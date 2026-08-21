# Task 07: excludeDuplicateComments — Семантика дедупликации и точность аудит-следа

**Date:** 2026-08-21  
**Base Commit SHA:** `8741569817f4463387c5dc3ac36c0beaedbd0663`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Устранено расхождение между поведением движка фильтрации и каноническим хешем условий розыгрыша:
1. **Семантика дедупликации (Вариант B):**
   - В ядре Randomayzer закреплена безусловная дедупликация участников: **1 пользователь = 1 шанс**.
   - Поддержка взвешенных шансов за множественные комментарии потребовала бы модификации детерминированного алгоритма жеребьёвки `executeDeterministicDrawV1` и структуры слепка, что прямо запрещено `AGENTS.md` §1 без отдельного прямого задания владельца.
   - Поле `excludeDuplicateComments` удалено из `DEFAULT_FILTER_RULES`, `filterRulesSchema` и помечено как `@deprecated optional` для обратной совместимости.

2. **Обратная совместимость `conditionsHash` и `verifyDrawResult`:**
   - В `computeConditionsHash` реализована поддержка легаси-снапшотов: если объект правил `snapshot.filterRulesSnapshot` содержит поле `excludeDuplicateComments`, оно включается в каноническую сериализацию, гарантируя точное совпадение хеша (`conditionsIntegrity: true`, `verified: true`) для всех ранее проведённых розыгрышей.
   - Для новых розыгрышей хеш вычисляется по чистому набору правил без фиктивного поля.

3. **Исправление ошибки слияния `commentsCount`:**
   - Устранена ошибка `(p.commentsCount || 1)`, из-за которой дубликат с `commentsCount: 0` (например, пришедший из списка лайков) ошибочно прибавлял 1 к счетчику комментариев.
   - Подсчет обновлен на `typeof p.commentsCount === 'number' ? p.commentsCount : (p.commented ? 1 : 0)`.

---

## 2. Modified Files

| File | Type | Description |
|------|------|-------------|
| `src/core/filtering/filter-engine.ts` | Core Domain | Исправлен подсчет `commentsCount` при слиянии дубликатов участников. |
| `src/core/types/giveaway.ts` | Core Types | `excludeDuplicateComments` помечен как `@deprecated optional`, удален из `DEFAULT_FILTER_RULES`. |
| `src/core/randomizer/canonical.ts` | Core Randomizer | `computeConditionsHash` поддерживает легаси-снапшоты с сохранением байтовой идентичности хешей. |
| `src/core/validation/giveaway-schemas.ts` | Validation | `excludeDuplicateComments` сделан опциональным, удален из `defaultRulesObject`. |
| `tests/duplicate-comments-rule.test.ts` | Tests (NEW) | Набор тестов (5 тестов): точный подсчет счетчика комментариев, безусловная дедупликация, проверка легаси и новых снапшотов. |

---

## 3. Verification Evidence & Test Gate

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (0 ошибок типизации)
npm test             -> EXIT 0 (55 тестовых файлов, 321 тест прошёл успешно)
npm run lint         -> EXIT 0 (0 ошибок, 6 warnings на no-img-element)
npm run build        -> EXIT 0 (Все 17 маршрутов скомпилированы успешно)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
