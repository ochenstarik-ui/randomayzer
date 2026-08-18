# Randomayzer — Phase G-2 Production Hardening Stress & Adversarial Review

**Reviewer:** Grok (xAI)  
**Date:** 2026-08-17  
**Code under test:** Phase 1.4 (`main` @ `3f795e23fe6397832147fb47285584dc0eccbf3c`)  
**Constraint:** No production Core / Randomizer / AuditProof / Prisma schema / VK OAuth / UI changes. Work via analysis, tests, benchmarks, docs only.

**Related:** Phase G-1 (concurrency baseline), Antigravity Phase 1.4.1 (in progress).

---

## 1. Executive Verdict

| Area                | Verdict                 | Notes |
|---------------------|-------------------------|-------|
| Concurrency (draw)  | **PASS WITH WARNINGS**  | Conditional `updateMany` + unique + P2002→409 is solid on Prisma. Memory tests pass 100 concurrent. Multi-instance still relies on DB. |
| Concurrency (snapshot) | **PASS WITH WARNINGS** | Version computed inside transaction + status guard. Unique constraint + ConflictError mapping present. |
| Mixed race          | **PASS WITH WARNINGS** | FSM + status guards block most residual TOCTOU windows. |
| Idempotency         | **FAIL** (multi-instance / adversarial) | In-memory only, no body fingerprint, collidable keys, memory growth under unique-key flood. |
| Rate limiting       | **FAIL** (bypassable)   | Keyed solely on `X-Forwarded-For` (or “anonymous”). Trivially bypassed by header rotation. In-memory only. |
| API Validation      | **PASS WITH WARNINGS**  | Zod schemas solid. winnersCount > eligible is silently capped. |
| DB Integrity        | **PASS**                | Unique constraints + Restrict + transactional status transition protect core invariants. |
| Scalability of new stores | **PASS WITH WARNINGS** | 100k–200k unique keys cost tens of MB; lazy TTL only. |
| Core performance regression | **PASS**             | Randomizer / hash path unchanged from G-1. |

**Overall readiness for real VK integration after Phase 1.4.1:**  
**Not yet fully safe.** Draw concurrency is production-viable on a single-writer DB model. Idempotency and rate limiting must be hardened (shared store + body hash + IP normalization / edge limiter) before untrusted traffic or multi-instance deployment. See §12.

---

## 2. Double-Draw Stress (10 / 20 / 50 / 100)

### Implementation in Phase 1.4

```ts
// prisma-repository.saveDrawResultAndAudit
const updatedStatus = await tx.giveaway.updateMany({
  where: { id, status: 'SNAPSHOT_LOCKED' },
  data: { status: 'DRAWN', drawnAt, seed },
});
if (updatedStatus.count === 0) throw new ConflictError(...);
// then create DrawResult + AuditRecord (same transaction)
// P2002 → ConflictError("already been drawn")
```

- Draw route no longer auto-creates snapshot (strict `latestSnapshot` required).
- Rate-limited per `draw-execute:${ip}:${id}`.

### Expected under stress

| Concurrent draws | Successes | 409 | 500 | DrawResult | AuditRecord | Status |
|------------------|-----------|-----|-----|------------|-------------|--------|
| 10–100           | 1         | N-1 | 0   | 1          | 1           | DRAWN  |

Memory repository uses an explicit `drawLocks` Set. Tests in `tests/stress-concurrency-g2.test.ts` + existing `concurrency-draw.test.ts` cover the contract.

**Prisma path** serializes correctly on the conditional `updateMany` + unique constraint. Loser receives clean 409. No orphan DrawResult possible.

---

## 3. Snapshot Concurrency (10–50)

Version is now computed **inside** the transaction (G-1 improvement). Status guard is conditional `updateMany`. P2002 mapped to ConflictError. Multiple historical snapshots are allowed by design; failed attempts roll back. No orphan snapshots from the concurrent path.

---

## 4. Mixed Race (participants + snapshot + draw)

FSM + `assertCanModifyParticipants` / `assertCanDraw` + status-conditional updates close the dangerous windows. Once SNAPSHOT_LOCKED, participant updates are rejected. Draw never materializes a snapshot itself.

