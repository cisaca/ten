const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('../config');

const COOKIE = 'admin_session';
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

// En Vercel hay que definir SESSION_SECRET (no hay disco donde guardar uno).
// En tu computador, si no la defines, se genera una y se guarda en la carpeta de datos.
function loadSecret() {
  if (cfg.SESSION_SECRET) return cfg.SESSION_SECRET;
  if (cfg.ON_VERCEL) return '';
  const file = path.join(cfg.DATA_DIR, '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    try {
      fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
      const secret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(file, secret, { mode: 0o600 });
      return secret;
    } catch {
      return '';
    }
  }
}

const SECRET = loadSecret();
const hasSecret = SECRET.length >= 16;

// La firma incluye la contraseña: cambiarla cierra todas las sesiones abiertas.
function sign(value) {
  return crypto.createHmac('sha256', SECRET + cfg.ADMIN_PASSWORD).update(value).digest('hex');
}

function createToken() {
  const expires = String(Date.now() + TTL_MS);
  return `${expires}.${sign(expires)}`;
}

function validToken(token) {
  if (!hasSecret || typeof token !== 'string') return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(expires));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expires) > Date.now();
}

function checkPassword(input) {
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(hash(input), hash(cfg.ADMIN_PASSWORD));
}

function startSession(req, res) {
  res.cookie(COOKIE, createToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: TTL_MS,
    path: '/admin'
  });
}

function endSession(res) {
  res.clearCookie(COOKIE, { path: '/admin' });
}

function isLoggedIn(req) {
  return validToken(req.cookies?.[COOKIE]);
}

function requireAuth(req, res, next) {
  if (isLoggedIn(req)) return next();
  res.redirect('/admin/login');
}

module.exports = { hasSecret, checkPassword, startSession, endSession, requireAuth, isLoggedIn };
