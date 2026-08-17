import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { executeDeterministicDraw } from '@/core/randomizer/deterministic';
import { generateRandomSeed } from '@/core/randomizer/hasher';

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

    const eligibleParticipants = giveaway.participants.filter(p => p.eligible);

    if (eligibleParticipants.length === 0) {
      return NextResponse.json({ 
        error: 'Нет допущенных участников для проведения розыгрыша' 
      }, { status: 400 });
    }

    const winnersCount = body.winnersCount || giveaway.winnersCount || 1;
    const reserveWinnersCount = body.reserveWinnersCount ?? giveaway.reserveWinnersCount ?? 0;
    const seed = body.seed?.trim() || giveaway.seed || generateRandomSeed();

    // Execute provably fair draw
    const drawResult = executeDeterministicDraw({
      giveawayId: id,
      eligibleParticipants,
      totalLoadedCount: giveaway.participants.length,
      winnersCount,
      reserveWinnersCount,
      seed,
      filterRules: giveaway.filterRules,
    });

    // Persist result
    const updatedGiveaway = await GiveawayStore.saveDrawResult(id, drawResult);

    return NextResponse.json({
      success: true,
      drawResult,
      giveaway: updatedGiveaway,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
