# Task 04: Разблокировка SNAPSHOT_LOCKED → READY

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (functional regression)  
**Date:** 2026-08-21  
**Base SHA:** `fb6ae616285aebe4ef6ac1436cd0861664f3ba0d`

## Scope
1. Implement `POST /api/giveaways/[id]/unlock` endpoint:
   - Security: `requireGiveawayOwner`, CSRF-guard, user-scoped rate limiting (`expensiveApiRateLimiter`), `Idempotency-Key` support.
   - Atomic state transition `SNAPSHOT_LOCKED` -> `READY`.
   - Rejects `DRAWN` and `PUBLISHED` states with `409 Conflict`.
2. Atomic repository transition `unlockSnapshot(id: string)` in both `MemoryGiveawayRepository` and `PrismaGiveawayRepository`:
   - Enforce condition `status: 'SNAPSHOT_LOCKED'`.
   - Reset `seed: null` in DB in the same atomic transaction.
   - Versioning strategy: keep historical snapshots with incrementing version (`version = max(version) + 1` upon next lock) or manage previous snapshot records cleanly.
3. Expose `GiveawayStore.unlockSnapshot(id)`.
4. Update UI: on Step 4 of the wizard (`src/app/giveaways/new/page.tsx`), add a button to unlock snapshot and return to Step 3 with filter adjustment.
5. Create regression and concurrency test suite `tests/snapshot-unlock.test.ts`:
   - Full cycle: lock -> unlock -> change rules -> lock -> draw.
   - Seed and commitment before and after unlock/re-lock are different (CSPRNG re-generated).
   - Unlock from `DRAWN` -> `409 Conflict`.
   - Unlock of another user's giveaway -> `403 Forbidden`.
   - Concurrent unlock requests: exactly 1 succeeds, remaining return `409 Conflict`.
6. Verification Gate:
   - `npm ci`, `npx prisma generate`, `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`.
7. Output report in `agents/antigravity/done/TASK-2026-08-21-04-snapshot-unlock.md`.
