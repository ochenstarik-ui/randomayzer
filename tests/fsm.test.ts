import { describe, it, expect } from 'vitest';
import { GiveawayFSM, InvalidStateTransitionError } from '../src/core/fsm/giveaway-fsm';

describe('Giveaway Lifecycle State Machine (FSM)', () => {
  it('should allow valid happy path state transitions', () => {
    expect(GiveawayFSM.canTransition('DRAFT', 'FETCHING')).toBe(true);
    expect(GiveawayFSM.canTransition('FETCHING', 'READY')).toBe(true);
    expect(GiveawayFSM.canTransition('READY', 'SNAPSHOT_LOCKED')).toBe(true);
    expect(GiveawayFSM.canTransition('SNAPSHOT_LOCKED', 'DRAWN')).toBe(true);
    expect(GiveawayFSM.canTransition('DRAWN', 'PUBLISHED')).toBe(true);
  });

  it('should allow unlocking snapshot back to READY or re-fetching', () => {
    expect(GiveawayFSM.canTransition('SNAPSHOT_LOCKED', 'READY')).toBe(true);
    expect(GiveawayFSM.canTransition('READY', 'FETCHING')).toBe(true);
  });

  it('should forbid illegal transitions', () => {
    expect(GiveawayFSM.canTransition('DRAFT', 'DRAWN')).toBe(false);
    expect(GiveawayFSM.canTransition('READY', 'DRAWN')).toBe(false);
    expect(GiveawayFSM.canTransition('DRAWN', 'DRAFT')).toBe(false);
    expect(GiveawayFSM.canTransition('DRAWN', 'READY')).toBe(false);
    expect(GiveawayFSM.canTransition('PUBLISHED', 'DRAFT')).toBe(false);
  });

  it('should throw InvalidStateTransitionError on illegal validateTransition', () => {
    expect(() => {
      GiveawayFSM.validateTransition('DRAFT', 'DRAWN');
    }).toThrow(InvalidStateTransitionError);
  });

  it('should strictly forbid drawing when status is not SNAPSHOT_LOCKED', () => {
    expect(() => GiveawayFSM.assertCanDraw('DRAFT')).toThrow(/must be "SNAPSHOT_LOCKED"/);
    expect(() => GiveawayFSM.assertCanDraw('FETCHING')).toThrow(/must be "SNAPSHOT_LOCKED"/);
    expect(() => GiveawayFSM.assertCanDraw('READY')).toThrow(/must be "SNAPSHOT_LOCKED"/);
  });

  it('should strictly forbid second draw when status is DRAWN', () => {
    expect(() => GiveawayFSM.assertCanDraw('DRAWN')).toThrow(/Duplicate draw is strictly forbidden/);
  });

  it('should forbid modifying participants when snapshot is locked or drawn', () => {
    expect(() => GiveawayFSM.assertCanModifyParticipants('SNAPSHOT_LOCKED')).toThrow(/while snapshot is locked/);
    expect(() => GiveawayFSM.assertCanModifyParticipants('DRAWN')).toThrow(/final status "DRAWN"/);
    expect(() => GiveawayFSM.assertCanModifyParticipants('PUBLISHED')).toThrow(/final status "PUBLISHED"/);
  });
});
