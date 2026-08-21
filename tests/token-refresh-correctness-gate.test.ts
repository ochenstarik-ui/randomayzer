import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenRefresher } from '../src/lib/auth/token-refresher';
import { MemoryUserRepository } from '../src/lib/repository/user-repository';
import { AesGcmTokenVault } from '../src/lib/auth/token-vault';
import { MockVkOAuthClient } from '../src/integrations/vk/mock-oauth-client';
import { VkReauthenticationRequiredError, VkNetworkError } from '../src/integrations/vk/vk-errors';

const TEST_KEY = 'test-master-token-encryption-key-32b!';

async function makeExpiredUser(
  userRepo: MemoryUserRepository,
  tokenVault: AesGcmTokenVault,
  opts: { vkUserId?: string; hasRefreshToken?: boolean; noExpiry?: boolean } = {}
): Promise<string> {
  const { vkUserId = '12345678', hasRefreshToken = true, noExpiry = false } = opts;
  const encryptedAccessToken = await tokenVault.encrypt('old_access_token');
  const encryptedRefreshToken = hasRefreshToken
    ? await tokenVault.encrypt('old_refresh_token')
    : undefined;

  const user = await userRepo.upsertUserWithTokens({
    vkUserId,
    firstName: 'Test',
    lastName: 'User',
    encryptedAccessToken,
    encryptedRefreshToken,
    expiresIn: noExpiry ? undefined : -10, // expired 10s ago (or no expiry)
  });
  return user.id;
}

