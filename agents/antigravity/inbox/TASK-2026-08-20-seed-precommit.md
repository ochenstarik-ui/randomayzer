# Task: Phase 2.4 — Seed Pre-Commit Gate (Seed Grinding Elimination)

**Assigned to:** Antigravity
**Priority:** CRITICAL (fairness)
**Date:** 2026-08-20
**Base SHA:** `9927e74421223135a170de640255803ab513fd48`

## Scope
1. Remove client-provided `seed` from `executeDrawSchema` (strict schema -> 400 on client seed).
2. Remove client-provided `seed` from `createGiveawaySchema` and creation inputs.
3. Fix seed generation inside `createAndLockSnapshot` / `POST /api/giveaways/[id]/snapshot` using CSPRNG (`generateCryptoSecureSeed`) and persist in `Giveaway.seed` atomically with snapshot creation.
4. Update `POST /api/giveaways/[id]/draw` to strictly read seed from DB (`giveaway.seed`). Fail with `409 Conflict` if seed is not pre-committed.
5. Hide `seed` before `DRAWN` status:
   - Compute `seedCommitment = sha256(seed)`.
   - `POST /api/giveaways/[id]/snapshot` returns `seedCommitment`, not raw `seed`.
   - `GET /api/giveaways/[id]` masks `seed` with `null`/omitted before `DRAWN`, providing `seedCommitment`.
   - Ensure `GET /api/giveaways` and other routes do not leak raw `seed`.
6. Update UI in `src/app/giveaways/new/page.tsx` to remove manual seed input and display `seedCommitment`.
7. Add adversarial / grinding regression tests in `tests/seed-precommit-gate.test.ts`.
8. Ensure all existing 273 tests pass, lint passes, build passes.
