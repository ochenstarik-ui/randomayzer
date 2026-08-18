# OAuth Attack Matrix — Phase G-4

**Commit:** `02a04df2719094e28db97575b9fbecb940b6ead3`  
**Date:** 2026-08-18

## Legend
OK / WARN / GAP / FAIL

---

## OAuth State / PKCE

| # | Attack | Result | Grade |
|---|--------|--------|-------|
| 1 | missing state | ValidationError | OK |
| 2 | unknown state | Unauthorized | OK |
| 3 | expired state | Unauthorized | OK |
| 4 | reused state | Unauthorized (deleted) | OK |
| 5 | concurrent same state | possible double consume | **WARN/GAP** |
| 6 | foreign browser state | fail | OK |
| 7 | error=access_denied | state consumed | OK |
| 8 | missing code | ValidationError | OK |
| 9 | wrong codeVerifier | VK rejects | OK |
| 10 | cross-tx verifier | bound by state | OK |

## Redirect / Host

| # | Attack | Result | Grade |
|---|--------|--------|-------|
| 1 | https://evil.com | → `/` | OK |
| 2 | //evil.com | → `/` | OK |
| 3 | /\evil.com /\\evil | → `/` | OK |
| 4 | javascript: / data: | → `/` | OK |
| 5 | Host poisoning, VK_REDIRECT_URI unset | Location/redirect_uri risk | **WARN** |
| 6 | VK_REDIRECT_URI set | fixed URI | OK |

## Session / Cookie

| # | Check | Result | Grade |
|---|-------|--------|-------|
| 1 | CSPRNG session id | randomBytes(32) | OK |
| 2 | Session fixation | new id always | OK |
| 3 | HttpOnly Secure SameSite | yes (prod Secure) | OK |
| 4 | Token in cookie | no | OK |
| 5 | Memory multi-instance | FATAL if MULTI_INSTANCE | OK (guard) / WARN (limit) |

## CSRF

| # | Attack | Result | Grade |
|---|--------|--------|-------|
| 1 | cross-site Sec-Fetch-Site | Forbidden | OK |
| 2 | evil Origin | Forbidden | OK |
| 3 | missing Origin/Referer prod | Forbidden | OK |
| 4 | X-Forwarded-Host trust | depends on edge | **WARN** |

## Ownership

| # | Attack | Result | Grade |
|---|--------|--------|-------|
| 1 | B accesses A’s giveaway | 403 | OK |
| 2 | anonymous mutation | 401 | OK |
| 3 | organizerId null | Forbidden | OK |
| 4 | delete User with giveaways | Restrict FK | OK |

## TokenVault

| # | Attack | Result | Grade |
|---|--------|--------|-------|
| 1 | no/short key in prod | FATAL | OK |
| 2 | tampered IV/tag/ciphertext | decrypt fail | OK |
| 3 | marker token in API/errors | not present by design | OK |

## Endpoint contract

| Claim | Verdict |
|-------|---------|
| id.vk.com/auth vs id.vk.ru/authorize | PARTIALLY VERIFIED |
| oauth2/auth token | PARTIALLY VERIFIED |
| PKCE S256 | VERIFIED |
| device_id | UNVERIFIED (often required) |
| scope commas vs spaces | WARN |

---

## Summary grades

| Area | Grade |
|------|-------|
| OAuth State/PKCE | **PASS WITH WARNINGS** |
| OAuth endpoint correctness | **PASS WITH WARNINGS** |
| Session | **PASS WITH WARNINGS** |
| CSRF | **PASS WITH WARNINGS** |
| Ownership/AuthZ | **PASS** |
| TokenVault | **PASS** |
| Redirect safety | **PASS WITH WARNINGS** |
| Privacy | **PASS WITH WARNINGS** |
| **Overall** | **PASS WITH FIXES** |

## Phase 2.3

**YES** — with mandatory `VK_REDIRECT_URI` + encryption key, single-instance or shared session/OAuth store, and planned fix for concurrent state consume + live VK ID parameter check (`device_id`, authorize path).
