import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/lib/rate-limiter';
import { RateLimitError } from '../src/core/errors/http-errors';

describe('Sliding Window Rate Limiter', () => {
  it('should allow requests within limit and block when threshold exceeded', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 1000,
      maxRequests: 3,
    });

    const key = 'test-user-ip';

    expect(limiter.check(key).allowed).toBe(true);
    expect(limiter.check(key).allowed).toBe(true);
    expect(limiter.check(key).allowed).toBe(true);

    const fourth = limiter.check(key);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);

    expect(() => limiter.assertAllowed(key)).toThrow(RateLimitError);
  });
});
