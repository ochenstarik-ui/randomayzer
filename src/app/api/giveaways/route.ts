import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { DEFAULT_FILTER_RULES } from '@/core/types/giveaway';

export async function GET() {
  try {
    const list = await GiveawayStore.listAll();
    return NextResponse.json({ success: true, giveaways: list });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sourceUrl, post, filterRules = DEFAULT_FILTER_RULES, winnersCount = 1, reserveWinnersCount = 0, seed } = body;

    if (!sourceUrl || !post) {
      return NextResponse.json({ error: 'sourceUrl and post are required' }, { status: 400 });
    }

    const giveaway = await GiveawayStore.create({
      sourceUrl,
      post,
      filterRules,
      winnersCount,
      reserveWinnersCount,
      seed,
    });

    return NextResponse.json({ success: true, giveaway });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
