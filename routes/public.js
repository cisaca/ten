const express = require('express');
const cfg = require('../config');
const store = require('../db');

const router = express.Router();

const pick = (value, allowed) => (allowed.includes(value) ? value : '');

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const category = pick(String(req.query.categoria || ''), cfg.CATEGORIES);
  const condition = pick(String(req.query.estado || ''), cfg.CONDITIONS);
  const sort = pick(String(req.query.orden || ''), ['menor', 'mayor']) || 'recientes';

  const products = await store.listProducts({ q, category, condition, sort });

  // Arma enlaces de filtro conservando la búsqueda actual.
  const filterUrl = (override = {}) => {
    const params = new URLSearchParams();
    const merged = { q, categoria: category, estado: condition, orden: sort === 'recientes' ? '' : sort, ...override };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return `/${qs ? '?' + qs : ''}#productos`;
  };

  res.render('index', {
    title: null,
    products,
    q,
    category,
    condition,
    sort,
    filterUrl,
    hasFilters: Boolean(q || category || condition)
  });
});

router.get('/producto/:id', async (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return next();
  const product = await store.getProduct(id);
  if (!product) return next();

  const text = `Hola, me interesa "${product.title}" (${res.locals.money(product.price)}). ${res.locals.absoluteUrl(
    '/producto/' + product.id
  )}`;

  res.render('product', {
    title: product.title,
    product,
    related: await store.getRelated(product),
    whatsappUrl: res.locals.waLink(text)
  });
});

router.get('/envios', (req, res) => {
  res.render('shipping', { title: 'Envíos, pagos y devoluciones' });
});

module.exports = router;
