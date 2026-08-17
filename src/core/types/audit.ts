import { FilterRules } from './giveaway';
import { FilteredParticipant, Winner } from './participant';

export const ALGORITHM_HMAC_SHA256_FY_V1 = 'HMAC_SHA256_FY_V1';
export const CURRENT_RANDOMIZER_ALGORITHM = ALGORITHM_HMAC_SHA256_FY_V1;

export interface ParticipantSnapshotData {
  id: string;
  giveawayId: string;
  version: number;
  createdAt: string;
  eligibleParticipants: FilteredParticipant[];
  filterRulesSnapshot: FilterRules;
  participantCount: number;
  participantsSnapshotHash: string;
  conditionsHash: string;
}

export interface DrawExecutionParams {
  giveawayId: string;
  snapshot: ParticipantSnapshotData;
  totalLoadedCount: number;
  winnersCount: number;
  reserveWinnersCount: number;
  seed: string;
  filterRules?: FilterRules;
}

export interface DrawExecutionResult {
  drawId: string;
  giveawayId: string;
  snapshotId: string;
  winners: Winner[];
  reserveWinners: Winner[];
  winnerIds: string[];
  reserveWinnerIds: string[];
  totalEligibleCount: number;
  totalLoadedCount: number;
  seedUsed: string;
  participantsSnapshotHash: string;
  conditionsHash: string;
  algorithmVersion: string;
  deterministicProofHash: string;
  auditEventHash: string;
  drawnAt: string; // ISO String
}

export interface AuditRecordData {
  id: string;
  giveawayId: string;
  snapshotId: string;
  algorithmVersion: string;
  seed: string;
  participantsSnapshotHash: string;
  conditionsHash: string;
  deterministicProofHash: string;
  auditEventHash: string;
  winnerIds: string[];
  reserveWinnerIds: string[];
  eligibleCount: number;
  drawId: string;
  drawnAt: string;
  verifiedAt: string;
}

export interface VerificationParams {
  giveawayId: string;
  drawId: string;
  drawnAt: string;
  snapshot: ParticipantSnapshotData;
  seed: string;
  claimedWinnersCount: number;
  claimedReserveCount: number;
  claimedWinnerIds: string[];
  claimedReserveWinnerIds: string[];
  claimedDeterministicProofHash: string;
  claimedAuditEventHash: string;
  algorithmVersion?: string;
}

export interface VerificationResult {
  verified: boolean;
  algorithmVersion: string;
  algorithmSupported: boolean;
  participantsSnapshotIntegrity: boolean;
  conditionsIntegrity: boolean;
  winnersMatch: boolean;
  reserveWinnersMatch: boolean;
  deterministicProofHashMatch: boolean;
  auditEventHashMatch: boolean;
  expectedWinners: Winner[];
  expectedReserveWinners: Winner[];
  expectedWinnerIds: string[];
  expectedReserveWinnerIds: string[];
  expectedDeterministicProofHash: string;
  expectedAuditEventHash: string;
  actualDeterministicProofHash: string;
  actualAuditEventHash: string;
}
