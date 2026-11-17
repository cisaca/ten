const fs = require('fs');
const path = require('path');

// Carga simple de un archivo .env (sin dependencias extra). En Vercel no existe: se usan sus variables.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
}

const ON_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PROD: process.env.NODE_ENV === 'production' || ON_VERCEL,
  ON_VERCEL,
  BASE_URL: (process.env.BASE_URL || '').replace(/\/+$/, ''),

  // Base de datos: en Vercel se usa Turso (la integración define estas variables).
  // Si no existen, se usa un archivo local dentro de DATA_DIR (solo para trabajar en tu computador).
  DATABASE_URL: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || '',
  DATABASE_TOKEN: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_TOKEN || '',
  DATA_DIR,

  // Fotos: en Vercel se guardan en Vercel Blob (BLOB_READ_WRITE_TOKEN).
  // Sin ese token, y solo fuera de Vercel, se guardan en disco local.
  USE_BLOB: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),

  // Acceso al panel de administración.
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  SESSION_SECRET: process.env.SESSION_SECRET || '',

  // Formato de precios.
  LOCALE: process.env.LOCALE || 'es-CL',
  CURRENCY: process.env.CURRENCY || 'CLP',

  // Edita estas listas para adaptar la tienda a lo que vendes.
  CATEGORIES: ['Celulares', 'Audio', 'Computación', 'Consolas', 'Accesorios', 'Otros'],
  CONDITIONS: ['Nuevo', 'Usado', 'Reacondicionado'],
  STATUSES: { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' },

  // Fotos: el navegador las reduce antes de subirlas (foto completa + miniatura).
  MAX_IMAGES: 8,
  IMAGE_MAX_SIDE: 1600,
  THUMB_MAX_SIDE: 480
};
