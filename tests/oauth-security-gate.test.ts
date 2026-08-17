import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { defaultOAuthTransactionStore } from '../src/lib/auth/oauth-state';
import { validateSafeRedirectTarget } from '../src/lib/auth/safe-redirect';
import { GET as startGet } from '../src/app/api/auth/vk/start/route';
import { GET as callbackGet } from '../src/app/api/auth/vk/callback/route';
import { POST as logoutPost } from '../src/app/api/auth/logout/route';

describe('Phase 2.2.1 OAuth Security Gate, Redirects & CSRF Protection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    defaultOAuthTransactionStore.clear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('validates and neutralizes dangerous redirect targets (open redirect prevention)', () => {
    // Dangerous attacks
    expect(validateSafeRedirectTarget('//evil.com/phishing')).toBe('/');
    expect(validateSafeRedirectTarget('/\\evil.com')).toBe('/');
    expect(validateSafeRedirectTarget('https://attacker.com')).toBe('/');
    expect(validateSafeRedirectTarget('http://attacker.com')).toBe('/');
    expect(validateSafeRedirectTarget('javascript:alert(1)')).toBe('/');
    expect(validateSafeRedirectTarget('data:text/html,<script>evil()</script>')).toBe('/');
    expect(validateSafeRedirectTarget('   ')).toBe('/');
    expect(validateSafeRedirectTarget(null)).toBe('/');

    // Legitimate local paths
    expect(validateSafeRedirectTarget('/giveaways/new')).toBe('/giveaways/new');
    expect(validateSafeRedirectTarget('/giveaways/123')).toBe('/giveaways/123');
    expect(validateSafeRedirectTarget('/')).toBe('/');
  });

  it('invalidates state transaction when OAuth is cancelled (error=access_denied)', async () => {
    const { state } = await defaultOAuthTransactionStore.createTransaction();

    const req = new NextRequest(
      `http://localhost:3000/api/auth/vk/callback?error=access_denied&error_description=User%20denied&state=${state}`
    );
    const res = await callbackGet(req);

    expect(res.status).toBe(307);

    // Attempting to reuse the state MUST fail
    await expect(defaultOAuthTransactionStore.consumeTransaction(state)).rejects.toThrow();
  });

  it('sanitizes external redirectTarget on OAuth start', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/vk/start?redirectTarget=//evil.com/attack');
    const res = await startGet(req);

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('https://id.vk.com/auth');
    // Location URL must not contain evil.com redirect
    expect(location).not.toContain('evil.com');
  });

  it('rejects POST /api/auth/logout with cross-site Origin / CSRF mismatch', async () => {
    // 1. Cross-site Sec-Fetch-Site
    const crossSiteReq = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'cross-site',
      },
    });
    const crossSiteRes = await logoutPost(crossSiteReq);
    expect(crossSiteRes.status).toBe(403);
    const body1 = await crossSiteRes.json();
    expect(body1.error?.message).toMatch(/CSRF/i);

    // 2. Mismatched Origin
    const mismatchReq = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'https://evil-hacker.com',
        host: 'localhost:3000',
      },
    });
    const mismatchRes = await logoutPost(mismatchReq);
    expect(mismatchRes.status).toBe(403);
    const body2 = await mismatchRes.json();
    expect(body2.error?.message).toMatch(/CSRF/i);
  });
});
