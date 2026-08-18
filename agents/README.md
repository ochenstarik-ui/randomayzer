# Agents workspace — Randomayzer

Эта папка хранит задания, рабочие заметки и результаты всех агентов проекта.

Корневые обязательные правила: `../AGENTS.md`.

## Структура

Для каждого агента используется отдельная папка:

```text
agents/
  <agent-id>/
    inbox/
    notes/
    done/
```

Рекомендуемые `agent-id`:

```text
antigravity
opencode
grok
claude
coordinator
```

## Inbox

Перед началом работы агент фиксирует полученное задание в:

```text
agents/<agent-id>/inbox/TASK-YYYY-MM-DD-<slug>.md
```

Минимальные поля:

```text
# Task
Base SHA:
Scope:
Do not change:
Definition of Done:
Required verification:
```

Если задание пришло через чат, его смысл переносится в inbox без самовольного расширения scope.

## Notes

Черновые исследования, временные матрицы, локальные гипотезы и незавершённые выводы:

```text
agents/<agent-id>/notes/
```

Notes не считаются принятым результатом и не используются как доказательство закрытия фазы.

## Done

Итог задачи:

```text
agents/<agent-id>/done/TASK-YYYY-MM-DD-<slug>.md
```

Минимум:

```text
# Result
Base SHA:
Result SHA:
Files changed:
Commands actually run:
Test result:
Lint result:
Build result:
Findings:
UNVERIFIED:
Remaining blockers:
Non-blocking tech debt:
```

Review-agent дополнительно указывает:

```text
Reviewed SHA:
CRITICAL:
HIGH:
MEDIUM:
LOW:
Final verdict:
```

## Параллельная работа

Два implementation-agent не редактируют одну и ту же область одновременно без прямого указания координатора.

Если параллельная работа необходима:
- фиксируются разные scope;
- каждый агент сообщает base/result SHA;
- изменения остаются логически раздельными;
- merge выполняется контролируемо после review.

Review-agent не исправляет найденные production-проблемы в том же review-коммите, если задание явно не переведено в режим `fix`.

## Security findings

`CRITICAL` и `HIGH` не считаются закрытыми по заявлению автора исправления. В `done/` должен быть указан конкретный fix SHA и evidence; для security-sensitive областей применяется независимый re-review согласно `AGENTS.md`.

PoC считается более сильным evidence, чем общий PASS-отчёт. После исправления PoC превращается в regression test, если это технически возможно.

## Git

Force-push запрещён.

Reviewers не пушат production source. Кто имеет право пушить implementation в `main`, определяет владелец/главный координатор текущей задачи.

В каждом task/result всегда хранить полный commit SHA, а не только `main` или «последний коммит».

## Review export

Если внешний reviewer не видит GitHub:

```powershell
.\tools\export-review.ps1
```

или diff от известной базы:

```powershell
.\tools\export-review.ps1 -Diff -Base <SHA>
```

Reviewer использует архив как source of truth и обязательно указывает SHA snapshot.
