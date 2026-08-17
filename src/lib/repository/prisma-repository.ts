import { prisma } from '../prisma';
import { 
  IGiveawayRepository, 
  CreateGiveawayInput, 
  GiveawayWithRelations 
} from './giveaway-repository';
import { FilterRules, GiveawayStatusType, PlatformType } from '../../core/types/giveaway';
import { FilteredParticipant } from '../../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../../core/types/audit';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../../core/randomizer/canonical';
import { GiveawayFSM } from '../../core/fsm/giveaway-fsm';

export class PrismaGiveawayRepository implements IGiveawayRepository {
  private mapPrismaGiveaway(raw: any): GiveawayWithRelations {
    const participants: FilteredParticipant[] = (raw.participants || []).map((p: any) => ({
      platformUserId: p.platformUserId,
      firstName: p.firstName,
      lastName: p.lastName,
      username: p.username || undefined,
      avatarUrl: p.avatarUrl || undefined,
      source: p.source,
      liked: p.liked,
      commented: p.commented,
      commentsCount: p.commentsCount,
      reposted: p.reposted,
      subscribed: p.subscribed,
      eligible: p.eligible,
      exclusionReason: p.exclusionReason,
    }));

    const snapshots: ParticipantSnapshotData[] = (raw.snapshots || []).map((s: any) => ({
      id: s.id,
      giveawayId: s.giveawayId,
      version: s.version,
      createdAt: s.createdAt.toISOString(),
      eligibleParticipants: s.eligibleParticipants as FilteredParticipant[],
      participantCount: s.participantCount,
      participantsSnapshotHash: s.participantsSnapshotHash,
      conditionsHash: s.conditionsHash,
    }));

    const latestSnapshot = snapshots.length > 0 
      ? snapshots.sort((a, b) => b.version - a.version)[0] 
      : null;

    let drawResult: DrawExecutionResult | null = null;
    if (raw.drawResult) {
      drawResult = {
        drawId: raw.drawResult.id,
        giveawayId: raw.drawResult.giveawayId,
        snapshotId: raw.drawResult.snapshotId,
        winners: raw.drawResult.winners as any,
        reserveWinners: raw.drawResult.reserveWinners as any,
        winnerIds: raw.drawResult.winnerIds as any,
        reserveWinnerIds: raw.drawResult.reserveWinnerIds as any,
        totalEligibleCount: raw.drawResult.totalEligibleCount,
        totalLoadedCount: raw.drawResult.totalLoadedCount,
        seedUsed: raw.drawResult.seedUsed,
        participantsSnapshotHash: latestSnapshot?.participantsSnapshotHash || '',
        conditionsHash: latestSnapshot?.conditionsHash || '',
        algorithmVersion: raw.drawResult.algorithmVersion,
        drawnAt: raw.drawResult.drawnAt.toISOString(),
        auditHash: raw.drawResult.auditHash,
      };
    }

    return {
      id: raw.id,
      platform: raw.platform as PlatformType,
      sourceUrl: raw.sourceUrl,
      platformOwnerId: raw.platformOwnerId,
      platformPostId: raw.platformPostId,
      title: raw.title,
      description: raw.description,
      postImageUrl: raw.postImageUrl,
      postLikesCount: raw.postLikesCount,
      postCommentsCount: raw.postCommentsCount,
      postRepostsCount: raw.postRepostsCount,
      status: raw.status as GiveawayStatusType,
      filterRules: raw.filterRules as FilterRules,
      winnersCount: raw.winnersCount,
      reserveWinnersCount: raw.reserveWinnersCount,
      seed: raw.seed,
      createdAt: raw.createdAt.toISOString(),
      updatedAt: raw.updatedAt.toISOString(),
      drawnAt: raw.drawnAt ? raw.drawnAt.toISOString() : null,
      participants,
      snapshots,
      latestSnapshot,
      drawResult,
    };
  }

