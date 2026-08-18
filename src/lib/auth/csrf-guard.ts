import { NextRequest } from 'next/server';
import { ForbiddenError } from '@/core/errors/http-errors';
import { getTrustedHost } from './app-config';

/**
 * Validates Origin and Referer headers for cookie-authenticated mutating requests (POST/PUT/DELETE/PATCH)
 * to protect against Cross-Site Request Forgery (CSRF).
 * In production, compares strictly against configured APP_BASE_URL host to prevent X-Forwarded-Host spoofing.
 */
export function validateCsrfOrigin(req: NextRequest): void {
  // Safe idempotent methods do not modify server state
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return;
  }

  // If Sec-Fetch-Site is present, strictly forbid cross-site
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite === 'cross-site') {
    throw new ForbiddenError('Cross-Site Request Forgery (CSRF) detected: cross-site origin rejected');
  }

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  
  // Resolve trusted host: strictly from configured APP_BASE_URL in production
  const trustedHost = process.env.NODE_ENV === 'production'
    ? getTrustedHost()
    : (req.headers.get('host') || getTrustedHost());

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host.toLowerCase() !== trustedHost.toLowerCase()) {
        throw new ForbiddenError(`CSRF origin mismatch: origin "${originUrl.host}" does not match trusted host "${trustedHost}"`);
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
      if (refererUrl.host.toLowerCase() !== trustedHost.toLowerCase()) {
        throw new ForbiddenError(`CSRF referer mismatch: referer "${refererUrl.host}" does not match trusted host "${trustedHost}"`);
      }
    } catch (e: any) {
      if (e instanceof ForbiddenError) throw e;
      throw new ForbiddenError('Malformed Referer header rejected');
    }
    return;
  }

  // In test environment, if neither origin nor referer is supplied by test runner, allow if test environment
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  // In production, require either Origin or Referer for mutating requests
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenError('Missing Origin/Referer header on authenticated mutation');
  }
}
