# Real VK ID & API Live Smoke Test Runbook

This runbook outlines the live verification steps for testing VK ID OAuth 2.1 and authenticated VK operations without committing credentials into version control or CI.

---

## 1. Local Environment Preparation

Set in your `.env.local` file:
```bash
# VK ID Web Application Credentials
VK_APP_ID="<your_vk_app_id>"
VK_CLIENT_SECRET="<your_vk_client_secret>"

# Service Token for Public Operations
VK_SERVICE_TOKEN="<your_vk_service_token>"

# Canonical Local Configuration
APP_BASE_URL="http://localhost:3000"
VK_REDIRECT_URI="http://localhost:3000/api/auth/vk/callback"

# Cryptographic Keys (min 32 chars)
AUTH_SECRET="<random_hex_32_bytes>"
TOKEN_ENCRYPTION_KEY="<random_hex_32_bytes>"
```

---

## 2. Verification Checklist

- [ ] **A. OAuth Login Start**: Visit `/api/auth/vk/start` $\rightarrow$ Redirects to `https://id.vk.com/authorize` with PKCE `code_challenge` (S256).
- [ ] **B. OAuth Callback**: Authorize on VK screen $\rightarrow$ Redirected to `/api/auth/vk/callback`, sets HttpOnly cookie `randomayzer_session`.
- [ ] **C. Session Inspection**: Visit `/api/auth/me` $\rightarrow$ Returns authenticated user profile (name, avatar).
- [ ] **D. Public Post Preview**: Paste public VK post URL in `/giveaways/new` $\rightarrow$ Preview loads with `accessMode: "PUBLIC_SERVICE"`.
- [ ] **E. Private/Restricted Post Preview**: Paste post URL from closed group where organizer is member $\rightarrow$ Resolver falls back to `ORGANIZER_USER`.
- [ ] **F. Create Giveaway**: Submit giveaway form $\rightarrow$ Giveaway created with `organizerId: sessionUser.id`.
- [ ] **G. Import Participants**: Click Import Participants $\rightarrow$ Likes and comments fetched via `VkAuthContextResolver`.
- [ ] **H. Subscription Verification**: Run community subscription filter $\rightarrow$ Batch `groups.isMember` executed successfully.
- [ ] **I. Snapshot Locking**: Lock snapshot $\rightarrow$ Canonical hashes computed.
- [ ] **J. Deterministic Draw**: Execute draw $\rightarrow$ Winner selected via unbiased CSPRNG rejection sampling.
- [ ] **K. Public Audit**: Open `/api/giveaways/[id]/verify` in incognito window $\rightarrow$ Audit passes without authentication.
- [ ] **L. Token Expiry & Refresh**: Wait for access token expiry or simulate $\rightarrow$ Next API request automatically triggers server-side refresh without user interruption.
- [ ] **M. Logout**: Click logout $\rightarrow$ Session terminated, cookie destroyed.
