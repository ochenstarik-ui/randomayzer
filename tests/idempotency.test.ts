import { describe, it, expect } from 'vitest';
import { IdempotencyStore } from '../src/lib/idempotency';

describe('Idempotency Key Store', () => {
  it('should store and return cached idempotent response', () => {
    const key = 'test-idemp-key-1';
    const requestPayload = { result: 'ok', id: '123' };
    const responsePayload = { success: true, createdId: '123' };

    expect(
      IdempotencyStore.get({
        key,
        operation: 'test-op',
        requestPayload,
      })
    ).toBeNull();

    IdempotencyStore.set({
      key,
      operation: 'test-op',
      requestPayload,
      statusCode: 201,
      body: responsePayload,
    });

    const cached = IdempotencyStore.get({
      key,
      operation: 'test-op',
      requestPayload,
    });
    expect(cached).not.toBeNull();
    expect(cached?.statusCode).toBe(201);
    expect(cached?.body).toEqual(responsePayload);
  });
});
