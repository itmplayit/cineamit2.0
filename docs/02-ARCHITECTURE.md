# Architecture — CineAmit 2.0

## 1. High-level diagram

```
                          ┌─────────────────────────────┐
   Browser (website) ───▶ │  cineamit-node (Express)    │ ──▶ MySQL / MariaDB / TiDB
   Android app (JSON) ──▶ │  0.0.0.0:3000 (default)     │ ──▶ TMDB API (metadata)
                          │                             │ ──▶ Brevo / Resend / SMTP (OTP mails)
   Reverse proxy (nginx)  │  server.js → router.js →    │ ──▶ Google/GitHub OAuth
     TLS termination ───▶ │  routes/* + web-json.js     │ ──▶ Xtream / Stalker / M3U (Live TV)
                          └─────────────────────────────┘ ──▶ Unity S2S (reward verification)
```

Do clients, ek backend:
- **Website** — Twig templates (Twing 7 render) + Tailwind CSS + DPlayer/hls.js/dash.js
- **Android app** — same routes with `Accept: application/json`; `web-json.js` har HTML route ko JSON me wrap karta hai, plus native `/api/app/*` aliases

## 2. Request lifecycle (server.js)

```
1. env-loader.loadSettings()     → .env (native parseEnv) + host env overrides
2. Config.load()                 → fail-fast validation (required keys, origins, ports)
3. Route registration            → routes/auth|player|party|main + web-json.attach()
4. Express middleware chain:
   a. security headers (CSP, HSTS-on-secure, X-Frame-Options...)
   b. bad-bot block (BLOCK_BAD_BOTS)
   c. cookie-parser, urlencoded(2mb), json(1mb)
   d. session middleware — SKIPPED for stateless public paths (sitemaps, /api/search…)
      and guest-page-cacheable GETs (lazy session)
   e. CSRF token ensure (12h rotation)
   f. main dispatcher:
      - sameOriginOk() for POST   → 403 cross-origin
      - csrfOk() for POST (exempt: /api/party/, /api/app/, /setup)
      - maintenance gate (fail-closed 503)
      - guest page cache (file-based, host+blacklist-revision keyed, TTL ≤ 3600s)
      - router.match() → handler(app, args) inside TMDB request-context
      - error → error_log table + 500 page
5. Startup: ensureSchema() (migrations to v25) → session-store ready → listen
```

## 3. Core modules map (`src/`)

| Group | Modules | Role |
|---|---|---|
| **Bootstrap** | `env-loader.js`, `config.js`, `db-options.js`, `database.js`, `ticket-schema.js` | Config + DB pool + schema v25 + guarded TiDB ticket-PK migration |
| **Security** | `security.js`, `account-security.js`, `session-store.js`, `ssrf.js` | Passwords, AES-GCM tokens, TOTP, SSRF-safe fetch, resilient session store |
| **Web framework** | `app.js`, `router.js`, `twig-env.js`, `seo.js`, `seo-routes.js` | App class (session/flash/url_for/roles), named routes, Twing env, SEO/canonical |
| **Content** | `tmdb.js`, `studios.js`, `media-library.js`, `kids.js`, `profiles.js`, `playlists.js` | TMDB client + shard cache, studios catalog, library scoping, kids filter |
| **Playback** | `live.js`, `player-access.js`, `watch-limit.js`, `vast.js` | Live relay + HLS rewrite, watch/download tokens, daily watch quota, VAST proxy |
| **Accounts** | `routes/auth.js`, `password-reset.js`, `mailer.js`, `oauth.js`, `site-status.js` | Register/login/2FA/reset/OAuth, mail delivery, maintenance/registration switches |
| **App API** | `web-json.js`, `android-app.js`, `unity-s2s.js`, `economy.js`, `ads-ops.js` | JSON wrapper + app routes, APK update metadata, Unity S2S verify, wallet/points |
| **Routes** | `routes/main.js`, `routes/player.js`, `routes/party.js` | Pages + admin panel, watch player, party watch |
| **Tools** | `tools/migrate-env.js`, `tools/indexnow.js` | env.js→.env lossless converter, manual IndexNow submitter |

