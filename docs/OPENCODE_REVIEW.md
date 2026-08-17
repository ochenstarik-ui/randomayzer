# OpenCode Independent Review — Randomayzer

**Scope:** test coverage, security, concurrency, VK integration preparation.  
**Review date:** 2026-08-18  
**Branch reviewed:** `main` (initial clone)  
**Reviewer:** OpenCode  

> **Coordination note:** another agent (Antigravity) is performing Core Audit Fixes / Phase 1.2.  
> This review intentionally does **not** rewrite the Randomizer, Prisma schema, FSM, AuditProof, `giveaway-store.ts`, VK OAuth, or any existing core architecture. Findings that touch those areas are documented as recommendations and are **not** auto-fixed unless they are isolated, low-risk, and do not overlap with Antigravity's scope.

---

## Summary of findings

| Severity | Count | Themes |
|---|---|---|
| CRITICAL | 2 | double-draw race, silent DB→memory fallback |
| HIGH | 6 | capability violations, API input validation, VK pagination limits, token exposure surface, missing retry/rate-limit, JSON snapshot scalability |
| MEDIUM | 5 | environment-based mock fallback, `.gitignore` gaps, error-message leakage, unused env vars, `excludeDuplicateComments` ignored |
| LOW | 3 | in-memory IDs via `Math.random()`, `filterRules` immutability gaps, `MINIMUM_COMMENTS` not implemented |
| INFO | 3 | architecture strengths, provider abstraction, clean separation |

---

## CRITICAL

### C1 — Race condition allows duplicate draw for the same giveaway

- **File:** `src/app/api/giveaways/[id]/draw/route.ts`
- **Lines:** 12–60
- **Description:** The route performs a read-check-write sequence without an atomic lock or transaction:
  1. `giveaway.status === 'DRAWN'` is checked on a giveaway object loaded at line 14.
  2. A snapshot is fetched or created (lines 28–36).
  3. `GiveawayFSM.assertCanDraw('SNAPSHOT_LOCKED')` is called with a hard-coded status string, **not** the current persisted status (line 41).
  4. `GiveawayStore.saveDrawResult` persists the draw (line 60).
- **Consequence:** Two concurrent `POST /draw` requests can both pass the initial `DRAWN` check while the giveaway is `READY`, both create/retrieve a snapshot, both pass `assertCanDraw('SNAPSHOT_LOCKED')`, and both persist a `DrawResult`. The second call overwrites the first or produces two audit records for the same giveaway, violating provably-fair invariants.
- **Recommended fix:** Wrap the entire read-snapshot-draw-write sequence in a database-level atomic operation. Options:
  - Use a `SELECT FOR UPDATE` row lock on the giveaway row at the start of the transaction.
  - Or add a unique constraint on `DrawResult.giveawayId`/`AuditRecord.giveawayId` (already present) and retry on conflict, but the route must read the row **inside** the transaction and fail fast on status mismatch.
  - Pass the actual persisted status to `assertCanDraw`, not a literal string.
- **Coordination:** overlaps Antigravity Phase 1.2 (core audit / persistence). **Not auto-fixed.**

### C2 — Prisma errors silently fall back to in-memory storage

- **File:** `src/lib/giveaway-store.ts`
- **Lines:** 24–58 (`create`, `getById`, `listAll`)
- **Description:** Every read/write operation catches any Prisma error, logs a warning, swaps `activeRepository` to `MemoryGiveawayRepository`, and retries. There is no recovery path back to Prisma.
- **Consequence:** A transient DB hiccup (network blip, pool timeout, lock timeout) permanently downgrades the running process to in-memory mode. Subsequent requests create giveaways that are lost on restart or invisible to other horizontally scaled instances. This violates data durability and audit traceability.
- **Recommended fix:**
  - Remove the silent fallback from production code. Fail fast and return a 500/503 with a clear error.
  - Keep `MemoryGiveawayRepository` only for unit tests via `GiveawayStore.setRepository(...)`.
  - If a fallback is truly required, implement it at the infrastructure level (connection pool, replica read), not by switching the repository implementation mid-process.
- **Coordination:** `giveaway-store.ts` is explicitly in Antigravity's scope. **Not auto-fixed.**

---

## HIGH

