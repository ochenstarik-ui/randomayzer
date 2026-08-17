import { IGiveawayRepository, GiveawayWithRelations, CreateGiveawayInput } from './repository/giveaway-repository';
import { PrismaGiveawayRepository } from './repository/prisma-repository';
import { MemoryGiveawayRepository } from './repository/memory-repository';
import { FilterRules, GiveawayStatusType } from '../core/types/giveaway';
import { FilteredParticipant } from '../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../core/types/audit';

export type StoredGiveaway = GiveawayWithRelations;

let activeRepository: IGiveawayRepository = new PrismaGiveawayRepository();

export class GiveawayStore {
  /**
   * Set custom repository (e.g. MemoryGiveawayRepository in tests)
   */
  static setRepository(repo: IGiveawayRepository): void {
    activeRepository = repo;
  }

  static getRepository(): IGiveawayRepository {
    return activeRepository;
  }

  static async create(input: CreateGiveawayInput): Promise<StoredGiveaway> {
    try {
      return await activeRepository.createGiveaway(input);
    } catch (err) {
      if (activeRepository instanceof PrismaGiveawayRepository) {
        console.warn('Prisma DB error, falling back to memory repository:', (err as Error).message);
        activeRepository = new MemoryGiveawayRepository();
        return await activeRepository.createGiveaway(input);
      }
      throw err;
    }
  }

  static async getById(id: string): Promise<StoredGiveaway | null> {
    try {
      return await activeRepository.getGiveawayById(id);
    } catch (err) {
      if (activeRepository instanceof PrismaGiveawayRepository) {
        activeRepository = new MemoryGiveawayRepository();
        return await activeRepository.getGiveawayById(id);
      }
      throw err;
    }
  }

  static async listAll(): Promise<StoredGiveaway[]> {
    try {
      return await activeRepository.listGiveaways();
    } catch (err) {
      if (activeRepository instanceof PrismaGiveawayRepository) {
        activeRepository = new MemoryGiveawayRepository();
        return await activeRepository.listGiveaways();
      }
      throw err;
    }
  }

  static async updateParticipants(id: string, participants: FilteredParticipant[]): Promise<StoredGiveaway> {
    return await activeRepository.saveParticipants(id, participants);
  }

  static async createAndLockSnapshot(
    id: string, 
    eligibleParticipants: FilteredParticipant[], 
    rules: FilterRules
  ): Promise<ParticipantSnapshotData> {
    return await activeRepository.createAndLockSnapshot(id, eligibleParticipants, rules);
  }

  static async getLatestSnapshot(giveawayId: string): Promise<ParticipantSnapshotData | null> {
    return await activeRepository.getLatestSnapshot(giveawayId);
  }

  static async saveDrawResult(id: string, snapshotId: string, result: DrawExecutionResult): Promise<StoredGiveaway> {
    return await activeRepository.saveDrawResultAndAudit(id, snapshotId, result);
  }
}
