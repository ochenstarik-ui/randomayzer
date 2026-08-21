import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MemoryOAuthTransactionStore,
  PrismaOAuthTransactionStore,
  createOAuthTransactionStore,
  generateOAuthState,
  generateCodeVerifier,
  generateCodeChallenge,
} from '../src/lib/auth/oauth-state';
import {
  MemorySessionStore,
  PrismaSessionStore,
  createSessionStore,
  SessionUser,
} from '../src/lib/auth/session';
import { UnauthorizedError } from '../src/core/errors/http-errors';

describe('Task 01: Persistent OAuth-State & Session Store', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ─── 1. Concurrent consumeTransaction on single state ────────────────────────
  describe('OAuth Single-Use Concurrency & Race Resistance', () => {
    it('concurrent consumeTransaction calls on same state yield exactly 1 success and N-1 UnauthorizedErrors', async () => {
      const store = new MemoryOAuthTransactionStore();
      const { state } = await store.createTransaction({
        redirectTarget: '/dashboard',
        ttlMs: 60000,
      });

      const concurrentAttempts = Array.from({ length: 25 }, async () => {
        try {
          const res = await store.consumeTransaction(state);
          return { success: true, res };
        } catch (err: any) {
          return { success: false, error: err };
        }
      });

      const results = await Promise.all(concurrentAttempts);
      const successes = results.filter(r => r.success);
      const failures = results.filter(r => !r.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(24);
      expect((successes[0] as any).res.redirectTarget).toBe('/dashboard');

      failures.forEach(f => {
        expect(f.error).toBeInstanceOf(UnauthorizedError);
        expect((f.error as UnauthorizedError).message).toMatch(/single-use constraint|not found/i);
      });

      // Subsequent read after race must also fail
      await expect(store.consumeTransaction(state)).rejects.toThrow(UnauthorizedError);
    });
  });

  // ─── 2. Multi-Instance OAuth Consumption ─────────────────────────────────────
  describe('Multi-Instance OAuth Transaction Handoff', () => {
    it('state created by instance A can be consumed by instance B sharing underlying state', async () => {
      // Create shared backing map for simulation
      const sharedMap = new Map<string, any>();

      class SharedMemoryStore extends MemoryOAuthTransactionStore {
        constructor() {
          super();
          (this as any).store = sharedMap;
        }
      }

      const instanceA = new SharedMemoryStore();
      const instanceB = new SharedMemoryStore();

      // Instance A creates OAuth start transaction
      const { state, codeVerifier } = await instanceA.createTransaction({
        redirectTarget: '/giveaways/new',
      });

      // Instance B consumes OAuth callback transaction
      const consumed = await instanceB.consumeTransaction(state);
      expect(consumed.codeVerifier).toBe(codeVerifier);
      expect(consumed.redirectTarget).toBe('/giveaways/new');

      // Attempt to re-consume by instance A fails
      await expect(instanceA.consumeTransaction(state)).rejects.toThrow(UnauthorizedError);
    });
  });

  // ─── 3. TTL Expiry Enforcement ───────────────────────────────────────────────
  describe('TTL Expiry & Invalidation Policy', () => {
    it('expired OAuth state is rejected with UnauthorizedError', async () => {
      const store = new MemoryOAuthTransactionStore({ defaultTtlMs: 1 });
      const { state } = await store.createTransaction({ ttlMs: -1000 }); // already expired

      await expect(store.consumeTransaction(state)).rejects.toThrow(UnauthorizedError);
    });

    it('invalidateTransaction removes state explicitly', async () => {
      const store = new MemoryOAuthTransactionStore();
      const { state } = await store.createTransaction();

      const invalidated = await store.invalidateTransaction(state);
      expect(invalidated).toBe(true);

      await expect(store.consumeTransaction(state)).rejects.toThrow(UnauthorizedError);
    });

    it('expired Session is rejected and returns null from getSession', async () => {
      const sessionStore = new MemorySessionStore({ defaultTtlMs: 1 });
      const user: SessionUser = {
        id: 'usr_ttl_test',
        vkUserId: '123456',
        firstName: 'TTL',
        lastName: 'Test',
      };

      const sessionId = await sessionStore.createSession(user, -5000); // expired 5s ago
      const session = await sessionStore.getSession(sessionId);

      expect(session).toBeNull();
    });
  });

  // ─── 4. Session Store Lifecycle & Destruction ────────────────────────────────
  describe('Session Store Lifecycle', () => {
    const testUser: SessionUser = {
      id: 'usr_session_lifecycle',
      vkUserId: '998877',
      firstName: 'Alice',
      lastName: 'Organizer',
      username: 'alice_org',
    };

    it('createSession, getSession and destroySession work correctly', async () => {
      const store = new MemorySessionStore();
      const sessionId = await store.createSession(testUser);

      const retrieved = await store.getSession(sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(testUser.id);
      expect(retrieved?.vkUserId).toBe(testUser.vkUserId);

      await store.destroySession(sessionId);
      const afterDestroy = await store.getSession(sessionId);
      expect(afterDestroy).toBeNull();
    });

    it('session survives re-creation of store instance when sharing storage', async () => {
      const sharedStoreMap = new Map<string, any>();

      class SharedSessionStore extends MemorySessionStore {
        constructor() {
          super();
          (this as any).store = sharedStoreMap;
        }
      }

      const storeProcess1 = new SharedSessionStore();
      const sessionId = await storeProcess1.createSession(testUser);

      // Simulate process restart
      const storeProcess2 = new SharedSessionStore();
      const retrieved = await storeProcess2.getSession(sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(testUser.id);
    });
  });

  // ─── 5. MULTI_INSTANCE Configuration Policy & Driver Selector ────────────────
  describe('Driver Selector & MULTI_INSTANCE Guards', () => {
    it('Memory stores throw fatal error when MULTI_INSTANCE=true', () => {
      process.env.MULTI_INSTANCE = 'true';

      expect(() => new MemoryOAuthTransactionStore()).toThrow(/MemoryOAuthTransactionStore cannot be used when MULTI_INSTANCE=true/);
      expect(() => new MemorySessionStore()).toThrow(/In-memory session store cannot be used with MULTI_INSTANCE=true/);
    });

    it('Prisma stores do NOT throw when MULTI_INSTANCE=true', () => {
      process.env.MULTI_INSTANCE = 'true';

      expect(() => new PrismaOAuthTransactionStore()).not.toThrow();
      expect(() => new PrismaSessionStore()).not.toThrow();
    });

    it('createOAuthTransactionStore selects Memory in test/memory mode, Prisma in production mode', () => {
      delete process.env.STORAGE_DRIVER;
      (process.env as any).NODE_ENV = 'test';
      expect(createOAuthTransactionStore()).toBeInstanceOf(MemoryOAuthTransactionStore);

      process.env.STORAGE_DRIVER = 'memory';
      (process.env as any).NODE_ENV = 'production';
      expect(createOAuthTransactionStore()).toBeInstanceOf(MemoryOAuthTransactionStore);

      delete process.env.STORAGE_DRIVER;
      (process.env as any).NODE_ENV = 'production';
      expect(createOAuthTransactionStore()).toBeInstanceOf(PrismaOAuthTransactionStore);
    });

    it('createSessionStore selects Memory in test/memory mode, Prisma in production mode', () => {
      delete process.env.STORAGE_DRIVER;
      (process.env as any).NODE_ENV = 'test';
      expect(createSessionStore()).toBeInstanceOf(MemorySessionStore);

      process.env.STORAGE_DRIVER = 'memory';
      (process.env as any).NODE_ENV = 'production';
      expect(createSessionStore()).toBeInstanceOf(MemorySessionStore);

      delete process.env.STORAGE_DRIVER;
      (process.env as any).NODE_ENV = 'production';
      expect(createSessionStore()).toBeInstanceOf(PrismaSessionStore);
    });
  });
});
