import { VkAuthError, VkValidationError, VkNetworkError } from './vk-errors';

export interface VkOAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
  user_id: number;
  state?: string;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
  email?: string;
  phone?: string;
}

export interface IVkOAuthClient {
  buildAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scope?: string;
  }): string;

  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    state?: string;
  }): Promise<VkOAuthTokenResponse>;

  refreshToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
  }): Promise<VkOAuthTokenResponse>;

  getUserProfile(
    accessToken: string,
    userId: number | string
  ): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    username?: string;
    avatarUrl?: string;
  }>;
}

export class VkOAuthClient implements IVkOAuthClient {
  public static readonly DEFAULT_AUTH_URL = 'https://id.vk.com/auth';
  public static readonly DEFAULT_TOKEN_URL = 'https://id.vk.com/oauth2/auth';
  public static readonly DEFAULT_API_BASE = 'https://api.vk.com/method/';

  private readonly authUrl: string;
  private readonly tokenUrl: string;
  private readonly apiBase: string;

  constructor(options?: { authUrl?: string; tokenUrl?: string; apiBase?: string }) {
    this.authUrl = options?.authUrl || process.env.VK_ID_AUTH_URL || VkOAuthClient.DEFAULT_AUTH_URL;
    this.tokenUrl = options?.tokenUrl || process.env.VK_ID_TOKEN_URL || VkOAuthClient.DEFAULT_TOKEN_URL;
    this.apiBase = options?.apiBase || process.env.VK_API_BASE_URL || VkOAuthClient.DEFAULT_API_BASE;
  }

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

    if (params.scope) {
      query.append('scope', params.scope);
    }

    return `${this.authUrl}?${query.toString()}`;
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

    const formBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
    });

    if (params.clientSecret) {
      formBody.append('client_secret', params.clientSecret);
    }
    if (params.state) {
      formBody.append('state', params.state);
    }

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'Randomayzer-OAuth/1.0 (+https://github.com/ochenstarik-ui/randomayzer)',
        },
        body: formBody.toString(),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || data.error) {
        const errorDesc = data?.error_description || data?.error_msg || data?.error || 'Token exchange failed';
        throw new VkAuthError(`VK OAuth token exchange error (${response.status}): ${errorDesc}`, {
          errorCode: response.status,
        });
      }

      if (!data.access_token) {
        throw new VkAuthError('VK OAuth response missing access_token');
      }

      return {
        access_token: data.access_token,
        token_type: data.token_type || 'Bearer',
        expires_in: Number(data.expires_in || 0),
        user_id: Number(data.user_id || 0),
        refresh_token: data.refresh_token,
        id_token: data.id_token,
        email: data.email,
        phone: data.phone,
        scope: data.scope,
      };
    } catch (err: unknown) {
      if (err instanceof VkAuthError || err instanceof VkValidationError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Network error';
      throw new VkNetworkError(`Failed to connect to VK OAuth token endpoint: ${message}`);
    }
  }

  public async refreshToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
  }): Promise<VkOAuthTokenResponse> {
    if (!params.refreshToken) {
      throw new VkValidationError('Refresh token is required');
    }

    const formBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
    });

    if (params.clientSecret) {
      formBody.append('client_secret', params.clientSecret);
    }

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'Randomayzer-OAuth/1.0',
        },
        body: formBody.toString(),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || data.error) {
        const errorDesc = data?.error_description || data?.error_msg || data?.error || 'Token refresh failed';
        throw new VkAuthError(`VK OAuth token refresh error (${response.status}): ${errorDesc}`);
      }

      return {
        access_token: data.access_token,
        token_type: data.token_type || 'Bearer',
        expires_in: Number(data.expires_in || 0),
        user_id: Number(data.user_id || 0),
        refresh_token: data.refresh_token || params.refreshToken,
        id_token: data.id_token,
        email: data.email,
        phone: data.phone,
        scope: data.scope,
      };
    } catch (err: unknown) {
      if (err instanceof VkAuthError) throw err;
      const message = err instanceof Error ? err.message : 'Network error';
      throw new VkNetworkError(`Failed to refresh VK token: ${message}`);
    }
  }

  public async getUserProfile(
    accessToken: string,
    userId: number | string
  ): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    username?: string;
    avatarUrl?: string;
  }> {
    const url = `${this.apiBase}users.get`;
    const formBody = new URLSearchParams({
      user_ids: String(userId),
      fields: 'photo_100,photo_200,screen_name',
      access_token: accessToken,
      v: '5.199',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: formBody.toString(),
    });

    const data = await response.json().catch(() => null);
    const user = data?.response?.[0];

    if (!user) {
      return {
        id: String(userId),
        firstName: 'VK Organizer',
        lastName: String(userId),
      };
    }

    return {
      id: String(user.id),
      firstName: user.first_name || 'Organizer',
      lastName: user.last_name || '',
      username: user.screen_name || undefined,
      avatarUrl: user.photo_100 || user.photo_200 || undefined,
    };
  }
}

export let defaultVkOAuthClient: IVkOAuthClient = new VkOAuthClient();

export function setOAuthClient(client: IVkOAuthClient): void {
  defaultVkOAuthClient = client;
}

export function getOAuthClient(): IVkOAuthClient {
  if (process.env.USE_VK_MOCK === 'true' || (process.env.NODE_ENV === 'test' && !process.env.VK_APP_ID)) {
    return defaultVkOAuthClient;
  }
  return defaultVkOAuthClient;
}
