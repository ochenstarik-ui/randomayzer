import { 
  IGiveawayRepository, 
  CreateGiveawayInput, 
  GiveawayWithRelations,
  GiveawaySummary,
  PaginatedParticipantsResult
} from './giveaway-repository';
import { FilterRules, GiveawayStatusType, PlatformType } from '../../core/types/giveaway';
import { FilteredParticipant } from '../../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../../core/types/audit';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../../core/randomizer/canonical';
import { GiveawayFSM } from '../../core/fsm/giveaway-fsm';
import { ConflictError, NotFoundError } from '../../core/errors/http-errors';

export class MemoryGiveawayRepository implements IGiveawayRepository {
  private giveaways: Map<string, GiveawayWithRelations> = new Map();
  private snapshots: Map<string, ParticipantSnapshotData[]> = new Map();
  private drawLocks: Set<string> = new Set();

  async createGiveaway(input: CreateGiveawayInput): Promise<GiveawayWithRelations> {
    if (!input.organizerId) {
      throw new Error('FATAL: organizerId is strictly required to create a giveaway in repository');
    }

    const id = 'gw_' + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();

    const gw: GiveawayWithRelations = {
      id,
      platform: input.post.platform,
      sourceUrl: input.sourceUrl,
      platformOwnerId: input.post.ownerId,
      platformPostId: input.post.postId,
      title: input.post.title,
      description: input.post.text || null,
      postImageUrl: input.post.imageUrl || null,
      postLikesCount: input.post.likesCount,
      postCommentsCount: input.post.commentsCount,
      postRepostsCount: input.post.repostsCount,
      status: 'READY',
      filterRules: input.filterRules,
      winnersCount: input.winnersCount || 1,
      reserveWinnersCount: input.reserveWinnersCount || 0,
      seed: input.seed || null,
      organizerId: input.organizerId,
      createdAt: now,
      updatedAt: now,
      drawnAt: null,
      participants: [],
      snapshots: [],
      latestSnapshot: null,
      drawResult: null,
    };

    this.giveaways.set(id, gw);
    this.snapshots.set(id, []);
    return gw;
  }

  async getGiveawayById(id: string): Promise<GiveawayWithRelations | null> {
    const gw = this.giveaways.get(id);
    if (!gw) return null;

    const snaps = this.snapshots.get(id) || [];
    const latest = snaps.length > 0 ? snaps[snaps.length - 1] : null;

    let drawResult = gw.drawResult;
    if (drawResult) {
      const boundSnapshot = snaps.find(s => s.id === drawResult?.snapshotId) || latest;
      drawResult = {
        ...drawResult,
        participantsSnapshotHash: boundSnapshot?.participantsSnapshotHash || '',
        conditionsHash: boundSnapshot?.conditionsHash || '',
      };
    }

    return {
      ...gw,
      snapshots: [...snaps],
      latestSnapshot: latest,
      drawResult,
    };
  }

