
---

## Fix Status (2026-10-24, restructure branch)

| ID | Status | Change |
|----|--------|--------|
| M1 | ✅ FIXED | 21 dead README doc-links unlinked (prose kept as bold); `../docs/` pointers added to both READMEs. `tools/migrate-env.js` tool confirmed present. |
| M2 | ✅ FIXED (conditional) | When `ADS_ENABLED=false`, CSP `script-src` no longer allows blanket `https:` — whitelist `cdn.tailwindcss.com` (fallback) + `googletagmanager.com` (GA4). Ads-on keeps current CSP (no ad feature break). Full nonce retrofit noted as future work. |
| L1 | ✅ FIXED | migration14 now checks `SHOW INDEX ... Key_name='uniq_wl_user_profile_tmdb'` before `ADD UNIQUE KEY` (same pattern as later migrations) — no more spurious fresh-install error log. |
| L2 | ✅ FIXED | Register: email/username duplicates share ONE generic message (anti-enumeration); `ER_DUP_ENTRY` (errno 1062) on the INSERT race now maps to the same message instead of "Database error". |
| L3 | ✅ FIXED | Web + app_login: locked account returns the exact wrong-password response (web: same flash; app: 401 `invalid_credentials` + `login_failed` security log). Timing dummy-hash kept. TOTP-stage 423s unchanged (post-password, no pre-auth oracle). Lock-out notification-by-email noted as future work. |
| L4 | ✅ FIXED | Home cache-validity now checks `<!-- cache-ok -->` marker rendered only when the `movies` row actually renders. NOTE: the old `Popular Movies` check matched the always-present footer link — it never failed; the new marker is a real fail-safe. |
| L5 | ✅ FIXED | `engines: >=20.12.0` (was `>=22.12.0`); `node:util.parseEnv` needs 20.12+. |

Regression: all 15 HTML pages byte-identical after fixes (register/login flash texts change only on the POST flows themselves).