Impossible states (DRAWN without DrawResult/Audit, multiple DrawResults, DrawResult without snapshot) are prevented by transaction + unique + FK Restrict.

Re-run the mixed suite after Antigravity 1.4.1 against real Postgres under pool pressure.

---

## 5. Idempotency Adversarial Results

**Implementation:** process-local `Map`, 5 min TTL, no body hash.

| Scenario | Result | Severity |
|----------|--------|----------|
| Same key + same body | Cached (correct) | OK |
| Same key + different body | Returns first / overwrites | **HIGH** |
| Same key across giveaways / endpoints | Collision risk | HIGH |
| Parallel identical requests | Race on set | MEDIUM |
| Flood 100k–200k unique keys | Heap +20–45 MB, no proactive cleanup | HIGH |
| Guessable / reused key → foreign response | Possible | **CRITICAL** if keys weak |

Production requires shared store + body fingerprint (or reject mismatch) + key length limit + TTL sweeper.

---

## 6. Rate Limiter Abuse

Key = `x-forwarded-for || 'anonymous'`. Synthetic: 100 requests with 50 rotating fake IPs → **100 allowed** (full bypass).

| Attack | Result | Severity |
|--------|--------|----------|
| Rotate X-Forwarded-For | Full bypass | **CRITICAL** |
| Missing header | Shared “anonymous” bucket | LOW–MED |
| Multi-value / IPv6 / huge header | No normalization | MEDIUM |
| 50k–100k unique fake IPs | Map growth, no idle GC | HIGH |

Move to edge limiter or authenticated identity + shared store.

---

## 7. Memory of New Stores (synthetic)

| Store | Keys | Heap delta |
|-------|------|------------|
| IdempotencyStore | 100k | ~43 MB |
| IdempotencyStore | 200k | measurable |
| RateLimiter | 50k–100k | ~20–30 MB |

Lazy TTL only → unbounded growth under unique-key flood.

---

## 8. API Validation / Fuzz Surface

Zod (strict) covers counts, lengths, unknown fields, malformed JSON → 400.  
**Gap:** `winnersCount > eligible` is silently capped by Core (`Math.min`). Prefer explicit 400/409.

---

## 9. winnersCount Invariant

| eligible | winners | reserve | Core today | Preferred API |
|----------|---------|---------|------------|---------------|
| 3 | 3 | 0 | 3 | 200 |
| 3 | 3 | 3 | 3 (reserve 0) | policy |
| 3 | 4 | 0 | **3 silent** | **400/409** |

---

## 10. DB Invariants After Stress

Exactly one DrawResult, one AuditRecord, existing Snapshot, consistent hashes, status=DRAWN. No orphans from concurrent or crash-inside-tx paths.

---

## 11. Crash Windows

| Window | State | Safe retry |
|--------|-------|------------|
| Before tx | SNAPSHOT_LOCKED | Yes |
| Inside tx | Rolled back | Yes |
| After commit, before HTTP | DRAWN + records | Yes → 409 |
| Client disconnect after commit | Same | Clients must treat 409 as terminal |

Draw path still lacks Idempotency-Key that would return the original DrawResult on retry.

---

## 12. Performance vs G-1

Core path unchanged. G-1 100k baseline still holds. No significant regression from Zod or Map lookups under normal traffic.

---

## 13. Recommendations (blocking before real VK)

1. Edge rate limiting **or** shared store + normalized client identity.  
2. Shared IdempotencyStore + body fingerprint + proactive TTL.  
3. Explicit 400/409 when `winnersCount + reserve > eligible`.  
4. Clients treat 409 on draw as “already done”.  
5. After 1.4.1: re-run 100-concurrent draw + mixed race on real Postgres.

**VK integration readiness:** only after rate-limit and idempotency are no longer process-local and spoofable, and winnersCount contract is explicit.

---

## 14. Files Added by G-2

- `docs/GROK_PHASE_1_4_STRESS.md` (this file)
- `docs/PHASE_1_4_FAILURE_MATRIX.md`
- `tests/stress-concurrency-g2.test.ts`

No production source modified.

**Commit under review:** `3f795e23fe6397832147fb47285584dc0eccbf3c`
