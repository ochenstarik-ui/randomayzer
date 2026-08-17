import { describe, it, expect } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';
import { ConflictError } from '../src/core/errors/http-errors';

describe('Concurrency Double Draw Protection', () => {
  const participants: FilteredParticipant[] = Array.from({ length: 20 }, (_, i) => ({
    platformUserId: `user_${i + 1}`,
    firstName: `User`,
    lastName: `${i + 1}`,
    source: 'LIKES',
    liked: true,
    commented: false,
    commentsCount: 0,
    reposted: false,
    subscribed: true,
    eligible: true,
    exclusionReason: null,
  }));

  it('should allow exactly 1 success out of 20 concurrent draw requests, with 19 receiving 409 Conflict', async () => {
    const repo = new MemoryGiveawayRepository();

    // 1. Create giveaway & lock snapshot
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-100_500',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '500',
        sourceUrl: 'https://vk.com/wall-100_500',
        title: 'Concurrent Test Giveaway',
        text: 'Description',
        likesCount: 100,
        commentsCount: 20,
        repostsCount: 10,
      },
      filterRules: DEFAULT_FILTER_RULES,
    });

    const snapshot = await repo.createAndLockSnapshot(gw.id, participants, DEFAULT_FILTER_RULES);

    // 2. Launch 20 concurrent draw attempts
    const concurrentDrawPromises = Array.from({ length: 20 }, async (_, index) => {
      try {
        const seed = `concurrent-seed-${index}`;
        const drawResult = executeDeterministicDrawV1({
          giveawayId: gw.id,
          snapshot,
          totalLoadedCount: 20,
          winnersCount: 1,
          reserveWinnersCount: 1,
          seed,
        });

        const saved = await repo.saveDrawResultAndAudit(gw.id, snapshot.id, drawResult);
        return { status: 200, success: true, result: saved };
      } catch (err: any) {
        if (err instanceof ConflictError || err?.message?.includes('already been drawn') || err?.message?.includes('SNAPSHOT_LOCKED')) {
          return { status: 409, success: false, error: err.message };
        }
        return { status: 500, success: false, error: err.message };
      }
    });

    const results = await Promise.all(concurrentDrawPromises);

    const successCount = results.filter(r => r.status === 200).length;
    const conflictCount = results.filter(r => r.status === 409).length;
    const serverErrorCount = results.filter(r => r.status === 500).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(19);
    expect(serverErrorCount).toBe(0);

    // Verify giveaway is in DRAWN state with exactly 1 draw result
    const finalized = await repo.getGiveawayById(gw.id);
    expect(finalized?.status).toBe('DRAWN');
    expect(finalized?.drawResult).toBeDefined();
    expect(finalized?.drawResult?.winners.length).toBe(1);
  });
});
