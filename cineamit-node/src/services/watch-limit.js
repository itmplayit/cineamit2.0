'use strict';

const crypto = require('crypto');
const Database = require('../db');
const Config = require('../core/config');
const KEYS = {enabled:'WEB_WATCH_LIMIT_ENABLED', daily:'WEB_WATCH_DAILY', windowDays:'WEB_WATCH_WINDOW_DAYS', windowMax:'WEB_WATCH_WINDOW_MAX', guests:'WEB_WATCH_GUESTS', ipLimit:'WEB_WATCH_IP_LIMIT', exemptStaff:'WEB_WATCH_EXEMPT_STAFF', exemptKids:'WEB_WATCH_EXEMPT_KIDS', message:'WEB_WATCH_MESSAGE'};
const COOKIE = 'cine_wid';
const REQUEST_ID = Symbol('watchViewer');
const STAFF = new Set(['owner', 'super_admin', 'editor']);
const IST = 19800000, DAY = 86400000;
function flag(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (['1','true','on','yes'].includes(s)) return true;
  if (['0','false','off','no'].includes(s)) return false;
  throw Object.assign(new Error('Invalid watch-limit setting.'), {code:'WATCH_SETTINGS_INVALID'});
}
function integer(value, min, max) {
  const s = String(value == null ? '' : value).trim();
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < min || n > max) throw Object.assign(new Error('Invalid watch-limit number.'), {code:'WATCH_SETTINGS_INVALID'});
  return n;
}
function dayInfo() {
  const now = Date.now();
  return {server_now:now,day_key:new Date(now + IST).toISOString().slice(0,10), reset_at:(Math.floor((now + IST) / DAY) + 1) * DAY - IST};
}
function titleKey(tmdbId, mediaType, s=1, e=1) {
  const id = integer(tmdbId,1,Number.MAX_SAFE_INTEGER);
  if (!['movie','tv'].includes(mediaType)) throw Object.assign(new Error('Invalid media type.'), {code:'WATCH_SETTINGS_INVALID'});
  return mediaType === 'tv' ? `tv:${id}:s${integer(s,1,10000)}e${integer(e,1,100000)}` : `movie:${id}`;
}
async function config(conn) {
  const sql = 'SELECT setting_key, setting_value FROM site_setting WHERE setting_key IN (' + Object.values(KEYS).map(()=>'?').join(',') + ')';
  // One coherent read. Missing settings use defaults; a failed DB read must not silently disable enforcement.
  const rows = conn ? (await conn.execute(sql,Object.values(KEYS)))[0] : await Database.fetchAll(sql,Object.values(KEYS));
  const settings = Object.fromEntries(rows.map(row=>[row.setting_key,row.setting_value]));
  const c = {model:'daily_unlock_v2', enabled:flag(settings[KEYS.enabled],true), daily_max:integer(settings[KEYS.daily] ?? '10',0,100), window_days:1, window_max:0, guests:flag(settings[KEYS.guests],true), ip_limit:false, exempt_staff:flag(settings[KEYS.exemptStaff],true), exempt_kids:flag(settings[KEYS.exemptKids],true), message:String(settings[KEYS.message] || '').slice(0,400)};
  c.revision = crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
  return c;
}
async function publicConfig() { return config(null); }
async function saveSettings(body) {
  const preset = body.preset === 'daily10';
  const desired = {enabled:preset || flag(body.enabled,false), daily_max:preset ? 10 : integer(body.daily_max,0,100), guests:preset || flag(body.guests,false), exempt_staff:flag(body.exempt_staff,false), exempt_kids:flag(body.exempt_kids,false), message:preset ? '' : String(body.message || '').slice(0,400)};
  return Database.transaction(async conn=>{
    await lock(conn,'watch-settings-v2');
    const current = await config(conn);
    if (!/^[a-f0-9]{64}$/.test(String(body.revision || '')) || body.revision !== current.revision) throw Object.assign(new Error('Watch settings changed. Reload the admin page before saving.'), {code:'WATCH_SETTINGS_CONFLICT'});
    for (const [key,value] of [[KEYS.enabled,desired.enabled?'1':'0'],[KEYS.daily,String(desired.daily_max)],[KEYS.guests,desired.guests?'1':'0'],[KEYS.exemptStaff,desired.exempt_staff?'1':'0'],[KEYS.exemptKids,desired.exempt_kids?'1':'0'],[KEYS.message,desired.message],[KEYS.windowMax,'0'],[KEYS.windowDays,'1'],[KEYS.ipLimit,'0']]) {
      await conn.execute('INSERT INTO site_setting (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',[key,value]);
    }
    return config(conn);
  },{readCommitted:true});
}
function guestId(app) {
  if (app[REQUEST_ID]) return app[REQUEST_ID];
  const value = String((app.req.cookies || {})[COOKIE] || '');
  const [id,signature,...extra] = value.split('.');
  const sign = s=>crypto.createHmac('sha256',Config.SECRET_KEY).update('watch-viewer:' + s).digest('hex');
  if (!extra.length && /^[a-f0-9]{32}$/.test(id || '') && /^[a-f0-9]{64}$/.test(signature || '') && crypto.timingSafeEqual(Buffer.from(sign(id)),Buffer.from(signature))) return (app[REQUEST_ID]=id);
  const fresh = crypto.randomBytes(16).toString('hex');
  // Failure to emit the guest identity must not be silently swallowed.
  app.res.cookie(COOKIE,fresh+'.'+sign(fresh),{httpOnly:true,sameSite:'lax',path:'/',maxAge:400*DAY,secure:!!app.isSecure()});
  return (app[REQUEST_ID]=fresh);
}
async function viewerContext(app,user) {
  const id = Number(app.session.active_profile_id || 0);
  let profile = null;
  if (user && id) {
    profile = await Database.fetchOne('SELECT * FROM user_profiles WHERE id = ? AND user_id = ?',[id,user.id]);
    if (!profile) throw new Error('Active profile unavailable.');
  }
  return {user,profile,isKids:app.session.is_kids === true || Number(app.session.is_kids) === 1 || Number(profile && profile.is_kids) === 1};
}
async function lock(conn,key) {
  const name = 'watch-v2:' + crypto.createHash('sha256').update(key).digest('hex');
  // Persistent row lock, not connection-local advisory locks. RC makes aggregates
  // observe the preceding lock holder's commit on both MySQL and TiDB.
  await conn.execute('INSERT INTO rate_limits (rate_key, cnt, window_start) VALUES (?, 0, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE window_start = VALUES(window_start)',[name]);
  await conn.execute('SELECT rate_key FROM rate_limits WHERE rate_key = ? FOR UPDATE',[name]);
}
function pack(cfg,extra={}) {
  const d = dayInfo();
  const q = {enabled:cfg.enabled,available:true,model:cfg.model,daily_max:cfg.daily_max,daily_used:0,remaining_daily:cfg.daily_max,window_max:0,window_days:1,window_used:0,blocked:false,reason:'',exempt:'',current_unlocked:false,message:cfg.message,identity:'account',...d,...extra};
  if (!q.enabled) q.summary='Website watch limit is off';
  else if (q.exempt) q.summary=q.exempt==='staff' ? 'Staff account: daily limit exempt' : q.exempt==='kids' ? 'Kids profile: daily limit exempt' : 'Guests: daily limit off';
  else if (!q.daily_max) q.summary='Unlimited daily unlocks';
  else q.summary=`Aaj ${q.remaining_daily}/${q.daily_max} naye titles baaki` + (q.current_unlocked ? ' · Is title ka replay available' : '');
  q.detail=q.identity==='guest' ? 'Guest soft limit: cookie clear/incognito can reset it. Reset: 12 AM IST.' : 'One movie or TV episode = one unlock. Same-day replay/server switch is free. Reset: 12 AM IST.';
  return q;
}
function unavailable() { return {available:false,enabled:true,blocked:true,reason:'unavailable',daily_used:null,daily_max:null,remaining_daily:null,summary:'Watch usage unavailable — retry shortly',detail:'No new player access until usage can be checked.',...dayInfo()}; }
async function evaluate(app,opts,consume) {
  let cfg = await publicConfig();
  const tkey = titleKey(opts.tmdbId,opts.mediaType,opts.s ?? 1,opts.e ?? 1);
  const user = opts.user;
  const identity = user && user.id ? 'account' : 'guest';
  const base = {identity};
  const bypass = () => {
    if (!cfg.enabled || !cfg.daily_max) return pack(cfg,base);
    if (cfg.exempt_staff && STAFF.has(String(user && user.role))) return pack(cfg,{...base,exempt:'staff'});
    if (cfg.exempt_kids && opts.isKids) return pack(cfg,{...base,exempt:'kids'});
    if (identity==='guest' && !cfg.guests) return pack(cfg,{...base,exempt:'guest'});
    return null;
  };
  const free = bypass();
  if (free) return free;
  const viewer = identity==='account' ? 'u:'+integer(user.id,1,Number.MAX_SAFE_INTEGER) : 'g:'+guestId(app);
  const check = async conn=>{
    const info = dayInfo(), {day_key} = info;
    const run = async(sql,params)=>conn ? (await conn.execute(sql,params))[0] : Database.fetchAll(sql,params);
    // Single snapshot for the read-only status; only today's rows count.
    const read = async()=>{
      const rows = await run('SELECT COUNT(*) AS used, COALESCE(MAX(title_key = ?), 0) AS unlocked FROM web_watch_hits WHERE viewer_key = ? AND day_key = ?',[tkey,viewer,day_key]);
      const row = rows[0];
      const used = Number(row && row.used), unlocked=Number(row && row.unlocked)===1;
      if (!Number.isSafeInteger(used) || used<0) throw new Error('Invalid watch count.');
      return {used,unlocked};
    };
    let {used,unlocked} = await read();
    const blocked = !unlocked && used >= cfg.daily_max;
    if (consume && !blocked && !unlocked) {
      await conn.execute('INSERT INTO web_watch_hits (viewer_key, title_key, day_key, watched_at) VALUES (?, ?, ?, UTC_TIMESTAMP())',[viewer,tkey,day_key]);
      ({used,unlocked}=await read());
    }
    return pack(cfg,{...base,...info,daily_used:used,remaining_daily:Math.max(0,cfg.daily_max-used),current_unlocked:unlocked,blocked,reason:blocked?'daily':''});
  };
  if (!consume) return check(null);
  return Database.transaction(async conn=>{
    await lock(conn,viewer);
    // Queued admissions must not keep a policy captured before a long lock wait.
    cfg = await config(conn);
    return bypass() || check(conn);
  },{readCommitted:true});
}
async function inspect(app,opts) { return evaluate(app,opts,false); }
async function gate(app,opts) { return evaluate(app,opts,true); }
async function resetAll() {
  // Propagate failures: an unsuccessful reset must never be reported as success.
  return Database.execute('DELETE FROM web_watch_hits');
}
module.exports={publicConfig,saveSettings,inspect,gate,resetAll,titleKey,KEYS,viewerContext,unavailable};
