import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { generateCryptoSecureSeed } from '@/core/randomizer/hasher';
import { executeDeterministicDrawV1 } from '@/core/randomizer/deterministic';
import { executeDrawSchema } from '@/core/validation/giveaway-schemas';
import { 
  handleApiError, 
  ConflictError, 
  ValidationError, 
  DrawAlreadyCompletedError 
} from '@/core/errors/http-errors';
import { expensiveApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await params;

    // 1. Enforce giveaway ownership authorization (extracts trusted sessionUser)
    const { giveaway, sessionUser } = await requireGiveawayOwner(req, id);

    // 2. User-scoped rate limiter: isolates organizer quota
    expensiveApiRateLimiter.assertAllowed(`draw-execute:${sessionUser.id}:${id}`);

    // 1. Strict Terminal State Guard: If already DRAWN or PUBLISHED, return 409 DRAW_ALREADY_COMPLETED
    if (giveaway.status === 'DRAWN' || giveaway.status === 'PUBLISHED') {
      throw new DrawAlreadyCompletedError(
        `Giveaway "${id}" has already been drawn and finalized. Repeat draws are not permitted.`,
        { giveawayId: id, status: giveaway.status, drawnAt: giveaway.drawnAt }
      );
    }

    if (giveaway.status !== 'SNAPSHOT_LOCKED') {
      throw new ConflictError(
        `Cannot execute draw: giveaway status is "${giveaway.status}", but draw requires "SNAPSHOT_LOCKED"`
      );
    }

    // 2. Strict Snapshot requirement
    const snapshot = giveaway.latestSnapshot;
    if (!snapshot) {
      throw new ConflictError(
        'Cannot execute draw: no locked participant snapshot exists. Lock a snapshot before drawing.'
      );
    }

    const rawBody = await req.json().catch(() => ({}));
    const validated = executeDrawSchema.parse(rawBody);

    const winnersCount = validated.winnersCount;
    const reserveWinnersCount = validated.reserveWinnersCount;
    const totalRequired = winnersCount + reserveWinnersCount;

    // 3. Strict Winner Count Contract: Never under-deliver winners
    if (totalRequired > snapshot.participantCount) {
      throw new ValidationError(
        `Requested ${winnersCount} winners and ${reserveWinnersCount} reserve winners (${totalRequired} total) exceeds eligible participants count (${snapshot.participantCount})`,
        { winnersCount, reserveWinnersCount, eligibleCount: snapshot.participantCount }
      );
    }

    // 4. Strict Seed Pre-Commit Guard: Read seed strictly from locked database state
    if (!giveaway.seed) {
      throw new ConflictError(
        'Cannot execute draw: no pre-committed seed is locked for this giveaway. Lock a snapshot before drawing.'
      );
    }

    const seed = giveaway.seed;

    // 5. Execute Provably Fair Fisher-Yates Draw V1
    const drawResult = executeDeterministicDrawV1({
      giveawayId: id,
      snapshot,
      totalLoadedCount: giveaway.participants.length,
      winnersCount,
      reserveWinnersCount,
      seed,
      filterRules: giveaway.filterRules,
    });

    // 6. Save DrawResult & AuditRecord in database with atomic status transition
    const updatedGiveaway = await GiveawayStore.saveDrawResult(id, snapshot.id, drawResult);

    return NextResponse.json({
      success: true,
      giveaway: updatedGiveaway,
      drawResult,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
