# Randomayzer — Claude C-3 Final Security Verification

**Reviewed commit:** `b5467f617e061c864333b362c6b84481469de890`
**Scope:** только проверка закрытия blockers из C-2/G-4, не полный аудит.

---

## 1. Anonymous `GET /api/giveaways` — было 200+утечка, теперь?

**401.** Подтверждено кодом (`requireAuthenticatedUser(req)` вызывается до любого чтения из store) и живым тестом, который был прогнан изолированно:

```
✓ Claude PoC Reproduction: anonymous GET /api/giveaways is rejected with 401 Unauthorized
```
Тело ответа `body.giveaways` — `undefined`, ничего не утекает.

## 2. Authenticated listing — scoped на уровне repository/SQL?

**Да.** `GiveawayStore.listSummaries(organizerId)` → `listGiveawaysSummary(organizerId)`:
- Prisma: `where: organizerId ? { organizerId } : undefined` — фильтрация в самом SQL-запросе, не постфактум.
- Memory-репозиторий: тот же контракт (`listGiveaways(organizerId)` фильтрует внутри репозитория).

Живой прогон теста `tests/giveaway-listing-idor.test.ts` (5/5 passed):
- User A видит только свой giveaway, JSON ответа не содержит ни слова "Bob" / чужого URL.
- User B — симметрично.
- Пустой аккаунт → `[]`, без ошибок.
- Отдельный repository-level тест напрямую подтверждает `listGiveawaysSummary(userId)` фильтрует по `organizerId`.

## 3. Prisma migration

**Реально существует:** `prisma/migrations/20260818120000_ownership_invariant/migration.sql`.

Проверено содержимое:
- `DO $$ ... IF EXISTS (SELECT 1 FROM "Giveaway" WHERE "organizerId" IS NULL) THEN RAISE EXCEPTION ...` — миграция **абортится**, если есть legacy NULL-записи, а не назначает их случайному пользователю.
- `ALTER TABLE "Giveaway" ALTER COLUMN "organizerId" SET NOT NULL;`
- `DROP CONSTRAINT ... ADD CONSTRAINT ... FOREIGN KEY (organizerId) REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;`
- `CREATE INDEX ... ON "Giveaway"("organizerId")`.

Поведение при legacy `organizerId=NULL` соответствует требованию: миграция требует ручной data remediation, не авто-назначения.

## 4. Atomic OAuth state consumption

`MemoryOAuthTransactionStore.consumeTransaction(state)`:
```ts
const tx = this.store.get(state);
if (!tx) throw new UnauthorizedError(...);
this.store.delete(state);   // ← между get и delete нет await
```
Между `get` и `delete` нет `await` — в однопоточном event loop Node.js это гарантирует атомарность синхронного участка даже при параллельном вызове `Promise.all`.

Существующий тест `tests/oauth-concurrency.test.ts` (100 concurrent на один state) — прогнан живьём:
```
✓ 100 concurrent consumeTransaction attempts on the same state result in exactly 1 success and 99 failures
```
Ровно 1 success, 99 failures, победитель получил корректный `codeVerifier`, повторный consume после — отклонён.

## 5. Production trusted origin

- `getAppBaseUrl()` / `getVkRedirectUri()` — fail-fast `throw`, если `APP_BASE_URL`/`VK_REDIRECT_URI` отсутствуют в проде или не HTTPS. Подтверждено тестами (`origin-and-csrf-gate.test.ts`, 4 подтеста).
- `validateCsrfOrigin` в проде сравнивает `Origin`/`Referer` со строго конфигурируемым `getTrustedHost()` (из `APP_BASE_URL`), **никогда** не читает `Host` или `X-Forwarded-Host` в production-ветке кода. Grep по всем API-роутам подтверждает: `req.headers.get('host')` и `x-forwarded-host` нигде не используются для построения redirect-целей — везде используется `getAppBaseUrl()`.
- Встроенный тест: evil `Origin: https://evil.com` + спуфленный `X-Forwarded-Host: evil.com` → `CSRF origin mismatch` (throw). Passed.
- **Дополнительно написаны и прогнаны живьём** PoC-тесты сверх встроенных:
  - Только evil `Host: evil.com` (без Origin/Referer) в проде → `Missing Origin/Referer` (throw). Passed.
  - Evil `Host` + evil `X-Forwarded-Host` + evil `X-Forwarded-Proto` + evil `Origin` одновременно → `CSRF origin mismatch` (throw). Passed.

