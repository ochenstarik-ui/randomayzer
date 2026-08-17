import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';

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
        error: 'Нельзя создать слепок с 0 допущенными участниками' 
      }, { status: 400 });
    }

    const rules = body.filterRules || giveaway.filterRules;

    const snapshot = await GiveawayStore.createAndLockSnapshot(
      id,
      eligibleParticipants,
      rules
    );

    return NextResponse.json({
      success: true,
      snapshot,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
