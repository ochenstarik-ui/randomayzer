import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { GET as publicGiveawayGet } from '../src/app/api/giveaways/[id]/public/route';
import { GET as privateGiveawayGet } from '../src/app/api/giveaways/[id]/route';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { expensiveApiRateLimiter } from '../src/lib/rate-limiter';

describe('Task 06: Public Giveaway Verification Endpoint (GET /api/giveaways/[id]/public)', () => {
  const organizerUser = { id: 'usr_pub_verify_org', vkUserId: '555444' };
  let sessionCookie: string;

  const testParticipants: FilteredParticipant[] = Array.from({ length: 25 }, (_, i) => ({
    platformUserId: `${4000 + i}`,
    firstName: `User${i}`,
    lastName: `Public${i}`,
    source: 'LIKES',
    liked: true,
    commented: false,
    commentsCount: 0,
    reposted: false,
    subscribed: true,
    eligible: true,
    exclusionReason: null,
  }));

  beforeEach(async () => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    defaultSessionStore.clear();
    expensiveApiRateLimiter.reset();

    const sessionId = await defaultSessionStore.createSession(organizerUser);
    sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;
  });

  async function createLockedGiveaway() {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-55667788_999',
      post: {
        platform: 'VK',
        ownerId: '-55667788',
        postId: '999',
        sourceUrl: 'https://vk.com/wall-55667788_999',
        title: 'Public Verification Test Post',
        text: 'Provably fair giveaway description',
        likesCount: 25,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, testParticipants);

    const snapReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });
    const snapRes = await snapshotPost(snapReq, { params: { id: gw.id } });
    const snapData = await snapRes.json();

    return { giveawayId: gw.id, seedCommitment: snapData.seedCommitment, snapshot: snapData.snapshot };
  }

  // ─── Test 1: Anonymous Access Before Draw (Masked Seed, Exposed Commitment) ───
  it('anonymous visitor before draw sees seedCommitment and snapshot hash, but seed is strictly null', async () => {
    const { giveawayId, seedCommitment } = await createLockedGiveaway();

    const req = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/public`);
    const res = await publicGiveawayGet(req, { params: { id: giveawayId } });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const gw = data.giveaway;
    expect(gw.id).toBe(giveawayId);
    expect(gw.status).toBe('SNAPSHOT_LOCKED');
    expect(gw.title).toBe('Public Verification Test Post');
    expect(gw.seedCommitment).toBe(seedCommitment);
    expect(gw.seed).toBeNull(); // Strictly masked before draw!
    expect(gw.latestSnapshot.participantsSnapshotHash).toBeDefined();
    expect(gw.latestSnapshot.conditionsHash).toBeDefined();
    expect(gw.drawResult).toBeNull();

    // Verify raw PII protection
    expect((gw as any).participants).toBeUndefined();
    expect((gw as any).eligibleParticipants).toBeUndefined();
    expect((gw as any).organizerId).toBeUndefined();
  });

  // ─── Test 2: Anonymous Access After Draw (Revealed Seed, Proof & Winners) ─────
  it('anonymous visitor after draw sees revealed seed, deterministic proof, and winner public profiles', async () => {
    const { giveawayId, seedCommitment } = await createLockedGiveaway();

    // Execute draw as organizer
    const drawReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ winnersCount: 2, reserveWinnersCount: 1 }),
    });
    const drawRes = await drawPost(drawReq, { params: { id: giveawayId } });
    expect(drawRes.status).toBe(200);

    // Fetch public giveaway
    const req = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/public`);
    const res = await publicGiveawayGet(req, { params: { id: giveawayId } });

    expect(res.status).toBe(200);
    const data = await res.json();
    const gw = data.giveaway;

    expect(gw.status).toBe('DRAWN');
    expect(gw.seedCommitment).toBe(seedCommitment);
    expect(gw.seed).toBeDefined();
    expect(typeof gw.seed).toBe('string');

    // SHA-256 of revealed seed MUST equal the pre-committed hash
    const computedHash = createHash('sha256').update(gw.seed).digest('hex');
    expect(computedHash).toBe(seedCommitment);

    // Draw result details
    expect(gw.drawResult).toBeDefined();
    expect(gw.drawResult.algorithmVersion).toBe('HMAC_SHA256_FY_V1');
    expect(gw.drawResult.deterministicProofHash).toMatch(/^[a-f0-9]{64}$/);
    expect(gw.drawResult.auditEventHash).toMatch(/^[a-f0-9]{64}$/);
    expect(gw.drawResult.winners).toHaveLength(2);
    expect(gw.drawResult.reserveWinners).toHaveLength(1);

    // Winner profiles contain only safe public fields
    const winner1 = gw.drawResult.winners[0];
    expect(winner1.position).toBe(1);
    expect(winner1.participant.platformUserId).toBeDefined();
    expect(winner1.participant.firstName).toBeDefined();
    expect(winner1.participant.lastName).toBeDefined();
    expect((winner1.participant as any).encryptedToken).toBeUndefined();

    // Raw participant list is still omitted
    expect((gw as any).participants).toBeUndefined();
  });

  // ─── Test 3: Private Giveaway Detail Route Remains Protected (401) ───────────
  it('anonymous request to private GET /api/giveaways/[id] returns 401 Unauthorized', async () => {
    const { giveawayId } = await createLockedGiveaway();

    const req = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}`);
    const res = await privateGiveawayGet(req, { params: { id: giveawayId } });

    expect(res.status).toBe(401);
  });

  // ─── Test 4: Non-Existent Giveaway Returns 404 ────────────────────────────────
  it('request for non-existent giveaway returns 404 Not Found', async () => {
    const req = new NextRequest('http://localhost:3000/api/giveaways/non_existent_123/public');
    const res = await publicGiveawayGet(req, { params: { id: 'non_existent_123' } });

    expect(res.status).toBe(404);
  });

  // ─── Test 5: Rate Limiting on Public Endpoint ─────────────────────────────────
  it('public endpoint enforces rate limiting per client IP', async () => {
    const { giveawayId } = await createLockedGiveaway();

    // Exhaust expensive rate limiter (15 requests)
    for (let i = 0; i < 15; i++) {
      expensiveApiRateLimiter.check(`giveaway-public-get:direct-client:${giveawayId}`);
    }

    const req = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/public`);
    const res = await publicGiveawayGet(req, { params: { id: giveawayId } });

    expect(res.status).toBe(429);
  });
});
