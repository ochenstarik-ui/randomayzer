import { PlatformType, PostMetadata } from '../../core/types/giveaway';
import { RawParticipant } from '../../core/types/participant';
import { FetchParticipantsParams, ProviderCapabilities, SocialMediaProvider } from '../types';
import { parseVkPostUrl } from './vk-parser';
import { IVkClient, defaultVkClient, fetchPaginatedVk } from '@/integrations/vk/vk-client';
import { VkAuthContext } from '@/integrations/vk/vk-types';
import { createServiceAuth } from '@/integrations/vk/vk-auth';
import { 
  VkWallPost, 
  VkUserProfile, 
  VkGroupProfile, 
  VkLikesGetListResponse, 
  VkWallGetCommentsResponse,
  VkIsMemberItem
} from '@/integrations/vk/vk-types';
import { 
  VkNotFoundError, 
  VkAuthError, 
  VkPrivateResourceError, 
  VkPermissionError 
} from '@/integrations/vk/vk-errors';
import { STATIC_VK_CAPABILITIES } from './vk-capabilities';
import { VkAuthContextResolver, defaultVkAuthContextResolver } from '@/integrations/vk/vk-auth-resolver';

export interface ExtendedFetchParticipantsParams extends FetchParticipantsParams {
  authContext?: VkAuthContext;
  organizerId?: string;
}

export class VkProvider implements SocialMediaProvider {
  readonly platform: PlatformType = 'VK';
  readonly capabilities: ProviderCapabilities = STATIC_VK_CAPABILITIES;

  private readonly client: IVkClient;
  private readonly defaultAuthContext: VkAuthContext;
  private readonly authResolver: VkAuthContextResolver;

  constructor(
    serviceToken?: string, 
    client?: IVkClient, 
    authResolver?: VkAuthContextResolver
  ) {
    const token = serviceToken !== undefined ? serviceToken : (process.env.VK_SERVICE_TOKEN || '');
    this.defaultAuthContext = createServiceAuth(token);
    this.client = client || defaultVkClient;
    this.authResolver = authResolver || defaultVkAuthContextResolver;
  }

  public parsePostUrl(url: string): { ownerId: string; postId: string } | null {
    return parseVkPostUrl(url);
  }

  /**
   * Fetches VK post metadata with optional organizer context and controlled fallback.
   */
  async fetchPost(
    url: string, 
    options?: { authContext?: VkAuthContext; organizerId?: string }
  ): Promise<PostMetadata> {
    const parsed = this.parsePostUrl(url);
    if (!parsed) {
      throw new VkNotFoundError('Invalid VK post URL format');
    }

    const { ownerId, postId } = parsed;

    // 1. Initial attempt with resolved auth context (prefers explicit/service token by policy)
    let activeAuth: VkAuthContext;
    if (options?.authContext) {
      activeAuth = options.authContext;
    } else if (this.defaultAuthContext.token) {
      activeAuth = this.defaultAuthContext;
    } else {
      activeAuth = await this.authResolver.resolveAuthContext({
        organizerId: options?.organizerId,
        method: 'wall.getById',
        resource: { ownerId, postId },
      });
    }

    try {
      return await this.executeFetchPost(ownerId, postId, url, activeAuth);
    } catch (err: unknown) {
      /**
       * Controlled SERVICE → USER fallback policy:
       *
       * ALLOWED:
       *   - VkPrivateResourceError (codes 15, 30, 203): private/restricted post or group.
       *     Organizer's personal token may have explicit access.
       *   - VkPermissionError (codes 7, 260) on RESOURCE-ACCESS methods only
       *     (likes.getList, wall.getComments, wall.getById): the service token
       *     may lack implicit access to restricted content. User token carries
       *     the organizer's explicit VK grants.
       *
       * FORBIDDEN (never fall back):
       *   - VkRateLimitError: rate limit is per-token; switching token does not help.
       *   - VkTemporaryError: VK server-side issue; fallback would waste quota.
       *   - VkNetworkError / VkTimeoutError: infrastructure issue; retry, don't switch.
       *   - VkValidationError: malformed request; switching token won't fix params.
       *
       * PAGINATION SAFETY:
       *   executeFetchParticipants always starts with a fresh empty participantsMap.
       *   If SERVICE fails mid-pagination, the USER retry is a COMPLETE RESTART —
       *   no partial SERVICE results are carried over.
       */
      const isPrivateOrRestricted = err instanceof VkPrivateResourceError || err instanceof VkPermissionError;
      if (isPrivateOrRestricted && activeAuth.type === 'SERVICE' && options?.organizerId) {
        const userAuth = await this.authResolver.resolveUserFallbackContext(options.organizerId);
        return await this.executeFetchPost(ownerId, postId, url, userAuth);
      }
      throw err;
    }
  }

