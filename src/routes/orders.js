// Pedidos del cliente que inició sesión.

const { Router } = require('express');
const { requireUser } = require('../auth');
const { ORDER_SELECT, getOrder } = require('../queries');
const util = require('../util');

const { HttpError } = util;

module.exports = ({ db }) => {
  const r = Router();
  r.use(requireUser);

  r.post('/', (req, res) => {
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

    const findProduct = db.prepare('SELECT id, name, price, color, accent, design, image, active FROM products WHERE id = ?');
    const takeStock = db.prepare(
      'UPDATE product_stock SET stock = stock - ? WHERE product_id = ? AND size = ? AND stock >= ?',
    );

    const orderId = util.tx(db, () => {
      const lines = [];
      for (const item of items) {
        const productId = util.int(item?.product_id, { field: 'producto', min: 1 });
        const size = util.oneOf(item.size, util.SIZES, 'talla');
        const quantity = util.int(item.quantity, { field: 'cantidad', min: 1, max: util.MAX_QTY_PER_LINE });
        const custom = util.customText(item.custom_text);

        const p = findProduct.get(productId);
        if (!p || !p.active) throw new HttpError(400, 'Un producto de tu carrito ya no está disponible');
        if (takeStock.run(quantity, productId, size, quantity).changes !== 1) {
          throw new HttpError(409, `No hay stock suficiente de "${p.name}" en talla ${size}`);
        }
        lines.push({ p, size, quantity, custom, unit: p.price + (custom ? util.CUSTOM_FEE : 0) });
      }

      const subtotal = lines.reduce((sum, l) => sum + l.unit * l.quantity, 0);
      const shippingCost = subtotal >= util.FREE_SHIPPING_FROM ? 0 : util.SHIPPING_COST;
      const { lastInsertRowid: id } = db.prepare(`
        INSERT INTO orders (user_id, subtotal, shipping, total, ship_name, ship_phone, ship_address, ship_city, payment_method, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, subtotal, shippingCost, subtotal + shippingCost, ship.name, ship.phone, ship.address, ship.city, paymentMethod, orderNotes);

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, size, quantity, unit_price, custom_text, color, accent, design, image)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const l of lines) {
        insertItem.run(id, l.p.id, l.p.name, l.size, l.quantity, l.unit, l.custom, l.p.color, l.p.accent, l.p.design, l.p.image);
      }
      return id;
    });

    res.status(201).json(getOrder(db, orderId));
  });

  r.get('/', (req, res) => {
    const orders = db.prepare(`${ORDER_SELECT} WHERE o.user_id = ? ORDER BY o.id DESC`).all(req.user.id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
    res.json(orders.map((o) => ({ ...o, items: items.all(o.id) })));
  });

  r.get('/:id', (req, res) => {
    const order = getOrder(db, parseInt(req.params.id, 10) || 0);
    if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Pedido no encontrado');
    res.json(order);
  });

  r.post('/:id/cancel', (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    util.tx(db, () => {
      const order = getOrder(db, id);
      if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Pedido no encontrado');
      if (order.status !== 'pendiente') throw new HttpError(409, 'Solo puedes cancelar pedidos pendientes');
      util.restock(db, order.items);
      db.prepare("UPDATE orders SET status = 'cancelado', updated_at = datetime('now') WHERE id = ?").run(id);
    });
    res.json(getOrder(db, id));
  });

  return r;
};
