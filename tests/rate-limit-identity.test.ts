import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { POST as previewPost } from '../src/app/api/posts/preview/route';
import { GET as giveawaysGet } from '../src/app/api/giveaways/route';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { MemoryUserRepository, setUserRepository } from '../src/lib/repository/user-repository';
import { MemorySessionStore, setSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { expensiveApiRateLimiter, generalApiRateLimiter } from '../src/lib/rate-limiter';
import { ProviderFactory } from '../src/providers/factory';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';

describe('Task 02: Client Identity for Rate Limiting', () => {
  let userRepo: MemoryUserRepository;
  let sessionStore: MemorySessionStore;
  let repo: MemoryGiveawayRepository;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.TRUST_PROXY;

    userRepo = new MemoryUserRepository();
    setUserRepository(userRepo);

    sessionStore = new MemorySessionStore();
    setSessionStore(sessionStore);

    repo = new MemoryGiveawayRepository();
    GiveawayStore.setRepository(repo);

    expensiveApiRateLimiter.reset();
    generalApiRateLimiter.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function createOrganizerWithSession(vkUserId: string, name: string) {
    const user = await userRepo.upsertUserWithTokens({
      vkUserId,
      firstName: name,
      lastName: 'Organizer',
      encryptedAccessToken: 'enc_token',
      expiresIn: 86400,
    });
    const sessionId = await sessionStore.createSession(user);
    return { user, sessionId };
  }

  async function createReadyGiveaway(organizerId: string) {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-100_1',
      post: {
        platform: 'VK',
        ownerId: '-100',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-100_1',
        title: 'Test',
        text: 'Test post',
        imageUrl: 'https://example.com/1.jpg',
        likesCount: 10,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 1,
      reserveWinnersCount: 0,
      organizerId,
    });

    const participants = Array.from({ length: 5 }, (_, i) => ({
      platformUserId: `user_${i + 1}`,
      firstName: `User${i + 1}`,
      lastName: 'Participant',
      source: 'LIKES' as const,
      liked: true,
      commented: false,
      reposted: false,
      subscribed: false,
      eligible: true,
    }));

    await GiveawayStore.updateParticipants(gw.id, participants as any);
    await GiveawayStore.createAndLockSnapshot(gw.id, participants as any, DEFAULT_FILTER_RULES);
    return gw;
  }

  // ─── 1. Authenticated User Isolation with Empty req.ip ───────────────────────
  describe('User-Scoped Rate Limiting on Authenticated Routes', () => {
    it('two distinct organizers with empty req.ip have independent draw rate limits', async () => {
      const alice = await createOrganizerWithSession('1001', 'Alice');
      const bob = await createOrganizerWithSession('1002', 'Bob');

      const aliceGw = await createReadyGiveaway(alice.user.id);
      const bobGw = await createReadyGiveaway(bob.user.id);

      // Alice exhausts expensiveApiRateLimiter (15 requests limit)
      // We simulate requests from Alice with NO req.ip (defaulting to 'direct-client')
      for (let i = 0; i < 15; i++) {
        expensiveApiRateLimiter.check(`draw-execute:${alice.user.id}:${aliceGw.id}`);
      }

      // Alice's next draw request must be rate-limited (429)
      const aliceReq = new NextRequest(`http://localhost/api/giveaways/${aliceGw.id}/draw`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${alice.sessionId}`,
        },
      });
      const aliceRes = await drawPost(aliceReq, { params: { id: aliceGw.id } });
      expect(aliceRes.status).toBe(429);

      // Bob's draw request with same empty req.ip must SUCCEED (not blocked by Alice)
      const bobReq = new NextRequest(`http://localhost/api/giveaways/${bobGw.id}/draw`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${bob.sessionId}`,
        },
      });
      const bobRes = await drawPost(bobReq, { params: { id: bobGw.id } });
      expect(bobRes.status).toBe(200);
      const bobData = await bobRes.json();
      expect(bobData.success).toBe(true);
    });

    it('organizer listing rate limit is scoped by sessionUser.id', async () => {
      const alice = await createOrganizerWithSession('1001', 'Alice');
      const bob = await createOrganizerWithSession('1002', 'Bob');

      // Alice exhausts generalApiRateLimiter (120 requests limit)
      for (let i = 0; i < 120; i++) {
        generalApiRateLimiter.check(`giveaways-list:${alice.user.id}`);
      }

      const aliceReq = new NextRequest('http://localhost/api/giveaways', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.sessionId}` },
      });
      const aliceRes = await giveawaysGet(aliceReq);
      expect(aliceRes.status).toBe(429);

      // Bob can still list his giveaways
      const bobReq = new NextRequest('http://localhost/api/giveaways', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${bob.sessionId}` },
      });
      const bobRes = await giveawaysGet(bobReq);
      expect(bobRes.status).toBe(200);
    });
  });

  // ─── 2. Anonymous vs Authenticated Bucket Isolation ──────────────────────────
  describe('Anonymous vs Authenticated Bucket Isolation', () => {
    it('exhausting anonymous rate limit on post preview does not block authenticated organizers', async () => {
      const alice = await createOrganizerWithSession('1001', 'Alice');

      const mockProvider = {
        fetchPost: vi.fn().mockResolvedValue({
          platform: 'VK',
          ownerId: '-100',
          postId: '1',
          title: 'Test Post',
          text: 'Hello world',
          imageUrl: 'https://example.com/img.png',
          likesCount: 10,
          commentsCount: 2,
          repostsCount: 1,
          resolvedAuthType: 'SERVICE',
        }),
      };
      vi.spyOn(ProviderFactory, 'getVkProvider').mockReturnValue(mockProvider as any);

      // Exhaust anonymous IP bucket
      for (let i = 0; i < 120; i++) {
        generalApiRateLimiter.check('post-preview:anon:direct-client');
      }

      // Anonymous preview request is rate-limited (429)
      const anonReq = new NextRequest('http://localhost/api/posts/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://vk.com/wall-100_1' }),
      });
      const anonRes = await previewPost(anonReq);
      expect(anonRes.status).toBe(429);

      // Authenticated organizer preview request SUCCEEDS (200)
      const authReq = new NextRequest('http://localhost/api/posts/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${alice.sessionId}`,
        },
        body: JSON.stringify({ url: 'https://vk.com/wall-100_1' }),
      });
      const authRes = await previewPost(authReq);
      expect(authRes.status).toBe(200);
      const data = await authRes.json();
      expect(data.success).toBe(true);
    });
  });

  // ─── 3. Unauthenticated Rejection & Bucket Integrity ─────────────────────────
  describe('Unauthenticated Request Handling', () => {
    it('unauthenticated request fails with 401 without affecting organizer rate limit bucket', async () => {
      const alice = await createOrganizerWithSession('1001', 'Alice');
      const aliceGw = await createReadyGiveaway(alice.user.id);

      // Attack: unauthenticated requests sent to draw endpoint
      for (let i = 0; i < 50; i++) {
        const unauthReq = new NextRequest(`http://localhost/api/giveaways/${aliceGw.id}/draw`, {
          method: 'POST',
        });
        const unauthRes = await drawPost(unauthReq, { params: { id: aliceGw.id } });
        expect(unauthRes.status).toBe(401);
      }

      // Alice's draw bucket is completely untouched and succeeds
      const aliceReq = new NextRequest(`http://localhost/api/giveaways/${aliceGw.id}/draw`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${alice.sessionId}`,
        },
      });
      const aliceRes = await drawPost(aliceReq, { params: { id: aliceGw.id } });
      expect(aliceRes.status).toBe(200);
    });
  });

  // ─── 4. TRUST_PROXY=true IP Resolution & Rate Limiting ────────────────────────
  describe('TRUST_PROXY=true Behavior', () => {
    it('uses validated client IP for anonymous endpoints when TRUST_PROXY=true', async () => {
      process.env.TRUST_PROXY = 'true';

      const req1 = new NextRequest('http://localhost/api/posts/preview', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.195, 198.51.100.1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://vk.com/wall-100_1' }),
      });

      const req2 = new NextRequest('http://localhost/api/posts/preview', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '198.51.100.25',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://vk.com/wall-100_1' }),
      });

      // Exhaust IP 203.0.113.195
      for (let i = 0; i < 120; i++) {
        generalApiRateLimiter.check('post-preview:anon:203.0.113.195');
      }

      const res1 = await previewPost(req1);
      expect(res1.status).toBe(429);

      // req2 from different IP 198.51.100.25 is NOT blocked
      const mockProvider = {
        fetchPost: vi.fn().mockResolvedValue({
          platform: 'VK',
          ownerId: '-100',
          postId: '1',
          title: 'Test',
          text: 'Hello',
          imageUrl: 'https://example.com/img.png',
          likesCount: 5,
          commentsCount: 1,
          repostsCount: 0,
          resolvedAuthType: 'SERVICE',
        }),
      };
      vi.spyOn(ProviderFactory, 'getVkProvider').mockReturnValue(mockProvider as any);

      const res2 = await previewPost(req2);
      expect(res2.status).toBe(200);
    });
  });
});
