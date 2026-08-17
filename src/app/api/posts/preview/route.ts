import { NextRequest, NextResponse } from 'next/server';
import { ProviderFactory } from '@/providers/factory';
import { postPreviewSchema } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';

export async function POST(req: NextRequest) {
  try {
    const clientIp = resolveClientIp(req);
    generalApiRateLimiter.assertAllowed(`post-preview:${clientIp}`);

    const rawBody = await req.json();
    const validated = postPreviewSchema.parse(rawBody);

    const provider = ProviderFactory.getVkProvider();
    const post = await provider.fetchPost(validated.url);

    return NextResponse.json({
      success: true,
      post,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
