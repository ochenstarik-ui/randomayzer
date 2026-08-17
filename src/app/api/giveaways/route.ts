import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { createGiveawaySchema } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { IdempotencyStore } from '@/lib/idempotency';

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    generalApiRateLimiter.assertAllowed(`giveaways-list:${ip}`);

    // Return lightweight summary for scalability (no massive participant/snapshot payloads)
    const summaries = await GiveawayStore.listSummaries();
    return NextResponse.json({
      success: true,
      giveaways: summaries,
      totalCount: summaries.length,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    generalApiRateLimiter.assertAllowed(`giveaway-create:${ip}`);

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cached = IdempotencyStore.get(`create-gw:${idempotencyKey}`);
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.statusCode });
      }
    }

    const rawBody = await req.json();
    const validated = createGiveawaySchema.parse(rawBody);

    const giveaway = await GiveawayStore.create({
      sourceUrl: validated.sourceUrl,
      post: validated.post,
      filterRules: validated.filterRules,
      winnersCount: validated.winnersCount,
      reserveWinnersCount: validated.reserveWinnersCount,
      seed: validated.seed,
    });

    const responseBody = {
      success: true,
      giveaway,
    };

    if (idempotencyKey) {
      IdempotencyStore.set(`create-gw:${idempotencyKey}`, 201, responseBody);
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