  private async executeFetchPost(
    ownerId: string, 
    postId: string, 
    url: string, 
    authContext: VkAuthContext
  ): Promise<PostMetadata> {
    const response = await this.client.call<{
      items: VkWallPost[];
      profiles?: VkUserProfile[];
      groups?: VkGroupProfile[];
    }>('wall.getById', {
      posts: `${ownerId}_${postId}`,
      extended: 1,
    }, authContext);

    if (!response.items || response.items.length === 0) {
      throw new VkNotFoundError(`Post "${ownerId}_${postId}" not found or access is restricted`);
    }

    const post = response.items[0];

    let authorName = `VK Wall ${ownerId}`;
    let authorAvatarUrl: string | undefined = undefined;

    if (ownerId.startsWith('-')) {
      const groupId = Math.abs(parseInt(ownerId, 10));
      const group = (response.groups || []).find(g => g.id === groupId);
      if (group) {
        authorName = group.name;
        authorAvatarUrl = group.photo_50;
      }
    } else {
      const userId = parseInt(ownerId, 10);
      const profile = (response.profiles || []).find(p => p.id === userId);
      if (profile) {
        authorName = `${profile.first_name} ${profile.last_name}`;
        authorAvatarUrl = profile.photo_100 || profile.photo_200;
      }
    }

    let imageUrl: string | undefined = undefined;
    if (post.attachments && post.attachments.length > 0) {
      const photoAttachment = post.attachments.find(a => a.type === 'photo');
      if (photoAttachment && photoAttachment.photo && photoAttachment.photo.sizes) {
        const sizes = photoAttachment.photo.sizes;
        imageUrl = sizes[sizes.length - 1]?.url;
      }
    }

    const textContent = String(post.text || '');

    return {
      platform: 'VK',
      ownerId,
      postId,
      sourceUrl: url,
      title: textContent ? textContent.slice(0, 80) + '...' : `Запись на стене ${ownerId}_${postId}`,
      text: textContent,
      authorName,
      authorAvatarUrl,
      imageUrl,
      likesCount: post.likes?.count || 0,
      commentsCount: post.comments?.count || 0,
      repostsCount: post.reposts?.count || 0,
      publishedAt: post.date ? new Date(post.date * 1000) : undefined,
      resolvedAuthType: authContext.type,
    };
  }

  /**
   * Fetches participants for giveaway with optional explicit or resolved AuthContext.
   */
  async fetchParticipants(params: ExtendedFetchParticipantsParams): Promise<RawParticipant[]> {
    const { ownerId, postId, organizerId, authContext: explicitAuth } = params;

    let activeAuth: VkAuthContext;
    if (explicitAuth) {
      activeAuth = explicitAuth;
    } else if (this.defaultAuthContext.token) {
      activeAuth = this.defaultAuthContext;
    } else {
      activeAuth = await this.authResolver.resolveAuthContext({
        organizerId,
        method: 'likes.getList',
        resource: { ownerId, postId },
      });
    }

    try {
      return await this.executeFetchParticipants(params, activeAuth);
    } catch (err: unknown) {
      /**
       * Controlled SERVICE → USER fallback policy:
       *
       * ALLOWED:
       *   - VkPrivateResourceError (codes 15, 30, 203): private/restricted post or group.
       *     Organizer's personal token may have explicit access.
       *   - VkPermissionError (codes 7, 260) on RESOURCE-ACCESS methods only
       *     (likes.getList, wall.getComments, wall.getById): the service token
       *     may lack implicit access to restricted content. User token carries
       *     the organizer's explicit VK grants.
       *
       * FORBIDDEN (never fall back):
       *   - VkRateLimitError: rate limit is per-token; switching token does not help.
       *   - VkTemporaryError: VK server-side issue; fallback would waste quota.
       *   - VkNetworkError / VkTimeoutError: infrastructure issue; retry, don't switch.
       *   - VkValidationError: malformed request; switching token won't fix params.
       *
       * PAGINATION SAFETY:
       *   executeFetchParticipants always starts with a fresh empty participantsMap.
       *   If SERVICE fails mid-pagination, the USER retry is a COMPLETE RESTART —
       *   no partial SERVICE results are carried over.
       */
      const isPrivateOrRestricted = err instanceof VkPrivateResourceError || err instanceof VkPermissionError;
      if (isPrivateOrRestricted && activeAuth.type === 'SERVICE' && organizerId) {
        const userAuth = await this.authResolver.resolveUserFallbackContext(organizerId);
        return await this.executeFetchParticipants(params, userAuth);
      }
      throw err;
    }
  }

