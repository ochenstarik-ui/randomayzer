import { NextRequest, NextResponse } from 'next/server';
import { defaultOAuthTransactionStore } from '@/lib/auth/oauth-state';
import { getOAuthClient } from '@/integrations/vk/vk-oauth-client';
import { handleApiError, ValidationError } from '@/core/errors/http-errors';
import { validateSafeRedirectTarget } from '@/lib/auth/safe-redirect';
import { getVkRedirectUri } from '@/lib/auth/app-config';
import { oauthStartRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const clientIp = resolveClientIp(req);
    oauthStartRateLimiter.assertAllowed(`oauth-start:${clientIp}`);

    const { searchParams } = new URL(req.url);
    const rawRedirectTarget = searchParams.get('redirectTarget');
    const redirectTarget = validateSafeRedirectTarget(rawRedirectTarget);

    const clientId = process.env.VK_APP_ID || (process.env.NODE_ENV === 'test' ? 'test_vk_app_id' : '');
    if (!clientId) {
      throw new ValidationError('VK_APP_ID is not configured in server environment');
    }

    // Resolve canonical redirect URI from configuration (fail-fast in production if missing/non-HTTPS)
    const redirectUri = getVkRedirectUri();

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
