import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { POST as giveawaysPost } from '../src/app/api/giveaways/route';
import { GET as giveawayDetailGet } from '../src/app/api/giveaways/[id]/route';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { GET as verifyGet } from '../src/app/api/giveaways/[id]/verify/route';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';

describe('Phase 2.2.2 Giveaway Ownership Invariant & AuthZ Guard Security Suite', () => {
  let memoryRepo: MemoryGiveawayRepository;
  const ownerUser = { id: 'usr_organizer_1', vkUserId: '111111', firstName: 'Alice' };
  const intruderUser = { id: 'usr_intruder_2', vkUserId: '222222', firstName: 'Eve' };
  let ownerSessionId: string;
  let intruderSessionId: string;

  beforeEach(async () => {
    memoryRepo = new MemoryGiveawayRepository();
    GiveawayStore.setRepository(memoryRepo);

    defaultSessionStore.clear();
    ownerSessionId = await defaultSessionStore.createSession(ownerUser);
    intruderSessionId = await defaultSessionStore.createSession(intruderUser);
  });

  const validPostData = {
    sourceUrl: 'https://vk.com/wall-1_100',
    post: {
      platform: 'VK' as const,
      ownerId: '-1',
      postId: '100',
      sourceUrl: 'https://vk.com/wall-1_100',
      title: 'Mega Giveaway',
      text: 'Mega Giveaway Description',
      likesCount: 10,
      commentsCount: 5,
      repostsCount: 0,
    },
    filterRules: {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      minEligibleParticipants: 1,
    },
    winnersCount: 1,
    reserveWinnersCount: 0,
  };

  it('anonymous POST /api/giveaways returns 401 Unauthorized', async () => {
    const req = new NextRequest('http://localhost:3000/api/giveaways', {
      method: 'POST',
      body: JSON.stringify(validPostData),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await giveawaysPost(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.message).toMatch(/authentication required/i);
  });

  it('authenticated POST /api/giveaways binds organizerId strictly from server session', async () => {
    const req = new NextRequest('http://localhost:3000/api/giveaways', {
      method: 'POST',
      body: JSON.stringify({
        ...validPostData,
        organizerId: 'usr_fake_spoofed_id', // Client attempt to spoof organizer
      }),
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}`,
      },
    });

    const res = await giveawaysPost(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.giveaway.organizerId).toBe(ownerUser.id);
  });

  it('owner can access private giveaway details; intruder gets 403 Forbidden', async () => {
    const created = await GiveawayStore.create({
      sourceUrl: validPostData.sourceUrl,
      post: validPostData.post,
      filterRules: validPostData.filterRules,
      organizerId: ownerUser.id,
    });

    // 1. Owner access
    const ownerReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}` },
    });
    const ownerRes = await giveawayDetailGet(ownerReq, { params: { id: created.id } });
    expect(ownerRes.status).toBe(200);

    // 2. Intruder access
    const intruderReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${intruderSessionId}` },
    });
    const intruderRes = await giveawayDetailGet(intruderReq, { params: { id: created.id } });
    expect(intruderRes.status).toBe(403);
    const intruderBody = await intruderRes.json();
    expect(intruderBody.error?.message).toMatch(/not the organizer/i);
  });

  it('owner can import participants; intruder gets 403 Forbidden', async () => {
    const created = await GiveawayStore.create({
      sourceUrl: validPostData.sourceUrl,
      post: validPostData.post,
      filterRules: validPostData.filterRules,
      organizerId: ownerUser.id,
    });

    const body = JSON.stringify({ filterRules: validPostData.filterRules });

    // 1. Intruder attempt
    const intruderReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/participants`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${intruderSessionId}`,
      },
    });
    const intruderRes = await participantsPost(intruderReq, { params: { id: created.id } });
    expect(intruderRes.status).toBe(403);

    // 2. Anonymous attempt
    const anonReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/participants`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });
    const anonRes = await participantsPost(anonReq, { params: { id: created.id } });
    expect(anonRes.status).toBe(401);
  });

  it('owner can lock snapshot and execute draw; non-owner gets 403 Forbidden', async () => {
    const created = await GiveawayStore.create({
      sourceUrl: validPostData.sourceUrl,
      post: validPostData.post,
      filterRules: validPostData.filterRules,
      organizerId: ownerUser.id,
    });

    // Populate participants
    await GiveawayStore.updateParticipants(created.id, [
      {
        platformUserId: 'u1',
        firstName: 'Bob',
        lastName: 'Test',
        source: 'LIKES',
        liked: true,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: false,
        eligible: true,
      },
    ]);

    // 1. Snapshot by intruder -> 403
    const intruderSnapshotReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({ filterRules: validPostData.filterRules }),
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${intruderSessionId}`,
      },
    });
    const intruderSnapRes = await snapshotPost(intruderSnapshotReq, { params: { id: created.id } });
    expect(intruderSnapRes.status).toBe(403);

    // 2. Snapshot by owner -> 200
    const ownerSnapshotReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({ filterRules: validPostData.filterRules }),
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}`,
      },
    });
    const ownerSnapRes = await snapshotPost(ownerSnapshotReq, { params: { id: created.id } });
    expect(ownerSnapRes.status).toBe(200);

    // 3. Draw by intruder -> 403
    const intruderDrawReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${intruderSessionId}`,
      },
    });
    const intruderDrawRes = await drawPost(intruderDrawReq, { params: { id: created.id } });
    expect(intruderDrawRes.status).toBe(403);

    // 4. Draw by owner -> 200
    const ownerDrawReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}`,
      },
    });
    const ownerDrawRes = await drawPost(ownerDrawReq, { params: { id: created.id } });
    expect(ownerDrawRes.status).toBe(200);
  });

  it('null organizer giveaway must NEVER authorize any user (fails with 403 Forbidden)', async () => {
    // Manually inject a corrupted/legacy giveaway with empty organizerId
    const corruptedId = 'gw_corrupted_null_owner';
    (memoryRepo as any).giveaways.set(corruptedId, {
      id: corruptedId,
      platform: 'VK',
      sourceUrl: 'https://vk.com/wall-1_1',
      platformOwnerId: '-1',
      platformPostId: '1',
      title: 'Corrupted',
      organizerId: '', // Empty/null owner
      status: 'READY',
      participants: [],
      filterRules: validPostData.filterRules,
      winnersCount: 1,
      reserveWinnersCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      drawnAt: null,
      snapshots: [],
      latestSnapshot: null,
      drawResult: null,
    });

    // 1. Authenticated user attempts GET -> 403
    const getReq = new NextRequest(`http://localhost:3000/api/giveaways/${corruptedId}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}` },
    });
    const getRes = await giveawayDetailGet(getReq, { params: { id: corruptedId } });
    expect(getRes.status).toBe(403);
    const getBody = await getRes.json();
    expect(getBody.error?.message).toMatch(/no valid organizer assigned/i);

    // 2. Authenticated user attempts POST participants -> 403
    const partReq = new NextRequest(`http://localhost:3000/api/giveaways/${corruptedId}/participants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}`,
      },
      body: JSON.stringify({ filterRules: validPostData.filterRules }),
    });
    const partRes = await participantsPost(partReq, { params: { id: corruptedId } });
    expect(partRes.status).toBe(403);

    // 3. Authenticated user attempts POST draw -> 403
    const drawReq = new NextRequest(`http://localhost:3000/api/giveaways/${corruptedId}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}`,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });
    const drawRes = await drawPost(drawReq, { params: { id: corruptedId } });
    expect(drawRes.status).toBe(403);
  });

  it('GET /api/giveaways/[id]/verify remains public without requiring authentication', async () => {
    const created = await GiveawayStore.create({
      sourceUrl: validPostData.sourceUrl,
      post: validPostData.post,
      filterRules: validPostData.filterRules,
      organizerId: ownerUser.id,
    });

    await GiveawayStore.updateParticipants(created.id, [
      {
        platformUserId: 'u1',
        firstName: 'Bob',
        lastName: 'Test',
        source: 'LIKES',
        liked: true,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: false,
        eligible: true,
      },
    ]);

    await GiveawayStore.createAndLockSnapshot(created.id, created.participants, validPostData.filterRules);

    // Draw
    const drawReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${ownerSessionId}`,
      },
    });
    await drawPost(drawReq, { params: { id: created.id } });

    // Public verify request without any cookie/session
    const publicVerifyReq = new NextRequest(`http://localhost:3000/api/giveaways/${created.id}/verify`);
    const verifyRes = await verifyGet(publicVerifyReq, { params: { id: created.id } });

    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.verified).toBe(true);
    expect(verifyBody.deterministicProofHash).toBeDefined();
    // Verify no private credentials or PII lists are leaked
    expect(verifyBody.access_token).toBeUndefined();
    expect(verifyBody.participants).toBeUndefined();
  });
});
