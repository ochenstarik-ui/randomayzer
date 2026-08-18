import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { validateCsrfOrigin } from '../src/lib/auth/csrf-guard';
import { getAppBaseUrl, getVkRedirectUri } from '../src/lib/auth/app-config';
import { GET as vkStartGet, oauthStartRateLimiter } from '../src/app/api/auth/vk/start/route';

describe('Phase 2.2.3 Origin, CSRF Trusted Host & Rate Limiting Gate', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Production Base URL & VK_REDIRECT_URI Fail-Fast Policy', () => {
    it('fails fast in production when APP_BASE_URL is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_BASE_URL;

      expect(() => getAppBaseUrl()).toThrow(/APP_BASE_URL environment variable is strictly required in production/i);
    });

    it('fails fast in production when APP_BASE_URL is not HTTPS', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'http://insecure-http-url.com';

      expect(() => getAppBaseUrl()).toThrow(/must be a valid HTTPS URL in production/i);
    });

    it('fails fast in production when VK_REDIRECT_URI is missing', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://randomayzer.org';
      delete process.env.VK_REDIRECT_URI;

      expect(() => getVkRedirectUri()).toThrow(/VK_REDIRECT_URI environment variable is strictly required in production/i);
    });

    it('accepts valid HTTPS configuration in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://randomayzer.org';
      process.env.VK_REDIRECT_URI = 'https://randomayzer.org/api/auth/vk/callback';

      expect(getAppBaseUrl()).toBe('https://randomayzer.org');
      expect(getVkRedirectUri()).toBe('https://randomayzer.org/api/auth/vk/callback');
    });
  });

  describe('CSRF Trusted Host & Host-Spoofing Immunity', () => {
    it('rejects attacker sending evil Origin even if attacker injects spoofed X-Forwarded-Host', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://trusted-randomayzer.org';

      const req = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://evil.com',
          'x-forwarded-host': 'evil.com', // Spoofed header
        },
      });

      expect(() => validateCsrfOrigin(req)).toThrow(/CSRF origin mismatch/i);
    });

    it('rejects cross-site Sec-Fetch-Site requests', () => {
      const req = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://trusted-randomayzer.org',
          'sec-fetch-site': 'cross-site',
        },
      });

      expect(() => validateCsrfOrigin(req)).toThrow(/cross-site origin rejected/i);
    });

    it('accepts valid origin matching configured trusted host', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://trusted-randomayzer.org';

      const req = new NextRequest('https://trusted-randomayzer.org/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://trusted-randomayzer.org',
          'sec-fetch-site': 'same-origin',
        },
      });

      expect(() => validateCsrfOrigin(req)).not.toThrow();
    });
  });

  describe('OAuth Start Rate Limiter', () => {
    it('rate limits burst requests to GET /api/auth/vk/start', async () => {
      oauthStartRateLimiter.clear();

      const ip = '198.51.100.42';

      // 10 allowed requests
      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost:3000/api/auth/vk/start', {
          headers: { 'x-forwarded-for': ip },
        });
        const res = await vkStartGet(req);
        expect(res.status).toBe(307); // Temporary redirect to VK
      }

      // 11th request in the same window -> 429 Too Many Requests
      const blockedReq = new NextRequest('http://localhost:3000/api/auth/vk/start', {
        headers: { 'x-forwarded-for': ip },
      });
      const blockedRes = await vkStartGet(blockedReq);
      expect(blockedRes.status).toBe(429);
      const body = await blockedRes.json();
      expect(body.error?.message).toMatch(/rate limit exceeded/i);
    });
  });
});
