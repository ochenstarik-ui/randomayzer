# VK ID OAuth 2.1 Live Contract & Specification Reference

This document catalogs the verified and unverified technical facts of VK ID OAuth 2.1 based on official VK ID Web SDK (`@vkid/sdk`) and documentation.

---

## 1. Verified Official VK ID Specifications (VERIFIED)

| Contract Attribute | Official VK ID Specification | Status | Implementation in Randomayzer |
|---|---|---|---|
| **Protocol Flow** | OAuth 2.1 Authorization Code Flow with PKCE | **VERIFIED** | Authorization Code + PKCE (S256) |
| **Code Challenge Method** | `s256` (`BASE64URL(SHA256(code_verifier))`) | **VERIFIED** | Cryptographic SHA-256 via `crypto.createHash` |
| **Code Verifier Length** | 43 to 128 characters, unreserved URL characters | **VERIFIED** | 48 random bytes encoded as `base64url` (64 chars) |
| **CSRF Defense** | Single-use cryptographically random `state` parameter | **VERIFIED** | 32 random bytes `base64url`, atomic single-use consume |
| **Default Authorization Host** | `https://id.vk.com/authorize` or `https://id.vk.ru/auth` | **VERIFIED** | Uses `https://id.vk.com/authorize` |
| **Token Exchange Endpoint** | `https://id.vk.com/oauth2/auth` | **VERIFIED** | POST request with `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`, `state` |
| **Token Format Response** | JSON containing `access_token`, `user_id`, `expires_in`, optional `refresh_token`, `scope` | **VERIFIED** | Handled by `VkOAuthTokenResponseSchema` |
| **Security at Rest** | `access_token` and `refresh_token` encrypted via AES-256-GCM | **VERIFIED** | `AesGcmTokenVault` with 256-bit derived key and 96-bit IV |

---

## 2. Environment-Dependent / Unverified Live Behaviors (UNVERIFIED)

| Attribute | Known Variation / Live Behavior | Status | Operational Handling |
|---|---|---|---|
| **`device_id` requirement** | Some mobile VK ID Web SDK modes require a transient `device_id` string in token exchange. Standard web server-side auth code flows typically do not enforce it if PKCE is used. | **UNVERIFIED in web server-flow** | Supported optionally in token payload; verify during manual smoke test. |
| **Scope separator** | Some older endpoints accepted comma-separated (`wall,groups`), while newer OAuth 2.1 RFC-compliant endpoints accept space-separated (`wall groups`). | **UNVERIFIED across legacy vs vkid** | Currently defaults to standard VK scope string `wall,groups,offline`; test against registered App ID. |
| **Refresh Token Expiry** | `refresh_token` issuance is subject to application settings ("Server application" vs "Web application" in VK Developer Console). | **UNVERIFIED on test app** | Handled dynamically: if present, stored encrypted; if absent, flow continues safely. |
