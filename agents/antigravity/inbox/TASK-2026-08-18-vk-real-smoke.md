# Task: Phase 2.4 — Real VK Smoke Test Gate

**Status:** IN PROGRESS
**Assigned to:** Antigravity (@orchestrator)
**Date:** 2026-08-18
**Base Commit:** `9927e74`

## Scope
1. Pre-flight configuration check (APP_BASE_URL, VK_REDIRECT_URI, VK_APP_ID, VK_CLIENT_SECRET, VK_SERVICE_TOKEN, TOKEN_ENCRYPTION_KEY, AUTH_SECRET).
2. Secret hygiene check on git tracked files.
3. Baseline verification (`npm test`, `npm run lint`, `npm run build`).
4. Database & schema readiness check.
5. VK App & live contract verification.
6. Execution of smoke test stages:
   - OAuth login & session verification
   - Public post preview & effectiveCapabilities truthfulness
   - Giveaway creation under authenticated organizer
   - Real participant import & pagination
   - Like + comment deduplication
   - Subscription check
   - Controlled SERVICE -> USER fallback
   - Snapshot creation & participant hashing
   - Random draw execution & idempotency
   - Public audit verification
   - Token refresh & identity binding check
   - Token leak scan
   - Logout / login user binding
   - Restart behavior & multi-instance guard
7. Update `docs/VK_ID_LIVE_CONTRACT.md` and create `docs/VK_REAL_SMOKE_RESULT.md`.
8. Final verdict and move to `agents/antigravity/done/`.
