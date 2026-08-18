import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOAuthTransactionStore } from '../src/lib/auth/oauth-state';

describe('Phase 2.2.3 OAuth Atomic Consume & 100-Concurrent Race Gate', () => {
  let store: MemoryOAuthTransactionStore;

  beforeEach(() => {
    store = new MemoryOAuthTransactionStore();
  });

  it('100 concurrent consumeTransaction attempts on the same state result in exactly 1 success and 99 failures', async () => {
    // 1. Create a single valid transaction
    const { state, codeVerifier } = await store.createTransaction({
      redirectTarget: '/giveaways/new',
      ttlMs: 5 * 60 * 1000,
    });

    // 2. Launch 100 concurrent consume requests
    const attempts = Array.from({ length: 100 }, async (_, index) => {
      try {
        const result = await store.consumeTransaction(state);
        return { success: true, verifier: result.codeVerifier, index };
      } catch (err: any) {
        return { success: false, error: err.message, index };
      }
    });

    const results = await Promise.all(attempts);

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    // Invariant: Exactly 1 consume succeeds
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(99);

    // Invariant: The winning consume got the exact codeVerifier
    expect(successful[0].verifier).toBe(codeVerifier);

    // Invariant: Subsequent sequential consume also fails
    await expect(store.consumeTransaction(state)).rejects.toThrow(/already consumed/i);
  });

  it('reused state is immediately rejected with unauthorized error', async () => {
    const { state } = await store.createTransaction();

    // First consume succeeds
    const first = await store.consumeTransaction(state);
    expect(first.codeVerifier).toBeDefined();

    // Second consume fails
    await expect(store.consumeTransaction(state)).rejects.toThrow(/already consumed/i);
  });

  it('expired state cannot be consumed', async () => {
    const { state } = await store.createTransaction({ ttlMs: -1000 }); // Expired in the past

    await expect(store.consumeTransaction(state)).rejects.toThrow(/expired/i);
  });

  it('invalidateTransaction deletes state cleanly on error or cancellation', async () => {
    const { state } = await store.createTransaction();

    const deleted = await store.invalidateTransaction(state);
    expect(deleted).toBe(true);

    // State can no longer be consumed
    await expect(store.consumeTransaction(state)).rejects.toThrow(/not found/i);
  });
});
