import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { ProviderRegistry } from '../src/providers/registry';
import { POST as drawPost } from '../src/app/api/giveaways/[id]/draw/route';
import { POST as participantsPost } from '../src/app/api/giveaways/[id]/participants/route';
import { POST as snapshotPost } from '../src/app/api/giveaways/[id]/snapshot/route';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';

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
  beforeEach(() => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    ProviderRegistry.useMockVk();
  });

  it('documents double-draw race protection (exactly one succeeds with 200, concurrent receives 409)', async () => {
    const gw = await createReadyGiveaway();

    const req1 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ seed: 'race-seed-1' }),
    });
    const req2 = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ seed: 'race-seed-2' }),
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

    const snapshotReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const drawReq = new NextRequest(`http://localhost/api/giveaways/${gw.id}/draw`, {
      method: 'POST',
      body: JSON.stringify({ seed: 'race-seed' }),
    });

    const [snapRes, drawRes] = await Promise.all([
      snapshotPost(snapshotReq, { params: { id: gw.id } }),
      drawPost(drawReq, { params: { id: gw.id } }),
    ]);

    // At least one operation must succeed; both should not silently corrupt.
    expect([snapRes.status, drawRes.status]).toContain(200);

    const final = await GiveawayStore.getById(gw.id);
    expect(final).not.toBeNull();
    // After any successful draw the status must be DRAWN.
    if (drawRes.status === 200) {
      expect(final?.status).toBe('DRAWN');
    }
  });

  it('should not allow participant import to overwrite a DRAWN giveaway', async () => {
    const gw = await createReadyGiveaway();
    const refreshed = await GiveawayStore.getById(gw.id);
    const eligible = refreshed!.participants.filter(p => p.eligible);
    const snapshot = refreshed!.latestSnapshot!;
    await GiveawayStore.saveDrawResult(gw.id, snapshot.id, {
      drawId: 'draw-test',
      giveawayId: gw.id,
      snapshotId: snapshot.id,
      winners: [],
      reserveWinners: [],
      winnerIds: [],
      reserveWinnerIds: [],
      totalEligibleCount: snapshot.participantCount,
      totalLoadedCount: gw.participants.length,
      seedUsed: 'seed',
      participantsSnapshotHash: snapshot.participantsSnapshotHash,
      conditionsHash: snapshot.conditionsHash,
      algorithmVersion: 'HMAC_SHA256_FY_V1',
      drawnAt: new Date().toISOString(),
      auditHash: 'audit',
    });

    const req = new NextRequest(`http://localhost/api/giveaways/${gw.id}/participants`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await participantsPost(req, { params: { id: gw.id } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
