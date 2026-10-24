'use strict';

const mysql = require('mysql2/promise');
const crypto = require('crypto');
const databaseOptions = require('../core/db-options');
const tableDefinitions = require('./schema');
const runMigrations = require('./migrations');
const runRetentionGc = require('./retention');

const SCHEMA_VERSION = 25;
let pool = null;
let inCreateAll = false;

const Database = {
  SCHEMA_VERSION,

  async get() {
    if (!pool) {
      pool = mysql.createPool(databaseOptions());
    }
    return pool;
  },

  async transaction(fn, {readCommitted = false} = {}) {
    const pool = await this.get();
    const conn = await pool.getConnection();
    try {
      // TiDB RR snapshots can predate a waited-on account lock. Wallet
      // aggregates must see the previous lock holder's committed tickets.
      // SET TRANSACTION applies to this next transaction only, not the pool.
      if (readCommitted) await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      try { await conn.rollback(); } catch {}
      throw error;
    } finally { conn.release(); }
  },

  async withLocks(keys, fn) {
    const db = await this.get(), conn = await db.getConnection();
    const acquired = [];
    try {
      for (const key of [...new Set(keys)].sort()) {
        const name = 'cine:' + crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 58);
        const [rows] = await conn.query('SELECT GET_LOCK(?, 5) AS acquired', [name]);
        if (Number(rows[0].acquired) !== 1) throw new Error('Resource busy; please retry.');
        acquired.push(name);
      }
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit(); return result;
    } catch (error) { try { await conn.rollback(); } catch {} throw error; }
    finally {
      for (const name of acquired.reverse()) { try { await conn.query('SELECT RELEASE_LOCK(?)', [name]); } catch {} }
      conn.release();
    }
  },

  async consumeRate(key, max, seconds) {
    return this.transaction(async conn => {
      await conn.execute('INSERT INTO rate_limits (rate_key, cnt, window_start) VALUES (?, 0, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE rate_key = VALUES(rate_key)', [key]);
      const [rows] = await conn.execute('SELECT cnt, TIMESTAMPDIFF(SECOND, window_start, UTC_TIMESTAMP()) AS age FROM rate_limits WHERE rate_key = ? FOR UPDATE', [key]);
      const row = rows[0];
      if (Number(row.age) >= seconds) {
        await conn.execute('UPDATE rate_limits SET cnt = 1, window_start = UTC_TIMESTAMP() WHERE rate_key = ?', [key]);
        return {allowed: true, count: 1};
      }
      if (Number(row.cnt) >= max) return {allowed: false, count: Number(row.cnt)};
      await conn.execute('UPDATE rate_limits SET cnt = cnt + 1 WHERE rate_key = ?', [key]);
      return {allowed: true, count: Number(row.cnt) + 1};
    });
  },

  async close() {
    if (pool) { const current = pool; pool = null; await current.end(); }
  },

  async execSql(sql) {
    const db = await this.get();
    await db.query(sql);
  },

  async tryExec(sql) {
    try { await this.execSql(sql); } catch (e) { /* column/index already exists */ }
  },

  isMissingTableError(e) {
    const msg = String(e && e.message || '').toLowerCase();
    return msg.includes("doesn't exist")
      || msg.includes('base table or view not found')
      || msg.includes('42s02')
      || e.code === 'ER_NO_SUCH_TABLE';
  },

  async fetchOne(sql, params = []) {
    const db = await this.get();
    try {
      const [rows] = await db.execute(sql, params);
      return rows[0] || null;
    } catch (e) {
      if (this.isMissingTableError(e)) {
        await this.createAll();
        const [rows] = await db.execute(sql, params);
        return rows[0] || null;
      }
      throw e;
    }
  },

  async fetchAll(sql, params = []) {
    const db = await this.get();
    try {
      const [rows] = await db.execute(sql, params);
      return rows;
    } catch (e) {
      if (this.isMissingTableError(e)) {
        await this.createAll();
        const [rows] = await db.execute(sql, params);
        return rows;
      }
      throw e;
    }
  },

  async execute(sql, params = []) {
    const db = await this.get();
    try {
      const [res] = await db.execute(sql, params);
      return res.affectedRows || 0;
    } catch (e) {
      if (this.isMissingTableError(e)) {
        await this.createAll();
        const [res] = await db.execute(sql, params);
        return res.affectedRows || 0;
      }
      throw e;
    }
  },

  shortCode(len = 12) {
    return crypto.randomBytes(8).toString('hex').slice(0, len);
  },

  async ensureIndex(table, indexName, columns) {
    const cols = columns.map((c) => c.replace(/[^A-Za-z0-9_]/g, '')).join(', ');
    try {
      const db = await this.get();
      const [rows] = await db.execute('SHOW INDEX FROM `' + table.replace(/[^A-Za-z0-9_]/g, '') + '` WHERE Key_name = ?', [indexName]);
      if (rows.length) return;
      await this.execSql(`ALTER TABLE ${table} ADD INDEX ${indexName} (${cols})`);
    } catch (e) {
      console.error('[ensureIndex] ' + table + '.' + indexName + ': ' + e.message);
    }
  },

  async opportunisticGc() {
    return runRetentionGc(this);
  },

  async ensureSchema() {
    const db = await this.get();
    try {
      const [rows] = await db.query('SELECT MAX(version) AS v FROM schema_migrations');
      const current = Number(rows[0] && rows[0].v || 0);
      if (current >= SCHEMA_VERSION) {
        await db.query('SELECT 1 FROM users LIMIT 1');
        await this.opportunisticGc();
        return;
      }
    } catch { /* migrate */ }
    await this.createAll();
  },

  async deleteUserCascade(userId) {
    const db = await this.get();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
      await conn.execute('DELETE FROM playlist_movies WHERE playlist_id IN (SELECT id FROM playlist WHERE user_id = ?)', [userId]);
      const [uRows] = await conn.execute('SELECT email FROM users WHERE id = ?', [userId]);
      if (uRows[0] && uRows[0].email) {
        await conn.execute('DELETE FROM password_otp WHERE email = ?', [uRows[0].email]);
      }
      for (const table of [
        'watch_history', 'watchlist', 'user_requests', 'user_profiles',
        'notifications', 'reviews', 'playlist',
        'cine_match_friends', 'oauth_accounts',
        'active_sessions', 'announcement_reads', 'live_presence', 'user_wallet',
        'app_reward_usage', 'app_ad_diagnostics', 'app_ad_tickets', 'reward_events',
      ]) {
        try {
          if (table === 'cine_match_friends') {
            await conn.execute('DELETE FROM cine_match_friends WHERE user_id = ? OR friend_id = ?', [userId, userId]);
            continue;
          }
          await conn.execute(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
        } catch { /* table may not exist */ }
      }
      await conn.execute('DELETE FROM users WHERE id = ?', [userId]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  async createAll() {
    if (inCreateAll) return;
    inCreateAll = true;
    const Security = require('../security');
    try {
      const db = await this.get();
      await this.execSql(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const [verRows] = await db.query('SELECT MAX(version) AS v FROM schema_migrations');
      let applied = Number(verRows[0] && verRows[0].v || 0);

      for (const sql of tableDefinitions()) await this.execSql(sql);

      await this.seedHelpArticles();

      await runMigrations(this, db, applied, Security);

    } finally {
      inCreateAll = false;
    }
  },

  async seedHelpArticles() {
    try {
      const count = await this.fetchOne('SELECT COUNT(*) AS c FROM help_articles');
      if (count && Number(count.c) > 0) return;
      const articles = require('../help-seed');
      for (const a of articles) {
        await this.execute(
          'INSERT INTO help_articles (topic, title, slug, content) VALUES (?, ?, ?, ?)',
          [a[0], a[1], a[2], a[3]]
        );
      }
    } catch (e) {
      console.error('[HelpCenter] seed failed: ' + e.message);
    }
  },

};

module.exports = Database;
