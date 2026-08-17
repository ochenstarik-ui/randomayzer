import { IGiveawayRepository, GiveawayWithRelations, CreateGiveawayInput } from './repository/giveaway-repository';
import { PrismaGiveawayRepository } from './repository/prisma-repository';
import { MemoryGiveawayRepository } from './repository/memory-repository';
import { FilterRules } from '../core/types/giveaway';
import { FilteredParticipant } from '../core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '../core/types/audit';

export type StoredGiveaway = GiveawayWithRelations;

// Select initial repository based on explicit STORAGE_DRIVER configuration
function createDefaultRepository(): IGiveawayRepository {
  if (process.env.STORAGE_DRIVER === 'memory') {
    return new MemoryGiveawayRepository();
  }
  return new PrismaGiveawayRepository();
}

let activeRepository: IGiveawayRepository = createDefaultRepository();

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

  /**
   * Reset repository to environment default
   */
  static resetToDefault(): void {
    activeRepository = createDefaultRepository();
  }

  static async create(input: CreateGiveawayInput): Promise<StoredGiveaway> {
    return await activeRepository.createGiveaway(input);
  }

  static async getById(id: string): Promise<StoredGiveaway | null> {
    return await activeRepository.getGiveawayById(id);
  }

  static async listAll(): Promise<StoredGiveaway[]> {
    return await activeRepository.listGiveaways();
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
