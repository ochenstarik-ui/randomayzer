import { IUserRepository, defaultUserRepository } from '@/lib/repository/user-repository';
import { ITokenVault, defaultTokenVault } from '@/lib/auth/token-vault';
import { IVkOAuthClient, defaultVkOAuthClient } from '@/integrations/vk/vk-oauth-client';
import { VkReauthenticationRequiredError } from '@/integrations/vk/vk-errors';

export class TokenRefresher {
  private inFlightRefreshes = new Map<string, Promise<string>>();

  constructor(
    private userRepo: IUserRepository = defaultUserRepository,
    private tokenVault: ITokenVault = defaultTokenVault,
    private oauthClient: IVkOAuthClient = defaultVkOAuthClient
  ) {}

  public setDependencies(deps: {
    userRepo?: IUserRepository;
    tokenVault?: ITokenVault;
    oauthClient?: IVkOAuthClient;
  }): void {
    if (deps.userRepo) this.userRepo = deps.userRepo;
    if (deps.tokenVault) this.tokenVault = deps.tokenVault;
    if (deps.oauthClient) this.oauthClient = deps.oauthClient;
  }

  /**
   * Refreshes the user token using a single-flight concurrency mutex.
   * If 20 concurrent requests attempt to refresh the token simultaneously for the same userId,
   * only 1 network request to VK ID is executed, and all callers share the refreshed access token.
   */
  public async getOrRefreshUserToken(userId: string): Promise<string> {
    const cred = await this.userRepo.getUserCredentials(userId);

    if (!cred || !cred.encryptedAccessToken) {
      throw new VkReauthenticationRequiredError('VK organizer credentials not found. Please log in with VK ID.');
    }

    const now = Date.now();
    const isExpiredOrExpiring = cred.expiresAt ? now >= cred.expiresAt.getTime() - 30 * 1000 : false;

    if (!isExpiredOrExpiring) {
      return await this.tokenVault.decrypt(cred.encryptedAccessToken);
    }

    // Token is expired. Check if refresh token is available.
    if (!cred.encryptedRefreshToken) {
      throw new VkReauthenticationRequiredError(
        'VK session expired and no refresh token is available. Please reconnect your VK account.'
      );
    }

    // Single-Flight Mutex: join in-flight refresh or start a new one
    let existingFlight = this.inFlightRefreshes.get(userId);
    if (!existingFlight) {
      existingFlight = this.executeRefresh(userId, cred.encryptedRefreshToken);
      this.inFlightRefreshes.set(userId, existingFlight);
    }

    try {
      return await existingFlight;
    } finally {
      this.inFlightRefreshes.delete(userId);
    }
  }

  private async executeRefresh(userId: string, encryptedRefreshToken: string): Promise<string> {
    try {
      const refreshToken = await this.tokenVault.decrypt(encryptedRefreshToken);
      const clientId = process.env.VK_APP_ID || (process.env.NODE_ENV === 'test' ? 'test_vk_app_id' : '');
      const clientSecret = process.env.VK_CLIENT_SECRET;

      const refreshResponse = await this.oauthClient.refreshToken({
        refreshToken,
        clientId,
        clientSecret,
      });

      if (!refreshResponse.access_token) {
        throw new VkReauthenticationRequiredError('VK token refresh response did not return a valid access token');
      }

      const encryptedAccessToken = await this.tokenVault.encrypt(refreshResponse.access_token);
      const newEncryptedRefreshToken = refreshResponse.refresh_token
        ? await this.tokenVault.encrypt(refreshResponse.refresh_token)
        : encryptedRefreshToken;

      const user = await this.userRepo.getUserById(userId);
      if (!user) {
        throw new VkReauthenticationRequiredError('User account not found during token refresh');
      }

      await this.userRepo.upsertUserWithTokens({
        vkUserId: user.vkUserId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        encryptedAccessToken,
        encryptedRefreshToken: newEncryptedRefreshToken,
        expiresIn: refreshResponse.expires_in,
        scope: refreshResponse.scope,
      });

      return refreshResponse.access_token;
    } catch (err: unknown) {
      if (err instanceof VkReauthenticationRequiredError) throw err;
      throw new VkReauthenticationRequiredError(
        `Failed to refresh VK session: ${err instanceof Error ? err.message : 'Unknown error'}. Please reconnect your VK account.`
      );
    }
  }
}

export const defaultTokenRefresher = new TokenRefresher();
