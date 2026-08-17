import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { ProviderRegistry } from '../src/providers/registry';
import { POST as giveawaysPost } from '../src/app/api/giveaways/route';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { POST as previewPost } from '../src/app/api/posts/preview/route';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { GET as giveawayGet } from '../src/app/api/giveaways/[id]/route';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';

async function createGiveaway(overrides: Partial<{ filterRules: typeof DEFAULT_FILTER_RULES; winnersCount: number; reserveWinnersCount: number; seed: string }> = {}) {
  return GiveawayStore.create({
    sourceUrl: 'https://vk.com/wall-100_1',
    post: {
      platform: 'VK',
      ownerId: '-100',
      postId: '1',
      sourceUrl: 'https://vk.com/wall-100_1',
      title: 'Test',
      text: 'Test',
      likesCount: 10,
      commentsCount: 5,
      repostsCount: 2,
    },
    filterRules: overrides.filterRules || DEFAULT_FILTER_RULES,
    winnersCount: overrides.winnersCount ?? 1,
    reserveWinnersCount: overrides.reserveWinnersCount ?? 0,
    seed: overrides.seed,
  });
}

const sampleParticipants: FilteredParticipant[] = Array.from({ length: 5 }, (_, i) => ({
  platformUserId: `${1000 + i}`,
  firstName: 'User',
  lastName: `${i}`,
  source: 'LIKES',
  liked: true,
  commented: false,
  commentsCount: 0,
  reposted: false,
  subscribed: true,
  eligible: true,
  exclusionReason: null,
}));

describe('API input validation', () => {
  beforeEach(() => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    ProviderRegistry.useMockVk();
  });

  describe('POST /api/giveaways', () => {
    it('returns 400 when sourceUrl is missing', async () => {
      const req = new NextRequest('http://localhost/api/giveaways', {
        method: 'POST',
        body: JSON.stringify({ post: {} }),
      });
      const res = await giveawaysPost(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when post is missing', async () => {
      const req = new NextRequest('http://localhost/api/giveaways', {
        method: 'POST',
        body: JSON.stringify({ sourceUrl: 'https://vk.com/wall-1_1' }),
      });
      const res = await giveawaysPost(req);
      expect(res.status).toBe(400);
    });

    it('returns 500 for malformed JSON body', async () => {
      const req = new NextRequest('http://localhost/api/giveaways', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await giveawaysPost(req);
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/posts/preview', () => {
    it('returns 400 for invalid VK URL', async () => {
      const req = new NextRequest('http://localhost/api/posts/preview', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://google.com' }),
      });
      const res = await previewPost(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when URL is missing', async () => {
      const req = new NextRequest('http://localhost/api/posts/preview', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await previewPost(req);
      expect(res.status).toBe(400);
    });

    it('returns 500 for malformed JSON', async () => {
      const req = new NextRequest('http://localhost/api/posts/preview', {
        method: 'POST',
        body: '{ broken',
      });
      const res = await previewPost(req);
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/giveaways/:id/draw', () => {
    it('returns 404 for non-existent giveaway', async () => {
      const req = new NextRequest('http://localhost/api/giveaways/does-not-exist/draw', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await drawPost(req, { params: { id: 'does-not-exist' } });
      expect(res.status).toBe(404);
    });

    it('returns 400 when drawing a giveaway that is already DRAWN', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const snapshot = await GiveawayStore.createAndLockSnapshot(gw.id, sampleParticipants, DEFAULT_FILTER_RULES);

      // First draw
      const firstReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const firstRes = await drawPost(firstReq, { params: { id: gw.id } });
      expect(firstRes.status).toBe(200);

      // Second draw attempt
      const secondReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const secondRes = await drawPost(secondReq, { params: { id: gw.id } });
      expect(secondRes.status).toBe(400);
      const data = await secondRes.json();
      expect(data.error).toMatch(/уже проведен|already drawn/i);
    });

    it('returns 400 when there are 0 eligible participants', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants.map(p => ({ ...p, eligible: false, exclusionReason: 'TEST' })));
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Нет допущенных|0 eligible/i);
    });

    it('currently accepts winnersCount = -1 (documented validation gap)', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({ winnersCount: -1 }),
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      // Current behavior: does not reject negative winnersCount; it caps to pool size.
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.drawResult.winners).toHaveLength(0);
    });

    it('currently treats winnersCount = 0 as the giveaway default (documented validation gap)', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({ winnersCount: 0 }),
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      // The route uses `body.winnersCount || giveaway.winnersCount || 1`, so 0 is ignored.
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.drawResult.winners).toHaveLength(1);
    });

    it('caps winnersCount = 999999999 to pool size', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({ winnersCount: 999999999 }),
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.drawResult.winners).toHaveLength(5);
    });

    it('currently accepts reserveWinnersCount < 0 (documented validation gap)', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({ reserveWinnersCount: -5 }),
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.drawResult.reserveWinners).toHaveLength(0);
    });

    it('uses generated seed when empty seed is provided', async () => {
      const gw = await createGiveaway({ seed: undefined });
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({ seed: '   ' }),
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.drawResult.seedUsed).toBeTruthy();
      expect(data.drawResult.seedUsed.trim().length).toBeGreaterThan(0);
    });

    it('currently accepts huge seed strings (documented validation gap)', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const hugeSeed = 'a'.repeat(100_000);
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: JSON.stringify({ seed: hugeSeed }),
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.drawResult.seedUsed).toBe(hugeSeed);
    });

    it('currently swallows malformed JSON body and proceeds (documented validation gap)', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants);
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
        method: 'POST',
        body: 'not-json',
      });
      const res = await drawPost(req, { params: { id: gw.id } });
      // `.catch(() => ({}))` silently turns malformed JSON into an empty body.
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/giveaways/:id/participants', () => {
    it('currently accepts unknown filter rules in body (documented validation gap)', async () => {
      const gw = await createGiveaway();
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/participants`, {
        method: 'POST',
        body: JSON.stringify({
          filterRules: {
            ...DEFAULT_FILTER_RULES,
            unknownRule: true,
            anotherBadField: 'x',
          },
        }),
      });
      const res = await participantsPost(req, { params: { id: gw.id } });
      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent giveaway', async () => {
      const req = new NextRequest('http://localhost/api/giveaways/missing/participants', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await participantsPost(req, { params: { id: 'missing' } });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/giveaways/:id/snapshot', () => {
    it('returns 400 when there are 0 eligible participants', async () => {
      const gw = await createGiveaway();
      await GiveawayStore.updateParticipants(gw.id, sampleParticipants.map(p => ({ ...p, eligible: false, exclusionReason: 'TEST' })));
      const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/snapshot`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await snapshotPost(req, { params: { id: gw.id } });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/giveaways/:id', () => {
    it('returns 404 for non-existent giveaway', async () => {
      const req = new NextRequest('http://localhost/api/giveaways/missing');
      const res = await giveawayGet(req, { params: { id: 'missing' } });
      expect(res.status).toBe(404);
    });
  });
});
