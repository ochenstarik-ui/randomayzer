-- Migration: 20260818120000_ownership_invariant
-- Enforces mandatory non-null organizer ownership and Restrict foreign key constraint.
-- IMPORTANT: A database backup must be created before running this migration in production.

-- Step 1: Safety verification for legacy records
-- If any Giveaway rows have organizerId IS NULL, abort migration with descriptive notice.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Giveaway" WHERE "organizerId" IS NULL) THEN
    RAISE EXCEPTION 'MIGRATION ABORTED: Found Giveaway records with NULL organizerId. Run quarantine/data remediation before enforcing NOT NULL.';
  END IF;
END $$;

-- Step 2: Enforce NOT NULL on organizerId
ALTER TABLE "Giveaway" ALTER COLUMN "organizerId" SET NOT NULL;

-- Step 3: Recreate Foreign Key with ON DELETE RESTRICT
ALTER TABLE "Giveaway" DROP CONSTRAINT IF EXISTS "Giveaway_organizerId_fkey";

ALTER TABLE "Giveaway" 
  ADD CONSTRAINT "Giveaway_organizerId_fkey" 
  FOREIGN KEY ("organizerId") 
  REFERENCES "User"("id") 
  ON DELETE RESTRICT 
  ON UPDATE CASCADE;

-- Step 4: Ensure Index on organizerId exists for scoped queries
CREATE INDEX IF NOT EXISTS "Giveaway_organizerId_idx" ON "Giveaway"("organizerId");
