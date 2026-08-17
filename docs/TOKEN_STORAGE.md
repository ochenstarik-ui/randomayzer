# Token Storage & Encryption-at-Rest Architecture

This document describes how user access and refresh tokens are protected at rest.

---

## 1. Zero Plaintext Invariant

Tokens issued by VK ID are **never** stored in plaintext in the database or caches.

---

## 2. AES-256-GCM Token Vault (`src/lib/auth/token-vault.ts`)

- **Algorithm**: Authenticated Encryption with Associated Data (`AES-256-GCM`).
- **Key Derivation**: 256-bit key derived via `SHA-256` from `TOKEN_ENCRYPTION_KEY` or `AUTH_SECRET`.
- **Initialization Vector (IV)**: 12 bytes (96 bits) of fresh cryptographic randomness generated per encryption operation.
- **Authentication Tag**: 16 bytes (128 bits) ensuring ciphertext integrity against tampering.
- **Format**: `iv_hex:authTag_hex:ciphertext_hex`

---

## 3. Token Rotation & Refresh Semantics

- If VK ID responds with a `refresh_token`, it is encrypted and saved alongside the access token in `UserCredential`.
- Invalidation: Calling `/api/auth/logout` destroys the user session and local credential cache.
