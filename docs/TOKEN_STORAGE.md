# Token Storage & Encryption-at-Rest Architecture

This document describes how user access and refresh tokens are protected at rest.

---

## 1. Zero Plaintext Invariant

Tokens issued by VK ID are **never** stored in plaintext in the database, logs, or caches.

---

## 2. AES-256-GCM Token Vault (`src/lib/auth/token-vault.ts`)

- **Algorithm**: Authenticated Encryption with Associated Data (`AES-256-GCM`).
- **Dedicated Master Key**: Derived strictly from `TOKEN_ENCRYPTION_KEY`. `AUTH_SECRET` is used exclusively for sessions and CSRF signing; it is never reused as a fallback key for token encryption.
- **Fail-Fast Policy**: In production (`NODE_ENV=production`), `TOKEN_ENCRYPTION_KEY` is strictly mandatory and must be at least 32 characters in length. Missing or short keys abort application startup immediately.
- **Entropy & Key Generation**: While code checks a minimum length of 32 characters, high cryptographic entropy is essential. Use:
  ```bash
  openssl rand -hex 32
  ```
- **Initialization Vector (IV)**: 12 bytes (96 bits) of fresh cryptographic randomness generated via `crypto.randomBytes` per encryption call.
- **Authentication Tag**: 16 bytes (128 bits) guaranteeing ciphertext authenticity and preventing ciphertext tampering.
- **Format**: `iv_hex:authTag_hex:ciphertext_hex`

---

## 3. Token Rotation & Refresh Semantics

- If VK ID responds with a `refresh_token`, it is independently encrypted with AES-256-GCM and saved in the `UserCredential` model.
- Invalidation: Calling `/api/auth/logout` terminates the session and invalidates the session cookie.
