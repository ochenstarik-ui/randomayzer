# Randomayzer — Независимый повторный аудит безопасности (Claude, Phase C-2)

**Репозиторий:** https://github.com/ochenstarik-ui/randomayzer
**Проверенный commit:** `02a04df2719094e28db97575b9fbecb940b6ead3`
**Цель:** независимо перепроверить, действительно ли закрыты два ранее найденных Critical (Broken Access Control, TokenVault public fallback), не доверяя отчёту Antigravity (Phase 2.2.1 / 2.2.2).
**Метод:** клонирование репозитория, запуск тестов, чтение кода, написание и живой прогон собственного PoC-теста на реальном коде (не мок).

---

## TL;DR

| Finding | Статус |
|---|---|
| CRITICAL-1: Broken Access Control | **PARTIALLY CLOSED** — detail/mutating-эндпоинты защищены; листинг `GET /api/giveaways` открыт для анонимов |
| CRITICAL-2: TokenVault public fallback | **CLOSED** |
| Release-ready? | **Нет**, до фикса IDOR в листинге и добавления SQL-миграции |

---

## 1. Таблица маршрутов Giveaway

| Route | Method | Auth required | Ownership required | Guard | Verdict |
|---|---|---|---|---|---|
| `POST /api/giveaways` | POST | ✅ | — (создание) | `requireAuthenticatedUser` | OK |
| `GET /api/giveaways` | GET | ❌ (опционально) | ❌ не работает для анонимов | ручная фильтрация внутри route | **УЯЗВИМО** |
| `GET /api/giveaways/[id]` | GET | ✅ | ✅ | `requireGiveawayOwner` | OK |
| `POST .../participants` | POST | ✅ | ✅ | `requireGiveawayOwner` | OK |
| `GET .../participants` | GET | ✅ | ✅ | `requireGiveawayOwner` | OK |
| `POST .../snapshot` | POST | ✅ | ✅ | `requireGiveawayOwner` | OK |
| `POST .../draw` | POST | ✅ | ✅ | `requireGiveawayOwner` | OK |
| `GET .../verify` | GET | ❌ (by design) | ❌ (by design) | нет | OK — публичная верификация, токены/PII не раскрываются |
| publish / update / delete | — | — | — | — | таких routes не существует |

---

## 2. `requireGiveawayOwner` — логика верна

Файл: `src/lib/auth/auth-guard.ts`

- `organizerId == null / ""` → `ForbiddenError` (403) — **никогда не авторизует**.
- `organizerId != session.user.id` → 403.
- `organizerId == session.user.id` → pass.
- нет сессии → `UnauthorizedError` (401).

Подтверждено тестом `null organizer giveaway must NEVER authorize any user (fails with 403 Forbidden)` в `tests/auth-guard.test.ts` — прогнан живьём, 7/7 passed.

---

## 3. Создание — spoofing организатора невозможен

`POST /api/giveaways`:
```ts
const sessionUser = await requireAuthenticatedUser(req);
...
organizerId: sessionUser.id, // ignoring any client spoofing
```
Тест отправляет payload с `organizerId: "usr_fake_spoofed_id"` в теле — сервер игнорирует его и берёт ID из серверной сессии. Confirmed.

---

## 4. 🔴 Листинг — подтверждённый живым PoC IDOR

`src/app/api/giveaways/route.ts`:
```ts
const sessionUser = await getSessionFromRequest(req);
const summaries = await GiveawayStore.listSummaries();

const filteredSummaries = sessionUser
  ? summaries.filter(s => !s.organizerId || s.organizerId === sessionUser.id)
  : summaries; // ← если сессии нет — отдаётся ВСЁ
```

`GiveawayStore.listSummaries()` / `listGiveawaysSummary()` не принимает `userId` и не фильтрует на уровне репозитория (ни в Prisma-, ни в Memory-адаптере) — вся защита держится на одной строке в route-хендлере.

**Написан и выполнен независимый тест против реального кода** (не мок):

```ts
it('anonymous request sees every giveaway in the system (no session)', async () => {
  const req = new NextRequest('http://localhost:3000/api/giveaways'); // без cookie
  const res = await giveawaysList(req);
  const body = await res.json();
  expect(body.giveaways.map(g => g.title)).toContain('Victim Secret Giveaway');
});
```

Результат прогона:
```
ANONYMOUS SEES: [ 'Victim Secret Giveaway' ]
ATTACKER SEES: []   // авторизованный посторонний пользователь фильтруется корректно
```

