-- Preferences.pricesVisibleByDefault — "Mostrar valores por padrão", por usuário.
--
-- O olho da barra lateral (mostrar/ocultar valores) nunca foi persistido de propósito:
-- ele volta a OCULTO a cada recarga e a cada navegação. Quem trabalha o dia inteiro em
-- telas financeiras precisava clicar no olho em toda página. Esta coluna guarda apenas o
-- PADRÃO — o estado atual continua em memória e continua sendo redefinido para este
-- padrão a cada navegação/recarga.
--
--   false (comportamento atual, mantido para todo mundo) = começa OCULTO, o olho revela.
--   true                                                 = começa VISÍVEL, o olho oculta.
--
-- Escrita à mão de propósito: `prisma migrate dev` autogera um diff que DERRUBA
-- 16 índices trigram e 96 colunas geradas deste schema.

ALTER TABLE "Preferences"
  ADD COLUMN IF NOT EXISTS "pricesVisibleByDefault" BOOLEAN NOT NULL DEFAULT false;
