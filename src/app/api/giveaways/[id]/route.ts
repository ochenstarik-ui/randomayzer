import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { handleApiError, NotFoundError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    generalApiRateLimiter.assertAllowed(`giveaway-get:${ip}`);

    const giveaway = await GiveawayStore.getById(id);

    if (!giveaway) {
      throw new NotFoundError(`Giveaway with id "${id}" not found`);
    }

    return NextResponse.json({ success: true, giveaway });
  } catch (error: any) {
    return handleApiError(error);
  }
}
