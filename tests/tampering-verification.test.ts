import { describe, it, expect } from 'vitest';
import { executeDeterministicDrawV1, verifyDrawResult } from '../src/core/randomizer/deterministic';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../src/core/randomizer/canonical';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { ParticipantSnapshotData } from '../src/core/types/audit';

describe('Public Verification Integrity & Anti-Tampering Test Suite', () => {
  const originalParticipants: FilteredParticipant[] = [
    {
      platformUserId: '101',
      firstName: 'Иван',
      lastName: 'Петров',
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
      firstName: 'Анна',
      lastName: 'Сидорова',
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
      platformUserId: '103',
      firstName: 'Сергей',
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
  ];

  const validSnapshot: ParticipantSnapshotData = {
    id: 'snap-tamper-baseline',
    giveawayId: 'gw-tamper-1',
    version: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    eligibleParticipants: JSON.parse(JSON.stringify(originalParticipants)),
    filterRulesSnapshot: { ...DEFAULT_FILTER_RULES },
    participantCount: 3,
    participantsSnapshotHash: computeParticipantsSnapshotHash(originalParticipants),
    conditionsHash: computeConditionsHash(DEFAULT_FILTER_RULES),
  };

  const seed = 'anti-tampering-master-seed-2026';

  const baselineDraw = executeDeterministicDrawV1({
    giveawayId: 'gw-tamper-1',
    snapshot: validSnapshot,
    totalLoadedCount: 3,
    winnersCount: 1,
    reserveWinnersCount: 1,
    seed,
  });

  it('1. Baseline check: authentic draw result must pass 100% verification', () => {
    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: baselineDraw.drawnAt,
      snapshot: validSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(true);
    expect(result.participantsSnapshotIntegrity).toBe(true);
    expect(result.conditionsIntegrity).toBe(true);
    expect(result.winnersMatch).toBe(true);
    expect(result.reserveWinnersMatch).toBe(true);
    expect(result.deterministicProofHashMatch).toBe(true);
    expect(result.auditEventHashMatch).toBe(true);
  });

  it('2. Tampering test: modifying a participant name/ID in snapshot must fail participantsSnapshotIntegrity', () => {
    const tamperedSnapshot: ParticipantSnapshotData = {
      ...validSnapshot,
      eligibleParticipants: [
        {
          ...originalParticipants[0],
          firstName: 'Хакер', // Tampered name!
        },
        originalParticipants[1],
        originalParticipants[2],
      ],
    };

    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: baselineDraw.drawnAt,
      snapshot: tamperedSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.participantsSnapshotIntegrity).toBe(false);
  });

  it('3. Tampering test: modifying a filter rule in snapshot must fail conditionsIntegrity', () => {
    const tamperedSnapshot: ParticipantSnapshotData = {
      ...validSnapshot,
      filterRulesSnapshot: {
        ...DEFAULT_FILTER_RULES,
        requireComment: true, // Tampered rule!
      },
    };

    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: baselineDraw.drawnAt,
      snapshot: tamperedSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.conditionsIntegrity).toBe(false);
  });

  it('4. Tampering test: modifying winnerIds must fail winnersMatch', () => {
    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: baselineDraw.drawnAt,
      snapshot: validSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: ['fake-winner-id-999'], // Tampered winner!
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.winnersMatch).toBe(false);
  });

  it('5. Tampering test: modifying reserveWinnerIds must fail reserveWinnersMatch', () => {
    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: baselineDraw.drawnAt,
      snapshot: validSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: ['fake-reserve-id-777'], // Tampered reserve winner!
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.reserveWinnersMatch).toBe(false);
  });

  it('6. Tampering test: modifying seed must fail replay and deterministicProofHashMatch', () => {
    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: baselineDraw.drawnAt,
      snapshot: validSnapshot,
      seed: 'tampered-seed-999',
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.deterministicProofHashMatch).toBe(false);
  });

  it('7. Tampering test: modifying drawId must fail auditEventHashMatch', () => {
    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: 'tampered-draw-id-xyz', // Tampered drawId!
      drawnAt: baselineDraw.drawnAt,
      snapshot: validSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.auditEventHashMatch).toBe(false);
  });

  it('8. Tampering test: modifying drawnAt timestamp must fail auditEventHashMatch', () => {
    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: '2026-08-19T00:00:00.000Z', // Tampered timestamp!
      snapshot: validSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: baselineDraw.deterministicProofHash,
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.auditEventHashMatch).toBe(false);
  });

  it('9. Tampering test: modifying deterministicProofHash directly must fail deterministicProofHashMatch', () => {
    const result = verifyDrawResult({
      giveawayId: 'gw-tamper-1',
      drawId: baselineDraw.drawId,
      drawnAt: baselineDraw.drawnAt,
      snapshot: validSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 1,
      claimedWinnerIds: baselineDraw.winnerIds,
      claimedReserveWinnerIds: baselineDraw.reserveWinnerIds,
      claimedDeterministicProofHash: '1111111111111111111111111111111111111111111111111111111111111111',
      claimedAuditEventHash: baselineDraw.auditEventHash,
      algorithmVersion: baselineDraw.algorithmVersion,
    });

    expect(result.verified).toBe(false);
    expect(result.deterministicProofHashMatch).toBe(false);
  });
});
