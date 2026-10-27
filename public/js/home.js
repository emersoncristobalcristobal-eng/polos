import { api, esc, icons, isLight, mountChrome, observeReveal, productCard, productVisual, qs, reducedMotion } from './core.js';

const chrome = mountChrome({ overlay: true });
const products = await api('/products').catch(() => []);
await chrome;

// ---------- Escenario con los tres polos destacados ----------
const featured = products.filter((p) => p.featured);
const trio = (featured.length >= 3 ? featured : products).slice(0, 3);
const ordered = trio.length === 3 ? [trio[1], trio[0], trio[2]] : trio;

const stageItem = (p, center) => `
  <a class="stage-item ${center ? 'is-center' : 'is-side'}" href="/producto.html?id=${p.id}" aria-label="${esc(p.name)}">
    <div class="${center ? 'float' : ''}">${productVisual(p)}</div>
    <div class="stage-reflection" aria-hidden="true">${productVisual(p)}</div>
  </a>`;

qs('[data-stage]').innerHTML = ordered.map((p, i) => stageItem(p, ordered.length === 1 || i === 1)).join('');

// Movimiento suave del escenario siguiendo el mouse.
const hero = qs('[data-hero]');
const stage = qs('[data-stage]');
if (!reducedMotion() && window.matchMedia('(pointer: fine)').matches) {
  hero.addEventListener('pointermove', (e) => {
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    stage.style.transform = `translate3d(${x * -18}px, ${y * -10}px, 0)`;
  });
  hero.addEventListener('pointerleave', () => {
    stage.style.transform = '';
  });
}

// ---------- Polos de cada capítulo ----------
const drawn = products.filter((p) => !p.image);
const pick = (test, fallback) => drawn.find(test) || fallback;
const material = pick((p) => p.design === 'lineas' && !isLight(p.color), products[0]);
const origen = pick((p) => p !== material && !p.featured && p.design !== 'liso' && !isLight(p.color), products[1] || material);
const edicion = featured[0] || products[0];
const crear = pick((p) => isLight(p.color), products[0]);

const visuals = { material, origen, edicion, crear };
for (const [key, product] of Object.entries(visuals)) {
  const el = qs(`[data-visual="${key}"]`);
  if (!product) continue;
  el.innerHTML = key === 'crear' ? productVisual(product, { text: 'TU NOMBRE' }) : productVisual(product);
}

// ---------- Personalización en vivo ----------
const nameInput = qs('[data-name-input]');
const customLink = qs('[data-custom-link]');
const updateCustom = () => {
  if (!crear) return;
  const name = nameInput.value.trim().toUpperCase();
  qs('[data-visual="crear"]').innerHTML = productVisual(crear, { text: name || 'TU NOMBRE' });
  customLink.href = `/producto.html?id=${crear.id}${name ? `&nombre=${encodeURIComponent(name)}` : ''}`;
};
nameInput.addEventListener('input', updateCustom);
updateCustom();

// ---------- Beneficios y colección ----------
qs('[data-perks]').innerHTML = [
  [icons.truck, 'Envío gratis', 'En compras desde S/ 150 a todo el Perú'],
  [icons.refresh, 'Cambios fáciles', 'Tienes 30 días para cambiar tu talla'],
  [icons.card, 'Paga como quieras', 'Yape, Plin, transferencia o contra entrega'],
  [icons.shirt, 'Hecho en Perú', 'Algodón pima de la costa norte'],
]
  .map(([icon, title, text]) => `<div class="perk">${icon}<div><strong>${title}</strong><span>${text}</span></div></div>`)
  .join('');

qs('[data-grid]').innerHTML = products.length
  ? products.slice(0, 8).map(productCard).join('')
  : '<div class="empty"><h3>Muy pronto</h3><p>Estamos preparando la nueva colección.</p></div>';

observeReveal();
