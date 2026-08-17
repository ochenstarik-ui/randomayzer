/**
 * Parses various formats of VKontakte post URLs:
 * - https://vk.com/wall-123456_789
 * - https://vk.ru/wall123456_789
 * - https://m.vk.com/wall-123456_789
 * - https://vk.com/club123456?w=wall-123456_789
 * - https://vk.com/public123456?w=wall-123456_789
 * - wall-123456_789
 * - -123456_789
 */
export function parseVkPostUrl(input: string): { ownerId: string; postId: string } | null {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // Pattern 1: Direct "wall-123_456" or "-123_456"
  const directMatch = trimmed.match(/^(?:wall)?(-?\d+)_(\d+)$/i);
  if (directMatch) {
    return {
      ownerId: directMatch[1],
      postId: directMatch[2],
    };
  }

  // Pattern 2: URL with ?w=wall-123_456 or &w=wall-123_456
  const queryWallMatch = trimmed.match(/[?&]w=wall(-?\d+)_(\d+)/i);
  if (queryWallMatch) {
    return {
      ownerId: queryWallMatch[1],
      postId: queryWallMatch[2],
    };
  }

  // Pattern 3: Standard URL path https://vk.com/wall-123_456 or https://m.vk.com/wall-123_456
  const urlWallMatch = trimmed.match(/(?:vk\.com|vk\.ru|m\.vk\.com)\/wall(-?\d+)_(\d+)/i);
  if (urlWallMatch) {
    return {
      ownerId: urlWallMatch[1],
      postId: urlWallMatch[2],
    };
  }

  return null;
}
