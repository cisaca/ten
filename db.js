const fs = require('fs');
const path = require('path');
const cfg = require('./config');

// ---------- Conexión ----------
// En Vercel: Turso (SQLite en la nube) por HTTPS. En tu computador: un archivo local.

let client;
if (cfg.DATABASE_URL) {
  const { createClient } = require('@libsql/client/web');
  client = createClient({
    url: cfg.DATABASE_URL.replace(/^libsql:/, 'https:'),
    authToken: cfg.DATABASE_TOKEN || undefined
  });
} else {
  if (cfg.ON_VERCEL) {
    // Sin base de datos configurada, en Vercel todo se perdería: mejor fallar con un aviso claro.
    throw new Error('Falta la base de datos: instala Turso desde el Marketplace de Vercel (TURSO_DATABASE_URL).');
  }
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  const { createClient } = require('@libsql/client');
  client = createClient({ url: 'file:' + path.join(cfg.DATA_DIR, 'tienda.db') });
}

const toObjects = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c) => [c, row[c]])));

// ---------- Esquema ----------

const DEFAULT_SETTINGS = {
  store_name: 'Tu Tienda',
  whatsapp: '',
  seller_name: '',
  top_banner: 'Envíos y retiro en persona · Atención directa por WhatsApp',
  hero_title: 'Electrónica revisada y lista para usar',
  hero_text:
    'Cada producto tiene fotos reales, estado detallado y un precio claro. Me escribes por WhatsApp y coordinamos todo.',
  about_text:
    'Vendo electrónica que reviso personalmente antes de publicarla. Cada producto lleva fotos reales y te cuento su estado con honestidad. Si tienes dudas, escríbeme y las resolvemos.',
  shipping_policy:
    'Envíos: [explica cómo y a dónde envías, y quién paga el envío].\n\nRetiro en persona: [indica dónde y en qué horarios].\n\nPagos: se coordinan directamente por WhatsApp. [Indica qué formas de pago aceptas].\n\nDevoluciones: [explica tu política de devoluciones o garantía].'
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    category       TEXT    NOT NULL,
    item_condition TEXT    NOT NULL,
    price          INTEGER NOT NULL CHECK (price >= 0),
    status         TEXT    NOT NULL DEFAULT 'disponible',
    note           TEXT    NOT NULL DEFAULT '',
    description    TEXT    NOT NULL DEFAULT '',
    includes       TEXT    NOT NULL DEFAULT '',
    flaws          TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS product_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url        TEXT    NOT NULL,
    thumb_url  TEXT,
    position   INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT    NOT NULL,
    ts INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id, position)',
  'CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_ip ON login_attempts(ip, ts)',
  ...Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
    sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    args: [key, value]
  }))
];

// Bases creadas con la versión anterior (fotos guardadas como "filename"): se adaptan solas.
async function migrate() {
  try {
    const info = toObjects(await client.execute('PRAGMA table_info(product_images)'));
    const names = info.map((c) => c.name);
    if (names.includes('filename') && !names.includes('url')) {
      await client.execute('ALTER TABLE product_images RENAME COLUMN filename TO url');
      await client.execute(
        "UPDATE product_images SET url = '/uploads/' || url WHERE url NOT LIKE '/%' AND url NOT LIKE 'http%'"
      );
    }
    if (!names.includes('thumb_url')) {
      await client.execute('ALTER TABLE product_images ADD COLUMN thumb_url TEXT');
    }
  } catch (err) {
    console.error('Aviso: no se pudo revisar el esquema de fotos:', err.message);
  }
}

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = client
      .batch(SCHEMA, 'write')
      .then(migrate)
      .catch((err) => {
        readyPromise = null; // se reintenta en la próxima petición
        throw err;
      });
  }
  return readyPromise;
}

// ---------- Ajustes de la tienda ----------

const SETTINGS_TTL_MS = 15000; // evita consultar la base en cada visita
let settingsCache = null;
let settingsCachedAt = 0;

async function getSettings() {
  if (settingsCache && Date.now() - settingsCachedAt < SETTINGS_TTL_MS) return settingsCache;
  await ready();
  const rows = toObjects(await client.execute('SELECT key, value FROM settings'));
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  settingsCache = out;
  settingsCachedAt = Date.now();
  return out;
}

async function saveSettings(values) {
  await ready();
  const statements = Object.keys(DEFAULT_SETTINGS)
    .filter((key) => key in values)
    .map((key) => ({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [key, String(values[key])]
    }));
  if (statements.length) await client.batch(statements, 'write');
  settingsCache = null;
}

// ---------- Productos ----------

const COVER_SQL = `
  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS cover,
  (SELECT COALESCE(i.thumb_url, i.url) FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS cover_thumb`;

async function listProducts({ q = '', category = '', condition = '', sort = 'recientes', admin = false } = {}) {
  await ready();
  const where = [];
  const args = [];

  if (q) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR p.note LIKE ? ESCAPE '\\')");
    const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    args.push(like, like, like);
  }
  if (category) {
    where.push('p.category = ?');
    args.push(category);
  }
  if (condition) {
    where.push('p.item_condition = ?');
    args.push(condition);
  }

  const order = { menor: 'p.price ASC', mayor: 'p.price DESC', recientes: 'p.id DESC' }[sort] || 'p.id DESC';
  // En la tienda, los vendidos van al final (siguen visibles para dar confianza).
  const soldLast = admin ? '' : "CASE p.status WHEN 'vendido' THEN 1 ELSE 0 END, ";

  const sql = `SELECT p.*, ${COVER_SQL} FROM products p
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${soldLast}${order}`;
  return toObjects(await client.execute({ sql, args }));
}

