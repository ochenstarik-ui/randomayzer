# Randomayzer — Production Guards & Security Architecture

This document details the production integrity guards, concurrency safeguards, rate limiting, and idempotency semantics implemented in **Randomayzer**.

---

## 1. Idempotency Hardening & Request Fingerprinting

### Contract
The API supports the standard `Idempotency-Key` HTTP header on state-mutating endpoints:
- `POST /api/giveaways` (Giveaway creation)
- `POST /api/giveaways/[id]/participants` (Participant import & enrichment)
- `POST /api/giveaways/[id]/snapshot` (Participant snapshot locking)

### Semantics
1. **Scoped Storage Key**:
   Keys are composite and scoped by `operation`, `giveawayId`, and `idempotencyKey`:
   `format: ${operation}:${giveawayId || 'global'}:${key}`
   This prevents cross-endpoint and cross-giveaway key collision.
2. **Request Fingerprinting**:
   Every request computes a canonical SHA-256 fingerprint:
   `requestFingerprint = SHA256(canonicalStringify(requestPayload))`
3. **Replay vs Conflict Handling**:
   - **Same Key + Same Request**: Returns the previously cached status code and response body without re-executing.
   - **Same Key + Different Request**: Throws HTTP `409 Conflict` with error code `IDEMPOTENCY_KEY_REUSED`.
4. **Key Validation & TTL**:
   - Maximum key length is 128 characters (exceeding length returns `400 VALIDATION_ERROR`).
   - Default TTL is 5 minutes with proactive cleanup and upper memory bounds.

---

## 2. Rate Limiting & Client Identity Resolution

### Client Identity Scoping Architecture
- **Authenticated Routes (`/api/giveaways*`)**:
  Rate limits are keyed strictly by trusted server-side `sessionUser.id` (e.g. `draw-execute:${sessionUser.id}:${id}`, `giveaways-list:${sessionUser.id}`) **after** session authentication and ownership checks.
  This ensures:
  1. Different organizers have isolated rate limit buckets and never block each other, even when `req.ip` is unpopulated.
  2. Unauthenticated attackers receive `401 Unauthorized` before reaching the rate limiter and cannot drain any organizer's quota.
- **Anonymous / Hybrid Routes (`/api/posts/preview`, `/api/auth/vk/start`, `/api/giveaways/[id]/verify`)**:
  - `POST /api/posts/preview`: Uses `post-preview:user:${sessionUser.id}` if a valid session exists, and `post-preview:anon:${clientIp}` if anonymous. An anonymous attacker consuming the IP limit cannot affect authenticated organizers.
  - `GET /api/auth/vk/start`: Rate-limited per resolved client IP (`oauth-start:${clientIp}`).
  - `GET /api/giveaways/[id]/verify`: Rate-limited per resolved client IP and giveaway (`verify-get:${clientIp}:${id}`).

### Centralized Client IP Resolution (`src/lib/client-ip.ts`)
- **Untrusted Proxy Mode (Default)**:
  When `TRUST_PROXY !== 'true'`, user-supplied `X-Forwarded-For`, `X-Real-IP`, or `CF-Connecting-IP` headers are **strictly ignored** to prevent IP spoofing attacks. The direct socket connection `req.ip` is used.
  - *Production Behavior*: If `NODE_ENV=production`, `TRUST_PROXY !== 'true'`, and direct `req.ip` is unavailable (e.g. in self-hosted Node.js / `next start` behind a reverse proxy), the server emits a `[SECURITY CONFIGURATION WARNING]` and falls back to `'direct-client'`. For production deployments behind reverse proxies, setting `TRUST_PROXY=true` is required.
- **Trusted Proxy Mode (`TRUST_PROXY=true`)**:
  When deployed behind a verified reverse proxy (e.g. Nginx, Cloudflare, AWS ALB), `TRUST_PROXY=true` must be set. The resolver:
  - Enforces a maximum header length of 1024 characters (oversized headers are rejected as malformed).
  - Parses multi-value proxy chains (`client, proxy1, proxy2`), extracting and validating the leftmost IP.
  - Normalizes IPv4, IPv6 (including IPv4-mapped IPv6 `::ffff:192.0.2.1` and loopbacks `::1`).
  - Validates IP syntax against IPv4/IPv6 standards.

### Memory Limiter vs Multi-Instance Deployments
- The built-in `SlidingWindowRateLimiter` is optimized for single-instance, serverless dev, and test environments.
- In multi-instance or horizontal cluster deployments, rate limiting must be offloaded to an edge layer (e.g., Cloudflare Rate Limiting, Nginx limit_req) or a shared distributed cache (Redis/Valkey).

---

## 3. Winner Count Contract (Zero Under-Delivery)

### Contract
Before conducting any draw, the system enforces:
$$\text{winnersCount} + \text{reserveWinnersCount} \le \text{eligibleParticipantsCount}$$

If the requested winners count plus reserve exceeds the locked snapshot's eligible participants:
- The system returns HTTP `400 VALIDATION_ERROR` (or `409 CONFLICT`).
- **The system NEVER silently clamps or reduces the winners count.**

---

## 4. Draw Concurrency & Terminal Retry Contract

### Atomic Conditional Execution
- Draw execution (`POST /api/giveaways/[id]/draw`) requires the giveaway to be in `SNAPSHOT_LOCKED` status with an existing snapshot.
- The state transition from `SNAPSHOT_LOCKED` to `DRAWN` occurs atomically inside a database transaction (`updateMany({ where: { id, status: 'SNAPSHOT_LOCKED' } })`).
- In a concurrent race (e.g. 20 or 100 simultaneous draw requests), exactly **one** request acquires the lock and transitions to `DRAWN`. All competing requests receive `409 Conflict`.

### Terminal State Replay (`DRAW_ALREADY_COMPLETED`)
- Once a giveaway is in `DRAWN` or `PUBLISHED` status, subsequent draw attempts return:
  ```json
  {
    "success": false,
    "error": {
      "code": "DRAW_ALREADY_COMPLETED",
      "message": "Giveaway has already been drawn and finalized. Repeat draws are not permitted."
    }
  }
  ```
- Clients and UI treat `DRAW_ALREADY_COMPLETED` as a terminal final status.

---

## 5. Summary of Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | string | `development` | Environment mode (`production`, `test`, `development`) |
| `TRUST_PROXY` | boolean (`true`/`false`) | `false` | Enable only behind trusted upstream proxies |
| `ALLOW_MEMORY_IDEMPOTENCY` | boolean | `false` | Silence production warning for memory idempotency in single-instance |
| `ALLOW_MEMORY_RATE_LIMITER` | boolean | `false` | Silence production warning for memory rate limiter in single-instance |
| `USE_VK_MOCK` | boolean | `false` | Explicitly enable VkMockProvider (forbidden in production unless true) |
| `VK_SERVICE_TOKEN` | string | `undefined` | VK Application Service Access Token |
