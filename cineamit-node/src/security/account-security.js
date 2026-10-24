'use strict';
const crypto = require('crypto');
const Database = require('../db');
const Config = require('../core/config');
const Security = require('.');
const Profiles = require('../services/profiles');

function clear(app) {
  for (const key of ['totp_setup_secret','totp_setup_at','totp_setup_binding']) delete app.session[key];
}
async function adult(app, user) {
  if (app.session.is_kids) { clear(app); return {ok:false,error:'adult_required'}; }
  const profile = await Profiles.ensureActive(app,user);
  if (!profile || app.session.is_kids || Number(profile.is_kids) === 1) { clear(app); return {ok:false,error:'adult_required'}; }
  return {ok:true,profile};
}
async function authorize(app,user) {
  const access = await adult(app,user);
  if (!access.ok) return access;
  // Shared account budget across sessions/IPs and both web/API representations.
  try {
    if (!(await app.throttle('account_security_ip',60,900)) || !(await Database.consumeRate('account-security:u:'+Number(user.id),10,900)).allowed)
      return {ok:false,error:'throttled'};
  } catch { return {ok:false,error:'unavailable'}; }
  const body = app.req.body || {};
  const password = String(body.confirm_password || body.current_password || body.password || '');
  if (!password || !(await Security.checkPasswordHash(String(user.password || ''),password))) return {ok:false,error:'bad_password'};
  return access;
}
function binding(app,user,secret) {
  return crypto.createHmac('sha256',Config.SECRET_KEY).update(JSON.stringify([Number(user.id),Number(app.session.active_profile_id),String(user.password),secret])).digest('hex');
}
async function begin(app,user) {
  clear(app);
  if (Number(user.totp_enabled)) return {ok:false,error:'already'};
  const access = await authorize(app,user);
  if (!access.ok) return access;
  if (!Security.totpEncryptionAvailable()) return {ok:false,error:'unavailable'};
  if (!(await app.throttle('totp_setup',5,3600))) return {ok:false,error:'throttled'};
  const secret = Security.totpNewSecret();
  app.session.totp_setup_secret=secret;
  app.session.totp_setup_at=Math.floor(Date.now()/1000);
  app.session.totp_setup_binding=binding(app,user,secret);
  return {ok:true,secret,otpauth:Security.totpUri(secret,String(user.username))};
}
async function enroll(app,user,code) {
  const access=await adult(app,user);
  if (!access.ok) return access;
  if (Number(user.totp_enabled)) {clear(app);return {ok:false,error:'already'};}
  const secret=String(app.session.totp_setup_secret || ''),at=Number(app.session.totp_setup_at || 0),age=Date.now()/1000-at;
  const sent=String(app.session.totp_setup_binding || '');
  if (!secret || !at || age<0 || age>600 || !/^[a-f0-9]{64}$/.test(sent)
      || !crypto.timingSafeEqual(Buffer.from(sent),Buffer.from(binding(app,user,secret)))) {
    clear(app);return {ok:false,error:'expired'};
  }
  if (!(await app.throttle('totp_verify',10,600))) return {ok:false,error:'throttled'};
  if (!Security.totpVerify(secret,String(code || ''))) return {ok:false,error:'bad_code'};
  // No read-then-unconditional-write race. Password revision also fences a concurrent reset.
  const changed=await Database.execute('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ? AND COALESCE(totp_enabled, 0) = 0 AND password = ?', [Security.encryptTotpSecret(secret),user.id,String(user.password)]);
  clear(app);
  if (changed!==1) return {ok:false,error:'conflict'};
  return {ok:true};
}
function message(error) {
  return ({adult_required:'Switch to an adult profile to manage account security.',bad_password:'Enter your current account password. For social-only accounts, reset your password first.',throttled:'Too many account-security attempts. Try again in 15 minutes.',already:'2FA is already enabled. Start again only after an authorized disable.',expired:'Setup expired or account/profile changed. Start again with your current password.',conflict:'Account security changed in another session. Start again.',bad_code:'Incorrect authenticator code.',unavailable:'Account security is temporarily unavailable. Please retry.'})[error] || 'Account security could not be updated. Please retry.';
}
module.exports={authorize,begin,enroll,clear,message};
