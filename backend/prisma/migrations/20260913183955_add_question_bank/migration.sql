-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "assignedQuestionBank" INTEGER;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "questionBank" INTEGER;

-- CreateIndex
CREATE INDEX "Task_activityId_questionBank_idx" ON "Task"("activityId", "questionBank");
