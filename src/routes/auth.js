const { Router } = require('express');
const { hashPassword, verifyPassword, setSession, clearSession, requireUser } = require('../auth');
const { createLimiter } = require('../limiter');
const { HttpError, text, email } = require('../util');

const TOO_MANY = 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';

module.exports = ({ db, tokens }) => {
  const r = Router();
  const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone };
  // 8 contraseñas incorrectas por correo y dirección en 15 minutos; 20 registros por dirección por hora.
  const loginLimit = createLimiter({ max: 8, windowMs: 15 * 60 * 1000 });
  const registerLimit = createLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

  r.post('/register', async (req, res) => {
    if (registerLimit.blocked(req.ip)) throw new HttpError(429, TOO_MANY);
    registerLimit.hit(req.ip);
    const name = text(req.body.name, { field: 'nombre', min: 2, max: 80 });
    const mail = email(req.body.email);
    const password = text(req.body.password, { field: 'contraseña', min: 6, max: 100 });
    const phone = text(req.body.phone, { field: 'teléfono', max: 20, required: false });

    if (await db.get('SELECT 1 FROM users WHERE email = ?', mail)) {
      throw new HttpError(409, 'Ese correo ya está registrado');
    }
    const { lastInsertRowid } = await db.run(
      "INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, 'cliente', ?)",
      name, mail, hashPassword(password), phone,
    );
    const user = await db.get('SELECT * FROM users WHERE id = ?', lastInsertRowid);
    setSession(req, res, tokens, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  r.post('/login', async (req, res) => {
    const mail = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const key = `${req.ip}|${mail}`;
    if (loginLimit.blocked(key)) throw new HttpError(429, TOO_MANY);

    const user = await db.get('SELECT * FROM users WHERE email = ?', mail);
    if (!verifyPassword(password, user?.password_hash)) {
      loginLimit.hit(key);
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    loginLimit.reset(key);
    if (!user.active) throw new HttpError(403, 'Tu cuenta está desactivada. Contacta a la tienda.');
    setSession(req, res, tokens, user.id);
    res.json({ user: publicUser(user) });
  });

  r.post('/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  r.put('/me', requireUser, async (req, res) => {
    const name = text(req.body.name, { field: 'nombre', min: 2, max: 80 });
    const phone = text(req.body.phone, { field: 'teléfono', max: 20, required: false });

    let passwordHash = null;
    if (req.body.new_password) {
      const current = await db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
      if (!verifyPassword(String(req.body.current_password || ''), current.password_hash)) {
        throw new HttpError(400, 'La contraseña actual no es correcta');
      }
      passwordHash = hashPassword(text(req.body.new_password, { field: 'nueva contraseña', min: 6, max: 100 }));
    }
    await db.run(
      'UPDATE users SET name = ?, phone = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?',
      name, phone, passwordHash, req.user.id,
    );
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ user: publicUser(user) });
  });

  return r;
};
