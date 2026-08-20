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
import { computeSeedCommitment } from '@/core/randomizer/hasher';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const clientIp = resolveClientIp(req);
    expensiveApiRateLimiter.assertAllowed(`snapshot-lock:${clientIp}:${id}`);

    // Enforce giveaway ownership authorization
    const { giveaway } = await requireGiveawayOwner(req, id);

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
    const snapshot = await GiveawayStore.createAndLockSnapshot(
      id,
      eligibleParticipants,
      validated.filterRules
    );

    const updatedGw = await GiveawayStore.getById(id);
    const seedCommitment = updatedGw?.seed ? computeSeedCommitment(updatedGw.seed) : null;

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
