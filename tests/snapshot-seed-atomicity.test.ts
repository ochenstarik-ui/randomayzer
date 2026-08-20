import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { GET as giveawayDetailGet } from '../src/app/api/giveaways/[id]/route';
import { GET as verifyGet } from '../src/app/api/giveaways/[id]/verify/route';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { ConflictError } from '../src/core/errors/http-errors';
import { computeSeedCommitment } from '../src/core/randomizer/hasher';

describe('Phase 2.4.1 — Atomic Snapshot + Seed Commitment Binding', () => {
  const organizerUser = { id: 'usr_atomic_snap_organizer', vkUserId: '888222' };
  let sessionCookie: string;

  const testParticipants: FilteredParticipant[] = Array.from({ length: 50 }, (_, i) => ({
    platformUserId: `${2000 + i}`,
    firstName: `User${i}`,
    lastName: `Atomic${i}`,
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

  async function createReadyGiveaway() {
    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-33445566_789',
      post: {
        platform: 'VK',
        ownerId: '-33445566',
        postId: '789',
        sourceUrl: 'https://vk.com/wall-33445566_789',
        title: 'Atomic Snapshot Test Post',
        likesCount: 50,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await GiveawayStore.updateParticipants(gw.id, testParticipants);
    return gw;
  }

  // ─── Test 1: Memory Repository Single Lock Invariant & Concurrency ───────────
  it('Memory repository: 20 concurrent createAndLockSnapshot calls yield exactly 1 success and 19 ConflictErrors', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-1_1',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-1_1',
        title: 'Parity Test',
        likesCount: 50,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: 'org_atomic_mem',
    });

    await repo.saveParticipants(gw.id, testParticipants);

    const attempts = Array.from({ length: 20 }, async (_, index) => {
      try {
        const res = await repo.createAndLockSnapshot(gw.id, testParticipants, {
          ...DEFAULT_FILTER_RULES,
          requireLike: index % 2 === 0,
        });
        return { success: true, res };
      } catch (err: any) {
        return { success: false, error: err };
      }
    });

    const results = await Promise.all(attempts);
    const successes = results.filter(r => r.success);
    const conflicts = results.filter(r => !r.success);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(19);

    // The winning result has both snapshot and seedCommitment
    const winning = (successes[0] as any).res;
    expect(winning.snapshot).toBeDefined();
    expect(winning.seedCommitment).toBeDefined();
    expect(winning.seedCommitment).toHaveLength(64);

    // Verify DB state
    const locked = await repo.getGiveawayById(gw.id);
    expect(locked?.status).toBe('SNAPSHOT_LOCKED');
    expect(locked?.snapshots).toHaveLength(1);
    expect(locked?.seed).toBeDefined();
    expect(computeSeedCommitment(locked!.seed!)).toBe(winning.seedCommitment);

    // All failed attempts threw ConflictError
    conflicts.forEach(c => {
      expect(c.error).toBeInstanceOf(ConflictError);
    });
  });

  // ─── Test 2: API Concurrency with different Idempotency keys ─────────────────
  it('API route: concurrent snapshot lock requests with different Idempotency-Keys produce exactly 1 200 and remaining 409s', async () => {
    const gw = await createReadyGiveaway();

    const requests = Array.from({ length: 5 }, (_, i) => {
      const req = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
          'Idempotency-Key': `key-diff-${i}-${Date.now()}`,
        },
        body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
      });
      return snapshotPost(req, { params: { id: gw.id } });
    });

    const responses = await Promise.all(requests);
    const statusCodes = responses.map(r => r.status);

    const count200 = statusCodes.filter(s => s === 200).length;
    const count409 = statusCodes.filter(s => s === 409).length;

    expect(count200).toBe(1);
    expect(count409).toBe(4);

    const successRes = responses.find(r => r.status === 200)!;
    const body = await successRes.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('SNAPSHOT_LOCKED');
    expect(body.snapshot).toBeDefined();
    expect(body.seedCommitment).toBeDefined();

    // Verify persisted seed matches returned commitment directly
    const stored = await GiveawayStore.getById(gw.id);
    expect(stored?.status).toBe('SNAPSHOT_LOCKED');
    expect(computeSeedCommitment(stored!.seed!)).toBe(body.seedCommitment);
  });

  // ─── Test 3: Idempotency Replay with same key vs new key ─────────────────────
  it('idempotency: replaying same key returns cached commitment; new key after lock returns 409', async () => {
    const gw = await createReadyGiveaway();
    const idempotencyKey = `idem-key-stable-${Date.now()}`;

    // 1. Initial lock
    const req1 = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });

    const res1 = await snapshotPost(req1, { params: { id: gw.id } });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    const initialCommitment = data1.seedCommitment;
    expect(initialCommitment).toMatch(/^[a-f0-9]{64}$/);

    // 2. Replay with identical key -> returns cached 200 with identical snapshot & commitment
    const replayReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });

    const replayRes = await snapshotPost(replayReq, { params: { id: gw.id } });
    expect(replayRes.status).toBe(200);
    const replayData = await replayRes.json();
    expect(replayData.seedCommitment).toBe(initialCommitment);
    expect(replayData.snapshot.id).toBe(data1.snapshot.id);

    // 3. New request with different key -> 409 Conflict
    const newKeyReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Idempotency-Key': `new-key-${Date.now()}`,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });

    const newKeyRes = await snapshotPost(newKeyReq, { params: { id: gw.id } });
    expect(newKeyRes.status).toBe(409);
  });

  // ─── Test 4: Commitment Stability and Provable Draw Verification ────────────
  it('commitment stability: commitment is invariant across reads and equals sha256(seedUsed) after draw', async () => {
    const gw = await createReadyGiveaway();

    // 1. Lock snapshot
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
    const snapData = await snapRes.json();
    const lockedCommitment = snapData.seedCommitment;

    // 2. Repeated GET before draw
    for (let i = 0; i < 3; i++) {
      const getReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}`, {
        method: 'GET',
        headers: { Cookie: sessionCookie },
      });
      const getRes = await giveawayDetailGet(getReq, { params: { id: gw.id } });
      const getData = await getRes.json();
      expect(getData.giveaway.seed).toBeNull(); // Masked before DRAWN
      expect(getData.giveaway.seedCommitment).toBe(lockedCommitment);
    }

    // 3. Execute draw
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

    const seedUsed = drawData.drawResult.seedUsed;
    expect(createHash('sha256').update(seedUsed).digest('hex')).toBe(lockedCommitment);

    // 4. Verify public endpoint
    const verifyReq = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}/verify`, {
      method: 'GET',
    });
    const verifyRes = await verifyGet(verifyReq, { params: { id: gw.id } });
    const verifyData = await verifyRes.json();
    expect(verifyData.verified).toBe(true);
  });
});
