# Task 06: Публичная проверяемость розыгрыша Report

**Date:** 2026-08-21  
**Base Commit SHA:** `1a27a10847fe510f0ed0f128087271f78a489c7b`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Реализована архитектура публичной проверяемости результатов розыгрыша для участников и внешних наблюдателей без раскрытия персональных данных третьих лиц:

1. **Публичный API-эндпоинт (`GET /api/giveaways/[id]/public`):**
   - Доступен без аутентификации, защищен rate limiter'ом `expensiveApiRateLimiter` (`giveaway-public-get:${clientIp}:${id}`).
   - Возвращает метаданные публикации, условия отбора, хеш слепка `participantsSnapshotHash`, хеш условий `conditionsHash`, `algorithmVersion`.
   - **`seedCommitment`:** публично доступен **и до, и после** розыгрыша.
   - **`seed`:** строго скрыт (`null`) до завершения жеребьевки (`SNAPSHOT_LOCKED`), раскрывается только в статусе `DRAWN`/`PUBLISHED`.
   - **Защита PII:** полные списки участников (`participants`, `eligibleParticipants`, `excludedParticipants`) исключены из публичного ответа. Публикуются только победители (имя, аватар, ID).
   - Токены, учетные данные и `organizerId` исключены из ответа.

2. **Публичная страница розыгрыша (`src/app/giveaways/[id]/page.tsx`):**
   - Переведена на получение данных через `/api/giveaways/[id]/public`.
   - Открывается анонимным пользователям без необходимости авторизации через VK ID.
   - Отображает карточки победителей, хеш сида `Seed Commitment (SHA-256)`, `deterministicProofHash`, `auditEventHash` и кнопку онлайн-верификации (`/api/giveaways/[id]/verify`).

3. **UI Визарда (Шаг 4):**
   - Добавлена кнопка быстрого копирования `seedCommitment` в буфер обмена для публикации организатором в комментариях к посту до запуска розыгрыша.

4. **Документация (`README.md`, `docs/ARCHITECTURE.md`):**
   - Честно зафиксированы границы проверяемости и компромисс защиты приватности (PII).

---

## 2. Границы публичной проверяемости (Provably Fair Scope & Privacy Compromise)

### Что может независимо проверить любой внешний наблюдатель:
1. **Защита от Seed Grinding:** совпадение $\text{SHA256}(\text{seed}) == \text{SeedCommitment}$ гарантирует, что случайное число было сгенерировано и зафиксировано на этапе создания слепка до жеребьевки, а не подбиралось организатором под конкретных победителей.
2. **Воспроизводимость алгоритма:** соответствие вычислений стандарту `HMAC_SHA256_FY_V1`.
3. **Целостность доказательства:** совпадение `deterministicProofHash` и `auditEventHash`.

### Что остаётся непроверяемым внешним наблюдателем (и почему):
1. **Вычисление `participantsSnapshotHash` с нуля:** без полного списка участников сторонний наблюдатель не может самостоятельно пересчитать хеш слепка участников. Список участников намеренно не отдаётся анонимам ради защиты персональных данных третьих лиц (PII).
2. **Внешний якорь времени:** доказательство фиксируется в базе данных Randomayzer. Внешний децентрализованный якорь (блокчейн, drand beacon, RFC 3161) на текущем этапе отсутствует.

---

## 3. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/app/api/giveaways/[id]/public/route.ts` | API Route (NEW) | Публичный маршрут с отдачей данных розыгрыша без PII и с защитой сида до жеребьевки. |
| `src/app/giveaways/[id]/page.tsx` | UI | Перевод страницы на `/api/giveaways/[id]/public` и отображение `seedCommitment`. |
| `src/app/giveaways/new/page.tsx` | UI | Кнопка копирования `seedCommitment` на шаге 4 визарда. |
| `docs/ARCHITECTURE.md` | Docs | Обновлен раздел механизма честности и границ проверяемости. |
| `README.md` | Docs | Описаны возможности публичной проверки и Seed Pre-Commitment. |
| `tests/public-verification.test.ts` | Tests (NEW) | Тесты публичного эндпоинта (5 тестов): доступ анонимов, маскирование seed, проверка commitment, защита 401 на приватном маршруте, отсутствие PII. |

---

## 4. Verification Evidence & Test Gate

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (0 ошибок типизации)
npm test             -> EXIT 0 (54 тестовых файла, 316 тестов прошли успешно)
npm run lint         -> EXIT 0 (0 ошибок, 6 warnings на no-img-element)
npm run build        -> EXIT 0 (Все 17 маршрутов скомпилированы успешно)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
