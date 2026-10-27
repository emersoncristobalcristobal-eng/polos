import { api, getMe, mountChrome, poloSVG, qs, qsa, safeNext } from './core.js';

const form = qs('[data-auth-form]');
const mode = form.dataset.authForm;
const error = qs('[data-error]', form);
const next = new URLSearchParams(location.search).get('next');

mountChrome();
qs('[data-auth-polo]').innerHTML = poloSVG({
  color: mode === 'login' ? '#18181a' : '#a3111a',
  accent: mode === 'login' ? '#ff2a2a' : '#f4f4f4',
  design: mode === 'login' ? 'lineas' : 'franja',
});

// Si ya hay sesión, no tiene sentido mostrar el formulario.
const current = await getMe();
if (current) location.replace(safeNext(next, current.role === 'admin' ? '/admin.html' : '/cuenta.html'));

// Mantener el destino al cambiar entre "ingresar" y "crear cuenta".
if (next) {
  qsa('[data-keep-next]').forEach((a) => {
    a.href = `${a.getAttribute('href')}?next=${encodeURIComponent(next)}`;
  });
}

qsa('[data-demo]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const demo = {
      admin: ['admin@pololab.pe', 'admin123'],
      cliente: ['cliente@pololab.pe', 'cliente123'],
    }[btn.dataset.demo];
    form.elements.email.value = demo[0];
    form.elements.password.value = demo[1];
    form.requestSubmit();
  }),
);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  if (!data.email || !data.password || (mode === 'register' && !data.name)) {
    error.textContent = 'Completa todos los campos obligatorios.';
    return;
  }
  const button = qs('button[type="submit"]', form);
  button.disabled = true;
  try {
    const { user } = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body: data });
    location.href = safeNext(next, user.role === 'admin' ? '/admin.html' : '/tienda.html');
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});
