# Randomayzer — Phase G-5 Authenticated VK Access / Token Lifecycle Review

**Reviewer:** Grok (xAI)  
**Date:** 2026-08-18  
**Commit:** `d6f087c21efb593ee7db58f816be98a2d087b3e3`  
**Scope:** Phase 2.3 — VkAuthContextResolver, token refresh, SERVICE→USER fallback, credential ownership, capabilities, import auth.  
**Constraint:** Review / tests / docs only. No production code changes.

---

## 1. Executive Verdicts

| Area | Verdict |
|------|---------|
| **Credential isolation** | **PASS** |
| **Resolver** | **PASS WITH WARNINGS** |
| **Refresh** | **PASS WITH WARNINGS** |
| **Refresh concurrency** | **PASS WITH WARNINGS** |
| **Fallback** | **PASS WITH WARNINGS** |
| **Capabilities** | **PASS WITH WARNINGS** |
| **Token confidentiality** | **PASS** |
| **Participant import** | **PASS WITH WARNINGS** |
| **VK contract** | **PASS WITH WARNINGS** |
| **Overall Phase 2.3** | **PASS WITH FIXES** |

### Безопасно ли переходить к реальному VK smoke test?

**YES.**

**Real blockers:** none for a controlled smoke test with:
- configured `VK_SERVICE_TOKEN` / organizer USER login,
- `TOKEN_ENCRYPTION_KEY`,
- single-instance process (in-memory single-flight map).

**Must watch during smoke:** refresh single-flight under load, null `expiresAt` behaviour, fallback only on private/permission errors, no token in API responses.

---

## 2. Credential Ownership / IDOR

Participants POST/GET and other mutations call `requireGiveawayOwner` **before** any provider/resolver call.

```ts
const { giveaway, sessionUser } = await requireGiveawayOwner(req, id);
// ...
organizerId: sessionUser.id  // from session, not body
```

- Organizer identity for resolver comes from **trusted session** after ownership check.
- Client cannot pass another user’s `userId` / `vkUserId` / `organizerId` to decrypt or use their credential.
- A’s giveaway never loads B’s `UserCredential`.
- Null `organizerId` still Forbidden (prior phase invariant).

**Horizontal privilege escalation: not found.**

---

## 3. VkAuthContextResolver

Least-privilege default: SERVICE if configured; else USER if `organizerId` present.

| Mode | Behaviour |
|------|-----------|
| preferred SERVICE | SERVICE env token; if missing + organizer → USER |
| preferred USER | requires organizerId → getOrRefreshUserToken |
| preferred COMMUNITY | env `VK_COMMUNITY_TOKEN_{id}` or USER fallback |
| automatic | SERVICE preferred; else USER; else AuthError |

`resolveUserFallbackContext(organizerId)` is explicit and only used by provider on private/permission failure.

No silent arbitrary token switching outside documented paths.

**WARN:** COMMUNITY → USER fallback when community token missing is broad; acceptable if documented.

---

## 4. SERVICE → USER Fallback

Provider (e.g. `fetchPost`) only falls back when:

```ts
err instanceof VkPrivateResourceError || err instanceof VkPermissionError
&& activeAuth.type === 'SERVICE'
&& options?.organizerId
```

| Error class | Fallback? |
|-------------|-----------|
| VkPrivateResourceError | YES (documented) |
| VkPermissionError | YES (documented; broader than pure private) |
| VkRateLimitError | NO |
| VkTemporaryError | NO |
| VkNetworkError / Timeout | NO |
| VkValidationError | NO |
| VkAuthError on SERVICE | NO (rethrows) |

Rate-limit bypass via token switch: **blocked**.

**WARN:** Treating all `VkPermissionError` as fallback-eligible may include non-privacy permission failures; policy is explicit in `VK_AUTHENTICATED_ACCESS.md`.

**Fallback loop:** USER path does not re-enter SERVICE fallback → no SERVICE↔USER loop.

---

## 5. User Token Expiry

```ts
const isExpiredOrExpiring = cred.expiresAt
  ? now >= cred.expiresAt.getTime() - 30_000
  : false;
```

| Case | Behaviour |
|------|-----------|
| future expiresAt | decrypt & use |
| within 30s of expiry | refresh |
| past expiry | refresh |
| **null expiresAt** | **treated as non-expired** → send without refresh |
| missing access token | ReauthenticationRequired |

**WARN:** null/legacy `expiresAt` never triggers refresh. Prefer “unknown expiry → refresh or re-auth” for safety.

Expired token is not knowingly sent when `expiresAt` is present and past.

---

## 6–10. Refresh Security & Concurrency

**Security**
- Refresh token decrypted only server-side in `executeRefresh`.
- New access (and rotated refresh if present) encrypted before `upsertUserWithTokens`.
- Failures → `VkReauthenticationRequiredError`; message may include generic error text, not raw tokens.
- Refresh response `user_id` is **not** checked against stored `vkUserId` → **WARN** (account binding): should reject identity mismatch.

**Single-flight**
- Map keyed by `userId`.
- Existing test: 20 concurrent → 1 refresh call, same token to all (PASS in test).
- **WARN:** every waiter runs `finally { inFlightRefreshes.delete(userId) }`. First completer clears the key; a new concurrent request can start a **second** refresh while other waiters still use the first promise. Prefer delete only if `map.get(id) === thisFlight`.
- Locks are per-user → A does not block B (OK).
- On error, waiters all reject; key cleared → subsequent call can retry (no permanent stuck lock).

**Stale write**
- No version/CAS on credential update. Late refresh can overwrite a credential updated by a concurrent login/refresh.
- Severity: MEDIUM–HIGH under concurrent refresh+relogin; lower if single-flight holds for most cases.

