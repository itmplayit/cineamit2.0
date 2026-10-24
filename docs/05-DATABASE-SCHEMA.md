# Database Schema — CineAmit 2.0 (schema v25)

Engine: InnoDB, charset `utf8mb4`. Versions tracked in `schema_migrations(version, applied_at)`; startup par `createAll()` + numbered migrations run hoti hain.

## 1. Core identity & security

| Table | Key columns | Notes |
|---|---|---|
| **users** | `id` PK AI, `username` UNIQUE, `email` UNIQUE, `password` (pbkdf2/bcrypt), `role` (owner/super_admin/editor/user), `match_code` UNIQUE, `totp_secret` (AES-GCM `gcm1:`), `totp_enabled`, `password_changed_at`, `is_active`, `last_login` | id=1 primary owner (suspend-exempt) |
| **oauth_accounts** | `user_id`, `provider`, `provider_user_id`, `email` | Google/GitHub links |
| **user_profiles** | `user_id`, `name`, `avatar_color/image`, `theme_color`, `pin`, `autoplay_next`, `default_server`, `is_kids`, `binge_streak` | Multi-profile per user |
| **security_log** | `event`, `user_id`, `ip`, `details`, `created_at` | 30-day retention; indexed (event, created_at) |
| **active_sessions** | `session_id` PK, `user_id`, `ip`, `created_at` | Session registry (admin kill) |
| **express_sessions** | `session_id` PK, `data`, `expires` | express-mysql-session (30-day expiry, 15-min cleanup) |
| **password_otp** | `email` (also `dlpin:{uid}` keys), `otp_hash` (HMAC), `expires_at`, `attempts` | Reset + download-PIN OTP; legacy `id` AUTO_INCREMENT repair manual |
| **rate_limits** | `rate_key` PK (md5/sha truncated), `cnt`, `window_start` | Throttles, account locks, watch-settings locks |

## 2. Content & library

| Table | Purpose |
|---|---|
| **watch_history** | `user_id, profile_id, tmdb_id, media_type` UNIQUE — watch tracking |
| **watchlist** | `user_id, profile_id, tmdb_id` UNIQUE (`uniq_wl_user_profile_tmdb`) |
| **playlist** / **playlist_movies** | Playlists + items; `share_code` UNIQUE; owner/profile-scoped |
| **notifications** / **announcements** / **announcement_reads** | Messaging |
| **user_requests** | Content requests |
| **reviews** | Title reviews |
| **cine_match_friends** | `user_id, friend_id` friend graph |
| **site_setting** | `setting_key`/`setting_value` KV — all admin switches (registration, maintenance, ads, watch-limit, revision counters) |

## 3. Live TV & playback

| Table | Purpose |
|---|---|
| **xtream_servers** | Xtream creds (`username`/`password` **AES-GCM encrypted at rest**), host, sort, active |
| **server_model** | Embed server patterns (movie/tv pattern URLs) |
| **download_setting** | Download provider patterns + media filter |
| **live_presence** | Live viewers (1-day retention) |

## 4. Rewards / app economy

| Table | Purpose |
|---|---|
| **user_wallet** | Points balance (ceiling 10,000,000) |
| **app_ad_tickets** | Ad tickets (idempotent event IDs, TTL 10 min, 7-day retention) |
| **app_ad_diagnostics** | Client diagnostics (7-day retention) |
| **app_ads_settings_history** | Settings audit (90-day retention) |
| **app_reward_usage** | Per-account daily caps (`day_key` UTC) |
| **reward_events** | Credit ledger |
| **app_reward_usage** + cooldown | 1000 pts/account/day default, 60s between attempts |

## 5. Ops

| Table | Purpose |
|---|---|
| **error_log** | Route errors (90-day retention) |
| **party_messages** | Watch-party chat (24h retention) |
| **web_watch_hits** | Watch-quota admissions (`viewer_key`, `title_key`, `day_key` — 40-day retention) |
| **schema_migrations** | Applied versions |

## 6. Key constraints & indices (selected)

```
users:        UNIQUE(username), UNIQUE(email), UNIQUE(match_code)
watch_history: UNIQUE(user_id, profile_id, tmdb_id, media_type)
watchlist:     UNIQUE(user_id, profile_id, tmdb_id)
playlist:      UNIQUE(share_code)
xtream_servers: KEY(is_active, sort_order)
security_log:  KEY(event, created_at), KEY(user_id)
rate_limits:   PRIMARY(rate_key)
```

## 7. Migration behavior

- `createAll()`: `CREATE TABLE IF NOT EXISTS` for all tables (final shape), then `applied < N` blocks for upgrades (ALTERs, data transforms — e.g. migration 15 encrypts legacy TOTP secrets)
- Missing-table errors in `fetchOne/fetchAll/execute` auto-trigger `createAll()` (self-heal)
- **Known noise:** fresh installs log `[migration14] watchlist unique key: Duplicate key name ...` (see bugs L1) — harmless
- TiDB ticket-PK rebuild: `ticket-schema.js` (`APP_ALLOW_TICKET_TABLE_REBUILD=true` + backup + writers stopped)

## 8. Retention / GC schedule (`opportunisticGc`)

| Table | Deletes where |
|---|---|
| app_ad_tickets | expired > 7 days |
| app_ad_diagnostics | > 7 days |
| app_ads_settings_history | > 90 days |
| app_reward_usage | day_key > 30 days |
| password_otp | expired > 1 day |
| rate_limits | window_start > 1 day |
| error_log | > 90 days |
| active_sessions | created > 30 days |
| live_presence | last_seen > 1 day |
| party_messages | > 24 hours |
| web_watch_hits | watched_at > 40 days |
| security_log | > 30 days (via securityLog GC guard) |

GC: tmpfile lease (`O_EXCL`) + checkpoint JSON + exponential bounded retries — multi-worker safe.

## 9. Connection settings (`db-options.js`)

- Pool: `connectionLimit 10`, `waitTimeout` 5s connect, `dateStrings: true`, utf8mb4
- SSL: `rejectUnauthorized: true`, `verifyIdentity: true`, `minVersion TLSv1.2` — **IP hosts rejected with SSL** (DNS hostname required for SNI)
- TiDB Cloud hosts (`*.tidbcloud.com`) force TLS in `auto` mode

## 10. Transactions & locking

| Use case | Pattern |
|---|---|
| Rate limit consume | `INSERT ... ON DUPLICATE` + `SELECT ... FOR UPDATE` + update |
| Watch-quota admission | Row lock (`rate_limits` lock row) + READ COMMITTED |
| Wallet credit | Transaction + READ COMMITTED (TiDB snapshot caveat) |
| Owner bootstrap | `GET_LOCK('cineamit_owner_bootstrap', 5)` + recheck |
| Multi-key ops | `withLocks` — sorted lock names (deadlock-safe) |
| Settings save | Revision check (`APP_ADS_CONFIG_REVISION`) — optimistic concurrency |
