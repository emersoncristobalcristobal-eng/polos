// Catálogo público: categorías, productos y la configuración de precios.

const { Router } = require('express');
const { demoMode } = require('../db');
const { PRODUCT_SELECT, withStock, getProduct } = require('../queries');
const util = require('../util');

const SORTS = {
  'precio-asc': 'p.price ASC, p.id DESC',
  'precio-desc': 'p.price DESC, p.id DESC',
  nuevo: 'p.created_at DESC, p.id DESC',
};

module.exports = ({ db }) => {
  const r = Router();

  r.get('/config', (req, res) => {
    res.json({
      sizes: util.SIZES,
      customFee: util.CUSTOM_FEE,
      shippingCost: util.SHIPPING_COST,
      freeShippingFrom: util.FREE_SHIPPING_FROM,
      customMaxLength: util.CUSTOM_MAX_LENGTH,
      maxQtyPerLine: util.MAX_QTY_PER_LINE,
      paymentMethods: util.PAYMENT_METHODS,
      demoAccounts: demoMode(),
    });
  });

  r.get('/categories', async (req, res) => {
    res.json(await db.all(`
      SELECT c.id, c.name, COUNT(p.id) AS count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
      GROUP BY c.id
      ORDER BY c.id`));
  });

  r.get('/products', async (req, res) => {
    const where = ['p.active = 1'];
    const params = [];
    const category = parseInt(req.query.category, 10);
    if (Number.isInteger(category)) {
      where.push('p.category_id = ?');
      params.push(category);
    }
    if (req.query.q) {
      const like = `%${String(req.query.q).trim().slice(0, 60)}%`;
      where.push('(p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
      params.push(like, like, like);
    }
    if (req.query.featured === '1') where.push('p.featured = 1');
    if (req.query.ids) {
      const ids = String(req.query.ids).split(',').map(Number).filter(Number.isInteger).slice(0, 50);
      where.push(`p.id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
      params.push(...ids);
    }
    if (req.query.exclude) {
      where.push('p.id != ?');
      params.push(parseInt(req.query.exclude, 10) || 0);
    }
    const order = SORTS[req.query.sort] || 'p.featured DESC, p.id ASC';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 100);
    const rows = await db.all(`${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`, ...params);
    res.json(await withStock(db, rows));
  });

  r.get('/products/:id', async (req, res) => {
    const product = await getProduct(db, parseInt(req.params.id, 10) || 0);
    if (!product || !product.active) throw new util.HttpError(404, 'Producto no encontrado');
    res.json(product);
  });

  return r;
};
