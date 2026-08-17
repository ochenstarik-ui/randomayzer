import { describe, it, expect } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { ConflictError } from '../src/core/errors/http-errors';

describe('Concurrency Snapshot Locking & Participant Isolation', () => {
  const participants: FilteredParticipant[] = [
    {
      platformUserId: '101',
      firstName: 'Участник',
      lastName: '1',
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
      firstName: 'Участник',
      lastName: '2',
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

  it('should not allow locking snapshot when status is DRAWN', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-1_1',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-1_1',
        title: 'Title',
        text: 'Text',
        likesCount: 10,
        commentsCount: 2,
        repostsCount: 1,
      },
      filterRules: DEFAULT_FILTER_RULES,
    });

    // Valid transition: READY -> SNAPSHOT_LOCKED -> DRAWN
    await repo.createAndLockSnapshot(gw.id, participants, DEFAULT_FILTER_RULES);
    await repo.updateStatus(gw.id, 'DRAWN');

    await expect(
      repo.createAndLockSnapshot(gw.id, participants, DEFAULT_FILTER_RULES)
    ).rejects.toThrow(ConflictError);
  });

  it('should not allow modifying participants when status is SNAPSHOT_LOCKED', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-1_2',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '2',
        sourceUrl: 'https://vk.com/wall-1_2',
        title: 'Title',
        text: 'Text',
        likesCount: 10,
        commentsCount: 2,
        repostsCount: 1,
      },
      filterRules: DEFAULT_FILTER_RULES,
    });

    await repo.createAndLockSnapshot(gw.id, participants, DEFAULT_FILTER_RULES);

    await expect(
      repo.saveParticipants(gw.id, participants)
    ).rejects.toThrow(/Cannot modify participants/);
  });
});
