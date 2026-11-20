// The Vercel review site: requests through the Vercel entry point on a real HTTP server, Vercel's size
// limits (videos in pieces under 4 MB, uploads capped), the same security headers as Firebase Hosting,
// and the review setup script refusing the live Pelagos project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup, versionOf, CONTENT } from './helpers.js';
import { createVercelHandler } from '../src/vercel.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';

let env, server, base, app;
before(async () => {
  config.vercel = true; // as on Vercel
  env = await setup();
  app = await buildApp({ db: env.db, storage: env.storage, logger: false, serveStatic: false });
  server = http.createServer(createVercelHandler(async () => app));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { config.vercel = false; server.close(); await app.close(); await env.close(); });

// How Vercel calls the function: vercel.json rewrites /api/<path> to /api/index?__p=<path>.
const call = (p, opts = {}) => { const [pth, q] = p.replace(/^\/api\//, '').split('?'); return fetch(`${base}/api/index?__p=${pth}${q ? `&${q}` : ''}`, { redirect: 'manual', ...opts }); };

test('Requests go through the Vercel entry point: sign-in, cookie, signed-in pages', async () => {
  assert.equal((await call('/api/healthz')).status, 200);
  const r = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pelagos': '1' }, body: JSON.stringify({ clientCode: 'PELAGOS', staffNo: 'PL002', pin: '1234' }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await (await call('/api/me', { headers: { cookie } })).json();
  assert.equal(me.staff.name, 'Example Waitron');
  assert.equal(me.features.maxUploadMb, 4); assert.equal(me.features.reviewSite, true);
});

test('Videos stream in pieces under Vercel’s 4.5 MB limit; whole large files are refused politely', async () => {
  const m = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pelagos': '1' }, body: JSON.stringify({ clientCode: 'PELAGOS', staffNo: 'PL001', pin: '1234' }) });
  const cookie = m.headers.get('set-cookie').split(';')[0];
  const vid = (await versionOf(env.db, 'PEL-SOP-001')).videos[0].fileId;
  const part = await call(`/api/files/${vid}`, { headers: { cookie, range: 'bytes=0-' } });
  assert.equal(part.status, 206);
  const len = (await part.arrayBuffer()).byteLength;
  assert.ok(len <= 4 * 1024 * 1024 && len > 1024 * 1024, `piece of ${len} bytes`);
  assert.match(part.headers.get('content-range'), /^bytes 0-\d+\/\d+$/);
  assert.equal((await call(`/api/files/${vid}`, { headers: { cookie } })).status, 413);
});

test('Uploads over 4 MB are refused with a clear message suggesting YouTube', async () => {
  const m = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pelagos': '1' }, body: JSON.stringify({ clientCode: 'PELAGOS', staffNo: 'PL001', pin: '1234' }) });
  const cookie = m.headers.get('set-cookie').split(';')[0];
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(`${CONTENT}files/PEL-SOP-001-video.mp4`)], { type: 'video/mp4' }), 'big.mp4');
  const r = await call('/api/admin/files', { method: 'POST', headers: { cookie, 'x-pelagos': '1' }, body: fd });
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /review site.*YouTube/);
});

test('vercel.json routes the API and the platform page, with the same security rules as Firebase Hosting', () => {
  const v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const fb = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.deepEqual(v.rewrites.map(r => r.source), ['/api/:path*', '/platform']);
  const csp = h => h.find(x => x.key === 'Content-Security-Policy').value;
  assert.equal(csp(v.headers[0].headers), csp(fb.hosting.headers[0].headers));
  assert.equal(v.outputDirectory, 'public');
});

test('The review setup refuses the live Pelagos project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-'));
  const key = path.join(dir, 'key.json');
  fs.writeFileSync(key, JSON.stringify({ project_id: 'pelagos-portal', private_key: 'x', client_email: 'x@y' }));
  const r = spawnSync(process.execPath, ['scripts/setup-review.js', '--email', 'a@b.co', '--name', 'A'], { cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: key, FIRESTORE_EMULATOR_HOST: '' }, encoding: 'utf8', input: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /live project "pelagos-portal".*separate project/s);
});

test('Without its key, the review site says exactly what is missing', async () => {
  const { createVercelHandler, getVercelApp } = await import('../src/vercel.js');
  const old = [process.env.FIREBASE_SERVICE_ACCOUNT_B64, process.env.FIREBASE_SERVICE_ACCOUNT];
  delete process.env.FIREBASE_SERVICE_ACCOUNT_B64; delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const srv = http.createServer(createVercelHandler(getVercelApp));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/index?__p=healthz`);
  srv.close();
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /FIREBASE_SERVICE_ACCOUNT_B64 is missing/);
  if (old[0]) process.env.FIREBASE_SERVICE_ACCOUNT_B64 = old[0]; if (old[1]) process.env.FIREBASE_SERVICE_ACCOUNT = old[1];
});
