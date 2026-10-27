import {
  DESIGNS, PAYMENT, PRINTS, STATUS, STATUS_FLOW, STORE, api, esc, fmtDate, getConfig, getMe, icons, logoMark, logout, money,
  poloSVG, productVisual, qs, qsa, statusChip, toast,
} from './core.js';

const me = await getMe();
if (me?.role !== 'admin') location.replace('/login.html?next=/admin.html');
const config = await getConfig();

const view = qs('[data-view]');
const actions = qs('[data-actions]');
const modal = qs('[data-modal]');
const modalBody = qs('[data-modal-body]');

const VIEWS = {
  dashboard: { title: 'Dashboard', kicker: 'Resumen', icon: icons.grid, render: renderDashboard },
  productos: { title: 'Productos', kicker: 'Catálogo', icon: icons.shirt, render: renderProducts },
  pedidos: { title: 'Pedidos', kicker: 'Ventas', icon: icons.box, render: renderOrders },
  categorias: { title: 'Categorías', kicker: 'Catálogo', icon: icons.tag, render: renderCategories },
  clientes: { title: 'Clientes', kicker: 'Comunidad', icon: icons.users, render: renderCustomers },
};

// ---------- Estructura ----------
qs('[data-brand]').innerHTML = `${logoMark()}<span>${esc(STORE.name)}</span>`;
qs('[data-store-link]').innerHTML = `${icons.store}<span>Ver tienda</span>`;
qs('[data-profile-link]').innerHTML = `${icons.user}<span>Mi perfil</span>`;
qs('[data-logout]').innerHTML = `${icons.logout}<span>Cerrar sesión</span>`;
qs('[data-logout]').addEventListener('click', logout);
qs('[data-admin-name]').textContent = me ? `${me.name} · ${me.email}` : '';
qs('[data-menu]').innerHTML = icons.menu;
qs('[data-menu]').addEventListener('click', () => document.body.classList.add('menu-open'));
qs('[data-scrim]').addEventListener('click', () => document.body.classList.remove('menu-open'));

let pendingCount = 0;
let routeToken = 0;

function parseHash() {
  const [key, arg] = location.hash.slice(1).split('/');
  return VIEWS[key] ? [key, arg] : ['dashboard', undefined];
}

function renderNav(current) {
  qs('[data-nav]').innerHTML = Object.entries(VIEWS)
    .map(([key, v]) => `<a href="#${key}" ${key === current ? 'aria-current="page"' : ''}>${v.icon}<span>${v.title}</span>
      ${key === 'pedidos' && pendingCount ? `<span class="count" title="Pedidos pendientes">${pendingCount}</span>` : ''}</a>`)
    .join('');
}

async function refreshPending() {
  try {
    pendingCount = (await api('/admin/orders?status=pendiente')).length;
  } catch {
    // El contador es solo informativo.
  }
  renderNav(parseHash()[0]);
}

