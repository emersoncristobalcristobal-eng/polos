// Consultas reutilizadas por la tienda y el panel de administración.

const { SIZES } = require('./util');

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.description, p.price, p.category_id, c.name AS category,
         p.color, p.accent, p.design, p.image, p.featured, p.active, p.created_at
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id`;

function withStock(db, products) {
  const stmt = db.prepare('SELECT size, stock FROM product_stock WHERE product_id = ?');
  return products.map((p) => {
    const stock = Object.fromEntries(SIZES.map((s) => [s, 0]));
    for (const row of stmt.all(p.id)) stock[row.size] = row.stock;
    return {
      ...p,
      featured: Boolean(p.featured),
      active: Boolean(p.active),
      stock,
      total_stock: Object.values(stock).reduce((a, b) => a + b, 0),
    };
  });
}

function getProduct(db, id) {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
  return row ? withStock(db, [row])[0] : null;
}

const ORDER_SELECT = `
  SELECT o.*, u.name AS customer_name, u.email AS customer_email,
         (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id) AS units
  FROM orders o
  JOIN users u ON u.id = o.user_id`;

function getOrder(db, id) {
  const order = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  return order;
}

module.exports = { PRODUCT_SELECT, ORDER_SELECT, withStock, getProduct, getOrder };
