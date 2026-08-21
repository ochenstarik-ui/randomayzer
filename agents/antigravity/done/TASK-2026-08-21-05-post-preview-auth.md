# Task 05: Auth & CSRF на POST /api/posts/preview Report

**Date:** 2026-08-21  
**Base Commit SHA:** `4b8c6b10395452a3fd1ff7ea4eb919289b66f33f`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Устранены уязвимости безопасности на маршруте `POST /api/posts/preview`:
1. **CSRF Guard (`validateCsrfOrigin`):** Защищает маршрут от Cross-Site Request Forgery атак. Кросс-сайтовые запросы с чужих доменов (`Origin`, `Referer`, `Sec-Fetch-Site: cross-site`) немедленно отвергаются со статусом `403 Forbidden`.
2. **Политика доступа и защита от Open Proxy:** 
   - Аутентифицированные организаторы используют изолированный лимитер `post-preview:user:${sessionUser.id}` и передают `organizerId` для безопасного зондирования закрытых постов.
   - Анонимные запросы ограничены строгим лимитером `expensiveApiRateLimiter` (`post-preview:anon:${clientIp}` — 15 запросов / 10 с), что полностью блокирует вектор исчерпания серверной квоты VK API и предотвращает использование эндпоинта как открытого прокси.
3. **Сохранение правдивости Effective Capabilities:** `resolveEffectiveCapabilities` по-прежнему рассчитывается исключительно от фактически использованного типа авторизации `post.resolvedAuthType` (инвариант Phase 2.3.1).
4. **UI Обработка Ошибок:** В `handleFetchPost` (`src/app/giveaways/new/page.tsx`) добавлена понятная обработка `401 Unauthorized` с предложением авторизоваться через VK ID.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/app/api/posts/preview/route.ts` | API Route | Добавлена валидация `validateCsrfOrigin(req)` и строгий лимитер `expensiveApiRateLimiter` для анонимов. |
| `src/app/giveaways/new/page.tsx` | UI | Улучшена обработка ошибок 401 в `handleFetchPost`. |
| `tests/post-preview-guard.test.ts` | Tests (NEW) | Набор тестов (5 тестов) на CSRF, Sec-Fetch-Site, строгий анонимный лимит, capabilities и отсутствие утечки `VK_SERVICE_TOKEN`. |
| `tests/rate-limit-identity.test.ts` | Tests | Обновлены тесты изоляции пользовательских лимитов и валидации IP через `TRUST_PROXY=true`. |

---

## 3. Architecture & Security Invariants

- **Zero Token Leakage:** Серверный `VK_SERVICE_TOKEN` и приватные организаторские токены ни при каких обстоятельствах не попадают в тело ответа.
- **Fail-Closed CSRF:** Любой запрос с несовпадающим `Origin` блокируется до вызова VK API.
- **Quota Protection:** Невозможно истощить квоту приложения анонимными запросами благодаря строгому ограничению IP.

---

## 4. Verification Evidence & Test Gate

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (0 ошибок типизации)
npm test             -> EXIT 0 (53 тестовых файла, 311 тестов прошли успешно)
npm run lint         -> EXIT 0 (0 ошибок, 6 warnings на no-img-element)
npm run build        -> EXIT 0 (Все 16 маршрутов скомпилированы успешно)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
