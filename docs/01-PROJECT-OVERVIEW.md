# Project Overview — CineAmit 2.0

**CineAmit** ek full-featured video streaming platform hai: movies/TV/anime catalog (TMDB metadata), Live TV (Xtream/M3U/Stalker), watch party, profiles/kids mode, playlists, rewards economy, ads monetization, aur native Android client.

## Identity

| | |
|---|---|
| Repository | `itmplayit/cineamit2.0` |
| Backend | **cineamit-node** — Node.js/Express v16.0.16, schema v25 |
| Android | **cineamit-android** — v1.0.75 (versionCode 75), package `in.cineamit.app` |
| Origin | Poora PHP backend Node.js me convert hua hai (Twig templates unchanged via Twing 7) |
| Node requirement | 22.12+ declared (20.12+ par bhi verified working) |
| DB | MySQL 5.7+/8, MariaDB, ya TiDB (Cloud) — utf8mb4 |

## Features

### Website
- **Catalog:** Home (hero + rails), Movies, Series, Anime, categories, filters, search, studios, OTT providers, actors, collections, albums
- **Details & Watch:** TMDB details, seasons/episodes, trailers, multi-server embed players, fullscreen, download providers
- **Live TV:** Xtream Codes, M3U playlists, Stalker portals — browser ko sirf relay-token URLs milte hain
- **Accounts:** Register/login (owner bootstrap), Google/GitHub OAuth, TOTP 2FA, password reset (OTP email), profiles (PIN, kids, themes), account security
- **Personal:** Watchlist, history, playlists (share codes), notifications, announcements, Cine Match (friend history match), Cine Wrapped (year-in-review)
- **Kids Mode:** strict certification allowlist (IN U/U/A 7+, US TV-Y/Y7/G, GB U), genre gate (Family 10751 / Kids 10762), actor/album suppression
- **Watch quota:** daily-unlock model (default 10 titles/day), guest soft quota (signed cookie), staff/kids exemptions
- **Monetization:** Adsterra (bars/popunder/banners/smartlink), HilltopAds/AdSense, VAST pre-roll with allowlisted proxy, premium plans (trial/monthly/yearly)
- **Admin panel** (`/cineamit-admin`): users/roles/suspend, sessions, security log + CSV exports, registration/maintenance switches, watch-limit settings, app-ads settings (revision-checked), sources management, broadcasts
- **SEO:** canonical URLs with slug (`title-tmdb_id`), sitemaps, IndexNow tool, breadcrumbs/JSON-LD, blog/help/FAQ/legal pages

### Android app
- Home/Search/Details/Watch (ExoPlayer + libVLC), Live TV & VOD, Reels, Downloads (private vault + PIN), Profiles, Plans
- Unity-only ads (banner/interstitial/rewarded) + server-verified reward points
- In-app updater (same-origin HTTPS APK + SHA-256 + signature preflight)
- Access guard (VPN/filtering-DNS detection), offline policies, hardened WebView
- GA4 analytics (Measurement Protocol), OneSignal-style notification icon assets

## Tech stack

| Layer | Tech |
|---|---|
| Server | Node.js ≥22, Express 4.21, express-session + express-mysql-session (custom resilient subclass) |
| Templates | Twing 7.3 (PHP Twig syntax: named args, Elvis `?:`, `session.get()`, `|json_str`) |
| DB | mysql2 3.24 (parameterized), transactions + GET_LOCK, schema migrations v25 |
| Crypto | Node crypto — PBKDF2-SHA256 (600k), AES-256-GCM (HKDF), HMAC tokens, TOTP |
| Mail | nodemailer (SMTP) + Brevo/Resend HTTPS APIs |
| Frontend | Twig HTML + Tailwind (bundled), Chart.js, QRCode, ColorThief, hls.js, dash.js, mpegts.js, DPlayer, Font Awesome |
| Android | Java 17, AGP 8.10.1, Gradle 8.11.1, Media3 ExoPlayer, libVLC 3.7.7, Unity Ads 4.21.0, OkHttp |
| Tools | `migrate-env.js` (env.js→.env), `indexnow.js` (manual SEO submit) |

## Repository structure

```
cineamit2.0/
├── .gitignore / .gitattributes
├── docs/                          ← ye documentation (analysis ke baad add kiya gaya)
├── cineamit-node/
│   ├── server.js                  # 409 lines — Express bootstrap + dispatcher
│   ├── package.json               # v16.0.16, engines node>=22.12
│   ├── .env.example               # config template (dotenv format)
│   ├── src/                       # 34 modules (~13k lines)
│   │   ├── routes/                # auth.js, main.js, player.js, party.js
│   │   └── ...
│   ├── templates/                 # 53 Twig HTML files
│   ├── static/                    # css/js/icons + vendor libs
│   ├── tools/                     # migrate-env.js, indexnow.js
│   ├── vendor/locutus-compat/     # PHP function shim (range/strings/array/url/math)
│   └── data/app/                  # runtime data dir (gitignored)
└── cineamit-android/
    ├── settings.gradle.kts, gradle.properties, gradlew
    ├── README.md                  # release notes + integration guide
    └── app/src/main/
        ├── java/in/cineamit/app/  # 45+ Java classes (~11k lines)
        │   ├── data/ ui/ widget/  # helpers, UI fragments, widgets
        └── res/                   # layouts, drawables (4 densities), fonts, menus
```

## Release history (READMEs se)

| Version | Highlights |
|---|---|
| Node 16.0.16 | TMDB TLS fail-closed, homepage macro escaping, provider-page title fixes, OAuth origin validation, IndexNow dedupe |
| Node 16.0.15 | env.js → .env migration (`tools/migrate-env.js`) |
| Node 16.0.13 | Owner/profile-scoped playlists, password-bound 2FA, kids certification, fail-closed OAuth/site-status |
| Node 16.0.12 | Watch quota daily-unlock model, fullscreen fix, session-reset fix, TiDB startup fix |
| Node 16.0.6–7 | App Ads operations (Unity reward health, caps, cooldown), exports |
| Android 1.0.75 | Embed playback fixes (provider client, popup rejection, retry/recovery) |
| Android 1.0.74 | Secure cookie mirroring, adult-only 2FA confirm, kids offline restrictions |
| Android 1.0.73 | App Ads diagnostics (bounded, memory-only telemetry) |
| Android 1.0.72 | Security hardening (HTTPS-only, cert rejection, WebView lockdown, verified updates) |

## Quick start (see 03-SETUP-AND-DEPLOYMENT.md for details)

```bash
cd cineamit-node
cp .env.example .env        # fill DB_*, TMDB_API_KEY, SECRET_KEY (32+ chars)
npm ci && npm start         # http://0.0.0.0:3000
# First owner: set OWNER_BOOTSTRAP_KEY in .env → register at /register with that key
```
