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

  describe('rule combination matrix', () => {
    function makeParticipant(
      id: string,
      overrides: Partial<RawParticipant> = {}
    ): RawParticipant {
      return {
        platformUserId: id,
        firstName: 'User',
        lastName: id,
        source: 'LIKES',
        liked: false,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: false,
        isAdmin: false,
        ...overrides,
      };
    }

    it('should require like only', () => {
      const participants = [
        makeParticipant('1', { liked: true }),
        makeParticipant('2', { liked: false }),
      ];
      const rules: FilterRules = {
        requireLike: true,
        requireComment: false,
        requireRepost: false,
        requireSubscription: false,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['1']);
      expect(result.excludedParticipants[0].exclusionReason).toBe('MISSING_LIKE');
    });

    it('should require comment only', () => {
      const participants = [
        makeParticipant('1', { commented: true, commentsCount: 1 }),
        makeParticipant('2', { commented: false, commentsCount: 0 }),
      ];
      const rules: FilterRules = {
        requireLike: false,
        requireComment: true,
        requireRepost: false,
        requireSubscription: false,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['1']);
      expect(result.excludedParticipants[0].exclusionReason).toBe('MISSING_COMMENT');
    });

    it('should require subscription only', () => {
      const participants = [
        makeParticipant('1', { subscribed: true }),
        makeParticipant('2', { subscribed: false }),
      ];
      const rules: FilterRules = {
        requireLike: false,
        requireComment: false,
        requireRepost: false,
        requireSubscription: true,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['1']);
      expect(result.excludedParticipants[0].exclusionReason).toBe('NOT_SUBSCRIBED');
    });

    it('should require like + comment together', () => {
      const participants = [
        makeParticipant('1', { liked: true, commented: true, commentsCount: 1 }),
        makeParticipant('2', { liked: true, commented: false, commentsCount: 0 }),
        makeParticipant('3', { liked: false, commented: true, commentsCount: 1 }),
      ];
      const rules: FilterRules = {
        requireLike: true,
        requireComment: true,
        requireRepost: false,
        requireSubscription: false,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['1']);
      expect(result.excludedParticipants.map(p => p.exclusionReason)).toContain('MISSING_COMMENT');
      expect(result.excludedParticipants.map(p => p.exclusionReason)).toContain('MISSING_LIKE');
    });

    it('should combine admin exclusion and subscription requirement', () => {
      const participants = [
        makeParticipant('1', { liked: true, subscribed: true, isAdmin: false }),
        makeParticipant('2', { liked: true, subscribed: true, isAdmin: true }),
        makeParticipant('3', { liked: true, subscribed: false, isAdmin: false }),
      ];
      const rules: FilterRules = {
        requireLike: true,
        requireComment: false,
        requireRepost: false,
        requireSubscription: true,
        excludeAdmins: true,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['1']);
      expect(result.excludedParticipants.map(p => p.platformUserId).sort()).toEqual(['2', '3']);
      expect(result.excludedParticipants.find(p => p.platformUserId === '2')?.exclusionReason).toContain('IS_ADMIN');
      expect(result.excludedParticipants.find(p => p.platformUserId === '3')?.exclusionReason).toContain('NOT_SUBSCRIBED');
    });

    it('should combine blacklist with action requirements', () => {
      const participants = [
        makeParticipant('1', { liked: true }),
        makeParticipant('2', { liked: true }),
        makeParticipant('3', { liked: false }),
      ];
      const rules: FilterRules = {
        requireLike: true,
        requireComment: false,
        requireRepost: false,
        requireSubscription: false,
        excludeAdmins: false,
        excludeBlacklistedIds: ['2'],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['1']);
      const excluded2 = result.excludedParticipants.find(p => p.platformUserId === '2');
      expect(excluded2?.exclusionReason).toContain('BLACKLISTED');
      const excluded3 = result.excludedParticipants.find(p => p.platformUserId === '3');
      expect(excluded3?.exclusionReason).toContain('MISSING_LIKE');
    });

    it('should aggregate duplicate users with both LIKE and COMMENT into a single eligible participant', () => {
      const participants: RawParticipant[] = [
        {
          platformUserId: '10',
          firstName: 'Like',
          lastName: 'Only',
          source: 'LIKES',
          liked: true,
          commented: false,
          commentsCount: 0,
          reposted: false,
          subscribed: true,
        },
        {
          platformUserId: '10',
          firstName: 'Comment',
          lastName: 'Only',
          source: 'COMMENTS',
          liked: false,
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
      const result = applyFilterRules(participants, rules);
      expect(result.stats.total).toBe(1);
      expect(result.stats.eligibleCount).toBe(1);
      const merged = result.eligibleParticipants[0];
      expect(merged.liked).toBe(true);
      expect(merged.commented).toBe(true);
      expect(merged.commentsCount).toBe(1);
    });

    it('should exclude a user who satisfies only some of several mandatory conditions', () => {
      const participants = [
        makeParticipant('all', { liked: true, commented: true, commentsCount: 1, reposted: true, subscribed: true }),
        makeParticipant('missing-repost', { liked: true, commented: true, commentsCount: 1, reposted: false, subscribed: true }),
        makeParticipant('missing-sub', { liked: true, commented: true, commentsCount: 1, reposted: true, subscribed: false }),
      ];
      const rules: FilterRules = {
        requireLike: true,
        requireComment: true,
        requireRepost: true,
        requireSubscription: true,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['all']);
      expect(result.excludedParticipants).toHaveLength(2);
      expect(result.excludedParticipants.map(p => p.exclusionReason)).toContain('MISSING_REPOST');
      expect(result.excludedParticipants.map(p => p.exclusionReason)).toContain('NOT_SUBSCRIBED');
    });

    it('should report all reasons for exclusion when multiple conditions fail', () => {
      const participant = makeParticipant('bad', { liked: false, commented: false, subscribed: false });
      const rules: FilterRules = {
        requireLike: true,
        requireComment: true,
        requireRepost: false,
        requireSubscription: true,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules([participant], rules);
      expect(result.excludedParticipants[0].exclusionReason?.split(', ').sort()).toEqual([
        'MISSING_COMMENT',
        'MISSING_LIKE',
        'NOT_SUBSCRIBED',
      ]);
    });

    it('should handle username-based blacklist matching', () => {
      const participants = [
        makeParticipant('1', { username: 'spammer' }),
        makeParticipant('2', { username: 'gooduser' }),
      ];
      const rules: FilterRules = {
        requireLike: false,
        requireComment: false,
        requireRepost: false,
        requireSubscription: false,
        excludeAdmins: false,
        excludeBlacklistedIds: ['@Spammer'],
        excludeDuplicateComments: true,
      };
      const result = applyFilterRules(participants, rules);
      expect(result.eligibleParticipants.map(p => p.platformUserId)).toEqual(['2']);
      expect(result.excludedParticipants[0].platformUserId).toBe('1');
    });
  });
});
