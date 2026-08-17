# Phase 1.4 Failure Matrix — Grok G-2

**Commit:** `3f795e23fe6397832147fb47285584dc0eccbf3c`  
**Date:** 2026-08-17

## Legend
- **Protected** = data integrity holds, clean client error
- **Degraded** = integrity holds but UX / ops suffer
- **Bypassable** = attacker can defeat the control
- **Gap** = missing or incomplete protection

---

## 1. Concurrency

| Scenario | Protection | HTTP outcome | Data integrity | Notes |
|----------|------------|--------------|----------------|-------|
| 2 concurrent draws | Conditional updateMany + unique | 200 + 409 | Protected | Good |
| 10–100 concurrent draws | Same | 1×200 + (N-1)×409 | Protected | Memory tests pass; Prisma relies on DB |
| Concurrent snapshots | Version inside tx + unique | 409 on conflict | Protected | Multiple historical versions allowed |
| Participants update while SNAPSHOT_LOCKED | FSM assert | 409 | Protected | |
| Participants + snapshot + draw interleaving | FSM + status guards | 409 / sequential success | Protected (residual TOCTOU low) | Re-test after 1.4.1 |

## 2. Idempotency

| Scenario | Protection | Outcome | Grade |
|----------|------------|---------|-------|
| Same key + same body | In-memory Map | Cached response | OK (single instance) |
| Same key + different body | None (no body hash) | Wrong / first body returned | **Gap / HIGH** |
| Key reuse across giveaways | Weak prefix only | Possible collision | **Gap** |
| Parallel identical requests | Race on set | One wins | Degraded |
| Flood unique keys | Lazy TTL only | Memory growth | **Gap** |
| Multi-instance deployment | Process-local | No shared semantics | **Fail** |

## 3. Rate Limiting

| Scenario | Protection | Outcome | Grade |
|----------|------------|---------|-------|
| Burst same IP | Sliding window | 429 after limit | OK |
| Rotate X-Forwarded-For | None | Full bypass | **Bypassable / CRITICAL** |
| Missing X-Forwarded-For | Falls to “anonymous” | Shared bucket | Degraded |
| IPv6 / multi-value header | No normalization | Unexpected keys | Gap |
| Unique fake IP flood | No idle key GC | Memory growth | Gap |
| Multi-instance | Process-local | Independent buckets | Fail for global limit |

## 4. Validation & Contract

| Scenario | Protection | Outcome | Grade |
|----------|------------|---------|-------|
| winnersCount 0 / 101 / negative | Zod | 400 | Protected |
| seed > 512 chars | Zod | 400 | Protected |
| URL > 2048 | Zod | 400 | Protected |
| Malformed JSON | handleApiError | 400 | Protected |
| Unknown fields | .strict() | 400 | Protected |
| winnersCount > eligible | Silent Math.min in Core | 200 with fewer winners | **Gap** (contract) |
| Nested / huge JSON before Zod | Node parser limits | Possible 400 / memory | Acceptable |

## 5. Database / Crash

| Scenario | State after | Retry safe? | Grade |
|----------|-------------|-------------|-------|
| Crash before draw tx | SNAPSHOT_LOCKED | Yes | Protected |
| Crash inside draw tx | Rolled back | Yes | Protected |
| Crash after commit, before HTTP | DRAWN + records | Yes → 409 | Protected (client must understand 409) |
| Unique violation on DrawResult | ConflictError 409 | N/A | Protected |
| Orphan DrawResult / Audit | Impossible (same tx + unique) | — | Protected |
| Snapshot delete with Draw/Audit | Restrict | — | Protected |

## 6. Memory / Scalability of Phase 1.4 Stores

| Load | IdempotencyStore | RateLimiter | Risk |
|------|------------------|-------------|------|
| 10k unique keys | ~5 MB | low | OK |
| 100k unique keys | ~43 MB | ~20–30 MB | Warning |
| 200k+ / continuous flood | Unbounded (lazy TTL) | Unbounded | High under abuse |

## 7. Summary Grades (G-2)

| Area | Grade |
|------|-------|
| Concurrency | **PASS WITH WARNINGS** |
| Idempotency | **FAIL** (for production multi-instance / adversarial) |
| Rate limiting | **FAIL** (header spoof bypass) |
| Validation | **PASS WITH WARNINGS** (silent winners cap) |
| DB integrity | **PASS** |
| Scalability of new stores | **PASS WITH WARNINGS** |

## 8. VK Integration Readiness Answer

**Is it safe to start real VK integration after Phase 1.4.1?**

**No — not yet fully safe.**

Arguments:

1. Draw concurrency and DB invariants are solid enough for a single-instance or carefully pooled deployment.
2. Rate limiting is trivially bypassable via `X-Forwarded-For` rotation; any public exposure can be flooded.
3. Idempotency is process-local and lacks body fingerprinting; multi-instance or retry storms will misbehave.
4. Silent under-delivery of winners when requested count exceeds eligible violates a clear API contract expectation.
5. After Antigravity finishes 1.4.1, the mixed-race and 100-concurrent suites must be re-validated on real Postgres.

**Minimum before VK production traffic:**
- Edge (or shared) rate limiting with non-spoofable identity
- Shared idempotency store with body hash / mismatch rejection
- Explicit error when winnersCount + reserve > eligible
- Client contract that 409 on draw means “already completed”

Once those are in place, Phase 1.4 concurrency + validation form a reasonable base for controlled VK integration.
