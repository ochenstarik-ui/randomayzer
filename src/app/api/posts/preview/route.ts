import { NextRequest, NextResponse } from 'next/server';
import { ProviderFactory } from '@/providers/factory';
import { postPreviewSchema } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { getSessionFromRequest } from '@/lib/auth/session';
import { resolveEffectiveCapabilities } from '@/providers/vk/vk-capabilities';

export async function POST(req: NextRequest) {
  try {
    const clientIp = resolveClientIp(req);
    generalApiRateLimiter.assertAllowed(`post-preview:${clientIp}`);

    const rawBody = await req.json();
    const validated = postPreviewSchema.parse(rawBody);

    const sessionUser = await getSessionFromRequest(req);
    const provider = ProviderFactory.getVkProvider();

    // Fetch post with optional organizer session context for private/restricted access probe
    const post = await provider.fetchPost(validated.url, { organizerId: sessionUser?.id });

    // Derive effective capabilities based on authentication context
    const effectiveCapabilities = resolveEffectiveCapabilities(
      sessionUser ? { type: 'USER', token: 'active' } : { type: 'SERVICE', token: 'active' }
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
