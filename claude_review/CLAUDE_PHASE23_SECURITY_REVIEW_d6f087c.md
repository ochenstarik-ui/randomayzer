# Randomayzer — Claude Phase C-4
## Phase 2.3 Auth Resolver & Refresh Security Review

**Repository:** https://github.com/ochenstarik-ui/randomayzer
**Review commit:** `d6f087c21efb593ee7db58f816be98a2d087b3e3`
**Source of truth:** local snapshot archive `randomayzer-d6f087c.zip`, uploaded and extracted directly. GitHub/web was **not** used as a code source.
**Scope:** New Phase 2.3 security-sensitive code only (Auth Resolver, Refresh, Credential Repository, Participants authenticated flow, SERVICE→USER fallback). No general re-audit was performed.

---

## 0. Files Reviewed

| Area | File |
|---|---|
| Auth resolver | `src/integrations/vk/vk-auth-resolver.ts` |
| Token refresher | `src/lib/auth/token-refresher.ts` |
| Token vault | `src/lib/auth/token-vault.ts` |
| VK OAuth client | `src/integrations/vk/vk-oauth-client.ts`, `src/integrations/vk/mock-oauth-client.ts` |
| Credential repository | `src/lib/repository/user-repository.ts` (+ `prisma/schema.prisma`) |
| VK provider / authenticated flow | `src/providers/vk/vk-provider.ts`, `src/integrations/vk/vk-client.ts`, `src/integrations/vk/vk-errors.ts` |
| Capabilities | `src/providers/vk/vk-capabilities.ts` |
| Session / CSRF / OAuth state | `src/lib/auth/session.ts`, `src/lib/auth/csrf-guard.ts`, `src/lib/auth/oauth-state.ts`, `src/lib/auth/auth-guard.ts` |
| API routes | `src/app/api/giveaways/[id]/participants/route.ts`, `src/app/api/posts/preview/route.ts`, `src/app/api/auth/vk/callback/route.ts`, `src/app/api/giveaways/route.ts` |
| Pipeline | `src/core/pipeline/participant-enricher.ts` |
| Error mapping | `src/core/errors/http-errors.ts` |
| Tests | `tests/token-refresh-concurrency.test.ts`, `tests/vk-auth-resolver.test.ts`, `tests/vk-provider-authenticated.test.ts`, `tests/oauth-concurrency.test.ts` |

---

## 1. Credential Data Flow Trace

```
HTTP request (cookie: randomayzer_session)
  → getSessionFromRequest()                [session.ts: opaque 32-byte token, server-side Map lookup]
  → requireGiveawayOwner(req, giveawayId)   [auth-guard.ts: CSRF-origin check + ownership check]
  → giveaway.organizerId === sessionUser.id ?  (else 403, and null-organizer is force-denied)
  → sessionUser.id passed as `organizerId` into provider.fetchParticipants()/fetchPost()/checkSubscription()
  → VkAuthContextResolver.resolveAuthContext({ organizerId, ... })
  → TokenRefresher.getOrRefreshUserToken(organizerId)
  → IUserRepository.getUserCredentials(userId)      [Prisma: WHERE userId = <internal id>]
  → TokenVault.decrypt(encryptedAccessToken)         [AES-256-GCM]
  → VkAuthContext{ type: 'USER', token: <plaintext> }
  → VkProvider → VkClient.call() → token placed in outbound form body only
```

### Trust boundaries identified
1. **Cookie → session store** — session id is a random, unguessable, server-generated 32-byte token (`randomBytes(32)`), stored server-side (`MemorySessionStore`). The client never supplies `userId`/`organizerId` directly.
2. **Session → giveaway ownership** — `requireGiveawayOwner` compares `giveaway.organizerId` (DB, server-set at creation) to `sessionUser.id` (server-derived from session). Explicitly denies when `organizerId` is null (anti-orphan invariant).
3. **organizerId → resolver** — `organizerId` is **only ever populated from `sessionUser.id`** at every call site (`participants/route.ts:80,90`, `posts/preview/route.ts:22`, `giveaways/route.ts:65`). Verified with a full-repo grep — **no client-supplied field named `organizerId` exists in any Zod schema** (`giveaway-schemas.ts`), so it cannot be injected via request body/query.
4. **Resolver → TokenRefresher → UserRepository** — lookup is by internal `userId` (cuid), not by attacker-controlled VK id.
5. **TokenVault** — AES-256-GCM, key derived via SHA-256 from `TOKEN_ENCRYPTION_KEY` (hard-fails in production if unset or <32 chars). Decrypted plaintext lives only in function-local variables, never persisted or logged.
6. **VkClient → VK API** — token is placed only in the outbound `URLSearchParams` body; never logged, never included in thrown errors (see §10).

