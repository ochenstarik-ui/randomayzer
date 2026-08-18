import { describe, it, expect, beforeEach } from 'vitest';
import { VkAuthContextResolver } from '../src/integrations/vk/vk-auth-resolver';
import { TokenRefresher } from '../src/lib/auth/token-refresher';
import { MemoryUserRepository } from '../src/lib/repository/user-repository';
import { AesGcmTokenVault } from '../src/lib/auth/token-vault';
import { MockVkOAuthClient } from '../src/integrations/vk/mock-oauth-client';
import { VkReauthenticationRequiredError } from '../src/integrations/vk/vk-errors';

describe('Phase 2.3 VkAuthContextResolver & Token Selection Policy', () => {
  let userRepo: MemoryUserRepository;
  let tokenVault: AesGcmTokenVault;
  let oauthClient: MockVkOAuthClient;
  let tokenRefresher: TokenRefresher;
  let resolver: VkAuthContextResolver;

  let organizerId: string;
  const rawAccessToken = 'vk1.a.alice_valid_user_access_token_12345';
  const rawRefreshToken = 'vk1.a.alice_valid_refresh_token_67890';

  beforeEach(async () => {
    userRepo = new MemoryUserRepository();
    tokenVault = new AesGcmTokenVault('test-master-token-encryption-key-32b!');
    oauthClient = new MockVkOAuthClient();
    tokenRefresher = new TokenRefresher(userRepo, tokenVault, oauthClient);
    resolver = new VkAuthContextResolver(tokenRefresher);

    process.env.VK_SERVICE_TOKEN = 'vk_service_token_secret_12345';

    // Store encrypted user credentials
    const encryptedAccessToken = await tokenVault.encrypt(rawAccessToken);
    const encryptedRefreshToken = await tokenVault.encrypt(rawRefreshToken);

    const user = await userRepo.upsertUserWithTokens({
      vkUserId: '12345678',
      firstName: 'Alice',
      lastName: 'Organizer',
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresIn: 3600, // Valid for 1 hour
    });
    organizerId = user.id;
  });

  it('selects SERVICE token by default for public operations (least privilege)', async () => {
    const auth = await resolver.resolveAuthContext({
      method: 'wall.getById',
      resource: { ownerId: '-100', postId: '1' },
    });

    expect(auth.type).toBe('SERVICE');
    expect(auth.token).toBe('vk_service_token_secret_12345');
  });

  it('selects USER token when preferredMode is explicitly set to USER', async () => {
    const auth = await resolver.resolveAuthContext({
      organizerId,
      preferredMode: 'USER',
      method: 'wall.getById',
    });

    expect(auth.type).toBe('USER');
    expect(auth.token).toBe(rawAccessToken);
  });

  it('throws VkReauthenticationRequiredError when USER token is requested but organizer is unauthenticated', async () => {
    await expect(
      resolver.resolveAuthContext({
        preferredMode: 'USER',
        method: 'wall.getById',
      })
    ).rejects.toThrow(VkReauthenticationRequiredError);
  });

  it('throws VkReauthenticationRequiredError when organizer credentials do not exist in database', async () => {
    await expect(
      resolver.resolveAuthContext({
        organizerId: 'usr_non_existent_organizer',
        preferredMode: 'USER',
        method: 'wall.getById',
      })
    ).rejects.toThrow(VkReauthenticationRequiredError);
  });

  it('resolves fallback USER token for controlled privacy/permission errors', async () => {
    const auth = await resolver.resolveUserFallbackContext(organizerId);

    expect(auth.type).toBe('USER');
    expect(auth.token).toBe(rawAccessToken);
  });
});
