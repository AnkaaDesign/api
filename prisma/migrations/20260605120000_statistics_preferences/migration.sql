-- CreateTable
CREATE TABLE "StatisticsPagePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "lastConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatisticsPagePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatisticsPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatisticsPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatisticsPagePreference_userId_pageKey_key" ON "StatisticsPagePreference"("userId", "pageKey");

-- CreateIndex
CREATE INDEX "StatisticsPagePreference_userId_idx" ON "StatisticsPagePreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StatisticsPreset_userId_pageKey_name_key" ON "StatisticsPreset"("userId", "pageKey", "name");

-- CreateIndex
CREATE INDEX "StatisticsPreset_userId_pageKey_idx" ON "StatisticsPreset"("userId", "pageKey");

-- AddForeignKey
ALTER TABLE "StatisticsPagePreference" ADD CONSTRAINT "StatisticsPagePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatisticsPreset" ADD CONSTRAINT "StatisticsPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
