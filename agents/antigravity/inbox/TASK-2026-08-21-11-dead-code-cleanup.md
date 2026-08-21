# Task 11: Удаление мёртвого кода

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** LOW (tech debt cleanup)  
**Date:** 2026-08-21  
**Base SHA:** `1883a864023b0b10fe6674a035fbcffa7461c3c8`

## Scope
1. **Unused import in `src/app/api/giveaways/[id]/draw/route.ts`**:
   - Remove unused import `generateCryptoSecureSeed`.
2. **`ProviderRegistry` (`src/providers/registry.ts`)**:
   - Delete dead `src/providers/registry.ts` which duplicates `ProviderFactory` with inconsistent token lengths and non-fail-fast behavior.
3. **`rule-validation.ts` (`src/core/filtering/rule-validation.ts`) vs `validateProviderCapabilities`**:
   - Inspect `requireSubscription` check in `src/core/filtering/rule-validation.ts`.
   - Transfer required capability checks (including `requireSubscription` checking `supportsSubscriptions`) into canonical `validateProviderCapabilities` in `src/core/validation/giveaway-schemas.ts`.
   - Remove redundant `src/core/filtering/rule-validation.ts`.
   - Update `tests/provider-capabilities.test.ts` to test canonical `validateProviderCapabilities`.
4. **`GiveawayStore.listAll` (`src/lib/giveaway-store.ts`)**:
   - Remove unused `listAll` method.
5. **`getOAuthClient()` in `src/integrations/vk/vk-oauth-client.ts`**:
   - Clean up redundant branches in `getOAuthClient()`.
6. **FSM unreachable statuses (`DRAFT`, `FETCHING`, `PUBLISHED`, `CANCELLED`)**:
   - Per instructions, **DO NOT delete** from `GiveawayStatusType` or FSM transitions. Document them as reserved for future publication & cancellation features.
7. Verification gate:
   - `npm test`, `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm audit --omit=dev`.
   - Save report to `agents/antigravity/done/TASK-2026-08-21-11-dead-code-cleanup.md`.
