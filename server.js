const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Tienda lista en http://localhost:${PORT}`);
  console.log(`Panel de administración: http://localhost:${PORT}/admin.html`);
});
