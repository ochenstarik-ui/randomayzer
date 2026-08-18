import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { PrismaGiveawayRepository } from '../src/lib/repository/prisma-repository';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { IGiveawayRepository } from '../src/lib/repository/giveaway-repository';

describe('Storage Driver Policy & No Silent Fallback', () => {
  beforeEach(() => {
    delete process.env.STORAGE_DRIVER;
    GiveawayStore.resetToDefault();
  });

  afterEach(() => {
    delete process.env.STORAGE_DRIVER;
    GiveawayStore.resetToDefault();
  });

  it('should default to PrismaGiveawayRepository when STORAGE_DRIVER is not memory', () => {
    const repo = GiveawayStore.getRepository();
    expect(repo).toBeInstanceOf(PrismaGiveawayRepository);
  });

  it('should use MemoryGiveawayRepository when STORAGE_DRIVER=memory is explicitly configured', () => {
    process.env.STORAGE_DRIVER = 'memory';
    GiveawayStore.resetToDefault();

    const repo = GiveawayStore.getRepository();
    expect(repo).toBeInstanceOf(MemoryGiveawayRepository);
  });

  it('should throw database errors explicitly without silently falling back to memory', async () => {
    // Mock a failing Prisma repository
    const failingDbRepo: IGiveawayRepository = {
      createGiveaway: async () => {
        throw new Error('P1001: Can\'t reach database server at `localhost:5432`');
      },
      getGiveawayById: async () => {
        throw new Error('Database connection timeout');
      },
      listGiveaways: async () => {
        throw new Error('Database connection failed');
      },
      updateStatus: async () => { throw new Error('DB error'); },
      saveParticipants: async () => { throw new Error('DB error'); },
      createAndLockSnapshot: async () => { throw new Error('DB error'); },
      getLatestSnapshot: async () => { throw new Error('DB error'); },
      saveDrawResultAndAudit: async () => { throw new Error('DB error'); },
    };

    GiveawayStore.setRepository(failingDbRepo);

    // Assert that calling create throws the exact database error
    await expect(
      GiveawayStore.create({
        sourceUrl: 'https://vk.com/wall-1_1',
        post: {
          platform: 'VK',
          ownerId: '-1',
          postId: '1',
          sourceUrl: 'https://vk.com/wall-1_1',
          title: 'Test',
          text: 'Text',
          likesCount: 10,
          commentsCount: 5,
          repostsCount: 2,
        },
        filterRules: {} as any,
        organizerId: 'usr_test_driver',
      })
    ).rejects.toThrow(/Can't reach database server/);

    // Assert active repository remains the failing one and did not silently switch to memory
    expect(GiveawayStore.getRepository()).toBe(failingDbRepo);
  });
});
