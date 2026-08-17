import { NextRequest, NextResponse } from 'next/server';
import { defaultOAuthTransactionStore } from '@/lib/auth/oauth-state';
import { defaultVkOAuthClient, IVkOAuthClient } from '@/integrations/vk/vk-oauth-client';
import { MockVkOAuthClient } from '@/integrations/vk/mock-oauth-client';
import { handleApiError, ValidationError } from '@/core/errors/http-errors';
import { validateSafeRedirectTarget } from '@/lib/auth/safe-redirect';

export const dynamic = 'force-dynamic';

export function getOAuthClient(): IVkOAuthClient {
  if (process.env.USE_VK_MOCK === 'true' || (process.env.NODE_ENV === 'test' && !process.env.VK_APP_ID)) {
    return new MockVkOAuthClient();
  }
  return defaultVkOAuthClient;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawRedirectTarget = searchParams.get('redirectTarget');
    const redirectTarget = validateSafeRedirectTarget(rawRedirectTarget);

    const clientId = process.env.VK_APP_ID || (process.env.NODE_ENV === 'test' ? 'test_vk_app_id' : '');
    if (!clientId) {
      throw new ValidationError('VK_APP_ID is not configured in server environment');
    }

    // Determine absolute redirect URI
    const origin = req.nextUrl.origin || 'http://localhost:3000';
    const redirectUri = process.env.VK_REDIRECT_URI || `${origin}/api/auth/vk/callback`;

    // 1. Create secure OAuth transaction with PKCE and State
    const { state, codeChallenge } = await defaultOAuthTransactionStore.createTransaction({
      redirectTarget,
      ttlMs: 10 * 60 * 1000, // 10 min TTL
    });

    // 2. Build authorization URL
    const oauthClient = getOAuthClient();
    const authUrl = oauthClient.buildAuthorizationUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge,
      scope: 'wall,groups,offline',
    });

    // 3. Redirect user to VK ID
    return NextResponse.redirect(authUrl);
  } catch (error: any) {
    return handleApiError(error);
  }
}
