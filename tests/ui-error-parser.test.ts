import { describe, it, expect } from 'vitest';
import { extractApiErrorMessage } from '../src/lib/api-error-parser';

describe('Task 10: extractApiErrorMessage helper', () => {
  it('extracts message from structured error payload { error: { message, code } }', () => {
    const payload = {
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'Розыгрыш уже находится в статусе SNAPSHOT_LOCKED',
      },
    };
    expect(extractApiErrorMessage(payload)).toBe('Розыгрыш уже находится в статусе SNAPSHOT_LOCKED');
  });

  it('never returns "[object Object]" when error is a structured object without message but with code', () => {
    const payload = {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
      },
    };
    const result = extractApiErrorMessage(payload);
    expect(result).toBe('Ошибка: UNAUTHORIZED');
    expect(result).not.toContain('[object Object]');
  });

  it('extracts legacy string error { error: "Custom string" }', () => {
    const payload = {
      success: false,
      error: 'Неверный формат URL',
    };
    expect(extractApiErrorMessage(payload)).toBe('Неверный формат URL');
  });

  it('extracts message from { message: "Some message" }', () => {
    const payload = {
      message: 'Network timeout',
    };
    expect(extractApiErrorMessage(payload)).toBe('Network timeout');
  });

  it('extracts plain string payload', () => {
    expect(extractApiErrorMessage('Bad Gateway')).toBe('Bad Gateway');
  });

  it('uses HTTP status code fallbacks when body has no message', () => {
    expect(extractApiErrorMessage({}, 'Default', 400)).toContain('400');
    expect(extractApiErrorMessage(null, 'Default', 401)).toContain('401');
    expect(extractApiErrorMessage(undefined, 'Default', 403)).toContain('403');
    expect(extractApiErrorMessage({}, 'Default', 404)).toContain('404');
    expect(extractApiErrorMessage({}, 'Default', 409)).toContain('409');
    expect(extractApiErrorMessage({}, 'Default', 429)).toContain('429');
    expect(extractApiErrorMessage({}, 'Default', 500)).toContain('500');
  });

  it('falls back to custom fallback message when data is empty and no status code provided', () => {
    expect(extractApiErrorMessage(null, 'Пользовательский фоллбэк')).toBe('Пользовательский фоллбэк');
    expect(extractApiErrorMessage({}, 'Пользовательский фоллбэк')).toBe('Пользовательский фоллбэк');
  });
});
