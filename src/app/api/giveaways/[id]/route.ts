import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';
import { resolveEffectiveCapabilities } from '@/providers/vk/vk-capabilities';
import { defaultTokenRefresher } from '@/lib/auth/token-refresher';

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
    const { giveaway, sessionUser } = await requireGiveawayOwner(req, id);

    // Resolve runtime effective capabilities truthfully based on stored organizer credential status
    let credentialStatus: 'AVAILABLE' | 'REFRESHABLE' | 'REAUTH_REQUIRED' | 'MISSING' = 'MISSING';
    if (sessionUser?.id) {
      credentialStatus = await defaultTokenRefresher.getCredentialStatus(sessionUser.id);
    }

    const isUserAuthUsable = credentialStatus === 'AVAILABLE' || credentialStatus === 'REFRESHABLE';
    const effectiveCapabilities = resolveEffectiveCapabilities({
      type: isUserAuthUsable ? 'USER' : 'SERVICE',
      credentialStatus,
    });

    return NextResponse.json({ 
      success: true, 
      giveaway,
      effectiveCapabilities,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
