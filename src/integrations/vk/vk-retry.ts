import { VkClientError, VkCancelledError } from './vk-errors';

export interface VkRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
}

/**
 * Calculates exponential backoff delay with optional full jitter.
 */
export function calculateBackoffDelay(
  attempt: number,
  options: Required<VkRetryOptions>
): number {
  const baseDelay = options.initialDelayMs * Math.pow(options.factor, attempt);
  const cappedDelay = Math.min(baseDelay, options.maxDelayMs);

  if (options.jitter) {
    // Full jitter: random delay between 0 and cappedDelay
    return Math.floor(Math.random() * cappedDelay);
  }

  return Math.floor(cappedDelay);
}

/**
 * Determines whether a given error is eligible for retry.
 */
export function isErrorRetryable(error: unknown): boolean {
  if (error instanceof VkClientError) {
    return error.isRetryable;
  }
  return false;
}

/**
 * Executes an asynchronous operation with retry and backoff.
 */
export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options?: VkRetryOptions,
  signal?: AbortSignal
): Promise<T> {
  const config: Required<VkRetryOptions> = {
    maxRetries: options?.maxRetries ?? 3,
    initialDelayMs: options?.initialDelayMs ?? 300,
    maxDelayMs: options?.maxDelayMs ?? 4000,
    factor: options?.factor ?? 2,
    jitter: options?.jitter ?? true,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new VkCancelledError('Operation aborted by caller signal before attempt');
    }

    try {
      return await operation(attempt);
    } catch (err: unknown) {
      lastError = err;

      if (attempt === config.maxRetries || !isErrorRetryable(err)) {
        throw err;
      }

      const delay = calculateBackoffDelay(attempt, config);
      if (delay > 0) {
        await new Promise((resolve, reject) => {
          let timeoutId: NodeJS.Timeout | null = null;
          const onAbort = () => {
            if (timeoutId) clearTimeout(timeoutId);
            reject(new VkCancelledError('Operation aborted by caller signal during retry backoff'));
          };

          timeoutId = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve(true);
          }, delay);

          if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }
  }

  throw lastError;
}
