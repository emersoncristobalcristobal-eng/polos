// La base de datos usa node:sqlite, que viene incluido desde Node.js 22.13.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13) || (major === 23 && minor < 4)) {
  console.error(`\nNecesitas Node.js 22.13 o superior y tienes ${process.version}.`);
  console.error('Descarga la versión LTS desde https://nodejs.org, instálala y vuelve a intentarlo.\n');
  process.exit(1);
}

const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`\nTienda lista en http://localhost:${PORT}`);
  console.log(`Panel de administración: http://localhost:${PORT}/admin.html`);
  console.log('No cierres esta ventana mientras uses la tienda. Para detenerla presiona Ctrl + C.\n');
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\nEl puerto ${PORT} ya está en uso: probablemente la tienda ya está abierta en otra ventana.`);
  console.error(`Abre http://localhost:${PORT} o cierra la otra ventana y vuelve a intentarlo.\n`);
  process.exit(1);
});
