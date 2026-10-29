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
      const os = require('node:os');
      const nets = os.networkInterfaces();
      const ips = [];
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
        }
      }
      console.log('\n======================================================');
      console.log('   TIENDA POLOLAB - FUNCIONAL Y LISTA');
      console.log('======================================================');
      console.log(`En esta computadora:`);
      console.log(`  -> Tienda: http://localhost:${PORT}`);
      console.log(`  -> Panel Admin: http://localhost:${PORT}/admin.html`);
      if (ips.length) {
        console.log(`\nEn celulares y otras laptops (conectadas al mismo Wi-Fi):`);
        for (const ip of ips) {
          console.log(`  -> Tienda: http://${ip}:${PORT}`);
          console.log(`  -> Panel Admin: http://${ip}:${PORT}/admin.html`);
        }
      }
      console.log('======================================================');
      console.log('Para usarla desde cualquier parte de internet (fuera de casa),');
      console.log('ejecuta "compartir-en-internet.bat" o publica en Render.');
      console.log('No cierres esta ventana mientras uses la tienda.\n');
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