describe('Phase 2.3.1 — Token Refresh Correctness Gate', () => {
  let userRepo: MemoryUserRepository;
  let tokenVault: AesGcmTokenVault;
  let oauthClient: MockVkOAuthClient;
  let refresher: TokenRefresher;

  beforeEach(() => {
    userRepo = new MemoryUserRepository();
    tokenVault = new AesGcmTokenVault(TEST_KEY);
    oauthClient = new MockVkOAuthClient();
    refresher = new TokenRefresher(userRepo, tokenVault, oauthClient);
  });

  // ─── Test 1: 100 concurrent expired requests → exactly 1 refresh ─────────────
  it('100 concurrent expired token requests trigger exactly 1 refresh HTTP call', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault);
    let callCount = 0;
    const orig = oauthClient.refreshToken.bind(oauthClient);
    oauthClient.refreshToken = async (p) => {
      callCount++;
      await new Promise(r => setTimeout(r, 40));
      return orig(p);
    };

    const tokens = await Promise.all(
      Array.from({ length: 100 }, () => refresher.getOrRefreshUserToken(organizerId))
    );

    expect(callCount).toBe(1);
    expect(tokens).toHaveLength(100);
    expect(new Set(tokens).size).toBe(1); // all same token
    expect(tokens[0]).toMatch(/mock_refreshed_access_token_/);
  });

  // ─── Test 2: 50 concurrent expired requests → exactly 1 refresh ──────────────
  it('50 concurrent expired token requests trigger exactly 1 refresh HTTP call', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault);
    let callCount = 0;
    const orig = oauthClient.refreshToken.bind(oauthClient);
    oauthClient.refreshToken = async (p) => {
      callCount++;
      await new Promise(r => setTimeout(r, 30));
      return orig(p);
    };

    const tokens = await Promise.all(
      Array.from({ length: 50 }, () => refresher.getOrRefreshUserToken(organizerId))
    );

    expect(callCount).toBe(1);
    expect(tokens.every(t => t === tokens[0])).toBe(true);
  });

  // ─── Test 3: Late caller joins existing flight before cleanup ─────────────────
  it('late caller arriving while flight is resolving joins existing flight (no extra call)', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault);
    let callCount = 0;
    let resolveRefresh!: () => void;
    const refreshBarrier = new Promise<void>(res => { resolveRefresh = res; });

    const orig = oauthClient.refreshToken.bind(oauthClient);
    oauthClient.refreshToken = async (p) => {
      callCount++;
      await refreshBarrier;
      return orig(p);
    };

    // Start first caller — it will block on the barrier
    const first = refresher.getOrRefreshUserToken(organizerId);
    // Give microtask loop time to register the flight
    await new Promise(r => setTimeout(r, 10));

    // Late second caller — should join the in-flight promise
    const second = refresher.getOrRefreshUserToken(organizerId);

    // Unblock the refresh
    resolveRefresh();
    const [t1, t2] = await Promise.all([first, second]);

    expect(callCount).toBe(1);
    expect(t1).toBe(t2);
  });

  // ─── Test 4: Refresh failure releases the flight (no deadlock) ───────────────
  it('refresh failure clears the flight so the next caller can start a fresh attempt', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault);
    oauthClient.shouldFailRefresh = true;

    await expect(refresher.getOrRefreshUserToken(organizerId)).rejects.toThrow(
      VkReauthenticationRequiredError
    );

    // Flight must be cleared after failure
    oauthClient.shouldFailRefresh = false;
    const token = await refresher.getOrRefreshUserToken(organizerId);
    expect(token).toMatch(/mock_refreshed_access_token_/);
  });

  // ─── Test 5: User A and B refresh independently (flights isolated per userId) ─
  it('concurrent expired token refresh for two different users executes 2 independent refreshes', async () => {
    const idA = await makeExpiredUser(userRepo, tokenVault, { vkUserId: '11111111' });
    const idB = await makeExpiredUser(userRepo, tokenVault, { vkUserId: '22222222' });

    let callCount = 0;
    const orig = oauthClient.refreshToken.bind(oauthClient);
    oauthClient.refreshToken = async (p) => {
      callCount++;
      await new Promise(r => setTimeout(r, 20));
      const res = await orig(p);
      delete (res as any).user_id;
      return res;
    };

    const [tokenA, tokenB] = await Promise.all([
      refresher.getOrRefreshUserToken(idA),
      refresher.getOrRefreshUserToken(idB),
    ]);

    expect(callCount).toBe(2); // one per user
    expect(tokenA).toBeDefined();
    expect(tokenB).toBeDefined();
  });

  // ─── Test 6: null expiresAt + refresh token → forces refresh ─────────────────
  it('null expiresAt with refresh token forces a refresh (conservative policy)', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault, { noExpiry: true });
    let callCount = 0;
    const orig = oauthClient.refreshToken.bind(oauthClient);
    oauthClient.refreshToken = async (p) => { callCount++; return orig(p); };

    const token = await refresher.getOrRefreshUserToken(organizerId);
    expect(callCount).toBe(1);
    expect(token).toMatch(/mock_refreshed_access_token_/);
  });

  // ─── Test 7: null expiresAt without refresh token → ReauthRequired ───────────
  it('null expiresAt without refresh token throws VkReauthenticationRequiredError', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault, {
      noExpiry: true,
      hasRefreshToken: false,
    });

    await expect(refresher.getOrRefreshUserToken(organizerId)).rejects.toThrow(
      VkReauthenticationRequiredError
    );
  });

  // ─── Test 8: Identity mismatch → security error, DB NOT written ──────────────
  it('identity mismatch in refresh response throws security error and does not persist tokens', async () => {
    // User stored with vkUserId 12345678
    const organizerId = await makeExpiredUser(userRepo, tokenVault, { vkUserId: '12345678' });

    // But the OAuth mock will return user_id 99999999 (different user)
    oauthClient.mockUserId = 99999999;

    await expect(refresher.getOrRefreshUserToken(organizerId)).rejects.toThrow(
      VkReauthenticationRequiredError
    );

    // Verify DB credential was NOT overwritten — still has old encrypted token
    const cred = await userRepo.getUserCredentials(organizerId);
    const storedToken = await tokenVault.decrypt(cred!.encryptedAccessToken);
    expect(storedToken).toBe('old_access_token'); // unchanged
  });

  // ─── Test 9: Stale refresh cannot overwrite newer credential (CAS) ────────────
  it('stale refresh result does not overwrite a newer credential created by re-login', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault, { vkUserId: '12345678' });

    let resolveRefresh!: () => void;
    const refreshBarrier = new Promise<void>(res => { resolveRefresh = res; });
    const orig = oauthClient.refreshToken.bind(oauthClient);
    oauthClient.refreshToken = async (p) => {
      await refreshBarrier; // hold until we simulate re-login
      return orig(p);
    };

    // Start refresh (will block)
    const refreshPromise = refresher.getOrRefreshUserToken(organizerId);
    await new Promise(r => setTimeout(r, 10));

    // Simulate re-login: overwrite credential with a newer version
    const newAccessToken = await tokenVault.encrypt('brand_new_login_token');
    const newRefreshToken = await tokenVault.encrypt('brand_new_refresh_token');
    await userRepo.upsertUserWithTokens({
      vkUserId: '12345678',
      encryptedAccessToken: newAccessToken,
      encryptedRefreshToken: newRefreshToken,
      expiresIn: 86400, // fresh
    });

    // Unblock the original refresh
    resolveRefresh();
    const refreshedToken = await refreshPromise;

    // The refresh still returns the freshly-computed token (valid)
    expect(refreshedToken).toMatch(/mock_refreshed_access_token_/);

    // But the DB must retain the newer login credential, not the stale refresh result
    const cred = await userRepo.getUserCredentials(organizerId);
    const dbToken = await tokenVault.decrypt(cred!.encryptedAccessToken);
    expect(dbToken).toBe('brand_new_login_token'); // re-login wins
  });

  // ─── Test 10: Rotated refresh token is persisted ─────────────────────────────
  it('new refresh_token in response is persisted (rotation)', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault);
    const credBefore = await userRepo.getUserCredentials(organizerId);
    const oldRefreshPlaintext = await tokenVault.decrypt(credBefore!.encryptedRefreshToken!);

    await refresher.getOrRefreshUserToken(organizerId);

    const credAfter = await userRepo.getUserCredentials(organizerId);
    const newRefreshPlaintext = await tokenVault.decrypt(credAfter!.encryptedRefreshToken!);
    expect(newRefreshPlaintext).toMatch(/mock_new_refresh_token_/);
    expect(newRefreshPlaintext).not.toBe(oldRefreshPlaintext);
  });

  // ─── Test 10b: When VK omits refresh_token, old token is retained ────────────
  it('when refresh response omits refresh_token, old refresh token is retained', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault);
    const credBefore = await userRepo.getUserCredentials(organizerId);
    const oldRefreshEncrypted = credBefore!.encryptedRefreshToken!;

    oauthClient.shouldReturnNoRefreshToken = true;
    await refresher.getOrRefreshUserToken(organizerId);

    const credAfter = await userRepo.getUserCredentials(organizerId);
    // Should still have a refresh token (the old one retained)
    expect(credAfter!.encryptedRefreshToken).toBeDefined();
    // Decrypt and verify it's still the old refresh token value
    // (The old encrypted token was kept as-is, same ciphertext)
    expect(credAfter!.encryptedRefreshToken).toBe(oldRefreshEncrypted);
  });

  // ─── Test 11: Temporary/network refresh failure preserves old DB credential ───
  it('network error during refresh does not corrupt or delete the existing credential', async () => {
    const organizerId = await makeExpiredUser(userRepo, tokenVault);
    const credBefore = await userRepo.getUserCredentials(organizerId);

    oauthClient.shouldFailRefreshWithNetwork = true;

    await expect(refresher.getOrRefreshUserToken(organizerId)).rejects.toThrow(VkNetworkError);

    // DB credential must be untouched
    const credAfter = await userRepo.getUserCredentials(organizerId);
    expect(credAfter!.encryptedAccessToken).toBe(credBefore!.encryptedAccessToken);
    expect(credAfter!.encryptedRefreshToken).toBe(credBefore!.encryptedRefreshToken);
    expect(credAfter!.expiresAt?.getTime()).toBe(credBefore!.expiresAt?.getTime());
  });

  // ─── Test 12: Partial SERVICE pagination → complete USER restart ──────────────
  it('partial SERVICE import followed by USER fallback is a complete restart (no result append)', async () => {
    // This test verifies that executeFetchParticipants always starts with a fresh map.
    // We test it indirectly: mock VkProvider behavior at the provider level.
    // The key assertion is that executeFetchParticipants creates a new Map each call.

    // Import VkProvider and related mocks
    const { VkProvider } = await import('../src/providers/vk/vk-provider');
    const { VkPrivateResourceError } = await import('../src/integrations/vk/vk-errors');

    let serviceCallCount = 0;
    let userCallCount = 0;

    // Mock VkClient
    const mockClient = {
      call: vi.fn(async (method: string, _params: unknown, auth: { type: string }) => {
        if (method === 'likes.getList') {
          if (auth.type === 'SERVICE') {
            serviceCallCount++;
            if (serviceCallCount === 1) {
              // First page succeeds (100 items so it doesn't break)
              return { items: Array.from({length: 100}, (_, i) => ({ id: i+1, first_name: 'A', last_name: 'B', screen_name: 'a' })), count: 200 };
            }
            // Second page fails (private)
            throw new VkPrivateResourceError('Private post');
          } else {
            userCallCount++;
            // User token fetches fresh result (2 items, different from SERVICE)
            return { items: [{ id: 99, first_name: 'X', last_name: 'Y', screen_name: 'x' }], count: 1 };
          }
        }
        return {};
      }),
    };

    // Mock auth resolver to return USER context on fallback
    const mockResolver = {
      resolveAuthContext: vi.fn().mockResolvedValue({ type: 'SERVICE', token: 'svc_token' }),
      resolveUserFallbackContext: vi.fn().mockResolvedValue({ type: 'USER', token: 'usr_token' }),
    };

    const provider = new VkProvider('svc_token', mockClient as any, mockResolver as any);
    const results = await provider.fetchParticipants({
      ownerId: '-123',
      postId: '456',
      organizerId: 'org1',
      includeLikes: true,
    });

    // USER restart: only the user result (id=99) should appear, not SERVICE partial (id=1)
    expect(results).toHaveLength(1);
    expect(results[0].platformUserId).toBe('99');
    expect(results.some(r => r.platformUserId === '1')).toBe(false);
  });
});
