/**
 * Application environment configuration and trusted origin resolver.
 * Enforces strict fail-fast validation in production for OAuth base URLs.
 */

export function getAppBaseUrl(): string {
  const envUrl = process.env.APP_BASE_URL?.trim();

  if (process.env.NODE_ENV === 'production') {
    if (!envUrl) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: APP_BASE_URL environment variable is strictly required in production.'
      );
    }
    if (!envUrl.startsWith('https://')) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: APP_BASE_URL must be a valid HTTPS URL in production.'
      );
    }
    return envUrl.replace(/\/+$/, '');
  }

  // Development/Test environment fallback
  return (envUrl || 'http://localhost:3000').replace(/\/+$/, '');
}

export function getVkRedirectUri(): string {
  const envUri = process.env.VK_REDIRECT_URI?.trim();

  if (process.env.NODE_ENV === 'production') {
    if (!envUri) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: VK_REDIRECT_URI environment variable is strictly required in production.'
      );
    }
    if (!envUri.startsWith('https://')) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: VK_REDIRECT_URI must be a valid HTTPS URL in production.'
      );
    }
    return envUri;
  }

  // Development/Test environment fallback
  return envUri || `${getAppBaseUrl()}/api/auth/vk/callback`;
}

export function getTrustedHost(): string {
  try {
    const url = new URL(getAppBaseUrl());
    return url.host.toLowerCase();
  } catch {
    return 'localhost:3000';
  }
}
