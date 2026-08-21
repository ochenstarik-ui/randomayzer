import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';

describe('Winner Count Contract & Draw Retry Invariants', () => {
  const testUser = { id: 'usr_winner_contract_tester', vkUserId: '66666' };
  let sessionId: string;

  beforeEach(async () => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    defaultSessionStore.clear();
    sessionId = await defaultSessionStore.createSession(testUser);
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
        text: 'Test description',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 3,
      reserveWinnersCount: 0,
      organizerId: testUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    const { snapshot } = await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

    const result = executeDeterministicDrawV1({
      giveawayId: gw.id,
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 3,
      reserveWinnersCount: 0,
      seed: 'test-seed-3-3-0',
    });

    expect(result.winners).toHaveLength(3);
    expect(result.reserveWinners).toHaveLength(0);
    expect(result.totalEligibleCount).toBe(3);
  });

  it('eligible=3, winners=2, reserve=1 -> success', async () => {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_2',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '2',
        sourceUrl: 'https://vk.com/wall-100_2',
        title: 'Title',
        text: 'Test description',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 2,
      reserveWinnersCount: 1,
      organizerId: testUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    const { snapshot } = await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

    const result = executeDeterministicDrawV1({
      giveawayId: gw.id,
      snapshot,
      totalLoadedCount: 3,
      winnersCount: 2,
      reserveWinnersCount: 1,
      seed: 'test-seed-2-1-0',
    });

    expect(result.winners).toHaveLength(2);
    expect(result.reserveWinners).toHaveLength(1);
    expect(result.winnerIds).not.toEqual(result.reserveWinnerIds);
  });

  it('eligible=3, winners=3, reserve=3 -> throws error (never silently reduce)', async () => {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_3',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '3',
        sourceUrl: 'https://vk.com/wall-100_3',
        title: 'Title',
        text: 'Test description',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 3,
      reserveWinnersCount: 3,
      organizerId: testUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    const { snapshot } = await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

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
        text: 'Test description',
        likesCount: 3,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: testUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, threeParticipants);
    await GiveawayStore.createAndLockSnapshot(gw.id, threeParticipants, DEFAULT_FILTER_RULES);

    // First draw
    const req1 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });
    const res1 = await drawPost(req1, { params: { id: gw.id } });
    expect(res1.status).toBe(200);

    // Second draw -> MUST return 409 DRAW_ALREADY_COMPLETED
    const req2 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });
    const res2 = await drawPost(req2, { params: { id: gw.id } });
    expect(res2.status).toBe(409);

    const body = await res2.json();
    expect(body.error?.code).toBe('DRAW_ALREADY_COMPLETED');
  });
});
