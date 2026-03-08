-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BankSlipStatus" AS ENUM ('CREATING', 'ACTIVE', 'OVERDUE', 'PAID', 'CANCELLED', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "NfseStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "BankSlipType" AS ENUM ('NORMAL', 'HIBRIDO');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "TaskPricingCustomerConfig" ADD COLUMN "paymentMethod" "PaymentMethod";

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "customerConfigId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod",
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "installmentCount" INTEGER NOT NULL DEFAULT 1,
    "downPaymentDate" TIMESTAMP(3),
    "paymentCondition" "PaymentCondition",
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankSlip" (
    "id" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "nossoNumero" TEXT NOT NULL,
    "seuNumero" TEXT,
    "barcode" TEXT,
    "digitableLine" TEXT,
    "pixQrCode" TEXT,
    "txid" TEXT,
    "type" "BankSlipType" NOT NULL DEFAULT 'HIBRIDO',
    "amount" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BankSlipStatus" NOT NULL DEFAULT 'CREATING',
    "sicrediStatus" TEXT,
    "pdfFileId" TEXT,
    "paidAmount" DECIMAL(10,2),
    "paidAt" TIMESTAMP(3),
    "liquidationData" JSONB,
    "errorMessage" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankSlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NfseDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "nfseNumber" TEXT,
    "verificationCode" TEXT,
    "xml" TEXT,
    "status" "NfseStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "retryAfter" TIMESTAMP(3),
    "municipalServiceCode" TEXT,
    "description" TEXT,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "issRate" DECIMAL(5,4),
    "issAmount" DECIMAL(10,2),
    "pdfFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NfseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SicrediToken" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "expiresIn" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresIn" INTEGER,
    "refreshExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "identifier" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SicrediToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SicrediWebhookEvent" (
    "id" TEXT NOT NULL,
    "idEventoWebhook" TEXT NOT NULL,
    "nossoNumero" TEXT NOT NULL,
    "movimento" TEXT NOT NULL,
    "valorLiquidacao" DECIMAL(10,2),
    "valorDesconto" DECIMAL(10,2),
    "valorJuros" DECIMAL(10,2),
    "valorMulta" DECIMAL(10,2),
    "valorAbatimento" DECIMAL(10,2),
    "dataEvento" TIMESTAMP(3),
    "dataPrevisaoPagamento" TIMESTAMP(3),
    "agencia" TEXT,
    "posto" TEXT,
    "beneficiario" TEXT,
    "carteira" TEXT,
    "rawPayload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SicrediWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_customerConfigId_key" ON "Invoice"("customerConfigId");
CREATE INDEX "Invoice_taskId_idx" ON "Invoice"("taskId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_invoiceId_number_key" ON "Installment"("invoiceId", "number");
CREATE INDEX "Installment_invoiceId_idx" ON "Installment"("invoiceId");
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");
CREATE INDEX "Installment_status_idx" ON "Installment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BankSlip_installmentId_key" ON "BankSlip"("installmentId");
CREATE UNIQUE INDEX "BankSlip_nossoNumero_key" ON "BankSlip"("nossoNumero");
CREATE INDEX "BankSlip_nossoNumero_idx" ON "BankSlip"("nossoNumero");
CREATE INDEX "BankSlip_status_idx" ON "BankSlip"("status");
CREATE INDEX "BankSlip_dueDate_idx" ON "BankSlip"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "NfseDocument_invoiceId_key" ON "NfseDocument"("invoiceId");
CREATE INDEX "NfseDocument_invoiceId_idx" ON "NfseDocument"("invoiceId");
CREATE INDEX "NfseDocument_nfseNumber_idx" ON "NfseDocument"("nfseNumber");
CREATE INDEX "NfseDocument_status_idx" ON "NfseDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SicrediToken_identifier_key" ON "SicrediToken"("identifier");
CREATE INDEX "SicrediToken_expiresAt_idx" ON "SicrediToken"("expiresAt");
CREATE INDEX "SicrediToken_identifier_idx" ON "SicrediToken"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "SicrediWebhookEvent_idEventoWebhook_key" ON "SicrediWebhookEvent"("idEventoWebhook");
CREATE INDEX "SicrediWebhookEvent_nossoNumero_idx" ON "SicrediWebhookEvent"("nossoNumero");
CREATE INDEX "SicrediWebhookEvent_status_idx" ON "SicrediWebhookEvent"("status");
CREATE INDEX "SicrediWebhookEvent_dataEvento_idx" ON "SicrediWebhookEvent"("dataEvento");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerConfigId_fkey" FOREIGN KEY ("customerConfigId") REFERENCES "TaskPricingCustomerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankSlip" ADD CONSTRAINT "BankSlip_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankSlip" ADD CONSTRAINT "BankSlip_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfseDocument" ADD CONSTRAINT "NfseDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NfseDocument" ADD CONSTRAINT "NfseDocument_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
