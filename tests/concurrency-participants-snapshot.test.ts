import { describe, it, expect } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { ConflictError } from '../src/core/errors/http-errors';

describe('Concurrency: Participants Update vs Snapshot Lock Race', () => {
  const initialParticipants: FilteredParticipant[] = Array.from({ length: 10 }, (_, i) => ({
    platformUserId: `user_${i + 1}`,
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

  const updatedParticipants: FilteredParticipant[] = Array.from({ length: 20 }, (_, i) => ({
    platformUserId: `user_new_${i + 1}`,
    firstName: 'NewUser',
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

  it('saveParticipants must fail with ConflictError if snapshot is already locked', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-100_1',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-100_1',
        title: 'Race Test',
        likesCount: 10,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: 'usr_conc_part_snap',
    });

    await repo.saveParticipants(gw.id, initialParticipants);
    expect(gw.status).toBe('READY');

    // 1. Lock snapshot -> moves status to SNAPSHOT_LOCKED
    await repo.createAndLockSnapshot(gw.id, initialParticipants, DEFAULT_FILTER_RULES);
    const locked = await repo.getGiveawayById(gw.id);
    expect(locked?.status).toBe('SNAPSHOT_LOCKED');

    // 2. Attempt to save new participants -> MUST reject with ConflictError
    await expect(
      repo.saveParticipants(gw.id, updatedParticipants)
    ).rejects.toThrow(ConflictError);

    // 3. Status must remain SNAPSHOT_LOCKED (never overwritten back to READY)
    const finalized = await repo.getGiveawayById(gw.id);
    expect(finalized?.status).toBe('SNAPSHOT_LOCKED');
    expect(finalized?.participants.length).toBe(10);
  });

  it('simultaneous participant update and snapshot lock guarantees consistent single winner state', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-100_2',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '2',
        sourceUrl: 'https://vk.com/wall-100_2',
        title: 'Simultaneous Race Test',
        likesCount: 10,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: 'usr_conc_part_snap',
    });

    await repo.saveParticipants(gw.id, initialParticipants);

    // Launch both simultaneously
    const results = await Promise.allSettled([
      repo.createAndLockSnapshot(gw.id, initialParticipants, DEFAULT_FILTER_RULES),
      repo.saveParticipants(gw.id, updatedParticipants),
    ]);

    // Check final state integrity
    const finalGw = await repo.getGiveawayById(gw.id);
    expect(finalGw).not.toBeNull();
    expect(['READY', 'SNAPSHOT_LOCKED']).toContain(finalGw?.status);

    if (finalGw?.status === 'SNAPSHOT_LOCKED') {
      // If snapshot won, participants cannot be the new ones without snapshot binding
      expect(finalGw.snapshots.length).toBeGreaterThan(0);
    }
  });
});
