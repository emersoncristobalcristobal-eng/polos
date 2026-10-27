// Panel de administración: estadísticas, productos, categorías, pedidos y clientes.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Router } = require('express');
const multer = require('multer');
const { requireAdmin } = require('../auth');
const { PRODUCT_SELECT, ORDER_SELECT, withStock, getProduct, getOrder } = require('../queries');
const util = require('../util');

const { HttpError } = util;
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const LOW_STOCK = 3;
// Perú está en UTC-5 todo el año; las ventas por día se agrupan con la hora local de la tienda.
const UTC_OFFSET_HOURS = Number(process.env.STORE_UTC_OFFSET ?? -5);

module.exports = ({ db, uploadsDir }) => {
  const r = Router();
  r.use(requireAdmin);

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + IMAGE_TYPES[file.mimetype]),
    }),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (IMAGE_TYPES[file.mimetype]) cb(null, true);
      else cb(new HttpError(400, 'Formato de imagen no permitido (usa JPG, PNG o WEBP)'));
    },
  });

  // Borra una imagen subida, salvo que algún pedido antiguo todavía la muestre.
  const removeImage = (image) => {
    if (!image?.startsWith('/uploads/')) return;
    if (db.prepare('SELECT 1 FROM order_items WHERE image = ?').get(image)) return;
    fs.rm(path.join(uploadsDir, path.basename(image)), { force: true }, () => {});
  };

  // ---------- Estadísticas ----------
  r.get('/stats', (req, res) => {
    const offset = `${Number.isFinite(UTC_OFFSET_HOURS) ? UTC_OFFSET_HOURS : 0} hours`;
    const sales = db.prepare(`
      SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
      FROM orders WHERE status != 'cancelado'`).get();
    const byStatus = Object.fromEntries(util.ORDER_STATUSES.map((s) => [s, 0]));
    for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()) byStatus[row.status] = row.n;

    const dayRows = db.prepare(`
      SELECT date(created_at, ?) AS day, SUM(total) AS total, COUNT(*) AS orders
      FROM orders
      WHERE status != 'cancelado' AND date(created_at, ?) >= date('now', ?, '-6 days')
      GROUP BY day`).all(offset, offset, offset);
    const today = db.prepare("SELECT date('now', ?) AS d").get(offset).d;
    const salesByDay = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const day = d.toISOString().slice(0, 10);
      const row = dayRows.find((x) => x.day === day);
      salesByDay.push({ day, total: row?.total ?? 0, orders: row?.orders ?? 0 });
    }

    res.json({
      revenue: sales.revenue,
      orders: sales.orders,
      averageTicket: sales.orders ? Math.round(sales.revenue / sales.orders) : 0,
      byStatus,
      customers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'cliente'").get().n,
      products: db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n,
      salesByDay,
      topProducts: db.prepare(`
        SELECT oi.product_id, oi.product_name AS name, oi.color, oi.accent, oi.design, oi.print, oi.image,
               SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price) AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status != 'cancelado'
        GROUP BY oi.product_id, oi.product_name
        ORDER BY units DESC, revenue DESC LIMIT 5`).all(),
      lowStock: db.prepare(`
        SELECT p.id, p.name, ps.size, ps.stock
        FROM product_stock ps JOIN products p ON p.id = ps.product_id
        WHERE p.active = 1 AND ps.stock <= ?
        ORDER BY ps.stock ASC, p.name LIMIT 8`).all(LOW_STOCK),
      recentOrders: db.prepare(`${ORDER_SELECT} ORDER BY o.id DESC LIMIT 6`).all(),
    });
  });

  // ---------- Productos ----------
  r.get('/products', (req, res) => {
    const rows = db.prepare(`${PRODUCT_SELECT} ORDER BY p.id DESC`).all();
    res.json(withStock(db, rows));
  });

  function readProduct(body) {
    const categoryId = body.category_id ? util.int(body.category_id, { field: 'categoría', min: 1 }) : null;
    if (categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) {
      throw new HttpError(400, 'La categoría no existe');
    }
    return {
      name: util.text(body.name, { field: 'nombre', min: 3, max: 80 }),
      description: util.text(body.description, { field: 'descripción', max: 800, required: false }),
      price: util.cents(body.price),
      category_id: categoryId,
      color: util.color(body.color, 'color del polo'),
      accent: util.color(body.accent, 'color de acento'),
      design: util.oneOf(body.design, util.DESIGNS, 'diseño'),
      print: util.oneOf(body.print || 'ninguno', util.PRINTS, 'estampado'),
      featured: util.bool(body.featured) ? 1 : 0,
      active: util.bool(body.active) ? 1 : 0,
      stock: Object.fromEntries(
        util.SIZES.map((s) => [s, util.int(body[`stock_${s}`] || 0, { field: `stock talla ${s}`, min: 0, max: 9999 })]),
      ),
    };
  }

  function saveStock(productId, stock) {
    const stmt = db.prepare(`
      INSERT INTO product_stock (product_id, size, stock) VALUES (?, ?, ?)
      ON CONFLICT (product_id, size) DO UPDATE SET stock = excluded.stock`);
    for (const [size, qty] of Object.entries(stock)) stmt.run(productId, size, qty);
  }

  // Si algo falla después de subir la imagen, no dejamos el archivo huérfano.
  const cleanupOnError = (handler) => (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      if (req.file) fs.rm(req.file.path, { force: true }, () => {});
      throw err;
    }
  };

  r.post('/products', upload.single('image'), cleanupOnError((req, res) => {
    const p = readProduct(req.body);
    const image = req.file ? `/uploads/${req.file.filename}` : null;
    const id = util.tx(db, () => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO products (name, description, price, category_id, color, accent, design, print, image, featured, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(p.name, p.description, p.price, p.category_id, p.color, p.accent, p.design, p.print, image, p.featured, p.active);
      saveStock(lastInsertRowid, p.stock);
      return lastInsertRowid;
    });
    res.status(201).json(getProduct(db, id));
  }));

  r.put('/products/:id', upload.single('image'), cleanupOnError((req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const current = getProduct(db, id);
    if (!current) throw new HttpError(404, 'Producto no encontrado');
    const p = readProduct(req.body);

    let image = current.image;
    if (req.file || util.bool(req.body.remove_image)) image = req.file ? `/uploads/${req.file.filename}` : null;

    util.tx(db, () => {
      db.prepare(`
        UPDATE products SET name = ?, description = ?, price = ?, category_id = ?, color = ?, accent = ?,
                            design = ?, print = ?, image = ?, featured = ?, active = ?
        WHERE id = ?`)
        .run(p.name, p.description, p.price, p.category_id, p.color, p.accent, p.design, p.print, image, p.featured, p.active, id);
      saveStock(id, p.stock);
    });
    if (image !== current.image) removeImage(current.image);
    res.json(getProduct(db, id));
  }));

  r.delete('/products/:id', (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const current = getProduct(db, id);
    if (!current) throw new HttpError(404, 'Producto no encontrado');
    // Los pedidos guardan una copia del nombre, color y precio, así que el historial no se pierde.
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    removeImage(current.image);
    res.json({ ok: true });
  });

  // ---------- Categorías ----------
  r.get('/categories', (req, res) => {
    res.json(db.prepare(`
      SELECT c.id, c.name, COUNT(p.id) AS count
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.id`).all());
  });

  const categoryName = (body) => util.text(body.name, { field: 'nombre', min: 2, max: 40 });
  const assertUniqueCategory = (name, exceptId = 0) => {
    if (db.prepare('SELECT 1 FROM categories WHERE name = ? AND id != ?').get(name, exceptId)) {
      throw new HttpError(409, 'Ya existe una categoría con ese nombre');
    }
  };

  r.post('/categories', (req, res) => {
    const name = categoryName(req.body);
    assertUniqueCategory(name);
    const { lastInsertRowid } = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ id: lastInsertRowid, name, count: 0 });
  });

  r.put('/categories/:id', (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const name = categoryName(req.body);
    assertUniqueCategory(name, id);
    if (db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id).changes !== 1) {
      throw new HttpError(404, 'Categoría no encontrada');
    }
    res.json({ id, name });
  });

  r.delete('/categories/:id', (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    if (db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes !== 1) {
      throw new HttpError(404, 'Categoría no encontrada');
    }
    res.json({ ok: true });
  });

  // ---------- Pedidos ----------
  r.get('/orders', (req, res) => {
    const where = [];
    const params = [];
    if (util.ORDER_STATUSES.includes(req.query.status)) {
      where.push('o.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      const q = String(req.query.q).trim().replace(/^#/, '');
      where.push('(o.id = ? OR u.name LIKE ? OR u.email LIKE ? OR o.ship_name LIKE ?)');
      params.push(parseInt(q, 10) || 0, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const sql = `${ORDER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC LIMIT 200`;
    res.json(db.prepare(sql).all(...params));
  });

  r.get('/orders/:id', (req, res) => {
    const order = getOrder(db, parseInt(req.params.id, 10) || 0);
    if (!order) throw new HttpError(404, 'Pedido no encontrado');
    res.json(order);
  });

  r.patch('/orders/:id', (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const status = util.oneOf(req.body.status, util.ORDER_STATUSES, 'estado');
    util.tx(db, () => {
      const order = getOrder(db, id);
      if (!order) throw new HttpError(404, 'Pedido no encontrado');
      if (order.status === status) return;
      if (order.status === 'cancelado') throw new HttpError(409, 'Un pedido cancelado no se puede reactivar');
      if (status === 'cancelado') util.restock(db, order.items);
      db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    });
    res.json(getOrder(db, id));
  });

  // ---------- Clientes ----------
  r.get('/customers', (req, res) => {
    res.json(db.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at,
             COUNT(o.id) AS orders,
             COALESCE(SUM(CASE WHEN o.status != 'cancelado' THEN o.total END), 0) AS spent,
             MAX(o.created_at) AS last_order
      FROM users u LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'cliente'
      GROUP BY u.id
      ORDER BY u.id DESC`).all());
  });

  r.patch('/customers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const active = util.bool(req.body.active) ? 1 : 0;
    const result = db.prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'cliente'").run(active, id);
    if (result.changes !== 1) throw new HttpError(404, 'Cliente no encontrado');
    res.json({ id, active: Boolean(active) });
  });

  return r;
};
