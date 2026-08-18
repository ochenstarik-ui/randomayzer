import { IVkOAuthClient, VkOAuthTokenResponse } from './vk-oauth-client';
import { VkAuthError, VkNetworkError, VkValidationError } from './vk-errors';

export class MockVkOAuthClient implements IVkOAuthClient {
  public shouldFailExchange = false;
  public shouldFailRefresh = false;
  /** Simulates a transient network failure on refresh (not an auth error). */
  public shouldFailRefreshWithNetwork = false;
  /** Controls the user_id returned in token responses. Useful for identity mismatch tests. */
  public mockUserId: number = 12345678;
  /** When true, refresh response omits refresh_token (tests token retention). */
  public shouldReturnNoRefreshToken = false;

  public buildAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scope?: string;
  }): string {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://id.vk.com/auth?${query.toString()}`;
  }

  public async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    state?: string;
  }): Promise<VkOAuthTokenResponse> {
    if (!params.code) {
      throw new VkValidationError('Authorization code is missing');
    }
    if (!params.codeVerifier) {
      throw new VkValidationError('PKCE code_verifier is missing');
    }
    if (this.shouldFailExchange || params.code === 'invalid_code') {
      throw new VkAuthError('VK OAuth token exchange failed: invalid_grant');
    }

    return {
      access_token: `mock_vk_access_token_${params.code}`,
      token_type: 'Bearer',
      expires_in: 86400,
      user_id: this.mockUserId,
      refresh_token: `mock_vk_refresh_token_${params.code}`,
      scope: 'wall,groups,offline',
    };
  }

  public async refreshToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
  }): Promise<VkOAuthTokenResponse> {
    if (!params.refreshToken) {
      throw new VkValidationError('Refresh token is required');
    }
    if (this.shouldFailRefreshWithNetwork) {
      throw new VkNetworkError('Simulated network error during token refresh');
    }
    if (this.shouldFailRefresh || params.refreshToken === 'invalid_refresh') {
      throw new VkAuthError('VK OAuth token refresh failed: invalid_grant');
    }

    const ts = Date.now();
    return {
      access_token: `mock_refreshed_access_token_${ts}`,
      token_type: 'Bearer',
      expires_in: 86400,
      user_id: this.mockUserId,
      refresh_token: this.shouldReturnNoRefreshToken ? undefined : `mock_new_refresh_token_${ts}`,
      scope: 'wall,groups,offline',
    };
  }

  public async getUserProfile(
    _accessToken: string,
    userId: number | string
  ): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    username?: string;
    avatarUrl?: string;
  }> {
    return {
      id: String(userId),
      firstName: 'Иван',
      lastName: 'Организаторов',
      username: 'organizer_ivan',
      avatarUrl: 'https://sun9-1.userapi.com/s/v1/ig2/mock_avatar.jpg',
    };
  }
}
