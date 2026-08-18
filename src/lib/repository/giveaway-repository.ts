import { FilterRules, GiveawayStatusType, PlatformType, PostMetadata } from '../../core/types/giveaway';
import { FilteredParticipant } from '../../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../../core/types/audit';

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
  organizerId: string;
  createdAt: string;
  updatedAt: string;
  drawnAt: string | null;
  participants: FilteredParticipant[];
  snapshots: ParticipantSnapshotData[];
  latestSnapshot: ParticipantSnapshotData | null;
  drawResult: DrawExecutionResult | null;
}

export interface GiveawaySummary {
  id: string;
  platform: PlatformType;
  sourceUrl: string;
  platformOwnerId: string;
  platformPostId: string;
  title: string;
  postImageUrl: string | null;
  postLikesCount: number;
  postCommentsCount: number;
  postRepostsCount: number;
  status: GiveawayStatusType;
  winnersCount: number;
  reserveWinnersCount: number;
  organizerId: string;
  createdAt: string;
  updatedAt: string;
  drawnAt: string | null;
  totalParticipantsCount: number;
  eligibleParticipantsCount: number;
  hasDrawResult: boolean;
  algorithmVersion: string | null;
}

export interface PaginatedParticipantsResult {
  participants: FilteredParticipant[];
  page: number;
  pageSize: number;
  totalCount: number;
  eligibleCount: number;
  excludedCount: number;
  totalPages: number;
}

export interface CreateGiveawayInput {
  sourceUrl: string;
  post: PostMetadata;
  filterRules: FilterRules;
  winnersCount?: number;
  reserveWinnersCount?: number;
  seed?: string;
  organizerId: string;
}

export interface IGiveawayRepository {
  createGiveaway(input: CreateGiveawayInput): Promise<GiveawayWithRelations>;
  getGiveawayById(id: string): Promise<GiveawayWithRelations | null>;
  listGiveaways(): Promise<GiveawayWithRelations[]>;
  listGiveawaysSummary(): Promise<GiveawaySummary[]>;
  getParticipantsPaginated(
    id: string, 
    page: number, 
    pageSize: number, 
    tab?: 'all' | 'eligible' | 'excluded'
  ): Promise<PaginatedParticipantsResult>;
  updateStatus(id: string, status: GiveawayStatusType): Promise<GiveawayWithRelations>;
  saveParticipants(id: string, participants: FilteredParticipant[]): Promise<GiveawayWithRelations>;
  createAndLockSnapshot(
    id: string, 
    eligibleParticipants: FilteredParticipant[], 
    rules: FilterRules
  ): Promise<ParticipantSnapshotData>;
  getLatestSnapshot(giveawayId: string): Promise<ParticipantSnapshotData | null>;
  saveDrawResultAndAudit(
    id: string, 
    snapshotId: string, 
    result: DrawExecutionResult
  ): Promise<GiveawayWithRelations>;
}
