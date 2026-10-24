'use strict';

const crypto = require('crypto');
const Database = require('../db');
const Config = require('../core/config');
const {rewardUnit} = require('./unity-s2s');
const {parseFlag} = require('./site-status');

const TICKET_TTL_MS = 10 * 60_000;
const MAX_WALLET_POINTS = 10_000_000;
const REVISION_KEY = 'APP_ADS_CONFIG_REVISION';
const CONFIG_ATTEMPTS = 3;

const SETTING_KEYS = [
  'SITE_ADS_ENABLED', 'APP_ADS_ENABLED', 'APP_ADS_BANNER', 'APP_ADS_INTERSTITIAL',
  'APP_ADS_REWARDED', 'APP_ADS_INTER_EVERY', 'APP_ADS_REWARD_EVERY', 'APP_ADS_HOME_BANNERS',
  'APP_ADS_BANNER_TOP', 'APP_INTER_GAP_SEC', 'APP_AD_POINTS', 'APP_COST_MONTHLY', 'APP_COST_YEARLY',
  'APP_TRIAL_ENABLED', 'APP_TRIAL_DAYS', 'APP_MONTHLY_ENABLED', 'APP_YEARLY_ENABLED',
  'APP_DAYS_MONTHLY', 'APP_DAYS_YEARLY',
  'APP_LABEL_TRIAL', 'APP_BLURB_TRIAL', 'APP_LABEL_MONTHLY', 'APP_BLURB_MONTHLY',
  'APP_LABEL_YEARLY', 'APP_BLURB_YEARLY',
  'APP_REWARD_DAILY_CAP', 'APP_REWARD_COOLDOWN_SEC', 'APP_AD_DIAGNOSTICS',
];

const DEFAULTS = {
  SITE_ADS_ENABLED: '',
  APP_ADS_ENABLED: '1',
  APP_ADS_BANNER: '1',
  APP_ADS_INTERSTITIAL: '1',
  APP_ADS_REWARDED: '1',
  APP_ADS_INTER_EVERY: '1',
  APP_ADS_REWARD_EVERY: '0',
  APP_ADS_HOME_BANNERS: '1',
  APP_ADS_BANNER_TOP: '1',
  APP_INTER_GAP_SEC: '6',
  APP_AD_POINTS: '50',
  APP_REWARD_DAILY_CAP: '1000',
  APP_REWARD_COOLDOWN_SEC: '60',
  APP_AD_DIAGNOSTICS: '1',
  APP_COST_MONTHLY: '500',
  APP_COST_YEARLY: '4500',
  APP_TRIAL_ENABLED: '1',
  APP_TRIAL_DAYS: '14',
  APP_MONTHLY_ENABLED: '1',
  APP_YEARLY_ENABLED: '1',
  APP_DAYS_MONTHLY: '30',
  APP_DAYS_YEARLY: '365',
  APP_LABEL_TRIAL: 'FREE TRIAL',
  APP_BLURB_TRIAL: 'Ad-free trial. VIP servers remain free for everyone.',
  APP_LABEL_MONTHLY: 'PREMIUM MONTHLY',
  APP_BLURB_MONTHLY: 'Ad-free experience. VIP servers remain free for everyone.',
  APP_LABEL_YEARLY: 'PREMIUM YEARLY  ·  BEST VALUE',
  APP_BLURB_YEARLY: 'Best value. No ads. VIP servers remain free for everyone.',
};

function clipStr(v, max, def) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return def;
  return s.length > max ? s.slice(0, max).trim() : s;
}

function onOff(v, def = true) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return def;
  return !(s === '0' || s === 'false' || s === 'off' || s === 'no');
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

async function rawMap(strict = false, conn = null) {
  const out = { ...DEFAULTS, [REVISION_KEY]: '0' };
  try {
    const sql = "SELECT setting_key, setting_value FROM site_setting WHERE setting_key IN ('"
      + [...SETTING_KEYS, REVISION_KEY].join("','") + "')";
    // Strict reads must not silently recreate a missing settings table.
    const reader = conn || (strict ? await Database.get() : null);
    const rows = reader ? (await reader.execute(sql))[0] : await Database.fetchAll(sql);
    for (const r of rows || []) out[String(r.setting_key)] = String(r.setting_value);
  } catch (error) { if (strict) throw error; }
  return out;
}