async function route() {
  const [key, arg] = parseHash();
  const token = ++routeToken;
  const v = VIEWS[key];
  document.body.classList.remove('menu-open');
  renderNav(key);
  qs('[data-title]').textContent = v.title;
  qs('[data-kicker]').textContent = v.kicker;
  document.title = `${v.title} · Admin ${STORE.name}`;
  actions.innerHTML = '';
  view.innerHTML = '<div class="panel skeleton" style="height: 240px"></div>';
  try {
    await v.render(() => token === routeToken, arg);
  } catch (err) {
    if (err.status === 401 || err.status === 403) return location.replace('/login.html?next=/admin.html');
    view.innerHTML = `<div class="empty"><h3>Algo salió mal</h3><p>${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', route);

// ---------- Modal ----------
qs('[data-modal-close]').innerHTML = icons.close;
qs('[data-modal-close]').addEventListener('click', () => modal.close());
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.close();
});

function openModal(title, html) {
  qs('[data-modal-title]').textContent = title;
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
  modalBody.scrollTop = 0;
  return modalBody;
}

// ---------- Utilidades ----------
const shortMoney = (cents) => `S/ ${(cents / 100).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;

function niceMax(value) {
  if (value <= 0) return 10000;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp;
}

const dayName = (iso, style = 'short') =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-PE', { weekday: style, day: style === 'long' ? 'numeric' : undefined, month: style === 'long' ? 'short' : undefined, timeZone: 'UTC' });

const kpi = (label, value, note, extra = '') =>
  `<div class="kpi ${extra}"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;

function stockPills(stock) {
  return `<div class="stock-pills">${config.sizes
    .map((s) => `<span class="pill ${stock[s] === 0 ? 'is-zero' : stock[s] <= 3 ? 'is-low' : ''}"><small>${s}</small>${stock[s]}</span>`)
    .join('')}</div>`;
}

function statusSelect(order, attrs = '') {
  return `<select class="status-select" ${attrs} aria-label="Estado del pedido #${order.id}" ${order.status === 'cancelado' ? 'disabled' : ''}>
    ${Object.entries(STATUS).map(([value, s]) => `<option value="${value}" ${value === order.status ? 'selected' : ''}>${s.label}</option>`).join('')}
  </select>`;
}

async function changeStatus(order, status) {
  if (status === order.status) return null;
  if (status === 'cancelado' && !confirm(`¿Cancelar el pedido #${order.id}? El stock de sus productos se devolverá al inventario.`)) {
    return null;
  }
  const updated = await api(`/admin/orders/${order.id}`, { method: 'PATCH', body: { status } });
  toast(`Pedido #${order.id}: ${STATUS[status].label.toLowerCase()}`);
  refreshPending();
  return updated;
}

// =========================================================
// Dashboard
// =========================================================
function barChart(days) {
  const max = Math.max(...days.map((d) => d.total), 0);
  const top = niceMax(max * 1.12);
  const ticks = [0, top / 2, top];
  const peak = max > 0 ? days.findIndex((d) => d.total === max) : -1;
  const pct = (v) => (v / top) * 100;

  return `<div class="bars" data-chart>
    <div class="bars-axis" aria-hidden="true">
      ${ticks.map((t) => `<span style="bottom: calc(28px + ${t / top} * (100% - 28px))">${shortMoney(t)}</span>`).join('')}
    </div>
    <div class="bars-plot">
      ${ticks.slice(1).map((t) => `<div class="bars-grid" style="bottom: ${pct(t)}%"></div>`).join('')}
      ${days.map((d, i) => `
        <button type="button" class="bar ${d.total ? '' : 'is-zero'}" data-i="${i}"
          aria-label="${esc(dayName(d.day, 'long'))}: ${money(d.total)} en ${d.orders} ${d.orders === 1 ? 'pedido' : 'pedidos'}">
          <i style="height: ${d.total ? Math.max(pct(d.total), 1.5) : 0.8}%"></i>
          ${i === peak ? `<span class="bar-label" style="bottom: ${pct(d.total)}%">${money(d.total)}</span>` : ''}
        </button>`).join('')}
    </div>
    <div class="bars-x" aria-hidden="true">${days.map((d, i) => `<span>${i === days.length - 1 ? 'Hoy' : esc(dayName(d.day))}</span>`).join('')}</div>
  </div>
  <table class="sr-only">
    <caption>Ventas por día</caption>
    <tr><th>Día</th><th>Ventas</th><th>Pedidos</th></tr>
    ${days.map((d) => `<tr><td>${esc(dayName(d.day, 'long'))}</td><td>${money(d.total)}</td><td>${d.orders}</td></tr>`).join('')}
  </table>`;
}

function wireChart(days) {
  const chart = qs('[data-chart]', view);
  if (!chart) return;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  chart.append(tip);

  const show = (bar) => {
    const d = days[Number(bar.dataset.i)];
    const box = chart.getBoundingClientRect();
    const mark = bar.querySelector('i').getBoundingClientRect();
    tip.innerHTML = `<span>${esc(dayName(d.day, 'long'))}</span><strong>${money(d.total)}</strong><span>${d.orders} ${d.orders === 1 ? 'pedido' : 'pedidos'}</span>`;
    tip.hidden = false;
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(mark.left + mark.width / 2 - box.left, half), box.width - half);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(mark.top - box.top, tip.offsetHeight + 10)}px`;
  };
  const hide = () => {
    tip.hidden = true;
  };
  qsa('.bar', chart).forEach((bar) => {
    bar.addEventListener('pointerenter', () => show(bar));
    bar.addEventListener('focus', () => show(bar));
    bar.addEventListener('pointerleave', hide);
    bar.addEventListener('blur', hide);
  });
}

async function renderDashboard(alive) {
  const s = await api('/admin/stats');
  if (!alive()) return;
  pendingCount = s.byStatus.pendiente;
  renderNav('dashboard');

  const week = s.salesByDay.reduce((sum, d) => sum + d.total, 0);
  const maxUnits = Math.max(...s.topProducts.map((p) => p.units), 1);
  actions.innerHTML = `<a class="btn-ghost btn-sm" href="#productos/nuevo">${icons.plus}Nuevo producto</a>`;

  view.innerHTML = `
    <div class="kpis">
      ${kpi('Ventas totales', money(s.revenue), 'Sin contar pedidos cancelados')}
      ${kpi('Pedidos', s.orders, `Ticket promedio ${money(s.averageTicket)}`)}
      <a href="#pedidos/pendiente" class="kpi ${s.byStatus.pendiente ? 'is-alert' : ''}">
        <span>Por atender</span><strong>${s.byStatus.pendiente}</strong><small>Pedidos pendientes de pago</small>
      </a>
      ${kpi('Clientes', s.customers, `${s.products} productos a la venta`)}
    </div>

    <div class="dash-grid">
      <section class="panel">
        <div class="panel-head"><h2>Ventas · últimos 7 días</h2><small>${money(week)} en la semana</small></div>
        ${barChart(s.salesByDay)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Pedidos por estado</h2><a href="#pedidos">Ver todos</a></div>
        <div class="status-list">
          ${Object.keys(STATUS).map((st) => `<a class="status-row" href="#pedidos/${st}">${statusChip(st)}<b>${s.byStatus[st]}</b></a>`).join('')}
        </div>
      </section>
    </div>

    <div class="dash-grid">
      <section class="panel">
        <div class="panel-head"><h2>Pedidos recientes</h2><a href="#pedidos">Ver todos</a></div>
        ${s.recentOrders.length ? `<div class="table-wrap" style="border: 0">
          <table>
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${s.recentOrders.map((o) => `<tr>
                <td><button class="link-btn" type="button" data-order="${o.id}">#${o.id}</button></td>
                <td>${esc(o.customer_name)}</td>
                <td><small>${fmtDate(o.created_at)}</small></td>
                <td>${statusChip(o.status)}</td>
                <td class="num">${money(o.total)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>` : '<p class="muted">Todavía no hay pedidos.</p>'}
      </section>

      <div style="display: grid; gap: 20px; align-content: start">
        <section class="panel">
          <div class="panel-head"><h2>Más vendidos</h2><small>Unidades</small></div>
          <div class="rank">
            ${s.topProducts.length ? s.topProducts.map((p) => `
              <div class="rank-row">
                <div class="thumb">${productVisual(p, { flat: true })}</div>
                <div><strong>${esc(p.name)}</strong><div class="rank-meter"><i style="width: ${(p.units / maxUnits) * 100}%"></i></div></div>
                <div class="rank-value"><b>${p.units} u.</b>${money(p.revenue)}</div>
              </div>`).join('') : '<p class="muted">Aún no hay ventas.</p>'}
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Stock bajo</h2><small>3 unidades o menos</small></div>
          ${s.lowStock.length ? s.lowStock.map((r) => `
            <div class="low-row">
              <span>${esc(r.name)} <span class="pill">${esc(r.size)}</span></span>
              <span><span class="pill ${r.stock === 0 ? 'is-zero' : 'is-low'}">${r.stock === 0 ? 'Agotado' : `${r.stock} u.`}</span>
              <button class="link-btn" type="button" data-restock="${r.id}" style="margin-left: 8px">Reponer</button></span>
            </div>`).join('') : '<p class="muted">Todo el inventario está bien abastecido.</p>'}
        </section>
      </div>
    </div>`;

  wireChart(s.salesByDay);
  qsa('[data-order]', view).forEach((b) => b.addEventListener('click', () => openOrder(Number(b.dataset.order))));
  qsa('[data-restock]', view).forEach((b) =>
    b.addEventListener('click', async () => {
      await loadCatalog();
      const p = catalog.products.find((x) => x.id === Number(b.dataset.restock));
      if (p) openProductForm(p);
    }),
  );
}

// =========================================================
// Productos
// =========================================================
const catalog = { products: [], categories: [] };
async function loadCatalog() {
  [catalog.products, catalog.categories] = await Promise.all([api('/admin/products'), api('/admin/categories')]);
}

async function renderProducts(alive, arg) {
  await loadCatalog();
  if (!alive()) return;
  actions.innerHTML = `<button class="btn btn-sm" type="button" data-new>${icons.plus}Nuevo producto</button>`;
  qs('[data-new]', actions).addEventListener('click', () => openProductForm());

  view.innerHTML = `
    <div class="admin-toolbar">
      <label class="search"><span class="sr-only">Buscar</span>${icons.search}<input type="search" placeholder="Buscar producto" data-q></label>
      <select data-cat aria-label="Categoría">
        <option value="">Todas las categorías</option>
        ${catalog.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
      <select data-state aria-label="Estado">
        <option value="">Todos</option>
        <option value="active">A la venta</option>
        <option value="hidden">Ocultos</option>
        <option value="featured">Destacados</option>
        <option value="out">Con tallas agotadas</option>
      </select>
      <small class="muted" data-count></small>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Producto</th><th class="num">Precio</th><th>Stock por talla</th><th>Estado</th><th class="num">Acciones</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>`;

  const rows = qs('[data-rows]', view);
  const q = qs('[data-q]', view);
  const cat = qs('[data-cat]', view);
  const state = qs('[data-state]', view);

  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const list = catalog.products.filter((p) => {
      if (term && !`${p.name} ${p.category || ''}`.toLowerCase().includes(term)) return false;
      if (cat.value && String(p.category_id) !== cat.value) return false;
      if (state.value === 'active' && !p.active) return false;
      if (state.value === 'hidden' && p.active) return false;
      if (state.value === 'featured' && !p.featured) return false;
      if (state.value === 'out' && !Object.values(p.stock).some((n) => n === 0)) return false;
      return true;
    });
    qs('[data-count]', view).textContent = `${list.length} de ${catalog.products.length} productos`;
    rows.innerHTML = list.length
      ? list.map((p) => `<tr>
          <td><div class="cell-main"><div class="thumb">${productVisual(p, { flat: true })}</div>
            <div><strong>${esc(p.name)}</strong><small>${esc(p.category || 'Sin categoría')} · ${esc(DESIGNS[p.design] || p.design)}${p.print && p.print !== 'ninguno' ? ` · ${esc(PRINTS[p.print] || p.print)}` : ''}</small></div></div></td>
          <td class="num">${money(p.price)}</td>
          <td>${stockPills(p.stock)}</td>
          <td>${p.active ? '<span class="chip chip-ok">A la venta</span>' : '<span class="chip chip-muted">Oculto</span>'}
            ${p.featured ? `<span class="star" title="Destacado en el inicio">★</span>` : ''}</td>
          <td><div class="row-actions">
            <a class="icon-btn" href="/producto.html?id=${p.id}" target="_blank" rel="noopener" aria-label="Ver en la tienda" title="Ver en la tienda" ${p.active ? '' : 'hidden'}>${icons.store}</a>
            <button class="icon-btn" type="button" data-edit="${p.id}" aria-label="Editar ${esc(p.name)}" title="Editar">${icons.edit}</button>
            <button class="icon-btn is-danger" type="button" data-del="${p.id}" aria-label="Eliminar ${esc(p.name)}" title="Eliminar">${icons.trash}</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="5"><p class="muted" style="padding: 20px 0; text-align: center">No hay productos con esos filtros.</p></td></tr>';
  };

  [q, cat, state].forEach((el) => el.addEventListener('input', draw));
  rows.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openProductForm(catalog.products.find((p) => p.id === Number(edit.dataset.edit)));
    if (del) {
      const p = catalog.products.find((x) => x.id === Number(del.dataset.del));
      if (!confirm(`¿Eliminar "${p.name}"? Los pedidos anteriores conservarán sus datos. Si solo quieres dejar de venderlo, márcalo como oculto.`)) return;
      try {
        await api(`/admin/products/${p.id}`, { method: 'DELETE' });
        toast('Producto eliminado');
        catalog.products = catalog.products.filter((x) => x.id !== p.id);
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  draw();

  if (arg === 'nuevo') {
    history.replaceState(null, '', '#productos');
    openProductForm();
  }
}

function openProductForm(product = null) {
  const isNew = !product;
  const p = product || {
    name: '', description: '', price: 5990, category_id: catalog.categories[0]?.id ?? '', color: '#18181a',
    accent: '#ff2a2a', design: 'liso', print: 'ninguno', featured: false, active: true, image: null,
    stock: Object.fromEntries(config.sizes.map((s) => [s, 10])),
  };

  const body = openModal(isNew ? 'Nuevo producto' : `Editar: ${p.name}`, `
    <form class="product-form" novalidate data-form>
      <div class="preview">
        <div class="preview-stage" data-preview></div>
        <div class="seg" role="group" aria-label="Vista de la vista previa" data-preview-views>
          <button type="button" data-pv="front" aria-pressed="true">Frente</button>
          <button type="button" data-pv="back" aria-pressed="false">Espalda</button>
        </div>
        <small data-preview-note></small>
      </div>
      <div class="form-grid">
        <label class="field full"><span>Nombre</span><input type="text" name="name" required maxlength="80" value="${esc(p.name)}"></label>
        <label class="field"><span>Categoría</span>
          <select name="category_id">
            <option value="">Sin categoría</option>
            ${catalog.categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Precio (S/)</span><input type="number" name="price" min="0" step="0.10" required value="${(p.price / 100).toFixed(2)}"></label>
        <label class="field full"><span>Descripción</span><textarea name="description" maxlength="800">${esc(p.description)}</textarea></label>

        <div class="field"><span>Color del polo</span>
          <div class="color-field"><input type="color" value="${esc(p.color)}" data-pick="color" aria-label="Elegir color del polo">
          <input type="text" name="color" value="${esc(p.color)}" maxlength="7" pattern="#[0-9a-fA-F]{6}" aria-label="Código de color del polo"></div>
        </div>
        <div class="field"><span>Color de acento</span>
          <div class="color-field"><input type="color" value="${esc(p.accent)}" data-pick="accent" aria-label="Elegir color de acento">
          <input type="text" name="accent" value="${esc(p.accent)}" maxlength="7" pattern="#[0-9a-fA-F]{6}" aria-label="Código del color de acento"></div>
        </div>

        <fieldset class="field full" style="border: 0; padding: 0; margin: 0">
          <legend class="field-label" style="margin-bottom: 6px">Diseño</legend>
          <div class="design-options" data-designs>
            ${Object.entries(DESIGNS).map(([value, label]) => `
              <label class="design-option">
                <input type="radio" name="design" value="${value}" ${value === p.design ? 'checked' : ''}>
                <span data-design-thumb="${value}"></span>${label}
              </label>`).join('')}
          </div>
        </fieldset>

        <fieldset class="field full" style="border: 0; padding: 0; margin: 0">
          <legend class="field-label" style="margin-bottom: 6px">Estampado en el pecho</legend>
          <div class="design-options print-options">
            ${Object.entries(PRINTS).map(([value, label]) => `
              <label class="design-option">
                <input type="radio" name="print" value="${value}" ${value === (p.print || 'ninguno') ? 'checked' : ''}>
                <span data-print-thumb="${value}"></span>${label}
              </label>`).join('')}
          </div>
        </fieldset>

        <fieldset class="field full" style="border: 0; padding: 0; margin: 0">
          <legend class="field-label" style="margin-bottom: 6px">Stock por talla</legend>
          <div class="stock-grid">
            ${config.sizes.map((s) => `<label>${s}<input type="number" name="stock_${s}" min="0" max="9999" step="1" value="${p.stock[s] ?? 0}"></label>`).join('')}
          </div>
        </fieldset>

        <label class="field full"><span>Foto del producto (opcional)</span>
          <input type="file" name="image" accept="image/png,image/jpeg,image/webp" data-file>
          <small class="muted">JPG, PNG o WEBP de hasta 2 MB. Si no subes foto, se muestra el polo dibujado con los colores elegidos.</small>
        </label>
        ${p.image ? `<label class="switch full"><input type="checkbox" name="remove_image" value="1" data-remove-image><span>Quitar la foto actual</span></label>` : ''}

        <label class="switch"><input type="checkbox" name="active" value="1" ${p.active ? 'checked' : ''}><span>A la venta</span></label>
        <label class="switch"><input type="checkbox" name="featured" value="1" ${p.featured ? 'checked' : ''}><span>Destacado en el inicio</span></label>

        <p class="form-error full" role="alert" data-error></p>
        <div class="form-actions">
          <button class="btn-ghost btn-sm" type="button" data-cancel>Cancelar</button>
          <button class="btn btn-sm" type="submit">${isNew ? 'Crear producto' : 'Guardar cambios'}</button>
        </div>
      </div>
    </form>`);

  const form = qs('[data-form]', body);
  const preview = qs('[data-preview]', body);
  const note = qs('[data-preview-note]', body);
  const fileInput = qs('[data-file]', body);
  const removeImage = qs('[data-remove-image]', body);
  let objectUrl = null;
  let thumbsKey = '';
  let printsKey = '';
  let previewView = 'front';
  const validHex = (v) => /^#[0-9a-f]{6}$/i.test(v);

  const drawPreview = () => {
    const color = validHex(form.elements.color.value) ? form.elements.color.value : p.color;
    const accent = validHex(form.elements.accent.value) ? form.elements.accent.value : p.accent;
    const design = form.elements.design.value;
    const print = form.elements.print.value;
    // Redibujar las miniaturas solo si cambia lo que muestran: si se reemplazan bajo el puntero, el clic se pierde.
    if (thumbsKey !== color + accent) {
      thumbsKey = color + accent;
      qsa('[data-design-thumb]', body).forEach((el) => {
        el.innerHTML = poloSVG({ color, accent, design: el.dataset.designThumb, flat: true });
      });
    }
    if (printsKey !== color + accent + design) {
      printsKey = color + accent + design;
      qsa('[data-print-thumb]', body).forEach((el) => {
        el.innerHTML = poloSVG({ color, accent, design, print: el.dataset.printThumb, flat: true });
      });
    }
    qsa('[data-pv]', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pv === previewView)));

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    const file = fileInput.files[0];
    if (file) {
      objectUrl = URL.createObjectURL(file);
      preview.innerHTML = `<img class="polo polo-img" src="${objectUrl}" alt="Vista previa de la foto">`;
      note.textContent = 'Foto nueva (se guardará al confirmar)';
    } else if (p.image && !removeImage?.checked) {
      preview.innerHTML = `<img class="polo polo-img" src="${esc(p.image)}" alt="Foto actual">`;
      note.textContent = 'Foto actual del producto';
    } else {
      preview.innerHTML = poloSVG({ color, accent, design, print, view: previewView, text: previewView === 'back' ? 'NOMBRE' : '' });
      note.textContent = previewView === 'back' ? 'Espalda: aquí va el nombre si el cliente lo personaliza' : 'Vista previa del polo dibujado';
    }
  };

  qsa('[data-pick]', body).forEach((picker) =>
    picker.addEventListener('input', () => {
      form.elements[picker.dataset.pick].value = picker.value;
      drawPreview();
    }),
  );
  ['color', 'accent'].forEach((name) =>
    form.elements[name].addEventListener('input', () => {
      const v = form.elements[name].value.trim();
      if (validHex(v)) qs(`[data-pick="${name}"]`, body).value = v;
      drawPreview();
    }),
  );
  form.addEventListener('change', drawPreview);
  qsa('[data-pv]', body).forEach((b) =>
    b.addEventListener('click', () => {
      previewView = b.dataset.pv;
      drawPreview();
    }),
  );
  qs('[data-cancel]', body).addEventListener('click', () => modal.close());
  modal.addEventListener('close', () => objectUrl && URL.revokeObjectURL(objectUrl), { once: true });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = qs('[data-error]', form);
    error.textContent = '';
    if (form.elements.name.value.trim().length < 3) {
      error.textContent = 'El nombre debe tener al menos 3 caracteres.';
      return;
    }
    const data = new FormData(form);
    // Sin archivo elegido el navegador envía una parte vacía; no la mandamos.
    if (!fileInput.files.length) data.delete('image');
    const submit = qs('button[type="submit"]', form);
    submit.disabled = true;
    try {
      await api(isNew ? '/admin/products' : `/admin/products/${p.id}`, { method: isNew ? 'POST' : 'PUT', form: data });
      modal.close();
      toast(isNew ? 'Producto creado' : 'Cambios guardados');
      route();
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  });

  drawPreview();
  form.elements.name.focus();
}

// =========================================================
// Pedidos
// =========================================================
const orderFilter = { status: '', q: '' };

async function renderOrders(alive, arg) {
  orderFilter.status = STATUS[arg] ? arg : '';
  let orders = await api('/admin/orders');
  if (!alive()) return;

  view.innerHTML = `
    <div class="admin-toolbar">
      <div class="seg" role="group" aria-label="Filtrar por estado" data-seg></div>
      <label class="search" style="margin-left: auto"><span class="sr-only">Buscar pedido</span>${icons.search}
        <input type="search" placeholder="N.º de pedido, cliente o correo" value="${esc(orderFilter.q)}" data-q></label>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th class="num">Unid.</th><th class="num">Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>`;

  const seg = qs('[data-seg]', view);
  const rows = qs('[data-rows]', view);
  const q = qs('[data-q]', view);

  const draw = () => {
    const counts = Object.fromEntries(Object.keys(STATUS).map((s) => [s, orders.filter((o) => o.status === s).length]));
    seg.innerHTML = [['', 'Todos', orders.length], ...Object.entries(STATUS).map(([k, s]) => [k, s.label, counts[k]])]
      .map(([k, label, n]) => `<button type="button" data-status="${k}" aria-pressed="${orderFilter.status === k}">${label}<small>${n}</small></button>`)
      .join('');

    const term = orderFilter.q.toLowerCase().replace(/^#/, '');
    const list = orders.filter((o) => {
      if (orderFilter.status && o.status !== orderFilter.status) return false;
      if (!term) return true;
      return String(o.id) === term || `${o.customer_name} ${o.customer_email} ${o.ship_name}`.toLowerCase().includes(term);
    });
    rows.innerHTML = list.length
      ? list.map((o) => `<tr>
          <td><button class="link-btn" type="button" data-open="${o.id}"><strong>#${o.id}</strong></button></td>
          <td><strong>${esc(o.customer_name)}</strong><br><small>${esc(o.customer_email)}</small></td>
          <td><small>${fmtDate(o.created_at)}</small></td>
          <td class="num">${o.units}</td>
          <td class="num"><strong>${money(o.total)}</strong></td>
          <td><small>${esc(PAYMENT[o.payment_method] || o.payment_method)}</small></td>
          <td>${statusSelect(o, `data-status-of="${o.id}"`)}</td>
          <td><button class="btn-ghost btn-sm" type="button" data-open="${o.id}">Ver</button></td>
        </tr>`).join('')
      : '<tr><td colspan="8"><p class="muted" style="padding: 20px 0; text-align: center">No hay pedidos para mostrar.</p></td></tr>';
  };

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    orderFilter.status = b.dataset.status;
    history.replaceState(null, '', orderFilter.status ? `#pedidos/${orderFilter.status}` : '#pedidos');
    draw();
  });
  q.addEventListener('input', () => {
    orderFilter.q = q.value.trim();
    draw();
  });
  rows.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) openOrder(Number(open.dataset.open), (updated) => {
      orders = orders.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
      draw();
    });
  });
  rows.addEventListener('change', async (e) => {
    const select = e.target.closest('[data-status-of]');
    if (!select) return;
    const order = orders.find((o) => o.id === Number(select.dataset.statusOf));
    try {
      const updated = await changeStatus(order, select.value);
      if (updated) orders = orders.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
    } catch (err) {
      toast(err.message, 'error');
    }
    draw();
  });
  draw();
}

