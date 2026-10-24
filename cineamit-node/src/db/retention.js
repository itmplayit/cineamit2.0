'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const retentionState = { running: false, completed_at: 0, next_attempt_at: 0, failures: 0, checkpoint_failed: false };

/**
 * Opportunistic retention GC (lease file + checkpoint + bounded retries) —
 * verbatim logic from the original Database.opportunisticGc(). ctx = Database API (execSql).
 */
module.exports = async function opportunisticGc(ctx) {
    if (retentionState.running) return;
    const guard = path.join(os.tmpdir(), 'cineamit_gc_last_' + crypto.createHash('md5').update(__dirname).digest('hex').slice(0, 8));
    const lease = guard + '.lock';
    let ownsLease = false;
    const warn = (table, error) => {
      const code = /^[A-Z0-9_]{1,64}$/.test(String(error && error.code)) ? error.code : 'UNAVAILABLE';
      console.error('[retention] ' + table + ' cleanup unavailable (' + code + '); bounded retry will follow.');
    };
    try {
      let state = retentionState;
      try {
        const saved = JSON.parse(fs.readFileSync(guard, 'utf8'));
        if (saved && typeof saved === 'object' && ['completed_at', 'next_attempt_at', 'failures'].every(k => Number.isSafeInteger(saved[k]) && saved[k] >= 0)) state = saved;
        else if (typeof saved === 'number') state = {completed_at: Math.floor(fs.statSync(guard).mtimeMs), next_attempt_at: Math.floor(fs.statSync(guard).mtimeMs) + 21600_000, failures: 0};
      } catch { /* No usable checkpoint; local backoff still protects this worker. */ }
      if (retentionState.checkpoint_failed && retentionState.next_attempt_at > state.next_attempt_at) state = retentionState;
      if (Date.now() < state.next_attempt_at) return;
      try {
        const fd = fs.openSync(lease, 'wx'); fs.closeSync(fd); ownsLease = true;
      } catch (error) {
        if (error.code === 'EEXIST') {
          // Recover an abandoned lease on a later trigger, never wait in a request.
          try { if (Date.now() - fs.statSync(lease).mtimeMs > 300_000) fs.unlinkSync(lease); } catch {}
          return;
        }
        warn('checkpoint lease', error); // Read-only temp storage must not disable cleanup.
      }
      retentionState.running = true;
      let failed = false;
      const jobs = [
        ['app_ad_tickets', 'DELETE FROM app_ad_tickets WHERE expires_at < (UNIX_TIMESTAMP() * 1000) - 604800000'],
        ['app_ad_diagnostics', 'DELETE FROM app_ad_diagnostics WHERE received_at < (UTC_TIMESTAMP() - INTERVAL 7 DAY)'],
        ['app_ads_settings_history', 'DELETE FROM app_ads_settings_history WHERE created_at < (UTC_TIMESTAMP() - INTERVAL 90 DAY)'],
        ['app_reward_usage', "DELETE FROM app_reward_usage WHERE day_key < DATE_FORMAT(UTC_DATE() - INTERVAL 30 DAY, '%Y-%m-%d')"],
        ['password_otp', 'DELETE FROM password_otp WHERE expires_at < (NOW() - INTERVAL 1 DAY)'],
        ['rate_limits', 'DELETE FROM rate_limits WHERE window_start < (NOW() - INTERVAL 1 DAY)'],
        ['error_log', 'DELETE FROM error_log WHERE created_at < (NOW() - INTERVAL 90 DAY)'],
        ['active_sessions', 'DELETE FROM active_sessions WHERE created_at < (NOW() - INTERVAL 30 DAY)'],
        ['live_presence', 'DELETE FROM live_presence WHERE last_seen < (NOW() - INTERVAL 1 DAY)'],
        ['party_messages', 'DELETE FROM party_messages WHERE created_at < (NOW() - INTERVAL 24 HOUR)'],
        ['web_watch_hits', 'DELETE FROM web_watch_hits WHERE watched_at < (NOW() - INTERVAL 40 DAY)'],
      ];
      for (const [table, sql] of jobs) {
        try { await ctx.execSql(sql); }
        catch (error) {
          // Missing optional legacy tables cannot prevent operational retention.
          if (!table.startsWith('app_') && error.code === 'ER_NO_SUCH_TABLE') continue;
          failed = true; warn(table, error);
        }
      }
      const now = Date.now(), failures = failed ? Math.min(5, Number(state.failures || 0) + 1) : 0;
      const next = {completed_at: failed ? Number(state.completed_at || 0) : now,
        next_attempt_at: now + (failed ? Math.min(900_000, 60_000 * 2 ** (failures - 1)) : 21600_000), failures};
      Object.assign(retentionState, next);
      let tmp;
      try {
        tmp = guard + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex');
        fs.writeFileSync(tmp, JSON.stringify(next)); fs.renameSync(tmp, guard); retentionState.checkpoint_failed = false;
      } catch (error) { retentionState.checkpoint_failed = true; warn('checkpoint', error); if (tmp) { try { fs.unlinkSync(tmp); } catch {} } }
    } catch (error) {
      retentionState.next_attempt_at = Date.now() + 60_000; retentionState.checkpoint_failed = true;
      warn('runner', error);
    } finally {
      if (ownsLease) { try { fs.unlinkSync(lease); } catch {} }
      retentionState.running = false;
    }
};
