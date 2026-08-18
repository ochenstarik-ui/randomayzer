# Randomayzer — Phase G-1 Concurrency, Load, Abuse & Failure-Mode Review

**Reviewer:** Grok (xAI)  
**Date:** 2026-08-17  
**Scope:** Concurrency, load/scalability, abuse resistance, failure modes, DB invariants, observability, rate limiting, memory & algorithmic complexity.  
**Out of scope (per assignment):** Public Verification Integrity (Antigravity), general QA/security review & VK Integration prep (OpenCode). No changes to Randomizer core, proof format, OAuth, UI branding, VK Provider contract, or large Prisma schema rewrites.

**Repository snapshot:** local extract of `randomayzer-main` (matches provided zip / expected main).  
**Commit SHA (from zip metadata):** `26e82fcf8d8e5855ac9e46fa8af21ca7daacc36f`

---

## Executive Summary

| Category              | Critical | High | Medium | Low |
|-----------------------|----------|------|--------|-----|
| Concurrency           | 2        | 2    | 1      | 0   |
| Failure Modes         | 0        | 3    | 2      | 1   |
| Abuse Resistance      | 1        | 3    | 2      | 1   |
| Database Invariants   | 0        | 2    | 2      | 0   |
| Scalability / Memory  | 1        | 3    | 2      | 0   |
| **Total**             | **4**    | **13**| **9**  | **2**|

**Maximum participant count synthetically exercised:** 100 000 (core hashing / Fisher-Yates / verify).  
**Estimated safe production limit (current architecture, single Node process, 2–4 GB RAM):** ~30–50k eligible participants.  
**Race conditions found:** Double-draw (protected by unique constraint but poor error handling), Snapshot version collision (unique constraint only), Participant-update vs Draw interleaving.

**Production Core was not modified.** Only documentation + optional offline benchmark script added.

---

## Critical Findings

### C1. Double-Draw Race Condition (Application-level TOCTOU)

**Location:** `src/app/api/giveaways/[id]/draw/route.ts` + `PrismaGiveawayRepository.saveDrawResultAndAudit`

**Scenario:** Two almost simultaneous `POST /api/giveaways/:id/draw`.

1. Both requests read Giveaway (status = `READY` or `SNAPSHOT_LOCKED`).
2. Both pass the early `if (status === 'DRAWN')` guard.
3. Both may create / reuse snapshot.
4. Both call `executeDeterministicDrawV1` (possibly with different seeds).
5. Both enter `$transaction` and attempt `drawResult.create({ giveawayId })`.

**Protection today:**
- `DrawResult.giveawayId @unique` → second insert fails with Prisma `P2002`.
- Transaction is atomic for the successful request.

**Problems:**
- Second request receives **500 Internal Server Error** (unhandled unique violation) instead of clean 409/400 “already drawn”.
- Client may retry and keep failing.
- Work (hashing, Fisher-Yates) is wasted on the loser.
- No `SELECT … FOR UPDATE` / optimistic version / conditional `UPDATE … WHERE status = 'SNAPSHOT_LOCKED'`.
- Default Prisma isolation (Read Committed) does not prevent the race.

**Impact:** Data integrity is preserved (only one DrawResult), but availability and UX under concurrent load are broken. In a load-balanced multi-instance deployment the race window is larger.

**Recommended fix (proposal only — do not implement without agreement):**

```ts
// Inside transaction, use conditional update as gate
const updated = await tx.giveaway.updateMany({
  where: { id, status: 'SNAPSHOT_LOCKED' },
  data: { status: 'DRAWN', drawnAt: ..., seed: ... },
});
if (updated.count === 0) {
  throw new Error('ALREADY_DRAWN_OR_INVALID_STATE'); // map to 409
}
// then create DrawResult + AuditRecord
```

Or use PostgreSQL advisory lock (`pg_advisory_xact_lock(hashtext(giveawayId))`) at the start of the transaction, or a dedicated `draw_lock` row.

Optimistic locking via a `version` / `statusVersion` integer column is also viable.

