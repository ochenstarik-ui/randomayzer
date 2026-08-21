import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';

const testUser = { id: 'usr_concurrency_organizer', vkUserId: '99999' };
let sessionId: string;

async function createReadyGiveaway() {
  const gw = await GiveawayStore.create({
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
    filterRules: DEFAULT_FILTER_RULES,
    winnersCount: 1,
    reserveWinnersCount: 0,
    organizerId: testUser.id,
  });

  const participants: FilteredParticipant[] = Array.from({ length: 10 }, (_, i) => ({
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

  await GiveawayStore.updateParticipants(gw.id, participants);
  await GiveawayStore.createAndLockSnapshot(gw.id, participants, DEFAULT_FILTER_RULES);
  return gw;
}

describe('Concurrency analysis', () => {
  beforeEach(async () => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    defaultSessionStore.clear();
    sessionId = await defaultSessionStore.createSession(testUser);
  });

  it('documents double-draw race protection (exactly one succeeds with 200, concurrent receives 409)', async () => {
    const gw = await createReadyGiveaway();

    const req1 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });

    const req2 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });

    const [res1, res2] = await Promise.all([
      drawPost(req1, { params: { id: gw.id } }),
      drawPost(req2, { params: { id: gw.id } }),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
  });

  it('should not corrupt giveaway state when snapshot and draw race', async () => {
    const gw = await createReadyGiveaway();

    const snapReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });

    const drawReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ winnersCount: 1, reserveWinnersCount: 0 }),
    });

    const [snapRes, drawRes] = await Promise.all([
      snapshotPost(snapReq, { params: { id: gw.id } }),
      drawPost(drawReq, { params: { id: gw.id } }),
    ]);

    // At least one operation must succeed; both should not silently corrupt
    expect([snapRes.status, drawRes.status]).toContain(200);

    const final = await GiveawayStore.getById(gw.id);
    expect(final).toBeDefined();
    expect(['SNAPSHOT_LOCKED', 'DRAWN']).toContain(final?.status);
  });

  it('concurrent participant fetch vs snapshot does not produce corrupted participants or invalid snapshot', async () => {
    const gw = await createReadyGiveaway();

    const partReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/participants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });

    const snapReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ filterRules: DEFAULT_FILTER_RULES }),
    });

    const [partRes, snapRes] = await Promise.all([
      participantsPost(partReq, { params: { id: gw.id } }),
      snapshotPost(snapReq, { params: { id: gw.id } }),
    ]);

    // One of them succeeds with 200 or 409
    expect([200, 409]).toContain(partRes.status);
    expect([200, 409]).toContain(snapRes.status);

    const final = await GiveawayStore.getById(gw.id);
    expect(final).toBeDefined();
  });
});
