import { describe, it, expect } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';

describe('Repository Persistence & Lifecycle Scenario', () => {
  const sampleParticipants: FilteredParticipant[] = [
    {
      platformUserId: '1001',
      firstName: 'Дмитрий',
      lastName: 'Попов',
      source: 'LIKES',
      liked: true,
      commented: true,
      commentsCount: 1,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    },
    {
      platformUserId: '1002',
      firstName: 'Мария',
      lastName: 'Иванова',
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
      platformUserId: '1003',
      firstName: 'Олег',
      lastName: 'Сидоров',
      source: 'LIKES',
      liked: true,
      commented: true,
      commentsCount: 1,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    },
  ];

  it('should execute complete giveaway lifecycle with snapshot locking and persistent draw result', async () => {
    const repo = new MemoryGiveawayRepository();

    // 1. Create Giveaway
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-22446688_1054',
      post: {
        platform: 'VK',
        ownerId: '-22446688',
        postId: '1054',
        sourceUrl: 'https://vk.com/wall-22446688_1054',
        title: 'Розыгрыш призов',
        text: 'Текст поста',
        likesCount: 150,
        commentsCount: 50,
        repostsCount: 20,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 1,
      reserveWinnersCount: 1,
      organizerId: 'usr_persist_test',
    });

    expect(gw.status).toBe('READY');
    expect(gw.participants.length).toBe(0);

    // 2. Save Participants
    const updatedGw = await repo.saveParticipants(gw.id, sampleParticipants);
    expect(updatedGw.participants.length).toBe(3);

    // 3. Create & Lock Snapshot
    const snapshot = await repo.createAndLockSnapshot(
      gw.id, 
      sampleParticipants, 
      DEFAULT_FILTER_RULES
    );

    expect(snapshot.version).toBe(1);
    expect(snapshot.participantCount).toBe(3);
    expect(snapshot.participantsSnapshotHash).toBeDefined();
    expect(snapshot.conditionsHash).toBeDefined();

    // Verify giveaway status transitioned to SNAPSHOT_LOCKED
    const lockedGw = await repo.getGiveawayById(gw.id);
    expect(lockedGw?.status).toBe('SNAPSHOT_LOCKED');

    // 4. Execute Draw on Snapshot
    const seed = 'test-persistence-seed-2026';
    const drawResult = executeDeterministicDrawV1({
      giveawayId: gw.id,
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    expect(drawResult.winners.length).toBe(1);
    expect(drawResult.reserveWinners.length).toBe(1);
    expect(drawResult.deterministicProofHash).toBeDefined();
    expect(drawResult.auditEventHash).toBeDefined();

    // 5. Persist DrawResult and Audit
    const finishedGw = await repo.saveDrawResultAndAudit(gw.id, snapshot.id, drawResult);

    expect(finishedGw.status).toBe('DRAWN');
    expect(finishedGw.drawnAt).toBeDefined();
    expect(finishedGw.drawResult).toBeDefined();
    expect(finishedGw.drawResult?.winners.length).toBe(1);

    // 6. Simulate Server Reload: Fetch directly by ID
    const reloaded = await repo.getGiveawayById(gw.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.status).toBe('DRAWN');
    expect(reloaded?.snapshots.length).toBe(1);
    expect(reloaded?.drawResult?.deterministicProofHash).toBe(drawResult.deterministicProofHash);
    expect(reloaded?.drawResult?.auditEventHash).toBe(drawResult.auditEventHash);
    expect(reloaded?.drawResult?.winnerIds).toEqual(drawResult.winnerIds);
  });
});
