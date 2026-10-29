// Panel de administración: estadísticas, productos, categorías, pedidos y clientes.

const crypto = require('node:crypto');
const { Router } = require('express');
const multer = require('multer');
const { requireAdmin } = require('../auth');
const { PRODUCT_SELECT, ORDER_SELECT, withStock, getProduct, getOrder } = require('../queries');
const { getSettings, saveSettings, generateReceipt, printReceipt, attachReceiptDetails } = require('../receipts');
const { listPrinters, printTestTicket, sendToCentralPrinter } = require('../printer');
const util = require('../util');

const { HttpError } = util;
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const LOW_STOCK = 3;
// Perú está en UTC-5 todo el año; las ventas por día se agrupan con la hora local de la tienda.
const UTC_OFFSET_HOURS = Number(process.env.STORE_UTC_OFFSET ?? -5);

module.exports = ({ db }) => {
  const r = Router();
  r.use(requireAdmin);

  // La foto queda en memoria y se guarda en la base de datos junto con el producto.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (IMAGE_TYPES[file.mimetype]) cb(null, true);
      else cb(new HttpError(400, 'Formato de imagen no permitido (usa JPG, PNG o WEBP)'));
    },
  });

  async function saveImage(t, file) {
    const name = crypto.randomBytes(12).toString('hex') + IMAGE_TYPES[file.mimetype];
    await t.run('INSERT INTO images (name, mime, data) VALUES (?, ?, ?)', name, file.mimetype, file.buffer);
    return `/uploads/${name}`;
  }

  // Borra una foto que ya nadie usa, salvo que algún pedido antiguo todavía la muestre.
  async function removeImage(t, image) {
    if (!image?.startsWith('/uploads/')) return;
    await t.run(
      'DELETE FROM images WHERE name = ? AND NOT EXISTS (SELECT 1 FROM order_items WHERE image = ?) AND NOT EXISTS (SELECT 1 FROM products WHERE image = ?)',
      image.slice('/uploads/'.length), image, image,
    );
  }

  // ---------- Estadísticas ----------
  r.get('/stats', async (req, res) => {
    const offset = `${Number.isFinite(UTC_OFFSET_HOURS) ? UTC_OFFSET_HOURS : 0} hours`;
    const [sales, statusRows, dayRows, today, customers, products, topProducts, lowStock, recentOrders] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE status != 'cancelado'`),
      db.all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status'),
      db.all(`
        SELECT date(created_at, ?) AS day, SUM(total) AS total, COUNT(*) AS orders
        FROM orders
        WHERE status != 'cancelado' AND date(created_at, ?) >= date('now', ?, '-6 days')
        GROUP BY day`, offset, offset, offset),
      db.get("SELECT date('now', ?) AS d", offset),
      db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'cliente'"),
      db.get('SELECT COUNT(*) AS n FROM products WHERE active = 1'),
      db.all(`
        SELECT oi.product_id, oi.product_name AS name, oi.color, oi.accent, oi.design, oi.print, oi.image,
               SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price) AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status != 'cancelado'
        GROUP BY oi.product_id, oi.product_name
        ORDER BY units DESC, revenue DESC LIMIT 5`),
      db.all(`
        SELECT p.id, p.name, ps.size, ps.stock
        FROM product_stock ps JOIN products p ON p.id = ps.product_id
        WHERE p.active = 1 AND ps.stock <= ?
        ORDER BY ps.stock ASC, p.name LIMIT 8`, LOW_STOCK),
      db.all(`${ORDER_SELECT} ORDER BY o.id DESC LIMIT 6`),
    ]);

    const byStatus = Object.fromEntries(util.ORDER_STATUSES.map((s) => [s, 0]));
    for (const row of statusRows) byStatus[row.status] = row.n;
    const salesByDay = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today.d}T00:00:00Z`);
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
      customers: customers.n,
      products: products.n,
      salesByDay,
      topProducts,
      lowStock,
      recentOrders,
    });
  });

  // ---------- Productos ----------
  r.get('/products', async (req, res) => {
    res.json(await withStock(db, await db.all(`${PRODUCT_SELECT} ORDER BY p.id DESC`)));
  });

  async function readProduct(body) {
    const categoryId = body.category_id ? util.int(body.category_id, { field: 'categoría', min: 1 }) : null;
    if (categoryId && !(await db.get('SELECT 1 FROM categories WHERE id = ?', categoryId))) {
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

  async function saveStock(t, productId, stock) {
    for (const [size, qty] of Object.entries(stock)) {
      await t.run(`
        INSERT INTO product_stock (product_id, size, stock) VALUES (?, ?, ?)
        ON CONFLICT (product_id, size) DO UPDATE SET stock = excluded.stock`, productId, size, qty);
    }
  }

  r.post('/products', upload.single('image'), async (req, res) => {
    const p = await readProduct(req.body);
    const id = await db.tx(async (t) => {
      const image = req.file ? await saveImage(t, req.file) : null;
      const { lastInsertRowid } = await t.run(`
        INSERT INTO products (name, description, price, category_id, color, accent, design, print, image, featured, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.name, p.description, p.price, p.category_id, p.color, p.accent, p.design, p.print, image, p.featured, p.active);
      await saveStock(t, lastInsertRowid, p.stock);
      return lastInsertRowid;
    });
    res.status(201).json(await getProduct(db, id));
  });

  r.put('/products/:id', upload.single('image'), async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const p = await readProduct(req.body);
    await db.tx(async (t) => {
      const current = await t.get('SELECT image FROM products WHERE id = ?', id);
      if (!current) throw new HttpError(404, 'Producto no encontrado');
      let image = current.image;
      if (req.file) image = await saveImage(t, req.file);
      else if (util.bool(req.body.remove_image)) image = null;

      await t.run(`
        UPDATE products SET name = ?, description = ?, price = ?, category_id = ?, color = ?, accent = ?,
                            design = ?, print = ?, image = ?, featured = ?, active = ?
        WHERE id = ?`,
      p.name, p.description, p.price, p.category_id, p.color, p.accent, p.design, p.print, image, p.featured, p.active, id);
      await saveStock(t, id, p.stock);
      if (image !== current.image) await removeImage(t, current.image);
    });
    res.json(await getProduct(db, id));
  });

  r.delete('/products/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    await db.tx(async (t) => {
      const current = await t.get('SELECT image FROM products WHERE id = ?', id);
      if (!current) throw new HttpError(404, 'Producto no encontrado');
      // Los pedidos guardan una copia del nombre, color y precio, así que el historial no se pierde.
      await t.run('DELETE FROM product_stock WHERE product_id = ?', id);
      await t.run('UPDATE order_items SET product_id = NULL WHERE product_id = ?', id);
      await t.run('DELETE FROM products WHERE id = ?', id);
      await removeImage(t, current.image);
    });
    res.json({ ok: true });
  });

  // ---------- Categorías ----------
  r.get('/categories', async (req, res) => {
    res.json(await db.all(`
      SELECT c.id, c.name, COUNT(p.id) AS count
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.id`));
  });

  const categoryName = (body) => util.text(body.name, { field: 'nombre', min: 2, max: 40 });
  const assertUniqueCategory = async (name, exceptId = 0) => {
    if (await db.get('SELECT 1 FROM categories WHERE name = ? AND id != ?', name, exceptId)) {
      throw new HttpError(409, 'Ya existe una categoría con ese nombre');
    }
  };

  r.post('/categories', async (req, res) => {
    const name = categoryName(req.body);
    await assertUniqueCategory(name);
    const { lastInsertRowid } = await db.run('INSERT INTO categories (name) VALUES (?)', name);
    res.status(201).json({ id: lastInsertRowid, name, count: 0 });
  });

  r.put('/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const name = categoryName(req.body);
    await assertUniqueCategory(name, id);
    if ((await db.run('UPDATE categories SET name = ? WHERE id = ?', name, id)).changes !== 1) {
      throw new HttpError(404, 'Categoría no encontrada');
    }
    res.json({ id, name });
  });

  r.delete('/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    await db.tx(async (t) => {
      await t.run('UPDATE products SET category_id = NULL WHERE category_id = ?', id);
      if ((await t.run('DELETE FROM categories WHERE id = ?', id)).changes !== 1) {
        throw new HttpError(404, 'Categoría no encontrada');
      }
    });
    res.json({ ok: true });
  });

  // ---------- Pedidos ----------
  r.get('/orders', async (req, res) => {
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
    res.json(await db.all(sql, ...params));
  });

  r.get('/orders/:id', async (req, res) => {
    const order = await getOrder(db, parseInt(req.params.id, 10) || 0);
    if (!order) throw new HttpError(404, 'Pedido no encontrado');
    res.json(order);
  });

  r.patch('/orders/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const status = util.oneOf(req.body.status, util.ORDER_STATUSES, 'estado');
    await db.tx(async (t) => {
      const order = await getOrder(t, id);
      if (!order) throw new HttpError(404, 'Pedido no encontrado');
      if (order.status === status) return;
      if (order.status === 'cancelado') throw new HttpError(409, 'Un pedido cancelado no se puede reactivar');
      if (status === 'cancelado') await util.restock(t, order.items);
      await t.run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
    });

    // Si el estado cambia a pagado, generar boleta y enviar a impresión automática
    if (status === 'pagado') {
      try {
        await generateReceipt(db, id, { autoPrint: true });
      } catch (err) {
        console.error('Error generando boleta automática al pagar:', err);
      }
    }

    res.json(await getOrder(db, id));
  });

  // ---------- Clientes ----------
  r.get('/customers', async (req, res) => {
    res.json(await db.all(`
      SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at,
             COUNT(o.id) AS orders,
             COALESCE(SUM(CASE WHEN o.status != 'cancelado' THEN o.total END), 0) AS spent,
             MAX(o.created_at) AS last_order
      FROM users u LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'cliente'
      GROUP BY u.id
      ORDER BY u.id DESC`));
  });

  r.patch('/customers/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const active = util.bool(req.body.active) ? 1 : 0;
    const result = await db.run("UPDATE users SET active = ? WHERE id = ? AND role = 'cliente'", active, id);
    if (result.changes !== 1) throw new HttpError(404, 'Cliente no encontrado');
    res.json({ id, active: Boolean(active) });
  });

  // ---------- Boletas e Impresión ----------
  r.get('/printer', async (req, res) => {
    const settings = await getSettings(db);
    const printers = await listPrinters();
    res.json({ settings, printers });
  });

  r.put('/printer', async (req, res) => {
    const {
      printer_name,
      printer_paper_width,
      printer_auto_cut,
      printer_auto_print,
      print_method,
      central_jobs_url,
      central_site_access_token,
      central_submit_token,
      central_source_name,
      store_business_name,
      store_ruc,
      store_address,
      store_phone,
      receipt_series,
    } = req.body;

    const toSave = {};
    if (printer_name !== undefined) toSave.printer_name = String(printer_name || '').trim();
    if (printer_paper_width !== undefined) {
      toSave.printer_paper_width = ['58mm', '80mm'].includes(printer_paper_width) ? printer_paper_width : '58mm';
    }
    if (printer_auto_cut !== undefined) toSave.printer_auto_cut = util.bool(printer_auto_cut) ? '1' : '0';
    if (printer_auto_print !== undefined) {
      toSave.printer_auto_print = ['on_paid', 'on_order', 'disabled'].includes(printer_auto_print) ? printer_auto_print : 'on_paid';
    }
    if (print_method !== undefined) {
      toSave.print_method = ['central', 'windows_direct'].includes(print_method) ? print_method : 'central';
    }
    if (central_jobs_url !== undefined) toSave.central_jobs_url = String(central_jobs_url || '').trim();
    if (central_site_access_token !== undefined) toSave.central_site_access_token = String(central_site_access_token || '').trim();
    if (central_submit_token !== undefined) toSave.central_submit_token = String(central_submit_token || '').trim();
    if (central_source_name !== undefined) toSave.central_source_name = String(central_source_name || 'POLOLAB').trim();

    if (store_business_name !== undefined) toSave.store_business_name = util.text(store_business_name, { field: 'razón social', min: 2, max: 100 });
    if (store_ruc !== undefined) toSave.store_ruc = util.text(store_ruc, { field: 'RUC', min: 8, max: 20, required: false });
    if (store_address !== undefined) toSave.store_address = util.text(store_address, { field: 'dirección', max: 150, required: false });
    if (store_phone !== undefined) toSave.store_phone = util.text(store_phone, { field: 'teléfono', max: 50, required: false });
    if (receipt_series !== undefined) toSave.receipt_series = util.text(receipt_series, { field: 'serie', min: 2, max: 10 }).toUpperCase();

    await saveSettings(db, toSave);
    res.json(await getSettings(db));
  });

  r.post('/printer/test-central', async (req, res) => {
    const settings = await getSettings(db);
    const jobsUrl = req.body.central_jobs_url || settings.central_jobs_url;
    const siteAccessToken = req.body.central_site_access_token || settings.central_site_access_token;
    const submitToken = req.body.central_submit_token || settings.central_submit_token;
    const source = req.body.central_source_name || settings.central_source_name || 'POLOLAB';

    if (!jobsUrl || !siteAccessToken || !submitToken) {
      throw new HttpError(400, 'Configura la URL y los tokens de la Central de Impresión');
    }

    const testId = `TEST-${Date.now().toString().slice(-6)}`;
    const fecha = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });
    const content = [
      '================================',
      `   ${settings.store_business_name || 'POLOLAB PERÚ'}`,
      '   CENTRAL DE IMPRESIÓN CLOUD',
      '================================',
      `Fecha: ${fecha}`,
      `ID Prueba: ${testId}`,
      'Estado: CONEXIÓN EXITOSA',
      '--------------------------------',
      'La tienda virtual está conectada',
      'con tu Central de Comprobantes.',
      'El comprobante se imprimirá en',
      'la impresora POS58 de tu PC.',
      '================================',
      'POLOLAB · Hecho en Perú',
      '================================',
      '',
      '',
    ].join('\n');

    const result = await sendToCentralPrinter({
      jobsUrl,
      siteAccessToken,
      submitToken,
      source,
      externalId: testId,
      title: `Prueba Central ${testId}`,
      content,
      copies: 1,
    });

    res.json({ ok: true, message: 'Ticket de prueba enviado a la Central de Impresión', ...result });
  });

  r.post('/printer/test', async (req, res) => {
    const settings = await getSettings(db);
    const printerName = req.body.printer_name || settings.printer_name;
    const paperWidth = req.body.printer_paper_width || settings.printer_paper_width;
    const autoCut = req.body.printer_auto_cut !== undefined ? util.bool(req.body.printer_auto_cut) : settings.printer_auto_cut === '1';

    if (!printerName) throw new HttpError(400, 'Selecciona una impresora para la prueba');

    const result = await printTestTicket(printerName, {
      width: paperWidth,
      autoCut,
      storeInfo: {
        name: settings.store_business_name,
        ruc: settings.store_ruc,
        address: settings.store_address,
        phone: settings.store_phone,
      },
    });
    res.json(result);
  });

  r.get('/receipts', async (req, res) => {
    const where = [];
    const params = [];
    if (['pendiente', 'impresa', 'fallida'].includes(req.query.status)) {
      where.push('r.print_status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      const q = String(req.query.q).trim().replace(/^#/, '');
      where.push('(r.receipt_number LIKE ? OR r.customer_name LIKE ? OR r.order_id = ?)');
      params.push(`%${q}%`, `%${q}%`, parseInt(q, 10) || 0);
    }
    const sql = `
      SELECT r.*, o.created_at AS order_date, o.status AS order_status
      FROM receipts r
      JOIN orders o ON o.id = r.order_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.id DESC LIMIT 200`;
    res.json(await db.all(sql, ...params));
  });

  r.get('/receipts/:id', async (req, res) => {
    const receipt = await db.get('SELECT * FROM receipts WHERE id = ?', parseInt(req.params.id, 10) || 0);
    if (!receipt) throw new HttpError(404, 'Boleta no encontrada');
    const order = await getOrder(db, receipt.order_id);
    const settings = await getSettings(db);
    res.json(attachReceiptDetails(receipt, order, settings));
  });

  r.post('/receipts/:id/print', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const method = req.body?.method;
    const result = await printReceipt(db, id, { method });
    const receipt = await db.get('SELECT * FROM receipts WHERE id = ?', id);
    res.json({ ...result, receipt });
  });

  r.post('/orders/:id/receipt', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const autoPrint = req.body.print !== false;
    const receipt = await generateReceipt(db, id, { autoPrint, forceImmediatePrint: autoPrint });
    res.status(201).json(receipt);
  });

  return r;
};
