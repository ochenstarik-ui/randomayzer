import { describe, it, expect } from 'vitest';
import { executeDeterministicDraw, verifyDrawResult } from '../src/core/randomizer/deterministic';
import { computeParticipantsSnapshotHash, generateRandomSeed } from '../src/core/randomizer/hasher';
import { FilteredParticipant } from '../src/core/types/participant';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';

function createMockEligibleParticipants(count: number): FilteredParticipant[] {
  return Array.from({ length: count }, (_, i) => ({
    platformUserId: `${1000 + i}`,
    firstName: `User${i + 1}`,
    lastName: `Surname${i + 1}`,
    username: `user_${i + 1}`,
    avatarUrl: `https://example.com/avatar/${i + 1}.jpg`,
    source: 'LIKES',
    liked: true,
    commented: true,
    commentsCount: 1,
    reposted: true,
    subscribed: true,
    eligible: true,
    exclusionReason: null,
  }));
}

describe('Deterministic Randomizer & Provably Fair Engine', () => {
  it('should generate identical winners given the same participants snapshot and seed', () => {
    const participants = createMockEligibleParticipants(50);
    const seed = 'test-secret-seed-2026';

    const draw1 = executeDeterministicDraw({
      giveawayId: 'gw-1',
      eligibleParticipants: participants,
      totalLoadedCount: 50,
      winnersCount: 3,
      reserveWinnersCount: 2,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const draw2 = executeDeterministicDraw({
      giveawayId: 'gw-1',
      eligibleParticipants: participants,
      totalLoadedCount: 50,
      winnersCount: 3,
      reserveWinnersCount: 2,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    expect(draw1.participantsSnapshotHash).toBe(draw2.participantsSnapshotHash);
    expect(draw1.winners.map(w => w.participant.platformUserId)).toEqual(
      draw2.winners.map(w => w.participant.platformUserId)
    );
    expect(draw1.reserveWinners.map(w => w.participant.platformUserId)).toEqual(
      draw2.reserveWinners.map(w => w.participant.platformUserId)
    );
    expect(draw1.verificationSignature).toBe(draw2.verificationSignature);
  });

  it('should produce different winners when seed changes', () => {
    const participants = createMockEligibleParticipants(100);
    const seedA = 'seed-alpha-123';
    const seedB = 'seed-beta-456';

    const drawA = executeDeterministicDraw({
      giveawayId: 'gw-a',
      eligibleParticipants: participants,
      totalLoadedCount: 100,
      winnersCount: 5,
      reserveWinnersCount: 2,
      seed: seedA,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const drawB = executeDeterministicDraw({
      giveawayId: 'gw-b',
      eligibleParticipants: participants,
      totalLoadedCount: 100,
      winnersCount: 5,
      reserveWinnersCount: 2,
      seed: seedB,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const winnersA = drawA.winners.map(w => w.participant.platformUserId);
    const winnersB = drawB.winners.map(w => w.participant.platformUserId);

    expect(winnersA).not.toEqual(winnersB);
  });

  it('should guarantee no duplicates between winners and reserve winners', () => {
    const participants = createMockEligibleParticipants(30);
    const seed = generateRandomSeed();

    const draw = executeDeterministicDraw({
      giveawayId: 'gw-uniq',
      eligibleParticipants: participants,
      totalLoadedCount: 30,
      winnersCount: 5,
      reserveWinnersCount: 5,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const allChosenIds = [
      ...draw.winners.map(w => w.participant.platformUserId),
      ...draw.reserveWinners.map(w => w.participant.platformUserId),
    ];

    const uniqueIds = new Set(allChosenIds);
    expect(uniqueIds.size).toBe(10);
  });

  it('should handle cases where pool size is smaller than requested winners', () => {
    const participants = createMockEligibleParticipants(2);
    const seed = 'small-pool-seed';

    const draw = executeDeterministicDraw({
      giveawayId: 'gw-small',
      eligibleParticipants: participants,
      totalLoadedCount: 2,
      winnersCount: 5,
      reserveWinnersCount: 3,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    expect(draw.winners.length).toBe(2);
    expect(draw.reserveWinners.length).toBe(0);
  });

  it('should throw when attempting draw with 0 eligible participants', () => {
    expect(() => {
      executeDeterministicDraw({
        giveawayId: 'gw-empty',
        eligibleParticipants: [],
        totalLoadedCount: 0,
        winnersCount: 1,
        reserveWinnersCount: 0,
        seed: 'empty-seed',
        filterRules: DEFAULT_FILTER_RULES,
      });
    }).toThrow(/Cannot conduct draw with 0 eligible participants/);
  });

  it('should be independent of input participant ordering (canonical sorting)', () => {
    const p1 = createMockEligibleParticipants(20);
    const p2 = [...p1].reverse(); // reversed order

    const seed = 'sort-order-invariant-seed';

    const draw1 = executeDeterministicDraw({
      giveawayId: 'gw-sort',
      eligibleParticipants: p1,
      totalLoadedCount: 20,
      winnersCount: 3,
      reserveWinnersCount: 1,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const draw2 = executeDeterministicDraw({
      giveawayId: 'gw-sort',
      eligibleParticipants: p2,
      totalLoadedCount: 20,
      winnersCount: 3,
      reserveWinnersCount: 1,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    expect(draw1.participantsSnapshotHash).toBe(draw2.participantsSnapshotHash);
    expect(draw1.winners.map(w => w.participant.platformUserId)).toEqual(
      draw2.winners.map(w => w.participant.platformUserId)
    );
  });

  it('should allow third-party verification through verifyDrawResult', () => {
    const participants = createMockEligibleParticipants(25);
    const seed = 'audit-verification-seed';

    const originalDraw = executeDeterministicDraw({
      giveawayId: 'gw-audit',
      eligibleParticipants: participants,
      totalLoadedCount: 25,
      winnersCount: 2,
      reserveWinnersCount: 2,
      seed,
      filterRules: DEFAULT_FILTER_RULES,
    });

    const verification = verifyDrawResult(participants, seed, 2, 2);

    expect(verification.snapshotHash).toBe(originalDraw.participantsSnapshotHash);
    expect(verification.winners.map(w => w.participant.platformUserId)).toEqual(
      originalDraw.winners.map(w => w.participant.platformUserId)
    );
    expect(verification.reserveWinners.map(w => w.participant.platformUserId)).toEqual(
      originalDraw.reserveWinners.map(w => w.participant.platformUserId)
    );
  });
});
