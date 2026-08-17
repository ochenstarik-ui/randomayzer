# Randomayzer — Phase G-3 VK Client Adversarial Review

**Reviewer:** Grok (xAI)  
**Date:** 2026-08-17  
**Commit reviewed:** `7acf4d2d4ed131f999936186377e85663c19316a`  
**Scope:** Phase 2.1 + 2.1.1 VkClient, retry, cancellation, pagination, rate limit, token security, error mapping, method capability claims.  
**Constraints:** No production Core / Randomizer / AuditProof / Prisma / OAuth implementation changes. Docs + optional tests only.

---

## 1. Executive Verdicts

| Area | Verdict |
|------|---------|
| **Cancellation / Timeout** | **PASS WITH WARNINGS** |
| **Retry** | **PASS** |
| **Pagination** | **PASS WITH WARNINGS** |
| **Token Security** | **PASS WITH WARNINGS** |
| **Error Mapping** | **PASS** |
| **VK Contract Accuracy** | **PASS WITH WARNINGS** |
| **OAuth Readiness** | **YES** (with non-blocking risks) |

**Overall:** VkClient is solid enough to proceed to Phase 2.2 OAuth. Blocking issues are absent; remaining risks are documented and manageable.

---

## 2. Cancellation vs Timeout

### Implementation summary

```ts
let timedOut = false;
let callerCancelled = false;
// timeout → timedOut=true; controller.abort()
// caller signal → callerCancelled=true; controller.abort()
// catch order:
// 1. if (callerCancelled || signal?.aborted) → VkCancelledError
// 2. if (timedOut) → VkTimeoutError
// 3. AbortError fallback with same priority
// finally: clearTimeout + removeEventListener
```

| Scenario | Expected | Observed design |
|----------|----------|-----------------|
| signal already aborted before call | VkCancelledError, 0 retries | Yes (early check) |
| abort before rate limiter | VkCancelledError | Yes (pre-acquire check) |
| abort while waiting rate limiter | VkCancelledError after slot granted | **Partial** — acquire() has no AbortSignal; abort is only observed after acquire resolves |
| abort during fetch | VkCancelledError, no retry | Yes |
| abort during retry backoff | VkCancelledError, stop retries | Yes (backoff Promise rejects on abort) |
| timeout during fetch | VkTimeoutError, retryable | Yes |
| timeout after several retries | final VkTimeoutError | Yes |
| timeout + caller abort nearly simultaneous | **VkCancelledError** (caller wins) | Deterministic: callerCancelled checked first |

**Classification is deterministic and documented** in `docs/VK_CLIENT.md`.

**Warning:** Rate-limiter queue wait is not abortable. Long queue under load delays cancellation observation until the slot is granted. Recommendation (proposal only): pass AbortSignal into `IVkRateLimiter.acquire(signal?)`.

**Listener / timer hygiene:** `finally` always clears timeout and removes the abort listener (`{ once: true }` + explicit remove). No obvious MaxListeners accumulation on the happy path. Stress of 10k–100k calls should be safe if finally runs (normal Promise path).

---

## 3. Retry Policy Matrix

### HTTP status → typed error → retryable

| HTTP | Mapped class | Retryable | Notes |
|------|--------------|-----------|-------|
| 400 | VkValidationError | No | |
| 401 | VkAuthError | No | |
| 403 | VkPermissionError | No | |
| 404 | VkNotFoundError | No | |
| 408 | VkNetworkError (fallback) | Yes* | Treated as network |
| 429 | VkRateLimitError | Yes | |
| 500–504 | VkTemporaryError | Yes | |
| other 4xx | VkValidationError | No | |
| other | VkNetworkError | Yes | |

\*408 is not specially cased; falls through to Network (retryable). Acceptable.

### VK API error_code → typed error → retryable

| Code | Mapped class | Retryable | Notes |
|------|--------------|-----------|-------|
| 1 | VkTemporaryError | Yes | Unknown error |
| 5 | VkAuthError | No | Auth |
| 6 | VkRateLimitError | Yes | Too many requests / s |
| 7 | VkPermissionError | No | |
| 9 | VkRateLimitError | Yes | Flood control |
| 10 | VkTemporaryError | Yes | Internal server |
| 15 | VkPrivateResourceError | No | Access denied |
| 28 | VkAuthError | No | |
| 29 | VkRateLimitError | Yes | Rate limit |
| 30 | VkPrivateResourceError | No | Private profile |
| 36 | VkTimeoutError | Yes | Method execution timeout on VK side |
| 100 | VkValidationError | No | Invalid params |
| 104 | VkNotFoundError | No | |
| 113 | VkValidationError | No | Invalid user id |
| 203 | VkPrivateResourceError | No | |
| 210 | VkNotFoundError | No | Wall access / not found |
| 260 | VkPermissionError | No | |
| default | VkValidationError | No | Safe default |

