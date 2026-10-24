'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('../../db');
const { add } = require('../../core/router');

function partySanitizeUsername(raw) {
  let u = String(raw || '').trim().replace(/<[^>]+>/g, '');
  u = u.replace(/[^\p{L}\p{N}_.\-\s]/gu, '').trim();
  if (!u) return 'Guest';
  return [...u].slice(0, 30).join('');
}

async function partyResolveUsername(app, raw) {
  try {
    if (await app.isAuthenticated()) {
      const prof = String(app.session.active_profile_name || '');
      if (prof) return partySanitizeUsername(prof);
      const u = await app.currentUser();
      if (u && u.username) return partySanitizeUsername(u.username);
    }
  } catch {}
  let guest = partySanitizeUsername(raw);
  if (guest === 'Guest') return 'Guest';
  try {
    let isTaken = !!(await Database.fetchOne('SELECT id FROM users WHERE username = ? LIMIT 1', [guest]));
    if (!isTaken) isTaken = !!(await Database.fetchOne('SELECT id FROM user_profiles WHERE name = ? LIMIT 1', [guest]));
    if (isTaken) guest = [...guest].slice(0, 22).join('') + ' (guest)';
  } catch {}
  return guest;
}

module.exports = function registerParty() {
  add('/api/party/join', 'party.join', async (app) => {
    app.res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    if (!(await app.isAuthenticated())) { app.res.status(401); return app.json({ok: false, error: 'login_required'}); }
    const data = app.req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid_json' });
    }
    const username = await partyResolveUsername(app, data.username || 'Guest');
    const room = String(data.room || '').trim().slice(0, 50);
    if (!room || !/^[\w-]{2,50}$/i.test(room)) return app.json({ ok: false, error: 'invalid_room' });
    const recent = await Database.fetchOne(
      "SELECT id FROM party_messages WHERE room = ? AND username = ? AND msg_type = 'system' AND created_at > (NOW() - INTERVAL 5 MINUTE) LIMIT 1",
      [room, username]
    );
    if (!recent && await app.throttle('party_join', 30, 300)) {
      await Database.execute("INSERT INTO party_messages (room, username, msg_type, msg) VALUES (?, ?, 'system', ?)", [room, username, username + ' joined the party!']);
    }
    const last = await Database.fetchOne('SELECT MAX(id) AS m FROM party_messages WHERE room = ?', [room]);
    return app.json({ ok: true, last_id: Number((last && last.m) || 0) });
  }, ['POST']);

  add('/api/party/send', 'party.send', async (app) => {
    app.res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    if (!(await app.throttle('party_send', 10, 60))) return app.json({ ok: false, error: 'slow_down' });
    const data = app.req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid_json' });
    }
    const username = await partyResolveUsername(app, data.username || 'Guest');
    const room = String(data.room || '').trim().slice(0, 50);
    const msg = String(data.msg || '').trim();
    if (!room || !msg) return app.json({ ok: false });
    if (!/^[\w-]{2,50}$/i.test(room)) return app.json({ ok: false, error: 'invalid_room' });
    if (!(await app.throttle('party_send_room_' + room.toLowerCase(), 5, 60))) return app.json({ ok: false, error: 'slow_down' });
    if (/(.)\1{24,}/u.test(msg)) return app.json({ ok: false, error: 'spam_guard' });
    const pgcGuard = path.join(os.tmpdir(), 'cineamit_partygc_' + crypto.createHash('md5').update(__dirname).digest('hex').slice(0, 8));
    let pgcLast = 0;
    try { pgcLast = fs.statSync(pgcGuard).mtimeMs / 1000; } catch {}
    if (pgcLast === 0 || (Date.now() / 1000 - pgcLast) >= 3600) {
      try { fs.writeFileSync(pgcGuard, '1'); } catch {}
      try { await Database.execute('DELETE FROM party_messages WHERE created_at < (NOW() - INTERVAL 24 HOUR)'); } catch {}
    }
    await Database.execute("INSERT INTO party_messages (room, username, msg_type, msg) VALUES (?, ?, 'user', ?)", [room, username, [...msg].slice(0, 1000).join('')]);
    return app.json({ ok: true });
  }, ['POST']);

  add('/api/party/messages', 'party.messages', async (app) => {
    app.res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ messages: [], last_id: 0, error: 'login_required' });
    }
    if (!(await app.throttle('party_read', 240, 60))) {
      return app.json({ messages: [], last_id: Number(app.req.query.since || 0) });
    }
    const room = String(app.req.query.room || '').trim().slice(0, 50);
    const since = Number(app.req.query.since || 0);
    if (!room || !/^[\w-]{2,50}$/i.test(room)) return app.json({ messages: [], last_id: 0 });
    const rows = await Database.fetchAll('SELECT id, username, msg_type, msg FROM party_messages WHERE room = ? AND id > ? ORDER BY id ASC LIMIT 100', [room, since]);
    const messages = [];
    let lastId = since;
    for (const r of rows) {
      messages.push({ type: r.msg_type, user: r.username, msg: r.msg });
      lastId = Number(r.id);
    }
    return app.json({ messages, last_id: lastId });
  });
};
