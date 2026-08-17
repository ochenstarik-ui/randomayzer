import { FilterRules } from './giveaway';
import { FilteredParticipant, Winner } from './participant';

export const CURRENT_RANDOMIZER_ALGORITHM = 'HMAC_SHA256_FY_V1';

export interface ParticipantSnapshotData {
  id: string;
  giveawayId: string;
  version: number;
  createdAt: string;
  eligibleParticipants: FilteredParticipant[];
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
  filterRules: FilterRules;
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
  drawnAt: string; // ISO String
  auditHash: string;
}

export interface AuditRecordData {
  id: string;
  giveawayId: string;
  snapshotId: string;
  algorithmVersion: string;
  seed: string;
  participantsSnapshotHash: string;
  conditionsHash: string;
  auditHash: string;
  winnerIds: string[];
  reserveWinnerIds: string[];
  eligibleCount: number;
  drawId: string;
  drawnAt: string;
  verifiedAt: string;
}