async function openOrder(id, onChange) {
  let order;
  try {
    order = await api(`/admin/orders/${id}`);
  } catch (err) {
    return toast(err.message, 'error');
  }
  const reached = STATUS_FLOW.indexOf(order.status);
  const body = openModal(`Pedido #${order.id}`, `
    <div class="order-detail">
      <div>
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px">
          ${statusChip(order.status)}<span class="muted">${fmtDate(order.created_at)}</span>
        </div>
        ${order.status === 'cancelado' ? '' : `<ol class="clean timeline">${STATUS_FLOW.map((s, i) => `<li class="${i <= reached ? 'done' : ''}">${STATUS[s].label}</li>`).join('')}</ol>`}
        <div class="order-items">
          ${order.items.map((it) => `
            <div class="order-item">
              <div class="cart-thumb">${productVisual(it, { text: it.custom_text, view: it.custom_text ? 'back' : 'front' })}</div>
              <div><strong>${esc(it.product_name)}</strong>
                <span>Talla ${esc(it.size)} · ${it.quantity} × ${money(it.unit_price)}${it.custom_text ? ` · Estampado: “${esc(it.custom_text)}”` : ''}</span></div>
              <span>${money(it.unit_price * it.quantity)}</span>
            </div>`).join('')}
        </div>
      </div>
      <div style="display: grid; gap: 14px; align-content: start">
        <div class="detail-box">
          <h3>Cliente</h3>
          <strong>${esc(order.customer_name)}</strong>
          <span>${esc(order.customer_email)}</span>
        </div>
        <div class="detail-box">
          <h3>Envío</h3>
          <strong>${esc(order.ship_name)}</strong>
          <span>${esc(order.ship_address)}, ${esc(order.ship_city)}</span>
          <span>Cel. ${esc(order.ship_phone)}</span>
          ${order.notes ? `<span>Notas: ${esc(order.notes)}</span>` : ''}
        </div>
        <div class="detail-box">
          <h3>Pago · ${esc(PAYMENT[order.payment_method] || order.payment_method)}</h3>
          <div class="summary-row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
          <div class="summary-row"><span>Envío</span><span>${order.shipping ? money(order.shipping) : 'Gratis'}</span></div>
          <div class="detail-total"><span>Total</span><span>${money(order.total)}</span></div>
        </div>
        ${order.status === 'cancelado'
          ? '<p class="muted">Este pedido fue cancelado y su stock ya se devolvió al inventario.</p>'
          : `<label class="field"><span>Cambiar estado</span>${statusSelect(order, 'data-detail-status')}</label>`}
      </div>
    </div>`);

  qs('[data-detail-status]', body)?.addEventListener('change', async (e) => {
    try {
      const updated = await changeStatus(order, e.target.value);
      if (!updated) {
        e.target.value = order.status;
        return;
      }
      onChange?.(updated);
      if (parseHash()[0] === 'dashboard') route();
      openOrder(order.id, onChange);
    } catch (err) {
      toast(err.message, 'error');
      e.target.value = order.status;
    }
  });
}