  async listGiveaways(): Promise<GiveawayWithRelations[]> {
    const all = Array.from(this.giveaways.values());
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async listGiveawaysSummary(): Promise<GiveawaySummary[]> {
    const all = await this.listGiveaways();
    return all.map(gw => ({
      id: gw.id,
      platform: gw.platform,
      sourceUrl: gw.sourceUrl,
      platformOwnerId: gw.platformOwnerId,
      platformPostId: gw.platformPostId,
      title: gw.title,
      postImageUrl: gw.postImageUrl,
      postLikesCount: gw.postLikesCount,
      postCommentsCount: gw.postCommentsCount,
      postRepostsCount: gw.postRepostsCount,
      status: gw.status,
      winnersCount: gw.winnersCount,
      reserveWinnersCount: gw.reserveWinnersCount,
      organizerId: gw.organizerId,
      createdAt: gw.createdAt,
      updatedAt: gw.updatedAt,
      drawnAt: gw.drawnAt,
      totalParticipantsCount: gw.participants.length,
      eligibleParticipantsCount: gw.drawResult?.totalEligibleCount || gw.participants.filter(p => p.eligible).length,
      hasDrawResult: Boolean(gw.drawResult),
      algorithmVersion: gw.drawResult?.algorithmVersion || null,
    }));
  }

  async getParticipantsPaginated(
    id: string, 
    page: number = 1, 
    pageSize: number = 50, 
    tab: 'all' | 'eligible' | 'excluded' = 'all'
  ): Promise<PaginatedParticipantsResult> {
    const gw = this.giveaways.get(id);
    if (!gw) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    const all = gw.participants;
    const eligibleCount = all.filter(p => p.eligible).length;
    const excludedCount = all.filter(p => !p.eligible).length;
    const totalCount = all.length;

    let filtered = all;
    if (tab === 'eligible') filtered = all.filter(p => p.eligible);
    if (tab === 'excluded') filtered = all.filter(p => !p.eligible);

    const relevantCount = filtered.length;
    const totalPages = Math.ceil(relevantCount / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const paginatedItems = filtered.slice(start, start + pageSize);

    return {
      participants: paginatedItems,
      page,
      pageSize,
      totalCount,
      eligibleCount,
      excludedCount,
      totalPages,
    };
  }

  async updateStatus(id: string, newStatus: GiveawayStatusType): Promise<GiveawayWithRelations> {
    const gw = this.giveaways.get(id);
    if (!gw) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    GiveawayFSM.validateTransition(gw.status, newStatus);
    gw.status = newStatus;
    gw.updatedAt = new Date().toISOString();
    return gw;
  }

  async saveParticipants(id: string, participants: FilteredParticipant[]): Promise<GiveawayWithRelations> {
    const gw = this.giveaways.get(id);
    if (!gw) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    if (gw.status !== 'READY') {
      throw new ConflictError(
        `Cannot modify participants: giveaway "${id}" is in status "${gw.status}", but requires "READY"`
      );
    }

    gw.participants = participants;
    gw.status = 'READY';
    gw.updatedAt = new Date().toISOString();
    return gw;
  }

  async createAndLockSnapshot(
    id: string, 
    eligibleParticipants: FilteredParticipant[], 
    rules: FilterRules
  ): Promise<ParticipantSnapshotData> {
    const gw = this.giveaways.get(id);
    if (!gw) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    if (gw.status === 'DRAWN' || gw.status === 'PUBLISHED') {
      throw new ConflictError(`Cannot lock snapshot in final status "${gw.status}"`);
    }

    if (eligibleParticipants.length === 0) {
      throw new ConflictError('Cannot create snapshot with 0 eligible participants');
    }

    const participantsSnapshotHash = computeParticipantsSnapshotHash(eligibleParticipants);
    const conditionsHash = computeConditionsHash(rules);

    const snaps = this.snapshots.get(id) || [];
    const newVersion = snaps.length + 1;
    const snapId = 'snap_' + Math.random().toString(36).slice(2, 10);

    const snapshot: ParticipantSnapshotData = {
      id: snapId,
      giveawayId: id,
      version: newVersion,
      createdAt: new Date().toISOString(),
      eligibleParticipants: [...eligibleParticipants],
      filterRulesSnapshot: { ...rules },
      participantCount: eligibleParticipants.length,
      participantsSnapshotHash,
      conditionsHash,
    };

    snaps.push(snapshot);
    this.snapshots.set(id, snaps);

    gw.status = 'SNAPSHOT_LOCKED';
    gw.filterRules = rules;
    gw.latestSnapshot = snapshot;
    gw.updatedAt = new Date().toISOString();

    return snapshot;
  }

  async getLatestSnapshot(giveawayId: string): Promise<ParticipantSnapshotData | null> {
    const snaps = this.snapshots.get(giveawayId) || [];
    return snaps.length > 0 ? snaps[snaps.length - 1] : null;
  }

  async saveDrawResultAndAudit(
    id: string, 
    snapshotId: string, 
    result: DrawExecutionResult
  ): Promise<GiveawayWithRelations> {
    // Atomic test & set lock check
    if (this.drawLocks.has(id)) {
      throw new ConflictError(`Giveaway "${id}" has already been drawn or is concurrently drawing.`);
    }

    const gw = this.giveaways.get(id);
    if (!gw) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    if (gw.status !== 'SNAPSHOT_LOCKED') {
      throw new ConflictError(`Giveaway is in status "${gw.status}", but draw requires "SNAPSHOT_LOCKED"`);
    }

    if (gw.drawResult) {
      throw new ConflictError(`Giveaway "${id}" has already been drawn.`);
    }

    // Acquire lock and transition
    this.drawLocks.add(id);

    gw.drawResult = result;
    gw.status = 'DRAWN';
    gw.drawnAt = result.drawnAt;
    gw.seed = result.seedUsed;
    gw.updatedAt = new Date().toISOString();

    return gw;
  }
}
