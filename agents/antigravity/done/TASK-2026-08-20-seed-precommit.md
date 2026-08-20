# Phase 2.4 — Seed Pre-Commit Gate Report (Eliminating Seed Grinding)

**Date:** 2026-08-20  
**Base Commit SHA:** `9927e74421223135a170de640255803ab513fd48`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Закрыта критическая уязвимость манипуляции результатами розыгрышей (**Seed Grinding / Pre-computation attack**), при которой организатор мог локально перебрать seed'ы на открытом списке участников и передать в `POST /api/giveaways/[id]/draw` подобранный seed, гарантирующий победу нужного участника при успешном статусе верификации `verified: true`.

Реализована схема **Cryptographic Seed Pre-Commitment**:
1. Клиентский `seed` полностью исключён из входных схем (`createGiveawaySchema`, `executeDrawSchema`). Попытка передать `seed` в теле запроса строго отклоняется со статусом `400 VALIDATION_ERROR`.
2. Seed генерируется на сервере исключительно через CSPRNG (`crypto.randomBytes(16).toString('hex')`) в момент создания и блокировки неизменяемого слепка участников (`createAndLockSnapshot`) и сохраняется в БД (`Giveaway.seed`) в единой атомарной транзакции.
3. До момента проведения жеребьёвки (`DRAWN`) открытый `seed` скрыт от клиента во всех публичных и приватных эндпоинтах (`POST /api/giveaways/[id]/snapshot`, `GET /api/giveaways/[id]`, `GET /api/giveaways`, `GET /api/giveaways/[id]/participants`). Клиенту отдаётся только криптографическое обязательство `seedCommitment = sha256(seed)`.
4. Роут жеребьёвки `POST /api/giveaways/[id]/draw` читает seed строго из базы данных (`giveaway.seed`). Любой fallback на генерацию seed в роуте жеребьёвки удалён. Если seed отсутствует — возвращается `409 CONFLICT`.
5. После завершения жеребьёвки `seed` раскрывается публично (`giveaway.seed` и `drawResult.seedUsed`), позволяя любому участнику подтвердить равенство `sha256(drawResult.seedUsed) === seedCommitment` и математическую честность через независимый `GET /api/giveaways/[id]/verify`.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/core/randomizer/hasher.ts` | Backend | Добавлена функция `computeSeedCommitment(seed: string): string` (SHA-256 hex digest). |
| `src/core/validation/giveaway-schemas.ts` | Validation | Удалено поле `seed` из `createGiveawaySchema` и `executeDrawSchema` (строгая валидация). |
| `src/lib/repository/giveaway-repository.ts` | Repository | Добавлено поле `seedCommitment?: string \| null` в `GiveawayWithRelations`, удален `seed` из `CreateGiveawayInput`. |
| `src/lib/repository/memory-repository.ts` | Storage Driver | Инициализация `seed: null`, атомарная генерация и фиксация `seed` + `seedCommitment` в `createAndLockSnapshot`. |
| `src/lib/repository/prisma-repository.ts` | Storage Driver | Фиксация `seed` в БД внутри `$transaction` при `createAndLockSnapshot`, маппинг `seedCommitment`. |
| `src/app/api/giveaways/route.ts` | API Route | Удалена передача клиентского seed при создании розыгрыша. |
| `src/app/api/giveaways/[id]/snapshot/route.ts` | API Route | Возврат `seedCommitment` вместо раскрытия plaintext seed. |
| `src/app/api/giveaways/[id]/draw/route.ts` | API Route | Строгое чтение pre-committed seed из БД; `409 CONFLICT` при отсутствии; удалён fallback. |
| `src/app/api/giveaways/[id]/route.ts` | API Route | Маскирование `seed: null` до статуса `DRAWN`, отдача `seedCommitment`. |
| `src/app/giveaways/new/page.tsx` | Frontend UI | Удалено поле ручного ввода seed из шага 4; добавлен индикатор защиты от подбора (Seed Pre-Commitment) со значением SHA-256 commitment. |
| `tests/api-validation.test.ts` | Tests | Обновлены тесты валидации на строгое отклонение `seed`. |
| `tests/seed-precommit-gate.test.ts` | Tests (NEW) | Комплексный adversarial & regression test suite (7 тестов). |

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

## 4. Verification Evidence & Test Gate

Фактически выполненные команды:

1. `npx prisma generate` → Exit code 0 (Prisma Client v5.22.0 generated).
2. `npm test` → Exit code 0 (48 test files, 280 tests passed, 0 failed).
3. `npm run lint` → Exit code 0 (Next.js ESLint passed clean).
4. `npm run build` → Exit code 0 (Production build & static generation compiled successfully).

### Regression Tests Summary (`tests/seed-precommit-gate.test.ts`):
- `adversarial attempt to pass custom seed in draw body fails with 400 and keeps status SNAPSHOT_LOCKED` → PASS
- `grinding regression: local brute-force of 100 seeds cannot alter the pre-committed API winner` → PASS
- `draw attempt on giveaway without locked snapshot and seed returns 409 Conflict` → PASS
- `GET /api/giveaways/[id] masks seed before DRAWN and exposes seedCommitment` → PASS
- `after DRAWN, sha256(seedUsed) strictly equals seedCommitment and verify endpoint succeeds` → PASS
- `MemoryGiveawayRepository generates and locks seed during createAndLockSnapshot` → PASS
- `PrismaGiveawayRepository maps seedCommitment correctly` → PASS

---

## 5. Security & Risk Assessment

- **CRITICAL/HIGH findings:** 0 open
- **Seed Grinding Attack:** ELIMINATED & MATHEMATICALLY PREVENTED
- **IDOR / Cross-User Access:** PRESERVED (protected by session & `requireGiveawayOwner`)
- **Secrets:** 0 leaked
- **UNVERIFIED statements:** None
