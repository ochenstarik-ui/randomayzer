import { describe, it, expect, beforeEach } from 'vitest';
import { validateProviderCapabilities } from '../src/core/validation/giveaway-schemas';
import { VkMockProvider } from '../src/providers/vk/vk-mock-provider';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { FilterRules } from '../src/core/types/giveaway';
import { NextRequest } from 'next/server';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { ValidationError } from '../src/core/errors/http-errors';

const testUser = { id: 'usr_capabilities_tester', vkUserId: '77777' };
let sessionId: string;

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
    },
    winnersCount: 1,
    reserveWinnersCount: 0,
    organizerId: testUser.id,
  });
}

function buildReq(id: string, body: object): NextRequest {
  return new NextRequest(`http://localhost/api/giveaways/${id}/participants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
    },
    body: JSON.stringify(body),
  });
}

describe('Provider capabilities', () => {
  beforeEach(async () => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    defaultSessionStore.clear();
    sessionId = await defaultSessionStore.createSession(testUser);
  });

  it('VkMockProvider declares reposts and admin detection as unsupported', () => {
    const provider = new VkMockProvider();
    expect(provider.capabilities.reposts).toBe(false);
    expect(provider.capabilities.adminDetection).toBe(false);
  });

  it('VkProvider declares reposts and admin detection as unsupported for public service tokens', () => {
    const provider = new VkProvider();
    expect(provider.capabilities.reposts).toBe(false);
    expect(provider.capabilities.adminDetection).toBe(false);
  });

  it('VkMockProvider supports likes, comments and subscription checks', () => {
    const provider = new VkMockProvider();
    expect(provider.capabilities.likes).toBe(true);
    expect(provider.capabilities.comments).toBe(true);
    expect(provider.capabilities.subscriptions).toBe(true);
  });

  it('VkProvider supports likes, comments and subscription checks', () => {
    const provider = new VkProvider();
    expect(provider.capabilities.likes).toBe(true);
    expect(provider.capabilities.comments).toBe(true);
    expect(provider.capabilities.subscriptions).toBe(true);
  });

  it('validation rejects requireRepost when provider cannot fetch reposts', () => {
    const rules: FilterRules = {
      requireLike: false,
      requireComment: false,
      requireRepost: true,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
    };
    const provider = new VkMockProvider();
    expect(() => validateProviderCapabilities(rules, provider.capabilities)).toThrow(ValidationError);
    expect(() => validateProviderCapabilities(rules, provider.capabilities)).toThrow(/repost/i);
  });

  it('validation rejects excludeAdmins when provider cannot detect admins', () => {
    const rules: FilterRules = {
      requireLike: false,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: true,
      excludeBlacklistedIds: [],
    };
    const provider = new VkMockProvider();
    expect(() => validateProviderCapabilities(rules, provider.capabilities)).toThrow(ValidationError);
    expect(() => validateProviderCapabilities(rules, provider.capabilities)).toThrow(/admin/i);
  });

  it('validation rejects requireSubscription when provider does not support subscriptions', () => {
    const rules: FilterRules = {
      requireLike: false,
      requireComment: false,
      requireRepost: false,
      requireSubscription: true,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
    };
    const capabilities = { ...new VkMockProvider().capabilities, subscriptions: false };
    expect(() => validateProviderCapabilities(rules, capabilities)).toThrow(ValidationError);
    expect(() => validateProviderCapabilities(rules, capabilities)).toThrow(/subscription/i);
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
    };
    const provider = new VkMockProvider();
    expect(() => validateProviderCapabilities(rules, provider.capabilities)).not.toThrow();
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
      },
    });

    const res = await participantsPost(req, { params: { id: gw.id } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.eligibleCount + data.excludedCount).toBeGreaterThan(0);
  });
});
