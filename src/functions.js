// Cloud Functions entry point. Firebase Hosting sends every /api/... request here.
// The same web app runs inside the function; each request is handed to it in memory.
import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { buildApp } from './app.js';
import { config } from './config.js';
import { initFirebase } from './firebase.js';
import { createBucketStorage } from './storage.js';

setGlobalOptions({ region: config.region, maxInstances: 10 });

/** Turn the web app into a Cloud Functions handler (req and res are Express-style). */
export function createHandler(getApp) {
  return async (req, res) => {
    const app = await getApp();
    const headers = { ...req.headers };
    delete headers['content-length'];
    const r = await app.inject({
      method: req.method, url: req.originalUrl || req.url, headers,
      payload: req.rawBody && req.rawBody.length ? req.rawBody : undefined,
      remoteAddress: req.ip,
    });
    res.status(r.statusCode);
    for (const [k, v] of Object.entries(r.headers)) if (!['content-length', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
    res.end(r.rawPayload);
  };
}

let ready = null;
const getApp = () => (ready ||= (async () => {
  const fb = initFirebase();
  const app = await buildApp({ db: fb.db, storage: createBucketStorage(fb.bucket), serveStatic: false });
  await app.ready();
  return app;
})());

export const api = onRequest({ memory: '512MiB', timeoutSeconds: 120, concurrency: 40 }, createHandler(getApp));
