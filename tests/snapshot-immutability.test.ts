import { describe, it, expect } from 'vitest';
import { 
  computeConditionsHash, 
  computeParticipantsSnapshotHash, 
  canonicalStringify 
} from '../src/core/randomizer/canonical';
import { FilterRules } from '../src/core/types/giveaway';
import { FilteredParticipant } from '../src/core/types/participant';

describe('Snapshot Immutability & Canonical Hashing', () => {
  const baseRules: FilterRules = {
    requireLike: true,
    requireComment: false,
    requireRepost: false,
    requireSubscription: true,
    excludeAdmins: true,
    excludeBlacklistedIds: ['100', '200'],
    excludeDuplicateComments: true,
    minEligibleParticipants: 1,
  };

  const sampleParticipants: FilteredParticipant[] = [
    {
      platformUserId: '101',
      firstName: 'Иван',
      lastName: 'Иванов',
      username: 'ivanov',
      source: 'LIKES',
      liked: true,
      commented: true,
      commentsCount: 1,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    },
    {
      platformUserId: '102',
      firstName: 'Анна',
      lastName: 'Смирнова',
      username: 'anna_s',
      source: 'LIKES',
      liked: true,
      commented: false,
      commentsCount: 0,
      reposted: false,
      subscribed: true,
      eligible: true,
      exclusionReason: null,
    },
  ];

  it('should generate identical conditionsHash regardless of key order in rules object', () => {
    const rulesA = { ...baseRules };
    const rulesB: FilterRules = {
      minEligibleParticipants: 1,
      excludeDuplicateComments: true,
      excludeBlacklistedIds: ['200', '100'], // reversed array
      excludeAdmins: true,
      requireSubscription: true,
      requireRepost: false,
      requireComment: false,
      requireLike: true,
    };

    const hashA = computeConditionsHash(rulesA);
    const hashB = computeConditionsHash(rulesB);

    expect(hashA).toBe(hashB);
  });

  it('should change conditionsHash when any rule changes', () => {
    const originalHash = computeConditionsHash(baseRules);

    const changedLike = computeConditionsHash({ ...baseRules, requireLike: false });
    const changedComment = computeConditionsHash({ ...baseRules, requireComment: true });
    const changedBlacklist = computeConditionsHash({ ...baseRules, excludeBlacklistedIds: ['300'] });

    expect(changedLike).not.toBe(originalHash);
    expect(changedComment).not.toBe(originalHash);
    expect(changedBlacklist).not.toBe(originalHash);
  });

  it('should generate invariant snapshot hash regardless of participant list ordering', () => {
    const p1 = [...sampleParticipants];
    const p2 = [...sampleParticipants].reverse();

    const hash1 = computeParticipantsSnapshotHash(p1);
    const hash2 = computeParticipantsSnapshotHash(p2);

    expect(hash1).toBe(hash2);
  });

  it('should change snapshot hash when participant attributes or actions change', () => {
    const originalHash = computeParticipantsSnapshotHash(sampleParticipants);

    const modifiedParticipants: FilteredParticipant[] = [
      {
        ...sampleParticipants[0],
        firstName: 'Иван Измененный',
      },
      sampleParticipants[1],
    ];

    const newHash = computeParticipantsSnapshotHash(modifiedParticipants);
    expect(newHash).not.toBe(originalHash);
  });

  it('should produce valid canonical string for deep objects', () => {
    const obj1 = { z: 1, a: { y: 2, b: 3 } };
    const obj2 = { a: { b: 3, y: 2 }, z: 1 };

    expect(canonicalStringify(obj1)).toBe(canonicalStringify(obj2));
    expect(canonicalStringify(obj1)).toBe('{"a":{"b":3,"y":2},"z":1}');
  });
});
