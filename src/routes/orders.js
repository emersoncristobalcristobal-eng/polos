// Pedidos del cliente que inició sesión.

const { Router } = require('express');
const { requireUser } = require('../auth');
const { ORDER_SELECT, getOrder, withItems } = require('../queries');
const { getSettings, generateReceipt, attachReceiptDetails } = require('../receipts');
const util = require('../util');

const { HttpError } = util;

module.exports = ({ db }) => {
  const r = Router();
  r.use(requireUser);

  r.post('/', async (req, res) => {
    const { items, shipping = {}, payment_method: paymentMethod, notes } = req.body;
    if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Tu carrito está vacío');
    if (items.length > 30) throw new HttpError(400, 'Demasiados productos en un solo pedido');

    const ship = {
      name: util.text(shipping.name, { field: 'nombre de quien recibe', min: 2, max: 80 }),
      phone: util.text(shipping.phone, { field: 'teléfono', min: 6, max: 20 }),
      address: util.text(shipping.address, { field: 'dirección', min: 5, max: 160 }),
      city: util.text(shipping.city, { field: 'ciudad', min: 2, max: 60 }),
    };
    util.oneOf(paymentMethod, util.PAYMENT_METHODS, 'método de pago');
    const orderNotes = util.text(notes, { field: 'notas', max: 300, required: false });
    const lines = items.map((item) => ({
      productId: util.int(item?.product_id, { field: 'producto', min: 1 }),
      size: util.oneOf(item.size, util.SIZES, 'talla'),
      quantity: util.int(item.quantity, { field: 'cantidad', min: 1, max: util.MAX_QTY_PER_LINE }),
      custom: util.customText(item.custom_text),
    }));

    // El stock se descuenta dentro de la transacción: si una línea falla, no se descuenta nada.
    const orderId = await db.tx(async (t) => {
      for (const line of lines) {
        line.p = await t.get('SELECT id, name, price, color, accent, design, print, image, active FROM products WHERE id = ?', line.productId);
        if (!line.p || !line.p.active) throw new HttpError(400, 'Un producto de tu carrito ya no está disponible');
        const taken = await t.run(
          'UPDATE product_stock SET stock = stock - ? WHERE product_id = ? AND size = ? AND stock >= ?',
          line.quantity, line.productId, line.size, line.quantity,
        );
        if (taken.changes !== 1) throw new HttpError(409, `No hay stock suficiente de "${line.p.name}" en talla ${line.size}`);
        line.unit = line.p.price + (line.custom ? util.CUSTOM_FEE : 0);
      }

      const subtotal = lines.reduce((sum, l) => sum + l.unit * l.quantity, 0);
      const shippingCost = subtotal >= util.FREE_SHIPPING_FROM ? 0 : util.SHIPPING_COST;
      const { lastInsertRowid: id } = await t.run(`
        INSERT INTO orders (user_id, subtotal, shipping, total, ship_name, ship_phone, ship_address, ship_city, payment_method, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id, subtotal, shippingCost, subtotal + shippingCost, ship.name, ship.phone, ship.address, ship.city, paymentMethod, orderNotes);

      for (const l of lines) {
        await t.run(`
          INSERT INTO order_items (order_id, product_id, product_name, size, quantity, unit_price, custom_text, color, accent, design, print, image)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, l.p.id, l.p.name, l.size, l.quantity, l.unit, l.custom, l.p.color, l.p.accent, l.p.design, l.p.print, l.p.image);
      }
      return id;
    });

    try {
      const settings = await getSettings(db);
      if (settings.printer_auto_print === 'on_order') {
        await generateReceipt(db, orderId, { autoPrint: true });
      }
    } catch (err) {
      console.error('Error generando boleta al crear pedido:', err);
    }

    res.status(201).json(await getOrder(db, orderId));
  });

  r.get('/', async (req, res) => {
    const orders = await db.all(`${ORDER_SELECT} WHERE o.user_id = ? ORDER BY o.id DESC`, req.user.id);
    res.json(await withItems(db, orders));
  });

  r.get('/:id', async (req, res) => {
    const order = await getOrder(db, parseInt(req.params.id, 10) || 0);
    if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Pedido no encontrado');
    res.json(order);
  });

  r.get('/:id/receipt', async (req, res) => {
    const orderId = parseInt(req.params.id, 10) || 0;
    const order = await getOrder(db, orderId);
    if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Pedido no encontrado');
    const receipt = await db.get('SELECT * FROM receipts WHERE order_id = ?', orderId);
    if (!receipt) throw new HttpError(404, 'La boleta para este pedido aún no ha sido emitida');
    const settings = await getSettings(db);
    res.json(attachReceiptDetails(receipt, order, settings));
  });

  r.post('/:id/cancel', async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    await db.tx(async (t) => {
      const order = await getOrder(t, id);
      if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Pedido no encontrado');
      if (order.status !== 'pendiente') throw new HttpError(409, 'Solo puedes cancelar pedidos pendientes');
      await util.restock(t, order.items);
      await t.run("UPDATE orders SET status = 'cancelado', updated_at = datetime('now') WHERE id = ?", id);
    });
    res.json(await getOrder(db, id));
  });

  return r;
};
