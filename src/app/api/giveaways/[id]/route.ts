import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const giveaway = await GiveawayStore.getById(id);

    if (!giveaway) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, giveaway });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
