-- AlterTable
ALTER TABLE "User" ALTER COLUMN "birth" DROP NOT NULL,
ALTER COLUMN "admissional" DROP NOT NULL;

-- AlterTable
ALTER TABLE "thumbnail_jobs" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;
