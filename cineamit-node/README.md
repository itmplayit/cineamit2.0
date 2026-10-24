# CineAmit — Node.js backend

> **Docs note:** Historical release notes below reference private deep-dive documents that are not shipped in this repo (kept as bold text for context). The current analysis and restructure documentation lives in [`../docs/`](../docs/) (01-AS-IS through 13). Operational tools referenced below (e.g. `tools/migrate-env.js`) are present and runnable.

> **16.0.16 deep-analysis fixes:** TMDB certificate failures now fail closed unless insecure retry is explicitly enabled; homepage macros HTML-escape metadata; provider pages no longer substitute unrelated titles; application/OAuth origins are validated; legacy conversion rejects non-plain/inherited settings; IndexNow deduplicates normalized URLs and accepts pagination only on genuinely paginated public routes. Schema and Android are unchanged.

> **16.0.15 config change:** Existing installations: privately back up `env.js`, then run `node tools/migrate-env.js` to create `.env` without changing secrets. Fresh installs: copy `.env.example`. Host variables override file settings. See **ENV-MIGRATION.md**. Do not merely rename the old JavaScript file.

Poora PHP backend **Node.js (Express)** me convert ho chuka hai. Features, schema v25, security fixes (CSRF, TOTP/Xtream encryption, Live-TV relay, Kids Mode, owner bootstrap) sab port kiye gaye.

**Current release: 16.0.16 / schema 25; Android remains 1.0.75 / code 75 (unchanged).** **Website SEO deployment and Google/Bing owner checklist**: global-English identity, self-canonical pagination, truthful structured data, current sitemaps and opt-in daily sitemap announcement (IndexNow and/or Google Search Console via service account) plus the manual/dry-run IndexNow CLI. No ranking guarantee or production deployment is implied.

**Retained 16.0.13 fixes:** **Full audit fixes**: owner/profile-scoped playlists, password-bound and atomic adult-only 2FA, strict Kids certification and offline admission, fail-closed OAuth/site-status handling, fresh blacklist filtering, request-local TMDB metadata and installable-only native update metadata. No schema migration or production deployment is implied.

**Previous release: 16.0.12 / schema 25.** **Watch quota audit/fix**: daily-unlock model, live remaining/exemption labels, signed-cookie guest soft quota, transactional admission/settings, honest unavailable/reset recovery and no rolling/IP cap. Existing installations: apply the explicit10/day admin preset. **Website fullscreen fix**: redirected-player permission repair, own Fullscreen/labelled expanded-view control, valid viewport CSS and no iframe reparent/reload. **Session reset fix**: guarded expiration cleanup, bounded retries and safe shutdown, without masking session/authentication storage failures. **TiDB startup fix**: compatible legacy ticket-key migration, maintenance/backup opt-in, retained recovery table and accurate startup errors.  **Audit fixes**: fail-closed entitlement settings, transaction revision checks, honest wallet-ceiling handling, pagination beyond page 1000, audit-integrity warnings, bounded cleanup retries and stale-form conflict protection. Android remains 1.0.73.

**Extras baseline: 16.0.7 / schema 25.** **App Ads extras**: daily/account quota summary, read-only shared-validator settings preview, client-reported configuration warnings and permission-checked filtered CSV exports. Android remains 1.0.73; no new schema or Android build is needed for this follow-up.

**Base operations release: 16.0.6 / schema 25.** **App Ads operations**: Unity/reward health, searchable claims, server-enforced daily cap/cooldown, atomic settings audit/reset and Android 73 operational diagnostics. Defaults: 1000 earned points/account/UTC day, 60-second admitted-attempt cooldown. No live Unity delivery or production rollout is claimed.

**Registration baseline retained from 16.0.5 / schema 24.** **Registration and site-status fixes**: New Registration/Maintenance switches, real saved-state display, explicit feedback, fail-closed signup checks and bootstrap-only locking. Existing saved OFF values are preserved: after deploying, an owner/super-admin must turn **New Registration ON** to enable signup. The registration fix itself did not change Android; the new diagnostics update does.

**Local access guard (16.0.4 / schema 24):** **ACCESS-GUARD.md**. Confirmed repeated local cosmetic filtering shows a blocking screen; normal ad/offline failures do not. Website VPN detection is not included. Client-side enforcement is best-effort, not backend authorization.

**Reward integration retained from 16.0.4 / schema 24:** **UNITY-REWARDS-SETUP.md**. Unity-only Support-enabled S2S, atomic/idempotent credits and authenticated reconciliation for Android 1.0.71. The previous Google verifier and generic bridge are removed. Preserve private .env; real Support setup and genuine staging callbacks remain mandatory. Reward-provider/player/library/VIP-free behavior is unchanged apart from the documented access-screen overlay.

