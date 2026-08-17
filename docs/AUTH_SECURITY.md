# Authentication & Authorization Security Policy

This document details the security mitigations, CSRF defenses, session controls, and token isolation policies in **Randomayzer**.

---

## 1. CSRF & State Parameter Defenses

- **Unpredictable State**: Every OAuth flow generates 32 bytes of cryptographic randomness via `crypto.randomBytes(32).toString('base64url')`.
- **Strict Single-Use**: The moment `consumeTransaction(state)` is called in the callback handler, the transaction is immediately deleted from storage. Even if a duplicate or replayed request arrives, it is immediately rejected with HTTP 401.
- **Short TTL**: OAuth transactions automatically expire after 10 minutes.

---

## 2. PKCE (Proof Key for Code Exchange)

- **Standard**: RFC 7636 (OAuth 2.1 mandatory).
- **Code Verifier**: 48 random bytes encoded as base64url (64 characters).
- **Code Challenge**: `BASE64URL(SHA256(codeVerifier))`.
- **Method**: `S256` (plain is strictly forbidden).

---

## 3. Session Security

- **Cookie Name**: `randomayzer_session`
- **Attributes**:
  - `HttpOnly`: Client-side JavaScript (`document.cookie`) cannot read the session cookie, preventing XSS-based session extraction.
  - `Secure`: Transmitted only over HTTPS in production.
  - `SameSite=Lax`: Prevents cross-site CSRF on third-party link navigations while permitting normal user navigation.
  - `Max-Age`: 30 days (2,592,000 seconds).

---

## 4. Token Leakage Prevention

- `/api/auth/me` returns only safe, sanitized user metadata (`id`, `vkUserId`, `firstName`, `lastName`, `username`, `avatarUrl`).
- Tokens are **never** rendered in JSON responses, headers, URL parameters, logs, or persistent audit records.
