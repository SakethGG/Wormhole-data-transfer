'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const selfsigned = require('selfsigned');

// Each install has one long-lived self-signed certificate. Its SHA-256
// fingerprint is the device's identity; peers pin it during pairing.
function fingerprintOfPem(pem) {
  return new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
}

function loadOrCreate(dir) {
  const file = path.join(dir, 'identity.json');
  try {
    const id = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (id.cert && id.key) return { cert: id.cert, key: id.key, fp: fingerprintOfPem(id.cert) };
  } catch { /* create below */ }
  const pems = selfsigned.generate([{ name: 'commonName', value: 'wormhole' }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cert: pems.cert, key: pems.private }), { mode: 0o600 });
  return { cert: pems.cert, key: pems.private, fp: fingerprintOfPem(pems.cert) };
}

module.exports = { loadOrCreate };
