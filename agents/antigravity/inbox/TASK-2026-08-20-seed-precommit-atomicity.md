# Task: Phase 2.4.1 — Atomic Snapshot + Seed Commitment Binding

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** CRITICAL (fairness / concurrency)  
**Date:** 2026-08-20  
**Base SHA:** `78151572bd2ae01645d70a0768c6ece517e2cab0`

## Scope
1. Enforce strict single-lock invariant: `createAndLockSnapshot` only transitions `READY` → `SNAPSHOT_LOCKED`. Any request on already locked/drawn giveaway yields 409 CONFLICT.
2. Extend `createAndLockSnapshot` repository interface and implementations (`MemoryGiveawayRepository` and `PrismaGiveawayRepository`) to atomically generate `seed`, compute `seedCommitment = sha256(seed)`, update DB, and return `{ snapshot: ParticipantSnapshotData; seedCommitment: string }`.
3. Eliminate secondary `getById` read in `POST /api/giveaways/[id]/snapshot`. Use returned `seedCommitment` directly.
4. Concurrency regression tests (memory & API):
   - Multiple concurrent snapshot requests: exactly 1 succeeds, others get 409.
   - Snapshot count strictly 1, seed commitment matches persisted seed.
   - Idempotency replay returns cached commitment without generating new seed.
   - Post-draw verification `sha256(seedUsed) === seedCommitment`.
5. Run full gate: `npx prisma generate`, `npm test`, `npm run lint`, `npm run build`.
6. Output report in `agents/antigravity/done/TASK-2026-08-20-seed-precommit-atomicity.md`.
