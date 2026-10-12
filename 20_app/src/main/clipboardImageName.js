const crypto = require('crypto');

function createClipboardImageName(extension, now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `clip-image_${stamp}_${crypto.randomBytes(6).toString('hex')}.${extension}`;
}

module.exports = { createClipboardImageName };
