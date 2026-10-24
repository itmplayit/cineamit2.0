'use strict';

const crypto = require('crypto');
const Database = require('../../db');
const TMDB = require('../../services/tmdb');
const Security = require('../../security');
const PasswordReset = require('../../security/password-reset');
const Playlists = require('../../services/playlists');
const MediaLibrary = require('../../services/media-library');
const { needAppUser } = require('./guards');
const { PAGE_TEXT } = require('./page-text');
const { imageBase, slim, slimList, dedupeMediaRows, stripHtml, histItem } = require('./serializers');

// App content pages dispatcher: privacy/terms/help/history/notifications/playlists/cine-match/wrapped...
async function handleAppPage(app, kind, id, shareOnly=false) {
  const method = String(app.req.method || 'GET').toUpperCase();
  const q = String((app.req.query && app.req.query.q) || (app.req.body && app.req.body.q) || '').trim();
  kind = String(kind || '').toLowerCase().replace(/[^a-z0-9_]/g, '');

  if (['about', 'privacy', 'terms', 'dmca', 'legal', 'faq', 'download', 'totp'].includes(kind)) {
    const titles = {
      about: 'About', privacy: 'Privacy', terms: 'Terms', dmca: 'DMCA', legal: 'Legal',
      faq: 'FAQ', download: 'Downloads', totp: 'Two-Factor',
    };
    return app.json({ ok: true, kind, title: titles[kind], body: PAGE_TEXT[kind] || '' });
  }

  if (app.session.is_kids && ['actors','albums','album'].includes(kind)) {app.res.status(403);return app.json({ok:false,error:'kids_restricted'});}

  if (kind === 'actors') {
    const page = Math.max(1, parseInt(String((app.req.query && app.req.query.page) || '1'), 10) || 1);
    let items = [];
    try {
      const people = await TMDB.getPopularPeople(page);
      items = slimList(people, 'person').map((it) => {
        if (it) it.media_type = 'person';
        return it;
      }).filter(Boolean);
    } catch { items = []; }
    return app.json({
      ok: true, image_base: imageBase(), kind, title: 'Actors',
      items, page, total_pages: Math.max(1, Number(TMDB.lastTotalPages) || 20),
    });
  }

  if (kind === 'mood') {
    const catalog = [
      { id: 'chill', title: 'Chill · Laugh it off', genre: '35', body: 'Had a bad day? Laugh it off!' },
      { id: 'thrill', title: 'Thrill · Adrenaline', genre: '28', body: 'Need an adrenaline rush' },
      { id: 'scary', title: 'Scary · Nightmares', genre: '27', body: 'In the mood for nightmares' },
      { id: 'mind_bending', title: 'Mind-bending · Sci-Fi', genre: '878', body: 'Mind-bending and sci-fi' },
      { id: 'romantic', title: 'Romantic Night', genre: '10749', body: 'Romantic night in' },
    ];
    const kids = !!app.session.is_kids;
    if (id) {
      const m = catalog.find((x) => x.id === id);
      if (!m) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
      if (kids && ['scary', 'thrill', 'romantic', 'mind_bending'].includes(id)) {
        app.res.status(403);
        return app.json({ ok: false, error: 'kids_restricted' });
      }
      const genre = kids && id === 'chill' ? '35,16' : m.genre;
      const page = Math.max(1, parseInt(app.req.query.page, 10) || 1);
      const raw = await TMDB.getFilteredContent('movie', page, genre, '', 'popularity.desc').catch(() => []);
      const items = slimList(await app.filterBlacklisted(raw || []), 'movie');
      return app.json({
        ok: true, image_base: imageBase(), kind, title: m.title, body: m.body,
        items, page, total_pages: Math.max(1, Number(TMDB.lastTotalPages) || 1), genre,
      });
    }
    const rows = (kids ? catalog.filter((x) => x.id === 'chill') : catalog).map((m) => ({
      id: m.id, title: m.title, body: m.body, genre: m.genre,
    }));
    return app.json({
      ok: true, kind, title: 'Mood',
      body: 'Pick a mood — matching titles will appear.',
      rows,
    });
  }

  if (kind === 'reels') {
    const trending = await app.filterBlacklisted(await TMDB.getTrending('all', 'day'));
    const items = slimList((trending || []).filter((it) => it && it.media_type !== 'person')).slice(0, 30);
    return app.json({ ok: true, image_base: imageBase(), kind, title: 'Reels', items });
  }

  if (kind === 'surprise') {
    const trending = await app.filterBlacklisted(await TMDB.getTrending('movie', 'week'));
    const pool = (trending || []).filter((it) => it && it.id);
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    const item = slim(pick, 'movie');
    return app.json({ ok: true, image_base: imageBase(), kind, title: 'Surprise', item, items: item ? [item] : [] });
  }

  if (kind === 'albums') {
    let results = [];
    if (q) results = await TMDB.searchCollections(q, 1);
    const items = (results || []).map((c) => slim({
      id: c.id, media_type: 'collection', name: c.name, poster_path: c.poster_path, backdrop_path: c.backdrop_path, overview: c.overview,
    }, 'movie')).filter(Boolean);
    items.forEach((it) => { it.media_type = 'collection'; });
    return app.json({ ok: true, image_base: imageBase(), kind, title: 'Albums', query: q, items });
  }

  if (kind === 'album') {
    const collection = await TMDB.getCollection(Number(id));
    if (!collection) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
    const items = slimList(await app.filterBlacklisted(collection.parts || [],'movie'), 'movie');
    return app.json({
      ok: true, image_base: imageBase(), kind, title: String(collection.name || 'Album'),
      body: stripHtml(collection.overview || ''), items,
    });
  }

  if (kind === 'blog') {
    if (id) {
      const post = await Database.fetchOne('SELECT * FROM blog_posts WHERE slug = ? OR id = ?', [id, Number(id) || 0]);
      if (!post) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
      return app.json({
        ok: true, kind, title: String(post.title || 'Blog'),
        body: stripHtml(post.content || post.meta_description || ''),
        image: String(post.image_url || ''),
      });
    }
    const posts = await Database.fetchAll('SELECT id, title, slug, image_url, meta_description, created_at FROM blog_posts ORDER BY created_at DESC LIMIT 50');
    return app.json({
      ok: true, kind, title: 'Blog',
      rows: (posts || []).map((p) => ({
        id: String(p.slug || p.id),
        title: String(p.title || ''),
        body: String(p.meta_description || ''),
      })),
    });
  }

  if (kind === 'help') {
    if (id) {
      const article = await Database.fetchOne('SELECT * FROM help_articles WHERE slug = ? OR id = ?', [id, Number(id) || 0]);
      if (!article) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
      try { await Database.execute('UPDATE help_articles SET views = views + 1 WHERE id = ?', [article.id]); } catch {}
      return app.json({
        ok: true, kind, title: String(article.title || 'Help'),
        body: stripHtml(article.content || ''),
      });
    }
    const articles = await Database.fetchAll('SELECT topic, title, slug FROM help_articles ORDER BY topic, title');
    return app.json({
      ok: true, kind, title: 'Help',
      rows: (articles || []).map((a) => ({
        id: String(a.slug || ''),
        title: String(a.title || ''),
        body: String(a.topic || ''),
      })),
    });
  }

  if (kind === 'contact') {
    if (method === 'POST') {
      if (!(await app.throttle('contact', 5, 3600))) {
        return app.json({ ok: false, error: 'throttled' });
      }
      const name = String((app.req.body && app.req.body.name) || '').trim().slice(0, 80);
      const email = String((app.req.body && app.req.body.email) || '').trim().slice(0, 120);
      const message = String((app.req.body && app.req.body.message) || '').trim().slice(0, 2000);
      if (!name || !email || !message) return app.json({ ok: false, error: 'bad_email' });
      let uid = 0;
      try {
        const u = await app.currentUser();
        if (u) uid = Number(u.id) || 0;
      } catch { uid = 0; }
      try {
        await Database.execute(
          'INSERT INTO user_requests (user_id, request_type, title, message) VALUES (?, ?, ?, ?)',
          [uid, 'contact', (name + ' <' + email + '>').slice(0, 255), message]
        );
      } catch (e) { console.error('[app.contact] ' + e.message); }
      return app.json({ ok: true, kind, title: 'Contact', message: 'Thanks — we received your message.' });
    }
    return app.json({ ok: true, kind, title: 'Contact', body: 'Send your name, email, and message. We treat it like the website contact form.' });
  }

  if (kind === 'forgot') {
    if (method !== 'POST') return app.json({ ok: true, kind, title: 'Forgot password', body: 'Enter your account email to request a reset code.' });
    const result = await PasswordReset.request(app, app.req.body && app.req.body.email);
    if (!result.ok) {
      if (result.error === 'mail_unavailable' || result.error === 'reset_unavailable') app.res.status(503);
      return app.json({ ok: false, error: result.error, message: result.message });
    }
    return app.json({ ok: true, kind, step: 'otp', message: result.message });
  }

  if (kind === 'forgot_verify') {
    if (method !== 'POST') return app.json({ ok: false, error: 'post_required' });
    const result = await PasswordReset.verify(app, app.req.body && app.req.body.otp);
    if (!result.ok) {
      if (result.error === 'reset_unavailable') app.res.status(503);
      return app.json({ ok: false, error: result.error === 'invalid_code' ? 'totp_invalid' : result.error, message: result.message });
    }
    return app.json({ ok: true, kind, step: 'reset', message: 'Code verified. Set a new password.' });
  }

  if (kind === 'forgot_reset') {
    if (method !== 'POST') return app.json({ ok: false, error: 'post_required' });
    const email = String(app.session.pw_reset_email || '').toLowerCase().trim();
    const verified = !!app.session.pw_otp_verified;
    const vAt = Number(app.session.pw_verified_at || 0);
    if (!email || !verified || vAt <= 0 || vAt > Date.now() / 1000 || (Date.now() / 1000 - vAt) > 900) {
      PasswordReset.clear(app);
      return app.json({ ok: false, error: 'totp_expired' });
    }
    const password = String((app.req.body && app.req.body.password) || '');
    const confirm = String((app.req.body && (app.req.body.confirm || app.req.body.confirm_password)) || '');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return app.json({ ok: false, error: 'weak_password' });
    if (password !== confirm) return app.json({ ok: false, error: 'mismatch' });
    const user = await Database.fetchOne('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1', [email]);
    if (!user || Number(user.id) !== Number(app.session.pw_verified_user_id)) {
      PasswordReset.clear(app);
      return app.json({ ok: false, error: 'start_over' });
    }
    await Database.execute('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?', [
      await Security.generatePasswordHash(password), new Date().toISOString().slice(0, 19).replace('T', ' '), user.id,
    ]);
    PasswordReset.clear(app);
    return app.json({ ok: true, kind, message: 'Password updated. Sign in now.' });
  }

  if (kind === 'history') {
    const user = await needAppUser(app);
    if (!user) return;
    const library = await MediaLibrary.scope(app, user);
    if (app.session.is_kids) { app.res.status(403); return app.json({ ok: false, error: 'kids_restricted' }); }
    if (method === 'POST') {
      const body = app.req.body || {};
      const action = String(body.action || '').toLowerCase();
      const oneId = Number(body.tmdb_id || body.id || 0);
      const oneType = String(body.media_type || body.type || '').trim();
      if (oneId > 0 && action !== 'clear') {
        const params = [...library.params, oneId];
        let sql = 'DELETE FROM watch_history WHERE ' + library.clause + ' AND tmdb_id = ?';
        if (oneType) {
          sql += ' AND media_type = ?';
          params.push(TMDB.mt_safe(oneType));
        }
        await Database.execute(sql, params);
      } else {
        await Database.execute('DELETE FROM watch_history WHERE ' + library.clause, library.params);
      }
      const left = dedupeMediaRows(await Database.fetchAll('SELECT * FROM watch_history WHERE ' + library.clause + ' ORDER BY watch_time DESC LIMIT 200', library.params));
      return app.json({
        ok: true, image_base: imageBase(), kind, title: 'History',
        items: (await app.filterBlacklisted(left || [])).map(histItem).filter(Boolean),
        message: oneId > 0 && action !== 'clear' ? 'Removed.' : 'Watch history cleared.',
      });
    }
    const rows = dedupeMediaRows(await Database.fetchAll('SELECT * FROM watch_history WHERE ' + library.clause + ' ORDER BY watch_time DESC LIMIT 200', library.params));
    return app.json({ ok: true, image_base: imageBase(), kind, title: 'History', items: (await app.filterBlacklisted(rows || [])).map(histItem).filter(Boolean) });
  }

  if (kind === 'notifications') {
    const user = await needAppUser(app);
    if (!user) return;
    if (method === 'POST') {
      await Database.execute('DELETE FROM notifications WHERE user_id = ?', [user.id]);
      return app.json({ ok: true, kind, title: 'Notifications', rows: [], message: 'Cleared.' });
    }
    const rows = await Database.fetchAll('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [user.id]);
    return app.json({
      ok: true, kind, title: 'Notifications',
      rows: (rows || []).map((n) => ({
        id: String(n.id),
        title: String(n.title || ''),
        body: String(n.message || ''),
      })),
    });
  }

  if (kind === 'playlists') {
    const user = await needAppUser(app);
    if (!user) return;
    const scope=await Playlists.scope(app,user);
    if (method === 'POST') {
      const name = String((app.req.body && (app.req.body.name || app.req.body.q)) || '').trim().slice(0, 80);
      if (!name) return app.json({ ok: false, error: 'name_required' });
      const code = crypto.randomBytes(5).toString('hex');
      try {
        await Database.execute(
          'INSERT INTO playlist (user_id, profile_id, name, share_code) VALUES (?, ?, ?, ?)',
          [user.id, scope.profile.id, name, code]
        );
      } catch {
        await Database.execute(
          'INSERT INTO playlist (user_id, profile_id, name, share_code) VALUES (?, ?, ?, ?)',
          [user.id, scope.profile.id, name, crypto.randomBytes(6).toString('hex')]
        );
      }
    }
    const rows = await Database.fetchAll('SELECT * FROM playlist WHERE '+scope.clause+' ORDER BY created_at DESC', scope.params);
    return app.json({
      ok: true, kind, title: 'Playlists',
      rows: (rows || []).map((p) => ({
        id: String(p.id),
        title: String(p.name || 'Playlist'),
        body: String(p.description || ''),
      })),
    });
  }

  if (kind === 'playlist') {
    const pl = await Playlists.lookup(app,id,shareOnly);
    if (!pl) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
    const rows = await app.filterBlacklisted(await Database.fetchAll('SELECT * FROM playlist_movies WHERE playlist_id = ? ORDER BY added_at DESC', [pl.id]));
    const items = (rows || []).map((r) => slim({
      id: r.tmdb_id, media_type: r.media_type, title: r.title, poster_path: r.poster_path,
    }, r.media_type)).filter(Boolean);
    return app.json({ ok: true, image_base: imageBase(), kind, title: String(pl.name || 'Playlist'), items });
  }

  if (kind === 'cine_match') {
    const user = await needAppUser(app);
    if (!user) return;
    if (app.session.is_kids) { app.res.status(403); return app.json({ ok: false, error: 'kids_restricted' }); }
    const full = await Database.fetchOne('SELECT match_code, username FROM users WHERE id = ?', [user.id]);
    const matchCode = String((full && full.match_code) || '');
    if (method !== 'POST') {
      return app.json({
        ok: true, kind, title: 'Cine Match', match_code: matchCode,
        body: 'Share your match code, or enter a friend’s code — shared watch history will appear.',
      });
    }
    const code = String((app.req.body && (app.req.body.code || app.req.body.q)) || '').trim();
    const friend = await Database.fetchOne('SELECT * FROM users WHERE match_code = ? LIMIT 1', [code]);
    if (!friend || Number(friend.id) === Number(user.id)) return app.json({ ok: false, error: 'invalid_code' });
    const myHist = await Database.fetchAll('SELECT tmdb_id, media_type, title, poster_path FROM watch_history WHERE user_id = ? AND profile_id IN (?, 0)', [user.id, activePid(app)]);
    const friendProf = await Database.fetchOne('SELECT id FROM user_profiles WHERE user_id = ? AND is_kids = 0 ORDER BY id ASC LIMIT 1', [friend.id]);
    const fHist = friendProf ? await Database.fetchAll('SELECT tmdb_id, media_type, title, poster_path FROM watch_history WHERE user_id = ? AND profile_id IN (?, 0)', [friend.id, friendProf.id]) : [];
    const mine = new Set((myHist || []).map((r) => r.media_type + ':' + r.tmdb_id));
    const matched = (fHist || []).filter((r) => mine.has(r.media_type + ':' + r.tmdb_id)).map(histItem).filter(Boolean);
    try { await Database.execute('INSERT IGNORE INTO cine_match_friends (user_id, friend_id) VALUES (?, ?)', [user.id, friend.id]); } catch {}
    return app.json({
      ok: true, image_base: imageBase(), kind, title: 'Cine Match',
      match_code: matchCode, friend: String(friend.username || 'Friend'), items: matched,
    });
  }

  if (kind === 'wrapped') {
    const user = await needAppUser(app);
    if (!user) return;
    const library = await MediaLibrary.scope(app, user);
    const hist = await app.filterBlacklisted(dedupeMediaRows(await Database.fetchAll('SELECT tmdb_id, media_type FROM watch_history WHERE ' + library.clause, library.params)));
    let movies = 0;
    let tv = 0;
    for (const r of hist || []) {
      if (String(r.media_type) === 'tv') tv++;
      else movies++;
    }
    const recent = dedupeMediaRows(await Database.fetchAll('SELECT * FROM watch_history WHERE ' + library.clause + ' ORDER BY watch_time DESC LIMIT 50', library.params));
    const items = (await app.filterBlacklisted(recent || [])).map(histItem).filter(Boolean);
    const total = (hist || []).length;
    return app.json({
      ok: true, image_base: imageBase(), kind, title: 'Cine Wrapped',
      total, movies, tv, items,
      body: total ? ('You watched ' + total + ' titles. Movies ' + movies + ' · Series ' + tv + '.') : 'History is empty. Watch something, then Wrapped will appear here.',
    });
  }

  app.res.status(404);
  return app.json({ ok: false, error: 'not_found' });
}

module.exports = { handleAppPage };
