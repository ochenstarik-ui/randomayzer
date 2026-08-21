/**
 * Extracts a human-readable, safe error message from any API response payload.
 * Eliminates `[object Object]` displays across all HTTP response codes.
 *
 * Supported formats:
 * - Structured API format: { success: false, error: { message, code, details } }
 * - String error format: { error: "..." }
 * - General message format: { message: "..." }
 * - Direct string payloads
 * - HTTP status code fallbacks (400, 401, 403, 404, 409, 429, 500)
 * - Safe fallback default
 */
export function extractApiErrorMessage(
  data: unknown,
  fallbackMessage: string = 'Произошла ошибка при выполнении запроса',
  httpStatus?: number
): string {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, any>;

    // 1. Structured API error: { error: { message: "...", code: "..." } }
    if (obj.error && typeof obj.error === 'object') {
      if (typeof obj.error.message === 'string' && obj.error.message.trim().length > 0) {
        return obj.error.message;
      }
      if (typeof obj.error.code === 'string' && obj.error.code.trim().length > 0) {
        return `Ошибка: ${obj.error.code}`;
      }
    }

    // 2. String error property: { error: "..." }
    if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
      return obj.error;
    }

    // 3. String message property: { message: "..." }
    if (typeof obj.message === 'string' && obj.message.trim().length > 0) {
      return obj.message;
    }
  }

  // 4. Direct string payload
  if (typeof data === 'string' && data.trim().length > 0) {
    return data;
  }

  // 5. HTTP status code fallback
  if (httpStatus) {
    switch (httpStatus) {
      case 400:
        return 'Некорректный запрос (400). Проверьте введенные параметры.';
      case 401:
        return 'Требуется авторизация через VK ID (401).';
      case 403:
        return 'Доступ запрещен (403). У вас нет прав для выполнения этой операции.';
      case 404:
        return 'Запрашиваемый ресурс не найден (404).';
      case 409:
        return 'Конфликт состояния данных (409). Попробуйте обновить страницу.';
      case 429:
        return 'Слишком много запросов (429). Пожалуйста, подождите несколько секунд.';
      case 500:
      case 502:
      case 503:
      case 504:
        return 'Серверная ошибка (500) при обработке запроса. Попробуйте позже.';
    }
  }

  return fallbackMessage;
}
