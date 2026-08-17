# VK ID OAuth 2.1 Authentication Flow

This document specifies the authorization flow, endpoints, and security contracts for organizer login via VK ID.

---

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as Organizer (Browser)
    participant App as Randomayzer Frontend
    participant Server as Randomayzer API
    participant Vault as Token Vault / DB
    participant VKID as VK ID OAuth 2.1 (id.vk.com)

    User->>App: Click "Войти через VK ID"
    App->>Server: GET /api/auth/vk/start?redirectTarget=/
    Server->>Server: Generate PKCE (verifier + S256 challenge) & State (32 bytes)
    Server->>Server: Save OAuthTransaction (10m TTL, single-use)
    Server-->>User: 302 Redirect to VK ID Auth URL
    User->>VKID: Authorize App & Grant Permissions
    VKID-->>User: 302 Redirect to /api/auth/vk/callback?code=AUTH_CODE&state=STATE
    User->>Server: GET /api/auth/vk/callback?code=AUTH_CODE&state=STATE
    Server->>Server: Validate & Consume single-use State
    Server->>VKID: POST /oauth2/auth (grant_type=authorization_code, code, code_verifier)
    VKID-->>Server: 200 OK (access_token, refresh_token, user_id, expires_in)
    Server->>Vault: Encrypt access_token & refresh_token with AES-256-GCM
    Server->>Server: Fetch Profile (users.get) & Upsert User/Organizer
    Server->>Server: Create Session & set HttpOnly Secure Cookie
    Server-->>User: 302 Redirect to redirectTarget
    User->>Server: GET /api/auth/me (Cookie: randomayzer_session)
    Server-->>User: 200 OK (safe profile without tokens)
```

---

## Official Endpoints

1. **Authorization Start**: `https://id.vk.com/auth`
   - Parameters:
     - `response_type=code`
     - `client_id` (VK App ID)
     - `redirect_uri` (`https://randomayzer.domain/api/auth/vk/callback`)
     - `state` (Cryptographically random, single-use, 10 min TTL)
     - `code_challenge` (BASE64URL(SHA256(code_verifier)))
     - `code_challenge_method=S256`
     - `scope=wall,groups,offline`

2. **Token Exchange**: `https://id.vk.com/oauth2/auth`
   - Method: POST `application/x-www-form-urlencoded`
   - Parameters:
     - `grant_type=authorization_code`
     - `code`
     - `code_verifier`
     - `client_id`
     - `client_secret`
     - `redirect_uri`
     - `state`
