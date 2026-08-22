# Task 15 Report: Pre-auth лимит срабатывает ДО обращения к session store

**Agent:** Antigravity  
**Priority:** MEDIUM (доступность / защита БД)  
**Date:** 2026-08-21  
**Base SHA:** `8e39ce0cbd809b9fb1666dce09905035bc493c10`  
**Status:** COMPLETED & VERIFIED  

---

## 1. Проблема и воспроизведение дефекта

В реализации Task 12 проверка лимита для запросов с cookie (`randomayzer_session=<value>`) выполнялась **после** вызова `getSessionFromRequest(req)`. Если атакующий отправлял пачку запросов с произвольными строками в cookie, каждый запрос выполнял SQL-запрос к `prisma.session` (или `sessionStore.getSession()`), нагружая базу данных, и лишь затем получал 429.

### Воспроизведение на Base SHA (`8e39ce0cbd809b9fb1666dce09905035bc493c10`):
- 300 запросов без cookie: `getSessionCalls = 0`, 60 ответов `401`, 240 ответов `429` (PASS).
- 300 запросов с уникальными невалидными cookie: `getSessionCalls = 300`, 60 ответов `401`, 240 ответов `429` (FAIL — все 300 запросов били в session store / БД).

---

## 2. Внесённые изменения

### 2.1. `src/lib/rate-limiter.ts` (`SlidingWindowRateLimiter`)
Добавлены методы для разделения проверки и списания квоты:
1. `peek(key: string)` — read-only инспекция скользящего окна. Возвращает `{ allowed, remaining, resetInMs }` без добавления timestamp и без модификации состояния.
2. `assertCanAttempt(key: string)` — read-only проверка: выбрасывает `RateLimitError` (429), если квота клиента уже исчерпана, не изменяя счётчики.
3. `consume(key: string)` — явное списание одного токена (вызов `check(key)`).
4. `assertAllowed(key: string)` сохранён в неизменном виде для остальных вызывающих модулей в проекте.

### 2.2. `src/lib/auth/auth-guard.ts` (`requireAuthenticatedUser`)
Перестроен порядок выполнения шагов аутентификации и лимитирования:
1. **CSRF Guard** (первым для POST/PUT/DELETE/PATCH).
2. **Pre-auth read-only check**: `preAuthRateLimiter.assertCanAttempt(preAuthKey)`. Выполняется **до** любого обращения к session store или базе данных. Если квота попыток для данного IP исчерпана, запрос немедленно прерывается с `429 RateLimitError` (0 обращений к БД).
3. **Проверка наличия cookie**:
   - Если cookie отсутствует: `preAuthRateLimiter.consume(preAuthKey)` (списание попытки) и выброс `401 UnauthorizedError` (0 обращений к БД).
4. **Обращение к session store**: `getSessionFromRequest(req)`.
   - Если сессия не найдена / невалидна / истекла: `preAuthRateLimiter.consume(preAuthKey)` (списание попытки) и выброс `401 UnauthorizedError`.
5. **Валидная сессия**: возврат `sessionUser` **без** списания токенов `preAuthRateLimiter`.

---

## 3. Изменённые файлы

1. `src/lib/rate-limiter.ts` — добавлены методы `peek`, `assertCanAttempt`, `consume`.
2. `src/lib/auth/auth-guard.ts` — pre-auth `assertCanAttempt` вынесен перед обращением к `getSessionFromRequest`, списание `consume` только при failed auth.
3. `tests/pre-auth-rate-limit.test.ts` — тесты обновлены для проверки 300 запросов, строгого ограничения обращений к session store (`<= 60`), и валидации ненарушения квоты активного пользователя.

---

## 4. Фактически выполненные проверки

1. **Unit & Integration Tests (vitest):**
   ```text
   npm test
   ```
   **Результат:** `59 passed (59), 343 passed (343)`
   - 300 запросов без cookie: `getSessionCalls === 0`, 60x 401, 240x 429.
   - 300 запросов с уникальными невалидными cookie: `getSessionCalls === 60` (`<= 60`), 60x 401, 240x 429.
   - 100 запросов активного аутентифицированного пользователя: 100x 200 OK, `preAuthRateLimiter.peek` remaining = 60 (0 токенов pre-auth потрачено).
   - Все 8 защищённых эндпоинтов блокируют доступ до БД при исчерпании лимита.
   - User-scoped изоляция сохранена.

2. **Linter:**
   ```text
   npm run lint
   ```
   **Результат:** `0 errors, 6 warnings` (чисто, только стандартные next/image warnings).

3. **TypeScript typecheck:**
   ```text
   npx tsc --noEmit
   ```
   **Результат:** `exit 0` (0 ошибок).

4. **Production build:**
   ```text
   npm run build
   ```
   **Результат:** `Compiled successfully in 50s`, static pages generated, `exit 0`.

---

## 5. Security & Invariant Check

- **AGENTS.md §1 & §11:** Алгоритмы жеребьёвки, доказательства, канонический хэш и VK-инварианты не изменялись.
- **CSRF First:** CSRF origin validation выполняется первым шагом.
- **Quota & DB Protection:** При флуде невалидными сессионными куками обращение к базе данных строго ограничено 60 вызовами за скользящее окно (1 минута).
- **Legitimate Organizer Protection:** Активные аутентифицированные пользователи не расходуют pre-auth токены и изолированы по `sessionUser.id`.