**Вывод:** достаточно не отправить cookie сессии (открыть эндпоинт в приватном окне / curl без авторизации), чтобы получить полный список **всех** giveaways в системе — `title`, `sourceUrl`, `organizerId`, `winnersCount`, статистику розыгрыша. Для авторизованных посторонних пользователей фильтрация работает верно; проблема — именно в ветке "нет сессии".

Ни один из 7 тестов в `auth-guard.test.ts` не покрывает `GET /api/giveaways` — поэтому регресс остался незамеченным.

**Рекомендация:** `listGiveawaysSummary` должен принимать `organizerId` и фильтровать на уровне репозитория (SQL `WHERE organizerId = ?`), а не в route постфактум; для запросов без сессии — возвращать пустой список либо требовать авторизацию (401), а не отдавать общий список.

---

## 5. Public verify boundary — OK

`GET /api/giveaways/[id]/verify` намеренно публичен (provably-fair верификация). В ответе только `winnerIds`, `reserveWinnerIds`, хэши (`deterministicProofHash`, `auditEventHash`), `snapshotId`, `algorithmVersion`. Токенов, session-данных, credential, `codeVerifier` — нет. Соответствует продуктовой модели.

---

## 6. DB ownership invariant — закрыт (для чистой БД)

`prisma/schema.prisma`:
```prisma
model Giveaway {
  organizerId String
  organizer   User   @relation(fields: [organizerId], references: [id], onDelete: Restrict)
}
```
`organizerId` — не nullable, FK с `onDelete: Restrict`.

`MemoryGiveawayRepository.createGiveaway`:
```ts
if (!input.organizerId) {
  throw new Error('FATAL: organizerId is strictly required to create a giveaway in repository');
}
```
Оба адаптера (Prisma и Memory) консистентны и не позволяют создать giveaway без владельца.

---

## 7. 🟠 Реальной SQL-миграции нет

`find prisma/migrations` — пусто. Есть только `docs/MIGRATION_OWNERSHIP_INVARIANT.md` с *описанием* плана миграции (SQL как документация, не как исполняемый Prisma migration file).

- Для новой чистой БД (CI, dev, свежий прод) — не проблема: `prisma db push`/`migrate dev` создаст схему сразу с нужными constraints.
- Для **уже существующей продовой БД** с legacy nullable `organizerId` — потребуется вручную выполнять `ALTER TABLE ... SET NOT NULL`, автоматического migration file для этого нет.

**Классификация:** HIGH release blocker для существующей БД, но **не** является незакрытым Broken Access Control для чистой БД.

---

## 8–9. Token Vault — fail-fast подтверждён

`src/lib/auth/token-vault.ts`:
```ts
if (process.env.NODE_ENV === 'production') {
  if (!rawSecret) throw new Error('FATAL CONFIGURATION ERROR: TOKEN_ENCRYPTION_KEY environment variable is strictly required in production.');
  if (rawSecret.length < 32) throw new Error('FATAL CONFIGURATION ERROR: TOKEN_ENCRYPTION_KEY must be at least 32 characters long...');
}
```
- Отсутствие ключа в проде → `throw` (не `warn`, как было раньше).
- Ключ короче 32 символов в проде → `throw`.
- `AUTH_SECRET`-фолбэк и хардкодный `dev-encryption-key-do-not-use-in-production-...` из первой версии **полностью убраны**. Grep по репозиторию не находит старый ключ нигде вне тестовых файлов.

**Build-phase bypass (`NEXT_PHASE === 'phase-production-build'`)** — легитимный, стандартный для Next.js паттерн: пропуск проверки только во время `next build` (статический анализ), а не во время обслуживания реальных запросов. Синглтон `defaultTokenVault` создаётся при импорте модуля; при реальном старте сервера в проде без ключа модуль упадёт сразу при импорте. Байпас рантайма не подтверждён.

---

## 10. Качество ключа — задокументировано неточно (LOW)

Код и `.env.example` честно проверяют только `length >= 32` (символы, не биты энтропии) — строка `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` формально пройдёт проверку.

`docs/TOKEN_STORAGE.md` при этом всё ещё утверждает:
> "256-bit key derived via SHA-256 from `TOKEN_ENCRYPTION_KEY` **or `AUTH_SECRET`**"

Упоминание `AUTH_SECRET`-фолбэка устарело — в текущем коде его нет. Документация не синхронизирована с кодом. Minor hardening/doc issue, не блокер.

---