function configRevision(map) {
  const value = String(map[REVISION_KEY]);
  if (!/^(0|[1-9][0-9]{0,15})$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) >= Number.MAX_SAFE_INTEGER)
    throw new Error('Invalid app settings revision.');
  return value;
}
function settingsConflict() {
  return Object.assign(new Error('App settings changed. Reload the page and review the latest values before retrying.'), {code: 'APP_SETTINGS_CONFLICT'});
}
function submittedRevision(body) {
  if (!body || typeof body.settings_revision !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(body.settings_revision)) throw settingsConflict();
  return body.settings_revision;
}
async function ensureRevision() {
  // Autocommit seed: do not retain INSERT IGNORE shared locks before upgrading.
  const pool = await Database.get();
  await pool.execute("INSERT IGNORE INTO site_setting (setting_key, setting_value) VALUES ('APP_ADS_CONFIG_REVISION', '0')");
}
async function setKey(key, value) {
  key = String(key); value = String(value);
  const write = conn => conn.execute('INSERT INTO site_setting (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value]);
  if (!key.startsWith('APP_') || !SETTING_KEYS.includes(key)) return write(Database);
  await ensureRevision();
  return Database.transaction(async conn => {
    const [rows] = await conn.execute("SELECT setting_value FROM site_setting WHERE setting_key = 'APP_ADS_CONFIG_REVISION' FOR UPDATE");
    if (!rows.length) throw new Error('App settings revision unavailable.');
    configRevision({[REVISION_KEY]: rows[0].setting_value});
    await write(conn);
    await conn.execute("UPDATE site_setting SET setting_value = CAST(setting_value AS UNSIGNED) + 1 WHERE setting_key = 'APP_ADS_CONFIG_REVISION'");
  });
}
async function publicConfig(strict = false) {
  return configFromMap(await rawMap(strict), strict);
}
async function adminConfig() {
  const map = await rawMap(true);
  // Read failure must not turn a fallback/default form into an editable snapshot.
  // Readable malformed business values remain repairable through validated Save.
  return {...configFromMap(map), settings_revision: configRevision(map), settings_available: true};
}
function configFromMap(m, strict = false) {
  if (strict) {
    for (const [key, min, max] of [['APP_AD_POINTS', 1, 500], ['APP_REWARD_DAILY_CAP', 0, 100000], ['APP_REWARD_COOLDOWN_SEC', 0, 86400]]) {
      const value = String(m[key]).trim();
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Invalid reward configuration: ' + key);
    }
    for (const key of ['APP_ADS_ENABLED', 'APP_ADS_REWARDED', 'APP_AD_DIAGNOSTICS']) {
      if (parseFlag(m[key]) === null) throw new Error('Invalid reward toggle: ' + key);
    }
    if (Number(m.APP_REWARD_DAILY_CAP) > 0 && Number(m.APP_REWARD_DAILY_CAP) < Number(m.APP_AD_POINTS)) throw new Error('Invalid reward daily cap');
    for (const [key, min, max] of [['APP_COST_MONTHLY', 0, 100000], ['APP_COST_YEARLY', 0, 500000], ['APP_TRIAL_DAYS', 1, 90], ['APP_DAYS_MONTHLY', 1, 365], ['APP_DAYS_YEARLY', 1, 1095]]) {
      const value = String(m[key]).trim();
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Invalid entitlement configuration: ' + key);
    }
    for (const key of ['APP_TRIAL_ENABLED', 'APP_MONTHLY_ENABLED', 'APP_YEARLY_ENABLED']) {
      if (parseFlag(m[key]) === null) throw new Error('Invalid entitlement toggle: ' + key);
    }
  }
  return {
    ads_enabled: onOff(m.APP_ADS_ENABLED, true),
    ads_banner: onOff(m.APP_ADS_BANNER, true),
    ads_interstitial: onOff(m.APP_ADS_INTERSTITIAL, true),
    ads_rewarded: onOff(m.APP_ADS_REWARDED, true),
    reward_verification_ready: rewardVerificationReady(),
    reward_provider: 'unity',
    reward_verification_unity: unityVerificationReady(),
    ads_inter_every: onOff(m.APP_ADS_INTER_EVERY, true),
    ads_reward_every: onOff(m.APP_ADS_REWARD_EVERY, false),
    ads_home_banners: onOff(m.APP_ADS_HOME_BANNERS, true),
    ads_banner_top: onOff(m.APP_ADS_BANNER_TOP, true),
    inter_gap_sec: clampInt(m.APP_INTER_GAP_SEC, 0, 120, 6),
    ad_points: clampInt(m.APP_AD_POINTS, 1, 500, 50),
    reward_daily_cap: clampInt(m.APP_REWARD_DAILY_CAP, 0, 100000, 1000),
    reward_cooldown_sec: clampInt(m.APP_REWARD_COOLDOWN_SEC, 0, 86400, 60),
    ads_diagnostics: parseFlag(m.APP_AD_DIAGNOSTICS) === true,
    cost_monthly: clampInt(m.APP_COST_MONTHLY, 0, 100000, 500),
    cost_yearly: clampInt(m.APP_COST_YEARLY, 0, 500000, 4500),
    trial_enabled: onOff(m.APP_TRIAL_ENABLED, true),
    trial_days: clampInt(m.APP_TRIAL_DAYS, 1, 90, 14),
    monthly_enabled: onOff(m.APP_MONTHLY_ENABLED, true),
    yearly_enabled: onOff(m.APP_YEARLY_ENABLED, true),
    days_monthly: clampInt(m.APP_DAYS_MONTHLY, 1, 365, 30),
    days_yearly: clampInt(m.APP_DAYS_YEARLY, 1, 1095, 365),
    label_trial: clipStr(m.APP_LABEL_TRIAL, 40, DEFAULTS.APP_LABEL_TRIAL),
    blurb_trial: clipStr(m.APP_BLURB_TRIAL, 160, DEFAULTS.APP_BLURB_TRIAL),
    label_monthly: clipStr(m.APP_LABEL_MONTHLY, 40, DEFAULTS.APP_LABEL_MONTHLY),
    blurb_monthly: clipStr(m.APP_BLURB_MONTHLY, 160, DEFAULTS.APP_BLURB_MONTHLY),
    label_yearly: clipStr(m.APP_LABEL_YEARLY, 40, DEFAULTS.APP_LABEL_YEARLY),
    blurb_yearly: clipStr(m.APP_BLURB_YEARLY, 160, DEFAULTS.APP_BLURB_YEARLY),
  };
}

function siteAdsFromMap(m) {
  const v = String((m && m.SITE_ADS_ENABLED) || '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'on') return true;
  return !!Config.ADS_ENABLED;
}

async function siteAdsEnabled() {
  return siteAdsFromMap(await rawMap());
}

function packWallet(row) {
  if (!row) {
    return { points: 0, plan: 'free', until: 0, seeded: false, trial_used: false, trial_available: true };
  }
  const until = Number(row.plan_until || 0);
  let plan = String(row.plan || 'free');
  if (until <= Date.now()) plan = 'free';
  const trialUsed = Number(row.trial_used || 0) === 1;
  const active = plan === 'monthly' || plan === 'yearly' || plan === 'trial';
  return {
    points: Math.max(0, Number(row.points || 0)),
    plan,
    until: plan === 'free' ? 0 : until,
    seeded: Number(row.seeded || 0) === 1,
    trial_used: trialUsed,
    trial_available: !trialUsed && !active,
  };
}

async function getRow(userId) {
  const id = Number(userId) || 0;
  if (id <= 0) return null;
  try {
    return await Database.fetchOne('SELECT * FROM user_wallet WHERE user_id = ?', [id]);
  } catch {
    return null;
  }
}

async function getWallet(userId) {
  return packWallet(await getRow(userId));
}

function normPlan(plan) {
  if (plan === 'yearly' || plan === 'monthly' || plan === 'trial') return plan;
  return 'free';
}

// Account/wallet rows serialize balances. Financial settings use one coherent
// snapshot on this connection, then a brief revision lock before committing.
// Saves use the same revision lock; changed snapshots roll back and retry rather
// than holding one global settings lock throughout every account's business work.
async function mutateWallet(userId, fn, needsConfig = false) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid wallet user');
  if (needsConfig) await ensureRevision();
  for (let attempt = 0; attempt < (needsConfig ? CONFIG_ATTEMPTS : 1); attempt++) {
    try {
      return await Database.transaction(async conn => {
        const [users] = await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
        if (!users.length) throw new Error('Account unavailable');
        await conn.execute("INSERT IGNORE INTO user_wallet (user_id, points, plan, plan_until, seeded, trial_used) VALUES (?, 0, 'free', 0, 1, 0)", [id]);
        const [rows] = await conn.execute('SELECT * FROM user_wallet WHERE user_id = ? FOR UPDATE', [id]);
        const current = packWallet(rows[0]);
        const map = needsConfig ? await rawMap(true, conn) : null;
        const economy = map ? configFromMap(map, true) : null;
        const revision = map ? configRevision(map) : null;
        const change = await fn(current, conn, economy);
        if (map) {
          const [latest] = await conn.execute("SELECT setting_value FROM site_setting WHERE setting_key = 'APP_ADS_CONFIG_REVISION' FOR UPDATE");
          if (!latest.length || String(latest[0].setting_value) !== revision)
            throw Object.assign(new Error('App settings changed during wallet operation.'), {code: 'APP_ECONOMY_RETRY'});
        }
        if (change.error) return {ok: false, ...change, wallet: current, ...(economy ? {economy} : {})};
        const next = {...current, ...(change.wallet || {})};
        const points = Number(next.points);
        // Never silently truncate a financial mutation after its claim was used.
        if (!Number.isSafeInteger(points) || points < 0 || points > MAX_WALLET_POINTS)
          throw Object.assign(new Error('Wallet balance must remain between 0 and ' + MAX_WALLET_POINTS + ' points.'), {code: 'WALLET_RANGE'});
        const plan = normPlan(next.plan);
        const until = plan === 'free' ? 0 : Number(next.until || 0);
        await conn.execute('UPDATE user_wallet SET points = ?, plan = ?, plan_until = ?, seeded = 1, trial_used = ? WHERE user_id = ?', [points, plan, until, next.trial_used ? 1 : 0, id]);
        return {ok: true, ...(change.extra || {}), ...(economy ? {economy} : {}), wallet: packWallet({points, plan, plan_until: until, seeded: 1, trial_used: next.trial_used ? 1 : 0})};
      }, {readCommitted: true});
    } catch (error) {
      const retryable = ['APP_ECONOMY_RETRY', 'ER_CHECKREAD', 'ER_LOCK_DEADLOCK'].includes(error.code) || error.errno === 9007;
      if (!needsConfig || !retryable || attempt === CONFIG_ATTEMPTS - 1) throw error;
      // Database.transaction rolled back all ticket/usage/event changes.
      // MariaDB may signal 1020 instead of returning a newer locked revision;
      // deadlocks / TiDB write conflicts also require a fresh transaction snapshot.
    }
  }
}

async function payload(app) {
  const economy = await publicConfig();
  const user = app && await app.currentUser();
  return {economy, wallet: user ? await getWallet(user.id) : null};
}

async function syncFromClient(userId) {
  // Legacy clients may still send points/plan/until; these are deliberately ignored.
  return {...(await mutateWallet(userId, async () => ({}))), economy: await publicConfig()};
}

function unityVerificationReady() {
  return Boolean(Config.UNITY_S2S_ENABLED && Config.UNITY_S2S_SECRET.length >= 32 && Config.UNITY_GAME_ID && Config.UNITY_REWARDED_PLACEMENT);
}
function rewardVerificationReady() { return unityVerificationReady(); }

async function usageForUpdate(conn, userId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  await conn.execute('INSERT IGNORE INTO app_reward_usage (user_id, day_key) VALUES (?, ?)', [userId, day]);
  const [rows] = await conn.execute('SELECT * FROM app_reward_usage WHERE user_id = ? FOR UPDATE', [userId]);
  const row = rows[0];
  if (row.day_key !== day) {
    await conn.execute('UPDATE app_reward_usage SET day_key = ?, points_earned = 0 WHERE user_id = ?', [day, userId]);
    row.day_key = day; row.points_earned = 0;
  }
  return row;
}

async function issueTicket(userId, adUnit = '') {
  if (!rewardVerificationReady())
    return {ok: false, error: 'verification_required', message: 'Verified rewards are currently unavailable.'};
  if (typeof adUnit !== 'string' || adUnit !== rewardUnit(Config.UNITY_GAME_ID, Config.UNITY_REWARDED_PLACEMENT))
    return {ok: false, error: 'invalid_unit', message: 'Reward configuration does not match.'};
  return mutateWallet(userId, async (current, conn, economy) => {
    if (!economy.ads_enabled || !economy.ads_rewarded)
      return {error: 'verification_required', message: 'Verified rewards are currently unavailable.'};
    const now = Date.now();
    const usage = await usageForUpdate(conn, Number(userId), now);
    const cap = economy.reward_daily_cap;
    if (cap > 0 && Number(usage.points_earned) + economy.ad_points > cap)
      return {error: 'daily_limit', message: 'Daily reward points limit reached. Try again after 00:00 UTC.'};
    const wait = Math.max(0, Math.ceil((Number(usage.last_issued_at) + economy.reward_cooldown_sec * 1000 - now) / 1000));
    if (wait > 0) return {error: 'reward_cooldown', message: 'Please wait ' + wait + ' seconds before the next reward.', retry_after_seconds: wait};
    const [reserved] = await conn.execute("SELECT COALESCE(SUM(points), 0) AS points FROM app_ad_tickets WHERE user_id = ? AND credited = 0 AND status = 'pending' AND expires_at >= ?", [Number(userId), now]);
    if (cap > 0 && Number(usage.points_earned) + Number(reserved[0].points) + economy.ad_points > cap)
      return {error: 'pending_limit', message: 'Existing rewards are still pending verification. Wait for them to finish or expire.'};
    if (current.points + Number(reserved[0].points) + economy.ad_points > MAX_WALLET_POINTS)
      return {error: 'wallet_limit', message: 'Wallet point limit reached or reserved. Spend points or wait for pending rewards before watching another reward ad.'};
    const ticket = crypto.randomBytes(16).toString('hex');
    await conn.execute(`INSERT INTO app_ad_tickets (user_id, ticket, expires_at, verified, credited, points, ad_unit, created_at_ms)
      VALUES (?, ?, ?, 0, 0, ?, ?, ?)`, [Number(userId), ticket, now + TICKET_TTL_MS, economy.ad_points, adUnit, now]);
    await conn.execute('UPDATE app_reward_usage SET last_issued_at = ? WHERE user_id = ?', [now, Number(userId)]);
    return {extra: {ticket}};
  }, true);
}

// Only the verified Unity S2S handler calls this. Provider and unit are mandatory.
async function creditVerifiedReward(userId, ticket, eventId, adUnit) {
  if (!unityVerificationReady() || adUnit !== rewardUnit(Config.UNITY_GAME_ID, Config.UNITY_REWARDED_PLACEMENT))
    return {ok: false, error: 'verification_required'};
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1 || !/^[a-f0-9]{32}$/.test(String(ticket))
      || !/^(?:unity:[A-Za-z0-9_.:-]{1,122}|unity-hash:[a-f0-9]{64})$/.test(String(eventId))) return {ok: false, error: 'invalid_verification'};
  const result = await mutateWallet(userId, async (current, conn, economy) => {
    const [rows] = await conn.execute('SELECT ticket, expires_at, verified, credited, points, ad_unit, status, reason FROM app_ad_tickets WHERE user_id = ? AND ticket = ? FOR UPDATE', [Number(userId), ticket]);
    const row = rows[0];
    if (!row || row.ad_unit !== adUnit) return {error: 'ticket'};
    const [prior] = await conn.execute('SELECT event_id FROM reward_events WHERE user_id = ? AND ticket = ? FOR UPDATE', [Number(userId), ticket]);
    if (prior.length && prior[0].event_id !== eventId) return {error: 'event_reused'};
    if (Number(row.credited) === 1) return {extra: {credited: true, already_credited: true, credited_points: Number(row.points), added: 0}};
    if (row.status === 'rejected') return {error: row.reason || 'rejected'};
    if (Number(row.expires_at) < Date.now()) {
      await conn.execute("UPDATE app_ad_tickets SET verified = 1, status = 'expired', reason = 'expired' WHERE user_id = ? AND ticket = ?", [Number(userId), ticket]);
      return {error: 'expired'};
    }
    await conn.execute('INSERT INTO reward_events (event_id, user_id, ticket) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE event_id = VALUES(event_id)', [eventId, Number(userId), ticket]);
    const [events] = await conn.execute('SELECT user_id, ticket FROM reward_events WHERE event_id = ? FOR UPDATE', [eventId]);
    if (Number(events[0].user_id) !== Number(userId) || events[0].ticket !== ticket) return {error: 'event_reused'};
    const points = Math.max(0, Number(row.points) || 0);
    if (!Number.isSafeInteger(points) || points < 1 || current.points + points > MAX_WALLET_POINTS) {
      await conn.execute("UPDATE app_ad_tickets SET verified = 1, status = 'rejected', reason = 'wallet_limit' WHERE user_id = ? AND ticket = ?", [Number(userId), ticket]);
      return {error: 'wallet_limit', message: 'The full reward cannot fit in this wallet. No points were credited.'};
    }
    const creditedAt = Date.now();
    const usage = await usageForUpdate(conn, Number(userId), creditedAt);
    if (economy.reward_daily_cap > 0 && Number(usage.points_earned) + points > economy.reward_daily_cap) {
      await conn.execute("UPDATE app_ad_tickets SET verified = 1, status = 'rejected', reason = 'daily_limit' WHERE user_id = ? AND ticket = ?", [Number(userId), ticket]);
      return {error: 'daily_limit'};
    }
    await conn.execute('UPDATE app_reward_usage SET points_earned = points_earned + ?, last_credited_at = ? WHERE user_id = ?', [points, creditedAt, Number(userId)]);
    await conn.execute("UPDATE app_ad_tickets SET verified = 1, credited = 1, status = 'credited', reason = '', credited_at_ms = ? WHERE user_id = ? AND ticket = ?", [creditedAt, Number(userId), ticket]);
    return {wallet: {points: current.points + points}, extra: {credited: true, credited_points: points, added: points}};
  }, true);
  return result;
}

