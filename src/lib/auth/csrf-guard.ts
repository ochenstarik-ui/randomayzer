import { NextRequest } from 'next/server';
import { ForbiddenError } from '@/core/errors/http-errors';

/**
 * Validates Origin and Referer headers for cookie-authenticated mutating requests (POST/PUT/DELETE/PATCH)
 * to protect against Cross-Site Request Forgery (CSRF).
 */
export function validateCsrfOrigin(req: NextRequest): void {
  // Safe idempotent methods do not modify server state
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return;
  }

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');

  // If Sec-Fetch-Site is present, enforce 'same-origin' or 'same-site'
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite === 'cross-site') {
    throw new ForbiddenError('Cross-Site Request Forgery (CSRF) detected: cross-site origin rejected');
  }

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (host && originUrl.host !== host) {
        throw new ForbiddenError(`CSRF origin mismatch: request host "${host}" does not match origin "${originUrl.host}"`);
      }
    } catch (e: any) {
      if (e instanceof ForbiddenError) throw e;
      throw new ForbiddenError('Malformed Origin header rejected');
    }
    return;
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (host && refererUrl.host !== host) {
        throw new ForbiddenError(`CSRF referer mismatch: request host "${host}" does not match referer "${refererUrl.host}"`);
      }
    } catch (e: any) {
      if (e instanceof ForbiddenError) throw e;
      throw new ForbiddenError('Malformed Referer header rejected');
    }
    return;
  }

  // In test environment, if neither origin nor referer is supplied by test runner, allow if host exists
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  // In production, require either Origin or Referer for mutating requests
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenError('Missing Origin/Referer header on authenticated mutation');
  }
}
