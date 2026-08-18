# Phase 2.3 Failure Matrix — Grok G-5

**Commit:** `d6f087c21efb593ee7db58f816be98a2d087b3e3`  
**Date:** 2026-08-18

## Credential / IDOR

| Attack | Result | Grade |
|--------|--------|-------|
| B uses A’s giveaway id | 403 owner check | OK |
| Client supplies foreign organizerId | ignored; session owner used | OK |
| Decrypt B credential as A | no path | OK |
| Null organizerId authorize | Forbidden | OK |

## Resolver / Fallback

| Case | Behaviour | Grade |
|------|-----------|-------|
| Public + SERVICE configured | SERVICE | OK |
| Private + SERVICE fail PrivateResource | USER fallback | OK |
| RateLimit on SERVICE | no fallback | OK |
| Network/Timeout/Validation | no fallback | OK |
| SERVICE→USER→SERVICE loop | no | OK |
| PermissionError fallback | allowed by policy | WARN |

## Refresh

| Case | Behaviour | Grade |
|------|-----------|-------|
| 20 concurrent expired | 1 HTTP refresh (test) | OK |
| 50–100 concurrent | intended single-flight; finally-delete race | WARN |
| A and B concurrent | separate keys | OK |
| null expiresAt | no refresh | WARN |
| identity mismatch on refresh | not checked | WARN |
| stale write overwrite | no CAS | WARN |
| invalid refresh / 429 / 500 | ReauthenticationRequired | OK |
| token in error/API | not by design | OK |

## Import / Capabilities

| Case | Behaviour | Grade |
|------|-----------|-------|
| Provider before ownership | no | OK |
| Idempotent completed import | cache hit | OK |
| Partial SERVICE + USER restart | must full restart | WARN |
| Stale UI capabilities | re-resolve on import | OK |
| Token in participants response | summary only | OK |

## VK contract

| Item | Verdict |
|------|---------|
| Refresh endpoint | VERIFIED / PARTIAL |
| device_id | UNVERIFIED |
| Scope separator | UNVERIFIED |
| Fallback policy | VERIFIED (product) |
| Definitely WRONG | None |

---

## Summary grades

| Area | Grade |
|------|-------|
| Credential isolation | **PASS** |
| Resolver | **PASS WITH WARNINGS** |
| Refresh | **PASS WITH WARNINGS** |
| Refresh concurrency | **PASS WITH WARNINGS** |
| Fallback | **PASS WITH WARNINGS** |
| Capabilities | **PASS WITH WARNINGS** |
| Token confidentiality | **PASS** |
| Participant import | **PASS WITH WARNINGS** |
| VK contract | **PASS WITH WARNINGS** |
| **Overall** | **PASS WITH FIXES** |

## Smoke-test readiness

**YES** — no CRITICAL blockers for controlled real VK smoke.  
Watch: single-flight under load, null expiry, fallback only private/permission, zero token leakage in responses/logs.
