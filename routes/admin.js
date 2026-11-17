const express = require('express');

const cfg = require('../config');
const store = require('../db');
const auth = require('../lib/auth');
const storage = require('../lib/storage');

const router = express.Router();

// ---------- Utilidades ----------

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

function parseProduct(body) {
  const data = {
    title: clean(body.title, 120),
    category: clean(body.category, 40),
    item_condition: clean(body.item_condition, 40),
    status: clean(body.status, 20) || 'disponible',
    price: Number.parseInt(String(body.price ?? '').replace(/\D/g, ''), 10),
    note: clean(body.note, 120),
    description: clean(body.description, 3000),
    includes: clean(body.includes, 200),
    flaws: clean(body.flaws, 500)
  };

  const errors = [];
  if (!data.title) errors.push('Escribe el nombre del producto.');
  if (!cfg.CATEGORIES.includes(data.category)) errors.push('Elige una categoría.');
  if (!cfg.CONDITIONS.includes(data.item_condition)) errors.push('Elige el estado del producto (nuevo, usado…).');
  if (!(data.status in cfg.STATUSES)) errors.push('Elige una disponibilidad válida.');
  if (!Number.isInteger(data.price) || data.price < 0 || data.price > 1_000_000_000)
    errors.push('Ingresa un precio válido (solo números).');

  return { data, errors };
}

// Las fotos ya subidas llegan como "urlCompleta|urlMiniatura" (una por campo "foto").
function parsePhotos(body) {
  const photos = [];
  const errors = [];
  for (const item of [].concat(body.foto || []).slice(0, 20)) {
    const [url, thumb] = String(item).split('|');
    if (!storage.isOwnImageUrl(url) || (thumb && !storage.isOwnImageUrl(thumb))) {
      errors.push('Una de las fotos subidas no es válida. Quítala y vuelve a subirla.');
      break;
    }
    photos.push({ url, thumb_url: thumb || null });
  }
  return { photos, errors };
}

const formValues = (data) => ({ ...data, price: Number.isInteger(data.price) ? data.price : '' });

function productId(req) {
  const id = Number.parseInt(req.params.id, 10);
  return Number.isInteger(id) ? id : null;
}

function renderNotFound(res) {
  res.status(404).render('404', { title: 'No encontrado' });
}

// ---------- Subida de fotos (JSON; las usa la página del panel) ----------
// Van antes del control de acceso general para poder responder con JSON en vez de redirigir.

const jsonAuth = (req, res, next) =>
  auth.isLoggedIn(req) ? next() : res.status(401).json({ error: 'Tu sesión expiró. Vuelve a entrar al panel.' });

// El navegador envía cada foto ya reducida (JPG). Se limpian sus metadatos antes de guardarla.
router.post('/fotos', jsonAuth, express.raw({ type: 'image/jpeg', limit: '4mb' }), async (req, res) => {
  const variant = req.query.v === 'thumb' ? 'thumb' : 'full';
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'No se recibió la foto.' });
  }
  const jpeg = storage.stripJpegMetadata(req.body);
  if (!jpeg) return res.status(400).json({ error: 'La foto no es un JPG válido.' });

  try {
    res.json({ url: await storage.saveImage(jpeg, variant) });
  } catch (err) {
    if (err.code === 'STORAGE_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    console.error('Error al guardar una foto:', err);
    res.status(500).json({ error: 'No se pudo guardar la foto. Intenta de nuevo.' });
  }
});

// Quita una foto que se subió pero todavía no se guardó en ningún producto.
router.post('/fotos/quitar', jsonAuth, async (req, res) => {
  const urls = [req.body.url, req.body.thumb].filter((u) => storage.isOwnImageUrl(u));
  const free = [];
  for (const url of urls) if (!(await store.isImageUsed(url))) free.push(url);
  await storage.deleteImages(free);
  res.json({ ok: true });
});

router.use('/fotos', (err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La foto es demasiado grande.' });
  }
  next(err);
});

// ---------- Acceso ----------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

router.get('/login', (req, res) => {
  if (auth.isLoggedIn(req)) return res.redirect('/admin');
  res.render('admin/login', { title: 'Acceso', error: null });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || 'desconocida';
  if ((await store.failedLoginCount(ip, LOGIN_WINDOW_MS)) >= LOGIN_MAX_FAILS) {
    return res.status(429).render('admin/login', { title: 'Acceso', error: 'Demasiados intentos. Espera unos minutos.' });
  }
  if (auth.checkPassword(req.body.password || '')) {
    await store.clearFailedLogins(ip);
    auth.startSession(req, res);
    return res.redirect('/admin');
  }
  await store.recordFailedLogin(ip);
  res.status(401).render('admin/login', { title: 'Acceso', error: 'Contraseña incorrecta.' });
});

router.post('/logout', (req, res) => {
  auth.endSession(res);
  res.redirect('/admin/login');
});

