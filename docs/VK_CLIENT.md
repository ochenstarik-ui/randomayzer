# VK Client Architecture & Integration Guide

The VK Integration layer is structured into modular, decoupled components located under `src/integrations/vk/`.

---

## Architecture Overview

```
[SocialMediaProvider Interface]
               │
               ▼
        [VkProvider]
               │
               ▼
          [VkClient]
      ┌────────┼────────┐
      │        │        │
      ▼        ▼        ▼
 [VkAuth] [VkRateLimit] [VkRetry]
      │        │        │
      └────────┼────────┘
               │ (POST https://api.vk.com/method/*)
               ▼
           [VK API]
```

### Core Components

1. **`VkClient` (`src/integrations/vk/vk-client.ts`)**:
   - Centralizes low-level HTTP communication with VK API.
   - Enforces default API version `5.199`.
   - Manages timeouts with `AbortController` (default 15s).
   - Coordinates outbound rate limiting and retry backoff.
   - Provides universal pagination helper `fetchPaginatedVk`.

2. **`VkAuthContext` (`src/integrations/vk/vk-auth.ts`)**:
   - Represents typed access tokens (`SERVICE`, `USER`, `COMMUNITY`).
   - Ensures tokens are never leaked into logs, error messages, or persistent audit records.

3. **`VkRateLimiter` (`src/integrations/vk/vk-rate-limit.ts`)**:
   - Throttles outbound requests according to VK API thresholds (default: 10 req/sec configurable).

4. **`executeWithRetry` (`src/integrations/vk/vk-retry.ts`)**:
   - Handles exponential backoff with full jitter for retryable transient errors (5xx server errors, rate limits, network timeouts).
   - Fast-fails non-retryable errors (auth errors, permissions, private resources, validation).

---

## Pagination & Scalability

- **No Artificial Caps**: Previous limits (e.g. 5,000 likes or 1,000 comments) have been completely removed.
- **Likes**: Uses `likes.getList` with `filter=likes&extended=1` in batches of 100 up to the total post likes count.
- **Comments**: Uses `wall.getComments` with `extended=1` and profile enrichment.
- **Subscription Checks**: Batches up to 500 user IDs per `groups.isMember` call.
