# Deep Analysis Report — CineAmit 2.0

> **Date:** 23 October 2026 · **Repo:** `itmplayit/cineamit2.0` (single commit `77fac9f Initial commit`, branch `main`)
> **Scope:** `cineamit-node` v16.0.16 (schema 25) + `cineamit-android` v1.0.75 (code 75) · 587 files · ~13,000 lines backend JS + ~11,000 lines Java

---

## 1. Methodology

### Phase A — Static analysis
- Saare 70 JS source files (`server.js`, `src/*.js`, `src/routes/*.js`, `tools/*.js`) full read/review
- Template escaping audit (53 Twig templates — `|raw`, autoescape, `json_str` usage)
- Android: `AndroidManifest.xml`, `build.gradle.kts` (Unity-only ad resolver), security classes (`WebSecurity`, `UpdateVerifier`, `AdBlock`, `AccessGate`, `Io`)
- Greps: SQL string-concatenation, `eval`/`child_process`, hardcoded secrets, `Math.random` in security paths, TODO/FIXME, empty catches

### Phase B — Automated checks
| Check | Result |
|---|---|
| `node --check` on every JS file | ✅ 0 syntax errors |
| `npm ci` (lockfile install) | ✅ clean |
| `npm audit` | ✅ **0 vulnerabilities** |
| Module load + route registration | ✅ all modules load; **115 GET + 120 POST** routes registered |

### Phase C — Live smoke test (MariaDB 11 ke saath boot)
Ek test `.env` banaya (dummy TMDB key), MariaDB me `cineamit` DB/user create kiya, aur poora startup + HTTP test suite chalaya. Detailed results §3 me hain.

---

## 2. Architecture findings (summary)

### Backend (`cineamit-node/`)
- **Framework:** Express 4 + custom micro-router (`src/router.js`) with named endpoints (PHP-style `url_for`) + **Twing 7** Twig engine (original PHP templates unchanged)
- **DB layer:** mysql2 pool + transactions (`READ COMMITTED` opt-in for wallet/watch-quota), `GET_LOCK` advisory locks, transactional rate-limiter (`rate_limits` table), opportunistic retention GC with lease + checkpoint
- **Schema:** v25, auto-migration at boot (`createAll()` + numbered migrations 1..25); guarded TiDB ticket-PK rebuild (`ticket-schema.js`)
- **Sessions:** `express-session` + `express-mysql-session` (custom resilient subclass — cleanup promise-rejections ko contain karta hai), cookie `cineamit_session` (PHP-compatible name), 30-day absolute expiry
- **Security:** PBKDF2-SHA256 (600k) passwords, AES-256-GCM (HKDF purpose-separated keys) for TOTP/Xtream/opaque tokens, HMAC-signed reset tokens, TOTP (SHA1/6/30, ±1 window), CSRF (double-check: origin + token), SSRF-safe fetch with DNS pinning
- **Live TV relay:** session+uid-bound opaque tokens (4h TTL), HLS manifest rewrite, `.mpd` (DASH) reject, Xtream credentials AES-GCM at rest, HTTPS-only Xtream
- **Ads:** Adsterra/HilltopAds/AdSense (site) + Unity-only (app) + VAST proxy with host allowlist
- **Rewards economy:** Unity S2S HMAC-verified (server-only secret), atomic idempotent credits, daily cap (1000 pts) + 60s cooldown, wallet ceiling 10M, revision-checked admin settings
- **SEO:** canonical pagination, sitemaps, IndexNow (manual/dry-run tool), robots/bad-bot blocklist

### Android (`cineamit-android/`)
- Native Java + XML Views, minSdk 24 / target 36, AGP 8.10.1, Java 17, Media3 ExoPlayer + libVLC 3.7.7
- Same website routes with `Accept: application/json` (server `web-json.js` wraps Twig routes) + `/api/app/*` aliases
- Security: HTTPS-only (`usesCleartextTraffic=false`), cert pinning reject-invalid, WebView hardened, APK update with SHA-256 + same-origin + package/signature match preflight
- Ads: **Unity-only** 4.21.0 (Game ID 800377017), no AdMob/mediation; rewarded points server-verified
- Access guard: VPN/Private-DNS detection → blocking screen (best-effort client-side)

---

## 3. Live test evidence