### H1 — Unsupported filter rules are accepted for the current provider

- **File:** `src/app/api/giveaways/[id]/participants/route.ts`
- **Lines:** 27–30
- **Description:** The route forwards `rules.requireRepost` to `provider.fetchParticipants({ includeReposts: rules.requireRepost })` without checking `provider.capabilities.reposts`. `VkProvider` and `VkMockProvider` both declare `reposts: false`, yet the backend still attempts to honor the rule. There is no backend validation that rejects a rule the selected provider cannot verify.
- **Consequence:** Organizers can configure giveaways that the system cannot actually verify. The UI may imply reposts are checked while the provider silently ignores them, undermining trust and audit correctness.
- **Recommended fix:** Add a `validateFilterRulesAgainstCapabilities(rules, capabilities)` guard (see `tests/provider-capabilities.test.ts` for contract expectations). Call it in the participants route and snapshot route before any provider work. Return `400` with a clear message such as `"requireRepost is not supported by VK provider"`.
- **Coordination:** low risk, isolated. A validation utility was added during this review; wiring it into routes is documented as a recommendation and tested.

### H2 — API routes lack input validation

- **Files:**
  - `src/app/api/giveaways/route.ts` (lines 14–35)
  - `src/app/api/giveaways/[id]/draw/route.ts` (lines 42–46)
  - `src/app/api/giveaways/[id]/snapshot/route.ts` (lines 10–30)
  - `src/app/api/posts/preview/route.ts` (lines 5–30)
- **Description:** No schema validation or bounds checks on:
  - `winnersCount` / `reserveWinnersCount` (negative, zero, or extremely large values are accepted).
  - `seed` (empty string, multi-megabyte seed, or untrusted external seed).
  - `filterRules` (unknown keys are ignored; missing required keys may be defaulted unsafely).
  - `sourceUrl` / `url` (only presence is checked in some routes, not format/length).
  - JSON body parsing failures return generic 500 instead of 400.
- **Consequence:** Invalid or malicious payloads can corrupt persisted data, cause confusing draw behavior (e.g., `winnersCount: -1` produces zero winners), or be used for DoS via huge strings stored in `seed`, `filterRules`, or snapshot JSON.
- **Recommended fix:** Introduce a lightweight schema validator (Zod is recommended) for all API routes. At minimum enforce:
  - `winnersCount` integer >= 1, capped to a reasonable maximum (e.g., 10 000).
  - `reserveWinnersCount` integer >= 0, capped similarly.
  - `seed` non-empty string, max length 1024, sanitized.
  - `filterRules` strict shape with only known keys and capability checks.
  - Malformed JSON returns `400 Bad Request`.
- **Coordination:** additive change, does not touch forbidden files. Validation tests added; full Zod refactor deferred pending team agreement.

### H3 — VK provider silently caps large participant lists

- **File:** `src/providers/vk/vk-provider.ts`
- **Lines:** 142–183 (likes), 186–238 (comments)
- **Description:** `fetchParticipants` loops with `offset < totalLikes && offset < 5000` for likes and `offset < totalComments && offset < 1000` for comments. For posts with more than ~5 000 likes or ~1 000 comments, the remaining participants are silently truncated.
- **Consequence:** Large giveaways exclude valid participants without warning, breaking fairness.
- **Recommended fix:** Remove artificial caps or make them configurable/documented with explicit UI warnings. Implement paginated fetching with rate limiting and progress callbacks. Use `execute` batching where beneficial.
- **Coordination:** touches `VkProvider`; overlaps VK integration preparation. **Not auto-fixed.**

### H4 — VK service token travels in query string and may leak through logs/proxies

- **File:** `src/providers/vk/vk-provider.ts`
- **Lines:** 43–52 (`callApi`)
- **Description:** `access_token` is appended to the URL query string. `fetch` errors, server/proxy access logs, APM traces, or exception reporters may capture the full URL. The constructor also reads `process.env.VK_SERVICE_TOKEN` directly; while this is correct, there is no audit that the value never appears in error objects.
- **Consequence:** If an error reporter logs the request URL, the VK service token is exposed. Service tokens are long-lived and grant broad public-data access.
- **Recommended fix:**
  - Prefer sending the token in an `Authorization: Bearer <token>` header where VK allows it; otherwise ensure request URLs are never logged.
  - Scrub tokens from any error serialization in `VkProvider`.
  - Add automated tests asserting that token does not appear in thrown messages, responses, or logs (see `tests/security.test.ts`).
