import { RateLimitError } from '../core/errors/http-errors';

interface RateLimitRecord {
  timestamps: number[];
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export class SlidingWindowRateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  public check(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Purge timestamps outside current window
    record.timestamps = record.timestamps.filter(ts => ts > windowStart);

    if (record.timestamps.length >= this.maxRequests) {
      const oldest = record.timestamps[0];
      const resetInMs = Math.max(0, oldest + this.windowMs - now);
      return { allowed: false, remaining: 0, resetInMs };
    }

    record.timestamps.push(now);
    const remaining = this.maxRequests - record.timestamps.length;
    return { allowed: true, remaining, resetInMs: this.windowMs };
  }

  public assertAllowed(key: string): void {
    const result = this.check(key);
    if (!result.allowed) {
      throw new RateLimitError(
        `Rate limit exceeded. Please retry after ${Math.ceil(result.resetInMs / 1000)} seconds.`,
        { retryAfterMs: result.resetInMs }
      );
    }
  }

  public reset(): void {
    this.records.clear();
  }
}

// Global default limiter instances for expensive operations
export const expensiveApiRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 10_000, // 10 seconds
  maxRequests: 15,
});

export const generalApiRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000, // 1 minute
  maxRequests: 120,
});
