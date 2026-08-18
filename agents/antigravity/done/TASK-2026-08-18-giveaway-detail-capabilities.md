# Task Done: Phase 2.3.1.1 — Giveaway Detail Capability Truthfulness

**Status:** DONE
**Assigned to:** Antigravity (@orchestrator)
**Date:** 2026-08-18
**Base Commit:** `4e4370d`

## Summary of Changes
- Implemented `getCredentialStatus(userId: string)` in `TokenRefresher` with exact states:
  - `AVAILABLE`: valid, non-expired USER access token present.
  - `REFRESHABLE`: expired or unknown expiry, but refresh token is present.
  - `REAUTH_REQUIRED`: expired or unknown expiry, without refresh token.
  - `MISSING`: no credentials stored for user.
- Updated `GET /api/giveaways/[id]` to query `defaultTokenRefresher.getCredentialStatus(sessionUser.id)` without performing network calls or leaking tokens into response.
- `resolveEffectiveCapabilities` assigns `accessMode: 'ORGANIZER_USER'` only when `status` is `AVAILABLE` or `REFRESHABLE`. For `MISSING` or `REAUTH_REQUIRED`, it strictly defaults to `PUBLIC_SERVICE`.
- Expanded `tests/effective-capabilities-truthfulness.test.ts` to 11 tests covering all credential states, expiration boundaries, refresh token presence, and token secrecy.
- All 273 tests passing across 47 test files (100% green).
