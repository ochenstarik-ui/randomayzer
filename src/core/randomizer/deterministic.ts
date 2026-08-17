import { createHash, randomBytes } from 'crypto';
import { FilteredParticipant, Winner } from '../types/participant';
import { DrawExecutionParams, DrawExecutionResult, CURRENT_RANDOMIZER_ALGORITHM, ParticipantSnapshotData } from '../types/audit';
import { DeterministicHmacStream } from './unbiased-sampler';
import { computeAuditHash } from './canonical';

export const ALGORITHM_VERSION_V1 = CURRENT_RANDOMIZER_ALGORITHM; // 'HMAC_SHA256_FY_V1'

/**
 * Generates an individual audit proof hash for a winner position
 */
export function generateWinnerProofHash(
  seed: string,
  snapshotHash: string,
  position: number,
  participantId: string
): string {
  return createHash('sha256')
    .update(`${seed}:${snapshotHash}:pos:${position}:id:${participantId}`)
    .digest('hex');
}

/**
 * Executes deterministic Fisher-Yates selection V1 (HMAC_SHA256_FY_V1)
 * with unbiased rejection sampling.
 */
export function executeDeterministicDrawV1(params: DrawExecutionParams): DrawExecutionResult {
  const {
    giveawayId,
    snapshot,
    totalLoadedCount,
    winnersCount,
    reserveWinnersCount,
    seed,
  } = params;

  const eligible = snapshot.eligibleParticipants;

  if (!eligible || eligible.length === 0) {
    throw new Error('Cannot conduct draw with 0 eligible participants in snapshot');
  }

  // 1. Canonical sort to ensure exact invariant input order
  const pool = [...eligible].sort((a, b) =>
    a.platformUserId.localeCompare(b.platformUserId)
  );

  const snapshotHash = snapshot.participantsSnapshotHash;
  const conditionsHash = snapshot.conditionsHash;

  // 2. Initialize unbiased HMAC stream keyed by seed and snapshotHash
  const stream = new DeterministicHmacStream(seed, snapshotHash);

  const totalNeeded = Math.min(winnersCount + reserveWinnersCount, pool.length);
  const actualWinnersCount = Math.min(winnersCount, totalNeeded);
  const actualReserveCount = Math.max(0, totalNeeded - actualWinnersCount);

  const winners: Winner[] = [];
  const reserveWinners: Winner[] = [];
  const winnerIds: string[] = [];
  const reserveWinnerIds: string[] = [];

  // 3. Select Main Winners (Fisher-Yates removal without replacement)
  for (let i = 0; i < actualWinnersCount; i++) {
    const selectedIndex = stream.sampleUnbiasedIndex(pool.length);
    const selectedParticipant = pool.splice(selectedIndex, 1)[0];
    const proofHash = generateWinnerProofHash(seed, snapshotHash, i + 1, selectedParticipant.platformUserId);

    winners.push({
      position: i + 1,
      isReserve: false,
      participant: selectedParticipant,
      selectionIndex: selectedIndex,
      proofHash,
    });
    winnerIds.push(selectedParticipant.platformUserId);
  }

  // 4. Select Reserve Winners
  for (let i = 0; i < actualReserveCount; i++) {
    const pos = winners.length + i + 1;
    const selectedIndex = stream.sampleUnbiasedIndex(pool.length);
    const selectedParticipant = pool.splice(selectedIndex, 1)[0];
    const proofHash = generateWinnerProofHash(seed, snapshotHash, pos, selectedParticipant.platformUserId);

    reserveWinners.push({
      position: pos,
      isReserve: true,
      participant: selectedParticipant,
      selectionIndex: selectedIndex,
      proofHash,
    });
    reserveWinnerIds.push(selectedParticipant.platformUserId);
  }

  const drawId = 'draw_' + randomBytes(8).toString('hex');
  const drawnAt = new Date().toISOString();

  // 5. Compute canonical auditHash
  const auditHash = computeAuditHash({
    algorithmVersion: ALGORITHM_VERSION_V1,
    giveawayId,
    snapshotId: snapshot.id,
    seed,
    participantsSnapshotHash: snapshotHash,
    conditionsHash,
    winnerIds,
    reserveWinnerIds,
    eligibleCount: eligible.length,
    drawId,
    drawnAt,
  });

  return {
    drawId,
    giveawayId,
    snapshotId: snapshot.id,
    winners,
    reserveWinners,
    winnerIds,
    reserveWinnerIds,
    totalEligibleCount: eligible.length,
    totalLoadedCount,
    seedUsed: seed,
    participantsSnapshotHash: snapshotHash,
    conditionsHash,
    algorithmVersion: ALGORITHM_VERSION_V1,
    drawnAt,
    auditHash,
  };
}

/**
 * Universal entrypoint (routes to active algorithm version V1)
 */
export function executeDeterministicDraw(params: DrawExecutionParams): DrawExecutionResult {
  return executeDeterministicDrawV1(params);
}

/**
 * Re-runs draw algorithm on a snapshot to verify identical outcome
 */
export function verifyDrawResult(
  snapshot: ParticipantSnapshotData,
  seed: string,
  claimedWinnersCount: number,
  claimedReserveCount: number,
  algorithmVersion: string = ALGORITHM_VERSION_V1
): { winners: Winner[]; reserveWinners: Winner[]; winnerIds: string[]; reserveWinnerIds: string[]; auditHash: string } {
  if (algorithmVersion !== ALGORITHM_VERSION_V1) {
    throw new Error(`Unsupported algorithm version for replay: ${algorithmVersion}`);
  }

  const result = executeDeterministicDrawV1({
    giveawayId: snapshot.giveawayId,
    snapshot,
    totalLoadedCount: snapshot.participantCount,
    winnersCount: claimedWinnersCount,
    reserveWinnersCount: claimedReserveCount,
    seed,
    filterRules: {} as any,
  });

  return {
    winners: result.winners,
    reserveWinners: result.reserveWinners,
    winnerIds: result.winnerIds,
    reserveWinnerIds: result.reserveWinnerIds,
    auditHash: result.auditHash,
  };
}