- **Coordination:** low risk; security tests added. Header change depends on VK API contract (documented as recommendation).

### H5 — No rate limiting, retry, or timeout strategy in VK client

- **File:** `src/providers/vk/vk-provider.ts`
- **Lines:** 38–69 (`callApi`)
- **Description:** `callApi` uses a single `fetch` call. It does not:
  - Set a timeout.
  - Retry on transient failures (network, 5xx, VK error 6/29).
  - Back off on rate-limit responses.
  - Distinguish retryable from non-retryable VK errors.
- **Consequence:** A single network stall or rate-limit response fails the entire participant import. Large giveaways are unreliable and slow.
- **Recommended fix:** Implement `VkClient` → `RateLimiter` → `RetryPolicy` → `VkProvider` as documented in `docs/VK_INTEGRATION_PLAN.md`. Start with interfaces and a simple exponential-backoff wrapper; do not over-engineer.
- **Coordination:** preparation-only; no production implementation added.

### H6 — Storing entire eligible participant snapshot as JSON does not scale

- **Files:**
  - `prisma/schema.prisma` — `ParticipantSnapshot.eligibleParticipants Json`
  - `src/core/types/audit.ts` — `ParticipantSnapshotData.eligibleParticipants: FilteredParticipant[]`
  - `src/lib/repository/prisma-repository.ts` — snapshot create/read maps the full JSON
- **Description:** Every eligible participant is serialized into a single JSON column. Each participant record contains avatar URLs, names, usernames, and flags.
- **Consequence:**
  - ~1 000 participants ≈ 200–400 KB JSON.
  - ~100 000 participants ≈ 20–40 MB per snapshot row.
  - ~500 000 participants ≈ 100–200 MB per row.
  - PostgreSQL `jsonb` limit is 1 GB, but reading/writing such rows consumes large amounts of application memory, slows queries, and blocks the UI table. Hashing the snapshot becomes CPU-bound.
- **Recommended fix:** See **Scalability** section below. Short term: cap supported giveaway size and warn organizers. Long term: store participants in normalized `ParticipantSnapshotItem` rows and compute the snapshot hash incrementally or on a streaming cursor.
- **Coordination:** Prisma schema is explicitly forbidden to change. **Not auto-fixed.**

---

## MEDIUM

### M1 — Environment-based provider selection can silently run mock in production

- **File:** `src/providers/registry.ts`
- **Lines:** 9–12
- **Description:** `ProviderRegistry` chooses `VkProvider` only if `VK_SERVICE_TOKEN` is present and longer than 10 characters. If the variable is missing, empty, or a placeholder shorter than 11 chars, the production process silently uses `VkMockProvider`, returning synthetic data.
- **Consequence:** Misconfigured deployments appear to work but produce fake participants and fake draws.
- **Recommended fix:** Fail fast at startup when a real token is expected. Reserve `VkMockProvider` for explicit `NODE_ENV=test` or a `USE_VK_MOCK=1` flag.
- **Coordination:** isolated; recommended but not auto-fixed to avoid behavior changes.

### M2 — `.gitignore` does not cover all environment files

- **File:** `.gitignore`
- **Lines:** 19–22
- **Description:** Only `.env` and `.env*.local` are ignored. `.env.production`, `.env.staging`, `.env.test`, and `.env*.[other]` are not ignored.
- **Consequence:** Accidental commits of production secrets are possible.
- **Recommended fix:** Add `!.env.example` and `.env*` (with explicit allow-list for safe examples) or list common variants.
- **Coordination:** isolated; not auto-fixed because it is project hygiene and can be handled by Antigravity.

### M3 — Raw error messages from external APIs are returned to clients

- **Files:** all `src/app/api/**/route.ts`
- **Description:** Catch blocks return `error.message` directly in the JSON body.
- **Consequence:** Internal details (file paths, provider error texts, partial URLs) may leak to the client.
- **Recommended fix:** In production, log the full error server-side and return a sanitized message. Use `NODE_ENV` to decide detail level.
- **Coordination:** additive; not auto-fixed because it spans many routes.

