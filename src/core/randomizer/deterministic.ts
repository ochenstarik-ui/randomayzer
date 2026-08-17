import { createHmac, createHash } from 'crypto';
import { FilteredParticipant, Winner } from '../types/participant';
import { DrawExecutionParams, DrawExecutionResult } from '../types/audit';
import { computeParticipantsSnapshotHash } from './hasher';

const ALGORITHM_NAME = 'HMAC-SHA256-SEEDED-SELECTION-V1';

/**
 * Deterministic pseudo-random number generator using HMAC-SHA256.
 * Given a seed, snapshot hash, and step/index, generates a deterministic 32-bit unsigned integer.
 */
export function getDeterministicUint32(seed: string, snapshotHash: string, step: number): number {
  const hmac = createHmac('sha256', seed);
  hmac.update(`${snapshotHash}:step:${step}`);
  const hashBuffer = hmac.digest();
  // Read first 4 bytes as unsigned 32-bit big endian integer
  return hashBuffer.readUInt32BE(0);
}

/**
 * Generates an audit proof hash for a specific winner step
 */
export function generateWinnerProofHash(seed: string, snapshotHash: string, position: number, participantId: string): string {
  return createHash('sha256')
    .update(`${seed}:${snapshotHash}:pos:${position}:id:${participantId}`)
    .digest('hex');
}

/**
 * Executes a deterministic draw on a set of eligible participants.
 * Guarantees that the same eligible participants + same seed ALWAYS produce the exact same winners.
 */
export function executeDeterministicDraw(params: DrawExecutionParams): DrawExecutionResult {
  const {
    giveawayId,
    eligibleParticipants,
    totalLoadedCount,
    winnersCount,
    reserveWinnersCount,
    seed,
    filterRules,
  } = params;

  if (eligibleParticipants.length === 0) {
    throw new Error('Cannot conduct draw with 0 eligible participants');
  }

  // 1. Canonical sort to guarantee stability
  const sortedParticipants = [...eligibleParticipants].sort((a, b) =>
    a.platformUserId.localeCompare(b.platformUserId)
  );

  // 2. Compute canonical snapshot hash
  const snapshotHash = computeParticipantsSnapshotHash(sortedParticipants);

  // 3. Clone pool for sampling without replacement
  const pool = [...sortedParticipants];
  const winners: Winner[] = [];
  const reserveWinners: Winner[] = [];

  const totalNeeded = Math.min(winnersCount + reserveWinnersCount, pool.length);
  const actualWinnersCount = Math.min(winnersCount, totalNeeded);
  const actualReserveCount = Math.max(0, totalNeeded - actualWinnersCount);

  let step = 0;

  // 4. Select Main Winners
  for (let i = 0; i < actualWinnersCount; i++) {
    const randUint = getDeterministicUint32(seed, snapshotHash, step);
    const selectedIndex = randUint % pool.length;
    const selectedParticipant = pool.splice(selectedIndex, 1)[0];

    const proofHash = generateWinnerProofHash(seed, snapshotHash, i + 1, selectedParticipant.platformUserId);

    winners.push({
      position: i + 1,
      isReserve: false,
      participant: selectedParticipant,
      selectionIndex: selectedIndex,
      proofHash,
    });

    step++;
  }

  // 5. Select Reserve Winners
  for (let i = 0; i < actualReserveCount; i++) {
    const randUint = getDeterministicUint32(seed, snapshotHash, step);
    const selectedIndex = randUint % pool.length;
    const selectedParticipant = pool.splice(selectedIndex, 1)[0];

    const proofHash = generateWinnerProofHash(seed, snapshotHash, winners.length + i + 1, selectedParticipant.platformUserId);

    reserveWinners.push({
      position: winners.length + i + 1,
      isReserve: true,
      participant: selectedParticipant,
      selectionIndex: selectedIndex,
      proofHash,
    });

    step++;
  }

  const drawnAt = new Date().toISOString();

  // 6. Compute overall verification signature
  const verificationSignature = createHash('sha256')
    .update(JSON.stringify({
      giveawayId,
      snapshotHash,
      seed,
      algorithm: ALGORITHM_NAME,
      winnerIds: winners.map(w => w.participant.platformUserId),
      reserveIds: reserveWinners.map(w => w.participant.platformUserId),
    }))
    .digest('hex');

  return {
    giveawayId,
    winners,
    reserveWinners,
    totalEligibleCount: eligibleParticipants.length,
    totalLoadedCount,
    seedUsed: seed,
    participantsSnapshotHash: snapshotHash,
    algorithm: ALGORITHM_NAME,
    drawnAt,
    verificationSignature,
  };
}

/**
 * Re-runs the draw algorithm with the given snapshot of participants and seed
 * to verify if the produced outcome matches the claimed outcome.
 */
export function verifyDrawResult(
  eligibleParticipants: FilteredParticipant[],
  seed: string,
  claimedWinnersCount: number,
  claimedReserveCount: number
): { winners: Winner[]; reserveWinners: Winner[]; snapshotHash: string } {
  const result = executeDeterministicDraw({
    giveawayId: 'verification',
    eligibleParticipants,
    totalLoadedCount: eligibleParticipants.length,
    winnersCount: claimedWinnersCount,
    reserveWinnersCount: claimedReserveCount,
    seed,
    filterRules: {} as any,
  });

  return {
    winners: result.winners,
    reserveWinners: result.reserveWinners,
    snapshotHash: result.participantsSnapshotHash,
  };
}