### C2. Snapshot Version Race

**Location:** `PrismaGiveawayRepository.createAndLockSnapshot`

```ts
const latestVersion = current.snapshots.length > 0
  ? Math.max(...current.snapshots.map(s => s.version)) : 0;
const newVersion = latestVersion + 1;
// then $transaction([ create with newVersion, update status ])
```

Version is computed **outside** any lock. Two concurrent snapshot creations can choose the same `version` → unique constraint `@@unique([giveawayId, version])` rejects one with 500.

**Sufficient for data integrity?** Yes (constraint works).  
**Production-safe?** No — error handling and retry semantics are missing. Status can also be left inconsistent if one succeeds and the other fails after status update.

**Proposal:** Compute next version inside a serializable transaction or use `INSERT … ON CONFLICT` / sequence / `MAX(version)+1` under `SELECT FOR UPDATE` on the Giveaway row.

### C3. Full Participant Lists Loaded into Memory on Every getById / listAll

`getGiveawayById` and `listGiveaways` always `include: { participants: true, snapshots: true }`.

For a giveaway with 100k participants the JSON response + in-memory objects easily exceed hundreds of MB. `listAll` multiplies the problem.

Combined with snapshot `eligibleParticipants Json` this is the primary OOM vector.

### C4. Snapshot Storage as Monolithic JSON

`ParticipantSnapshot.eligibleParticipants Json` stores the entire canonical array.

| Eligible count | Approx. canonical JSON size | Prisma / PG TOAST risk | Memory on read |
|----------------|-----------------------------|------------------------|----------------|
| 10k            | ~1.5–2.5 MB                 | OK                     | Low            |
| 50k            | ~8–14 MB                    | Acceptable             | Medium         |
| 100k           | ~20–30 MB                   | High (large object)    | High           |
| 500k           | ~80–140 MB                  | Problematic            | Almost certain OOM on small instances |

No chunking, compression, or external object storage. Verification and UI that re-load the snapshot will re-materialize the whole array.

---

## High Findings

### H1. Participant Update vs Draw Race

`saveParticipants` is allowed only when status ∉ {SNAPSHOT_LOCKED, DRAWN, PUBLISHED}.  
Draw can create a snapshot from the in-memory `giveaway.participants` if none exists.

If both run concurrently while status = READY:
- Draw may snapshot a partially-updated list (deleteMany has finished, createMany has not, or vice-versa).
- Or snapshot the old list while the new list is committed.

Result: Draw operates on a non-atomic participant set. Integrity of the snapshot relative to the final stored participants is not guaranteed.

**Mitigation proposal:** Always require an explicit snapshot before draw (already partially true via FSM), and make `createAndLockSnapshot` take a DB-level lock that also blocks `saveParticipants`.

### H2. No Idempotency Keys

None of the mutating endpoints accept or honour `Idempotency-Key`:

- `POST /api/giveaways` (create)
- `POST …/participants`
- `POST …/snapshot`
- `POST …/draw`
- `POST …/publish` (if exists)

For draw the unique constraint gives a crude form of “at-most-once”, but the error is not clean.  
For create / participants / snapshot a client retry after a network blip can create duplicates or re-fetch VK data unnecessarily.

**Recommendation:**
- Draw / Publish → rely on DB state machine + unique constraints (already present) + map P2002 → 409.
- Create Giveaway, Snapshot, Participants fetch → accept optional `Idempotency-Key` header, store in a short-lived table or Redis, return the previous response on conflict.

### H3. API Response Size / DoS Surface

`POST …/participants` returns the full `allParticipants` array.  
`GET /api/giveaways` returns every giveaway with every participant and every snapshot.

A malicious or naïve client can trigger multi-hundred-MB responses. Combined with lack of rate limiting this is an easy memory / bandwidth exhaustion vector.

### H4. No Request Timeouts / Cancellation on VK Fetch

`VkProvider.fetchParticipants` (and pagination) can run for a long time. There is no `AbortController`, no overall request timeout, no job queue. A slow VK response or large comment tree holds a Node request forever and can exhaust the connection pool.