## 11. Env safety — чисто

Секретов в репозитории не найдено (grep по `TOKEN_ENCRYPTION_KEY=`, `AUTH_SECRET=` вне `.env.example` — пусто). `.env.example` содержит все нужные переменные с инструкцией генерации (`openssl rand -hex 32`).

---

## 12. Session/Authorization coupling — корректно

`sessionId = randomBytes(32).toString('hex')` — opaque random identifier, не сериализованный userId. Сервер резолвит его через `MemorySessionStore` (`getSessionFromRequest`). Подделать userId через клиентский cookie нельзя — клиент не может передать произвольный `sessionId`, который сервер бы принял за чужого пользователя.

---

## 13. Тесты

Существующее покрытие (`tests/auth-guard.test.ts`, `tests/token-vault.test.ts`, `tests/oauth-security-gate.test.ts`):

- ✅ anonymous create → 401
- ✅ organizer spoofing через body → игнорируется
- ✅ owner vs intruder на detail / participants / snapshot / draw → 403
- ✅ null owner → 403
- ✅ public verify без авторизации
- ✅ TokenVault: missing/short key в проде → fail-fast
- ✅ TokenVault: tampered ciphertext → fail
- ✅ CSRF origin mismatch на logout

**Отсутствует:** тест на `GET /api/giveaways` (listing IDOR, см. п.4) — что и позволило регрессу остаться незамеченным.

---

## Финальный вердикт

### CRITICAL-1 (Broken Access Control): **PARTIALLY CLOSED**
Все detail/mutating-эндпоинты (`GET/POST [id]`, `participants`, `snapshot`, `draw`) защищены корректно, проверено чтением кода и живым тестом. Но `GET /api/giveaways` (листинг) — открытый IDOR: анонимный запрос получает полный список чужих кампаний. Это тот же класс уязвимости, просто на другом эндпоинте.

### CRITICAL-2 (Token Vault public fallback): **CLOSED**
Fail-fast в проде подтверждён кодом и тестами, хардкодный ключ убран полностью.

### Новые находки

| Severity | Finding |
|---|---|
| 🔴 CRITICAL (новая) | IDOR в `GET /api/giveaways` для запросов без сессии — полный список чужих giveaways |
| 🟠 HIGH | Нет исполняемого SQL-migration file для NOT NULL-инварианта `organizerId` (риск для существующих продовых БД) |
| 🟡 MEDIUM | `docs/TOKEN_STORAGE.md` устарела (упоминает убранный `AUTH_SECRET`-фолбэк) |
| 🟢 LOW | Проверка ключа — только длина (32+ символов), не факт истинной 256-битной энтропии |

### Ответ на главный вопрос

**"Можно ли после commit `02a04df` считать два первоначальных Critical закрытыми?"**

**NO.**

CRITICAL-2 закрыт полностью. CRITICAL-1 закрыт только частично: до релиза нужно поправить фильтрацию в `GET /api/giveaways` — `listGiveawaysSummary` должен принимать `organizerId` и фильтровать на уровне репозитория, а не постфактум в route; для запросов без сессии эндпоинт должен требовать авторизацию (401) или возвращать пустой список, а не общий список всех кампаний.

---

## Метаданные проверки

- **Reviewed commit:** `02a04df2719094e28db97575b9fbecb940b6ead3`
- **Tests run:** 169 passed. 9 файлов недоступны в песочнице из-за блокировки скачивания Prisma query-engine (`binaries.prisma.sh` не в allow-list сети) — инфраструктурное ограничение среды проверки, не дефект кода; подтверждено обходным путём через локальный stub Prisma-клиента: `tests/auth-guard.test.ts` — 7/7 passed.
- **Live PoC:** написан и выполнен собственный тест `GET /api/giveaways` без cookie сессии → подтверждена утечка чужих giveaways.
- **Files inspected:** `src/lib/auth/auth-guard.ts`, `csrf-guard.ts`, `token-vault.ts`, `session.ts`; все routes под `src/app/api/giveaways/**`; `src/lib/repository/prisma-repository.ts`, `memory-repository.ts`; `prisma/schema.prisma`; `docs/MIGRATION_OWNERSHIP_INVARIANT.md`, `docs/TOKEN_STORAGE.md`; `.env.example`; тесты `auth-guard`, `token-vault`, `oauth-security-gate`.
- **Production release recommendation:** **Не готово к релизу** до исправления IDOR в листинге и добавления исполняемого migration file для продовых БД. После этого — можно.
