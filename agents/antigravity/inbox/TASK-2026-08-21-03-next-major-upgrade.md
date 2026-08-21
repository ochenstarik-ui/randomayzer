# Task 03: Next.js Major Upgrade (устранение 2 high advisories)

**Assigned to:** Antigravity (Implementation Orchestrator)  
**Priority:** HIGH (security)  
**Date:** 2026-08-21  
**Base SHA:** `6f3fd44333cbb200d82efa665d191f660b100144`

## Scope
1. Check `npm audit --omit=dev` and record the exact vulnerability output.
2. Upgrade `next`, `eslint-config-next`, `@types/react`, `@types/react-dom`, React/React-DOM as needed.
3. Review and adapt Next.js App Router breaking changes:
   - Dynamic route handlers: `params` as Promise in Next.js 15+ (`{ params }: { params: Promise<{ id: string }> }` or `Promise.resolve(params)`).
   - `NextRequest.ip` handling in `src/lib/client-ip.ts`.
   - `next.config.mjs` compatibility.
   - Client components: `useParams()` in `src/app/giveaways/[id]/page.tsx`.
   - `export const dynamic = 'force-dynamic'` across all route handlers.
4. Update `.github/workflows/ci.yml` if Node version requirements change.
5. Verification Gate:
   - `npm ci` / `npm install`
   - `npx prisma generate`
   - `npm test`
   - `npm run lint`
   - `npm run build`
   - `npx tsc --noEmit`
   - `npm audit --omit=dev`
6. Output report in `agents/antigravity/done/TASK-2026-08-21-03-next-major-upgrade.md`.
