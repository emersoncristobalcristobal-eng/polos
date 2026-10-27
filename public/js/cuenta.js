import { PAYMENT, STATUS_FLOW, api, esc, fmtDate, logout, money, mountChrome, productVisual, qs, qsa, statusChip, toast } from './core.js';

const user = await mountChrome();
if (!user) location.replace('/login.html?next=/cuenta.html');

const newOrderId = Number(new URLSearchParams(location.search).get('pedido')) || null;
const ordersPanel = qs('[data-panel="pedidos"]');
const profilePanel = qs('[data-panel="datos"]');

qs('[data-hello]').textContent = `Hola, ${user?.name.split(' ')[0] ?? ''}`;
qs('[data-logout]').addEventListener('click', logout);

// ---------- Pestañas ----------
function selectTab(name) {
  qsa('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  ordersPanel.hidden = name !== 'pedidos';
  profilePanel.hidden = name !== 'datos';
}
qsa('[data-tab]').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
if (new URLSearchParams(location.search).get('tab') === 'datos') selectTab('datos');

// ---------- Pedidos ----------
function timeline(status) {
  if (status === 'cancelado') return '';
  const reached = STATUS_FLOW.indexOf(status);
  return `<ol class="clean timeline" aria-label="Seguimiento">
    ${STATUS_FLOW.map((s, i) => `<li class="${i <= reached ? 'done' : ''}">${{ pendiente: 'Recibido', pagado: 'Pagado', enviado: 'En camino', entregado: 'Entregado' }[s]}</li>`).join('')}
  </ol>`;
}

function orderHTML(o) {
  return `<article class="order-card ${o.id === newOrderId ? 'is-new' : ''}" id="pedido-${o.id}">
    <header class="order-top">
      <h3>Pedido #${o.id}</h3>
      ${statusChip(o.status)}
      <span class="muted">${fmtDate(o.created_at)}</span>
      <span class="order-total">${money(o.total)}</span>
    </header>
    <div class="order-body">
      <div class="order-items">
        ${o.items.map((it) => `
          <div class="order-item">
            <div class="cart-thumb">${productVisual(it, { text: it.custom_text })}</div>
            <div><strong>${esc(it.product_name)}</strong><span>Talla ${esc(it.size)} · ${it.quantity} u.${it.custom_text ? ` · “${esc(it.custom_text)}”` : ''}</span></div>
            <span>${money(it.unit_price * it.quantity)}</span>
          </div>`).join('')}
      </div>
      <div>
        ${timeline(o.status)}
        <div class="ship-box">
          <strong>Envío a ${esc(o.ship_name)}</strong>
          <span>${esc(o.ship_address)}, ${esc(o.ship_city)}</span>
          <span>Cel. ${esc(o.ship_phone)}</span>
          <span>Pago: ${esc(PAYMENT[o.payment_method] || o.payment_method)}</span>
          <span>Subtotal ${money(o.subtotal)} · Envío ${o.shipping ? money(o.shipping) : 'gratis'}</span>
          ${o.notes ? `<span>Notas: ${esc(o.notes)}</span>` : ''}
        </div>
        ${o.status === 'pendiente' ? `<button class="link-btn" type="button" style="margin-top: 14px" data-cancel="${o.id}">Cancelar pedido</button>` : ''}
      </div>
    </div>
  </article>`;
}

async function loadOrders() {
  try {
    const orders = await api('/orders');
    const fresh = orders.find((o) => o.id === newOrderId);
    ordersPanel.innerHTML = `
      ${fresh ? `<div class="thanks">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="var(--ok)" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7 12 3.5 3.5L17 9"/></svg>
        <div><strong>¡Gracias por tu compra!</strong><p class="muted">Recibimos tu pedido #${fresh.id}. Te escribiremos al ${esc(fresh.ship_phone)} para coordinar el pago y la entrega.</p></div>
      </div>` : ''}
      ${orders.length ? orders.map(orderHTML).join('') : `<div class="empty"><h3>Aún no tienes pedidos</h3><p>Cuando compres, podrás seguir tu pedido aquí.</p><a class="btn" href="/tienda.html">Ir a la tienda</a></div>`}`;
  } catch (err) {
    ordersPanel.innerHTML = `<div class="empty"><h3>Ups</h3><p>${esc(err.message)}</p></div>`;
  }
}

ordersPanel.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancel]');
  if (!btn) return;
  if (!confirm(`¿Seguro que quieres cancelar el pedido #${btn.dataset.cancel}?`)) return;
  try {
    await api(`/orders/${btn.dataset.cancel}/cancel`, { method: 'POST' });
    toast('Pedido cancelado');
    loadOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- Mis datos ----------
profilePanel.innerHTML = `
  <form class="profile-form" novalidate data-profile>
    <fieldset>
      <legend>Datos personales</legend>
      <label class="field"><span>Nombre</span><input type="text" name="name" maxlength="80" required value="${esc(user?.name)}"></label>
      <label class="field"><span>Correo</span><input type="email" value="${esc(user?.email)}" disabled></label>
      <label class="field"><span>Celular</span><input type="tel" name="phone" maxlength="20" value="${esc(user?.phone)}"></label>
    </fieldset>
    <fieldset>
      <legend>Cambiar contraseña</legend>
      <label class="field"><span>Contraseña actual</span><input type="password" name="current_password" autocomplete="current-password"></label>
      <label class="field"><span>Nueva contraseña</span><input type="password" name="new_password" autocomplete="new-password" minlength="6"></label>
    </fieldset>
    <p class="form-error" role="alert" data-error></p>
    <div><button class="btn" type="submit">Guardar cambios</button></div>
  </form>`;

qs('[data-profile]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = qs('[data-error]', form);
  error.textContent = '';
  try {
    const { user: updated } = await api('/auth/me', { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
    qs('[data-hello]').textContent = `Hola, ${updated.name.split(' ')[0]}`;
    form.elements.current_password.value = '';
    form.elements.new_password.value = '';
    toast('Tus datos se guardaron');
  } catch (err) {
    error.textContent = err.message;
  }
});

if (user) {
  await loadOrders();
  if (newOrderId) qs(`#pedido-${newOrderId}`)?.scrollIntoView({ block: 'center' });
}
