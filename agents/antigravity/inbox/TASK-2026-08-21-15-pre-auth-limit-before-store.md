# Task 15: Pre-auth лимит должен срабатывать ДО обращения к session store

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (доступность / защита БД)  
**Date:** 2026-08-21  
**Base SHA:** `8e39ce0cbd809b9fb1666dce09905035bc493c10`

## Проблема
При флуде запросами с невалидными/фейковыми куками (`randomayzer_session=<random>`), запрос сначала совершал обращение к Session Store (`prisma.session` / БД), и только после этого проверял лимит. Таким образом, 300 запросов с фейковыми куками совершали 300 обращений к БД, создавая неограниченную нагрузку.

## Scope
1. В `SlidingWindowRateLimiter` (`src/lib/rate-limiter.ts`):
   - Добавить read-only методы проверки лимита без списания токена:
     - `isAllowed(key: string): boolean` (или `peek(key: string): boolean`) — проверяет, не превышен ли лимит в текущем скользящем окне, не добавляя timestamp в историю.
     - `assertAllowedReadOnly(key: string): void` (или `peekAllowed(key: string): void`) — выбрасывает `RateLimitError`, если лимит уже исчерпан, без модификации состояния.
     - `consume(key: string): void` (или `charge(key: string): void` / существующий `check(key)` / `assertAllowed(key)`) — списывает токен / добавляет timestamp.
2. В `requireAuthenticatedUser` (`src/lib/auth/auth-guard.ts`):
   - **До** обращения к Session Store (независимо от наличия сессионной куки): выполнить read-only проверку `preAuthRateLimiter.assertCanAttempt('pre-auth:' + clientIp)`. Если лимит уже исчерпан — немедленно выбросить 429 `RateLimitError` без похода в Session Store / БД.
   - Если куки нет: списать токен в `preAuthRateLimiter` и выбросить 401 `UnauthorizedError`.
   - Если кука есть: обратиться в Session Store (`getSessionFromRequest(req)`).
     - Если сессия не найдена / невалидна / истекла: списать токен в `preAuthRateLimiter` и выбросить 401 `UnauthorizedError`.
     - Если сессия валидна: вернуть `sessionUser` без списания `preAuthRateLimiter` токенов.
3. Дополнить `tests/pre-auth-rate-limit.test.ts`:
   - 300 запросов с уникальными фейковыми куками -> `getSessionCalls <= 60`, остальные 240 отсекаются с кодом 429 без обращения к БД.
   - 300 запросов без кук -> `getSessionCalls === 0`.
   - Успешная аутентификация не расходует pre-auth токены.
   - User-scoped изоляция сохраняется.
