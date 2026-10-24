# cineamit-node — Folder Restructure Plan (PROPOSAL ONLY)

> **Status:** ⛔ Koi change apply nahi hua — sirf plan hai. Execute karne se pehle Phase-wise review kar lein.
> **Goal:** folder structure sahi karna + badi files ko todna — **runtime behavior bilkul same rahe**.

---

## 1. Current State (data)

### 1.1 Size map
```
cineamit-node/          7 root files (server.js 17KB, package.json, README, .env.example, .nvmrc...)
├── src/        708K    38 files FLAT — sab ek hi folder me (framework + security + services + routes)
├── static/     3.0M    vendor libs + 6 duplicate image copies + mixed js/css at root
├── templates/  1.1M    53 HTML files FLAT — admin.html 212KB!, base.html 120KB, watch.html 85KB
├── tools/      12K     2 scripts
├── vendor/     55K     locutus-compat (npm file: dep — chhuna nahi)
└── data/       512B    runtime (gitignored)
```

### 1.2 Badi files (jinhe todna hai)
| File | Lines | Bytes | Andar kya-kya hai |
|---|---|---|---|
| `src/routes/main.js` | **2,504** | 130K | helpers + home-bundle + 100 public routes + 70 admin routes (5 alag domains!) |
| `src/web-json.js` | **2,148** | 100K | serializers + 60 app handlers (auth/catalog/library/wallet/GA) + wrap/attach |
| `src/live.js` | **1,289** | 52K | token access + HLS relay + M3U + Xtream + Stalker + VOD catalog (6 subsystems) |
| `src/database.js` | **871** | 41K | pool/tx/locks + 33 CREATE TABLEs + 15 migrations + retention GC |
| `src/app.js` | **771** | 33K | App class (throttle/session/urlFor/render 250-line context builder) |
| `templates/admin.html` | — | **212K** | poora admin panel ek file me |
| `templates/base.html` | — | 120K | head+SEO+ads+header+nav+footer sab ek me (45 templates extend karte hain) |
| `templates/watch.html` | — | 85K | player + servers + quota UI |

### 1.3 Duplicate assets (MD5 identical pairs)
```
static/logo-192.png        == static/assets/logo-192.png        (DONO referenced — 4 root + 6 assets refs)
static/logo-512.png        == static/assets/logo-512.png        (root copy: koi ref nahi mila ✅)
static/default-tv.png      == static/assets/default-tv.png      (root copy: koi ref nahi mila ✅)
static/favicon-32.png      == static/assets/favicon-32.png      (assets copy referenced)
static/favicon.png         == static/assets/favicon.png         == apple-touch-icon.png (teenon same hash!)
```

---

## 2. PROPOSED Target Structure

