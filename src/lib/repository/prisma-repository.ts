import { 
  IGiveawayRepository, 
  CreateGiveawayInput, 
  GiveawayWithRelations,
  GiveawaySummary,
  PaginatedParticipantsResult,
  LockedSnapshotResult
} from './giveaway-repository';
import { prisma } from '../prisma';
import { FilterRules, GiveawayStatusType, PlatformType } from '../../core/types/giveaway';
import { FilteredParticipant } from '../../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../../core/types/audit';
import { computeParticipantsSnapshotHash, computeConditionsHash } from '../../core/randomizer/canonical';
import { generateCryptoSecureSeed, computeSeedCommitment } from '../../core/randomizer/hasher';
import { GiveawayFSM } from '../../core/fsm/giveaway-fsm';
import { ConflictError, NotFoundError } from '../../core/errors/http-errors';

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
      eligibleParticipants: (s.eligibleParticipants as any) || [],
      filterRulesSnapshot: (s.filterRulesSnapshot as any) || {},
      participantCount: s.participantCount,
      participantsSnapshotHash: s.participantsSnapshotHash,
      conditionsHash: s.conditionsHash,
    }));

    const latestSnapshot = snapshots.length > 0 ? snapshots[0] : null;

    let drawResult: DrawExecutionResult | null = null;
    if (raw.drawResult) {
      const boundSnapshot = snapshots.find(s => s.id === raw.drawResult.snapshotId) || latestSnapshot;

      drawResult = {
        drawId: raw.drawResult.drawId,
        giveawayId: raw.drawResult.giveawayId,
        snapshotId: raw.drawResult.snapshotId,
        winners: raw.drawResult.winners as any,
        reserveWinners: raw.drawResult.reserveWinners as any,
        winnerIds: raw.drawResult.winnerIds as any,
        reserveWinnerIds: raw.drawResult.reserveWinnerIds as any,
        totalEligibleCount: raw.drawResult.totalEligibleCount,
        totalLoadedCount: raw.drawResult.totalLoadedCount,
        seedUsed: raw.drawResult.seedUsed,
        algorithmVersion: raw.drawResult.algorithmVersion as any,
        deterministicProofHash: raw.drawResult.deterministicProofHash,
        auditEventHash: raw.drawResult.auditEventHash,
        drawnAt: raw.drawResult.drawnAt.toISOString(),
        participantsSnapshotHash: boundSnapshot?.participantsSnapshotHash || '',
        conditionsHash: boundSnapshot?.conditionsHash || '',
      };
    }

    const seedCommitment = raw.seed ? computeSeedCommitment(raw.seed) : null;

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
      filterRules: raw.filterRules as any,
      winnersCount: raw.winnersCount,
      reserveWinnersCount: raw.reserveWinnersCount,
      seed: raw.seed,
      seedCommitment,
      organizerId: raw.organizerId,
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
        seed: null,
        organizerId: input.organizerId,
      },
      include: {
        participants: true,
        snapshots: true,
        drawResult: {
          include: { snapshot: true },
        },
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
        drawResult: {
          include: { snapshot: true },
        },
      },
    });

    return raw ? this.mapPrismaGiveaway(raw) : null;
  }

  async listGiveaways(organizerId?: string): Promise<GiveawayWithRelations[]> {
    const list = await prisma.giveaway.findMany({
      where: organizerId ? { organizerId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        participants: true,
        snapshots: {
          orderBy: { version: 'desc' },
        },
        drawResult: {
          include: { snapshot: true },
        },
      },
    });

    return list.map(item => this.mapPrismaGiveaway(item));
  }

  async listGiveawaysSummary(organizerId?: string): Promise<GiveawaySummary[]> {
    const list = await prisma.giveaway.findMany({
      where: organizerId ? { organizerId } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        sourceUrl: true,
        platformOwnerId: true,
        platformPostId: true,
        title: true,
        postImageUrl: true,
        postLikesCount: true,
        postCommentsCount: true,
        postRepostsCount: true,
        status: true,
        winnersCount: true,
        reserveWinnersCount: true,
        organizerId: true,
        createdAt: true,
        updatedAt: true,
        drawnAt: true,
        _count: {
          select: {
            participants: true,
          },
        },
        drawResult: {
          select: {
            algorithmVersion: true,
            totalEligibleCount: true,
          },
        },
      },
    });

    return list.map(item => ({
      id: item.id,
      platform: item.platform as PlatformType,
      sourceUrl: item.sourceUrl,
      platformOwnerId: item.platformOwnerId,
      platformPostId: item.platformPostId,
      title: item.title,
      postImageUrl: item.postImageUrl,
      postLikesCount: item.postLikesCount,
      postCommentsCount: item.postCommentsCount,
      postRepostsCount: item.postRepostsCount,
      status: item.status as GiveawayStatusType,
      winnersCount: item.winnersCount,
      reserveWinnersCount: item.reserveWinnersCount,
      organizerId: item.organizerId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      drawnAt: item.drawnAt ? item.drawnAt.toISOString() : null,
      totalParticipantsCount: item._count.participants,
      eligibleParticipantsCount: item.drawResult?.totalEligibleCount || 0,
      hasDrawResult: Boolean(item.drawResult),
      algorithmVersion: item.drawResult?.algorithmVersion || null,
    }));
  }

  async getParticipantsPaginated(
    id: string, 
    page: number = 1, 
    pageSize: number = 50, 
    tab: 'all' | 'eligible' | 'excluded' = 'all'
  ): Promise<PaginatedParticipantsResult> {
    const whereClause: any = { giveawayId: id };
    if (tab === 'eligible') whereClause.eligible = true;
    if (tab === 'excluded') whereClause.eligible = false;

    const [totalCount, eligibleCount, excludedCount, items] = await prisma.$transaction([
      prisma.participant.count({ where: { giveawayId: id } }),
      prisma.participant.count({ where: { giveawayId: id, eligible: true } }),
      prisma.participant.count({ where: { giveawayId: id, eligible: false } }),
      prisma.participant.findMany({
        where: whereClause,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { platformUserId: 'asc' },
      }),
    ]);

    const participants: FilteredParticipant[] = items.map(p => ({
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

    const relevantCount = tab === 'eligible' ? eligibleCount : tab === 'excluded' ? excludedCount : totalCount;
    const totalPages = Math.ceil(relevantCount / pageSize) || 1;

    return {
      participants,
      page,
      pageSize,
      totalCount,
      eligibleCount,
      excludedCount,
      totalPages,
    };
  }

  async updateStatus(id: string, newStatus: GiveawayStatusType): Promise<GiveawayWithRelations> {
    const current = await this.getGiveawayById(id);
    if (!current) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    GiveawayFSM.validateTransition(current.status, newStatus);

    const updated = await prisma.giveaway.update({
      where: { id },
      data: { status: newStatus as any },
      include: {
        participants: true,
        snapshots: true,
        drawResult: {
          include: { snapshot: true },
        },
      },
    });

    return this.mapPrismaGiveaway(updated);
  }

  async saveParticipants(id: string, participants: FilteredParticipant[]): Promise<GiveawayWithRelations> {
    await prisma.$transaction(async (tx) => {
      // Atomic conditional status guard: only allow replacing participants if status is READY
      const updateRes = await tx.giveaway.updateMany({
        where: {
          id,
          status: 'READY',
        },
        data: {
          status: 'READY',
          updatedAt: new Date(),
        },
      });

      if (updateRes.count === 0) {
        const check = await tx.giveaway.findUnique({ where: { id } });
        if (!check) {
          throw new NotFoundError(`Giveaway with id "${id}" not found`);
        }
        throw new ConflictError(
          `Cannot modify participants: giveaway "${id}" is in status "${check.status}", but requires "READY"`
        );
      }

      await tx.participant.deleteMany({ where: { giveawayId: id } });

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
    });

    const updated = await this.getGiveawayById(id);
    return updated!;
  }

  async createAndLockSnapshot(
    id: string, 
    eligibleParticipants: FilteredParticipant[], 
    rules: FilterRules
  ): Promise<LockedSnapshotResult> {
    const current = await this.getGiveawayById(id);
    if (!current) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    // Strict Single Lock Invariant: Only READY -> SNAPSHOT_LOCKED transition is permitted
    if (current.status !== 'READY') {
      throw new ConflictError(
        `Cannot lock snapshot: giveaway "${id}" is in status "${current.status}", but requires "READY"`
      );
    }

    if (eligibleParticipants.length === 0) {
      throw new ConflictError('Cannot create snapshot with 0 eligible participants');
    }

    const participantsSnapshotHash = computeParticipantsSnapshotHash(eligibleParticipants);
    const conditionsHash = computeConditionsHash(rules);

    try {
      return await prisma.$transaction(async (tx) => {
        // Generate cryptographic seed and commitment
        const seed = generateCryptoSecureSeed();
        const seedCommitment = computeSeedCommitment(seed);

        // Atomic status and seed guard: ONLY transition from READY
        const updateRes = await tx.giveaway.updateMany({
          where: {
            id,
            status: 'READY',
          },
          data: {
            status: 'SNAPSHOT_LOCKED',
            filterRules: rules as any,
            seed: seed,
          },
        });

        if (updateRes.count === 0) {
          throw new ConflictError(`Concurrent modification or invalid status for giveaway "${id}"`);
        }

        const latestSnap = await tx.participantSnapshot.findFirst({
          where: { giveawayId: id },
          orderBy: { version: 'desc' },
        });

        const newVersion = (latestSnap?.version || 0) + 1;

        const snapshot = await tx.participantSnapshot.create({
          data: {
            giveawayId: id,
            version: newVersion,
            eligibleParticipants: eligibleParticipants as any,
            filterRulesSnapshot: rules as any,
            participantCount: eligibleParticipants.length,
            participantsSnapshotHash,
            conditionsHash,
          },
        });

        return {
          snapshot: {
            id: snapshot.id,
            giveawayId: snapshot.giveawayId,
            version: snapshot.version,
            createdAt: snapshot.createdAt.toISOString(),
            eligibleParticipants,
            filterRulesSnapshot: rules,
            participantCount: snapshot.participantCount,
            participantsSnapshotHash: snapshot.participantsSnapshotHash,
            conditionsHash: snapshot.conditionsHash,
          },
          seedCommitment,
        };
      });
    } catch (err: any) {
      if (err instanceof ConflictError) throw err;
      if (err?.code === 'P2002') {
        throw new ConflictError('Concurrent snapshot creation conflict. Please retry.');
      }
      throw err;
    }
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
      filterRulesSnapshot: snap.filterRulesSnapshot as any,
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
    if (!current) throw new NotFoundError(`Giveaway with id "${id}" not found`);

    GiveawayFSM.assertCanDraw(current.status);

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Atomic conditional transition SNAPSHOT_LOCKED -> DRAWN
        const updatedStatus = await tx.giveaway.updateMany({
          where: {
            id,
            status: 'SNAPSHOT_LOCKED',
          },
          data: {
            status: 'DRAWN',
            drawnAt: new Date(result.drawnAt),
            seed: result.seedUsed,
          },
        });

        if (updatedStatus.count === 0) {
          throw new ConflictError(
            `Cannot draw giveaway "${id}": giveaway is not in SNAPSHOT_LOCKED status or has already been drawn`
          );
        }

        // 2. Create DrawResult with unique constraint on giveawayId and snapshotId
        await tx.drawResult.create({
          data: {
            drawId: result.drawId,
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
            deterministicProofHash: result.deterministicProofHash,
            auditEventHash: result.auditEventHash,
            drawnAt: new Date(result.drawnAt),
          },
        });

        // 3. Create AuditRecord
        await tx.auditRecord.create({
          data: {
            giveawayId: id,
            snapshotId: snapshotId,
            algorithmVersion: result.algorithmVersion,
            seed: result.seedUsed,
            participantsSnapshotHash: result.participantsSnapshotHash,
            conditionsHash: result.conditionsHash,
            deterministicProofHash: result.deterministicProofHash,
            auditEventHash: result.auditEventHash,
            winnerIds: result.winnerIds as any,
            reserveWinnerIds: result.reserveWinnerIds as any,
            eligibleCount: result.totalEligibleCount,
            drawId: result.drawId,
            drawnAt: new Date(result.drawnAt),
            verifiedAt: new Date(),
          },
        });
      });
    } catch (err: any) {
      if (err instanceof ConflictError) throw err;
      if (err?.code === 'P2002') {
        throw new ConflictError(`Giveaway "${id}" has already been drawn.`);
      }
      throw err;
    }

    const updated = await this.getGiveawayById(id);
    return updated!;
  }
}
