import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const clientIp = resolveClientIp(req);
    generalApiRateLimiter.assertAllowed(`giveaway-get:${clientIp}`);

    // Enforce giveaway ownership authorization
    const { giveaway } = await requireGiveawayOwner(req, id);

    return NextResponse.json({ success: true, giveaway });
  } catch (error: any) {
    return handleApiError(error);
  }
}
