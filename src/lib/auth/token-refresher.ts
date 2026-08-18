import { IUserRepository, defaultUserRepository } from '@/lib/repository/user-repository';
import { ITokenVault, defaultTokenVault } from '@/lib/auth/token-vault';
import { IVkOAuthClient, defaultVkOAuthClient } from '@/integrations/vk/vk-oauth-client';
import { VkReauthenticationRequiredError, VkAuthError } from '@/integrations/vk/vk-errors';

/**
 * TokenRefresher: Single-flight concurrency mutex for VK token refresh.
 *
 * Concurrency strategy:
 * - A single Promise per userId is stored in inFlightRefreshes.
 * - New callers that find an existing flight JOIN it (no cleanup responsibility).
 * - Only the caller that CREATED the flight may delete it (reference-equality guard).
 * - This prevents two races:
 *   (a) Multiple waiters all deleting the entry in finally → next real refresh starts multiple HTTP calls.
 *   (b) Late caller after cleanup getting an orphaned stale entry.
 *
 * CAS / stale-write strategy:
 * - Before calling executeRefresh, we capture cred.updatedAt.
 * - After refresh completes, we use updateCredentialConditionally(userId, update, expectedUpdatedAt).
 * - If the credential was replaced (re-login or another refresh won) between our read and our write,
 *   the CAS returns false and we skip the write. The freshly-computed access token is still returned
 *   (it is valid for the remainder of its TTL) but the DB retains the newer credential.
 *
 * Null expiresAt policy:
 * - VK ID OAuth 2.1 always returns expires_in. A null expiresAt in the DB indicates a legacy
 *   credential stored without expiry metadata.
 * - Policy: if refresh token exists → treat as expired, force refresh.
 * - If no refresh token → ReauthenticationRequired (we cannot safely assume the token is valid).
 *
 * Identity binding:
 * - VK token refresh responses include user_id. We verify it matches the stored User.vkUserId.
 * - Mismatch → VkReauthenticationRequiredError. Tokens are NOT persisted.
 */
export type UserCredentialStatus = 'AVAILABLE' | 'REFRESHABLE' | 'REAUTH_REQUIRED' | 'MISSING';

export class TokenRefresher {
  private inFlightRefreshes = new Map<string, Promise<string>>();