**Critical check:** VK error **code 500 is not treated as HTTP 500**. There is no case 500 in `mapVkApiError`; HTTP 500 is handled only in `mapHttpStatusError`. Correct separation.

**Backoff:** exponential with full jitter, default maxRetries=3, initial 300 ms, maxDelay 4000 ms. Cancellation aborts backoff. Good.

**Retry storm / thundering herd:** Full jitter reduces sync; global rate limiter serializes outbound calls. 100 parallel clients hitting VK 429 will queue behind the limiter + backoff — acceptable, not a thundering herd of raw HTTP.

---

## 4. VK Rate Limiter

- Default: 10 RPS, sequential FIFO queue, minInterval ≈ 100 ms.
- `acquire()` has **no AbortSignal** → cancellation while queued is delayed (see §2).
- One large likes import (many pages) occupies the single global limiter and can **starve** concurrent short calls (e.g. wall.getById for another giveaway) for the duration of the import.
- Memory: queue of resolve callbacks; 1000 concurrent is fine; 10k+ starts to matter.
- Fairness: pure FIFO, no priority lanes.

**Proposal (non-blocking):** optional separate limiters per token type / priority, or AbortSignal on acquire.

---

## 5. Pagination (`fetchPaginatedVk`)

| Case | Behavior | Grade |
|------|----------|-------|
| 0 items | break, return [] | OK |
| 1 page | OK | OK |
| exact page boundary | continues until short page / total | OK |
| 2+ pages | accumulates | OK |
| totalCount changes mid-flight | uses latest recordedTotalCount for truncation check | OK |
| duplicated IDs across pages | accumulated as-is; provider Map dedups later | OK at client, OK at provider |
| API repeats same page forever | stopped by **maxPages** (default 10000) | **WARN** — no fingerprint / no-progress detection |
| items.length < pageSize while total larger | treated as last page (break) | OK |
| maxPages reached + truncation | throws `VkPaginationLimitError` if `throwOnTruncation` (default true) | OK — **partial set is not returned as complete** |
| caller cancel | VkCancelledError between pages | OK |
| network / rate limit mid-page | bubbles; no silent partial complete | OK |

**Stuck pagination:** only maxPages protects against a broken VK that always returns the same non-empty page.  
**Proposal:** optional loop detection (fingerprint of first/last id + offset progress). Non-blocking for Phase 2.2.

---

## 6. Participant Deduplication & Subscription Batching

**Provider:** `participantsMap` keyed by `platformUserId`. Like then comment merge actions → one Participant. Correct.

**groups.isMember batching:** chunkSize = **500**, sequential calls.  
Sizes 1 / 499 / 500 / 501 / 1000 / 1001 → all users covered, no duplicate checks of the same id in one batch. Partial failure of one chunk fails the whole `checkSubscription` (no per-chunk continue) — acceptable for correctness, could be improved later with partial results.

**Duplicate likes pages / name change between pages:** Map overwrites with later profile data; still one entry. Deactivated users appear with whatever fields VK returns; not specially filtered here (filter engine may later).

---

## 7. Token Security

| Vector | Protection | Result |
|--------|------------|--------|
| access_token in URL | Sent in **POST form body** only | OK |
| VK error `request_params` | `sanitizeRequestParams` → `[REDACTED]` for token keys | OK |
| Error.message / method | Uses method name, not full URL+token | OK |
| Network Error wrapping `err.message` | Could theoretically contain URL if fetch implementation leaks it; current code uses generic message | Low risk |
| redactToken() helper | Present for logs | OK |
| Stack traces | Do not embed token | OK |
| Fake token `SUPER_SECRET_RANDOMAYZER_TOKEN_123456` in error paths | Sanitized in request_params; not present in constructed messages | Expected pass |

**Warning:** Ensure no debug/logging middleware serializes the raw `URLSearchParams` body into error metadata. Current VkClient does not.

**Form body token:** Correct choice; never lands in query string.

---

## 8. VK Method Capability Claims vs Official Sources

