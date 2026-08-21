import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as previewPost } from '../src/app/api/posts/preview/route';
import { ProviderFactory } from '../src/providers/factory';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { generalApiRateLimiter } from '../src/lib/rate-limiter';

describe('Task 13: Preview Quota Policy & Mandatory Authentication', () => {
  const secretServiceToken = 'vk_service_token_super_secret_xyz123!';
  const organizerUser = { id: 'usr_preview_policy_org', vkUserId: '999888' };
  let sessionCookie: string;
  let fetchPostSpy: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.VK_SERVICE_TOKEN = secretServiceToken;
    process.env.APP_BASE_URL = 'https://randomayzer.test';
    generalApiRateLimiter.reset();

    defaultSessionStore.clear();
    const sessionId = await defaultSessionStore.createSession(organizerUser);
    sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

    fetchPostSpy = vi.fn().mockResolvedValue({
      platform: 'VK',
      ownerId: '-12345',
      postId: '67890',
      sourceUrl: 'https://vk.com/wall-12345_67890',
      title: 'Preview Policy Test Post',
      text: 'Post content for preview security test',
      imageUrl: 'https://example.com/cover.jpg',
      likesCount: 15,
      commentsCount: 3,
      repostsCount: 0,
      resolvedAuthType: 'SERVICE',
    });

    const mockProvider = {
      capabilities: {
        maxParticipants: 10000,
        supportsLikes: true,
        supportsComments: true,
        supportsReposts: false,
        supportsAdminExclusion: false,
      },
      fetchPost: fetchPostSpy,
    };
    vi.spyOn(ProviderFactory, 'getVkProvider').mockReturnValue(mockProvider as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ─── 1. Option A: Anonymous Request Rejected with 401 & 0 VK Provider Calls ──
  it('anonymous request without session cookie is rejected with 401 and NEVER calls VK provider', async () => {
    const unauthReq = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    const res = await previewPost(unauthReq);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('VK ID');

    // Quota Protection Proof: 0 calls to VK provider
    expect(fetchPostSpy).toHaveBeenCalledTimes(0);
  });

  // ─── 2. Authenticated Request Succeeds & Carries Organizer ID ────────────────
  it('authenticated request with valid session cookie succeeds (200) and calls provider with organizerId', async () => {
    const authReq = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    const res = await previewPost(authReq);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.post.title).toBe('Preview Policy Test Post');
    expect(data.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');

    // Verify provider received trusted organizerId
    expect(fetchPostSpy).toHaveBeenCalledTimes(1);
    expect(fetchPostSpy).toHaveBeenCalledWith(
      'https://vk.com/wall-12345_67890',
      { organizerId: organizerUser.id }
    );
  });

  // ─── 3. User-Scoped Rate Limiting Applies to Authenticated Preview ───────────
  it('user-scoped rate limiting applies to preview requests (120 req / min)', async () => {
    // Exhaust rate limit for organizerUser (120 requests)
    for (let i = 0; i < 120; i++) {
      generalApiRateLimiter.check(`post-preview:user:${organizerUser.id}`);
    }

    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    const res = await previewPost(req);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error.code).toBe('RATE_LIMIT_EXCEEDED');

    // Rate-limited request does not invoke provider
    expect(fetchPostSpy).toHaveBeenCalledTimes(0);
  });

  // ─── 4. CSRF Origin Protection Remains Active on Protected Preview ──────────
  it('cross-origin request with untrusted Origin header is rejected with 403 Forbidden', async () => {
    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        Origin: 'https://evil-attacker-site.com',
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    const res = await previewPost(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(fetchPostSpy).toHaveBeenCalledTimes(0);
  });
});
