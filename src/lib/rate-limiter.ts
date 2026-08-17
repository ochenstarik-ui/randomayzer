import { RateLimitError } from '../core/errors/http-errors';

interface RateLimitRecord {
  timestamps: number[];
  lastAccessed: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  maxBuckets?: number;
}

export class SlidingWindowRateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxBuckets: number;
  private opCounter = 0;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.maxBuckets = options.maxBuckets ?? 50000;

    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MEMORY_RATE_LIMITER !== 'true') {
      console.warn(
        '[SECURITY WARNING] SlidingWindowRateLimiter (In-Memory) is active in production. ' +
        'In multi-instance deployments, use a distributed edge/Redis limiter.'
      );
    }
  }

  public check(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    this.opCounter++;
    if (this.opCounter % 200 === 0 || this.records.size >= this.maxBuckets) {
      this.cleanupExpired();
    }

    let record = this.records.get(key);
    if (!record) {
      if (this.records.size >= this.maxBuckets) {
        const oldestKey = this.records.keys().next().value;
        if (oldestKey) this.records.delete(oldestKey);
      }

      record = { timestamps: [], lastAccessed: now };
      this.records.set(key, record);
    }

    record.lastAccessed = now;

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

  public cleanupExpired(): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let deletedCount = 0;

    for (const [k, v] of this.records.entries()) {
      v.timestamps = v.timestamps.filter(ts => ts > windowStart);
      if (v.timestamps.length === 0 && now - v.lastAccessed > this.windowMs) {
        this.records.delete(k);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  public reset(): void {
    this.records.clear();
    this.opCounter = 0;
  }

  public size(): number {
    return this.records.size;
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
