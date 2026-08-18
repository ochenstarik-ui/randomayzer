import { describe, it, expect, beforeEach } from 'vitest';
import { TokenRefresher } from '../src/lib/auth/token-refresher';
import { MemoryUserRepository } from '../src/lib/repository/user-repository';
import { AesGcmTokenVault } from '../src/lib/auth/token-vault';
import { MockVkOAuthClient } from '../src/integrations/vk/mock-oauth-client';
import { VkReauthenticationRequiredError } from '../src/integrations/vk/vk-errors';

describe('Phase 2.3 Token Refresh & Single-Flight Concurrency Gate', () => {
  let userRepo: MemoryUserRepository;
  let tokenVault: AesGcmTokenVault;
  let oauthClient: MockVkOAuthClient;
  let tokenRefresher: TokenRefresher;

  let organizerId: string;
  const expiredAccessToken = 'vk1.a.expired_old_access_token';
  const initialRefreshToken = 'vk1.a.initial_refresh_token_valid';

  beforeEach(async () => {
    userRepo = new MemoryUserRepository();
    tokenVault = new AesGcmTokenVault('test-master-token-encryption-key-32b!');
    oauthClient = new MockVkOAuthClient();
    tokenRefresher = new TokenRefresher(userRepo, tokenVault, oauthClient);

    const encryptedAccessToken = await tokenVault.encrypt(expiredAccessToken);
    const encryptedRefreshToken = await tokenVault.encrypt(initialRefreshToken);

    // Save expired credential (expired 10 seconds ago)
    const user = await userRepo.upsertUserWithTokens({
      vkUserId: '98765432',
      firstName: 'Bob',
      lastName: 'Refresher',
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresIn: -10, // Expired in the past
    });
    organizerId = user.id;
  });

  it('20 concurrent requests for an expired token trigger exactly 1 refresh operation (single-flight mutex)', async () => {
    let refreshCallsCount = 0;
    const originalRefreshToken = oauthClient.refreshToken.bind(oauthClient);

    oauthClient.refreshToken = async (params) => {
      refreshCallsCount++;
      // Artificial delay to allow all 20 concurrent requests to pile in
      await new Promise(r => setTimeout(r, 50));
      return originalRefreshToken(params);
    };

    // Launch 20 concurrent requests
    const promises = Array.from({ length: 20 }, () =>
      tokenRefresher.getOrRefreshUserToken(organizerId)
    );

    const tokens = await Promise.all(promises);

    // 1. Single-Flight guarantee: Exactly 1 network refresh call was made
    expect(refreshCallsCount).toBe(1);

    // 2. All 20 callers received the same valid refreshed access token
    expect(tokens).toHaveLength(20);
    const firstToken = tokens[0];
    expect(firstToken).toMatch(/mock_refreshed_access_token_/);
    expect(tokens.every(t => t === firstToken)).toBe(true);

    // 3. Database credential record was updated with the new token
    const updatedCred = await userRepo.getUserCredentials(organizerId);
    expect(updatedCred?.expiresAt).toBeDefined();
    expect(updatedCred?.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('rotates refresh_token when provided by VK ID response', async () => {
    const refreshedToken = await tokenRefresher.getOrRefreshUserToken(organizerId);
    expect(refreshedToken).toBeDefined();

    const updatedCred = await userRepo.getUserCredentials(organizerId);
    const decryptedNewRefresh = await tokenVault.decrypt(updatedCred!.encryptedRefreshToken!);
    expect(decryptedNewRefresh).toMatch(/mock_new_refresh_token_/);
    expect(decryptedNewRefresh).not.toBe(initialRefreshToken);
  });

  it('throws VkReauthenticationRequiredError when refresh fails on VK side', async () => {
    oauthClient.shouldFailRefresh = true;

    await expect(
      tokenRefresher.getOrRefreshUserToken(organizerId)
    ).rejects.toThrow(VkReauthenticationRequiredError);
  });

  it('throws VkReauthenticationRequiredError when expired token has no refresh token', async () => {
    // Create user without refresh token
    const encryptedAccessToken = await tokenVault.encrypt(expiredAccessToken);
    const userNoRefresh = await userRepo.upsertUserWithTokens({
      vkUserId: '55555555',
      firstName: 'No',
      lastName: 'Refresh',
      encryptedAccessToken,
      expiresIn: -10, // Expired
    });

    await expect(
      tokenRefresher.getOrRefreshUserToken(userNoRefresh.id)
    ).rejects.toThrow(VkReauthenticationRequiredError);
  });
});
