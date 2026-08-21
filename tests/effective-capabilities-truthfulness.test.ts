import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as previewPost } from '../src/app/api/posts/preview/route';
import { GET as giveawayDetailGet } from '../src/app/api/giveaways/[id]/route';
import { MemoryUserRepository, setUserRepository } from '../src/lib/repository/user-repository';
import { defaultSessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { AesGcmTokenVault } from '../src/lib/auth/token-vault';
import { TokenRefresher } from '../src/lib/auth/token-refresher';
import { VkAuthContextResolver } from '../src/integrations/vk/vk-auth-resolver';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { IVkClient } from '../src/integrations/vk/vk-client';
import { VkAuthContext } from '../src/integrations/vk/vk-types';
import { VkPrivateResourceError } from '../src/integrations/vk/vk-errors';
import { ProviderFactory } from '../src/providers/factory';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { DEFAULT_FILTER_RULES } from '../src/core/types/giveaway';

describe('Phase 2.3.1 — Effective Capabilities Truthfulness Gate', () => {
  let userRepo: MemoryUserRepository;
  let tokenVault: AesGcmTokenVault;
  let tokenRefresher: TokenRefresher;
  let authResolver: VkAuthContextResolver;

  let loggedInUser: any;
  let sessionCookie: string;
  let loggedInUserWithoutCreds: any;
  let sessionCookieNoCreds: string;

  const userTokenPlain = 'vk1.a.user_organizer_valid_token_123';
  const serviceTokenPlain = 'vk_service_token_456';

  beforeEach(async () => {
    userRepo = new MemoryUserRepository();
    setUserRepository(userRepo);

    defaultSessionStore.clear();

    tokenVault = new AesGcmTokenVault('test-master-token-encryption-key-32b!');
    tokenRefresher = new TokenRefresher(userRepo, tokenVault);
    authResolver = new VkAuthContextResolver(tokenRefresher);

    process.env.VK_SERVICE_TOKEN = serviceTokenPlain;
    process.env.USE_VK_MOCK = 'false';

    // 1. User with valid encrypted VK credential
    const encryptedAccessToken = await tokenVault.encrypt(userTokenPlain);
    loggedInUser = await userRepo.upsertUserWithTokens({
      vkUserId: '11112222',
      firstName: 'Alice',
      lastName: 'Organizer',
      encryptedAccessToken,
      expiresIn: 3600,
    });
    const sessionId1 = await defaultSessionStore.createSession(loggedInUser);
    sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId1}`;

    // 2. User with session but NO VK credentials in repository
    loggedInUserWithoutCreds = await userRepo.upsertUserWithTokens({
      vkUserId: '33334444',
      firstName: 'Charlie',
      lastName: 'NoCreds',
      encryptedAccessToken: '', // empty / missing
    });
    // Remove credentials for Charlie
    (userRepo as any).credentials.delete(loggedInUserWithoutCreds.id);
    const sessionId2 = await defaultSessionStore.createSession(loggedInUserWithoutCreds);
    sessionCookieNoCreds = `${SESSION_COOKIE_NAME}=${sessionId2}`;

    // Reset GiveawayStore
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
  });

  // ─── Test 1: Logged-in user + public post + SERVICE succeeds → PUBLIC_SERVICE ───
  it('1. logged-in user + public post + SERVICE succeeds reports accessMode PUBLIC_SERVICE', async () => {
    const mockClient: IVkClient = {
      call: async (_method, _params, auth) => {
        expect(auth.type).toBe('SERVICE');
        return {
          items: [
            {
              id: 101,
              owner_id: -101,
              date: 1700000000,
              text: 'Public wall post',
              likes: { count: 10 },
              comments: { count: 2 },
              reposts: { count: 0 },
            },
          ],
        } as any;
      },
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);
    ProviderFactory.getVkProvider = () => provider;

    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-101_101' }),
    });

    const res = await previewPost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Truthfulness: Despite user having a session, the post was fetched with SERVICE token
    expect(json.post.resolvedAuthType).toBe('SERVICE');
    expect(json.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');
    expect(json.effectiveCapabilities.adminDetection).toBe(false);
  });

  // ─── Test 2: SERVICE denied + USER succeeds → ORGANIZER_USER ─────────────────
  it('2. SERVICE denied (private) + USER fallback succeeds reports accessMode ORGANIZER_USER', async () => {
    const authSequence: VkAuthContext[] = [];

    const mockClient: IVkClient = {
      call: async (_method, _params, auth) => {
        authSequence.push(auth!);
        if (auth.type === 'SERVICE') {
          // Private post access denied on service token
          throw new VkPrivateResourceError('Post is private', { errorCode: 15 });
        }
        // USER token succeeds
        return {
          items: [
            {
              id: 202,
              owner_id: -202,
              date: 1700000000,
              text: 'Private group post visible to organizer',
              likes: { count: 25 },
              comments: { count: 7 },
              reposts: { count: 0 },
            },
          ],
        } as any;
      },
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);
    ProviderFactory.getVkProvider = () => provider;

    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-202_202' }),
    });

    const res = await previewPost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(authSequence).toHaveLength(2);
    expect(authSequence[0].type).toBe('SERVICE');
    expect(authSequence[1].type).toBe('USER');

    // Truthfulness: Since USER fallback was actually used, it accurately reports ORGANIZER_USER
    expect(json.post.resolvedAuthType).toBe('USER');
    expect(json.effectiveCapabilities.accessMode).toBe('ORGANIZER_USER');
  });

  // ─── Test 3: Logged-in user with missing credentials + public SERVICE succeeds ─
  it('3. logged-in user with missing USER credential + public SERVICE access does NOT claim ORGANIZER_USER', async () => {
    const mockClient: IVkClient = {
      call: async () => ({
        items: [
          {
            id: 303,
            owner_id: -303,
            date: 1700000000,
            text: 'Public post for user without VK creds',
            likes: { count: 1 },
            comments: { count: 0 },
            reposts: { count: 0 },
          },
        ],
      } as any),
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);
    ProviderFactory.getVkProvider = () => provider;

    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookieNoCreds, // Charlie has no VK credentials
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-303_303' }),
    });

    const res = await previewPost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Truthfulness: must NOT claim ORGANIZER_USER
    expect(json.post.resolvedAuthType).toBe('SERVICE');
    expect(json.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');
  });

  // ─── Test 4: Authenticated user without custom tokens + SERVICE succeeds → PUBLIC_SERVICE ───
  it('4. authenticated user without custom tokens + SERVICE succeeds reports accessMode PUBLIC_SERVICE', async () => {
    const mockClient: IVkClient = {
      call: async () => ({
        items: [
          {
            id: 404,
            owner_id: -404,
            date: 1700000000,
            text: 'Preview post with default service token',
            likes: { count: 50 },
            comments: { count: 12 },
            reposts: { count: 3 },
          },
        ],
      } as any),
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);
    ProviderFactory.getVkProvider = () => provider;

    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookieNoCreds,
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-404_404' }),
    });

    const res = await previewPost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.post.resolvedAuthType).toBe('SERVICE');
    expect(json.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');
  });

  // ─── Test 5: No token/credential/auth object leaked in preview response ───────
  it('5. preview response never contains tokens, credentials, or internal auth objects', async () => {
    const mockClient: IVkClient = {
      call: async () => ({
        items: [
          {
            id: 505,
            owner_id: -505,
            date: 1700000000,
            text: 'Security check post',
            likes: { count: 2 },
            comments: { count: 1 },
            reposts: { count: 0 },
          },
        ],
      } as any),
    };

    const provider = new VkProvider(serviceTokenPlain, mockClient, authResolver);
    ProviderFactory.getVkProvider = () => provider;

    const req = new NextRequest('http://localhost:3000/api/posts/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({ url: 'https://vk.com/wall-505_505' }),
    });

    const res = await previewPost(req);
    const text = await res.text();

    // Security check: raw response text must NOT leak any secret strings
    expect(text).not.toContain(userTokenPlain);
    expect(text).not.toContain(serviceTokenPlain);
    expect(text).not.toContain('tokenVault');
    expect(text).not.toContain('encryptedAccessToken');
    expect(text).not.toContain('refreshToken');

    const parsed = JSON.parse(text);
    // Post only contains safe literal resolvedAuthType string
    expect(parsed.post.resolvedAuthType).toBe('SERVICE');
    expect(parsed.post).not.toHaveProperty('token');
    expect(parsed.post).not.toHaveProperty('authContext');
  });

  // ─── Test 6: Giveaway detail effectiveCapabilities truthfulness ──────────────
  it('6. giveaway detail endpoint reports ORGANIZER_USER when user has credentials, PUBLIC_SERVICE when missing', async () => {
    // 6a. Create giveaway for Alice (has credentials)
    const gwAlice = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-101_101',
      organizerId: loggedInUser.id,
      filterRules: DEFAULT_FILTER_RULES,
      post: {
        platform: 'VK',
        ownerId: '-101',
        postId: '101',
        sourceUrl: 'https://vk.com/wall-101_101',
        title: 'Alice Giveaway',
        text: 'Text',
        likesCount: 10,
        commentsCount: 2,
        repostsCount: 0,
      },
    });

    const reqAlice = new NextRequest(`http://localhost:3000/api/giveaways/${gwAlice.id}`, {
      method: 'GET',
      headers: { 'Cookie': sessionCookie },
    });

    const resAlice = await giveawayDetailGet(reqAlice, { params: { id: gwAlice.id } });
    const jsonAlice = await resAlice.json();

    expect(resAlice.status).toBe(200);
    expect(jsonAlice.effectiveCapabilities.accessMode).toBe('ORGANIZER_USER');
    expect(jsonAlice.effectiveCapabilities.credentialStatus).toBe('AVAILABLE');

    // 6b. Create giveaway for Charlie (no credentials)
    const gwCharlie = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-303_303',
      organizerId: loggedInUserWithoutCreds.id,
      filterRules: DEFAULT_FILTER_RULES,
      post: {
        platform: 'VK',
        ownerId: '-303',
        postId: '303',
        sourceUrl: 'https://vk.com/wall-303_303',
        title: 'Charlie Giveaway',
        text: 'Text',
        likesCount: 1,
        commentsCount: 0,
        repostsCount: 0,
      },
    });

    const reqCharlie = new NextRequest(`http://localhost:3000/api/giveaways/${gwCharlie.id}`, {
      method: 'GET',
      headers: { 'Cookie': sessionCookieNoCreds },
    });

    const resCharlie = await giveawayDetailGet(reqCharlie, { params: { id: gwCharlie.id } });
    const jsonCharlie = await resCharlie.json();

    expect(resCharlie.status).toBe(200);
    expect(jsonCharlie.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');
    expect(jsonCharlie.effectiveCapabilities.credentialStatus).toBe('MISSING');
  });

  // ─── Test 7: Expired credential + refresh token available → ORGANIZER_USER (REFRESHABLE) ─
  it('7. expired credential + refresh token reports ORGANIZER_USER with REFRESHABLE status', async () => {
    const encryptedAccessToken = await tokenVault.encrypt('old_token');
    const encryptedRefreshToken = await tokenVault.encrypt('valid_refresh_token');

    const expiredUser = await userRepo.upsertUserWithTokens({
      vkUserId: '55556666',
      firstName: 'David',
      lastName: 'Refreshable',
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresIn: -60, // expired 1 minute ago
    });

    const sessionId = await defaultSessionStore.createSession(expiredUser);
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-555_555',
      organizerId: expiredUser.id,
      filterRules: DEFAULT_FILTER_RULES,
      post: {
        platform: 'VK',
        ownerId: '-555',
        postId: '555',
        sourceUrl: 'https://vk.com/wall-555_555',
        title: 'David Giveaway',
        text: 'Text',
        likesCount: 5,
        commentsCount: 1,
        repostsCount: 0,
      },
    });

    const req = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}`, {
      method: 'GET',
      headers: { 'Cookie': cookie },
    });

    const res = await giveawayDetailGet(req, { params: { id: gw.id } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.effectiveCapabilities.accessMode).toBe('ORGANIZER_USER');
    expect(json.effectiveCapabilities.credentialStatus).toBe('REFRESHABLE');
  });

  // ─── Test 8: Expired credential WITHOUT refresh token → PUBLIC_SERVICE (REAUTH_REQUIRED) ─
  it('8. expired credential without refresh token reports PUBLIC_SERVICE with REAUTH_REQUIRED status', async () => {
    const encryptedAccessToken = await tokenVault.encrypt('old_token_no_refresh');

    const expiredNoRefreshUser = await userRepo.upsertUserWithTokens({
      vkUserId: '77779999',
      firstName: 'Eve',
      lastName: 'NoRefresh',
      encryptedAccessToken,
      expiresIn: -60, // expired 1 minute ago
    });

    const sessionId = await defaultSessionStore.createSession(expiredNoRefreshUser);
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-777_777',
      organizerId: expiredNoRefreshUser.id,
      filterRules: DEFAULT_FILTER_RULES,
      post: {
        platform: 'VK',
        ownerId: '-777',
        postId: '777',
        sourceUrl: 'https://vk.com/wall-777_777',
        title: 'Eve Giveaway',
        text: 'Text',
        likesCount: 5,
        commentsCount: 1,
        repostsCount: 0,
      },
    });

    const req = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}`, {
      method: 'GET',
      headers: { 'Cookie': cookie },
    });

    const res = await giveawayDetailGet(req, { params: { id: gw.id } });
    const json = await res.json();

    expect(res.status).toBe(200);
    // Must NOT claim ORGANIZER_USER
    expect(json.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');
    expect(json.effectiveCapabilities.credentialStatus).toBe('REAUTH_REQUIRED');
  });

  // ─── Test 9: Null expiresAt WITHOUT refresh token → PUBLIC_SERVICE (REAUTH_REQUIRED) ─
  it('9. null expiresAt without refresh token reports PUBLIC_SERVICE with REAUTH_REQUIRED status', async () => {
    const encryptedAccessToken = await tokenVault.encrypt('legacy_token');

    const legacyUser = await userRepo.upsertUserWithTokens({
      vkUserId: '88880000',
      firstName: 'Frank',
      lastName: 'LegacyNoExpiry',
      encryptedAccessToken,
      // expiresIn: undefined -> expiresAt: null
    });

    const sessionId = await defaultSessionStore.createSession(legacyUser);
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-888_888',
      organizerId: legacyUser.id,
      filterRules: DEFAULT_FILTER_RULES,
      post: {
        platform: 'VK',
        ownerId: '-888',
        postId: '888',
        sourceUrl: 'https://vk.com/wall-888_888',
        title: 'Frank Giveaway',
        text: 'Text',
        likesCount: 5,
        commentsCount: 1,
        repostsCount: 0,
      },
    });

    const req = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}`, {
      method: 'GET',
      headers: { 'Cookie': cookie },
    });

    const res = await giveawayDetailGet(req, { params: { id: gw.id } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.effectiveCapabilities.accessMode).toBe('PUBLIC_SERVICE');
    expect(json.effectiveCapabilities.credentialStatus).toBe('REAUTH_REQUIRED');
  });

  // ─── Test 10: Null expiresAt WITH refresh token → ORGANIZER_USER (REFRESHABLE) ─
  it('10. null expiresAt with refresh token reports ORGANIZER_USER with REFRESHABLE status', async () => {
    const encryptedAccessToken = await tokenVault.encrypt('legacy_token');
    const encryptedRefreshToken = await tokenVault.encrypt('valid_refresh_token');

    const legacyRefreshUser = await userRepo.upsertUserWithTokens({
      vkUserId: '99991111',
      firstName: 'Grace',
      lastName: 'LegacyRefreshable',
      encryptedAccessToken,
      encryptedRefreshToken,
      // expiresIn: undefined -> expiresAt: null
    });

    const sessionId = await defaultSessionStore.createSession(legacyRefreshUser);
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-999_999',
      organizerId: legacyRefreshUser.id,
      filterRules: DEFAULT_FILTER_RULES,
      post: {
        platform: 'VK',
        ownerId: '-999',
        postId: '999',
        sourceUrl: 'https://vk.com/wall-999_999',
        title: 'Grace Giveaway',
        text: 'Text',
        likesCount: 5,
        commentsCount: 1,
        repostsCount: 0,
      },
    });

    const req = new NextRequest(`http://localhost:3000/api/giveaways/${gw.id}`, {
      method: 'GET',
      headers: { 'Cookie': cookie },
    });

    const res = await giveawayDetailGet(req, { params: { id: gw.id } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.effectiveCapabilities.accessMode).toBe('ORGANIZER_USER');
    expect(json.effectiveCapabilities.credentialStatus).toBe('REFRESHABLE');
  });

  // ─── Test 11: Giveaway detail does not leak tokens or secret fields ──────────
  it('11. giveaway detail response never leaks token or secret fields', async () => {
    const gwAlice = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-101_101',
      organizerId: loggedInUser.id,
      filterRules: DEFAULT_FILTER_RULES,
      post: {
        platform: 'VK',
        ownerId: '-101',
        postId: '101',
        sourceUrl: 'https://vk.com/wall-101_101',
        title: 'Alice Giveaway',
        text: 'Text',
        likesCount: 10,
        commentsCount: 2,
        repostsCount: 0,
      },
    });

    const reqAlice = new NextRequest(`http://localhost:3000/api/giveaways/${gwAlice.id}`, {
      method: 'GET',
      headers: { 'Cookie': sessionCookie },
    });

    const resAlice = await giveawayDetailGet(reqAlice, { params: { id: gwAlice.id } });
    const rawText = await resAlice.text();

    expect(rawText).not.toContain(userTokenPlain);
    expect(rawText).not.toContain(serviceTokenPlain);
    expect(rawText).not.toContain('encryptedAccessToken');
    expect(rawText).not.toContain('encryptedRefreshToken');
    expect(rawText).not.toContain('tokenVault');
  });
});
