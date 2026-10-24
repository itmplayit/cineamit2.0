'use strict';

const https = require('https');
const Config = require('../core/config');
const Database = require('../db');

const OAuth = { lastError: '' };

function httpReq(method, url, post, headers) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const body = method === 'POST' && post ? new URLSearchParams(post).toString() : null;
    const hdrs = { 'User-Agent': 'CineAmit-OAuth', ...(headers || {}) };
    if (body) hdrs['Content-Type'] = 'application/x-www-form-urlencoded';
    if (body) hdrs['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: hdrs,
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve([res.statusCode || 0, Buffer.concat(chunks).toString('utf8')]));
    });
    req.on('error', (err) => { OAuth.lastError = 'HTTP: ' + err.message; resolve([0, '']); });
    req.on('timeout', () => { req.destroy(); resolve([0, '']); });
    if (body) req.write(body);
    req.end();
  });
}

OAuth.enabled = (provider) => OAuth.clientId(provider) !== '' && OAuth.clientSecret(provider) !== '';
OAuth.clientId = (p) => p === 'google' ? String(Config.GOOGLE_CLIENT_ID || '') : String(Config.GITHUB_CLIENT_ID || '');
OAuth.clientSecret = (p) => p === 'google' ? String(Config.GOOGLE_CLIENT_SECRET || '') : String(Config.GITHUB_CLIENT_SECRET || '');
OAuth.redirectUri = (provider) => OAuth.baseUrl().replace(/\/+$/, '') + '/auth/' + provider + '/callback';
OAuth.baseUrl = () => {
  const override = String(Config.OAUTH_BASE_URL || '').trim();
  if (override) return override.replace(/\/+$/, '');
  return 'http://localhost';
};

OAuth.authUrl = (provider, state) => {
  if (provider === 'google') {
    const q = new URLSearchParams({
      client_id: OAuth.clientId('google'),
      redirect_uri: OAuth.redirectUri('google'),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
  }
  const q = new URLSearchParams({
    client_id: OAuth.clientId('github'),
    redirect_uri: OAuth.redirectUri('github'),
    scope: 'read:user user:email',
    state,
  });
  return 'https://github.com/login/oauth/authorize?' + q.toString();
};

async function exchangeToken(provider, code) {
  const url = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token';
  const [status, body] = await httpReq('POST', url, {
    client_id: OAuth.clientId(provider),
    client_secret: OAuth.clientSecret(provider),
    code,
    redirect_uri: OAuth.redirectUri(provider),
    grant_type: 'authorization_code',
  }, { Accept: 'application/json' });
  let data;
  try { data = JSON.parse(body); } catch { data = null; }
  if (!data || !data.access_token) {
    console.error('[OAuth] token exchange failed (HTTP ' + status + '): ' + String(body).slice(0, 200));
    OAuth.lastError = 'Authentication token exchange failed. Please try again.';
    return null;
  }
  return String(data.access_token);
}

OAuth.fetchUser = async function fetchUser(provider, code) {
  OAuth.lastError = '';
  const token = await exchangeToken(provider, code);
  if (!token) return null;
  return provider === 'google' ? googleUser(token) : githubUser(token);
};

async function googleUser(token) {
  const [status, body] = await httpReq('GET', 'https://www.googleapis.com/oauth2/v3/userinfo', null, { Authorization: 'Bearer ' + token });
  let d;
  try { d = JSON.parse(body); } catch { d = null; }
  if (!d || !d.sub) {
    console.error('[OAuth] google userinfo failed (HTTP ' + status + ')');
    OAuth.lastError = 'Could not retrieve Google profile.';
    return null;
  }
  if (!d.email) { OAuth.lastError = 'No email address was returned by your Google account.'; return null; }
  if (!d.email_verified) { OAuth.lastError = 'Your Google account email is not verified.'; return null; }
  return { id: String(d.sub), email: String(d.email).toLowerCase().trim(), name: String(d.name || d.given_name || ''), avatar: String(d.picture || '') };
}

async function githubUser(token) {
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'CineAmit-OAuth' };
  const [status, body] = await httpReq('GET', 'https://api.github.com/user', null, headers);
  let u;
  try { u = JSON.parse(body); } catch { u = null; }
  if (!u || !u.id) {
    console.error('[OAuth] github /user failed (HTTP ' + status + ')');
    OAuth.lastError = 'Could not retrieve GitHub profile.';
    return null;
  }
  let email = '';
  const [, eBody] = await httpReq('GET', 'https://api.github.com/user/emails', null, headers);
  let list;
  try { list = JSON.parse(eBody); } catch { list = null; }
  if (Array.isArray(list)) {
    for (const e of list) {
      if (e.primary && e.verified && e.email) { email = String(e.email).toLowerCase().trim(); break; }
    }
    if (!email) {
      for (const e of list) {
        if (e.verified && e.email) { email = String(e.email).toLowerCase().trim(); break; }
      }
    }
  }
  if (!email) {
    OAuth.lastError = 'No verified email on this GitHub account. Verify email in GitHub settings, or use normal signup.';
    return null;
  }
  return { id: String(u.id), email, name: String(u.name || u.login || ''), avatar: String(u.avatar_url || '') };
}

OAuth.uniqueUsername = async function uniqueUsername(base) {
  base = String(base).replace(/[^A-Za-z0-9_.]/g, '') || 'user';
  base = base.slice(0, 40) || 'user';
  let name = base;
  let i = 1;
  while (await Database.fetchOne('SELECT id FROM users WHERE username = ?', [name])) {
    i++;
    name = base + i;
    if (i > 9999) { name = base + require('crypto').randomBytes(3).toString('hex'); break; }
  }
  return name;
};

module.exports = OAuth;
