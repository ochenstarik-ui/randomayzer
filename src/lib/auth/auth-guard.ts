import { NextRequest } from 'next/server';
import { getSessionFromRequest, SessionUser, SESSION_COOKIE_NAME } from './session';
import { GiveawayStore, StoredGiveaway } from '@/lib/giveaway-store';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@/core/errors/http-errors';
import { validateCsrfOrigin } from './csrf-guard';
import { resolveClientIp } from '@/lib/client-ip';
import { preAuthRateLimiter } from '@/lib/rate-limiter';

/**
 * Enforces that a request is authenticated with a valid active session.
 * Also enforces CSRF origin checks for state-mutating HTTP methods
 * and pre-auth rate limiting to protect the database/session store from unauthenticated flood.
 */
export async function requireAuthenticatedUser(req: NextRequest): Promise<SessionUser> {
  // 1. Enforce CSRF guard on state-mutating requests
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    validateCsrfOrigin(req);
  }

  const clientIp = resolveClientIp(req);
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  // 2. Pre-auth rate limit for anonymous requests (no cookie):
  // Asserts rate limit BEFORE throwing 401, preventing unauthenticated flood from consuming resources.
  if (!sessionId) {
    preAuthRateLimiter.assertAllowed(`pre-auth:${clientIp}`);
    throw new UnauthorizedError('Authentication required: please log in via VK ID');
  }

  // 3. Resolve active session user
  const sessionUser = await getSessionFromRequest(req);

  // 4. Pre-auth rate limit for invalid/fake session cookies:
  // Charges the pre-auth limiter for the client IP to prevent brute-force / fake cookie flood against the DB.
  if (!sessionUser) {
    preAuthRateLimiter.assertAllowed(`pre-auth:${clientIp}`);
    throw new UnauthorizedError('Authentication required: please log in via VK ID');
  }

  return sessionUser;
}

/**
 * Enforces that a request is authenticated AND that the current user is the verified organizer (owner) of the giveaway.
 * Invariant: A giveaway without an owner (organizerId is null/empty) must NEVER authorize any user.
 */
export async function requireGiveawayOwner(
  req: NextRequest,
  giveawayId: string
): Promise<{ sessionUser: SessionUser; giveaway: StoredGiveaway }> {
  const sessionUser = await requireAuthenticatedUser(req);

  if (!giveawayId) {
    throw new NotFoundError('Giveaway ID parameter is missing');
  }

  const giveaway = await GiveawayStore.getById(giveawayId);
  if (!giveaway) {
    throw new NotFoundError(`Giveaway with id "${giveawayId}" not found`);
  }

  // Mandatory Ownership Invariant: Null organizer must NEVER authorize
  if (!giveaway.organizerId) {
    throw new ForbiddenError('Access denied: giveaway has no valid organizer assigned (ownership integrity error)');
  }

  if (giveaway.organizerId !== sessionUser.id) {
    throw new ForbiddenError('Access denied: you are not the organizer of this giveaway');
  }

  return { sessionUser, giveaway };
}