// Todo lo que sigue requiere sesión iniciada.
router.use(auth.requireAuth);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------- Productos ----------

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  res.render('admin/products', {
    title: 'Productos',
    products: await store.listProducts({ q, admin: true }),
    q,
    missingWhatsapp: !res.locals.settings.whatsapp
  });
});

router.get('/productos/nuevo', (req, res) => {
  res.render('admin/product-form', {
    title: 'Nuevo producto',
    product: null,
    values: { status: 'disponible' },
    pending: [],
    errors: []
  });
});

router.post('/productos', async (req, res) => {
  const { data, errors } = parseProduct(req.body);
  const parsed = parsePhotos(req.body);
  errors.push(...parsed.errors);
  if (parsed.photos.length > cfg.MAX_IMAGES) errors.push(`Cada producto admite hasta ${cfg.MAX_IMAGES} fotos.`);

  if (errors.length) {
    return res.status(400).render('admin/product-form', {
      title: 'Nuevo producto',
      product: null,
      values: formValues(data),
      pending: parsed.photos,
      errors
    });
  }

  const id = await store.createProduct(data);
  await store.addImages(id, parsed.photos);
  res.flash('ok', 'Producto publicado.');
  res.redirect('/admin');
});

router.get('/productos/:id/editar', async (req, res) => {
  const id = productId(req);
  const product = id && (await store.getProduct(id));
  if (!product) return renderNotFound(res);
  res.render('admin/product-form', {
    title: 'Editar producto',
    product,
    values: product,
    pending: [],
    errors: []
  });
});

router.post('/productos/:id', async (req, res) => {
  const id = productId(req);
  const product = id && (await store.getProduct(id));
  if (!product) return renderNotFound(res);

  const { data, errors } = parseProduct(req.body);
  const parsed = parsePhotos(req.body);
  errors.push(...parsed.errors);
  if (product.images.length + parsed.photos.length > cfg.MAX_IMAGES)
    errors.push(`Cada producto admite hasta ${cfg.MAX_IMAGES} fotos.`);

  if (errors.length) {
    return res.status(400).render('admin/product-form', {
      title: 'Editar producto',
      product,
      values: formValues(data),
      pending: parsed.photos,
      errors
    });
  }

  await store.updateProduct(id, data);
  await store.addImages(id, parsed.photos);
  res.flash('ok', 'Cambios guardados.');
  res.redirect('/admin');
});

router.post('/productos/:id/estado', async (req, res) => {
  const id = productId(req);
  const status = String(req.body.status || '');
  if (!id || !(status in cfg.STATUSES) || !(await store.getProduct(id))) return renderNotFound(res);
  await store.setStatus(id, status);
  res.flash('ok', `Marcado como ${cfg.STATUSES[status].toLowerCase()}.`);
  res.redirect('/admin');
});

router.post('/productos/:id/eliminar', async (req, res) => {
  const id = productId(req);
  if (!id || !(await store.getProduct(id))) return renderNotFound(res);
  await storage.deleteImages(await store.deleteProduct(id));
  res.flash('ok', 'Producto eliminado.');
  res.redirect('/admin');
});

router.post('/productos/:id/fotos/:imageId/eliminar', async (req, res) => {
  const id = productId(req);
  const urls = id && (await store.removeImage(id, Number.parseInt(req.params.imageId, 10)));
  if (!urls) return renderNotFound(res);
  await storage.deleteImages(urls);
  res.flash('ok', 'Foto eliminada.');
  res.redirect(`/admin/productos/${id}/editar`);
});

router.post('/productos/:id/fotos/:imageId/portada', async (req, res) => {
  const id = productId(req);
  if (!id || !(await store.setCover(id, Number.parseInt(req.params.imageId, 10)))) return renderNotFound(res);
  res.flash('ok', 'Foto principal actualizada.');
  res.redirect(`/admin/productos/${id}/editar`);
});

// ---------- Ajustes de la tienda ----------

router.get('/ajustes', (req, res) => {
  res.render('admin/settings', { title: 'Ajustes', values: res.locals.settings, errors: [] });
});

router.post('/ajustes', async (req, res) => {
  const values = {
    store_name: clean(req.body.store_name, 60) || 'Tu Tienda',
    seller_name: clean(req.body.seller_name, 80),
    whatsapp: clean(req.body.whatsapp, 25).replace(/\D/g, ''),
    top_banner: clean(req.body.top_banner, 160),
    hero_title: clean(req.body.hero_title, 100),
    hero_text: clean(req.body.hero_text, 300),
    about_text: clean(req.body.about_text, 1200),
    shipping_policy: clean(req.body.shipping_policy, 4000)
  };

  const errors = [];
  if (values.whatsapp && (values.whatsapp.length < 8 || values.whatsapp.length > 15))
    errors.push('El número de WhatsApp debe incluir el código de país (por ejemplo 56912345678).');

  if (errors.length) {
    return res.status(400).render('admin/settings', { title: 'Ajustes', values, errors });
  }

  await store.saveSettings(values);
  res.flash('ok', 'Ajustes guardados.');
  res.redirect('/admin/ajustes');
});

module.exports = router;
