# Task 04: Разблокировка SNAPSHOT_LOCKED → READY Report

**Date:** 2026-08-21  
**Base Commit SHA:** `fb6ae616285aebe4ef6ac1436cd0861664f3ba0d`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Реализован механизм безопасной и атомарной разблокировки розыгрыша (`SNAPSHOT_LOCKED → READY`), устраняющий проблему невозвратной блокировки на шаге 4 визарда.

Ключевые свойства реализации:
1. **Атомарность и защита от Seed Grinding:** При вызове разблокировки поле `giveaway.seed` и `seedCommitment` принудительно сбрасываются в `null` в рамках единой транзакции с условным переходом статуса (`updateMany where status = 'SNAPSHOT_LOCKED'`).
2. **Новый CSPRNG seed при повторной фиксации:** При повторном вызове `/api/giveaways/[id]/snapshot` генерируется новый криптостойкий seed и новый commitment SHA-256.
3. **Обоснование стратегии версионирования снапшотов:** Предыдущие записи `ParticipantSnapshot` сохраняются в базе данных, а поле `version` инкрементируется (`version = max(version) + 1`). Это оживляет версионирование и сохраняет полную историю условий розыгрыша, в то время как `drawResult` и `auditRecord` связываются исключительно с финальным `snapshotId`.
4. **Безопасность и авторизация:** Новый эндпоинт `POST /api/giveaways/[id]/unlock` защищен CSRF-guard (`validateCsrfOrigin`), проверкой владения организатором (`requireGiveawayOwner`), лимитером частоты (`expensiveApiRateLimiter`) и поддержкой `Idempotency-Key`.
5. **UI Integration:** На шаге 4 визарда добавлена кнопка возврата к шагу 3 с вызовом `/api/giveaways/[id]/unlock` и сбросом клиентского состояния commitment.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/lib/repository/giveaway-repository.ts` | Interface | Добавлен метод `unlockSnapshot(id: string): Promise<GiveawayWithRelations>`. |
| `src/lib/repository/memory-repository.ts` | Repository | Реализован `unlockSnapshot` с атомарным сбросом `seed`, `seedCommitment`, `latestSnapshot` и переходом в `READY`. |
| `src/lib/repository/prisma-repository.ts` | Repository | Реализован `unlockSnapshot` через транзакционный условный `updateMany` (`SNAPSHOT_LOCKED → READY`, `seed: null`). |
| `src/lib/giveaway-store.ts` | Store | Добавлен фасад `GiveawayStore.unlockSnapshot(id)`. |
| `src/app/api/giveaways/[id]/unlock/route.ts` | API Route (NEW) | Защищенный HTTP-эндпоинт разблокировки с CSRF, auth, rate limit и идемпотентностью. |
| `src/app/giveaways/new/page.tsx` | UI | Обработчик `handleUnlockAndReturnToStep3` и кнопка возврата с шага 4 к шагу 3. |
| `tests/snapshot-unlock.test.ts` | Tests (NEW) | 6 тестов на полный жизненный цикл, IDOR, терминальные состояния, конкурентность и идемпотентность. |
| `tests/storage-driver.test.ts` | Tests | Обновлен mock-объект `failingDbRepo` интерфейса `IGiveawayRepository`. |

---

## 3. Architecture & Security Invariants

- **Terminal State Protection:** Из статусов `DRAWN` и `PUBLISHED` разблокировка строго запрещена — возвращается `409 Conflict`.
- **Ownership (IDOR):** Запросы разблокировки чужого розыгрыша возвращают `403 Forbidden`.
- **Single Flight / Concurrency:** Конкурентные запросы разблокировки гарантируют ровно один переход `200 OK`, все остальные получают `409 Conflict`.
- **Core Randomizer Invariant:** Криптографический алгоритм `HMAC_SHA256_FY_V1` и формат proof сохранены в строгом соответствии с `AGENTS.md`.

---

## 4. Verification Evidence & Test Gate

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (Clean TypeScript check, 0 errors)
npm test             -> EXIT 0 (52 test files, 306 tests passed, 0 failed)
npm run lint         -> EXIT 0 (0 errors, 6 warnings on no-img-element)
npm run build        -> EXIT 0 (All 16 routes compiled and static pages generated)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
