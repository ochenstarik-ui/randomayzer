import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { ProviderFactory } from '@/providers/factory';
import { applyFilterRules } from '@/core/filtering/filter-engine';
import { createSnapshotSchema, validateProviderCapabilities } from '@/core/validation/giveaway-schemas';
import { handleApiError, NotFoundError, ConflictError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter } from '@/lib/rate-limiter';
import { IdempotencyStore } from '@/lib/idempotency';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    expensiveApiRateLimiter.assertAllowed(`snapshot-lock:${ip}:${id}`);

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cached = IdempotencyStore.get(`lock-snap:${idempotencyKey}`);
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.statusCode });
      }
    }

    const giveaway = await GiveawayStore.getById(id);
    if (!giveaway) {
      throw new NotFoundError(`Giveaway with id "${id}" not found`);
    }

    if (giveaway.status === 'DRAWN' || giveaway.status === 'PUBLISHED') {
      throw new ConflictError(`Cannot create new snapshot for giveaway in status "${giveaway.status}"`);
    }

    const rawBody = await req.json();
    const validated = createSnapshotSchema.parse(rawBody);

    const provider = ProviderFactory.getVkProvider();
    validateProviderCapabilities(validated.filterRules, provider.capabilities);

    // Apply strict filtering on current participants
    const { eligibleParticipants } = applyFilterRules(
      giveaway.participants,
      validated.filterRules
    );

    if (eligibleParticipants.length === 0) {
      throw new ConflictError('Cannot create snapshot with 0 eligible participants. Check your filter rules.');
    }

    // Atomically create and lock snapshot in database
    const snapshot = await GiveawayStore.createAndLockSnapshot(
      id,
      eligibleParticipants,
      validated.filterRules
    );

    const responseBody = {
      success: true,
      giveawayId: id,
      status: 'SNAPSHOT_LOCKED',
      snapshot,
    };

    if (idempotencyKey) {
      IdempotencyStore.set(`lock-snap:${idempotencyKey}`, 200, responseBody);
    }

    return NextResponse.json(responseBody);
  } catch (error: any) {
    return handleApiError(error);
  }
}
