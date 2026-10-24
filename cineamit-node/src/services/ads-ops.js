'use strict';
const crypto = require('crypto');
const Database = require('../db');
const Config = require('../core/config');
const Economy = require('./economy');

const PAGE_SIZE = 20;
const FORMATS = ['sdk', 'banner', 'interstitial', 'rewarded'];
const STAGES = ['init', 'load', 'show'];
const OUTCOMES = ['success', 'failure', 'started', 'completed', 'skipped'];
const EVENT_FIELDS = ['format', 'stage', 'outcome', 'code', 'app_version', 'app_code', 'sdk_version', 'config_fingerprint', 'test_mode', 'unit'];
function cleanText(value, max, pattern) {
  if (typeof value !== 'string' || !value.length || value.length > max || !pattern.test(value)) throw new Error('Invalid diagnostic metadata.');
  return value;
}
function validateEvents(body) {
  if (!body || Object.keys(body).some(k => k !== 'events') || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 10) throw new Error('Send 1–10 diagnostic events.');
  return body.events.map(e => {
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k => !EVENT_FIELDS.includes(k))) throw new Error('Unsupported diagnostic fields.');
    if (!FORMATS.includes(e.format) || !STAGES.includes(e.stage) || !OUTCOMES.includes(e.outcome) || typeof e.test_mode !== 'boolean') throw new Error('Invalid diagnostic category.');
    if (!Number.isSafeInteger(e.app_code) || e.app_code < 1 || e.app_code > 1000000000) throw new Error('Invalid app version code.');
    return {
      format: e.format, stage: e.stage, outcome: e.outcome,
      code: cleanText(e.code, 64, /^[A-Za-z0-9_.:-]+$/),
      app_version: cleanText(e.app_version, 32, /^[A-Za-z0-9_.-]+$/), app_code: e.app_code,
      sdk_version: cleanText(e.sdk_version, 32, /^[A-Za-z0-9_.-]+$/),
      config_fingerprint: cleanText(e.config_fingerprint, 12, /^[a-f0-9]{12}$/),
      test_mode: e.test_mode, unit: e.unit === '' ? '' : cleanText(e.unit, 60, /^[A-Za-z0-9_-]+$/),
    };
  });
}
async function storeEvents(userId, events) {
  const accepted = await Database.transaction(async conn => {
    const [users] = await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!users.length) throw new Error('Account unavailable.');
    for (const e of events) await conn.execute(`INSERT INTO app_ad_diagnostics
      (id, user_id, format, stage, outcome, code, app_version, app_code, sdk_version, config_fingerprint, test_mode, unit, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [crypto.randomBytes(16).toString('hex'), userId, e.format, e.stage, e.outcome, e.code, e.app_version, e.app_code, e.sdk_version, e.config_fingerprint, e.test_mode ? 1 : 0, e.unit]);
    return events.length;
  });
  await Database.opportunisticGc();
  return accepted;
}
async function noteVerifiedCallback(outcome) {
  const safe = /^[a-z_]{1,32}$/.test(String(outcome)) ? outcome : 'processed';
  await Database.execute(`INSERT INTO app_ads_callback_health (id, verified_at, outcome) VALUES (1, ?, ?)
    ON DUPLICATE KEY UPDATE verified_at = VALUES(verified_at), outcome = VALUES(outcome)`, [Date.now(), safe]);
}
function page(value) {
  const s = String(value == null ? '' : value);
  const n = /^\d+$/.test(s) ? Number(s) : 1;
  return Number.isSafeInteger(n) && n >= 1 && n <= Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE) ? n : 1;
}
function fitPage(filters, field, total) {
  filters[field] = String(Math.min(page(filters[field]), Math.max(1, Math.ceil(Number(total) / PAGE_SIZE))));
}
function stamp(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Not recorded'; }
function links(filters, field, current, total) {
  const url = n => '/cineamit-admin?' + new URLSearchParams({...filters, [field]: String(n)}).toString() + '#tab-economy';
  return {prev: current > 1 ? url(current - 1) : '', next: current * PAGE_SIZE < total ? url(current + 1) : ''};
}
function text(value, max = 80) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function normalizeFilters(query = {}) {
  const filters = {
    reward_q: text(query.reward_q), reward_state: ['pending', 'credited', 'rejected', 'expired'].includes(query.reward_state) ? query.reward_state : '',
    reward_page: String(page(query.reward_page)), diag_page: String(page(query.diag_page)), history_page: String(page(query.history_page)),
    diag_format: FORMATS.includes(query.diag_format) ? query.diag_format : '', diag_outcome: OUTCOMES.includes(query.diag_outcome) ? query.diag_outcome : '',
    summary_user: text(query.summary_user, 12), history_q: text(query.history_q),
    history_action: ['save', 'restore_defaults'].includes(query.history_action) ? query.history_action : '',
    history_from: text(query.history_from, 32), history_to: text(query.history_to, 32),
  };
  for (const key of ['history_from', 'history_to']) {
    const value = filters[key];
    if (value && (!/^[1-9][0-9]{3}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)) throw Object.assign(new Error('Invalid history date filter.'), {code: 'ADS_FILTER'});
  }
  if (filters.history_from && filters.history_to && filters.history_from > filters.history_to) throw Object.assign(new Error('History date range is reversed.'), {code: 'ADS_FILTER'});
  return filters;
}
const likeText = value => '%' + value.replace(/[=%_]/g, '=$&') + '%';
const STATUS_EXPR = "CASE WHEN t.credited = 1 THEN 'credited' WHEN t.status = 'rejected' THEN 'rejected' WHEN t.expires_at < ? THEN 'expired' ELSE 'pending' END";
function claimWhere(filters, now) {
  const where = [], args = [];
  if (filters.reward_q) {
    where.push("(u.username LIKE ? ESCAPE '=' OR CAST(t.user_id AS CHAR) = ? OR t.ticket LIKE ? ESCAPE '=')");
    args.push(likeText(filters.reward_q), filters.reward_q, likeText(filters.reward_q));
  }
  if (filters.reward_state) { where.push(STATUS_EXPR + ' = ?'); args.push(now, filters.reward_state); }
  return {clause: where.length ? ' WHERE ' + where.join(' AND ') : '', args};
}
function historyWhere(filters) {
  const where = [], args = [];
  if (filters.history_q) { where.push("(actor_name LIKE ? ESCAPE '=' OR CAST(actor_id AS CHAR) = ?)"); args.push(likeText(filters.history_q), filters.history_q); }
  if (filters.history_action) { where.push('action = ?'); args.push(filters.history_action); }
  if (filters.history_from) { where.push('created_at >= ?'); args.push(filters.history_from + ' 00:00:00'); }
  if (filters.history_to) { where.push('created_at <= ?'); args.push(filters.history_to + ' 23:59:59'); }
  return {clause: where.length ? ' WHERE ' + where.join(' AND ') : '', args};
}
function historyRecord(raw) {
  let parsed; try { parsed = JSON.parse(raw); } catch { return {changes: [], audit_status: 'unreadable'}; }
  if (!Array.isArray(parsed)) return {changes: [], audit_status: 'unreadable'};
  const changes = [];
  let partial = parsed.length > 40;
  const scalar = value => value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value));
  for (const c of parsed.slice(0, 40)) {
    if (!c || typeof c.key !== 'string' || !c.key.startsWith('APP_') || !Object.hasOwn(Economy.DEFAULTS, c.key)
      || !Object.hasOwn(c, 'before') || !Object.hasOwn(c, 'after') || !scalar(c.before) || !scalar(c.after)) { partial = true; continue; }
    changes.push({key: c.key, before: c.before == null ? '' : String(c.before), after: c.after == null ? '' : String(c.after)});
  }
  // Never expose raw invalid/private data, but never call it a valid no-op either.
  return {changes, audit_status: partial ? 'partial' : 'valid'};
}

async function dailySummary(selected, config, now) {
  const day = new Date(now).toISOString().slice(0, 10), cap = config.reward_daily_cap;
  const totals = await Database.fetchOne(`SELECT COALESCE(SUM(points_earned), 0) AS points,
    COALESCE(SUM(CASE WHEN ? > 0 AND points_earned >= ? THEN 1 ELSE 0 END), 0) AS at_cap
    FROM app_reward_usage WHERE day_key = ?`, [cap, cap, day]);
  const reservations = await Database.fetchOne("SELECT COUNT(*) AS claims, COALESCE(SUM(points), 0) AS points FROM app_ad_tickets WHERE credited = 0 AND status = 'pending' AND expires_at >= ?", [now]);
  const result = {day, cap, verified_points: Number(totals.points), cap_reached_users: Number(totals.at_cap),
    pending_claims: Number(reservations.claims), reserved_points: Number(reservations.points), selected: null, selection_error: ''};
  if (!selected) return result;
  if (!/^[1-9][0-9]{0,9}$/.test(selected) || Number(selected) > 2147483647) { result.selection_error = 'Enter a valid numeric account ID.'; return result; }
  const user = await Database.fetchOne('SELECT u.id, u.username, r.day_key, r.points_earned, r.last_issued_at FROM users u LEFT JOIN app_reward_usage r ON r.user_id = u.id WHERE u.id = ?', [Number(selected)]);
  if (!user) { result.selection_error = 'Account not found.'; return result; }
  const pending = await Database.fetchOne("SELECT COALESCE(SUM(points), 0) AS points FROM app_ad_tickets WHERE user_id = ? AND credited = 0 AND status = 'pending' AND expires_at >= ?", [Number(selected), now]);
  const earned = user.day_key === day ? Number(user.points_earned) : 0, reserved = Number(pending.points);
  result.selected = {id: user.id, username: user.username, earned, reserved,
    remaining: cap === 0 ? null : Math.max(0, cap - earned), admission_room: cap === 0 ? null : Math.max(0, cap - earned - reserved),
    cooldown_seconds: Math.max(0, Math.ceil(((Number(user.last_issued_at) || 0) + config.reward_cooldown_sec * 1000 - now) / 1000))};
  return result;
}
async function configurationWarnings() {
  const placement = String(Config.UNITY_REWARDED_PLACEMENT || '');
  const stats = await Database.fetchOne(`SELECT COUNT(*) AS reports, COUNT(DISTINCT config_fingerprint) AS fingerprints,
    COUNT(DISTINCT BINARY CONCAT(app_code, ':', app_version)) AS versions,
    COALESCE(SUM(CASE WHEN test_mode = 1 THEN 1 ELSE 0 END), 0) AS test_reports,
    COALESCE(SUM(CASE WHEN format = 'rewarded' AND unit <> '' AND BINARY unit <> BINARY ? THEN 1 ELSE 0 END), 0) AS mismatches
    FROM app_ad_diagnostics WHERE received_at >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)`, [placement]);
  const rows = await Database.fetchAll(`SELECT MIN(app_version) AS app_version, app_code, config_fingerprint, test_mode, format, MIN(unit) AS unit,
    COUNT(*) AS reports, COUNT(DISTINCT user_id) AS reporting_accounts, MAX(received_at) AS last_seen
    FROM app_ad_diagnostics WHERE received_at >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)
    GROUP BY BINARY app_version, app_code, config_fingerprint, test_mode, format, BINARY unit
    ORDER BY last_seen DESC, app_code DESC, config_fingerprint ASC, format ASC, unit ASC LIMIT 51`);
  const warnings = [];
  if (!Number(stats.reports)) warnings.push({level: 'info', message: 'No recent client reports. Configuration agreement cannot be assessed.'});
  if (Number(stats.test_reports)) warnings.push({level: 'warning', message: Number(stats.test_reports) + ' client reports declare TEST mode. Check the intended build; reports are untrusted.'});
  if (Number(stats.versions) > 1) warnings.push({level: 'info', message: Number(stats.versions) + ' app versions reported. Mixed versions can be a normal rollout.'});
  if (Number(stats.fingerprints) > 1) warnings.push({level: 'info', message: Number(stats.fingerprints) + ' configuration fingerprints reported. Different fingerprints are not proof of broken ads.'});
  if (!placement) warnings.push({level: 'warning', message: 'Server rewarded placement is not configured; reported placements cannot be compared.'});
  else if (Number(stats.mismatches)) warnings.push({level: 'warning', message: Number(stats.mismatches) + ' rewarded reports name a placement different from the current server reward binding. Check build configuration.'});
  if (Number(stats.reports) && !warnings.length) warnings.push({level: 'info', message: 'No warning found in recent reports. This is not verified configuration or delivery proof.'});
  return {warnings, groups: rows.slice(0, 50), truncated: rows.length > 50, reports: Number(stats.reports), expected_rewarded: placement};
}
const EXPORT_LIMIT = 2000;
function csvCell(value) {
  let s = String(value == null ? '' : value).replace(/\0/g, '');
  if (/^[\s\uFEFF]*[=+\-@]/u.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function csv(rows) { return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
async function exportCsv(kind, query = {}) {
  if (!['rewards', 'history'].includes(kind)) throw new Error('Unknown export.');
  const filters = normalizeFilters(query), now = Date.now();
  let rows, data;
  if (kind === 'rewards') {
    const {clause, args} = claimWhere(filters, now);
    rows = await Database.fetchAll('SELECT t.user_id, u.username, t.ticket, t.created_at_ms, t.credited_at_ms, t.points, t.reason, ' + STATUS_EXPR + ' AS display_status FROM app_ad_tickets t LEFT JOIN users u ON u.id = t.user_id' + clause + ' ORDER BY t.created_at_ms DESC, t.expires_at DESC, t.ticket ASC LIMIT ' + (EXPORT_LIMIT + 1), [now, ...args]);
    data = [['user_id', 'username', 'ticket_reference_masked', 'issued_utc', 'credited_utc', 'points', 'state', 'reason'],
      ...rows.slice(0, EXPORT_LIMIT).map(r => [r.user_id, r.username, r.ticket.slice(0, 8) + '…' + r.ticket.slice(-4), stamp(r.created_at_ms), stamp(r.credited_at_ms), r.points, r.display_status,
        ({daily_limit: 'Daily earned points cap reached', wallet_limit: 'Full reward cannot fit in wallet; no points credited', expired: 'Ticket expired'})[r.reason] || (r.reason ? 'Rejected (reason unavailable)' : '')])];
  } else {
    const {clause, args} = historyWhere(filters);
    rows = await Database.fetchAll('SELECT actor_id, actor_name, action, changes_json, created_at FROM app_ads_settings_history' + clause + ' ORDER BY id DESC LIMIT ' + (EXPORT_LIMIT + 1), args);
    data = [['time_utc', 'actor_id', 'actor_name', 'action', 'setting', 'before', 'after', 'audit_status']];
    for (const row of rows.slice(0, EXPORT_LIMIT)) {
      const {changes, audit_status} = historyRecord(row.changes_json);
      for (const change of changes.length ? changes : [{key: '', before: '', after: ''}]) data.push([row.created_at, row.actor_id, row.actor_name, row.action, change.key, change.before, change.after, audit_status]);
    }
  }
  const truncated = rows.length > EXPORT_LIMIT;
  return {body: csv(data), source_rows: Math.min(rows.length, EXPORT_LIMIT), truncated,
    filename: 'app-ads-' + kind + '-' + new Date(now).toISOString().slice(0, 10) + (truncated ? '-truncated' : '') + '.csv'};
}

async function dashboard(query = {}) {
  await Database.opportunisticGc();
  const filters = normalizeFilters(query), now = Date.now();
  const {clause, args} = claimWhere(filters, now);
  const claimCount = await Database.fetchOne('SELECT COUNT(*) AS c FROM app_ad_tickets t LEFT JOIN users u ON u.id = t.user_id' + clause, args);
  fitPage(filters, 'reward_page', claimCount.c);
  const claims = await Database.fetchAll('SELECT t.*, u.username, ' + STATUS_EXPR + ' AS display_status FROM app_ad_tickets t LEFT JOIN users u ON u.id = t.user_id' + clause + ' ORDER BY t.created_at_ms DESC, t.expires_at DESC, t.ticket ASC LIMIT 20 OFFSET ' + ((page(filters.reward_page) - 1) * PAGE_SIZE), [now, ...args]);
  const diagWhere = [], diagArgs = [];
  if (filters.diag_format) { diagWhere.push('d.format = ?'); diagArgs.push(filters.diag_format); }
  if (filters.diag_outcome) { diagWhere.push('d.outcome = ?'); diagArgs.push(filters.diag_outcome); }
  const dc = diagWhere.length ? ' WHERE ' + diagWhere.join(' AND ') : '';
  const diagCount = await Database.fetchOne('SELECT COUNT(*) AS c FROM app_ad_diagnostics d' + dc, diagArgs);
  fitPage(filters, 'diag_page', diagCount.c);
  const diagnostics = await Database.fetchAll('SELECT d.*, u.username FROM app_ad_diagnostics d LEFT JOIN users u ON u.id = d.user_id' + dc + ' ORDER BY d.received_at DESC, d.id DESC LIMIT 20 OFFSET ' + ((page(filters.diag_page) - 1) * PAGE_SIZE), diagArgs);
  const hw = historyWhere(filters);
  const historyCount = await Database.fetchOne('SELECT COUNT(*) AS c FROM app_ads_settings_history' + hw.clause, hw.args);
  fitPage(filters, 'history_page', historyCount.c);
  const history = await Database.fetchAll('SELECT * FROM app_ads_settings_history' + hw.clause + ' ORDER BY id DESC LIMIT 20 OFFSET ' + ((page(filters.history_page) - 1) * PAGE_SIZE), hw.args);
  const summary = await dailySummary(filters.summary_user, await Economy.publicConfig(true), now);
  const configWarnings = await configurationWarnings();
  const callback = await Database.fetchOne('SELECT verified_at, outcome FROM app_ads_callback_health WHERE id = 1');
  const latestClient = await Database.fetchOne('SELECT app_version, sdk_version, config_fingerprint, test_mode, received_at FROM app_ad_diagnostics ORDER BY received_at DESC, id DESC LIMIT 1');
  return {
    available: true, filters, binding_configured: Boolean(Config.UNITY_GAME_ID && Config.UNITY_REWARDED_PLACEMENT),
    verification_configured: Boolean(Config.UNITY_S2S_ENABLED && Config.UNITY_S2S_SECRET.length >= 32 && Config.UNITY_GAME_ID && Config.UNITY_REWARDED_PLACEMENT),
    callback_seen: Boolean(callback && Number(callback.verified_at) > 0), callback_at: stamp(callback && callback.verified_at),
    callback_outcome: callback ? callback.outcome : '', pending: summary.pending_claims, daily_points: summary.verified_points,
    latest_client: latestClient, summary, config_warnings: configWarnings,
    claim_export_url: '/admin/app_ads/export/rewards?' + new URLSearchParams(filters).toString(),
    history_export_url: '/admin/app_ads/export/history?' + new URLSearchParams(filters).toString(),
    claims: claims.map(t => ({...t, ticket_short: t.ticket.slice(0, 8) + '…' + t.ticket.slice(-4), issued_label: stamp(t.created_at_ms), credited_label: stamp(t.credited_at_ms)})),
    claim_total: Number(claimCount.c), claim_links: links(filters, 'reward_page', page(filters.reward_page), Number(claimCount.c)),
    diagnostics, diag_total: Number(diagCount.c), diag_links: links(filters, 'diag_page', page(filters.diag_page), Number(diagCount.c)),
    history: history.map(h => { const {changes_json, ...safe} = h; return {...safe, ...historyRecord(changes_json)}; }),
    history_total: Number(historyCount.c), history_links: links(filters, 'history_page', page(filters.history_page), Number(historyCount.c)),
  };
}
module.exports = { validateEvents, storeEvents, noteVerifiedCallback, dashboard, exportCsv, csvCell, normalizeFilters };
