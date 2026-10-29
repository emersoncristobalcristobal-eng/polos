// Base de datos SQLite. En tu computadora es el archivo data/tienda.db; publicada en internet es una
// base de datos de Turso (SQLite en la nube). El mismo código funciona en los dos casos.

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');
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

-- Fotos subidas desde el panel. Se guardan en la base de datos para que no se pierdan en el hosting.
CREATE TABLE IF NOT EXISTS images (
  name       TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id             INTEGER PRIMARY KEY,
  order_id       INTEGER NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  series         TEXT NOT NULL DEFAULT 'B001',
  correlative    INTEGER NOT NULL,
  issue_date     TEXT NOT NULL DEFAULT (datetime('now')),
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_doc   TEXT NOT NULL DEFAULT '',
  customer_city  TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL,
  subtotal       INTEGER NOT NULL,
  shipping       INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,
  print_status   TEXT NOT NULL DEFAULT 'pendiente' CHECK (print_status IN ('pendiente', 'impresa', 'fallida')),
  print_attempts INTEGER NOT NULL DEFAULT 0,
  printed_at     TEXT,
  printer_name   TEXT NOT NULL DEFAULT '',
  last_error     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_items_order   ON order_items (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_order ON receipts (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_number ON receipts (receipt_number);
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

// ---------- Acceso a datos ----------
const plain = (row) => ({ ...row });
const cleanArgs = (args) => args.map((v) => (v === undefined ? null : v));

function queries(execute) {
  return {
    async all(sql, ...args) {
      return (await execute(sql, cleanArgs(args))).rows.map(plain);
    },
    async get(sql, ...args) {
      return (await execute(sql, cleanArgs(args))).rows.map(plain)[0] ?? null;
    },
    async run(sql, ...args) {
      const r = await execute(sql, cleanArgs(args));
      return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
  };
}

class Database {
  constructor(client) {
    this.client = client;
    this.writing = Promise.resolve();
    const { all, get } = queries((sql, args) => client.execute({ sql, args }));
    const { run } = queries((sql, args) => this.serial(() => client.execute({ sql, args })));
    Object.assign(this, { all, get, run });
  }

  // SQLite acepta un solo escritor a la vez, así que las escrituras de la tienda se atienden en orden.
  // Dentro de tx() solo se usa el objeto que recibe la función; usar db.run ahí bloquearía la cola.
  serial(fn) {
    const result = this.writing.then(fn);
    this.writing = result.catch(() => {});
    return result;
  }

  exec(sql) {
    return this.serial(() => this.client.executeMultiple(sql));
  }

  batch(statements) {
    return this.serial(() =>
      this.client.batch(statements.map(([sql, ...args]) => ({ sql, args: cleanArgs(args) })), 'write'),
    );
  }

  tx(fn) {
    return this.serial(async () => {
      const t = await this.client.transaction('write');
      try {
        const result = await fn(queries((sql, args) => t.execute({ sql, args })));
        await t.commit();
        return result;
      } catch (err) {
        await t.rollback().catch(() => {});
        throw err;
      } finally {
        t.close();
      }
    });
  }

  close() {
    this.client.close();
  }
}

// Cambios de estructura para bases de datos creadas con versiones anteriores de la tienda.
async function migrate(db) {
  const hasColumn = async (table, column) =>
    Boolean(await db.get(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`, column));
  if (!(await hasColumn('products', 'print'))) {
    await db.run("ALTER TABLE products ADD COLUMN print TEXT NOT NULL DEFAULT 'ninguno'");
    for (const [name, print] of Object.entries(DEMO_PRINTS)) {
      await db.run('UPDATE products SET print = ? WHERE name = ?', print, name);
    }
  }
  if (!(await hasColumn('order_items', 'print'))) {
    await db.run("ALTER TABLE order_items ADD COLUMN print TEXT NOT NULL DEFAULT 'ninguno'");
    await db.run('UPDATE order_items SET print = (SELECT print FROM products WHERE id = order_items.product_id) WHERE product_id IS NOT NULL');
  }

  const hasTable = async (table) =>
    Boolean(await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", table));
  if (!(await hasTable('settings'))) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const defaults = [
      ['printer_name', ''],
      ['printer_paper_width', '58mm'],
      ['printer_auto_cut', '1'],
      ['printer_auto_print', 'on_paid'],
      ['store_business_name', 'POLOLAB PERÚ S.A.C.'],
      ['store_ruc', '20608974512'],
      ['store_address', 'Av. Larco 743, Miraflores, Lima'],
      ['store_phone', '(01) 445-8920 / 992 481 029'],
      ['receipt_series', 'B001'],
    ];
    for (const [k, v] of defaults) {
      await db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v);
    }
  }
  if (!(await hasTable('receipts'))) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        id             INTEGER PRIMARY KEY,
        order_id       INTEGER NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
        receipt_number TEXT NOT NULL UNIQUE,
        series         TEXT NOT NULL DEFAULT 'B001',
        correlative    INTEGER NOT NULL,
        issue_date     TEXT NOT NULL DEFAULT (datetime('now')),
        customer_name  TEXT NOT NULL,
        customer_phone TEXT NOT NULL DEFAULT '',
        customer_doc   TEXT NOT NULL DEFAULT '',
        customer_city  TEXT NOT NULL DEFAULT '',
        customer_address TEXT NOT NULL DEFAULT '',
        payment_method TEXT NOT NULL,
        subtotal       INTEGER NOT NULL,
        shipping       INTEGER NOT NULL,
        discount       INTEGER NOT NULL DEFAULT 0,
        total          INTEGER NOT NULL,
        print_status   TEXT NOT NULL DEFAULT 'pendiente' CHECK (print_status IN ('pendiente', 'impresa', 'fallida')),
        print_attempts INTEGER NOT NULL DEFAULT 0,
        printed_at     TEXT,
        printer_name   TEXT NOT NULL DEFAULT '',
        last_error     TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_order ON receipts (order_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_number ON receipts (receipt_number);
    `);
  }
}

// Las versiones anteriores guardaban las fotos en data/uploads: se copian a la base de datos.
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
async function importUploads(db, dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of files) {
    const mime = IMAGE_MIME[path.extname(name).toLowerCase()];
    if (!mime || !/^[a-f0-9]+\.(jpg|png|webp)$/.test(name)) continue;
    if (await db.get('SELECT 1 FROM images WHERE name = ?', name)) continue;
    await db.run('INSERT INTO images (name, mime, data) VALUES (?, ?, ?)', name, mime, fs.readFileSync(path.join(dir, name)));
  }
}

// Ruta local como URL de libsql ("file:data/tienda.db"), con barras normales también en Windows.
function fileUrl(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const relative = path.relative(process.cwd(), file);
  const target = path.isAbsolute(relative) ? file : relative;
  return `file:${target.split(path.sep).join('/')}`;
}

async function openDb({ file, url, authToken, uploadsDir } = {}) {
  const local = !url;
  const db = new Database(createClient({ url: url || fileUrl(file), authToken }));
  if (local) await db.get('PRAGMA journal_mode = WAL');
  await db.exec(SCHEMA);
  await migrate(db);
  await seed(db);
  if (uploadsDir) await importUploads(db, uploadsDir);
  return db;
}

// Sin ADMIN_PASSWORD la tienda está en modo de prueba: cuentas de ejemplo visibles en la página de ingreso.
const demoMode = () => !process.env.ADMIN_PASSWORD;

// Datos iniciales de una tienda nueva. Se insertan en un solo lote (una sola ida a la base de datos).
async function seed(db) {
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) return;

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@pololab.pe').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const sql = [['INSERT INTO users (id, name, email, password_hash, role, phone) VALUES (1, ?, ?, ?, ?, ?)',
    'Administrador', adminEmail, hashPassword(adminPassword), 'admin', '']];

  if (process.env.SEED_DEMO !== '0') {
    DEMO_CATEGORIES.forEach((name, i) => sql.push(['INSERT INTO categories (id, name) VALUES (?, ?)', i + 1, name]));
    const products = DEMO_PRODUCTS.map(([name, cat, price, color, accent, design, featured, stock, description], i) => {
      const p = { id: i + 1, name, price: Math.round(price * 100), color, accent, design, print: DEMO_PRINTS[name] || 'ninguno' };
      sql.push([`INSERT INTO products (id, name, description, price, category_id, color, accent, design, print, featured)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, name, description, p.price, DEMO_CATEGORIES.indexOf(cat) + 1, color, accent, design, p.print, featured]);
      SIZES.forEach((size, s) => sql.push(['INSERT INTO product_stock (product_id, size, stock) VALUES (?, ?, ?)', p.id, size, stock[s]]));
      return p;
    });

    // Cliente y pedidos de ejemplo solo en modo de prueba, para que el panel no empiece vacío.
    if (demoMode()) {
      sql.push(['INSERT INTO users (id, name, email, password_hash, role, phone) VALUES (2, ?, ?, ?, ?, ?)',
        'Cliente Demo', 'cliente@pololab.pe', hashPassword('cliente123'), 'cliente', '987654321']);
      const demoOrders = [
        { daysAgo: 6, status: 'entregado', lines: [[0, 'M', 1, ''], [7, 'L', 2, '']] },
        { daysAgo: 5, status: 'entregado', lines: [[2, 'S', 1, 'EMERSON']] },
        { daysAgo: 4, status: 'enviado', lines: [[1, 'L', 1, ''], [10, 'M', 1, '']] },
        { daysAgo: 3, status: 'cancelado', lines: [[5, 'XL', 1, '']] },
        { daysAgo: 2, status: 'pagado', lines: [[3, 'L', 2, ''], [8, 'M', 1, '']] },
        { daysAgo: 1, status: 'pagado', lines: [[0, 'S', 1, 'LIMA'], [6, 'M', 1, '']] },
        { daysAgo: 0, status: 'pendiente', lines: [[1, 'M', 1, '10']] },
      ];
      const payments = ['yape', 'transferencia', 'contraentrega'];
      demoOrders.forEach((o, i) => {
        const lines = o.lines.map(([idx, size, qty, custom]) => ({
          p: products[idx], size, qty, custom, unit: products[idx].price + (custom ? CUSTOM_FEE : 0),
        }));
        const subtotal = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
        const shipping = subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST;
        const when = `-${o.daysAgo * 24 + 3 + i} hours`;
        sql.push([`INSERT INTO orders (id, user_id, status, subtotal, shipping, total, ship_name, ship_phone, ship_address, ship_city,
                                       payment_method, created_at, updated_at)
                   VALUES (?, 2, ?, ?, ?, ?, 'Cliente Demo', '987654321', 'Av. Arequipa 1234, Dpto. 502', 'Lima', ?,
                           datetime('now', ?), datetime('now', ?))`,
          i + 1, o.status, subtotal, shipping, subtotal + shipping, payments[i % 3], when, when]);
        for (const l of lines) {
          sql.push([`INSERT INTO order_items (order_id, product_id, product_name, size, quantity, unit_price, custom_text, color, accent, design, print)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            i + 1, l.p.id, l.p.name, l.size, l.qty, l.unit, l.custom, l.p.color, l.p.accent, l.p.design, l.p.print]);
        }
      });
    }
  }
  await db.batch(sql);
}

module.exports = { openDb, demoMode };