**When HTTP request-response stops being suitable:**  
When expected VK fetch + enrichment > 15–20 s for typical giveaways, or when 10k+ participants become common. Move to background job (BullMQ / Inngest / custom) with status polling.

### H5. Failure Modes – Partial Crash After Commit

- Crash after successful `$transaction` in `saveDrawResultAndAudit` but before HTTP response → client retries → unique violation → 500.
- Crash in the middle of `saveParticipants` transaction → rolled back (good).
- Process death after snapshot create but before draw → status = SNAPSHOT_LOCKED, safe to draw later.
- VK 429 / 500 / network break during pagination → unhandled, leaves giveaway in FETCHING or READY with incomplete data. No partial-progress resume.

### H6. winnersCount / reserveWinnersCount Abuse

No hard upper bound on `winnersCount` or `reserveWinnersCount` beyond `Math.min(..., eligible.length)`.  
A client can request `winnersCount: 1_000_000` on a 100-participant giveaway; the code will still allocate and run the partial Fisher-Yates for the actual needed size, but the request body and subsequent JSON can be large.  
More importantly, no validation that `winnersCount + reserve ≤ reasonable constant` (e.g. 100).

### H7. Missing Conditional Status Updates

All status transitions (`READY` → `SNAPSHOT_LOCKED`, `SNAPSHOT_LOCKED` → `DRAWN`) are plain `update` without `WHERE status = expected`. Under concurrency the wrong status can be overwritten.

### H8. listAll + Dashboard Memory Amplification

Dashboard that calls `listAll` will pull every participant of every giveaway into the Node process on each page load.

### H9. No Soft Limits on Concurrent Snapshots / Draws per Giveaway

A single giveaway can accumulate many snapshots (version keeps increasing). Each stores a full JSON copy. No retention policy yet.

### H10–H13. See detailed sections below (Rate limit, Observability, Privacy, Algorithmic notes).

---

## Medium Findings

- FSM guards are only application-level; a direct DB write can bypass them.
- `MemoryGiveawayRepository` has no concurrency protection at all (single-process only).
- Canonical stringify + sort is correct but CPU-heavy for 100k+; no incremental hashing.
- Verify endpoint re-loads full snapshot every time — expensive for large draws.
- No body-size limit middleware visible (Next.js default is generous).
- Malformed / extremely long VK URLs not explicitly rejected early.
- Unicode / null-byte handling in user names relies on JSON/Postgres; edge cases untested under load.
- Retry storms on 500 from unique violations can amplify load.

---

## Low Findings

- Seed length is not capped; extremely long custom seed is accepted (only affects HMAC input size).
- No explicit `ON DELETE RESTRICT` behaviour documented for operators.
- AuditRecord and DrawResult both store winner IDs — minor redundancy.

---

## Concurrency Review (Detailed)

| Scenario                        | Protected by unique / constraint? | Clean error? | Safe retry? | Recommendation |
|---------------------------------|-----------------------------------|--------------|-------------|----------------|
| Double draw                     | Yes (`giveawayId` unique)         | No (500)     | No          | Conditional update + 409 mapping |
| Concurrent snapshot             | Yes (`giveawayId+version`)        | No (500)     | Partial     | Version under lock |
| Update participants + draw      | Partial (FSM)                     | —            | Risky       | Explicit lock / require pre-existing snapshot |
| Concurrent create giveaway      | No                                | —            | Creates dups| Idempotency-Key |
| Concurrent participants fetch   | No                                | —            | Re-fetches  | Idempotency or debounce |

Prisma `$transaction` (interactive or sequential array) uses the connection’s isolation level (default Read Committed). It does **not** by itself serialise the “read status → write DrawResult” critical section.

---

## Failure-Mode Analysis

