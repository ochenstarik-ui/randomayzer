# Database Migration Strategy: Mandatory Organizer Ownership Invariant

This document details the database schema migration strategy for enforcing mandatory, non-null `organizerId` on the `Giveaway` table in production.

---

## 1. Context & Invariant

In Randomayzer, every giveaway is owned by an authenticated Organizer (represented by the `User` model via VK ID OAuth 2.1).
To prevent broken access control and ambiguous authorization states:
- `Giveaway.organizerId` is strictly `NOT NULL`.
- Foreign key relation is defined with `onDelete: Restrict`, strictly preventing the deletion of an organizer account while owned giveaways exist.

---

## 2. Prisma Schema Definition

```prisma
model User {
  id          String          @id @default(cuid())
  vkUserId    String          @unique
  giveaways   Giveaway[]
  ...
}

model Giveaway {
  id                  String               @id @default(cuid())
  organizerId         String
  organizer           User                 @relation(fields: [organizerId], references: [id], onDelete: Restrict)
  ...
  @@index([organizerId])
}
```

---

## 3. Migration Plan for Existing Records

### A. Development & Staging Environments
Existing anonymous test records created prior to Phase 2.2 can be purged:
```sql
DELETE FROM "ParticipantSnapshot" WHERE "giveawayId" IN (SELECT "id" FROM "Giveaway" WHERE "organizerId" IS NULL);
DELETE FROM "Participant" WHERE "giveawayId" IN (SELECT "id" FROM "Giveaway" WHERE "organizerId" IS NULL);
DELETE FROM "Giveaway" WHERE "organizerId" IS NULL;
```

### B. Production Migration Protocol
1. **Never assign legacy records to arbitrary users**: If unassigned giveaways exist in a production database, do not automatically bind them to random organizers.
2. **Quarantine or Admin Assignment**: Migrate legacy orphan giveaways to a designated system quarantine table or assign to an explicitly verified administrative organizer.
3. **Execute SQL Migration**:
```sql
-- Step 1: Verify 0 null records remain
SELECT COUNT(*) FROM "Giveaway" WHERE "organizerId" IS NULL;

-- Step 2: Enforce NOT NULL and Restrict constraint
ALTER TABLE "Giveaway" ALTER COLUMN "organizerId" SET NOT NULL;
```
