# Phase 2.4 — Seed Pre-Commit Gate Report (Eliminating Seed Grinding)

**Date:** 2026-08-20  
**Base Commit SHA:** `9927e74421223135a170de640255803ab513fd48`  
**Result Commit SHA:** `78151572bd2ae01645d70a0768c6ece517e2cab0`  
**Status:** IMPLEMENTED / READY FOR INDEPENDENT RE-REVIEW  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Закрыта критическая уязвимость манипуляции результатами розыгрышей (**Seed Grinding / Pre-computation attack**), при которой организатор мог локально перебрать seed'ы на открытом списке участников и передать в `POST /api/giveaways/[id]/draw` подобранный seed, гарантирующий победу нужного участника при успешном статусе верификации `verified: true`.

Реализована схема **Cryptographic Seed Pre-Commitment**:
1. Клиентский `seed` полностью исключён из входных схем (`createGiveawaySchema`, `executeDrawSchema`). Попытка передать `seed` в теле запроса `POST /draw` строго отклоняется со статусом `400 VALIDATION_ERROR`.
2. Seed генерируется на сервере исключительно через CSPRNG (`generateCryptoSecureSeed()`) в момент создания и блокировки неизменяемого слепка участников (`createAndLockSnapshot`) и сохраняется в БД (`Giveaway.seed`) в единой атомарной операции.
3. До момента проведения жеребьёвки (`DRAWN`) открытый `seed` скрыт от клиента во всех эндпоинтах (`POST /api/giveaways/[id]/snapshot`, `GET /api/giveaways/[id]`, `GET /api/giveaways`, `GET /api/giveaways/[id]/participants`). Клиенту отдаётся только криптографическое обязательство `seedCommitment = sha256(seed)`.
4. Роут жеребьёвки `POST /api/giveaways/[id]/draw` читает seed строго из базы данных (`giveaway.seed`). Любой fallback на генерацию seed в роуте жеребьёвки удалён. Если seed отсутствует — возвращается `409 CONFLICT`.
5. После завершения жеребьёвки `seed` раскрывается публично (`giveaway.seed` и `drawResult.seedUsed`), позволяя любому участнику подтвердить равенство `sha256(drawResult.seedUsed) === seedCommitment` и математическую честность через независимый `GET /api/giveaways/[id]/verify`.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/core/randomizer/hasher.ts` | Core | Добавлена функция `computeSeedCommitment(seed: string): string` (SHA-256 hex digest). |
| `src/core/validation/giveaway-schemas.ts` | Validation | Удалено поле `seed` из `createGiveawaySchema` и `executeDrawSchema` (строгая `.strict()` валидация на draw). |
| `src/lib/repository/giveaway-repository.ts` | Repository | Добавлено поле `seedCommitment?: string \| null` в `GiveawayWithRelations`, удален `seed` из `CreateGiveawayInput`. |
| `src/lib/repository/memory-repository.ts` | Storage Driver | Инициализация `seed: null`, генерация и фиксация `seed` + `seedCommitment` в `createAndLockSnapshot`. |
| `src/lib/repository/prisma-repository.ts` | Storage Driver | Фиксация `seed` в БД внутри `$transaction` при `createAndLockSnapshot`, маппинг `seedCommitment`. |
| `src/app/api/giveaways/route.ts` | API Route | Удалена передача клиентского seed при создании розыгрыша. |
| `src/app/api/giveaways/[id]/snapshot/route.ts` | API Route | Возврат `seedCommitment` вместо раскрытия plaintext seed. |
| `src/app/api/giveaways/[id]/draw/route.ts` | API Route | Строгое чтение pre-committed seed из БД; `409 CONFLICT` при отсутствии; удалён fallback. |
| `src/app/api/giveaways/[id]/route.ts` | API Route | Маскирование `seed: null` до статуса `DRAWN`, отдача `seedCommitment`. |
| `src/app/giveaways/new/page.tsx` | Frontend UI | Удалено поле ручного ввода seed из шага 4; добавлен индикатор защиты от подбора (Seed Pre-Commitment) со значением SHA-256 commitment. |
| `tests/api-validation.test.ts` | Tests | Обновлены тесты валидации на строгое отклонение `seed`. |
| `tests/seed-precommit-gate.test.ts` | Tests (NEW) | Комплексный adversarial & regression test suite (7 тестов). |
| `tests/storage-driver.test.ts` | Tests | Исправлен мок `IGiveawayRepository` (добавлены `listGiveawaysSummary` и `getParticipantsPaginated`). |

---

## 3. Core Cryptographic Invariants Preserved

Ни один из базовых криптографических алгоритмов НЕ изменялся:
- `HMAC_SHA256_FY_V1`
- `DeterministicHmacStream`
- `executeDeterministicDrawV1`
- `computeParticipantsSnapshotHash`
- `computeConditionsHash`
- `computeDeterministicProofHash`
- `computeAuditEventHash`
- `verifyDrawResult`

---

## 4. API Contract & Database Migration

- **Database Migration Required:** `NO` (Поле `Giveaway.seed` уже существует в `prisma/schema.prisma` как nullable `String?` и готово к сохранению CSPRNG seed).
- **API Contract Changes:**
  - `POST /api/giveaways`: поле `seed` удалено из входящего тела (автоматически отбрасывается `.strip()`).
  - `POST /api/giveaways/[id]/draw`: поле `seed` строго запрещено в теле запроса (`.strict()`), возвращает `400 VALIDATION_ERROR` при попытке передачи.
  - `POST /api/giveaways/[id]/snapshot`: в ответ добавлено поле `seedCommitment: string` (SHA-256 hex от сгенерированного seed).
  - `GET /api/giveaways/[id]`: в объекте `giveaway` возвращается `seedCommitment: string | null`. До статуса `DRAWN` поле `giveaway.seed` маскируется (`null`), после проведения розыгрыша раскрывается исходный `seed`.
  - `GET /api/giveaways`: поле `seed` отсутствует в `GiveawaySummary` и не утекает в списках.

---

## 5. Verification Evidence & Test Gate

Фактически выполненные команды:

```text
npx prisma generate  -> Exit code 0 (Prisma Client v5.22.0 generated)
npm test             -> Exit code 0 (49 test files, 284 tests passed, 0 failed)
npm run lint         -> Exit code 0 (Next.js ESLint passed clean)
npm run build        -> Exit code 0 (Next.js production build compiled successfully)
npx tsc --noEmit     -> Exit code 0 (Clean TypeScript check)
```

### Regression Tests Summary (`tests/seed-precommit-gate.test.ts`):
- `adversarial attempt to pass custom seed in draw body fails with 400 and keeps status SNAPSHOT_LOCKED` → **PASS**
- `grinding regression: local brute-force of 100 seeds cannot alter the pre-committed API winner` → **PASS**
- `draw attempt on giveaway without locked snapshot and seed returns 409 Conflict` → **PASS**
- `GET /api/giveaways/[id] masks seed before DRAWN and exposes seedCommitment` → **PASS**
- `after DRAWN, sha256(seedUsed) strictly equals seedCommitment and verify endpoint succeeds` → **PASS**
- `MemoryGiveawayRepository generates and locks seed during createAndLockSnapshot` → **PASS**
- `PrismaGiveawayRepository maps seedCommitment correctly` → **PASS**

---

## 6. UNVERIFIED Assertions & Tech Debt

1. **UNVERIFIED: Prisma integration harness with live DB:**
   - В текущем тестовом сьюте все функциональные тесты выполняются с драйвером `STORAGE_DRIVER=memory`. Хотя `PrismaGiveawayRepository` полностью реализован, компилируется (`tsc --noEmit`), собирается (`npm run build`) и покрыт маппинг-тестами, его сквозное выполнение в интеграционном тесте с реальной БД PostgreSQL не автоматизировано в Vitest.
   - **Рекомендация / Proposed Next Task:** Добавить тестовый сьют `tests/prisma-integration.test.ts` для запуска прогона репозитория против тестового экземпляра PostgreSQL.

2. **CRITICAL Finding Status:**
   - Исполнитель не объявляет CRITICAL finding автоматически закрытым самостоятельно. Требуется независимое re-review ревизии.
