# CineAmit 2.0 — Documentation Index

Ye `docs/` folder **cineamit2.0** repository ke liye complete technical documentation hai.
Ye docs 23 October 2026 ko deep code analysis + live smoke testing ke baad banaye gaye hain.

> Quick answer (Hinglish) ke liye: [SUMMARY-HINGLISH.md](SUMMARY-HINGLISH.md) padhein.
> Bugs/problems ki full list: [06-BUGS-AND-PROBLEMS.md](06-BUGS-AND-PROBLEMS.md)

## Documents

| # | File | Kya milta hai |
|---|------|---------------|
| 1 | [01-PROJECT-OVERVIEW.md](01-PROJECT-OVERVIEW.md) | Project kya hai, features, tech stack, versions, repo layout |
| 2 | [02-ARCHITECTURE.md](02-ARCHITECTURE.md) | Node backend + Android app architecture, request lifecycle, modules map |
| 3 | [03-SETUP-AND-DEPLOYMENT.md](03-SETUP-AND-DEPLOYMENT.md) | Install, `.env` config, DB migration, PHP se migrate, reverse-proxy, Android build |
| 4 | [04-API-REFERENCE.md](04-API-REFERENCE.md) | Saare web routes + Android JSON API endpoints, auth, errors |
| 5 | [05-DATABASE-SCHEMA.md](05-DATABASE-SCHEMA.md) | Schema v25 — tables, keys, retention/GC, migration notes |
| 6 | [06-BUGS-AND-PROBLEMS.md](06-BUGS-AND-PROBLEMS.md) | **Bugs, problems, risks** — severity ke saath (ye padhna zaroori hai) |
| 7 | [07-SECURITY-ANALYSIS.md](07-SECURITY-ANALYSIS.md) | Security controls ka audit — passwords, 2FA, CSRF, SSRF, XSS, rate-limit |
| 8 | [08-ANDROID-APP.md](08-ANDROID-APP.md) | Android client (1.0.75) — screens, ads, updates, security hardening |
| 9 | [09-DEEP-ANALYSIS-REPORT.md](09-DEEP-ANALYSIS-REPORT.md) | Deep analysis evidence: static review + live test results (sab logs) |

## Project versions (analyzed)

- **Node backend:** 16.0.16 / schema 25 (`cineamit-node/`)
- **Android app:** 1.0.75 / versionCode 75 (`cineamit-android/`)
- **Runtime verified on:** Node.js 20.20.2 + MariaDB (sandbox smoke test); production requirement Node.js **22.12+**

## Repo layout

```
cineamit2.0/
├── cineamit-node/          # Express + Twing (PHP-Twig compatible) website/backend
│   ├── server.js           # Entry point
│   ├── src/                # 34 modules (config, security, database, routes, ...)
│   ├── templates/          # 53 Twig HTML templates (original PHP templates)
│   ├── static/             # CSS, JS, icons, vendor libs (hls.js, dash.js, DPlayer...)
│   ├── tools/              # migrate-env.js, indexnow.js
│   ├── vendor/locutus-compat/  # PHP-function compat shim for Twing
│   └── data/app/           # runtime data (gitignored)
└── cineamit-android/       # Native Java + XML Views Android client
    └── app/src/main/java/in/cineamit/app/  # 45+ Java classes
```

## Analysis method (is analysis me kya kiya)

1. **Static review:** saare 70 JS source files, templates, Android manifest/Gradle/Java security classes
2. **Syntax check:** `node --check` — sab files pass
3. **Dependency audit:** `npm ci` + `npm audit` — **0 vulnerabilities**
4. **Live smoke test (MariaDB ke saath):** server boot, schema v25 migration, owner registration, login, admin RBAC, CSRF/cross-origin rejection, rate limiting, XSS reflection, JSON API auth, fail-closed behavior — sab run kiya gaya
5. **Findings:** [06-BUGS-AND-PROBLEMS.md](06-BUGS-AND-PROBLEMS.md) me document kiya gaya

---
*Ye docs informational hain — production deployment se pehle apne staging environment par zaroor test karein.*
