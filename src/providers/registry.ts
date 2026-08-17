import { PlatformType } from '../core/types/giveaway';
import { SocialMediaProvider } from './types';
import { VkMockProvider } from './vk/vk-mock-provider';
import { VkProvider } from './vk/vk-provider';

export class ProviderRegistry {
  private static providers: Map<PlatformType, SocialMediaProvider> = new Map();

  static {
    // Determine whether to use real VK provider or mock provider
    const useRealVk = Boolean(process.env.VK_SERVICE_TOKEN && process.env.VK_SERVICE_TOKEN.trim().length > 10);
    const vkProvider = useRealVk ? new VkProvider() : new VkMockProvider();

    this.providers.set('VK', vkProvider);
  }

  /**
   * Register or override a provider for a platform
   */
  static registerProvider(platform: PlatformType, provider: SocialMediaProvider): void {
    this.providers.set(platform, provider);
  }

  /**
   * Get provider by platform type
   */
  static getProvider(platform: PlatformType): SocialMediaProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`Provider for platform "${platform}" is not registered`);
    }
    return provider;
  }

  /**
   * Force set mock provider for testing purposes
   */
  static useMockVk(): void {
    this.providers.set('VK', new VkMockProvider());
  }
}
