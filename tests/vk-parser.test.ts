import { describe, it, expect } from 'vitest';
import { parseVkPostUrl } from '../src/providers/vk/vk-parser';

describe('VK Post URL Parser', () => {
  it('should parse standard desktop URLs', () => {
    const res = parseVkPostUrl('https://vk.com/wall-22446688_1054');
    expect(res).toEqual({ ownerId: '-22446688', postId: '1054' });
  });

  it('should parse mobile URLs', () => {
    const res = parseVkPostUrl('https://m.vk.com/wall-123456_789');
    expect(res).toEqual({ ownerId: '-123456', postId: '789' });
  });

  it('should parse vk.ru domain URLs', () => {
    const res = parseVkPostUrl('https://vk.ru/wall55555_999');
    expect(res).toEqual({ ownerId: '55555', postId: '999' });
  });

  it('should parse URLs with ?w= query parameter', () => {
    const res = parseVkPostUrl('https://vk.com/club1234567?w=wall-1234567_42');
    expect(res).toEqual({ ownerId: '-1234567', postId: '42' });
  });

  it('should parse direct wall string format', () => {
    const res1 = parseVkPostUrl('wall-100_200');
    expect(res1).toEqual({ ownerId: '-100', postId: '200' });

    const res2 = parseVkPostUrl('-100_200');
    expect(res2).toEqual({ ownerId: '-100', postId: '200' });
  });

  it('should return null for invalid inputs', () => {
    expect(parseVkPostUrl('')).toBeNull();
    expect(parseVkPostUrl('https://google.com')).toBeNull();
    expect(parseVkPostUrl('invalid_string')).toBeNull();
  });
});
