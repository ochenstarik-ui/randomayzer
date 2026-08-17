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
import { VkNotFoundError, VkAuthError } from '@/integrations/vk/vk-errors';

export class VkProvider implements SocialMediaProvider {
  readonly platform: PlatformType = 'VK';
  readonly capabilities: ProviderCapabilities = {
    likes: true,
    comments: true,
    reposts: false,
    repostsNote: 'Сбор репостов ограничен политикой приватности VK для закрытых профилей',
    subscriptions: true,
    adminDetection: false,
    adminDetectionNote: 'Требует расширенных прав администратора группы',
  };

  private readonly client: IVkClient;
  private readonly authContext: VkAuthContext;

  constructor(serviceToken?: string, client?: IVkClient) {
    const token = serviceToken || process.env.VK_SERVICE_TOKEN;
    if (!token) {
      // In tests or unconfigured environments, create a dummy context that will be validated on call
      this.authContext = createServiceAuth('');
    } else {
      this.authContext = createServiceAuth(token);
    }
    this.client = client || defaultVkClient;
  }

  public parsePostUrl(url: string): { ownerId: string; postId: string } | null {
    return parseVkPostUrl(url);
  }

  private ensureConfigured(): void {
    if (!this.authContext.token) {
      throw new VkAuthError('VK_SERVICE_TOKEN is not configured in environment variables');
    }
  }

  async fetchPost(url: string): Promise<PostMetadata> {
    this.ensureConfigured();

    const parsed = this.parsePostUrl(url);
    if (!parsed) {
      throw new VkNotFoundError('Invalid VK post URL format');
    }

    const { ownerId, postId } = parsed;

    const response = await this.client.call<{
      items: VkWallPost[];
      profiles?: VkUserProfile[];
      groups?: VkGroupProfile[];
    }>('wall.getById', {
      posts: `${ownerId}_${postId}`,
      extended: 1,
    }, this.authContext);

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
    };
  }

  async fetchParticipants(params: FetchParticipantsParams): Promise<RawParticipant[]> {
    this.ensureConfigured();

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
          }, this.authContext);

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
          }, this.authContext);

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

  async checkSubscription(userIds: string[], groupId: string): Promise<Map<string, boolean>> {
    this.ensureConfigured();

    const cleanGroupId = groupId.replace(/^-/, '');
    const resultMap = new Map<string, boolean>();

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
        this.authContext
      );

      for (const item of res || []) {
        resultMap.set(String(item.user_id), item.member === 1);
      }
    }

    return resultMap;
  }
}
