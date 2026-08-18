import { describe, it, expect } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';

describe('DrawResult Snapshot Binding Regression Tests', () => {
  const participantsV1: FilteredParticipant[] = [
    {
      platformUserId: '101',
      firstName: 'Пользователь',
      lastName: 'Один',
      source: 'LIKES',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    },
    {
      platformUserId: '102',
      firstName: 'Пользователь',
      lastName: 'Два',
      source: 'LIKES',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    },
  ];

  const participantsV2: FilteredParticipant[] = [
    ...participantsV1,
    {
      platformUserId: '103',
      firstName: 'Пользователь',
      lastName: 'Три',
      source: 'LIKES',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    },
  ];

  it('should guarantee that DrawResult remains bound to snapshot v1 even when another snapshot v2 exists', async () => {
    const repo = new MemoryGiveawayRepository();

    // 1. Create giveaway
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-100_200',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '200',
        sourceUrl: 'https://vk.com/wall-100_200',
        title: 'Тестовый розыгрыш',
        text: 'Текст',
        likesCount: 50,
        commentsCount: 20,
        repostsCount: 10,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: 'usr_snap_bind_test',
    });

    // 2. Create snapshot V1
    const snapshotV1 = await repo.createAndLockSnapshot(gw.id, participantsV1, DEFAULT_FILTER_RULES);
    expect(snapshotV1.version).toBe(1);
    const hashV1 = snapshotV1.participantsSnapshotHash;

    // 3. Unlock / simulate revision and create Snapshot V2
    await repo.updateStatus(gw.id, 'READY');
    const snapshotV2 = await repo.createAndLockSnapshot(gw.id, participantsV2, {
      ...DEFAULT_FILTER_RULES,
      requireComment: true,
    });
    expect(snapshotV2.version).toBe(2);
    expect(snapshotV2.participantsSnapshotHash).not.toBe(hashV1);

    // 4. Conduct Draw explicitly bound to snapshot V1 (e.g. historical draw verification)
    const seed = 'test-snapshot-binding-seed';
    const drawResult = executeDeterministicDrawV1({
      giveawayId: gw.id,
      snapshot: snapshotV1,
      totalLoadedCount: 2,
      winnersCount: 1,
      reserveWinnersCount: 0,
      seed,
    });

    await repo.saveDrawResultAndAudit(gw.id, snapshotV1.id, drawResult);

    // 5. Reload giveaway and assert that DrawResult references snapshot V1 and its hashes!
    const reloaded = await repo.getGiveawayById(gw.id);
    expect(reloaded?.drawResult?.snapshotId).toBe(snapshotV1.id);
    expect(reloaded?.drawResult?.participantsSnapshotHash).toBe(hashV1);
    expect(reloaded?.drawResult?.conditionsHash).toBe(snapshotV1.conditionsHash);
    expect(reloaded?.drawResult?.deterministicProofHash).toBe(drawResult.deterministicProofHash);
    expect(reloaded?.snapshots.length).toBe(2);
  });
});
