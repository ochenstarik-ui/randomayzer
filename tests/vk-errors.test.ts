import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { VkClient } from '../src/integrations/vk/vk-client';
import { 
  VkAuthError, 
  VkPermissionError, 
  VkRateLimitError, 
  VkPrivateResourceError, 
  VkNotFoundError, 
  VkValidationError, 
  VkTemporaryError,
  VkNetworkError 
} from '../src/integrations/vk/vk-errors';
import { IVkRateLimiter } from '../src/integrations/vk/vk-rate-limit';

class NoopRateLimiter implements IVkRateLimiter {
  async acquire(): Promise<void> {}
  reset(): void {}
}

describe('VK API error handling', () => {
  const token = 'vk1.a.test-service-token';
  let client: VkClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    client = new VkClient({
      rateLimiter: new NoopRateLimiter(),
      defaultTimeoutMs: 100,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchJson(json: unknown, status = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 500 ? 'Internal Server Error' : 'OK',
      json: async () => json,
      text: async () => (typeof json === 'string' ? json : JSON.stringify(json)),
    });
  }

  function mockFetchNetworkError(message = 'Network request failed') {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(message));
  }

  it('throws on invalid token (error_code 5)', async () => {
    mockFetchJson({ error: { error_code: 5, error_msg: 'User authorization failed' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchPost('https://vk.com/wall-1_1')).rejects.toThrow(VkAuthError);
  });

  it('throws on expired token (error_code 5)', async () => {
    mockFetchJson({ error: { error_code: 5, error_msg: 'User authorization failed' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchParticipants({ ownerId: '-1', postId: '1' })).rejects.toThrow(VkAuthError);
  });

  it('throws on access denied (error_code 15)', async () => {
    mockFetchJson({ error: { error_code: 15, error_msg: 'Access denied' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchPost('https://vk.com/wall-1_1')).rejects.toThrow(VkPrivateResourceError);
  });

  it('throws on rate limit per second (error_code 6)', async () => {
    mockFetchJson({ error: { error_code: 6, error_msg: 'Too many requests per second' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchParticipants({ ownerId: '-1', postId: '1' })).rejects.toThrow(VkRateLimitError);
  });

  it('throws on daily rate limit (error_code 29)', async () => {
    mockFetchJson({ error: { error_code: 29, error_msg: 'Rate limit reached' } });
    const provider = new VkProvider(token, client);

    await expect(provider.checkSubscription(['1', '2'], '1')).rejects.toThrow(VkRateLimitError);
  });

  it('throws on private profile (error_code 30)', async () => {
    mockFetchJson({ error: { error_code: 30, error_msg: 'This profile is private' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchParticipants({ ownerId: '-1', postId: '1' })).rejects.toThrow(VkPrivateResourceError);
  });

  it('throws on deleted or banned user (error_code 18)', async () => {
    mockFetchJson({ error: { error_code: 18, error_msg: 'User was deleted or banned' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchParticipants({ ownerId: '-1', postId: '1' })).rejects.toThrow(VkValidationError);
  });

  it('throws on deleted post (error_code 100 with post not found semantics)', async () => {
    mockFetchJson({ error: { error_code: 100, error_msg: 'One of the parameters specified was missing or invalid' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchPost('https://vk.com/wall-1_999999')).rejects.toThrow(VkValidationError);
  });

  it('throws when post is not found in response', async () => {
    mockFetchJson({ response: { items: [] } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchPost('https://vk.com/wall-1_1')).rejects.toThrow(VkNotFoundError);
  });

  it('throws on unavailable community (error_code 203)', async () => {
    mockFetchJson({ error: { error_code: 203, error_msg: 'Access to the community is denied' } });
    const provider = new VkProvider(token, client);

    await expect(provider.fetchPost('https://vk.com/wall-1_1')).rejects.toThrow(VkPrivateResourceError);
  });

  it('throws on empty response body', async () => {
    mockFetchJson({});
    const provider = new VkProvider(token, client);

    await expect(provider.fetchPost('https://vk.com/wall-1_1')).rejects.toThrow(VkValidationError);
  });

  it('throws on HTTP 500 from VK', async () => {
    mockFetchJson('Internal Server Error', 500);
    const provider = new VkProvider(token, client);

    await expect(provider.fetchParticipants({ ownerId: '-1', postId: '1' })).rejects.toThrow(VkTemporaryError);
  });

  it('throws on network timeout / failure', async () => {
    mockFetchNetworkError('fetch failed');
    const provider = new VkProvider(token, client);

    await expect(provider.fetchParticipants({ ownerId: '-1', postId: '1' })).rejects.toThrow(VkNetworkError);
  });

  it('does not leak the service token in thrown error messages', async () => {
    mockFetchJson({ error: { error_code: 5, error_msg: 'User authorization failed' } });
    const provider = new VkProvider(token, client);

    try {
      await provider.fetchPost('https://vk.com/wall-1_1');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.message).not.toContain(token);
    }
  });
});
