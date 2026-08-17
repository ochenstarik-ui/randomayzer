import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VkClient, fetchPaginatedVk } from '../src/integrations/vk/vk-client';
import { createServiceAuth, createUserAuth, createCommunityAuth, redactToken } from '../src/integrations/vk/vk-auth';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { 
  VkAuthError, 
  VkPermissionError, 
  VkRateLimitError, 
  VkTemporaryError, 
  VkValidationError, 
  VkTimeoutError 
} from '../src/integrations/vk/vk-errors';
import { IVkRateLimiter } from '../src/integrations/vk/vk-rate-limit';

class NoopRateLimiter implements IVkRateLimiter {
  async acquire(): Promise<void> {}
  reset(): void {}
}

describe('VK Client & Provider Mocked HTTP Integration', () => {
  const serviceToken = 'vk1.a.secret_service_token_123456789';
  let client: VkClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    client = new VkClient({
      rateLimiter: new NoopRateLimiter(),
      defaultTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchSuccess<T>(data: T) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ response: data }),
      json: async () => ({ response: data }),
    });
  }

  function mockFetchVkError(errorCode: number, errorMsg: string) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ error: { error_code: errorCode, error_msg: errorMsg } }),
      json: async () => ({ error: { error_code: errorCode, error_msg: errorMsg } }),
    });
  }

  it('successfully calls VK API and parses response payload', async () => {
    mockFetchSuccess({ items: [{ id: 100, owner_id: -1, text: 'Hello VK post' }] });

    const auth = createServiceAuth(serviceToken);
    const result = await client.call<{ items: Array<{ id: number; text: string }> }>(
      'wall.getById',
      { posts: '-1_100' },
      auth
    );

    expect(result.items).toBeDefined();
    expect(result.items[0].id).toBe(100);
    expect(result.items[0].text).toBe('Hello VK post');
  });

  it('supports User and Community auth context types', async () => {
    mockFetchSuccess({ count: 1, items: [100] });

    const userAuth = createUserAuth('vk1.a.user_token');
    const commAuth = createCommunityAuth('vk1.a.comm_token', '123456');

    const resUser = await client.call('likes.getList', { type: 'post' }, userAuth);
    expect(resUser).toBeDefined();

    const resComm = await client.call('likes.getList', { type: 'post' }, commAuth);
    expect(resComm).toBeDefined();
  });

  it('throws VkTimeoutError when request exceeds configured timeout', async () => {
    const slowClient = new VkClient({
      rateLimiter: new NoopRateLimiter(),
      defaultTimeoutMs: 20,
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      new Promise(resolve => setTimeout(resolve, 100))
    );

    const auth = createServiceAuth(serviceToken);
    await expect(
      slowClient.call('wall.getById', { posts: '-1_1' }, auth, { maxRetries: 0 })
    ).rejects.toThrow(VkTimeoutError);
  });

  it('aborts immediately when caller AbortSignal fires', async () => {
    const controller = new AbortController();
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Caller aborted')));
      })
    );

    const auth = createServiceAuth(serviceToken);
    const promise = client.call('wall.getById', {}, auth, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it('retries on retryable server error (error_code 10) up to maxRetries', async () => {
    let callCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ error: { error_code: 10, error_msg: 'Internal server error' } }),
          json: async () => ({ error: { error_code: 10, error_msg: 'Internal server error' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: { success: 1 } }),
        json: async () => ({ response: { success: 1 } }),
      };
    });

    const auth = createServiceAuth(serviceToken);
    const res = await client.call<{ success: number }>(
      'wall.getById',
      {},
      auth,
      { maxRetries: 3, retryInitialDelayMs: 5 }
    );

    expect(res.success).toBe(1);
    expect(callCount).toBe(3);
  });

  it('does NOT retry on non-retryable auth error (error_code 5)', async () => {
    let callCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ error: { error_code: 5, error_msg: 'User auth failed' } }),
        json: async () => ({ error: { error_code: 5, error_msg: 'User auth failed' } }),
      };
    });

    const auth = createServiceAuth(serviceToken);
    await expect(
      client.call('wall.getById', {}, auth, { maxRetries: 3 })
    ).rejects.toThrow(VkAuthError);

    expect(callCount).toBe(1);
  });

  it('does NOT retry on permission error (error_code 7)', async () => {
    mockFetchVkError(7, 'Permission to perform this action is denied');

    const auth = createServiceAuth(serviceToken);
    await expect(
      client.call('wall.getById', {}, auth, { maxRetries: 2 })
    ).rejects.toThrow(VkPermissionError);
  });

  it('throws VkValidationError on malformed non-JSON response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>502 Bad Gateway</html>',
      json: async () => { throw new Error('invalid json'); },
    });

    const auth = createServiceAuth(serviceToken);
    await expect(
      client.call('wall.getById', {}, auth, { maxRetries: 0 })
    ).rejects.toThrow(VkValidationError);
  });

  it('pagination abstraction handles single and multiple pages seamlessly', async () => {
    let page = 0;
    const fetchPage = vi.fn(async (offset: number, count: number) => {
      page++;
      if (page === 1) {
        return { items: [1, 2, 3], totalCount: 6 };
      }
      if (page === 2) {
        return { items: [4, 5, 6], totalCount: 6 };
      }
      return { items: [], totalCount: 6 };
    });

    const items = await fetchPaginatedVk<number>({
      pageSize: 3,
      fetchPage,
    });

    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('VkProvider deduplicates LIKE + COMMENT into a single merged participant', async () => {
    // 1. Likes response: user 100
    // 2. Comments response: user 100 and user 200
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('likes.getList')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            response: {
              count: 1,
              items: [{ id: 100, first_name: 'Alice', last_name: 'Like', photo_100: 'http://a.jpg' }],
            },
          }),
        };
      }
      if (url.includes('wall.getComments')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            response: {
              count: 2,
              items: [
                { id: 1, from_id: 100, text: 'Comment from Alice' },
                { id: 2, from_id: 200, text: 'Comment from Bob' },
              ],
              profiles: [
                { id: 100, first_name: 'Alice', last_name: 'Like' },
                { id: 200, first_name: 'Bob', last_name: 'Comment' },
              ],
            },
          }),
        };
      }
      return { ok: false, status: 404, text: async () => '' };
    });

    const provider = new VkProvider(serviceToken, client);
    const participants = await provider.fetchParticipants({
      ownerId: '-100',
      postId: '1',
      includeLikes: true,
      includeComments: true,
    });

    expect(participants.length).toBe(2);

    const alice = participants.find(p => p.platformUserId === '100');
    expect(alice).toBeDefined();
    expect(alice?.liked).toBe(true);
    expect(alice?.commented).toBe(true);
    expect(alice?.commentsCount).toBe(1);

    const bob = participants.find(p => p.platformUserId === '200');
    expect(bob).toBeDefined();
    expect(bob?.liked).toBe(false);
    expect(bob?.commented).toBe(true);
  });

  it('VkProvider batches subscription checks into 500-user chunks', async () => {
    const userIds = Array.from({ length: 1200 }, (_, i) => String(1000 + i));
    const capturedChunks: string[] = [];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init: any) => {
      const body = new URLSearchParams(init?.body || '');
      const idsParam = body.get('user_ids') || '';
      capturedChunks.push(idsParam);

      const parsedIds = idsParam.split(',').map(Number);
      const items = parsedIds.map(id => ({ user_id: id, member: id % 2 === 0 ? 1 : 0 }));

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: items }),
      };
    });

    const provider = new VkProvider(serviceToken, client);
    const subMap = await provider.checkSubscription(userIds, '100');

    expect(capturedChunks.length).toBe(3); // 500, 500, 200
    expect(capturedChunks[0].split(',').length).toBe(500);
    expect(capturedChunks[1].split(',').length).toBe(500);
    expect(capturedChunks[2].split(',').length).toBe(200);

    expect(subMap.size).toBe(1200);
    expect(subMap.get('1000')).toBe(true);
    expect(subMap.get('1001')).toBe(false);
  });

  it('ensures token is never exposed in logs or redaction utility', () => {
    const secret = 'vk1.a.secret_top_secret_token_value_99999';
    const redacted = redactToken(secret);

    expect(redacted).not.toBe(secret);
    expect(redacted).toContain('...');
    expect(redacted.length).toBeLessThan(15);
  });
});
