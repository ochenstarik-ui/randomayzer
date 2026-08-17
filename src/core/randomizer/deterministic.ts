import { createHash, randomBytes } from 'crypto';
import { FilteredParticipant, Winner } from '../types/participant';
import { 
  DrawExecutionParams, 
  DrawExecutionResult, 
  ALGORITHM_HMAC_SHA256_FY_V1, 
  ParticipantSnapshotData,
  VerificationResult
} from '../types/audit';
import { DeterministicHmacStream } from './unbiased-sampler';
import { computeDeterministicProofHash, computeAuditEventHash } from './canonical';

export const ALGORITHM_VERSION_V1 = ALGORITHM_HMAC_SHA256_FY_V1; // 'HMAC_SHA256_FY_V1'

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
 * Executes true partial Fisher-Yates shuffle V1 (HMAC_SHA256_FY_V1)
 * with in-place swap and unbiased rejection sampling.
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

  // 1. Canonical sort to guarantee exact invariant input ordering
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

  // 3. True partial Fisher-Yates shuffle: swap pool[i] with pool[j] where j in [i, n-1]
  for (let i = 0; i < totalNeeded; i++) {
    const remainingCount = pool.length - i;
    const offset = stream.sampleUnbiasedIndex(remainingCount);
    const j = i + offset;

    // In-place swap
    const temp = pool[i];
    pool[i] = pool[j];
    pool[j] = temp;
  }

  const winners: Winner[] = [];
  const reserveWinners: Winner[] = [];
  const winnerIds: string[] = [];
  const reserveWinnerIds: string[] = [];

  // 4. Map Main Winners from pool[0 ... actualWinnersCount - 1]
  for (let i = 0; i < actualWinnersCount; i++) {
    const selectedParticipant = pool[i];
    const proofHash = generateWinnerProofHash(seed, snapshotHash, i + 1, selectedParticipant.platformUserId);

    winners.push({
      position: i + 1,
      isReserve: false,
      participant: selectedParticipant,
      selectionIndex: i,
      proofHash,
    });
    winnerIds.push(selectedParticipant.platformUserId);
  }

  // 5. Map Reserve Winners from pool[actualWinnersCount ... totalNeeded - 1]
  for (let i = 0; i < actualReserveCount; i++) {
    const idx = actualWinnersCount + i;
    const pos = idx + 1;
    const selectedParticipant = pool[idx];
    const proofHash = generateWinnerProofHash(seed, snapshotHash, pos, selectedParticipant.platformUserId);

    reserveWinners.push({
      position: pos,
      isReserve: true,
      participant: selectedParticipant,
      selectionIndex: idx,
      proofHash,
    });
    reserveWinnerIds.push(selectedParticipant.platformUserId);
  }

  const drawId = 'draw_' + randomBytes(8).toString('hex');
  const drawnAt = new Date().toISOString();

  // 6. Compute deterministicProofHash (reproducible upon replay)
  const deterministicProofHash = computeDeterministicProofHash({
    algorithmVersion: ALGORITHM_VERSION_V1,
    snapshotId: snapshot.id,
    participantsSnapshotHash: snapshotHash,
    conditionsHash,
    seed,
    winnerIds,
    reserveWinnerIds,
    eligibleCount: eligible.length,
  });

  // 7. Compute auditEventHash (unique for this draw execution instance)
  const auditEventHash = computeAuditEventHash({
    giveawayId,
    drawId,
    drawnAt,
    deterministicProofHash,
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
    deterministicProofHash,
    auditEventHash,
    drawnAt,
  };
}

/**
 * Universal entrypoint (routes to algorithm version)
 */
export function executeDeterministicDraw(params: DrawExecutionParams): DrawExecutionResult {
  return executeDeterministicDrawV1(params);
}

/**
 * Re-runs draw algorithm on a snapshot to verify identical outcome and hashes
 */
export function verifyDrawResult(
  snapshot: ParticipantSnapshotData,
  seed: string,
  claimedWinnersCount: number,
  claimedReserveCount: number,
  claimedWinnerIds?: string[],
  claimedDeterministicProofHash?: string,
  algorithmVersion: string = ALGORITHM_VERSION_V1
): VerificationResult {
  if (algorithmVersion !== ALGORITHM_VERSION_V1) {
    throw new Error(`Unsupported algorithm version for replay: ${algorithmVersion}`);
  }

  const replayed = executeDeterministicDrawV1({
    giveawayId: snapshot.giveawayId,
    snapshot,
    totalLoadedCount: snapshot.participantCount,
    winnersCount: claimedWinnersCount,
    reserveWinnersCount: claimedReserveCount,
    seed,
  });

  const winnersMatch = claimedWinnerIds 
    ? JSON.stringify(replayed.winnerIds) === JSON.stringify(claimedWinnerIds)
    : true;

  const deterministicProofHashMatch = claimedDeterministicProofHash
    ? replayed.deterministicProofHash === claimedDeterministicProofHash
    : true;

  const snapshotHashMatch = replayed.participantsSnapshotHash === snapshot.participantsSnapshotHash;
  const conditionsHashMatch = replayed.conditionsHash === snapshot.conditionsHash;

  const verified = winnersMatch && deterministicProofHashMatch && snapshotHashMatch && conditionsHashMatch;

  return {
    verified,
    algorithmVersion: ALGORITHM_VERSION_V1,
    winnersMatch,
    snapshotHashMatch,
    conditionsHashMatch,
    deterministicProofHashMatch,
    expectedWinners: replayed.winners,
    expectedReserveWinners: replayed.reserveWinners,
    expectedWinnerIds: replayed.winnerIds,
    expectedReserveWinnerIds: replayed.reserveWinnerIds,
    expectedDeterministicProofHash: replayed.deterministicProofHash,
    actualDeterministicProofHash: claimedDeterministicProofHash || replayed.deterministicProofHash,
  };
}
