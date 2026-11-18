import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authHooks } from './auth.js';
import authRoutes from './routes/auth.js';
import myRoutes from './routes/my.js';
import fileRoutes from './routes/files.js';
import adminRoutes from './routes/admin.js';

/** Build the web app. db is Firestore (or the in-memory stand-in); storage is Cloud Storage (or memory). */
export async function buildApp({ db, storage, logger = true, orgId = config.orgId, serveStatic = true } = {}) {
  const app = Fastify({
    logger: logger && { level: config.production ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.body.pin'] },
    trustProxy: config.trustProxy,
    bodyLimit: 3 * 1024 * 1024, // JSON bodies; documents can be long. Files go through multipart.
  });
  app.decorate('db', db);
  app.decorate('storage', storage);
  app.decorate('orgId', orgId);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // style attributes only; scripts stay strictly same-origin
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
    hsts: config.production,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 5 }, throwFileSizeLimit: true });
  authHooks(app, db);

  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode || 500;
    if (code >= 500) req.log.error(err);
    const msg = code < 500 && (err.expose || err.validation || code === 413)
      ? (code === 413 ? 'That file is too large.' : err.message)
      : code < 500 ? 'That request could not be processed.' : 'Something went wrong on the server. Try again, and tell your manager if it keeps happening.';
    reply.code(code).send({ error: msg, problems: err.problems });
  });

  await app.register(authRoutes);
  await app.register(myRoutes);
  await app.register(fileRoutes);
  await app.register(adminRoutes);

  app.get('/api/healthz', async () => {
    await db.collection('orgs').doc(orgId).get();
    return { ok: true };
  });

  // On Firebase, Hosting serves the screens. When running as a plain Node server, this does.
  if (serveStatic) await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../public/', import.meta.url)),
    setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !serveStatic) return reply.code(404).send({ error: 'Not found.' });
    return reply.sendFile('index.html');
  });
  return app;
}
