import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resolveClientIp, normalizeIp } from '../src/lib/client-ip';
import { SlidingWindowRateLimiter } from '../src/lib/rate-limiter';

describe('Client IP Resolution & Rate Limiter Identity', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('strictly ignores forged X-Forwarded-For when TRUST_PROXY is not enabled', () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '198.51.100.25',
        'x-real-ip': '203.0.113.195',
      },
    });

    const ip = resolveClientIp(req);
    expect(ip).not.toBe('198.51.100.25');
    expect(ip).not.toBe('203.0.113.195');
    expect(ip).toBe('direct-client');
  });

  it('extracts and normalizes client IP when TRUST_PROXY=true is set', () => {
    process.env.TRUST_PROXY = 'true';

    const req = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.50, 198.51.100.1, 192.0.2.1',
      },
    });

    const ip = resolveClientIp(req);
    expect(ip).toBe('203.0.113.50');
  });

  it('normalizes IPv6 and IPv4-mapped IPv6 correctly', () => {
    expect(normalizeIp('::1')).toBe('127.0.0.1');
    expect(normalizeIp('[::1]:8080')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:192.168.1.10')).toBe('192.168.1.10');
    expect(normalizeIp('192.168.1.1:3000')).toBe('192.168.1.1');
  });

  it('rejects oversized headers when TRUST_PROXY=true', () => {
    process.env.TRUST_PROXY = 'true';

    const oversizedHeader = '1.1.1.1, ' + 'a'.repeat(1100);
    const req = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': oversizedHeader,
      },
    });

    const ip = resolveClientIp(req);
    expect(ip).toBe('malformed-oversized-ip');
  });

  it('rate limiter proactively cleans up expired buckets without unbounded growth', async () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 30,
      maxRequests: 5,
      maxBuckets: 50,
    });

    for (let i = 0; i < 40; i++) {
      limiter.check(`ip-${i}`);
    }

    expect(limiter.size()).toBe(40);

    // Wait for window to expire
    await new Promise(r => setTimeout(r, 45));

    const cleaned = limiter.cleanupExpired();
    expect(cleaned).toBeGreaterThanOrEqual(40);
    expect(limiter.size()).toBe(0);
  });
});
