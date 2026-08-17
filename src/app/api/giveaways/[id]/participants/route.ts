import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { ProviderRegistry } from '@/providers/registry';
import { executeParticipantPipeline } from '@/core/pipeline/participant-enricher';
import { validateFilterRulesAgainstProviderCapabilities } from '@/core/filtering/rule-validation';

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

    // Reject filter rules the selected provider cannot actually verify
    const capabilityCheck = validateFilterRulesAgainstProviderCapabilities(rules, provider.capabilities);
    if (!capabilityCheck.valid) {
      return NextResponse.json(
        { error: 'Unsupported filter rules', details: capabilityCheck.errors },
        { status: 400 }
      );
    }

    // 1. Fetch raw participants
    const rawParticipants = await provider.fetchParticipants({
      ownerId: giveaway.platformOwnerId,
      postId: giveaway.platformPostId,
      sourceUrl: giveaway.sourceUrl,
      includeLikes: true,
      includeComments: rules.requireComment,
      includeReposts: rules.requireRepost,
    });

    // 2. Run enrichment pipeline (subscription check + filter engine)
    const filterResult = await executeParticipantPipeline({
      rawParticipants,
      rules,
      provider,
      ownerId: giveaway.platformOwnerId,
    });

    // 3. Save participants into persistent database
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