```
cineamit-node/
├── server.js                      # entry — root par hi rahega (npm start convention)
├── package.json / package-lock.json / .nvmrc / .env.example / README.md
│
├── src/
│   ├── core/                      # framework & bootstrap
│   │   ├── config.js              # Config.load
│   │   ├── env-loader.js          # dotenv parser
│   │   ├── db-options.js          # mysql2 options
│   │   ├── router.js              # named-route registry
│   │   ├── app.js                 # App class (ya app/ me split — §3.5)
│   │   ├── twig-env.js            # Twing adapter
│   │   └── session-store.js       # resilient MySQL session store
│   │
│   ├── db/                        # database layer
│   │   ├── database.js            # pool, transaction, locks, fetchOne/All/execute (SLIM ~160 lines)
│   │   ├── schema.js              # saare CREATE TABLE strings (~300 lines)
│   │   ├── migrations.js          # applied<N blocks v1–v25 (~280 lines)
│   │   ├── retention.js           # opportunisticGc (~70 lines)
│   │   └── ticket-schema.js       # TiDB ticket PK guard (already separate)
│   │
│   ├── security/
│   │   ├── security.js            # crypto primitives (PBKDF2/AES-GCM/TOTP)
│   │   ├── account-security.js
│   │   ├── ssrf.js
│   │   └── password-reset.js
│   │
│   ├── services/                  # domain logic (route-free)
│   │   ├── tmdb.js
│   │   ├── live/                  # live.js → package (§3.3)
│   │   │   ├── index.js           # public API re-export (same exports as aaj)
│   │   │   ├── access.js          # CineLiveStreamAccess (issue/resolve tokens)
│   │   │   ├── relay.js           # pipeLiveHop + cineLiveStreamResponse + HLS rewrite
│   │   │   ├── m3u.js             # parseM3uLines/parseM3uPlaylist
│   │   │   ├── xtream.js          # Xtream API/cache/creds
│   │   │   ├── stalker.js         # Stalker portal allowlist + fetch + play-url
│   │   │   └── catalog.js         # collectRawChannels, loadLiveCatalog, VOD/series
│   │   ├── economy.js
│   │   ├── ads-ops.js
│   │   ├── unity-s2s.js
│   │   ├── watch-limit.js
│   │   ├── player-access.js
│   │   ├── studios.js
│   │   ├── profiles.js / playlists.js / kids.js / media-library.js
│   │   └── site-status.js
│   │
│   ├── integrations/
│   │   ├── mailer.js  ·  oauth.js  ·  vast.js
│   │
│   ├── http/
│   │   ├── web-json/              # web-json.js → package (§3.2)
│   │   │   ├── index.js           # attach() + wrap() + wantsJson (same export)
│   │   │   ├── serializers.js     # slim/slimList/logo cache/sessionUser/maskEmail
│   │   │   ├── app-auth.js        # login/logout/register/totp/dlpin
│   │   │   ├── app-catalog.js     # home/search/details/watch/episodes/studios/providers/iptv
│   │   │   ├── app-library.js     # watchlist/history/page-kinds/playlists/notifications/wrapped
│   │   │   ├── app-account.js     # profiles/pin/playback/review/request/wallet/trial
│   │   │   └── app-ga.js          # GA Measurement Protocol block
│   │   └── routes/
│   │       ├── auth.js            # (unchanged location)
│   │       ├── main.js            # SLIM: home/search/details/catalog (~500 lines)
│   │       ├── home-bundle.js     # hydrateHomeRows/loadHomeBundle (~350 lines)
│   │       ├── library.js         # watchlist/history/playlists/notifications/reels/cine-match
│   │       ├── account.js         # profile CRUD/avatar/theme/pin/requests/delete
│   │       ├── pages.js           # privacy/terms/dmca/faq/about/blog/help/contact/app/premium
│   │       ├── media.js           # actor/albums/studios/mood/surprise
│   │       ├── api-public.js      # api/search/episodes/trailer/warm/secure_play/vast/ping
│   │       ├── player.js · party.js · seo-routes.js
│   │       └── admin/
│   │           ├── index.js       # registerAdmin() + dashboard + postAdmin helper
│   │           ├── users.js       # suspend/roles/bulk/delete/CSV exports
│   │           ├── sources.js     # servers/xtream/m3u/proxies/downloads/blacklist/health
│   │           ├── content.js     # blog/help/announcements/notifications/cache/backup
│   │           └── economy.js     # site-ads/app-economy/watch-limit/apk/wallet/pulse
│   │
│   ├── seo.js · seo helpers · help-seed.js · android-app.js
│
├── templates/
│   ├── base.html                  # NAME MATTAI rakhein — 45× {% extends "base.html" %} unchanged
│   │                              # (andar partials me tuta hua — §3.6)
│   ├── partials/                  # head.html, ads.html, header.html, footer.html, seo_breadcrumbs.html
│   ├── admin/                     # admin.html + admin_app_ads_*.html + future partials
│   ├── pages/                     # privacy/terms/faq/about/blog/help... (optional group)
│   └── ... (baaki page templates)
│
├── static/
│   ├── js/    # cine-motion.js, watch-quota.js, access-check.js, app-ads-preview.js...
│   ├── css/   # tailwind.min.css, cine-motion.css, access-check.css, app-ads-admin.css
│   ├── img/   # logos, favicons, default-tv (SINGLE canonical copy each)
│   └── assets/
│       ├── vendor/   # hls, dash, DPlayer, mpegts, chart, qrcode, color-thief (unchanged)
│       └── fa/       # Font Awesome (unchanged)
│
├── tools/     # migrate-env.js, indexnow.js (unchanged)
├── vendor/    # locutus-compat (unchanged — npm file: dependency)
├── data/      # runtime
└── cache/     # page cache (gitignored)
```

