-- Best candidate confidence recorded by the matcher when an auto-match did not
-- succeed, so the transactions list can show "Pendente · 40%" for triage.
ALTER TABLE "BankTransaction" ADD COLUMN "topMatchScore" INTEGER;
