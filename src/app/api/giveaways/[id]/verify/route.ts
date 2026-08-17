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

    // Find the snapshot associated with this draw
    const snapshot = giveaway.snapshots.find(s => s.id === drawResult.snapshotId) 
      || giveaway.latestSnapshot;

    if (!snapshot) {
      return NextResponse.json({ 
        error: `Participant snapshot "${drawResult.snapshotId}" not found for this giveaway` 
      }, { status: 404 });
    }

    const claimedWinnersCount = drawResult.winners.length;
    const claimedReserveCount = drawResult.reserveWinners.length;

    // Run independent cryptographic replay verification
    const verification = verifyDrawResult(
      snapshot,
      drawResult.seedUsed,
      claimedWinnersCount,
      claimedReserveCount,
      drawResult.winnerIds,
      drawResult.deterministicProofHash,
      drawResult.algorithmVersion
    );

    return NextResponse.json({
      verified: verification.verified,
      giveawayId: id,
      snapshotId: snapshot.id,
      algorithmVersion: verification.algorithmVersion,
      winnersMatch: verification.winnersMatch,
      snapshotHashMatch: verification.snapshotHashMatch,
      conditionsHashMatch: verification.conditionsHashMatch,
      deterministicProofHashMatch: verification.deterministicProofHashMatch,
      expectedWinnerIds: verification.expectedWinnerIds,
      expectedReserveWinnerIds: verification.expectedReserveWinnerIds,
      deterministicProofHash: verification.expectedDeterministicProofHash,
      auditEventHash: drawResult.auditEventHash,
      drawnAt: drawResult.drawnAt,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
