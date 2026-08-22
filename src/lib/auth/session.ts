import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';

export const SESSION_COOKIE_NAME = 'randomayzer_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface SessionUser {
  id: string;
  vkUserId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
}

interface SessionRecord {
  sessionId: string;
  user: SessionUser;
  createdAt: number;
  expiresAt: number;
}

interface CachedValidSession {
  user: SessionUser;
  expiresAt: number;
}

// In-memory short-lived cache of verified valid sessions (Option C)
// Protects the session store / DB from repeated lookups and prevents legitimate users
// from being blocked by pre-auth rate limits during concurrent/subsequent requests.
const validSessionCache = new Map<string, CachedValidSession>();
const VALID_SESSION_CACHE_TTL_MS = 60_000; // 60s fast cache

export function getCachedValidSession(sessionId: string): SessionUser | null {
  const cached = validSessionCache.get(sessionId);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    validSessionCache.delete(sessionId);
    return null;
  }
  return cached.user;
}

export function cacheValidSession(
  sessionId: string,
  user: SessionUser,
  ttlMs: number = VALID_SESSION_CACHE_TTL_MS
): void {
  validSessionCache.set(sessionId, {
    user,
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateSessionCache(sessionId: string): void {
  validSessionCache.delete(sessionId);
}

export function clearSessionCache(): void {
  validSessionCache.clear();
}

export interface ISessionStore {
  createSession(user: SessionUser, ttlMs?: number): Promise<string>;
  getSession(sessionId: string): Promise<SessionUser | null>;
  destroySession(sessionId: string): Promise<void>;
  cleanupExpired(): number | Promise<number>;
  clear(): void | Promise<void>;
  size(): number | Promise<number>;
}

export class MemorySessionStore implements ISessionStore {
  private store = new Map<string, SessionRecord>();
  private readonly defaultTtlMs: number;

  constructor(options?: { defaultTtlMs?: number }) {
    if (process.env.MULTI_INSTANCE === 'true') {
      throw new Error(
        'FATAL CONFIGURATION ERROR: In-memory session store cannot be used with MULTI_INSTANCE=true. Configure a distributed store (e.g. Redis).'
      );
    }
    this.defaultTtlMs = options?.defaultTtlMs ?? SESSION_MAX_AGE_SECONDS * 1000;
  }

  public async createSession(user: SessionUser, ttlMs?: number): Promise<string> {
    const sessionId = randomBytes(32).toString('hex');
    const now = Date.now();
    const ttl = ttlMs ?? this.defaultTtlMs;

    this.store.set(sessionId, {
      sessionId,
      user,
      createdAt: now,
      expiresAt: now + ttl,
    });

    cacheValidSession(sessionId, user, ttl);
    return sessionId;
  }

  public async getSession(sessionId: string): Promise<SessionUser | null> {
    if (!sessionId) return null;
    const record = this.store.get(sessionId);
    if (!record) return null;

    if (Date.now() > record.expiresAt) {
      this.store.delete(sessionId);
      return null;
    }

    return record.user;
  }

  public async destroySession(sessionId: string): Promise<void> {
    if (sessionId) {
      invalidateSessionCache(sessionId);
      this.store.delete(sessionId);
    }
  }

  public cleanupExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) {
        invalidateSessionCache(k);
        this.store.delete(k);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    clearSessionCache();
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}

export class PrismaSessionStore implements ISessionStore {
  private readonly defaultTtlMs: number;

  constructor(options?: { defaultTtlMs?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? SESSION_MAX_AGE_SECONDS * 1000;
  }

  public async createSession(user: SessionUser, ttlMs?: number): Promise<string> {
    const sessionId = randomBytes(32).toString('hex');
    const now = new Date();
    const ttl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = new Date(now.getTime() + ttl);

    await prisma.session.create({
      data: {
        sessionId,
        userId: user.id,
        createdAt: now,
        expiresAt,
      },
    });

    cacheValidSession(sessionId, user, ttl);
    return sessionId;
  }

  public async getSession(sessionId: string): Promise<SessionUser | null> {
    if (!sessionId) return null;

    const record = await prisma.session.findUnique({
      where: { sessionId },
      include: {
        user: true,
      },
    });

    if (!record) return null;

    if (Date.now() > record.expiresAt.getTime()) {
      invalidateSessionCache(sessionId);
      await prisma.session.deleteMany({
        where: { sessionId },
      });
      return null;
    }

    if (!record.user) return null;

    const user: SessionUser = {
      id: record.user.id,
      vkUserId: record.user.vkUserId,
      firstName: record.user.firstName ?? undefined,
      lastName: record.user.lastName ?? undefined,
      username: record.user.username ?? undefined,
      avatarUrl: record.user.avatarUrl ?? undefined,
    };

    cacheValidSession(sessionId, user);
    return user;
  }

  public async destroySession(sessionId: string): Promise<void> {
    if (sessionId) {
      invalidateSessionCache(sessionId);
      await prisma.session.deleteMany({
        where: { sessionId },
      });
    }
  }

  public async cleanupExpired(): Promise<number> {
    const res = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return res.count;
  }

  public async clear(): Promise<void> {
    clearSessionCache();
    await prisma.session.deleteMany();
  }

  public async size(): Promise<number> {
    return await prisma.session.count();
  }
}

export function createSessionStore(): ISessionStore {
  const driver = process.env.STORAGE_DRIVER || (process.env.NODE_ENV === 'test' ? 'memory' : 'prisma');
  if (driver === 'memory') {
    return new MemorySessionStore();
  }
  return new PrismaSessionStore();
}

export let defaultSessionStore: ISessionStore = createSessionStore();

export function setSessionStore(store: ISessionStore): void {
  clearSessionCache();
  defaultSessionStore = store;
}

/**
 * Extracts session user from request cookie
 */
export async function getSessionFromRequest(
  req: NextRequest,
  sessionStore: ISessionStore = defaultSessionStore
): Promise<SessionUser | null> {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  // Fast path: check valid session cache
  const cached = getCachedValidSession(sessionId);
  if (cached) return cached;

  const user = await sessionStore.getSession(sessionId);
  if (user) {
    cacheValidSession(sessionId, user);
  }
  return user;
}

/**
 * Sets session cookie on a NextResponse
 */
export function setSessionCookie(res: NextResponse, sessionId: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Clears session cookie on a NextResponse
 */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
