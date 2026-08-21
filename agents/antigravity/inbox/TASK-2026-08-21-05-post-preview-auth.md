# Task 05: Auth & CSRF на POST /api/posts/preview

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (security)  
**Date:** 2026-08-21  
**Base SHA:** `4b8c6b10395452a3fd1ff7ea4eb919289b66f33f`

## Scope
1. Add `validateCsrfOrigin(req)` to `POST /api/posts/preview` (`src/app/api/posts/preview/route.ts`).
2. Require authenticated session (`requireAuthenticatedUser(req)`) on `POST /api/posts/preview`:
   - Post preview is step 1 of giveaway creation wizard which immediately calls `POST /api/giveaways` (already requiring authentication).
   - Prevents open VK API proxy abuse and unauthenticated server token quota draining.
   - User-scoped rate limit: `expensiveApiRateLimiter.assertAllowed('post-preview:' + sessionUser.id)`.
3. Preserve `resolveEffectiveCapabilities` truthfulness from actual `post.resolvedAuthType` (Phase 2.3.1 invariant).
4. Update UI in `src/app/giveaways/new/page.tsx` to handle 401 cleanly with redirect/re-login prompt.
5. Create test suite `tests/post-preview-guard.test.ts`:
   - Cross-site POST with untrusted Origin -> 403 Forbidden.
   - POST without authenticated session -> 401 Unauthorized.
   - `VK_SERVICE_TOKEN` never leaked in response.
   - Legitimate authenticated same-origin request -> 200 OK with accurate effective capabilities.
6. Verify gate and submit report to `agents/antigravity/done/TASK-2026-08-21-05-post-preview-auth.md`.
