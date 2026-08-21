# Task 06: Публичная проверяемость розыгрыша

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (product claim alignment)  
**Date:** 2026-08-21  
**Base SHA:** `1a27a10847fe510f0ed0f128087271f78a489c7b`

## Scope
1. Implement public read-only giveaway result endpoint `GET /api/giveaways/[id]/public`:
   - Publicly accessible without session.
   - Bounded by anonymous rate limiting (`expensiveApiRateLimiter.assertAllowed('giveaway-public-get:' + clientIp + ':' + id)`).
   - Exposes safe public information:
     * Post metadata & snapshot `filterRules`
     * `participantsSnapshotHash`, `conditionsHash`, `algorithmVersion`
     * `seedCommitment` — both BEFORE and AFTER the draw
     * After `DRAWN`: `seed` (revealed only once finalized), `deterministicProofHash`, `auditEventHash`, winners & reserve winners (public winner names & IDs)
     * Before `DRAWN`: `seed === null` (strictly masked)
     * Zero private PII: full eligible/excluded participants list is omitted to protect third-party privacy
     * Zero credential/token/internal organizer metadata
2. Update public giveaway view page `src/app/giveaways/[id]/page.tsx`:
   - Works seamlessly for unauthenticated visitors by fetching from `/api/giveaways/[id]/public`.
   - Displays post information, winners, seed pre-commitment SHA-256, proof hash, and mathematical verification state.
3. Update `README.md` and `docs/ARCHITECTURE.md` to document the Provably Fair model honestly and explicitly:
   - What is independently verifiable by external observers (seed pre-commitment binding, draw execution reproducibility from snapshot hash + seed).
   - What remains unverifiable externally without raw PII (external observers cannot re-compute `participantsSnapshotHash` without the full raw participant list, and the server DB holds the proof without external decentralized timestamping/blockchain anchor).
4. Create test suite `tests/public-verification.test.ts`:
   - Anonymous user retrieves public results for `DRAWN` giveaway.
   - Anonymous user does not receive `seed` on non-`DRAWN` giveaway (`seed === null`).
   - `seedCommitment` is visible before draw and equals `sha256(seed)` after draw.
   - Anonymous user still receives `401 Unauthorized` on private `GET /api/giveaways/[id]`.
   - Zero private participant PII or tokens in public response.
5. Verification gate & report in `agents/antigravity/done/TASK-2026-08-21-06-public-verification.md`.
