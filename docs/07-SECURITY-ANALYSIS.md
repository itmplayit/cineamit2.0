# Security Analysis — CineAmit 2.0

> Review date: 23 October 2026. Ye audit code reading + live probes par based hai. Koi third-party pentest nahi hai.

## 1. Threat model summary

| Asset | Protection |
|---|---|
| User passwords | PBKDF2-SHA256, 600,000 iterations, 16-byte hex salt, 32-byte key; legacy bcrypt (`$2y$`→`$2a$`) verify |
| TOTP secrets | AES-256-GCM (HKDF `CineAmit/TOTP-GCM-v1`), AAD `cineamit-totp-v1`, lazy re-encryption of legacy plaintext |
| Xtream provider creds | AES-256-GCM (`CineAmit/Xtream-{kind}-GCM-v1`), per-kind keys |
| Watch/download/live tokens | AES-256-GCM opaque tokens (`g1_` prefix) with purpose binding |
| Session tokens | express-session signed cookie + DB store; regenerate on login/logout |
| OAuth | state param + session binding; HTTPS redirect URIs |
| Reward integrity | Unity S2S HMAC-MD5 (server-only secret ≥32 chars), timing-safe, idempotent events |

## 2. Authentication & account security

| Control | Implementation | Verified |
|---|---|---|
| Password policy | ≥8 chars, letter + digit; max 1024 bytes | ✅ code |
| Login throttling | 10/15min identity + 60/15min IP + 120/15min fail-IP | ✅ live: 10→429 |
| Account lockout | 5 fails / 15 min per account | ✅ code |
| Timing pad (enumeration) | Dummy bcrypt hash compared on unknown user / locked account | ✅ code |
| Session fixation | `session.regenerate()` on login/logout | ✅ code |
| Session kill switches | 30-day absolute, password-change invalidation, admin kill registry, suspension | ✅ code |
| TOTP | 6-digit SHA1/30s ±1 window; 5 attempts then lock; per-account rate table | ✅ code |
| 2FA binding | Password re-entry required to enable/disable (AccountSecurity.authorize) | ✅ code |
| Password reset | HMAC OTP, 10-min TTL, 5 attempts, 60s resend cooldown, identical response for unknown emails (anti-enumeration), fake timing | ✅ code |
| Owner bootstrap | 32+ char `OWNER_BOOTSTRAP_KEY`, `GET_LOCK` race-guard, timing-safe compare | ✅ live |
| OAuth account linking | By verified email + `INSERT IGNORE`; registration-closed respected | ✅ code |

**Residual:** Login "locked" message is an account-existence oracle (bugs L3). User id=1 suspension-immune (design; ops note I3).

## 3. Session & CSRF

| Control | Detail | Verified |
|---|---|---|
| Cookie | `cineamit_session`, httpOnly, sameSite=lax, secure=auto, 30d rolling | ✅ |
| CSRF token | 32-byte hex, 12h rotation, timing-safe compare, body or `X-Csrf-Token` | ✅ live reject |
| Origin check | `sec-fetch-site: cross-site` reject + Origin/host match vs `APP_PUBLIC_ORIGIN` | ✅ live: 403 |
| Exempt paths | `/api/party/*`, `/api/app/*`, `/setup`, `/api/ga_blocked` (auth + origin still enforced) | design note I2 |
| Statefulless skip | Sitemaps/`/api/search` etc. skip session middleware (perf) | ✅ |

## 4. Injection & XSS

| Vector | Protection | Verified |
|---|---|---|
| SQL injection | 100% parameterized (`execute`/`query` with `?`); dynamic SQL only whitelisted table/index names (sanitized `[A-Za-z0-9_]`) | ✅ grep: 0 concat-params |
| XSS (templates) | Twing autoescape `html` + explicit escaping re-applied to **blocks & macros** (node visitor); `json_str`/`html_json` escape `<>&` + U+2028/9 | ✅ |
| `|raw` usage | Only 5 spots: JSON-LD graph (`json_encode`), ad social-bar code (admin-configured) | ✅ audit |
| Reflected input | Search query escaped in HTML (live probe `<script>` → no reflection) | ✅ live |
| Rich text (blog/help) | `sanitize-html` allowlist + `rel=noopener noreferrer`; markdown-lite converter escapes URLs | ✅ |
| Header injection | Mailer/error strings strip `[\r\n\0]`; token URLs reject CRLF | ✅ |
| JSON responses | Express `res.json` (proper encoding); API messages static strings | ✅ |
| Command injection | No `child_process`/`eval`/`Function` in runtime code | ✅ grep |

