import { FilterRules, GiveawayStatusType, PlatformType, PostMetadata } from '../core/types/giveaway';
import { FilteredParticipant, RawParticipant, Winner } from '../core/types/participant';
import { DrawExecutionResult } from '../core/types/audit';

export interface StoredGiveaway {
  id: string;
  platform: PlatformType;
  sourceUrl: string;
  platformOwnerId: string;
  platformPostId: string;
  title: string;
  description?: string;
  postImageUrl?: string;
  postLikesCount: number;
  postCommentsCount: number;
  postRepostsCount: number;
  status: GiveawayStatusType;
  filterRules: FilterRules;
  winnersCount: number;
  reserveWinnersCount: number;
  seed?: string;
  createdAt: string;
  updatedAt: string;
  drawnAt?: string;
  participants: FilteredParticipant[];
  drawResult?: DrawExecutionResult;
}

// In-memory runtime cache/store for fast UI state & standalone dev mode
const memoryStore = new Map<string, StoredGiveaway>();

export class GiveawayStore {
  static async create(data: {
    sourceUrl: string;
    post: PostMetadata;
    filterRules: FilterRules;
    winnersCount?: number;
    reserveWinnersCount?: number;
    seed?: string;
  }): Promise<StoredGiveaway> {
    const id = 'gw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();

    const giveaway: StoredGiveaway = {
      id,
      platform: data.post.platform,
      sourceUrl: data.sourceUrl,
      platformOwnerId: data.post.ownerId,
      platformPostId: data.post.postId,
      title: data.post.title,
      description: data.post.text,
      postImageUrl: data.post.imageUrl,
      postLikesCount: data.post.likesCount,
      postCommentsCount: data.post.commentsCount,
      postRepostsCount: data.post.repostsCount,
      status: 'READY',
      filterRules: data.filterRules,
      winnersCount: data.winnersCount || 1,
      reserveWinnersCount: data.reserveWinnersCount || 0,
      seed: data.seed,
      createdAt: now,
      updatedAt: now,
      participants: [],
    };

    memoryStore.set(id, giveaway);
    return giveaway;
  }

  static async getById(id: string): Promise<StoredGiveaway | null> {
    return memoryStore.get(id) || null;
  }

  static async listAll(): Promise<StoredGiveaway[]> {
    return Array.from(memoryStore.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  static async updateParticipants(id: string, participants: FilteredParticipant[]): Promise<StoredGiveaway> {
    const gw = memoryStore.get(id);
    if (!gw) throw new Error('Giveaway not found');

    gw.participants = participants;
    gw.updatedAt = new Date().toISOString();
    memoryStore.set(id, gw);
    return gw;
  }

  static async saveDrawResult(id: string, result: DrawExecutionResult): Promise<StoredGiveaway> {
    const gw = memoryStore.get(id);
    if (!gw) throw new Error('Giveaway not found');

    gw.drawResult = result;
    gw.status = 'COMPLETED';
    gw.drawnAt = result.drawnAt;
    gw.seed = result.seedUsed;
    gw.updatedAt = new Date().toISOString();
    memoryStore.set(id, gw);
    return gw;
  }
}
