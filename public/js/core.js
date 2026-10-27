// Utilidades compartidas por todas las páginas: API, sesión, carrito, cabecera y el polo en SVG.

export const STORE = {
  name: 'POLOLAB',
  collection: 'LIMA 26',
  tagline: 'Diseñado en la calle · Hecho en Perú',
};

export const STATUS = {
  pendiente: { label: 'Pendiente', tone: 'warn' },
  pagado: { label: 'Pagado', tone: 'info' },
  enviado: { label: 'Enviado', tone: 'accent' },
  entregado: { label: 'Entregado', tone: 'ok' },
  cancelado: { label: 'Cancelado', tone: 'muted' },
};
export const STATUS_FLOW = ['pendiente', 'pagado', 'enviado', 'entregado'];

export const PAYMENT = {
  yape: 'Yape / Plin',
  transferencia: 'Transferencia bancaria',
  contraentrega: 'Pago contra entrega',
};

export const DESIGNS = { liso: 'Liso', franja: 'Franja central', lineas: 'Líneas en hombros' };

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const money = (cents) => `S/ ${(Number(cents || 0) / 100).toFixed(2)}`;

export function fmtDate(sqlDate, withTime = true) {
  const d = new Date(`${String(sqlDate).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- API ----------
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new Error('No se pudo conectar con el servidor');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || 'Ocurrió un error inesperado');
    err.status = res.status;
    throw err;
  }
  return data;
}

let mePromise;
export function getMe(refresh = false) {
  if (!mePromise || refresh) mePromise = api('/auth/me').then((r) => r.user).catch(() => null);
  return mePromise;
}

let configPromise;
export function getConfig() {
  configPromise ??= api('/config');
  return configPromise;
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

// Solo se aceptan rutas internas para evitar redirecciones a otros sitios.
export function safeNext(value, fallback) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

// ---------- Carrito (se guarda en el navegador) ----------
const CART_KEY = 'pololab_cart_v1';
const sameLine = (a, b) => a.productId === b.productId && a.size === b.size && (a.custom || '') === (b.custom || '');

export const cart = {
  read() {
    try {
      const items = JSON.parse(localStorage.getItem(CART_KEY));
      return Array.isArray(items) ? items.filter((i) => i && i.productId && i.size && i.qty > 0) : [];
    } catch {
      return [];
    }
  },
  write(items) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      // Navegación privada sin almacenamiento: el carrito vive solo en esta página.
    }
    updateCartBadge(items);
  },
  add(line, max = 20) {
    const items = cart.read();
    const found = items.find((i) => sameLine(i, line));
    if (found) found.qty = Math.min(found.qty + line.qty, max);
    else items.push({ productId: line.productId, size: line.size, qty: line.qty, custom: line.custom || '' });
    cart.write(items);
  },
  setQty(index, qty) {
    const items = cart.read();
    if (!items[index]) return;
    items[index].qty = qty;
    cart.write(items.filter((i) => i.qty > 0));
  },
  remove(index) {
    const items = cart.read();
    items.splice(index, 1);
    cart.write(items);
  },
  clear() {
    cart.write([]);
  },
  count(items = cart.read()) {
    return items.reduce((n, i) => n + i.qty, 0);
  },
};

export function updateCartBadge(items) {
  const n = cart.count(items);
  qsa('[data-cart-count]').forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
  });
}

// ---------- Avisos ----------
export function toast(message, tone = 'ok') {
  let box = qs('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.classList.add('is-leaving'), 3200);
  setTimeout(() => el.remove(), 3600);
}

export function statusChip(status) {
  const s = STATUS[status] || { label: status, tone: 'muted' };
  return `<span class="chip chip-${s.tone}">${esc(s.label)}</span>`;
}

// ---------- El polo dibujado en SVG ----------
function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return 0;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const isLight = (hex) => luminance(hex) > 0.45;

const HEX = /^#[0-9a-f]{6}$/i;
const BODY =
  'M112 26C96 32 76 36 58 44C40 52 30 66 24 82L12 110L50 134L76 106C79 160 78 240 78 300Q150 308 222 300C222 240 221 160 224 106L250 134L288 110L276 82C270 66 260 52 242 44C224 36 204 32 188 26Q150 62 112 26Z';
let svgSeq = 0;

export function poloSVG({ color = '#1a1a1c', accent = '#ff2a2a', design = 'liso', text = '', className = '', label = '' } = {}) {
  const c = HEX.test(color) ? color : '#1a1a1c';
  const a = HEX.test(accent) ? accent : '#ff2a2a';
  const id = `polo${++svgSeq}`;
  const light = isLight(c);
  const stitch = light ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.16)';
  const contrast = light ? '#151515' : '#f4f4f4';

  let deco = '';
  if (design === 'franja') {
    deco = `<rect x="136" y="20" width="28" height="300" fill="${a}"/>
      <rect x="147" y="20" width="6" height="300" fill="${contrast}" opacity=".85"/>`;
  } else if (design === 'lineas') {
    deco = `<g id="${id}-l" fill="none" stroke="${a}" stroke-width="4.5" stroke-linecap="round">
        <path d="M112 35C96 41 78 45 62 53C46 61 36 73 31 89L20 114"/>
        <path d="M114 43C98 49 81 53 66 61C52 69 43 80 38 95L28 119"/>
        <path d="M12 110L50 134L55 127L16 102Z" fill="${a}" stroke="none"/>
      </g>
      <use href="#${id}-l" transform="translate(300 0) scale(-1 1)"/>`;
  }

  const rib = design === 'lineas' ? a : light ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.12)';
  const emblem = design === 'franja'
    ? `<path d="M184 96l9-14 5 7 3-4 7 11z" fill="${contrast}" opacity=".9"/>`
    : `<path d="M184 96l9-14 5 7 3-4 7 11z" fill="${a}"/>`;
  const t = String(text || '').toUpperCase().slice(0, 12);
  const words = t
    ? `<text x="150" y="182" text-anchor="middle" font-family="'Barlow Condensed', Impact, sans-serif" font-weight="800"
         font-size="40" letter-spacing="2" fill="${design === 'franja' ? contrast : a}" stroke="${c}" stroke-width="5"
         paint-order="stroke" ${t.length > 7 ? 'textLength="128" lengthAdjust="spacingAndGlyphs"' : ''}>${esc(t)}</text>`
    : '';

  return `<svg class="polo ${esc(className)}" viewBox="0 0 300 326" role="img" aria-label="${esc(label || 'Polo')}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="${id}-c"><path d="${BODY}"/></clipPath>
      <linearGradient id="${id}-h" x1="0" x2="1">
        <stop offset="0" stop-color="#000" stop-opacity=".5"/>
        <stop offset=".2" stop-color="#000" stop-opacity=".1"/>
        <stop offset=".44" stop-color="#fff" stop-opacity=".12"/>
        <stop offset=".6" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".84" stop-color="#000" stop-opacity=".16"/>
        <stop offset="1" stop-color="#000" stop-opacity=".55"/>
      </linearGradient>
      <linearGradient id="${id}-v" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
        <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity=".38"/>
      </linearGradient>
      <radialGradient id="${id}-s"><stop offset="0" stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="150" cy="312" rx="96" ry="10" fill="url(#${id}-s)"/>
    <path d="M112 26Q150 62 188 26Q150 15 112 26Z" fill="${c}"/>
    <path d="M112 26Q150 62 188 26Q150 15 112 26Z" fill="#000" opacity=".5"/>
    <path d="${BODY}" fill="${c}"/>
    <g clip-path="url(#${id}-c)">
      ${deco}
      <g fill="none" stroke="#000" stroke-opacity=".16" stroke-width="3" stroke-linecap="round">
        <path d="M100 150Q112 210 104 290"/><path d="M198 140Q188 200 196 290"/>
        <path d="M78 116Q92 128 104 126"/><path d="M222 116Q208 128 196 126"/>
      </g>
      <path d="M128 120Q136 200 130 290" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="7" stroke-linecap="round"/>
      <path d="M58 44C66 70 72 90 76 106M242 44C234 70 228 90 224 106" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1.3"/>
      <path d="M81 293Q150 301 219 293M16 103L54 127M284 103L246 127" fill="none" stroke="${stitch}" stroke-width="1.2" stroke-dasharray="3 3"/>
      ${emblem}
      ${words}
      <rect x="0" y="0" width="300" height="326" fill="url(#${id}-h)"/>
      <rect x="0" y="0" width="300" height="326" fill="url(#${id}-v)"/>
    </g>
    <path d="M112 26Q150 62 188 26" fill="none" stroke="${c}" stroke-width="6"/>
    <path d="M112 26Q150 62 188 26" fill="none" stroke="${rib}" stroke-width="6"/>
    <path class="polo-rim" d="${BODY}" fill="none" stroke="${a}" stroke-width="2"/>
  </svg>`;
}

export function productVisual(p, { text = '', className = '' } = {}) {
  const name = p.product_name || p.name || 'Polo';
  if (p.image) return `<img class="polo polo-img ${esc(className)}" src="${esc(p.image)}" alt="${esc(name)}" loading="lazy">`;
  return poloSVG({ color: p.color, accent: p.accent, design: p.design, text, className, label: name });
}

export function productCard(p) {
  const soldOut = p.total_stock === 0;
  return `<a class="card" href="/producto.html?id=${p.id}" style="--accent:${esc(p.accent)}">
    <div class="card-stage">
      <div class="card-tags">
        ${p.featured ? `<span class="tag">${esc(STORE.collection)}</span>` : ''}
        ${soldOut ? '<span class="tag tag-muted">Agotado</span>' : ''}
      </div>
      ${productVisual(p, { className: 'card-polo' })}
    </div>
    <div class="card-info">
      <span class="card-cat">${esc(p.category || 'Polo')}</span>
      <h3>${esc(p.name)}</h3>
      <span class="card-price">${money(p.price)}</span>
    </div>
  </a>`;
}

// ---------- Iconos ----------
const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icons = {
  bag: svg('<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  logout: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
  truck: svg('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  card: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  shirt: svg('<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>'),
  box: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.2 3.8 5"/>'),
  store: svg('<path d="M4 9h16l-1-5H5zM5 9v11h14V9M10 20v-6h4v6"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
};

export const logoMark = () =>
  `<svg class="logo-mark" viewBox="0 0 32 24" width="30" height="22" aria-hidden="true"><path d="M2 22 13 4l6 9 4-6 7 15z" fill="currentColor"/></svg>`;

// ---------- Cabecera y pie ----------
export async function mountChrome({ overlay = false } = {}) {
  const header = qs('[data-header]');
  const footer = qs('[data-footer]');
  const user = await getMe();

  if (header) {
    header.className = `site-header${overlay ? ' is-overlay' : ''}`;
    header.innerHTML = `
      <a class="brand" href="/" aria-label="${esc(STORE.name)}, inicio">${logoMark()}<span>${esc(STORE.name)}</span></a>
      <nav class="main-nav" aria-label="Principal">
        <a href="/tienda.html">Tienda</a>
        ${user?.role === 'admin' ? '<a href="/admin.html">Panel admin</a>' : ''}
      </nav>
      <div class="header-actions">
        <a class="btn-ghost btn-sm hide-sm" href="/tienda.html">Ver la colección</a>
        <a class="icon-btn" href="/carrito.html" aria-label="Carrito">${icons.bag}<span class="badge" data-cart-count hidden></span></a>
        ${user
          ? `<a class="icon-btn" href="${user.role === 'admin' ? '/admin.html' : '/cuenta.html'}" aria-label="Mi cuenta" title="${esc(user.name)}">${icons.user}</a>`
          : '<a class="header-link" href="/login.html">Ingresar</a>'}
      </div>`;
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="footer-brand">${logoMark()}<strong>${esc(STORE.name)}</strong><span>${esc(STORE.tagline)}</span></div>
      <nav class="footer-links" aria-label="Pie de página">
        <a href="/tienda.html">Tienda</a>
        <a href="/cuenta.html">Mis pedidos</a>
        <a href="/login.html">Ingresar</a>
      </nav>
      <small>© ${new Date().getFullYear()} ${esc(STORE.name)} · Términos y condiciones · Privacidad · Libro de reclamaciones</small>`;
  }
  updateCartBadge();
  return user;
}

// ---------- Efectos ----------
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>';
export function scramble(el, duration = 900) {
  const final = el.dataset.text ?? el.textContent;
  el.dataset.text = final;
  if (reducedMotion()) {
    el.textContent = final;
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const fixed = Math.floor(final.length * progress);
    let out = final.slice(0, fixed);
    for (let i = fixed; i < final.length; i++) {
      out += final[i] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
    el.textContent = out;
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Añade .in-view a los elementos [data-reveal] cuando aparecen en pantalla.
export function observeReveal(root = document) {
  const items = qsa('[data-reveal]', root);
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in-view'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in-view');
        qsa('[data-scramble]', entry.target).forEach((el) => scramble(el));
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.25 },
  );
  items.forEach((el) => io.observe(el));
}
