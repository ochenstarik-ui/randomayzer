import { VkAuthContext, VkTokenType } from './vk-types';
import { VkAuthError, VkReauthenticationRequiredError } from './vk-errors';
import { TokenRefresher, defaultTokenRefresher } from '@/lib/auth/token-refresher';

export interface ResolveAuthContextParams {
  organizerId?: string;
  method?: string;
  resource?: {
    ownerId: string;
    postId?: string;
  };
  preferredMode?: VkTokenType;
  allowFallback?: boolean;
}

export class VkAuthContextResolver {
  constructor(private tokenRefresher: TokenRefresher = defaultTokenRefresher) {}

  public setTokenRefresher(refresher: TokenRefresher): void {
    this.tokenRefresher = refresher;
  }

  /**
   * Resolves the appropriate VK AuthContext based on the principle of least privilege.
   */
  public async resolveAuthContext(params: ResolveAuthContextParams): Promise<VkAuthContext> {
    const { organizerId, preferredMode } = params;

    // 1. Explicit COMMUNITY token requested
    if (preferredMode === 'COMMUNITY') {
      const communityId = params.resource?.ownerId?.replace(/^-/, '');
      const communityToken = process.env[`VK_COMMUNITY_TOKEN_${communityId}`];
      if (communityToken) {
        return { type: 'COMMUNITY', token: communityToken, communityId };
      }
      // If community token not configured, fallback to USER if organizer exists
      if (organizerId) {
        const userToken = await this.tokenRefresher.getOrRefreshUserToken(organizerId);
        return { type: 'USER', token: userToken };
      }
      throw new VkAuthError('Community token not found and no organizer session provided');
    }

    // 2. Explicit USER token requested
    if (preferredMode === 'USER') {
      if (!organizerId) {
        throw new VkReauthenticationRequiredError('Organizer authentication is required to use user credentials');
      }
      const userToken = await this.tokenRefresher.getOrRefreshUserToken(organizerId);
      return { type: 'USER', token: userToken };
    }

    // 3. Explicit SERVICE token requested
    if (preferredMode === 'SERVICE') {
      const serviceToken = process.env.VK_SERVICE_TOKEN;
      if (!serviceToken) {
        if (organizerId) {
          // Controlled fallback to USER if SERVICE token not configured
          const userToken = await this.tokenRefresher.getOrRefreshUserToken(organizerId);
          return { type: 'USER', token: userToken };
        }
        throw new VkAuthError('VK_SERVICE_TOKEN is not configured in server environment');
      }
      return { type: 'SERVICE', token: serviceToken };
    }

    // 4. Automatic Selection (Least Privilege Policy)
    // Default to SERVICE token for public operations if available
    const serviceToken = process.env.VK_SERVICE_TOKEN;
    if (serviceToken) {
      return { type: 'SERVICE', token: serviceToken };
    }

    // If no service token exists, but organizer is authenticated, resolve USER token
    if (organizerId) {
      const userToken = await this.tokenRefresher.getOrRefreshUserToken(organizerId);
      return { type: 'USER', token: userToken };
    }

    throw new VkAuthError('No VK credentials (neither VK_SERVICE_TOKEN nor organizer session) available');
  }

  /**
   * Resolves USER token specifically for controlled fallback when a SERVICE call fails with a private resource error.
   */
  public async resolveUserFallbackContext(organizerId: string): Promise<VkAuthContext> {
    if (!organizerId) {
      throw new VkReauthenticationRequiredError('Organizer authentication required for user credential fallback');
    }
    const userToken = await this.tokenRefresher.getOrRefreshUserToken(organizerId);
    return { type: 'USER', token: userToken };
  }
}

export const defaultVkAuthContextResolver = new VkAuthContextResolver();
