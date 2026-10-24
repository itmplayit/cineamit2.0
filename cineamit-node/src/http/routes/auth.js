'use strict';

const crypto = require('crypto');
const Config = require('../../core/config');
const Database = require('../../db');
const SiteStatus = require('../../services/site-status');
const Security = require('../../security');
const AccountSecurity = require('../../security/account-security');
const PasswordReset = require('../../security/password-reset');
const OAuth = require('../../integrations/oauth');
const { add } = require('../../core/router');


function maskEmail(email) {
  const at = email.indexOf('@');
  if (at < 0) return email;
  const name = email.slice(0, at);
  const domain = email.slice(at);
  const keep = Math.min(2, Math.max(1, name.length - 1));
  return name.slice(0, keep) + '*'.repeat(Math.max(2, name.length - keep)) + domain;
}

function safeNext(v) {
  v = String(v || '');
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\x00-\x1F\x7F]/.test(v)) return '';
  return v;
}

module.exports = function registerAuth() {
  add('/register', 'auth.register', async (app) => {
    if (await app.isAuthenticated()) return app.redirect(app.urlFor('routes.home'));
    app.res.set('Cache-Control', 'private, no-store');
    let ownerBootstrapRequired;
    try {
      if (!(await SiteStatus.readRegistrationEnabled())) {
        app.flash('Registration is currently closed. Please contact support if you need an account.', 'error');
        return app.redirect(app.urlFor('auth.login'));
      }
      ownerBootstrapRequired = (await Database.fetchOne("SELECT id FROM users WHERE role = 'owner' LIMIT 1")) === null;
    } catch (error) {
      console.error('[Auth:register] Registration status unavailable: ' + error.message);
      app.res.status(503);
      app.res.set('Retry-After', '60');
      return app.render('register.html', { registration_unavailable: true });
    }
    if (app.req.method === 'POST') {
      const username = String(app.req.body.username || '').trim();
      const email = String(app.req.body.email || '').trim();
      const password = String(app.req.body.password || '');
      const confirm = String(app.req.body.confirm_password || '');
      if (!(await app.throttle('register', 5, 3600))) {
        app.flash('Too many sign-up attempts. Please wait an hour and try again.', 'error');
        return app.render('register.html', { owner_bootstrap_required: ownerBootstrapRequired });
      }
      try {
        const emailExists = await Database.fetchOne('SELECT id FROM users WHERE email = ?', [email]);
        const usernameExists = await Database.fetchOne('SELECT id FROM users WHERE username = ?', [username]);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
          app.flash('Please enter a valid email address.', 'error');
        } else if (!/^[A-Za-z0-9_.]{3,50}$/.test(username)) {
          app.flash('Username must be 3-50 characters (letters, numbers, dot, underscore only).', 'error');
        } else if (emailExists || usernameExists) {
          // Generic message for both cases (anti-enumeration: docs/06 L2).
          app.flash('These account details are already in use. Please sign in instead, or choose a different email/username.', 'error');
        } else if (password !== confirm) {
          app.flash('Passwords do not match.', 'error');
        } else if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
          app.flash('Password must be at least 8 characters with at least one letter and one number.', 'error');
        } else {
          const hashed = await Security.generatePasswordHash(password);
          const insertSql = 'INSERT INTO users (username, email, password, role, match_code) VALUES (?, ?, ?, ?, ?)';
          const insertParams = role => [username, email, hashed, role, Database.shortCode()];
          if (!ownerBootstrapRequired) {
            // A confirmed existing owner means this can only create a normal user.
            // Do not serialize everyday signups on the first-owner setup lock.
            await Database.execute(insertSql, insertParams('user'));
          } else {
            const db = await Database.get();
            const conn = await db.getConnection();
            let lockAcquired = false;
            let reusable = true;
            try {
              let lockRows;
              try {
                [lockRows] = await conn.query("SELECT GET_LOCK('cineamit_owner_bootstrap', 5) AS acquired");
              } catch (error) {
                // A failed acquire response leaves ownership uncertain: do not pool it.
                reusable = false;
                throw error;
              }
              if (Number(lockRows[0].acquired) !== 1) {
                const error = new Error('Owner setup is busy. Please try again in a moment.');
                error.code = 'OWNER_BOOTSTRAP_BUSY';
                throw error;
              }
              lockAcquired = true;
              // Recheck under the same lock so simultaneous first signups cannot
              // both create owners. If another request finished, create only a user.
              const [ownerRows] = await conn.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'owner'");
              let role = 'user';
              if (Number((ownerRows[0] && ownerRows[0].c) || 0) === 0) {
                const bootstrapKey = String(Config.OWNER_BOOTSTRAP_KEY || '');
                const provided = String(app.req.body.owner_bootstrap_key || '');
                const expectedBytes = Buffer.from(bootstrapKey);
                const suppliedBytes = Buffer.from(provided);
                if (bootstrapKey.length < 32 || !provided || expectedBytes.length !== suppliedBytes.length || !crypto.timingSafeEqual(expectedBytes, suppliedBytes)) {
                  app.flash('First-account setup is locked. Configure a 32+ character OWNER_BOOTSTRAP_KEY in .env, then enter it here.', 'error');
                  return app.render('register.html', { owner_bootstrap_required: true });
                }
                role = 'owner';
              }
              await conn.execute(insertSql, insertParams(role));
            } finally {
              if (lockAcquired) {
                try { await conn.query("SELECT RELEASE_LOCK('cineamit_owner_bootstrap')"); }
                catch (error) {
                  reusable = false;
                  console.error('[Auth:register] Owner bootstrap lock release failed: ' + error.message);
                }
              }
              if (reusable) conn.release();
              else conn.destroy();
            }
          }
          await app.securityLog('registered', null, 'user=' + username);
          app.flash('Account created successfully! You can now log in.', 'success');
          return app.redirect(app.urlFor('auth.login'));
        }
      } catch (e) {
        console.error('[Auth:register] ' + e.message);
        if (e.code === 'OWNER_BOOTSTRAP_BUSY') {
          app.res.status(503);
          app.res.set('Retry-After', '5');
          app.flash('Owner setup is busy. Please try again in a moment.', 'error');
        } else if (e.code === 'ER_DUP_ENTRY' || e.errno === 1062) {
          // Concurrent duplicate signup lost the race (docs/06 L2) — same generic message as the pre-check.
          app.flash('These account details are already in use. Please sign in instead, or choose a different email/username.', 'error');
        } else {
          app.flash('Database error while creating account. Please try again in a moment.', 'error');
        }
      }
    }
    return app.render('register.html', { owner_bootstrap_required: ownerBootstrapRequired });
  }, ['GET', 'POST']);

  add('/login', 'auth.login', async (app) => {
    if (await app.isAuthenticated()) return app.redirect(app.urlFor('routes.select_profile'));
    if (app.req.method === 'POST') {
      try { await Database.ensureSchema(); } catch (e) { console.error('[Auth:login] ensureSchema: ' + e.message); }
      let nextVal = safeNext(app.req.body.next || app.req.query.next);
      if (app.req.body.totp_cred) {
        const uid = Number(Security.loadsToken(String(app.req.body.totp_cred), 'totp-login-salt', 600) || 0);
        const pending = Number(app.session.totp_pending_uid || 0);
        const fresh = (Date.now() / 1000 - Number(app.session.totp_pending_at || 0)) <= 600;
        if (uid <= 0 || uid !== pending || !fresh) {
          delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
          delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
          app.flash('2FA session expired. Please log in again.', 'error');
          return app.render('login.html');
        }
        let user;
        try { user = await Database.fetchOne('SELECT * FROM users WHERE id = ?', [uid]); } catch { user = null; }
        if (!user || !user.totp_enabled) {
          delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
          delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
          app.flash('2FA session expired. Please log in again.', 'error');
          return app.render('login.html');
        }
        if (await app.accountTotpLocked(Number(user.id))) {
          delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
          delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
          await app.securityLog('totp_locked', user, 'account 2FA attempts remain locked for 15 minutes');
          app.flash('Too many wrong codes. Please wait 15 minutes and try again.', 'error');
          return app.render('login.html');
        }
        const storedTotpSecret = String(user.totp_secret || '');
        const totpSecret = Security.decryptTotpSecret(storedTotpSecret);
        if (totpSecret === null) {
          delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
          delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
          await app.securityLog('totp_secret_unavailable', user, 'stored 2FA secret could not be decrypted');
          app.flash('Your 2FA setup needs support assistance. Please contact an administrator.', 'error');
          return app.render('login.html');
        }
        if (!Security.totpSecretIsEncrypted(storedTotpSecret)) {
          try {
            await Database.execute('UPDATE users SET totp_secret = ? WHERE id = ? AND totp_secret = ?', [
              Security.encryptTotpSecret(totpSecret), Number(user.id), storedTotpSecret,
            ]);
          } catch (e) { console.error('[Auth:totp] legacy secret encryption failed: ' + e.message); }
        }
        const attempts = Number(app.session.totp_pending_attempts || 0);
        if (attempts >= 5) {
          delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
          delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
          await app.securityLog('totp_locked', user, '5 wrong codes — login attempt locked');
          app.flash('Too many wrong codes. Please log in again.', 'error');
          return app.render('login.html');
        }
        if (Security.totpVerify(totpSecret, String(app.req.body.totp_code || ''))) {
          await app.accountTotpReset(Number(user.id));
          const remember = !!app.session.totp_pending_remember;
          delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
          delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
          if (!(await app.loginUser(user, remember))) {
            await app.securityLog('login_suspended_denied', user);
            app.flash('Your account has been suspended by an administrator. Please contact support.', 'error');
            return app.render('login.html');
          }
          await app.securityLog('login_2fa', user);
          app.flash('Welcome back, ' + user.username + '!', 'success');
          let next = String(app.session.oauth_next || '');
          delete app.session.oauth_next;
          if (!next || !next.startsWith('/') || next.startsWith('//')) next = nextVal;
          if (next && next.startsWith('/') && !next.startsWith('//')) return app.redirect(next);
          return app.redirect(app.urlFor('routes.select_profile'));
        }
        app.session.totp_pending_attempts = attempts + 1;
        const left = 5 - attempts - 1;
        const totpAttemptResult = await app.accountTotpFailed(Number(user.id));
        await app.securityLog('totp_failed', user, 'attempt ' + (attempts + 1));
        if (totpAttemptResult === 'locked') {
          delete app.session.totp_pending_uid; delete app.session.totp_pending_at;
          delete app.session.totp_pending_attempts; delete app.session.totp_pending_remember;
          await app.securityLog('totp_locked', user, '5 wrong codes / 15 min — account 2FA locked');
          app.flash('Too many wrong codes. Please wait 15 minutes and try again.', 'error');
          return app.render('login.html');
        }
        app.flash(`Incorrect 2FA code. ${left} attempt(s) left.`, 'error');
        return app.render('login.html', { totp_step: true, totp_cred: String(app.req.body.totp_cred), next: nextVal });
      }

      const login_id = String(app.req.body.login_id || '').trim();
      const password = String(app.req.body.password || '');
      const remember = !!app.req.body.remember;
      const identityKey = crypto.createHash('sha256').update(login_id.toLowerCase()).digest('hex');
      if (!(await app.throttle('login_attempt_ip', 60, 900)) || !(await app.throttle('login_attempt_identity:' + identityKey, 10, 900))) {
        app.res.status(429); app.flash('Too many login attempts. Please wait 15 minutes.', 'error');
        return app.render('login.html');
      }
      let user;
      try { user = await Database.fetchOne('SELECT * FROM users WHERE email = ? OR username = ?', [login_id, login_id]); }
      catch (e) {
        console.error('[Auth:login] DB error: ' + e.message);
        app.flash('Database connection error. Please check your database settings or try again.', 'error');
        return app.render('login.html');
      }
      if (user && await app.accountLoginLocked(Number(user.id))) {
        // Anti-enumeration (docs/06 L3): locked must be indistinguishable from wrong password.
        await Security.checkPasswordHash('$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', password);
        app.flash('Invalid login credentials. Please check your username/email and password.', 'error');
        return app.render('login.html');
      }
      if (user && await Security.checkPasswordHash(user.password, password)) {
        await app.accountLoginReset(Number(user.id));
        delete app.session.oauth_next;
        if (user.totp_enabled) {
          app.session.totp_pending_uid = Number(user.id);
          app.session.totp_pending_at = Math.floor(Date.now() / 1000);
          app.session.totp_pending_attempts = 0;
          app.session.totp_pending_remember = remember;
          app.flash('Step 2 of 2: Enter the 6-digit code from your authenticator app.', 'message');
          return app.render('login.html', { totp_step: true, totp_cred: Security.dumpsToken(String(user.id), 'totp-login-salt'), next: nextVal });
        }
        if (!(await app.loginUser(user, remember))) {
          await app.securityLog('login_suspended_denied', user);
          app.flash('Your account has been suspended by an administrator. Please contact support.', 'error');
          return app.render('login.html');
        }
        await app.securityLog('login', user);
        app.flash('Welcome back, ' + user.username + '!', 'success');
        if (nextVal) return app.redirect(nextVal);
        return app.redirect(app.urlFor('routes.select_profile'));
      }
      if (!user) await Security.checkPasswordHash('$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', password);
      const loginIdentityKey = crypto.createHash('sha256').update(login_id.toLowerCase()).digest('hex');
      const ipRateAllowed = await app.throttle('login_fail_ip', 120, 900);
      const identityRateAllowed = await app.throttle('login_fail_identity:' + loginIdentityKey, 10, 900);
      if (!ipRateAllowed || !identityRateAllowed) {
        app.flash('Too many failed login attempts. Please try again after 15 minutes.', 'error');
      } else {
        await app.securityLog('login_failed', null, 'id=' + login_id.slice(0, 100));
        if (user) {
          const accRes = await app.accountLoginFailed(Number(user.id));
          if (accRes === 'locked') await app.securityLog('login_account_locked', user, '5 fails / 15 min — account 15 min locked');
        }
        app.flash('Invalid login credentials. Please check your username/email and password.', 'error');
      }
    } else {
      app.res.set('Cache-Control', 'private, no-store');
    }
    return app.render('login.html', { next: safeNext(app.req.query.next) });
  }, ['GET', 'POST']);

  add('/logout', 'auth.logout', async (app) => {
    if (!(await app.requireLogin())) return;
    await app.logoutUser();
    app.flash('You have been logged out successfully.', 'success');
    app.redirect(app.urlFor('auth.login'));
  }, ['POST']);

  add('/forgot_password', 'routes.forgot_password', async (app) => {
    app.res.set('Cache-Control', 'private, no-store');
    if (app.req.method === 'POST') {
      const email = String(app.req.body.email || '').toLowerCase().trim();
      const result = await PasswordReset.request(app, email);
      if (!result.ok) {
        if (result.error === 'mail_unavailable' || result.error === 'reset_unavailable') app.res.status(503);
        app.flash(result.message, 'error');
        return app.render('forgot_password.html', { entered_email: email });
      }
      app.flash(result.message, 'message');
      return app.redirect(app.urlFor('routes.verify_otp'));
    }
    return app.render('forgot_password.html');
  }, ['GET', 'POST']);

  add('/verify_otp', 'routes.verify_otp', async (app) => {
    app.res.set('Cache-Control', 'private, no-store');
    const email = String(app.session.pw_reset_email || '');
    if (!email) {
      app.flash('Please enter your email first.', 'error');
      return app.redirect(app.urlFor('routes.forgot_password'));
    }
    if (app.req.method === 'POST') {
      const resending = app.req.body.action === 'resend';
      const result = resending
        ? await PasswordReset.request(app, email)
        : await PasswordReset.verify(app, app.req.body.otp);
      if (!result.ok) {
        if (result.error === 'mail_unavailable' || result.error === 'reset_unavailable') app.res.status(503);
        app.flash(result.message, 'error');
      } else if (resending) {
        app.flash(result.message, 'message');
      } else {
        return app.redirect(app.urlFor('routes.reset_password'));
      }
    }
    return app.render('verify_otp.html', {
      masked_email: maskEmail(email),
      resend_wait: Math.max(0, PasswordReset.RESEND_WAIT - (Math.floor(Date.now() / 1000) - Number(app.session.pw_otp_sent_at || 0))),
    });
  }, ['GET', 'POST']);

  add('/reset_password', 'routes.reset_password', async (app) => {
    app.res.set('Cache-Control', 'private, no-store');
    const email = app.session.pw_reset_email || '';
    const verified = !!app.session.pw_otp_verified;
    const vAt = Number(app.session.pw_verified_at || 0);
    if (!email || !verified || vAt <= 0 || vAt > Date.now() / 1000 || (Date.now() / 1000 - vAt) > 900) {
      PasswordReset.clear(app);
      app.flash('Session expired. Please start again.', 'error');
      return app.redirect(app.urlFor('routes.forgot_password'));
    }
    if (app.req.method === 'POST') {
      const password = String(app.req.body.password || '');
      const confirm = String(app.req.body.confirm_password || '');
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        app.flash('Password must be at least 8 characters with at least one letter and one number.', 'error');
        return app.render('reset_password.html');
      }
      if (password !== confirm) {
        app.flash('Passwords do not match.', 'error');
        return app.render('reset_password.html');
      }
      const user = await Database.fetchOne('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1', [email]);
      if (!user || Number(user.id) !== Number(app.session.pw_verified_user_id)) {
        PasswordReset.clear(app);
        app.flash('Something went wrong. Please try again.', 'error');
        return app.redirect(app.urlFor('routes.forgot_password'));
      }
      await Database.execute('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?', [
        await Security.generatePasswordHash(password), new Date().toISOString().slice(0, 19).replace('T', ' '), user.id,
      ]);
      await app.securityLog('password_reset', user);
      PasswordReset.clear(app);
      app.flash('Password updated! You can now log in.', 'success');
      return app.redirect(app.urlFor('auth.login'));
    }
    return app.render('reset_password.html');
  }, ['GET', 'POST']);

  add('/profile/totp_setup', 'routes.totp_setup', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    let result;
    try { result = await AccountSecurity.begin(app,user); }
    catch { result = {ok:false,error:'unavailable'}; }
    if (!result.ok) {
      app.res.status(result.error === 'throttled' ? 429 : result.error === 'unavailable' ? 503 : 403);
      app.flash(AccountSecurity.message(result.error),'error');
      return app.redirect(app.urlFor('routes.profile'));
    }
    await app.securityLog('totp_setup_start', user);
    return app.render('totp_setup.html', {secret:result.secret,otpauth_uri:result.otpauth});
  }, ['POST']);

  add('/profile/totp_verify', 'routes.totp_verify', async app => {
    if (!(await app.requireLogin())) return;
    const user=await app.currentUser();
    let result;
    try { result=await AccountSecurity.enroll(app,user,app.req.body.totp_code); }
    catch { result={ok:false,error:'unavailable'}; }
    if (!result.ok) {
      app.flash(AccountSecurity.message(result.error),'error');
      await app.securityLog('totp_verify_blocked',user,result.error);
    } else {
      await app.securityLog('totp_enabled',user);
      app.flash('Two-Factor Authentication enabled.','success');
    }
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/profile/totp_disable', 'routes.totp_disable', async app => {
    if (!(await app.requireLogin())) return;
    const user=await app.currentUser();
    let access;
    try { access=await AccountSecurity.authorize(app,user); }
    catch { access={ok:false,error:'unavailable'}; }
    if (!access.ok) {
      app.res.status(access.error === 'throttled' ? 429 : access.error === 'unavailable' ? 503 : 403);
      app.flash(AccountSecurity.message(access.error),'error');
      await app.securityLog('totp_disable_blocked',user,access.error);
      return app.redirect(app.urlFor('routes.profile'));
    }
    const changed=await Database.execute('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ? AND password = ?', [user.id,String(user.password)]);
    if (changed!==1 && Number(user.totp_enabled)) {
      app.flash(AccountSecurity.message('conflict'),'error');
      return app.redirect(app.urlFor('routes.profile'));
    }
    await app.accountTotpReset(Number(user.id));
    AccountSecurity.clear(app);
    await app.securityLog('totp_disabled',user);
    app.flash('Two-Factor Authentication disabled.','message');
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  for (const provider of ['google', 'github']) {
    add('/auth/' + provider, 'auth.' + provider, async (app) => {
      if (await app.isAuthenticated()) return app.redirect(app.urlFor('routes.select_profile'));
      if (!OAuth.enabled(provider)) {
        app.flash(provider[0].toUpperCase() + provider.slice(1) + ' login is not configured yet.', 'error');
        return app.redirect(app.urlFor('auth.login'));
      }
      const state = crypto.randomBytes(16).toString('hex');
      app.session.oauth_state = state;
      app.session.oauth_provider = provider;
      const next = safeNext(app.req.query.next);
      if (next) app.session.oauth_next = next;
      else delete app.session.oauth_next;
      return app.redirect(OAuth.authUrl(provider, state));
    });

    add('/auth/' + provider + '/callback', 'auth.' + provider + '_callback', async (app) => {
      const fail = (msg) => {
        delete app.session.oauth_state; delete app.session.oauth_provider;
        app.flash(msg, 'error');
        return app.redirect(app.urlFor('auth.login'));
      };
      if (app.req.query.error) return fail('Sign-in was cancelled.');
      const code = app.req.query.code || '';
      const state = app.req.query.state || '';
      if (!code) return fail('Sign-in failed: no authorization code received.');
      const expected = app.session.oauth_state || '';
      if (!expected || expected !== String(state) || app.session.oauth_provider !== provider) {
        return fail('Sign-in session expired. Please try again.');
      }
      delete app.session.oauth_state; delete app.session.oauth_provider;
      if (!(await app.throttle('oauth_login', 10, 900))) return fail('Too many sign-in attempts. Please wait and try again.');
      const info = await OAuth.fetchUser(provider, String(code));
      if (!info) return fail('Could not sign you in with ' + provider[0].toUpperCase() + provider.slice(1) + '. ' + OAuth.lastError);
      const pName = provider[0].toUpperCase() + provider.slice(1);
      const email = info.email;
      let link = await Database.fetchOne('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ? LIMIT 1', [provider, info.id]);
      let user = null;
      if (link) {
        user = await Database.fetchOne('SELECT * FROM users WHERE id = ?', [link.user_id]);
        if (!user) {
          await Database.execute('DELETE FROM oauth_accounts WHERE id = ?', [link.id]);
          link = null;
        }
      }
      if (!user) {
        const existing = await Database.fetchOne('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1', [email]);
        if (existing) {
          user = existing;
          await Database.execute('INSERT IGNORE INTO oauth_accounts (user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?)', [user.id, provider, info.id, email]);
          app.flash('Your ' + pName + ' account has been linked. Welcome back, ' + user.username + '!', 'success');
        }
      }
      if (!user) {
        try {
          if (!(await SiteStatus.readRegistrationEnabled())) return fail('New registrations are currently closed. Please sign in with an existing account.');
        } catch {
          app.res.status(503);
          return fail('Registration status is temporarily unavailable. Please retry later.');
        }
        const ownerExists = await Database.fetchOne("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
        if (!ownerExists) return fail('The initial owner must be created through the secure first-run registration before social sign-up.');
        const base = info.name !== '' ? info.name : email.split('@')[0];
        const username = await OAuth.uniqueUsername(base.replace(/ /g, ''));
        const randomPw = await Security.generatePasswordHash(crypto.randomBytes(32).toString('hex'));
        try {
          await Database.execute('INSERT INTO users (username, email, password, match_code) VALUES (?, ?, ?, ?)', [username, email, randomPw, Database.shortCode()]);
        } catch (e) {
          console.error('[OAuth] user insert failed: ' + e.message);
          return fail('Could not create your account. Please try again.');
        }
        user = await Database.fetchOne('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1', [email]);
        if (!user) return fail('Could not create your account. Please try again.');
        await Database.execute('INSERT IGNORE INTO oauth_accounts (user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?)', [user.id, provider, info.id, email]);
        app.flash('Welcome to CineAmit, ' + user.username + '!', 'success');
      } else if (link) {
        app.flash('Welcome back, ' + user.username + '!', 'success');
      }
      await app.securityLog('oauth_login_' + provider, user, 'linked=' + (link ? '1' : '0') + ', 2fa=' + (user.totp_enabled ? '1' : '0'));
      if (user.totp_enabled) {
        app.session.totp_pending_uid = Number(user.id);
        app.session.totp_pending_at = Math.floor(Date.now() / 1000);
        app.session.totp_pending_attempts = 0;
        app.session.totp_pending_remember = true;
        app.flash('Step 2 of 2 (' + pName + '): Enter the 6-digit code from your authenticator app.', 'message');
        return app.render('login.html', { totp_step: true, totp_cred: Security.dumpsToken(String(user.id), 'totp-login-salt') });
      }
      if (!(await app.loginUser(user, true))) {
        await app.securityLog('login_suspended_denied', user);
        app.flash('Your account has been suspended by an administrator. Please contact support.', 'error');
        return app.redirect(app.urlFor('auth.login'));
      }
      const next = safeNext(app.session.oauth_next);
      delete app.session.oauth_next;
      if (next) return app.redirect(next);
      return app.redirect(app.urlFor('routes.select_profile'));
    });
  }
};
