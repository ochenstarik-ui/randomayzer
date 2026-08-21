# Task 14: Два LOW-хвоста из ревью 9061488 Report

**Date:** 2026-08-21  
**Base Commit SHA:** `6510ea2a048aa9bbeec5af8d80e61a420f32c471`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Устранены два LOW-хвоста, выявленные в ходе независимого ревью:

1. **Запрет `excludeDuplicateComments` на границе API (`src/core/validation/giveaway-schemas.ts`):**
   - Поле `excludeDuplicateComments` удалено из `filterRulesSchema`.
   - Поскольку `filterRulesSchema` определена со `.strict()`, любая попытка внешнего API-клиента передать `excludeDuplicateComments` при создании розыгрыша (`POST /api/giveaways`), импорте участников (`POST /api/giveaways/[id]/participants`) или фиксации слепка (`POST /api/giveaways/[id]/snapshot`) немедленно отвергается с кодом `400 Bad Request` (`ValidationError: Unrecognized key(s) in object: 'excludeDuplicateComments'`).
   - Поле физически не может попасть в `filterRulesSnapshot` нового розыгрыша и изменить `conditionsHash`.
   - **Обратная совместимость legacy-снапшотов:** Функция `computeConditionsHash` (`src/core/randomizer/canonical.ts:46`) и верификатор `verifyDrawResult` сохраняют поддержку старых слепков, где это поле было записано до Задания 07 (`verified: true`, `conditionsIntegrity: true`).

2. **Обновление версии Node.js в CI (`.github/workflows/ci.yml`):**
   - Версия `node-version` в GitHub Actions поднята с 20 до 22 (текущая Active LTS).
   - Все шаги CI (Prisma generate/migrations, Unit/Integration tests, ESLint, Next.js build) валидированы.

---

## 2. Modified Files

| File | Status | Description |
|------|--------|-------------|
| `src/core/validation/giveaway-schemas.ts` | MODIFIED | Удалено `excludeDuplicateComments` из `filterRulesSchema`. |
| `.github/workflows/ci.yml` | MODIFIED | Обновлен `node-version: 22` в CI workflow. |
| `tests/duplicate-comments-rule.test.ts` | MODIFIED | Добавлены тесты отсечения `excludeDuplicateComments` на уровне схем Zod. |
| `tests/auth-guard.test.ts` | MODIFIED | Удалено устаревшее поле из тестовых фикстур `validPostData`. |
| `tests/security.test.ts` | MODIFIED | Удалено устаревшее поле из тестовой фикстуры. |

---

## 3. Verification Evidence

```text
npx prisma generate  -> EXIT 0 (Prisma Client v5.22.0)
npx tsc --noEmit     -> EXIT 0 (0 ошибок типизации)
npm test             -> EXIT 0 (59 тест-сьютов, 343 теста пройдены успешно)
npm run lint         -> EXIT 0 (0 ошибок, 6 warnings на no-img-element)
npm run build        -> EXIT 0 (Все 17 маршрутов скомпилированы успешно в Next.js 16.3.2)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
