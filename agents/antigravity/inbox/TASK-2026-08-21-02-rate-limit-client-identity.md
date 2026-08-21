# Task 02: Client Identity for Rate Limiting

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** HIGH (availability)  
**Date:** 2026-08-21  
**Base SHA:** `92f6d1922500791ef221cc11ed63f606afc01b53`

## Scope
1. User-scoped rate limiting for authenticated routes (`/api/giveaways*`):
   - Scope rate limit key by `sessionUser.id` instead of IP (`draw:${sessionUser.id}:${id}`, `snapshot-lock:${sessionUser.id}:${id}`, `participants:${sessionUser.id}:${id}`, `giveaways:${sessionUser.id}`).
   - Order of execution: `requireAuthenticatedUser` / `requireGiveawayOwner` authenticates the request and extracts `sessionUser`, then user-scoped rate limiter runs. Unauthenticated requests fail with 401 immediately and cannot exhaust organizer rate limit buckets.
2. Anonymous route rate limiting (`/api/auth/vk/start`, `/api/posts/preview`):
   - When IP cannot be resolved (empty `req.ip` and `TRUST_PROXY !== 'true'`), use a dedicated anonymous fallback bucket (`anon:direct-client` or similar) separate from user buckets.
3. Production configuration guard & documentation:
   - In `docs/PRODUCTION_GUARDS.md`, document proxy configuration and IP resolution behavior.
4. Concurrency & Isolation tests in `tests/rate-limit-identity.test.ts`:
   - Two authenticated organizers with empty `req.ip` do not affect each other's rate limits.
   - Exhausting anonymous rate limit does not affect authenticated organizers.
   - Unauthenticated requests cannot bypass authentication or drain organizer limits.
   - Existing `TRUST_PROXY=true` behavior and tests remain green.
5. Verification:
   - `npm ci`, `npx prisma generate`, `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`.
6. Output report in `agents/antigravity/done/TASK-2026-08-21-02-rate-limit-client-identity.md`.
