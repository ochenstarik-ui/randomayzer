import { z } from 'zod';
import { FilterRules } from '../types/giveaway';
import { ProviderCapabilities } from '../../providers/types';
import { ValidationError } from '../errors/http-errors';

export const filterRulesSchema = z.object({
  requireLike: z.boolean().default(false),
  requireComment: z.boolean().default(false),
  requireRepost: z.boolean().default(false),
  requireSubscription: z.boolean().default(false),
  excludeAdmins: z.boolean().default(false),
  excludeDuplicateComments: z.boolean().default(true),
  excludeBlacklistedIds: z.array(z.string().max(128)).max(1000).default([]),
  targetGroupId: z.string().max(128).optional(),
  minEligibleParticipants: z.number().int().min(1).max(100000).default(1),
}).strict();

const defaultRulesObject = {
  requireLike: true,
  requireComment: false,
  requireRepost: false,
  requireSubscription: false,
  excludeAdmins: false,
  excludeDuplicateComments: true,
  excludeBlacklistedIds: [] as string[],
  minEligibleParticipants: 1,
};

export const postMetadataSchema = z.object({
  platform: z.enum(['VK', 'TELEGRAM', 'YOUTUBE']),
  ownerId: z.string().min(1).max(128),
  postId: z.string().min(1).max(128),
  sourceUrl: z.string().url().max(2048),
  title: z.string().max(512),
  text: z.string().max(10000).default(''),
  imageUrl: z.string().url().max(2048).nullish().transform(v => v ?? undefined),
  authorName: z.string().max(256).optional(),
  authorAvatarUrl: z.string().url().max(2048).nullish().transform(v => v ?? undefined),
  likesCount: z.number().int().min(0).default(0),
  commentsCount: z.number().int().min(0).default(0),
  repostsCount: z.number().int().min(0).default(0),
});

export const createGiveawaySchema = z.object({
  sourceUrl: z.string().min(1).max(2048),
  post: postMetadataSchema,
  filterRules: filterRulesSchema.default(defaultRulesObject),
  winnersCount: z.number().int().min(1).max(100).default(1),
  reserveWinnersCount: z.number().int().min(0).max(100).default(0),
  seed: z.string().max(512).optional(),
}).strict();

export const fetchParticipantsSchema = z.object({
  filterRules: filterRulesSchema.default(defaultRulesObject),
}).strict();

export const createSnapshotSchema = z.object({
  filterRules: filterRulesSchema.default(defaultRulesObject),
}).strict();

export const executeDrawSchema = z.object({
  winnersCount: z.number().int().min(1).max(100).default(1),
  reserveWinnersCount: z.number().int().min(0).max(100).default(0),
  seed: z.string().max(512).optional(),
}).strict();

export const postPreviewSchema = z.object({
  url: z.string().min(1).max(2048),
  platform: z.enum(['VK', 'TELEGRAM', 'YOUTUBE']).default('VK'),
}).strict();

/**
 * Validates requested filter rules against provider capabilities
 */
export function validateProviderCapabilities(
  rules: FilterRules,
  capabilities: ProviderCapabilities
): void {
  if (rules.requireRepost && !capabilities.reposts) {
    throw new ValidationError(
      'Repost verification is not supported due to VK API privacy limitations',
      { condition: 'requireRepost' }
    );
  }

  if (rules.excludeAdmins && !capabilities.adminDetection) {
    throw new ValidationError(
      'Admin detection requires VK ID organizer authorization',
      { condition: 'excludeAdmins' }
    );
  }
}