## 6. OAuth start rate limiter

`oauthStartRateLimiter` — 10 запросов/60 сек на IP. Тест: 10 запросов проходят (307), 11-й → 429 с `rate limit exceeded`. Прогнан в составе полного suite — passed.

---

## 7. Повторная проверка старых findings

| Finding | Verdict |
|---|---|
| CRITICAL-1 Broken Access Control (включая listing IDOR из C-2) | **CLOSED** |
| CRITICAL-2 TokenVault public fallback | **CLOSED** |
| HIGH missing SQL migration | **CLOSED** |
| Grok OAuth state race | **CLOSED** |

---

## 8. `npm test` / `npm run lint` / `npm run build`

- **`npm test`**: **PASS**. 42 test files, 235 tests, все зелёные (включая новые `giveaway-listing-idor.test.ts`, `origin-and-csrf-gate.test.ts`, `oauth-concurrency.test.ts`, `token-vault.test.ts`).
  ⚠️ Прогнано после ручного стаба `@prisma/client` в песочнице — сеть песочницы блокирует `binaries.prisma.sh` (403, не в allow-list), из-за чего `prisma generate` не может скачать query engine. Это ограничение среды проверки, не дефект кода — реальный CI-пайплайн репозитория (`.github/workflows/ci.yml`) выполняет `prisma generate` → `prisma db push` → `npm test` → `npm run lint` → `npm run build` с полным доступом к сети.
- **`npm run lint`**: **PASS**. 0 ошибок, только косметические warning про `<img>` вместо `next/image` (были и раньше, не новые).
- **`npm run build`**: webpack/Next.js compile-шаг прошёл (`✓ Compiled successfully`), но TypeScript type-check упал на `prisma-repository.ts` с `implicitly has an 'any' type` — проверено: это из-за того, что сгенерированный `.d.ts` в песочнице **не содержит вообще никаких упоминаний** модели `Giveaway`/`organizerId` (сгенерирован до текущей схемы, т.к. `prisma generate` ни разу не завершился успешно в этой сети). Не удалось независимо подтвердить build end-to-end из-за сетевого ограничения песочницы.

---

## 9. Финальный ответ

**Phase 2.2 security gate: PASS**

**Безопасно ли переходить к Phase 2.3: YES**

Реальных blockers из чек-листа C-2/G-4 не осталось. Единственная оговорка — `npm run build` не подтверждён end-to-end исключительно из-за сетевого ограничения проверочной песочницы (нет доступа к `binaries.prisma.sh`); тот же CI-пайплайн с полным сетевым доступом уже включает этот шаг и настроен идентично тому, что было запущено. Это не квалифицируется как security-blocker по существу проверки.

---

## Метаданные проверки

- **Reviewed commit:** `b5467f617e061c864333b362c6b84481469de890`
- **Предыдущий commit (C-2):** `02a04df2719094e28db97575b9fbecb940b6ead3`
- **Tests run:** 42 files / 235 tests passed (после локального стаба Prisma client из-за сетевого ограничения песочницы)
- **Live PoC написаны и прогнаны в рамках этой проверки:** evil Host header alone; evil Host + X-Forwarded-Host + X-Forwarded-Proto + Origin combo
- **Files inspected:** `src/app/api/giveaways/route.ts`, `src/lib/giveaway-store.ts`, `src/lib/repository/prisma-repository.ts`, `memory-repository.ts`, `prisma/migrations/20260818120000_ownership_invariant/migration.sql`, `src/lib/auth/oauth-state.ts`, `src/lib/auth/csrf-guard.ts`, `src/lib/auth/app-config.ts`, `src/app/api/auth/vk/callback/route.ts`, `src/app/api/auth/vk/start/route.ts`, тесты `giveaway-listing-idor`, `origin-and-csrf-gate`, `oauth-concurrency`, `token-vault`
