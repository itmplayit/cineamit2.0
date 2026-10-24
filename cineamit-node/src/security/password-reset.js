'use strict';

const crypto = require('crypto');
const Config = require('../core/config');
const Database = require('../db');
const Mailer = require('../integrations/mailer');

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_WAIT = 60;
const REQUEST_MESSAGE = 'If an account matches this email, a reset code has been requested. Check your inbox and spam. If it does not arrive, try again later or contact support.';
const UNAVAILABLE_MESSAGE = 'Password reset email is currently unavailable. Please try again later or contact support.';
const keyFor = email => crypto.createHash('sha256').update(email).digest('hex');
const hashOtp = otp => crypto.createHmac('sha256', Config.SECRET_KEY).update(otp).digest('hex');

function utcMillis(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text)) return NaN;
  const iso = text.replace(' ', 'T');
  return Date.parse(iso + (/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? '' : 'Z'));
}

function clearVerification(app) {
  delete app.session.pw_otp_verified;
  delete app.session.pw_verified_at;
  delete app.session.pw_verified_user_id;
}

function logFailure(stage, error) {
  const message = String(error && error.message || error || 'Unknown error')
    .replace(/[\r\n\0]/g, ' ')
    .replace(/[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/g, '[email]')
    .replace(/\b[0-9a-f]{64}\b/gi, '[hash]')
    .replace(/\b\d{6}\b/g, '[code]')
    .slice(0, 500);
  console.error('[password-reset] ' + stage + ': ' + message);
}

async function emailLimit(scope, email, max, seconds) {
  try { return (await Database.consumeRate('pw:' + scope + ':' + keyFor(email), max, seconds)).allowed; }
  catch (error) { logFailure('rate-limit storage', error); return false; }
}

async function storageReady() {
  try {
    const db = await Database.get();
    const [columns] = await db.query("SHOW COLUMNS FROM password_otp LIKE 'id'");
    if (!columns.length || !/auto_increment/i.test(String(columns[0].Extra || ''))) {
      throw new Error('password_otp.id is missing AUTO_INCREMENT; inspect SHOW CREATE TABLE password_otp before repairing the legacy schema.');
    }
    return true;
  } catch (error) {
    logFailure('OTP storage (check password_otp schema)', error);
    return false;
  }
}

async function request(app, input) {
  clearVerification(app);
  const email = String(input || '').toLowerCase().trim();
  if (email.length > 120 || /[\0\r\n]/.test(email) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return { ok: false, error: 'bad_email', message: 'Please enter a valid email address.' };
  // This is checked for every address before account lookup: configuration errors
  // can be shown without revealing whether an account exists.
  const configError = Mailer.configurationError();
  if (configError) {
    logFailure('configuration', configError);
    return { ok: false, error: 'mail_unavailable', message: UNAVAILABLE_MESSAGE };
  }
  if (!(await app.throttle('otp_ip', 10, 3600))) {
    return { ok: false, error: 'throttled', message: 'Too many reset requests. Please try again later.' };
  }
  // Database-backed cooldown applies across sessions/IPs and both web/JSON
  // routes. Repeated clicks during the cooldown do not consume the email quota.
  if (!(await emailLimit('cooldown', email, 1, RESEND_WAIT))) {
    return { ok: false, error: 'wait', message: 'Please wait 60 seconds before requesting another code.' };
  }
  if (!(await emailLimit('request', email, 5, 3600))) {
    return { ok: false, error: 'throttled', message: 'Too many reset requests. Please try again later.' };
  }
  // Read-only preflight applies equally to known and unknown addresses. A
  // legacy schema problem is a service outage, not a pretend successful send.
  if (!(await storageReady())) return { ok: false, error: 'reset_unavailable', message: UNAVAILABLE_MESSAGE };
  let user;
  try { user = await Database.fetchOne('SELECT id, email FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1', [email]); }
  catch (error) {
    logFailure('account lookup', error);
    return { ok: false, error: 'reset_unavailable', message: UNAVAILABLE_MESSAGE };
  }
  app.session.pw_reset_email = email;
  app.session.pw_otp_sent_at = Math.floor(Date.now() / 1000);
  delete app.session.pw_fake_attempts;
  if (!user) {
    // Keep the public result identical for unknown addresses. Do not send mail.
    await new Promise(resolve => setTimeout(resolve, 400 + crypto.randomInt(0, 201)));
    return { ok: true, message: REQUEST_MESSAGE };
  }
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  let challenge;
  try {
    challenge = await Database.transaction(async conn => {
      const [users] = await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
      if (!users.length) throw new Error('Reset account is unavailable.');
      const [result] = await conn.execute(
        'INSERT INTO password_otp (email, otp_hash, expires_at, attempts, created_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), 0, UTC_TIMESTAMP())',
        [email, hashOtp(otp)]
      );
      const id = Number(result.insertId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('password_otp.id must generate a valid AUTO_INCREMENT ID.');
      const [stored] = await conn.execute('SELECT created_at FROM password_otp WHERE id = ?', [id]);
      if (!stored.length) throw new Error('OTP storage could not be confirmed.');
      return { id, createdAt: stored[0].created_at };
    });
  } catch (error) {
    // E.g. a legacy table missing AUTO_INCREMENT: log the storage failure, never
    // claim delivery or expose account existence in the public response.
    logFailure('OTP storage (check password_otp schema)', error);
    return { ok: true, message: REQUEST_MESSAGE };
  }
  let delivery;
  try { delivery = await Mailer.deliverOtpEmail(email, otp, TTL_MINUTES); }
  catch (error) { delivery = { ok: false, error: 'Unexpected mail transport error.' }; logFailure('mail transport', error); }
  try {
    await Database.transaction(async conn => {
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
      if (delivery.ok) {
        // Keep this accepted code; older codes cannot become valid again.
        await conn.execute('DELETE FROM password_otp WHERE email = ? AND id <> ? AND created_at <= ?', [email, challenge.id, challenge.createdAt]);
      } else {
        // A failed resend must not delete a previously working code.
        await conn.execute('DELETE FROM password_otp WHERE email = ? AND id = ?', [email, challenge.id]);
      }
    });
  } catch (error) { logFailure('challenge cleanup', error); }
  if (!delivery.ok) logFailure('delivery failed', delivery.error);
  else console.error('[password-reset] provider accepted ' + JSON.stringify({ provider: delivery.provider, messageId: delivery.messageId || '' }));
  return { ok: true, message: REQUEST_MESSAGE };
}

async function verify(app, input) {
  const email = String(app.session.pw_reset_email || '').toLowerCase().trim();
  if (!email) return { ok: false, error: 'start_over', message: 'Please enter your email first.' };
  const otp = String(input || '').trim();
  if (!/^\d{6}$/.test(otp)) return { ok: false, error: 'bad_otp', message: 'Please enter the 6-digit code.' };
  if (!(await app.throttle('otp_verify_ip', 30, 900)) ||
      !(await emailLimit('verify', email, 15, 900))) {
    return { ok: false, error: 'throttled', message: 'Too many verification attempts. Please try again later.' };
  }
  let result;
  try {
    result = await Database.transaction(async conn => {
      // Same user-row lock order as issuance: verification, attempt increments
      // and one-time consumption are serialized even across different sessions.
      const [users] = await conn.execute('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1 FOR UPDATE', [email]);
      if (!users.length) return { ok: false, error: 'invalid_code' };
      const [rows] = await conn.execute('SELECT * FROM password_otp WHERE email = ? ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE', [email]);
      const row = rows[0];
      if (!row) return { ok: false, error: 'invalid_code' };
      const expires = utcMillis(row.expires_at);
      if (!Number.isFinite(expires) || expires <= Date.now() || Number(row.attempts) >= MAX_ATTEMPTS) {
        await conn.execute('DELETE FROM password_otp WHERE email = ?', [email]);
        return { ok: false, error: 'invalid_code', remaining: 0 };
      }
      const expected = Buffer.from(String(row.otp_hash || ''), 'utf8');
      const received = Buffer.from(hashOtp(otp), 'utf8');
      if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        const remaining = Math.max(0, MAX_ATTEMPTS - Number(row.attempts || 0) - 1);
        await conn.execute('UPDATE password_otp SET attempts = attempts + 1 WHERE id = ?', [row.id]);
        if (!remaining) await conn.execute('DELETE FROM password_otp WHERE email = ?', [email]);
        return { ok: false, error: 'invalid_code', remaining };
      }
      await conn.execute('DELETE FROM password_otp WHERE email = ?', [email]);
      return { ok: true, userId: Number(users[0].id) };
    });
  } catch (error) {
    logFailure('verification storage', error);
    return { ok: false, error: 'reset_unavailable', message: UNAVAILABLE_MESSAGE };
  }
  if (!result.ok) {
    const remaining = result.remaining ?? Math.max(0, MAX_ATTEMPTS - Number(app.session.pw_fake_attempts || 0) - 1);
    app.session.pw_fake_attempts = MAX_ATTEMPTS - remaining;
    return { ok: false, error: 'invalid_code', message: remaining > 0 ? `Incorrect or expired code. ${remaining} attempt(s) left.` : 'Code unavailable or attempts exhausted. Please request a new code.' };
  }
  app.session.pw_otp_verified = true;
  app.session.pw_verified_at = Math.floor(Date.now() / 1000);
  app.session.pw_verified_user_id = result.userId;
  delete app.session.pw_fake_attempts;
  return { ok: true };
}

function clear(app) {
  clearVerification(app);
  delete app.session.pw_reset_email;
  delete app.session.pw_otp_sent_at;
  delete app.session.pw_fake_attempts;
}

module.exports = { request, verify, clear, utcMillis, TTL_MINUTES, MAX_ATTEMPTS, RESEND_WAIT, REQUEST_MESSAGE };