**Residual:** CSP `script-src 'self' https: 'unsafe-inline'` (bugs M2) — XSS defense rests on escaping, CSP is not a backstop on ad pages.

## 5. SSRF & outbound requests (`src/ssrf.js`)

| Control | Detail |
|---|---|
| Private IP block | 0/10/127/169.254/172.16-31/192.168/≥224 + IPv6 ULA/link-local/loopback/multicast |
| DNS pinning | Resolve → filter → connect to pinned IP (Host/SNI preserved) |
| Host blocklist | localhost, metadata.google.internal, *.local/.internal/.lan, nip.io-style |
| Redirect handling | Re-validated each hop (≤3), CRLF reject, credential-bearing HTTP blocked |
| Size/timeout limits | 10 MB default, 20s timeout |
| Live relay | HTTPS-only option, session-bound tokens, `.mpd` reject, own-host skip |
| TMDB fetch | `rejectUnauthorized: true`; insecure retry **opt-in** (`TMDB_INSECURE_TLS_RETRY`) |

## 6. Authorization

| Surface | Control | Verified |
|---|---|---|
| Admin panel | `requireStaff` (owner/super_admin/editor); source management owner/super_admin | ✅ live guest→login |
| CSV exports | Role-checked (per export endpoint) | ✅ code |
| API user data | `needAppUser`/`requireLogin` on watchlist/history/wallet/etc. | ✅ live 401 |
| Profile scoping | `profile_id` filters in library queries (owner-scoped playlists) | ✅ code |
| Download tokens | Session-owner compare (timing-safe) + pattern-hash invalidation | ✅ code |
| Play tokens | Profile-bound session bag, TTL 6h, max 80/100 entries | ✅ code |
| Live tokens | uid + session-binding HMAC + expiry in encrypted payload | ✅ code |

## 7. Rate limiting & abuse

- All throttles DB-backed and **fail-closed** (deny on DB error) — verified design
- Login, register, OTP, setup, OAuth, dlpin, CSRF-log, rewards all throttled
- Bad-bot blocklist (Ahrefs/Semrush/GPTBot/CCBot/...) — `BLOCK_BAD_BOTS`
- Unity reward: server daily cap + cooldown + atomic counters

## 8. Transport & headers

| Header | Value | Note |
|---|---|---|
| HSTS | `max-age=31536000; includeSubDomains` | on `req.secure` only |
| X-Frame-Options | `SAMEORIGIN` (e2b preview exempt) | clickjacking |
| CSP | see M2 | ad-driven |
| X-Content-Type-Options | `nosniff` | |
| Referrer-Policy | `strict-origin-when-cross-origin` | |
| Permissions-Policy | geolocation/mic/camera/payment disabled | |

DB TLS: `rejectUnauthorized + verifyIdentity + TLSv1.2 min`; SSL-on-IP-host rejected (SNI correctness).

## 9. Secrets handling

- `.env` dotenv-only (no JS execution — `env.js` explicitly refused); NUL-byte reject; lossless converter for legacy
- Mail errors redact API keys/passwords/emails (`safeError`)
- Setup page: CSP `default-src 'none'`, no ads/analytics; `SECRET_KEY` compare timing-safe
- Debug output gated by `APP_DEBUG` (default false); production errors generic
- Android: no secrets in APK (Unity public IDs only); S2S secret server-side

## 10. Android app security

| Control | Class |
|---|---|
| HTTPS-only, cleartext disabled, cert-validation never bypassed | `WebSecurity.requireHttps` |
| Cross-origin API block (app client header) | `WebSecurity.requireAppRequest` |
| WebView hardened (file access off, JS bridges limited, safe browsing) | `WebSecurity.harden` |
| Update: same-origin HTTPS + SHA-256 + package/version/signature match | `UpdateVerifier`, `AppUpdate` |
| AdBlock cosmetic filter + AccessGate VPN/DNS screen | `AdBlock`, `AccessGate` |
| `allowBackup=false`, no exported activities except launcher | `AndroidManifest.xml` |

## 11. Findings & recommendations (recap)

| ID | Severity | Summary |
|---|---|---|
| M2 | MEDIUM | CSP `unsafe-inline` + any-https scripts (ad-driven) → nonce CSP for ads-off |
| L3 | LOW | Login locked-state oracle → uniform error |
| L2 | LOW | Register race → generic DB error message |
| I2 | INFO | CSRF-exempt JSON APIs — OK given origin+cookie mitigations; keep `sameSite` strict if possible |
| I3 | INFO | Owner id=1 un-suspendable — protect that account with TOTP |

**Overall:** strong, layered, fail-closed security posture — typical PHP-movie-site codebase se kahin better. Critical exploitable issues **nahi mile**.
