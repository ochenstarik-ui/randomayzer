import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { GET as giveawaysGet } from '../src/app/api/giveaways/route';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';

describe('Phase 2.2.3 Claude PoC: GET /api/giveaways IDOR & Scoped Query Gate', () => {
  let memoryRepo: MemoryGiveawayRepository;

  const userA = { id: 'usr_organizer_alpha', vkUserId: '11111', firstName: 'Alice' };
  const userB = { id: 'usr_organizer_beta', vkUserId: '22222', firstName: 'Bob' };
  const userEmpty = { id: 'usr_organizer_empty', vkUserId: '33333', firstName: 'Charlie' };

  let sessionA: string;
  let sessionB: string;
  let sessionEmpty: string;

  beforeEach(async () => {
    memoryRepo = new MemoryGiveawayRepository();
    GiveawayStore.setRepository(memoryRepo);

    defaultSessionStore.clear();
    sessionA = await defaultSessionStore.createSession(userA);
    sessionB = await defaultSessionStore.createSession(userB);
    sessionEmpty = await defaultSessionStore.createSession(userEmpty);

    // Populate giveaways for User A
    await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-10_100',
      post: {
        platform: 'VK',
        ownerId: '-10',
        postId: '100',
        sourceUrl: 'https://vk.com/wall-10_100',
        title: 'Secret Giveaway of Alice',
        likesCount: 10,
        commentsCount: 2,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: userA.id,
    });

    // Populate giveaways for User B
    await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-20_200',
      post: {
        platform: 'VK',
        ownerId: '-20',
        postId: '200',
        sourceUrl: 'https://vk.com/wall-20_200',
        title: 'Confidential Giveaway of Bob',
        likesCount: 50,
        commentsCount: 15,
        repostsCount: 5,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: userB.id,
    });
  });

  it('Claude PoC Reproduction: anonymous GET /api/giveaways is rejected with 401 Unauthorized', async () => {
    const req = new NextRequest('http://localhost:3000/api/giveaways');
    const res = await giveawaysGet(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.message).toMatch(/authentication required/i);
    // Crucial: No giveaways leaked to anonymous attacker
    expect(body.giveaways).toBeUndefined();
  });

  it('User A list returns strictly User A giveaways (no User B records leaked)', async () => {
    const req = new NextRequest('http://localhost:3000/api/giveaways', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionA}` },
    });
    const res = await giveawaysGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.giveaways).toHaveLength(1);

    const gw = body.giveaways[0];
    expect(gw.organizerId).toBe(userA.id);
    expect(gw.title).toBe('Secret Giveaway of Alice');

    // Ensure User B information is completely absent
    expect(JSON.stringify(body)).not.toContain('Bob');
    expect(JSON.stringify(body)).not.toContain('Confidential Giveaway of Bob');
    expect(JSON.stringify(body)).not.toContain('wall-20_200');
  });

  it('User B list returns strictly User B giveaways (no User A records leaked)', async () => {
    const req = new NextRequest('http://localhost:3000/api/giveaways', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionB}` },
    });
    const res = await giveawaysGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.giveaways).toHaveLength(1);

    const gw = body.giveaways[0];
    expect(gw.organizerId).toBe(userB.id);
    expect(gw.title).toBe('Confidential Giveaway of Bob');

    // Ensure User A information is completely absent
    expect(JSON.stringify(body)).not.toContain('Alice');
    expect(JSON.stringify(body)).not.toContain('Secret Giveaway of Alice');
    expect(JSON.stringify(body)).not.toContain('wall-10_100');
  });

  it('empty account receives empty array [] without errors', async () => {
    const req = new NextRequest('http://localhost:3000/api/giveaways', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionEmpty}` },
    });
    const res = await giveawaysGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.giveaways).toEqual([]);
    expect(body.totalCount).toBe(0);
  });

  it('Repository level test: listGiveawaysSummary filters directly by organizerId', async () => {
    const summariesA = await memoryRepo.listGiveawaysSummary(userA.id);
    expect(summariesA).toHaveLength(1);
    expect(summariesA[0].organizerId).toBe(userA.id);

    const summariesB = await memoryRepo.listGiveawaysSummary(userB.id);
    expect(summariesB).toHaveLength(1);
    expect(summariesB[0].organizerId).toBe(userB.id);

    const summariesEmpty = await memoryRepo.listGiveawaysSummary(userEmpty.id);
    expect(summariesEmpty).toHaveLength(0);
  });
});
