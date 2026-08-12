-- Aerografia: forma de pagamento + vencimento configurável.
--
-- Até aqui o vencimento de uma aerografia era CALCULADO em memória por
-- OrderService.airbrushingPayableDue() com um prazo fixo de 7 dias, e a coluna
-- "Forma" de Contas a Pagar era sempre "-". Agora a regra é por aerografia e o
-- vencimento resultante é materializado em "dueDate", que é o que Contas a Pagar lê.

CREATE TYPE "AirbrushingDueDateRule" AS ENUM ('DAYS_AFTER_FINISH', 'DAY_OF_MONTH', 'FIXED_DATE');

ALTER TABLE "Airbrushing"
  ADD COLUMN "paymentMethod"   "PaymentMethod",
  ADD COLUMN "dueDateRule"     "AirbrushingDueDateRule" NOT NULL DEFAULT 'DAYS_AFTER_FINISH',
  ADD COLUMN "paymentTermDays" INTEGER,
  ADD COLUMN "dueDayOfMonth"   INTEGER,
  ADD COLUMN "dueDate"         TIMESTAMP(3);

-- 1-31, truncado ao último dia do mês em tempo de cálculo (mesma convenção de
-- RecurrentPayable.dueDayOfMonth). O CHECK só barra o que nunca é válido.
ALTER TABLE "Airbrushing"
  ADD CONSTRAINT "Airbrushing_dueDayOfMonth_range"
  CHECK ("dueDayOfMonth" IS NULL OR ("dueDayOfMonth" >= 1 AND "dueDayOfMonth" <= 31));

ALTER TABLE "Airbrushing"
  ADD CONSTRAINT "Airbrushing_paymentTermDays_range"
  CHECK ("paymentTermDays" IS NULL OR ("paymentTermDays" >= 0 AND "paymentTermDays" <= 365));

-- Backfill: reproduz EXATAMENTE o cálculo legado (término + 7 dias às 18:00 SP =
-- 21:00 UTC, Brasil sem horário de verão desde 2019), para que nenhuma linha de
-- Contas a Pagar mude de vencimento por causa desta migração. As colunas são
-- TIMESTAMP sem timezone guardando UTC, daí o duplo AT TIME ZONE.
UPDATE "Airbrushing"
SET "dueDate" = (
      (
        date_trunc(
          'day',
          COALESCE("finishedAt", "finishDate") AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'
        )
        + INTERVAL '7 days'
        + INTERVAL '18 hours'
      ) AT TIME ZONE 'America/Sao_Paulo'
    ) AT TIME ZONE 'UTC'
WHERE COALESCE("finishedAt", "finishDate") IS NOT NULL;
