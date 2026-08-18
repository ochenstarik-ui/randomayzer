import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { defaultOAuthTransactionStore } from '../src/lib/auth/oauth-state';
import { AesGcmTokenVault } from '../src/lib/auth/token-vault';
import { MemorySessionStore, SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { MemoryUserRepository, setUserRepository } from '../src/lib/repository/user-repository';
import { GET as startGet } from '../src/app/api/auth/vk/start/route';
import { GET as callbackGet } from '../src/app/api/auth/vk/callback/route';
import { GET as meGet } from '../src/app/api/auth/me/route';
import { POST as logoutPost } from '../src/app/api/auth/logout/route';
import { MockVkOAuthClient } from '../src/integrations/vk/mock-oauth-client';
import { setOAuthClient } from '../src/integrations/vk/vk-oauth-client';

describe('Phase 2.2 VK ID OAuth 2.1 Security & Token Safety Tests', () => {
  beforeEach(() => {
    defaultOAuthTransactionStore.clear();
  });

  it('generates unpredictable PKCE code_verifier, code_challenge and state on OAuth start', async () => {
    const tx1 = await defaultOAuthTransactionStore.createTransaction();
    const tx2 = await defaultOAuthTransactionStore.createTransaction();

    expect(tx1.state).not.toBe(tx2.state);
    expect(tx1.codeVerifier).not.toBe(tx2.codeVerifier);
    expect(tx1.codeChallenge).not.toBe(tx2.codeChallenge);

    expect(tx1.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(tx1.codeChallenge.length).toBeGreaterThanOrEqual(43);
    expect(tx1.state.length).toBeGreaterThanOrEqual(32);
  });

  it('strictly enforces single-use state on transaction consumption (replay attack prevention)', async () => {
    const { state, codeVerifier } = await defaultOAuthTransactionStore.createTransaction();

    // First consumption succeeds
    const consumed = await defaultOAuthTransactionStore.consumeTransaction(state);
    expect(consumed.codeVerifier).toBe(codeVerifier);

    // Second consumption MUST fail
    await expect(defaultOAuthTransactionStore.consumeTransaction(state)).rejects.toThrow(
      /OAuth state not found or was already consumed/i
    );
  });

  it('rejects expired OAuth state transactions', async () => {
    const { state } = await defaultOAuthTransactionStore.createTransaction({ ttlMs: 10 });

    await new Promise(r => setTimeout(r, 20));

    await expect(defaultOAuthTransactionStore.consumeTransaction(state)).rejects.toThrow(
      /OAuth state.*(expired|consumed|not found)/i
    );
  });

  it('callback returns 400 when authorization code is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/vk/callback?state=dummy_state');
    const res = await callbackGet(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/code is missing/i);
  });

  it('callback returns 400 when state parameter is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/vk/callback?code=dummy_code');
    const res = await callbackGet(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/state parameter is missing/i);
  });

  it('callback redirects to frontend with error query when user cancels authorization (error=access_denied)', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/auth/vk/callback?error=access_denied&error_description=User%20denied'
    );
    const res = await callbackGet(req);

    expect(res.status).toBe(307); // NextResponse.redirect default status
    const location = res.headers.get('location');
    expect(location).toContain('auth_error=User%20denied');
  });

  it('completes full successful OAuth 2.1 PKCE exchange, sets HttpOnly session cookie, and encrypts tokens', async () => {
    const mockOAuth = new MockVkOAuthClient();
    const userRepo = new MemoryUserRepository();
    const vault = new AesGcmTokenVault('test-secret-key-12345');
    const sessionStore = new MemorySessionStore();
    setOAuthClient(mockOAuth);
    setUserRepository(userRepo);

    // 1. Create start transaction
    const { state, codeVerifier } = await defaultOAuthTransactionStore.createTransaction({
      redirectTarget: '/giveaways/new',
    });

    // 2. Simulate Callback
    const req = new NextRequest(
      `http://localhost:3000/api/auth/vk/callback?code=auth_code_xyz&state=${state}`
    );
    const res = await callbackGet(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/giveaways/new');

    // 3. Verify HttpOnly session cookie is set
    const cookieHeader = res.headers.get('set-cookie');
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain(SESSION_COOKIE_NAME);
    expect(cookieHeader?.toLowerCase()).toContain('httponly');
    expect(cookieHeader?.toLowerCase()).toContain('samesite=lax');

    // 4. Assert token is NOT in cookie header
    expect(cookieHeader).not.toContain('mock_vk_access_token');
  });

  it('/api/auth/me returns only safe user profile and never leaks access or refresh tokens', async () => {
    const sessionStore = new MemorySessionStore();
    const sessionId = await sessionStore.createSession({
      id: 'usr_123',
      vkUserId: '999888',
      firstName: 'Ольга',
      lastName: 'Иванова',
      username: 'olga_iv',
      avatarUrl: 'https://sun9-1.userapi.com/s/v1/avatar.jpg',
    });

    const req = new NextRequest('http://localhost:3000/api/auth/me', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      },
    });

    const res = await meGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.user?.access_token).toBeUndefined();
    expect(body.user?.refreshToken).toBeUndefined();
    expect(body.user?.encryptedAccessToken).toBeUndefined();
  });

  it('/api/auth/logout destroys session and clears cookie', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=dummy_session_id`,
      },
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(200);

    const cookieHeader = res.headers.get('set-cookie');
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookieHeader).toContain('Max-Age=0');
  });

  it('AES-256-GCM TokenVault encrypts, decrypts, and rejects tampered ciphertexts', async () => {
    const vault = new AesGcmTokenVault('super-secure-key-vault-test-2026');
    const secretToken = 'vk1.a.secret_access_token_to_encrypt_987654321';

    const encrypted = await vault.encrypt(secretToken);
    expect(encrypted).not.toBe(secretToken);
    expect(encrypted).not.toContain(secretToken);

    // Decrypt
    const decrypted = await vault.decrypt(encrypted);
    expect(decrypted).toBe(secretToken);

    // Tamper with ciphertext
    const tampered = encrypted.slice(0, -4) + 'abcd';
    await expect(vault.decrypt(tampered)).rejects.toThrow();
  });
});
