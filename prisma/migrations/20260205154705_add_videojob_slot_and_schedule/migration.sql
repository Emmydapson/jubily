-- 1) Create enum if not exists
DO $$ BEGIN
  CREATE TYPE "RunSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2) Add columns as NULLABLE first
ALTER TABLE "VideoJob"
  ADD COLUMN IF NOT EXISTS "slot" "RunSlot",
  ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);

-- 3) Backfill existing rows
-- Put all existing rows into MORNING slot, and scheduledFor = createdAt
UPDATE "VideoJob"
SET
  "slot" = COALESCE("slot", 'MORNING'),
  "scheduledFor" = COALESCE("scheduledFor", "createdAt");

-- 4) Make columns required
ALTER TABLE "VideoJob"
  ALTER COLUMN "slot" SET NOT NULL,
  ALTER COLUMN "scheduledFor" SET NOT NULL;

-- 5) Add unique constraint (idempotency)
DO $$ BEGIN
  ALTER TABLE "VideoJob"
    ADD CONSTRAINT "VideoJob_slot_scheduledFor_key" UNIQUE ("slot", "scheduledFor");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 6) Add indexes (optional but helpful)
CREATE INDEX IF NOT EXISTS "VideoJob_slot_idx" ON "VideoJob"("slot");
CREATE INDEX IF NOT EXISTS "VideoJob_scheduledFor_idx" ON "VideoJob"("scheduledFor");
