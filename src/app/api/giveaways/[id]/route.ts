import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/http-errors';
import { generalApiRateLimiter } from '@/lib/rate-limiter';
import { resolveClientIp } from '@/lib/client-ip';
import { requireGiveawayOwner } from '@/lib/auth/auth-guard';
import { resolveEffectiveCapabilities } from '@/providers/vk/vk-capabilities';
import { defaultTokenRefresher } from '@/lib/auth/token-refresher';
import { computeSeedCommitment } from '@/core/randomizer/hasher';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 1. Enforce giveaway ownership authorization
    const { giveaway, sessionUser } = await requireGiveawayOwner(req, id);

    // 2. User-scoped rate limiter
    generalApiRateLimiter.assertAllowed(`giveaway-get:${sessionUser.id}`);

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

    // Seed pre-commitment masking: do not expose plaintext seed before DRAWN
    const isDrawn = giveaway.status === 'DRAWN' || giveaway.status === 'PUBLISHED';
    const seedCommitment = giveaway.seed ? computeSeedCommitment(giveaway.seed) : (giveaway.seedCommitment || null);

    const sanitizedGiveaway = {
      ...giveaway,
      seed: isDrawn ? giveaway.seed : null,
      seedCommitment,
    };

    return NextResponse.json({ 
      success: true, 
      giveaway: sanitizedGiveaway,
      effectiveCapabilities,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
