import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryIdempotencyStore } from '../src/lib/idempotency';
import { IdempotencyKeyReusedError, ValidationError } from '../src/core/errors/http-errors';

describe('Idempotency Hardening & Request Fingerprinting', () => {
  let store: MemoryIdempotencyStore;

  beforeEach(() => {
    store = new MemoryIdempotencyStore({ defaultTtlMs: 1000, maxKeyLength: 128, maxEntries: 100 });
  });

  it('returns cached response for same key and identical request payload', () => {
    const key = 'test-key-1';
    const payload = { sourceUrl: 'https://vk.com/wall-1_1', winnersCount: 1 };
    const responseBody = { success: true, giveawayId: 'gw-1' };

    store.set({
      key,
      operation: 'create-giveaway',
      giveawayId: 'gw-1',
      requestPayload: payload,
      statusCode: 201,
      body: responseBody,
    });

    const cached = store.get({
      key,
      operation: 'create-giveaway',
      giveawayId: 'gw-1',
      requestPayload: payload,
    });

    expect(cached).not.toBeNull();
    expect(cached?.statusCode).toBe(201);
    expect(cached?.body).toEqual(responseBody);
  });

  it('throws IdempotencyKeyReusedError (409) when same key is used with different payload', () => {
    const key = 'test-key-reused';
    const originalPayload = { sourceUrl: 'https://vk.com/wall-1_1', winnersCount: 1 };
    const modifiedPayload = { sourceUrl: 'https://vk.com/wall-1_1', winnersCount: 5 }; // Changed!

    store.set({
      key,
      operation: 'create-giveaway',
      giveawayId: 'gw-1',
      requestPayload: originalPayload,
      statusCode: 201,
      body: { success: true },
    });

    expect(() =>
      store.get({
        key,
        operation: 'create-giveaway',
        giveawayId: 'gw-1',
        requestPayload: modifiedPayload,
      })
    ).toThrow(IdempotencyKeyReusedError);
  });

  it('prevents collision across different operations or giveaways with identical key', () => {
    const key = 'shared-key-id';
    const payload = { test: 123 };

    store.set({
      key,
      operation: 'operation-A',
      giveawayId: 'gw-1',
      requestPayload: payload,
      statusCode: 200,
      body: { op: 'A' },
    });

    // Lookup under operation-B with same key must return null
    const resB = store.get({
      key,
      operation: 'operation-B',
      giveawayId: 'gw-1',
      requestPayload: payload,
    });
    expect(resB).toBeNull();

    // Lookup under different giveaway must return null
    const resGw2 = store.get({
      key,
      operation: 'operation-A',
      giveawayId: 'gw-2',
      requestPayload: payload,
    });
    expect(resGw2).toBeNull();
  });

  it('rejects keys exceeding maximum allowed length', () => {
    const oversizedKey = 'a'.repeat(129);
    expect(() =>
      store.get({
        key: oversizedKey,
        operation: 'op',
        requestPayload: {},
      })
    ).toThrow(ValidationError);
  });

  it('cleans up expired entries proactively', async () => {
    const shortTtlStore = new MemoryIdempotencyStore({ defaultTtlMs: 20 });
    shortTtlStore.set({
      key: 'expiring-key',
      operation: 'op',
      requestPayload: { a: 1 },
      statusCode: 200,
      body: { ok: true },
    });

    expect(shortTtlStore.size()).toBe(1);

    await new Promise(r => setTimeout(r, 40));

    const res = shortTtlStore.get({
      key: 'expiring-key',
      operation: 'op',
      requestPayload: { a: 1 },
    });

    expect(res).toBeNull();
  });

  it('handles bounded capacity with synthetic keys without memory leak', () => {
    const boundedStore = new MemoryIdempotencyStore({ maxEntries: 50, defaultTtlMs: 10000 });

    for (let i = 0; i < 200; i++) {
      boundedStore.set({
        key: `synth-key-${i}`,
        operation: 'op',
        requestPayload: { index: i },
        statusCode: 200,
        body: { i },
      });
    }

    // Capacity must not exceed maxEntries
    expect(boundedStore.size()).toBeLessThanOrEqual(50);
  });
});
