const { Router } = require('express');
const { hashPassword, verifyPassword, setSession, clearSession, requireUser } = require('../auth');
const { HttpError, text, email } = require('../util');

module.exports = ({ db, tokens }) => {
  const r = Router();
  const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone };

  r.post('/register', (req, res) => {
    const name = text(req.body.name, { field: 'nombre', min: 2, max: 80 });
    const mail = email(req.body.email);
    const password = text(req.body.password, { field: 'contraseña', min: 6, max: 100 });
    const phone = text(req.body.phone, { field: 'teléfono', max: 20, required: false });

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) {
      throw new HttpError(409, 'Ese correo ya está registrado');
    }
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, 'cliente', ?)")
      .run(name, mail, hashPassword(password), phone);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    setSession(req, res, tokens, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  r.post('/login', (req, res) => {
    const mail = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
    if (!verifyPassword(password, user?.password_hash)) {
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
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

  r.put('/me', requireUser, (req, res) => {
    const name = text(req.body.name, { field: 'nombre', min: 2, max: 80 });
    const phone = text(req.body.phone, { field: 'teléfono', max: 20, required: false });
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);

    if (req.body.new_password) {
      const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(String(req.body.current_password || ''), current.password_hash)) {
        throw new HttpError(400, 'La contraseña actual no es correcta');
      }
      const next = text(req.body.new_password, { field: 'nueva contraseña', min: 6, max: 100 });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  });

  return r;
};