async function rewardStatus(userId, ticket) {
  const economy = await publicConfig();
  const row = /^[a-f0-9]{32}$/.test(String(ticket)) ? await Database.fetchOne('SELECT expires_at, credited, points, status, reason FROM app_ad_tickets WHERE user_id = ? AND ticket = ?', [Number(userId), ticket]) : null;
  if (!row) return {ok: false, error: 'ticket'};
  if (Number(row.credited) === 1) return {ok: true, credited: true, credited_points: Number(row.points), economy, wallet: await getWallet(userId)};
  if (row.status === 'rejected') return {ok: false, error: row.reason || 'rejected', ...(row.reason === 'wallet_limit' ? {message: 'The full reward could not fit in your wallet. No points were credited.'} : {})};
  if (Number(row.expires_at) < Date.now()) return {ok: false, error: 'expired'};
  return {ok: true, credited: false, pending: true, retry_after_ms: 5000};
}

async function earnAd(userId, ticket) {
  // Client completion claims no longer mutate wallets. Genuine server verification credits directly.
  const status = await rewardStatus(userId, ticket);
  if (status.ok && !status.credited) return {...status, ok: false, error: 'verification_pending'};
  return {...status, added: 0, already_credited: Boolean(status.credited)};
}

async function redeem(userId, type) {
  const plan = ['monthly', 'yearly'].includes(type) ? type : '';
  if (!plan) return {ok: false, error: 'bad_plan', economy: await publicConfig(), wallet: await getWallet(userId)};
  return mutateWallet(userId, async (current, conn, economy) => {
    if (!(plan === 'yearly' ? economy.yearly_enabled : economy.monthly_enabled)) return {error: 'plan_off'};
    const cost = plan === 'yearly' ? economy.cost_yearly : economy.cost_monthly;
    const days = plan === 'yearly' ? economy.days_yearly : economy.days_monthly;
    if (current.plan === 'yearly' && plan === 'monthly') return {error: 'active_plan_downgrade'};
    if (current.points < cost) return {error: 'need_points', need: cost};
    return {wallet: {points: current.points - cost, plan, until: Math.max(Date.now(), current.until) + days * 86400000, trial_used: true}};
  }, true);
}

