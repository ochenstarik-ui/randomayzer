import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';
import { NextRequest } from 'next/server';
import { GET as giveawaysGet } from '../src/app/api/giveaways/route';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { GiveawayStore } from '../src/lib/giveaway-store';

describe('Task 09: Summary Count Parity (listGiveawaysSummary)', () => {
  let memoryRepo: MemoryGiveawayRepository;
  const organizerUser = { id: 'usr_summary_parity_org', vkUserId: '777888' };
  let sessionCookie: string;

  beforeEach(async () => {
    memoryRepo = new MemoryGiveawayRepository();
    GiveawayStore.setRepository(memoryRepo);
    defaultSessionStore.clear();

    const sessionId = await defaultSessionStore.createSession(organizerUser);
    sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;
  });

  const mixedParticipants: FilteredParticipant[] = Array.from({ length: 12 }, (_, i) => ({
    platformUserId: `${2000 + i}`,
    firstName: `User${i}`,
    lastName: `Test${i}`,
    source: 'LIKES' as const,
    liked: true,
    commented: false,
    commentsCount: 0,
    reposted: false,
    subscribed: true,
    eligible: i < 8, // 8 eligible, 4 excluded
    exclusionReason: i >= 8 ? 'BLACKLISTED' : null,
  }));

  const zeroEligibleParticipants: FilteredParticipant[] = Array.from({ length: 5 }, (_, i) => ({
    platformUserId: `${3000 + i}`,
    firstName: `User${i}`,
    lastName: `Excluded${i}`,
    source: 'LIKES' as const,
    liked: false,
    commented: false,
    commentsCount: 0,
    reposted: false,
    subscribed: false,
    eligible: false,
    exclusionReason: 'MISSING_LIKE',
  }));

  // ─── 1. Memory repository: Undrawn giveaway with eligible participants ────────
  it('memory driver returns correct eligibleCount for undrawn giveaway', async () => {
    const gw = await memoryRepo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-10_1',
      post: {
        platform: 'VK',
        ownerId: '-10',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-10_1',
        title: 'Undrawn Test',
        text: 'Undrawn giveaway',
        likesCount: 12,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await memoryRepo.saveParticipants(gw.id, mixedParticipants);

    const summaries = await memoryRepo.listGiveawaysSummary(organizerUser.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalParticipantsCount).toBe(12);
    expect(summaries[0].eligibleParticipantsCount).toBe(8);
    expect(summaries[0].hasDrawResult).toBe(false);
    expect(summaries[0].algorithmVersion).toBeNull();
  });

  // ─── 2. Memory repository: Undrawn giveaway with 0 eligible participants ──────
  it('memory driver returns 0 eligibleCount when all participants are excluded', async () => {
    const gw = await memoryRepo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-10_2',
      post: {
        platform: 'VK',
        ownerId: '-10',
        postId: '2',
        sourceUrl: 'https://vk.com/wall-10_2',
        title: 'Zero Eligible Test',
        text: 'Zero eligible giveaway',
        likesCount: 5,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await memoryRepo.saveParticipants(gw.id, zeroEligibleParticipants);

    const summaries = await memoryRepo.listGiveawaysSummary(organizerUser.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalParticipantsCount).toBe(5);
    expect(summaries[0].eligibleParticipantsCount).toBe(0);
    expect(summaries[0].hasDrawResult).toBe(false);
  });

  // ─── 3. Memory repository: Drawn giveaway uses totalEligibleCount from drawResult
  it('memory driver uses totalEligibleCount from drawResult after draw', async () => {
    const gw = await memoryRepo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-10_3',
      post: {
        platform: 'VK',
        ownerId: '-10',
        postId: '3',
        sourceUrl: 'https://vk.com/wall-10_3',
        title: 'Drawn Test',
        text: 'Drawn giveaway',
        likesCount: 12,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await memoryRepo.saveParticipants(gw.id, mixedParticipants);
    const locked = await memoryRepo.createAndLockSnapshot(gw.id, mixedParticipants.filter(p => p.eligible), DEFAULT_FILTER_RULES);

    await memoryRepo.saveDrawResultAndAudit(gw.id, locked.snapshot.id, {
      drawId: 'draw_summary_test_1',
      giveawayId: gw.id,
      snapshotId: locked.snapshot.id,
      winners: [{ position: 1, participant: locked.snapshot.eligibleParticipants[0], isReserve: false, selectionIndex: 0, proofHash: 'h' }],
      reserveWinners: [],
      winnerIds: [locked.snapshot.eligibleParticipants[0].platformUserId],
      reserveWinnerIds: [],
      totalEligibleCount: 8,
      totalLoadedCount: 12,
      seedUsed: 'seed123',
      algorithmVersion: 'HMAC_SHA256_FY_V1',
      deterministicProofHash: 'a'.repeat(64),
      auditEventHash: 'b'.repeat(64),
      drawnAt: new Date().toISOString(),
      participantsSnapshotHash: locked.snapshot.participantsSnapshotHash,
      conditionsHash: locked.snapshot.conditionsHash,
    });

    const summaries = await memoryRepo.listGiveawaysSummary(organizerUser.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalParticipantsCount).toBe(12);
    expect(summaries[0].eligibleParticipantsCount).toBe(8);
    expect(summaries[0].hasDrawResult).toBe(true);
    expect(summaries[0].algorithmVersion).toBe('HMAC_SHA256_FY_V1');
  });

  // ─── 4. API Route: GET /api/giveaways returns lightweight summaries without arrays
  it('GET /api/giveaways returns summaries with exact counts and no participant arrays or seeds', async () => {
    const gw = await memoryRepo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-10_4',
      post: {
        platform: 'VK',
        ownerId: '-10',
        postId: '4',
        sourceUrl: 'https://vk.com/wall-10_4',
        title: 'API Summary Test',
        text: 'API test',
        likesCount: 12,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: organizerUser.id,
    });

    await memoryRepo.saveParticipants(gw.id, mixedParticipants);

    const req = new NextRequest('http://localhost:3000/api/giveaways', {
      headers: { Cookie: sessionCookie },
    });

    const res = await giveawaysGet(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.giveaways).toHaveLength(1);

    const summary = data.giveaways[0];
    expect(summary.id).toBe(gw.id);
    expect(summary.totalParticipantsCount).toBe(12);
    expect(summary.eligibleParticipantsCount).toBe(8);

    // Verify lightweight payload: no participant arrays or seeds
    expect(summary.participants).toBeUndefined();
    expect(summary.eligibleParticipants).toBeUndefined();
    expect(summary.seed).toBeUndefined();
  });
});
