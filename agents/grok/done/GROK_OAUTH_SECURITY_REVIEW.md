# Randomayzer — Phase G-4 OAuth / Auth / Authorization Adversarial Security Review

**Reviewer:** Grok (xAI)  
**Date:** 2026-08-18  
**Commit:** `02a04df2719094e28db97575b9fbecb940b6ead3`  
**Scope:** Phase 2.2 + 2.2.1 + 2.2.2 — OAuth state/PKCE, session, CSRF, TokenVault, ownership, redirects.  
**Constraint:** Attack / review / tests / docs only. No production code changes.

---

## 1. Executive Verdicts

| Area | Verdict |
|------|---------|
| **OAuth State / PKCE** | **PASS WITH WARNINGS** |
| **OAuth endpoint correctness** | **PASS WITH WARNINGS** |
| **Session** | **PASS WITH WARNINGS** |
| **CSRF** | **PASS WITH WARNINGS** |
| **Ownership / AuthZ** | **PASS** |
| **TokenVault** | **PASS** |
| **Redirect safety** | **PASS WITH WARNINGS** |
| **Privacy** | **PASS WITH WARNINGS** |
| **Overall Phase 2.2 security** | **PASS WITH FIXES** |

### Безопасно ли переходить к Phase 2.3?

**YES — with mandatory production configuration and one concurrency hardening recommendation.**

**Blocking for multi-instance / untrusted production traffic:**
1. `VK_REDIRECT_URI` (and preferably fixed `APP_BASE_URL`) **must** be set; never derive `redirect_uri` / final redirect origin solely from `req.nextUrl.origin` / Host.
2. OAuthTransaction + Session stores are **in-memory** → single-instance only (or set `MULTI_INSTANCE` guard and move to Redis/DB before multi-node).
3. Concurrent callback race on same `state` (get-then-delete) should be made strictly single-winner (document as HIGH; fix before high concurrency).

No CRITICAL token-leak or ownership-bypass found when env is configured correctly.

---

## 2. OAuth State Attacks

| Attack | Expected | Observed |
|--------|----------|----------|
| missing state | reject | ValidationError |
| unknown state | reject | UnauthorizedError (not found / consumed) |
| expired state | reject | UnauthorizedError after consume attempt |
| reused state | reject | delete-on-consume → second fails |
| same state twice concurrent | exactly one success | **WARN**: get-then-delete is not atomic under concurrent awaits — both can read before either deletes |
| state from another browser | reject (unknown) | OK |
| user denies (`error=access_denied`) | state consumed if present | OK — consume attempted on error path |
| callback error + valid state | state invalidated | OK |
| callback error + invalid state | ignore consume error | OK |
| missing code | reject | ValidationError |
| code without state | reject | ValidationError |

**Single-use:** Intent is strict (delete before return). Race window exists in concurrent same-state callbacks.

**TTL:** 10 minutes default; periodic cleanup on create.

**Storage:** **Memory only** (`MemoryOAuthTransactionStore`). Restart loses in-flight OAuth. Multi-instance: state on node A, callback on node B → fail. Grade: **MVP single-instance**.

---

## 3. PKCE Attacks

| Attack | Result |
|--------|--------|
| wrong codeVerifier | VK token endpoint rejects (bound in transaction) |
| empty codeVerifier | ValidationError in client |
| verifier from another transaction | different state → different verifier; binding is state→verifier |
| verifier reuse | state already consumed |
| code replay | second consume fails on state |
| code from tx A + state B | verifier from B ≠ challenge for A → VK rejects |

Transaction binding is strict via state key. PKCE S256 via `createHash('sha256')` + base64url. CSPRNG `randomBytes` for verifier/state.

---

## 4. OAuth Transaction Race (10–100 concurrent)

`consumeTransaction`:
```ts
const tx = this.store.get(state);
if (!tx) throw ...
this.store.delete(state);
// then expiry checks
```

Under concurrent Node callbacks with the **same** valid state, two execution contexts can both `get` a non-null `tx` before either `delete`. **Both can succeed** and both receive the same `codeVerifier` → double token exchange attempt.

**Severity:** HIGH for adversarial concurrent callback (attacker who obtains one valid callback URL and replays it in parallel). Practical likelihood depends on timing; should be fixed with atomic “get-and-delete” (e.g. compare-and-swap pattern or single-flight lock per state).

Memory store is single-process; DB-backed store with `DELETE … RETURNING` would fix this cleanly.

---

## 5. Open Redirect

