const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

let server;
let base;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-test-'));

before(async () => {
  const app = await createApp({ dataDir });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Cliente HTTP mínimo que guarda la cookie de sesión.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const headers = cookie ? { cookie } : {};
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
}

const shipping = { name: 'Ana Torres', phone: '999888777', address: 'Jr. Unión 456', city: 'Lima' };

test('el catálogo público lista productos con stock por talla', async () => {
  const http = client();
  const { status, data } = await http('GET', '/api/products');
  assert.equal(status, 200);
  assert.ok(data.length >= 10);
  assert.deepEqual(Object.keys(data[0].stock), ['S', 'M', 'L', 'XL']);

  const featured = await http('GET', '/api/products?featured=1');
  assert.ok(featured.data.every((p) => p.featured));
});

test('un cliente se registra, compra y el stock se descuenta', async () => {
  const http = client();
  const reg = await http('POST', '/api/auth/register', { name: 'Ana Torres', email: 'ana@test.pe', password: 'secreta1' });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'cliente');

  const before = (await http('GET', '/api/products/1')).data;
  const order = await http('POST', '/api/orders', {
    items: [{ product_id: 1, size: 'M', quantity: 2, custom_text: 'ana' }],
    shipping,
    payment_method: 'yape',
  });
  assert.equal(order.status, 201);
  assert.equal(order.data.status, 'pendiente');
  assert.equal(order.data.items[0].custom_text, 'ANA');
  assert.equal(order.data.subtotal, (before.price + 1000) * 2);
  assert.equal(order.data.total, order.data.subtotal + order.data.shipping);

  const afterBuy = (await http('GET', '/api/products/1')).data;
  assert.equal(afterBuy.stock.M, before.stock.M - 2);

  const cancel = await http('POST', `/api/orders/${order.data.id}/cancel`);
  assert.equal(cancel.data.status, 'cancelado');
  const afterCancel = (await http('GET', '/api/products/1')).data;
  assert.equal(afterCancel.stock.M, before.stock.M);
});

test('no se puede comprar más que el stock disponible', async () => {
  const http = client();
  await http('POST', '/api/auth/login', { email: 'cliente@pololab.pe', password: 'cliente123' });
  const product = (await http('GET', '/api/products/1')).data;
  const res = await http('POST', '/api/orders', {
    items: [
      { product_id: 1, size: 'S', quantity: product.stock.S },
      { product_id: 1, size: 'S', quantity: 1 },
    ],
    shipping,
    payment_method: 'contraentrega',
  });
  assert.equal(res.status, 409);
  // La transacción se revierte completa: no se descuenta nada.
  assert.equal((await http('GET', '/api/products/1')).data.stock.S, product.stock.S);
});

test('un cliente no puede entrar al panel de administración', async () => {
  const http = client();
  assert.equal((await http('GET', '/api/admin/stats')).status, 401);
  assert.equal((await http('GET', '/admin.html')).status, 302);
  await http('POST', '/api/auth/login', { email: 'cliente@pololab.pe', password: 'cliente123' });
  assert.equal((await http('GET', '/api/admin/stats')).status, 403);
  assert.equal((await http('GET', '/admin.html')).status, 302);
});

test('credenciales incorrectas son rechazadas', async () => {
  const http = client();
  const res = await http('POST', '/api/auth/login', { email: 'admin@pololab.pe', password: 'mala' });
  assert.equal(res.status, 401);
});

test('el administrador gestiona productos, categorías y pedidos', async () => {
  const admin = client();
  const login = await admin('POST', '/api/auth/login', { email: 'admin@pololab.pe', password: 'admin123' });
  assert.equal(login.data.user.role, 'admin');
  assert.equal((await admin('GET', '/admin.html')).status, 200);

  const stats = await admin('GET', '/api/admin/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.data.salesByDay.length, 7);

  const cat = await admin('POST', '/api/admin/categories', { name: 'Edición Test' });
  assert.equal(cat.status, 201);

  const form = new FormData();
  Object.entries({
    name: 'Polo Test', description: 'Prueba', price: '49.90', category_id: String(cat.data.id),
    color: '#112233', accent: '#FF0000', design: 'franja', print: 'ola', active: '1', stock_S: '1', stock_M: '2', stock_L: '0', stock_XL: '0',
  }).forEach(([k, v]) => form.append(k, v));
  form.append('image', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'polo.png');
  const created = await admin('POST', '/api/admin/products', form);
  assert.equal(created.status, 201);
  assert.equal(created.data.price, 4990);
  assert.equal(created.data.accent, '#ff0000');
  assert.equal(created.data.print, 'ola');
  assert.match(created.data.image, /^\/uploads\/[a-f0-9]+\.png$/);
  assert.equal((await admin('GET', created.data.image)).status, 200);

  const bad = new FormData();
  bad.append('name', 'X');
  assert.equal((await admin('POST', '/api/admin/products', bad)).status, 400);

  const badPrint = new FormData();
  Object.entries({ name: 'Polo raro', price: '10', color: '#000000', accent: '#ffffff', design: 'liso', print: 'calavera' })
    .forEach(([k, v]) => badPrint.append(k, v));
  const rejected = await admin('POST', '/api/admin/products', badPrint);
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /estampado/);

  // Un cliente compra el producto nuevo y el admin lo despacha.
  const buyer = client();
  await buyer('POST', '/api/auth/login', { email: 'cliente@pololab.pe', password: 'cliente123' });
  const order = await buyer('POST', '/api/orders', {
    items: [{ product_id: created.data.id, size: 'M', quantity: 2 }],
    shipping,
    payment_method: 'transferencia',
  });
  assert.equal(order.status, 201);

  const shipped = await admin('PATCH', `/api/admin/orders/${order.data.id}`, { status: 'enviado' });
  assert.equal(shipped.data.status, 'enviado');
  assert.equal((await buyer('POST', `/api/orders/${order.data.id}/cancel`)).status, 409);

  const cancelled = await admin('PATCH', `/api/admin/orders/${order.data.id}`, { status: 'cancelado' });
  assert.equal(cancelled.data.status, 'cancelado');
  assert.equal((await admin('GET', `/api/products/${created.data.id}`)).data.stock.M, 2);
  assert.equal((await admin('PATCH', `/api/admin/orders/${order.data.id}`, { status: 'pagado' })).status, 409);

  // Otro cliente no ve pedidos ajenos.
  assert.equal((await client()('GET', `/api/orders/${order.data.id}`)).status, 401);

  const del = await admin('DELETE', `/api/admin/products/${created.data.id}`);
  assert.equal(del.status, 200);
  const history = await buyer('GET', `/api/orders/${order.data.id}`);
  assert.equal(history.data.items[0].product_name, 'Polo Test');
});

