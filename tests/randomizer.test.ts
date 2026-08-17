import { describe, it, expect } from 'vitest';
import { executeDeterministicDrawV1, verifyDrawResult, ALGORITHM_VERSION_V1 } from '../src/core/randomizer/deterministic';
import { generateCryptoSecureSeed } from '../src/core/randomizer/hasher';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../src/core/randomizer/canonical';
import { FilteredParticipant } from '../src/core/types/participant';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { ParticipantSnapshotData } from '../src/core/types/audit';

function createMockSnapshot(count: number): ParticipantSnapshotData {
  const eligible: FilteredParticipant[] = Array.from({ length: count }, (_, i) => ({
    platformUserId: `${1000 + i}`,
    firstName: `User${i + 1}`,
    lastName: `Surname${i + 1}`,
    username: `user_${i + 1}`,
    avatarUrl: `https://example.com/avatar/${i + 1}.jpg`,
    source: 'LIKES',
    liked: true,
    commented: true,
    commentsCount: 1,
    reposted: false,
    subscribed: true,
    eligible: true,
    exclusionReason: null,
  }));

  return {
    id: 'snap-test-1',
    giveawayId: 'gw-test-1',
    version: 1,
    createdAt: new Date().toISOString(),
    eligibleParticipants: eligible,
    participantCount: count,
    participantsSnapshotHash: computeParticipantsSnapshotHash(eligible),
    conditionsHash: computeConditionsHash(DEFAULT_FILTER_RULES),
  };
}

describe('Deterministic Randomizer V1 (HMAC_SHA256_FY_V1)', () => {
  it('should use CSPRNG crypto.randomBytes for seed generation (no Math.random)', () => {
    const seed1 = generateCryptoSecureSeed();
    const seed2 = generateCryptoSecureSeed();

    expect(seed1).toHaveLength(32); // 16 bytes in hex = 32 chars
    expect(seed2).toHaveLength(32);
    expect(seed1).not.toBe(seed2);
    expect(/^[0-9a-f]{32}$/.test(seed1)).toBe(true);
  });

  it('should guarantee deterministic replay given the same snapshot and seed', () => {
    const snapshot = createMockSnapshot(50);
    const seed = 'test-secret-seed-2026';

    const draw1 = executeDeterministicDrawV1({
      giveawayId: 'gw-1',
      snapshot,
      totalLoadedCount: 50,
      winnersCount: 3,
      reserveWinnersCount: 2,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const draw2 = executeDeterministicDrawV1({
      giveawayId: 'gw-1',
      snapshot,
      totalLoadedCount: 50,
      winnersCount: 3,
      reserveWinnersCount: 2,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    expect(draw1.algorithmVersion).toBe(ALGORITHM_VERSION_V1);
    expect(draw1.participantsSnapshotHash).toBe(draw2.participantsSnapshotHash);
    expect(draw1.deterministicProofHash).toBe(draw2.deterministicProofHash);
    expect(draw1.winnerIds).toEqual(draw2.winnerIds);
    expect(draw1.reserveWinnerIds).toEqual(draw2.reserveWinnerIds);
    expect(draw1.winners.map(w => w.participant.platformUserId)).toEqual(
      draw2.winners.map(w => w.participant.platformUserId)
    );
    expect(draw1.reserveWinners.map(w => w.participant.platformUserId)).toEqual(
      draw2.reserveWinners.map(w => w.participant.platformUserId)
    );
  });

  it('should produce different winners when seed changes', () => {
    const snapshot = createMockSnapshot(100);
    const seedA = 'seed-alpha-123';
    const seedB = 'seed-beta-456';

    const drawA = executeDeterministicDrawV1({
      giveawayId: 'gw-a',
      snapshot,
      totalLoadedCount: 100,
      winnersCount: 5,
      reserveWinnersCount: 2,
      seed: seedA,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const drawB = executeDeterministicDrawV1({
      giveawayId: 'gw-b',
      snapshot,
      totalLoadedCount: 100,
      winnersCount: 5,
      reserveWinnersCount: 2,
      seed: seedB,
      filterRules: DEFAULT_FILTER_RULES,
    });

    expect(drawA.winnerIds).not.toEqual(drawB.winnerIds);
  });

  it('should guarantee no duplicates between winners and reserve winners', () => {
    const snapshot = createMockSnapshot(30);
    const seed = generateCryptoSecureSeed();

    const draw = executeDeterministicDrawV1({
      giveawayId: 'gw-uniq',
      snapshot,
      totalLoadedCount: 30,
      winnersCount: 5,
      reserveWinnersCount: 5,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const allChosenIds = [...draw.winnerIds, ...draw.reserveWinnerIds];
    const uniqueIds = new Set(allChosenIds);
    expect(uniqueIds.size).toBe(10);
  });

  it('should handle small pool sizes gracefully', () => {
    const snapshot = createMockSnapshot(2);
    const seed = 'small-pool-seed';

    const draw = executeDeterministicDrawV1({
      giveawayId: 'gw-small',
      snapshot,
      totalLoadedCount: 2,
      winnersCount: 5,
      reserveWinnersCount: 3,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    expect(draw.winners.length).toBe(2);
    expect(draw.reserveWinners.length).toBe(0);
  });

  it('should allow third-party audit replay verification via verifyDrawResult', () => {
    const snapshot = createMockSnapshot(25);
    const seed = 'audit-verification-seed';

    const originalDraw = executeDeterministicDrawV1({
      giveawayId: 'gw-audit',
      snapshot,
      totalLoadedCount: 25,
      winnersCount: 2,
      reserveWinnersCount: 2,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const verification = verifyDrawResult(
      snapshot,
      seed,
      2,
      2,
      originalDraw.winnerIds,
      originalDraw.deterministicProofHash,
      ALGORITHM_VERSION_V1
    );

    expect(verification.verified).toBe(true);
    expect(verification.expectedWinnerIds).toEqual(originalDraw.winnerIds);
    expect(verification.expectedReserveWinnerIds).toEqual(originalDraw.reserveWinnerIds);
    expect(verification.expectedWinners.map(w => w.participant.platformUserId)).toEqual(
      originalDraw.winners.map(w => w.participant.platformUserId)
    );
  });
});
