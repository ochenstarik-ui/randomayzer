import { canonicalStringify, sha256 } from '@/core/randomizer/canonical';
import { IdempotencyKeyReusedError, ValidationError } from '@/core/errors/http-errors';

export interface IdempotentResponse {
  statusCode: number;
  body: any;
  createdAt: number;
  expiresAt: number;
  requestFingerprint: string;
}

export interface IdempotencyLookupParams {
  key: string;
  operation: string;
  giveawayId?: string;
  requestPayload?: any;
}

export interface IdempotencySaveParams extends IdempotencyLookupParams {
  statusCode: number;
  body: any;
  ttlMs?: number;
}

export interface IIdempotencyStore {
  get(params: IdempotencyLookupParams): IdempotentResponse | null;
  set(params: IdempotencySaveParams): void;
  clear(): void;
  size(): number;
  cleanupExpired(): number;
}

export class MemoryIdempotencyStore implements IIdempotencyStore {
  private store = new Map<string, IdempotentResponse>();
  private readonly defaultTtlMs: number;
  private readonly maxKeyLength: number;
  private readonly maxEntries: number;
  private opCounter = 0;

  constructor(options?: { defaultTtlMs?: number; maxKeyLength?: number; maxEntries?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 5 * 60 * 1000; // 5 minutes default
    this.maxKeyLength = options?.maxKeyLength ?? 128;
    this.maxEntries = options?.maxEntries ?? 10000;

    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MEMORY_IDEMPOTENCY !== 'true') {
      console.warn(
        '[SECURITY WARNING] MemoryIdempotencyStore is active in production. ' +
        'In multi-instance deployments, use a shared distributed store (e.g., Redis/KV) to prevent race conditions.'
      );
    }
  }

  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('Idempotency-Key must be a non-empty string');
    }
    if (key.length > this.maxKeyLength) {
      throw new ValidationError(
        `Idempotency-Key length exceeds maximum allowed (${this.maxKeyLength} characters)`
      );
    }
  }

  private buildCompositeKey(operation: string, giveawayId?: string, key?: string): string {
    return `${operation}:${giveawayId || 'global'}:${key}`;
  }

  private computeFingerprint(payload: any): string {
    return sha256(canonicalStringify(payload ?? {}));
  }

  public get(params: IdempotencyLookupParams): IdempotentResponse | null {
    this.validateKey(params.key);
    const compositeKey = this.buildCompositeKey(params.operation, params.giveawayId, params.key);
    const cached = this.store.get(compositeKey);

    if (!cached) return null;

    // Check TTL expiration
    if (Date.now() > cached.expiresAt) {
      this.store.delete(compositeKey);
      return null;
    }

    // Verify request fingerprint matches original request payload
    const currentFingerprint = this.computeFingerprint(params.requestPayload);
    if (cached.requestFingerprint !== currentFingerprint) {
      throw new IdempotencyKeyReusedError(
        `Idempotency key "${params.key}" was previously used for operation "${params.operation}" with different request parameters.`,
        {
          key: params.key,
          operation: params.operation,
          giveawayId: params.giveawayId,
        }
      );
    }

    return cached;
  }

  public set(params: IdempotencySaveParams): void {
    this.validateKey(params.key);
    const compositeKey = this.buildCompositeKey(params.operation, params.giveawayId, params.key);
    const fingerprint = this.computeFingerprint(params.requestPayload);
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;

    // Proactive cleanup
    this.opCounter++;
    if (this.opCounter % 100 === 0 || this.store.size >= this.maxEntries) {
      this.cleanupExpired();
    }

    // If still at capacity after cleanup, evict oldest entry
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(compositeKey, {
      statusCode: params.statusCode,
      body: params.body,
      createdAt: now,
      expiresAt: now + ttl,
      requestFingerprint: fingerprint,
    });
  }

  public cleanupExpired(): number {
    const now = Date.now();
    let deletedCount = 0;

    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) {
        this.store.delete(k);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  public clear(): void {
    this.store.clear();
    this.opCounter = 0;
  }

  public size(): number {
    return this.store.size;
  }
}

// Global Singleton Instance
export const IdempotencyStore: IIdempotencyStore = new MemoryIdempotencyStore();
