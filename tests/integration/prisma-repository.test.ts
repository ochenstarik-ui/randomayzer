import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { PrismaGiveawayRepository } from '../../src/lib/repository/prisma-repository';
import { PrismaUserRepository } from '../../src/lib/repository/user-repository';
import { DEFAULT_FILTER_RULES } from '../../src/core/types/giveaway';
import { FilteredParticipant } from '../../src/core/types/participant';
import { ConflictError } from '../../src/core/errors/http-errors';
import { computeSeedCommitment } from '../../src/core/randomizer/hasher';
import { DrawExecutionResult } from '../../src/core/types/audit';

// Ensure DATABASE_URL is explicitly configured for integration runs
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is required to run Prisma integration tests. ' +
    'Please set DATABASE_URL to a running PostgreSQL database (e.g. postgresql://postgres:postgres@localhost:5432/randomayzer).'
  );
}

describe('Task 08: Prisma Integration Test Harness (PostgreSQL)', () => {
  const giveawayRepo = new PrismaGiveawayRepository();
  const userRepo = new PrismaUserRepository();

  let testOrganizer: { id: string; vkUserId: string };

  beforeAll(async () => {
    try {
      await prisma.$connect();
    } catch (err: any) {
      throw new Error(
        `Failed to connect to PostgreSQL at "${DATABASE_URL}": ${err.message}. Ensure database is running and migrations are applied.`
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean all tables in reverse dependency order
    await prisma.auditRecord.deleteMany();
    await prisma.drawResult.deleteMany();
    await prisma.participantSnapshot.deleteMany();
    await prisma.participant.deleteMany();
    await prisma.giveaway.deleteMany();
    await prisma.userCredential.deleteMany();
    await prisma.session.deleteMany();
    await prisma.oAuthTransaction.deleteMany();
    await prisma.user.deleteMany();

    // Create a base test organizer user
    testOrganizer = await userRepo.upsertUserWithTokens({
      vkUserId: '888777666',
      firstName: 'Integration',
      lastName: 'Organizer',
      encryptedAccessToken: 'enc_access_token_123',
      encryptedRefreshToken: 'enc_refresh_token_123',
      expiresIn: 86400,
    });
  });

  const sampleParticipants: FilteredParticipant[] = Array.from({ length: 15 }, (_, i) => ({
    platformUserId: `${1000 + i}`,
    firstName: `User${i}`,
    lastName: `Test${i}`,
    source: 'LIKES' as const,
    liked: true,
    commented: i % 2 === 0,
    commentsCount: i % 2 === 0 ? 1 : 0,
    reposted: false,
    subscribed: true,
    eligible: i < 10,
    exclusionReason: i >= 10 ? 'NOT_SUBSCRIBED' : null,
  }));

  const eligibleOnly = sampleParticipants.filter(p => p.eligible);

  async function createReadyGiveaway() {
    const gw = await giveawayRepo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-123_456',
      post: {
        platform: 'VK',
        ownerId: '-123',
        postId: '456',
        sourceUrl: 'https://vk.com/wall-123_456',
        title: 'Prisma Integration Giveaway',
        text: 'Integration test post content',
        likesCount: 15,
        commentsCount: 8,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: testOrganizer.id,
    });

    await giveawayRepo.saveParticipants(gw.id, sampleParticipants);
    return gw;
  }

  // ─── 1. createAndLockSnapshot: Atomic seed generation & status lock ───────────
  it('createAndLockSnapshot: atomically locks snapshot, generates seed, computes commitment, and transitions to SNAPSHOT_LOCKED', async () => {
    const gw = await createReadyGiveaway();

    const locked = await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);

    expect(locked.snapshot).toBeDefined();
    expect(locked.snapshot.version).toBe(1);
    expect(locked.snapshot.participantCount).toBe(10); // 10 eligible participants
    expect(locked.snapshot.participantsSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(locked.snapshot.conditionsHash).toMatch(/^[a-f0-9]{64}$/);

    // Verify DB state
    const fromDb = await giveawayRepo.getGiveawayById(gw.id);
    expect(fromDb?.status).toBe('SNAPSHOT_LOCKED');
    expect(fromDb?.seed).toMatch(/^[a-f0-9]{64}$/);
    expect(locked.seedCommitment).toBe(computeSeedCommitment(fromDb!.seed!));
  });

  // ─── 2. Single Lock Invariant ────────────────────────────────────────────────
  it('createAndLockSnapshot: repeated lock on SNAPSHOT_LOCKED throws ConflictError', async () => {
    const gw = await createReadyGiveaway();

    await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);

    // Second lock attempt must fail with ConflictError
    await expect(
      giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES)
    ).rejects.toThrow(ConflictError);
  });

  // ─── 3. Concurrent lock attempts: Exactly 1 succeeds on PostgreSQL ────────────
  it('createAndLockSnapshot: 10 concurrent requests result in exactly 1 successful lock', async () => {
    const gw = await createReadyGiveaway();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES)
      )
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(ConflictError);
      }
    }

    const finalGw = await giveawayRepo.getGiveawayById(gw.id);
    expect(finalGw?.status).toBe('SNAPSHOT_LOCKED');
  });

  // ─── 4. saveDrawResultAndAudit: Atomic transition to DRAWN ────────────────────
  it('saveDrawResultAndAudit: transitions SNAPSHOT_LOCKED to DRAWN and creates DrawResult + AuditRecord', async () => {
    const gw = await createReadyGiveaway();
    const locked = await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);
    const lockedGw = (await giveawayRepo.getGiveawayById(gw.id))!;

    const drawResult: DrawExecutionResult = {
      drawId: `draw_${Date.now()}`,
      giveawayId: gw.id,
      snapshotId: locked.snapshot.id,
      winners: [
        {
          position: 1,
          participant: locked.snapshot.eligibleParticipants[0],
          isReserve: false,
          selectionIndex: 0,
          proofHash: 'proof_win_1',
        },
      ],
      reserveWinners: [],
      winnerIds: [locked.snapshot.eligibleParticipants[0].platformUserId],
      reserveWinnerIds: [],
      totalEligibleCount: locked.snapshot.participantCount,
      totalLoadedCount: 15,
      seedUsed: lockedGw.seed!,
      algorithmVersion: 'HMAC_SHA256_FY_V1',
      deterministicProofHash: 'a'.repeat(64),
      auditEventHash: 'b'.repeat(64),
      drawnAt: new Date().toISOString(),
      participantsSnapshotHash: locked.snapshot.participantsSnapshotHash,
      conditionsHash: locked.snapshot.conditionsHash,
    };

    const drawnGw = await giveawayRepo.saveDrawResultAndAudit(gw.id, locked.snapshot.id, drawResult);

    expect(drawnGw.status).toBe('DRAWN');
    expect(drawnGw.drawnAt).toBeDefined();
    expect(drawnGw.drawResult).toBeDefined();
    expect(drawnGw.drawResult?.drawId).toBe(drawResult.drawId);

    // Verify AuditRecord in DB
    const auditInDb = await prisma.auditRecord.findFirst({ where: { giveawayId: gw.id } });
    expect(auditInDb).toBeDefined();
    expect(auditInDb?.seed).toBe(lockedGw.seed);
    expect(auditInDb?.deterministicProofHash).toBe('a'.repeat(64));
  });

  // ─── 5. saveDrawResultAndAudit: Repeat draw prevention (P2002) ────────────────
  it('saveDrawResultAndAudit: second draw attempt on DRAWN giveaway throws ConflictError', async () => {
    const gw = await createReadyGiveaway();
    const locked = await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);
    const lockedGw = (await giveawayRepo.getGiveawayById(gw.id))!;

    const drawResult: DrawExecutionResult = {
      drawId: `draw_${Date.now()}`,
      giveawayId: gw.id,
      snapshotId: locked.snapshot.id,
      winners: [
        {
          position: 1,
          participant: locked.snapshot.eligibleParticipants[0],
          isReserve: false,
          selectionIndex: 0,
          proofHash: 'proof_win_1',
        },
      ],
      reserveWinners: [],
      winnerIds: [locked.snapshot.eligibleParticipants[0].platformUserId],
      reserveWinnerIds: [],
      totalEligibleCount: locked.snapshot.participantCount,
      totalLoadedCount: 15,
      seedUsed: lockedGw.seed!,
      algorithmVersion: 'HMAC_SHA256_FY_V1',
      deterministicProofHash: 'a'.repeat(64),
      auditEventHash: 'b'.repeat(64),
      drawnAt: new Date().toISOString(),
      participantsSnapshotHash: locked.snapshot.participantsSnapshotHash,
      conditionsHash: locked.snapshot.conditionsHash,
    };

    await giveawayRepo.saveDrawResultAndAudit(gw.id, locked.snapshot.id, drawResult);

    // Second draw must fail
    await expect(
      giveawayRepo.saveDrawResultAndAudit(gw.id, locked.snapshot.id, {
        ...drawResult,
        drawId: `draw_repeat_${Date.now()}`,
      })
    ).rejects.toThrow(ConflictError);
  });

  // ─── 6. unlockSnapshot: SNAPSHOT_LOCKED -> READY and resets seed ──────────────
  it('unlockSnapshot: transitions SNAPSHOT_LOCKED to READY and resets seed to null', async () => {
    const gw = await createReadyGiveaway();
    await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);

    const unlocked = await giveawayRepo.unlockSnapshot(gw.id);

    expect(unlocked.status).toBe('READY');
    expect(unlocked.seed).toBeNull();

    const fromDb = await giveawayRepo.getGiveawayById(gw.id);
    expect(fromDb?.status).toBe('READY');
    expect(fromDb?.seed).toBeNull();
  });

  // ─── 7. Snapshot versioning across unlock & relock ────────────────────────────
  it('snapshot versioning: re-locking creates version 2 and preserves version 1 in DB', async () => {
    const gw = await createReadyGiveaway();

    const lock1 = await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);
    expect(lock1.snapshot.version).toBe(1);
    const seed1 = (await giveawayRepo.getGiveawayById(gw.id))?.seed;

    await giveawayRepo.unlockSnapshot(gw.id);

    const lock2 = await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);
    expect(lock2.snapshot.version).toBe(2);
    const seed2 = (await giveawayRepo.getGiveawayById(gw.id))?.seed;
    expect(seed2).not.toBe(seed1);

    // Verify all snapshots in DB
    const allSnaps = await prisma.participantSnapshot.findMany({
      where: { giveawayId: gw.id },
      orderBy: { version: 'asc' },
    });
    expect(allSnaps).toHaveLength(2);
    expect(allSnaps[0].version).toBe(1);
    expect(allSnaps[1].version).toBe(2);
  });

  // ─── 8. saveParticipants: Requires READY status ───────────────────────────────
  it('saveParticipants: throws ConflictError when giveaway is in SNAPSHOT_LOCKED status', async () => {
    const gw = await createReadyGiveaway();
    await giveawayRepo.createAndLockSnapshot(gw.id, eligibleOnly, DEFAULT_FILTER_RULES);

    await expect(
      giveawayRepo.saveParticipants(gw.id, sampleParticipants)
    ).rejects.toThrow(ConflictError);
  });

  // ─── 9. Ownership: onDelete: Restrict on User -> Giveaway ────────────────────
  it('ownership constraint: deleting a user with existing giveaways throws foreign key violation', async () => {
    await createReadyGiveaway();

    // Attempting to delete the user must fail with Prisma foreign key violation
    await expect(
      prisma.user.delete({ where: { id: testOrganizer.id } })
    ).rejects.toThrow();
  });

  // ─── 10. getParticipantsPaginated: Pagination and counts ─────────────────────
  it('getParticipantsPaginated: correctly calculates counts and returns paginated slice', async () => {
    const gw = await createReadyGiveaway();

    const page1 = await giveawayRepo.getParticipantsPaginated(gw.id, 1, 5, 'all');
    expect(page1.totalCount).toBe(15);
    expect(page1.eligibleCount).toBe(10);
    expect(page1.excludedCount).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.participants).toHaveLength(5);

    const eligiblePage = await giveawayRepo.getParticipantsPaginated(gw.id, 1, 20, 'eligible');
    expect(eligiblePage.participants).toHaveLength(10);
    expect(eligiblePage.participants.every(p => p.eligible)).toBe(true);

    const excludedPage = await giveawayRepo.getParticipantsPaginated(gw.id, 1, 20, 'excluded');
    expect(excludedPage.participants).toHaveLength(5);
    expect(excludedPage.participants.every(p => !p.eligible)).toBe(true);
  });

  // ─── 11. PrismaUserRepository: updateCredentialConditionally CAS ─────────────
  it('PrismaUserRepository: updateCredentialConditionally succeeds with matching updatedAt and fails on stale', async () => {
    const credBefore = await userRepo.getUserCredentials(testOrganizer.id);
    expect(credBefore).toBeDefined();

    // 1. Valid update with expected updatedAt
    const success = await userRepo.updateCredentialConditionally(
      testOrganizer.id,
      {
        encryptedAccessToken: 'fresh_enc_access_token',
        encryptedRefreshToken: 'fresh_enc_refresh_token',
        expiresAt: new Date(Date.now() + 3600000),
      },
      credBefore!.updatedAt
    );
    expect(success).toBe(true);

    // 2. Stale update with old updatedAt
    const staleAttempt = await userRepo.updateCredentialConditionally(
      testOrganizer.id,
      {
        encryptedAccessToken: 'stale_token',
        encryptedRefreshToken: 'stale_refresh',
        expiresAt: null,
      },
      credBefore!.updatedAt // Old timestamp
    );
    expect(staleAttempt).toBe(false);
  });

  // ─── 12. listGiveawaysSummary: eligibleParticipantsCount parity ──────────────
  it('listGiveawaysSummary: calculates eligibleParticipantsCount for undrawn and drawn giveaways without full participant load', async () => {
    // 1. Create undrawn giveaway with 15 total (10 eligible)
    const gw1 = await createReadyGiveaway();

    // 2. Create second giveaway and draw it
    const gw2 = await giveawayRepo.createGiveaway({
      sourceUrl: 'https://vk.com/wall-123_789',
      post: {
        platform: 'VK',
        ownerId: '-123',
        postId: '789',
        sourceUrl: 'https://vk.com/wall-123_789',
        title: 'Drawn Giveaway',
        text: 'Drawn content',
        likesCount: 15,
        commentsCount: 8,
        repostsCount: 0,
      },
      filterRules: DEFAULT_FILTER_RULES,
      organizerId: testOrganizer.id,
    });
    await giveawayRepo.saveParticipants(gw2.id, sampleParticipants);
    const locked2 = await giveawayRepo.createAndLockSnapshot(gw2.id, eligibleOnly, DEFAULT_FILTER_RULES);
    const lockedGw2 = (await giveawayRepo.getGiveawayById(gw2.id))!;

    await giveawayRepo.saveDrawResultAndAudit(gw2.id, locked2.snapshot.id, {
      drawId: `draw_summary_test_2`,
      giveawayId: gw2.id,
      snapshotId: locked2.snapshot.id,
      winners: [{ position: 1, participant: locked2.snapshot.eligibleParticipants[0], isReserve: false, selectionIndex: 0, proofHash: 'p' }],
      reserveWinners: [],
      winnerIds: [locked2.snapshot.eligibleParticipants[0].platformUserId],
      reserveWinnerIds: [],
      totalEligibleCount: 10,
      totalLoadedCount: 15,
      seedUsed: lockedGw2.seed!,
      algorithmVersion: 'HMAC_SHA256_FY_V1',
      deterministicProofHash: 'c'.repeat(64),
      auditEventHash: 'd'.repeat(64),
      drawnAt: new Date().toISOString(),
      participantsSnapshotHash: locked2.snapshot.participantsSnapshotHash,
      conditionsHash: locked2.snapshot.conditionsHash,
    });

    const summaries = await giveawayRepo.listGiveawaysSummary(testOrganizer.id);
    expect(summaries).toHaveLength(2);

    // gw2 (drawn)
    const summary2 = summaries.find(s => s.id === gw2.id);
    expect(summary2?.totalParticipantsCount).toBe(15);
    expect(summary2?.eligibleParticipantsCount).toBe(10);
    expect(summary2?.hasDrawResult).toBe(true);

    // gw1 (undrawn)
    const summary1 = summaries.find(s => s.id === gw1.id);
    expect(summary1?.totalParticipantsCount).toBe(15);
    expect(summary1?.eligibleParticipantsCount).toBe(10);
    expect(summary1?.hasDrawResult).toBe(false);
  });
});
