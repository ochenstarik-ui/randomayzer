import { createHash, randomBytes } from 'crypto';
import { FilteredParticipant } from '../types/participant';
import { 
  computeParticipantsSnapshotHash, 
  computeConditionsHash, 
  computeDeterministicProofHash,
  computeAuditEventHash 
} from './canonical';

export { 
  computeParticipantsSnapshotHash, 
  computeConditionsHash, 
  computeDeterministicProofHash,
  computeAuditEventHash 
};

/**
 * Generates a cryptographically secure random seed (128-bit / 32 hex chars) using CSPRNG.
 * Math.random() is strictly forbidden in security-sensitive giveaway workflows.
 */
export function generateCryptoSecureSeed(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Computes a cryptographic commitment (SHA-256 hex digest) of a seed.
 * Exposed before draw execution to bind the seed without revealing its plaintext.
 */
export function computeSeedCommitment(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}
