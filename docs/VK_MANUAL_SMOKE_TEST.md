# Manual VK ID OAuth 2.1 Smoke Test Guide

This guide describes how to perform an end-to-end manual verification of VK ID login without checking secrets into git or CI.

---

## 1. Prerequisites & Environment Setup

Create or update your local `.env.local` (never commit this file):

```bash
# VK ID Application Credentials (from https://dev.vk.com/admin)
VK_APP_ID="<your_vk_app_id>"
VK_CLIENT_SECRET="<your_vk_client_secret>"

# Canonical Application URLs
APP_BASE_URL="http://localhost:3000"
VK_REDIRECT_URI="http://localhost:3000/api/auth/vk/callback"

# Security Keys
AUTH_SECRET="<32_char_random_hex_for_session>"
TOKEN_ENCRYPTION_KEY="<32_char_random_hex_for_aes_gcm>"

# Storage Driver (memory or database)
STORAGE_DRIVER="memory"
```

In the VK Developer Console:
- Add `http://localhost:3000/api/auth/vk/callback` to the list of **Authorized Redirect URIs**.
- Set Trusted Domain to `localhost:3000`.

---

## 2. Step-by-Step Test Procedure

### Step A: Start Server
```bash
npm run dev
```

### Step B: Initiate OAuth Login
1. Open `http://localhost:3000` in your browser.
2. Click **Войти через VK ID**.
3. Verify redirection to `https://id.vk.com/authorize` with:
   - `client_id` matching `VK_APP_ID`
   - `redirect_uri` matching `VK_REDIRECT_URI`
   - `code_challenge` (S256 hash)
   - `code_challenge_method=s256`
   - `state` (unpredictable base64url string)

### Step C: Complete Authorization
1. Authorize the application on the VK screen.
2. VK redirects to `http://localhost:3000/api/auth/vk/callback?code=...&state=...`.
3. Check network and cookies:
   - Response sets `randomayzer_session` cookie (`HttpOnly; SameSite=Lax`).
   - Browser is redirected to `/` (or specified `redirectTarget`).
   - Header displays the logged-in user's name and avatar.

### Step D: Inspect Active Session
Visit `http://localhost:3000/api/auth/me`:
```json
{
  "authenticated": true,
  "user": {
    "id": "usr_...",
    "vkUserId": "...",
    "firstName": "...",
    "lastName": "...",
    "avatarUrl": "..."
  }
}
```

### Step E: Test Giveaway Creation & Scoped Listing
1. Create a new giveaway via UI or `POST /api/giveaways`.
2. Visit `GET /api/giveaways`: observe that only giveaways created by this user are returned.
3. Open incognito window without cookie $\rightarrow$ `GET /api/giveaways` returns `401 Unauthorized`.

### Step F: Test Logout
1. Click **Выйти** in header (or `POST /api/auth/logout`).
2. Verify `randomayzer_session` cookie is cleared.
3. Verify `GET /api/auth/me` returns `{"authenticated": false}`.
