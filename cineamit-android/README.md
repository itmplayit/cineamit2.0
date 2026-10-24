# CineAmit Android

> **Docs note:** Historical notes below reference private deep-dive documents that are not shipped in this repo (kept as bold text for context). Current analysis lives in [`../docs/`](../docs/).

Native **Java + XML Views** client for the **CineAmit Node** website backend.

This folder is an **Android Studio source project**. Open it in Android Studio and Build → Build APK(s) / Run.

The app talks to the **same website routes** as the browser (`/home`, `/details/…`, `/login`, …) with `Accept: application/json`. Wallet/reward operations also use authenticated `/api/app/*` aliases.

## Current release — 1.0.75 / code 75

**Premium/trial embed playback fixes**: shared provider client, safe popup rejection, subscription-independent dependency loading, bounded main-frame navigation, sanitized diagnostics and native Retry / next-server recovery. Dead renderers are disposed without reusing their WebView; stale resolver/end callbacks are ignored. Premium/trial still disables app-managed Unity ads. Provider cosmetic ad hiding remains, but provider in-video ads are not guaranteed removable; VIP-labelled servers remain free for everyone. Plans clarify this distinction.

Backend remains **Node 16.0.13 / schema 25**; no migration or server source update for this fix. Build and device-release limitations are recorded in the accompanying fix evidence/report. Validate your provider flows and production-signed update on a device.

## Previous release — 1.0.74 / code 74

**Full audit fixes**: secure cookie mirroring, structured daily-quota errors, password-confirmed adult-only 2FA, persisted Kids offline restrictions and final indexed-file/private-vault admission. Update metadata is preflighted before any required-update dialog, and failed/unavailable artifacts have a recovery close path. Free VIP servers, guest soft quota, independent Unity and server-only reward authority remain unchanged.

Project: compile/target SDK 36, AGP 8.10.1, Gradle 8.11.1, Java 17, stable libVLC 3.7.7. Universal native libraries stay compressed to fit the existing 90-MB updater contract. Validate your own release APK with the production signing key; source/debug validation is not device, Play Console or Protect clearance.

Deploy Node **16.0.13 / schema 25** with this release; no new schema migration. The older 1.0.73 telemetry release remains documented below.

## Previous release — 1.0.73 / code 73

Adds bounded, authenticated, memory-only init/load/show operational diagnostics for the owner’s App Ads panel and clear server admission-limit messages. This telemetry never credits points. Signed-in non-Kids accounts only; remote flag defaults OFF until bootstrap. Existing Unity-only/contextual privacy, security fixes, free VIP servers and in-app updater are retained.

Deploy **Node 16.0.6 / schema 25 first**. The server adds cap/cooldown, verified reward activity and transactional settings history; defaults are 1000 earned points/account/UTC day and 60 seconds between admitted attempts. Read **APP-ADS-DIAGNOSTICS.md** and the Node `APP-ADS-OPERATIONS.md`.

13 focused Robolectric tests plus debug/release Java compilation passed. Full debug APK packaging exceeded the test sandbox’s memory constraints; no new APK or production signing/device/Unity callback verification is claimed. Build and test the complete source with your existing production signing key.

## Security hardening — 1.0.72 / 72

****SECURITY-HARDENING.md**** covers SSL-certificate rejection, HTTPS-only app/provider networking, restricted WebViews and verified native update preflight. Native in-app updates remain available with same-origin HTTPS APK hosting, a mandatory checksum and matching package/version/signing metadata. Sign with your existing production key. This is not a promise that Play Protect/Xiaomi warnings or normal scan prompts disappear; the exact blocked Redmi APK still needs testing.

HTTP-only/invalid-certificate providers and off-origin APK links no longer get an unsafe fallback. Use working HTTPS endpoints/relays and the Node server's uploaded-APK facility. The 1.0.72 security fixes alone required no Node migration; the 1.0.73 diagnostics rollout requires the backend update described above.

## What you get

| Tab | Behaviour |
| --- | --- |
| **Home** | Hero + rails from `GET /home` (same bundle as the website) |
| **Search** | `GET /search?q=` |
| **Details** | `GET /details/{type}/{id}` — Play uses guest-friendly `GET /watch/{type}/{id}` |
| **TV & On Demand** | Live + Movies / Series / Anime from the same M3U / Xtream / Stalker sources. Login required. Play via `/api/live_stream/{token}` |
| **More** | Server URL, login/logout, studios & OTT providers |

