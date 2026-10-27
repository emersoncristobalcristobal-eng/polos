const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`\nNecesitas Node.js 20 o superior y tienes ${process.version}.`);
  console.error('Descarga la versión LTS desde https://nodejs.org, instálala y vuelve a intentarlo.\n');
  process.exit(1);
}

const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;

createApp()
  .then((app) => {
    const server = app.listen(PORT, () => {
      if (process.env.TURSO_DATABASE_URL) {
        console.log(`Tienda en línea escuchando en el puerto ${PORT} (base de datos: Turso).`);
        return;
      }
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
  })
  .catch((err) => {
    console.error('\nNo se pudo abrir la base de datos de la tienda.');
    if (process.env.TURSO_DATABASE_URL) {
      console.error('Revisa que TURSO_DATABASE_URL y TURSO_AUTH_TOKEN estén bien copiados.');
    }
    console.error(err.message, '\n');
    process.exit(1);
  });
