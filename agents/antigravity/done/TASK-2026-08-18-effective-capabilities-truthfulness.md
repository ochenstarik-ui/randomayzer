# Task Done: Phase 2.3.1 — Effective Capabilities Truthfulness Gate

**Status:** DONE
**Assigned to:** Antigravity (@orchestrator)
**Date:** 2026-08-18
**Base Commit:** `1495067`

## Findings & Fixes
- **Claude C-4 finding**: `POST /api/posts/preview` derived `effectiveCapabilities` from session existence rather than the actual `VkAuthContext` used by `fetchPost`.
- **Fix**:
  - `PostMetadata` now exposes safe, non-secret `resolvedAuthType?: 'SERVICE' | 'USER' | 'COMMUNITY'`.
  - `VkProvider.executeFetchPost` records `resolvedAuthType: authContext.type` (tokens/secrets are never exposed).
  - `POST /api/posts/preview` calculates `effectiveCapabilities` truthfully from `post.resolvedAuthType`.
  - `GET /api/giveaways/[id]` checks `defaultUserRepository.getUserCredentials` truthfully instead of hardcoding synthetic `{ type: 'USER' }`.
- **Tests Added**: `tests/effective-capabilities-truthfulness.test.ts` (6 tests covering all 5 prompt requirements + giveaway detail check).
- **Test Suite Status**: 268/268 tests passing (47 test files).
