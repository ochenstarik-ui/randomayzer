# Task 02: Client Identity for Rate Limiting Report

**Date:** 2026-08-21  
**Base Commit SHA:** `92f6d1922500791ef221cc11ed63f606afc01b53`  
**Status:** IMPLEMENTED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Устранена проблема совместного использования одного общего bucket (`'direct-client'`) в механизме rate limiting при неизвестном IP (`req.ip` пуст и `TRUST_PROXY !== 'true'`), из-за которой в дефолтной конфигурации self-hosted `next start` один пользователь мог заблокировать всех остальных организаторов (выдав `429 Too Many Requests`).

Реализована модель **User-Scoped & Role-Isolated Rate Limiting**:
1. Для аутентифицированных маршрутов (`/api/giveaways*`) ключ лимита формируется строго на основе доверенного серверного идентификатора организатора `sessionUser.id`:
   - `draw-execute:${sessionUser.id}:${id}`
   - `snapshot-lock:${sessionUser.id}:${id}`
   - `participants-import:${sessionUser.id}:${id}`
   - `participants-get:${sessionUser.id}`
   - `giveaway-get:${sessionUser.id}`
   - `giveaways-list:${sessionUser.id}`
   - `giveaway-create:${sessionUser.id}`
2. **Порядок вызовов**: аутентификация и проверка владения (`requireAuthenticatedUser` / `requireGiveawayOwner`) теперь выполняются **до** вызова рейт-лимитера. Неаутентифицированные запросы сразу отклоняются со статусом `401 Unauthorized` и не имеют возможности исчерпать или затронуть квоту организатора.
3. Для гибридного эндпоинта `POST /api/posts/preview`: при наличии активной сессии используется ключ `post-preview:user:${sessionUser.id}`, а для анонимных пользователей — `post-preview:anon:${clientIp}`. Анонимный спам не блокирует авторизованных пользователей.
4. В `src/lib/client-ip.ts` добавлен однократный `[SECURITY CONFIGURATION WARNING]` в production, если `TRUST_PROXY !== 'true'` и `req.ip` пуст. Поведение задокументировано в `docs/PRODUCTION_GUARDS.md`.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/lib/client-ip.ts` | Security | Добавлено предупреждение в production при отсутствии `TRUST_PROXY` и пустом `req.ip`. |
| `src/app/api/giveaways/[id]/draw/route.ts` | API Route | Перенесён вызов `requireGiveawayOwner` перед лимитером; ключ лимита `draw-execute:${sessionUser.id}:${id}`. |
| `src/app/api/giveaways/[id]/snapshot/route.ts` | API Route | Перенесён вызов `requireGiveawayOwner` перед лимитером; ключ лимита `snapshot-lock:${sessionUser.id}:${id}`. |
| `src/app/api/giveaways/[id]/participants/route.ts` | API Route | Аутентификация перед лимитером; ключи `participants-get:${sessionUser.id}` и `participants-import:${sessionUser.id}:${id}`. |
| `src/app/api/giveaways/[id]/route.ts` | API Route | Аутентификация перед лимитером; ключ `giveaway-get:${sessionUser.id}`. |
| `src/app/api/giveaways/route.ts` | API Route | Аутентификация перед лимитером; ключи `giveaways-list:${sessionUser.id}` и `giveaway-create:${sessionUser.id}`. |
| `src/app/api/posts/preview/route.ts` | API Route | Разделение ключей на `post-preview:user:${sessionUser.id}` и `post-preview:anon:${clientIp}`. |
| `docs/PRODUCTION_GUARDS.md` | Docs | Обновлен раздел 2 (Client Identity Scoping Architecture, Trust Proxy Modes). |
| `tests/rate-limit-identity.test.ts` | Tests (NEW) | Набор тестов изоляции лимитов организаторов, анонимных пользователей и защиты от обхода (5 тестов). |

---

## 3. Verification Evidence & Test Gate

Фактически выполненные команды:

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (Clean TypeScript check, 0 errors)
npm test             -> EXIT 0 (51 test files, 300 tests passed, 0 failed)
npm run lint         -> EXIT 0 (Next.js ESLint passed clean)
npm run build        -> EXIT 0 (Next.js production build compiled successfully)
```

### Summary of New Tests (`tests/rate-limit-identity.test.ts`):
- `two distinct organizers with empty req.ip have independent draw rate limits` → **PASS**
- `organizer listing rate limit is scoped by sessionUser.id` → **PASS**
- `exhausting anonymous rate limit on post preview does not block authenticated organizers` → **PASS**
- `unauthenticated request fails with 401 without affecting organizer rate limit bucket` → **PASS**
- `uses validated client IP for anonymous endpoints when TRUST_PROXY=true` → **PASS**

---

## 4. Core Invariants & Security

- **Randomizer / Audit Proof Invariants:** Алгоритмы `HMAC_SHA256_FY_V1`, `executeDeterministicDrawV1`, `verifyDrawResult` сохранены без изменений.
- **Fail-Closed Authorization:** Любой неаутентифицированный или cross-tenant запрос отклоняется `401`/`403` до изменения счётчиков лимитера.
- **Proxy Header Integrity:** При `TRUST_PROXY !== 'true'` клиентские заголовки `X-Forwarded-For` по-прежнему строго игнорируются во избежание IP-spoofing.

---

## 5. UNVERIFIED Assertions & Tech Debt

1. **UNVERIFIED: Distributed Edge / Redis Rate Limiter:**
   - В текущей реализации лимитер остаётся in-memory (`SlidingWindowRateLimiter`). Для горизонтально масштабируемых кластеров рекомендуется подключение Redis/Valkey или edge-уровня (Cloudflare Rate Limiting).
