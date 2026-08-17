import { createHash } from 'crypto';
import { FilteredParticipant } from '../types/participant';

/**
 * Computes a deterministic SHA-256 snapshot hash for a list of participants.
 * Participants are sorted canonically by platformUserId to guarantee identical hash
 * regardless of initial retrieval order.
 */
export function computeParticipantsSnapshotHash(participants: FilteredParticipant[]): string {
  // Canonical sort by platformUserId
  const sorted = [...participants].sort((a, b) => 
    a.platformUserId.localeCompare(b.platformUserId)
  );

  const canonicalRepresentation = sorted.map(p => ({
    id: p.platformUserId,
    name: `${p.firstName} ${p.lastName}`.trim(),
    username: p.username || '',
    actions: {
      liked: p.liked,
      commented: p.commented,
      reposted: p.reposted,
      subscribed: p.subscribed,
    }
  }));

  const jsonString = JSON.stringify(canonicalRepresentation);
  return createHash('sha256').update(jsonString, 'utf8').digest('hex');
}

/**
 * Generates a random crypto seed if not provided by user
 */
export function generateRandomSeed(): string {
  return createHash('sha256')
    .update(`${Date.now()}-${Math.random()}-${process.pid}`)
    .digest('hex')
    .slice(0, 16);
}
