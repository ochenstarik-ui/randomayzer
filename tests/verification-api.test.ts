import { describe, it, expect } from 'vitest';
import { verifyDrawResult, executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../src/core/randomizer/canonical';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { ParticipantSnapshotData } from '../src/core/types/audit';

describe('Verification API Replay Engine', () => {
  const participants: FilteredParticipant[] = [
    {
      platformUserId: '10',
      firstName: 'Победитель',
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
      platformUserId: '20',
      firstName: 'Победитель',
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
    {
      platformUserId: '30',
      firstName: 'Победитель',
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

  const snapshot: ParticipantSnapshotData = {
    id: 'snap-verif-1',
    giveawayId: 'gw-verif-1',
    version: 1,
    createdAt: '2026-08-17T12:00:00.000Z',
    eligibleParticipants: participants,
    participantCount: 3,
    participantsSnapshotHash: computeParticipantsSnapshotHash(participants),
    conditionsHash: computeConditionsHash(DEFAULT_FILTER_RULES),
  };

  const seed = 'verification-engine-seed';

  it('should return verified: true when claimed winners and proof hash match replay', () => {
    const draw = executeDeterministicDrawV1({
      giveawayId: 'gw-verif-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    const result = verifyDrawResult(
      snapshot,
      seed,
      1,
      1,
      draw.winnerIds,
      draw.deterministicProofHash,
      draw.algorithmVersion
    );

    expect(result.verified).toBe(true);
    expect(result.winnersMatch).toBe(true);
    expect(result.deterministicProofHashMatch).toBe(true);
    expect(result.snapshotHashMatch).toBe(true);
    expect(result.conditionsHashMatch).toBe(true);
    expect(result.expectedWinnerIds).toEqual(draw.winnerIds);
  });

  it('should return verified: false and winnersMatch: false if claimed winners differ', () => {
    const draw = executeDeterministicDrawV1({
      giveawayId: 'gw-verif-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    const fakeWinnerIds = ['9999']; // Tampered winners

    const result = verifyDrawResult(
      snapshot,
      seed,
      1,
      1,
      fakeWinnerIds,
      draw.deterministicProofHash,
      draw.algorithmVersion
    );

    expect(result.verified).toBe(false);
    expect(result.winnersMatch).toBe(false);
  });

  it('should return verified: false if deterministicProofHash was tampered with', () => {
    const draw = executeDeterministicDrawV1({
      giveawayId: 'gw-verif-1',
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 1,
      reserveWinnersCount: 1,
      seed,
    });

    const fakeProofHash = '0000000000000000000000000000000000000000000000000000000000000000';

    const result = verifyDrawResult(
      snapshot,
      seed,
      1,
      1,
      draw.winnerIds,
      fakeProofHash,
      draw.algorithmVersion
    );

    expect(result.verified).toBe(false);
    expect(result.deterministicProofHashMatch).toBe(false);
    expect(result.winnersMatch).toBe(true);
  });
});
