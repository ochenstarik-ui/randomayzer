export interface IVkRateLimiter {
  acquire(key?: string): Promise<void>;
  reset(): void;
}

export interface VkRateLimiterOptions {
  maxRequestsPerSecond?: number;
  minIntervalMs?: number;
}

/**
 * Client-side rate limiter for throttling outbound requests to the VK API.
 * Ensures the client stays within official VK API thresholds (default: 3 req/sec user, up to 20 req/sec service).
 */
export class VkRateLimiter implements IVkRateLimiter {
  private lastRequestTime = 0;
  private readonly minIntervalMs: number;
  private queue: Array<() => void> = [];
  private isProcessing = false;

  constructor(options?: VkRateLimiterOptions) {
    const rps = options?.maxRequestsPerSecond ?? 3;
    this.minIntervalMs = options?.minIntervalMs ?? Math.ceil(1000 / rps);
  }

  public async acquire(): Promise<void> {
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.minIntervalMs - timeSinceLast);

      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
      }

      this.lastRequestTime = Date.now();
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        nextResolve();
      }
    }

    this.isProcessing = false;
  }

  public reset(): void {
    this.queue = [];
    this.lastRequestTime = 0;
    this.isProcessing = false;
  }
}

export const defaultVkRateLimiter: IVkRateLimiter = new VkRateLimiter({
  maxRequestsPerSecond: 10,
});
