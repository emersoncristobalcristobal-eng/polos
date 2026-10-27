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
  const app = createApp({ dataDir, dbFile: ':memory:' });
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
    color: '#112233', accent: '#FF0000', design: 'franja', active: '1', stock_S: '1', stock_M: '2', stock_L: '0', stock_XL: '0',
  }).forEach(([k, v]) => form.append(k, v));
  form.append('image', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'polo.png');
  const created = await admin('POST', '/api/admin/products', form);
  assert.equal(created.status, 201);
  assert.equal(created.data.price, 4990);
  assert.equal(created.data.accent, '#ff0000');
  assert.match(created.data.image, /^\/uploads\/[a-f0-9]+\.png$/);
  assert.equal((await admin('GET', created.data.image)).status, 200);

  const bad = new FormData();
  bad.append('name', 'X');
  assert.equal((await admin('POST', '/api/admin/products', bad)).status, 400);

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
