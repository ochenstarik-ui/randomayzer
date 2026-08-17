import { 
  VkAuthContext, 
  VkCallOptions, 
  VkApiResponse, 
  VkPaginationOptions 
} from './vk-types';
import { 
  mapVkApiError, 
  mapHttpStatusError,
  VkTimeoutError, 
  VkCancelledError,
  VkNetworkError, 
  VkValidationError,
  VkPaginationLimitError
} from './vk-errors';
import { validateAuthContext } from './vk-auth';
import { IVkRateLimiter, defaultVkRateLimiter } from './vk-rate-limit';
import { executeWithRetry } from './vk-retry';

export interface IVkClient {
  call<T>(
    method: string,
    params: Record<string, any>,
    authContext: VkAuthContext,
    options?: VkCallOptions
  ): Promise<T>;
}

export interface VkClientOptions {
  apiVersion?: string;
  baseUrl?: string;
  defaultTimeoutMs?: number;
  rateLimiter?: IVkRateLimiter;
}

export class VkClient implements IVkClient {
  public static readonly DEFAULT_API_VERSION = '5.199';
  public static readonly DEFAULT_BASE_URL = 'https://api.vk.com/method/';
  public static readonly DEFAULT_TIMEOUT_MS = 15000;

  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly rateLimiter: IVkRateLimiter;

  constructor(options?: VkClientOptions) {
    this.apiVersion = options?.apiVersion ?? VkClient.DEFAULT_API_VERSION;
    this.baseUrl = options?.baseUrl ?? VkClient.DEFAULT_BASE_URL;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? VkClient.DEFAULT_TIMEOUT_MS;
    this.rateLimiter = options?.rateLimiter ?? defaultVkRateLimiter;
  }

  /**
   * Executes a single low-level HTTP call to VK API with explicit separate timeout/cancellation tracking.
   */
  private async executeSingleCall<T>(
    method: string,
    params: Record<string, any>,
    authContext: VkAuthContext,
    options?: VkCallOptions
  ): Promise<T> {
    validateAuthContext(authContext);

    // 1. Check if caller already aborted before execution starts
    if (options?.signal?.aborted) {
      throw new VkCancelledError(`VK request to "${method}" was cancelled by caller before execution`, {
        method,
      });
    }

    // 2. Acquire rate limit slot
    await this.rateLimiter.acquire();

    if (options?.signal?.aborted) {
      throw new VkCancelledError(`VK request to "${method}" was cancelled by caller while waiting for rate limiter`, {
        method,
      });
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let callerCancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    const onCallerAbort = () => {
      callerCancelled = true;
      controller.abort();
    };

    if (options?.signal) {
      options.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const url = `${this.baseUrl}${method}`;
    const formBody = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        formBody.append(key, String(value));
      }
    }

    formBody.append('v', this.apiVersion);
    formBody.append('access_token', authContext.token);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Randomayzer/1.0 (+https://github.com/ochenstarik-ui/randomayzer)',
        },
        body: formBody.toString(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw mapHttpStatusError(response.status, response.statusText, method);
      }

      const text = await response.text();
      let json: VkApiResponse<T>;

      try {
        json = JSON.parse(text);
      } catch {
        throw new VkValidationError(
          `VK API returned invalid non-JSON response for method ${method}`,
          { method }
        );
      }

      if (json.error) {
        throw mapVkApiError(json.error, method);
      }

      if (json.response === undefined) {
        throw new VkValidationError(
          `VK API response missing "response" payload for method ${method}`,
          { method }
        );
      }

      return json.response;
    } catch (err: unknown) {
      // Precise error classification:
      if (callerCancelled || options?.signal?.aborted) {
        throw new VkCancelledError(`VK API call to "${method}" was cancelled by the caller`, {
          method,
        });
      }

      if (timedOut) {
        throw new VkTimeoutError(`VK API call to "${method}" timed out after ${timeoutMs}ms`, {
          method,
        });
      }

      if (err instanceof Error && err.name === 'AbortError') {
        if (options?.signal?.aborted) {
          throw new VkCancelledError(`VK API call to "${method}" was aborted by caller signal`, {
            method,
          });
        }
        throw new VkTimeoutError(`VK API call to "${method}" was aborted by timeout`, { method });
      }

      if (err instanceof Error && !(err as any).category) {
        throw new VkNetworkError(`VK API network error on "${method}": ${err.message}`, {
          method,
        });
      }

      throw err;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (options?.signal) {
        options.signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /**
   * Main typed method with automatic retry engine.
   */
  public async call<T>(
    method: string,
    params: Record<string, any> = {},
    authContext: VkAuthContext,
    options?: VkCallOptions
  ): Promise<T> {
    return executeWithRetry<T>(
      () => this.executeSingleCall<T>(method, params, authContext, options),
      {
        maxRetries: options?.maxRetries,
        initialDelayMs: options?.retryInitialDelayMs,
        maxDelayMs: options?.retryMaxDelayMs,
      },
      options?.signal
    );
  }
}

/**
 * Universal pagination abstraction for VK API methods (offset/count based).
 */
export async function fetchPaginatedVk<TItem>(
  options: VkPaginationOptions<TItem> & { throwOnTruncation?: boolean }
): Promise<TItem[]> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 10000;
  const throwOnTruncation = options.throwOnTruncation ?? true;
  const allItems: TItem[] = [];
  let offset = 0;
  let page = 0;
  let recordedTotalCount: number | undefined;

  while (page < maxPages) {
    if (options.signal?.aborted) {
      throw new VkCancelledError('VK pagination cancelled by caller signal');
    }

    const { items, totalCount } = await options.fetchPage(offset, pageSize, options.signal);
    if (totalCount !== undefined) {
      recordedTotalCount = totalCount;
    }

    if (!items || items.length === 0) {
      break;
    }

    allItems.push(...items);
    offset += items.length;
    page++;

    if (options.onProgress) {
      options.onProgress(allItems.length, totalCount ?? null);
    }

    if (totalCount !== undefined && allItems.length >= totalCount) {
      break;
    }

    if (items.length < pageSize) {
      break;
    }
  }

  // Safety check against silent truncation
  if (
    page >= maxPages &&
    recordedTotalCount !== undefined &&
    allItems.length < recordedTotalCount
  ) {
    if (throwOnTruncation) {
      throw new VkPaginationLimitError(
        `VK pagination reached maxPages safety ceiling (${maxPages} pages) with only ${allItems.length}/${recordedTotalCount} items loaded. Truncation detected.`,
        { details: { loaded: allItems.length, total: recordedTotalCount, maxPages } }
      );
    }
  }

  return allItems;
}

export const defaultVkClient: IVkClient = new VkClient();