async function startTrial(userId) {
  return mutateWallet(userId, async (current, conn, economy) => {
    if (!economy.trial_enabled || economy.trial_days < 1) return {error: 'trial_off'};
    if (current.plan !== 'free') return {error: 'already_premium'};
    if (current.trial_used) return {error: 'trial_used'};
    return {wallet: {plan: 'trial', until: Date.now() + economy.trial_days * 86400000, trial_used: true}};
  }, true);
}

async function cancelPlan(userId) {
  return {...(await mutateWallet(userId, async () => ({wallet: {plan: 'free', until: 0}}))), economy: await publicConfig()};
}
async function grantPoints(userId, delta) {
  delta = Number(delta);
  if (!Number.isSafeInteger(delta) || Math.abs(delta) > 1000000) throw Object.assign(new Error('Invalid point adjustment.'), {code: 'WALLET_RANGE'});
  return (await mutateWallet(userId, async current => ({wallet: {points: current.points + delta}}))).wallet;
}
async function setPoints(userId, value) {
  value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_WALLET_POINTS) throw Object.assign(new Error('Invalid wallet balance.'), {code: 'WALLET_RANGE'});
  return (await mutateWallet(userId, async () => ({wallet: {points: value}}))).wallet;
}
async function grantPlan(userId, type, daysOverride) {
  const plan = ['yearly', 'trial'].includes(type) ? type : 'monthly';
  return (await mutateWallet(userId, async (current, conn, economy) => {
    const days = clampInt(daysOverride, 0, 1095, 0) || (plan === 'yearly' ? economy.days_yearly : plan === 'trial' ? economy.trial_days : economy.days_monthly);
    return {wallet: {plan, until: Math.max(Date.now(), current.until) + Math.max(1, days) * 86400000, trial_used: true}};
  }, true)).wallet;
}