| Claim | Project says | Official (dev.vk.com / schema practice) | Verdict |
|-------|--------------|------------------------------------------|---------|
| wall.getById token types | service, user, group, open | Supported with those tokens | **VERIFIED** |
| likes.getList max count | Max 100 with extended=1; 1000 IDs only | Official: max **1000** (friends_only off); extended returns profiles | **PARTIALLY VERIFIED** (project is more conservative) |
| groups.isMember max user_ids | **500** | Common community/SDK limit; official page does not always spell 500 explicitly | **PARTIALLY VERIFIED** (widely used & safe) |
| wall.getReposts limitations | capabilities.reposts = false; privacy | Method exists for service/user; practical privacy limits on third-party posts | **PARTIALLY VERIFIED** (pragmatic & correct for product) |
| groups.getMembers managers for adminDetection | requires admin rights; capability false | Correct | **VERIFIED** |
| Service token usable for listed methods | Yes | Yes for wall/likes/comments/isMember | **VERIFIED** |
| Service token lifetime | (not overclaimed in client) | Long-lived app token | OK |

No claim was found **WRONG**. Conservative count limits are safer than optimistic ones.

---

## 9. Auth / OAuth Readiness

- `VkAuthContext` already supports `SERVICE | USER | COMMUNITY` with `communityId` for group tokens.
- Factories: `createServiceAuth`, `createUserAuth`, `createCommunityAuth`.
- `validateAuthContext` enforces non-empty token and communityId for COMMUNITY.
- VkClient is token-agnostic; no hardcoded OAuth endpoints or legacy assumptions that block Phase 2.2.
- No OAuth implementation present (as required).

**Verdict: YES — safe to start Phase 2.2 OAuth.**

Non-blocking risks:
- Rate limiter is global (one import can delay OAuth-related calls).
- acquire() not cancellable.
- No token refresh / lifecycle hooks yet (expected for 2.2).

---

## 10. Error Surface (public safety)

Typed errors expose: `category`, `errorCode`, `method`, sanitized `details`.  
They do **not** expose: access_token, full request URL with secrets, raw request_params with tokens.  
Owner/post ids may appear in messages when the application constructs them (e.g. “Post X not found”) — acceptable and useful.  
Safe public mapping path exists via existing `handleApiError` style (HTTP layer already maps AppErrors).

---

## 11. Performance Notes

- Pagination accumulates in memory (full list). For 100k likes this is the dominant cost (same as G-1 baseline).
- Retry overhead: up to 3 backoffs with jitter; small vs network.
- Rate limiter serializes to ~10 RPS → ~10k likes pages ≈ 1000 s theoretical floor (plus VK latency). Real large imports need background jobs (already noted in prior phases).
- Mock throughput of single call path is high; bottleneck is limiter + network.

---

## 12. CRITICAL / HIGH Findings

**CRITICAL:** none that block Phase 2.2.

**HIGH:**
1. Rate-limiter `acquire()` ignores AbortSignal → delayed cancellation under queue load.
2. Single global limiter → large import starves other VK traffic.
3. No pagination loop-detection beyond maxPages (stuck identical pages).

**MEDIUM:**
- likes.getList pageSize=100 is conservative vs official max 1000 (performance only).
- isMember partial chunk failure fails entire check (no partial map).
- NetworkError may surface underlying fetch message (low token risk).

---

## 13. Tests Executed / Scale

- Code review of: `vk-client.ts`, `vk-retry.ts`, `vk-errors.ts`, `vk-rate-limit.ts`, `vk-auth.ts`, `vk-provider.ts`, docs.
- Existing suites present: `vk-client-integration.test.ts`, `vk-correctness-gate.test.ts`, `vk-errors.test.ts`.
- Synthetic reasoning for cancellation races, retry matrix, token redaction, 500 concurrent queue behaviour.
- Official VK docs cross-check for capability claims (dev.vk.com).
- Stress scale for listener/timer: reasoned from `finally` + `{ once: true }`; recommend 10k mock-call run in CI.

Optional artifact: `tests/vk-client-grok-stress.test.ts` can be added later without touching production sources.

---

## 14. Final Answer

### Безопасно ли начинать Phase 2.2 OAuth?

**YES.**

**Blocking issues:** none.

**Remaining non-blocking risks:**
1. Make rate-limiter acquire abortable and/or add priority / per-token limiters before heavy production traffic.
2. Consider pagination progress fingerprint for pathological VK responses.
3. Confirm likes.getList `count` strategy (100 vs up to 1000) under real load.
4. After OAuth lands, ensure user/group tokens do not share the same global limiter bucket with long service-token imports without isolation.

VkClient cancellation/timeout separation, retry classification, token redaction, and error mapping are production-grade for the next phase.
