# Task 11: Удаление мёртвого кода Report

**Date:** 2026-08-21  
**Base Commit SHA:** `1883a864023b0b10fe6674a035fbcffa7461c3c8`  
**Status:** COMPLETED / PASS  
**Assigned Agent:** Antigravity (Implementation Orchestrator)

---

## 1. Executive Summary

Проведена чистка мертвого и дублирующего кода, устранен технический долг без изменения боевых инвариантов:

1. **Удален неиспользуемый импорт:**
   - `generateCryptoSecureSeed` удален из `src/app/api/giveaways/[id]/draw/route.ts`.
2. **Ликвидация дублирующей фабрики `ProviderRegistry` (`src/providers/registry.ts`):**
   - Файл `src/providers/registry.ts` удален.
   - Метод `getProvider(platform)` перенесен в каноническую фабрику `ProviderFactory` (`src/providers/factory.ts`), реализующую строгий fail-closed контроль наличия `VK_SERVICE_TOKEN` в production.
   - Все тестовые вызовы (`tests/concurrency.test.ts`, `tests/payload-summary-regression.test.ts`, `tests/winner-count-contract.test.ts`, `tests/security.test.ts`) и документация `docs/ARCHITECTURE.md` переведены на `ProviderFactory`.
3. **Объединение валидации возможностей провайдера (`validateProviderCapabilities`):**
   - Проверка `requireSubscription` перенесена в канонический валидатор `validateProviderCapabilities` (`src/core/validation/giveaway-schemas.ts`).
   - Дублирующий модуль `src/core/filtering/rule-validation.ts` удален.
   - Тестовый набор `tests/provider-capabilities.test.ts` перенастроен на тестирование `validateProviderCapabilities` (все 11 тестов успешны).
4. **Удаление `GiveawayStore.listAll` (`src/lib/giveaway-store.ts`):**
   - Неиспользуемый метод `listAll` удален из класса `GiveawayStore`.
5. **Упрощение `getOAuthClient()` (`src/integrations/vk/vk-oauth-client.ts`):**
   - Удалены избыточные тождественные ветви `if/else`, возвращавшие одну и ту же переменную `defaultVkOAuthClient`.
6. **Сохранение статусов FSM (`DRAFT`, `FETCHING`, `PUBLISHED`, `CANCELLED`):**
   - Статусы сохранены в `GiveawayStatusType` и таблице переходов FSM согласно контракту (являются заделом под фичи публикации итогов в группу VK и отмены конкурса).

---

## 2. Modified & Deleted Files

| File | Status | Description |
|------|--------|-------------|
| `src/core/filtering/rule-validation.ts` | DELETED | Удален дублирующий валидатор правил. |
| `src/providers/registry.ts` | DELETED | Удалена неконсистентная фабрика `ProviderRegistry`. |
| `src/app/api/giveaways/[id]/draw/route.ts` | MODIFIED | Удален неиспользуемый импорт `generateCryptoSecureSeed`. |
| `src/providers/factory.ts` | MODIFIED | Добавлен метод `getProvider(platform: PlatformType)` с fail-fast проверкой неподдерживаемых платформ. |
| `src/core/validation/giveaway-schemas.ts` | MODIFIED | В `validateProviderCapabilities` добавлена проверка `requireSubscription`. |
| `src/lib/giveaway-store.ts` | MODIFIED | Удален неиспользуемый метод `listAll`. |
| `src/integrations/vk/vk-oauth-client.ts` | MODIFIED | Упрощена функция `getOAuthClient()`. |
| `tests/provider-capabilities.test.ts` | MODIFIED | Переведен на `validateProviderCapabilities` и `ProviderFactory`. |
| `tests/concurrency.test.ts` | MODIFIED | Удален импорт и вызовы `ProviderRegistry`. |
| `tests/payload-summary-regression.test.ts` | MODIFIED | Удален импорт и вызовы `ProviderRegistry`. |
| `tests/winner-count-contract.test.ts` | MODIFIED | Удален импорт и вызовы `ProviderRegistry`. |
| `tests/security.test.ts` | MODIFIED | Переведен на `ProviderFactory`. |
| `docs/ARCHITECTURE.md` | MODIFIED | Обновлена ссылка на `ProviderFactory`. |

---

## 3. Предложение следующей задачи (FSM Statuses Lifecycle)

Статусы `DRAFT`, `FETCHING`, `PUBLISHED`, `CANCELLED` сохранены в `src/core/fsm/giveaway-fsm.ts`.
Рекомендуется оформить отдельную задачу на реализацию недостающих пользовательских сценариев:
1. `POST /api/giveaways/[id]/cancel` — отмена активного розыгрыша организатором с фиксацией аудиторного события (`status: 'CANCELLED'`).
2. `POST /api/giveaways/[id]/publish` — автоматическая публикация карточки с итогами и победителями на стену сообщества через VK API (`status: 'PUBLISHED'`).

---

## 4. Verification Evidence

```text
npx prisma generate  -> EXIT 0
npx tsc --noEmit     -> EXIT 0
npm test             -> EXIT 0 (57 suites, 333 tests passed)
npm run lint         -> EXIT 0 (0 errors, 6 warnings on no-img-element)
npm run build        -> EXIT 0 (All 17 routes compiled successfully)
npm audit --omit=dev -> EXIT 0 (0 vulnerabilities)
```
