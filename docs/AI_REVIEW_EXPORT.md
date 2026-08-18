# Randomayzer AI Security Review Exporter

`tools/export-review.ps1` — утилита для создания автономных snapshot и diff пакетов репозитория для внешних AI security reviewers, у которых нет прямого доступа к GitHub репозиторию или локальной файловой системе.

---

## 1. Возможности

- **Full Snapshot Mode (по умолчанию)**: Создает полный ZIP-архив репозитория на основе `git archive HEAD`.
- **Diff Mode (`-Diff`)**: Создает компактный пакет изменений между базовым коммитом (`-Base`) и `HEAD`, включая патч, список измененных файлов, измененные исходники, полный набор тестов, схему базы данных и документацию.
- **Review Context (`REVIEW_CONTEXT.md`)**: В каждый архив автоматически встраивается файл метаданных с полным SHA, веткой, временной меткой, состоянием working tree и статистикой `git log`.
- **Secret Safety Check**: Проверяет tracked-файлы на наличие потенциальных секретов (`.env`, `*.pem`, `*.key`, `credentials.json`, `secrets.json`) и блокирует экспорт при обнаружении.
- **Dirty Worktree Warning / Guard**: Предупреждает о наличии незакоммиченных изменений (снапшот собирается строго из `HEAD`) или прерывает выполнение при флаге `-RequireClean`.
- **Zero External Dependencies**: Работает на Windows PowerShell 5.1 и PowerShell 7+ с использованием стандартных API .NET (`System.IO.Compression`). Сторонние архиваторы (7-Zip, WinRAR) не требуются.
- **Корректная работа с пробелами в путях** (например, `E:\Agent projects\Randomayzer`).

---

## 2. Быстрый старт

Запуск из корня проекта:

### Полный снимок репозитория (Full Snapshot)
```powershell
.\tools\export-review.ps1
```
Архив сохраняется по умолчанию в папку `Desktop\Randomayzer Reviews\randomayzer-review-<shortSHA>.zip`.

### Diff последнего коммита (`HEAD^` vs `HEAD`)
```powershell
.\tools\export-review.ps1 -Diff
```
Создает архив `randomayzer-diff-review-<shortSHA>.zip`, содержащий:
- `REVIEW_CONTEXT.md`
- `REVIEW_DIFF.patch`
- `REVIEW_CHANGED_FILES.txt`
- Измененные файлы в структуре каталогов проекта
- Полный набор тестов `tests/*`
- Схему `prisma/schema.prisma`, `package.json`, `.env.example`, документацию `docs/*`

### Diff от определенного коммита
```powershell
.\tools\export-review.ps1 -Diff -Base b5467f6
```

---

## 3. Параметры

| Параметр | Тип | Описание |
|---|---|---|
| `-Diff` | Switch | Включает режим формирования diff-пакета вместо полного снимка. |
| `-Base <SHA>` | String | Базовый коммит для сравнения в режиме `-Diff` (по умолчанию `HEAD^`). |
| `-OutputDir <Path>` | String | Пользовательский путь для сохранения ZIP-файлов (по умолчанию `Desktop\Randomayzer Reviews\`). |
| `-RequireClean` | Switch | Завершает работу с ошибкой, если в working tree есть незакоммиченные файлы. |
| `-AllowSensitiveTrackedFiles` | Switch | Отключает блокировку экспорта при обнаружении подозрительных tracked-файлов. |
| `-CopyPrompt` | Switch | Автоматически копирует в буфер обмена Windows текст задания для security reviewer. |

---

## 4. Примеры использования

### Экспорт со строгой проверкой чистоты рабочей директории
```powershell
.\tools\export-review.ps1 -RequireClean
```

### Экспорт в пользовательскую директорию с копированием промпта
```powershell
.\tools\export-review.ps1 -Diff -Base bc2b658 -OutputDir "D:\Audits" -CopyPrompt
```

После выполнения в буфере обмена будет готов стандартизированный промпт:
> «В приложенном архиве snapshot Randomayzer на commit `<SHA>`.  
> Используй архив как source of truth.  
> Не используй GitHub HEAD вместо него.  
> Выполни ранее выданное security review задание.»

---

## 5. Гарантии безопасности архива

1. **Изоляция от локального мусора**: В ZIP-архив **никогда не попадают**:
   - `.git`
   - `node_modules`
   - `.next` сборки и кэш
   - Локальные незакоммиченные файлы
   - Локальные `.env`, `.env.local`
   - IDE-файлы (`.vscode`, `.idea`)
2. **Точность снимка**: Файлы извлекаются напрямую из Git-объектов коммита (`git archive` для Full или `git show HEAD:<path>` для Diff), поэтому локальные изменения в рабочей директории не искажают снимок.
3. **Защита от утечки секретов**: Сканирование имен файлов блокирует экспорт при случайном попадании приватных ключей или файлов конфигурации в индекс Git.
