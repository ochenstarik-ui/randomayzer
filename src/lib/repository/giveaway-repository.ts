import { FilterRules, GiveawayStatusType, PlatformType, PostMetadata } from '../../core/types/giveaway';
import { FilteredParticipant, RawParticipant } from '../../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../../core/types/audit';

export interface CreateGiveawayInput {
  sourceUrl: string;
  post: PostMetadata;
  filterRules: FilterRules;
  winnersCount?: number;
  reserveWinnersCount?: number;
  seed?: string;
}

export interface GiveawayWithRelations {
  id: string;
  platform: PlatformType;
  sourceUrl: string;
  platformOwnerId: string;
  platformPostId: string;
  title: string;
  description: string | null;
  postImageUrl: string | null;
  postLikesCount: number;
  postCommentsCount: number;
  postRepostsCount: number;
  status: GiveawayStatusType;
  filterRules: FilterRules;
  winnersCount: number;
  reserveWinnersCount: number;
  seed: string | null;
  createdAt: string;
  updatedAt: string;
  drawnAt: string | null;
  participants: FilteredParticipant[];
  snapshots: ParticipantSnapshotData[];
  latestSnapshot?: ParticipantSnapshotData | null;
  drawResult?: DrawExecutionResult | null;
}

export interface IGiveawayRepository {
  createGiveaway(input: CreateGiveawayInput): Promise<GiveawayWithRelations>;
  getGiveawayById(id: string): Promise<GiveawayWithRelations | null>;
  listGiveaways(): Promise<GiveawayWithRelations[]>;
  updateStatus(id: string, status: GiveawayStatusType): Promise<GiveawayWithRelations>;
  saveParticipants(id: string, participants: FilteredParticipant[]): Promise<GiveawayWithRelations>;
  createAndLockSnapshot(id: string, eligibleParticipants: FilteredParticipant[], rules: FilterRules): Promise<ParticipantSnapshotData>;
  getLatestSnapshot(giveawayId: string): Promise<ParticipantSnapshotData | null>;
  saveDrawResultAndAudit(id: string, snapshotId: string, result: DrawExecutionResult): Promise<GiveawayWithRelations>;
}