---

## 3. Badi Files — Split Plans (exact boundaries)

### 3.1 `routes/main.js` (2,504 lines) → 8 files
| New file | Lines (approx) | Kya jaayega |
|---|---|---|
| `routes/home-bundle.js` | ~350 | `hydrateHomeRows`, `loadHomeBundle`, `homeBundleCoreReady/RowsReady`, `shuffleInPlace`, `warmKeyMatches` |
| `routes/main.js` (slim) | ~350 | `/`, `/home`, `/search`, `/details`, `/movies`, `/series`, `/anime`, `/filter`, category pages |
| `routes/library.js` | ~250 | history/watchlist/playlists/notifications/reels/cine-match/cine-wrapped/reviews |
| `routes/account.js` | ~200 | `/profile*` CRUD, avatar, theme, pin, preferences, requests, delete_account |
| `routes/pages.js` | ~180 | privacy/terms/dmca/faq/about/legal/blog/help/contact/app/premium/plans/manifest/sw |
| `routes/media.js` | ~200 | actor/actors/albums/album/studio/studios/mood/surprise/providers |
| `routes/api-public.js` | ~180 | api/search/episodes/trailer/video_preview/studio_thumb/warm/vast_proxy/secure_play/ping/ga_blocked |
| `routes/admin/*` (5 files) | ~750 | `registerAdmin()` ka poora block (line 1760–2504) — users/sources/content/economy/dashboard |

Shared chhote helpers (`csvSafe`, `sendCsv`, `requireStaff`, `tmdbIdFromSlug`, `activePid`, `dedupeMediaRows`, `validateServerPattern`...) → `routes/_helpers.js` (ya `src/http/helpers.js`).

### 3.2 `web-json.js` (2,148 lines) → 7 files
| New file | Lines | Content (current line refs) |
|---|---|---|
| `web-json/serializers.js` | ~260 | imageBase, slim, slimList, logoCache*, maskEmail, sessionUser, embedServers, downloadOptions (1–265) |
| `web-json/app-catalog.js` | ~420 | bootstrap, home, search, details, watch, episodes, studios, providers, iptv/livetv (266–726) |
| `web-json/app-auth.js` | ~420 | login (TOTP flow), logout, register, dlpin otp/verify (727–918, 1331–1403) |
| `web-json/app-account.js` | ~280 | profiles CRUD, pin, playback, trailer, review, request, totp, wallet×6 (918–1185, 304–374) |
| `web-json/app-library.js` | ~280 | catalog, filter, watchlist, page-kinds (`app_library` dispatcher tail) (1185–1331, 1741–2148) |
| `web-json/app-ga.js` | ~90 | gaClientId/gaCleanParams/gaMpCollect/app_ga (1403–1495) |
| `web-json/index.js` | ~60 | `wrap()`, `attach()`, `wantsJson` — **exports same `{attach, wantsJson}`** |