  async createGiveaway(input: CreateGiveawayInput): Promise<GiveawayWithRelations> {
    const created = await prisma.giveaway.create({
      data: {
        platform: input.post.platform,
        sourceUrl: input.sourceUrl,
        platformOwnerId: input.post.ownerId,
        platformPostId: input.post.postId,
        title: input.post.title,
        description: input.post.text,
        postImageUrl: input.post.imageUrl,
        postLikesCount: input.post.likesCount,
        postCommentsCount: input.post.commentsCount,
        postRepostsCount: input.post.repostsCount,
        status: 'READY',
        filterRules: input.filterRules as any,
        winnersCount: input.winnersCount || 1,
        reserveWinnersCount: input.reserveWinnersCount || 0,
        seed: input.seed,
      },
      include: {
        participants: true,
        snapshots: true,
        drawResult: true,
      },
    });

    return this.mapPrismaGiveaway(created);
  }

  async getGiveawayById(id: string): Promise<GiveawayWithRelations | null> {
    const raw = await prisma.giveaway.findUnique({
      where: { id },
      include: {
        participants: true,
        snapshots: {
          orderBy: { version: 'desc' },
        },
        drawResult: true,
      },
    });

    return raw ? this.mapPrismaGiveaway(raw) : null;
  }

  async listGiveaways(): Promise<GiveawayWithRelations[]> {
    const list = await prisma.giveaway.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        participants: true,
        snapshots: {
          orderBy: { version: 'desc' },
        },
        drawResult: true,
      },
    });

    return list.map(item => this.mapPrismaGiveaway(item));
  }

  async updateStatus(id: string, newStatus: GiveawayStatusType): Promise<GiveawayWithRelations> {
    const current = await this.getGiveawayById(id);
    if (!current) throw new Error(`Giveaway with id "${id}" not found`);

    GiveawayFSM.validateTransition(current.status, newStatus);

    const updated = await prisma.giveaway.update({
      where: { id },
      data: { status: newStatus as any },
      include: {
        participants: true,
        snapshots: true,
        drawResult: true,
      },
    });

    return this.mapPrismaGiveaway(updated);
  }

  async saveParticipants(id: string, participants: FilteredParticipant[]): Promise<GiveawayWithRelations> {
    const current = await this.getGiveawayById(id);
    if (!current) throw new Error(`Giveaway with id "${id}" not found`);

    GiveawayFSM.assertCanModifyParticipants(current.status);

    await prisma.$transaction(async (tx) => {
      // Clear previous live participants
      await tx.participant.deleteMany({ where: { giveawayId: id } });

      // Insert new participants
      if (participants.length > 0) {
        await tx.participant.createMany({
          data: participants.map(p => ({
            giveawayId: id,
            platformUserId: p.platformUserId,
            firstName: p.firstName,
            lastName: p.lastName,
            username: p.username,
            avatarUrl: p.avatarUrl,
            source: p.source as any,
            liked: p.liked,
            commented: p.commented,
            commentsCount: p.commentsCount,
            reposted: p.reposted,
            subscribed: p.subscribed,
            eligible: p.eligible,
            exclusionReason: p.exclusionReason,
          })),
        });
      }

      await tx.giveaway.update({
        where: { id },
        data: { status: 'READY' },
      });
    });

    const updated = await this.getGiveawayById(id);
    return updated!;
  }

  async createAndLockSnapshot(
    id: string, 
    eligibleParticipants: FilteredParticipant[], 
    rules: FilterRules
  ): Promise<ParticipantSnapshotData> {
    const current = await this.getGiveawayById(id);
    if (!current) throw new Error(`Giveaway with id "${id}" not found`);

    if (current.status === 'DRAWN' || current.status === 'PUBLISHED') {
      throw new Error(`Cannot lock snapshot in final status "${current.status}"`);
    }

    if (eligibleParticipants.length === 0) {
      throw new Error('Cannot create snapshot with 0 eligible participants');
    }

    const participantsSnapshotHash = computeParticipantsSnapshotHash(eligibleParticipants);
    const conditionsHash = computeConditionsHash(rules);

    const latestVersion = current.snapshots.length > 0
      ? Math.max(...current.snapshots.map(s => s.version))
      : 0;
    const newVersion = latestVersion + 1;

    const [snapshot] = await prisma.$transaction([
      prisma.participantSnapshot.create({
        data: {
          giveawayId: id,
          version: newVersion,
          eligibleParticipants: eligibleParticipants as any,
          participantCount: eligibleParticipants.length,
          participantsSnapshotHash,
          conditionsHash,
        },
      }),
      prisma.giveaway.update({
        where: { id },
        data: {
          status: 'SNAPSHOT_LOCKED',
          filterRules: rules as any,
        },
      }),
    ]);

    return {
      id: snapshot.id,
      giveawayId: snapshot.giveawayId,
      version: snapshot.version,
      createdAt: snapshot.createdAt.toISOString(),
      eligibleParticipants: eligibleParticipants,
      participantCount: snapshot.participantCount,
      participantsSnapshotHash: snapshot.participantsSnapshotHash,
      conditionsHash: snapshot.conditionsHash,
    };
  }

  async getLatestSnapshot(giveawayId: string): Promise<ParticipantSnapshotData | null> {
    const snap = await prisma.participantSnapshot.findFirst({
      where: { giveawayId },
      orderBy: { version: 'desc' },
    });

    if (!snap) return null;

    return {
      id: snap.id,
      giveawayId: snap.giveawayId,
      version: snap.version,
      createdAt: snap.createdAt.toISOString(),
      eligibleParticipants: snap.eligibleParticipants as any,
      participantCount: snap.participantCount,
      participantsSnapshotHash: snap.participantsSnapshotHash,
      conditionsHash: snap.conditionsHash,
    };
  }

  async saveDrawResultAndAudit(
    id: string, 
    snapshotId: string, 
    result: DrawExecutionResult
  ): Promise<GiveawayWithRelations> {
    const current = await this.getGiveawayById(id);
    if (!current) throw new Error(`Giveaway with id "${id}" not found`);

    GiveawayFSM.assertCanDraw(current.status);

    await prisma.$transaction(async (tx) => {
      // 1. Create DrawResult
      await tx.drawResult.create({
        data: {
          giveawayId: id,
          snapshotId: snapshotId,
          winners: result.winners as any,
          reserveWinners: result.reserveWinners as any,
          winnerIds: result.winnerIds as any,
          reserveWinnerIds: result.reserveWinnerIds as any,
          totalEligibleCount: result.totalEligibleCount,
          totalLoadedCount: result.totalLoadedCount,
          seedUsed: result.seedUsed,
          algorithmVersion: result.algorithmVersion,
          auditHash: result.auditHash,
          drawnAt: new Date(result.drawnAt),
        },
      });

      // 2. Create AuditRecord
      await tx.auditRecord.create({
        data: {
          giveawayId: id,
          snapshotId: snapshotId,
          algorithmVersion: result.algorithmVersion,
          seed: result.seedUsed,
          participantsSnapshotHash: result.participantsSnapshotHash,
          conditionsHash: result.conditionsHash,
          auditHash: result.auditHash,
          winnerIds: result.winnerIds as any,
          reserveWinnerIds: result.reserveWinnerIds as any,
          eligibleCount: result.totalEligibleCount,
          drawId: result.drawId,
          drawnAt: new Date(result.drawnAt),
          verifiedAt: new Date(),
        },
      });

      // 3. Update Giveaway status to DRAWN
      await tx.giveaway.update({
        where: { id },
        data: {
          status: 'DRAWN',
          drawnAt: new Date(result.drawnAt),
          seed: result.seedUsed,
        },
      });
    });

    const updated = await this.getGiveawayById(id);
    return updated!;
  }
}
