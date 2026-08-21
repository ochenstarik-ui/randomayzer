import { describe, it, expect } from 'vitest';
import { executeDeterministicDrawV1, ALGORITHM_VERSION_V1 } from '../src/core/randomizer/deterministic';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../src/core/randomizer/canonical';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { ParticipantSnapshotData } from '../src/core/types/audit';

describe('True Partial Fisher-Yates (HMAC_SHA256_FY_V1)', () => {
  function createTestSnapshot(size: number): ParticipantSnapshotData {
    const participants: FilteredParticipant[] = Array.from({ length: size }, (_, i) => ({
      platformUserId: String(i + 1),
      firstName: `User${i + 1}`,
      lastName: `Surname${i + 1}`,
      source: 'LIKES',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    }));

    return {
      id: `snap-fy-${size}`,
      giveawayId: 'gw-fy-1',
      version: 1,
      createdAt: '2026-08-17T12:00:00.000Z',
      eligibleParticipants: participants,
      filterRulesSnapshot: DEFAULT_FILTER_RULES,
      participantCount: size,
      participantsSnapshotHash: computeParticipantsSnapshotHash(participants),
      conditionsHash: computeConditionsHash(DEFAULT_FILTER_RULES),
    };
  }

  it('should have algorithmVersion set strictly to HMAC_SHA256_FY_V1', () => {
    expect(ALGORITHM_VERSION_V1).toBe('HMAC_SHA256_FY_V1');
  });

  it('should select k distinct elements in 0..k-1 range with correct positions', () => {
    const snapshot = createTestSnapshot(20);
    const result = executeDeterministicDrawV1({
      giveawayId: 'gw-fy-1',
      snapshot,
      totalLoadedCount: 20,
      winnersCount: 3,
      reserveWinnersCount: 2,
      seed: 'fy-test-seed-1',
    });

    expect(result.winners.length).toBe(3);
    expect(result.reserveWinners.length).toBe(2);

    expect(result.winners[0].position).toBe(1);
    expect(result.winners[1].position).toBe(2);
    expect(result.winners[2].position).toBe(3);

    expect(result.reserveWinners[0].position).toBe(4);
    expect(result.reserveWinners[1].position).toBe(5);

    const allChosen = [...result.winnerIds, ...result.reserveWinnerIds];
    const uniqueChosen = new Set(allChosen);
    expect(uniqueChosen.size).toBe(5);
  });

  it('should produce invariant selection across 100 replays', () => {
    const snapshot = createTestSnapshot(10);
    const seed = 'deterministic-invariant-test-seed';

    const baseline = executeDeterministicDrawV1({
      giveawayId: 'gw-fy-1',
      snapshot,
      totalLoadedCount: 10,
      winnersCount: 2,
      reserveWinnersCount: 1,
      seed,
    });

    for (let i = 0; i < 100; i++) {
      const current = executeDeterministicDrawV1({
        giveawayId: 'gw-fy-1',
        snapshot,
        totalLoadedCount: 10,
        winnersCount: 2,
        reserveWinnersCount: 1,
        seed,
      });

      expect(current.winnerIds).toEqual(baseline.winnerIds);
      expect(current.reserveWinnerIds).toEqual(baseline.reserveWinnerIds);
      expect(current.deterministicProofHash).toBe(baseline.deterministicProofHash);
    }
  });
});
