// The Cloud Functions adapter: requests arrive Express-style with the body already read (rawBody).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, CONTENT } from './helpers.js';
import { createHandler } from '../src/functions.js';

let env, handler;
before(async () => { env = await setup(); handler = createHandler(async () => env.app); });
after(async () => { await env.close(); });

function call(method, url, { headers = {}, body } = {}) {
  return new Promise(resolve => {
    const out = { status: 0, headers: {}, body: null };
    const res = {
      status(c) { out.status = c; return this; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(b) { out.body = b; resolve(out); },
    };
    handler({ method, url, originalUrl: url, headers: { host: 'localhost', ...headers }, rawBody: body, ip: '10.0.0.5' }, res);
  });
}
const cookieOf = r => String([].concat(r.headers['set-cookie'])[0]).split(';')[0];

test('sign-in, a staff page and the __session cookie work through the function', async () => {
  const login = await call('POST', '/api/auth/login', { headers: { 'content-type': 'application/json', 'x-pelagos': '1' }, body: Buffer.from(JSON.stringify({ clientCode: 'PELAGOS', staffNo: 'PL002', pin: '1234' })) });
  assert.equal(login.status, 200);
  assert.match(cookieOf(login), /^__session=/, 'Firebase Hosting only forwards a cookie named __session');
  const course = await call('GET', '/api/my/course', { headers: { cookie: cookieOf(login) } });
  assert.equal(course.status, 200);
  assert.equal(JSON.parse(course.body.toString()).total, 12);
  const ev = (await env.db.collection('loginEvents').where('staffNo', '==', 'PL002').get()).docs.map(d => d.data());
  assert.ok(ev.some(e => e.ip === '10.0.0.5'), 'the real client IP is recorded');
});

test('a PDF upload (multipart) and a video range request work through the function', async () => {
  const login = await call('POST', '/api/auth/login', { headers: { 'content-type': 'application/json', 'x-pelagos': '1' }, body: Buffer.from(JSON.stringify({ clientCode: 'PELAGOS', staffNo: 'PL001', pin: '1234' })) });
  const cookie = cookieOf(login);
  const pdf = fs.readFileSync(`${CONTENT}files/PEL-SOP-003.pdf`);
  const b = '----pelagosboundary';
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${b}--\r\n`)]);
  const up = await call('POST', '/api/admin/files', { headers: { cookie, 'x-pelagos': '1', 'content-type': `multipart/form-data; boundary=${b}` }, body });
  assert.equal(up.status, 200, up.body && up.body.toString());
  const f = JSON.parse(up.body.toString());
  assert.equal(f.kind, 'pdf'); assert.equal(f.size, pdf.length);
  const vid = (await env.db.collection('files').where('kind', '==', 'video').get()).docs[0].id;
  const r = await call('GET', `/api/files/${vid}`, { headers: { cookie, range: 'bytes=0-' } });
  assert.equal(r.status, 206);
  assert.equal(r.body.length, 8 * 1024 * 1024, 'large ranges are served in 8 MB pieces');
  assert.match(r.headers['content-range'], /^bytes 0-8388607\/13081160$/);
});
