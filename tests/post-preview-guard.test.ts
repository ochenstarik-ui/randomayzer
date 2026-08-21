import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as previewPost } from '../src/app/api/posts/preview/route';
import { ProviderFactory } from '../src/providers/factory';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { expensiveApiRateLimiter, generalApiRateLimiter } from '../src/lib/rate-limiter';

describe('Task 05: Auth & CSRF Guard on POST /api/posts/preview', () => {
  const secretServiceToken = 'vk_service_token_super_secret_xyz123!';
  const organizerUser = { id: 'usr_preview_guard_org', vkUserId: '999888' };
  let sessionCookie: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.VK_SERVICE_TOKEN = secretServiceToken;
    process.env.APP_BASE_URL = 'https://randomayzer.test';
    generalApiRateLimiter.reset();

    defaultSessionStore.clear();
    const sessionId = await defaultSessionStore.createSession(organizerUser);
    sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const mockProvider = {
      capabilities: {
        maxParticipants: 10000,
        supportsLikes: true,
        supportsComments: true,
        supportsReposts: false,
        supportsAdminExclusion: false,
      },
      fetchPost: vi.fn().mockResolvedValue({
        platform: 'VK',
        ownerId: '-12345',
        postId: '67890',
        sourceUrl: 'https://vk.com/wall-12345_67890',
        title: 'Preview Guard Test Post',
        text: 'Post content for preview security test',
        imageUrl: 'https://example.com/cover.jpg',
        likesCount: 15,
        commentsCount: 3,
        repostsCount: 0,
        resolvedAuthType: 'SERVICE',
      }),
    };
    vi.spyOn(ProviderFactory, 'getVkProvider').mockReturnValue(mockProvider as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ─── Test 1: Cross-origin POST with untrusted Origin is rejected (403) ─────────
  it('cross-origin request with untrusted Origin header returns 403 Forbidden', async () => {
    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        Origin: 'https://malicious-attacker.com',
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    const res = await previewPost(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('CSRF');
  });

  // ─── Test 2: Cross-site Sec-Fetch-Site is rejected (403) ───────────────────────
  it('request with sec-fetch-site: cross-site returns 403 Forbidden', async () => {
    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    const res = await previewPost(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // ─── Test 3: Anonymous request is permitted but bounded by strict rate limiter ──
  it('anonymous request is allowed under strict rate limiter, and blocked when limit exceeded (429)', async () => {
    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://randomayzer.test',
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    // 1. Initial anonymous request succeeds
    const res = await previewPost(req);
    expect(res.status).toBe(200);

    // 2. Exhaust strict expensive limiter on anonymous bucket (15 requests)
    for (let i = 0; i < 15; i++) {
      expensiveApiRateLimiter.check('post-preview:anon:direct-client');
    }

    const blockedRes = await previewPost(req);
    expect(blockedRes.status).toBe(429);
  });

  // ─── Test 4: Authenticated same-origin request succeeds (200) ───────────────────
  it('authenticated request with valid session returns 200 with truthful capabilities', async () => {
    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        Origin: 'https://randomayzer.test',
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });

    const res = await previewPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.post.title).toBe('Preview Guard Test Post');
    expect(data.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');
  });

  // ─── Test 5: VK_SERVICE_TOKEN is never leaked in response ───────────────────────
  it('VK_SERVICE_TOKEN is never leaked in response body on success or failure', async () => {
    // 1. Success response
    const authReq = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });
    const authRes = await previewPost(authReq);
    const authText = await authRes.text();
    expect(authText).not.toContain(secretServiceToken);

    // 2. Failure response (401)
    const unauthReq = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://vk.com/wall-12345_67890' }),
    });
    const unauthRes = await previewPost(unauthReq);
    const unauthText = await unauthRes.text();
    expect(unauthText).not.toContain(secretServiceToken);
  });
});
