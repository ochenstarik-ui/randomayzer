import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { ProviderFactory } from '@/providers/factory';
import { executeParticipantPipeline } from '@/core/pipeline/participant-enricher';
import { fetchParticipantsSchema, validateProviderCapabilities } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter, generalApiRateLimiter } from '@/lib/rate-limiter';
import { IdempotencyStore } from '@/lib/idempotency';
import { resolveClientIp } from '@/lib/client-ip';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const clientIp = resolveClientIp(req);
    generalApiRateLimiter.assertAllowed(`participants-get:${clientIp}`);

    // Enforce giveaway ownership authorization (private participant PII data)
    await requireGiveawayOwner(req, id);

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
    const clientIp = resolveClientIp(req);
    expensiveApiRateLimiter.assertAllowed(`participants-import:${clientIp}:${id}`);

    // Enforce giveaway ownership authorization for importing participants
    const { giveaway } = await requireGiveawayOwner(req, id);

    const rawBody = await req.json();
    const validated = fetchParticipantsSchema.parse(rawBody);

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cached = IdempotencyStore.get({
        key: idempotencyKey,
        operation: 'participants-import',
        giveawayId: id,
        requestPayload: validated,
      });
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.statusCode });
      }
    }

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

    // Return summary only (no massive arrays in POST response)
    const responseBody = {
      success: true,
      giveawayId: updated.id,
      totalCount: allParticipants.length,
      eligibleCount: eligibleParticipants.length,
      excludedCount: excludedParticipants.length,
    };

    if (idempotencyKey) {
      IdempotencyStore.set({
        key: idempotencyKey,
        operation: 'participants-import',
        giveawayId: id,
        requestPayload: validated,
        statusCode: 200,
        body: responseBody,
      });
    }

    return NextResponse.json(responseBody);
  } catch (error: any) {
    return handleApiError(error);
  }
}
