const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const cfg = require('./config');
const auth = require('./lib/auth');
const store = require('./db');
const { money, whatsappLink } = require('./lib/format');
require('./lib/views');

// ---------- Revisión de la configuración ----------

const problems = [];
if (!cfg.ADMIN_PASSWORD || cfg.ADMIN_PASSWORD.length < 8) {
  problems.push('Falta definir ADMIN_PASSWORD (mínimo 8 caracteres).');
}
if (!auth.hasSecret) {
  problems.push('Falta definir SESSION_SECRET (una clave larga y aleatoria, mínimo 16 caracteres).');
}

const app = express();

app.disable('x-powered-by');
if (cfg.IS_PROD) app.set('trust proxy', 1); // detrás del proxy HTTPS de Vercel (u otro)

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Si falta configuración, la tienda avisa en vez de funcionar a medias.
app.use((req, res, next) => {
  if (!problems.length) return next();
  console.error('Configuración incompleta:\n - ' + problems.join('\n - '));
  res.status(500).type('text').send('La tienda no está configurada todavía. Revisa las variables de entorno del proyecto.');
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.public.blob.vercel-storage.com'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: cfg.IS_PROD ? [] : null
      }
    }
  })
);

app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use((req, res, next) => {
  req.body = req.body || {}; // Express 5 deja el cuerpo sin definir cuando no llega nada
  next();
});

// Bloquea formularios enviados desde otros sitios (protección CSRF básica).
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Los navegadores modernos indican si la petición nace en el mismo sitio.
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'none') return next();
    return res.status(403).send('Origen no permitido');
  }

  // Navegadores antiguos: se compara el origen con el host de la tienda.
  const source = req.get('origin') || req.get('referer');
  if (source) {
    const allowed = [req.get('host'), req.get('x-forwarded-host')];
    if (cfg.BASE_URL) {
      try {
        allowed.push(new URL(cfg.BASE_URL).host);
      } catch {
        /* BASE_URL inválida: se ignora */
      }
    }
    try {
      if (!allowed.includes(new URL(source).host)) return res.status(403).send('Origen no permitido');
    } catch {
      return res.status(403).send('Origen no permitido');
    }
  }
  next();
});

// CSS y JS: en Vercel los sirve su red de distribución desde public/; aquí solo se usan al trabajar en local.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: cfg.IS_PROD ? '1h' : 0 }));

// Fotos guardadas en disco: solo al trabajar en local (en Vercel van a Blob).
if (!cfg.USE_BLOB && !cfg.ON_VERCEL) {
  app.use('/uploads', express.static(cfg.UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
}

// Variables disponibles en todas las vistas.
app.use(async (req, res, next) => {
  const settings = await store.getSettings();
  res.locals.settings = settings;
  res.locals.money = money;
  res.locals.cfg = cfg;
  res.locals.waLink = (text) => whatsappLink(settings.whatsapp, text);
  res.locals.absoluteUrl = (p) => `${cfg.BASE_URL || `${req.protocol}://${req.get('host')}`}${p}`;
  res.locals.currentPath = req.path;

  // Mensajes de una sola vez ("Producto guardado", etc.).
  res.locals.flash = null;
  if (req.cookies.flash) {
    try {
      const f = JSON.parse(req.cookies.flash);
      if (f && typeof f.msg === 'string') {
        res.locals.flash = { type: f.type === 'error' ? 'error' : 'ok', msg: f.msg.slice(0, 200) };
      }
    } catch {
      /* cookie inválida: se ignora */
    }
    res.clearCookie('flash', { path: '/' });
  }
  res.flash = (type, msg) =>
    res.cookie('flash', JSON.stringify({ type, msg }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: 15000,
      path: '/'
    });

  next();
});

app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/public'));

app.use((req, res) => {
  res.status(404).render('404', { title: 'Página no encontrada' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // Si la falla fue al cargar los ajustes, la vista de error necesita valores por defecto.
  res.locals.settings = res.locals.settings || { store_name: 'Tienda', top_banner: '', whatsapp: '' };
  res.locals.money = res.locals.money || money;
  res.locals.cfg = res.locals.cfg || cfg;
  res.locals.waLink = res.locals.waLink || (() => whatsappLink(''));
  res.status(500).render('error', { title: 'Algo salió mal' });
});

module.exports = app;

// Al ejecutar "npm start" se abre un puerto; en Vercel solo se exporta la app.
if (require.main === module) {
  if (problems.length) {
    console.error('\n  ' + problems.join('\n  ') + '\n  Revisa tu archivo .env (mira .env.example).\n');
    process.exit(1);
  }
  app.listen(cfg.PORT, () => {
    console.log(`\n  Tienda lista en http://localhost:${cfg.PORT}`);
    console.log(`  Panel de administración: http://localhost:${cfg.PORT}/admin\n`);
  });
}
