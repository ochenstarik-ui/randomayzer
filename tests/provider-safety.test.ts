import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderFactory } from '../src/providers/factory';
import { VkMockProvider } from '../src/providers/vk/vk-mock-provider';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { DependencyUnavailableError } from '../src/core/errors/http-errors';

describe('Provider Safety (No unconfigured mocks in Production)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.USE_VK_MOCK;
    delete process.env.VK_SERVICE_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return VkMockProvider when USE_VK_MOCK=true is explicitly set', () => {
    process.env.USE_VK_MOCK = 'true';
    const provider = ProviderFactory.getVkProvider();
    expect(provider).toBeInstanceOf(VkMockProvider);
  });

  it('should return VkProvider when VK_SERVICE_TOKEN is present', () => {
    process.env.VK_SERVICE_TOKEN = 'mock_service_token_123';
    const provider = ProviderFactory.getVkProvider();
    expect(provider).toBeInstanceOf(VkProvider);
  });

  it('should throw DependencyUnavailableError in production when VK credentials and USE_VK_MOCK are missing', () => {
    (process.env as any).NODE_ENV = 'production';
    delete process.env.USE_VK_MOCK;
    delete process.env.VK_SERVICE_TOKEN;

    expect(() => ProviderFactory.getVkProvider()).toThrow(DependencyUnavailableError);
  });
});