### 3.3 `live.js` (1,289 lines) → `services/live/` package (6 files)
| New file | Lines | Content |
|---|---|---|
| `live/access.js` | ~130 | `CineLiveStreamAccess` (issueUrl/issueStalker/resolve) |
| `live/relay.js` | ~220 | HLS rewrite, `cineLiveStreamResponse`, `pipeLiveHop`, `liveMime` |
| `live/stalker.js` | ~330 | portal allowlist, HTTP, itv list, play-url resolve |
| `live/m3u.js` | ~80 | `parseM3uLines`, `parseM3uPlaylist` |
| `live/xtream.js` | ~180 | Xtream live/VOD API, creds decrypt, caches |
| `live/catalog.js` | ~300 | `collectRawChannels*`, `loadLiveCatalog`, VOD/series mappers, classify/lang |
| `live/index.js` | ~50 | re-export — **module.exports exactly same shape** (server.js + web-json + main.js ko farak nahi padega) |

### 3.4 `database.js` (871 lines) → `src/db/` (4 files)
| New file | Lines | Content |
|---|---|---|
| `db/database.js` | ~160 | get/transaction/withLocks/consumeRate/fetch*/execute/ensureIndex |
| `db/schema.js` | ~300 | `tables[]` CREATE TABLE strings (286–590) |
| `db/migrations.js` | ~280 | `applied < N` blocks (592–end) |
| `db/retention.js` | ~70 | `opportunisticGc` |
| `db/index.js` | ~30 | facade — **same exports incl. `SCHEMA_VERSION`** |

### 3.5 `app.js` (771 lines) — OPTIONAL split (sabse kam zaroorat)
- `app/render-context.js` (~250): `render()` ka globals/context building block
- `app/throttles.js` (~80): throttle + account lock methods
- Class aise hi reh sakti hai (ya `core/app.js` move). **Priority low.**

### 3.6 Templates — bina 45 `extends` badle
**`base.html` (120K)** ko andar se todo — name `base.html` hi rakho (loader path unchanged):
```
templates/base.html          → thin shell + blocks (~25K)
templates/partials/head.html       # meta/SEO/JSON-LD (~25K)
templates/partials/ads.html        # Adsterra/GA/splash scripts (~20K)
templates/partials/header.html     # nav/search/user menu (~25K)
templates/partials/footer.html     # (~15K)
```
Sirf `base.html` ke andar `{% include %}` aayenge — **45 child templates untouched**.

**`admin.html` (212K)** → `templates/admin/dashboard.html` + `admin/partials/{users,sources,economy,content}.html` (app-ads wale includes pehle se isi pattern me hain). Route me `render('admin.html')` → ya to name same rakho (wrapper include) ya 1-line change.

**`watch.html` (85K) / `livetv.html` (56K)** → `partials/player-chrome.html`, `partials/server-list.html` etc.

---

## 4. Har move ka "touch-point" map (kitni jagah badlegi)

| Move | Call-sites affected | Kaise |
|---|---|---|
| Duplicate images delete (unreferenced only) | **0** | bas file delete |
| Big-file split + **same-path facade** (`web-json.js` re-exports from `web-json/`) | **0** require sites | caller files bilkul same; facade ~10 lines |
| Module group-move + **shim files** (`src/config.js` → `module.exports=require('./core/config')`) | **0** callers | old paths pe thin re-exports |
| Module group-move **clean** (shims ke bina) | **~85 require() sites** + server.js | mechanical search/replace + smoke test |
| Templates partial extraction (names unchanged) | **0** | sirf base/admin ke andar include |
| Templates folder groups (`pages/`, `admin/`) | 45+ render/extends strings **ya** 2 `loader.addPath()` lines | addPath trick = 1 file change |
| static/ js-css-img folders | ~30 template refs (`/static/...`) **ya** express.static alias mounts (2–3 lines server.js) | alias mount = URL same, folder clean |

**Sach ye hai:** 100% "zero-code-change" restructure sirf duplicate-file deletion tak possible hai. Baaki sab me **ya to facade/shim** (callers unchanged) ya **mechanical path updates** chahiye — dono me behavior same rehta hai.