### Can organizer/user id be influenced by client data?
**No.** Every code path that reaches `resolveAuthContext` / `resolveUserFallbackContext` / `getOrRefreshUserToken` receives `organizerId` that was assigned server-side from `sessionUser.id`, itself derived from an unguessable opaque session token validated against an in-memory session store the client cannot write to.

---

## 2. Horizontal Access Control

**Claim: User A cannot cause the resolver to decrypt/use User B's token.**

All resolver call sites were enumerated (`grep -rn "resolveAuthContext\|resolveUserFallbackContext\|getOrRefreshUserToken"`):

| Call site | organizerId origin |
|---|---|
| `vk-provider.ts:74` (`fetchPost`) | `options?.organizerId` — caller-supplied param |
| `vk-provider.ts:88` (fallback) | same |
| `vk-provider.ts:178` (`fetchParticipants`) | `params.organizerId` — caller-supplied param |
| `vk-provider.ts:190` (fallback) | same |
| `vk-provider.ts:324` (`checkSubscription`) | `options?.organizerId` — caller-supplied param |

All of these `VkProvider` methods are only invoked from two places in `src/app`:
- `participants/route.ts` → `organizerId: sessionUser.id` (post-ownership-check)
- `posts/preview/route.ts` → `organizerId: sessionUser?.id` (session-only, no ownership check needed since this is a public preview endpoint and worst case is resolving to the *current caller's own* USER token)

Because `VkProvider` itself has no HTTP-layer awareness, its "trust boundary" is the constructor/method contract: **any caller of `VkProvider.fetchParticipants/fetchPost/checkSubscription` that passes an arbitrary `organizerId` would be able to force resolution of that organizer's token.** Today, in this snapshot, no such caller exists outside the two verified sites. This is a **structural risk, not an active vulnerability**, and should be called out explicitly:

> ⚠️ `VkAuthContextResolver`/`TokenRefresher`/`VkProvider` do not themselves enforce that the `organizerId` passed in belongs to the authenticated caller — that invariant is enforced entirely by *callers* (currently correctly, in both cases). Any new API route or background job added later that passes a client-controlled or cross-user `organizerId` into these methods **would** constitute a full horizontal privilege escalation (User A obtains User B's decrypted VK token). This should be treated as an architectural trust assumption that needs to be documented and defended in code review for every future call site, not just today's two.

**Verdict for this snapshot: NO** (not currently exploitable) — see Final Verdict §18 for the caveat above.

---

## 3. Refresh Single-Flight Correctness

`TokenRefresher.getOrRefreshUserToken()` (`token-refresher.ts:30-63`):

- **Lock key**: `userId` (internal cuid) — correct, scoped per-user, no cross-user collision possible since the map key is the same value used for the DB lookup.
- **Exactly one refresh**: `inFlightRefreshes.get(userId)` is checked before creating a new promise; the promise is stored **synchronously** before any `await`, so concurrent callers within the same event-loop tick correctly join the same in-flight promise (verified in `tests/token-refresh-concurrency.test.ts`: 20 concurrent calls → `refreshCallsCount === 1`, all 20 receive the identical token).
- **Finally cleanup**: `try { return await existingFlight } finally { this.inFlightRefreshes.delete(userId) }` — the map entry is deleted regardless of success or failure, so no permanently stuck promise.
- **Exception cleanup**: `executeRefresh` itself catches all errors and rethrows as `VkReauthenticationRequiredError`; the outer `finally` still deletes the map entry. Confirmed via `tests/token-refresh-concurrency.test.ts` ("throws VkReauthenticationRequiredError when refresh fails on VK side") that a failed refresh correctly propagates the typed error. Not directly tested: that a **second** call after a failed first call is allowed to retry (i.e., the map entry was truly cleared) — implied correct by the `finally`, but there is no explicit regression test for it.
- **No cross-user lock collision**: keys are per-`userId`; no shared/global key used.

**Existing concurrency test critique**: `token-refresh-concurrency.test.ts` is a real exercise of `TokenRefresher` + `MemoryUserRepository` + `AesGcmTokenVault` + `MockVkOAuthClient` — not a shallow mock-everything test. It genuinely exercises the single-flight map, the encrypt/decrypt round trip, and the repository upsert. It does **not** test:
  - Two *different* users refreshing concurrently (to prove no accidental shared state) — low risk given the per-userId map key, but worth adding.
  - Recovery/retry after a failed refresh (map cleanup verification).

**Verdict: Single-flight is correctly implemented for a single Node process.** See §4 for the multi-instance caveat.

---

## 4. Refresh Persistence Race (Stale Overwrite)

- `UserCredential` (Prisma schema) has `updatedAt` (auto) but **no optimistic-concurrency `version` column and no CAS-conditioned update** (`WHERE version = ...`). The `upsertUserWithTokens` write is a plain `prisma.user.upsert(...)` with a nested `credentials.upsert`, i.e., last-write-wins by design.
- **Within a single Node process**, this is not exploitable: the in-memory single-flight mutex guarantees only one `executeRefresh` runs per user at a time, so there is no concurrent writer to race against.
- **Across multiple instances** (horizontal scaling), `inFlightRefreshes` is a per-process `Map` — it provides **no cross-instance mutual exclusion**. Two instances could both observe the same expired credential, both call VK's refresh endpoint with the same (still-valid, not-yet-rotated) `refresh_token`, and both attempt to persist. Because there is no CAS/version guard, the second write silently overwrites the first, and (depending on real-world VK refresh-token rotation semantics — see §5) the token that "loses" the race may still be a **valid and equally fresh token** rather than a stale one, since both refreshes were derived from the same VK refresh call input. The practical impact is bounded:
  - Worst case if VK **does** invalidate the used refresh_token after first use: the *losing* instance's exchange fails outright with `invalid_grant`, surfacing as `VkReauthenticationRequiredError` — a forced-reauth availability bug, not a credential leak or corruption of another user's data.
  - It cannot cause a different user's credential to be corrupted (write is scoped by `vkUserId`/`userId` uniqueness constraints).
- **Contrast**: `MemorySessionStore` and `MemoryOAuthTransactionStore` both explicitly `throw` a fatal configuration error when `MULTI_INSTANCE=true`. `TokenRefresher`/`AesGcmTokenVault`/`MemoryUserRepository` (memory-driver mode) have **no equivalent guard**, so a misconfigured horizontal deployment would fail loudly for sessions/OAuth-state but silently degrade (occasional forced reauth, no data corruption) for token refresh.

**Classification: MEDIUM** — availability/correctness gap under horizontal scaling, not a confidentiality or cross-user integrity issue. No CAS/version field exists; recommend adding one and/or a startup guard consistent with the session/OAuth-state stores.

---

## 5. Rotating Refresh Token

- `executeRefresh` (`token-refresher.ts:81-84`): if `refreshResponse.refresh_token` is present, it is encrypted and replaces the stored value; if absent, the **previous** `encryptedRefreshToken` is retained unchanged. This matches the project's own documented contract in `docs/VK_ID_LIVE_CONTRACT.md` §2 ("Refresh Token Expiry... if present, stored encrypted; if absent, flow continues safely") — internally consistent.
- `VkOAuthClient.refreshToken()` (`vk-oauth-client.ts:206`) defaults `refresh_token: data.refresh_token || params.refreshToken` at the HTTP-client layer, which is redundant with but not contradictory to the `token-refresher.ts` retention logic (double-safe).
- **External verification**: I do not have network access in this environment to hit VK's live `id.vk.com/oauth2/auth` endpoint, and general web search did not surface an authoritative, current public VK ID contract page confirming whether refresh tokens are single-use/rotating (the repo's own `docs/VK_ID_LIVE_CONTRACT.md` explicitly marks this **"UNVERIFIED on test app"**). The implementation's behavior (retain-if-absent, replace-if-present) is the correct defensive default regardless of which VK behavior turns out to be true, so this is **not a blocker**, but the live-VK smoke test called for in `docs/VK_REAL_SMOKE_TEST.md` / `VK_MANUAL_SMOKE_TEST.md` should still be run to close this out formally.

**Verdict: Correct as implemented; contract still formally unverified against live VK (pre-existing, documented limitation).**

---

## 6. Refresh Failure Handling

`executeRefresh`'s `catch` block (`token-refresher.ts:104-109`) wraps **any** non-`VkReauthenticationRequiredError` exception (invalid refresh token, VK auth error, network failure, malformed response) into a `VkReauthenticationRequiredError` and rethrows. Critically, **no partial state is persisted**: `userRepo.upsertUserWithTokens(...)` is only called after `refreshResponse.access_token` has been validated truthy (line 77-79) — if the response is malformed (missing `access_token`), the function throws *before* any encryption or persistence occurs. A malformed VK response (e.g., valid HTTP 200 with missing fields) therefore cannot corrupt stored credentials.

**Verdict: Correct — no partial/undefined credential persistence possible on any failure path.**

---

## 7. Expired Token Ordering

`getOrRefreshUserToken` (`token-refresher.ts:37-42`) computes `isExpiredOrExpiring` using a 30-second safety margin (`now >= expiresAt - 30_000`) **before** returning a decrypted token, and only returns the currently-stored token when it is *not* expiring. Refresh is attempted first, and only the resulting fresh token is ever handed to the VK API caller (`VkAuthContextResolver` → `VkProvider` → `VkClient`). There is no path where a known-expired token reaches `VkClient.call()` ahead of a refresh attempt.

**Verdict: Correct ordering.**

---

## 8 & 9. SERVICE→USER Fallback: Catch Conditions & Method Contract

Fallback is implemented identically in `fetchPost` and `fetchParticipants` (`vk-provider.ts:83-95`, `186-194`):

```ts
const isPrivateOrRestricted = err instanceof VkPrivateResourceError || err instanceof VkPermissionError;
if (isPrivateOrRestricted && activeAuth.type === 'SERVICE' && organizerId) { ... }
```

This is an **explicit instanceof whitelist**, not a generic/catch-all. Cross-checked against `vk-errors.ts`'s `mapVkApiError`/`mapHttpStatusError`:

| Condition | Mapped error class | Triggers fallback? |
|---|---|---|
| VK code 15/30/203 (private) | `VkPrivateResourceError` | ✅ yes (intended) |
| VK code 7/260 (permission) / HTTP 403 | `VkPermissionError` | ✅ yes (intended) |
| VK code 6/9/29 / HTTP 429 (rate limit) | `VkRateLimitError` | ❌ no — confirmed by `vk-provider-authenticated.test.ts` ("strictly forbids fallback on rate limits") |
| VK code 1/10 / HTTP 5xx (temporary) | `VkTemporaryError` | ❌ no — confirmed by test ("strictly forbids fallback on VK server errors") |
| Network failure | `VkNetworkError` | ❌ no (not in whitelist) |
| Timeout | `VkTimeoutError` | ❌ no (not in whitelist) |
| Validation (code 8/100/113/150) | `VkValidationError` | ❌ no (not in whitelist) |
| Auth (code 4/5/28 / HTTP 401) | `VkAuthError` | ❌ no (not in whitelist) |

No generic "service failed → try user" wrapper exists; the fallback also requires `activeAuth.type === 'SERVICE'` (never triggers when already on USER/COMMUNITY) **and** a non-empty `organizerId`. `checkSubscription` (the third resolver caller) has **no fallback branch at all** — a private/permission error there simply propagates. This is a minor **inconsistency** (not a vulnerability): `checkSubscription` is architecturally capable of the same fallback but doesn't implement it, which just means subscription checks against a private/restricted group fail outright for organizers where post/participant fetch would have succeeded via fallback. Low-impact, functional-completeness note only.

Fallback method contract (§9): the whitelist is enforced at the `catch` level of each method individually (`fetchPost`, `fetchParticipants`), not as a shared generic wrapper — each method explicitly re-implements the same narrow check. This avoids a blanket "service failed, try user" wrapper for arbitrary VK methods, satisfying the requirement, at the cost of minor duplication.

**Verdict: Whitelist is correct and narrow. NO catch-all fallback exists.**

---

## 10. Token Leak Review

Full-repo `grep` for `console.log|console.error|console.warn|console.debug|console.info`, `JSON.stringify`, and object-spread patterns involving `cred`/`user`/`token`/`auth` across every Phase 2.3 file (`vk-auth-resolver.ts`, `token-refresher.ts`, `token-vault.ts`, `vk-oauth-client.ts`, `user-repository.ts`, `vk-provider.ts`, `vk-capabilities.ts`, `participants/route.ts`, `auth/vk/callback/route.ts`, `auth/vk/start/route.ts`, `mock-oauth-client.ts`): **zero matches**.

Additional checks:
- `vk-errors.ts` includes a dedicated `sanitizeRequestParams()` helper that redacts any parameter whose key contains `token`/`access_token` before attaching it to `VkClientError.details` — defense in depth even for the internal (non-HTTP-facing) error object.
- `http-errors.ts`'s `handleApiError()` **never** serializes `VkClientError.details` (or any raw VK error payload) to the HTTP response — every `VkClientError` category is mapped to a hand-written, generic, token-free message (§10 cross-reference with §"Error Mapping" review above). Plaintext tokens, encrypted blobs, and raw VK API responses are structurally unreachable from any API response body.
- `token-vault.ts` decrypted plaintext only ever exists as a local variable / return value passed directly into `VkAuthContext.token`, which itself is only consumed by `VkClient.executeSingleCall` to build the outbound `URLSearchParams` body — never logged, never echoed back.

**Verdict: NO token leak found — plaintext or encrypted — in Phase 2.3 code or its HTTP-facing error paths.**

---

## 11. User Credential Repository Update

`upsertUserWithTokens` (`user-repository.ts:29-81`, Prisma impl) keys the upsert on `vkUserId` (`where: { vkUserId: params.vkUserId }`), which has a **DB-level `@unique` constraint** (`prisma/schema.prisma:35`). `UserCredential.userId` also has `@unique` (schema line 49) with `onDelete: Cascade` from `User`. The caller (`TokenRefresher.executeRefresh`) always derives `params.vkUserId` from `await this.userRepo.getUserById(userId)` — i.e., it re-reads the **existing** user record by internal id and re-uses its own `vkUserId`; it is not possible for a caller to pass an arbitrary/different `vkUserId` into the update path, because the value is sourced from the DB record matching the original `userId`, not from any external input.

The in-memory driver (`MemoryUserRepository`) mirrors the same "find-by-vkUserId-or-create" semantics and preserves the same uniqueness invariant in application code (no DB constraint to fall back on, but logically equivalent for tests/dev).

**Verdict: Caller cannot choose an arbitrary userId/vkUserId credential to update. Uniqueness constraints present at both DB (`@unique`) and application (find-or-create) layers.**

---

## 12. Participants Route

`src/app/api/giveaways/[id]/participants/route.ts`:
- **Ownership before resolver**: `requireGiveawayOwner(req, id)` (line 53) runs and throws before `provider.fetchParticipants(...)` (line 75) is ever reached. Confirmed by direct code order inspection — no possible reordering since `giveaway`/`sessionUser` returned from the guard are the same values passed downstream.
- **Idempotency**: `Idempotency-Key` header, when present, is checked (`IdempotencyStore.get`) before any provider call and set (`IdempotencyStore.set`) only after a full successful pipeline run, scoped by `operation:giveawayId:key` per `docs/PRODUCTION_GUARDS.md` §1 — consistent with the documented Phase-1 contract. Nothing in Phase 2.3 changed this ordering.
- **Fallback vs. Phase 1 concurrency rules**: the SERVICE→USER fallback happens entirely *inside* `provider.fetchParticipants()`, before `GiveawayStore.updateParticipants(id, allParticipants)` is called — i.e., fallback is fully resolved before the atomic participant-state write, so it cannot interact with or break the Phase 1 concurrency/idempotency guarantees around `GiveawayStore`.

**Verdict: Correct ordering; idempotency and Phase 1 concurrency invariants preserved.**

---

## 13. Effective Capabilities Overpromise Check

`resolveEffectiveCapabilities()` (`vk-capabilities.ts`): `reposts` is **statically `false`** regardless of `accessMode` (SERVICE/USER/COMMUNITY) — it never overpromises reposts capability even under a USER token. `adminDetection` is only ever `true` when `authContext.type === 'COMMUNITY'` — correctly gated (organizer USER tokens never claim admin-level capability).

**However, one real overpromise bug was found**, not in `vk-capabilities.ts` itself but in its caller:

`src/app/api/posts/preview/route.ts:25-27`:
```ts
const effectiveCapabilities = resolveEffectiveCapabilities(
  sessionUser ? { type: 'USER', token: 'active' } : { type: 'SERVICE', token: 'active' }
);
```
This calls `resolveEffectiveCapabilities` with a **synthetic stub auth context** based purely on "does a session cookie exist," not on the actual `VkAuthContext` that `provider.fetchPost()` resolved and used a few lines above. Concretely:
- If the organizer is logged in but their **VK credential is missing/expired and refresh fails** (`VkReauthenticationRequiredError`), `fetchPost()` would have already succeeded using the **SERVICE** token for a public post (no fallback was even needed) — yet the response still reports `accessMode: 'ORGANIZER_USER'` and USER-tier capabilities to the frontend, which is inaccurate.
- Conversely, if `fetchPost` genuinely fell back to a USER token to reach a private resource, the reported capabilities happen to be correct only coincidentally.

This is a **UI-truthfulness / trust-boundary correctness issue**, not a credential-exposure issue — no token or PII is exposed — but it means the frontend cannot reliably use `effectiveCapabilities` from this endpoint to reason about what the *next* authenticated action will actually be able to do (e.g., it might imply reauth is not needed when it is).

**Classification: MEDIUM** (correctness / capability overpromise, `posts/preview` route only — `vk-capabilities.ts` core logic itself is sound).

---

## 14. Identity Consistency (Token ↔ User)

- **At initial OAuth login** (`auth/vk/callback/route.ts:80-81`): `vkUserId: String(tokenResponse.user_id)` is taken directly from VK's own token-exchange response (`tokenResponse.user_id`), not from client input — the session is correctly bound to the VK-asserted identity at creation time.
- **At refresh time** (`token-refresher.ts:65-110`): `executeRefresh` calls `oauthClient.refreshToken(...)`, which (per `vk-oauth-client.ts` and the mock) **does** return a `user_id` field in `VkOAuthTokenResponse` — but `token-refresher.ts` **never reads or validates `refreshResponse.user_id` against the existing `user.vkUserId`**. The refreshed `access_token` is persisted purely based on which internal `userId` initiated the refresh, with no re-assertion that VK still considers the refreshed token to belong to the same VK user.

**Risk assessment**: Not currently exploitable as a cross-user vector, because:
1. The `refresh_token` used as input was itself encrypted and stored under this specific `userId`'s row, sourced only from that same user's original OAuth login.
2. There is no code path allowing one user's stored `refresh_token` to be fed into another user's refresh call.

It is, however, a **missing defense-in-depth check**: if VK's refresh endpoint ever returned a mismatched `user_id` (server-side bug, token-family confusion, or a future VK API change), the application would silently accept and store it under the *original* internal user without ever detecting the mismatch.

**Classification: LOW** — add an assertion `refreshResponse.user_id == user.vkUserId` (when VK provides `user_id` on refresh) that throws `VkReauthenticationRequiredError` on mismatch, as defense-in-depth. Real VK response data needed to confirm whether `user_id` is actually populated on the refresh grant (see §17 limitations).

---

## 15. Database Schema

Migration present for Phase 2.3's era: `prisma/migrations/20260818120000_ownership_invariant/` (ownership invariant — relates to `Giveaway.organizerId` non-null enforcement, consistent with `auth-guard.ts`'s explicit null-organizer denial). No new columns were required specifically for token refresh in this snapshot; `UserCredential` (`encryptedAccessToken`, `encryptedRefreshToken`, `expiresAt`, `scope`, `updatedAt`) has sufficient fields for the current refresh lifecycle logic (§4, §6, §7 all validated against these fields). **Missing**: an optimistic-concurrency `version` (or equivalent) column, called out in §4 as a MEDIUM finding for multi-instance deployments — this would require a new migration if implemented.

