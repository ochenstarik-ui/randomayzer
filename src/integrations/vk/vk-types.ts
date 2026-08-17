/**
 * VK Authentication context supporting Service, User, and Community access tokens.
 */
export type VkTokenType = 'SERVICE' | 'USER' | 'COMMUNITY';

export interface VkAuthContext {
  type: VkTokenType;
  token: string;
  communityId?: string;
}

/**
 * Raw VK API response shape according to official VK API specifications.
 */
export interface VkApiRawErrorParam {
  key: string;
  value: string;
}

export interface VkApiRawError {
  error_code: number;
  error_msg: string;
  request_params?: VkApiRawErrorParam[];
  error_text?: string;
}

export interface VkApiResponse<T> {
  response?: T;
  error?: VkApiRawError;
  execute_errors?: VkApiRawError[];
}

/**
 * Call options for individual VK client requests.
 */
export interface VkCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  retryInitialDelayMs?: number;
  retryMaxDelayMs?: number;
}

/**
 * Base pagination parameters for VK endpoints.
 */
export interface VkPaginationOptions<TItem> {
  fetchPage: (offset: number, count: number, signal?: AbortSignal) => Promise<{
    items: TItem[];
    totalCount?: number;
  }>;
  pageSize?: number;
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (loadedCount: number, totalCount: number | null) => void;
}

/**
 * VK API Domain Entities
 */
export interface VkWallPost {
  id: number;
  owner_id: number;
  from_id?: number;
  date: number;
  text: number | string;
  comments?: { count: number };
  likes?: { count: number; user_likes?: number };
  reposts?: { count: number; user_reposted?: number };
  attachments?: Array<{ type: string; [key: string]: any }>;
  is_pinned?: number;
}

export interface VkUserProfile {
  id: number;
  first_name: string;
  last_name: string;
  screen_name?: string;
  photo_50?: string;
  photo_100?: string;
  photo_200?: string;
  deactivated?: string; // 'deleted' | 'banned'
  is_closed?: boolean;
}

export interface VkGroupProfile {
  id: number;
  name: string;
  screen_name: string;
  is_closed: number;
  type: 'group' | 'page' | 'event';
  photo_50?: string;
}

export interface VkLikesGetListResponse {
  count: number;
  items: Array<number | VkUserProfile>;
}

export interface VkCommentItem {
  id: number;
  from_id: number;
  date: number;
  text: string;
  likes?: { count: number };
  deleted?: boolean;
}

export interface VkWallGetCommentsResponse {
  count: number;
  items: VkCommentItem[];
  profiles?: VkUserProfile[];
  groups?: VkGroupProfile[];
}

export interface VkIsMemberItem {
  user_id: number;
  member: number; // 1 or 0
  invitation?: number;
  request?: number;
}