---

## 5. PHASED Execution Plan (safe order)

### Phase 0 — Zero-change cleanup (5 min, risk: none) — ✅ DONE (branch `restructure`)
- [x] `static/logo-512.png`, `static/default-tv.png`, `static/favicon*.png` ke unreferenced root copies — ref audit ke baad 5 dead root copies delete; root `logo-192.png` REFERENCED (5 jagah) — kept
- [~] `.env.test` (scratch) delete — **deviation**: retained (gitignored) — active test-harness config (DB creds + owner bootstrap key) ban gaya; repo pe koi effect nahi
- [x] Duplicate `favicon.png`/`apple-touch-icon.png` trio — root copies delete; canonical = `static/assets/` copies (base.html inhein reference karta hai)

### Phase 1 — Big-file splits with facades (2–4 hrs, risk: low, callers 0 change) — ✅ DONE (branch `restructure`, 5 commits)
Executed order (smallest-first, plan ka "biggest-first" order invert kiya — safer):
1. ✅ `database.js` → `src/database/` (4 files) — `src/db/` naam ki bajaye `database/` folder (require path 0 change trick)
2. ✅ `live.js` → `src/live/` (9 files — plan ka 6 se thoda zyada granular: common/cache alag)
3. ✅ `web-json.js` → `src/web-json/` (9 files — plan §3.2 ke names se alag: app-pages/app-account split, +guards/+page-text)
4. ✅ `routes/main.js` → **§3.1 FULL fine split DONE** (92 route blocks → livetv(5)/catalog(10)/media(10)/library(20)/account(13)/api-public(10)/pages(24) + slim orchestrator main.js; admin 60 blocks → admin/{dashboard12,users9,sources17,content13,economy9} + admin/helpers.js (staff/owners/postAdmin/updateSiteStatus/bustSiteCache) + admin/index.js). Route table byte-identical (235 regs); blocks verbatim-proven; registration order proven irrelevant first (zero ambiguous pairs).
5. ✅ Har step ke baad smoke test — syntax + exports parity + route count (115/120) + boot + HTTP/JSON smoke + fresh-DB boot. **Deep audit (post-completion) ne 1 real bug pakda**: `live/common.js` ka `module.exports` missing tha (`sessionBinding`/`streamOk` undefined → live-stream token issue path runtime crash) — FIXED + import-resolution audit (whole src/) now clean

**Deep-audit verdict (2026-10-23)**: Phase 0 ✅ complete (1 justified deviation), Phase 1 ✅ complete-with-deviation (main.js fine-split pending, zero functions lost: 48/75/25 fn parity exact).

### Phase 2 — Folder grouping (1–2 hrs, risk: low-med) — ✅ DONE (Option B — clean, no shims)
- ✅ `src/core/` (config, env-loader, db-options, router, app, twig-env, session-store), `src/db/` (database package + ticket-schema), `src/security/` (security + account-security + ssrf + password-reset), `src/services/` (tmdb, economy, ads-ops, unity-s2s, watch-limit, player-access, studios, profiles, playlists, kids, media-library, site-status, live/), `src/integrations/` (mailer, oauth, vast), `src/http/` (routes/ + web-json/), root par seo.js + seo-routes→http/routes/ + help-seed + android-app
- Deviations: `db/database.js`→`db/index.js`, `security/security.js`→`security/index.js` (folder+index pattern — require paths shorter); `__dirname` root-depth fixed in tmdb/env-loader/db-options (same resolved paths — cacheDir hash verified identical)
- Verified: 75-file require+exports audit clean, route table identical (235), boot+smoke+fresh-DB green
- **Deep-audit verdict (2026-10-24)**: ✅ Phase 2 CONFIRMED COMPLETE. Independent proofs: (1) tree = plan §2 exact (72 files, root par sirf seo/help-seed/android-app); (2) content integrity — 72/72 files byte-identical modulo require-strings, EXACTLY 4 documented `__dirname` depth fixes (tmdb×2, env-loader, db-options); (3) semantic path check — 560 require sites: old-resolved target ≡ new-resolved target via move-map, 0 wrong rewrites; (4) server.js 24 + tools 9 requires resolve; (5) no explicit `/index.js` requires → module singletons intact (proof: `require('./src/db')===require('./src/db/index.js')`); (6) static assets serve (tailwind/cine-motion/logo 200), templates resolve via `app.rootDir` (move-independent), tools CLI load; (7) route table + exports + cacheDir hash identical to pre-move baselines. Harmless note: 3 tmp GC-guard filenames (app.js/party.js/retention.js) hash `__dirname` — filename salt value changed (throttle markers only, no behavior change).