test('el administrador puede desactivar a un cliente', async () => {
  const admin = client();
  await admin('POST', '/api/auth/login', { email: 'admin@pololab.pe', password: 'admin123' });
  const user = client();
  await user('POST', '/api/auth/register', { name: 'Luis', email: 'luis@test.pe', password: 'secreta1' });
  const customers = (await admin('GET', '/api/admin/customers')).data;
  const luis = customers.find((c) => c.email === 'luis@test.pe');
  await admin('PATCH', `/api/admin/customers/${luis.id}`, { active: false });
  assert.equal((await user('GET', '/api/auth/me')).data.user, null);
  const relogin = await client()('POST', '/api/auth/login', { email: 'luis@test.pe', password: 'secreta1' });
  assert.equal(relogin.status, 403);
});

test('rechaza peticiones que vienen de otro sitio', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ email: 'admin@pololab.pe', password: 'admin123' }),
  });
  assert.equal(res.status, 403);
});

test('una base de datos anterior a los estampados se actualiza sin perder datos', async () => {
  const { openDb } = require('../src/db');
  const file = path.join(dataDir, 'antigua.db');
  const old = await openDb({ file });
  await old.exec('ALTER TABLE order_items DROP COLUMN print; ALTER TABLE products DROP COLUMN print; DROP TABLE images;');
  const { n: products } = await old.get('SELECT COUNT(*) AS n FROM products');
  old.close();

  // Las fotos de versiones anteriores estaban en data/uploads y pasan a la base de datos.
  const uploads = path.join(dataDir, 'uploads-antiguas');
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, 'abc123.png'), Buffer.from([1, 2, 3]));

  const db = await openDb({ file, uploadsDir: uploads });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM products')).n, products);
  assert.equal((await db.get("SELECT print FROM products WHERE name = 'Polo Lima 26 Negro'")).print, 'lima26');
  assert.equal((await db.get("SELECT print FROM products WHERE name = 'Polo Básico Negro'")).print, 'ninguno');
  assert.equal((await db.get("SELECT print FROM order_items WHERE product_name = 'Polo Lima 26 Negro' LIMIT 1")).print, 'lima26');
  const image = await db.get("SELECT mime, length(data) AS size FROM images WHERE name = 'abc123.png'");
  assert.deepEqual(image, { mime: 'image/png', size: 3 });
  db.close();
});

test('demasiados intentos de contraseña bloquean el ingreso por un rato', async () => {
  const http = client();
  for (let i = 0; i < 8; i++) {
    assert.equal((await http('POST', '/api/auth/login', { email: 'cliente@pololab.pe', password: 'mala' })).status, 401);
  }
  const blocked = await http('POST', '/api/auth/login', { email: 'cliente@pololab.pe', password: 'cliente123' });
  assert.equal(blocked.status, 429);
});

test('con ADMIN_PASSWORD la tienda no crea ni muestra cuentas de prueba', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-prod-'));
  process.env.ADMIN_PASSWORD = 'clave-segura-123';
  process.env.ADMIN_EMAIL = 'dueno@tienda.pe';
  try {
    const app = await createApp({ dataDir: dir });
    const srv = app.listen(0);
    await new Promise((resolve) => srv.once('listening', resolve));
    const url = `http://127.0.0.1:${srv.address().port}`;
    const config = await (await fetch(`${url}/api/config`)).json();
    assert.equal(config.demoAccounts, false);
    const login = (email, password) => fetch(`${url}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    assert.equal((await login('admin@pololab.pe', 'admin123')).status, 401);
    assert.equal((await login('cliente@pololab.pe', 'cliente123')).status, 401);
    assert.equal((await login('dueno@tienda.pe', 'clave-segura-123')).status, 200);
    const products = await (await fetch(`${url}/api/products`)).json();
    assert.ok(products.length > 0);
    srv.close();
    app.locals.db.close();
  } finally {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_EMAIL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
