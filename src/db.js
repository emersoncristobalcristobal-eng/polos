// Base de datos SQLite (módulo node:sqlite incluido en Node.js 22.13+).

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');
const { SIZES, CUSTOM_FEE, SHIPPING_COST, FREE_SHIPPING_FROM } = require('./util');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('admin', 'cliente')),
  phone         TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price >= 0),
  category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  color       TEXT NOT NULL DEFAULT '#1a1a1c',
  accent      TEXT NOT NULL DEFAULT '#ff2a2a',
  design      TEXT NOT NULL DEFAULT 'liso' CHECK (design IN ('liso', 'franja', 'lineas')),
  image       TEXT,
  featured    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_stock (
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  size       TEXT NOT NULL,
  stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  PRIMARY KEY (product_id, size)
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users (id),
  status         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (status IN ('pendiente', 'pagado', 'enviado', 'entregado', 'cancelado')),
  subtotal       INTEGER NOT NULL,
  shipping       INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  ship_name      TEXT NOT NULL,
  ship_phone     TEXT NOT NULL,
  ship_address   TEXT NOT NULL,
  ship_city      TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('yape', 'transferencia', 'contraentrega')),
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products (id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  size         TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   INTEGER NOT NULL,
  custom_text  TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL,
  accent       TEXT NOT NULL,
  design       TEXT NOT NULL,
  image        TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_items_order   ON order_items (order_id);
`;

const DEMO_CATEGORIES = ['Colección Lima 26', 'Oversize', 'Street', 'Básicos', 'Deportivo'];

// [nombre, categoría, precio S/, color, acento, diseño, destacado, stock S/M/L/XL, descripción]
const DEMO_PRODUCTS = [
  ['Polo Lima 26 Rojo Neón', 'Colección Lima 26', 79.9, '#a3111a', '#f4f4f4', 'franja', 1, [6, 12, 10, 4],
    'La pieza central de la colección. Algodón pima peruano de 180 g, franja frontal contrastada y corte regular. Nacido en las calles de Lima.'],
  ['Polo Lima 26 Negro', 'Colección Lima 26', 79.9, '#18181a', '#ff2a2a', 'lineas', 1, [8, 14, 12, 6],
    'Negro profundo con líneas rojas que recorren los hombros. Ligero, transpirable y hecho para moverte toda la noche.'],
  ['Polo Lima 26 Blanco', 'Colección Lima 26', 79.9, '#ececec', '#d0161f', 'lineas', 1, [5, 9, 7, 2],
    'Blanco óptico con detalles rojos. El poder de crear: personalízalo con tu nombre y hazlo único.'],
  ['Polo Oversize Asfalto', 'Oversize', 69.9, '#3a4146', '#ff3b30', 'liso', 0, [4, 10, 10, 8],
    'Corte oversize con hombro caído en gris asfalto. Algodón peinado 200 g, cuello acanalado reforzado.'],
  ['Polo Oversize Hueso', 'Oversize', 69.9, '#e6dfd2', '#1a1a1a', 'liso', 0, [3, 8, 9, 5],
    'Tono hueso cálido, corte amplio y caída pesada. Un básico con actitud de calle.'],
  ['Polo Street Azul Noche', 'Street', 59.9, '#16263f', '#ff5a1f', 'franja', 0, [7, 11, 9, 3],
    'Azul noche con franja naranja fuego. Inspirado en las luces de la ciudad a las 3 a. m.'],
  ['Polo Street Petróleo', 'Street', 59.9, '#1f3d3f', '#ff2a2a', 'lineas', 0, [2, 6, 5, 1],
    'Verde petróleo con líneas rojas en hombros y mangas. Edición limitada.'],
  ['Polo Básico Negro', 'Básicos', 39.9, '#121214', '#3a3a3e', 'liso', 0, [20, 30, 25, 15],
    'El básico que nunca falla. Algodón 100 % peruano, costuras dobles y cuello que no se deforma.'],
  ['Polo Básico Blanco', 'Básicos', 39.9, '#f4f4f4', '#cfcfcf', 'liso', 0, [18, 25, 22, 12],
    'Blanco limpio, tela suave y opaca. Perfecto solo o debajo de una casaca.'],
  ['Polo Básico Gris Melange', 'Básicos', 39.9, '#8b8d90', '#2a2a2a', 'liso', 0, [10, 16, 14, 9],
    'Gris melange clásico con textura jaspeada. Combina con todo.'],
  ['Polo Dry-Fit Carbono', 'Deportivo', 64.9, '#26282b', '#22d3ee', 'lineas', 0, [6, 10, 8, 4],
    'Tela técnica dry-fit que seca rápido. Líneas cian reflectivas para entrenar de noche.'],
  ['Polo Dry-Fit Volt', 'Deportivo', 64.9, '#c6f31d', '#111111', 'lineas', 0, [5, 7, 6, 0],
    'Amarillo volt de alta visibilidad. Ligero, elástico y con protección UV.'],
];

// Estampado de cada polo de ejemplo (los que no aparecen van lisos).
const DEMO_PRINTS = {
  'Polo Lima 26 Negro': 'lima26',
  'Polo Lima 26 Blanco': 'logo',
  'Polo Oversize Asfalto': 'atardecer',
  'Polo Oversize Hueso': 'ola',
  'Polo Street Petróleo': 'logo',
};

// Cambios de estructura para bases de datos creadas con versiones anteriores de la tienda.
function migrate(db) {
  const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!hasColumn('products', 'print')) {
    db.exec("ALTER TABLE products ADD COLUMN print TEXT NOT NULL DEFAULT 'ninguno'");
    const setPrint = db.prepare('UPDATE products SET print = ? WHERE name = ?');
    for (const [name, print] of Object.entries(DEMO_PRINTS)) setPrint.run(print, name);
  }
  if (!hasColumn('order_items', 'print')) {
    db.exec("ALTER TABLE order_items ADD COLUMN print TEXT NOT NULL DEFAULT 'ninguno'");
    db.exec('UPDATE order_items SET print = (SELECT print FROM products WHERE id = order_items.product_id) WHERE product_id IS NOT NULL');
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  return db;
}

function seed(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@pololab.pe').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('Administrador', adminEmail, hashPassword(adminPassword), 'admin', '');

  if (process.env.SEED_DEMO === '0') return;

  const demoUser = insertUser.run('Cliente Demo', 'cliente@pololab.pe', hashPassword('cliente123'), 'cliente', '987654321');
  const insertCategory = db.prepare('INSERT INTO categories (name) VALUES (?)');
  const categoryIds = Object.fromEntries(DEMO_CATEGORIES.map((c) => [c, insertCategory.run(c).lastInsertRowid]));

  const insertProduct = db.prepare(`
    INSERT INTO products (name, description, price, category_id, color, accent, design, print, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertStock = db.prepare('INSERT INTO product_stock (product_id, size, stock) VALUES (?, ?, ?)');
  const products = [];
  for (const [name, cat, price, color, accent, design, featured, stock, description] of DEMO_PRODUCTS) {
    const print = DEMO_PRINTS[name] || 'ninguno';
    const id = insertProduct.run(name, description, Math.round(price * 100), categoryIds[cat], color, accent, design, print, featured).lastInsertRowid;
    SIZES.forEach((size, i) => insertStock.run(id, size, stock[i]));
    products.push({ id, name, price: Math.round(price * 100), color, accent, design, print });
  }

  // Algunos pedidos de ejemplo para que el panel de administración no empiece vacío.
  const demoOrders = [
    { daysAgo: 6, status: 'entregado', lines: [[0, 'M', 1, ''], [7, 'L', 2, '']] },
    { daysAgo: 5, status: 'entregado', lines: [[2, 'S', 1, 'EMERSON']] },
    { daysAgo: 4, status: 'enviado', lines: [[1, 'L', 1, ''], [10, 'M', 1, '']] },
    { daysAgo: 3, status: 'cancelado', lines: [[5, 'XL', 1, '']] },
    { daysAgo: 2, status: 'pagado', lines: [[3, 'L', 2, ''], [8, 'M', 1, '']] },
    { daysAgo: 1, status: 'pagado', lines: [[0, 'S', 1, 'LIMA'], [6, 'M', 1, '']] },
    { daysAgo: 0, status: 'pendiente', lines: [[1, 'M', 1, '10']] },
  ];
  const insertOrder = db.prepare(`
    INSERT INTO orders (user_id, status, subtotal, shipping, total, ship_name, ship_phone, ship_address, ship_city,
                        payment_method, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Cliente Demo', '987654321', 'Av. Arequipa 1234, Dpto. 502', 'Lima', ?,
            datetime('now', ?), datetime('now', ?))`);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, size, quantity, unit_price, custom_text, color, accent, design, print)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const payments = ['yape', 'transferencia', 'contraentrega'];
  demoOrders.forEach((o, i) => {
    const lines = o.lines.map(([idx, size, qty, custom]) => ({
      p: products[idx], size, qty, custom, unit: products[idx].price + (custom ? CUSTOM_FEE : 0),
    }));
    const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const shipping = subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST;
    const when = `-${o.daysAgo * 24 + 3 + i} hours`;
    const orderId = insertOrder.run(demoUser.lastInsertRowid, o.status, subtotal, shipping, subtotal + shipping, payments[i % 3], when, when).lastInsertRowid;
    for (const l of lines) {
      insertItem.run(orderId, l.p.id, l.p.name, l.size, l.qty, l.unit, l.custom, l.p.color, l.p.accent, l.p.design, l.p.print);
    }
  });
}

module.exports = { openDb };
