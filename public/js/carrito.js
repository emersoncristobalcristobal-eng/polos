import { PAYMENT, api, cart, esc, getConfig, icons, money, mountChrome, productVisual, qs, toast } from './core.js';

const root = qs('[data-cart]');
const [user, config] = await Promise.all([mountChrome(), getConfig()]);
let products = new Map();

async function loadProducts() {
  const ids = [...new Set(cart.read().map((i) => i.productId))];
  if (!ids.length) {
    products = new Map();
    return;
  }
  const list = await api(`/products?ids=${ids.join(',')}`).catch(() => []);
  products = new Map(list.map((p) => [p.id, p]));
}

function computeTotals(items) {
  let subtotal = 0;
  let problems = 0;
  for (const item of items) {
    const p = products.get(item.productId);
    if (!p) {
      problems++;
      continue;
    }
    if (item.qty > p.stock[item.size]) problems++;
    subtotal += (p.price + (item.custom ? config.customFee : 0)) * item.qty;
  }
  const shipping = subtotal === 0 || subtotal >= config.freeShippingFrom ? 0 : config.shippingCost;
  return { subtotal, shipping, total: subtotal + shipping, problems };
}

function lineHTML(item, index) {
  const p = products.get(item.productId);
  if (!p) {
    return `<div class="cart-line">
      <div class="cart-thumb"></div>
      <div><h3>Producto no disponible</h3><p class="warn-text">Ya no está a la venta. Quítalo para continuar.</p></div>
      <div class="cart-line-end"><button class="link-btn" type="button" data-action="remove" data-index="${index}">Quitar</button></div>
    </div>`;
  }
  const unit = p.price + (item.custom ? config.customFee : 0);
  const stock = p.stock[item.size];
  const warn = stock === 0 ? 'Talla agotada. Quítala o elige otra.' : item.qty > stock ? `Solo quedan ${stock} en talla ${item.size}.` : '';
  return `<div class="cart-line">
    <a class="cart-thumb" href="/producto.html?id=${p.id}">${productVisual(p, { text: item.custom })}</a>
    <div>
      <h3><a href="/producto.html?id=${p.id}">${esc(p.name)}</a></h3>
      <div class="cart-meta">
        <span>Talla <strong>${esc(item.size)}</strong></span>
        ${item.custom ? `<span>Nombre <strong>${esc(item.custom)}</strong> (+${money(config.customFee)})</span>` : ''}
        <span>${money(unit)} c/u</span>
      </div>
      ${warn ? `<p class="warn-text">${warn}</p>` : ''}
    </div>
    <div class="cart-line-end">
      <span class="cart-line-total">${money(unit * item.qty)}</span>
      <div class="qty">
        <button type="button" data-action="dec" data-index="${index}" aria-label="Quitar uno">${icons.minus}</button>
        <output>${item.qty}</output>
        <button type="button" data-action="inc" data-index="${index}" aria-label="Agregar uno" ${item.qty >= Math.min(stock, config.maxQtyPerLine) ? 'disabled' : ''}>${icons.plus}</button>
      </div>
      <button class="link-btn" type="button" data-action="remove" data-index="${index}">Quitar</button>
    </div>
  </div>`;
}

function checkoutHTML() {
  if (!user) {
    return `<div class="login-prompt">
      <p>Inicia sesión o crea tu cuenta para finalizar la compra y seguir tu pedido.</p>
      <a class="btn btn-block" href="/login.html?next=/carrito.html">Ingresar</a>
      <a class="btn-ghost btn-block" href="/registro.html?next=/carrito.html">Crear cuenta</a>
    </div>`;
  }
  return `<form class="form-grid" data-checkout novalidate>
    <h3 class="full" style="font-size: 20px; letter-spacing: .08em">Datos de envío</h3>
    <label class="field full"><span>Quién recibe</span><input type="text" name="name" required maxlength="80" value="${esc(user.name)}" autocomplete="name"></label>
    <label class="field"><span>Celular</span><input type="tel" name="phone" required maxlength="20" value="${esc(user.phone)}" autocomplete="tel"></label>
    <label class="field"><span>Ciudad</span><input type="text" name="city" required maxlength="60" value="Lima" autocomplete="address-level2"></label>
    <label class="field full"><span>Dirección</span><input type="text" name="address" required maxlength="160" placeholder="Av., calle, número, distrito" autocomplete="street-address"></label>
    <fieldset class="full pay-options" style="border:0; padding:0; margin:0">
      <legend class="field-label" style="margin-bottom: 8px">Método de pago</legend>
      ${Object.entries(PAYMENT).map(([value, label], i) => `
        <label class="pay-option">
          <input type="radio" name="payment_method" value="${value}" ${i === 0 ? 'checked' : ''}>
          <span>${label}<small>${{
            yape: 'Te enviamos el número para yapear al confirmar el pedido.',
            transferencia: 'Recibirás los datos bancarios en tu pedido.',
            contraentrega: 'Pagas en efectivo o con Yape al recibir.',
          }[value]}</small></span>
        </label>`).join('')}
    </fieldset>
    <label class="field full"><span>Notas (opcional)</span><textarea name="notes" maxlength="300" placeholder="Referencia, horario de entrega…"></textarea></label>
    <p class="form-error full" role="alert" data-error></p>
    <button class="btn btn-block full" type="submit" data-submit>Confirmar pedido</button>
  </form>`;
}

