import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VkClient, fetchPaginatedVk } from '../src/integrations/vk/vk-client';
import { createServiceAuth, redactToken } from '../src/integrations/vk/vk-auth';
import { 
  VkCancelledError, 
  VkTimeoutError, 
  VkRateLimitError, 
  VkTemporaryError, 
  VkAuthError, 
  VkPermissionError, 
  VkPrivateResourceError,
  VkNotFoundError, 
  VkValidationError,
  VkPaginationLimitError
} from '../src/integrations/vk/vk-errors';
import { IVkRateLimiter } from '../src/integrations/vk/vk-rate-limit';

class ImmediateRateLimiter implements IVkRateLimiter {
  async acquire(): Promise<void> {}
  reset(): void {}
}

describe('Phase 2.1.1 VK Client Correctness Gate & Official Schema Verification', () => {
  const token = 'vk1.a.correctness_gate_secret_token_12345';
  const auth = createServiceAuth(token);
  let client: VkClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    client = new VkClient({
      rateLimiter: new ImmediateRateLimiter(),
      defaultTimeoutMs: 500,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchVkError(errorCode: number, errorMsg: string) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ error: { error_code: errorCode, error_msg: errorMsg } }),
      json: async () => ({ error: { error_code: errorCode, error_msg: errorMsg } }),
    });
  }

  // --- 1. Cancellation vs Timeout Separation ---

  it('caller already aborted before call immediately throws VkCancelledError with 0 retries', async () => {
    const controller = new AbortController();
    controller.abort();

    let fetchCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      fetchCount++;
      return { ok: true, status: 200, text: async () => '{"response": 1}' };
    });

    await expect(
      client.call('wall.getById', {}, auth, { signal: controller.signal, maxRetries: 3 })
    ).rejects.toThrow(VkCancelledError);

    expect(fetchCount).toBe(0);
  });

  it('caller abort during active request throws VkCancelledError and NEVER retries', async () => {
    const controller = new AbortController();
    let fetchCount = 0;

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url, init) => {
      fetchCount++;
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('AbortError'));
        });
      });
    });

    const callPromise = client.call('wall.getById', {}, auth, { signal: controller.signal, maxRetries: 3 });

    setTimeout(() => controller.abort(), 10);

    await expect(callPromise).rejects.toThrow(VkCancelledError);
    expect(fetchCount).toBe(1);
  });

  it('internal timeout throws VkTimeoutError and retries according to policy', async () => {
    const timeoutClient = new VkClient({
      rateLimiter: new ImmediateRateLimiter(),
      defaultTimeoutMs: 25,
    });

    let fetchCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      fetchCount++;
      if (fetchCount < 3) {
        return new Promise(resolve => setTimeout(resolve, 80));
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: { success: 1 } }),
      };
    });

    const result = await timeoutClient.call<{ success: number }>(
      'wall.getById',
      {},
      auth,
      { maxRetries: 3, retryInitialDelayMs: 5 }
    );

    expect(result.success).toBe(1);
    expect(fetchCount).toBe(3);
  });

  it('caller abort during retry backoff terminates immediately with VkCancelledError', async () => {
    const controller = new AbortController();
    let fetchCount = 0;

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      fetchCount++;
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
    });

    const callPromise = client.call(
      'wall.getById',
      {},
      auth,
      { signal: controller.signal, maxRetries: 3, retryInitialDelayMs: 200 }
    );

    setTimeout(() => controller.abort(), 30);

    await expect(callPromise).rejects.toThrow(VkCancelledError);
    expect(fetchCount).toBe(1);
  });

  // --- 2. HTTP Status Code Handling ---

  it('HTTP 429 Too Many Requests throws VkRateLimitError and retries', async () => {
    let fetchCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      fetchCount++;
      if (fetchCount < 2) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: { ok: true } }),
      };
    });

    const res = await client.call<{ ok: boolean }>('likes.getList', {}, auth, { maxRetries: 2, retryInitialDelayMs: 5 });
    expect(res.ok).toBe(true);
    expect(fetchCount).toBe(2);
  });

  it('HTTP 500, 502, 503 throw VkTemporaryError and retry', async () => {
    for (const status of [500, 502, 503]) {
      let fetchCount = 0;
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        fetchCount++;
        if (fetchCount < 2) {
          return { ok: false, status, statusText: 'Server Error' };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ response: { ok: true } }),
        };
      });

      const res = await client.call<{ ok: boolean }>('wall.getById', {}, auth, { maxRetries: 2, retryInitialDelayMs: 5 });
      expect(res.ok).toBe(true);
      expect(fetchCount).toBe(2);
    }
  });

  it('HTTP 400 throws VkValidationError and does NOT retry', async () => {
    let fetchCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      fetchCount++;
      return { ok: false, status: 400, statusText: 'Bad Request' };
    });

    await expect(client.call('wall.getById', {}, auth, { maxRetries: 3 })).rejects.toThrow(VkValidationError);
    expect(fetchCount).toBe(1);
  });

  // --- 3. Official VK API Error Codes ---

  it('VK error 5 (user auth) & 28 (app auth) throw VkAuthError without retry', async () => {
    mockFetchVkError(5, 'User authorization failed');
    await expect(client.call('wall.getById', {}, auth, { maxRetries: 2 })).rejects.toThrow(VkAuthError);

    mockFetchVkError(28, 'Application authorization failed');
    await expect(client.call('wall.getById', {}, auth, { maxRetries: 2 })).rejects.toThrow(VkAuthError);
  });

  it('VK error 6 (too many req/s), 9 (flood control), 29 (rate limit) throw VkRateLimitError and retry', async () => {
    for (const code of [6, 9, 29]) {
      let fetchCount = 0;
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        fetchCount++;
        if (fetchCount < 2) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ error: { error_code: code, error_msg: 'Rate limited' } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ response: { ok: true } }),
        };
      });

      const res = await client.call<{ ok: boolean }>('wall.getById', {}, auth, { maxRetries: 2, retryInitialDelayMs: 5 });
      expect(res.ok).toBe(true);
      expect(fetchCount).toBe(2);
    }
  });

  it('VK error 10 (internal server error) throws VkTemporaryError and retries', async () => {
    let fetchCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      fetchCount++;
      if (fetchCount < 2) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ error: { error_code: 10, error_msg: 'Internal error' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: { ok: true } }),
      };
    });

    const res = await client.call<{ ok: boolean }>('wall.getById', {}, auth, { maxRetries: 2, retryInitialDelayMs: 5 });
    expect(res.ok).toBe(true);
    expect(fetchCount).toBe(2);
  });

  it('VK error 7 (permission denied) & 15 (access denied) & 30 (private profile) throw non-retryable errors', async () => {
    mockFetchVkError(7, 'Permission denied');
    await expect(client.call('wall.getById', {}, auth, { maxRetries: 2 })).rejects.toThrow(VkPermissionError);

    mockFetchVkError(15, 'Access denied');
    await expect(client.call('wall.getById', {}, auth, { maxRetries: 2 })).rejects.toThrow(VkPrivateResourceError);

    mockFetchVkError(30, 'Private profile');
    await expect(client.call('wall.getById', {}, auth, { maxRetries: 2 })).rejects.toThrow(VkPrivateResourceError);
  });

  it('VK error 100 (missing/invalid param) throws VkValidationError without retry', async () => {
    mockFetchVkError(100, 'One of the parameters specified was missing or invalid');
    await expect(client.call('wall.getById', {}, auth, { maxRetries: 2 })).rejects.toThrow(VkValidationError);
  });

  // --- 4. Pagination Truncation Safety ---

  it('pagination throws VkPaginationLimitError when maxPages is hit before totalCount is loaded', async () => {
    const fetchPage = vi.fn(async () => {
      return { items: [1, 2], totalCount: 10 };
    });

    await expect(
      fetchPaginatedVk<number>({
        pageSize: 2,
        maxPages: 2,
        fetchPage,
        throwOnTruncation: true,
      })
    ).rejects.toThrow(VkPaginationLimitError);
  });

  // --- 5. Malformed Response & Missing Response ---

  it('throws VkValidationError on malformed non-JSON response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{ broken_json ',
    });

    await expect(client.call('wall.getById', {}, auth, { maxRetries: 0 })).rejects.toThrow(VkValidationError);
  });

  it('throws VkValidationError on missing response field in VK JSON', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    });

    await expect(client.call('wall.getById', {}, auth, { maxRetries: 0 })).rejects.toThrow(VkValidationError);
  });

  // --- 6. Token Redaction Verification ---

  it('verifies token is never exposed in error message or error details', async () => {
    const secretToken = 'vk1.a.ultra_secret_token_999999999';
    const authSecret = createServiceAuth(secretToken);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        error: {
          error_code: 5,
          error_msg: 'User authorization failed: invalid access_token.',
          request_params: [
            { key: 'oauth', value: '1' },
            { key: 'access_token', value: secretToken },
          ],
        },
      }),
    });

    try {
      await client.call('wall.getById', {}, authSecret, { maxRetries: 0 });
      expect.unreachable('Should have thrown VkAuthError');
    } catch (err: any) {
      expect(err.message).not.toContain(secretToken);
      const detailsStr = JSON.stringify(err.details);
      expect(detailsStr).not.toContain(secretToken);
      expect(detailsStr).toContain('[REDACTED]');
    }
  });
});
