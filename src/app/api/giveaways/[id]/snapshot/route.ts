import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { ProviderFactory } from '@/providers/factory';
import { applyFilterRules } from '@/core/filtering/filter-engine';
import { createSnapshotSchema, validateProviderCapabilities } from '@/core/validation/giveaway-schemas';
import { handleApiError, ConflictError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter } from '@/lib/rate-limiter';
import { IdempotencyStore } from '@/lib/idempotency';
import { resolveClientIp } from '@/lib/client-ip';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 1. Enforce giveaway ownership authorization
    const { giveaway, sessionUser } = await requireGiveawayOwner(req, id);

    // 2. User-scoped rate limiter
    expensiveApiRateLimiter.assertAllowed(`snapshot-lock:${sessionUser.id}:${id}`);

    if (giveaway.status === 'DRAWN' || giveaway.status === 'PUBLISHED') {
      throw new ConflictError(`Cannot create new snapshot for giveaway in status "${giveaway.status}"`);
    }

    const rawBody = await req.json();
    const validated = createSnapshotSchema.parse(rawBody);

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cached = IdempotencyStore.get({
        key: idempotencyKey,
        operation: 'snapshot-lock',
        giveawayId: id,
        requestPayload: validated,
      });
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.statusCode });
      }
    }

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

    // Atomically create and lock snapshot + pre-commit seed in database
    const { snapshot, seedCommitment } = await GiveawayStore.createAndLockSnapshot(
      id,
      eligibleParticipants,
      validated.filterRules
    );

    const responseBody = {
      success: true,
      giveawayId: id,
      status: 'SNAPSHOT_LOCKED',
      snapshot,
      seedCommitment,
    };

    if (idempotencyKey) {
      IdempotencyStore.set({
        key: idempotencyKey,
        operation: 'snapshot-lock',
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
