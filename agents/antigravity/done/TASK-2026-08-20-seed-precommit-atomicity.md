# Phase 2.4.1 — Atomic Snapshot + Seed Commitment Binding Report

**Date:** 2026-08-20  
**Base Commit SHA:** `78151572bd2ae01645d70a0768c6ece517e2cab0`  
**Status:** COMPLETED / READY FOR RE-REVIEW  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Problem Addressed

В ходе независимого ревью Phase 2.4 было выявлено, что:
1. `createAndLockSnapshot` в Prisma-репозитории допускал смену статуса из `READY` или `SNAPSHOT_LOCKED` (`status IN ('READY', 'SNAPSHOT_LOCKED')`), а Memory-репозиторий аналогично допускал повторную фиксацию слепков.
2. В роуте `POST /api/giveaways/[id]/snapshot` фиксация слепка и чтение `giveaway.seed` для вычисления `seedCommitment` выполнялись двумя независимыми операциями (`createAndLockSnapshot` с последующим `getById`). При конкурентных запросах блокировки это могло привести к гонке, когда ответ возвращал слепок A с хешем seed B.

---

## 2. Implemented Solutions

1. **Single Lock Invariant:**
   - Переход разрешён **только** `READY` → `SNAPSHOT_LOCKED`.
   - Любая попытка заблокировать слепок, когда статус отличен от `READY` (например, уже `SNAPSHOT_LOCKED` или `DRAWN`), немедленно возвращает `409 CONFLICT`.
   - При этом новый seed не генерируется, повторный слепок не создаётся, существующий `seedCommitment` остаётся неизменным.

2. **Atomic Return of `{ snapshot, seedCommitment }`:**
   - Интерфейс `IGiveawayRepository.createAndLockSnapshot` и класс `GiveawayStore.createAndLockSnapshot` теперь возвращают `Promise<LockedSnapshotResult>`:
     ```typescript
     export interface LockedSnapshotResult {
       snapshot: ParticipantSnapshotData;
       seedCommitment: string;
     }
     ```
   - Генерация CSPRNG seed, вычисление `seedCommitment = sha256(seed)`, сохранение seed в базе данных и создание записи `ParticipantSnapshot` выполняются строго внутри единой атомарной транзакции (в Prisma: `$transaction`; в Memory: синхронная мутация Map).

3. **Elimination of Post-Transaction Query:**
   - Роут `POST /api/giveaways/[id]/snapshot` использует `seedCommitment`, возвращённый непосредственно из атомарной операции `GiveawayStore.createAndLockSnapshot`. Дополнительный запрос `GiveawayStore.getById(id)` полностью исключён.

4. **Driver Parity (Memory & Prisma):**
   - `PrismaGiveawayRepository`: `where: { id, status: 'READY' }` внутри `$transaction`.
   - `MemoryGiveawayRepository`: строгая проверка `if (gw.status !== 'READY') throw new ConflictError(...)`.

5. **Idempotency & Commitment Stability:**
   - Повторные вызовы с одинаковым `Idempotency-Key` отдают закэшированный ответ 200 со стабильным `seedCommitment` без перегенерации seed.
   - Повторный вызов с новым ключом после фиксации слепка возвращает `409 CONFLICT`.
   - До жеребьёвки `giveaway.seed` маскируется (`null`), отдаётся только `seedCommitment`. После жеребьёвки `sha256(drawResult.seedUsed) === seedCommitment`.

---

## 3. Files Changed

| File | Type | Description |
|------|------|-------------|
| `src/lib/repository/giveaway-repository.ts` | Interface | Добавлен интерфейс `LockedSnapshotResult`, обновлена сигнатура `createAndLockSnapshot`. |
| `src/lib/giveaway-store.ts` | Store | Обновлена сигнатура `GiveawayStore.createAndLockSnapshot` (`Promise<LockedSnapshotResult>`). |
| `src/lib/repository/memory-repository.ts` | Driver | Строгий инвариант `READY` → `SNAPSHOT_LOCKED` (409 на повторы), атомарный возврат `{ snapshot, seedCommitment }`. |
| `src/lib/repository/prisma-repository.ts` | Driver | Условие `status: 'READY'` внутри `$transaction`, атомарный возврат `{ snapshot, seedCommitment }`. |
| `src/app/api/giveaways/[id]/snapshot/route.ts` | API Route | Прямое использование возвращённых `{ snapshot, seedCommitment }`, убран redundant `getById`. |
| `tests/winner-count-contract.test.ts` | Tests | Деструктуризация `{ snapshot }` из вызовов `createAndLockSnapshot`. |
| `tests/persistence.test.ts` | Tests | Деструктуризация `{ snapshot, seedCommitment }`. |
| `tests/snapshot-binding.test.ts` | Tests | Деструктуризация `{ snapshot: snapshotV1/V2 }`. |
| `tests/concurrency-draw.test.ts` | Tests | Деструктуризация `{ snapshot }`. |
| `tests/concurrency-draw-100.test.ts` | Tests | Деструктуризация `{ snapshot }`. |
| `tests/seed-precommit-gate.test.ts` | Tests | Деструктуризация `{ snapshot, seedCommitment }`, проверка равенства commitment. |
| `tests/snapshot-seed-atomicity.test.ts` | Tests (NEW) | Комплексный сьют проверки атомарности, конкуренции и стабильности commitment (4 теста). |

---

## 4. Unchanged Core Algorithms

Все алгоритмы генерации и верификации не изменялись:
- `HMAC_SHA256_FY_V1`
- `DeterministicHmacStream`
- `executeDeterministicDrawV1`
- `computeParticipantsSnapshotHash`
- `computeConditionsHash`
- `computeDeterministicProofHash`
- `computeAuditEventHash`
- `verifyDrawResult`

---

## 5. Test & Gate Results

Фактически выполненные команды:

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npm test             -> EXIT 0 (49 test files, 284 passed, 0 failed)
npm run lint         -> EXIT 0 (Clean)
npm run build        -> EXIT 0 (Next.js production build succeeded)
```

### Concurrency Test Evidence:
1. `tests/snapshot-seed-atomicity.test.ts` (4 теста):
   - `Memory repository: 20 concurrent createAndLockSnapshot calls yield exactly 1 success and 19 ConflictErrors` → **PASS**
   - `API route: concurrent snapshot lock requests with different Idempotency-Keys produce exactly 1 200 and remaining 409s` → **PASS**
   - `idempotency: replaying same key returns cached commitment; new key after lock returns 409` → **PASS**
   - `commitment stability: commitment is invariant across reads and equals sha256(seedUsed) after draw` → **PASS**
2. `tests/seed-precommit-gate.test.ts` (7 тестов) → **PASS**
3. `tests/concurrency-draw-100.test.ts` (2 теста) → **PASS**

---

## 6. Audit & Migration

- **Database migration required:** NO (поле `Giveaway.seed` уже присутствует в схеме Prisma).
- **CRITICAL/HIGH findings:** 0 open in implementation.
- **UNVERIFIED claims:** None.
- **Next step:** Передача на независимое security re-review (Grok/Claude/OpenCode).
