import { NextRequest, NextResponse } from 'next/server';
import { defaultOAuthTransactionStore } from '@/lib/auth/oauth-state';
import { getOAuthClient } from '../start/route';
import { defaultTokenVault } from '@/lib/auth/token-vault';
import { defaultUserRepository } from '@/lib/repository/user-repository';
import { defaultSessionStore, setSessionCookie } from '@/lib/auth/session';
import { handleApiError, ValidationError } from '@/core/errors/http-errors';
import { validateSafeRedirectTarget } from '@/lib/auth/safe-redirect';
import { getAppBaseUrl, getVkRedirectUri } from '@/lib/auth/app-config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    const appBaseUrl = getAppBaseUrl();

    // 1. Handle user cancellation or VK authorization rejection
    if (errorParam) {
      // Invalidate state transaction if present so it cannot be reused
      if (state) {
        await defaultOAuthTransactionStore.invalidateTransaction(state);
      }

      const safeErrorMsg = encodeURIComponent(
        (errorDescription || errorParam).replace(/[^\w\sа-яА-ЯёЁ.,-]/gi, '').slice(0, 100)
      );
      return NextResponse.redirect(`${appBaseUrl}/?auth_error=${safeErrorMsg}`);
    }

    if (!code) {
      throw new ValidationError('Authorization code is missing from callback query');
    }

    if (!state) {
      throw new ValidationError('OAuth state parameter is missing from callback query');
    }

    // 2. Validate and consume single-use state transaction (recovers codeVerifier and redirectTarget)
    const { codeVerifier, redirectTarget } = await defaultOAuthTransactionStore.consumeTransaction(state);
    const safeRedirect = validateSafeRedirectTarget(redirectTarget);

    const clientId = process.env.VK_APP_ID || (process.env.NODE_ENV === 'test' ? 'test_vk_app_id' : '');
    if (!clientId) {
      throw new ValidationError('VK_APP_ID is not configured in server environment');
    }

    const clientSecret = process.env.VK_CLIENT_SECRET;
    const redirectUri = getVkRedirectUri();

    // 3. Exchange code for access token via dedicated VkOAuthClient
    const oauthClient = getOAuthClient();
    const tokenResponse = await oauthClient.exchangeCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
      state,
    });

    // 4. Encrypt sensitive tokens at rest before storing
    const encryptedAccessToken = await defaultTokenVault.encrypt(tokenResponse.access_token);
    const encryptedRefreshToken = tokenResponse.refresh_token
      ? await defaultTokenVault.encrypt(tokenResponse.refresh_token)
      : undefined;

    // 5. Retrieve organizer profile from VK API
    const userProfile = await oauthClient.getUserProfile(
      tokenResponse.access_token,
      tokenResponse.user_id
    );

    // 6. Upsert user in repository
    const sessionUser = await defaultUserRepository.upsertUserWithTokens({
      vkUserId: String(tokenResponse.user_id),
      firstName: userProfile.firstName,
      lastName: userProfile.lastName,
      username: userProfile.username,
      avatarUrl: userProfile.avatarUrl,
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresIn: tokenResponse.expires_in,
      scope: tokenResponse.scope,
    });

    // 7. Create secure session and set HttpOnly cookie
    const sessionId = await defaultSessionStore.createSession(sessionUser);

    const response = NextResponse.redirect(`${appBaseUrl}${safeRedirect}`);
    setSessionCookie(response, sessionId);

    return response;
  } catch (error: any) {
    return handleApiError(error);
  }
}
