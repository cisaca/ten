# Tienda de electrónica

Tienda web simple, limpia y pensada para generar confianza. Tú publicas productos desde un panel privado y los clientes te compran escribiéndote por WhatsApp.

- **Tienda pública:** portada con búsqueda, categorías y filtros, ficha de producto con galería, página de envíos y devoluciones.
- **Panel de administración** (`/admin`): crear, editar y eliminar productos, subir fotos, marcar disponible / reservado / vendido y cambiar los textos de la tienda.
- **Compra por WhatsApp:** el botón abre un chat contigo con el producto y su enlace ya escritos.

Tecnología: Node.js + Express 5 y plantillas EJS. Preparada para el **plan gratuito de Vercel**: la base de datos es **Turso** (SQLite en la nube) y las fotos van a **Vercel Blob**. En tu computador funciona sin ninguno de los dos, con un archivo local. No hay carrito ni pasarela de pago.

## Probarla en tu computador

Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
cp .env.example .env     # en Windows: copy .env.example .env
```

Abre `.env` y completa:

- `ADMIN_PASSWORD`: tu contraseña para el panel (mínimo 8 caracteres).
- `SESSION_SECRET`: una clave larga y aleatoria. Genera una con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Luego:

```bash
npm start
```

- Tienda: <http://localhost:3000>
- Panel: <http://localhost:3000/admin>

Para ver la tienda con productos de ejemplo ejecuta `npm run seed` (después los borras desde el panel). En local, la base de datos y las fotos quedan en la carpeta `data/`.

## Publicarla en Vercel (plan gratuito)

1. **Sube el proyecto a GitHub** (repositorio privado). El archivo `.gitignore` ya deja fuera `.env`, `data/` y `node_modules/`.
2. **En Vercel**, crea un proyecto nuevo e importa ese repositorio. Vercel detecta Express solo.
3. **Base de datos:** en tu proyecto, pestaña **Storage**, agrega **Turso** desde el Marketplace y crea una base de datos. Se conecta al proyecto y define `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. Las tablas se crean solas la primera vez que entra alguien.
4. **Fotos:** en la misma pestaña, crea un almacén **Blob** de acceso **público** y conéctalo al proyecto. Define `BLOB_READ_WRITE_TOKEN`.
5. **Variables de entorno** (Settings → Environment Variables), las que no crea ninguna integración:

   | Variable | Qué poner |
   | --- | --- |
   | `ADMIN_PASSWORD` | Una contraseña larga y única para el panel |
   | `SESSION_SECRET` | Una clave aleatoria de 32 caracteres o más |
   | `BASE_URL` | La dirección de tu tienda, por ejemplo `https://mitienda.vercel.app` |

6. **Despliega de nuevo** (Deployments → Redeploy) para que el proyecto tome las variables de las integraciones.
7. Entra a `tu-dirección/admin`, ve a **Ajustes**, completa tu número de WhatsApp (con código de país, solo números, por ejemplo `56912345678`) y reemplaza los textos entre `[corchetes]` de «Envíos, pagos y devoluciones».

Si falta alguna variable obligatoria, la tienda muestra «no está configurada todavía» y el motivo exacto queda en los registros del despliegue (Logs).

### Cómo funcionan las fotos

Vercel no permite que una petición pese más de 4,5 MB y no tiene disco permanente. Por eso, **el navegador reduce cada foto antes de subirla** (a 1600 px, más una miniatura de 480 px) y la envía a Blob. De paso, al volver a dibujarla se pierden los metadatos del celular, como la **ubicación GPS**. El servidor también limpia los metadatos de cualquier JPG que reciba.

Para subir fotos hay que tener JavaScript activado en el navegador del panel.

### Límites del plan gratuito

- **Vercel Blob (Hobby):** 1 GB de almacenamiento, 10 GB de transferencia al mes y un tope de operaciones. Si lo superas, no se cobra nada, pero **Blob queda inaccesible hasta que pasen 30 días**, y las fotos dejarían de verse. Con fotos de ~200 KB y miniaturas de ~40 KB cabe bastante, pero conviene no subir cientos de fotos de más.
- **Turso:** el plan gratuito tiene sus propios límites de almacenamiento y lecturas; revísalos en tu cuenta.
- **Uso comercial:** Vercel ha reservado el plan Hobby para uso personal y no comercial. Una tienda probablemente cuente como comercial: revisa los [términos de Vercel](https://vercel.com/docs/limits/fair-use-guidelines) antes de lanzar.
- Las fotos que subes y luego no guardas en ningún producto (por ejemplo, si cierras la pestaña) quedan ocupando espacio. Si las quitas con el botón «Quitar», se borran.

## Primeros pasos en el panel

1. En **Ajustes**, completa tu nombre, el nombre de la tienda y tu número de WhatsApp. Sin esto, los botones de compra no te llegan a ti.
2. Crea tus productos con fotos reales. La primera foto es la principal.
3. Cuando vendas algo, cámbialo a **Vendido** en la lista en vez de borrarlo: los vendidos quedan al final y muestran que la tienda es real.

## Personalizar

| Qué | Dónde |
| --- | --- |
| Categorías, estados y cantidad de fotos | `config.js` |
| Colores | variables al inicio de `public/css/styles.css` |
| Moneda y formato de precios | `LOCALE` y `CURRENCY` en las variables de entorno |
| Textos de portada, «Quién vende», franja superior | panel → Ajustes |

## Respaldos

- **Producción:** tus datos están en Turso (productos y textos) y en Blob (fotos). Turso permite exportar la base de datos desde su panel o su herramienta de línea de comandos.
- **Local:** copia la carpeta `data/`.

## Seguridad incluida

- Contraseña de administrador en variable de entorno, sesión por cookie firmada y límite de intentos de acceso (guardado en la base de datos, así vale entre instancias).
- Protección contra formularios enviados desde otros sitios y política de seguridad de contenido estricta.
- Todo el texto escapado en las páginas y consultas SQL parametrizadas.
- Las fotos solo se aceptan como JPG válido, con tope de tamaño, y se les borran los metadatos.

## Estructura

```
server.js          app de Express (se exporta para Vercel; "npm start" la abre en un puerto)
config.js          categorías, estados, límites y variables de entorno
db.js              base de datos (Turso en Vercel, archivo local en tu computador)
lib/storage.js     fotos (Vercel Blob en producción, disco local en tu computador)
routes/            rutas públicas y del panel
views/             páginas (EJS)
public/            CSS y JavaScript (Vercel los sirve directamente)
scripts/seed.js    productos de ejemplo
```
