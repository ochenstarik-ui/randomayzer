# Task 08: Prisma Integration Test Harness

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (production storage driver coverage)  
**Date:** 2026-08-21  
**Base SHA:** `2da8b01b1b5491b0db491492ec039271d7855ead`

## Scope
1. Implement integration test suite for `PrismaGiveawayRepository` and `PrismaUserRepository` against PostgreSQL:
   - Atomic state transitions: `createAndLockSnapshot` (atomic seed + snapshot lock, single lock invariant, concurrent lock attempts with exactly 1 winner).
   - Atomic draw finalization: `saveDrawResultAndAudit` (transition `SNAPSHOT_LOCKED -> DRAWN`, P2002 duplicate prevention).
   - Atomic snapshot unlock: `unlockSnapshot` (transition `SNAPSHOT_LOCKED -> READY`, reset seed to null).
   - State guard: `saveParticipants` requires `READY`.
   - Ownership constraint: `onDelete: Restrict` on `Giveaway.organizerId`.
   - Pagination & counts: `getParticipantsPaginated`.
   - Record factual `eligibleCount` behavior under Prisma.
2. Separate test configuration & script in `package.json`:
   - `npm test` remains 100% executable without database (unit tests with memory repository).
   - `npm run test:integration` executes integration tests against `DATABASE_URL`.
   - If `DATABASE_URL` is not set or PostgreSQL is unreachable, fail-closed with explicit error/skip instructions rather than silent pseudo-green.
3. CI workflow update (`.github/workflows/ci.yml`):
   - Add integration test job against real postgres service with `prisma migrate deploy` (to verify actual Prisma migrations) and `STORAGE_DRIVER=prisma`.
4. Verification evidence & report in `agents/antigravity/done/TASK-2026-08-21-08-prisma-integration-harness.md`.
