# Testing Guide — CineAmit 2.0

Repo me automated test suite nahi hai (Android README me 13 Robolectric tests mention hain par files included nahi). Ye guide humare analysis me use kiya gaya **smoke-test suite** hai — ise apne staging par repeat kar sakte hain.

## 1. Pre-boot checks (koi DB nahi chahiye)

```bash
cd cineamit-node

# Syntax check — har JS file
for f in server.js src/*.js src/routes/*.js tools/*.js; do node --check "$f" || echo "FAIL $f"; done

# Dependencies + known CVEs
npm ci
npm audit

# Config validation (bad values → clear errors, good values → load OK)
cp .env.example .env.test   # fill test values
CINE_CONFIG_FILE=.env.test node -e "
require('./src/config').load(require('./src/env-loader').loadSettings({rootDir:process.cwd()}));
require('./src/routes/auth')();require('./src/routes/player')();
require('./src/routes/party')();require('./src/routes/main')();require('./src/web-json').attach();
const {routes}=require('./src/router');
console.log('GET routes:', routes.GET.length, 'POST routes:', routes.POST.length);"
```

Expected: 0 syntax errors, 0 audit vulnerabilities, ~115 GET + ~120 POST routes.

## 2. Boot smoke test (MariaDB/MySQL ke saath)

```sql
CREATE DATABASE cineamit CHARACTER SET utf8mb4;
CREATE USER 'cineamit'@'127.0.0.1' IDENTIFIED BY 'testpass';
GRANT ALL PRIVILEGES ON cineamit.* TO 'cineamit'@'127.0.0.1';
```

```bash
CINE_CONFIG_FILE=.env.test PORT=3123 node server.js
# Expected: "CineAmit Node.js listening ... (schema v25)"
# Ignore cosmetic: [migration14] watchlist unique key: Duplicate key name ...
```

## 3. HTTP test matrix

```bash
BASE=http://127.0.0.1:3123

# Public pages
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" $BASE/            # 200, ~100KB+
curl -s -o /dev/null -w "%{http_code}\n" $BASE/login                        # 200
curl -s -o /dev/null -w "%{http_code}\n" $BASE/robots.txt $BASE/sitemap.xml # 200
curl -s -o /dev/null -w "%{http_code}\n" $BASE/setup                        # 404 (SETUP_ENABLED=false)

# Security headers
curl -sI $BASE/login | grep -iE "x-frame|content-security|x-content|referrer|permissions"

# Owner bootstrap (csrf token /register page se)
CSRF=$(curl -s -c cj.txt $BASE/register | grep -oP 'name="csrf_token" value="\K[a-f0-9]+' | head -1)
curl -s -b cj.txt -c cj.txt -X POST $BASE/register \
  -d "csrf_token=$CSRF&username=testowner&email=owner@test.com&password=Test@1234&confirm_password=Test@1234&owner_bootstrap_key=<32+char-key>" \
  -o /dev/null -w "%{http_code}\n"    # 302

# Login
CSRF=$(curl -s -c cj.txt -b cj.txt $BASE/login | grep -oP 'name="csrf_token" value="\K[a-f0-9]+' | head -1)
curl -s -b cj.txt -c cj.txt -X POST $BASE/login \
  -d "csrf_token=$CSRF&login_id=testowner&password=Test@1234&remember=1" \
  -o /dev/null -w "%{http_code} %{redirect_url}\n"   # 302 → /profiles

# Admin RBAC
curl -s -b cj.txt -o /dev/null -w "%{http_code}\n" $BASE/cineamit-admin     # 200 (owner)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $BASE/cineamit-admin  # 302 → login

# CSRF / origin attacks (EXPECT BLOCKS)
curl -s -b cj.txt -X POST $BASE/profile/update -d "username=x" -o /dev/null -w "%{http_code}\n"   # 302 redirect + csrf_failed logged
curl -s -b cj.txt -X POST $BASE/profile/update -H "Origin: https://evil.example.com" -d "csrf_token=x" # 403 JSON

# XSS reflection (EXPECT ESCAPE)
curl -s "$BASE/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E" | grep -c "script>alert"   # 0

# Rate limit (EXPECT 429 after 10)
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST $BASE/api/app/login \
  -H "Content-Type: application/json" -d '{"username":"nobody","password":"x"}'; done

# JSON API auth
curl -s $BASE/api/app/watchlist -H "Accept: application/json"   # 401 login_required
curl -s -X POST $BASE/api/app/login -H "Content-Type: application/json" \
  -d '{"username":"testowner","password":"Test@1234"}'          # ok:true + user
curl -s $BASE/home -H "Accept: application/json" | head -c 200  # JSON wrapper
```

## 4. DB verification queries

```sql
SELECT id,username,role,is_active FROM users;                       -- owner row
SELECT event,user_id,details FROM security_log ORDER BY id DESC LIMIT 10;  -- registered/login/csrf_failed
SELECT COUNT(*) FROM schema_migrations;                             -- versions applied
SELECT * FROM rate_limits LIMIT 5;                                  -- throttle rows
```

## 5. Negative boot tests

```bash
# Missing config → fail-fast with Hinglish error, exit 1
# DB down → "Startup stopped: database connection/authentication/TLS failed..." exit 1
# Wrong SECRET_KEY (<32) → config error
# APP_PUBLIC_ORIGIN=http://public-host → config error (HTTPS enforced)
```

## 6. What we verified (23 Oct 2026)

| Test | Result |
|---|---|
| npm audit | 0 vulns |
| node --check (70 files) | pass |
| Boot + schema v25 on MariaDB | pass |
| Owner bootstrap + login + admin | pass |
| CSRF reject + cross-origin 403 | pass |
| Rate limit 429 | pass |
| XSS escape | pass |
| Guest guards (livetv/admin/api) | pass |
| TMDB-down fail-closed 503 | pass |
| Setup disabled 404 | pass |

## 7. Not covered here (karo to better)

- Real TMDB key ke saath content pages (details/watch/player)
- Live TV relay against real Xtream/Stalker
- Mail delivery (Brevo/Resend/SMTP) inbox test
- Android build (`gradlew :app:assembleDebug`) + device run
- Unity S2S staging callbacks
- Load/concurrency testing (watch quota races, wallet credits)
