import { describe, it, expect } from 'vitest';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';

describe('Payload Scalability & Pagination', () => {
  const participants: FilteredParticipant[] = Array.from({ length: 120 }, (_, i) => ({
    platformUserId: `${1000 + i}`,
    firstName: `User`,
    lastName: `${i + 1}`,
    source: 'LIKES',
    liked: true,
    commented: i % 2 === 0,
    commentsCount: i % 2 === 0 ? 1 : 0,
    reposted: false,
    subscribed: true,
    eligible: i % 3 !== 0, // 80 eligible, 40 excluded
    exclusionReason: i % 3 === 0 ? 'Not eligible' : null,
  }));

  it('listGiveawaysSummary should return lightweight objects without raw participants or snapshots arrays', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-1_100',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '100',
        sourceUrl: 'https://vk.com/wall-1_100',
        title: 'Scalability Test',
        text: 'Text',
        likesCount: 120,
        commentsCount: 60,
        repostsCount: 10,
      },
      filterRules: DEFAULT_FILTER_RULES,
    });

    await repo.saveParticipants(gw.id, participants);

    const summaries = await repo.listGiveawaysSummary();
    expect(summaries.length).toBe(1);

    const summary = summaries[0];
    expect(summary.id).toBe(gw.id);
    expect(summary.totalParticipantsCount).toBe(120);
    // Ensure raw heavy fields are not present in summary
    expect((summary as any).participants).toBeUndefined();
    expect((summary as any).snapshots).toBeUndefined();
  });

  it('getParticipantsPaginated should correctly paginate and filter tabs', async () => {
    const repo = new MemoryGiveawayRepository();
    const gw = await repo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-1_200',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '200',
        sourceUrl: 'https://vk.com/wall-1_200',
        title: 'Pagination Test',
        text: 'Text',
        likesCount: 120,
        commentsCount: 60,
        repostsCount: 10,
      },
      filterRules: DEFAULT_FILTER_RULES,
    });

    await repo.saveParticipants(gw.id, participants);

    // Page 1: 50 items
    const page1 = await repo.getParticipantsPaginated(gw.id, 1, 50, 'all');
    expect(page1.participants.length).toBe(50);
    expect(page1.totalCount).toBe(120);
    expect(page1.totalPages).toBe(3);

    // Page 3: 20 items
    const page3 = await repo.getParticipantsPaginated(gw.id, 3, 50, 'all');
    expect(page3.participants.length).toBe(20);

    // Tab 'eligible': 80 items total -> 50 on page 1, 30 on page 2
    const eligiblePage1 = await repo.getParticipantsPaginated(gw.id, 1, 50, 'eligible');
    expect(eligiblePage1.participants.length).toBe(50);
    expect(eligiblePage1.totalPages).toBe(2);
    expect(eligiblePage1.participants.every(p => p.eligible)).toBe(true);

    const eligiblePage2 = await repo.getParticipantsPaginated(gw.id, 2, 50, 'eligible');
    expect(eligiblePage2.participants.length).toBe(30);
  });
});
