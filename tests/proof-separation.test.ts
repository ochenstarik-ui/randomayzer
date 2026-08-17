import { describe, it, expect } from 'vitest';
import { executeDeterministicDrawV1, verifyDrawResult } from '../src/core/randomizer/deterministic';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../src/core/randomizer/canonical';
import { FilterRules, DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { ParticipantSnapshotData } from '../src/core/types/audit';

describe('DeterministicProofHash & AuditEventHash Separation', () => {
  const participants: FilteredParticipant[] = [
    {
      platformUserId: '1',
      firstName: 'Алексей',
      lastName: 'Смирнов',
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
      platformUserId: '2',
      firstName: 'Елена',
      lastName: 'Кузнецова',
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
      platformUserId: '3',
      firstName: 'Михаил',
      lastName: 'Попов',
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

  const snapshot: ParticipantSnapshotData = {
    id: 'snap-proof-test-1',
    giveawayId: 'gw-1',
    version: 1,
    createdAt: '2026-08-17T12:00:00.000Z',
    eligibleParticipants: participants,
    participantCount: 3,
    participantsSnapshotHash: computeParticipantsSnapshotHash(participants),
    conditionsHash: computeConditionsHash(DEFAULT_FILTER_RULES),
  };

  const seed = 'test-seed-separation-123';

  it('should generate identical deterministicProofHash across multiple executions with same inputs', () => {
    const draw1 = executeDeterministicDrawV1({
      giveawayId: 'gw-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    const draw2 = executeDeterministicDrawV1({
      giveawayId: 'gw-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    // deterministicProofHash must be 100% identical and reproducible
    expect(draw1.deterministicProofHash).toBe(draw2.deterministicProofHash);
    expect(draw1.winnerIds).toEqual(draw2.winnerIds);
    expect(draw1.reserveWinnerIds).toEqual(draw2.reserveWinnerIds);
  });

  it('should generate distinct auditEventHash for separate draw events (different drawId/timestamp)', () => {
    const drawA = executeDeterministicDrawV1({
      giveawayId: 'gw-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    const drawB = executeDeterministicDrawV1({
      giveawayId: 'gw-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    // auditEventHash must be unique per event execution
    expect(drawA.drawId).not.toBe(drawB.drawId);
    expect(drawA.auditEventHash).not.toBe(drawB.auditEventHash);
  });

  it('should verify that verifyDrawResult successfully matches deterministicProofHash upon independent replay', () => {
    const originalDraw = executeDeterministicDrawV1({
      giveawayId: 'gw-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    const verification = verifyDrawResult(
      snapshot,
      seed,
      1,
      1,
      originalDraw.winnerIds,
      originalDraw.deterministicProofHash
    );

    expect(verification.verified).toBe(true);
    expect(verification.winnersMatch).toBe(true);
    expect(verification.deterministicProofHashMatch).toBe(true);
    expect(verification.snapshotHashMatch).toBe(true);
    expect(verification.conditionsHashMatch).toBe(true);
    expect(verification.expectedDeterministicProofHash).toBe(originalDraw.deterministicProofHash);
  });
});
