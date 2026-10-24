# Setup & Deployment — CineAmit 2.0

## 1. Requirements

| Component | Minimum |
|---|---|
| Node.js | **22.12+** declared (`engines`) — 20.12+ par bhi verified chalta hai |
| Database | MySQL 5.7+/8, MariaDB (11.x tested), ya TiDB Cloud (TLS mandatory) |
| RAM | 512 MB+ (TMDB cache + page cache) |
| Disk | 1 GB+ (logs, cache, optional APK uploads) |
| TLS | Production me HTTPS reverse-proxy (nginx/caddy) — HSTS sirf secure par set hota hai |

## 2. Fresh install (Node backend)

```bash
cd cineamit-node
cp .env.example .env
# .env me inhe fill karein (dekhie §3)
npm ci
npm start                    # default http://0.0.0.0:3000
# Custom port: PORT=8080 npm start
```

Pehli baar boot par schema v25 automatically create/upgrade ho jati hai (`schema_migrations` table tracks versions).

### First owner account
1. `.env` me `OWNER_BOOTSTRAP_KEY` set karein (32+ random chars):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. `OWNER_BOOTSTRAP_KEY` **set** hone par hi `/register` first-account owner banata hai (GET_LOCK se double-bootstrap race protected). Registration closed hone par `New Registration` switch ON karna padega.
3. Owner banne ke baad key hata dein ya rotate karein (wo sirf bootstrap ke liye hai).

## 3. `.env` configuration reference

| Variable | Purpose | Notes |
|---|---|---|
| `PORT`, `HOST` | Listen address | default 3000 / 0.0.0.0 |
| `SECRET_KEY` | Master crypto key | **32+ chars; kabhi rotate na kare** (TOTP/Xtream/live tokens toot jayenge) |
| `DB_HOST/PORT/NAME/USER/PASS` | MySQL connection | IP ke bajay DNS hostname jab `DB_SSL` on (SNI verify) |
| `DB_SSL`, `DB_SSL_CA_FILE` | TLS mode | `auto` = TiDB Cloud par on; `true/false` explicit |
| `TMDB_API_KEY` | TMDB v3 key | Required. `TMDB_INSECURE_TLS_RETRY=false` hi rakhein |
| `APP_PUBLIC_ORIGIN` | Public origin | HTTPS required (HTTP sirf loopback dev) |
| `SEO_PUBLIC_ORIGIN` | Canonical SEO origin | HTTPS-only; mirrors par same |
| `OAUTH_BASE_URL` | OAuth redirect base | Required jab Google/GitHub enabled |
| `GOOGLE_*` / `GITHUB_*` | OAuth clients | Optional |
| `SMTP_*` / `BREVO_API_KEY` / `RESEND_API_KEY` | Mail (OTP) | Koi ek configure karein |
| `OWNER_BOOTSTRAP_KEY` | First-owner gate | Empty = bootstrap disabled |
| `SETUP_ENABLED` | One-shot `/setup` DB init | Sirf migration ke liye; baad me `false` |
| `UNITY_S2S_ENABLED/SECRET/GAME_ID/...` | Reward verification | Support-se secret; never ship in app |
| `TRUST_PROXY_REAL_IP`, `TRUSTED_PROXIES` | Proxy IP trust | Reverse-proxy par CIDR list |
| Ads (`ADSTERRA_*`, `ADSENSE_PUB_ID`, `HILLTOPADS_VAST_URL`, `GA_*`) | Monetization/analytics | Optional |
| `STALKER_PORTAL_URL/MAC`, `M3U_PLAYLISTS`, `CLOUDFLARE_PROXY_URL` | Live TV sources | Also admin-configurable |
| `PAGE_CACHE_TTL`, `WARM_KEY`, `BLOCK_BAD_BOTS`, `ADS_ENABLED`, `SPLASH_ENABLED`, `CURSOR_ENABLED` | Behavior toggles | |

**Host environment variables override `.env` values** (including intentional empty strings). No variable expansion — dotenv data only (no JS).

### Legacy `env.js` migration (16.0.15+)
```bash
# env.js ko manually rename NAHI karein
node tools/migrate-env.js            # → .env (lossless, atomic, no-clobber)
# ya: node tools/migrate-env.js --from trusted-env.js --to .env
```
Converter plain-object requirement rakhta hai (inherited/non-enumerable settings reject) aur secrets print nahi karta. Original file backup me rakhein.

