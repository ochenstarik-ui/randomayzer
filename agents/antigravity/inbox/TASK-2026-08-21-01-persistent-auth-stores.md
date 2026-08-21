# Task 01: Persistent OAuth-state & Session Store

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** HIGH  
**Date:** 2026-08-21  
**Base SHA:** `b2888950cdd2d948c15acf0004a0cdc91eeb70e6`

## Scope
1. Add `OAuthTransaction` and `Session` models to `prisma/schema.prisma`.
   - `OAuthTransaction`: `id` (@id @default(cuid())), `state` (@unique), `codeVerifier`, `redirectTarget` (optional string), `createdAt`, `expiresAt`. Index on `expiresAt`.
   - `Session`: `id` (@id @default(cuid())), `sessionId` (@unique), `userId` (FK to `User`), `user` relation, `createdAt`, `expiresAt`. Index on `expiresAt`, `userId`.
2. Generate migration SQL under `prisma/migrations/` (timestamped migration folder).
3. Implement `PrismaOAuthTransactionStore` in `src/lib/auth/oauth-state.ts` implementing `IOAuthTransactionStore`.
   - Atomic single-use `consumeTransaction` (atomic delete/find).
   - TTL check after atomic consumption.
4. Implement `PrismaSessionStore` in `src/lib/auth/session.ts` implementing `ISessionStore`.
   - `createSession`: persists session with `expiresAt = Date.now() + ttlMs`.
   - `getSession`: finds non-expired session by `sessionId`, loads user, returns `SessionUser` or `null`.
   - `destroySession`: deletes session by `sessionId`.
   - `clear`: deletes all sessions.
5. Create store factory / default selector based on `STORAGE_DRIVER` & `NODE_ENV`:
   - `createOAuthTransactionStore()` & `createSessionStore()`: `STORAGE_DRIVER === 'memory' || process.env.NODE_ENV === 'test'` -> Memory, otherwise Prisma.
   - Remove fatal on `MULTI_INSTANCE` for Prisma stores; keep fatal guard for Memory stores.
6. Tests in `tests/persistent-auth-stores.test.ts`:
   - Concurrent `consumeTransaction` on single state: exactly 1 success, N-1 fail / 401.
   - Multi-instance state consumption (two store instances sharing storage).
   - TTL expiry checks for both OAuth transaction and Session.
   - `destroySession` and session revival prevention.
7. Run verification gate: `npm ci`, `npx prisma generate`, `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`.
8. Write final report to `agents/antigravity/done/TASK-2026-08-21-01-persistent-auth-stores.md`.
