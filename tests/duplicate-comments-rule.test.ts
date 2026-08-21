import { describe, it, expect } from 'vitest';
import { applyFilterRules } from '../src/core/filtering/filter-engine';
import { RawParticipant } from '../src/core/types/participant';
import { FilterRules, DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';
import { computeConditionsHash } from '../src/core/randomizer/canonical';
import { verifyDrawResult, executeDeterministicDrawV1 } from '../src/core/randomizer/deterministic';
import { computeParticipantsSnapshotHash } from '../src/core/randomizer/canonical';

describe('Task 07: Duplicate Comments Rule & Backward Compatibility', () => {
  // ─── 1. commentsCount merging accuracy (Fix || 1 bug) ─────────────────────────
  it('duplicate participant entry with commentsCount: 0 does not artificially increment commentsCount', () => {
    const rawEntries: RawParticipant[] = [
      {
        platformUserId: 'user_like_only',
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
        platformUserId: 'user_like_only',
        firstName: 'Like',
        lastName: 'Only',
        source: 'LIKES',
        liked: true,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: true,
      },
    ];

    const result = applyFilterRules(rawEntries, DEFAULT_FILTER_RULES);
    expect(result.allParticipants).toHaveLength(1);
    expect(result.allParticipants[0].commentsCount).toBe(0);
  });

  it('merging like entry (0 comments) and comment entry (1 comment) accurately sums commentsCount to 1', () => {
    const rawEntries: RawParticipant[] = [
      {
        platformUserId: 'user_mixed',
        firstName: 'Mixed',
        lastName: 'User',
        source: 'LIKES',
        liked: true,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: true,
      },
      {
        platformUserId: 'user_mixed',
        firstName: 'Mixed',
        lastName: 'User',
        source: 'COMMENTS',
        liked: false,
        commented: true,
        commentsCount: 1,
        reposted: false,
        subscribed: true,
      },
    ];

    const result = applyFilterRules(rawEntries, DEFAULT_FILTER_RULES);
    expect(result.allParticipants).toHaveLength(1);
    expect(result.allParticipants[0].liked).toBe(true);
    expect(result.allParticipants[0].commented).toBe(true);
    expect(result.allParticipants[0].commentsCount).toBe(1);
  });

  // ─── 2. Unconditional deduplication (1 user = 1 chance) ──────────────────────
  it('unconditionally deduplicates participants so 1 user gets 1 chance regardless of comment volume', () => {
    const rawEntries: RawParticipant[] = Array.from({ length: 10 }, (_, i) => ({
      platformUserId: 'spammer_100',
      firstName: 'Spammer',
      lastName: 'User',
      source: 'COMMENTS',
      liked: true,
      commented: true,
      commentsCount: 1,
      reposted: false,
      subscribed: true,
    }));

    const result = applyFilterRules(rawEntries, {
      ...DEFAULT_FILTER_RULES,
      requireComment: true,
    });

    expect(result.allParticipants).toHaveLength(1);
    expect(result.eligibleParticipants).toHaveLength(1);
    expect(result.allParticipants[0].commentsCount).toBe(10);
    expect(result.allParticipants[0].eligible).toBe(true);
  });

  // ─── 3. Legacy snapshot verification compatibility ────────────────────────────
  it('legacy snapshot with excludeDuplicateComments: true retains verified: true in verifyDrawResult', () => {
    // 1. Simulate legacy filterRulesSnapshot with excludeDuplicateComments field
    const legacyFilterRules = {
      requireLike: true,
      requireComment: false,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: [],
      excludeDuplicateComments: true,
      minEligibleParticipants: 1,
    };

    const conditionsHash = computeConditionsHash(legacyFilterRules);

    const eligibleParticipants = [
      {
        platformUserId: '101',
        firstName: 'Alice',
        lastName: 'A',
        source: 'LIKES' as const,
        liked: true,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: true,
        eligible: true,
        exclusionReason: null,
      },
      {
        platformUserId: '102',
        firstName: 'Bob',
        lastName: 'B',
        source: 'LIKES' as const,
        liked: true,
        commented: false,
        commentsCount: 0,
        reposted: false,
        subscribed: true,
        eligible: true,
        exclusionReason: null,
      },
    ];

    const participantsSnapshotHash = computeParticipantsSnapshotHash(eligibleParticipants);

    const legacySnapshot = {
      id: 'snap_legacy_001',
      giveawayId: 'gw_legacy_001',
      version: 1,
      createdAt: '2026-08-15T12:00:00.000Z',
      eligibleParticipants,
      filterRulesSnapshot: legacyFilterRules,
      participantCount: 2,
      participantsSnapshotHash,
      conditionsHash,
    };

    const seed = 'legacy_test_seed_1234567890abcdef1234567890abcdef';

    // Execute draw with legacy snapshot
    const drawResult = executeDeterministicDrawV1({
      giveawayId: 'gw_legacy_001',
      snapshot: legacySnapshot,
      totalLoadedCount: 2,
      winnersCount: 1,
      reserveWinnersCount: 0,
      seed,
    });

    // Independent verifyDrawResult replay
    const verification = verifyDrawResult({
      giveawayId: 'gw_legacy_001',
      drawId: drawResult.drawId,
      drawnAt: drawResult.drawnAt,
      snapshot: legacySnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 0,
      claimedWinnerIds: drawResult.winnerIds,
      claimedReserveWinnerIds: drawResult.reserveWinnerIds,
      claimedDeterministicProofHash: drawResult.deterministicProofHash,
      claimedAuditEventHash: drawResult.auditEventHash,
      algorithmVersion: drawResult.algorithmVersion,
    });

    expect(verification.conditionsIntegrity).toBe(true);
    expect(verification.participantsSnapshotIntegrity).toBe(true);
    expect(verification.verified).toBe(true);
  });

  // ─── 4. New snapshot verification compatibility ───────────────────────────────
  it('new snapshot without excludeDuplicateComments computes clean hash and verifies successfully', () => {
    const newFilterRules: FilterRules = {
      requireLike: true,
      requireComment: true,
      requireRepost: false,
      requireSubscription: false,
      excludeAdmins: false,
      excludeBlacklistedIds: ['999'],
      minEligibleParticipants: 1,
    };

    const conditionsHash = computeConditionsHash(newFilterRules);

    const eligibleParticipants = [
      {
        platformUserId: '201',
        firstName: 'Charlie',
        lastName: 'C',
        source: 'COMMENTS' as const,
        liked: true,
        commented: true,
        commentsCount: 2,
        reposted: false,
        subscribed: true,
        eligible: true,
        exclusionReason: null,
      },
    ];

    const participantsSnapshotHash = computeParticipantsSnapshotHash(eligibleParticipants);

    const newSnapshot = {
      id: 'snap_new_001',
      giveawayId: 'gw_new_001',
      version: 1,
      createdAt: '2026-08-21T12:00:00.000Z',
      eligibleParticipants,
      filterRulesSnapshot: newFilterRules,
      participantCount: 1,
      participantsSnapshotHash,
      conditionsHash,
    };

    const seed = 'new_test_seed_1234567890abcdef1234567890abcdef';

    const drawResult = executeDeterministicDrawV1({
      giveawayId: 'gw_new_001',
      snapshot: newSnapshot,
      totalLoadedCount: 1,
      winnersCount: 1,
      reserveWinnersCount: 0,
      seed,
    });

    const verification = verifyDrawResult({
      giveawayId: 'gw_new_001',
      drawId: drawResult.drawId,
      drawnAt: drawResult.drawnAt,
      snapshot: newSnapshot,
      seed,
      claimedWinnersCount: 1,
      claimedReserveCount: 0,
      claimedWinnerIds: drawResult.winnerIds,
      claimedReserveWinnerIds: drawResult.reserveWinnerIds,
      claimedDeterministicProofHash: drawResult.deterministicProofHash,
      claimedAuditEventHash: drawResult.auditEventHash,
      algorithmVersion: drawResult.algorithmVersion,
    });

    expect(verification.conditionsIntegrity).toBe(true);
    expect(verification.verified).toBe(true);
  });

  // ─── 5. API Schemas Reject excludeDuplicateComments on Input ──────────────────
  it('API schemas strictly reject excludeDuplicateComments preventing it from reaching snapshot', async () => {
    const { filterRulesSchema, fetchParticipantsSchema, createSnapshotSchema, createGiveawaySchema } = await import(
      '../src/core/validation/giveaway-schemas'
    );

    // 1. filterRulesSchema is strict and rejects the key
    const parseResult = filterRulesSchema.safeParse({
      requireLike: true,
      excludeDuplicateComments: true,
    });
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(parseResult.error.issues.some(i => i.message.includes('unrecognized_keys') || (i as any).keys?.includes('excludeDuplicateComments'))).toBe(true);
    }

    // 2. fetchParticipantsSchema rejects
    const fetchResult = fetchParticipantsSchema.safeParse({
      filterRules: {
        requireLike: true,
        excludeDuplicateComments: true,
      },
    });
    expect(fetchResult.success).toBe(false);

    // 3. createSnapshotSchema rejects
    const snapResult = createSnapshotSchema.safeParse({
      filterRules: {
        requireLike: true,
        excludeDuplicateComments: true,
      },
    });
    expect(snapResult.success).toBe(false);

    // 4. createGiveawaySchema rejects
    const createResult = createGiveawaySchema.safeParse({
      sourceUrl: 'https://vk.com/wall-1_1',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-1_1',
        title: 'Test',
        text: 'Test',
        likesCount: 1,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: {
        requireLike: true,
        excludeDuplicateComments: true,
      },
    });
    expect(createResult.success).toBe(false);
  });
});
