-- CreateEnum
CREATE TYPE "SecullumSmokeTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SecullumSmokeRunStatus" AS ENUM ('RUNNING', 'PASSED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SecullumSmokeCheckStatus" AS ENUM ('PASS', 'FAIL', 'SKIP');

-- CreateTable
CREATE TABLE "secullum_smoke_test_runs" (
    "id" TEXT NOT NULL,
    "trigger" "SecullumSmokeTrigger" NOT NULL,
    "status" "SecullumSmokeRunStatus" NOT NULL DEFAULT 'RUNNING',
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "pass_count" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "skip_count" INTEGER NOT NULL DEFAULT 0,
    "triggered_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secullum_smoke_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secullum_smoke_test_checks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "check_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "SecullumSmokeCheckStatus" NOT NULL,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secullum_smoke_test_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "secullum_smoke_test_runs_ran_at_idx" ON "secullum_smoke_test_runs"("ran_at");

-- CreateIndex
CREATE INDEX "secullum_smoke_test_runs_status_idx" ON "secullum_smoke_test_runs"("status");

-- CreateIndex
CREATE INDEX "secullum_smoke_test_checks_run_id_idx" ON "secullum_smoke_test_checks"("run_id");

-- AddForeignKey
ALTER TABLE "secullum_smoke_test_runs" ADD CONSTRAINT "secullum_smoke_test_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secullum_smoke_test_checks" ADD CONSTRAINT "secullum_smoke_test_checks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "secullum_smoke_test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
