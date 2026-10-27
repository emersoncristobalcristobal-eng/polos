// Reglas de negocio y validaciones compartidas por todas las rutas.

const SIZES = ['S', 'M', 'L', 'XL'];
const DESIGNS = ['liso', 'franja', 'lineas'];
const ORDER_STATUSES = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];
const PAYMENT_METHODS = ['yape', 'transferencia', 'contraentrega'];

// Montos en céntimos (S/ 1.00 = 100) para evitar errores de redondeo.
const CUSTOM_FEE = 1000; // personalización con nombre
const SHIPPING_COST = 1000;
const FREE_SHIPPING_FROM = 15000;
const CUSTOM_MAX_LENGTH = 12;
const MAX_QTY_PER_LINE = 20;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, { field, min = 0, max = 255, required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!v && required) throw new HttpError(400, `El campo "${field}" es obligatorio`);
  if (v && v.length < min) throw new HttpError(400, `El campo "${field}" debe tener al menos ${min} caracteres`);
  if (v.length > max) throw new HttpError(400, `El campo "${field}" admite máximo ${max} caracteres`);
  return v;
}

function email(value) {
  const v = text(value, { field: 'correo', max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'El correo no es válido');
  return v;
}

function int(value, { field, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `El campo "${field}" debe ser un número entero entre ${min} y ${max}`);
  }
  return n;
}

// "79.90" -> 7990
function cents(value, field = 'precio') {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, `El ${field} no es válido`);
  return Math.round(n * 100);
}

function color(value, field) {
  const v = String(value ?? '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new HttpError(400, `El ${field} debe tener formato #RRGGBB`);
  return v.toLowerCase();
}

function oneOf(value, list, field) {
  if (!list.includes(value)) throw new HttpError(400, `El valor de "${field}" no es válido`);
  return value;
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

// Texto que se imprime en el polo: mayúsculas, sin caracteres de control.
function customText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, CUSTOM_MAX_LENGTH);
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function restock(db, items) {
  const stmt = db.prepare(`
    INSERT INTO product_stock (product_id, size, stock) VALUES (?, ?, ?)
    ON CONFLICT (product_id, size) DO UPDATE SET stock = stock + excluded.stock`);
  for (const it of items) {
    if (it.product_id != null) stmt.run(it.product_id, it.size, it.quantity);
  }
}

module.exports = {
  SIZES,
  DESIGNS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  CUSTOM_FEE,
  SHIPPING_COST,
  FREE_SHIPPING_FROM,
  CUSTOM_MAX_LENGTH,
  MAX_QTY_PER_LINE,
  HttpError,
  text,
  email,
  int,
  cents,
  color,
  oneOf,
  bool,
  customText,
  tx,
  restock,
};
