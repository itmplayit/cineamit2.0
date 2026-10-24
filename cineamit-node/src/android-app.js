'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('./db');
const Economy = require('./services/economy');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'app');
const APK_FILE = path.join(DIR, 'cineamit.apk');
const MAX_BYTES = 90 * 1024 * 1024;
const DEFAULT_VERSION = '1.0.74';

const KEYS = {
  enabled: 'APP_DOWNLOAD_ENABLED',
  version: 'APP_APK_VERSION',
  notes: 'APP_APK_NOTES',
  url: 'APP_APK_URL',
  sha: 'APP_APK_SHA256',
  force: 'APP_APK_FORCE',
};

let shaMem = { mtimeMs: 0, hex: '' };

function onOff(v, def = true) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return def;
  return !(s === '0' || s === 'false' || s === 'off' || s === 'no');
}

function formatSize(n) {
  const x = Number(n) || 0;
  if (x <= 0) return '';
  if (x < 1024 * 1024) return Math.max(1, Math.round(x / 1024)) + ' KB';
  return (x / (1024 * 1024)).toFixed(1) + ' MB';
}

function sanitizeExtUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('/app/')) return s.slice(0, 200);
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.username || u.password) return '';
    return u.toString().slice(0, 500);
  } catch {
    return '';
  }
}

async function getSetting(key, def = '') {
  try {
    const row = await Database.fetchOne(
      'SELECT setting_value FROM site_setting WHERE setting_key = ?',
      [key]
    );
    if (row && row.setting_value != null && String(row.setting_value).trim() !== '') {
      return String(row.setting_value);
    }
  } catch { /* first boot */ }
  return def;
}

function fileStat() {
  try {
    const st = fs.statSync(APK_FILE);
    if (st.isFile() && st.size > 100) return st;
  } catch {}
  return null;
}

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

async function shaOfFile(mtimeMs) {
  if (shaMem.hex && shaMem.mtimeMs === mtimeMs) return shaMem.hex;
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(APK_FILE);
    rs.on('data', (d) => hash.update(d));
    rs.on('end', () => {
      shaMem = { mtimeMs, hex: hash.digest('hex') };
      resolve(shaMem.hex);
    });
    rs.on('error', () => resolve(''));
  });
}

async function publicMeta() {
  const enabled = onOff(await getSetting(KEYS.enabled, '1'), true);
  const force = onOff(await getSetting(KEYS.force, '0'), false);
  const version = String(await getSetting(KEYS.version, DEFAULT_VERSION)).trim().slice(0, 32) || DEFAULT_VERSION;
  const notes = String(await getSetting(KEYS.notes, '')).slice(0, 2000);
  const ext = sanitizeExtUrl(await getSetting(KEYS.url, ''));
  const st = fileStat();
  const hasFile = !!st;
  let sha256 = '';
  if (hasFile) sha256 = await shaOfFile(st.mtimeMs);
  const downloadUrl = hasFile ? '/app/cineamit.apk' : ext;
  const installable=!!(enabled && hasFile && /^[a-f0-9]{64}$/.test(sha256));
  return {
    enabled,
    force: force && installable,
    ready: !!(enabled && downloadUrl),
    update_ready: installable,
    update_download_url: installable ? '/app/cineamit.apk' : '',
    update_error: installable ? '' : (hasFile ? 'unavailable' : 'upload_required'),
    version,
    notes,
    download_url: downloadUrl,
    has_file: hasFile,
    size: hasFile ? st.size : 0,
    size_label: hasFile ? formatSize(st.size) : '',
    sha256,
    min_android: '7.0 (Android 24+)',
    package: 'in.cineamit.app',
  };
}

