# Publicar la tienda en internet (gratis)

Al terminar tendrás un enlace como `https://pololab.onrender.com` que cualquiera puede abrir desde su celular o computadora, sin `iniciar.bat`.

Se usan dos servicios gratuitos, y en los dos puedes entrar con tu cuenta de GitHub:

- **Turso** guarda los datos: productos, pedidos, clientes y fotos.
- **Render** mantiene la página encendida en internet.

Tiempo aproximado: 15 minutos.

---

## Paso 1 · Crear la base de datos en Turso

1. Entra a <https://turso.tech> y elige **Sign up** → **Continue with GitHub**.
2. En el panel, entra a **Databases** y pulsa **Create Database**.
   - **Name:** `pololab`
   - **Location / Region:** elige **AWS US East (Virginia)** u otra de Estados Unidos (es la más cercana a Perú y al servidor de Render).
3. Abre la base de datos que creaste y copia la **URL**. Empieza con `libsql://`, por ejemplo `libsql://pololab-tuusuario.turso.io`. Guárdala en un bloc de notas.
4. En esa misma página busca **Create Token** (o **Generate Token**), elige permiso de **lectura y escritura** (*Read & Write*) y sin fecha de expiración. Copia el token (un texto largo que empieza con `ey…`) y guárdalo también.

> El token es como una contraseña de tu base de datos: no lo publiques ni lo subas a GitHub.

## Paso 2 · Publicar la página en Render

1. Entra a <https://render.com> y elige **Get Started** → **GitHub**. Autoriza a Render a ver tu repositorio `Emerson-`.
2. En el panel pulsa **New +** → **Blueprint**.
3. Elige el repositorio `Emerson-` y la rama `claude/busy-davinci-8v96dg` (o la rama donde esté la tienda). Render encontrará el archivo `render.yaml`.
4. Render te pedirá cuatro valores. Escríbelos así:

   | Variable | Qué poner |
   |---|---|
   | `TURSO_DATABASE_URL` | La URL `libsql://…` del paso 1 |
   | `TURSO_AUTH_TOKEN` | El token del paso 1 |
   | `ADMIN_EMAIL` | El correo con el que entrarás al panel, por ejemplo `tucorreo@gmail.com` |
   | `ADMIN_PASSWORD` | Una contraseña segura **nueva** (mínimo 8 caracteres; no uses `admin123`) |

5. Pulsa **Apply** / **Deploy Blueprint** y espera 3 a 5 minutos. Cuando el estado diga **Live**, arriba aparece tu enlace `https://pololab….onrender.com`.

## Paso 3 · Probar

1. Abre tu enlace: verás la tienda con los polos de ejemplo.
2. Entra a `tu-enlace/login.html` con el `ADMIN_EMAIL` y la `ADMIN_PASSWORD` que pusiste. Llegarás al panel de administración.
3. Desde el panel edita o borra los polos de ejemplo, sube tus fotos y crea los tuyos.
4. Haz una compra de prueba con otra cuenta (regístrate como cliente) y revisa que aparezca en **Pedidos**.

En la versión publicada **no** existen las cuentas de prueba (`admin123`, `cliente123`) ni los pedidos de ejemplo; solo tu cuenta de administrador.

---

## Bueno saber

- **Primera visita lenta:** en el plan gratis, si nadie entra durante 15 minutos Render apaga la página. La siguiente visita tarda cerca de un minuto en cargar; después va rápida. Tus datos no se pierden porque están en Turso.
- **Actualizar la tienda:** cada vez que se suben cambios a la rama de GitHub, Render la vuelve a publicar sola.
- **Cambiar tu contraseña:** en el panel → **Mi perfil**. La variable `ADMIN_PASSWORD` solo se usa la primera vez que se crea la tienda.
- **Tu propio dominio** (por ejemplo `www.pololab.pe`): se compra aparte y se conecta en Render → tu servicio → **Settings** → **Custom Domains**.
- **Si algo falla:** en Render abre tu servicio → **Logs**. Si dice *"No se pudo abrir la base de datos"*, revisa que la URL y el token de Turso estén bien copiados (sin espacios al inicio o al final) en **Environment**.
