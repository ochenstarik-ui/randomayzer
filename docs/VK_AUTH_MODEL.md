# VK Authentication Model & Token Security

This document outlines the authentication context lifecycle and security rules for VK tokens in **Randomayzer**.

---

## Token Types Supported

1. **Service Token (`SERVICE`)**:
   - Used for public API read operations (`wall.getById`, `likes.getList`, `wall.getComments`, `groups.isMember`).
   - Configured via environment variable `VK_SERVICE_TOKEN`.
   - Never exposed to frontend clients.

2. **User Token (`USER`)**:
   - Authorized via VK ID / OAuth with specific scopes (`wall`, `offline`, `groups`).
   - Used when accessing non-public walls or private community groups with admin access.

3. **Community Token (`COMMUNITY`)**:
   - Scoped to a specific community (`communityId`).
   - Used for managing giveaways directly on behalf of a VK public page or group.

---

## Invariant Security Rules

- **Zero Logging**: Tokens are never passed to `console.log`, error messages, or telemetry.
- **Redaction Helper**: `redactToken(token)` masks tokens as `vk1.a...1234`.
- **Database & Audit Isolation**: Access tokens are **never** persisted to PostgreSQL or included in cryptographic AuditProof / DrawResult hashes.
