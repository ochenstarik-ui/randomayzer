# VK Client Architecture & Official API Specification

The VK Integration layer is structured into decoupled components located under `src/integrations/vk/`.

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

---

## Verified VK API Specifications (v5.199)

### 1. `wall.getById`
- **Official Docs**: `https://dev.vk.com/ru/method/wall.getById`
- **Method**: POST/GET `https://api.vk.com/method/wall.getById`
- **Parameters**: `posts` (e.g. `"-100_12345"`), `extended=1`.
- **Response**: `{ items: VkWallPost[], profiles?: VkUserProfile[], groups?: VkGroupProfile[] }`.
- **Behavior**: Returns empty `items: []` or error 210 if post is deleted or wall is private.

### 2. `likes.getList`
- **Official Docs**: `https://dev.vk.com/ru/method/likes.getList`
- **Method**: POST/GET `https://api.vk.com/method/likes.getList`
- **Parameters**: `type="post"`, `owner_id`, `item_id`, `filter="likes"`, `extended=1`, `count` (max 100), `offset`.
- **Response**: `{ count: number, items: VkUserProfile[] }`.

### 3. `wall.getComments`
- **Official Docs**: `https://dev.vk.com/ru/method/wall.getComments`
- **Method**: POST/GET `https://api.vk.com/method/wall.getComments`
- **Parameters**: `owner_id`, `post_id`, `extended=1`, `count` (max 100), `offset`, `fields="photo_100,photo_200,screen_name"`.
- **Response**: `{ count: number, items: VkCommentItem[], profiles?: VkUserProfile[] }`.

### 4. `groups.isMember`
- **Official Docs**: `https://dev.vk.com/ru/method/groups.isMember`
- **Method**: POST/GET `https://api.vk.com/method/groups.isMember`
- **Parameters**: `group_id`, `user_ids` (comma-separated list of IDs up to **500 max** per batch call).
- **Response**: `Array<{ user_id: number, member: 1 | 0 }>`.

### 5. Reposts Limitation `[CONFIRMED_LIMITATION]`
- **Official Status**: VK API does **not** provide a public method to list all users who reposted an arbitrary third-party post due to user privacy settings. `wall.getReposts` only works for community managers on their own wall posts.
- **Provider Flag**: `capabilities.reposts = false`.

### 6. Admin Detection `[UNVERIFIED]`
- **Official Status**: Checking if a user is an administrator of a target community requires `groups.getMembers` with `filter=managers`, which requires community admin rights.
- **Provider Flag**: `capabilities.adminDetection = false`.

---

## Cancellation vs Timeout Lifecycle

| Failure Mode | Error Class | Retryable? | Behavior |
|---|---|---|---|
| Caller `AbortSignal` fires | `VkCancelledError` | **No** | Request aborted immediately; retry engine halts without retry. |
| Client timeout timer expires | `VkTimeoutError` | **Yes** | Attempt aborted; backoff delay computed and retry initiated up to `maxRetries`. |
| HTTP 429 Too Many Requests | `VkRateLimitError` | **Yes** | Retryable with backoff. |
| HTTP 500..504 Server Error | `VkTemporaryError` | **Yes** | Retryable with backoff. |
| HTTP 400/401/403/404 | `VkClientError` subclasses | **No** | Fast fail. |
