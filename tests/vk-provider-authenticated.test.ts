import { describe, it, expect, beforeEach } from 'vitest';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { VkAuthContextResolver } from '../src/integrations/vk/vk-auth-resolver';
import { TokenRefresher } from '../src/lib/auth/token-refresher';
import { MemoryUserRepository } from '../src/lib/repository/user-repository';
import { AesGcmTokenVault } from '../src/lib/auth/token-vault';
import { MockVkOAuthClient } from '../src/integrations/vk/mock-oauth-client';
import { IVkClient } from '../src/integrations/vk/vk-client';
import { VkAuthContext } from '../src/integrations/vk/vk-types';
import { 
  VkPrivateResourceError, 
  VkRateLimitError, 
  VkTemporaryError 
} from '../src/integrations/vk/vk-errors';
import { resolveEffectiveCapabilities } from '../src/providers/vk/vk-capabilities';

describe('Phase 2.3 Authenticated VK Provider & Controlled Fallback Gate', () => {
  let userRepo: MemoryUserRepository;
  let tokenVault: AesGcmTokenVault;
  let oauthClient: MockVkOAuthClient;
  let tokenRefresher: TokenRefresher;
  let authResolver: VkAuthContextResolver;

  let organizerId: string;
  const userTokenPlain = 'vk1.a.organizer_user_access_token_abc';
  const serviceTokenPlain = 'vk_service_token_xyz';

  beforeEach(async () => {
    userRepo = new MemoryUserRepository();
    tokenVault = new AesGcmTokenVault('test-master-token-encryption-key-32b!');
    oauthClient = new MockVkOAuthClient();
    tokenRefresher = new TokenRefresher(userRepo, tokenVault, oauthClient);
    authResolver = new VkAuthContextResolver(tokenRefresher);

    process.env.VK_SERVICE_TOKEN = serviceTokenPlain;

    const encryptedAccessToken = await tokenVault.encrypt(userTokenPlain);
    const user = await userRepo.upsertUserWithTokens({
      vkUserId: '77778888',
      firstName: 'Dmitry',
      lastName: 'Organizer',
      encryptedAccessToken,
      expiresIn: 7200,
    });
    organizerId = user.id;
  });

  it('uses SERVICE token for public posts by default (least privilege)', async () => {
    let capturedAuth: VkAuthContext | undefined;

    const mockClient: IVkClient = {
      call: async (_method, _params, auth) => {
        capturedAuth = auth;
        return {
          items: [
            {
              id: 100,
              owner_id: -100,
              date: 1700000000,
              text: 'Public post',
              likes: { count: 5 },
              comments: { count: 2 },
              reposts: { count: 1 },
            },
          ],
        } as any;
      },
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);
    const post = await provider.fetchPost('https://vk.com/wall-100_100', { organizerId });

    expect(post.title).toBe('Public post...');
    expect(capturedAuth?.type).toBe('SERVICE');
    expect(capturedAuth?.token).toBe(serviceTokenPlain);
  });

  it('performs controlled fallback to USER token when SERVICE token receives private resource error', async () => {
    const authSequence: VkAuthContext[] = [];

    const mockClient: IVkClient = {
      call: async (_method, _params, auth) => {
        authSequence.push(auth!);
        if (auth?.type === 'SERVICE') {
          // Simulate VK API error 15 / 30 (Access denied to private group/profile)
          throw new VkPrivateResourceError('Access denied: post is in a private group', { errorCode: 15 });
        }

        // USER token succeeds
        return {
          items: [
            {
              id: 200,
              owner_id: -200,
              date: 1700000000,
              text: 'Private group post visible to organizer',
              likes: { count: 10 },
              comments: { count: 4 },
              reposts: { count: 0 },
            },
          ],
        } as any;
      },
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);
    const post = await provider.fetchPost('https://vk.com/wall-200_200', { organizerId });

    expect(post.title).toBe('Private group post visible to organizer...');
    expect(authSequence).toHaveLength(2);
    expect(authSequence[0].type).toBe('SERVICE');
    expect(authSequence[1].type).toBe('USER');
    expect(authSequence[1].token).toBe(userTokenPlain);
  });

  it('strictly forbids fallback on rate limits (HTTP 429 / error 6/29)', async () => {
    const authSequence: VkAuthContext[] = [];

    const mockClient: IVkClient = {
      call: async (_method, _params, auth) => {
        authSequence.push(auth!);
        throw new VkRateLimitError('VK rate limit reached', { errorCode: 6 });
      },
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);

    await expect(
      provider.fetchPost('https://vk.com/wall-100_100', { organizerId })
    ).rejects.toThrow(VkRateLimitError);

    // Fallback was NOT attempted on rate limit
    expect(authSequence).toHaveLength(1);
    expect(authSequence[0].type).toBe('SERVICE');
  });

  it('strictly forbids fallback on VK server errors (HTTP 500 / error 10)', async () => {
    const authSequence: VkAuthContext[] = [];

    const mockClient: IVkClient = {
      call: async (_method, _params, auth) => {
        authSequence.push(auth!);
        throw new VkTemporaryError('VK Internal Server Error', { errorCode: 10 });
      },
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);

    await expect(
      provider.fetchPost('https://vk.com/wall-100_100', { organizerId })
    ).rejects.toThrow(VkTemporaryError);

    expect(authSequence).toHaveLength(1);
    expect(authSequence[0].type).toBe('SERVICE');
  });

  it('derives effective capabilities accurately depending on accessMode', () => {
    const serviceCapabilities = resolveEffectiveCapabilities({ type: 'SERVICE', token: 's' });
    expect(serviceCapabilities.accessMode).toBe('PUBLIC_SERVICE');
    expect(serviceCapabilities.adminDetection).toBe(false);

    const userCapabilities = resolveEffectiveCapabilities({ type: 'USER', token: 'u' });
    expect(userCapabilities.accessMode).toBe('ORGANIZER_USER');
    expect(userCapabilities.adminDetection).toBe(false);

    const communityCapabilities = resolveEffectiveCapabilities({ type: 'COMMUNITY', token: 'c', communityId: '100' });
    expect(communityCapabilities.accessMode).toBe('COMMUNITY_GROUP');
    expect(communityCapabilities.adminDetection).toBe(true);
  });
});
