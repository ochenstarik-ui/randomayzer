import { FilterRules } from '../types/giveaway';
import { RawParticipant, FilteredParticipant } from '../types/participant';

export interface FilterResult {
  allParticipants: FilteredParticipant[];
  eligibleParticipants: FilteredParticipant[];
  excludedParticipants: FilteredParticipant[];
  stats: {
    total: number;
    eligibleCount: number;
    excludedCount: number;
    reasonsBreakdown: Record<string, number>;
  };
}

/**
 * Filter Engine evaluates a list of raw participants against the configured giveaway filter rules.
 * Handles deduplication, action requirements (like, comment, repost, sub), admin exclusion, and blacklists.
 */
export function applyFilterRules(
  participants: RawParticipant[],
  rules: FilterRules
): FilterResult {
  // 1. Deduplicate participants by platformUserId (unconditional deduplication: 1 participant = 1 chance)
  const participantMap = new Map<string, RawParticipant>();

  for (const p of participants) {
    const existing = participantMap.get(p.platformUserId);
    const pComments = typeof p.commentsCount === 'number' ? p.commentsCount : (p.commented ? 1 : 0);

    if (!existing) {
      participantMap.set(p.platformUserId, {
        ...p,
        commentsCount: pComments,
      });
    } else {
      // Merge actions
      existing.liked = existing.liked || p.liked;
      existing.commented = existing.commented || p.commented;
      existing.commentsCount = (existing.commentsCount || 0) + pComments;
      existing.reposted = existing.reposted || p.reposted;
      existing.subscribed = existing.subscribed || p.subscribed;
      existing.isAdmin = existing.isAdmin || p.isAdmin;
    }
  }

  const deduplicated = Array.from(participantMap.values());
  const blacklistedSet = new Set(
    (rules.excludeBlacklistedIds || []).map(id => id.trim().toLowerCase().replace(/^@/, ''))
  );

  const allFiltered: FilteredParticipant[] = [];
  const eligibleList: FilteredParticipant[] = [];
  const excludedList: FilteredParticipant[] = [];
  const reasonsBreakdown: Record<string, number> = {};

  for (const p of deduplicated) {
    const reasons: string[] = [];

    // Check Blacklist
    const cleanId = p.platformUserId.toLowerCase();
    const cleanUsername = (p.username || '').toLowerCase();
    if (blacklistedSet.has(cleanId) || (cleanUsername && blacklistedSet.has(cleanUsername))) {
      reasons.push('BLACKLISTED');
    }

    // Check Admin Exclusion
    if (rules.excludeAdmins && p.isAdmin) {
      reasons.push('IS_ADMIN');
    }

    // Check Likes Requirement
    if (rules.requireLike && !p.liked) {
      reasons.push('MISSING_LIKE');
    }

    // Check Comments Requirement
    if (rules.requireComment && (!p.commented || p.commentsCount < 1)) {
      reasons.push('MISSING_COMMENT');
    }

    // Check Repost Requirement
    if (rules.requireRepost && !p.reposted) {
      reasons.push('MISSING_REPOST');
    }

    // Check Subscription Requirement
    if (rules.requireSubscription && !p.subscribed) {
      reasons.push('NOT_SUBSCRIBED');
    }

    const isEligible = reasons.length === 0;
    const exclusionReason = isEligible ? null : reasons.join(', ');

    const filteredItem: FilteredParticipant = {
      ...p,
      eligible: isEligible,
      exclusionReason,
    };

    allFiltered.push(filteredItem);

    if (isEligible) {
      eligibleList.push(filteredItem);
    } else {
      excludedList.push(filteredItem);
      for (const r of reasons) {
        reasonsBreakdown[r] = (reasonsBreakdown[r] || 0) + 1;
      }
    }
  }

  return {
    allParticipants: allFiltered,
    eligibleParticipants: eligibleList,
    excludedParticipants: excludedList,
    stats: {
      total: allFiltered.length,
      eligibleCount: eligibleList.length,
      excludedCount: excludedList.length,
      reasonsBreakdown,
    },
  };
}
