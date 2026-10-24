# API Reference — CineAmit 2.0

Do tarah ke clients:
1. **Website (HTML)** — Twig-rendered pages; POST forms me `csrf_token` chahiye
2. **App/JSON** — `Accept: application/json` ya `X-Cine-Client: app` header; same routes JSON me; CSRF token exempt (lekin session cookie + origin check required)

Auth: session cookie `cineamit_session` (PHP-compatible). JSON error shape: `{"ok":false,"error":"code"}`.

---

## 1. Public pages (GET)

| Route | Page |
|---|---|
| `/` · `/home` | Homepage (hero + rails) |
| `/movies` · `/series` · `/anime` · `/tv` | Catalog (+ `/movies/bollywood|hollywood|south|popular|indian|top-10-india`, `/shows/netflix|prime|apple|top|anime|korean`) |
| `/category/{slug}` · `/view_all` · `/filter` | Category / listing / filters |
| `/details/{movie\|tv}/{slug}` | Title details (slug = `title-tmdbid`) |
| `/actor/{slug}` · `/actors` | Person pages |
| `/studios` · `/studio/{id}` · `/providers` · `/provider/{id}/all` | Studios & OTT providers |
| `/collection/{id}` · `/album/{id}` · `/albums` | Collections & albums |
| `/search?q=` | Search |
| `/blog` · `/blog/{slug}` · `/help` · `/help/article/{slug}` · `/faq` | Content |
| `/about` · `/contact` · `/privacy` · `/terms` · `/legal` · `/dmca` | Static/legal |
| `/premium` | Plans |
| `/reels` | Reels |
| `/app` · `/app/cineamit.apk` | App landing / APK download |

## 2. Auth routes

| Method | Route | Notes |
|---|---|---|
| GET/POST | `/register` | `owner_bootstrap_key` (first owner), throttle 5/hour |
| GET/POST | `/login` | `login_id` + `password` (+`remember`); TOTP step-up with `totp_cred` |
| POST | `/logout` | CSRF required |
| GET/POST | `/forgot_password` → `/verify_otp` → `/reset_password` | OTP flow (session-scoped) |
| GET | `/auth/google` · `/auth/github` (+`/callback`) | OAuth |
| POST | `/profile/totp_setup` · `/profile/totp_verify` · `/profile/totp_disable` | 2FA |

Login failure limits: 10/15min per identity, 60/15min per IP, account lock 5 fails/15min.

## 3. Logged-in pages

| Route | Notes |
|---|---|
| `/profiles` · `/profile` | Profile select / account settings |
| `/watchlist` · `/history` · `/notifications` | Personal lists |
| `/playlists` · `/view_playlist/{share_code}` | Playlists |
| `/livetv` (auth) · `/livetv?kind=movie\|series\|anime` · `/livetv?series=` | Live + VOD |
| `/cine-match` · `/cine-match/compare` · `/cine-wrapped` | Social |
| `/watch/{movie\|tv}/{slug}?s=&e=` | Player page |

## 4. Playback APIs

| Method | Route | Notes |
|---|---|---|
| GET | `/api/secure_play?token=` | Session-bag token (6h, profile-bound) → provider page |
| GET | `/api/live_stream/{token}` | Opaque AES-GCM token (uid+session-bound, 4h) → HLS relay (manifest rewrite) |
| GET | `/api/episodes/{tmdb_id}/{season_number}` | Episodes JSON |
| GET | `/api/trailer/{type}/{id}` · `/api/video_preview/{type}/{id}` | Trailer/preview |
| GET | `/api/stalker_play` · `/api/stream_proxy` | Stalker / stream proxy |
| GET | `/api/vast_proxy` | VAST (host allowlist) |
| GET | `/download/{token}` · `/download-frame/{token}` | Download links (session-owned) |
| GET | `/api/watch/quota` | Watch-limit status |

Watch quota: daily-unlock model (default 10/day, IST midnight reset); same-day replay free; guests signed-cookie soft quota.

## 5. Site APIs

| Method | Route | Notes |
|---|---|---|
| GET | `/api/search` | Stateless search |
| GET | `/api/warm` | Cache warm (`WARM_KEY`) |
| GET | `/api/ga_blocked` | GA beacon (CSRF-exempt) |
| GET/POST | `/api/party/messages` | Watch-party chat (CSRF-exempt) |
| GET | `/api/rewards/unity` | Unity S2S callback (HMAC verified) |
| GET | `/sitemap.xml` · `/sitemap-*.xml` · `/robots.txt` · `/ads.txt` · `/indexnow-key.txt` · `/sw.php` · `/manifest.php` | SEO/PWA |

## 6. Admin (staff: owner/super_admin/editor — `/cineamit-admin` dashboard)