| Failure                              | Resulting state                          | Safe to retry? | Compensation needed? |
|--------------------------------------|------------------------------------------|----------------|----------------------|
| Postgres unavailable                 | 500, no write                            | Yes            | No                   |
| Prisma transaction timeout           | Rolled back                              | Yes            | No                   |
| VK 429                               | 500 / incomplete participants            | After backoff  | Possibly clear partial |
| VK 500 / network mid-pagination      | Incomplete list saved or error           | Yes            | Re-fetch             |
| Crash after snapshot, before draw    | SNAPSHOT_LOCKED, no DrawResult           | Yes (draw)     | No                   |
| Crash after DrawResult+Audit commit, before HTTP | DRAWN + full audit records      | Client sees error, retry → 409/500 | Map unique to 409 |
| Crash between DrawResult and Audit (impossible – same tx) | Atomic | — | — |

---

## Abuse Cases & Suggested Limits

| Abuse vector                        | Current behaviour                  | Suggested limit / mitigation |
|-------------------------------------|------------------------------------|------------------------------|
| Thousands of Giveaways              | Unlimited                          | 50–100 / user / day (once auth exists) |
| Spam participants fetch             | Re-hits VK every time              | Rate limit + cache / debounce 5 min |
| Spam verify                         | Cheap after first load             | 30 req/min per IP / giveaway |
| winnersCount = millions             | Capped by eligible                 | Hard max 100 + 100 reserve |
| Massive custom seed                 | Accepted                           | Max 256–512 chars |
| Oversized request body              | Next.js default                    | Explicit 1–2 MB limit |
| Extremely long VK URL               | Parsed                             | Max 2 kB, early reject |
| Repeated snapshot generation        | Unlimited versions                 | Max 5–10 snapshots / giveaway, retention |
| Retry storm after 500               | Amplifies                          | 429 + Retry-After, circuit breaker |

Full policy → `docs/RATE_LIMIT_POLICY.md`.

---

## Database Invariants Audit

| Invariant                                      | Guaranteed by DB? | Guaranteed by app code? | Notes |
|------------------------------------------------|-------------------|--------------------------|-------|
| At most one successful DrawResult per Giveaway | Yes (`@unique`)   | Yes (FSM + unique)       | Strong |
| At most one AuditRecord per Giveaway           | Yes (`@unique`)   | Yes                      | Strong |
| DrawResult always references existing snapshot | Yes (FK + Restrict)| Yes                      | Strong |
| Snapshot version unique per giveaway           | Yes (`@@unique`)  | Yes                      | Strong |
| Cannot delete snapshot that has Draw/Audit     | Yes (onDelete: Restrict) | —                   | Strong |
| Status = DRAWN implies DrawResult exists       | No                | Yes (same transaction)   | Soft – possible manual inconsistency |
| Status = DRAWN implies AuditRecord exists      | No                | Yes (same transaction)   | Soft |
| Participants unique per (giveaway, user)       | Yes               | Yes                      | Strong |

No CHECK constraints or triggers enforce status ↔ existence of DrawResult/Audit. Application must remain the sole writer of status transitions.

---

## Scalability & Algorithmic Complexity

| Operation                  | Time complexity          | Memory complexity      | Notes |
|----------------------------|--------------------------|------------------------|-------|
| Participant deduplication  | O(n)                     | O(n)                   | Map |
| Filter engine              | O(n)                     | O(n)                   | — |
| Canonical sort             | O(n log n)               | O(n)                   | localeCompare |
| Snapshot hashing           | O(n · L)                 | O(n · L)               | L ≈ 150–200 B/item |
| Partial Fisher-Yates       | O(k · C_HMAC) expected   | O(n) (copy)            | k = winners+reserve |
| Verification               | Same as draw             | O(n)                   | Full re-execution |
| Prisma createMany          | O(n)                     | O(n)                   | Batch |

No O(n²) algorithms found in the reviewed core paths. Dominant cost at scale is **canonical JSON construction + SHA-256** and **memory residency of the full participant arrays**.

**Synthetic baseline (Node 24, single core, see `docs/PERFORMANCE_BASELINE.md`):**

