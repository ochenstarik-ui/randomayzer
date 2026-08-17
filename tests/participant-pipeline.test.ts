import { describe, it, expect, vi } from 'vitest';
import { executeParticipantPipeline } from '../src/core/pipeline/participant-enricher';
import { VkMockProvider } from '../src/providers/vk/vk-mock-provider';
import { FilterRules } from '../src/core/types/giveaway';
import { SocialMediaProvider } from '../src/providers/types';
import { RawParticipant } from '../src/core/types/participant';

describe('Participant Pipeline', () => {
  function buildRules(overrides: Partial<FilterRules> = {}): FilterRules {
    return {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
      ...overrides,
    };
  }

  it('full pipeline: fetch -> enrich -> filter -> eligible', async () => {
    const provider = new VkMockProvider();
    provider.setScenario({ participantCount: 20, likedRatio: 1, subscribedRatio: 1 });

    const rawParticipants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });

    const rules = buildRules({ requireSubscription: true, targetGroupId: '-100' });

    const result = await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '-100',
    });

    expect(result.stats.total).toBe(20);
    expect(result.eligibleParticipants.length).toBe(20);
    expect(result.eligibleParticipants.every(p => p.subscribed)).toBe(true);
  });

  it('calls provider.checkSubscription when requireSubscription is true', async () => {
    const provider = new VkMockProvider();
    provider.setScenario({ participantCount: 5, subscribedRatio: 0.5 });
    const checkSubscriptionSpy = vi.spyOn(provider, 'checkSubscription');

    const rawParticipants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });

    const rules = buildRules({ requireSubscription: true, targetGroupId: '-100' });

    await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '-100',
    });

    expect(checkSubscriptionSpy).toHaveBeenCalledTimes(1);
    expect(checkSubscriptionSpy).toHaveBeenCalledWith(
      expect.arrayContaining(rawParticipants.map(p => p.platformUserId)),
      '-100'
    );
  });

  it('does NOT call provider.checkSubscription when requireSubscription is false', async () => {
    const provider = new VkMockProvider();
    provider.setScenario({ participantCount: 5 });
    const checkSubscriptionSpy = vi.spyOn(provider, 'checkSubscription');

    const rawParticipants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });

    const rules = buildRules({ requireSubscription: false });

    await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '-100',
    });

    expect(checkSubscriptionSpy).not.toHaveBeenCalled();
  });

  it('subscription result affects eligibility', async () => {
    const provider = new VkMockProvider();
    provider.setScenario({ participantCount: 10, likedRatio: 1, subscribedRatio: 0 });

    const rawParticipants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });

    const rules = buildRules({ requireSubscription: true, targetGroupId: '-100' });

    const result = await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '-100',
    });

    expect(result.eligibleParticipants).toHaveLength(0);
    expect(result.excludedParticipants).toHaveLength(10);
    expect(result.excludedParticipants[0].exclusionReason).toContain('NOT_SUBSCRIBED');
  });

  it('uses ownerId as targetGroupId when targetGroupId is not provided for group owner', async () => {
    const provider = new VkMockProvider();
    provider.setScenario({ participantCount: 3, subscribedRatio: 1 });
    const checkSubscriptionSpy = vi.spyOn(provider, 'checkSubscription');

    const rawParticipants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });

    const rules = buildRules({ requireSubscription: true }); // no targetGroupId

    await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '-100',
    });

    expect(checkSubscriptionSpy).toHaveBeenCalledWith(
      expect.arrayContaining(rawParticipants.map(p => p.platformUserId)),
      '-100'
    );
  });

  it('skips subscription check for personal walls without targetGroupId', async () => {
    const provider = new VkMockProvider();
    provider.setScenario({ participantCount: 3 });
    const checkSubscriptionSpy = vi.spyOn(provider, 'checkSubscription');

    const rawParticipants = await provider.fetchParticipants({
      ownerId: '100',
      postId: '1',
    });

    const rules = buildRules({ requireSubscription: true }); // no targetGroupId, owner is user

    const result = await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '100',
    });

    expect(checkSubscriptionSpy).not.toHaveBeenCalled();
    // Participants remain subscribed=false, so they are excluded
    expect(result.eligibleParticipants).toHaveLength(0);
  });

  it('pipeline filters by combined conditions after enrichment', async () => {
    const provider = new VkMockProvider();
    provider.setScenario({
      participantCount: 50,
      likedRatio: 0.8,
      commentedRatio: 0.6,
      subscribedRatio: 0.7,
    });

    const rawParticipants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });

    const rules = buildRules({
      requireLike: true,
      requireComment: true,
      requireSubscription: true,
      targetGroupId: '-100',
    });

    const result = await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '-100',
    });

    expect(result.stats.total).toBe(50);
    expect(result.eligibleParticipants.length).toBeGreaterThan(0);
    expect(result.eligibleParticipants.length).toBeLessThan(50);
    expect(result.eligibleParticipants.every(p => p.liked && p.commented && p.subscribed)).toBe(true);
  });

  it('pipeline handles duplicate users across sources correctly', async () => {
    const provider: SocialMediaProvider = {
      platform: 'VK',
      capabilities: {
        likes: true,
        comments: true,
        reposts: false,
        subscriptions: true,
        adminDetection: false,
      },
      parsePostUrl: () => ({ ownerId: '-100', postId: '1' }),
      fetchPost: async () => ({} as any),
      fetchParticipants: async () => [],
      checkSubscription: async (userIds: string[]) => {
        const map = new Map<string, boolean>();
        userIds.forEach(id => map.set(id, true));
        return map;
      },
    };

    const rawParticipants: RawParticipant[] = [
      {
        platformUserId: '42',
        firstName: 'A',
        lastName: 'B',
        source: 'LIKES',
        liked: true,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: false,
      },
      {
        platformUserId: '42',
        firstName: 'A',
        lastName: 'B',
        source: 'COMMENTS',
        liked: false,
        commented: true,
        commentsCount: 2,
        reposted: false,
        subscribed: false,
      },
    ];

    const rules = buildRules({
      requireLike: true,
      requireComment: true,
      requireSubscription: true,
      targetGroupId: '-100',
    });

    const result = await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: '-100',
    });

    expect(result.stats.total).toBe(1);
    expect(result.eligibleParticipants).toHaveLength(1);
    const merged = result.eligibleParticipants[0];
    expect(merged.liked).toBe(true);
    expect(merged.commented).toBe(true);
    expect(merged.commentsCount).toBe(2);
    expect(merged.subscribed).toBe(true);
  });
});
