import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { POST as unlockPost } from '../src/app/api/giveaways/[id]/unlock/route';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { GET as giveawayDetailGet } from '../src/app/api/giveaways/[id]/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { computeSeedCommitment } from '../src/core/randomizer/hasher';

describe('Task 04 — Snapshot Unlock Gate (SNAPSHOT_LOCKED -> READY)', () => {
  const organizerUser = { id: 'usr_unlock_org_1', vkUserId: '777111' };
  const attackerUser = { id: 'usr_unlock_attacker', vkUserId: '666222' };
  let sessionCookie: string;
  let attackerCookie: string;

  const testParticipants: FilteredParticipant[] = Array.from({ length: 30 }, (_, i) => ({
    platformUserId: `${3000 + i}`,
    firstName: `User${i}`,
    lastName: `Unlock${i}`,
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

    const attackerSessionId = await defaultSessionStore.createSession(attackerUser);
    attackerCookie = `${SESSION_COOKIE_NAME}=${attackerSessionId}`;
  });

  async function createReadyGiveaway() {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-44556677_100',
      post: {
        platform: 'VK',
        ownerId: '-44556677',
        postId: '100',
        sourceUrl: 'https://vk.com/wall-44556677_100',
        title: 'Unlock Test Post',
        text: 'Test description',
        likesCount: 30,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, testParticipants);
    return gw;
  }

  // ─── Test 1: Full Lifecycle (Lock -> Unlock -> Re-import/Modify -> Re-Lock -> Draw) ───
  it('full lifecycle: lock -> unlock -> modify rules -> re-lock -> draw succeeds', async () => {
    const gw = await createReadyGiveaway();

    // 1. Initial Lock
    const lockReq1 = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });
    const lockRes1 = await snapshotPost(lockReq1, { params: { id: gw.id } });
    expect(lockRes1.status).toBe(200);
    const lockData1 = await lockRes1.json();
    expect(lockData1.status).toBe('SNAPSHOT_LOCKED');
    expect(lockData1.snapshot.version).toBe(1);
    const commitment1 = lockData1.seedCommitment;

    // 2. Unlock
    const unlockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
    });
    const unlockRes = await unlockPost(unlockReq, { params: { id: gw.id } });
    expect(unlockRes.status).toBe(200);
    const unlockData = await unlockRes.json();
    expect(unlockData.success).toBe(true);
    expect(unlockData.status).toBe('READY');
    expect(unlockData.seedCommitment).toBeNull();

    // Verify stored state in DB
    const storedAfterUnlock = await GiveawayStore.getById(gw.id);
    expect(storedAfterUnlock?.status).toBe('READY');
    expect(storedAfterUnlock?.seed).toBeNull();
    expect(storedAfterUnlock?.seedCommitment).toBeNull();

    // 3. Modify Rules / Participants while in READY
    const modifiedRules = { ...DEFAULT_FILTER_RULES, requireComment: false };
    const partReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/participants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ filterRules: modifiedRules }),
    });
    const partRes = await participantsPost(partReq, { params: { id: gw.id } });
    expect(partRes.status).toBe(200);

    // 4. Re-lock snapshot with new version
    const lockReq2 = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ filterRules: modifiedRules }),
    });
    const lockRes2 = await snapshotPost(lockReq2, { params: { id: gw.id } });
    expect(lockRes2.status).toBe(200);
    const lockData2 = await lockRes2.json();
    expect(lockData2.status).toBe('SNAPSHOT_LOCKED');
    expect(lockData2.snapshot.version).toBe(2);
    const commitment2 = lockData2.seedCommitment;

    // 5. Seeds & commitments before and after unlock are distinct
    expect(commitment2).not.toBe(commitment1);

    // 6. Draw succeeds on version 2 snapshot
    const drawReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });
    const drawRes = await drawPost(drawReq, { params: { id: gw.id } });
    expect(drawRes.status).toBe(200);
    const drawData = await drawRes.json();
    expect(drawData.success).toBe(true);
    expect(drawData.drawResult.snapshotId).toBe(lockData2.snapshot.id);
    expect(createHash('sha256').update(drawData.drawResult.seedUsed).digest('hex')).toBe(commitment2);
  });

  // ─── Test 2: Unlock from Terminal State (DRAWN) -> 409 Conflict ──────────────
  it('unlock from DRAWN status returns 409 Conflict and preserves draw result', async () => {
    const gw = await createReadyGiveaway();

    // Lock and Draw
    const lockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });
    await snapshotPost(lockReq, { params: { id: gw.id } });

    const drawReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });
    const drawRes = await drawPost(drawReq, { params: { id: gw.id } });
    expect(drawRes.status).toBe(200);

    // Attempt Unlock on DRAWN giveaway -> 409
    const unlockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    });
    const unlockRes = await unlockPost(unlockReq, { params: { id: gw.id } });
    expect(unlockRes.status).toBe(409);

    // Verify status and drawResult are intact
    const stored = await GiveawayStore.getById(gw.id);
    expect(stored?.status).toBe('DRAWN');
    expect(stored?.drawResult).toBeDefined();
  });

  // ─── Test 3: Unlock from READY -> 409 Conflict ──────────────────────────────
  it('unlock when already in READY status returns 409 Conflict', async () => {
    const gw = await createReadyGiveaway();

    const unlockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    });
    const unlockRes = await unlockPost(unlockReq, { params: { id: gw.id } });
    expect(unlockRes.status).toBe(409);
  });

  // ─── Test 4: Ownership Protection (IDOR) -> 403 Forbidden ───────────────────
  it('unlock of another organizer giveaway returns 403 Forbidden', async () => {
    const gw = await createReadyGiveaway();

    // Lock as owner
    const lockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });
    await snapshotPost(lockReq, { params: { id: gw.id } });

    // Attacker attempts to unlock
    const attackUnlockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: attackerCookie },
    });
    const attackUnlockRes = await unlockPost(attackUnlockReq, { params: { id: gw.id } });
    expect(attackUnlockRes.status).toBe(403);

    // Unauthenticated attempt -> 401
    const unauthReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const unauthRes = await unlockPost(unauthReq, { params: { id: gw.id } });
    expect(unauthRes.status).toBe(401);
  });

  // ─── Test 5: Concurrent Unlock Requests (Exactly 1 Succeeds) ─────────────────
  it('concurrent unlock requests: exactly 1 returns 200 OK, remaining return 409 Conflict', async () => {
    const gw = await createReadyGiveaway();

    // Lock first
    const lockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });
    await snapshotPost(lockReq, { params: { id: gw.id } });

    // Launch 10 concurrent unlocks with distinct idempotency keys
    const requests = Array.from({ length: 10 }, (_, i) => {
      const req = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
          'Idempotency-Key': `unlock-concurrent-${i}-${Date.now()}`,
        },
      });
      return unlockPost(req, { params: { id: gw.id } });
    });

    const responses = await Promise.all(requests);
    const statusCodes = responses.map(r => r.status);

    const count200 = statusCodes.filter(s => s === 200).length;
    const count409 = statusCodes.filter(s => s === 409).length;

    expect(count200).toBe(1);
    expect(count409).toBe(9);

    const stored = await GiveawayStore.getById(gw.id);
    expect(stored?.status).toBe('READY');
    expect(stored?.seed).toBeNull();
    expect(stored?.seedCommitment).toBeNull();
  });

  // ─── Test 6: Idempotency Replay on Unlock ───────────────────────────────────
  it('idempotency replay returns cached 200 response when using identical Idempotency-Key', async () => {
    const gw = await createReadyGiveaway();
    const idempotencyKey = `unlock-stable-key-${Date.now()}`;

    // Lock first
    const lockReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });
    await snapshotPost(lockReq, { params: { id: gw.id } });

    // 1. First unlock with key
    const unlockReq1 = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Idempotency-Key': idempotencyKey,
      },
    });
    const res1 = await unlockPost(unlockReq1, { params: { id: gw.id } });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.status).toBe('READY');

    // 2. Replay with same key -> cached 200 OK
    const replayReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Idempotency-Key': idempotencyKey,
      },
    });
    const replayRes = await unlockPost(replayReq, { params: { id: gw.id } });
    expect(replayRes.status).toBe(200);
    const replayData = await replayRes.json();
    expect(replayData.status).toBe('READY');

    // 3. New request with different key -> 409 Conflict (since now already READY)
    const newKeyReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Idempotency-Key': `new-key-${Date.now()}`,
      },
    });
    const newKeyRes = await unlockPost(newKeyReq, { params: { id: gw.id } });
    expect(newKeyRes.status).toBe(409);
  });
});
