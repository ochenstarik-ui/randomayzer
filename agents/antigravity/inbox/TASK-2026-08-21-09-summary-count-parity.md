# Task 09: Паритет eligibleParticipantsCount между драйверами

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** MEDIUM (UI data accuracy & driver parity)  
**Date:** 2026-08-21  
**Base SHA:** `4e095553a11636cca298e75c799c92b07eb31396`

## Scope
1. Harmonize `eligibleParticipantsCount` calculation across `PrismaGiveawayRepository` and `MemoryGiveawayRepository`:
   - Single unified semantic:
     * If `drawResult` exists (after draw): use `drawResult.totalEligibleCount`.
     * If before draw: calculate `eligibleParticipantsCount` as the count of eligible participants (`eligible === true`).
2. Efficient Prisma query:
   - In `PrismaGiveawayRepository.listGiveawaysSummary`, do NOT load full participant records.
   - Use Prisma relational count with filter or aggregate:
     In Prisma query:
     ```prisma
     _count: {
       select: {
         participants: true,
       }
     }
     ```
     To count eligible participants without full records:
     In Prisma schema, `participants` is a relation on `Giveaway`.
     Can Prisma do `_count` with filter in `select`?
     In Prisma Client 5.x:
     ```typescript
     _count: {
       select: {
         participants: true,
       }
     }
     ```
     Prisma 5 does not support filtered `_count` inside `select` on nested relations, but we can do a grouped/filtered count or query efficiently.
     Let's check how Prisma handles `_count` or how `listGiveawaysSummary` is implemented.
3. Check all other fields of `GiveawaySummary` for driver parity:
   - `id`, `platform`, `sourceUrl`, `platformOwnerId`, `platformPostId`, `title`, `postImageUrl`, `status`, `winnersCount`, `reserveWinnersCount`, `createdAt`, `updatedAt`, `drawnAt`, `totalParticipantsCount`, `eligibleParticipantsCount`, `hasDrawResult`, `algorithmVersion`.
4. Keep `GET /api/giveaways` lightweight (zero participant arrays, zero seed leakage).
5. Create test suite `tests/summary-count-parity.test.ts`.
6. Full gate verification & report in `agents/antigravity/done/TASK-2026-08-21-09-summary-count-parity.md`.