Player is **Media3 ExoPlayer**. VOD play URLs are **tokens only** (`/api/secure_play?token=…`). Raw provider stream URLs are never sent to the app.

Guest **watch** (TMDB movies/shows) is allowed. **Live TV** still needs an account.

## Local access guard (retained from 1.0.72 / 72)

Active OS-reported VPN or supported active filtering Private DNS shows an ad-free blocking screen with settings/retry/privacy/exit. Ordinary offline, ad errors and no-fill do not block. Disable the detected setting to restart the app UI without clearing account/download data. Unsupported blockers/VPNs are not guaranteed detectable. Details, limitations and deployment: ****ACCESS-GUARD.md****.

## Ads — Unity only (1.0.73 / 73)

Current configuration, privacy policy, audit and validation: ****UNITY-ONLY-ADS.md****.

- Direct Unity Ads SDK 4.21.0. Public Game ID **800377017** and supplied `BP_*_Android` placements are already configured.
- AdMob SDK/IDs/manifest/UMP/inspector/provider rotation and backend Google verification are removed. No LevelPlay, mediation or second-provider fallback.
- `UNITY_TEST_MODE=false` is the shipped mode. Controlled test build: `gradlew.bat :app:assembleDebug -PUNITY_TEST_MODE=true`.
- Safe diagnostics: `gradlew.bat :app:printAdsConfig`; phone Logcat tag `CineAds`.
- No startup privacy popup or local ad on/off switch. Contextual ads are enabled by default, subject to metadata, current foreground, Kids/premium/remote switches and bounded lifecycle guards. Personalized consent is never auto-granted. Settings → Unity Ads privacy policy opens the policy on demand.
- Rewarded points require the compatible Unity-only backend; deploy **16.0.6/schema25** for this release, real Support-enabled Unity S2S and a server-only secret. SDK completion never credits. Delivered S2S is disabled until setup/staging verification.
- Direct-serving placement compatibility and live fill are not guaranteed by compilation or an active dashboard placement. No auction markup is fabricated.

Open the **complete new project** and preserve private signing settings; copying only its properties file into an old source tree will not remove the old SDK/build requirements. This delivery does not publish an APK.

## 1. Point the app at your Node server

**Option A — default at build time**

In `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "DEFAULT_BASE_URL", "\"https://your-real-domain.com\"")
```

No trailing slash. Use a valid, system-trusted **HTTPS** endpoint, including for device/LAN testing. Cleartext is disabled; old HTTP preferences/endpoints must be replaced or put behind a valid HTTPS relay. Do not disable certificate validation to make a test server work.

**Option B — inside the app**

More → **Base URL** → Save URL. Stored in SharedPreferences (`base_url`).

The Node process must serve the website (`cineamit-node`). JSON for the app is produced by wrapping those same routes when `Accept: application/json` (see `cineamit-node/src/web-json.js`). CSRF is skipped for JSON POSTs; cookies still carry the session.

## 2. Open in Android Studio

1. Android Studio **Ladybug or newer** (AGP **8.7.2**, compileSdk **35**, minSdk **24**). JDK **17**.
2. **File → Open** → this `cineamit-android` folder (the folder that contains `settings.gradle.kts`).
3. Let Gradle sync. Wrapper JAR + `gradlew` are included.
4. **Build → Clean Project**, then Run.

Package: `in.cineamit.app`.

## 3. Session / cookies

OkHttp uses `JavaNetCookieJar` + the process `CookieManager`, so `POST /login` session cookies are sent on later website routes, `/api/secure_play`, and `/api/live_stream` requests.

## 4. Website JSON (Node)

| Method | Path |
| --- | --- |
| GET | `/` (bootstrap) |
| GET | `/home` |
| GET | `/search?q=` |
| GET | `/details/{movie\|tv}/{id}` |
| GET | `/watch/{movie\|tv}/{id}?s=&e=` |
| GET | `/api/episodes/{id}/{season}` |
| GET | `/studios` · `/studio/{id}` |
| GET | `/providers` · `/provider/{id}/all` |
| GET | `/livetv` (auth) |
| GET | `/livetv?kind=movie\|series\|anime` (auth) |
| GET | `/livetv?series=` (auth) |
| POST | `/login` `username` / `login_id` `password` |
| POST | `/logout` |
| GET | `/movies` · `/series` · `/anime` · `/filter` |
| GET | `/watchlist` |
| POST | `/watchlist/add/{type}/{id}` |

Deploy the updated Node tree (`src/web-json.js`, no `app-api.js`) before installing the app against production.
