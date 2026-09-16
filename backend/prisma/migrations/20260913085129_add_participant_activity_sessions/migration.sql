-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'FOCUS_LOST';
ALTER TYPE "AuditEventType" ADD VALUE 'ACTIVITY_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'ACTIVITY_ENDED';

-- CreateTable
CREATE TABLE "ParticipantActivitySession" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipantActivitySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParticipantActivitySession_participantId_idx" ON "ParticipantActivitySession"("participantId");

-- CreateIndex
CREATE INDEX "ParticipantActivitySession_activityId_idx" ON "ParticipantActivitySession"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipantActivitySession_participantId_activityId_key" ON "ParticipantActivitySession"("participantId", "activityId");

-- AddForeignKey
ALTER TABLE "ParticipantActivitySession" ADD CONSTRAINT "ParticipantActivitySession_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantActivitySession" ADD CONSTRAINT "ParticipantActivitySession_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