Environment: Node.js v20.20.2 (project recommends 22.12+), MariaDB, `CINE_CONFIG_FILE=.env.test`, port 3123.

### 3.1 Startup & schema
```
[migration14] watchlist unique key: Duplicate key name 'uniq_wl_user_profile_tmdb'   ← cosmetic (see bugs L1)
CineAmit Node.js listening on http://0.0.0.0:3123 (schema v25)
```
✅ Schema v25 created/applied on empty DB.

### 3.2 Public pages
| Request | Result |
|---|---|
| `GET /` | 200 — 124,779 bytes homepage |
| `GET /login` | 200 |
| `GET /robots.txt`, `/sitemap.xml` | 200 |
| `GET /setup` (SETUP_ENABLED=false) | 404 ✅ (route not mounted) |
| `GET /movies` (invalid TMDB key) | **503 + Retry-After: 60** ✅ fail-closed, empty page not cached |
| `GET /livetv` (guest) | 302 → `/login?next=/livetv` ✅ auth required |

### 3.3 Security headers (sample `/login`)
```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
X-Frame-Options: SAMEORIGIN
Content-Security-Policy: default-src 'self' https: data: blob:; script-src 'self' https: 'unsafe-inline'; ... frame-ancestors 'self'
```

### 3.4 Owner bootstrap + auth flow
1. `GET /register` → 200 (CSRF token in form)
2. `POST /register` with `owner_bootstrap_key` → 302; DB row: `id=1, username=testowner, role=owner, is_active=1` ✅
3. `POST /login` → 302 → `/profiles` ✅ session cookie issued, `active_sessions` row written
4. `GET /cineamit-admin` (owner) → 200 admin dashboard ✅
5. `GET /cineamit-admin` (guest) → 302 → `/login?next=/cineamit-admin` ✅

### 3.5 Attack-surface probes
| Probe | Result |
|---|---|
| POST without CSRF token | 302 redirect + `csrf_failed` in `security_log` ✅ rejected |
| POST with `Origin: https://evil.example.com` | **403** `{"error":true,"message":"Cross-origin request rejected."}` ✅ |
| `/search?q=<script>alert(1)</script>` | 0 unescaped reflections ✅ |
| 12 rapid bad logins (JSON API) | 10× `401` then `429` ✅ (identity limit 10/15min) |
| `GET /api/app/watchlist` (guest) | `401 {"ok":false,"error":"login_required"}` ✅ |
| `POST /api/app/login` (correct creds) | `{"ok":true,"user":{...}}` ✅ |
| `POST /api/app/login` (wrong creds) | `401 invalid_credentials` ✅ |

### 3.6 JSON wrapper (Android contract)
`GET /home` with `Accept: application/json` → `{"ok":true,"image_base":...,"hero":[],"rows":[...],"studios":[...]}` ✅ (empty hero because test TMDB key — shape correct)

---

