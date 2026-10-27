const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { openDb } = require('./db');
const { createTokens, parseCookies, SESSION_COOKIE } = require('./auth');
const { HttpError } = require('./util');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

function createApp({ dataDir = path.join(__dirname, '..', 'data'), dbFile } = {}) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const db = openDb(dbFile ?? path.join(dataDir, 'tienda.db'));
  const tokens = createTokens(loadSecret(dataDir));
  const ctx = { db, tokens, uploadsDir };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.locals.db = db;

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  // Las peticiones que modifican datos deben venir de esta misma web.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next();
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {}
    if (host !== req.get('host')) return next(new HttpError(403, 'Origen no permitido'));
    next();
  });

  const findUser = db.prepare('SELECT id, name, email, role, phone FROM users WHERE id = ? AND active = 1');
  app.use((req, res, next) => {
    const session = tokens.read(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    req.user = session ? findUser.get(session.uid) ?? null : null;
    next();
  });

  app.use('/api/auth', require('./routes/auth')(ctx));
  app.use('/api/orders', require('./routes/orders')(ctx));
  app.use('/api/admin', require('./routes/admin')(ctx));
  app.use('/api', require('./routes/catalog')(ctx));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  // El panel solo se entrega a administradores; los datos además están protegidos en /api/admin.
  app.get(['/admin', '/admin.html'], (req, res, next) => {
    if (req.user?.role !== 'admin') return res.redirect('/login.html?next=/admin.html');
    if (req.path === '/admin') return res.redirect('/admin.html');
    next();
  });

  app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 2 MB' : 'No se pudo subir la imagen';
    } else if (err.type === 'entity.parse.failed') {
      message = 'Los datos enviados no son válidos';
    } else if (status >= 500) {
      console.error(err);
      message = 'Ocurrió un error en el servidor';
    }
    if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
    res.status(status).type('text').send(message);
  });

  return app;
}

module.exports = { createApp };
