const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config');

// Guarda las fotos en Vercel Blob (producción) o en disco local (solo para trabajar en tu computador).

const LOCAL_URL = /^\/uploads\/[a-z0-9._-]+\.jpg$/i;

class StorageNotConfigured extends Error {
  constructor() {
    super('Falta el almacenamiento de fotos: crea un almacén Blob en tu proyecto de Vercel (pestaña Storage).');
    this.code = 'STORAGE_NOT_CONFIGURED';
  }
}

function isBlobUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com') && u.pathname.startsWith('/productos/');
  } catch {
    return false;
  }
}

// Solo se aceptan URLs que esta tienda pudo haber generado.
function isOwnImageUrl(value) {
  return typeof value === 'string' && value.length < 600 && (LOCAL_URL.test(value) || isBlobUrl(value));
}

async function saveImage(buffer, variant) {
  const suffix = variant === 'thumb' ? '-m' : '';
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${suffix}.jpg`;

  if (cfg.USE_BLOB) {
    const { put } = require('@vercel/blob');
    const result = await put(`productos/${name}`, buffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: true,
      cacheControlMaxAge: 60 * 60 * 24 * 365
    });
    return result.url;
  }

  if (cfg.ON_VERCEL) throw new StorageNotConfigured();

  fs.mkdirSync(cfg.UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(cfg.UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

// Borra fotos (mejor esfuerzo: si falla, no interrumpe lo que estabas haciendo).
async function deleteImages(urls) {
  const own = [...new Set(urls.filter(isOwnImageUrl))];
  if (!own.length) return;
  try {
    const blobUrls = own.filter(isBlobUrl);
    if (blobUrls.length && cfg.USE_BLOB) {
      const { del } = require('@vercel/blob');
      await del(blobUrls);
    }
    for (const url of own.filter((u) => LOCAL_URL.test(u))) {
      fs.unlink(path.join(cfg.UPLOAD_DIR, path.basename(url)), () => {});
    }
  } catch (err) {
    console.error('No se pudieron borrar algunas fotos:', err.message);
  }
}

// Quita los metadatos de un JPG (ubicación GPS, cámara, fecha) sin tocar la imagen.
// Devuelve null si el archivo no es un JPG válido.
function stripJpegMetadata(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    while (buf[i + 1] === 0xff) i++; // bytes de relleno
    const marker = buf[i + 1];
    if (marker === undefined) return null;

    if (marker === 0xd9) {
      parts.push(buf.subarray(i, i + 2));
      return Buffer.concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }

    if (i + 4 > buf.length) return null;
    const length = buf.readUInt16BE(i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > buf.length) return null;

    if (marker === 0xda) {
      // Inicio de los datos de imagen: el resto se copia tal cual.
      parts.push(buf.subarray(i));
      return Buffer.concat(parts);
    }

    // APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) y comentarios se descartan.
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(buf.subarray(i, end));
    i = end;
  }
  return null;
}

module.exports = { saveImage, deleteImages, isOwnImageUrl, stripJpegMetadata, StorageNotConfigured };