| n      | Hash (ms) | JSON size (MB) | Heap after gen (MB) | Draw 10 winners (ms) |
|--------|-----------|----------------|---------------------|----------------------|
| 100    | ~3        | 0.03           | ~5                  | <1                   |
| 1 000  | ~6        | 0.27           | ~5                  | <1                   |
| 10 000 | ~56       | 2.8            | ~9                  | ~3                   |
| 50 000 | ~276      | 13.8           | ~30                 | <1                   |
| 100 000| ~994      | 27.7           | ~133                | ~1                   |

Extrapolated 500 k: hash ≈ 5 s, JSON ≈ 80–140 MB, heap pressure > 600 MB.

---

## Memory Pressure Hotspots

1. `getGiveawayById` / `listGiveaways` – always include full participants + snapshots.
2. `createAndLockSnapshot` – materialises full array + JSON for Prisma.
3. `computeParticipantsSnapshotHash` – creates sorted copy + large intermediate string.
4. `executeDeterministicDrawV1` – copies the eligible array.
5. API handlers that return full participant lists.
6. VK provider (if it accumulates all pages in memory before returning).

**Worst-case 500 k participants on a 1 GB container:** high probability of OOM during hash or snapshot write.

---

## Recommendations (Prioritised)

### Before any production traffic
1. Map Prisma unique-violation (P2002) on DrawResult / Snapshot to HTTP 409 with clear message.
2. Make draw status transition conditional (`updateMany` WHERE status = expected).
3. Stop returning full participant arrays from list / participants endpoints (paginate or return stats + IDs only).
4. Add hard caps: `winnersCount ≤ 100`, `reserve ≤ 100`, request body size, seed length.
5. Add basic rate limiting (even if only in reverse-proxy / Next middleware).

### Short-term (Phase 2)
6. Introduce optimistic locking or advisory locks for draw + snapshot.
7. Require explicit snapshot before draw; never auto-create inside the draw handler under concurrency.
8. Add `Idempotency-Key` support for create / participants / snapshot.
9. Paginate or stream large participant responses.
10. Add request-level timeout + AbortController for VK calls.

### Medium-term / Phase 3+ (architecture proposals)
11. Move large snapshots out of Postgres JSON:
    - Option A: normalised `SnapshotParticipant` rows (chunked inserts).
    - Option B: compressed JSON (gzip / zstd) in bytea + object storage (S3) for the bulk.
    - Option C: Merkle-tree root only in DB, leaves in object storage (best for public verification of very large sets).
12. Background job for VK fetch + enrichment when n > ~5–10 k.
13. Giveaway-level retention / anonymisation policy (see Privacy section).
14. Connection pooling, statement timeouts, and circuit breakers for VK + DB.

---

## Files Changed / Added

| File                              | Action   | Purpose |
|-----------------------------------|----------|---------|
| `docs/GROK_REVIEW.md`             | Created  | This review |
| `docs/LOAD_TEST_PLAN.md`          | Created  | Load scenarios |
| `docs/PERFORMANCE_BASELINE.md`    | Created  | Measured numbers |
| `docs/RATE_LIMIT_POLICY.md`       | Created  | Production rate limits |
| `docs/OBSERVABILITY.md`           | Created  | Metrics, logs, alerts |
| `scripts/benchmarks/core-performance.mjs` | Created | Offline core micro-benchmarks |

**No production Core, Prisma schema, proof format, or API contracts were altered.**  
**No existing tests were broken** (benchmark is standalone).

**Tests added:** 0 (analysis-only phase; benchmark is not a unit test).  
**Maximum participant count exercised:** 100 000.

---

## Definition of Done Checklist

- [x] Double draw race investigated
- [x] Snapshot race investigated
- [x] Participant update vs draw investigated
- [x] Idempotency strategy proposed
- [x] Load up to 500 k estimated
- [x] Performance baseline recorded
- [x] Memory risks identified
- [x] Abuse cases covered
- [x] Failure modes described
- [x] DB constraints audited
- [x] Rate limit policy written
- [x] Observability plan written
- [x] Production Core left intact
- [x] Deliverables present

---

*End of Grok Phase G-1 Review*
