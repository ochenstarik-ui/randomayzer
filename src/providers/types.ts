import { PlatformType, PostMetadata } from '../core/types/giveaway';
import { RawParticipant } from '../core/types/participant';

export interface FetchParticipantsParams {
  ownerId: string;
  postId: string;
  sourceUrl?: string;
  targetGroupId?: string;
  includeLikes?: boolean;
  includeComments?: boolean;
  includeReposts?: boolean;
  checkSubscription?: boolean;
  onProgress?: (loaded: number, total: number, message: string) => void;
}

export interface SocialMediaProvider {
  readonly platform: PlatformType;
  
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
