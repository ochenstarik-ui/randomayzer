# VK Authenticated Access & Method Capabilities Matrix

This document defines the token selection policy, capabilities, and fallback rules for all VK API methods used by Randomayzer.

---

## 1. Principle of Least Privilege & Token Selection Policy

Randomayzer adheres to the strict principle of least privilege:
1. **Public Read Operations**: Always prefer `SERVICE` token (public service access) if the resource is public.
2. **Restricted / Private Operations**: Use the authenticated organizer's `USER` token only when required or when a service token receives a privacy/permission error.
3. **Community Operations**: Use `COMMUNITY` token when managing community-specific admin operations.

---

## 2. Method-by-Method Capabilities Matrix

| VK API Method | Service Token Support | User Token Support | Community Token Support | Privacy / Permissions | Controlled Fallback Rule |
|---|---|---|---|---|---|
| **`wall.getById`** | **YES (Preferred for public)** | **YES (Required for private/restricted)** | **YES (for owned community wall)** | Works for public walls and communities. Returns error 15/30 if author profile or group is closed/private. | If `SERVICE` call returns `VkPrivateResourceError` (error 15/30), fallback to organizer `USER` token. |
| **`likes.getList`** | **YES (Preferred for public)** | **YES (Required for restricted)** | **YES** | Public posts allow open likes retrieval. Closed groups or friends-only posts require authenticated `USER` token. | If `SERVICE` call returns `VkPrivateResourceError` / `VkPermissionError`, fallback to organizer `USER` token. |
| **`wall.getComments`** | **YES (Preferred for public)** | **YES (Required for restricted)** | **YES** | Allows collecting comments and profile mapping. If comments are disabled on the post, returns error code 210/214. | If `SERVICE` call fails on private group post, fallback to organizer `USER` token. |
| **`groups.isMember`** | **YES (Preferred)** | **YES** | **YES** | Checks membership in open and closed groups. Batching supported up to 500 user IDs per call. | Defaults to `SERVICE` token; falls back to `USER` token if group is restricted. |

---

## 3. Fallback Policy Rules

### A. Permitted Fallback Conditions
A controlled fallback from `SERVICE` $\rightarrow$ `USER` token is allowed **strictly** when:
1. The initial call failed with `VkPrivateResourceError` (VK error codes 15, 30, 203) or `VkPermissionError` (VK error codes 7, 260);
2. AND the organizer is actively authenticated with a valid, non-expired `USER` credential.

### B. Forbidden Fallbacks
Fallback is strictly prohibited on:
- **Rate Limit (429 / error codes 6, 9, 29)**: Switching tokens to bypass rate limits violates VK terms of service and is never permitted.
- **Server Errors (500 / 502 / 503 / 504)**: Upstream VK errors must be retried via standard exponential backoff.
- **Client Validation Errors (400 / error codes 8, 100, 113)**: Malformed parameters indicate invalid client input.
- **Network / Timeout Errors**: Handled by network retry policy.
