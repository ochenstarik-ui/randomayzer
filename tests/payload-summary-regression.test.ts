import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { ProviderRegistry } from '../src/providers/registry';

describe('POST /participants Payload Summary Regression Test', () => {
  beforeEach(() => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    ProviderRegistry.useMockVk();
  });

  it('POST /participants response must return summary only and NOT contain massive participant arrays', async () => {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_1',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-100_1',
        title: 'Large Payload Test',
        likesCount: 100000,
        commentsCount: 50000,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 1,
      reserveWinnersCount: 0,
    });

    const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/participants`, {
      method: 'POST',
      body: JSON.stringify({
        filterRules: DEFAULT_FILTER_RULES,
      }),
    });

    const res = await participantsPost(req, { params: { id: gw.id } });
    expect(res.status).toBe(200);

    const body = await res.json();

    // Must have summary fields
    expect(body.success).toBe(true);
    expect(body.giveawayId).toBe(gw.id);
    expect(typeof body.totalCount).toBe('number');
    expect(typeof body.eligibleCount).toBe('number');
    expect(typeof body.excludedCount).toBe('number');

    // Must NOT contain large participant arrays
    expect(body.allParticipants).toBeUndefined();
    expect(body.eligibleParticipants).toBeUndefined();
    expect(body.excludedParticipants).toBeUndefined();
    expect(body.participants).toBeUndefined();

    // Payload size must be tiny (< 500 bytes)
    const jsonString = JSON.stringify(body);
    expect(jsonString.length).toBeLessThan(500);
  });
});
