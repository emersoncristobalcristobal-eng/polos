// Contraseñas con scrypt y sesiones con un token firmado (HMAC) en una cookie httpOnly.

const crypto = require('node:crypto');
const { HttpError } = require('./util');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const DUMMY_HASH = hashPassword('contraseña-de-relleno');

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored || DUMMY_HASH).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected) && Boolean(stored);
}

function createTokens(secret) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    issue(userId) {
      const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    read(token) {
      if (typeof token !== 'string') return null;
      const [payload, sig] = token.split('.');
      if (!payload || !sig) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(sig);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data.exp > Date.now() ? data : null;
      } catch {
        return null;
      }
    },
  };
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

function setSession(req, res, tokens, userId) {
  res.cookie(SESSION_COOKIE, tokens.issue(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Debes iniciar sesión'));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Debes iniciar sesión'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Acceso solo para administradores'));
  next();
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createTokens,
  parseCookies,
  setSession,
  clearSession,
  requireUser,
  requireAdmin,
};