## 4. App class (src/app.js) — key responsibilities

- `loginUser()` / `logoutUser()` — session regenerate, CSRF rotate, `active_sessions` registry
- `currentUser()` — kill-switches: 30-day absolute expiry, password-change invalidation, admin kill, suspension (id=1 exempt)
- `throttle(key,max,window)` — DB-backed `rate_limits` counter, **fail-closed** on DB error
- `accountLoginFailed/Locked` — per-account lockout (5 fails / 15 min)
- `render(template, context)` — Twig render with globals (user, ads config, SEO, flashes, blacklist filtering)
- `urlFor(endpoint, params)` — named-endpoint URL builder with slug support (`title-tmdbid`)

## 5. Database access patterns

```
Database.transaction(fn, {readCommitted})   — wallet/watch-quota aggregates (TiDB snapshot caveat)
Database.withLocks(keys, fn)                — sorted GET_LOCK (deadlock-safe)
Database.consumeRate(key, max, seconds)     — INSERT ... FOR UPDATE counter (atomic)
Database.opportunisticGc()                  — retention deletes w/ tmpfile lease + checkpoint
Database.fetchOne/All/execute               — auto-createAll() on missing-table errors
```

## 6. Live TV pipeline (`src/live.js`)

```
Admin configures Xtream/M3U/Stalker sources
        │
collectRawChannels() ──▶ channel list (cached, deduped)
        │
Browser gets ONLY /api/live_stream/{opaque-token} (AES-GCM token: url + uid + session-binding + 4h exp)
        │
resolve(token) → SSRF check → fetch upstream → HLS manifest rewrite (URIs → relay tokens)
        │
.mpd (DASH) rejected · Xtream credentials AES-GCM at rest · HTTPS-only
```

## 7. Reward economy (`src/economy.js` + `unity-s2s.js`)

```
Unity SDK completes ad (client) ──X── never trusted
Unity server → GET /api/rewards/unity?sid=uid.ticket&oid=...&hmac=...&game_id=...&placement_id=...
   → HMAC-MD5(secret) verify (canonical sorted fields, timing-safe)
   → atomic ticket insert (idempotent event ID) → wallet credit (cap 1000 pts/account/day, 60s cooldown)
```

## 8. Caching layers

| Layer | Where | Keying | TTL |
|---|---|---|---|
| TMDB shard cache | tmpdir (0700) `shard_v4_*.json` | request hash | 6h |
| Guest page cache | `cache/page/` files | version+host+path+blacklist-revision | 0–3600s (default 300) |
| Logo cache | in-memory (400 entries) | `type:id` | process-lifetime |
| Xtream channel cache | in-memory + code cache | server id | manual clear |
| Session store | `express_sessions` table | cookie | 30 days |

## 9. Android ↔ Server contract

- **Bootstrap:** `GET /` → JSON when `Accept: application/json` / `X-Cine-Client: app`
- **Auth:** `POST /login` (session cookie via `JavaNetCookieJar`), TOTP step-up with `totp_cred` signed token
- **Content:** `/home`, `/details/{type}/{id}`, `/watch/{type}/{id}`, `/api/episodes/...`, `/livetv`
- **Playback:** `/api/secure_play?token=` (session-bag tokens), `/api/live_stream/{token}` (opaque AES-GCM)
- **Wallet:** `/api/app/wallet/*` (sync/ticket/earn/redeem/trial/cancel)
- **Update:** `/api/app/update` → signed-metadata + same-origin APK + SHA-256 preflight

## 10. Deployment topology notes

- Node listens `0.0.0.0:PORT`; nginx/apache reverse-proxy kare, PHP `index.php` hata dein
- `trust proxy` off by default — `TRUST_PROXY_REAL_IP=true` + `TRUSTED_PROXIES` CIDRs set karein jab proxy ke peeche ho
- Sessions DB me hain → multi-instance safe; page cache local hai → per-instance
- `SECRET_KEY` rotate kabhi na kare (TOTP/Xtream/live tokens HKDF-sealed hain)
