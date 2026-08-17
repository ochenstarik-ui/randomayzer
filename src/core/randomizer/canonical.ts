import { createHash } from 'crypto';
import { FilterRules } from '../types/giveaway';
import { FilteredParticipant } from '../types/participant';

/**
 * Deterministic JSON stringifier that sorts object keys recursively.
 */
export function canonicalStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }

  const keys = Object.keys(value).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes SHA-256 hash from any string
 */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Computes deterministic conditionsHash for given filter rules
 */
export function computeConditionsHash(rules: FilterRules): string {
  const canonicalRules = {
    excludeAdmins: Boolean(rules.excludeAdmins),
    excludeBlacklistedIds: [...(rules.excludeBlacklistedIds || [])].map(s => s.trim().toLowerCase()).sort(),
    excludeDuplicateComments: Boolean(rules.excludeDuplicateComments),
    minEligibleParticipants: rules.minEligibleParticipants ?? 1,
    requireComment: Boolean(rules.requireComment),
    requireLike: Boolean(rules.requireLike),
    requireRepost: Boolean(rules.requireRepost),
    requireSubscription: Boolean(rules.requireSubscription),
    targetGroupId: rules.targetGroupId || null,
  };

  return sha256(canonicalStringify(canonicalRules));
}

/**
 * Computes deterministic snapshot hash for eligible participants.
 * Canonical sort by platformUserId ensures invariance against retrieval order.
 */
export function computeParticipantsSnapshotHash(participants: FilteredParticipant[]): string {
  const sorted = [...participants].sort((a, b) =>
    a.platformUserId.localeCompare(b.platformUserId)
  );

  const canonicalItems = sorted.map(p => ({
    actions: {
      commented: Boolean(p.commented),
      commentsCount: Number(p.commentsCount || 0),
      liked: Boolean(p.liked),
      reposted: Boolean(p.reposted),
      subscribed: Boolean(p.subscribed),
    },
    id: String(p.platformUserId),
    name: `${p.firstName} ${p.lastName}`.trim(),
    username: p.username || '',
  }));

  return sha256(canonicalStringify(canonicalItems));
}

/**
 * Computes deterministic proof hash (reproducible on replay)
 */
export function computeDeterministicProofHash(data: {
  algorithmVersion: string;
  snapshotId: string;
  participantsSnapshotHash: string;
  conditionsHash: string;
  seed: string;
  winnerIds: string[];
  reserveWinnerIds: string[];
  eligibleCount: number;
}): string {
  return sha256(canonicalStringify(data));
}

/**
 * Computes unique audit event hash (binds specific execution event metadata to the deterministic proof)
 */
export function computeAuditEventHash(data: {
  giveawayId: string;
  drawId: string;
  drawnAt: string;
  deterministicProofHash: string;
}): string {
  return sha256(canonicalStringify(data));
}
