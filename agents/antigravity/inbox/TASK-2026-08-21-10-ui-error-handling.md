# Task 10: Обработка ошибок и неаутентифицированного состояния в UI

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** LOW (UX & Error Handling)  
**Date:** 2026-08-21  
**Base SHA:** `3feb0d5834910bb804621edf11d3f98a07e23cbd`

## Scope
1. Implement a unified pure helper function for parsing error messages from API responses:
   - Supports structured `{ success: false, error: { message, code, details } }`, legacy string `data.error`, HTTP status fallbacks, and fallback defaults.
   - Comprehensive unit test suite in `tests/ui-error-parser.test.ts`.
2. Fix all UI call sites (`src/app/giveaways/new/page.tsx`, `src/app/giveaways/[id]/page.tsx`, `src/app/page.tsx`):
   - Replace direct string casting/alert calls with error banners/state and the unified helper.
   - Eliminate `[object Object]` displays across 400, 401, 403, 404, 409, 429 errors.
3. Fix wizard silent death without authentication:
   - In `handleFetchPost` (`new/page.tsx`), check `createRes.ok`, extract structured error, set error state, and do NOT proceed to step 2 if `createdGiveawayId` is null.
4. Dashboard and Auth states:
   - Distinguish empty list (`giveaways.length === 0` when authenticated) from 401 unauthenticated state.
   - In `src/components/auth/AuthButton.tsx`, append `?redirectTarget=${encodeURIComponent(pathname)}` using `usePathname()` so users are seamlessly redirected back after VK ID login.
5. Replace `alert()` calls in `src/app/giveaways/new/page.tsx` with inline error banners.
6. Verify via full test gate (`npm test`, `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm audit --omit=dev`) and document manual UI verification steps in report `agents/antigravity/done/TASK-2026-08-21-10-ui-error-handling.md`.
