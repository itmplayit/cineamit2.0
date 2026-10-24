'use strict';

const Database = require('../db');
const Security = require('../security');

function apply(app, profile, user) {
  app.session.active_profile_id = Number(profile.id);
  app.session.active_profile_uid = Number(user.id);
  app.session.active_profile_name = String(profile.name || user.username);
  app.session.active_profile_color = String(profile.avatar_color || 'bg-red-600');
  app.session.is_kids = Number(profile.is_kids) === 1;
  app.session.autoplay_next = Number(profile.autoplay_next ?? 1) === 1;
  let preferences = {};
  try { preferences = JSON.parse(profile.preferences || '{}'); } catch {}
  app.session.language = ['en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr'].includes(preferences.language) ? preferences.language : 'en';
  return profile;
}

// Resolve ownership before every write. Legacy accounts receive a default profile lazily.
async function ensureActive(app, user) {
  const pid = Number(app.session.active_profile_id || 0);
  let profile = pid > 0 ? await Database.fetchOne('SELECT * FROM user_profiles WHERE id = ? AND user_id = ?', [pid, user.id]) : null;
  if (!profile) {
    profile = await Database.fetchOne('SELECT * FROM user_profiles WHERE user_id = ?' + (app.session.is_kids ? ' AND is_kids = 1' : '') + ' ORDER BY id ASC LIMIT 1', [user.id]);
  }
  if (!profile && app.session.is_kids) return null; // Never silently escape a deleted Kids profile.
  if (!profile) {
    await Database.transaction(async conn => {
      const [users] = await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
      if (!users.length) throw new Error('Account unavailable');
      const [rows] = await conn.execute('SELECT * FROM user_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1', [user.id]);
      if (rows.length) { profile = rows[0]; return; }
      const [created] = await conn.execute('INSERT INTO user_profiles (user_id, name, is_kids, avatar_color) VALUES (?, ?, 0, ?)', [user.id, String(user.username || 'Profile').slice(0, 50), 'bg-red-600']);
      profile = {id: created.insertId, user_id: user.id, name: user.username, is_kids: 0, avatar_color: 'bg-red-600', autoplay_next: 1};
    });
  }
  return apply(app, profile, user);
}

async function authorizeManagement(app, user) {
  if (app.session.is_kids) return {ok: false, error: 'adult_required'};
  const password = String((app.req.body && (app.req.body.confirm_password || app.req.body.current_password)) || '');
  if (!(await app.throttle('profile_manage_' + user.id, 10, 900))) return {ok: false, error: 'locked'};
  if (!password || !(await Security.checkPasswordHash(String(user.password || ''), password))) return {ok: false, error: 'password_required'};
  return {ok: true};
}

async function select(app, user, profile, pin) {
  if (!profile || Number(profile.user_id) !== Number(user.id)) return {ok: false, error: 'not_found'};
  const key = 'pin_' + user.id;
  if (profile.pin && !(await app.throttle(key, 5, 900))) return {ok: false, error: 'locked'};
  if (profile.pin && !(await Security.checkPasswordHash(String(profile.pin), String(pin || '')))) {
    return {ok: false, error: 'bad_pin'};
  }
  if (app.session.is_kids && Number(profile.is_kids) !== 1 && !profile.pin) return {ok: false, error: 'adult_pin_required'};
  await app.resetThrottle(key);
  // Tokens from the previous profile must not survive a profile switch.
  delete app.session.cine_player_access_v1;
  delete app.session.cine_download_access_v1;
  apply(app, profile, user);
  return {ok: true};
}

async function add(user, name, isKids, color) {
  return Database.transaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    const [rows] = await conn.execute('SELECT id FROM user_profiles WHERE user_id = ?', [user.id]);
    if (rows.length >= 5) return {ok: false, error: 'limit'};
    await conn.execute('INSERT INTO user_profiles (user_id, name, is_kids, avatar_color) VALUES (?, ?, ?, ?)', [user.id, name, isKids ? 1 : 0, color]);
    return {ok: true};
  });
}
async function remove(app, user, pid) {
  const result = await Database.transaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    const [rows] = await conn.execute('SELECT id FROM user_profiles WHERE user_id = ? FOR UPDATE', [user.id]);
    if (rows.length <= 1) return {ok: false, error: 'last_profile'};
    if (!rows.some(row => Number(row.id) === Number(pid))) return {ok: false, error: 'not_found'};
    await conn.execute('DELETE FROM user_profiles WHERE id = ? AND user_id = ?', [pid, user.id]);
    return {ok: true};
  });
  if (result.ok) {
    delete app.session.cine_player_access_v1; delete app.session.cine_download_access_v1;
    await ensureActive(app, user);
  }
  return result;
}
module.exports = {apply, ensureActive, authorizeManagement, select, add, remove};