| Method | Route | Notes |
|---|---|---|
| GET | `/cineamit-admin` | Dashboard |
| POST | `/admin/*` (toggle_suspend, kill_sessions, settings, broadcasts, clear_security_log, watch-limit save/reset...) | CSRF + role required |
| GET | `/admin/export_users_csv` · `/admin/export_requests_csv` · `/admin/export_security_csv` | Permission-checked CSV |
| GET | `/admin/app_ads/export/{kind}` | App-ads CSV |
| GET | `/api/admin/pulse` | Ops pulse |

Roles: `owner`, `super_admin`, `editor`, `user`. Sensitive source management owner/super_admin only. **User id=1 ko suspend nahi kiya ja sakta** (primary-owner protection).

## 7. Android JSON API (`/api/app/*`)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/app/bootstrap` | — | App bootstrap/config |
| GET | `/api/app/home` | opt | Home rails |
| GET | `/api/app/search?q=` | opt | Search |
| GET | `/api/app/details/{type}/{id}` | opt | Details |
| GET | `/api/app/watch/{type}/{id}?s=&e=` | opt | Watch bundle (guest OK for TMDB titles) |
| GET | `/api/app/episodes/{id}/{season}` | opt | Episodes |
| GET | `/api/app/catalog/{kind}` · `/api/app/filter` · `/api/app/page/{kind}[/{id}]` | opt | Browsing |
| GET | `/api/app/studios` · `/api/app/studio/{id}` · `/api/app/providers` · `/api/app/provider/{id}` | opt | Catalogs |
| GET | `/api/app/person/{id}/credits` · `/api/app/trailer/{type}/{id}` · `/api/app/title_logo/{type}/{id}` | opt | Media helpers |
| GET | `/api/app/iptv` · `/api/app/iptv/series` · `/api/app/livetv` | **required** | Live TV (login mandatory) |
| POST | `/api/app/login` (`username`/`login_id`, `password`, `totp_cred`, `totp_code`) | — | Login + TOTP step |
| POST | `/api/app/logout` | opt | Logout |
| GET | `/api/app/profiles` | required | Profiles |
| GET/POST | `/api/app/watchlist` · `.../add/{type}/{id}` | required | Watchlist |
| GET | `/api/app/downloads/{type}/{id}` | required | Download options |
| GET | `/api/app/info` | — | App info |
| GET | `/api/app/update` | — | Update metadata (verified artifacts only) |
| GET/POST | `/api/app/wallet/sync\|ticket\|earn\|redeem\|trial\|cancel` | required | Rewards/subscription |
| POST | `/api/app/dlpin/otp` · `/api/app/dlpin/verify` | required | Downloads PIN via OTP email |

JSON `Accept` wrapper — **koi bhi website route** JSON me bhi aata hai:
```bash
curl -H 'Accept: application/json' https://host/home
# {"ok":true,"image_base":"...","hero":[...],"rows":[...],...}
```

### TOTP step-up (JSON)
```json
POST /api/app/login  {"username":"u","password":"p"}
→ 200 {"ok":false,"error":"totp_required","totp_cred":"<signed-token>"}
POST /api/app/login  {"totp_cred":"<token>","totp_code":"123456"}
→ 200 {"ok":true,"user":{...}}   |  401 {"error":"totp_invalid","left":N}  |  423 {"error":"locked"}
```

## 8. Common error codes

| Code | HTTP | Meaning |
|---|---|---|
| `login_required` | 401 | Session nahi hai |
| `invalid_credentials` | 401 | Galat username/password |
| `totp_required` / `totp_invalid` / `totp_expired` / `locked` | 200/401/423 | 2FA flow states |
| `suspended` | 403 | Account inactive |
| `forbidden` | 403 | Role insufficient |
| `not_found` | 404 | Missing route/resource |
| `maintenance` / `maintenance_unavailable` | 503 | Maintenance mode / status read fail (fail-closed) |
| `throttled` / `locked` | 429 | Rate limits |
| CSRF fail | 403 | `Invalid or missing CSRF token` (web POST) / cross-origin reject |

## 9. Rate limits (defaults)

| Action | Limit |
|---|---|
| Login attempts (per identity) | 10 / 15 min |
| Login attempts (per IP) | 60 / 15 min |
| Failed logins (per IP) | 120 / 15 min |
| Account lockout | 5 fails / 15 min |
| TOTP attempts | 5 then account 2FA lock |
| Register | 5 / hour |
| Password reset OTP | 5 / hour per email + 60s cooldown + 10/hour per IP |
| Setup POST | 5 / 10 min |
| OAuth login | 10 / 15 min |
| Unity reward | 1000 pts/account/day + 60s cooldown |

## 10. Webhooks / external callbacks

| Endpoint | Caller | Verification |
|---|---|---|
| `/api/rewards/unity` | Unity Ads S2S | HMAC-MD5 over sorted `sid,oid,game_id,placement_id` + server secret; idempotent event IDs |
| OAuth callbacks | Google/GitHub | `state` param + session provider match |
