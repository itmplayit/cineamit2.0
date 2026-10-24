'use strict';
const crypto = require('crypto');

const TABLE = 'app_ad_tickets';
const ident = value => '`' + String(value).replace(/`/g, '``') + '`';
const columnsOf = rows => rows.slice().sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index)).map(r => String(r.Column_name));
const isCurrent = columns => columns.length === 2 && columns[0] === 'user_id' && columns[1] === 'ticket';
const isLegacy = columns => columns.length === 1 && columns[0] === 'user_id';
const clusteredError = error => /unsupported drop primary key.*clustered index/i.test(String(error && (error.sqlMessage || error.message)));
function migrationError(message, cause) {
  return Object.assign(new Error(message), {code: 'CINE_TICKET_MIGRATION', cause});
}
async function primary(conn, table = TABLE) {
  const [rows] = await conn.query('SHOW INDEX FROM ' + ident(table) + " WHERE Key_name = 'PRIMARY'");
  return columnsOf(rows);
}

// DDL is not a transactional wallet mutation. In particular, TiDB cannot DROP
// an existing clustered PK, even if tidb_enable_clustered_index is changed.
async function ensureTicketPrimaryKey(pool, {allowRebuild = false} = {}) {
  const initial = await primary(pool);
  if (isCurrent(initial)) return {changed: false};
  if (!isLegacy(initial)) throw migrationError('Unexpected reward-ticket primary key. Keep the database intact and inspect it before migrating.');
  const conn = await pool.getConnection();
  let locked = false, lockName, stage = '', backup = '', renameAttempted = false;
  try {
    const [schema] = await conn.query('SELECT DATABASE() AS db_name');
    if (!schema[0] || !schema[0].db_name) throw migrationError('Select a database before migrating reward tickets.');
    lockName = 'cine:ticket-key:' + crypto.createHash('sha256').update(String(schema[0].db_name)).digest('hex').slice(0, 40);
    const [locks] = await conn.query('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
    if (!locks[0] || Number(locks[0].acquired) !== 1) throw migrationError('Another reward-ticket migration is busy. Run a single migration worker and retry later.');
    locked = true;
    const current = await primary(conn);
    if (isCurrent(current)) return {changed: false};
    if (!isLegacy(current)) throw migrationError('Reward-ticket key changed unexpectedly; manual schema inspection is required.');
    try {
      // Ordinary MySQL/MariaDB retain the atomic in-place path. Some TiDB
      // versions reject this combined ALTER even for NONCLUSTERED keys.
      // Never split DROP/ADD into separately committed, crash-unsafe DDL.
      await conn.query('ALTER TABLE app_ad_tickets DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, ticket)');
      if (!isCurrent(await primary(conn))) throw migrationError('Reward-ticket key change was not confirmed.');
      return {changed: true, method: 'alter'};
    } catch (error) {
      let needsRebuild = clusteredError(error);
      if (!needsRebuild && Number(error.errno) === 1068) {
        const [version] = await conn.query('SELECT VERSION() AS version');
        needsRebuild = /TiDB/i.test(String(version[0] && version[0].version));
      }
      if (!needsRebuild) throw error;
      if (!isLegacy(await primary(conn))) throw migrationError('Ticket key changed after rejected ALTER. Inspect the schema before retrying.', error);
      if (allowRebuild !== true) throw migrationError('Legacy TiDB/clustered reward-ticket key requires a controlled rebuild. Back up the DB, stop ALL app/cron workers, and temporarily set APP_ALLOW_TICKET_TABLE_REBUILD=true in .env. See TIDB-STARTUP-FIX.md. Do not delete tables or skip migration versions.', error);
    }
    // Opt-in asserts a maintenance window. Advisory locks serialize cooperating
    // migrations, not unrelated/old application writers; those MUST be stopped.
    const [refs] = await conn.query('SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?', [TABLE]);
    if (refs.length) throw migrationError('Reward tickets have inbound foreign keys; use a DBA-managed migration instead of automatic rebuild.');
    const [triggers] = await conn.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = ?', [TABLE]);
    if (triggers.length) throw migrationError('Reward tickets have custom triggers; use a DBA-managed migration instead of automatic rebuild.');
    const [createRows] = await conn.query('SHOW CREATE TABLE app_ad_tickets');
    const originalDdl = createRows[0] && createRows[0]['Create Table'];
    if (typeof originalDdl !== 'string' || /\bFOREIGN KEY\b|\bPARTITION BY\b/i.test(originalDdl)) throw migrationError('Unsupported custom reward-ticket schema; a DBA-managed migration is required.');
    const [columns] = await conn.query('SHOW COLUMNS FROM app_ad_tickets');
    const user = columns.find(c => c.Field === 'user_id'), ticket = columns.find(c => c.Field === 'ticket');
    if (!user || !/^int(?:\(\d+\))?(?: unsigned)?$/i.test(user.Type) || !ticket || !/^char\(32\)$/i.test(ticket.Type)) throw migrationError('Unexpected reward-ticket identity types; no automatic data conversion was attempted.');
    const nonce = crypto.randomBytes(8).toString('hex');
    stage = 'app_ad_tickets_v24_stage_' + nonce;
    backup = 'app_ad_tickets_v24_backup_' + nonce;
    let ddl = originalDdl.replace(/^CREATE TABLE\s+`app_ad_tickets`(?=\s*\()/i, 'CREATE TABLE ' + ident(stage));
    ddl = ddl.replace(/^\s*PRIMARY KEY\s*\(\s*`user_id`\s*\)/im, 'PRIMARY KEY (`user_id`,`ticket`)');
    if (ddl === originalDdl || !ddl.startsWith('CREATE TABLE ' + ident(stage)) || !/PRIMARY KEY\s*\(`user_id`,`ticket`\)/.test(ddl)) throw migrationError('Could not safely construct the replacement ticket schema.');
    await conn.query(ddl);
    if (!isCurrent(await primary(conn, stage))) throw migrationError('Replacement ticket key is unexpected. No table swap was attempted.');
    const writable = columns.filter(c => !/\b(?:VIRTUAL|STORED) GENERATED\b/i.test(String(c.Extra || ''))).map(c => c.Field);
    const list = writable.map(ident).join(',');
    let cursor = null;
    for (;;) {
      const [keys] = await conn.query('SELECT user_id FROM app_ad_tickets' + (cursor === null ? '' : ' WHERE user_id > ?') + ' ORDER BY user_id LIMIT 1000', cursor === null ? [] : [cursor]);
      if (!keys.length) break;
      const upper = Number(keys[keys.length - 1].user_id);
      if (!Number.isSafeInteger(upper) || (cursor !== null && upper <= cursor)) throw migrationError('Invalid ticket-copy cursor. Original and staging tables are retained.');
      const where = cursor === null ? ' WHERE user_id <= ?' : ' WHERE user_id > ? AND user_id <= ?';
      await conn.query('INSERT INTO ' + ident(stage) + ' (' + list + ') SELECT ' + list + ' FROM app_ad_tickets' + where, cursor === null ? [upper] : [cursor, upper]);
      cursor = upper;
    }
    const [beforeRows] = await conn.query('SELECT COUNT(*) AS c FROM app_ad_tickets');
    const [afterRows] = await conn.query('SELECT COUNT(*) AS c FROM ' + ident(stage));
    if (String(beforeRows[0].c) !== String(afterRows[0].c)) throw migrationError('Ticket-copy counts differ. No table swap was attempted; stop all writers and inspect the retained stage.');
    const differences = columns.map(c => 'NOT (BINARY o.' + ident(c.Field) + ' <=> BINARY n.' + ident(c.Field) + ')').join(' OR ');
    const [bad] = await conn.query('SELECT COUNT(*) AS c FROM app_ad_tickets o LEFT JOIN ' + ident(stage) + ' n ON o.user_id = n.user_id AND BINARY o.ticket = BINARY n.ticket WHERE n.user_id IS NULL OR ' + differences);
    if (Number(bad[0].c) !== 0) throw migrationError('Ticket-copy contents differ. No table swap was attempted; stop all writers and inspect the retained stage.');
    renameAttempted = true;
    // One atomic statement: there is no interval with the live table absent.
    // The original stays as a private recovery backup; never DROP it here.
    await conn.query('RENAME TABLE app_ad_tickets TO ' + ident(backup) + ', ' + ident(stage) + ' TO app_ad_tickets');
    if (!isCurrent(await primary(conn))) throw migrationError('Replacement ticket key was not confirmed after rename.');
    const [live] = await conn.query('SELECT COUNT(*) AS c FROM app_ad_tickets');
    if (String(live[0].c) !== String(beforeRows[0].c)) throw migrationError('Post-rename ticket count was not confirmed. Inspect the retained backup.');
    console.warn('[schema] Reward-ticket clustered key migrated. Original table retained as ' + backup + '. Remove the maintenance flag; review backup retention after validation.');
    return {changed: true, method: 'rebuild', backup, rows: String(live[0].c)};
  } catch (error) {
    if (stage) throw migrationError('Reward-ticket migration did not confirm completion. ' + (renameAttempted ? 'Rename was attempted; inspect the live key and retained tables before retrying. ' : 'No table swap was attempted. ') + 'Stage: ' + stage + '; backup name: ' + backup + '. No tables were dropped. Cause: ' + error.message, error);
    throw error;
  } finally {
    if (locked) { try { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch {} }
    conn.release();
  }
}
module.exports = {ensureTicketPrimaryKey};
