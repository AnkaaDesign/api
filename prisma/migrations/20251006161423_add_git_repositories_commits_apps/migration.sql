-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AppType" AS ENUM ('API', 'WEB', 'MOBILE', 'WORKER', 'CRON');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DeploymentLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DeploymentPhase" AS ENUM ('INITIALIZATION', 'FETCH_CODE', 'BUILD', 'TEST', 'DEPLOY', 'HEALTH_CHECK', 'CLEANUP', 'ROLLBACK', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DeploymentTrigger" AS ENUM ('MANUAL', 'AUTO', 'PUSH', 'PULL_REQUEST', 'TAG', 'SCHEDULE', 'WEBHOOK', 'ROLLBACK', 'API');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum - Add new values to existing DeploymentEnvironment enum
DO $$ BEGIN
    ALTER TYPE "DeploymentEnvironment" ADD VALUE IF NOT EXISTS 'DEVELOPMENT';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum - Add new values to existing DeploymentStatus enum
DO $$ BEGIN
    ALTER TYPE "DeploymentStatus" ADD VALUE IF NOT EXISTS 'BUILDING';
    ALTER TYPE "DeploymentStatus" ADD VALUE IF NOT EXISTS 'TESTING';
    ALTER TYPE "DeploymentStatus" ADD VALUE IF NOT EXISTS 'DEPLOYING';
    ALTER TYPE "DeploymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "repositories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "git_url" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "git_commits" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "short_hash" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "branch" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "files_changed" INTEGER NOT NULL DEFAULT 0,
    "insertions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "apps" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "app_type" "AppType" NOT NULL,
    "build_command" TEXT,
    "deploy_command" TEXT,
    "health_check_url" TEXT,
    "environment_vars" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deployment_logs" (
    "id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "level" "DeploymentLogLevel" NOT NULL,
    "phase" "DeploymentPhase" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "stack_trace" TEXT,
    "source" TEXT,
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deployment_metrics" (
    "id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_metrics_pkey" PRIMARY KEY ("id")
);

-- AlterTable deployments
DO $$ BEGIN
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "app_id" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "git_commit_id" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "triggered_by" "DeploymentTrigger" NOT NULL DEFAULT 'MANUAL';
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "build_number" INTEGER;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "previous_deployment_id" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "workflow_run_id" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "workflow_url" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "duration" INTEGER;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "build_log" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "error_message" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "error_stack" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "health_check_log" TEXT;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "can_rollback" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "rollback_reason" TEXT;

    -- Drop old columns if they exist (rename commit_sha to git_commit_id is handled by adding new column)
    ALTER TABLE "deployments" DROP COLUMN IF EXISTS "commit_sha";
    ALTER TABLE "deployments" DROP COLUMN IF EXISTS "branch";
    ALTER TABLE "deployments" DROP COLUMN IF EXISTS "previous_commit";
    ALTER TABLE "deployments" DROP COLUMN IF EXISTS "started_at";

    -- Add new started_at column if it doesn't exist
    ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3);
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "repositories_name_key" ON "repositories"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "git_commits_repository_id_hash_key" ON "git_commits"("repository_id", "hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "git_commits_repository_id_idx" ON "git_commits"("repository_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "git_commits_committed_at_idx" ON "git_commits"("committed_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "git_commits_branch_idx" ON "git_commits"("branch");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "apps_name_key" ON "apps"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "apps_repository_id_idx" ON "apps"("repository_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "apps_app_type_idx" ON "apps"("app_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployment_logs_deployment_id_idx" ON "deployment_logs"("deployment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployment_logs_deployment_id_phase_idx" ON "deployment_logs"("deployment_id", "phase");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployment_logs_level_idx" ON "deployment_logs"("level");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployment_logs_created_at_idx" ON "deployment_logs"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployment_metrics_deployment_id_idx" ON "deployment_metrics"("deployment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployment_metrics_metric_type_idx" ON "deployment_metrics"("metric_type");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "deployments_previous_deployment_id_key" ON "deployments"("previous_deployment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployments_app_id_environment_status_idx" ON "deployments"("app_id", "environment", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployments_git_commit_id_idx" ON "deployments"("git_commit_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployments_app_id_environment_idx" ON "deployments"("app_id", "environment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deployments_triggered_by_idx" ON "deployments"("triggered_by");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "apps" ADD CONSTRAINT "apps_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "deployments" ADD CONSTRAINT "deployments_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "deployments" ADD CONSTRAINT "deployments_git_commit_id_fkey" FOREIGN KEY ("git_commit_id") REFERENCES "git_commits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "deployments" ADD CONSTRAINT "deployments_previous_deployment_id_fkey" FOREIGN KEY ("previous_deployment_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "deployment_metrics" ADD CONSTRAINT "deployment_metrics_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
