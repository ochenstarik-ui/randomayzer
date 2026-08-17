# VK Method Capabilities Matrix

This document defines the verified VK API method capabilities, token scopes, and known platform constraints according to the official **`VKCOM/vk-api-schema`** (API version 5.199).

---

## Verified VK Method Matrix

| VK Method | Allowed Token Types (Schema) | Required Parameters | Max Batch / Count | Known Privacy & Policy Limitations | Verification Status |
|---|---|---|---|---|---|
| **`wall.getById`** | `service`, `user`, `group`, `open` | `posts` (e.g. `"-123_456"`) | Max 100 posts per call | Cannot access posts on private user walls or restricted groups without user/group authorization. | **`VERIFIED`** |
| **`likes.getList`** | `service`, `user`, `group`, `open` | `type="post"`, `owner_id`, `item_id` | Max 100 with `extended=1` (profiles), max 1000 with IDs only | If a post is from a closed community, requires membership/access. Profiles with deleted accounts are returned with `deactivated` tag. | **`VERIFIED`** |
| **`wall.getComments`** | `service`, `user`, `group`, `open` | `owner_id`, `post_id` | Max 100 comments per request | Nested replies require recursive traversal or standard chronological fetch. Closed comments return error 210. | **`VERIFIED`** |
| **`groups.isMember`** | `service`, `user`, `group`, `open` | `group_id`, `user_ids` | Max **500** `user_ids` per batch call | Closed groups return `member=0` for non-members even if user has pending join request (unless request status inspected). | **`VERIFIED`** |
| **`wall.getReposts`** | `user`, `group` | `owner_id`, `post_id` | Max 100 | **Cannot enumerate all reposters** on arbitrary public posts due to user profile privacy restrictions. Only available to group managers for their own posts. | **`CONFIRMED_LIMITATION`** |
| **`groups.getMembers`** (Managers) | `user`, `group` | `group_id`, `filter="managers"` | Max 1000 | Requires administrative rights in the target community. Not available via standalone public Service Token. | **`CONFIRMED_LIMITATION`** |

---

## Token Type Definitions (`VKCOM/vk-api-schema`)

1. **`service` (Service Token)**:
   - Application access token obtained from VK Developer Console.
   - Strictly read-only for public methods.
   - Never expires, but cannot act on behalf of a user.

2. **`user` (User Access Token)**:
   - Obtained via modern **VK ID Web SDK** (OAuth 2.1 with PKCE).
   - Can access user-authorized data, private groups user belongs to, and perform user actions.

3. **`group` (VK Group Access Token)**:
   - Configured in VK Community Settings (referred to internally as `COMMUNITY` token in Randomayzer).
   - Scoped strictly to the managing group/public page.

---

## Authentication Architecture for Phase 2.2

- **Protocol**: OAuth 2.1 + PKCE (`code_verifier`, `code_challenge` SHA-256 base64url).
- **State Security**: Cryptographically secure single-use `state` with TTL, validated on OAuth callback.
- **Endpoints**: Modern `id.vk.com` / `vk.ru` VK ID Web SDK flow (legacy implicit token flow is deprecated).
