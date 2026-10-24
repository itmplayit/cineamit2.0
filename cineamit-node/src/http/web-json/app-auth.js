'use strict';

const crypto = require('crypto');
const Config = require('../../core/config');
const Database = require('../../db');
const Security = require('../../security');
const Mailer = require('../../integrations/mailer');
const AccountSecurity = require('../../security/account-security');
const SiteStatus = require('../../services/site-status');
const { sessionUser, maskEmail } = require('./serializers');

// App auth: login (+TOTP step-up), logout, register, download-PIN OTP, 2FA management.
async function app_login(app) {
    if (await app.isAuthenticated()) {
      const user = await app.currentUser();
      return app.json({ ok: true, user: await sessionUser(app, user) });
    }

    async function finishLogin(user, remember) {
      if (!(await app.loginUser(user, remember))) {
        app.res.status(403);
        return app.json({ ok: false, error: 'suspended' });
      }
      return app.json({ ok: true, user: await sessionUser(app, user) });
    }

    async function verifyTotpStep(totpCred, totpCode) {
      const uid = Number(Security.loadsToken(String(totpCred), 'totp-login-salt', 600) || 0);
      const pending = Number(app.session.totp_pending_uid || 0);
      const fresh = (Date.now() / 1000 - Number(app.session.totp_pending_at || 0)) <= 600;
      if (uid <= 0 || uid !== pending || !fresh) {
        delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
        delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
        app.res.status(401);
        return app.json({ ok: false, error: 'totp_expired' });
      }
      let user;
      try { user = await Database.fetchOne('SELECT * FROM users WHERE id = ?', [uid]); } catch { user = null; }
      if (!user || !user.totp_enabled) {
        delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
        delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
        app.res.status(401);
        return app.json({ ok: false, error: 'totp_expired' });
      }
      if (await app.accountTotpLocked(Number(user.id))) {
        delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
        delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
        app.res.status(423);
        return app.json({ ok: false, error: 'locked' });
      }
      const storedTotpSecret = String(user.totp_secret || '');
      const totpSecret = Security.decryptTotpSecret(storedTotpSecret);
      if (totpSecret === null) {
        app.res.status(500);
        return app.json({ ok: false, error: 'totp_unavailable' });
      }
      const attempts = Number(app.session.totp_pending_attempts || 0);
      if (attempts >= 5) {
        delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
        delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
        app.res.status(423);
        return app.json({ ok: false, error: 'locked' });
      }
      if (Security.totpVerify(totpSecret, String(totpCode || ''))) {
        await app.accountTotpReset(Number(user.id));
        const remember = !!app.session.totp_pending_remember;
        delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
        delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
        return finishLogin(user, remember);
      }
      app.session.totp_pending_attempts = attempts + 1;
      const totpAttemptResult = await app.accountTotpFailed(Number(user.id));
      if (totpAttemptResult === 'locked') {
        delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
        delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
        app.res.status(423);
        return app.json({ ok: false, error: 'locked' });
      }
      app.res.status(401);
      return app.json({ ok: false, error: 'totp_invalid', totp_cred: String(totpCred), left: 5 - attempts - 1 });
    }

    const totpCred = String(app.req.body.totp_cred || '').trim();
    const totpCode = String(app.req.body.totp_code || '').trim();
    if (totpCred) return verifyTotpStep(totpCred, totpCode);

    const loginId = String(app.req.body.username || app.req.body.login_id || '').trim();
    const password = String(app.req.body.password || '');
    if (!loginId || !password) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid_credentials' });
    }
    const identityKey = crypto.createHash('sha256').update(loginId.toLowerCase()).digest('hex');
    if (!(await app.throttle('login_attempt_ip', 60, 900)) || !(await app.throttle('login_attempt_identity:' + identityKey, 10, 900))) {
      app.res.status(429); return app.json({ok: false, error: 'locked'});
    }
    let user;
    try { user = await Database.fetchOne('SELECT * FROM users WHERE email = ? OR username = ?', [loginId, loginId]); } catch {
      app.res.status(500);
      return app.json({ ok: false, error: 'db' });
    }
    if (user && await app.accountLoginLocked(Number(user.id))) {
      // Anti-enumeration (docs/06 L3): locked must be indistinguishable from wrong password.
      await Security.checkPasswordHash('$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', password);
      await app.securityLog('login_failed', null, 'app identity=' + loginId.slice(0, 100));
      app.res.status(401);
      return app.json({ ok: false, error: 'invalid_credentials' });
    }
    if (user && await Security.checkPasswordHash(user.password, password)) {
      await app.accountLoginReset(Number(user.id));
      if (user.totp_enabled) {
        app.session.totp_pending_uid = Number(user.id);
        app.session.totp_pending_at = Math.floor(Date.now() / 1000);
        app.session.totp_pending_attempts = 0;
        app.session.totp_pending_remember = true;
        const cred = Security.dumpsToken(String(user.id), 'totp-login-salt');
        if (totpCode) return verifyTotpStep(cred, totpCode);
        return app.json({ ok: false, error: 'totp_required', totp_cred: cred });
      }
      return finishLogin(user, true);
    }
    if (!user) await Security.checkPasswordHash('$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', password);
    if (user) await app.accountLoginFailed(Number(user.id));
    await app.securityLog('login_failed', null, 'app identity=' + loginId.slice(0, 100));
    app.res.status(401);
    return app.json({ ok: false, error: 'invalid_credentials' });
  }

