// Vercel entry point. vercel.json sends every /api/... request to api/index.js, which hands it to the
// same web app the tests use, in memory (like the Cloud Functions entry point in functions.js).
import { buildApp } from './app.js';
import { initFirebase } from './firebase.js';
import { createBucketStorage } from './storage.js';
import { serviceAccountFromEnv } from './config.js';

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
      console.error(e.setup || e);
      res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
      // A missing key is a setup problem, not a secret: say so plainly, so it can be fixed.
      res.end(JSON.stringify({ error: e.setup || 'Something went wrong on the server. Try again in a moment.' }));
    }
  };
}

let ready = null;
export const getVercelApp = () => (ready ||= (async () => {
  if (!serviceAccountFromEnv()) {
    ready = null; // check again on the next request (after the setting is fixed and redeployed)
    throw Object.assign(new Error('NO_KEY'), { setup: 'The review site is not connected to its database: the Vercel setting FIREBASE_SERVICE_ACCOUNT_B64 is missing or is not a valid service account key. Add it, then deploy again (README: "Review site on Vercel").' });
  }
  const { db, bucket } = initFirebase();
  return buildApp({ db, storage: createBucketStorage(bucket), logger: false, serveStatic: false });
})());
