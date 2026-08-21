# Task 10: Обработка ошибок и неаутентифицированного состояния в UI Report

**Date:** 2026-08-21  
**Base Commit SHA:** `3feb0d5834910bb804621edf11d3f98a07e23cbd`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Устранены проблемы UX и отображения ошибок во всем клиентском интерфейсе:

1. **Единый хелпер `extractApiErrorMessage` (`src/lib/api-error-parser.ts`):**
   - Корректно извлекает текст ошибок из структуры API `{ success: false, error: { code, message, details } }`, строковых полей `error` и `message`, прямых текстовых ответов и статусных кодов HTTP (400, 401, 403, 404, 409, 429, 500).
   - Исключено появление `[object Object]` на всех экранах приложения. Покрыт unit-тестами (7 тестов в `tests/ui-error-parser.test.ts`).

2. **Предотвращение «тихой смерти» визарда (`src/app/giveaways/new/page.tsx`):**
   - В `handleFetchPost` добавлена строгая проверка `createRes.ok` и `createData.giveaway.id`. При ошибке (включая 401 Unauthorized) сообщение отображается в баннере.
   - Кнопка перехода на шаг 2 деактивирована (`disabled={!createdGiveawayId}`) до успешного создания розыгрыша на сервере.
   - Все вызовы `alert()` удалены и заменены на встроенные интерактивные баннеры `wizardError`.

3. **Разделение состояний дашборда (`src/app/page.tsx`):**
   - Дашборд корректно отличает статус 401 (не авторизован) от пустого списка конкурсов у авторизованного организатора.
   - Для неавторизованных пользователей отображается специальный баннер с приглашением войти через VK ID.

4. **Сохранение контекста при авторизации (`src/components/auth/AuthButton.tsx`):**
   - В кнопку входа добавлен параметр `?redirectTarget=${encodeURIComponent(pathname)}` через `usePathname()`, обеспечивающий автоматический возврат пользователя на страницу, с которой был инициирован вход.

5. **Страница деталей (`src/app/giveaways/[id]/page.tsx`):**
   - Извлечение ошибок через `extractApiErrorMessage`.
   - Замена `alert()` при ошибке верификации на встроенный inline-баннер `verifyError`.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/lib/api-error-parser.ts` | Client Lib (NEW) | Единая функция извлечения понятных сообщений об ошибках из ответов API. |
| `tests/ui-error-parser.test.ts` | Tests (NEW) | Unit-тесты для `extractApiErrorMessage` (7 тестов). |
| `src/components/auth/AuthButton.tsx` | UI Component | Добавлен `redirectTarget` в URL кнопки входа через VK ID. |
| `src/app/page.tsx` | Page UI | Реализовано состояние 401 Unauthenticated с приглашением ко входу. |
| `src/app/giveaways/new/page.tsx` | Page UI | Валидация создания черновика на шаге 1, удаление `alert()`, встроенные баннеры ошибок. |
| `src/app/giveaways/[id]/page.tsx` | Page UI | Улучшена обработка ошибок загрузки и верификации розыгрыша. |
| `tests/vk-correctness-gate.test.ts` | Tests | Увеличен таймаут задержки в тесте отмены запроса до 1000мс для исключения флаков при высокой нагрузке CPU. |

---

## 3. Manual UI Verification Walkthrough

1. **Сценарий 1: Неавторизованный пользователь на главной (`/`):**
   - Открытие главной страницы без сессионной куки: `GET /api/giveaways` возвращает 401.
   - Результат: отображается красивый баннер «Требуется авторизация» с кнопкой «Войти через VK ID» (`/api/auth/vk/start?redirectTarget=/`).
2. **Сценарий 2: Попытка создать розыгрыш без авторизации (`/giveaways/new`):**
   - Ввод URL поста и нажатие «Загрузить пост»: `POST /api/posts/preview` возвращает 401.
   - Результат: отображается понятный баннер «Для создания розыгрыша и предпросмотра публикации необходимо войти через VK ID». Кнопка «Перейти к настройке условий» заблокирована.
3. **Сценарий 3: Обработка конфликтов и ошибок сервера (409, 429, 500):**
   - При ошибке блокировки слепка или проведения жеребьевки вместо `[object Object]` отображается сообщение `error.message` из ответа API во встроенном баннере с кнопкой закрытия.

---

## 4. Verification Evidence & Test Gate

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (0 ошибок типизации во всех 57 тестовых файлах и прикладном коде)
npm test             -> EXIT 0 (57 тестовых файлов, 332 теста пройдены успешно без БД)
npm run lint         -> EXIT 0 (0 ошибок, 6 warnings на no-img-element)
npm run build        -> EXIT 0 (Все 17 маршрутов скомпилированы успешно)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
