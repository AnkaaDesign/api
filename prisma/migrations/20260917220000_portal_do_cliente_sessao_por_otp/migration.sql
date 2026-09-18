-- PORTAL DO CLIENTE — o responsavel passa a ter sessao, e deixa de ter senha.
--
-- As quatro colunas de credencial abaixo sao apagadas. Isto foi conferido
-- contra a producao antes de escrever a migration:
--
--   SELECT count(*) FILTER (WHERE password IS NOT NULL),          -- 0
--          count(*) FILTER (WHERE "sessionToken" IS NOT NULL),    -- 0
--          count(*) FILTER (WHERE "resetToken" IS NOT NULL),      -- 0
--          count(*) FILTER (WHERE verified),                      -- 0
--          count(*) FILTER (WHERE "lastLoginAt" IS NOT NULL),     -- 0
--          count(*)                                               -- 183
--     FROM "Representative";
--
-- Nenhum dado se perde: o login de senha nunca foi usado uma unica vez. O que
-- se perde e' a superficie — um hash bcrypt que ninguem consegue usar e um
-- token de sessao que guarda nenhuma le sao passivo puro, ainda mais porque o
-- `omit` global do Prisma cobria `User` e esquecia `Responsible`, fazendo
-- `GET /responsibles` (rota sem @Roles) devolver os dois a qualquer funcionario.

ALTER TABLE "Representative" DROP COLUMN IF EXISTS "password";
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "verificationCode";
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "verificationExpiresAt";
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "sessionToken";
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "resetToken";
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "resetTokenExpiry";

-- `verified` e `lastLoginAt` PERMANECEM: deixam de ser pre-requisito de senha e
-- passam a registrar que este contato ja concluiu uma sessao por OTP.

CREATE TYPE "ResponsibleAuthChallengeStatus" AS ENUM ('PENDING', 'CONSUMED', 'LOCKED', 'EXPIRED', 'SUPERSEDED');

CREATE TABLE "ResponsibleAuthChallenge" (
    "id" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destinationMask" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" "ResponsibleAuthChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResponsibleAuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResponsibleAuthChallenge_responsibleId_status_idx" ON "ResponsibleAuthChallenge"("responsibleId", "status");
CREATE INDEX "ResponsibleAuthChallenge_expiresAt_idx" ON "ResponsibleAuthChallenge"("expiresAt");

ALTER TABLE "ResponsibleAuthChallenge"
  ADD CONSTRAINT "ResponsibleAuthChallenge_responsibleId_fkey"
  FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ResponsibleSession" (
    "id" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResponsibleSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResponsibleSession_tokenHash_key" ON "ResponsibleSession"("tokenHash");
CREATE INDEX "ResponsibleSession_responsibleId_revokedAt_idx" ON "ResponsibleSession"("responsibleId", "revokedAt");
CREATE INDEX "ResponsibleSession_expiresAt_idx" ON "ResponsibleSession"("expiresAt");

ALTER TABLE "ResponsibleSession"
  ADD CONSTRAINT "ResponsibleSession_responsibleId_fkey"
  FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
