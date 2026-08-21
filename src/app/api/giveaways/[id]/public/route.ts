import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { handleApiError, NotFoundError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { computeSeedCommitment } from '@/core/randomizer/hasher';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await params;
    const clientIp = resolveClientIp(req);

    // Anonymous rate limiter
    expensiveApiRateLimiter.assertAllowed(`giveaway-public-get:${clientIp}:${id}`);

    const giveaway = await GiveawayStore.getById(id);
    if (!giveaway) {
      throw new NotFoundError(`Giveaway with id "${id}" not found`);
    }

    const isDrawn = giveaway.status === 'DRAWN' || giveaway.status === 'PUBLISHED';

    // Calculate or retrieve seed commitment (accessible before and after draw)
    const seedCommitment = giveaway.seedCommitment || (giveaway.seed ? computeSeedCommitment(giveaway.seed) : null);

    // Revealed seed: strictly null before finalized draw, revealed once drawn
    const seed = isDrawn ? giveaway.seed : null;

    const publicGiveaway = {
      id: giveaway.id,
      status: giveaway.status,
      title: giveaway.title,
      description: giveaway.description,
      platform: giveaway.platform,
      sourceUrl: giveaway.sourceUrl,
      post: {
        platform: giveaway.platform,
        ownerId: giveaway.platformOwnerId,
        postId: giveaway.platformPostId,
        title: giveaway.title,
        imageUrl: giveaway.postImageUrl,
        likesCount: giveaway.postLikesCount,
        commentsCount: giveaway.postCommentsCount,
        repostsCount: giveaway.postRepostsCount,
      },
      postImageUrl: giveaway.postImageUrl,
      filterRules: giveaway.latestSnapshot?.filterRulesSnapshot || giveaway.filterRules,
      winnersCount: giveaway.winnersCount,
      reserveWinnersCount: giveaway.reserveWinnersCount,
      seedCommitment,
      seed,
      drawnAt: giveaway.drawnAt,
      createdAt: giveaway.createdAt,
      updatedAt: giveaway.updatedAt,
      latestSnapshot: giveaway.latestSnapshot ? {
        version: giveaway.latestSnapshot.version,
        createdAt: giveaway.latestSnapshot.createdAt,
        participantCount: giveaway.latestSnapshot.participantCount,
        participantsSnapshotHash: giveaway.latestSnapshot.participantsSnapshotHash,
        conditionsHash: giveaway.latestSnapshot.conditionsHash,
      } : null,
      drawResult: giveaway.drawResult ? {
        drawId: giveaway.drawResult.drawId,
        algorithmVersion: giveaway.drawResult.algorithmVersion,
        totalEligibleCount: giveaway.drawResult.totalEligibleCount,
        totalLoadedCount: giveaway.drawResult.totalLoadedCount,
        seedUsed: giveaway.drawResult.seedUsed,
        snapshotId: giveaway.drawResult.snapshotId,
        drawnAt: giveaway.drawResult.drawnAt,
        deterministicProofHash: giveaway.drawResult.deterministicProofHash,
        auditEventHash: giveaway.drawResult.auditEventHash,
        participantsSnapshotHash: giveaway.drawResult.participantsSnapshotHash,
        conditionsHash: giveaway.drawResult.conditionsHash,
        winners: giveaway.drawResult.winners.map(w => ({
          position: w.position,
          participant: {
            platformUserId: w.participant.platformUserId,
            firstName: w.participant.firstName,
            lastName: w.participant.lastName,
            avatarUrl: w.participant.avatarUrl,
          },
        })),
        reserveWinners: giveaway.drawResult.reserveWinners.map(w => ({
          position: w.position,
          participant: {
            platformUserId: w.participant.platformUserId,
            firstName: w.participant.firstName,
            lastName: w.participant.lastName,
            avatarUrl: w.participant.avatarUrl,
          },
        })),
        winnerIds: giveaway.drawResult.winnerIds,
        reserveWinnerIds: giveaway.drawResult.reserveWinnerIds,
      } : null,
    };

    return NextResponse.json({
      success: true,
      giveaway: publicGiveaway,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
