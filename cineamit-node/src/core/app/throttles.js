'use strict';

const crypto = require('crypto');
const Database = require('../../db');
const { LOGIN_FAIL_MAX, LOGIN_FAIL_WINDOW } = require('./helpers');

// Throttle + account-lock methods (moved verbatim from core/app.js; mixed into App.prototype).
module.exports = {
  throttleStorageKey(key) {
    return crypto.createHash('md5').update(this.clientIp() + '|' + key).digest('hex').slice(0, 48);
  },

  async throttleAvailable(key, max, windowSeconds) {
    try {
      const fullKey = this.throttleStorageKey(key);
      const row = await Database.fetchOne('SELECT cnt, window_start FROM rate_limits WHERE rate_key = ?', [fullKey]);
      if (!row || (Date.now() / 1000 - (Date.parse(row.window_start) / 1000)) > windowSeconds) return true;
      return Number(row.cnt) < max;
    } catch (e) {
      console.error('[throttle] fail-closed check for key=' + key + ': ' + e.message);
      return false;
    }
  },

  async recordThrottleFailure(key, max, windowSeconds) {
    try { await Database.consumeRate(this.throttleStorageKey(key), max, windowSeconds); }
    catch (error) { console.error('[throttle]', error.message); }
  },

  async resetThrottle(key) {
    try { await Database.execute('DELETE FROM rate_limits WHERE rate_key = ?', [this.throttleStorageKey(key)]); } catch (e) {
      console.error('[throttle] could not reset key=' + key + ': ' + e.message);
    }
  },

  async throttle(key, max, windowSeconds) {
    try { return (await Database.consumeRate(this.throttleStorageKey(key), max, windowSeconds)).allowed; }
    catch (error) { console.error('[throttle] fail-closed:', error.message); return false; }
  },

  accountLockKey(uid) { return crypto.createHash('md5').update('acc|' + uid).digest('hex').slice(0, 48); },
  accountTotpKey(uid) { return crypto.createHash('md5').update('totp|' + uid).digest('hex').slice(0, 48); },

  async accountLoginLocked(uid) {
    try {
      const row = await Database.fetchOne('SELECT cnt, window_start FROM rate_limits WHERE rate_key = ?', [this.accountLockKey(uid)]);
      if (!row) return false;
      if ((Date.now() / 1000 - Date.parse(row.window_start) / 1000) > LOGIN_FAIL_WINDOW) return false;
      return Number(row.cnt) >= LOGIN_FAIL_MAX;
    } catch { return false; }
  },

  async accountLoginFailed(uid) {
    try {
      const result = await Database.consumeRate(this.accountLockKey(uid), LOGIN_FAIL_MAX, LOGIN_FAIL_WINDOW);
      return result.count >= LOGIN_FAIL_MAX ? 'locked' : 'counted';
    } catch { return 'locked'; }
  },

  async accountLoginReset(uid) {
    try { await Database.execute('DELETE FROM rate_limits WHERE rate_key = ?', [this.accountLockKey(uid)]); } catch {}
  },

  async accountTotpLocked(uid) {
    try {
      const row = await Database.fetchOne('SELECT cnt, window_start FROM rate_limits WHERE rate_key = ?', [this.accountTotpKey(uid)]);
      if (!row) return false;
      if ((Date.now() / 1000 - Date.parse(row.window_start) / 1000) > LOGIN_FAIL_WINDOW) return false;
      return Number(row.cnt) >= LOGIN_FAIL_MAX;
    } catch { return false; }
  },

  async accountTotpFailed(uid) {
    try {
      const result = await Database.consumeRate(this.accountTotpKey(uid), LOGIN_FAIL_MAX, LOGIN_FAIL_WINDOW);
      return result.count >= LOGIN_FAIL_MAX ? 'locked' : 'counted';
    } catch { return 'locked'; }
  },

  async accountTotpReset(uid) {
    try { await Database.execute('DELETE FROM rate_limits WHERE rate_key = ?', [this.accountTotpKey(uid)]); } catch {}
  },
};