// =========================================================
// Categorías
// =========================================================
async function renderCategories(alive) {
  const cats = await api('/admin/categories');
  if (!alive()) return;
  view.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Nueva categoría</h2></div>
      <form class="inline-form" novalidate data-new-cat>
        <input type="text" name="name" maxlength="40" placeholder="Ej. Edición verano" aria-label="Nombre de la nueva categoría">
        <button class="btn btn-sm" type="submit">${icons.plus}Agregar</button>
      </form>
    </section>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th class="num">Productos</th><th class="num">Acciones</th></tr></thead>
        <tbody data-rows>
          ${cats.map((c) => `<tr data-id="${c.id}" data-count="${c.count}">
            <td><input class="cat-input" type="text" value="${esc(c.name)}" maxlength="40" aria-label="Nombre de la categoría ${esc(c.name)}"></td>
            <td class="num">${c.count}</td>
            <td><div class="row-actions">
              <button class="btn-ghost btn-sm" type="button" data-save>Guardar</button>
              <button class="icon-btn is-danger" type="button" data-del aria-label="Eliminar ${esc(c.name)}">${icons.trash}</button>
            </div></td>
          </tr>`).join('') || '<tr><td colspan="3"><p class="muted">Aún no hay categorías.</p></td></tr>'}
        </tbody>
      </table>
    </div>`;

  qs('[data-new-cat]', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/admin/categories', { method: 'POST', body: { name: e.currentTarget.elements.name.value } });
      toast('Categoría creada');
      route();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  qs('[data-rows]', view).addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    try {
      if (e.target.closest('[data-save]')) {
        await api(`/admin/categories/${id}`, { method: 'PUT', body: { name: qs('input', row).value } });
        toast('Categoría actualizada');
      } else if (e.target.closest('[data-del]')) {
        const n = Number(row.dataset.count);
        if (!confirm(`¿Eliminar la categoría?${n ? ` Sus ${n} productos quedarán sin categoría.` : ''}`)) return;
        await api(`/admin/categories/${id}`, { method: 'DELETE' });
        toast('Categoría eliminada');
        route();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// =========================================================
// Clientes
// =========================================================
async function renderCustomers(alive) {
  const customers = await api('/admin/customers');
  if (!alive()) return;
  view.innerHTML = `
    <div class="admin-toolbar">
      <label class="search"><span class="sr-only">Buscar cliente</span>${icons.search}<input type="search" placeholder="Nombre, correo o celular" data-q></label>
      <small class="muted">${customers.length} clientes registrados</small>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Cliente</th><th>Celular</th><th>Registro</th><th class="num">Pedidos</th><th class="num">Total comprado</th><th>Último pedido</th><th>Acceso</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>`;

  const rows = qs('[data-rows]', view);
  const q = qs('[data-q]', view);
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const list = customers.filter((c) => !term || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(term));
    rows.innerHTML = list.length
      ? list.map((c) => `<tr>
          <td><strong>${esc(c.name)}</strong><br><small>${esc(c.email)}</small></td>
          <td>${esc(c.phone) || '<small>—</small>'}</td>
          <td><small>${fmtDate(c.created_at, false)}</small></td>
          <td class="num">${c.orders}</td>
          <td class="num">${money(c.spent)}</td>
          <td><small>${c.last_order ? fmtDate(c.last_order, false) : '—'}</small></td>
          <td><button type="button" class="toggle ${c.active ? 'is-on' : 'is-off'}" data-toggle="${c.id}"
            title="${c.active ? 'Clic para bloquear su acceso' : 'Clic para reactivar'}">${c.active ? 'Activo' : 'Bloqueado'}</button></td>
        </tr>`).join('')
      : '<tr><td colspan="7"><p class="muted" style="padding: 20px 0; text-align: center">No se encontraron clientes.</p></td></tr>';
  };

  q.addEventListener('input', draw);
  rows.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    const c = customers.find((x) => x.id === Number(btn.dataset.toggle));
    if (c.active && !confirm(`¿Bloquear a ${c.name}? No podrá iniciar sesión ni comprar.`)) return;
    try {
      const res = await api(`/admin/customers/${c.id}`, { method: 'PATCH', body: { active: !c.active } });
      c.active = res.active ? 1 : 0;
      toast(c.active ? 'Cliente reactivado' : 'Cliente bloqueado');
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  draw();
}

route();
refreshPending();
