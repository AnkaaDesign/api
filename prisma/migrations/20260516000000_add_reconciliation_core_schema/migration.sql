-- Core reconciliation schema: enums, BankStatement, BankTransaction,
-- FiscalDocument, ReconciliationMatch, and ReconciliationRun.
-- ReconciliationAlias is added in the next migration (20260516120000).

-- Enums
CREATE TYPE "BankTransactionType" AS ENUM ('CREDIT', 'DEBIT');

CREATE TYPE "BankTransactionSubtype" AS ENUM (
  'PIX', 'TED', 'DOC', 'BOLETO', 'TARIFA', 'IOF',
  'CARTAO', 'TRANSFERENCIA', 'ESTORNO', 'RENDIMENTO', 'OUTROS'
);

CREATE TYPE "ReconciliationMatchStatus" AS ENUM (
  'UNMATCHED', 'AUTO_MATCHED', 'MANUAL_MATCHED', 'PARTIAL', 'IGNORED', 'DISPUTED'
);

CREATE TYPE "ReconciliationMatchType" AS ENUM (
  'EXACT', 'VALUE_DATE', 'FUZZY', 'MANUAL', 'BANK_SLIP_BRIDGE'
);

CREATE TYPE "FiscalDocumentType" AS ENUM ('NFE', 'NFSE', 'CTE', 'NFCE', 'CFE');

CREATE TYPE "FiscalDocumentOperation" AS ENUM ('ENTRADA', 'SAIDA');

CREATE TYPE "FiscalDocumentStatus" AS ENUM ('AUTHORIZED', 'CANCELLED', 'DENIED', 'PENDING');

CREATE TYPE "BankStatementImportStatus" AS ENUM (
  'PENDING', 'PARSING', 'MATCHING', 'COMPLETED', 'FAILED'
);

CREATE TYPE "BankStatementSource" AS ENUM ('OFX_SICREDI', 'MANUAL');

CREATE TYPE "FiscalDocumentSource" AS ENUM ('SIEG_API', 'MANUAL_UPLOAD');

CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

CREATE TYPE "ReconciliationRunTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'IMPORT', 'WEBHOOK');

