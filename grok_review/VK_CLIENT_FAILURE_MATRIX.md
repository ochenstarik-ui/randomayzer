# VK Client Failure Matrix — Phase G-3

**Commit:** `7acf4d2d4ed131f999936186377e85663c19316a`  
**Date:** 2026-08-17

## Legend
- **OK** — correct typed error, no retry when forbidden, cleanup done
- **WARN** — integrity holds, UX or edge behaviour imperfect
- **GAP** — missing protection or incomplete behaviour
- **FAIL** — wrong classification or leak

---

## 1. Cancellation / Timeout

| Scenario | Error class | Retries after | Timer/listener cleanup | Grade |
|----------|-------------|---------------|------------------------|-------|
| signal already aborted | VkCancelledError | 0 | N/A | OK |
| abort before rate limiter | VkCancelledError | 0 | OK | OK |
| abort while queued in rate limiter | VkCancelledError (after slot) | 0 | OK | **WARN** (delayed) |
| abort during fetch | VkCancelledError | 0 | OK | OK |
| abort during backoff | VkCancelledError | stop | OK | OK |
| timeout during fetch | VkTimeoutError | yes (policy) | OK | OK |
| timeout after max retries | VkTimeoutError | stop | OK | OK |
| timeout + caller abort simultaneous | **VkCancelledError** (deterministic) | 0 | OK | OK |

## 2. Retry Classification

| Input | Class | Retryable | Grade |
|-------|-------|-----------|-------|
| HTTP 400 | Validation | No | OK |
| HTTP 401 | Auth | No | OK |
| HTTP 403 | Permission | No | OK |
| HTTP 404 | NotFound | No | OK |
| HTTP 429 | RateLimit | Yes | OK |
| HTTP 500–504 | Temporary | Yes | OK |
| VK 1, 10 | Temporary | Yes | OK |
| VK 5, 28 | Auth | No | OK |
| VK 6, 9, 29 | RateLimit | Yes | OK |
| VK 7, 260 | Permission | No | OK |
| VK 15, 30, 203 | PrivateResource | No | OK |
| VK 36 | Timeout | Yes | OK |
| VK 100, 113 | Validation | No | OK |
| VK 104, 210 | NotFound | No | OK |
| VK code 500 (API) | (no special case → Validation default) | No | OK (not confused with HTTP 500) |
| Abort / Cancel | Cancelled | **No** | OK |

## 3. Pagination

| Case | Result | Grade |
|------|--------|-------|
| Empty first page | [] | OK |
| Short last page | stop, return accumulated | OK |
| maxPages + truncation | VkPaginationLimitError (default) | OK — not silent partial |
| Repeated identical page | maxPages only | **WARN** |
| Cancel between pages | VkCancelledError | OK |
| Failure mid-pagination | error bubbles, no “complete” partial | OK |

## 4. Token Security

| Vector | Token visible? | Grade |
|--------|----------------|-------|
| Request URL | No (POST body) | OK |
| Error.message | No | OK |
| request_params in VK error | [REDACTED] | OK |
| Stack / serialized metadata | No by design | OK |
| Logs via redactToken | Safe helper present | OK |

## 5. Rate Limiter

| Case | Behaviour | Grade |
|------|-----------|-------|
| Steady 10 RPS | Enforced | OK |
| 1000 concurrent acquire | FIFO queue | OK / memory light |
| Cancel while queued | Delayed until slot | **WARN** |
| Large import vs short calls | Starvation possible | **WARN** |

## 6. Capability Claims

| Claim | Verdict |
|-------|---------|
| groups.isMember batch 500 | PARTIALLY VERIFIED |
| likes.getList max 100 extended | PARTIALLY VERIFIED (official up to 1000) |
| wall.getReposts limited / capability false | PARTIALLY VERIFIED (pragmatic) |
| wall.getById token types | VERIFIED |
| adminDetection requires managers | VERIFIED |
| Any claim WRONG | **None found** |

## 7. Summary Grades

| Area | Grade |
|------|-------|
| Cancellation/Timeout | **PASS WITH WARNINGS** |
| Retry | **PASS** |
| Pagination | **PASS WITH WARNINGS** |
| Token Security | **PASS WITH WARNINGS** |
| Error Mapping | **PASS** |
| VK Contract Accuracy | **PASS WITH WARNINGS** |
| OAuth Readiness | **YES** |

## 8. OAuth Phase 2.2 Answer

**Безопасно ли начинать Phase 2.2 OAuth? → YES**

No blocking issues.  
Non-blocking: abortable rate-limiter acquire, limiter isolation for long imports, optional pagination loop detection.
