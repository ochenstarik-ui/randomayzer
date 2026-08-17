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
    filterRulesSnapshot: { ...DEFAULT_FILTER_RULES },
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

    const result = verifyDrawResult({
      giveawayId: 'gw-verif-1',
      drawId: draw.drawId,
      drawnAt: draw.drawnAt,
      snapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: draw.winnerIds,
      claimedReserveWinnerIds: draw.reserveWinnerIds,
      claimedDeterministicProofHash: draw.deterministicProofHash,
      claimedAuditEventHash: draw.auditEventHash,
      algorithmVersion: draw.algorithmVersion,
    });

    expect(result.verified).toBe(true);
    expect(result.winnersMatch).toBe(true);
    expect(result.reserveWinnersMatch).toBe(true);
    expect(result.deterministicProofHashMatch).toBe(true);
    expect(result.auditEventHashMatch).toBe(true);
    expect(result.participantsSnapshotIntegrity).toBe(true);
    expect(result.conditionsIntegrity).toBe(true);
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

    const result = verifyDrawResult({
      giveawayId: 'gw-verif-1',
      drawId: draw.drawId,
      drawnAt: draw.drawnAt,
      snapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: fakeWinnerIds,
      claimedReserveWinnerIds: draw.reserveWinnerIds,
      claimedDeterministicProofHash: draw.deterministicProofHash,
      claimedAuditEventHash: draw.auditEventHash,
      algorithmVersion: draw.algorithmVersion,
    });

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

    const result = verifyDrawResult({
      giveawayId: 'gw-verif-1',
      drawId: draw.drawId,
      drawnAt: draw.drawnAt,
      snapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: draw.winnerIds,
      claimedReserveWinnerIds: draw.reserveWinnerIds,
      claimedDeterministicProofHash: fakeProofHash,
      claimedAuditEventHash: draw.auditEventHash,
      algorithmVersion: draw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.deterministicProofHashMatch).toBe(false);
    expect(result.winnersMatch).toBe(true);
  });
});
