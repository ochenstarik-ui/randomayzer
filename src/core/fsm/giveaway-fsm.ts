import { GiveawayStatusType } from '../types/giveaway';

export class InvalidStateTransitionError extends Error {
  constructor(from: GiveawayStatusType, to: GiveawayStatusType, reason?: string) {
    super(`Invalid state transition from "${from}" to "${to}"${reason ? `: ${reason}` : ''}`);
    this.name = 'InvalidStateTransitionError';
  }
}

const ALLOWED_TRANSITIONS: Record<GiveawayStatusType, GiveawayStatusType[]> = {
  DRAFT: ['FETCHING', 'CANCELLED'],
  FETCHING: ['READY', 'CANCELLED'],
  READY: ['SNAPSHOT_LOCKED', 'FETCHING', 'CANCELLED'],
  SNAPSHOT_LOCKED: ['DRAWN', 'READY', 'CANCELLED'],
  DRAWN: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: [],
  CANCELLED: [],
};

export class GiveawayFSM {
  /**
   * Check if a state transition is allowed
   */
  static canTransition(from: GiveawayStatusType, to: GiveawayStatusType): boolean {
    const allowed = ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Validate and assert transition, throwing InvalidStateTransitionError if illegal
   */
  static validateTransition(from: GiveawayStatusType, to: GiveawayStatusType, reason?: string): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to, reason);
    }
  }

  /**
   * Guard: Verify that giveaway is in SNAPSHOT_LOCKED status before drawing
   */
  static assertCanDraw(status: GiveawayStatusType): void {
    if (status === 'DRAWN') {
      throw new Error('Giveaway is already DRAWN. Duplicate draw is strictly forbidden.');
    }
    if (status !== 'SNAPSHOT_LOCKED') {
      throw new Error(`Cannot draw winners: status must be "SNAPSHOT_LOCKED", but got "${status}". Lock participant snapshot first.`);
    }
  }

  /**
   * Guard: Verify that participants/rules can be modified
   */
  static assertCanModifyParticipants(status: GiveawayStatusType): void {
    if (status === 'SNAPSHOT_LOCKED') {
      throw new Error('Cannot modify participants or rules while snapshot is locked. Unlock snapshot first.');
    }
    if (status === 'DRAWN' || status === 'PUBLISHED') {
      throw new Error(`Cannot modify participants in final status "${status}".`);
    }
  }
}