async function resetTrial(userId) {
  return (await mutateWallet(userId, async () => ({wallet: {trial_used: false}}))).wallet;
}

function prepareAppSettings(body, previous, reset = false) {
  body = body || {};
  const next = {};
  const put = (key, value) => { next[key] = String(value); };
  const flag = key => {
    if (!Object.hasOwn(body, key)) return '0';
    const value = parseFlag(body[key]);
    if (value === null) throw new Error('Invalid toggle: ' + key);
    return value ? '1' : '0';
  };
  const integer = (key, min, max, fallback) => {
    const raw = Object.hasOwn(body, key) ? body[key] : fallback;
    if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('Invalid number: ' + key);
    const value = String(raw).trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Out-of-range number: ' + key);
    return String(Number(value));
  };
  if (reset) {
    for (const [key, value] of Object.entries(DEFAULTS)) if (key.startsWith('APP_')) put(key, value);
  } else {
    put('APP_ADS_ENABLED', flag('ads_enabled'));
    put('APP_ADS_BANNER', flag('ads_banner'));
    put('APP_ADS_INTERSTITIAL', flag('ads_interstitial'));
    put('APP_ADS_REWARDED', flag('ads_rewarded'));
    put('APP_ADS_INTER_EVERY', flag('ads_inter_every'));
    put('APP_ADS_REWARD_EVERY', flag('ads_reward_every'));
    put('APP_ADS_HOME_BANNERS', flag('ads_home_banners'));
    put('APP_ADS_BANNER_TOP', flag('ads_banner_top'));
    put('APP_INTER_GAP_SEC', integer('inter_gap_sec', 0, 120, 6));
    put('APP_AD_POINTS', integer('ad_points', 1, 500, 50));
    put('APP_COST_MONTHLY', integer('cost_monthly', 0, 100000, 500));
    put('APP_COST_YEARLY', integer('cost_yearly', 0, 500000, 4500));
    put('APP_TRIAL_ENABLED', flag('trial_enabled'));
    put('APP_TRIAL_DAYS', integer('trial_days', 1, 90, 14));
    put('APP_MONTHLY_ENABLED', flag('monthly_enabled'));
    put('APP_YEARLY_ENABLED', flag('yearly_enabled'));
    put('APP_DAYS_MONTHLY', integer('days_monthly', 1, 365, 30));
    put('APP_DAYS_YEARLY', integer('days_yearly', 1, 1095, 365));
    put('APP_LABEL_TRIAL', clipStr(body.label_trial, 40, DEFAULTS.APP_LABEL_TRIAL));
    put('APP_BLURB_TRIAL', clipStr(body.blurb_trial, 160, DEFAULTS.APP_BLURB_TRIAL));
    put('APP_LABEL_MONTHLY', clipStr(body.label_monthly, 40, DEFAULTS.APP_LABEL_MONTHLY));
    put('APP_BLURB_MONTHLY', clipStr(body.blurb_monthly, 160, DEFAULTS.APP_BLURB_MONTHLY));
    put('APP_LABEL_YEARLY', clipStr(body.label_yearly, 40, DEFAULTS.APP_LABEL_YEARLY));
    put('APP_BLURB_YEARLY', clipStr(body.blurb_yearly, 160, DEFAULTS.APP_BLURB_YEARLY));
    put('APP_REWARD_DAILY_CAP', integer('reward_daily_cap', 0, 100000, Number(previous.APP_REWARD_DAILY_CAP)));
    put('APP_REWARD_COOLDOWN_SEC', integer('reward_cooldown_sec', 0, 86400, Number(previous.APP_REWARD_COOLDOWN_SEC)));
    put('APP_AD_DIAGNOSTICS', Object.hasOwn(body, 'diagnostics_present') ? flag('ads_diagnostics') : previous.APP_AD_DIAGNOSTICS);
  }
  if (Number(next.APP_REWARD_DAILY_CAP) > 0 && Number(next.APP_REWARD_DAILY_CAP) < Number(next.APP_AD_POINTS)) throw new Error('Daily cap must cover at least one rewarded ad, or be 0 for unlimited.');
  return next;
}
function settingChanges(previous, next) {
  return Object.entries(next).filter(([key, value]) => String(previous[key]) !== value)
    .map(([key, after]) => ({key, before: String(previous[key]), after}));
}
async function previewAppSettings(body) {
  const previous = await rawMap(true);
  if (submittedRevision(body) !== configRevision(previous)) throw settingsConflict();
  const next = prepareAppSettings(body, previous);
  const points = Number(next.APP_AD_POINTS), cap = Number(next.APP_REWARD_DAILY_CAP);
  const rewardsPerDay = cap === 0 ? null : Math.floor(cap / points);
  const plan = (name, costKey, enabledKey) => {
    const cost = Number(next[costKey]);
    const rewards = Math.ceil(cost / points);
    return {name, enabled: next[enabledKey] === '1', cost, rewards,
      minimum_days: rewards === 0 ? 0 : rewardsPerDay === null ? null : Math.ceil(rewards / rewardsPerDay)};
  };
  return {read_only: true, settings_revision: configRevision(previous), read_at: new Date().toISOString(), changes: settingChanges(previous, next),
    points_per_reward: points, daily_cap: cap, rewards_per_day: rewardsPerDay,
    cooldown_seconds: Number(next.APP_REWARD_COOLDOWN_SEC),
    earning_enabled: next.APP_ADS_ENABLED === '1' && next.APP_ADS_REWARDED === '1',
    verification_configured: rewardVerificationReady(),
    plans: [plan('Monthly', 'APP_COST_MONTHLY', 'APP_MONTHLY_ENABLED'), plan('Yearly', 'APP_COST_YEARLY', 'APP_YEARLY_ENABLED')]};
}