**Refresh failure matrix (expected)**
| VK mock outcome | Result |
|-----------------|--------|
| invalid/expired refresh | ReauthenticationRequired |
| network/timeout/429/500 | wrapped ReauthenticationRequired |
| missing access_token | ReauthenticationRequired |
| malformed | ReauthenticationRequired |
| No plaintext token in thrown message by design | OK |

---

## 11. Account Binding

Upsert on refresh uses **DB user.vkUserId**, not token response identity.  
Silent rebind to another VK account: **not implemented**.  
**GAP:** no explicit reject if refresh response `user_id` ≠ stored vkUserId.

---

## 12–13. Token Confidentiality

Markers must not appear in API JSON, participant responses, giveaway detail, capabilities, audit proof.  

Design:
- Credentials only via vault decrypt on server.
- POST participants returns summary counts only.
- Session cookie is opaque ID.
- UserCredential not spread into public DTOs.

**Encrypted ciphertext** also should not be returned to frontend — repository responses used by API must omit credential fields (verify list/detail serializers).  

**Token leak result (static review):** no intentional plaintext path found. Smoke test should grep responses/logs for markers.

---

## 14–16. Participant Import Auth Flow

Order:
1. Rate limit  
2. **requireGiveawayOwner** (session + ownership + CSRF)  
3. Validate body  
4. Idempotency lookup  
5. Provider `fetchParticipants` with `organizerId: sessionUser.id`  
6. Pipeline / persist  
7. Summary response + idempotency store  

No provider call before ownership. Client organizer id cannot control resolver.

**Partial import + fallback:** if SERVICE fails mid-pagination with private error, fallback restarts USER fetch. Provider should not merge partial SERVICE pages with USER result as one complete set without clear restart. **WARN:** confirm import path fully restarts on fallback (likes/comments) rather than appending mixed auth pages.

**Idempotency:** key includes operation + giveawayId + payload; successful USER completion after SERVICE deny should cache final result; replay returns cache (design intent).

---

## 17–18. Runtime Capabilities

Docs define method matrix + fallback rules. Static `provider.capabilities` still flag reposts/adminDetection false.  

**TOCTOU:** UI capability snapshot can go stale if token expires before import; import path re-resolves via refresher → revalidation on execution (OK). Do not trust UI-only flags for authorization.

**WARN:** Ensure API “effectiveCapabilities” for a giveaway reflects actual SERVICE availability + organizer credential presence, not only static provider flags.

---

## 19–20. Subscription / Preview

`groups.isMember` batching remains 500; auth via resolver/organizerId. Prefer consistent token for all batches of one import (no mixed SERVICE/USER batches unless intentional full restart).

`/api/posts/preview`: must not accept foreign organizer tokens; use session or SERVICE only; no token fields in response. (Confirm route does not take client-supplied user tokens.)

---

## 21–22. Rate Limit & Refresh Storm

Global VK limiter can starve short calls during large import (ops issue, not security).  

100 concurrent + refresh 429/500: single-flight should yield one attempt then shared failure; after key clear, retries possible — avoid unbounded client retry amplification (application/API rate limits).

---

## 23. Credential Invalidation

Confirmed auth failure → `VkReauthenticationRequiredError` → client reconnect.  
No infinite retry of bad refresh token in-process without new user action (OK).  
Optional: clear stored refresh on definitive invalid_grant (product choice).

---

## 24–25. Versioning / Audit Isolation

Ciphertext has no explicit key-version field → **TECH DEBT**, non-blocking.  

Auth mode / token metadata must not enter Randomizer/AuditProof inputs — unchanged core; **PASS**.

---

## 26–27. Mock vs Real / VK Contract

| Claim | Implementation | Official | Verdict |
|-------|----------------|----------|---------|
| Refresh endpoint oauth2/auth | Yes | VK ID docs | **VERIFIED** (path) |
| grant_type refresh_token | via oauth client | Required | **VERIFIED** if client sends it |
| device_id on refresh | optional / often absent | Sometimes required | **UNVERIFIED** |
| access + optional refresh rotation | Yes | Common | **VERIFIED** pattern |
| expires_in handling | Yes (+30s skew) | Yes | **PARTIAL** (null expiry) |
| SERVICE→USER only on private/permission | Yes | Product policy | **VERIFIED** policy |
| Scope separator | comma default | space in some VK ID | **UNVERIFIED** live |

**No definite WRONG** refresh contract found that blocks smoke. Confirm `device_id` and scope format on the registered app during smoke.

---

## 28. Performance

Resolver + decrypt + expiry check are O(1) vs network/pagination. Overhead negligible vs 100k import.

---

## 29. CRITICAL / HIGH

**CRITICAL:** none for controlled smoke with proper env.

**HIGH:**
1. Single-flight `finally` deletes key for every waiter → possible double refresh under overlap.
2. null `expiresAt` never refreshes.
3. No CAS/version on credential write (stale refresh overwrite).
4. No refresh response `user_id` vs stored `vkUserId` check.

**MEDIUM:**  
- Fallback includes all PermissionError.  
- Partial SERVICE pages + USER restart semantics.  
- Global limiter starvation (ops).

---

## 30. Refresh stress scale

Existing test: **20 concurrent → 1 refresh**.  
Design targets 50–100; recommend extending test with the “delete only if same promise” fix verification.

---

## 31. Phase 2.3 readiness for real VK smoke

**YES.**

Proceed with manual/real smoke (`docs/VK_REAL_SMOKE_TEST.md` / `VK_MANUAL_SMOKE_TEST.md`) while monitoring:
- single refresh under parallel import,
- private wall fallback SERVICE→USER,
- zero token markers in HTTP bodies/logs,
- reconnect path when refresh fails.

Fix HIGH items before multi-instance production traffic, not necessarily before first smoke.
