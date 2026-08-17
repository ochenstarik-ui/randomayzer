import { describe, it, expect } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';
import { ConflictError } from '../src/core/errors/http-errors';

describe('100-Draw Concurrency Regression & Mixed Race', () => {
  const participants: FilteredParticipant[] = Array.from({ length: 50 }, (_, i) => ({
    platformUserId: `user_${1000 + i}`,
    firstName: 'User',
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

  it('100 concurrent draw attempts result in exactly 1 success and 99 conflicts with 1 DrawResult', async () => {
    const repo = new MemoryGiveawayRepository();

    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-100_100',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '100',
        sourceUrl: 'https://vk.com/wall-100_100',
        title: '100 Concurrency Test',
        likesCount: 50,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 3,
      reserveWinnersCount: 1,
    });

    const snapshot = await repo.createAndLockSnapshot(gw.id, participants, DEFAULT_FILTER_RULES);

    // Launch 100 concurrent draw requests
    const drawPromises = Array.from({ length: 100 }, async (_, index) => {
      try {
        const seed = `seed-concurrent-100-${index}`;
        const drawResult = executeDeterministicDrawV1({
          giveawayId: gw.id,
          snapshot,
          totalLoadedCount: 50,
          winnersCount: 3,
          reserveWinnersCount: 1,
          seed,
        });

        const saved = await repo.saveDrawResultAndAudit(gw.id, snapshot.id, drawResult);
        return { status: 200, result: saved };
      } catch (err: any) {
        if (
          err instanceof ConflictError ||
          err?.message?.includes('already been drawn') ||
          err?.message?.includes('SNAPSHOT_LOCKED')
        ) {
          return { status: 409, error: err.message };
        }
        return { status: 500, error: err.message };
      }
    });

    const results = await Promise.all(drawPromises);

    const successCount = results.filter(r => r.status === 200).length;
    const conflictCount = results.filter(r => r.status === 409).length;
    const errorCount = results.filter(r => r.status === 500).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(99);
    expect(errorCount).toBe(0);

    const finalized = await repo.getGiveawayById(gw.id);
    expect(finalized?.status).toBe('DRAWN');
    expect(finalized?.drawResult).toBeDefined();
    expect(finalized?.drawResult?.winners.length).toBe(3);
    expect(finalized?.drawResult?.reserveWinners.length).toBe(1);
  });

  it('mixed race between participant mutation, snapshot locking, and draw preserves terminal integrity', async () => {
    const repo = new MemoryGiveawayRepository();

    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-100_200',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '200',
        sourceUrl: 'https://vk.com/wall-100_200',
        title: 'Mixed Race Test',
        likesCount: 50,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 1,
      reserveWinnersCount: 0,
    });

    await repo.saveParticipants(gw.id, participants);

    // Launch mixed simultaneous actions
    const actions = [
      repo.createAndLockSnapshot(gw.id, participants, DEFAULT_FILTER_RULES).catch(e => ({ error: e.message })),
      repo.saveParticipants(gw.id, participants.slice(0, 10)).catch(e => ({ error: e.message })),
      (async () => {
        const snap = await repo.getLatestSnapshot(gw.id);
        if (!snap) return { skipped: true };
        const drawResult = executeDeterministicDrawV1({
          giveawayId: gw.id,
          snapshot: snap,
          totalLoadedCount: 50,
          winnersCount: 1,
          reserveWinnersCount: 0,
          seed: 'seed-mixed',
        });
        return repo.saveDrawResultAndAudit(gw.id, snap.id, drawResult).catch(e => ({ error: e.message }));
      })(),
    ];

    await Promise.allSettled(actions);

    const finalState = await repo.getGiveawayById(gw.id);
    expect(finalState).not.toBeNull();
    expect(['READY', 'SNAPSHOT_LOCKED', 'DRAWN']).toContain(finalState?.status);
  });
});
