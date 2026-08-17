import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { verifyDrawResult } from '@/core/randomizer/deterministic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const giveaway = await GiveawayStore.getById(id);

    if (!giveaway) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 });
    }

    const drawResult = giveaway.drawResult;
    if (!drawResult) {
      return NextResponse.json({ 
        error: 'Giveaway has not been drawn yet. Nothing to verify.' 
      }, { status: 400 });
    }

    // Strict snapshot lookup: DO NOT fallback to latestSnapshot
    const snapshot = giveaway.snapshots.find(s => s.id === drawResult.snapshotId);

    if (!snapshot) {
      return NextResponse.json({ 
        error: `Integrity Error: Participant snapshot "${drawResult.snapshotId}" referenced by draw does not exist in storage`,
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
