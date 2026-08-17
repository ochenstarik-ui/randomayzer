import { NextRequest, NextResponse } from 'next/server';
import { GiveawayStore } from '@/lib/giveaway-store';
import { handleApiError, NotFoundError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const clientIp = resolveClientIp(req);
    generalApiRateLimiter.assertAllowed(`giveaway-get:${clientIp}`);

    const giveaway = await GiveawayStore.getById(id);

    if (!giveaway) {
      throw new NotFoundError(`Giveaway with id "${id}" not found`);
    }

    return NextResponse.json({ success: true, giveaway });
  } catch (error: any) {
    return handleApiError(error);
  }
}
