import { NextRequest, NextResponse } from 'next/server';
import { ProviderFactory } from '@/providers/factory';
import { postPreviewSchema } from '@/core/validation/giveaway-schemas';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    generalApiRateLimiter.assertAllowed(`post-preview:${ip}`);

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
