import { describe, it, expect } from 'vitest';
import { IdempotencyStore } from '../src/lib/idempotency';

describe('Idempotency Key Store', () => {
  it('should store and return cached idempotent response', () => {
    const key = 'test-idemp-key-1';
    const payload = { result: 'ok', id: '123' };

    expect(IdempotencyStore.get(key)).toBeNull();

    IdempotencyStore.set(key, 201, payload);

    const cached = IdempotencyStore.get(key);
    expect(cached).not.toBeNull();
    expect(cached?.statusCode).toBe(201);
    expect(cached?.body).toEqual(payload);
  });
});
