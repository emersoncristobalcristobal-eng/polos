import { api, esc, mountChrome, productCard, qs } from './core.js';

const chrome = mountChrome();
const params = new URLSearchParams(location.search);
const state = {
  category: params.get('categoria') || '',
  q: params.get('q') || '',
  sort: params.get('orden') || '',
};

const chips = qs('[data-chips]');
const search = qs('[data-search]');
const sort = qs('[data-sort]');
const grid = qs('[data-grid]');
const count = qs('[data-count]');

search.value = state.q;
sort.value = state.sort;

const categories = await api('/categories').catch(() => []);
await chrome;

function renderChips() {
  const all = categories.reduce((n, c) => n + c.count, 0);
  chips.innerHTML = [
    `<button class="filter-chip" type="button" data-cat="" aria-pressed="${!state.category}">Todos<small>${all}</small></button>`,
    ...categories
      .filter((c) => c.count > 0)
      .map((c) => `<button class="filter-chip" type="button" data-cat="${c.id}" aria-pressed="${String(c.id) === state.category}">${esc(c.name)}<small>${c.count}</small></button>`),
  ].join('');
}

let requestId = 0;
async function load() {
  const current = ++requestId;
  const query = new URLSearchParams();
  if (state.category) query.set('category', state.category);
  if (state.q) query.set('q', state.q);
  if (state.sort) query.set('sort', state.sort);

  const url = new URLSearchParams();
  if (state.category) url.set('categoria', state.category);
  if (state.q) url.set('q', state.q);
  if (state.sort) url.set('orden', state.sort);
  history.replaceState(null, '', `${location.pathname}${url.size ? `?${url}` : ''}`);

  grid.setAttribute('aria-busy', 'true');
  try {
    const products = await api(`/products?${query}`);
    if (current !== requestId) return;
    count.textContent = `${products.length} ${products.length === 1 ? 'polo' : 'polos'}`;
    grid.innerHTML = products.length
      ? products.map(productCard).join('')
      : `<div class="empty" style="grid-column: 1 / -1">
           <h3>Sin resultados</h3>
           <p>No encontramos polos con esos filtros.</p>
           <button class="btn-ghost btn-sm" type="button" data-reset>Ver todos</button>
         </div>`;
  } catch (err) {
    grid.innerHTML = `<div class="empty" style="grid-column: 1 / -1"><h3>Ups</h3><p>${esc(err.message)}</p></div>`;
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

chips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  state.category = btn.dataset.cat;
  renderChips();
  load();
});

let debounce;
search.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state.q = search.value.trim();
    load();
  }, 250);
});

sort.addEventListener('change', () => {
  state.sort = sort.value;
  load();
});

grid.addEventListener('click', (e) => {
  if (!e.target.closest('[data-reset]')) return;
  Object.assign(state, { category: '', q: '', sort: '' });
  search.value = '';
  sort.value = '';
  renderChips();
  load();
});

renderChips();
load();
