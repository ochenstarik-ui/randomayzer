import { describe, it, expect } from 'vitest';
import { applyFilterRules } from '../src/core/filtering/filter-engine';
import { RawParticipant } from '../src/core/types/participant';
import { FilterRules } from '../src/core/types/giveaway';

describe('Filter Engine', () => {
  const sampleParticipants: RawParticipant[] = [
    {
      platformUserId: '1',
      firstName: 'Иван',
      lastName: 'Иванов',
      source: 'LIKES',
      liked: true,
      commented: true,
      commentsCount: 1,
      reposted: true,
      subscribed: true,
      isAdmin: false,
    },
    {
      platformUserId: '2',
      firstName: 'Петр',
      lastName: 'Петров',
      source: 'LIKES',
      liked: false,
      commented: true,
      commentsCount: 1,
      reposted: true,
      subscribed: true,
      isAdmin: false,
    },
    {
      platformUserId: '3',
      firstName: 'Анна',
      lastName: 'Сидорова',
      source: 'COMMENTS',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: true,
      subscribed: true,
      isAdmin: false,
    },
    {
      platformUserId: '4',
      firstName: 'Админ',
      lastName: 'Группы',
      source: 'LIKES',
      liked: true,
      commented: true,
      commentsCount: 1,
      reposted: true,
      subscribed: true,
      isAdmin: true,
    },
    {
      platformUserId: '5',
      firstName: 'Не',
      lastName: 'Подписан',
      source: 'LIKES',
      liked: true,
      commented: true,
      commentsCount: 1,
      reposted: true,
      subscribed: false,
      isAdmin: false,
    },
  ];

  it('should filter by like requirement correctly', () => {
    const rules: FilterRules = {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };

    const result = applyFilterRules(sampleParticipants, rules);
    expect(result.stats.eligibleCount).toBe(4);
    expect(result.stats.excludedCount).toBe(1);
    expect(result.excludedParticipants[0].platformUserId).toBe('2');
    expect(result.excludedParticipants[0].exclusionReason).toBe('MISSING_LIKE');
  });

  it('should filter by comment and subscription requirements', () => {
    const rules: FilterRules = {
      requireLike: true,
      requireComment: true,
      requireRepost: false,
      requireSubscription: true,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };

    const result = applyFilterRules(sampleParticipants, rules);
    // 1: passed
    // 2: missing like
    // 3: missing comment
    // 4: passed (admin allowed here)
    // 5: not subscribed
    expect(result.stats.eligibleCount).toBe(2);
    const eligibleIds = result.eligibleParticipants.map(p => p.platformUserId);
    expect(eligibleIds).toEqual(['1', '4']);
  });

  it('should exclude administrators when excludeAdmins is true', () => {
    const rules: FilterRules = {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: true,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };

    const result = applyFilterRules(sampleParticipants, rules);
    const adminParticipant = result.allParticipants.find(p => p.platformUserId === '4');
    expect(adminParticipant?.eligible).toBe(false);
    expect(adminParticipant?.exclusionReason).toContain('IS_ADMIN');
  });

  it('should exclude blacklisted user IDs and usernames', () => {
    const rules: FilterRules = {
      requireLike: false,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: ['1', '5'],
      excludeDuplicateComments: true,
    };

    const result = applyFilterRules(sampleParticipants, rules);
    const blacklisted = result.excludedParticipants.map(p => p.platformUserId);
    expect(blacklisted).toContain('1');
    expect(blacklisted).toContain('5');
    expect(result.stats.reasonsBreakdown['BLACKLISTED']).toBe(2);
  });

  it('should deduplicate multiple raw comments from the same user into single participant', () => {
    const multiComments: RawParticipant[] = [
      {
        platformUserId: '100',
        firstName: 'Спамер',
        lastName: 'Обыкновенный',
        source: 'COMMENTS',
        liked: true,
        commented: true,
        commentsCount: 1,
        reposted: false,
        subscribed: true,
      },
      {
        platformUserId: '100',
        firstName: 'Спамер',
        lastName: 'Обыкновенный',
        source: 'COMMENTS',
        liked: true,
        commented: true,
        commentsCount: 1,
        reposted: false,
        subscribed: true,
      },
      {
        platformUserId: '100',
        firstName: 'Спамер',
        lastName: 'Обыкновенный',
        source: 'COMMENTS',
        liked: true,
        commented: true,
        commentsCount: 1,
        reposted: false,
        subscribed: true,
      },
    ];

    const rules: FilterRules = {
      requireLike: true,
      requireComment: true,
      requireRepost: false,
      requireSubscription: true,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
    };

    const result = applyFilterRules(multiComments, rules);
    expect(result.stats.total).toBe(1);
    expect(result.stats.eligibleCount).toBe(1);
    expect(result.allParticipants[0].commentsCount).toBe(3);
  });
});