## 4. Optional one-shot `/setup` (schema only)

```ini
SETUP_ENABLED=true        # .env me → restart
```
- Browser me `http://localhost:3000/setup` kholo → form me existing `SECRET_KEY` submit karo (GET sirf form dikhata hai; ads/analytics scripts nahi)
- `Database.createAll()` POST par hi chalta hai; 5 attempts/10 min throttle
- **Baad me `SETUP_ENABLED=false` karke restart karein**
- Note: ye endpoint missing `AUTO_INCREMENT` (e.g. `password_otp.id`) automatically repair nahi karta

## 5. Database notes

- **Pehle backup lein** — startup migrations schema v25 tak chalti hain
- **TiDB user-only ticket PK** case: `APP_ALLOW_TICKET_TABLE_REBUILD=true` + verified backup + ALL writers stopped; detail README `TIDB-STARTUP-FIX.md` me (doc missing — see bugs M1)
- MariaDB 11.8.6 / TiDB 8.5.3 unistore regression testing claim README me hai — apne service par backup test karein
- Retention GC auto-cleanup: tickets 7d, diagnostics 7d, OTP 1d, rate-limits 1d, error_log 90d, sessions 30d, party messages 24h, watch hits 40d

## 6. Reverse proxy (nginx sketch)

```nginx
server {
  listen 443 ssl http2;
  server_name your-domain.com;
  # ssl_certificate ...;

  client_max_body_size 2m;          # body limits: json 1mb, urlencoded 2mb

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;        # live relay streams ke liye
  }
}
```
```ini
# .env me (proxy ke peeche):
TRUST_PROXY_REAL_IP="true"
TRUSTED_PROXIES="127.0.0.1/32"       # apna proxy CIDR
APP_PUBLIC_ORIGIN="https://your-domain.com"
OAUTH_BASE_URL="https://your-domain.com"
SEO_PUBLIC_ORIGIN="https://your-domain.com"
```
PHP stack se migrate: Node ko proxy karein, `index.php` hata dein. `SECRET_KEY` **same** rakhein.

## 7. From-PHP migration checklist

1. DB backup/clone par staging deploy; migration v25 tak chalegi
2. `SECRET_KEY` same rakhein (warna TOTP/Xtream/live tokens decrypt nahi honge)
3. Templates bundled hain; local CSS/vendor assets bundled; apne player/ad providers staging par verify karein
4. Apache/nginx: Node ko proxy, PHP entrypoint hatao
5. Smoke: register→login→details→watch→livetv→admin

## 8. Android build

```bash
cd cineamit-android
# app/build.gradle.kts me DEFAULT_BASE_URL set karein (https, no trailing slash)
# gradle.properties me Unity config: UNITY_ENABLED, UNITY_TEST_MODE, UNITY_GAME_ID, placements
./gradlew :app:assembleDebug          # ya assembleRelease (production signing key!)
./gradlew :app:printAdsConfig         # ads config sanity
# Controlled test ads build: ./gradlew :app:assembleDebug -PUNITY_TEST_MODE=true
```
- Android Studio Ladybug+, JDK 17, compileSdk 36, minSdk 24
- App me bhi More → Base URL se server change kar sakte hain (SharedPreferences `base_url`)
- Cleartext HTTP disabled — valid system-trusted HTTPS hi chalega
- Deploy updated Node tree (`web-json.js`) before app rollout

## 9. Operations

| Task | How |
|---|---|
| Config check | `node tools/migrate-env.js` style errors startup par hi aate hain (fail-fast) |
| IndexNow submit | `node tools/indexnow.js [--file urls.txt] [--send]` — default DRY RUN |
| Security log | `security_log` table (30d retention) + admin CSV export |
| Session kill | Admin panel → kill sessions (registry-based; `SESSIONS_MIGRATED_AT` marker) |
| Watch quota preset | Admin → explicit **daily10** preset apply karein (10/day) |
| Backups | DB dump + `.env` (private) + uploaded APKs (`data/app/`) |

## 10. Verified smoke-test script (jo humne chalaya)

```bash
curl -sI https://host/login            # security headers
curl -s https://host/ | wc -c          # homepage
curl -s -X POST https://host/api/app/login -H 'Content-Type: application/json' \
     -d '{"username":"u","password":"p"}'   # JSON auth
curl -s 'https://host/search?q=%3Cscript%3E' | grep script   # XSS reflection → none
```
