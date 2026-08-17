import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { createGiveawaySchema } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { IdempotencyStore } from '@/lib/idempotency';
import { resolveClientIp } from '@/lib/client-ip';
import { requireAuthenticatedUser } from '@/lib/auth/auth-guard';
import { getSessionFromRequest } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const clientIp = resolveClientIp(req);
    generalApiRateLimiter.assertAllowed(`giveaways-list:${clientIp}`);

    const sessionUser = await getSessionFromRequest(req);
    const summaries = await GiveawayStore.listSummaries();

    // If organizer is logged in, show their giveaways (or all if requested)
    const filteredSummaries = sessionUser
      ? summaries.filter(s => !s.organizerId || s.organizerId === sessionUser.id)
      : summaries;

    return NextResponse.json({
      success: true,
      giveaways: filteredSummaries,
      totalCount: filteredSummaries.length,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = resolveClientIp(req);
    generalApiRateLimiter.assertAllowed(`giveaway-create:${clientIp}`);

    // 1. Mandatory authentication guard for giveaway creation
    const sessionUser = await requireAuthenticatedUser(req);

    const rawBody = await req.json();
    const validated = createGiveawaySchema.parse(rawBody);

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cached = IdempotencyStore.get({
        key: idempotencyKey,
        operation: 'create-giveaway',
        requestPayload: validated,
      });
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.statusCode });
      }
    }

    // 2. Set organizerId strictly from server session (ignoring any client spoofing)
    const giveaway = await GiveawayStore.create({
      sourceUrl: validated.sourceUrl,
      post: validated.post,
      filterRules: validated.filterRules,
      winnersCount: validated.winnersCount,
      reserveWinnersCount: validated.reserveWinnersCount,
      seed: validated.seed,
      organizerId: sessionUser.id,
    });

    const responseBody = {
      success: true,
      giveaway,
    };

    if (idempotencyKey) {
      IdempotencyStore.set({
        key: idempotencyKey,
        operation: 'create-giveaway',
        requestPayload: validated,
        statusCode: 201,
        body: responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
