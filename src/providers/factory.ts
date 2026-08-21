import { PlatformType } from '../core/types/giveaway';
import { SocialMediaProvider } from './types';
import { VkProvider } from './vk/vk-provider';
import { VkMockProvider } from './vk/vk-mock-provider';
import { DependencyUnavailableError, ValidationError } from '../core/errors/http-errors';

export class ProviderFactory {
  public static getVkProvider(): SocialMediaProvider {
    // 1. Explicit mock configuration
    if (process.env.USE_VK_MOCK === 'true') {
      return new VkMockProvider();
    }

    // 2. Real provider when token is present
    const serviceToken = process.env.VK_SERVICE_TOKEN;
    if (serviceToken && serviceToken.trim().length > 0) {
      return new VkProvider(serviceToken.trim());
    }

    // 3. Test environment fallback
    if (process.env.NODE_ENV === 'test') {
      return new VkMockProvider();
    }

    // 4. Production/Default without token: STRICT FAIL
    throw new DependencyUnavailableError(
      'VK provider credentials are not configured. Configure VK_SERVICE_TOKEN or set USE_VK_MOCK=true for staging/test.'
    );
  }

  public static getProvider(platform: PlatformType): SocialMediaProvider {
    switch (platform) {
      case 'VK':
        return this.getVkProvider();
      case 'TELEGRAM':
      case 'YOUTUBE':
        throw new ValidationError(`Platform "${platform}" is not currently supported`);
      default:
        throw new ValidationError(`Unknown platform: ${platform}`);
    }
  }
}
