# Task 16 Report: Общий pre-auth ключ не блокирует легальных пользователей

**Agent:** Antigravity  
**Priority:** MEDIUM (доступность)  
**Date:** 2026-08-21  
**Base SHA:** `ef8360bd4ba892c96fc3add1d706ce3910884edf`  
**Status:** COMPLETED & VERIFIED  

---

## 1. Проблема и анализ

В Task 15 проверка `preAuthRateLimiter.assertCanAttempt('pre-auth:' + clientIp)` выполнялась перед любым обращением к session store. В default-конфигурации (`TRUST_PROXY !== 'true'` и пустой `req.ip`), `clientIp` разрешается в `direct-client`. Если анонимный атакующий производил флуд (60 запросов без cookie или с невалидными cookie), весь лимит `pre-auth:direct-client` исчерпывался, и легальный пользователь с валидной сессией на том же общем IP получал `429 RateLimitError` на этапе pre-auth проверки до обращения к store.

### Evidence на Base SHA (`ef8360b`):
- A: 300 запросов с фейковой cookie -> `getSessionCalls = 60` (защищено заданием 15).
- B: 300 запросов без cookie -> `getSessionCalls = 0` (защищено).
- C: легальный пользователь -> остаток pre-auth квоты 60/60 (защищено).
- D: легальный ПОСЛЕ чужого флуда -> HTTP 429 (FAIL — блокировался на `pre-auth:direct-client`).

---

## 2. Архитектурное решение (Option C: Valid Session In-Memory Fast Cache)

Реализован двухуровневый механизм валидации сессий с in-memory кэшем подтверждённых сессий (`Option C`):

1. **`src/lib/auth/session.ts` (`validSessionCache`):**
   - Добавлен легковесный in-memory кэш валидных сессий (`validSessionCache`) с TTL 60 секунд.
   - При создании сессии (`createSession`) или при первом успешном чтении из базы данных (`PrismaSessionStore` / `MemorySessionStore`), валидная сессия помещается в `validSessionCache`.
   - При выходе пользователя (`destroySession`) или очистке хранилища (`clear`), сессия удаляется из кэша.
   - `getSessionFromRequest(req)` проверяет `validSessionCache` перед обращением к базе данных.

2. **`src/lib/auth/auth-guard.ts` (`requireAuthenticatedUser`):**
   - **Шаг 1 (CSRF):** Валидация origin для мутирующих запросов.
   - **Шаг 2 (Fast Path для валидных сессий):** Если у запроса есть cookie `randomayzer_session` и эта сессия уже подтверждена в `validSessionCache`, запрос **немедленно авторизуется без проверок pre-auth лимитера и без запросов к базе данных**. Легальный пользователь никогда не блокируется анонимным флудом на общем IP (`direct-client` или NAT/proxy).
   - **Шаг 3 (Pre-auth Read-Only Check для неизвестных клиентов):** Неизвестные/некэшированные запросы проверяют квоту `preAuthRateLimiter.assertCanAttempt('pre-auth:' + clientIp)`.
   - **Шаг 4 (Анонимные запросы):** Запросы без cookie списывают pre-auth токен и выбрасывают `401 Unauthorized` (0 обращений к БД).
   - **Шаг 5 (Запросы с некэшированной cookie):** Обращение к `sessionStore.getSession(sessionId)`.
     - Если сессия невалидна / истекла / фейковая: списывается pre-auth токен и выбрасывается `401 Unauthorized`. После 60 таких запросов последующие некэшированные запросы отсекаются на Шаге 3 с кодом `429` до обращения к БД.
     - Если сессия найдена в БД: она кэшируется в `validSessionCache` и возвращается.

---

## 3. Изменённые файлы

1. `src/lib/auth/session.ts` — добавлен `validSessionCache`, функции `getCachedValidSession`, `cacheValidSession`, `invalidateSessionCache`, `clearSessionCache`, хуки в `MemorySessionStore` и `PrismaSessionStore`.
2. `src/lib/auth/auth-guard.ts` — добавлен fast-path обход pre-auth лимитера для подтверждённых валидных сессий.
3. `tests/pre-auth-rate-limit.test.ts` — восстановлен удалённый тест, добавлены тесты на fake-cookie flood isolation и `TRUST_PROXY=true` isolation.
4. `agents/antigravity/inbox/TASK-2026-08-21-16-shared-preauth-identity.md` — фиксация задачи.
5. `agents/antigravity/done/TASK-2026-08-21-16-shared-preauth-identity.md` — отчёт.

---

## 4. Фактически выполненные проверки

1. **Unit & Integration Tests (vitest):**
   ```text
   npm test
   ```
   **Результат:** `59 passed (59), 346 passed (346)`
   - Восстановленный тест: `authenticated organizer on the same IP is not blocked by another client anonymous flood` (`PASS` — HTTP 200).
   - `authenticated organizer on the same IP is not blocked by another client fake-cookie flood` (`PASS` — HTTP 200).
   - `when TRUST_PROXY=true, different client IPs maintain isolated rate limit buckets` (`PASS`).
   - 300 запросов без cookie: `getSessionCalls === 0`, 60x 401, 240x 429 (`PASS`).
   - 300 запросов с уникальными невалидными cookie: `getSessionCalls === 60` (`<= 60`), 60x 401, 240x 429 (`PASS`).
   - 100 запросов активного аутентифицированного пользователя: 100x 200 OK, `preAuthRateLimiter.peek` remaining = 60 (`PASS`).
   - Все 8 защищённых эндпоинтов защищены от анонимного флуда (`PASS`).
   - User-scoped изоляция сохранена (`PASS`).

2. **Linter:**
   ```text
   npm run lint
   ```
   **Результат:** `0 errors, 6 warnings` (стандартные next/image).

3. **TypeScript typecheck:**
   ```text
   npx tsc --noEmit
   ```
   **Результат:** `exit 0` (0 ошибок).

4. **Production build:**
   ```text
   npm run build
   ```
   **Результат:** `Compiled successfully in 54s`, static pages generated, `exit 0`.