async function saveSettings(body) {
  const version = String(body.app_apk_version || body.version || DEFAULT_VERSION).trim().slice(0, 32) || DEFAULT_VERSION;
  const notes = String(body.app_apk_notes || body.notes || '').slice(0, 2000);
  const url = sanitizeExtUrl(body.app_apk_url || body.url || '');
  const enabled = !!(body.app_download_enabled || body.enabled);
  const force = !!(body.app_apk_force || body.force);
  if (force && (!fileStat() || !enabled)) throw new Error('Upload a local APK and enable app downloads before requiring an update.');
  await Economy.setKey(KEYS.enabled, enabled ? '1' : '0');
  await Economy.setKey(KEYS.force, force ? '1' : '0');
  await Economy.setKey(KEYS.version, version);
  await Economy.setKey(KEYS.notes, notes);
  await Economy.setKey(KEYS.url, url);
  return publicMeta();
}

function extractBoundary(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  return m ? String(m[1] || m[2]).trim() : '';
}

async function readBody(req, max) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) {
      const err = new Error('too_large');
      err.code = 'too_large';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function extractApkPart(buf, boundary) {
  const token = Buffer.from('--' + boundary);
  const parts = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const at = buf.indexOf(token, cursor);
    if (at < 0) break;
    if (cursor > 0) {
      let end = at;
      if (end >= 2 && buf[end - 2] === 13 && buf[end - 1] === 10) end -= 2;
      parts.push(buf.slice(cursor, end));
    }
    cursor = at + token.length;
    if (buf[cursor] === 45 && buf[cursor + 1] === 45) break;
    if (buf[cursor] === 13 && buf[cursor + 1] === 10) cursor += 2;
  }
  for (const part of parts) {
    const sep = part.indexOf('\r\n\r\n');
    if (sep < 0) continue;
    const header = part.slice(0, sep).toString('utf8');
    if (!/name="apk"/i.test(header)) continue;
    const fn = /filename="([^"]+)"/i.exec(header);
    const name = fn ? String(fn[1] || '') : '';
    if (!/\.apk$/i.test(name)) {
      const err = new Error('not_apk');
      err.code = 'not_apk';
      throw err;
    }
    const body = part.slice(sep + 4);
    if (body.length < 100 || body[0] !== 0x50 || body[1] !== 0x4b) {
      const err = new Error('not_apk');
      err.code = 'not_apk';
      throw err;
    }
    if (body.length > MAX_BYTES) {
      const err = new Error('too_large');
      err.code = 'too_large';
      throw err;
    }
    return body;
  }
  const err = new Error('no_file');
  err.code = 'no_file';
  throw err;
}

async function saveUploadedApk(req) {
  const boundary = extractBoundary(req.headers['content-type']);
  if (!boundary) {
    const err = new Error('boundary');
    err.code = 'boundary';
    throw err;
  }
  const buf = await readBody(req, MAX_BYTES + 1024 * 1024);
  const apk = extractApkPart(buf, boundary);
  ensureDir();
  const tmp = APK_FILE + '.tmp';
  fs.writeFileSync(tmp, apk);
  fs.renameSync(tmp, APK_FILE);
  const hex = crypto.createHash('sha256').update(apk).digest('hex');
  shaMem = { mtimeMs: fs.statSync(APK_FILE).mtimeMs, hex };
  await Economy.setKey(KEYS.sha, hex);
  return publicMeta();
}

function sendApk(app, meta) {
  const filename = 'CineAmit-' + String(meta.version || DEFAULT_VERSION).replace(/[^\w.\-]+/g, '_') + '.apk';
  app.res.set({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Content-Length': String(meta.size),
    'Cache-Control': 'private, max-age=120',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  app._ended = true;
  fs.createReadStream(APK_FILE).pipe(app.res);
}

module.exports = {
  APK_FILE,
  MAX_BYTES,
  publicMeta,
  saveSettings,
  async updateMeta() {
    const meta=await publicMeta();
    return {...meta,ready:meta.update_ready,download_url:meta.update_download_url};
  },
  saveUploadedApk,
  sendApk,
  fileStat,
};
