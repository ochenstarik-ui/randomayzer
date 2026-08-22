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
  const preAuthKey = `pre-auth:${clientIp}`;

  // 2. Pre-auth rate limit read-only check:
  // Asserts quota BEFORE any lookup into the session store or database.
  // If this client IP has already exhausted its pre-auth quota, reject immediately with 429.
  preAuthRateLimiter.assertCanAttempt(preAuthKey);

  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  // 3. Pre-auth rate limit for anonymous requests (no cookie):
  // Consumes a pre-auth attempt and throws 401 Unauthorized without touching the session store.
  if (!sessionId) {
    preAuthRateLimiter.consume(preAuthKey);
    throw new UnauthorizedError('Authentication required: please log in via VK ID');
  }

  // 4. Resolve active session user from session store / DB
  const sessionUser = await getSessionFromRequest(req);

  // 5. Pre-auth rate limit for invalid/expired/fake session cookies:
  // Consumes a pre-auth attempt when authentication fails, preventing brute-force / fake cookie flood.
  if (!sessionUser) {
    preAuthRateLimiter.consume(preAuthKey);
    throw new UnauthorizedError('Authentication required: please log in via VK ID');
  }

  // 6. Valid authenticated session: do NOT consume pre-auth quota
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
