import { PlatformType, PostMetadata } from '../../core/types/giveaway';
import { RawParticipant } from '../../core/types/participant';
import { FetchParticipantsParams, SocialMediaProvider } from '../types';
import { parseVkPostUrl } from './vk-parser';

interface VkApiResponse<T> {
  response?: T;
  error?: {
    error_code: number;
    error_msg: string;
  };
}

export class VkProvider implements SocialMediaProvider {
  readonly platform: PlatformType = 'VK';
  private serviceToken?: string;
  private apiVersion = '5.199';
  private baseUrl = 'https://api.vk.com/method';

  constructor(serviceToken?: string) {
    this.serviceToken = serviceToken || process.env.VK_SERVICE_TOKEN;
  }

  parsePostUrl(url: string): { ownerId: string; postId: string } | null {
    return parseVkPostUrl(url);
  }

  private async callApi<T>(method: string, params: Record<string, string | number>): Promise<T> {
    if (!this.serviceToken) {
      throw new Error('VK_SERVICE_TOKEN is not configured in environment variables');
    }

    const query = new URLSearchParams({
      ...Object.entries(params).reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {}),
      access_token: this.serviceToken,
      v: this.apiVersion,
    });

    const response = await fetch(`${this.baseUrl}/${method}?${query.toString()}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`VK API HTTP error: ${response.status} ${response.statusText}`);
    }

    const data: VkApiResponse<T> = await response.json();

    if (data.error) {
      throw new Error(`VK API Error (${data.error.error_code}): ${data.error.error_msg}`);
    }

    if (!data.response) {
      throw new Error('Empty response from VK API');
    }

    return data.response;
  }

  async fetchPost(url: string): Promise<PostMetadata> {
    const parsed = this.parsePostUrl(url);
    if (!parsed) {
      throw new Error('Invalid VK post URL format');
    }

    const { ownerId, postId } = parsed;

    const response = await this.callApi<{ items: any[]; profiles?: any[]; groups?: any[] }>(
      'wall.getById',
      {
        posts: `${ownerId}_${postId}`,
        extended: 1,
      }
    );

    if (!response.items || response.items.length === 0) {
      throw new Error('Post not found or access is restricted');
    }

    const post = response.items[0];

    // Find author name / avatar
    let authorName = `VK Wall ${ownerId}`;
    let authorAvatarUrl = undefined;

    if (ownerId.startsWith('-')) {
      const groupId = Math.abs(parseInt(ownerId, 10));
      const group = (response.groups || []).find(g => g.id === groupId);
      if (group) {
        authorName = group.name;
        authorAvatarUrl = group.photo_100 || group.photo_200;
      }
    } else {
      const userId = parseInt(ownerId, 10);
      const profile = (response.profiles || []).find(p => p.id === userId);
      if (profile) {
        authorName = `${profile.first_name} ${profile.last_name}`;
        authorAvatarUrl = profile.photo_100 || profile.photo_200;
      }
    }

    // Extract first image attachment if available
    let imageUrl = undefined;
    if (post.attachments && post.attachments.length > 0) {
      const photoAttachment = post.attachments.find((a: any) => a.type === 'photo');
      if (photoAttachment && photoAttachment.photo && photoAttachment.photo.sizes) {
        const sizes = photoAttachment.photo.sizes;
        imageUrl = sizes[sizes.length - 1]?.url;
      }
    }

    return {
      platform: 'VK',
      ownerId,
      postId,
      sourceUrl: url,
      title: post.text ? post.text.slice(0, 80) + '...' : `Запись на стене ${ownerId}_${postId}`,
      text: post.text || '',
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
    const { ownerId, postId } = params;
    const participantsMap = new Map<string, RawParticipant>();

    // 1. Fetch Likes
    if (params.includeLikes !== false) {
      let offset = 0;
      const count = 1000;
      let totalLikes = 0;

      do {
        const likesRes = await this.callApi<{ count: number; items: any[] }>('likes.getList', {
          type: 'post',
          owner_id: ownerId,
          item_id: postId,
          filter: 'likes',
          extended: 1,
          count,
          offset,
        });

        totalLikes = likesRes.count;

        for (const item of likesRes.items) {
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

        offset += count;
        if (params.onProgress) {
          params.onProgress(participantsMap.size, totalLikes, 'Загрузка лайков...');
        }
      } while (offset < totalLikes && offset < 5000); // capped for phase 1 protection
    }

    // 2. Fetch Comments
    if (params.includeComments) {
      let offset = 0;
      const count = 100;
      let totalComments = 0;

      do {
        const commentsRes = await this.callApi<{ count: number; items: any[]; profiles?: any[] }>(
          'wall.getComments',
          {
            owner_id: ownerId,
            post_id: postId,
            extended: 1,
            count,
            offset,
            fields: 'photo_100,photo_200,screen_name',
          }
        );

        totalComments = commentsRes.count;
        const profileMap = new Map<number, any>(
          (commentsRes.profiles || []).map(p => [p.id, p])
        );

        for (const item of commentsRes.items) {
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

        offset += count;
      } while (offset < totalComments && offset < 1000);
    }

    return Array.from(participantsMap.values());
  }

  async checkSubscription(userIds: string[], groupId: string): Promise<Map<string, boolean>> {
    const cleanGroupId = groupId.replace(/^-/, '');
    const resultMap = new Map<string, boolean>();

    // Batch in chunks of 500 as supported by groups.isMember
    const chunkSize = 500;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      const res = await this.callApi<Array<{ user_id: number; member: number }>>(
        'groups.isMember',
        {
          group_id: cleanGroupId,
          user_ids: chunk.join(','),
        }
      );

      for (const item of res) {
        resultMap.set(String(item.user_id), item.member === 1);
      }
    }

    return resultMap;
  }
}
