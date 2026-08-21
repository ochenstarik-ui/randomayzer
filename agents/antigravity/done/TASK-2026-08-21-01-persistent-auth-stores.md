# Task 01: Persistent OAuth-state & Session Store Report

**Date:** 2026-08-21  
**Base Commit SHA:** `b2888950cdd2d948c15acf0004a0cdc91eeb70e6`  
**Status:** IMPLEMENTED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Устранена проблема хранения OAuth-состояний и пользовательских сессий исключительно в памяти одного процесса Node.js (`MemoryOAuthTransactionStore` и `MemorySessionStore`), из-за которой в multi-instance / serverless среде или при перезапуске сервера происходили сбои аутентификации VK ID и сброс активных сессий пользователей.

Реализованы персистентные хранилища на базе PostgreSQL / Prisma:
1. В `prisma/schema.prisma` добавлены модели `OAuthTransaction` (с полями `state`, `codeVerifier`, `redirectTarget`, `createdAt`, `expiresAt`) и `Session` (с полями `sessionId`, `userId`, `user`, `createdAt`, `expiresAt`), а также индексы по `expiresAt` и `userId`.
2. Создана SQL-миграция `prisma/migrations/20260821120000_persistent_auth_stores/migration.sql`.
3. В `src/lib/auth/oauth-state.ts` реализован `PrismaOAuthTransactionStore` с атомарной транзакционной операцией `consumeTransaction` (`$transaction` find + delete), предотвращающей race conditions и гарантирующей single-use семантику OAuth state.
4. В `src/lib/auth/session.ts` реализован `PrismaSessionStore` со строгой валидацией TTL и каскадным удалением сессий при удалении пользователя.
5. Настроены фабрики `createOAuthTransactionStore()` и `createSessionStore()`: при `STORAGE_DRIVER=memory` или `NODE_ENV=test` используются in-memory реализации, в остальных случаях — Prisma-драйверы.
6. Снят фатальный запрет на запуск с `MULTI_INSTANCE=true` для Prisma-хранилищ.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `prisma/schema.prisma` | DB Schema | Добавлены модели `OAuthTransaction` и `Session`, добавлена связь `sessions` в модель `User`. |
| `prisma/migrations/20260821120000_persistent_auth_stores/migration.sql` | Migration | SQL-миграция создания таблиц и индексов для `OAuthTransaction` и `Session`. |
| `src/lib/auth/oauth-state.ts` | Auth | Реализован `PrismaOAuthTransactionStore`, селектор `createOAuthTransactionStore`, функции установки стора. |
| `src/lib/auth/session.ts` | Auth | Реализован `PrismaSessionStore`, селектор `createSessionStore`, функции установки стора. |
| `tests/persistent-auth-stores.test.ts` | Tests (NEW) | Набор тестов на single-use конкурентность, multi-instance обмен, TTL, жизненный цикл и селекторы драйверов (11 тестов). |

---

## 3. Database Migration & Execution Order

### SQL Migration Content:
```sql
-- CreateTable
CREATE TABLE "OAuthTransaction" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectTarget" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthTransaction_state_key" ON "OAuthTransaction"("state");

-- CreateIndex
CREATE INDEX "OAuthTransaction_expiresAt_idx" ON "OAuthTransaction"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionId_key" ON "Session"("sessionId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### Порядок применения на существующей БД:
1. Выполнить `npx prisma migrate deploy` или применить приведенный SQL-скрипт в PostgreSQL.
2. Никаких изменений существующих данных `User`, `Giveaway`, `Participant` не требуется (обратно-совместимо).

---

## 4. Verification Evidence & Test Gate

Фактически выполненные команды:

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0 generated with OAuthTransaction and Session models)
npx tsc --noEmit     -> EXIT 0 (Clean TypeScript check, 0 errors)
npm test             -> EXIT 0 (50 test suites, 295 passed, 0 failed)
npm run lint         -> EXIT 0 (Next.js ESLint passed clean)
npm run build        -> EXIT 0 (Next.js production build compiled successfully)
```

### Summary of New Tests (`tests/persistent-auth-stores.test.ts`):
- `concurrent consumeTransaction calls on same state yield exactly 1 success and N-1 UnauthorizedErrors` → **PASS**
- `state created by instance A can be consumed by instance B sharing underlying state` → **PASS**
- `expired OAuth state is rejected with UnauthorizedError` → **PASS**
- `invalidateTransaction removes state explicitly` → **PASS**
- `expired Session is rejected and returns null from getSession` → **PASS**
- `createSession, getSession and destroySession work correctly` → **PASS**
- `session survives re-creation of store instance when sharing storage` → **PASS**
- `Memory stores throw fatal error when MULTI_INSTANCE=true` → **PASS**
- `Prisma stores do NOT throw when MULTI_INSTANCE=true` → **PASS**
- `createOAuthTransactionStore selects Memory in test/memory mode, Prisma in production mode` → **PASS**
- `createSessionStore selects Memory in test/memory mode, Prisma in production mode` → **PASS**

---

## 5. Core Invariants & Security

- **Randomizer / Audit Proof Invariants:** `HMAC_SHA256_FY_V1`, `DeterministicHmacStream`, `executeDeterministicDrawV1`, `verifyDrawResult` сохранены без изменений.
- **PKCE / State Invariants:** S256 code challenge, криптостойкие случайные токены (CSPRNG) сохранены.
- **Single-Use Invariant:** Гарантируется как в памяти, так и в базе данных через атомарную транзакцию `$transaction`.

---

## 6. UNVERIFIED Assertions & Tech Debt

1. **UNVERIFIED: Live PostgreSQL CI execution for Prisma auth stores:**
   - В текущем тестовом окружении автоматизированные тесты Vitest выполняются с `STORAGE_DRIVER=memory` и `NODE_ENV=test`. Хотя `PrismaOAuthTransactionStore` и `PrismaSessionStore` скомпилированы и проверены, сквозной прогон с живой базой PostgreSQL в Vitest требует отдельного интеграционного сьюта.
