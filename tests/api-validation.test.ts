import { describe, it, expect } from 'vitest';
import { 
  createGiveawaySchema, 
  executeDrawSchema, 
  validateProviderCapabilities 
} from '../src/core/validation/giveaway-schemas';
import { ValidationError } from '../src/core/errors/http-errors';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';

describe('Zod API Validation & Capability Rules', () => {
  it('should accept valid executeDraw payload', () => {
    const valid = executeDrawSchema.parse({
      winnersCount: 5,
      reserveWinnersCount: 2,
    });

    expect(valid.winnersCount).toBe(5);
    expect(valid.reserveWinnersCount).toBe(2);
  });

  it('should strictly reject seed parameter in executeDraw payload', () => {
    expect(() =>
      executeDrawSchema.parse({
        winnersCount: 5,
        reserveWinnersCount: 2,
        seed: 'client-supplied-seed',
      })
    ).toThrow();
  });

  it('should reject winnersCount outside 1..100', () => {
    expect(() => executeDrawSchema.parse({ winnersCount: 0 })).toThrow();
    expect(() => executeDrawSchema.parse({ winnersCount: 101 })).toThrow();
    expect(() => executeDrawSchema.parse({ winnersCount: -5 })).toThrow();
  });

  it('should reject reserveWinnersCount outside 0..100', () => {
    expect(() => executeDrawSchema.parse({ reserveWinnersCount: -1 })).toThrow();
    expect(() => executeDrawSchema.parse({ reserveWinnersCount: 105 })).toThrow();
  });

  it('should reject URL longer than 2048 characters in createGiveaway', () => {
    const longUrl = 'https://vk.com/wall-1_1?' + 'x'.repeat(2100);
    expect(() =>
      createGiveawaySchema.parse({
        sourceUrl: longUrl,
        post: {
          platform: 'VK',
          ownerId: '-1',
          postId: '1',
          sourceUrl: 'https://vk.com/wall-1_1',
          title: 'Title',
          likesCount: 0,
          commentsCount: 0,
          repostsCount: 0,
        },
      })
    ).toThrow();
  });

  it('should throw ValidationError when unsupported repost condition is requested', () => {
    const vkCapabilities = {
      likes: true,
      comments: true,
      reposts: false,
      subscriptions: true,
      adminDetection: false,
    };

    expect(() =>
      validateProviderCapabilities(
        { ...DEFAULT_FILTER_RULES, requireRepost: true },
        vkCapabilities
      )
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when admin detection is requested without capability', () => {
    const vkCapabilities = {
      likes: true,
      comments: true,
      reposts: false,
      subscriptions: true,
      adminDetection: false,
    };

    expect(() =>
      validateProviderCapabilities(
        { ...DEFAULT_FILTER_RULES, excludeAdmins: true },
        vkCapabilities
      )
    ).toThrow(ValidationError);
  });
});
