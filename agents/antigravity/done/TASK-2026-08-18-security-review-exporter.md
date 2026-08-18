# Task Done: Developer Tooling — Add Security Review Exporter

**Status:** DONE
**Assigned to:** Antigravity (@orchestrator)
**Date:** 2026-08-18
**Base Commit:** `bc2b658`

## Accomplished
1. Created `tools/export-review.ps1` supporting:
   - Full snapshot mode (`git archive HEAD`) with `REVIEW_CONTEXT.md` injection.
   - Diff mode (`-Diff`, `-Base <SHA>`) with `REVIEW_DIFF.patch`, `REVIEW_CHANGED_FILES.txt`, changed source files in tree structure, all tests in `tests/*`, `prisma/schema.prisma`, `package.json`, `docs/*`.
   - Security safety check against tracked secrets (`.env`, `*.pem`, `*.key`, `credentials.json`, `secrets.json`).
   - Dirty worktree handling with warning and `-RequireClean` strict guard.
   - Output summary table with file count, size, commit SHA, mode.
   - `-CopyPrompt` to automatically put Russian reviewer prompt into Windows clipboard.
   - Compatible with Windows PowerShell 5.1 and PowerShell 7+, handles paths with spaces.
2. Created user documentation in `docs/AI_REVIEW_EXPORT.md`.
3. Verified both FULL and DIFF exports, tested `-RequireClean`, tested Windows PowerShell 5.1 and PowerShell 7.
