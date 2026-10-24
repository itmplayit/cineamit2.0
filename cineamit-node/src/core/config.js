'use strict';

const Config = {
  SECRET_KEY: '',
  APP_DEBUG: false,
  DB_USER: null,
  DB_PASS: null,
  DB_HOST: null,
  DB_NAME: null,
  DB_PORT: null,
  DB_SSL: false,
  DB_SSL_CA_FILE: '',
  APP_ALLOW_TICKET_TABLE_REBUILD: false,
  SMTP_USER: null,
  SMTP_PASS: null,
  SMTP_HOST: null,
  SMTP_PORT: 587,
  MAIL_FROM: null,
  MAIL_FROM_NAME: null,
  BREVO_API_KEY: null,
  RESEND_API_KEY: null,
  GOOGLE_CLIENT_ID: null,
  GOOGLE_CLIENT_SECRET: null,
  GITHUB_CLIENT_ID: null,
  GITHUB_CLIENT_SECRET: null,
  OAUTH_BASE_URL: null,
  APP_PUBLIC_ORIGIN: '',
  SEO_PUBLIC_ORIGIN: '',
  GOOGLE_SITE_VERIFICATION: '',
  BING_SITE_VERIFICATION: '',
  INDEXNOW_KEY: '',
  INDEXNOW_AUTO: false,
  INDEXNOW_AUTO_INTERVAL_HOURS: 24,
  GOOGLE_SITEMAP_AUTO: false,
  GOOGLE_SA_JSON_FILE: '',
  GOOGLE_SITEMAPS_SITE: '',
  GOOGLE_SITEMAPS_FEEDS: 'sitemap.xml',
  OTP_DEBUG: false,
  TMDB_API_KEY: null,
  TMDB_INSECURE_TLS_RETRY: false,
  TRUST_PROXY_REAL_IP: false,
  TRUSTED_PROXIES: [],
  UNITY_S2S_ENABLED: false,
  UNITY_S2S_SECRET: '',
  UNITY_GAME_ID: '',
  UNITY_REWARDED_PLACEMENT: '',
  VAST_ALLOWED_HOSTS: '',
  TMDB_BASE_URL: 'https://api.themoviedb.org/3',
  TMDB_IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/original',
  TMDB_IMAGE_BASE: 'https://image.tmdb.org/t/p',
  STALKER_PORTAL_URL: '',
  STALKER_MAC: '',
  CLOUDFLARE_PROXY_URL: '',
  ADS_ENABLED: true,
  SPLASH_ENABLED: true,
  CURSOR_ENABLED: true,
  PAGE_CACHE_TTL: 300,
  WARM_KEY: '',
  BLOCK_BAD_BOTS: true,
  HILLTOPADS_VAST_URL: '',
  VAST_FALLBACK_URL: '',
  ADSTERRA_SOCIAL_BAR: '',
  ADSTERRA_POPUNDER: '',
  ADSTERRA_BANNER_728: '',
  ADSTERRA_BANNER_300: '',
  ADSTERRA_BANNER_320: '',
  ADSTERRA_BANNER_468: '',
  ADSTERRA_BANNER_160: '',
  ADSTERRA_NATIVE_BANNER: '',
  ADSTERRA_SMARTLINK_URL: '',
  ADSENSE_PUB_ID: '',
  GA_MEASUREMENT_ID: '',
  GA_API_SECRET: '',
  OWNER_BOOTSTRAP_KEY: '',
  M3U_PLAYLIST_LIST: [],
  SETUP_ENABLED: false,
};

function get(settings, key) {
  const value = settings[key] ?? '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  return value.trim();
}

