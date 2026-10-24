'use strict';

const crypto = require('crypto');
const Config = require('../core/config');

const TOTP_STEP = 30;
const TOTP_DIGITS = 6;
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function hkdf(purposeInfo) {
  if (!Config.SECRET_KEY) throw new Error('Application key missing for HKDF.');
  return crypto.hkdfSync('sha256', Config.SECRET_KEY, '', purposeInfo, 32);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

const Security = {
  async generatePasswordHash(password, iterations = 600000) {
    password = String(password);
    if (Buffer.byteLength(password) > 1024) throw new Error('Password must be at most 1024 bytes.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await new Promise((resolve, reject) => crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (err, key) => err ? reject(err) : resolve(key)));
    return `pbkdf2:sha256:${iterations}$${salt}$${hash.toString('hex')}`;
  },

  async checkPasswordHash(stored, password) {
    stored = String(stored || ''); password = String(password || '');
    if (!stored || Buffer.byteLength(password) > 1024) return false;
    if (stored.startsWith('pbkdf2:')) {
      const parts = stored.split('$');
      if (parts.length !== 3) return false;
      const [method, salt, hash] = parts;
      const [, algo, rounds] = method.split(':');
      const iterations = Number(rounds || 600000);
      if (!['sha256', 'sha512'].includes(algo) || !Number.isInteger(iterations) || iterations < 1 || iterations > 2000000 || !/^[a-f0-9]{64}$/i.test(hash)) return false;
      try {
        const result = await new Promise((resolve, reject) => crypto.pbkdf2(password, salt, iterations, 32, algo, (err, key) => err ? reject(err) : resolve(key)));
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), result);
      } catch { return false; }
    }
    if (/^\$2[ayb]\$/.test(stored)) {
      try { return await require('bcryptjs').compare(password, stored.replace(/^\$2y\$/, '$2a$')); } catch { return false; }
    }
    return false;
  },

  dumpsToken(email, salt = 'password-reset-salt') {
    const payload = JSON.stringify({ e: email, t: Math.floor(Date.now() / 1000) });
    const b64 = b64url(Buffer.from(payload, 'utf8'));
    const sig = this._sign(b64, salt);
    return b64 + '.' + sig;
  },

  loadsToken(token, salt = 'password-reset-salt', maxAge = 3600) {
    const parts = String(token).split('.');
    if (parts.length !== 2) return null;
    const [b64, sig] = parts;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(this._sign(b64, salt), 'utf8'), Buffer.from(sig, 'utf8'))) return null;
    } catch {
      return null;
    }
    let payload;
    try {
      payload = JSON.parse(b64urlDecode(b64).toString('utf8'));
    } catch {
      return null;
    }
    if (!payload || typeof payload !== 'object' || payload.e == null || payload.t == null) return null;
    if (Math.floor(Date.now() / 1000) - Number(payload.t) > maxAge) return null;
    return String(payload.e);
  },

  _sign(data, salt) {
    const key = crypto.createHmac('sha256', Config.SECRET_KEY).update(salt).digest();
    return b64url(crypto.createHmac('sha256', key).update(data).digest());
  },

  totpEncryptionAvailable() {
    return true;
  },

  totpSecretIsEncrypted(stored) {
    return stored.startsWith('gcm1:') || stored.startsWith('sbox1:');
  },

  encryptTotpSecret(secret) {
    if (!secret) throw new Error('TOTP secret cannot be empty.');
    const nonce = crypto.randomBytes(12);
    const key = hkdf('CineAmit/TOTP-GCM-v1');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('cineamit-totp-v1'));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'gcm1:' + Buffer.concat([nonce, tag, ciphertext]).toString('base64');
  },

  decryptTotpSecret(stored) {
    if (!stored) return null;
    if (stored.startsWith('gcm1:')) {
      const payload = Buffer.from(stored.slice(5), 'base64');
      if (payload.length <= 28) return null;
      const nonce = payload.subarray(0, 12);
      const tag = payload.subarray(12, 28);
      const ciphertext = payload.subarray(28);
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', hkdf('CineAmit/TOTP-GCM-v1'), nonce);
        decipher.setAAD(Buffer.from('cineamit-totp-v1'));
        decipher.setAuthTag(tag);
        const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        return secret || null;
      } catch {
        return null;
      }
    }
    if (stored.startsWith('sbox1:')) return null;
    return stored;
  },

  xtreamEncryptionAvailable() {
    return true;
  },

  xtreamCredentialIsEncrypted(stored) {
    return stored.startsWith('xgcm1:') || stored.startsWith('xsbox1:');
  },

  _xtreamKey(kind, mode) {
    if (!['username', 'password'].includes(kind)) throw new Error('Invalid Xtream credential type.');
    return hkdf('CineAmit/Xtream-' + kind + '-' + mode + '-v1');
  },

  encryptXtreamCredential(secret, kind) {
    if (secret === '') return '';
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._xtreamKey(kind, 'GCM'), nonce);
    cipher.setAAD(Buffer.from('cineamit-xtream-' + kind + '-v1'));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'xgcm1:' + Buffer.concat([nonce, tag, ciphertext]).toString('base64');
  },

  decryptXtreamCredential(stored, kind) {
    if (stored === '') return '';
    if (stored.startsWith('xgcm1:')) {
      const payload = Buffer.from(stored.slice(6), 'base64');
      if (payload.length <= 28) return null;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', this._xtreamKey(kind, 'GCM'), payload.subarray(0, 12));
        decipher.setAAD(Buffer.from('cineamit-xtream-' + kind + '-v1'));
        decipher.setAuthTag(payload.subarray(12, 28));
        return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    }
    if (stored.startsWith('xsbox1:')) return null;
    return stored;
  },

  _opaqueKey(purpose, mode) {
    if (!/^[a-z0-9_-]{1,40}$/.test(purpose)) throw new Error('Invalid opaque-token purpose.');
    return hkdf('CineAmit/Opaque-' + purpose + '-' + mode + '-v1');
  },

  encryptOpaqueToken(purpose, plaintext) {
    if (!plaintext) throw new Error('Opaque-token payload cannot be empty.');
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._opaqueKey(purpose, 'GCM'), nonce);
    cipher.setAAD(Buffer.from('cineamit-opaque-' + purpose + '-v1'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'g1_' + b64url(Buffer.concat([nonce, tag, ciphertext]));
  },

  decryptOpaqueToken(purpose, token) {
    const prefix = token.slice(0, 3);
    if (!['g1_', 's1_'].includes(prefix) || token.length > 12000) return null;
    let payload;
    try {
      payload = b64urlDecode(token.slice(3));
    } catch {
      return null;
    }
    if (prefix === 'g1_') {
      if (payload.length <= 28) return null;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', this._opaqueKey(purpose, 'GCM'), payload.subarray(0, 12));
        decipher.setAAD(Buffer.from('cineamit-opaque-' + purpose + '-v1'));
        decipher.setAuthTag(payload.subarray(12, 28));
        const plain = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
        return plain || null;
      } catch {
        return null;
      }
    }
    return null;
  },

  totpNewSecret() {
    return this.base32Encode(crypto.randomBytes(20));
  },

  base32Encode(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let bits = 0;
    let value = 0;
    let out = '';
    for (let i = 0; i < buf.length; i++) {
      value = (value << 8) | buf[i];
      bits += 8;
      while (bits >= 5) {
        out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
  },

  base32Decode(b32) {
    const clean = String(b32).toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (let i = 0; i < clean.length; i++) {
      const idx = B32_ALPHABET.indexOf(clean[i]);
      if (idx < 0) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return Buffer.from(out);
  },

  totpCode(secret, counter) {
    const key = this.base32Decode(secret);
    if (!key.length) return '';
    if (counter == null) counter = Math.floor(Date.now() / 1000 / TOTP_STEP);
    const bin = Buffer.alloc(8);
    bin.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    bin.writeUInt32BE(counter >>> 0, 4);
    const hash = crypto.createHmac('sha1', key).update(bin).digest();
    const offset = hash[hash.length - 1] & 0x0f;
    const value = ((hash[offset] & 0x7f) << 24)
      | (hash[offset + 1] << 16)
      | (hash[offset + 2] << 8)
      | hash[offset + 3];
    return String(value % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
  },

  totpVerify(secret, code, window = 1) {
    code = String(code).replace(/\D/g, '');
    if (!secret || code.length !== TOTP_DIGITS) return false;
    const now = Math.floor(Date.now() / 1000 / TOTP_STEP);
    for (let i = -window; i <= window; i++) {
      const expected = this.totpCode(secret, now + i);
      try {
        if (crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(code, 'utf8'))) return true;
      } catch { /* length mismatch */ }
    }
    return false;
  },

  totpUri(secret, accountName, issuer = 'CineAmit') {
    return 'otpauth://totp/' + encodeURIComponent(issuer + ':' + accountName)
      + '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer)
      + '&algorithm=SHA1&digits=6&period=30';
  },

  sanitizeRichHtml(html) {
    return require('sanitize-html')(String(html || ''), {
      allowedTags: ['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'],
      allowedAttributes: {a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'], '*': ['class']},
      allowedSchemes: ['http', 'https', 'mailto'],
      allowProtocolRelative: false,
      transformTags: {a: require('sanitize-html').simpleTransform('a', {rel: 'noopener noreferrer'})},
    });
  },

  stripAllHtml(html) {
    let s = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
    s = s.replace(/<[^>]+>/g, '');
    s = decodeHtmlEntities(s);
    return s.replace(/\s+/g, ' ').trim();
  },

  contentCleanHtml(raw) {
    if (!raw) return '';
    let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/gs, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/gs, '<em>$1</em>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (m, label, url) =>
      '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>');
    if (!/<\s*(?:p|div|h[1-6]|ul|ol|li|table|blockquote|pre|section|article)\b/i.test(s)) {
      const paras = s.trim().split(/\n{2,}/);
      s = paras.map((p) => '<p>' + p.trim().replace(/\n/g, '<br>') + '</p>').join('\n');
    }
    return this.sanitizeRichHtml(s);
  },

  markdownToPlain(raw, maxLen = 300) {
    if (!raw) return '';
    let s = this.stripAllHtml(raw);
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    s = s.replace(/[#*_`~>]+/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    if (maxLen > 0 && [...s].length > maxLen) {
      s = [...s].slice(0, maxLen).join('').replace(/\s+$/, '') + '…';
    }
    return s;
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

Security.escapeHtml = escapeHtml;
Security.decodeHtmlEntities = decodeHtmlEntities;

module.exports = Security;
