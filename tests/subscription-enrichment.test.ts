import { describe, it, expect } from 'vitest';
import { executeParticipantPipeline } from '../src/core/pipeline/participant-enricher';
import { RawParticipant } from '../src/core/types/participant';
import { FilterRules } from '../src/core/types/giveaway';
import { SocialMediaProvider } from '../src/providers/types';

describe('Subscription Enrichment Pipeline', () => {
  const mockRawParticipants: RawParticipant[] = [
    {
      platformUserId: '1',
      firstName: 'Пользователь',
      lastName: 'Один',
      source: 'LIKES',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: false,
      subscribed: false, // Initially false
    },
    {
      platformUserId: '2',
      firstName: 'Пользователь',
      lastName: 'Два',
      source: 'LIKES',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: false,
      subscribed: false, // Initially false
    },
  ];

  const mockProvider: SocialMediaProvider = {
    platform: 'VK',
    capabilities: {
      likes: true,
      comments: true,
      reposts: false,
      subscriptions: true,
      adminDetection: false,
    },
    parsePostUrl: () => ({ ownerId: '-100', postId: '200' }),
    fetchPost: async () => ({} as any),
    fetchParticipants: async () => [],
    checkSubscription: async (userIds: string[], groupId: string) => {
      const map = new Map<string, boolean>();
      map.set('1', true);  // User 1 is subscribed
      map.set('2', false); // User 2 is not subscribed
      return map;
    },
  };

  it('should enrich subscribed status and filter out non-subscribed users when requireSubscription is true', async () => {
    const rules: FilterRules = {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: true,
      targetGroupId: '-100',
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };

    const result = await executeParticipantPipeline({
      rawParticipants: mockRawParticipants,
      rules,
      provider: mockProvider,
      ownerId: '-100',
    });

    expect(result.stats.total).toBe(2);
    expect(result.stats.eligibleCount).toBe(1);
    expect(result.stats.excludedCount).toBe(1);

    const eligible = result.eligibleParticipants[0];
    expect(eligible.platformUserId).toBe('1');
    expect(eligible.subscribed).toBe(true);

    const excluded = result.excludedParticipants[0];
    expect(excluded.platformUserId).toBe('2');
    expect(excluded.subscribed).toBe(false);
    expect(excluded.exclusionReason).toContain('NOT_SUBSCRIBED');
  });

  it('should bypass subscription enrichment if requireSubscription is false', async () => {
    const rules: FilterRules = {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };

    const result = await executeParticipantPipeline({
      rawParticipants: mockRawParticipants,
      rules,
      provider: mockProvider,
      ownerId: '-100',
    });

    expect(result.stats.eligibleCount).toBe(2);
    expect(result.eligibleParticipants.every(p => p.eligible)).toBe(true);
  });
});
