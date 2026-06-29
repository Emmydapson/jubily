ALTER TABLE "VideoJob" DROP CONSTRAINT IF EXISTS "VideoJob_slot_scheduledFor_key";

CREATE UNIQUE INDEX IF NOT EXISTS "VideoJob_workspaceId_slot_scheduledFor_key"
  ON "VideoJob"("workspaceId", "slot", "scheduledFor");