  constructor(
    private userRepo?: IUserRepository,
    private tokenVault?: ITokenVault,
    private oauthClient?: IVkOAuthClient
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

  private getUserRepo(): IUserRepository {
    return this.userRepo || defaultUserRepository;
  }

  private getTokenVault(): ITokenVault {
    return this.tokenVault || defaultTokenVault;
  }

  private getOAuthClient(): IVkOAuthClient {
    return this.oauthClient || defaultVkOAuthClient;
  }

  /**
   * Fast, server-side status check of user credentials without performing network calls
   * or decrypting secrets.
   */
  public async getCredentialStatus(userId: string): Promise<UserCredentialStatus> {
    try {
      const cred = await this.getUserRepo().getUserCredentials(userId);
      if (!cred || !cred.encryptedAccessToken) {
        return 'MISSING';
      }

      const now = Date.now();
      const hasRefreshToken = Boolean(cred.encryptedRefreshToken);

      if (cred.expiresAt === null || cred.expiresAt === undefined) {
        return hasRefreshToken ? 'REFRESHABLE' : 'REAUTH_REQUIRED';
      }

      const isExpiredOrExpiring = now >= cred.expiresAt.getTime() - 30_000;
      if (!isExpiredOrExpiring) {
        return 'AVAILABLE';
      }

      return hasRefreshToken ? 'REFRESHABLE' : 'REAUTH_REQUIRED';
    } catch {
      return 'REAUTH_REQUIRED';
    }
  }

  /**
   * Returns a valid plaintext VK access token for the given userId.
   * Refreshes if expired or if expiry is unknown. Uses single-flight mutex.
   */
  public async getOrRefreshUserToken(userId: string): Promise<string> {
    const cred = await this.getUserRepo().getUserCredentials(userId);

    if (!cred || !cred.encryptedAccessToken) {
      throw new VkReauthenticationRequiredError(
        'VK organizer credentials not found. Please log in with VK ID.'
      );
    }

    const now = Date.now();

    // --- NULL expiresAt POLICY ---
    // A null/undefined expiresAt means expiry is unknown (legacy credential).
    // We do NOT assume the token is valid forever.
    let isExpiredOrExpiring: boolean;
    if (cred.expiresAt === null || cred.expiresAt === undefined) {
      if (cred.encryptedRefreshToken) {
        // Conservative: unknown expiry + refresh token available → force refresh
        isExpiredOrExpiring = true;
      } else {
        // No expiry info, no way to refresh → require re-login
        throw new VkReauthenticationRequiredError(
          'VK session has unknown expiry and no refresh token is available. Please reconnect your VK account.'
        );
      }
    } else {
      // Normal path: check if within 30-second pre-expiry window
      isExpiredOrExpiring = now >= cred.expiresAt.getTime() - 30_000;
    }

    if (!isExpiredOrExpiring) {
      return await this.getTokenVault().decrypt(cred.encryptedAccessToken);
    }

    // Token is expired or expiry is unknown. Check if refresh token is available.
    if (!cred.encryptedRefreshToken) {
      throw new VkReauthenticationRequiredError(
        'VK session expired and no refresh token is available. Please reconnect your VK account.'
      );
    }

    // --- SINGLE-FLIGHT MUTEX ---
    // If a refresh is already in flight for this userId, JOIN it.
    // Joiners do NOT have cleanup responsibility — only the owner does.
    const existingFlight = this.inFlightRefreshes.get(userId);
    if (existingFlight) {
      return await existingFlight;
    }

    // We are the owner: create and register the flight.
    const flight = this.executeRefresh(userId, cred.encryptedRefreshToken, cred.updatedAt);
    this.inFlightRefreshes.set(userId, flight);

    try {
      return await flight;
    } finally {
      // Reference-equality guard: only delete if THIS flight is still registered.
      // This prevents a late waiter (who joined after we completed) from deleting
      // a NEW flight that started for the same userId after ours resolved.
      if (this.inFlightRefreshes.get(userId) === flight) {
        this.inFlightRefreshes.delete(userId);
      }
    }
  }

  private async executeRefresh(
    userId: string,
    encryptedRefreshToken: string,
    credentialUpdatedAt: Date
  ): Promise<string> {
    try {
      const refreshToken = await this.getTokenVault().decrypt(encryptedRefreshToken);
      const clientId = process.env.VK_APP_ID || (process.env.NODE_ENV === 'test' ? 'test_vk_app_id' : '');
      const clientSecret = process.env.VK_CLIENT_SECRET;

      const refreshResponse = await this.getOAuthClient().refreshToken({
        refreshToken,
        clientId,
        clientSecret,
      });

      if (!refreshResponse.access_token) {
        throw new VkReauthenticationRequiredError(
          'VK token refresh response did not return a valid access token'
        );
      }

      // --- IDENTITY BINDING ---
      // Verify the refreshed token belongs to the same VK user.
      const user = await this.getUserRepo().getUserById(userId);
      if (!user) {
        throw new VkReauthenticationRequiredError(
          'User account not found during token refresh'
        );
      }

      if (refreshResponse.user_id && String(refreshResponse.user_id) !== String(user.vkUserId)) {
        // SECURITY: The token response is for a different VK account.
        // Do NOT persist these tokens. Require re-authentication.
        throw new VkReauthenticationRequiredError(
          'SECURITY: VK token refresh user_id mismatch — tokens not persisted. Please reconnect your account.'
        );
      }

      // --- REFRESH TOKEN ROTATION ---
      // VK ID may issue a new refresh_token. If it does, rotate it.
      // If the response omits refresh_token, retain the previous encrypted token.
      // IMPORTANT: only store defined non-null values.
      const encryptedAccessToken = await this.getTokenVault().encrypt(refreshResponse.access_token);
      let newEncryptedRefreshToken: string;
      if (refreshResponse.refresh_token) {
        // New (or same) refresh token returned — encrypt and store
        newEncryptedRefreshToken = await this.getTokenVault().encrypt(refreshResponse.refresh_token);
      } else {
        // No refresh token in response — retain the previous encrypted token
        newEncryptedRefreshToken = encryptedRefreshToken;
      }

      const newExpiresAt = refreshResponse.expires_in
        ? new Date(Date.now() + refreshResponse.expires_in * 1_000)
        : null;

      // --- CAS STALE WRITE PROTECTION ---
      // Only write the refreshed credential if the DB record has not been updated
      // since we read it (i.e., no re-login or concurrent refresh has won the race).
      // On CAS miss, we still return the freshly-computed access token — it's valid —
      // but we do NOT overwrite the newer credential in the DB.
      const written = await this.getUserRepo().updateCredentialConditionally(
        userId,
        {
          encryptedAccessToken,
          encryptedRefreshToken: newEncryptedRefreshToken,
          expiresAt: newExpiresAt,
          scope: refreshResponse.scope,
        },
        credentialUpdatedAt
      );

      if (!written) {
        // CAS miss: a newer credential exists (re-login or parallel refresh won).
        // Return the freshly-computed token without corrupting the DB.
        return refreshResponse.access_token;
      }

      return refreshResponse.access_token;
    } catch (err: unknown) {
      if (err instanceof VkReauthenticationRequiredError) throw err;

      // --- REFRESH FAILURE CLASSIFICATION ---
      // Auth failures (invalid_grant, revoked token, bad credentials):
      //   → VkReauthenticationRequiredError (user must log in again)
      //   → Credentials in DB are NOT modified (no partial write)
      if (err instanceof VkAuthError) {
        throw new VkReauthenticationRequiredError(
          `VK session is no longer valid: ${
            err instanceof Error ? err.message : 'Auth error'
          }. Please reconnect your VK account.`
        );
      }

      // Network / rate-limit / temporary VK failures:
      //   → Propagate the original error as-is (caller can decide to retry)
      //   → Credentials in DB are NOT modified
      throw err;
    }
  }
}

export let defaultTokenRefresher: TokenRefresher = new TokenRefresher();

export function setTokenRefresher(refresher: TokenRefresher): void {
  defaultTokenRefresher = refresher;
}