-- BankStatement
CREATE TABLE "BankStatement" (
    "id"               TEXT NOT NULL,
    "source"           "BankStatementSource" NOT NULL DEFAULT 'OFX_SICREDI',
    "bankCode"         TEXT NOT NULL,
    "bankName"         TEXT NOT NULL,
    "agency"           TEXT NOT NULL,
    "accountNumber"    TEXT NOT NULL,
    "ownerCnpj"        TEXT NOT NULL,
    "rawFileId"        TEXT,
    "periodStart"      TIMESTAMP(3) NOT NULL,
    "periodEnd"        TIMESTAMP(3) NOT NULL,
    "openingBalance"   DECIMAL(14, 2),
    "closingBalance"   DECIMAL(14, 2),
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "totalCredits"     DECIMAL(14, 2) NOT NULL DEFAULT 0,
    "totalDebits"      DECIMAL(14, 2) NOT NULL DEFAULT 0,
    "matchedCount"     INTEGER NOT NULL DEFAULT 0,
    "status"           "BankStatementImportStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage"     TEXT,
    "uploadedById"     TEXT,
    "importedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankStatement_periodStart_periodEnd_idx" ON "BankStatement"("periodStart", "periodEnd");
CREATE INDEX "BankStatement_status_idx" ON "BankStatement"("status");

ALTER TABLE "BankStatement"
    ADD CONSTRAINT "BankStatement_rawFileId_fkey"
    FOREIGN KEY ("rawFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankStatement"
    ADD CONSTRAINT "BankStatement_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BankTransaction
CREATE TABLE "BankTransaction" (
    "id"                  TEXT NOT NULL,
    "statementId"         TEXT NOT NULL,
    "fitId"               TEXT NOT NULL,
    "postedAt"            TIMESTAMP(3) NOT NULL,
    "amount"              DECIMAL(14, 2) NOT NULL,
    "type"                "BankTransactionType" NOT NULL,
    "subtype"             "BankTransactionSubtype" NOT NULL DEFAULT 'OUTROS',
    "rawTrnType"          TEXT,
    "memo"                TEXT,
    "counterpartyCnpjCpf" TEXT,
    "counterpartyName"    TEXT,
    "runningBalance"      DECIMAL(14, 2),
    "matchStatus"         "ReconciliationMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "ignoredReason"       TEXT,
    "bankSlipId"          TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankTransaction_statementId_fitId_key" ON "BankTransaction"("statementId", "fitId");
CREATE INDEX "BankTransaction_postedAt_idx" ON "BankTransaction"("postedAt");
CREATE INDEX "BankTransaction_matchStatus_idx" ON "BankTransaction"("matchStatus");
CREATE INDEX "BankTransaction_counterpartyCnpjCpf_idx" ON "BankTransaction"("counterpartyCnpjCpf");
CREATE INDEX "BankTransaction_amount_idx" ON "BankTransaction"("amount");

ALTER TABLE "BankTransaction"
    ADD CONSTRAINT "BankTransaction_statementId_fkey"
    FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankTransaction"
    ADD CONSTRAINT "BankTransaction_bankSlipId_fkey"
    FOREIGN KEY ("bankSlipId") REFERENCES "BankSlip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FiscalDocument
CREATE TABLE "FiscalDocument" (
    "id"             TEXT NOT NULL,
    "accessKey"      TEXT NOT NULL,
    "docType"        "FiscalDocumentType" NOT NULL,
    "operationType"  "FiscalDocumentOperation" NOT NULL,
    "status"         "FiscalDocumentStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "source"         "FiscalDocumentSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "issueDate"      TIMESTAMP(3) NOT NULL,
    "totalValue"     DECIMAL(14, 2) NOT NULL,
    "emitCnpj"       TEXT NOT NULL,
    "emitName"       TEXT,
    "destCnpj"       TEXT,
    "destCpf"        TEXT,
    "destName"       TEXT,
    "nfNumber"       TEXT,
    "paymentMethods" JSONB,
    "siegId"         TEXT,
    "rawXmlFileId"   TEXT,
    "fetchedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalDocument_accessKey_key" ON "FiscalDocument"("accessKey");
CREATE INDEX "FiscalDocument_docType_idx" ON "FiscalDocument"("docType");
CREATE INDEX "FiscalDocument_operationType_idx" ON "FiscalDocument"("operationType");
CREATE INDEX "FiscalDocument_issueDate_idx" ON "FiscalDocument"("issueDate");
CREATE INDEX "FiscalDocument_emitCnpj_issueDate_idx" ON "FiscalDocument"("emitCnpj", "issueDate");
CREATE INDEX "FiscalDocument_destCnpj_issueDate_idx" ON "FiscalDocument"("destCnpj", "issueDate");
CREATE INDEX "FiscalDocument_status_idx" ON "FiscalDocument"("status");

ALTER TABLE "FiscalDocument"
    ADD CONSTRAINT "FiscalDocument_rawXmlFileId_fkey"
    FOREIGN KEY ("rawXmlFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ReconciliationMatch
CREATE TABLE "ReconciliationMatch" (
    "id"               TEXT NOT NULL,
    "transactionId"    TEXT NOT NULL,
    "fiscalDocumentId" TEXT,
    "bankSlipId"       TEXT,
    "allocatedAmount"  DECIMAL(14, 2) NOT NULL,
    "matchType"        "ReconciliationMatchType" NOT NULL,
    "confidenceScore"  INTEGER NOT NULL DEFAULT 100,
    "matchedByUserId"  TEXT,
    "notes"            TEXT,
    "matchedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt"       TIMESTAMP(3),
    "reversedById"     TEXT,
    CONSTRAINT "ReconciliationMatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReconciliationMatch_transactionId_fiscalDocumentId_key"
    ON "ReconciliationMatch"("transactionId", "fiscalDocumentId");
CREATE INDEX "ReconciliationMatch_transactionId_idx" ON "ReconciliationMatch"("transactionId");
CREATE INDEX "ReconciliationMatch_fiscalDocumentId_idx" ON "ReconciliationMatch"("fiscalDocumentId");
CREATE INDEX "ReconciliationMatch_bankSlipId_idx" ON "ReconciliationMatch"("bankSlipId");
CREATE INDEX "ReconciliationMatch_matchType_idx" ON "ReconciliationMatch"("matchType");

ALTER TABLE "ReconciliationMatch"
    ADD CONSTRAINT "ReconciliationMatch_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReconciliationMatch"
    ADD CONSTRAINT "ReconciliationMatch_fiscalDocumentId_fkey"
    FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReconciliationMatch"
    ADD CONSTRAINT "ReconciliationMatch_bankSlipId_fkey"
    FOREIGN KEY ("bankSlipId") REFERENCES "BankSlip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReconciliationMatch"
    ADD CONSTRAINT "ReconciliationMatch_matchedByUserId_fkey"
    FOREIGN KEY ("matchedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReconciliationMatch"
    ADD CONSTRAINT "ReconciliationMatch_reversedById_fkey"
    FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ReconciliationRun
CREATE TABLE "ReconciliationRun" (
    "id"            TEXT NOT NULL,
    "trigger"       "ReconciliationRunTrigger" NOT NULL,
    "status"        "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "statementId"   TEXT,
    "dateStart"     TIMESTAMP(3),
    "dateEnd"       TIMESTAMP(3),
    "triggeredById" TEXT,
    "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"    TIMESTAMP(3),
    "stats"         JSONB,
    "errorMessage"  TEXT,
    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReconciliationRun_status_idx" ON "ReconciliationRun"("status");
CREATE INDEX "ReconciliationRun_startedAt_idx" ON "ReconciliationRun"("startedAt");

ALTER TABLE "ReconciliationRun"
    ADD CONSTRAINT "ReconciliationRun_triggeredById_fkey"
    FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
