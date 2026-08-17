import { VkAuthContext, VkTokenType } from './vk-types';
import { VkAuthError } from './vk-errors';

/**
 * Safely redacts an access token for logging and diagnostic purposes.
 */
export function redactToken(token?: string | null): string {
  if (!token || typeof token !== 'string') return '[NO_TOKEN]';
  if (token.length <= 8) return '***';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
}

/**
 * Validates that an auth context is properly formatted and non-empty.
 */
export function validateAuthContext(auth: VkAuthContext): void {
  if (!auth) {
    throw new VkAuthError('VK AuthContext is missing');
  }
  if (!auth.token || typeof auth.token !== 'string' || auth.token.trim().length === 0) {
    throw new VkAuthError(`VK ${auth.type || 'UNKNOWN'} access token is empty or invalid`);
  }
  if (auth.type === 'COMMUNITY' && !auth.communityId) {
    throw new VkAuthError('VK COMMUNITY auth context requires a valid communityId');
  }
}

/**
 * Factory functions for building type-safe VK auth contexts
 */
export function createServiceAuth(token: string): VkAuthContext {
  return { type: 'SERVICE', token };
}

export function createUserAuth(token: string): VkAuthContext {
  return { type: 'USER', token };
}

export function createCommunityAuth(token: string, communityId: string): VkAuthContext {
  return { type: 'COMMUNITY', token, communityId };
}
