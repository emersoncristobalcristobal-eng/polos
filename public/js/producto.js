import { STORE, api, cart, esc, getConfig, icons, money, mountChrome, productCard, productVisual, qs, qsa, toast } from './core.js';

const chrome = mountChrome();
const params = new URLSearchParams(location.search);
const root = qs('[data-product]');

const [product, config] = await Promise.all([
  api(`/products/${encodeURIComponent(params.get('id') || '0')}`).catch(() => null),
  getConfig(),
]);
await chrome;

if (!product) {
  root.innerHTML = `<div class="empty" style="margin: 60px 0">
    <h3>Polo no encontrado</h3>
    <p>Puede que ya no esté disponible.</p>
    <a class="btn" href="/tienda.html">Ir a la tienda</a>
  </div>`;
} else {
  renderProduct();
  loadRelated();
}

function renderProduct() {
  document.title = `${product.name} · ${STORE.name}`;
  const initialName = (params.get('nombre') || '').toUpperCase().slice(0, config.customMaxLength);
  const state = {
    size: config.sizes.find((s) => product.stock[s] > 0) || null,
    qty: 1,
    custom: Boolean(initialName),
    text: initialName,
  };
  const canCustomize = !product.image;

  root.innerHTML = `
    <div class="product">
      <div class="product-stage" style="--accent:${esc(product.accent)}">
        <div class="neon" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="float" data-visual style="width: 100%"></div>
      </div>

      <div class="product-info">
        <nav class="breadcrumb" aria-label="Ruta">
          <a href="/tienda.html">Tienda</a><span>/</span>
          ${product.category ? `<a href="/tienda.html?categoria=${product.category_id}">${esc(product.category)}</a><span>/</span>` : ''}
          <span>${esc(product.name)}</span>
        </nav>
        <div>
          ${product.featured ? `<span class="tag" style="display:inline-block; margin-bottom: 14px">${esc(STORE.collection)}</span>` : ''}
          <h1>${esc(product.name)}</h1>
        </div>
        <div class="price-lg">${money(product.price)}</div>
        <p class="product-desc">${esc(product.description)}</p>

        <div class="option-group">
          <div class="option-head"><span class="field-label">Talla</span><span class="muted">Corte regular · si dudas, elige tu talla de siempre</span></div>
          <div class="sizes" role="group" aria-label="Talla" data-sizes>
            ${config.sizes.map((s) => `<button class="size-btn" type="button" data-size="${s}" ${product.stock[s] > 0 ? '' : 'disabled'}
              aria-label="Talla ${s}${product.stock[s] > 0 ? '' : ', agotada'}">${s}</button>`).join('')}
          </div>
          <p class="stock-note" data-stock-note></p>
        </div>

        <div class="option-group">
          <span class="field-label">Cantidad</span>
          <div class="qty">
            <button type="button" data-qty="-1" aria-label="Quitar uno">${icons.minus}</button>
            <output data-qty-value>1</output>
            <button type="button" data-qty="1" aria-label="Agregar uno">${icons.plus}</button>
          </div>
        </div>

        ${canCustomize ? `
        <div class="custom-box">
          <label class="switch">
            <input type="checkbox" data-custom-toggle ${state.custom ? 'checked' : ''}>
            <span><strong>Personalizar con tu nombre</strong> <span class="muted">(+${money(config.customFee)})</span></span>
          </label>
          <label class="field" data-custom-field ${state.custom ? '' : 'hidden'}>
            <span>Texto a estampar (máx. ${config.customMaxLength} caracteres)</span>
            <input type="text" maxlength="${config.customMaxLength}" value="${esc(state.text)}" placeholder="Tu nombre" data-custom-text autocomplete="off">
          </label>
        </div>` : ''}

        <div class="buy-row">
          <button class="btn" type="button" data-add>${icons.bag}<span data-add-label>Agregar al carrito</span></button>
          <a class="btn-ghost" href="/carrito.html" data-go-cart hidden>Ver carrito</a>
        </div>

        <ul class="clean info-list">
          <li>${icons.truck}<span>Envío gratis en compras desde ${money(config.freeShippingFrom)}. Si no, ${money(config.shippingCost)} a todo el Perú.</span></li>
          <li>${icons.refresh}<span>Cambios de talla dentro de los 30 días.</span></li>
          <li>${icons.card}<span>Paga con Yape, Plin, transferencia o contra entrega.</span></li>
        </ul>
      </div>
    </div>`;

  const visual = qs('[data-visual]', root);
  const note = qs('[data-stock-note]', root);
  const addLabel = qs('[data-add-label]', root);
  const addBtn = qs('[data-add]', root);
  const qtyValue = qs('[data-qty-value]', root);
  const customToggle = qs('[data-custom-toggle]', root);
  const customField = qs('[data-custom-field]', root);
  const customInput = qs('[data-custom-text]', root);

  // Lo que ya está en el carrito de esta talla también cuenta para el stock.
  const inCart = (size) =>
    cart.read().filter((i) => i.productId === product.id && i.size === size).reduce((n, i) => n + i.qty, 0);
  const available = () => (state.size ? product.stock[state.size] - inCart(state.size) : 0);

  function update() {
    const text = state.custom ? state.text : '';
    visual.innerHTML = productVisual(product, { text, className: '' });

    qsa('[data-size]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === state.size)));
    const left = available();
    if (product.total_stock === 0) note.textContent = 'Agotado por ahora. Vuelve pronto.';
    else if (!state.size) note.textContent = 'Elige una talla.';
    else if (left <= 0) note.textContent = 'Ya tienes en tu carrito todas las unidades disponibles de esta talla.';
    else if (left <= 3) note.textContent = `¡Solo quedan ${left}!`;
    else note.textContent = '';

    state.qty = Math.max(1, Math.min(state.qty, Math.max(left, 1), config.maxQtyPerLine));
    qtyValue.textContent = state.qty;
    const unit = product.price + (state.custom && state.text ? config.customFee : 0);
    addLabel.textContent = `Agregar al carrito · ${money(unit * state.qty)}`;
    addBtn.disabled = !state.size || left <= 0;
  }

  qs('[data-sizes]', root).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-size]');
    if (!btn || btn.disabled) return;
    state.size = btn.dataset.size;
    update();
  });

  qsa('[data-qty]', root).forEach((b) =>
    b.addEventListener('click', () => {
      state.qty += Number(b.dataset.qty);
      update();
    }),
  );

  customToggle?.addEventListener('change', () => {
    state.custom = customToggle.checked;
    customField.hidden = !state.custom;
    if (state.custom) customInput.focus();
    update();
  });

  customInput?.addEventListener('input', () => {
    state.text = customInput.value.toUpperCase();
    update();
  });

  addBtn.addEventListener('click', () => {
    if (!state.size) return toast('Elige una talla', 'error');
    if (state.custom && !state.text.trim()) {
      customInput.focus();
      return toast('Escribe el texto para tu polo o desactiva la personalización', 'error');
    }
    const max = Math.min(product.stock[state.size], config.maxQtyPerLine);
    cart.add({ productId: product.id, size: state.size, qty: state.qty, custom: state.custom ? state.text.trim() : '' }, max);
    toast(`${product.name} (talla ${state.size}) se agregó al carrito`);
    qs('[data-go-cart]', root).hidden = false;
    state.qty = 1;
    update();
  });

  update();
}

async function loadRelated() {
  const query = product.category_id ? `category=${product.category_id}&` : '';
  let related = await api(`/products?${query}exclude=${product.id}&limit=4`).catch(() => []);
  if (related.length < 4) {
    const more = await api(`/products?featured=1&exclude=${product.id}&limit=8`).catch(() => []);
    related = [...related, ...more.filter((p) => !related.some((r) => r.id === p.id))].slice(0, 4);
  }
  if (!related.length) return;
  qs('[data-related-grid]').innerHTML = related.map(productCard).join('');
  qs('[data-related]').hidden = false;
}
