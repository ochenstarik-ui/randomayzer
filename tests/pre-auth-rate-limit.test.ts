import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('Task 12: Pre-Authentication Rate Limiting & Session Store Protection', () => {
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

  // ─── 1. Anonymous Flood on /api/giveaways ──────────────────────────────────
  it('N requests without cookie on /api/giveaways hit 429 after threshold without touching session store', async () => {
    // Threshold is 60 requests
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest('http://localhost/api/giveaways', { method: 'GET' });
      const res = await giveawaysGet(req);
      expect(res.status).toBe(401);
    }

    // 61st request must trigger pre-auth rate limit (429)
    const blockedReq = new NextRequest('http://localhost/api/giveaways', { method: 'GET' });
    const blockedRes = await giveawaysGet(blockedReq);
    expect(blockedRes.status).toBe(429);
    const body = await blockedRes.json();
    expect(body.error?.code).toBe('RATE_LIMIT_EXCEEDED');

    // Crucial: 0 session store calls for requests without cookies
    expect(countingSessionStore.getSessionCalls).toBe(0);
  });

  // ─── 2. Fake Cookie Flood Caps Session Store Lookups ────────────────────────
  it('flood with random fake cookies is capped by pre-auth rate limiter protecting DB', async () => {
    // 60 requests with invalid/fake cookies
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest('http://localhost/api/giveaways', {
        method: 'GET',
        headers: { cookie: `${SESSION_COOKIE_NAME}=fake_cookie_${i}` },
      });
      const res = await giveawaysGet(req);
      expect(res.status).toBe(401);
    }

    // Exactly 60 session store calls were made before limit tripped
    expect(countingSessionStore.getSessionCalls).toBe(60);

    // 61st request must be rejected with 429
    const req61 = new NextRequest('http://localhost/api/giveaways', {
      method: 'GET',
      headers: { cookie: `${SESSION_COOKIE_NAME}=fake_cookie_61` },
    });
    const res61 = await giveawaysGet(req61);
    expect(res61.status).toBe(429);
  });

  // ─── 3. Authenticated User is NOT Blocked by Anonymous Flood ─────────────────
  it('authenticated organizer on the same IP is not blocked by another client anonymous flood', async () => {
    const alice = await createOrganizerWithSession('1001', 'Alice');

    // Anonymous attacker floods /api/giveaways from default 'direct-client'
    for (let i = 0; i < 60; i++) {
      const unauthReq = new NextRequest('http://localhost/api/giveaways', { method: 'GET' });
      const unauthRes = await giveawaysGet(unauthReq);
      expect(unauthRes.status).toBe(401);
    }

    // Anonymous is now rate-limited (429)
    const blockedAnonReq = new NextRequest('http://localhost/api/giveaways', { method: 'GET' });
    const blockedAnonRes = await giveawaysGet(blockedAnonReq);
    expect(blockedAnonRes.status).toBe(429);

    // Alice sends request with valid session cookie from the same 'direct-client' IP -> SUCCEEDS (200)
    const aliceReq = new NextRequest('http://localhost/api/giveaways', {
      method: 'GET',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.sessionId}` },
    });
    const aliceRes = await giveawaysGet(aliceReq);
    expect(aliceRes.status).toBe(200);
    const aliceData = await aliceRes.json();
    expect(aliceData.success).toBe(true);
  });

  // ─── 4. Pre-Auth Rate Limiting on All Protected Endpoints ───────────────────
  it('pre-auth rate limiting protects all protected API routes', async () => {
    const alice = await createOrganizerWithSession('1001', 'Alice');
    const gw = await createReadyGiveaway(alice.user.id);

    // Exhaust preAuthRateLimiter (60 requests)
    for (let i = 0; i < 60; i++) {
      preAuthRateLimiter.check('pre-auth:direct-client');
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
