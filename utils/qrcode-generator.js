const QRCode = require('qrcode');

async function generateDataURL(text) {
  return QRCode.toDataURL(text);
}

module.exports = { generateDataURL };