import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { verifyDrawResult } from '@/core/randomizer/deterministic';
import { handleApiError, NotFoundError, ConflictError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const clientIp = resolveClientIp(req);
    expensiveApiRateLimiter.assertAllowed(`verify-get:${clientIp}:${id}`);

    const giveaway = await GiveawayStore.getById(id);
    if (!giveaway) {
      throw new NotFoundError(`Giveaway with id "${id}" not found`);
    }

    const drawResult = giveaway.drawResult;
    if (!drawResult) {
      throw new ConflictError('Giveaway has not been drawn yet. Nothing to verify.');
    }

    // Strict snapshot lookup: DO NOT fallback to latestSnapshot
    const snapshot = giveaway.snapshots.find(s => s.id === drawResult.snapshotId);

    if (!snapshot) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INTEGRITY_ERROR',
          message: `Participant snapshot "${drawResult.snapshotId}" referenced by draw does not exist in storage`,
        },
        verified: false,
        snapshotFound: false,
      }, { status: 404 });
    }

    const claimedWinnersCount = drawResult.winners.length;
    const claimedReserveCount = drawResult.reserveWinners.length;

    // Run independent cryptographic replay verification
    const verification = verifyDrawResult({
      giveawayId: id,
      drawId: drawResult.drawId,
      drawnAt: drawResult.drawnAt,
      snapshot,
      seed: drawResult.seedUsed,
      claimedWinnersCount,
      claimedReserveCount,
      claimedWinnerIds: drawResult.winnerIds,
      claimedReserveWinnerIds: drawResult.reserveWinnerIds,
      claimedDeterministicProofHash: drawResult.deterministicProofHash,
      claimedAuditEventHash: drawResult.auditEventHash,
      algorithmVersion: drawResult.algorithmVersion,
    });

    return NextResponse.json({
      success: true,
      verified: verification.verified,
      giveawayId: id,
      drawId: drawResult.drawId,
      snapshotId: snapshot.id,
      algorithmVersion: verification.algorithmVersion,
      algorithmSupported: verification.algorithmSupported,
      participantsSnapshotIntegrity: verification.participantsSnapshotIntegrity,
      conditionsIntegrity: verification.conditionsIntegrity,
      winnersMatch: verification.winnersMatch,
      reserveWinnersMatch: verification.reserveWinnersMatch,
      deterministicProofHashMatch: verification.deterministicProofHashMatch,
      auditEventHashMatch: verification.auditEventHashMatch,
      expectedWinnerIds: verification.expectedWinnerIds,
      expectedReserveWinnerIds: verification.expectedReserveWinnerIds,
      deterministicProofHash: verification.expectedDeterministicProofHash,
      auditEventHash: verification.expectedAuditEventHash,
      drawnAt: drawResult.drawnAt,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
