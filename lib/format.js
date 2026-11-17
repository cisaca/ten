const cfg = require('../config');

const formatter = new Intl.NumberFormat(cfg.LOCALE, {
  style: 'currency',
  currency: cfg.CURRENCY,
  maximumFractionDigits: cfg.CURRENCY === 'CLP' ? 0 : 2
});

function money(amount) {
  return formatter.format(Number(amount) || 0);
}

// Arma un enlace de WhatsApp con mensaje prellenado. El número debe ir solo con dígitos y código de país.
function whatsappLink(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

module.exports = { money, whatsappLink };
