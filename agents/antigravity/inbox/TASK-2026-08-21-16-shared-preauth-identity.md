# Task 16: Общий pre-auth ключ блокирует легальных пользователей

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (доступность)  
**Date:** 2026-08-21  
**Base SHA:** `ef8360bd4ba892c96fc3add1d706ce3910884edf`

## Проблема
`requireAuthenticatedUser` вызывает `preAuthRateLimiter.assertCanAttempt('pre-auth:' + clientIp)` для каждого запроса ДО проверки сессии. При пустом `req.ip` и `TRUST_PROXY !== 'true'` `resolveClientIp` возвращает `direct-client`. Если анонимный атакующий исчерпал лимит `pre-auth:direct-client` (60 запросов), следующий легальный пользователь с валидной сессией получает 429 до того, как система проверит сессию.

## Scope
1. Восстановить удалённый тест `authenticated organizer on the same IP is not blocked by another client anonymous flood` и убедиться, что он падает на base SHA.
2. Архитектурное решение проблемы:
   - Анализ вариантов A, B, C.
   - Реализация защиты от DoS на общем IP/идентичности, при этом сохраняя защиту БД от флуда невалидными cookie (<= 60 обращений к store при флуде) и защиту эндпоинтов от анонимного флуда.
3. Полный тестовый прогон: все тесты зелёные, восстановленный тест проходит, верификация чисто.
