import { randomBytes, createHash } from 'crypto';
import { UnauthorizedError, ValidationError } from '@/core/errors/http-errors';

export interface OAuthTransaction {
  state: string;
  codeVerifier: string;
  redirectTarget: string;
  createdAt: number;
  expiresAt: number;
}

export interface IOAuthTransactionStore {
  createTransaction(options?: {
    redirectTarget?: string;
    ttlMs?: number;
  }): Promise<{ state: string; codeVerifier: string; codeChallenge: string }>;
  consumeTransaction(state: string): Promise<{ codeVerifier: string; redirectTarget: string }>;
  invalidateTransaction(state: string): Promise<boolean>;
  clear(): void;
  size(): number;
  cleanupExpired(): number;
}

/**
 * Generates a cryptographically random PKCE code_verifier (64 bytes base64url).
 */
export function generateCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * Derives a PKCE S256 code_challenge from a code_verifier (BASE64URL(SHA256(verifier))).
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

/**
 * Generates an unpredictable random state string for OAuth CSRF protection.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export class MemoryOAuthTransactionStore implements IOAuthTransactionStore {
  private store = new Map<string, OAuthTransaction>();
  private readonly defaultTtlMs: number;
  private readonly maxTransactions: number;
  private opCounter = 0;

  constructor(options?: { defaultTtlMs?: number; maxTransactions?: number }) {
    if (process.env.MULTI_INSTANCE === 'true') {
      throw new Error(
        'FATAL CONFIGURATION ERROR: MemoryOAuthTransactionStore cannot be used when MULTI_INSTANCE=true. Configure a distributed store adapter (Redis/DB).'
      );
    }
    this.defaultTtlMs = options?.defaultTtlMs ?? 10 * 60 * 1000; // 10 minutes
    this.maxTransactions = options?.maxTransactions ?? 10000;
  }

  public async createTransaction(options?: {
    redirectTarget?: string;
    ttlMs?: number;
  }): Promise<{ state: string; codeVerifier: string; codeChallenge: string }> {
    const state = generateOAuthState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const now = Date.now();
    const ttl = options?.ttlMs ?? this.defaultTtlMs;

    this.opCounter++;
    if (this.opCounter % 50 === 0 || this.store.size >= this.maxTransactions) {
      this.cleanupExpired();
    }

    this.store.set(state, {
      state,
      codeVerifier,
      redirectTarget: options?.redirectTarget || '/',
      createdAt: now,
      expiresAt: now + ttl,
    });

    return { state, codeVerifier, codeChallenge };
  }

  /**
   * Atomically retrieves and removes the OAuth transaction in a single operation.
   * Guarantees exact-once consumption per state string.
   */
  public async consumeTransaction(state: string): Promise<{ codeVerifier: string; redirectTarget: string }> {
    if (!state || typeof state !== 'string') {
      throw new ValidationError('OAuth state parameter is missing or invalid');
    }

    const tx = this.store.get(state);

    if (!tx) {
      throw new UnauthorizedError('OAuth state not found or was already consumed (single-use constraint)');
    }

    // Atomic removal from process memory
    this.store.delete(state);

    if (Date.now() > tx.expiresAt) {
      throw new UnauthorizedError('OAuth state has expired');
    }

    return {
      codeVerifier: tx.codeVerifier,
      redirectTarget: tx.redirectTarget,
    };
  }

  /**
   * Explicitly consumes/deletes a state (e.g. on user cancellation or OAuth error).
   */
  public async invalidateTransaction(state: string): Promise<boolean> {
    if (!state || typeof state !== 'string') return false;
    return this.store.delete(state);
  }

  public cleanupExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) {
        this.store.delete(k);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.store.clear();
    this.opCounter = 0;
  }

  public size(): number {
    return this.store.size;
  }
}

export const defaultOAuthTransactionStore: IOAuthTransactionStore = new MemoryOAuthTransactionStore();
