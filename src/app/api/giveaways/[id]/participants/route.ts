import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { ProviderFactory } from '@/providers/factory';
import { executeParticipantPipeline } from '@/core/pipeline/participant-enricher';
import { fetchParticipantsSchema, validateProviderCapabilities } from '@/core/validation/giveaway-schemas';
import { handleApiError, NotFoundError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter, generalApiRateLimiter } from '@/lib/rate-limiter';
import { IdempotencyStore } from '@/lib/idempotency';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    generalApiRateLimiter.assertAllowed(`participants-get:${ip}`);

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const tabParam = searchParams.get('tab') || 'all';
    const tab = (tabParam === 'eligible' || tabParam === 'excluded') ? tabParam : 'all';

    const result = await GiveawayStore.getParticipantsPaginated(id, page, pageSize, tab);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    expensiveApiRateLimiter.assertAllowed(`participants-import:${ip}:${id}`);

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cached = IdempotencyStore.get(`import-part:${idempotencyKey}`);
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.statusCode });
      }
    }

    const giveaway = await GiveawayStore.getById(id);
    if (!giveaway) {
      throw new NotFoundError(`Giveaway with id "${id}" not found`);
    }

    const rawBody = await req.json();
    const validated = fetchParticipantsSchema.parse(rawBody);

    const provider = ProviderFactory.getVkProvider();
    validateProviderCapabilities(validated.filterRules, provider.capabilities);

    // Fetch raw participants from social provider
    const rawParticipants = await provider.fetchParticipants({
      ownerId: giveaway.platformOwnerId,
      postId: giveaway.platformPostId,
      includeLikes: validated.filterRules.requireLike,
      includeComments: validated.filterRules.requireComment,
    });

    // Run participant fetch, enrichment, and filtering pipeline
    const { allParticipants, eligibleParticipants, excludedParticipants } =
      await executeParticipantPipeline({
        rawParticipants,
        rules: validated.filterRules,
        provider,
        ownerId: giveaway.platformOwnerId,
      });

    // Save atomic participant state in store
    const updated = await GiveawayStore.updateParticipants(id, allParticipants);

    const responseBody = {
      success: true,
      giveawayId: updated.id,
      totalCount: allParticipants.length,
      eligibleCount: eligibleParticipants.length,
      excludedCount: excludedParticipants.length,
      allParticipants,
      eligibleParticipants,
      excludedParticipants,
    };

    if (idempotencyKey) {
      IdempotencyStore.set(`import-part:${idempotencyKey}`, 200, responseBody);
    }

    return NextResponse.json(responseBody);
  } catch (error: any) {
    return handleApiError(error);
  }
}
