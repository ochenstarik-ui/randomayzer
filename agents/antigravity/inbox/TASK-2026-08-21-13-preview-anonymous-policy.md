# Task 13: Политика анонимного доступа к POST /api/posts/preview

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (security / quota protection / UX consistency)  
**Date:** 2026-08-21  
**Base SHA:** `76ab7d0e77d06cbc31b66fc5c0cdd80282d7f496`

## Проблема
Анонимный доступ к `POST /api/posts/preview` создает риски истощения квоты `VK_SERVICE_TOKEN` через пул IP-адресов либо взаимную блокировку анонимных пользователей на ключе `direct-client`. При этом весь визард создания розыгрыша (`POST /api/giveaways` и последующие шаги) жестко требует авторизации через VK ID (`requireAuthenticatedUser`), поэтому анонимный доступ к превью не обслуживает завершаемый пользовательский сценарий.

## Scope
1. Реализовать **Вариант A (рекомендуемый)**:
   - Закрыть `POST /api/posts/preview` за `requireAuthenticatedUser(req)`.
   - Анонимные запросы получают `401 Unauthorized` с внятным сообщением о необходимости войти через VK ID.
   - Запросы без авторизации не доходят до VK API / провайдера (защита квоты приложения).
   - Лимитирование становится строго user-scoped (`generalApiRateLimiter.assertAllowed('post-preview:user:' + sessionUser.id)`).
2. Обновить тесты:
   - Создать `tests/preview-quota-policy.test.ts` (проверка `requireAuthenticatedUser`, 0 вызовов VK провайдера для неавторизованных запросов, успешная работа для авторизованных пользователей).
   - Обновить `tests/post-preview-guard.test.ts`, `tests/security.test.ts`, `tests/rate-limit-identity.test.ts` с явным объяснением перехода на обязательную аутентификацию.
3. Документировать исправление в отчете `agents/antigravity/done/TASK-2026-08-21-13-preview-anonymous-policy.md`.
4. Полный верификационный гейт.
