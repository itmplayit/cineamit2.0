# Android App — CineAmit (1.0.75 / code 75)

Native **Java + XML Views** client for the CineAmit Node backend. Package `in.cineamit.app`, minSdk 24, target/compileSdk 36, AGP 8.10.1, Gradle 8.11.1, JDK 17.

## 1. Screens & features

| Screen | Class | Behavior |
|---|---|---|
| Splash | `SplashActivity` | Launcher; update check; access guard |
| Login | `LoginActivity` | `/login` JSON; TOTP step-up; remember me |
| Profiles | `ProfilesActivity` | Profile select/create; kids; PIN |
| Home | `MainActivity` | Hero + rails from `GET /home` JSON |
| Search | `SearchActivity` | `GET /search?q=` |
| Details | `DetailsActivity` | `GET /details/{type}/{id}` — seasons, cast, similar |
| Watch | `WatchActivity` | `GET /watch/{type}/{id}` guest-friendly; `/api/secure_play` tokens only |
| Player | `PlayerActivity` | Media3 ExoPlayer + libVLC 3.7.7 fallback |
| Live TV | `LiveActivity` | Login-required; `/api/live_stream/{token}` |
| VOD series | `VodSeriesActivity` | Movies/Series/Anime from M3U/Xtream/Stalker |
| Reels | `ReelsActivity` | Short-form feed |
| Downloads | `DownloadsActivity`, `DownloadWebActivity`, `DownloadService` | Private vault + PIN (OTP-verified); indexed-file admission |
| Plans | `PlansActivity` | Trial/Monthly/Yearly (server-configured) |
| Info/Page | `InfoActivity`, `PageActivity` | Help, privacy, settings |
| Access block | `AccessBlockedActivity` | VPN/filtering-DNS detected |

## 2. Backend contract

- Same website routes with `Accept: application/json` / `X-Cine-Client: app`; cookies via `JavaNetCookieJar`
- Wallet/rewards: authenticated `/api/app/wallet/*` aliases
- Full route list: [04-API-REFERENCE.md](04-API-REFERENCE.md) §7
- Server URL: build-time `DEFAULT_BASE_URL` (`https://cineamit.qzz.io` in source) or in-app More → Base URL (SharedPreferences `base_url`)

## 3. Build & config

```properties
# gradle.properties (Unity-only ads — ALL must be explicit)
UNITY_ENABLED=true
UNITY_TEST_MODE=false
UNITY_GAME_ID=800377017
UNITY_BANNER_PLACEMENT=BP_Banner_Android
UNITY_INTERSTITIAL_PLACEMENT=BP_Interstitial_Android
UNITY_REWARDED_PLACEMENT=BP_Rewarded_Android
```
- Config resolver (`resolveCineAdsConfig` in `app/build.gradle.kts`) validates + fingerprints config; conflicting declarations fail the build (values never printed)
- Debug ads build: `gradlew :app:assembleDebug -PUNITY_TEST_MODE=true`
- Diagnostics: `gradlew :app:printAdsConfig`; Logcat tag `CineAds`
- Universal native libs compressed — 90-MB in-app updater contract
- **Sign releases with the production key** — source/debug validation ≠ Play Protect clearance

## 4. Ads (Unity-only since 1.0.73)

- Direct Unity Ads SDK 4.21.0 — no AdMob/LevelPlay/mediation (all removed)
- Contextual by default; personalized consent never auto-granted; no startup privacy popup
- Suppressed for: Kids profiles, premium/trial (app-managed ads off), remote flags
- Rewarded points: **SDK completion never credits** — Unity S2S to server (`/api/rewards/unity`), HMAC-verified, daily cap 1000 pts + 60s cooldown (server-side)
- Provider in-video ads not guaranteed removable (documented honest limitation)

## 5. Security hardening (1.0.72+)

| Control | Implementation |
|---|---|
| HTTPS-only | `usesCleartextTraffic=false`; `WebSecurity.requireHttps` |
| Invalid certs | Rejected — no insecure fallback (HTTP/cert-error providers blocked) |
| WebView lockdown | `WebSecurity.harden`: file access off, safe browsing, limited JS, blocked schemes |
| Cross-origin API | `requireAppRequest` pins API host to configured base |
| Updates | `UpdateVerifier`: same-origin HTTPS + SHA-256 checksum + package/version/signing match; ≤90 MB; system installer remains verifier |
| Backup | `allowBackup=false` |
| Cookie mirroring | Secure cookie mirror for WebView flows (1.0.74) |

## 6. Access guard & offline (retained)

- `AccessGate`/`AdGuardDns`: OS-reported VPN or supported filtering Private DNS → ad-free blocking screen (settings/retry/privacy/exit)
- Ordinary offline/ad errors/no-fill do **not** block
- Unsupported blockers not guaranteed detectable (client-side best-effort)
- `OfflinePolicy`: persisted Kids offline restrictions; private-vault admission

## 7. Embed playback (1.0.75)

- Shared provider client; safe popup rejection; dead renderers disposed (no WebView reuse)
- Bounded main-frame navigation; sanitized diagnostics
- Native Retry + next-server recovery; stale resolver/end callbacks ignored
- Premium/trial disables app-managed Unity ads

## 8. Testing status (README se)

- 13 focused Robolectric tests + debug/release Java compilation passed (1.0.73 era)
- Full debug APK packaging exceeded test-sandbox memory — **no APK shipped in repo**
- No Play Console / Protect / device claims in source validation
- Validate own release APK + Unity callbacks in staging

## 9. Files map

```
app/src/main/java/in/cineamit/app/
├── CineAmitApp.java          # app init, base URL, analytics
├── Io.java                   # OkHttp, cookies, JSON
├── WebSecurity.java          # HTTPS/WebView policy
├── UpdateVerifier.java       # APK checksum/signature preflight
├── AppUpdate.java            # in-app updater
├── Ads.java / UnityDirect.java / UnityPrivacy.java / AdLoadState.java / AdDiagnostics.java
├── AdBlock.java / AdGuardDns.java / AccessGate.java / AccessBlockedActivity.java
├── PlayerActivity.java (1151 lines) / WatchActivity.java (1039)
├── DownloadService/DownloadCatch/DownloadsActivity/DownloadWebActivity
├── RewardClaims.java / Sub.java / AppScreens.java / Analytics.java
├── data/ (models) · ui/ (fragments) · widget/ (views)
```
