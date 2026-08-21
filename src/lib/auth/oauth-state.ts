import { randomBytes, createHash } from 'crypto';
import { UnauthorizedError, ValidationError } from '@/core/errors/http-errors';
import { prisma } from '@/lib/prisma';

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
  clear(): void | Promise<void>;
  size(): number | Promise<number>;
  cleanupExpired(): number | Promise<number>;
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

export class PrismaOAuthTransactionStore implements IOAuthTransactionStore {
  private readonly defaultTtlMs: number;

  constructor(options?: { defaultTtlMs?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 10 * 60 * 1000; // 10 minutes
  }

  public async createTransaction(options?: {
    redirectTarget?: string;
    ttlMs?: number;
  }): Promise<{ state: string; codeVerifier: string; codeChallenge: string }> {
    const state = generateOAuthState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const now = new Date();
    const ttl = options?.ttlMs ?? this.defaultTtlMs;
    const expiresAt = new Date(now.getTime() + ttl);

    await prisma.oAuthTransaction.create({
      data: {
        state,
        codeVerifier,
        redirectTarget: options?.redirectTarget || '/',
        createdAt: now,
        expiresAt,
      },
    });

    return { state, codeVerifier, codeChallenge };
  }

  /**
   * Atomically retrieves and removes the OAuth transaction in a single operation.
   * Guarantees exact-once consumption per state string in concurrent and multi-instance environments.
   */
  public async consumeTransaction(state: string): Promise<{ codeVerifier: string; redirectTarget: string }> {
    if (!state || typeof state !== 'string') {
      throw new ValidationError('OAuth state parameter is missing or invalid');
    }

    try {
      const tx = await prisma.$transaction(async (txPrisma) => {
        const found = await txPrisma.oAuthTransaction.findUnique({
          where: { state },
        });

        if (!found) {
          return null;
        }

        await txPrisma.oAuthTransaction.delete({
          where: { state },
        });

        return found;
      });

      if (!tx) {
        throw new UnauthorizedError('OAuth state not found or was already consumed (single-use constraint)');
      }

      if (Date.now() > tx.expiresAt.getTime()) {
        throw new UnauthorizedError('OAuth state has expired');
      }

      return {
        codeVerifier: tx.codeVerifier,
        redirectTarget: tx.redirectTarget || '/',
      };
    } catch (error: any) {
      if (error instanceof UnauthorizedError || error instanceof ValidationError) {
        throw error;
      }
      if (error?.code === 'P2025') {
        throw new UnauthorizedError('OAuth state not found or was already consumed (single-use constraint)');
      }
      throw error;
    }
  }

  public async invalidateTransaction(state: string): Promise<boolean> {
    if (!state || typeof state !== 'string') return false;
    try {
      const res = await prisma.oAuthTransaction.deleteMany({
        where: { state },
      });
      return res.count > 0;
    } catch {
      return false;
    }
  }

  public async cleanupExpired(): Promise<number> {
    const res = await prisma.oAuthTransaction.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return res.count;
  }

  public async clear(): Promise<void> {
    await prisma.oAuthTransaction.deleteMany();
  }

  public async size(): Promise<number> {
    return await prisma.oAuthTransaction.count();
  }
}

export function createOAuthTransactionStore(): IOAuthTransactionStore {
  const driver = process.env.STORAGE_DRIVER || (process.env.NODE_ENV === 'test' ? 'memory' : 'prisma');
  if (driver === 'memory') {
    return new MemoryOAuthTransactionStore();
  }
  return new PrismaOAuthTransactionStore();
}

export let defaultOAuthTransactionStore: IOAuthTransactionStore = createOAuthTransactionStore();

export function setOAuthTransactionStore(store: IOAuthTransactionStore): void {
  defaultOAuthTransactionStore = store;
}
