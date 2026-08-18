# Правила работы агентов — Randomayzer

Документ адресован любому исполнителю: человеку или агенту. Он описывает не устройство проекта, а обязательный порядок работы над ним.

## 1. Границы задачи

Задание определяет область. Выход за неё запрещён, даже когда исправление очевидно и занимает минуту: перемешанные изменения нельзя независимо отревьюить и откатить. Замеченное рядом — отдельным списком в отчёт и предложением следующей задачи.

Изменять `Randomizer`, `AuditProof`, deterministic proof format, snapshot hash algorithm и алгоритм `HMAC_SHA256_FY_V1` можно только по отдельному прямому заданию владельца проекта.

## 2. Факты и догадки

Выдумывать нельзя. Если решение не принято, версия неизвестна, поведение не проверено или контракт VK не подтверждён — так и пишем: `UNVERIFIED` / `не определено`.

Для фактов о VK API, VK ID, OAuth, token scopes, limits и method capabilities источник истины — актуальная официальная документация VK/VKCOM. Старые примеры, сторонние SDK и предположения не выдавать за подтверждённый контракт.

## 3. Проверка

«Работает» — не результат проверки. В отчёт идут команды и фактический результат их запуска.

Минимальный gate для production-кода:

```text
npm ci
npx prisma generate
npm test
npm run lint
npm run build
```

Если какая-либо команда не запускалась или среда не позволила её выполнить, это указывается явно. Нельзя писать `green`, `PASS`, `готово` или `закрыто`, если соответствующая проверка фактически не была выполнена.

Для concurrency/security задач обязательны заявленные в задании regression/adversarial tests, а не только happy-path unit tests.

## 4. Задания и результаты

Задания и отчёты живут в `agents/`. Полная схема — в `agents/README.md`.

Коротко: задание — в `agents/<agent-id>/inbox/`, результат — в `agents/<agent-id>/done/`, черновики — в `agents/<agent-id>/notes/`.

Задание, пришедшее в чате, агент сначала фиксирует в своём `inbox/`, и только потом работает. Своих служебных папок за пределами `agents/<agent-id>/` не заводить.

Каждый результат обязан содержать:
- base commit SHA;
- resulting commit SHA, если код менялся;
- список изменённых файлов;
- фактически выполненные команды проверки и их результат;
- `CRITICAL/HIGH/MEDIUM/LOW` findings, если это review;
- список `UNVERIFIED` утверждений;
- оставшиеся blockers и non-blocking tech debt.

## 5. Роли агентов

Роль задаётся конкретным заданием и не расширяется самостоятельно.

- **Antigravity** — основной implementation-agent. Пишет код только в рамках задания, добавляет regression tests и отчёт.
- **OpenCode** — implementation/review agent по отдельному заданию. Не дублирует одновременно зону Antigravity без прямого указания.
- **Grok** — по умолчанию adversarial/stress reviewer. Production source не меняет, если это прямо не разрешено заданием.
- **Claude** — по умолчанию независимый security/code reviewer. Production source не меняет, если это прямо не разрешено заданием.
- **Главный агент/координатор** — принимает работу, сводит независимые ревью, определяет статус фазы и разрешает следующий этап.

Ни один исполнитель не объявляет самостоятельно `Phase CLOSED`, `release-ready` или `production-ready` — это решение принимает только главный агент после проверки evidence.

## 6. Git и main

Каждая задача начинается с фиксации base SHA. Перед отчётом агент обязан указать фактический HEAD/result SHA.

Самостоятельный force-push запрещён.

Пушить/мержить в `main` разрешено только главному implementation-agent, явно назначенному владельцем проекта для текущей задачи. Review-агенты (Grok/Claude) не пушат production-код и не смешивают review-artifacts с незапрошенными исправлениями.

Если несколько агентов работают параллельно, их зоны должны быть непересекающимися либо работа должна идти в отдельных ветках/коммитах с последующим контролируемым merge.

## 7. Security review gate

