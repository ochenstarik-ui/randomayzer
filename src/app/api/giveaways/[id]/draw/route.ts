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
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const clientIp = resolveClientIp(req);
    expensiveApiRateLimiter.assertAllowed(`draw-execute:${clientIp}:${id}`);

    // Enforce giveaway ownership authorization
    const { giveaway } = await requireGiveawayOwner(req, id);

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

    // Use CSPRNG crypto.randomBytes seed if none provided (Math.random is strictly forbidden)
    const seed = (validated.seed && validated.seed.trim()) || generateCryptoSecureSeed();

    // 4. Execute Provably Fair Fisher-Yates Draw V1
    const drawResult = executeDeterministicDrawV1({
      giveawayId: id,
      snapshot,
      totalLoadedCount: giveaway.participants.length,
      winnersCount,
      reserveWinnersCount,
      seed,
      filterRules: giveaway.filterRules,
    });

    // 5. Save DrawResult & AuditRecord in database with atomic status transition
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
