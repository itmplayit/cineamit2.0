'use strict';
const Database=require('../db');
const Profiles=require('./profiles');
async function scope(app,user) {
  const profile=await Profiles.ensureActive(app,user);
  if (!profile) throw new Error('Active profile unavailable.');
  // Preserve pre-profile playlists only for the first adult profile, never Kids.
  const first=await Database.fetchOne('SELECT id FROM user_profiles WHERE user_id = ? AND is_kids = 0 ORDER BY id ASC LIMIT 1',[user.id]);
  const legacy=!app.session.is_kids && first && Number(first.id)===Number(profile.id) ? 1:0;
  return {profile,clause:'user_id = ? AND (profile_id = ? OR ((profile_id IS NULL OR profile_id = 0) AND ? = 1))',params:[user.id,profile.id,legacy]};
}
async function lookup(app,value,shareOnly=false) {
  const id=String(value || '');
  if (shareOnly || !/^[1-9][0-9]*$/.test(id)) {
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return null;
    return Database.fetchOne('SELECT * FROM playlist WHERE share_code = ?',[id]);
  }
  const user=await app.currentUser();
  if (!user || !Number.isSafeInteger(Number(id))) return null;
  const s=await scope(app,user);
  return Database.fetchOne('SELECT * FROM playlist WHERE id = ? AND '+s.clause,[Number(id),...s.params]);
}
async function remove(app,user,id) {
  const s=await scope(app,user);
  return Database.transaction(async conn=>{
    const [rows]=await conn.execute('SELECT id FROM playlist WHERE id = ? AND '+s.clause+' FOR UPDATE',[id,...s.params]);
    if (!rows.length) return false;
    await conn.execute('DELETE FROM playlist_movies WHERE playlist_id = ?',[id]);
    await conn.execute('DELETE FROM playlist WHERE id = ? AND '+s.clause,[id,...s.params]);
    return true;
  });
}
async function addItem(app,user,id,media) {
  const s=await scope(app,user);
  return Database.transaction(async conn=>{
    const [rows]=await conn.execute('SELECT id FROM playlist WHERE id = ? AND '+s.clause+' FOR UPDATE',[id,...s.params]);
    if (!rows.length) return false;
    await conn.execute('INSERT INTO playlist_movies (playlist_id, tmdb_id, media_type, title, poster_path) VALUES (?, ?, ?, ?, ?)',[id,media.id,media.type,media.title,media.poster]);
    return true;
  });
}
module.exports={scope,lookup,remove,addItem};
