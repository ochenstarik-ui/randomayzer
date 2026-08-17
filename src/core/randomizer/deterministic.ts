import { createHash, randomBytes } from 'crypto';
import { FilteredParticipant, Winner } from '../types/participant';
import { 
  DrawExecutionParams, 
  DrawExecutionResult, 
  ALGORITHM_HMAC_SHA256_FY_V1, 
  ParticipantSnapshotData,
  VerificationParams,
  VerificationResult
} from '../types/audit';
import { DeterministicHmacStream } from './unbiased-sampler';
import { 
  computeDeterministicProofHash, 
  computeAuditEventHash,
  computeParticipantsSnapshotHash,
  computeConditionsHash
} from './canonical';

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
 * Re-runs draw algorithm on a snapshot to verify identical outcome and all cryptographic integrity hashes
 */
export function verifyDrawResult(params: VerificationParams): VerificationResult {
  const {
    giveawayId,
    drawId,
    drawnAt,
    snapshot,
    seed,
    claimedWinnersCount,
    claimedReserveCount,
    claimedWinnerIds = [],
    claimedReserveWinnerIds = [],
    claimedDeterministicProofHash = '',
    claimedAuditEventHash = '',
    algorithmVersion = ALGORITHM_VERSION_V1,
  } = params;

  const algorithmSupported = (algorithmVersion === ALGORITHM_VERSION_V1);

  // 1. Check Participant Snapshot Integrity: real recalculation from array
  const computedSnapshotHash = computeParticipantsSnapshotHash(snapshot.eligibleParticipants || []);
  const participantsSnapshotIntegrity = (computedSnapshotHash === snapshot.participantsSnapshotHash);

  // 2. Check Conditions Integrity: real recalculation from filter rules snapshot
  const computedConditionsHash = computeConditionsHash(snapshot.filterRulesSnapshot || {} as any);
  const conditionsIntegrity = (computedConditionsHash === snapshot.conditionsHash);

  // 3. Replay randomizer
  let replayed: DrawExecutionResult | null = null;
  let replayError = false;

  try {
    replayed = executeDeterministicDrawV1({
      giveawayId,
      snapshot,
      totalLoadedCount: snapshot.participantCount,
      winnersCount: claimedWinnersCount,
      reserveWinnersCount: claimedReserveCount,
      seed,
    });
  } catch {
    replayError = true;
  }

  const winnersMatch = !replayError && replayed !== null
    ? JSON.stringify(replayed.winnerIds) === JSON.stringify(claimedWinnerIds)
    : false;

  const reserveWinnersMatch = !replayError && replayed !== null
    ? JSON.stringify(replayed.reserveWinnerIds) === JSON.stringify(claimedReserveWinnerIds)
    : false;

  const deterministicProofHashMatch = !replayError && replayed !== null
    ? replayed.deterministicProofHash === claimedDeterministicProofHash
    : false;

  // 4. Check Audit Event Hash: recomputed from giveawayId, drawId, drawnAt, and proof hash
  const expectedAuditEventHash = (!replayError && replayed !== null)
    ? computeAuditEventHash({
        giveawayId,
        drawId,
        drawnAt,
        deterministicProofHash: replayed.deterministicProofHash,
      })
    : '';

  const auditEventHashMatch = (expectedAuditEventHash === claimedAuditEventHash);

  const verified = (
    algorithmSupported &&
    participantsSnapshotIntegrity &&
    conditionsIntegrity &&
    winnersMatch &&
    reserveWinnersMatch &&
    deterministicProofHashMatch &&
    auditEventHashMatch
  );

  return {
    verified,
    algorithmVersion,
    algorithmSupported,
    participantsSnapshotIntegrity,
    conditionsIntegrity,
    winnersMatch,
    reserveWinnersMatch,
    deterministicProofHashMatch,
    auditEventHashMatch,
    expectedWinners: replayed?.winners || [],
    expectedReserveWinners: replayed?.reserveWinners || [],
    expectedWinnerIds: replayed?.winnerIds || [],
    expectedReserveWinnerIds: replayed?.reserveWinnerIds || [],
    expectedDeterministicProofHash: replayed?.deterministicProofHash || '',
    expectedAuditEventHash,
    actualDeterministicProofHash: claimedDeterministicProofHash,
    actualAuditEventHash: claimedAuditEventHash,
  };
}
