import { prisma } from '../prisma';
import { SessionUser } from '../auth/session';

export interface UpsertUserParams {
  vkUserId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

export interface IUserRepository {
  upsertUserWithTokens(params: UpsertUserParams): Promise<SessionUser>;
  getUserById(id: string): Promise<SessionUser | null>;
  getUserByVkId(vkUserId: string): Promise<SessionUser | null>;
  getUserCredentials(userId: string): Promise<{
    encryptedAccessToken: string;
    encryptedRefreshToken?: string | null;
    expiresAt?: Date | null;
    scope?: string | null;
  } | null>;
}

export class PrismaUserRepository implements IUserRepository {
  public async upsertUserWithTokens(params: UpsertUserParams): Promise<SessionUser> {
    const expiresAt = params.expiresIn ? new Date(Date.now() + params.expiresIn * 1000) : null;

    const user = await prisma.user.upsert({
      where: { vkUserId: params.vkUserId },
      update: {
        firstName: params.firstName,
        lastName: params.lastName,
        username: params.username,
        avatarUrl: params.avatarUrl,
        credentials: {
          upsert: {
            create: {
              encryptedAccessToken: params.encryptedAccessToken,
              encryptedRefreshToken: params.encryptedRefreshToken,
              expiresAt,
              scope: params.scope,
            },
            update: {
              encryptedAccessToken: params.encryptedAccessToken,
              encryptedRefreshToken: params.encryptedRefreshToken,
              expiresAt,
              scope: params.scope,
            },
          },
        },
      },
      create: {
        vkUserId: params.vkUserId,
        firstName: params.firstName,
        lastName: params.lastName,
        username: params.username,
        avatarUrl: params.avatarUrl,
        credentials: {
          create: {
            encryptedAccessToken: params.encryptedAccessToken,
            encryptedRefreshToken: params.encryptedRefreshToken,
            expiresAt,
            scope: params.scope,
          },
        },
      },
    });

    return {
      id: user.id,
      vkUserId: user.vkUserId,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      username: user.username || undefined,
      avatarUrl: user.avatarUrl || undefined,
    };
  }

  public async getUserById(id: string): Promise<SessionUser | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    return {
      id: user.id,
      vkUserId: user.vkUserId,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      username: user.username || undefined,
      avatarUrl: user.avatarUrl || undefined,
    };
  }

  public async getUserByVkId(vkUserId: string): Promise<SessionUser | null> {
    const user = await prisma.user.findUnique({ where: { vkUserId } });
    if (!user) return null;
    return {
      id: user.id,
      vkUserId: user.vkUserId,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      username: user.username || undefined,
      avatarUrl: user.avatarUrl || undefined,
    };
  }

  public async getUserCredentials(userId: string) {
    const cred = await prisma.userCredential.findUnique({ where: { userId } });
    if (!cred) return null;
    return {
      encryptedAccessToken: cred.encryptedAccessToken,
      encryptedRefreshToken: cred.encryptedRefreshToken,
      expiresAt: cred.expiresAt,
      scope: cred.scope,
    };
  }
}

export class MemoryUserRepository implements IUserRepository {
  private users = new Map<string, SessionUser>();
  private credentials = new Map<string, any>();

  public async upsertUserWithTokens(params: UpsertUserParams): Promise<SessionUser> {
    let existingUser: SessionUser | undefined;
    for (const u of this.users.values()) {
      if (u.vkUserId === params.vkUserId) {
        existingUser = u;
        break;
      }
    }

    const id = existingUser ? existingUser.id : `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const user: SessionUser = {
      id,
      vkUserId: params.vkUserId,
      firstName: params.firstName,
      lastName: params.lastName,
      username: params.username,
      avatarUrl: params.avatarUrl,
    };

    this.users.set(id, user);

    const expiresAt = params.expiresIn ? new Date(Date.now() + params.expiresIn * 1000) : null;
    this.credentials.set(id, {
      encryptedAccessToken: params.encryptedAccessToken,
      encryptedRefreshToken: params.encryptedRefreshToken,
      expiresAt,
      scope: params.scope,
    });

    return user;
  }

  public async getUserById(id: string): Promise<SessionUser | null> {
    return this.users.get(id) || null;
  }

  public async getUserByVkId(vkUserId: string): Promise<SessionUser | null> {
    for (const u of this.users.values()) {
      if (u.vkUserId === vkUserId) return u;
    }
    return null;
  }

  public async getUserCredentials(userId: string) {
    return this.credentials.get(userId) || null;
  }

  public clear(): void {
    this.users.clear();
    this.credentials.clear();
  }
}

// Global user repository selector
function createUserRepository(): IUserRepository {
  const driver = process.env.STORAGE_DRIVER || (process.env.NODE_ENV === 'test' ? 'memory' : 'prisma');
  if (driver === 'memory') {
    return new MemoryUserRepository();
  }
  return new PrismaUserRepository();
}

export let defaultUserRepository: IUserRepository = createUserRepository();

export function setUserRepository(repo: IUserRepository): void {
  defaultUserRepository = repo;
}
