# Task 07: excludeDuplicateComments — правило не применяется

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (audit-trail accuracy)  
**Date:** 2026-08-21  
**Base SHA:** `8741569817f4463387c5dc3ac36c0beaedbd0663`

## Scope
1. Semantic decision on duplicate comments:
   - Randomayzer core algorithm `HMAC_SHA256_FY_V1` and `executeDeterministicDrawV1` operate on a 1-participant = 1-chance model (`AGENTS.md` §1 forbids altering deterministic randomizer/draw algorithms without explicit owner task).
   - Multi-weight/multi-entry draws would require modifying the deterministic randomizer and snapshot data structures, which is out of scope.
   - Therefore, choose **Option B**: Unconditional deduplication.
2. Backward compatibility & Conditions Hash versioning:
   - Ensure `computeConditionsHash` handles backward compatibility: snapshots created in legacy format (containing `excludeDuplicateComments`) must continue to verify `verified: true` with identical hash values (`conditionsIntegrity: true`).
3. Fix duplicate merging in `filter-engine.ts`:
   - Fix `commentsCount` summing so that duplicates with `commentsCount: 0` (or `undefined`) do not artificially add `+ 1`.
4. Update UI and validation schemas if `excludeDuplicateComments` is removed or deprecated:
   - Clean up or deprecate gracefully in `DEFAULT_FILTER_RULES`, `filterRulesSchema`, `src/app/giveaways/new/page.tsx`.
5. Create regression tests `tests/duplicate-comments-rule.test.ts`:
   - Duplicate with `commentsCount: 0` does not add 1.
   - Legacy snapshots with `excludeDuplicateComments` in `filterRulesSnapshot` retain `verified: true` and match original `conditionsHash`.
   - Filter engine deduplication behaves deterministically.
6. Verify and output report to `agents/antigravity/done/TASK-2026-08-21-07-duplicate-comments-rule.md`.