Любое изменение в следующих областях требует независимой проверки до закрытия фазы:
- authentication / OAuth / PKCE;
- authorization / ownership / IDOR;
- sessions / cookies / CSRF;
- token storage / TokenVault / refresh;
- VK auth resolver / SERVICE→USER fallback;
- Prisma ownership/credential migrations;
- idempotency / rate limiting;
- draw concurrency / snapshot integrity;
- public verify/audit boundary.

Минимум один независимый reviewer должен проверить security-sensitive change. Если уже есть `CRITICAL` или `HIGH`, найденный независимым reviewer, он считается открытым, пока отдельная повторная проверка не подтвердит `CLOSED` или главный агент не документирует осознанное исключение.

Исполнитель не может сам закрыть собственный security finding только формулировкой в отчёте — нужен код/tests/evidence, а для `CRITICAL/HIGH` предпочтительно независимое re-review.

## 8. Правило доказательности фаз

Фаза считается закрытой только когда одновременно выполнено:
1. Definition of Done исходного задания;
2. test/lint/build gate или явно принятая владельцем инфраструктурная оговорка;
3. нет открытых release-blocking `CRITICAL/HIGH`;
4. независимые review findings сведены и классифицированы;
5. итоговый commit SHA зафиксирован;
6. главный агент явно объявил фазу закрытой.

Наличие большого числа тестов само по себе не доказывает отсутствие уязвимости. Для найденного PoC обязательно добавляется regression test, воспроизводящий именно этот сценарий.

## 9. Секреты и реальные VK credentials

Никогда не коммитить и не помещать в review-архивы реальные:
- VK access/refresh/service/community tokens;
- `VK_CLIENT_SECRET`;
- `TOKEN_ENCRYPTION_KEY`;
- `AUTH_SECRET`;
- `.env`, `.env.local`, private keys и credential files.

Реальные credentials используются только через локальные environment variables. В tests/docs применяются очевидно фальшивые marker tokens.

Логи, ошибки, API responses, AuditProof и review reports не должны содержать plaintext или encrypted credential values.

## 10. Review snapshots

Если reviewer не имеет прямого доступа к репозиторию, source of truth — архив, созданный `tools/export-review.ps1` из конкретного commit SHA.

Reviewer обязан указать, какой SHA он проверял. Нельзя незаметно подменять snapshot текущим GitHub `HEAD`.

Для небольшого исправления предпочтителен diff-review от явно указанного base SHA.

## 11. Архитектурные инварианты Randomayzer

Без отдельного задания нельзя нарушать следующие инварианты:
- Giveaway принадлежит одному authenticated organizer; ownerless production giveaway запрещён.
- Чужой organizer credential никогда не выбирается по client-supplied id.
- SERVICE token предпочтителен для допустимых публичных VK операций; USER fallback только по явной whitelist-policy.
- Rate-limit/network/timeout/temporary/validation errors не используются как причина переключения токена.
- Expired/unknown USER credential не используется молча.
- Token refresh не должен перезаписывать более новую credential state.
- Public verification остаётся отделённой от private organizer/participant/credential данных.
- VK auth/token metadata не входит в deterministic draw proof.
- Partial participant import не может быть сохранён как полный результат без явного partial/error contract.

## 12. Новые call sites и trust boundaries

Любой новый route, background job или service, который вызывает `VkProvider`, `VkAuthContextResolver`, `TokenRefresher` или credential repository, обязан доказать происхождение `organizerId` из доверенного server-side контекста.

Запрещено передавать в credential resolution `organizerId`, `userId` или `vkUserId`, полученные напрямую из body/query/header клиента, без server-side authorization binding.

При добавлении нового call site необходимо добавить тест на cross-user/IDOR сценарий или явно объяснить, почему такой сценарий невозможен.

## 13. Отчётность о несоответствиях

Если документация, тест и production-код расходятся, source of truth — фактический production-код и реально выполненная проверка. Расхождение фиксируется отдельным finding; нельзя молча «считать», что документация описывает реализованное поведение.

Если один reviewer говорит `PASS`, а другой воспроизводит конкретный PoC, приоритет имеет воспроизводимый PoC до его опровержения или исправления.