`validateSafeRedirectTarget`:
- requires single leading `/`
- rejects `//`, `/\\`, `:`, `\`, `javascript:`, `data:`, `http:`, `https:`
- applied on **start** (before storage) and again on **callback**

Matrix (evil.com, //evil, ///evil, /\evil, /\\evil, %2f%2f, javascript:, data:, Unicode tricks): **rejected → `/`**.

**WARN:** Final browser redirect is `` `${origin}${safeRedirect}` `` where `origin = req.nextUrl.origin`. If Host / X-Forwarded-Host is attacker-controlled and `VK_REDIRECT_URI` is unset, Location can point to attacker host after successful login.

**Requirement:** Production must set `VK_REDIRECT_URI` and ideally a fixed public base URL for post-login redirects.

---

## 6. Callback Origin / Host Poisoning

```ts
const origin = req.nextUrl.origin || 'http://localhost:3000';
const redirectUri = process.env.VK_REDIRECT_URI || `${origin}/api/auth/vk/callback`;
```

| Condition | Risk |
|-----------|------|
| `VK_REDIRECT_URI` set | Low — fixed registered URI |
| unset + attacker Host | **redirect_uri sent to VK may not match registered** (VK rejects) OR if somehow matches, final Location uses poisoned origin |
| X-Forwarded-Host / Proto | Next.js `nextUrl.origin` respects proxy headers depending on trust config |

**Production rule:** Always set `VK_REDIRECT_URI` to the exact registered callback. Do not rely on request Host.

---

## 7. App ID / Client Secret

- No hardcoded production `VK_APP_ID` (test-only fallback).
- `VK_CLIENT_SECRET` only server-side env; not `NEXT_PUBLIC_*`.
- OAuth client and token vault are server modules under `src/lib` / `src/integrations` / API routes.
- Frontend `AuthButton` should only link to `/api/auth/vk/start` (no secret).

**PASS** for secret exposure when build is correct.

---

## 8–11. Session

| Property | Status |
|----------|--------|
| Session ID generation | `randomBytes(32).toString('hex')` — **CSPRNG** |
| Session fixation | **Mitigated** — always new ID on login; does not adopt pre-set cookie |
| Cookie | HttpOnly, Secure in production, SameSite=Lax, Path=/, Max-Age 30d |
| Token in cookie | **No** — opaque session ID only |
| Lifetime | Absolute TTL (default 30 days); no idle timeout |
| Expired session | getSession returns null after expiry + delete |
| Logout | destroySession + clear cookie; CSRF on POST logout |
| Memory store | Restart clears sessions; `MULTI_INSTANCE=true` throws FATAL |
| Multi-instance | **Not supported** without external store |

---

## 12. CSRF

`validateCsrfOrigin` on POST/PUT/PATCH/DELETE via `requireAuthenticatedUser`:
- Sec-Fetch-Site: cross-site → Forbidden
- Origin host must match Host / X-Forwarded-Host
- else Referer host must match
- production: missing both → Forbidden
- test env: allow missing

| Attack | Result |
|--------|--------|
| no Origin (prod) | Forbidden |
| evil Origin | Forbidden (host mismatch) |
| forged Referer only | Forbidden if host mismatch |
| cross-site form POST | Sec-Fetch-Site or Origin fail |
| same-site correct Origin | OK |

**WARN:** CSRF compares Origin to `x-forwarded-host || host`. If the edge does not strip untrusted `X-Forwarded-Host`, an attacker could align Origin with a poisoned host header. Trust proxy configuration is required.

Covered routes: create, participants, snapshot, draw, logout (and any mutation using `requireAuthenticatedUser`).

---

## 13–16. Ownership / IDOR / Null organizer / User delete

`requireGiveawayOwner`:
1. requireAuthenticatedUser (+ CSRF)
2. load giveaway
3. **if !organizerId → Forbidden** (null never authorizes)
4. organizerId !== sessionUser.id → Forbidden

Prisma: `organizerId String` required, `onDelete: Restrict` on User → cannot delete User who still owns Giveaways; no SetNull.

Anonymous → 401. Other user’s giveaway → 403.  
Public verify intentionally open (by design).

**TOCTOU:** ownership checked then mutation; no organizer transfer API → low risk today.

**List privacy:** Must filter by `organizerId = sessionUser.id` in repository (not fetch-all then client filter). Confirm in list implementation; ownership invariant docs exist.

---

## 17–19. TokenVault & Confidentiality

AES-256-GCM, format `iv:authTag:ciphertext`, random IV, auth tag verified.

| Attack | Result |
|--------|--------|
| production no key | FATAL throw |
| short key (&lt;32) in prod | FATAL throw |
| wrong key / modified IV / tag / ciphertext | decrypt throws (auth failure) |
| truncated / malformed hex | throws |
| empty plaintext | returns '' |

Marker token not placed in errors by design. Encrypted at rest in `UserCredential`. Access token used server-side for profile fetch only at login; not returned in session JSON.

Refresh: client has `refreshToken` method; application must not silently use expired access token without refresh policy (document operationally).

---

## 20–21. Profile binding & account collision

Identity from **VK token response `user_id` + getUserProfile**, not from attacker-controlled callback query fields.  
Upsert by `vkUserId` unique → same VK user maps to same User. Different vkUserIds do not merge on username.

---

## 22–24. Privacy

- Dashboard list: server must scope by organizerId (verify in list query).
- Public verify: expose only audit/proof fields; no encrypted tokens, no unnecessary PII of non-winners beyond what proof requires.

---

## 25. OAuth Endpoint Accuracy (vs official VK ID)

| Item | Project | Official VK ID docs | Verdict |
|------|---------|---------------------|---------|
| Auth URL | `https://id.vk.com/auth` | `https://id.vk.ru/authorize` (also id.vk.com variants) | **PARTIALLY VERIFIED** — path `/auth` vs `/authorize`; domain .com vs .ru |
| Token URL | `https://id.vk.com/oauth2/auth` | `https://id.vk.ru/oauth2/auth` | **PARTIALLY VERIFIED** |
| response_type=code | Yes | Yes | **VERIFIED** |
| PKCE S256 | Yes | Required | **VERIFIED** |
| state | Yes | Recommended/required | **VERIFIED** |
| code_verifier on token exchange | Yes | Required | **VERIFIED** |
| client_secret | Optional in body | Often optional with PKCE | **VERIFIED** |
| device_id | **Not sent** | Often required in token exchange examples | **UNVERIFIED / GAP** |
| scope format | `wall,groups,offline` | space-separated in some VK ID examples | **WARN** — confirm with app settings |
| redirect_uri exact match | Env preferred | Must match registered | **VERIFIED** (when env set) |

