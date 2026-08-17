/**
 * Validates and sanitizes redirect targets to prevent Open Redirect vulnerabilities.
 * Allows only strictly relative paths on the same origin (e.g., '/giveaways/new', '/dashboard').
 * Rejects protocol-relative paths ('//evil.com'), backslash escapes ('/\\evil.com'), and schema URIs.
 */
export function validateSafeRedirectTarget(rawTarget?: string | null): string {
  if (!rawTarget || typeof rawTarget !== 'string') {
    return '/';
  }

  const trimmed = rawTarget.trim();

  // Must start with a single forward slash
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }

  // Must not contain scheme colon or control characters before query/hash
  const pathPart = trimmed.split('?')[0].split('#')[0];
  if (pathPart.includes(':') || pathPart.includes('\\')) {
    return '/';
  }

  // Reject malicious schemes
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('data:') ||
    lower.includes('vbscript:') ||
    lower.includes('http:') ||
    lower.includes('https:')
  ) {
    return '/';
  }

  return trimmed;
}