function render() {
  const items = cart.read();
  if (!items.length) {
    root.innerHTML = `<div class="empty" style="margin: 40px 0 80px">
      <h3>Tu carrito está vacío</h3>
      <p>Encuentra tu próximo polo favorito en la colección.</p>
      <a class="btn" href="/tienda.html">Ir a la tienda</a>
    </div>`;
    return;
  }

  if (!qs('[data-lines]', root)) {
    root.innerHTML = `<div class="cart-layout">
      <div class="cart-lines" data-lines></div>
      <aside class="summary" aria-label="Resumen">
        <h2>Resumen</h2>
        <div class="summary-rows" data-summary></div>
        ${checkoutHTML()}
      </aside>
    </div>`;
    qs('[data-checkout]', root)?.addEventListener('submit', submit);
  }

  qs('[data-lines]', root).innerHTML = items.map(lineHTML).join('');
  const t = computeTotals(items);
  const missing = Math.max(config.freeShippingFrom - t.subtotal, 0);
  const pct = Math.min((t.subtotal / config.freeShippingFrom) * 100, 100);
  qs('[data-summary]', root).innerHTML = `
    <div class="summary-row"><span>Subtotal (${cart.count(items)} ${cart.count(items) === 1 ? 'polo' : 'polos'})</span><span>${money(t.subtotal)}</span></div>
    <div class="summary-row"><span>Envío</span><span>${t.shipping ? money(t.shipping) : 'Gratis'}</span></div>
    <div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <small class="muted">${missing ? `Te faltan ${money(missing)} para el envío gratis` : '¡Tienes envío gratis!'}</small>
    </div>
    <div class="summary-row total"><span>Total</span><span>${money(t.total)}</span></div>`;
  const submitBtn = qs('[data-submit]', root);
  if (submitBtn) submitBtn.disabled = t.problems > 0;
}

root.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const index = Number(btn.dataset.index);
  const item = cart.read()[index];
  if (!item) return;
  if (btn.dataset.action === 'remove') cart.remove(index);
  if (btn.dataset.action === 'inc') cart.setQty(index, item.qty + 1);
  if (btn.dataset.action === 'dec') cart.setQty(index, item.qty - 1);
  render();
});

async function submit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = qs('[data-error]', form);
  const button = qs('[data-submit]', form);
  const data = Object.fromEntries(new FormData(form));
  error.textContent = '';

  const required = { name: 'quién recibe', phone: 'celular', city: 'ciudad', address: 'dirección' };
  const empty = Object.entries(required).find(([key]) => !String(data[key] || '').trim());
  if (empty) {
    error.textContent = `Completa el campo "${empty[1]}".`;
    form.elements[empty[0]].focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Procesando…';
  try {
    const order = await api('/orders', {
      method: 'POST',
      body: {
        items: cart.read().map((i) => ({ product_id: i.productId, size: i.size, quantity: i.qty, custom_text: i.custom })),
        shipping: { name: data.name, phone: data.phone, city: data.city, address: data.address },
        payment_method: data.payment_method,
        notes: data.notes,
      },
    });
    cart.clear();
    location.href = `/cuenta.html?pedido=${order.id}`;
  } catch (err) {
    error.textContent = err.message;
    if (err.status === 401) toast('Tu sesión expiró. Vuelve a ingresar.', 'error');
    if (err.status === 409 || err.status === 400) {
      await loadProducts();
      render();
    }
    button.disabled = false;
    button.textContent = 'Confirmar pedido';
  }
}

await loadProducts();
render();
