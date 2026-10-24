# Bugs & Problems Report — CineAmit 2.0

> Deep analysis date: **23 October 2026** · Backend 16.0.16 (schema 25) · Android 1.0.75
> Har finding live smoke test ya static review se verified hai. Severity: **HIGH / MEDIUM / LOW / INFO**

## Executive Summary

Code quality overall **bahut acchi** hai — security layers (PBKDF2, AES-GCM, CSRF, SSRF-guard, fail-closed throttles) honestly implement hain aur live tests me kaam karte mile. Koi **critical exploitable vulnerability** nahi mila. Neeche jo issues hain wo mostly **documentation gaps, cosmetic/operational niggles, aur defense-in-depth improvements** hain.

| Severity | Count | Summary |
|----------|-------|---------|
| HIGH     | 0     | Koi critical exploitable bug nahi mila |
| MEDIUM   | 2     | Broken doc links; permissive CSP (ad-driven design) |
| LOW      | 5     | Migration log noise, register race UX, user-enumeration oracles, cache string fragility, Node engine strictness |
| INFO     | 5     | Silent catches, CSRF-exempt API design, owner-id-1 hardcode, SECRET_KEY lock-in, page-cache locality |

---

## MEDIUM

### M1. README me ~20 documentation files reference hain jo repo me EXIST hi nahi karte

**Jagah:** `cineamit-node/README.md`, `cineamit-android/README.md`

Dono READMEs links dete hain in files ke liye, lekin repo me inme se **koi bhi nahi hai**:

- Node README: `ENV-MIGRATION.md`, `SEO-DEPLOYMENT.md`, `DEEP-AUDIT-FIXES.md`, `WATCH-QUOTA-FIX.md`, `WEBSITE-FULLSCREEN-FIX.md`, `SESSION-RESET-FIX.md`, `TIDB-STARTUP-FIX.md`, `APP-ADS-FIXES.md`, `APP-ADS-EXTRAS.md`, `APP-ADS-OPERATIONS.md`, `REGISTRATION-FIXES.md`, `ACCESS-GUARD.md`, `UNITY-REWARDS-SETUP.md`, `DEPLOYMENT.md`, `FIXES-AND-TESTS.md`, `LOGIN-AND-OTP-ANALYSIS.md`
- Android README: `EMBED-PLAYBACK.md`, `DEEP-AUDIT-FIXES.md`, `APP-ADS-DIAGNOSTICS.md`, `SECURITY-HARDENING.md`, `UNITY-ONLY-ADS.md`, `ACCESS-GUARD.md`

**Impact:** Naya developer/operator README ke links click karega → 404. Critical upgrade steps (jaise `ENV-MIGRATION.md` ka "env.js ko rename mat karo, migrate-env.js chalao") sirf README summary me hain; full guidance missing hai. `TIDB-STARTUP-FIX.md` jaise recovery steps bhi gayab hain.

**Fix:** Ye docs kahin private me hain to repo me commit karein; warna README se dead links hata kar `docs/` folder use karein (ye wala).

---

### M2. CSP `script-src 'self' https: 'unsafe-inline'` — XSS mitigation sirf autoescape par depend karti hai

**Jagah:** `server.js` (security-headers middleware)

```
Content-Security-Policy: default-src 'self' https: data: blob:; script-src 'self' https: 'unsafe-inline'; ...
```

**Analysis:** CSP me `unsafe-inline` + koi bhi `https:` host script chala sakta hai. Ye ad networks (Adsterra/HilltopAds/AdSense) ke liye intentionally kiya gaya hai, matlab:

- Template autoescape (Twing `html` strategy + block/macro escaping) **akeli** XSS line-of-defense hai.
- `|raw` sirf 5 jagah use hota hai (JSON-LD `seo.graph|json_encode|raw`, ad social-bar) — ye controlled hain, lekin agar future me koi `|raw` user-input par lag gaya to CSP block nahi karega.

**Risk:** Defense-in-depth kamzor. Direct exploit nahi — aaj escaping sahi hai.

**Fix suggestion:** Jab `ADS_ENABLED=false` ho tab strict CSP (nonce-based `script-src 'self' 'nonce-...'`) serve karein; ad pages ke liye hi `unsafe-inline` rakhein. `trusted-types` bhi consider karein.

---

## LOW

### L1. Fresh install par har baar migration14 ka spurious error log hota hai

**Jagah:** `src/database.js` (migration 14 vs createAll)

Fresh install par console me ye aata hai:

```
[migration14] watchlist unique key: Duplicate key name 'uniq_wl_user_profile_tmdb'
```

**Root cause:** `createAll()` watchlist table ko **inline** `UNIQUE KEY uniq_wl_user_profile_tmdb` ke saath create karta hai (final schema), lekin uske baad version-guarded migration 14 `ALTER TABLE watchlist ADD UNIQUE KEY ...` chalata hai jo "Duplicate key name" fenkta hai. Error catch karke log hota hai — kuch break nahi hota, migration record phir bhi insert ho jata hai.

**Impact:** Sirf log noise; operators ko lag sakta hai migration fail hui. Idempotency gap ka symptom hai (fresh-create aur upgrade paths alag-alag final state la rahe hain).

**Fix:** Migration 14 me pehle `SHOW INDEX ... WHERE Key_name = 'uniq_wl_user_profile_tmdb'` check karein (jaisa later migration line ~786 already karta hai), ya `tryExec` use karein bina console.error ke.

---

### L2. Registration me email/username duplicate-check INSERT transaction ke bahar hai — race + unfriendly error

**Jagah:** `src/routes/auth.js` (`/register`)

Flow: `emailExists`/`usernameExists` SELECT → phir INSERT. Do concurrent signups same email se: dono SELECT me "not exists" dekhenge, ek INSERT UNIQUE constraint se fail hoga → user ko generic message: *"Database error while creating account."*

**Impact:** Low — data safe hai (UNIQUE constraints hain), bas UX kharab. Attacker enumeration ke liye bhi use kar sakta hai ("Email is already registered" vs "Username is already taken" — dono alag messages).

**Fix:** Insert ko `INSERT ... ` + duplicate-key error (ER_DUP_ENTRY) handle karke specific message; ya SELECT+INSERT ek transaction/lock me. Enumeration ke liye dono cases me same generic message.

---

### L3. Login response user-enumeration / account-status oracle

**Jagah:** `src/routes/auth.js` + `src/web-json.js` (app_login)

- Unknown user vs wrong password: same "Invalid login credentials" — **good**.
- Lekin locked account alag message deta hai: *"This account is temporarily locked..."* (web) / `error: 'locked'` + HTTP 423 (JSON). Isse attacker confirm kar sakta hai ki email/username **exist** karta hai aur lock state kya hai.
- `accountLoginLocked` check user milne ke baad hi hota hai, isliye timing/response se existence leak hota hai.

**Impact:** Low — lock system strong hai (5 fails/15 min account lock + IP/identity throttles). Oracle se targeted nuisance possible hai.

**Fix:** Locked case me bhi same generic "Invalid login credentials" + same status code; lock message sirf legitimate user ko email ke through batayein (ya CAPTCHA challenge).

---

### L4. Guest page-cache validity hardcoded English string `Popular Movies` par depend karti hai

**Jagah:** `server.js` (page-cache writer)

```js
&& !(pth === '/home' && !body.includes('Popular Movies'))
```

Agar home page ka section title change/localize ho jaye (ya TMDB-down hone par empty page render ho jaye jisme ye string na ho), cache write skip ho jayega — ye **intended fail-safe** hai. Lekin reverse case: agar kisi aur page par accidentally ye string aa gayi aur page empty/broken hua, wo cache ho sakta hai (TTL 300s tak).

**Impact:** Low — TTL short hai (5 min default), blacklist-revision hashing bhi cache key me hai. Fragile string coupling design smell hai.

**Fix:** Template me explicit `<!-- cache-ok -->` marker render karein aur usse check karein.

---

### L5. `engines: node >=22.12.0` strict hai; code Node 20.12+ par bhi chalta hai

**Jagah:** `package.json`

`env-loader.js` `node:util` `parseEnv` use karta hai (Node 20.12+ me available). Sandbox test me **Node 20.20.2 par pura server successfully boot hua** (schema migration + HTTP sab pass). `npm ci` engine-strict hosts par Node 20 wale users ko rok dega.

**Impact:** Low — Node 22 LTS recommend karna theek hai, lekin requirement overstated lagti hai. Koi runtime failure Node 20.12+ par nahi mila.

**Fix:** `>=20.12.0` likhein (ya comment me reason dein ki 22 kyun mandatory hai).

---

## INFO / Design Notes (bugs nahi, lekin jaan lo)

### I1. 83 silent `catch {}` blocks
Bahut saare empty catches hain (session registry writes, security-log GC, cleanup retries). Mostly **intentional fail-safe** patterns hain (request fail nahi hona chahiye maintenance ki wajah se). Lekin kuch `catch {}` (jaise logout me `active_sessions` DELETE) real problems chupa sakte hain. Ops visibility ke liye debug-level logging add karein.