async function saveAppSettings(body, actor, reset = false) {
  if (!actor || !Number.isSafeInteger(Number(actor.id)) || !['owner', 'super_admin'].includes(actor.role)) throw new Error('Unauthorized settings actor');
  body = body || {};
  const expected = submittedRevision(body);
  await ensureRevision();
  await Database.transaction(async conn => {
    const [revisionRows] = await conn.execute("SELECT setting_value FROM site_setting WHERE setting_key = 'APP_ADS_CONFIG_REVISION' FOR UPDATE");
    if (!revisionRows.length || configRevision({[REVISION_KEY]: revisionRows[0].setting_value}) !== expected) throw settingsConflict();
    const [rows] = await conn.execute("SELECT setting_key, setting_value FROM site_setting WHERE setting_key LIKE 'APP_%'");
    const previous = {...DEFAULTS};
    for (const row of rows) if (Object.hasOwn(DEFAULTS, row.setting_key)) previous[row.setting_key] = String(row.setting_value);
    const next = prepareAppSettings(body, previous, reset);
    const changes = settingChanges(previous, next);
    for (const [key, value] of Object.entries(next)) {
      await conn.execute('INSERT INTO site_setting (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value]);
    }
    await conn.execute("UPDATE site_setting SET setting_value = CAST(setting_value AS UNSIGNED) + 1 WHERE setting_key = 'APP_ADS_CONFIG_REVISION'");
    await conn.execute('INSERT INTO app_ads_settings_history (actor_id, actor_name, action, changes_json, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())', [Number(actor.id), String(actor.username || '').slice(0, 100), reset ? 'restore_defaults' : 'save', JSON.stringify(changes)]);
  });
  return publicConfig(true);
}

module.exports = {
  DEFAULTS,
  rawMap,
  setKey,
  publicConfig,
  adminConfig,
  siteAdsEnabled,
  siteAdsFromMap,
  getWallet,
  payload,
  syncFromClient,
  issueTicket,
  rewardVerificationReady,
  rewardStatus,
  creditVerifiedReward,
  earnAd,
  redeem,
  startTrial,
  cancelPlan,
  grantPoints,
  setPoints,
  grantPlan,
  resetTrial,
  saveAppSettings,
  previewAppSettings,
};