### Phase 3 — Template surgery (2–3 hrs, risk: med — visual regression!)
- `base.html` partial extraction → browser me har page visually diff karo
- `admin.html` split → admin panel tabs test karo
- Optional folders + `loader.addPath()` tweak (1 jagah code)

### Phase 4 — static/ consolidation (30 min, risk: low)
- `js/`, `css/`, `img/` folders; URLs rakhne hain to express.static aliases mount karo
- ya URLs clean karne hain to ~30 template refs update + cache bust

### Phase 5 (optional) — app.js/render-context split (low priority)

---

## 6. Kya-Kya FAYDA milega

| Problem (aaj) | Baad me |
|---|---|
| `main.js` 2504 lines — 5 domains ek file | ~350-line focused files; admin alag |
| `web-json.js` 2148 lines | serializers/handlers alag; naya endpoint = naya file |
| `live.js` 6 subsystems ek me | live/ package — Xtream/Stalker/M3U independent testable |
| `database.js` me 33 tables ki SQL | schema/migrations alag — migration edit karna safe |
| `admin.html` 212KB | partials — git diffs reviewable |
| `base.html` 120KB | head/ads/header/footer partials |
| 6 duplicate image copies | 1 canonical each |
| src/ me 38 flat files | 6 clear groups — naye dev ko 5 min me map samajh aaye |

## 7. RISKS / Constraints (sach-sach)

1. **Facade pattern mandatory** for behavior safety: split files se pehle `module.exports` ka shape same rakho (jest-less repo me smoke test hi proof hai).
2. `router.js` `App.endpoints` named-route registry global hai — route registrations kisi bhi order me chalte hain, isliye split me order worry mat karo; lekin **duplicate `add()` endpoint names** mat aane do.
3. Twing loader **single path** use karta hai (`addPath(templatesDir)`) — template subfolders ke liye `addPath` calls badhane padenge (ya render names me prefix).
4. `server.js` me `STATELESS`, `isCacheableGuestPath` paths hardcoded hain — routes move karne se URLs nahi badal rahe, isliye safe.
5. `createAll()` recursion guard (`inCreateAll`) aur missing-table auto-heal split ke baad bhi `db/index.js` facade se hi exposed ho.
6. Template visual regression = sabse bada practical risk (base.html). Diff-based review + screenshots zaroor.
7. Ye repo single-commit hai — **restructure se pehle baseline commit/branch banao** (`git checkout -b restructure`).

---

## 8. Quick-win summary (agar sirf 1 ghanta ho)

1. Phase 0 duplicate cleanup (0 code change) ✅
2. Sirf `routes/main.js` ka admin block (745 lines) `routes/admin/` me nikal do — sabse badi file ka aadha bojh utar jayega, `registerAdmin()` ko `require('./admin')()` bana do
3. `database.js` ki `tables[]` SQL `db/schema.js` me le jao (facade same)

Itte se hi repo ka first impression kaafi clean ho jayega; baaki phases dheere se.

---
*Plan ready — koi file move/edit nahi hui. Execute karne bolenge to Phase 0 se shuru karunga.*
