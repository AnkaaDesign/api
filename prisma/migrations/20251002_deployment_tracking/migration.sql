-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "environment" "DeploymentEnvironment" NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "status_order" INTEGER NOT NULL DEFAULT 1,
    "deployed_by" TEXT,
    "version" TEXT,
    "previous_commit" TEXT,
    "rollback_data" JSONB,
    "deployment_log" TEXT,
    "health_check_url" TEXT,
    "health_check_status" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "rolled_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployments_environment_status_idx" ON "deployments"("environment", "status");

-- CreateIndex
CREATE INDEX "deployments_commit_sha_idx" ON "deployments"("commit_sha");

-- CreateIndex
CREATE INDEX "deployments_created_at_idx" ON "deployments"("created_at");

-- CreateIndex
CREATE INDEX "deployments_status_order_idx" ON "deployments"("status_order");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deployed_by_fkey" FOREIGN KEY ("deployed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