  private async executeFetchParticipants(
    params: ExtendedFetchParticipantsParams, 
    authContext: VkAuthContext
  ): Promise<RawParticipant[]> {
    const { ownerId, postId } = params;
    const participantsMap = new Map<string, RawParticipant>();

    // 1. Fetch Likes with full pagination
    if (params.includeLikes !== false) {
      const likeProfiles = await fetchPaginatedVk<VkUserProfile>({
        pageSize: 100,
        fetchPage: async (offset, count) => {
          const res = await this.client.call<VkLikesGetListResponse>('likes.getList', {
            type: 'post',
            owner_id: ownerId,
            item_id: postId,
            filter: 'likes',
            extended: 1,
            count,
            offset,
          }, authContext);

          return {
            items: (res.items || []) as VkUserProfile[],
            totalCount: res.count,
          };
        },
        onProgress: (loaded, total) => {
          if (params.onProgress) {
            params.onProgress(loaded, total ?? loaded, 'Загрузка лайков...');
          }
        },
      });

      for (const item of likeProfiles) {
        const userId = String(item.id);
        participantsMap.set(userId, {
          platformUserId: userId,
          firstName: item.first_name || '',
          lastName: item.last_name || '',
          username: item.screen_name || undefined,
          avatarUrl: item.photo_100 || item.photo_200,
          source: 'LIKES',
          liked: true,
          commented: false,
          commentsCount: 0,
          reposted: false,
          subscribed: false,
        });
      }
    }

    // 2. Fetch Comments with full pagination and author profile mapping
    if (params.includeComments) {
      await fetchPaginatedVk<{ from_id: number }>({
        pageSize: 100,
        fetchPage: async (offset, count) => {
          const res = await this.client.call<VkWallGetCommentsResponse>('wall.getComments', {
            owner_id: ownerId,
            post_id: postId,
            extended: 1,
            count,
            offset,
            fields: 'photo_100,photo_200,screen_name',
          }, authContext);

          const profileMap = new Map<number, VkUserProfile>(
            (res.profiles || []).map(p => [p.id, p])
          );

          for (const item of res.items || []) {
            if (item.from_id && item.from_id > 0) {
              const userId = String(item.from_id);
              const prof = profileMap.get(item.from_id);
              const existing = participantsMap.get(userId);

              if (existing) {
                existing.commented = true;
                existing.commentsCount = (existing.commentsCount || 0) + 1;
              } else {
                participantsMap.set(userId, {
                  platformUserId: userId,
                  firstName: prof?.first_name || 'Участник',
                  lastName: prof?.last_name || userId,
                  username: prof?.screen_name,
                  avatarUrl: prof?.photo_100,
                  source: 'COMMENTS',
                  liked: false,
                  commented: true,
                  commentsCount: 1,
                  reposted: false,
                  subscribed: false,
                });
              }
            }
          }

          return {
            items: res.items || [],
            totalCount: res.count,
          };
        },
        onProgress: () => {
          if (params.onProgress) {
            params.onProgress(participantsMap.size, participantsMap.size, 'Загрузка комментариев...');
          }
        },
      });
    }

    return Array.from(participantsMap.values());
  }

  async checkSubscription(
    userIds: string[], 
    groupId: string, 
    options?: { authContext?: VkAuthContext; organizerId?: string }
  ): Promise<Map<string, boolean>> {
    const cleanGroupId = groupId.replace(/^-/, '');
    const resultMap = new Map<string, boolean>();

    let activeAuth: VkAuthContext;
    if (options?.authContext) {
      activeAuth = options.authContext;
    } else if (this.defaultAuthContext.token) {
      activeAuth = this.defaultAuthContext;
    } else {
      activeAuth = await this.authResolver.resolveAuthContext({
        organizerId: options?.organizerId,
        method: 'groups.isMember',
        resource: { ownerId: `-${cleanGroupId}` },
      });
    }

    // VK API groups.isMember allows up to 500 user_ids per batch call
    const chunkSize = 500;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      const res = await this.client.call<VkIsMemberItem[]>(
        'groups.isMember',
        {
          group_id: cleanGroupId,
          user_ids: chunk.join(','),
        },
        activeAuth
      );

      for (const item of res || []) {
        resultMap.set(String(item.user_id), item.member === 1);
      }
    }

    return resultMap;
  }
}
