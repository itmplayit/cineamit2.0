'use strict';

const { ensureTicketPrimaryKey } = require('./ticket-schema');

/**
 * Version-guarded schema migrations (v11..v25) — verbatim logic from the original createAll().
 * ctx = Database API (execSql/tryExec/execute/fetchOne/fetchAll/ensureIndex);
 * db  = raw mysql2 pool (for SHOW/inspection queries); Security passed to avoid load-order coupling.
 */
module.exports = async function runMigrations(ctx, db, applied, Security) {
      if (applied < 11) {
        const legacyServers = [
          ['https://vidsrc.xyz/embed/movie?tmdb={tmdb_id}', 'https://vidsrc.xyz/embed/tv?tmdb={tmdb_id}&season={s}&episode={e}'],
          ['https://multiembed.mov/?video_id={tmdb_id}&tmdb=1', 'https://multiembed.mov/?video_id={tmdb_id}&tmdb=1&s={s}&e={e}'],
          ['https://player.autoembed.cc/embed/movie/{tmdb_id}', 'https://player.autoembed.cc/embed/tv/{tmdb_id}/{s}/{e}'],
        ];
        for (const [moviePattern, tvPattern] of legacyServers) {
          try { await ctx.execute('DELETE FROM server_model WHERE movie_pattern = ? AND tv_pattern = ?', [moviePattern, tvPattern]); } catch {}
        }
        try { await ctx.execute('DELETE FROM download_setting WHERE pattern_url = ?', ['https://cineamit.blogspot.com/?id={tmdb_id}&type={media_type}']); } catch {}
        try { await ctx.execute('DELETE FROM proxies WHERE url = ?', ['https://frosty-snowflake-6d02.itmplayit.workers.dev/?url=']); } catch {}
        try { await ctx.execute("DELETE FROM site_setting WHERE setting_key = 'M3U_PLAYLISTS' AND setting_value = ?", ['http://mag.senpay25.com:80/c/|00:1A:79:00:00:01']); } catch {}
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (11)");
      }
      if (applied < 12) {
        await ctx.ensureIndex('notifications', 'idx_notif_user_read', ['user_id', 'is_read']);
        await ctx.ensureIndex('notifications', 'idx_notif_user_created', ['user_id', 'created_at']);
        await ctx.ensureIndex('user_profiles', 'idx_up_user', ['user_id']);
        await ctx.ensureIndex('reviews', 'idx_rv_tmdb', ['tmdb_id', 'media_type']);
        await ctx.ensureIndex('reviews', 'idx_rv_user', ['user_id', 'profile_id']);
        await ctx.ensureIndex('playlist', 'idx_pl_user', ['user_id', 'profile_id']);
        await ctx.ensureIndex('playlist_movies', 'idx_pm_playlist', ['playlist_id']);
        await ctx.ensureIndex('watchlist', 'idx_wl_user_profile', ['user_id', 'profile_id']);
        await ctx.ensureIndex('watchlist', 'idx_wl_tmdb', ['tmdb_id']);
        await ctx.ensureIndex('watch_history', 'idx_wh_user_profile', ['user_id', 'profile_id']);
        await ctx.ensureIndex('live_presence', 'idx_lp_last_seen', ['last_seen']);
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (12)");
      }
      if (applied < 13) {
        await ctx.tryExec('ALTER TABLE user_profiles MODIFY COLUMN pin VARCHAR(255) DEFAULT NULL');
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (13)");
      }
      if (applied < 14) {
        try {
          await ctx.execSql(`DELETE w1 FROM watchlist w1 JOIN watchlist w2
            ON w1.user_id = w2.user_id AND w1.profile_id = w2.profile_id
            AND w1.tmdb_id = w2.tmdb_id AND w1.id > w2.id`);
          const wlIdx = await ctx.fetchAll("SHOW INDEX FROM watchlist WHERE Key_name = 'uniq_wl_user_profile_tmdb'");
          if (!wlIdx.length) {
            await ctx.execSql('ALTER TABLE watchlist ADD UNIQUE KEY uniq_wl_user_profile_tmdb (user_id, profile_id, tmdb_id)');
          }
        } catch (e) {
          console.error('[migration14] watchlist unique key: ' + e.message);
        }
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (14)");
      }
      if (applied < 15) {
        await ctx.tryExec('ALTER TABLE users MODIFY COLUMN totp_secret VARCHAR(160) DEFAULT NULL');
        if (Security.totpEncryptionAvailable()) {
          const totpRows = await ctx.fetchAll("SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL AND totp_secret <> ''");
          for (const totpRow of totpRows) {
            const storedSecret = String(totpRow.totp_secret);
            if (Security.totpSecretIsEncrypted(storedSecret)) continue;
            await ctx.execute('UPDATE users SET totp_secret = ? WHERE id = ? AND totp_secret = ?', [
              Security.encryptTotpSecret(storedSecret), totpRow.id, storedSecret,
            ]);
          }
        }
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (15)");
      }
      if (applied < 16) {
        await ctx.tryExec('ALTER TABLE xtream_servers MODIFY COLUMN username TEXT NOT NULL');
        await ctx.tryExec('ALTER TABLE xtream_servers MODIFY COLUMN password TEXT NOT NULL');
        if (Security.xtreamEncryptionAvailable()) {
          const credentialRows = await ctx.fetchAll('SELECT id, username, password FROM xtream_servers');
          for (const row of credentialRows) {
            let username = String(row.username);
            let password = String(row.password);
            if (!Security.xtreamCredentialIsEncrypted(username)) username = Security.encryptXtreamCredential(username, 'username');
            if (!Security.xtreamCredentialIsEncrypted(password)) password = Security.encryptXtreamCredential(password, 'password');
            await ctx.execute('UPDATE xtream_servers SET username = ?, password = ? WHERE id = ?', [username, password, row.id]);
          }
        } else {
          const cnt = await ctx.fetchOne("SELECT COUNT(*) AS c FROM xtream_servers WHERE username <> '' OR password <> ''");
          if (cnt && Number(cnt.c) > 0) {
            throw new Error('Xtream credential migration requires AES-GCM support.');
          }
        }
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (16)");
      }
      if (applied < 17) {
        try { await ctx.execSql('ALTER TABLE watch_history DROP INDEX unique_watch'); } catch (e) { /* missing */ }
        try {
          await ctx.execSql('ALTER TABLE watch_history ADD UNIQUE KEY unique_watch (user_id, profile_id, tmdb_id, media_type)');
        } catch (e) {
          console.error('[migration17] unique_watch: ' + e.message);
        }
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (17)");
      }
      if (applied < 18) {
        await ctx.tryExec(`CREATE TABLE IF NOT EXISTS user_wallet (
          user_id INT PRIMARY KEY,
          points INT NOT NULL DEFAULT 0,
          plan VARCHAR(16) NOT NULL DEFAULT 'free',
          plan_until BIGINT NOT NULL DEFAULT 0,
          seeded TINYINT(1) NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        const seeds = [
          ['APP_ADS_ENABLED', '1'],
          ['APP_ADS_BANNER', '1'],
          ['APP_ADS_INTERSTITIAL', '1'],
          ['APP_ADS_REWARDED', '1'],
          ['APP_AD_POINTS', '50'],
          ['APP_COST_MONTHLY', '500'],
          ['APP_COST_YEARLY', '4500'],
        ];
        for (const [k, v] of seeds) {
          try {
            await ctx.execute(
              'INSERT IGNORE INTO site_setting (setting_key, setting_value) VALUES (?, ?)',
              [k, v]
            );
          } catch { /* ignore */ }
        }
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (18)");
      }
      if (applied < 19) {
        await ctx.tryExec(`CREATE TABLE IF NOT EXISTS web_watch_hits (
          viewer_key VARCHAR(80) NOT NULL,
          tmdb_id INT NOT NULL,
          media_type VARCHAR(10) NOT NULL,
          day_key CHAR(10) NOT NULL,
          watched_at DATETIME NOT NULL,
          PRIMARY KEY (viewer_key, tmdb_id, media_type, day_key),
          KEY idx_wwh_viewer_day (viewer_key, day_key),
          KEY idx_wwh_watched (watched_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        const watchSeeds = [
          ['WEB_WATCH_LIMIT_ENABLED', '1'],
          ['WEB_WATCH_DAILY', '10'],
          ['WEB_WATCH_WINDOW_DAYS', '1'],
          ['WEB_WATCH_WINDOW_MAX', '0'],
          ['WEB_WATCH_GUESTS', '1'],
          ['WEB_WATCH_IP_LIMIT', '0'],
          ['WEB_WATCH_EXEMPT_STAFF', '1'],
          ['WEB_WATCH_EXEMPT_KIDS', '1'],
        ];
        for (const [k, v] of watchSeeds) {
          try {
            await ctx.execute(
              'INSERT IGNORE INTO site_setting (setting_key, setting_value) VALUES (?, ?)',
              [k, v]
            );
          } catch { /* ignore */ }
        }
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (19)");
      }
      if (applied < 20) {
        await ctx.tryExec('DROP TABLE IF EXISTS web_watch_hits');
        await ctx.tryExec(`CREATE TABLE IF NOT EXISTS web_watch_hits (
          viewer_key VARCHAR(80) NOT NULL,
          title_key VARCHAR(80) NOT NULL,
          day_key CHAR(10) NOT NULL,
          watched_at DATETIME NOT NULL,
          PRIMARY KEY (viewer_key, title_key, day_key),
          KEY idx_wwh_viewer_day (viewer_key, day_key),
          KEY idx_wwh_watched (watched_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        try {
          await ctx.execute(
            "INSERT INTO site_setting (setting_key, setting_value) VALUES ('WEB_WATCH_IP_LIMIT', '0') ON DUPLICATE KEY UPDATE setting_value = '0'"
          );
          await ctx.execute(
            "INSERT INTO site_setting (setting_key, setting_value) VALUES ('WEB_WATCH_EXEMPT_KIDS', '1') ON DUPLICATE KEY UPDATE setting_value = '1'"
          );
        } catch { /* ignore */ }
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (20)");
      }
      if (applied < 21) {
        await ctx.tryExec(`CREATE TABLE IF NOT EXISTS app_ad_tickets (
          user_id INT NOT NULL,
          ticket CHAR(32) NOT NULL,
          expires_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, ticket),
          KEY idx_aat_exp (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (21)");
      }
      if (applied < 22) {
        await ctx.tryExec('ALTER TABLE user_wallet ADD COLUMN trial_used TINYINT(1) NOT NULL DEFAULT 0');
        await ctx.tryExec("INSERT IGNORE INTO schema_migrations (version) VALUES (22)");
      }
      if (applied < 23) {
        // New rows use media type in their identity: movie and TV IDs can overlap.
        const db = await ctx.get();
        const [columns] = await db.query("SHOW COLUMNS FROM user_profiles LIKE 'preferences'");
        if (!columns.length) await ctx.execSql("ALTER TABLE user_profiles ADD COLUMN preferences TEXT DEFAULT NULL");
        await ctx.execSql(`CREATE TABLE IF NOT EXISTS reward_events (
          event_id VARCHAR(128) PRIMARY KEY, user_id INT NOT NULL, ticket CHAR(32) NOT NULL,
          verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_reward_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        const [ticketCols] = await db.query("SHOW COLUMNS FROM app_ad_tickets LIKE 'verified'");
        if (!ticketCols.length) await ctx.execSql('ALTER TABLE app_ad_tickets ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0');
        const [indexes] = await db.query("SHOW INDEX FROM watchlist WHERE Key_name = 'uniq_wl_user_profile_media'");
        if (!indexes.length) await ctx.execSql('ALTER TABLE watchlist ADD UNIQUE KEY uniq_wl_user_profile_media (user_id, profile_id, tmdb_id, media_type)');
        const [oldIndexes] = await db.query("SHOW INDEX FROM watchlist WHERE Key_name = 'uniq_wl_user_profile_tmdb'");
        if (oldIndexes.length) await ctx.execSql('ALTER TABLE watchlist DROP INDEX uniq_wl_user_profile_tmdb');
        await ctx.execSql("INSERT IGNORE INTO schema_migrations (version) VALUES (23)");
      }


      if (applied < 24) {
        // Retain independent pending attempts and idempotent completed receipts for delayed SSV.
        const db = await ctx.get();
        for (const [name, ddl] of [
          ['credited', 'TINYINT(1) NOT NULL DEFAULT 0'],
          ['points', 'INT NOT NULL DEFAULT 0'],
          ['ad_unit', "VARCHAR(80) NOT NULL DEFAULT ''"],
        ]) {
          const [cols] = await db.query('SHOW COLUMNS FROM app_ad_tickets LIKE ?', [name]);
          if (!cols.length) await ctx.execSql(`ALTER TABLE app_ad_tickets ADD COLUMN ${name} ${ddl}`);
        }
        const [configuredPoints] = await db.query("SELECT setting_value FROM site_setting WHERE setting_key = 'APP_AD_POINTS'");
        const oldPoints = Math.max(1, Math.min(500, parseInt(configuredPoints[0] && configuredPoints[0].setting_value, 10) || 50));
        await db.execute('UPDATE app_ad_tickets SET points = ? WHERE points = 0', [oldPoints]);
        await ensureTicketPrimaryKey(db, {allowRebuild: require('../core/config').APP_ALLOW_TICKET_TABLE_REBUILD === true});
        await ctx.execSql("INSERT IGNORE INTO schema_migrations (version) VALUES (24)");
      }

      if (applied < 25) {
        // Additive operational data only: existing balances/settings/tickets survive.
        for (const [name, ddl] of [
          ['created_at_ms', 'BIGINT NOT NULL DEFAULT 0'],
          ['credited_at_ms', 'BIGINT NOT NULL DEFAULT 0'],
          ['status', "VARCHAR(20) NOT NULL DEFAULT 'pending'"],
          ['reason', "VARCHAR(64) NOT NULL DEFAULT ''"],
        ]) {
          const [cols] = await db.query('SHOW COLUMNS FROM app_ad_tickets LIKE ?', [name]);
          if (!cols.length) await ctx.execSql(`ALTER TABLE app_ad_tickets ADD COLUMN ${name} ${ddl}`);
        }
        await ctx.execSql(`CREATE TABLE IF NOT EXISTS app_reward_usage (
          user_id INT PRIMARY KEY, day_key CHAR(10) NOT NULL,
          points_earned INT NOT NULL DEFAULT 0, last_issued_at BIGINT NOT NULL DEFAULT 0,
          last_credited_at BIGINT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        await ctx.execSql(`CREATE TABLE IF NOT EXISTS app_ads_callback_health (
          id TINYINT PRIMARY KEY, verified_at BIGINT NOT NULL DEFAULT 0,
          outcome VARCHAR(32) NOT NULL DEFAULT ''
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        await ctx.execSql(`CREATE TABLE IF NOT EXISTS app_ads_settings_history (
          id BIGINT AUTO_INCREMENT PRIMARY KEY, actor_id INT NOT NULL,
          actor_name VARCHAR(100) NOT NULL, action VARCHAR(20) NOT NULL,
          changes_json MEDIUMTEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        await ctx.execSql(`CREATE TABLE IF NOT EXISTS app_ad_diagnostics (
          id CHAR(32) PRIMARY KEY, user_id INT NOT NULL, format VARCHAR(20) NOT NULL,
          stage VARCHAR(20) NOT NULL, outcome VARCHAR(20) NOT NULL, code VARCHAR(64) NOT NULL,
          app_version VARCHAR(32) NOT NULL, app_code INT NOT NULL,
          sdk_version VARCHAR(32) NOT NULL, config_fingerprint VARCHAR(12) NOT NULL,
          test_mode TINYINT(1) NOT NULL, unit VARCHAR(60) NOT NULL,
          received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_ad_diag_time (received_at), KEY idx_ad_diag_user (user_id, received_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        const [indexes] = await db.query("SHOW INDEX FROM app_ad_tickets WHERE Key_name = 'idx_aat_created'");
        if (!indexes.length) await ctx.execSql('ALTER TABLE app_ad_tickets ADD INDEX idx_aat_created (created_at_ms, user_id)');
        await ctx.execSql('INSERT IGNORE INTO schema_migrations (version) VALUES (25)');
      }
};