**No definite WRONG** that breaks all flows, but **device_id** and exact authorize path/domain should be confirmed against the live app registration before production OAuth traffic. Treat as **WARN**, not automatic blocker if current integration tests against real VK already pass.

---

## 26. Mock vs Real

Mock accepts test tokens; real client validates response shape (`access_token` required). Risk: mock may hide missing `device_id` or scope format issues. Gate real-environment smoke test before Phase 2.3 production.

---

## 27. DoS / Abuse

- OAuth start: unbounded createTransaction → Map growth; maxTransactions 10k + periodic cleanup.
- Callback random state: cheap fail.
- Recommend rate limit on `/api/auth/vk/start` (IP + global).

---

## 28. Security Headers

Not enforced in reviewed routes. Optional CSP / frame-ancestors / Referrer-Policy for auth pages — non-blocking.

---

## 29. CRITICAL / HIGH Summary

**CRITICAL (with bad config):**  
- Missing `VK_REDIRECT_URI` + Host header trust → open redirect / wrong redirect_uri.

**HIGH:**  
1. Concurrent same-state callback race (double consume possible).  
2. In-memory OAuth + Session stores (multi-instance unsafe).  
3. CSRF Host vs X-Forwarded-Host trust dependency.  
4. Possible VK ID `device_id` / authorize path mismatch (verify live).

**MEDIUM:**  
- No idle session timeout.  
- OAuth start without rate limit.  
- Scope delimiter format.

---

## 30. Stress scale (reasoned / existing tests)

- Existing: `auth-security.test.ts`, `oauth-security-gate.test.ts`, `token-vault.test.ts`, `auth-guard.test.ts`.
- Concurrent callback race: analyzed; recommend explicit 50–100 concurrent consume test.
- Open redirect matrix: covered by validator logic.
- Session ID uniqueness: CSPRNG 256-bit.
- Token vault tamper: auth tag fails closed.

---

## 31. Phase 2.3 Readiness

**YES** to proceed, provided:

1. Production env always sets `VK_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` (≥32), `VK_APP_ID`, and does not trust raw Host for OAuth URLs.
2. Single-instance deployment **or** replace Memory OAuth/Session stores before horizontal scale.
3. Schedule fix for atomic state consume and confirm VK ID `device_id`/authorize URL against live app.

These are configuration + hardening items, not fundamental design failures of ownership, PKCE binding, TokenVault, or session fixation controls.