async function app_logout(app) {
    await app.logoutUser();
    return app.json({ ok: true });
  }

async function app_dlpin_otp(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    if (!(await app.throttle('dlpin_otp', 5, 3600))) {
      return app.json({ ok: false, error: 'throttled' });
    }
    const user = await app.currentUser();
    const realEmail = String((user && user.email) || '').toLowerCase().trim();
    if (!realEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(realEmail)) {
      return app.json({ ok: false, error: 'no_email' });
    }
    const key = 'dlpin:' + Number(user.id);
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = crypto.createHmac('sha256', Config.SECRET_KEY).update('dlpin:' + otp).digest('hex');
    const expires = new Date(Date.now() + 10 * 60000).toISOString().slice(0, 19).replace('T', ' ');
    try {
      await Database.execute('DELETE FROM password_otp WHERE email = ?', [key]);
      await Database.execute(
        'INSERT INTO password_otp (email, otp_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, NOW())',
        [key, otpHash, expires]
      );
    } catch (e) {
      console.error('[dlpin_otp] db ' + e.message);
      return app.json({ ok: false, error: 'mail_fail' });
    }
    const sent = await Mailer.sendOtpEmail(realEmail, otp, 10, 'pin');
    if (!sent) {
      console.error('[dlpin_otp] mail fail :: ' + Mailer.lastError);
      return app.json({ ok: false, error: 'mail_fail' });
    }
    return app.json({ ok: true, masked_email: maskEmail(realEmail) });
  }

async function app_dlpin_verify(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const key = 'dlpin:' + Number(user && user.id);
    const otpInput = String((app.req.body && app.req.body.otp) || '').replace(/\D/g, '');
    if (otpInput.length !== 6) return app.json({ ok: false, error: 'bad_otp' });
    let row;
    try {
      row = await Database.fetchOne('SELECT * FROM password_otp WHERE email = ? ORDER BY id DESC LIMIT 1', [key]);
    } catch {
      row = null;
    }
    if (row && Date.parse(row.expires_at) < Date.now()) {
      try { await Database.execute('DELETE FROM password_otp WHERE email = ?', [key]); } catch {}
      row = null;
    }
    if (row && Number(row.attempts) >= 5) {
      try { await Database.execute('DELETE FROM password_otp WHERE email = ?', [key]); } catch {}
      return app.json({ ok: false, error: 'locked' });
    }
    if (!row) return app.json({ ok: false, error: 'totp_invalid' });
    const calc = crypto.createHmac('sha256', Config.SECRET_KEY).update('dlpin:' + otpInput).digest('hex');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(String(row.otp_hash)), Buffer.from(calc))) {
        await Database.execute('UPDATE password_otp SET attempts = attempts + 1 WHERE id = ?', [row.id]);
        return app.json({ ok: false, error: 'totp_invalid' });
      }
    } catch {
      return app.json({ ok: false, error: 'totp_invalid' });
    }
    try { await Database.execute('DELETE FROM password_otp WHERE email = ?', [key]); } catch {}
    return app.json({ ok: true });
  }

