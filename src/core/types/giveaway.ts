export type PlatformType = 'VK' | 'TELEGRAM' | 'YOUTUBE';

export type GiveawayStatusType = 
  | 'DRAFT'
  | 'FETCHING'
  | 'READY'
  | 'SNAPSHOT_LOCKED'
  | 'DRAWN'
  | 'PUBLISHED'
  | 'CANCELLED';

export type ParticipantSourceType = 'LIKES' | 'COMMENTS' | 'REPOSTS' | 'COMBINED';

export interface FilterRules {
  requireLike: boolean;
  requireComment: boolean;
  requireRepost: boolean;
  requireSubscription: boolean;
  targetGroupId?: string;
  excludeAdmins: boolean;
  excludeBlacklistedIds: string[]; // List of user IDs or usernames to exclude
  excludeDuplicateComments?: boolean; // @deprecated legacy field for backward compatibility
  minEligibleParticipants?: number;
}

export const DEFAULT_FILTER_RULES: FilterRules = {
  requireLike: true,
  requireComment: false,
  requireRepost: false,
  requireSubscription: false,
  excludeAdmins: false,
  excludeBlacklistedIds: [],
  minEligibleParticipants: 1,
};

export interface PostMetadata {
  platform: PlatformType;
  ownerId: string;
  postId: string;
  sourceUrl: string;
  title: string;
  text: string;
  authorName?: string;
  authorAvatarUrl?: string;
  imageUrl?: string;
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  publishedAt?: Date;
  resolvedAuthType?: 'SERVICE' | 'USER' | 'COMMUNITY';
}