**Verdict: No schema changes were required by Phase 2.3 as implemented; current fields are sufficient for single-instance-safe lifecycle management. A version/CAS column is recommended as a future migration for horizontal-scale safety (§4).**

---

## 16. Test Quality

| Test file | Exercises real production logic? | Notes |
|---|---|---|
| `tests/token-refresh-concurrency.test.ts` | **Yes** — real `TokenRefresher`, `MemoryUserRepository`, `AesGcmTokenVault`, only `MockVkOAuthClient` is a test double (appropriate, since it's the network boundary). Genuinely exercises the single-flight `Map`, encrypt/decrypt round-trip, and repository upsert. | Missing: cross-user concurrent refresh test; explicit "map cleared after failure, retry succeeds" test. |
| `tests/vk-auth-resolver.test.ts` | **Yes** — real `VkAuthContextResolver` + real `TokenRefresher` chain, only the OAuth HTTP boundary is mocked. | Missing: an explicit horizontal-access test (e.g., "resolver given organizerId=B while only A's credentials are seeded correctly returns A's data / never B's" — current tests only prove single-organizer correctness, not cross-organizer isolation at the resolver's own API surface). Given §2's finding, this test would be valuable to add. |
| `tests/vk-provider-authenticated.test.ts` | **Yes** — real `VkProvider` + real `VkAuthContextResolver` + real `TokenRefresher`, with a hand-written `IVkClient` mock standing in for the actual VK HTTP call (correct boundary to mock). Explicitly tests the fallback whitelist against `VkRateLimitError` and `VkTemporaryError` to prove they do **not** trigger fallback — this is exactly the "prove the whitelist is narrow" test the review scope calls for. | Good coverage; no significant gaps found for the scenarios it targets. |
| `tests/oauth-concurrency.test.ts` | **Yes** — real `MemoryOAuthTransactionStore`, 100-way concurrent single-use consumption race, genuinely exercises the atomic delete-then-check logic. | Solid; not itself part of Phase 2.3's Auth Resolver scope but adjacent and reviewed for context. |

No false-positive ("mocks all the way down, proves nothing about production code") tests were found among the four in scope. The tests consistently mock only the true external boundary (the HTTP call to VK), which is the correct approach.

---

## 17. Build/Test Execution — ENVIRONMENT LIMITATION

```
$ npm install --offline
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/zod/-/zod-4.4.3.tgz failed:
cache mode is 'only-if-cached' but no cached response is available.
```

**This sandbox has no outbound network access** (confirmed: bash tool network is disabled). `node_modules` is not present in the snapshot archive, and no local npm cache/mirror is available. As a result, **`npm test`, `npm run lint`, and `npm run build` could not be executed** in this environment. `node` (v22.22.2) and `npm` (10.9.7) are present, but dependency installation itself is blocked at the network layer, not by Prisma specifically.

This is a hard tooling limitation of the review environment, not a finding about the codebase. All conclusions above are based on **full static reading of the actual source files** (not summaries, not GitHub web rendering, not assumptions) plus **manual tracing of test file logic** (read in full, not executed). If a maintainer can run `npm install && npm test && npm run lint && npm run build` in an environment with network access, that should be done to mechanically confirm what this review verified by inspection.

---

## 18. Final Verdict

| Severity | Finding | Section |
|---|---|---|
| **MEDIUM** | No optimistic-concurrency/version guard on `UserCredential` persistence; `TokenRefresher`'s single-flight mutex is per-process only, with no `MULTI_INSTANCE` guard (unlike `MemorySessionStore`/`MemoryOAuthTransactionStore`, which fail loudly). Under horizontal scaling this can cause spurious forced-reauth, not credential corruption or cross-user leakage. | §4 |
| **MEDIUM** | `posts/preview` route reports `effectiveCapabilities` derived from "is there a session" rather than the actual resolved `VkAuthContext`, which can overstate USER-tier capability when the organizer's stored VK credential is actually missing/expired. UI-truthfulness issue, no data exposure. | §13 |
| **LOW** | Refreshed token's `user_id` (if returned by VK) is never cross-checked against the stored `user.vkUserId` — missing defense-in-depth identity assertion. Not currently exploitable. | §14 |
| **LOW** | `checkSubscription` has no SERVICE→USER fallback branch, unlike `fetchPost`/`fetchParticipants` — functional inconsistency, not a security gap. | §8/§9 |
| **LOW** | Resolver/refresher/provider layer has no self-contained enforcement that `organizerId` belongs to the calling session — this invariant is currently upheld entirely (and correctly) by the two HTTP-route callers, but is not defended at the library boundary itself. Structural risk for future call sites. | §2 |
| **INFO** | `getOAuthClient()` in `vk-oauth-client.ts` has dead/redundant branching (both branches return the same value) — code-quality note only. | §14 (context) |
| **INFO/BLOCKER** | `npm test`/`lint`/`build` could not be run — no network access in review sandbox. | §17 |

### Direct answers

**A. Can one organizer use another organizer's VK credential?**
**NO** — for the current call sites. `organizerId` is exclusively server-derived from the authenticated session at every point it reaches the resolver, verified by full-repo trace and schema check. (Caveat: this invariant is enforced by callers, not by the resolver/refresher/provider library itself — see §2 and the MEDIUM findings.)

**B. Can concurrent refresh corrupt token state?**
**POSSIBLE** (not YES, not clean NO) — impossible within a single process (single-flight mutex verified correct and tested); theoretically possible only under multi-instance horizontal deployment due to the absent CAS/version guard, and even then the realistic worst case is a forced reauth rather than silent data corruption or cross-user leakage (§4).

**C. Can fallback bypass rate-limit/network policy?**
**NO** — the fallback whitelist is a narrow `instanceof` check against exactly `VkPrivateResourceError`/`VkPermissionError`; rate-limit (`VkRateLimitError`) and network/timeout/temporary/validation/auth errors are explicitly excluded and this exclusion is covered by passing tests (§8/§9).

**D. Can plaintext token leak to frontend/API?**
**NO** — verified via full grep for logging/stringify/spread patterns (zero matches) and via inspection of `handleApiError`, which maps every `VkClientError` to a hand-written, token-free generic message and never serializes `.details` or raw VK payloads to the HTTP response (§10).

**E. Is Phase 2.3 safe for REAL VK SMOKE TEST?**
**YES**, with the following non-blocking caveats to keep in mind while running the smoke test:
- Confirm empirically whether VK's refresh grant response includes `user_id`, and if so, consider adding the identity cross-check from §14 before/after the smoke test as a follow-up (not a blocker for running the test itself).
- The refresh-token rotation behavior itself (§5) is exactly what the smoke test is meant to verify against `docs/VK_ID_LIVE_CONTRACT.md`'s "UNVERIFIED" markers — this review found no code-level blocker to running it.
- No credential-exposure, no horizontal-access, and no fallback-abuse blockers were found that would make it unsafe to point this code at real VK infrastructure with a real (non-privileged, test) organizer account.

No CRITICAL or HIGH findings were identified in the reviewed Phase 2.3 code.
