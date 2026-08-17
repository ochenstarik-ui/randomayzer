import { ParticipantSourceType } from './giveaway';

export interface ParticipantProfile {
  platformUserId: string;
  firstName: string;
  lastName: string;
  username?: string;
  avatarUrl?: string;
}

export interface ParticipantActions {
  liked: boolean;
  commented: boolean;
  commentsCount: number;
  reposted: boolean;
  subscribed: boolean;
  isAdmin?: boolean;
}

export interface RawParticipant extends ParticipantProfile, ParticipantActions {
  source: ParticipantSourceType;
}

export interface FilteredParticipant extends RawParticipant {
  id?: string;
  eligible: boolean;
  exclusionReason?: string | null;
}

export interface Winner {
  position: number; // 1, 2, 3...
  isReserve: boolean;
  participant: FilteredParticipant;
  selectionIndex: number;
  proofHash: string;
}
