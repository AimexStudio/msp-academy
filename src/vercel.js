// Vercel entry point. vercel.json sends every /api/... request to api/index.js, which hands it to the
// same web app the tests use, in memory (like the Cloud Functions entry point in functions.js).
import { buildApp } from './app.js';
import { initFirebase } from './firebase.js';
import { createBucketStorage } from './storage.js';

/** The original address of the request: vercel.json passes it as __p when routing to api/index. */
export function originalUrl(raw) {
  const u = new URL(raw || '/', 'http://x');
  if (u.pathname === '/api/index' && u.searchParams.has('__p')) {
    const p = u.searchParams.get('__p');
    u.searchParams.delete('__p');
    const q = u.searchParams.toString();
    return `/api/${p.replace(/^\/+/, '').replace(/^api\//, '')}${q ? `?${q}` : ''}`;
  }
  return u.pathname + u.search;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}

/** A Node (req, res) handler around the app. getApp returns the Fastify app (built once per instance). */
export function createVercelHandler(getApp) {
  return async (req, res) => {
    try {
      const app = await getApp();
      const body = ['GET', 'HEAD'].includes(req.method) ? null : await readBody(req);
      const headers = { ...req.headers };
      delete headers['content-length'];
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
      const r = await app.inject({ method: req.method, url: originalUrl(req.url), headers, payload: body && body.length ? body : undefined, remoteAddress: ip });
      res.statusCode = r.statusCode;
      for (const [k, v] of Object.entries(r.headers)) if (!['content-length', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
      res.end(r.rawPayload);
    } catch (e) {
      console.error(e);
      res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Something went wrong on the server. Try again in a moment.' }));
    }
  };
}

let ready = null;
export const getVercelApp = () => (ready ||= (async () => {
  const { db, bucket } = initFirebase();
  return buildApp({ db, storage: createBucketStorage(bucket), logger: false, serveStatic: false });
})());
