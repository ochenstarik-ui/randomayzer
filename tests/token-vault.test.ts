import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AesGcmTokenVault } from '../src/lib/auth/token-vault';

describe('Phase 2.2.1 Token Vault Security & Fail-Fast Policies', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails fast with fatal configuration error in production when TOKEN_ENCRYPTION_KEY is missing', () => {
    (process.env as any).NODE_ENV = 'production';
    delete process.env.TOKEN_ENCRYPTION_KEY;

    expect(() => new AesGcmTokenVault()).toThrow(/TOKEN_ENCRYPTION_KEY environment variable is strictly required in production/i);
  });

  it('fails fast in production when TOKEN_ENCRYPTION_KEY is shorter than 32 characters', () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.TOKEN_ENCRYPTION_KEY = 'too-short-key';

    expect(() => new AesGcmTokenVault()).toThrow(/must be at least 32 characters long in production/i);
  });

  it('successfully initializes and encrypts/decrypts with valid 32+ character key in production', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.TOKEN_ENCRYPTION_KEY = 'a-super-secret-production-encryption-key-32chars!';

    const vault = new AesGcmTokenVault();
    const token = 'vk1.a.prod_access_token_1234567890abcdef';

    const encrypted = await vault.encrypt(token);
    expect(encrypted).not.toBe(token);
    expect(encrypted).not.toContain(token);

    const decrypted = await vault.decrypt(encrypted);
    expect(decrypted).toBe(token);
  });

  it('allows explicit dev/test key when in development or test environment', async () => {
    (process.env as any).NODE_ENV = 'test';
    delete process.env.TOKEN_ENCRYPTION_KEY;

    const vault = new AesGcmTokenVault();
    const token = 'vk1.a.dev_token_sample';
    const encrypted = await vault.encrypt(token);
    const decrypted = await vault.decrypt(encrypted);
    expect(decrypted).toBe(token);
  });

  it('fails decryption with wrong key', async () => {
    const vault1 = new AesGcmTokenVault('key-number-one-with-sufficient-entropy-32b!');
    const vault2 = new AesGcmTokenVault('key-number-two-with-sufficient-entropy-32b!');

    const token = 'vk1.a.confidential_user_token_123';
    const encrypted = await vault1.encrypt(token);

    await expect(vault2.decrypt(encrypted)).rejects.toThrow();
  });

  it('fails authentication on tampered ciphertext or tag', async () => {
    const vault = new AesGcmTokenVault('valid-key-for-gcm-integrity-testing-32b!');
    const token = 'vk1.a.token_to_tamper_with';

    const encrypted = await vault.encrypt(token);
    const [iv, tag, cipher] = encrypted.split(':');

    // Tamper tag
    const tamperedTag = tag.slice(0, -2) + 'ff';
    await expect(vault.decrypt(`${iv}:${tamperedTag}:${cipher}`)).rejects.toThrow();

    // Tamper ciphertext
    const tamperedCipher = cipher.slice(0, -2) + '00';
    await expect(vault.decrypt(`${iv}:${tag}:${tamperedCipher}`)).rejects.toThrow();
  });
});