function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function falsy(v) {
  return ['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

function parseOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(name + ' must be an absolute HTTP(S) origin without path, credentials or query.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(name + ' must be an absolute HTTP(S) origin without path, credentials or query.');
  }
  return url;
}

function isLoopbackOrigin(url) {
  const host = String(url.hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

Config.load = function load(settings) {
  Config.APP_DEBUG = truthy(get(settings, 'APP_DEBUG'));
  Config.SECRET_KEY = get(settings, 'SECRET_KEY');
  Config.DB_USER = get(settings, 'DB_USER');
  Config.DB_PASS = get(settings, 'DB_PASS');
  Config.DB_HOST = get(settings, 'DB_HOST');
  Config.DB_NAME = get(settings, 'DB_NAME');
  const dbPort = get(settings, 'DB_PORT');
  Config.DB_PORT = null;
  if (dbPort !== '') {
    if (!/^[0-9]{1,5}$/.test(dbPort) || Number(dbPort) < 1 || Number(dbPort) > 65535) {
      throw new Error('DB_PORT must be an integer between 1 and 65535.');
    }
    Config.DB_PORT = Number(dbPort);
  }
  const sslMode = get(settings, 'DB_SSL').toLowerCase();
  Config.DB_SSL_CA_FILE = get(settings, 'DB_SSL_CA_FILE');
  const tidbHost = /(?:^|\.)tidbcloud\.com\.?$/i.test(String(Config.DB_HOST || ''));
  if (sslMode === '' || sslMode === 'auto') {
    Config.DB_SSL = tidbHost || Config.DB_SSL_CA_FILE !== '';
  } else if (truthy(sslMode) || falsy(sslMode)) {
    Config.DB_SSL = truthy(sslMode);
  } else {
    throw new Error('DB_SSL must be auto, true or false.');
  }
  if (!Config.DB_SSL && (tidbHost || Config.DB_SSL_CA_FILE)) {
    throw new Error('TLS is required for TiDB Cloud or when DB_SSL_CA_FILE is configured. Set DB_SSL to true or auto.');
  }
  const ticketRebuild = get(settings, 'APP_ALLOW_TICKET_TABLE_REBUILD');
  if (ticketRebuild && !truthy(ticketRebuild) && !falsy(ticketRebuild)) throw new Error('APP_ALLOW_TICKET_TABLE_REBUILD must be true or false.');
  Config.APP_ALLOW_TICKET_TABLE_REBUILD = truthy(ticketRebuild);
  Config.SMTP_USER = get(settings, 'SMTP_USER');
  // SMTP passwords are opaque: spaces and quotes can be intentional.
  Config.SMTP_PASS = typeof settings.SMTP_PASS === 'string' ? settings.SMTP_PASS : get(settings, 'SMTP_PASS');
  Config.SMTP_HOST = get(settings, 'SMTP_HOST');
  const smtpPort = get(settings, 'SMTP_PORT');
  Config.SMTP_PORT = smtpPort === '' ? 587 : Number(smtpPort);
  if (!/^\d{1,5}$/.test(smtpPort || '587') || !Number.isInteger(Config.SMTP_PORT) || Config.SMTP_PORT < 1 || Config.SMTP_PORT > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535.');
  }
  Config.MAIL_FROM = get(settings, 'MAIL_FROM');
  Config.MAIL_FROM_NAME = get(settings, 'MAIL_FROM_NAME');
  Config.BREVO_API_KEY = get(settings, 'BREVO_API_KEY');
  Config.RESEND_API_KEY = get(settings, 'RESEND_API_KEY');
  Config.GOOGLE_CLIENT_ID = get(settings, 'GOOGLE_CLIENT_ID');
  Config.GOOGLE_CLIENT_SECRET = get(settings, 'GOOGLE_CLIENT_SECRET');
  Config.GITHUB_CLIENT_ID = get(settings, 'GITHUB_CLIENT_ID');
  Config.GITHUB_CLIENT_SECRET = get(settings, 'GITHUB_CLIENT_SECRET');
  Config.OAUTH_BASE_URL = get(settings, 'OAUTH_BASE_URL').replace(/\/+$/, '');
  if (Config.OAUTH_BASE_URL) Config.OAUTH_BASE_URL = parseOrigin(Config.OAUTH_BASE_URL, 'OAUTH_BASE_URL').origin;
  Config.APP_PUBLIC_ORIGIN = get(settings, 'APP_PUBLIC_ORIGIN');
  if (Config.APP_PUBLIC_ORIGIN) {
    const appOrigin = parseOrigin(Config.APP_PUBLIC_ORIGIN, 'APP_PUBLIC_ORIGIN');
    // The local example intentionally uses APP_DEBUG=false. HTTP is therefore
    // restricted to loopback rather than tied to the debug error-reporting flag.
    if (appOrigin.protocol === 'http:' && !isLoopbackOrigin(appOrigin)) throw new Error('APP_PUBLIC_ORIGIN must use HTTPS; HTTP is allowed only for localhost/loopback development.');
    Config.APP_PUBLIC_ORIGIN = appOrigin.origin;
  }
  Config.SEO_PUBLIC_ORIGIN = get(settings, 'SEO_PUBLIC_ORIGIN');
  if (Config.SEO_PUBLIC_ORIGIN) {
    let u;try {u=new URL(Config.SEO_PUBLIC_ORIGIN);} catch {throw new Error('SEO_PUBLIC_ORIGIN must be an HTTPS origin.');}
    if (u.protocol!=='https:' || u.username || u.password || u.pathname!=='/' || u.search || u.hash)
      throw new Error('SEO_PUBLIC_ORIGIN must be an HTTPS origin without path, credentials or query.');
    Config.SEO_PUBLIC_ORIGIN=u.origin;
  }
  for (const name of ['GOOGLE_SITE_VERIFICATION','BING_SITE_VERIFICATION']) {
    Config[name]=get(settings,name);
    if (Config[name] && !/^[A-Za-z0-9_-]{8,256}$/.test(Config[name])) throw new Error(name+' has invalid characters or length.');
  }
  Config.INDEXNOW_KEY=get(settings,'INDEXNOW_KEY');
  if (Config.INDEXNOW_KEY && !/^[A-Za-z0-9-]{8,128}$/.test(Config.INDEXNOW_KEY)) throw new Error('INDEXNOW_KEY must contain 8-128 letters, digits or dashes.');
  Config.INDEXNOW_AUTO = truthy(get(settings, 'INDEXNOW_AUTO'));
  Config.INDEXNOW_AUTO_INTERVAL_HOURS = Number(get(settings, 'INDEXNOW_AUTO_INTERVAL_HOURS') || 24);
  if (!Number.isFinite(Config.INDEXNOW_AUTO_INTERVAL_HOURS) || Config.INDEXNOW_AUTO_INTERVAL_HOURS < 1 || Config.INDEXNOW_AUTO_INTERVAL_HOURS > 720) throw new Error('INDEXNOW_AUTO_INTERVAL_HOURS must be hours between 1 and 720.');
  Config.GOOGLE_SITEMAP_AUTO = truthy(get(settings, 'GOOGLE_SITEMAP_AUTO'));
  Config.GOOGLE_SA_JSON_FILE = get(settings, 'GOOGLE_SA_JSON_FILE');
  Config.GOOGLE_SITEMAPS_SITE = get(settings, 'GOOGLE_SITEMAPS_SITE');
  Config.GOOGLE_SITEMAPS_FEEDS = get(settings, 'GOOGLE_SITEMAPS_FEEDS') || 'sitemap.xml';
  if (Config.GOOGLE_SITEMAPS_SITE && !/^(?:sc-domain:[A-Za-z0-9.-]+|https:\/\/[^\s?#]+\/)$/.test(Config.GOOGLE_SITEMAPS_SITE)) throw new Error('GOOGLE_SITEMAPS_SITE must be an https URL-prefix property ending in / or sc-domain:example.com');
  Config.OTP_DEBUG = truthy(get(settings, 'OTP_DEBUG'));
  Config.TMDB_API_KEY = get(settings, 'TMDB_API_KEY');
  Config.TMDB_INSECURE_TLS_RETRY = truthy(get(settings, 'TMDB_INSECURE_TLS_RETRY'));
  Config.TRUST_PROXY_REAL_IP = truthy(get(settings, 'TRUST_PROXY_REAL_IP'));
  Config.TRUSTED_PROXIES = get(settings, 'TRUSTED_PROXIES').split(',').map(v => v.trim()).filter(Boolean);
  const unityMode = get(settings, 'UNITY_S2S_ENABLED');
  if (unityMode && !/^(true|false|1|0)$/i.test(unityMode)) throw new Error('UNITY_S2S_ENABLED must be true or false.');
  Config.UNITY_S2S_ENABLED = truthy(unityMode);
  Config.UNITY_S2S_SECRET = get(settings, 'UNITY_S2S_SECRET');
  Config.UNITY_GAME_ID = get(settings, 'UNITY_GAME_ID');
  Config.UNITY_REWARDED_PLACEMENT = get(settings, 'UNITY_REWARDED_PLACEMENT');
  if (Config.UNITY_S2S_ENABLED && (Config.UNITY_S2S_SECRET.length < 32 || !/^[1-9][0-9]{3,11}$/.test(Config.UNITY_GAME_ID)
    || !/^[A-Za-z0-9_-]{1,60}$/.test(Config.UNITY_REWARDED_PLACEMENT))) throw new Error('Unity S2S requires the server-only Support secret, valid Game ID and rewarded placement.');

  if (Config.TRUST_PROXY_REAL_IP && !Config.TRUSTED_PROXIES.length) throw new Error('Set TRUSTED_PROXIES to your proxy IP/CIDRs before enabling TRUST_PROXY_REAL_IP.');
  Config.VAST_ALLOWED_HOSTS = get(settings, 'VAST_ALLOWED_HOSTS');
  Config.SETUP_ENABLED = truthy(get(settings, 'SETUP_ENABLED'));

  let imgBase = get(settings, 'TMDB_IMAGE_BASE_URL').replace(/\/+$/, '');
  if (imgBase === '') imgBase = 'https://image.tmdb.org/t/p/original';
  else if (/\/t\/p$/i.test(imgBase)) imgBase += '/w500';
  Config.TMDB_IMAGE_BASE_URL = imgBase;
  let imgBaseEnv = get(settings, 'TMDB_IMAGE_BASE').replace(/\/+$/, '');
  if (imgBaseEnv !== '') imgBaseEnv = imgBaseEnv.replace(/\/(original|w\d+|h\d+|face)$/i, '');
  Config.TMDB_IMAGE_BASE = imgBaseEnv !== ''
    ? imgBaseEnv
    : Config.TMDB_IMAGE_BASE_URL.replace(/\/(original|w\d+|h\d+|face)$/i, '');

  Config.STALKER_PORTAL_URL = get(settings, 'STALKER_PORTAL_URL');
  Config.STALKER_MAC = get(settings, 'STALKER_MAC');
  Config.CLOUDFLARE_PROXY_URL = get(settings, 'CLOUDFLARE_PROXY_URL');

  const pageCacheTtl = parseInt(get(settings, 'PAGE_CACHE_TTL') || '0', 10) || 0;
  Config.PAGE_CACHE_TTL = get(settings, 'PAGE_CACHE_TTL') === '' ? 300 : Math.max(0, Math.min(3600, pageCacheTtl));
  Config.WARM_KEY = get(settings, 'WARM_KEY');
  Config.BLOCK_BAD_BOTS = !falsy(get(settings, 'BLOCK_BAD_BOTS') || 'true');

  const cursorEnabledValue = get(settings, 'CURSOR_ENABLED').toLowerCase();
  Config.CURSOR_ENABLED = cursorEnabledValue === '' || !falsy(cursorEnabledValue);
  const splashEnabledValue = get(settings, 'SPLASH_ENABLED').toLowerCase();
  Config.SPLASH_ENABLED = splashEnabledValue === '' || !falsy(splashEnabledValue);
  const adsEnabledValue = get(settings, 'ADS_ENABLED').toLowerCase();
  Config.ADS_ENABLED = adsEnabledValue === '' || !falsy(adsEnabledValue);

  Config.HILLTOPADS_VAST_URL = get(settings, 'HILLTOPADS_VAST_URL');
  Config.VAST_FALLBACK_URL = get(settings, 'VAST_FALLBACK_URL') !== ''
    ? get(settings, 'VAST_FALLBACK_URL')
    : get(settings, 'ADSTERRA_VAST_URL');

  const gaId = get(settings, 'GA_MEASUREMENT_ID').trim();
  Config.GA_MEASUREMENT_ID = (
    gaId !== ''
    && !['0', 'off', 'none', 'false', 'no', '-'].includes(gaId.toLowerCase())
    && /^(?:G|UA|GT|AW)-[A-Za-z0-9._-]{4,32}$/.test(gaId)
  ) ? gaId : '';
  const gaSecret = get(settings, 'GA_API_SECRET').trim();
  Config.GA_API_SECRET = /^[A-Za-z0-9_-]{8,80}$/.test(gaSecret) ? gaSecret : '';

  Config.OWNER_BOOTSTRAP_KEY = get(settings, 'OWNER_BOOTSTRAP_KEY');
  if (Config.OWNER_BOOTSTRAP_KEY && (Config.OWNER_BOOTSTRAP_KEY.startsWith('REPLACE_') || Config.OWNER_BOOTSTRAP_KEY.length < 32)) throw new Error('Set a real random 32+ character OWNER_BOOTSTRAP_KEY, or leave it empty to disable first-owner setup.');
  Config.ADSTERRA_SOCIAL_BAR = get(settings, 'ADSTERRA_SOCIAL_BAR');
  Config.ADSTERRA_POPUNDER = get(settings, 'ADSTERRA_POPUNDER');
  Config.ADSTERRA_BANNER_728 = get(settings, 'ADSTERRA_BANNER_728');
  Config.ADSTERRA_BANNER_300 = get(settings, 'ADSTERRA_BANNER_300');
  Config.ADSTERRA_BANNER_320 = get(settings, 'ADSTERRA_BANNER_320');
  Config.ADSTERRA_BANNER_468 = get(settings, 'ADSTERRA_BANNER_468');
  Config.ADSTERRA_BANNER_160 = get(settings, 'ADSTERRA_BANNER_160');
  Config.ADSTERRA_NATIVE_BANNER = get(settings, 'ADSTERRA_NATIVE_BANNER');
  Config.ADSTERRA_SMARTLINK_URL = get(settings, 'ADSTERRA_SMARTLINK_URL');
  Config.ADSENSE_PUB_ID = get(settings, 'ADSENSE_PUB_ID');

  const m3u = get(settings, 'M3U_PLAYLISTS');
  Config.M3U_PLAYLIST_LIST = m3u === ''
    ? []
    : m3u.split(',').map((u) => u.trim()).filter(Boolean);

  const required = {
    DB_HOST: Config.DB_HOST,
    DB_NAME: Config.DB_NAME,
    DB_USER: Config.DB_USER,
    DB_PASS: Config.DB_PASS,
    TMDB_API_KEY: Config.TMDB_API_KEY,
    SECRET_KEY: Config.SECRET_KEY,
  };
  const missing = [];
  for (const [key, value] of Object.entries(required)) {
    if (value === null || String(value).trim() === '' || String(value).startsWith('REPLACE_')) missing.push(key);
  }
  if (missing.length) {
    throw new Error('.env mein required config missing hai: ' + missing.join(', '));
  }
  if (Config.SECRET_KEY.length < 32) {
    throw new Error('.env ka SECRET_KEY kam se kam 32 characters ka hona chahiye.');
  }
  const oauthOn = !!(Config.GOOGLE_CLIENT_ID || Config.GITHUB_CLIENT_ID);
  if (oauthOn && !Config.OAUTH_BASE_URL) {
    throw new Error('OAUTH_BASE_URL set karein (public https origin) jab Google/GitHub OAuth enabled ho.');
  }
  if (oauthOn && Config.OAUTH_BASE_URL.startsWith('http://')) {
    const oauthOrigin = new URL(Config.OAUTH_BASE_URL);
    if (!Config.APP_DEBUG || !isLoopbackOrigin(oauthOrigin)) throw new Error('OAUTH_BASE_URL must use HTTPS; HTTP is allowed only for loopback development with APP_DEBUG=true.');
  }
};

module.exports = Config;