### M4 — `.env.example` contains unused variables

- **File:** `.env.example`
- **Lines:** 7–10
- **Description:** `VK_APP_ID` and `VK_APP_SECRET` are documented but not referenced in code.
- **Consequence:** Operators may populate them believing they are required, increasing secret surface area without benefit.
- **Recommended fix:** Remove unused variables or add comments explaining they are reserved for future OAuth/community-token flows.
- **Coordination:** trivial; not auto-fixed.

### M5 — `excludeDuplicateComments` flag exists but is not honored

- **File:** `src/core/filtering/filter-engine.ts`
- **Lines:** 25–42
- **Description:** `FilterRules` includes `excludeDuplicateComments`, but `applyFilterRules` always deduplicates participants and aggregates `commentsCount` regardless of the flag.
- **Consequence:** A future UI toggle for duplicate comments will not behave as expected. The rule is also included in `computeConditionsHash`, so changing its behavior later will alter snapshot hashes.
- **Recommended fix:** When `excludeDuplicateComments` is false, keep each raw comment as a separate entry (or disable aggregation). Update hash tests accordingly.
- **Coordination:** touches filter engine; not auto-fixed because it changes existing semantics.

---

## LOW

### L1 — In-memory repository uses `Math.random()` for IDs

- **File:** `src/lib/repository/memory-repository.ts`
- **Line:** 17
- **Description:** Giveaway IDs are generated with `Math.random()`. IDs are not secrets, but this is inconsistent with the cryptographic rigor used elsewhere.
- **Consequence:** Negligible for tests; low risk for production if the memory repo is ever used seriously.
- **Recommended fix:** Use `crypto.randomUUID()` or a CUID generator.
- **Coordination:** not auto-fixed; trivial.

### L2 — `filterRules` object in snapshot route can mutate stored rules unexpectedly

- **File:** `src/app/api/giveaways/[id]/snapshot/route.ts`
- **Lines:** 24–30
- **Description:** `body.filterRules || giveaway.filterRules` passes the request body object directly to `createAndLockSnapshot`, which then stores it in the DB.
- **Consequence:** Malformed or extra keys in the body can be persisted, affecting `conditionsHash` and future audits.
- **Recommended fix:** Deep-clone and validate rules before persisting.
- **Coordination:** overlaps input validation (H2); deferred.

### L3 — No `minimumComments` rule despite review task mentioning it

- **File:** `src/core/types/giveaway.ts`
- **Description:** `FilterRules` does not contain a `minimumComments` field. The task asked to test combinations including `minimumComments`, but the rule is not implemented.
- **Consequence:** Organizer cannot require "at least N comments".
- **Recommended fix:** Add `minimumComments?: number` to `FilterRules` and enforce it in `applyFilterRules` after deduplication.
- **Coordination:** requires type + filter engine change; **not auto-fixed.**

---

## INFO

### I1 — Strong core domain isolation

- The core layer (`src/core/randomizer`, `src/core/filtering`, `src/core/fsm`) has no imports from Next.js, React, or provider implementations. This is good and should be preserved.

### I2 — Provider abstraction is clean and testable

- `SocialMediaProvider` interface (`src/providers/types.ts`) cleanly separates platform specifics from the domain. `VkMockProvider` allows offline testing.

### I3 — Provably-fair hashing is deterministic and order-independent

- `computeParticipantsSnapshotHash` and `computeConditionsHash` canonicalize input and produce stable hashes, enabling third-party verification.

---

## Scalability analysis

### Participant snapshot JSON size estimation

A single `FilteredParticipant` record contains:

```json
{
  "platformUserId": "123456789",
  "firstName": "Иван",
  "lastName": "Иванов",
  "username": "ivanov",
  "avatarUrl": "https://.../photo.jpg",
  "source": "COMBINED",
  "liked": true,
  "commented": true,
  "commentsCount": 3,
  "reposted": false,
  "subscribed": true,
  "eligible": true,
  "exclusionReason": null
}
```

Approximate serialized size: **250–400 bytes** per participant (avatar URLs dominate).

