# Task 12: Rate limit до аутентификации

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (доступность / защита Session Store)  
**Date:** 2026-08-21  
**Base SHA:** `906148813ee66f6f52d7c291f335c1ebdca2a057`

## Проблема
После перехода Session Store на базу данных (Prisma) и переноса rate limiter на user-scoped ключи (`sessionUser.id`), запросы без cookie/сессии сначала обращаются к Session Store / базе данных (в `requireAuthenticatedUser`), и только потом попадают под rate limiter. Неаутентифицированный флуд создает нелимитированную нагрузку на Session Store / БД.

## Scope
1. Ввести дешёвый pre-auth rate limit по идентичности клиента (`resolveClientIp(req)`), срабатывающий ДО обращения к session store на защищенных маршрутах.
2. Сохранить все существующие user-scoped лимиты (второй рубеж).
3. Проанализировать варианты архитектуры: pre-auth guard в хендлерах / helper vs `middleware.ts` / `requireAuthenticatedUser` / rate-limiter.
4. Написать тесты `tests/pre-auth-rate-limit.test.ts`.
5. Полный verification gate и отчет в `agents/antigravity/done/TASK-2026-08-21-12-pre-auth-rate-limit.md`.
