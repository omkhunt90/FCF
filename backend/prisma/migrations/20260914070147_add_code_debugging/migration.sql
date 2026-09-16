-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'CODE_DEBUGGING';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "config" JSONB,
ADD COLUMN     "starterCode" TEXT;
