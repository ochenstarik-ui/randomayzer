import { NextRequest, NextResponse } from 'next/server';
import { ProviderFactory } from '@/providers/factory';
import { postPreviewSchema } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { expensiveApiRateLimiter, generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { getSessionFromRequest, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { validateCsrfOrigin } from '@/lib/auth/csrf-guard';
import { resolveEffectiveCapabilities } from '@/providers/vk/vk-capabilities';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Enforce CSRF Origin validation for mutating request (protects against cross-site exploitation)
    validateCsrfOrigin(req);

    const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const sessionUser = sessionId ? await getSessionFromRequest(req) : null;
    const clientIp = resolveClientIp(req);

    // 2. Strict Rate Limiting:
    // - Authenticated organizers get isolated user-scoped general bucket
    // - Anonymous clients get strict expensive rate limiter (15 req / 10s) to prevent VK proxy abuse
    if (sessionUser) {
      generalApiRateLimiter.assertAllowed(`post-preview:user:${sessionUser.id}`);
    } else {
      expensiveApiRateLimiter.assertAllowed(`post-preview:anon:${clientIp}`);
    }

    const rawBody = await req.json();
    const validated = postPreviewSchema.parse(rawBody);
    const provider = ProviderFactory.getVkProvider();

    // 3. Fetch post with optional organizer session context for private/restricted access probe
    const post = await provider.fetchPost(validated.url, { organizerId: sessionUser?.id });

    // 4. Derive effective capabilities based on the actual auth mode used to access the post
    const effectiveCapabilities = resolveEffectiveCapabilities(
      post.resolvedAuthType ? { type: post.resolvedAuthType } : undefined
    );

    return NextResponse.json({
      success: true,
      post,
      effectiveCapabilities,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