| Eligible participants | Snapshot JSON size | Assessment |
|---|---|---|
| 1 000 | ~0.3 MB | ✅ Safe. Fits comfortably in memory and a `jsonb` column. |
| 10 000 | ~3 MB | ✅ Still safe for a single request, but UI table rendering starts to degrade. |
| 50 000 | ~15 MB | ⚠️ Heavy. Page load / API response time increases; hashing takes noticeable CPU. |
| 100 000 | ~30 MB | ❌ Risky. Exceeds comfortable single-row JSON workload; Next.js API response limits may be hit. |
| 500 000 | ~150 MB | ❌ Not viable. PostgreSQL `jsonb` max is ~1 GB, but memory, I/O, and UI become impractical. |

### Component-by-component assessment

| Component | 1 000 | 10 000 | 50 000 | 100 000 | 500 000 |
|---|---|---|---|---|---|
| **Memory (API route)** | < 5 MB | ~30 MB | ~150 MB | ~300 MB | > 1 GB |
| **PostgreSQL snapshot row** | 0.3 MB | 3 MB | 15 MB | 30 MB | 150 MB |
| **Snapshot hashing (SHA-256)** | < 1 ms | ~5 ms | ~30 ms | ~80 ms | ~500 ms |
| **API pagination (VK likes)** | 1 req | 10 req | 50 req | 100 req | 500 req |
| **API pagination (VK comments)** | 10 req | 100 req | 500 req | 1 000 req | 5 000 req |
| **Subscription checks** | 2 req | 20 req | 100 req | 200 req | 1 000 req |
| **UI Participants table** | instant | slight lag | unusable without virtualization | browser crash risk | requires server-side pagination |
| **Next.js API response** | < 50 KB | ~300 KB | > 1 MB | > 3 MB | > 15 MB |

### When does `eligibleParticipants JSON` stop being a good solution?

**Threshold: ~10 000 eligible participants.**

Above 10 000, the monolithic JSON snapshot becomes a bottleneck because:
1. **Network:** `/api/giveaways/[id]/draw` and related endpoints return the full snapshot or draw result, producing multi-megabyte responses.
2. **Memory:** every snapshot read loads the entire list into the Node.js heap.
3. **UI:** rendering the participants table without virtualization causes jank or crashes.
4. **Hashing:** snapshot hash computation is O(n) on a large string; while still fast, it blocks the event loop.
5. **Audit replay:** third-party verification must download the entire JSON to recompute the hash.

### Recommended long-term architecture

1. **Normalize snapshot items:** replace `eligibleParticipants Json` with a `ParticipantSnapshotItem` table (or reuse `Participant` with a `snapshotId`). Each row stores one participant; `participantsSnapshotHash` is computed from a streaming sorted cursor.
2. **Paginated API:** return only summary counts by default; expose paginated endpoints for participant lists.
3. **Background jobs:** for > 10 000 participants, run import and subscription checks in a background worker (e.g., BullMQ / inngest) and update giveaway status asynchronously.
4. **Streaming hash:** compute the snapshot hash using a streaming SHA-256 over sorted rows instead of materializing the full JSON string.
5. **Cap + warn:** until the architecture changes, enforce a configurable maximum eligible count (e.g., 10 000) with a clear error message and guidance.

> **Coordination note:** schema changes are deferred to Antigravity Phase 1.2. The analysis above is provided for planning only.

---

## Test coverage notes

During this review the following test files were added or extended:

- `tests/filter-engine.test.ts` — extended with combination rule matrices.
- `tests/vk-mock-provider.test.ts` — new; scenarios for 0/1/10/1000/large participants, likes-only, comments-only, subscription, duplicates, excluded IDs.
- `tests/participant-pipeline.test.ts` — new; full fetch → enrichment → subscription → filtering → eligible pipeline.
- `tests/provider-capabilities.test.ts` — new; validation of rules against provider capabilities.
- `tests/vk-errors.test.ts` — new; VK error handling via mocked `fetch`.
- `tests/security.test.ts` — new; token leakage checks.
- `tests/api-validation.test.ts` — new; route-level input validation.
- `tests/concurrency.test.ts` — new; race-condition analysis (findings documented, no production fix).

See each file for concrete test cases and the final report for pass counts.
