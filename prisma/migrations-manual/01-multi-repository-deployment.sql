-- Migration: Multi-Repository Deployment System
-- Description: Adds Repository, GitCommit, App models and updates Deployment model
-- Date: 2025-10-05

-- Create AppType enum
DO $$ BEGIN
  CREATE TYPE "AppType" AS ENUM ('API', 'WEB', 'MOBILE', 'WORKER', 'CRON');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create DeploymentLogLevel enum
DO $$ BEGIN
  CREATE TYPE "DeploymentLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create DeploymentPhase enum
DO $$ BEGIN
  CREATE TYPE "DeploymentPhase" AS ENUM ('INITIALIZATION', 'FETCH_CODE', 'BUILD', 'TEST', 'DEPLOY', 'HEALTH_CHECK', 'CLEANUP', 'ROLLBACK', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create repositories table
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

CREATE UNIQUE INDEX IF NOT EXISTS "repositories_name_key" ON "repositories"("name");

-- Create git_commits table
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

CREATE UNIQUE INDEX IF NOT EXISTS "git_commits_repository_id_hash_key" ON "git_commits"("repository_id", "hash");
CREATE INDEX IF NOT EXISTS "git_commits_repository_id_idx" ON "git_commits"("repository_id");
CREATE INDEX IF NOT EXISTS "git_commits_committed_at_idx" ON "git_commits"("committed_at");
CREATE INDEX IF NOT EXISTS "git_commits_branch_idx" ON "git_commits"("branch");

-- Create apps table
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

CREATE UNIQUE INDEX IF NOT EXISTS "apps_name_key" ON "apps"("name");
CREATE INDEX IF NOT EXISTS "apps_repository_id_idx" ON "apps"("repository_id");
CREATE INDEX IF NOT EXISTS "apps_app_type_idx" ON "apps"("app_type");

-- Create deployment_logs table
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

CREATE INDEX IF NOT EXISTS "deployment_logs_deployment_id_idx" ON "deployment_logs"("deployment_id");
CREATE INDEX IF NOT EXISTS "deployment_logs_deployment_id_phase_idx" ON "deployment_logs"("deployment_id", "phase");
CREATE INDEX IF NOT EXISTS "deployment_logs_level_idx" ON "deployment_logs"("level");
CREATE INDEX IF NOT EXISTS "deployment_logs_created_at_idx" ON "deployment_logs"("created_at");

-- Create deployment_metrics table
CREATE TABLE IF NOT EXISTS "deployment_metrics" (
  "id" TEXT NOT NULL,
  "deployment_id" TEXT NOT NULL,
  "metric_type" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "deployment_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "deployment_metrics_deployment_id_idx" ON "deployment_metrics"("deployment_id");
CREATE INDEX IF NOT EXISTS "deployment_metrics_metric_type_idx" ON "deployment_metrics"("metric_type");

-- Add foreign keys
DO $$ BEGIN
  ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_repository_id_fkey"
    FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "apps" ADD CONSTRAINT "apps_repository_id_fkey"
    FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_fkey"
    FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "deployment_metrics" ADD CONSTRAINT "deployment_metrics_deployment_id_fkey"
    FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Update deployments table - add new columns
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "app_id" TEXT;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "git_commit_id" TEXT;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "previous_deployment_id" TEXT;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "workflow_url" TEXT;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "build_log" TEXT;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "error_stack" TEXT;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "health_check_log" TEXT;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "can_rollback" BOOLEAN DEFAULT true;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "rollback_reason" TEXT;

-- Add foreign keys for deployment
DO $$ BEGIN
  ALTER TABLE "deployments" ADD CONSTRAINT "deployments_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "deployments" ADD CONSTRAINT "deployments_git_commit_id_fkey"
    FOREIGN KEY ("git_commit_id") REFERENCES "git_commits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "deployments" ADD CONSTRAINT "deployments_previous_deployment_id_fkey"
    FOREIGN KEY ("previous_deployment_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create unique index on previous_deployment_id
CREATE UNIQUE INDEX IF NOT EXISTS "deployments_previous_deployment_id_key" ON "deployments"("previous_deployment_id") WHERE "previous_deployment_id" IS NOT NULL;

-- Update indexes for deployments
DROP INDEX IF EXISTS "deployments_application_environment_status_idx";
DROP INDEX IF EXISTS "deployments_commit_sha_idx";
DROP INDEX IF EXISTS "deployments_application_environment_idx";
DROP INDEX IF EXISTS "deployments_branch_idx";

CREATE INDEX IF NOT EXISTS "deployments_app_id_environment_status_idx" ON "deployments"("app_id", "environment", "status");
CREATE INDEX IF NOT EXISTS "deployments_git_commit_id_idx" ON "deployments"("git_commit_id");
CREATE INDEX IF NOT EXISTS "deployments_app_id_environment_idx" ON "deployments"("app_id", "environment");

-- Drop DeploymentApplication enum (will be done after data migration)
-- This will be handled manually after migrating existing data

COMMENT ON TABLE "repositories" IS 'Git repositories for different applications';
COMMENT ON TABLE "git_commits" IS 'Git commit history for each repository';
COMMENT ON TABLE "apps" IS 'Deployable applications linked to repositories';
COMMENT ON TABLE "deployment_logs" IS 'Detailed logs for each deployment phase';
COMMENT ON TABLE "deployment_metrics" IS 'Performance and health metrics for deployments';
