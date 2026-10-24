'use strict';
const Database = require('../db');
const Profiles = require('./profiles');

async function recordStart(app, user, details, mediaType) {
  if (!user || !details || !Number.isInteger(Number(details.id)) || Number(details.id) < 1) return false;
  const profile = await Profiles.ensureActive(app, user);
  if (!profile) throw new Error('profile_required');
  const title = String(details.title || details.name || 'Untitled').slice(0, 255);
  const genres = (details.genres || []).filter(g => g && g.name).slice(0, 3).map(g => String(g.name)).join(',').slice(0, 255);
  await Database.transaction(async conn => {
    const [rows] = await conn.execute('SELECT last_watch_date, binge_streak FROM user_profiles WHERE id = ? AND user_id = ? FOR UPDATE', [profile.id, user.id]);
    if (!rows.length) throw new Error('profile_required');
    const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() + 19800000 - 86400000).toISOString().slice(0, 10);
    const last = String(rows[0].last_watch_date || '').slice(0, 10);
    const streak = last === today ? Number(rows[0].binge_streak || 1) : (last === yesterday ? Number(rows[0].binge_streak || 0) + 1 : 1);
    await conn.execute('UPDATE user_profiles SET last_watch_date = ?, binge_streak = ? WHERE id = ? AND user_id = ?', [today, streak, profile.id, user.id]);
    await conn.execute(`INSERT INTO watch_history (user_id, profile_id, tmdb_id, media_type, title, poster_path, watch_time, genres)
      VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)
      ON DUPLICATE KEY UPDATE title = VALUES(title), poster_path = VALUES(poster_path), watch_time = UTC_TIMESTAMP(), genres = VALUES(genres)`,
    [user.id, profile.id, Number(details.id), mediaType, title, details.poster_path || null, genres]);
  });
  return true;
}

// Adult account library includes legacy/orphaned rows and other adult profiles,
// but never silently includes Kids activity. Child libraries remain profile-only.
async function scope(app, user) {
  const profile = await Profiles.ensureActive(app, user);
  if (app.session.is_kids) return {clause: 'user_id = ? AND profile_id = ?', params: [user.id, profile ? profile.id : -1]};
  return {clause: 'user_id = ? AND (profile_id IS NULL OR profile_id NOT IN (SELECT id FROM user_profiles WHERE user_id = ? AND is_kids = 1))', params: [user.id, user.id]};
}

function dedupe(rows) {
  const seen = new Set();
  return (rows || []).filter(row => {
    const key = String(row.media_type || 'movie') + ':' + row.tmdb_id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
module.exports = {recordStart, scope, dedupe};
