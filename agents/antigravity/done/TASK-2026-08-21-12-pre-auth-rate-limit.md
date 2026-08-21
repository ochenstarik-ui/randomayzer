# Task 12: Rate limit до аутентификации Report

**Date:** 2026-08-21  
**Base Commit SHA:** `906148813ee66f6f52d7c291f335c1ebdca2a057`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Устранена уязвимость неограниченной нагрузки на Session Store / базу данных при неаутентифицированном флуде:

1. **Pre-Authentication Rate Limiter (`src/lib/rate-limiter.ts` & `src/lib/auth/auth-guard.ts`):**
   - Экспортирован `preAuthRateLimiter` со скользящим окном 60 запросов / 60 секунд на клиентский IP (`resolveClientIp(req)`).
   - В `requireAuthenticatedUser(req)` проверка лимитера вынесена **до** обращения к Session Store (`prisma.session`):
     - Запросы без сессионной куки сразу проверяются через `preAuthRateLimiter.assertAllowed('pre-auth:' + clientIp)` без единого обращения к Session Store / БД (0 запросов в БД). При превышении лимита возвращается `429 RATE_LIMIT_EXCEEDED` вместо `401`.
     - Запросы с недействительными/поддельными куками после проверки в Session Store списывают попытку из `preAuthRateLimiter`, ограничивая максимальное число недействительных запросов к БД числом 60 в минуту.
2. **Защита аутентифицированных пользователей на общем ключе (`direct-client` / NAT):**
   - При наличии валидной сессионной куки запрос успешно аутентифицируется и **не попадает под штрафной лимит `pre-auth`**.
   - Аутентифицированный пользователь подчиняется исключительно своему изолированному `user-scoped` лимиту (`sessionUser.id`), что полностью исключает возможность DoS легальных пользователей через анонимный флуд с того же IP / `direct-client`.
3. **Оптимизация в `POST /api/posts/preview` (`src/app/api/posts/preview/route.ts`):**
   - Поиск сессии в `getSessionFromRequest` теперь вызывается только при наличии заголовка `Cookie: randomayzer_session=...`, исключая холостые вызовы при анонимных превью.
4. **Тестирование (`tests/pre-auth-rate-limit.test.ts`):**
   - Добавлено 5 всесторонних тестов, проверяющих:
     - 60 запросов без куки -> 61-й запрос возвращает `429` с кодом `RATE_LIMIT_EXCEEDED`, 0 вызовов `sessionStore.getSession`;
     - 60 запросов с фейковыми куками -> ровно 60 вызовов `sessionStore.getSession`, затем блокировка `429`;
     - Аутентифицированный пользователь на том же `direct-client` успешно выполняет запросы (`200 OK`) при исчерпанном анонимном лимите;
     - Защита всех 8 защищенных эндпоинтов (`/api/giveaways`, `/api/giveaways/[id]`, `/api/giveaways/[id]/participants`, `/api/giveaways/[id]/draw`, `/api/giveaways/[id]/snapshot`, `/api/giveaways/[id]/unlock`);
     - Сохранение изоляции user-scoped лимитов.

---

## 2. Архитектурные решения

### Почему `requireAuthenticatedUser` вместо `middleware.ts`?
1. **Совместимость с Next.js 16 и тестами:** В Next.js 16 middleware по умолчанию работает в Edge runtime, в то время как Vitest и интеграционные тесты запускают route handlers напрямую как функции. Размещение pre-auth guard внутри `requireAuthenticatedUser` гарантирует 100% покрытие во всех тестах, одинаковое поведение в dev/test/production и отсутствие накладных расходов на сериализацию между runtime-слоями.
2. **Детерминированность:** Все защищенные маршруты используют `requireAuthenticatedUser` или `requireGiveawayOwner` (который внутри вызывает `requireAuthenticatedUser`), что обеспечивает единую точку входа и невозможность обойти лимитер.

---

## 3. Modified & Created Files

| File | Status | Description |
|------|--------|-------------|
| `src/lib/rate-limiter.ts` | MODIFIED | Экспортирован `preAuthRateLimiter` (60 req / 60s). |
| `src/lib/auth/auth-guard.ts` | MODIFIED | Добавлена проверка `preAuthRateLimiter` до Session Store и для failed auth. |
| `src/app/api/posts/preview/route.ts` | MODIFIED | Пропуск `getSessionFromRequest` при отсутствии куки `SESSION_COOKIE_NAME`. |
| `tests/pre-auth-rate-limit.test.ts` | NEW | 5 тестов покрытия pre-auth лимитирования и защиты Session Store. |
| `tests/rate-limit-identity.test.ts` | MODIFIED | Сброс `preAuthRateLimiter` в `beforeEach`. |

---

## 4. Verification Evidence

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (0 ошибок типизации во всех 58 тестовых файлах и кодовой базе)
npm test             -> EXIT 0 (58 сьютов, 338 тестов пройдены успешно без БД)
npm run lint         -> EXIT 0 (0 ошибок, 6 warnings на no-img-element)
npm run build        -> EXIT 0 (Все 17 маршрутов скомпилированы успешно в Next.js 16.3.2)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
