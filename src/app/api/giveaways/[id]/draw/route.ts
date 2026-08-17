import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { GiveawayFSM } from '@/core/fsm/giveaway-fsm';
import { generateCryptoSecureSeed } from '@/core/randomizer/hasher';
import { executeDeterministicDrawV1 } from '@/core/randomizer/deterministic';
import { executeDrawSchema } from '@/core/validation/giveaway-schemas';
import { handleApiError, NotFoundError, ConflictError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter } from '@/lib/rate-limiter';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    expensiveApiRateLimiter.assertAllowed(`draw-execute:${ip}:${id}`);

    const giveaway = await GiveawayStore.getById(id);
    if (!giveaway) {
      throw new NotFoundError(`Giveaway with id "${id}" not found`);
    }

    // 1. Strict FSM Guard: Draw is permitted ONLY in SNAPSHOT_LOCKED status
    GiveawayFSM.assertCanDraw(giveaway.status);

    // 2. Strict Snapshot requirement: Never create a snapshot implicitly
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

    // Use CSPRNG crypto.randomBytes seed if none provided (Math.random is strictly forbidden)
    const seed = (validated.seed && validated.seed.trim()) || generateCryptoSecureSeed();

    // 3. Execute Provably Fair Fisher-Yates Draw V1
    const drawResult = executeDeterministicDrawV1({
      giveawayId: id,
      snapshot,
      totalLoadedCount: giveaway.participants.length,
      winnersCount,
      reserveWinnersCount,
      seed,
      filterRules: giveaway.filterRules,
    });

    // 4. Save DrawResult & AuditRecord in database with atomic status transition
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
