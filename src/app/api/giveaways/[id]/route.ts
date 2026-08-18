import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';
import { resolveEffectiveCapabilities } from '@/providers/vk/vk-capabilities';
import { defaultUserRepository } from '@/lib/repository/user-repository';

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

    // Resolve runtime effective capabilities truthfully based on stored organizer credentials
    let authType: 'SERVICE' | 'USER' = 'SERVICE';
    if (sessionUser?.id) {
      const cred = await defaultUserRepository.getUserCredentials(sessionUser.id);
      if (cred?.encryptedAccessToken) {
        authType = 'USER';
      }
    }

    const effectiveCapabilities = resolveEffectiveCapabilities({ type: authType });

    return NextResponse.json({ 
      success: true, 
      giveaway,
      effectiveCapabilities,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
