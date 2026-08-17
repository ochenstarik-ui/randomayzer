import { 
  IGiveawayRepository, 
  CreateGiveawayInput, 
  GiveawayWithRelations 
} from './giveaway-repository';
import { FilterRules, GiveawayStatusType, PlatformType } from '../../core/types/giveaway';
import { FilteredParticipant } from '../../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../../core/types/audit';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../../core/randomizer/canonical';
import { GiveawayFSM } from '../../core/fsm/giveaway-fsm';

export class MemoryGiveawayRepository implements IGiveawayRepository {
  private giveaways: Map<string, GiveawayWithRelations> = new Map();
  private snapshots: Map<string, ParticipantSnapshotData[]> = new Map();

  async createGiveaway(input: CreateGiveawayInput): Promise<GiveawayWithRelations> {
    const id = 'gw_' + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();

    const gw: GiveawayWithRelations = {
      id,
      platform: input.post.platform,
      sourceUrl: input.sourceUrl,
      platformOwnerId: input.post.ownerId,
      platformPostId: input.post.postId,
      title: input.post.title,
      description: input.post.text,
      postImageUrl: input.post.imageUrl || null,
      postLikesCount: input.post.likesCount,
      postCommentsCount: input.post.commentsCount,
      postRepostsCount: input.post.repostsCount,
      status: 'READY',
      filterRules: input.filterRules,
      winnersCount: input.winnersCount || 1,
      reserveWinnersCount: input.reserveWinnersCount || 0,
      seed: input.seed || null,
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
      // Strictly bind to the snapshot referenced by snapshotId
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

  async updateStatus(id: string, newStatus: GiveawayStatusType): Promise<GiveawayWithRelations> {
    const gw = await this.getGiveawayById(id);
    if (!gw) throw new Error(`Giveaway with id "${id}" not found`);

    GiveawayFSM.validateTransition(gw.status, newStatus);
    gw.status = newStatus;
    gw.updatedAt = new Date().toISOString();
    this.giveaways.set(id, gw);
    return gw;
  }

  async saveParticipants(id: string, participants: FilteredParticipant[]): Promise<GiveawayWithRelations> {
    const gw = await this.getGiveawayById(id);
    if (!gw) throw new Error(`Giveaway with id "${id}" not found`);

    GiveawayFSM.assertCanModifyParticipants(gw.status);
    gw.participants = participants;
    gw.status = 'READY';
    gw.updatedAt = new Date().toISOString();
    this.giveaways.set(id, gw);
    return gw;
  }

  async createAndLockSnapshot(
    id: string, 
    eligibleParticipants: FilteredParticipant[], 
    rules: FilterRules
  ): Promise<ParticipantSnapshotData> {
    const gw = await this.getGiveawayById(id);
    if (!gw) throw new Error(`Giveaway with id "${id}" not found`);

    if (gw.status === 'DRAWN' || gw.status === 'PUBLISHED') {
      throw new Error(`Cannot lock snapshot in final status "${gw.status}"`);
    }

    if (eligibleParticipants.length === 0) {
      throw new Error('Cannot create snapshot with 0 eligible participants');
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
    this.giveaways.set(id, gw);

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
    const gw = await this.getGiveawayById(id);
    if (!gw) throw new Error(`Giveaway with id "${id}" not found`);

    GiveawayFSM.assertCanDraw(gw.status);

    gw.drawResult = result;
    gw.status = 'DRAWN';
    gw.drawnAt = result.drawnAt;
    gw.seed = result.seedUsed;
    gw.updatedAt = new Date().toISOString();
    this.giveaways.set(id, gw);

    return gw;
  }
}
