import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as giveawaysGet, POST as giveawaysPost } from '../src/app/api/giveaways/route';
import { GET as giveawayGet } from '../src/app/api/giveaways/[id]/route';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { GET as participantsGet, POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { POST as unlockPost } from '../src/app/api/giveaways/[id]/unlock/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { MemoryUserRepository, setUserRepository } from '../src/lib/repository/user-repository';
import { MemorySessionStore, setSessionStore, SESSION_COOKIE_NAME, ISessionStore, SessionUser } from '../src/lib/auth/session';
import { expensiveApiRateLimiter, generalApiRateLimiter, preAuthRateLimiter } from '../src/lib/rate-limiter';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';

class CountingSessionStore implements ISessionStore {
  public getSessionCalls = 0;
  private delegate = new MemorySessionStore();

  public async createSession(user: SessionUser, ttlMs?: number): Promise<string> {
    return this.delegate.createSession(user, ttlMs);
  }

  public async getSession(sessionId: string): Promise<SessionUser | null> {
    this.getSessionCalls++;
    return this.delegate.getSession(sessionId);
  }

  public async destroySession(sessionId: string): Promise<void> {
    return this.delegate.destroySession(sessionId);
  }

  public cleanupExpired(): number {
    return this.delegate.cleanupExpired();
  }

  public clear(): void {
    this.getSessionCalls = 0;
    this.delegate.clear();
  }

  public size(): number {
    return this.delegate.size();
  }
}

describe('Task 15: Pre-Authentication Rate Limiting Before Session Store Lookup', () => {
  let userRepo: MemoryUserRepository;
  let countingSessionStore: CountingSessionStore;
  let repo: MemoryGiveawayRepository;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.TRUST_PROXY;

    userRepo = new MemoryUserRepository();
    setUserRepository(userRepo);

    countingSessionStore = new CountingSessionStore();
    setSessionStore(countingSessionStore);

    repo = new MemoryGiveawayRepository();
    GiveawayStore.setRepository(repo);

    expensiveApiRateLimiter.reset();
    generalApiRateLimiter.reset();
    preAuthRateLimiter.reset();
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
    const sessionId = await countingSessionStore.createSession(user);
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
        title: 'Test Giveaway',
        text: 'Description',
        likesCount: 10,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 1,
      reserveWinnersCount: 0,
      organizerId,
    });
    return gw;
  }

  // ─── 1. 300 Requests Without Cookie → getSessionCalls === 0 ───────────────
  it('300 requests without cookie result in exactly 0 session store calls and 429 after 60 requests', async () => {
    let unauthorizedCount = 0;
    let rateLimitedCount = 0;

    for (let i = 0; i < 300; i++) {
      const req = new NextRequest('http://localhost/api/giveaways', { method: 'GET' });
      const res = await giveawaysGet(req);
      if (res.status === 401) {
        unauthorizedCount++;
      } else if (res.status === 429) {
        rateLimitedCount++;
      }
    }

    expect(unauthorizedCount).toBe(60);
    expect(rateLimitedCount).toBe(240);
    // 0 database / session store calls
    expect(countingSessionStore.getSessionCalls).toBe(0);
  });

  // ─── 2. 300 Requests With Unique Fake Cookies → getSessionCalls <= 60 ──────
  it('300 requests with unique invalid/fake cookies result in at most 60 session store calls', async () => {
    let unauthorizedCount = 0;
    let rateLimitedCount = 0;

    for (let i = 0; i < 300; i++) {
      const req = new NextRequest('http://localhost/api/giveaways', {
        method: 'GET',
        headers: { cookie: `${SESSION_COOKIE_NAME}=fake_cookie_${i}` },
      });
      const res = await giveawaysGet(req);
      if (res.status === 401) {
        unauthorizedCount++;
      } else if (res.status === 429) {
        rateLimitedCount++;
      }
    }

    expect(unauthorizedCount).toBe(60);
    expect(rateLimitedCount).toBe(240);
    // Crucial evidence assertion: exactly 60 session store calls were made before limiter tripped,
    // all remaining 240 requests were cut off at step 2 before touching session store / DB.
    expect(countingSessionStore.getSessionCalls).toBeLessThanOrEqual(60);
    expect(countingSessionStore.getSessionCalls).toBe(60);
  });

  // ─── 3. Successful Authenticated Requests Do NOT Consume Pre-Auth Quota ────
  it('successful authenticated requests do not consume pre-auth tokens (active user does not self-block)', async () => {
    const alice = await createOrganizerWithSession('1001', 'Alice');
    countingSessionStore.getSessionCalls = 0; // reset counter after session creation

    // Alice makes 100 requests with her valid session cookie
    for (let i = 0; i < 100; i++) {
      const aliceReq = new NextRequest('http://localhost/api/giveaways', {
        method: 'GET',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.sessionId}` },
      });
      const aliceRes = await giveawaysGet(aliceReq);
      expect(aliceRes.status).toBe(200);
    }

    // All 100 requests went through to the session store
    expect(countingSessionStore.getSessionCalls).toBe(100);

    // Pre-auth rate limiter bucket for Alice's IP remains completely untouched (0 tokens consumed)
    const preAuthStatus = preAuthRateLimiter.peek('pre-auth:direct-client');
    expect(preAuthStatus.remaining).toBe(60);
  });

  // ─── 4. Pre-Auth Rate Limiting on All Protected Endpoints ───────────────────
  it('pre-auth rate limiting protects all protected API routes before DB access', async () => {
    const alice = await createOrganizerWithSession('1001', 'Alice');
    const gw = await createReadyGiveaway(alice.user.id);

    // Exhaust preAuthRateLimiter (60 requests)
    for (let i = 0; i < 60; i++) {
      preAuthRateLimiter.consume('pre-auth:direct-client');
    }

    // Check that every protected route returns 429 when unauthenticated
    const testCases = [
      { name: 'GET /api/giveaways', fn: () => giveawaysGet(new NextRequest('http://localhost/api/giveaways')) },
      { name: 'POST /api/giveaways', fn: () => giveawaysPost(new NextRequest('http://localhost/api/giveaways', { method: 'POST' })) },
      { name: 'GET /api/giveaways/[id]', fn: () => giveawayGet(new NextRequest(`http://localhost/api/giveaways/${gw.id}`), { params: { id: gw.id } }) },
      { name: 'POST /api/giveaways/[id]/draw', fn: () => drawPost(new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, { method: 'POST' }), { params: { id: gw.id } }) },
      { name: 'GET /api/giveaways/[id]/participants', fn: () => participantsGet(new NextRequest(`http://localhost/api/giveaways/${gw.id}/participants`), { params: { id: gw.id } }) },
      { name: 'POST /api/giveaways/[id]/participants', fn: () => participantsPost(new NextRequest(`http://localhost/api/giveaways/${gw.id}/participants`, { method: 'POST' }), { params: { id: gw.id } }) },
      { name: 'POST /api/giveaways/[id]/snapshot', fn: () => snapshotPost(new NextRequest(`http://localhost/api/giveaways/${gw.id}/snapshot`, { method: 'POST' }), { params: { id: gw.id } }) },
      { name: 'POST /api/giveaways/[id]/unlock', fn: () => unlockPost(new NextRequest(`http://localhost/api/giveaways/${gw.id}/unlock`, { method: 'POST' }), { params: { id: gw.id } }) },
    ];

    for (const tc of testCases) {
      const res = await tc.fn();
      expect(res.status, `Endpoint ${tc.name} must return 429 when pre-auth limit is reached`).toBe(429);
    }
  });

  // ─── 5. Regression: User-Scoped Isolation Remains Intact ─────────────────────
  it('user-scoped rate limit isolation remains intact after pre-auth layer', async () => {
    const alice = await createOrganizerWithSession('1001', 'Alice');
    const bob = await createOrganizerWithSession('1002', 'Bob');

    // Alice exhausts her user-scoped general bucket (120 requests)
    for (let i = 0; i < 120; i++) {
      generalApiRateLimiter.check(`giveaways-list:${alice.user.id}`);
    }

    // Alice is rate-limited (429)
    const aliceReq = new NextRequest('http://localhost/api/giveaways', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.sessionId}` },
    });
    const aliceRes = await giveawaysGet(aliceReq);
    expect(aliceRes.status).toBe(429);

    // Bob is NOT rate-limited (200)
    const bobReq = new NextRequest('http://localhost/api/giveaways', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${bob.sessionId}` },
    });
    const bobRes = await giveawaysGet(bobReq);
    expect(bobRes.status).toBe(200);
  });
});
