-- Reconciliation self-learning layer: counterparty / memo-token / NF-emitter
-- learners + recurrence + the fusion-decision audit log. Purely additive
-- (no drops), so it is safe to apply on top of the existing taxonomy schema.

-- CreateEnum
CREATE TYPE "LearnedRuleSource" AS ENUM ('MANUAL', 'AUTO', 'ADMIN_SEEDED');
CREATE TYPE "CategoryDecisionTier" AS ENUM ('AUTO_APPLY', 'SUGGEST', 'ABSTAIN');

-- AlterTable: BankTransaction SUGGEST-tier output columns
ALTER TABLE "BankTransaction" ADD COLUMN "suggestedCategoryId" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "suggestionConfidence" INTEGER;
ALTER TABLE "BankTransaction" ADD COLUMN "suggestionProvenance" JSONB;

-- CreateTable: CounterpartyCategoryRule
CREATE TABLE "CounterpartyCategoryRule" (
    "id" TEXT NOT NULL,
    "counterpartyCnpjCpf" TEXT NOT NULL,
    "txType" "BankTransactionType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "LearnedRuleSource" NOT NULL,
    "confirmedCount" INTEGER NOT NULL DEFAULT 1,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CounterpartyCategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CounterpartyProfile
CREATE TABLE "CounterpartyProfile" (
    "id" TEXT NOT NULL,
    "nameFingerprint" TEXT NOT NULL,
    "counterpartyCnpjCpf" TEXT NOT NULL,
    "displayName" TEXT,
    "source" "LearnedRuleSource" NOT NULL,
    "confirmedCount" INTEGER NOT NULL DEFAULT 1,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CounterpartyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MemoTokenWeight
CREATE TABLE "MemoTokenWeight" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "LearnedRuleSource" NOT NULL DEFAULT 'AUTO',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "negWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoTokenWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MemoTokenStat
CREATE TABLE "MemoTokenStat" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "categoryCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoTokenStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmitterCategoryPrior
CREATE TABLE "EmitterCategoryPrior" (
    "id" TEXT NOT NULL,
    "emitterCnpj" TEXT NOT NULL,
    "emitterRoot" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryKind" "TransactionCategoryKind" NOT NULL,
    "source" "LearnedRuleSource" NOT NULL DEFAULT 'AUTO',
    "confirmedCount" INTEGER NOT NULL DEFAULT 1,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmitterCategoryPrior_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CounterpartyCadence
CREATE TABLE "CounterpartyCadence" (
    "id" TEXT NOT NULL,
    "counterpartyKey" TEXT NOT NULL,
    "counterpartyLabel" TEXT,
    "categoryId" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "meanPeriodDays" DOUBLE PRECISION,
    "periodVarianceDays" DOUBLE PRECISION,
    "expectedAmount" DECIMAL(14,2),
    "amountVariance" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMP(3),
    "lastAmount" DECIMAL(14,2),
    "isLearnedRecurring" BOOLEAN NOT NULL DEFAULT false,
    "periodCv" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CounterpartyCadence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CadenceObservation
CREATE TABLE "CadenceObservation" (
    "id" TEXT NOT NULL,
    "cadenceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CadenceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CategoryDecisionLog
CREATE TABLE "CategoryDecisionLog" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "tier" "CategoryDecisionTier" NOT NULL,
    "categoryId" TEXT,
    "confidence" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "winners" JSONB NOT NULL,
    "event" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CategoryDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CounterpartyCategoryRule_counterpartyCnpjCpf_txType_key" ON "CounterpartyCategoryRule"("counterpartyCnpjCpf", "txType");
CREATE INDEX "CounterpartyCategoryRule_counterpartyCnpjCpf_idx" ON "CounterpartyCategoryRule"("counterpartyCnpjCpf");
CREATE INDEX "CounterpartyCategoryRule_categoryId_idx" ON "CounterpartyCategoryRule"("categoryId");
CREATE INDEX "CounterpartyCategoryRule_disabledAt_idx" ON "CounterpartyCategoryRule"("disabledAt");

CREATE UNIQUE INDEX "CounterpartyProfile_nameFingerprint_counterpartyCnpjCpf_key" ON "CounterpartyProfile"("nameFingerprint", "counterpartyCnpjCpf");
CREATE INDEX "CounterpartyProfile_nameFingerprint_idx" ON "CounterpartyProfile"("nameFingerprint");
CREATE INDEX "CounterpartyProfile_counterpartyCnpjCpf_idx" ON "CounterpartyProfile"("counterpartyCnpjCpf");
CREATE INDEX "CounterpartyProfile_disabledAt_idx" ON "CounterpartyProfile"("disabledAt");

CREATE UNIQUE INDEX "MemoTokenWeight_token_categoryId_key" ON "MemoTokenWeight"("token", "categoryId");
CREATE INDEX "MemoTokenWeight_token_idx" ON "MemoTokenWeight"("token");
CREATE INDEX "MemoTokenWeight_categoryId_idx" ON "MemoTokenWeight"("categoryId");
CREATE INDEX "MemoTokenWeight_disabledAt_idx" ON "MemoTokenWeight"("disabledAt");

CREATE UNIQUE INDEX "MemoTokenStat_token_key" ON "MemoTokenStat"("token");
CREATE INDEX "MemoTokenStat_token_idx" ON "MemoTokenStat"("token");

CREATE UNIQUE INDEX "EmitterCategoryPrior_emitterCnpj_categoryId_key" ON "EmitterCategoryPrior"("emitterCnpj", "categoryId");
CREATE INDEX "EmitterCategoryPrior_emitterCnpj_idx" ON "EmitterCategoryPrior"("emitterCnpj");
CREATE INDEX "EmitterCategoryPrior_emitterRoot_idx" ON "EmitterCategoryPrior"("emitterRoot");
CREATE INDEX "EmitterCategoryPrior_categoryId_idx" ON "EmitterCategoryPrior"("categoryId");
CREATE INDEX "EmitterCategoryPrior_disabledAt_idx" ON "EmitterCategoryPrior"("disabledAt");

CREATE UNIQUE INDEX "CounterpartyCadence_counterpartyKey_categoryId_key" ON "CounterpartyCadence"("counterpartyKey", "categoryId");
CREATE INDEX "CounterpartyCadence_categoryId_idx" ON "CounterpartyCadence"("categoryId");
CREATE INDEX "CounterpartyCadence_isLearnedRecurring_idx" ON "CounterpartyCadence"("isLearnedRecurring");
CREATE INDEX "CounterpartyCadence_lastSeenAt_idx" ON "CounterpartyCadence"("lastSeenAt");

CREATE UNIQUE INDEX "CadenceObservation_cadenceId_transactionId_key" ON "CadenceObservation"("cadenceId", "transactionId");
CREATE INDEX "CadenceObservation_cadenceId_idx" ON "CadenceObservation"("cadenceId");
CREATE INDEX "CadenceObservation_transactionId_idx" ON "CadenceObservation"("transactionId");

CREATE INDEX "CategoryDecisionLog_transactionId_createdAt_idx" ON "CategoryDecisionLog"("transactionId", "createdAt");
CREATE INDEX "CategoryDecisionLog_tier_idx" ON "CategoryDecisionLog"("tier");

CREATE INDEX "BankTransaction_suggestedCategoryId_idx" ON "BankTransaction"("suggestedCategoryId");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CounterpartyCategoryRule" ADD CONSTRAINT "CounterpartyCategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoTokenWeight" ADD CONSTRAINT "MemoTokenWeight_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmitterCategoryPrior" ADD CONSTRAINT "EmitterCategoryPrior_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CounterpartyCadence" ADD CONSTRAINT "CounterpartyCadence_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CadenceObservation" ADD CONSTRAINT "CadenceObservation_cadenceId_fkey" FOREIGN KEY ("cadenceId") REFERENCES "CounterpartyCadence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CadenceObservation" ADD CONSTRAINT "CadenceObservation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CategoryDecisionLog" ADD CONSTRAINT "CategoryDecisionLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: migrate the hardcoded COUNTERPARTY_CATEGORY_RULES into the learnable
-- table as ADMIN_SEEDED so day-one behavior is preserved while the hardcodes can
-- be retired. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO "CounterpartyCategoryRule"
    ("id","counterpartyCnpjCpf","txType","categoryId","source","confirmedCount","rejectedCount","firstObservedAt","lastConfirmedAt","createdAt","updatedAt")
SELECT gen_random_uuid(), v.cnpj, 'DEBIT'::"BankTransactionType", tc."id", 'ADMIN_SEEDED'::"LearnedRuleSource", 1, 0, now(), now(), now(), now()
FROM (VALUES
    ('06856214995','pro-labore'),
    ('07332960923','pro-labore'),
    ('33034206968','aluguel'),
    ('70564949949','aluguel')
) AS v(cnpj, slug)
JOIN "TransactionCategory" tc ON tc."slug" = v.slug
ON CONFLICT ("counterpartyCnpjCpf","txType") DO NOTHING;
