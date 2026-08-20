import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { GET as giveawayDetailGet } from '../src/app/api/giveaways/[id]/route';
import { GET as verifyGet } from '../src/app/api/giveaways/[id]/verify/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { PrismaGiveawayRepository } from '../src/lib/repository/prisma-repository';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';
import { computeSeedCommitment } from '../src/core/randomizer/hasher';

describe('Phase 2.4 — Seed Pre-Commit Gate (Seed Grinding Elimination)', () => {
  const organizerUser = { id: 'usr_organizer_precommit', vkUserId: '777111' };
  let sessionCookie: string;

  // 100 eligible participants for realistic grinding test
  const testParticipants: FilteredParticipant[] = Array.from({ length: 100 }, (_, i) => ({
    platformUserId: `${1000 + i}`,
    firstName: `User${i}`,
    lastName: `Test${i}`,
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
    const sessionId = await defaultSessionStore.createSession(organizerUser);
    sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;
  });

  async function createLockedGiveaway(repo?: any) {
    if (repo) GiveawayStore.setRepository(repo);

    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-22446688_1054',
      post: {
        platform: 'VK',
        ownerId: '-22446688',
        postId: '1054',
        sourceUrl: 'https://vk.com/wall-22446688_1054',
        title: 'Fairness Test Post',
        likesCount: 100,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, testParticipants);

    const snapReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });

    const snapRes = await snapshotPost(snapReq, { params: { id: gw.id } });
    expect(snapRes.status).toBe(200);
    const snapBody = await snapRes.json();

    return { giveawayId: gw.id, snapBody };
  }

  // ─── Test 1: Adversarial client-supplied seed is rejected with 400 ───────────
  it('adversarial attempt to pass custom seed in draw body fails with 400 and keeps status SNAPSHOT_LOCKED', async () => {
    const { giveawayId } = await createLockedGiveaway();

    const attackReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        winnersCount: 1,
        reserveWinnersCount: 0,
        seed: 'adversarial-crafted-seed-for-target-winner',
      }),
    });

    const res = await drawPost(attackReq, { params: { id: giveawayId } });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error?.code).toBe('VALIDATION_ERROR');

    // Verify giveaway remains intact in SNAPSHOT_LOCKED status
    const gwAfter = await GiveawayStore.getById(giveawayId);
    expect(gwAfter?.status).toBe('SNAPSHOT_LOCKED');
    expect(gwAfter?.drawResult).toBeNull();
  });

  // ─── Test 2: Grinding regression (100 local attack seeds cannot influence API draw) ───
  it('grinding regression: local brute-force of 100 seeds cannot alter the pre-committed API winner', async () => {
    const { giveawayId, snapBody } = await createLockedGiveaway();

    // 1. Verify snapshot commitment was returned
    const seedCommitment = snapBody.seedCommitment;
    expect(seedCommitment).toBeDefined();
    expect(seedCommitment).toMatch(/^[a-f0-9]{64}$/);

    // 2. Attacker runs 100 local simulations targeting user '1042'
    const targetUserId = '1042';
    let grindedSeed = '';
    for (let i = 0; i < 150; i++) {
      const candidateSeed = `attack-${i}`;
      const simResult = executeDeterministicDrawV1({
        giveawayId,
        snapshot: snapBody.snapshot,
        totalLoadedCount: testParticipants.length,
        winnersCount: 1,
        reserveWinnersCount: 0,
        seed: candidateSeed,
      });
      if (simResult.winnerIds.includes(targetUserId)) {
        grindedSeed = candidateSeed;
        break;
      }
    }

    expect(grindedSeed).not.toBe('');

    // 3. Attacker tries to submit this grinded seed to the draw endpoint -> REJECTED (400)
    const attackReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        winnersCount: 1,
        reserveWinnersCount: 0,
        seed: grindedSeed,
      }),
    });

    const attackRes = await drawPost(attackReq, { params: { id: giveawayId } });
    expect(attackRes.status).toBe(400);

    // 4. Legitimate draw execution without client seed
    const legitimateReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        winnersCount: 1,
        reserveWinnersCount: 0,
      }),
    });

    const legitRes = await drawPost(legitimateReq, { params: { id: giveawayId } });
    expect(legitRes.status).toBe(200);

    const legitBody = await legitRes.json();
    const actualSeedUsed = legitBody.drawResult.seedUsed;

    // 5. Verification: the seed used MUST match the pre-committed hash
    const computedHash = createHash('sha256').update(actualSeedUsed).digest('hex');
    expect(computedHash).toBe(seedCommitment);

    // Attacker's grinded seed is NOT the actual seed
    expect(actualSeedUsed).not.toBe(grindedSeed);
  });

  // ─── Test 3: Draw without locked seed / snapshot fails with 409 Conflict ───────
  it('draw attempt on giveaway without locked snapshot and seed returns 409 Conflict', async () => {
    // Create giveaway in READY status (no snapshot locked)
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-22446688_1054',
      post: {
        platform: 'VK',
        ownerId: '-22446688',
        postId: '1054',
        sourceUrl: 'https://vk.com/wall-22446688_1054',
        title: 'No Seed Post',
        likesCount: 10,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    const drawReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });

    const res = await drawPost(drawReq, { params: { id: gw.id } });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error?.code).toBe('CONFLICT');
  });

  // ─── Test 4: Seed is absent in GET /api/giveaways/[id] before DRAWN ────────────
  it('GET /api/giveaways/[id] masks seed before DRAWN and exposes seedCommitment', async () => {
    const { giveawayId, snapBody } = await createLockedGiveaway();

    const getReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}`, {
      method: 'GET',
      headers: { Cookie: sessionCookie },
    });

    const res = await giveawayDetailGet(getReq, { params: { id: giveawayId } });
    expect(res.status).toBe(200);

    const body = await res.json();
    // Seed must be null in response
    expect(body.giveaway.seed).toBeNull();
    // seedCommitment must match snapshot commitment
    expect(body.giveaway.seedCommitment).toBe(snapBody.seedCommitment);

    // Verify raw text does not contain internal seed
    const rawText = await (await giveawayDetailGet(getReq, { params: { id: giveawayId } })).text();
    const storedGw = await GiveawayStore.getById(giveawayId);
    expect(rawText).not.toContain(storedGw!.seed!);
  });

  // ─── Test 5: After DRAWN, sha256(seedUsed) strictly equals seedCommitment ──────
  it('after DRAWN, sha256(seedUsed) strictly equals seedCommitment and verify endpoint succeeds', async () => {
    const { giveawayId, snapBody } = await createLockedGiveaway();

    const drawReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ winnersCount: 2, reserveWinnersCount: 1 }),
    });

    const drawRes = await drawPost(drawReq, { params: { id: giveawayId } });
    expect(drawRes.status).toBe(200);
    const drawData = await drawRes.json();

    // 1. Check seedCommitment integrity
    const seedUsed = drawData.drawResult.seedUsed;
    expect(computeSeedCommitment(seedUsed)).toBe(snapBody.seedCommitment);

    // 2. Check giveaway detail exposes seed after DRAWN
    const getReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}`, {
      method: 'GET',
      headers: { Cookie: sessionCookie },
    });
    const detailRes = await giveawayDetailGet(getReq, { params: { id: giveawayId } });
    const detailData = await detailRes.json();
    expect(detailData.giveaway.seed).toBe(seedUsed);
    expect(detailData.giveaway.seedCommitment).toBe(snapBody.seedCommitment);

    // 3. Public verify endpoint succeeds without cookie
    const verifyReq = new NextRequest(`http://localhost:3000/api/giveaways/${giveawayId}/verify`, {
      method: 'GET',
    });
    const verifyRes = await verifyGet(verifyReq, { params: { id: giveawayId } });
    expect(verifyRes.status).toBe(200);

    const verifyData = await verifyRes.json();
    expect(verifyData.success).toBe(true);
    expect(verifyData.verified).toBe(true);
    expect(verifyData.winnersMatch).toBe(true);
    expect(verifyData.deterministicProofHashMatch).toBe(true);
  });

  // ─── Test 6: Repository Driver Parity (Memory repository seed precommit) ───────
  it('MemoryGiveawayRepository generates and locks seed during createAndLockSnapshot', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-1_1',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-1_1',
        title: 'Memory Parity',
        likesCount: 10,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: 'org_mem',
    });

    expect(gw.seed).toBeNull();
    expect(gw.seedCommitment).toBeNull();

    const snapshot = await repo.createAndLockSnapshot(gw.id, testParticipants.slice(0, 10), DEFAULT_FILTER_RULES);
    expect(snapshot.id).toBeDefined();

    const lockedGw = await repo.getGiveawayById(gw.id);
    expect(lockedGw?.status).toBe('SNAPSHOT_LOCKED');
    expect(lockedGw?.seed).toBeDefined();
    expect(lockedGw?.seed).toHaveLength(32);
    expect(lockedGw?.seedCommitment).toBe(computeSeedCommitment(lockedGw!.seed!));
  });

  // ─── Test 7: Repository Driver Parity (Prisma repository mapping & seed commitment) ───
  it('PrismaGiveawayRepository maps seedCommitment correctly', async () => {
    const prismaRepo = new PrismaGiveawayRepository();
    const rawMock = {
      id: 'gw_prisma_mock_1',
      platform: 'VK',
      sourceUrl: 'https://vk.com/wall-1_1',
      platformOwnerId: '-1',
      platformPostId: '1',
      title: 'Prisma Parity',
      description: null,
      postImageUrl: null,
      postLikesCount: 10,
      postCommentsCount: 0,
      postRepostsCount: 0,
      status: 'SNAPSHOT_LOCKED',
      filterRules: DEFAULT_FILTER_RULES,
      winnersCount: 1,
      reserveWinnersCount: 0,
      seed: '0123456789abcdef0123456789abcdef',
      organizerId: 'org_prisma',
      createdAt: new Date(),
      updatedAt: new Date(),
      drawnAt: null,
      participants: [],
      snapshots: [],
      drawResult: null,
    };

    const mapped = (prismaRepo as any).mapPrismaGiveaway(rawMock);
    expect(mapped.seed).toBe('0123456789abcdef0123456789abcdef');
    expect(mapped.seedCommitment).toBe(computeSeedCommitment('0123456789abcdef0123456789abcdef'));
  });
});
