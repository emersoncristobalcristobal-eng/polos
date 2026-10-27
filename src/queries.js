// Consultas reutilizadas por la tienda y el panel de administración.
// `q` es la base de datos o una transacción abierta: ambas tienen all/get/run.

const { SIZES } = require('./util');

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.description, p.price, p.category_id, c.name AS category,
         p.color, p.accent, p.design, p.print, p.image, p.featured, p.active, p.created_at
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id`;

const placeholders = (list) => list.map(() => '?').join(',') || 'NULL';

// Agrega el stock por talla con una sola consulta para todos los productos.
async function withStock(q, products) {
  const ids = products.map((p) => p.id);
  const rows = await q.all(`SELECT product_id, size, stock FROM product_stock WHERE product_id IN (${placeholders(ids)})`, ...ids);
  return products.map((p) => {
    const stock = Object.fromEntries(SIZES.map((s) => [s, 0]));
    for (const row of rows) if (row.product_id === p.id) stock[row.size] = row.stock;
    return {
      ...p,
      featured: Boolean(p.featured),
      active: Boolean(p.active),
      stock,
      total_stock: Object.values(stock).reduce((a, b) => a + b, 0),
    };
  });
}

async function getProduct(q, id) {
  const row = await q.get(`${PRODUCT_SELECT} WHERE p.id = ?`, id);
  return row ? (await withStock(q, [row]))[0] : null;
}

const ORDER_SELECT = `
  SELECT o.*, u.name AS customer_name, u.email AS customer_email,
         (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id) AS units
  FROM orders o
  JOIN users u ON u.id = o.user_id`;

async function withItems(q, orders) {
  const ids = orders.map((o) => o.id);
  const items = await q.all(`SELECT * FROM order_items WHERE order_id IN (${placeholders(ids)}) ORDER BY id`, ...ids);
  return orders.map((o) => ({ ...o, items: items.filter((it) => it.order_id === o.id) }));
}

async function getOrder(q, id) {
  const order = await q.get(`${ORDER_SELECT} WHERE o.id = ?`, id);
  return order ? (await withItems(q, [order]))[0] : null;
}

module.exports = { PRODUCT_SELECT, ORDER_SELECT, withStock, getProduct, withItems, getOrder };
