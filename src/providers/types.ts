import { PlatformType, PostMetadata } from '../core/types/giveaway';
import { RawParticipant } from '../core/types/participant';

export interface ProviderCapabilities {
  likes: boolean;
  comments: boolean;
  reposts: boolean;
  subscriptions: boolean;
  adminDetection: boolean;
  repostsNote?: string;
  adminDetectionNote?: string;
}

export interface FetchParticipantsParams {
  ownerId: string;
  postId: string;
  sourceUrl?: string;
  targetGroupId?: string;
  includeLikes?: boolean;
  includeComments?: boolean;
  includeReposts?: boolean;
  onProgress?: (loaded: number, total: number, message: string) => void;
}

export interface SocialMediaProvider {
  readonly platform: PlatformType;
  readonly capabilities: ProviderCapabilities;

  /**
   * Parse a raw URL from the user into ownerId and postId
   */
  parsePostUrl(url: string): { ownerId: string; postId: string } | null;

  /**
   * Fetch post metadata, text, counters, and image
   */
  fetchPost(url: string): Promise<PostMetadata>;

  /**
   * Fetch all raw participants performing actions on the post
   */
  fetchParticipants(params: FetchParticipantsParams): Promise<RawParticipant[]>;

  /**
   * Batch check membership in a community/channel
   */
  checkSubscription(userIds: string[], groupId: string): Promise<Map<string, boolean>>;
}
