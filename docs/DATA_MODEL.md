# Модель данных VK Giveaway Randomizer

## 1. Схема данных (Entity-Relationship)

```mermaid
erDiagram
    Giveaway ||--o{ Participant : "has"
    Giveaway ||--o| DrawResult : "produces"
    Giveaway ||--o| AuditRecord : "verifies"

    Giveaway {
        string id PK
        string platform "VK | TELEGRAM | YOUTUBE"
        string sourceUrl
        string platformOwnerId
        string platformPostId
        string title
        string description
        string postImageUrl
        string status "DRAFT | FETCHING | READY | COMPLETED | CANCELLED"
        json filterRules
        int winnersCount
        int reserveWinnersCount
        string seed
        datetime createdAt
        datetime updatedAt
        datetime drawnAt
    }

    Participant {
        string id PK
        string giveawayId FK
        string platformUserId
        string firstName
        string lastName
        string username
        string avatarUrl
        string source "LIKES | COMMENTS | REPOSTS | COMBINED"
        boolean liked
        boolean commented
        int commentsCount
        boolean reposted
        boolean subscribed
        boolean eligible
        string exclusionReason
        datetime createdAt
    }

    DrawResult {
        string id PK
        string giveawayId FK
        json winners
        json reserveWinners
        int totalEligibleCount
        int totalLoadedCount
        string seedUsed
        string algorithm
        datetime drawnAt
    }

    AuditRecord {
        string id PK
        string giveawayId FK
        string participantsSnapshotHash
        string seed
        string algorithm
        json filterRulesSnapshot
        json winnersSnapshot
        datetime verifiedAt
        string verificationSignature
    }
```

## 2. Описание сущностей

### Giveaway (Розыгрыш)
- Главная сущность кампании розыгрыша.
- Хранит метаданные поста (ссылка, ID автора, ID поста, заголовок, превью-картинка), статус выполнения, настройки фильтрации и параметры выбора (кол-во победителей, seed).

### Participant (Участник)
- Запись об участнике, полученном из социальной сети.
- Хранит профиль пользователя (`platformUserId`, имя, аватарка) и флаги выполненных действий (`liked`, `commented`, `commentsCount`, `reposted`, `subscribed`).
- Поле `eligible: boolean` определяет, допущен ли участник к жеребьевке.
- Поле `exclusionReason: string` фиксирует точную причину недопуска (например, `"NOT_SUBSCRIBED"`, `"NO_REPOST"`, `"BLACKLISTED"`).

### DrawResult (Результат розыгрыша)
- Зафиксированный результат проведения розыгрыша.
- Хранит массив основных победителей, массив резервных победителей, время розыгрыша, алгоритм и использованный seed.

### AuditRecord (Запись аудита и доказуемости)
- Неизменяемый криптографический слепок розыгрыша.
- Содержит `participantsSnapshotHash` (SHA-256 хеш канонического списка участников), точный `seed`, снапшот правил фильтрации и результатов. Позволяет любому стороннему лицу проверить результат жеребьевки.
