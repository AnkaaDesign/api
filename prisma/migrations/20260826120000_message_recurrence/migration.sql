-- Comunicados RECORRENTES: uma regra (MessageSchedule) que gera ocorrências.
--
-- Cada disparo materializa uma linha "Message" nova, e não um "rearme" da mesma
-- linha: MessageView é unique(userId, messageId) e dismissedAt e permanente, de
-- modo que reaproveitar a linha apagaria o historico de leitura e o primeiro
-- "nao mostrar novamente" mataria a recorrencia para sempre. Ver o doc do model
-- em schema.prisma.

CREATE TYPE "MessageTargetType" AS ENUM ('ALL', 'SPECIFIC', 'SECTOR', 'POSITION');

CREATE TABLE "MessageSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    -- modelo publicado a cada disparo
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "isDismissible" BOOLEAN NOT NULL DEFAULT true,
    "requiresView" BOOLEAN NOT NULL DEFAULT false,

    -- publico como REGRA (resolvido no disparo, nunca congelado na criacao)
    "targetType" "MessageTargetType" NOT NULL DEFAULT 'ALL',
    "targetUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetSectorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetPositionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- recorrencia (mesma forma de PpeDeliverySchedule / OrderSchedule)
    "frequency" "ScheduleFrequency" NOT NULL,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER,
    "dayOfWeek" "DayOfWeek",
    "month" "Month",
    "customMonths" "Month"[] DEFAULT ARRAY[]::"Month"[],
    "weeklyConfigId" TEXT,
    "monthlyConfigId" TEXT,
    "yearlyConfigId" TEXT,

    -- janela de exibicao de cada ocorrencia
    "displayDurationDays" INTEGER NOT NULL DEFAULT 7,
    "publishHour" INTEGER NOT NULL DEFAULT 8,

    -- limites
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "maxOccurrences" INTEGER,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,

    -- escrituracao do cron (mesma semantica de OrderSchedule)
    "nextRun" TIMESTAMP(3),
    "lastRun" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "lastRunStatus" "ScheduleRunStatus",
    "lastRunError" TEXT,
    "finishedAt" TIMESTAMP(3),

    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageSchedule_weeklyConfigId_key" ON "MessageSchedule"("weeklyConfigId");
CREATE UNIQUE INDEX "MessageSchedule_monthlyConfigId_key" ON "MessageSchedule"("monthlyConfigId");
CREATE UNIQUE INDEX "MessageSchedule_yearlyConfigId_key" ON "MessageSchedule"("yearlyConfigId");
CREATE INDEX "MessageSchedule_nextRun_idx" ON "MessageSchedule"("nextRun");
CREATE INDEX "MessageSchedule_isActive_idx" ON "MessageSchedule"("isActive");
CREATE INDEX "MessageSchedule_createdById_idx" ON "MessageSchedule"("createdById");

ALTER TABLE "MessageSchedule"
    ADD CONSTRAINT "MessageSchedule_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MessageSchedule"
    ADD CONSTRAINT "MessageSchedule_weeklyConfigId_fkey"
    FOREIGN KEY ("weeklyConfigId") REFERENCES "WeeklyScheduleConfig"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MessageSchedule"
    ADD CONSTRAINT "MessageSchedule_monthlyConfigId_fkey"
    FOREIGN KEY ("monthlyConfigId") REFERENCES "MonthlyScheduleConfig"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MessageSchedule"
    ADD CONSTRAINT "MessageSchedule_yearlyConfigId_fkey"
    FOREIGN KEY ("yearlyConfigId") REFERENCES "YearlyScheduleConfig"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Busca acento-insensivel, mesmo padrao das demais tabelas
-- (immutable_unaccent criada em 20260624150000_accent_insensitive_search).
ALTER TABLE "MessageSchedule"
    ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
    ADD COLUMN IF NOT EXISTS "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("title"))) STORED;

CREATE INDEX IF NOT EXISTS "MessageSchedule_nameNormalized_trgm_idx"
    ON "MessageSchedule" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "MessageSchedule_titleNormalized_trgm_idx"
    ON "MessageSchedule" USING gin ("titleNormalized" gin_trgm_ops);

-- A ocorrencia aponta de volta para a regra que a gerou.
ALTER TABLE "Message" ADD COLUMN "scheduleId" TEXT;
ALTER TABLE "Message" ADD COLUMN "occurrenceDate" TIMESTAMP(3);

-- SET NULL, jamais CASCADE: apagar o agendamento nao pode apagar comunicado que
-- gente ja leu. A ocorrencia so deixa de ter mae e vira mensagem avulsa.
ALTER TABLE "Message"
    ADD CONSTRAINT "Message_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "MessageSchedule"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Anteparo de idempotencia do cron: o @Cron e registrado em TODO worker do
-- cluster, entao dois processos podem tentar materializar a mesma data no mesmo
-- tick. O segundo bate aqui (P2002) e desiste.
--
-- Toda mensagem escrita a mao tem as duas colunas NULL, e o Postgres trata NULL
-- como DISTINTO em indice unico: as linhas existentes nao colidem entre si.
-- Por isso NAO se usa NULLS NOT DISTINCT.
CREATE UNIQUE INDEX "Message_scheduleId_occurrenceDate_key"
    ON "Message"("scheduleId", "occurrenceDate");
CREATE INDEX "Message_scheduleId_idx" ON "Message"("scheduleId");