### I2. `/api/party/*` aur `/api/app/*` CSRF-token-exempt hain
`App.csrfExemptPath()` in paths ko CSRF token se exempt karta hai (Android/JSON clients ke liye). Mitigations jo **abhi bhi lagu** hain: session cookie required, `sameOriginOk()` origin check (cross-origin POST → 403, verified in test), `sameSite=lax` cookies, Android side `WebSecurity.requireAppRequest` same-origin enforcement. Ye standard SPA/API pattern hai — samajhna zaroori hai ki "CSRF exempt" ka matlab "auth exempt" nahi hai.

### I3. User `id=1` ko suspend/logout se exempt kiya gaya hai
`loginUser()`/`currentUser()` me `user.id !== 1` checks — primary owner kabhi suspend nahi hoga. Design choice (lockout-prevention), lekin matlab: **account 1 ki password + TOTP security sabse critical hai**. Agar account 1 compromise ho gaya to admin panel me "suspend" kaam nahi karegi (DB se manually `is_active=0` + sessions delete karna padega).

### I4. `SECRET_KEY` change karne par TOTP/Xtream/live-tokens decrypt nahi honge
HKDF-derived keys (`CineAmit/TOTP-GCM-v1` etc.) SECRET_KEY se bante hain. README me documented hai. Migration se pehle SECRET_KEY backup zaroor rakhein.

### I5. Guest page-cache file-based (`cache/page/`) hai
Multi-instance/serverless deploy me har worker ka apna cache — inconsistency possible. TiDB/serverless target ke liye shared storage ya `PAGE_CACHE_TTL=0` consider karein.

---

## Verified-Good (jinhe test kiya — ye theek kaam karte hain)

Ye list isliye taaki pata chale kya **kaam kar raha** hai:

| Control | Test result |
|---|---|
| `npm audit` | **0 vulnerabilities** (12 direct deps incl. express, mysql2, twing, bcryptjs) |
| `node --check` all 70 JS files | Sab syntax-clean |
| Config validation (missing keys, bad ports, HTTP origins, weak SECRET_KEY) | Fail-fast with clear Hinglish errors |
| Schema v25 auto-migration (MariaDB) | Boot par apply hui, `schema_migrations` set |
| Owner bootstrap (`OWNER_BOOTSTRAP_KEY` + GET_LOCK) | First user `role=owner` bana; double-bootstrap race guarded |
| Login + session regenerate | Cookie session, redirect `/profiles`, `active_sessions` row bana |
| CSRF missing-token POST | Rejected + `csrf_failed` security_log entry |
| Cross-origin POST (`Origin: https://evil.example.com`) | `403 Cross-origin request rejected` |
| Login rate limit | 10 identity attempts → 429 (design: 10/15min per identity, 60/15min per IP) |
| XSS reflection (`/search?q=<script>...`) | Escaped output — no raw reflection |
| Admin RBAC (`/cineamit-admin`) | Guest → login redirect; owner → dashboard; non-staff paths guarded |
| JSON API auth (`/api/app/watchlist`) | Guest → `401 login_required` |
| JSON login + bad password | `ok:true` user payload / `401 invalid_credentials` |
| Fail-closed DB/throttle failures | throttle deny-by-default; site-status unavailable → 503 (fail-closed) |
| `/setup` with `SETUP_ENABLED=false` | 404 (route not registered) |
| Security headers | X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy, HSTS-on-secure |
| TMDB down behavior (`/movies`) | 503 + `Retry-After: 60` (fail-closed, no stale empty page cached) |
| Password hashing | PBKDF2-SHA256 600k iterations + legacy bcrypt verify + dummy-hash timing pad on unknown user |
| TOTP | AES-GCM encrypted secrets, window=±1, per-account lockout |
| Unity S2S | HMAC-MD5 verified, timing-safe compare, idempotent event IDs |
| SSRF guard (live relay, fetch) | DNS-pin, private-IP block, redirect revalidation, HTTPS-only options |

---

## Priority fix order (recommended)

1. **M1** — missing docs commit karo ya README links fix karo (sabse zyada operator impact)
2. **L1** — migration14 noise fix (1 ghante ka kaam)
3. **L2/L3** — registration/login messages unify (enumeration hardening)
4. **M2** — ads-off strict CSP
5. **L4/L5** — cache marker + engines range
