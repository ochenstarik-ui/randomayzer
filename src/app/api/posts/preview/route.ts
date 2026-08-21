import { NextRequest, NextResponse } from 'next/server';
import { ProviderFactory } from '@/providers/factory';
import { postPreviewSchema } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { requireAuthenticatedUser } from '@/lib/auth/auth-guard';
import { resolveEffectiveCapabilities } from '@/providers/vk/vk-capabilities';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Enforce authentication and CSRF protection (prevents anonymous VK proxy abuse and protects VK API quota)
    const sessionUser = await requireAuthenticatedUser(req);

    // 2. User-scoped rate limit (120 req / min)
    generalApiRateLimiter.assertAllowed(`post-preview:user:${sessionUser.id}`);

    const rawBody = await req.json();
    const validated = postPreviewSchema.parse(rawBody);
    const provider = ProviderFactory.getVkProvider();

    // 3. Fetch post with organizer session context for private/restricted access probe
    const post = await provider.fetchPost(validated.url, { organizerId: sessionUser.id });

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
