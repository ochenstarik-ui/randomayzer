import { randomBytes } from 'crypto';
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
