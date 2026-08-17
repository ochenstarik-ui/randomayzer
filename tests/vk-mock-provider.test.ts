import { describe, it, expect, beforeEach } from 'vitest';
import { VkMockProvider } from '../src/providers/vk/vk-mock-provider';
import { RawParticipant } from '../src/core/types/participant';

describe('VkMockProvider scenarios', () => {
  let provider: VkMockProvider;

  beforeEach(() => {
    provider = new VkMockProvider();
  });

  it('default scenario returns 35 participants', async () => {
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants).toHaveLength(35);
    expect(participants[0]).toHaveProperty('platformUserId');
    expect(participants[0]).toHaveProperty('liked');
  });

  it('supports 0 participants', async () => {
    provider.setScenario({ participantCount: 0 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants).toHaveLength(0);
  });

  it('supports 1 participant', async () => {
    provider.setScenario({ participantCount: 1 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants).toHaveLength(1);
    expect(participants[0].platformUserId).toBeDefined();
  });

  it('supports 10 participants', async () => {
    provider.setScenario({ participantCount: 10 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants).toHaveLength(10);
  });

  it('supports 1000 participants', async () => {
    provider.setScenario({ participantCount: 1000 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants).toHaveLength(1000);
    // IDs must be unique before deduplication
    const ids = new Set(participants.map(p => p.platformUserId));
    expect(ids.size).toBe(1000);
  });

  it('supports large participant counts efficiently', async () => {
    provider.setScenario({ participantCount: 50000 });
    const start = Date.now();
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    const duration = Date.now() - start;
    expect(participants).toHaveLength(50000);
    expect(duration).toBeLessThan(5000);
  });

  it('supports likes-only scenario', async () => {
    provider.setScenario({ participantCount: 20, likedRatio: 1, commentedRatio: 0 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants.every(p => p.liked)).toBe(true);
    expect(participants.every(p => !p.commented)).toBe(true);
  });

  it('supports comments-only scenario', async () => {
    provider.setScenario({ participantCount: 20, likedRatio: 0, commentedRatio: 1 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants.every(p => !p.liked)).toBe(true);
    expect(participants.every(p => p.commented)).toBe(true);
  });

  it('supports mixed likes + comments scenario', async () => {
    provider.setScenario({ participantCount: 100, likedRatio: 0.7, commentedRatio: 0.4 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    const likedCount = participants.filter(p => p.liked).length;
    const commentedCount = participants.filter(p => p.commented).length;
    expect(likedCount).toBeGreaterThan(50);
    expect(likedCount).toBeLessThan(90);
    expect(commentedCount).toBeGreaterThan(20);
    expect(commentedCount).toBeLessThan(60);
  });

  it('checkSubscription returns subscribed / not subscribed deterministically', async () => {
    provider.setScenario({ participantCount: 10, subscribedRatio: 0.5 });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    const ids = participants.map(p => p.platformUserId);
    const map = await provider.checkSubscription(ids, '-100');
    let subscribedCount = 0;
    ids.forEach(id => {
      if (map.get(id)) subscribedCount++;
    });
    expect(subscribedCount).toBeGreaterThan(0);
    expect(subscribedCount).toBeLessThan(10);
  });

  it('legacy checkSubscription marks users ending in 0 or 5 as not subscribed', async () => {
    provider.resetScenario();
    // Generated IDs are 1000000 + i*137. i=5 -> 1000685 (ends 5), i=10 -> 1001370 (ends 0).
    const map = await provider.checkSubscription(
      ['1000137', '1000685', '1001370', '1000411'],
      '-100'
    );
    expect(map.get('1000685')).toBe(false); // ends with 5
    expect(map.get('1001370')).toBe(false); // ends with 0
    expect(map.get('1000137')).toBe(true); // ends with 7
    expect(map.get('1000411')).toBe(true); // ends with 1
  });

  it('allows injecting duplicates via extraParticipants', async () => {
    provider.setScenario({
      participantCount: 2,
      extraParticipants: [
        {
          platformUserId: '1000137',
          firstName: 'Duplicate',
          lastName: 'Entry',
          source: 'COMMENTS',
          liked: false,
          commented: true,
          commentsCount: 1,
          reposted: false,
          subscribed: true,
        },
      ],
    });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    expect(participants).toHaveLength(3);
    const dupes = participants.filter(p => p.platformUserId === '1000137');
    expect(dupes).toHaveLength(2);
  });

  it('marks configured adminIds as admins', async () => {
    provider.setScenario({ participantCount: 5, adminIds: ['1000137', '1000411'] });
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
    });
    const admin1 = participants.find(p => p.platformUserId === '1000137');
    const admin2 = participants.find(p => p.platformUserId === '1000411');
    const nonAdmin = participants.find(p => p.platformUserId === '1000274');
    expect(admin1?.isAdmin).toBe(true);
    expect(admin2?.isAdmin).toBe(true);
    expect(nonAdmin?.isAdmin).toBe(false);
  });

  it('fetchPost returns metadata with parsed ownerId and postId', async () => {
    const post = await provider.fetchPost('https://vk.com/wall-123456_789');
    expect(post.platform).toBe('VK');
    expect(post.ownerId).toBe('-123456');
    expect(post.postId).toBe('789');
    expect(post.likesCount).toBeGreaterThan(0);
  });

  it('fetchPost falls back to default ids for unparsable url', async () => {
    const post = await provider.fetchPost('not-a-url');
    expect(post.ownerId).toBe('-22446688');
    expect(post.postId).toBe('1054');
  });
});