function securityFailure(app,error) {
  app.res.status(error === 'throttled' ? 429 : error === 'unavailable' ? 503 : 403);
  return app.json({ok:false,error,message:AccountSecurity.message(error)});
}
async function app_totp_setup(app) {
  if (!(await app.isAuthenticated())) {app.res.status(401);return app.json({ok:false,error:'login_required'});}
  const user=await app.currentUser();
  let result;
  try { result=await AccountSecurity.begin(app,user); } catch {result={ok:false,error:'unavailable'};}
  if (!result.ok) return securityFailure(app,result.error);
  try {await app.securityLog('totp_setup_start',user);} catch {}
  return app.json(result);
}
async function app_totp_verify(app) {
  if (!(await app.isAuthenticated())) {app.res.status(401);return app.json({ok:false,error:'login_required'});}
  const user=await app.currentUser();
  let result;
  try {result=await AccountSecurity.enroll(app,user,app.req.body.totp_code || app.req.body.code);} catch {result={ok:false,error:'unavailable'};}
  if (!result.ok) return securityFailure(app,result.error);
  try {await app.securityLog('totp_enabled',user);} catch {}
  user.totp_enabled=1;
  return app.json({ok:true,user:await sessionUser(app,user)});
}
async function app_totp_disable(app) {
  if (!(await app.isAuthenticated())) {app.res.status(401);return app.json({ok:false,error:'login_required'});}
  const user=await app.currentUser();
  let result;
  try {result=await AccountSecurity.authorize(app,user);} catch {result={ok:false,error:'unavailable'};}
  if (!result.ok) return securityFailure(app,result.error);
  try {
    const changed=await Database.execute('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ? AND password = ?',[user.id,String(user.password)]);
    if (changed!==1 && Number(user.totp_enabled)) return securityFailure(app,'conflict');
  } catch {return securityFailure(app,'unavailable');}
  try {await app.accountTotpReset(Number(user.id));} catch {}
  AccountSecurity.clear(app);
  try {await app.securityLog('totp_disabled',user);} catch {}
  user.totp_enabled=0;
  return app.json({ok:true,user:await sessionUser(app,user)});
}
async function app_register(app) {
    app.res.set('Cache-Control', 'private, no-store');
    let owner;
    try {
      if (!(await SiteStatus.readRegistrationEnabled())) {
        app.res.status(403);
        return app.json({ ok: false, error: 'closed' });
      }
      owner = await Database.fetchOne("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    } catch (error) {
      console.error('[App:register] Registration status unavailable: ' + error.message);
      app.res.status(503);
      app.res.set('Retry-After', '60');
      return app.json({ ok: false, error: 'registration_unavailable', message: 'Registration is temporarily unavailable. Please try again later.' });
    }
    if (!owner) { app.res.status(403); return app.json({ok: false, error: 'owner_setup_required'}); }
    const username = String(app.req.body.username || '').trim();
    const email = String(app.req.body.email || '').trim();
    const password = String(app.req.body.password || '');
    const confirm = String(app.req.body.confirm || app.req.body.confirm_password || '');
    if (!(await app.throttle('register', 5, 3600))) {
      app.res.status(429);
      return app.json({ ok: false, error: 'throttled' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      app.res.status(400);
      return app.json({ ok: false, error: 'bad_email' });
    }
    if (!/^[A-Za-z0-9_.]{3,50}$/.test(username)) {
      app.res.status(400);
      return app.json({ ok: false, error: 'bad_username' });
    }
    if (password !== confirm) {
      app.res.status(400);
      return app.json({ ok: false, error: 'mismatch' });
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      app.res.status(400);
      return app.json({ ok: false, error: 'weak_password' });
    }
    let emailExists, usernameExists;
    try {
      emailExists = await Database.fetchOne('SELECT id FROM users WHERE email = ?', [email]);
      usernameExists = await Database.fetchOne('SELECT id FROM users WHERE username = ?', [username]);
    } catch {
      app.res.status(500);
      return app.json({ ok: false, error: 'db' });
    }
    if (emailExists) { app.res.status(409); return app.json({ ok: false, error: 'email_taken' }); }
    if (usernameExists) { app.res.status(409); return app.json({ ok: false, error: 'username_taken' }); }
    const hashed = await Security.generatePasswordHash(password);
    try {
      await Database.execute(
        'INSERT INTO users (username, email, password, role, match_code) VALUES (?, ?, ?, ?, ?)',
        [username, email, hashed, 'user', Database.shortCode()]
      );
    } catch (e) {
      app.res.status(500);
      return app.json({ ok: false, error: 'db' });
    }
    const user = await Database.fetchOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(await app.loginUser(user, true))) {
      return app.json({ ok: true, need_login: true });
    }
    return app.json({ ok: true, user: await sessionUser(app, user) });
  }

module.exports = { app_login, app_logout, app_register, app_dlpin_otp, app_dlpin_verify,
  app_totp_setup, app_totp_verify, app_totp_disable };
