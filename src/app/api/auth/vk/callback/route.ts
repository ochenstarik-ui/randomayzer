import { NextRequest, NextResponse } from 'next/server';
import { defaultOAuthTransactionStore } from '@/lib/auth/oauth-state';
import { getOAuthClient } from '../start/route';
import { defaultTokenVault } from '@/lib/auth/token-vault';
import { defaultUserRepository } from '@/lib/repository/user-repository';
import { defaultSessionStore, setSessionCookie } from '@/lib/auth/session';
import { handleApiError, ValidationError, UnauthorizedError } from '@/core/errors/http-errors';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    const origin = req.nextUrl.origin || 'http://localhost:3000';

    // 1. Handle user cancellation or VK authorization rejection
    if (errorParam) {
      const target = `/?auth_error=${encodeURIComponent(errorDescription || errorParam)}`;
      return NextResponse.redirect(`${origin}${target}`);
    }

    if (!code) {
      throw new ValidationError('Authorization code is missing from callback query');
    }

    if (!state) {
      throw new ValidationError('OAuth state parameter is missing from callback query');
    }

    // 2. Validate and consume single-use state transaction (recovers codeVerifier and redirectTarget)
    const { codeVerifier, redirectTarget } = await defaultOAuthTransactionStore.consumeTransaction(state);

    const clientId = process.env.VK_APP_ID || process.env.NEXT_PUBLIC_VK_APP_ID || '51990000';
    const clientSecret = process.env.VK_CLIENT_SECRET;
    const redirectUri = process.env.VK_REDIRECT_URI || `${origin}/api/auth/vk/callback`;

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

    const destination = redirectTarget.startsWith('/') ? redirectTarget : '/';
    const response = NextResponse.redirect(`${origin}${destination}`);
    setSessionCookie(response, sessionId);

    return response;
  } catch (error: any) {
    return handleApiError(error);
  }
}
