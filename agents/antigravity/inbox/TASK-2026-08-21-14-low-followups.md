# Task 14: Два LOW-хвоста из ревью 9061488

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** LOW  
**Date:** 2026-08-21  
**Base SHA:** `6510ea2a048aa9bbeec5af8d80e61a420f32c471`

## Проблемы
1. **`excludeDuplicateComments` на входе API (`filterRulesSchema`)**:
   - `src/core/validation/giveaway-schemas.ts` по-прежнему объявляет `excludeDuplicateComments: z.boolean().optional()`.
   - Если внешний API-клиент передаст этот флаг, он попадет в `filterRulesSnapshot` и в `computeConditionsHash`, изменив хеш условий для нового розыгрыша, хотя фактически на фильтрацию не влияет.
   - Необходимо удалить поле из `filterRulesSchema` (или отбрасывать/валидировать), сохранив чтение legacy-снапшотов в `computeConditionsHash` и `verifyDrawResult`.
2. **`node-version: 20` в `.github/workflows/ci.yml`**:
   - Обновить версию Node.js в CI до актуальной активной LTS (Node 22 / 24) с сохранением поддержки `engines.node >= 20.9.0`.

## Scope
1. Схема `filterRulesSchema`:
   - Удалить `excludeDuplicateComments` из `filterRulesSchema` (так как схемы используют `.strict()`, передача этого поля будет отвергаться с 400 ValidationError, либо при strip отбрасываться без записи в БД).
   - Сохранить в `FilterRules` тип `excludeDuplicateComments?: boolean` (deprecated) для совместимости со старыми записями в БД.
   - Проверить, что `computeConditionsHash` по-прежнему поддерживает legacy-снапшоты с этим полем.
2. CI Workflow `.github/workflows/ci.yml`:
   - Обновить `node-version: 22` (текущая Active LTS).
3. Дополнить `tests/duplicate-comments-rule.test.ts`.
4. Verification gate & Report.