## 4. Module-by-module verdict

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `config.js` | 279 | ✅ Strong | Fail-fast validation; HTTPS enforcement; per-key checks |
| `env-loader.js` | 59 | ✅ Strong | Native `parseEnv` (no JS eval); lossless legacy converter |
| `security.js` | 354 | ✅ Strong | HKDF-separated AES-GCM; PBKDF2 600k; TOTP; sanitize-html |
| `database.js` | 871 | ✅ Strong | Transactions, locks, retention GC w/ lease; migration14 noise (bug L1) |
| `app.js` | 771 | ✅ Strong | CSRF/session/role framework; fail-closed throttle; blacklist filter |
| `router.js` | 61 | ✅ Good | Named endpoints, request-context wrapping |
| `tmdb.js` | 561 | ✅ Strong | AsyncLocalStorage request state; shard cache; cert-fail closed |
| `live.js` | 1289 | ✅ Strong | Opaque session-bound tokens; HLS rewrite; SSRF-guarded relay |
| `web-json.js` | 2148 | ✅ Strong | Full Android JSON contract; TOTP flow parity with web |
| `economy.js` | 555 | ✅ Strong | Atomic tickets/credits; revision-checked settings |
| `unity-s2s.js` | 42 | ✅ Strong | Canonical HMAC verify; timing-safe; idempotent events |
| `ssrf.js` | 184 | ✅ Strong | DNS-pin + private-IP deny + redirect revalidation |
| `password-reset.js` | 198 | ✅ Strong | Anti-enumeration; DB-cooldown; HMAC OTP; schema preflight |
| `mailer.js` | 182 | ✅ Good | Brevo/Resend/SMTP; secret-redacting error sanitizer |
| `oauth.js` | 149 | ✅ Good | Google/GitHub; state param; fail-closed |
| `watch-limit.js` | 143 | ✅ Strong | Daily-unlock model; signed guest cookie; locked settings save |
| `player-access.js` | 176 | ✅ Strong | Session-bag tokens; public-URL check; pattern-hash invalidation |
| `site-status.js` | 61 | ✅ Strong | Explicit boolean parsing; fail-closed maintenance |
| `account-security.js` | 67 | ✅ Good | Password-bound 2FA enrollment/disable |
| `session-store.js` | 61 | ✅ Good | express-mysql-session crash-guard (documented upstream bug) |
| `kids.js` | 77 | ✅ Strong | Certification-strict (IN/US/GB allowlists); genre + memo filter |
| `routes/auth.js` | 533 | ✅ Strong | Owner bootstrap lock; timing-safe compares; enumeration notes (L3) |
| `routes/main.js` | 2504 | ✅ Good | Admin RBAC; CSV exports permission-checked; settings revisions |
| `routes/player.js`, `party.js` | 316 | ✅ Good | Watch quota integration; party chat scoped |
| `seo.js`/`tools/indexnow.js` | 260 | ✅ Strong | Canonical discipline; dry-run default |
| Android `WebSecurity`/`UpdateVerifier` | — | ✅ Strong | HTTPS-only, hardened WebView, APK checksum+signature preflight |

---

## 5. Notable strengths (kya inhoone bahut sahi kiya hai)

1. **Fail-closed everywhere:** throttle DB-down → deny; site-status read fail → 503; TMDB TLS error → no insecure fallback (opt-in only); OAuth unconfigured → disabled.
2. **Crypto hygiene:** purpose-separated HKDF keys (TOTP/Xtream/opaque/reset distinct), AES-GCM with AAD, timing-safe compares, HMAC-signed guest watch cookie.
3. **Anti-enumeration** on forgot-password (identical response + fake timing), dummy bcrypt hash pad on unknown-user login.
4. **Concurrency care:** `GET_LOCK` ordering (deadlock-free sorted keys), READ COMMITTED for wallet aggregates (TiDB snapshot caveat documented in-code), revision checks for admin settings (optimistic concurrency).
5. **Session crash-guard:** express-mysql-session ka known unhandled-rejection bug workaround (`session-store.js`) — production-grade awareness.
6. **Cleanup/GC engineering:** lease file + checkpoint + bounded exponential retries — multi-worker safe.
7. **PHP migration fidelity:** Twing named-args/Elvis support, `session.get()`, `json_str`, same cookie name — thoughtful port.

---

## 6. Residual risks (bugs doc ke alawa)

1. **Ad-script trust:** CSP `https:` allow-all means any compromised ad-network script = full XSS. Inherent to ad-monetized streaming sites; M2 mitigation possible.
2. **IPTV upstream trust:** Live relay SSRF-guarded hai, par provider content (HLS keys, manifests) upstream se aata hai — provider compromise = stream manipulation. Expected.
3. **Legal/content:** TMDB metadata + third-party stream sources — content licensing operator ki zimmedari hai (code me DMCA page maujood hai).
4. **No automated test suite in repo:** 13 Robolectric tests Android README me mention hain par files nahi hain; Node ke liye koi `test/` nahi. Regression safety manual testing par depend karti hai.
5. **Single-commit repo:** koi git history nahi — audit trail ke liye aage se meaningful commits rakhein.

---

## 7. Conclusion

CineAmit 2.0 ek **production-hardened, honestly-engineered** streaming platform hai — typical "movie site" codebase se kahin behtar. Security controls implement bhi hue hain aur **kaam bhi karte hain** (live verified). Mila hua ek bhi issue critical exploitable nahi hai; sabse bada practical gap **missing documentation files** (M1) hai. Recommended fix order [06-BUGS-AND-PROBLEMS.md](06-BUGS-AND-PROBLEMS.md) ke end me hai.
