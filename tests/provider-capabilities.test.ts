import { describe, it, expect, beforeEach } from 'vitest';
import { validateFilterRulesAgainstProviderCapabilities } from '../src/core/filtering/rule-validation';
import { VkMockProvider } from '../src/providers/vk/vk-mock-provider';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { ProviderRegistry } from '../src/providers/registry';
import { FilterRules } from '../src/core/types/giveaway';
import { NextRequest } from 'next/server';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';

async function createGiveaway(store: typeof GiveawayStore) {
  return store.create({
    sourceUrl: 'https://vk.com/wall-100_1',
    post: {
      platform: 'VK',
      ownerId: '-100',
      postId: '1',
      sourceUrl: 'https://vk.com/wall-100_1',
      title: 'Test',
      text: 'Test',
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
    },
    filterRules: {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    },
    winnersCount: 1,
    reserveWinnersCount: 0,
  });
}

function buildReq(id: string, body: object): NextRequest {
  return new NextRequest(`http://localhost/api/giveaways/${id}/participants`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('Provider capabilities', () => {
  beforeEach(() => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    ProviderRegistry.useMockVk();
  });

  it('VK mock provider declares reposts=false and adminDetection=false', () => {
    const provider = new VkMockProvider();
    expect(provider.capabilities.reposts).toBe(false);
    expect(provider.capabilities.adminDetection).toBe(false);
    expect(provider.capabilities.subscriptions).toBe(true);
  });

  it('VK real provider declares reposts=false and adminDetection=false', () => {
    const provider = new VkProvider('dummy-token');
    expect(provider.capabilities.reposts).toBe(false);
    expect(provider.capabilities.adminDetection).toBe(false);
    expect(provider.capabilities.subscriptions).toBe(true);
  });

  it('validation rejects requireRepost when provider cannot verify reposts', () => {
    const rules: FilterRules = {
      requireLike: false,
      requireComment: false,
      requireRepost: true,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };
    const provider = new VkMockProvider();
    const result = validateFilterRulesAgainstProviderCapabilities(rules, provider.capabilities);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('requireRepost'))).toBe(true);
  });

  it('validation rejects excludeAdmins when provider cannot detect admins', () => {
    const rules: FilterRules = {
      requireLike: false,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: true,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };
    const provider = new VkMockProvider();
    const result = validateFilterRulesAgainstProviderCapabilities(rules, provider.capabilities);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('excludeAdmins'))).toBe(true);
  });

  it('validation accepts supported combinations', () => {
    const rules: FilterRules = {
      requireLike: true,
      requireComment: true,
      requireRepost: false,
      requireSubscription: true,
      targetGroupId: '-100',
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };
    const provider = new VkMockProvider();
    const result = validateFilterRulesAgainstProviderCapabilities(rules, provider.capabilities);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('participants route returns 400 when requireRepost is requested for VK', async () => {
    const gw = await createGiveaway(GiveawayStore);
    const req = buildReq(gw.id, {
      filterRules: {
        requireLike: true,
        requireComment: false,
        requireRepost: true,
        requireSubscription: false,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      },
    });

    const res = await participantsPost(req, { params: { id: gw.id } });
    expect(res.status).toBe(400);
    const data = await res.json();
    const errorMessage = data.error?.message || data.error || '';
    expect(errorMessage).toMatch(/repost/i);
  });

  it('participants route returns 400 when excludeAdmins is requested for VK', async () => {
    const gw = await createGiveaway(GiveawayStore);
    const req = buildReq(gw.id, {
      filterRules: {
        requireLike: true,
        requireComment: false,
        requireRepost: false,
        requireSubscription: false,
        excludeAdmins: true,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      },
    });

    const res = await participantsPost(req, { params: { id: gw.id } });
    expect(res.status).toBe(400);
    const data = await res.json();
    const errorMessage = data.error?.message || data.error || '';
    expect(errorMessage).toMatch(/admin/i);
  });

  it('participants route succeeds for supported VK rules', async () => {
    const gw = await createGiveaway(GiveawayStore);
    const req = buildReq(gw.id, {
      filterRules: {
        requireLike: true,
        requireComment: true,
        requireRepost: false,
        requireSubscription: true,
        targetGroupId: '-100',
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      },
    });

    const res = await participantsPost(req, { params: { id: gw.id } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.eligibleCount + data.excludedCount).toBeGreaterThan(0);
  });
});
