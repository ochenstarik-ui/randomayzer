import { FilterRules } from './giveaway';
import { FilteredParticipant, Winner } from './participant';

export interface DrawExecutionParams {
  giveawayId: string;
  eligibleParticipants: FilteredParticipant[];
  totalLoadedCount: number;
  winnersCount: number;
  reserveWinnersCount: number;
  seed: string;
  filterRules: FilterRules;
}

export interface DrawExecutionResult {
  giveawayId: string;
  winners: Winner[];
  reserveWinners: Winner[];
  totalEligibleCount: number;
  totalLoadedCount: number;
  seedUsed: string;
  participantsSnapshotHash: string;
  algorithm: string;
  drawnAt: string; // ISO String
  verificationSignature: string;
}

export interface AuditVerificationData {
  participantsSnapshotHash: string;
  seed: string;
  algorithm: string;
  filterRulesSnapshot: FilterRules;
  winners: Winner[];
  reserveWinners: Winner[];
  drawnAt: string;
}
