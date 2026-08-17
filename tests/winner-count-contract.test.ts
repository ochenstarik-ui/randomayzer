import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { ProviderRegistry } from '../src/providers/registry';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';

describe('Winner Count Contract & Draw Retry Invariants', () => {
  beforeEach(() => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    ProviderRegistry.useMockVk();
  });

  const threeParticipants: FilteredParticipant[] = Array.from({ length: 3 }, (_, i) => ({
    platformUserId: `user_${i + 1}`,
    firstName: 'User',
    lastName: `${i + 1}`,
    source: 'LIKES',
    liked: true,
    commented: false,
    commentsCount: 0,
    reposted: false,
    subscribed: true,
    eligible: true,
    exclusionReason: null,
  }));

  it('eligible=3, winners=3, reserve=0 -> success', async () => {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_1',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-100_1',
        title: 'Title',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 3,
      reserveWinnersCount: 0,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    const snapshot = await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

    const result = executeDeterministicDrawV1({
      giveawayId: gw.id,
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 3,
      reserveWinnersCount: 0,
      seed: 'test-seed-3-3-0',
    });

    expect(result.winners.length).toBe(3);
    expect(result.reserveWinners.length).toBe(0);
  });

  it('eligible=3, winners=4, reserve=0 -> error (never silently reduces winners count)', async () => {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_2',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '2',
        sourceUrl: 'https://vk.com/wall-100_2',
        title: 'Title',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 4,
      reserveWinnersCount: 0,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    const snapshot = await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

    expect(() =>
      executeDeterministicDrawV1({
        giveawayId: gw.id,
        snapshot,
        totalLoadedCount: 3,
        winnersCount: 4,
        reserveWinnersCount: 0,
        seed: 'test-seed-3-4-0',
      })
    ).toThrow(/exceeds eligible participants count/i);
  });

  it('eligible=3, winners=3, reserve=3 -> error (total 6 exceeds pool of 3)', async () => {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_3',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '3',
        sourceUrl: 'https://vk.com/wall-100_3',
        title: 'Title',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 3,
      reserveWinnersCount: 3,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    const snapshot = await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

    expect(() =>
      executeDeterministicDrawV1({
        giveawayId: gw.id,
        snapshot,
        totalLoadedCount: 3,
        winnersCount: 3,
        reserveWinnersCount: 3,
        seed: 'test-seed-3-3-3',
      })
    ).toThrow(/exceeds eligible participants count/i);
  });

  it('repeat draw on already DRAWN giveaway returns 409 DRAW_ALREADY_COMPLETED', async () => {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_4',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '4',
        sourceUrl: 'https://vk.com/wall-100_4',
        title: 'Title',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

    // First draw
    const req1 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });
    const res1 = await drawPost(req1, { params: { id: gw.id } });
    expect(res1.status).toBe(200);

    // Second draw -> MUST return 409 DRAW_ALREADY_COMPLETED
    const req2 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });
    const res2 = await drawPost(req2, { params: { id: gw.id } });
    expect(res2.status).toBe(409);

    const body = await res2.json();
    expect(body.error?.code).toBe('DRAW_ALREADY_COMPLETED');
  });
});
