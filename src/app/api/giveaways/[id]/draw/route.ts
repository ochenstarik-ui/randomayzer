import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { executeDeterministicDrawV1 } from '@/core/randomizer/deterministic';
import { generateCryptoSecureSeed } from '@/core/randomizer/hasher';
import { GiveawayFSM } from '@/core/fsm/giveaway-fsm';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json().catch(() => ({}));
    const giveaway = await GiveawayStore.getById(id);

    if (!giveaway) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 });
    }

    // 1. Guard check with FSM
    if (giveaway.status === 'DRAWN') {
      return NextResponse.json({
        error: 'Розыгрыш уже проведен. Повторный запуск строго запрещен.',
      }, { status: 400 });
    }

    // 2. Fetch locked snapshot (or lock current eligible if ready)
    let snapshot = await GiveawayStore.getLatestSnapshot(id);
    if (!snapshot) {
      const eligible = giveaway.participants.filter(p => p.eligible);
      if (eligible.length === 0) {
        return NextResponse.json({ 
          error: 'Нет допущенных участников для создания слепка и розыгрыша' 
        }, { status: 400 });
      }
      snapshot = await GiveawayStore.createAndLockSnapshot(id, eligible, giveaway.filterRules);
    }

    // Validate status after snapshot lock
    GiveawayFSM.assertCanDraw('SNAPSHOT_LOCKED');

    const winnersCount = body.winnersCount || giveaway.winnersCount || 1;
    const reserveWinnersCount = body.reserveWinnersCount ?? giveaway.reserveWinnersCount ?? 0;
    
    // Seed must be generated with CSPRNG if not provided
    const seed = body.seed?.trim() || giveaway.seed || generateCryptoSecureSeed();

    // 3. Execute Provably Fair Randomizer V1
    const drawResult = executeDeterministicDrawV1({
      giveawayId: id,
      snapshot,
      totalLoadedCount: giveaway.participants.length,
      winnersCount,
      reserveWinnersCount,
      seed,
      filterRules: giveaway.filterRules,
    });

    // 4. Persist DrawResult and AuditRecord atomically
    const updatedGiveaway = await GiveawayStore.saveDrawResult(id, snapshot.id, drawResult);

    return NextResponse.json({
      success: true,
      drawResult,
      giveaway: updatedGiveaway,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
