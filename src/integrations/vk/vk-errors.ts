import { VkApiRawError } from './vk-types';

/**
 * Base abstract class for all VK client errors.
 * Guarantees that access tokens are never leaked into error messages or details.
 */
export abstract class VkClientError extends Error {
  abstract readonly isRetryable: boolean;
  abstract readonly category: string;
  readonly errorCode?: number;
  readonly method?: string;
  readonly details?: any;

  constructor(message: string, options?: { errorCode?: number; method?: string; details?: any }) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = options?.errorCode;
    this.method = options?.method;
    this.details = options?.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * VK Auth Error: Invalid, expired, or missing access_token (VK error codes: 4, 5, 28)
 */
export class VkAuthError extends VkClientError {
  readonly isRetryable = false;
  readonly category = 'AUTH';
}

/**
 * VK Permission Error: Insufficient permissions for method or scope (VK error codes: 7, 15, 260)
 */
export class VkPermissionError extends VkClientError {
  readonly isRetryable = false;
  readonly category = 'PERMISSION';
}

/**
 * VK Rate Limit Error: Too many requests per second or flood control (VK error codes: 6, 9)
 */
export class VkRateLimitError extends VkClientError {
  readonly isRetryable = true;
  readonly category = 'RATE_LIMIT';
}

/**
 * VK Private Resource Error: Target group/user profile is private or access is restricted (VK error codes: 15, 30, 203)
 */
export class VkPrivateResourceError extends VkClientError {
  readonly isRetryable = false;
  readonly category = 'PRIVATE_RESOURCE';
}

/**
 * VK Not Found Error: Wall post, group, or resource does not exist (VK error codes: 104, 210, 214)
 */
export class VkNotFoundError extends VkClientError {
  readonly isRetryable = false;
  readonly category = 'NOT_FOUND';
}

/**
 * VK Validation Error: Malformed parameters or bad request (VK error codes: 100, 113, 150)
 */
export class VkValidationError extends VkClientError {
  readonly isRetryable = false;
  readonly category = 'VALIDATION';
}

/**
 * VK Temporary Error: Unknown error, internal server error, or 5xx response from VK API (VK error codes: 1, 10, 500, 502, 503, 504)
 */
export class VkTemporaryError extends VkClientError {
  readonly isRetryable = true;
  readonly category = 'TEMPORARY';
}

/**
 * VK Network Error: Connection refused, DNS failure, or aborted network socket
 */
export class VkNetworkError extends VkClientError {
  readonly isRetryable = true;
  readonly category = 'NETWORK';
}

/**
 * VK Timeout Error: Request was aborted due to client timeout
 */
export class VkTimeoutError extends VkClientError {
  readonly isRetryable = true;
  readonly category = 'TIMEOUT';
}

/**
 * Sanitizes request params returned by VK to redact any sensitive token values.
 */
function sanitizeRequestParams(params?: Array<{ key: string; value: string }>): Array<{ key: string; value: string }> | undefined {
  if (!params) return undefined;
  return params.map(p => {
    if (p.key.toLowerCase().includes('token') || p.key.toLowerCase().includes('access_token')) {
      return { key: p.key, value: '[REDACTED]' };
    }
    return p;
  });
}

/**
 * Maps raw VK API error_code according to official VK API documentation.
 */
export function mapVkApiError(raw: VkApiRawError, method: string): VkClientError {
  const code = raw.error_code;
  const sanitizedParams = sanitizeRequestParams(raw.request_params);
  const msg = raw.error_msg || raw.error_text || `VK API Error (${code})`;

  switch (code) {
    case 4: // Incorrect signature
    case 5: // User authorization failed
    case 28: // Application authorization failed
      return new VkAuthError(`VK Authentication Error (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });

    case 6: // Too many requests per second
    case 9: // Flood control
    case 29: // Rate limit reached
      return new VkRateLimitError(`VK Rate Limit Error (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });

    case 7: // Permission to perform this action is denied
    case 260: // Access to the group is denied
      return new VkPermissionError(`VK Permission Denied (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });

    case 15: // Access denied (private object)
    case 30: // This profile is private
    case 203: // Access to the group is denied
      return new VkPrivateResourceError(`VK Private Resource Access Denied (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });

    case 100: // One of the parameters specified was missing or invalid
    case 113: // Invalid user id
    case 150: // Invalid timestamp
      return new VkValidationError(`VK Invalid Parameters (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });

    case 104: // Not found
    case 210: // Access to wall's post denied or post not found
    case 214: // Access to adding post denied / not found
      return new VkNotFoundError(`VK Resource Not Found (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });

    case 1: // Unknown error occurred
    case 10: // Internal server error
    case 500:
    case 502:
    case 503:
    case 504:
      return new VkTemporaryError(`VK Server Temporary Error (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });

    default:
      return new VkValidationError(`VK API Error (${code}): ${msg}`, { errorCode: code, method, details: sanitizedParams });
  }
}