async function getProduct(id) {
  await ready();
  const [productRs, imagesRs] = await client.batch(
    [
      { sql: `SELECT p.*, ${COVER_SQL} FROM products p WHERE p.id = ?`, args: [id] },
      {
        sql: 'SELECT id, url, thumb_url, position FROM product_images WHERE product_id = ? ORDER BY position, id',
        args: [id]
      }
    ],
    'read'
  );
  const product = toObjects(productRs)[0];
  if (!product) return null;
  product.images = toObjects(imagesRs);
  return product;
}

async function getRelated(product, limit = 4) {
  await ready();
  const rs = await client.execute({
    sql: `SELECT p.*, ${COVER_SQL} FROM products p
          WHERE p.id != ? AND p.status != 'vendido'
          ORDER BY (p.category = ?) DESC, p.id DESC LIMIT ?`,
    args: [product.id, product.category, limit]
  });
  return toObjects(rs);
}

const FIELDS = ['title', 'category', 'item_condition', 'price', 'status', 'note', 'description', 'includes', 'flaws'];

async function createProduct(data) {
  await ready();
  const rs = await client.execute({
    sql: `INSERT INTO products (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`,
    args: FIELDS.map((f) => data[f])
  });
  return Number(rs.lastInsertRowid);
}

async function updateProduct(id, data) {
  await ready();
  await client.execute({
    sql: `UPDATE products SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    args: [...FIELDS.map((f) => data[f]), id]
  });
}

async function setStatus(id, status) {
  await ready();
  await client.execute({
    sql: "UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?",
    args: [status, id]
  });
}

// Devuelve las URLs de las fotos para que se borren del almacenamiento.
async function deleteProduct(id) {
  await ready();
  const images = toObjects(
    await client.execute({ sql: 'SELECT url, thumb_url FROM product_images WHERE product_id = ?', args: [id] })
  );
  await client.batch(
    [
      { sql: 'DELETE FROM product_images WHERE product_id = ?', args: [id] },
      { sql: 'DELETE FROM products WHERE id = ?', args: [id] }
    ],
    'write'
  );
  return images.flatMap((i) => [i.url, i.thumb_url]).filter(Boolean);
}

// photos: [{ url, thumb_url }]
async function addImages(productId, photos) {
  if (!photos.length) return;
  await ready();
  await client.batch(
    photos.map((p) => ({
      sql: `INSERT INTO product_images (product_id, url, thumb_url, position)
            VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM product_images WHERE product_id = ?))`,
      args: [productId, p.url, p.thumb_url || null, productId]
    })),
    'write'
  );
}

// Devuelve las URLs de la foto eliminada (o null si no existe).
async function removeImage(productId, imageId) {
  await ready();
  const row = toObjects(
    await client.execute({
      sql: 'SELECT url, thumb_url FROM product_images WHERE id = ? AND product_id = ?',
      args: [imageId, productId]
    })
  )[0];
  if (!row) return null;
  await client.execute({ sql: 'DELETE FROM product_images WHERE id = ?', args: [imageId] });
  return [row.url, row.thumb_url].filter(Boolean);
}

async function setCover(productId, imageId) {
  await ready();
  const images = toObjects(
    await client.execute({
      sql: 'SELECT id FROM product_images WHERE product_id = ? ORDER BY position, id',
      args: [productId]
    })
  );
  if (!images.some((i) => i.id === imageId)) return false;
  const ordered = [imageId, ...images.map((i) => i.id).filter((id) => id !== imageId)];
  await client.batch(
    ordered.map((id, position) => ({ sql: 'UPDATE product_images SET position = ? WHERE id = ?', args: [position, id] })),
    'write'
  );
  return true;
}

async function isImageUsed(url) {
  await ready();
  const rs = await client.execute({
    sql: 'SELECT 1 FROM product_images WHERE url = ? OR thumb_url = ? LIMIT 1',
    args: [url, url]
  });
  return rs.rows.length > 0;
}

async function countProducts() {
  await ready();
  const rs = await client.execute('SELECT COUNT(*) AS n FROM products');
  return Number(rs.rows[0].n);
}

// ---------- Límite de intentos de acceso (guardado en la base: sirve entre instancias de Vercel) ----------

async function failedLoginCount(ip, windowMs) {
  await ready();
  const rs = await client.execute({
    sql: 'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?',
    args: [ip, Date.now() - windowMs]
  });
  return Number(rs.rows[0].n);
}

async function recordFailedLogin(ip) {
  await ready();
  await client.batch(
    [
      { sql: 'DELETE FROM login_attempts WHERE ts < ?', args: [Date.now() - 24 * 60 * 60 * 1000] },
      { sql: 'INSERT INTO login_attempts (ip, ts) VALUES (?, ?)', args: [ip, Date.now()] }
    ],
    'write'
  );
}

async function clearFailedLogins(ip) {
  await ready();
  await client.execute({ sql: 'DELETE FROM login_attempts WHERE ip = ?', args: [ip] });
}

module.exports = {
  ready,
  getSettings,
  saveSettings,
  listProducts,
  getProduct,
  getRelated,
  createProduct,
  updateProduct,
  setStatus,
  deleteProduct,
  addImages,
  removeImage,
  setCover,
  isImageUsed,
  countProducts,
  failedLoginCount,
  recordFailedLogin,
  clearFailedLogins
};
