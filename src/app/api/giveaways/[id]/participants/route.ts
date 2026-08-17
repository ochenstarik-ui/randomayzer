import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { ProviderRegistry } from '@/providers/registry';
import { applyFilterRules } from '@/core/filtering/filter-engine';

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

    const rules = body.filterRules || giveaway.filterRules;
    const provider = ProviderRegistry.getProvider(giveaway.platform);

    // Fetch raw participants from provider
    const rawParticipants = await provider.fetchParticipants({
      ownerId: giveaway.platformOwnerId,
      postId: giveaway.platformPostId,
      sourceUrl: giveaway.sourceUrl,
      includeLikes: true,
      includeComments: rules.requireComment,
      includeReposts: rules.requireRepost,
      checkSubscription: rules.requireSubscription,
    });

    // Apply filtering engine
    const filterResult = applyFilterRules(rawParticipants, rules);

    // Update participants in store
    await GiveawayStore.updateParticipants(id, filterResult.allParticipants);

    return NextResponse.json({
      success: true,
      stats: filterResult.stats,
      allParticipants: filterResult.allParticipants,
      eligibleCount: filterResult.eligibleParticipants.length,
      excludedCount: filterResult.excludedParticipants.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