## Requirements

- Node.js **22.12+**
- MySQL 5.7+ / 8, MariaDB, or TiDB (local MariaDB 11.8.6 regressions and TiDB 8.5.3 unistore compatibility checks; test a backup on your actual service first)
- Existing TiDB user-only ticket PK: follow **TIDB-STARTUP-FIX.md**; the rebuild requires a verified backup and ALL writers stopped.
- `.env` with `DB_*`, `TMDB_API_KEY`, `SECRET_KEY` (32+ chars)

## Setup

```bash
cd cineamit-node
cp .env.example .env
# .env privately edit karein; existing installation: node tools/migrate-env.js
npm ci
npm start
```

Server default `http://0.0.0.0:3000` par sunta hai. Port: `PORT=8080 npm start`.

Pehla owner account: `OWNER_BOOTSTRAP_KEY` (32+ random chars) set karke `/register` par woh key daalein.

Optional one-shot schema: existing `.env` ke dotenv file mein `SETUP_ENABLED=true` set karein aur restart karein. Ab `http://localhost:3000/setup` browser mein kholkar isolated form par apna existing `SECRET_KEY` submit kar sakte hain. GET sirf form dikhata hai; database setup POST par valid key ke baad hi chalta hai. Page par ad/analytics scripts nahi hain. API clients ka existing POST /setup + form field `key` bhi supported hai.

Pehle database backup lein. Existing `password_otp.id` jaise columns ka missing AUTO_INCREMENT is endpoint se automatically repair nahi hota. Uske baad `SETUP_ENABLED=false` karke restart/redeploy karein. Apna existing SECRET_KEY change/share mat karein.

## Layout

```
server.js              Express entry
.env.example         config template
src/config.js          Config.load
src/database.js        MySQL/TiDB + schema v25 migrations
src/ticket-schema.js   guarded legacy ticket-key compatibility migration
src/security.js        PBKDF2, AES-GCM TOTP/Xtream/opaque tokens, TOTP
src/tmdb.js            TMDB client + shard cache
src/mailer.js          Brevo / Resend / SMTP
src/oauth.js           Google + GitHub
src/app.js             session, CSRF helpers, Twing render, throttle
src/twig-env.js        Twing 7 engine (PHP Twig templates unchanged)
src/ssrf.js            DNS-pin SSRF-safe fetch
src/live.js            /api/live_stream relay + HLS rewrite
src/player-access.js   watch/download tokens
src/routes/*.js        auth, player, party, main (pages+admin+livetv)
templates/             original Twig HTML
static/                css + icons
```

## Live TV

Browser ko sirf `/api/live_stream/{token}` milta hai (session+uid bound, ~4h). HLS manifests rewrite hote hain. DASH (`.mpd`) reject. Xtream **HTTPS-only**, credentials DB me AES-GCM.

## PHP se migrate

1. Pehle database backup/clone par staging deploy karein. Startup migrations schema v25 tak chalti hain; production backup ke bina upgrade mat karein.
2. `SECRET_KEY` **same** rakhein, warna TOTP / Xtream / live tokens decrypt nahi honge.
3. Templates already copied. Local CSS, Chart.js, QRCode and ColorThief assets bundled hain; apne configured player/ad providers ko staging par check karein.
4. Apache/nginx reverse-proxy Node ko, PHP `index.php` hata dein.

## Notes

- Twig templates **Twing 7** se render hote hain — updated HTML templates (named `url_for(...)`, Elvis `?:`, `session.get()`, `|json_str`, `constant()`).
- Sessions MySQL table `express_sessions` me store hoti hain (PHP `cineamit_session` cookie name same).
- Guest page-cache `cache/page/` me host-partitioned hai.
- PHP CLI is conversion me nahi chalta; runtime smoke test aapke Node+MySQL par karein.

## Fix release (15 October 2026)

Read **DEPLOYMENT.md** before upgrading. **FIXES-AND-TESTS.md** maps the original audit to changes, test evidence and remaining deployment limitations. Android native source has not been changed.

## Notification / password-reset follow-up

See `LOGIN-AND-OTP-ANALYSIS.md` for the toast layering fix, shared OTP safety/reliability changes, mail settings in .env and provider/schema troubleshooting. Deploy the complete Node source, including `src/password-reset.js`; preserve your real .env and SECRET_KEY. Live inbox delivery still requires valid provider credentials and an authorized sender.
