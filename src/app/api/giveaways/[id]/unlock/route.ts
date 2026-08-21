import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { handleApiError, ConflictError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter } from '@/lib/rate-limiter';
import { IdempotencyStore } from '@/lib/idempotency';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';
import { validateCsrfOrigin } from '@/lib/auth/csrf-guard';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // 1. Enforce CSRF Origin validation for mutating request
    validateCsrfOrigin(req);

    const { id } = await params;

    // 2. Enforce giveaway ownership authorization
    const { giveaway, sessionUser } = await requireGiveawayOwner(req, id);

    // 3. User-scoped rate limiter
    expensiveApiRateLimiter.assertAllowed(`snapshot-unlock:${sessionUser.id}:${id}`);

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const cached = IdempotencyStore.get({
        key: idempotencyKey,
        operation: 'snapshot-unlock',
        giveawayId: id,
      });
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.statusCode });
      }
    }

    // 4. Strict Terminal State Guard: cannot unlock DRAWN or PUBLISHED giveaways
    if (giveaway.status === 'DRAWN' || giveaway.status === 'PUBLISHED') {
      throw new ConflictError(
        `Cannot unlock snapshot for giveaway in final status "${giveaway.status}"`
      );
    }

    if (giveaway.status !== 'SNAPSHOT_LOCKED') {
      throw new ConflictError(
        `Cannot unlock snapshot: giveaway "${id}" is in status "${giveaway.status}", but requires "SNAPSHOT_LOCKED"`
      );
    }

    // 5. Atomically transition SNAPSHOT_LOCKED -> READY and reset pre-committed seed
    const updated = await GiveawayStore.unlockSnapshot(id);

    const responseBody = {
      success: true,
      giveawayId: id,
      status: updated.status,
      seedCommitment: null,
      message: 'Snapshot unlocked successfully and seed commitment cleared',
    };

    if (idempotencyKey) {
      IdempotencyStore.set({
        key: idempotencyKey,
        operation: 'snapshot-unlock',
        giveawayId: id,
        statusCode: 200,
        body: responseBody,
      });
    }

    return NextResponse.json(responseBody);
  } catch (error: any) {
    return handleApiError(error);
  }
}
