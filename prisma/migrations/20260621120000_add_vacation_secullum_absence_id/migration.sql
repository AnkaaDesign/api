-- Hide the [ANKAA-VAC:..] sentinel from the Secullum afastamento Motivo by
-- persisting the mirrored afastamento id on the Vacation. Reconciliation/removal
-- now use this id instead of parsing the Motivo, so the Motivo stays human-clean
-- ("Férias (Ankaa)"). Legacy tagged afastamentos keep working via fallback.
ALTER TABLE "Vacation" ADD COLUMN "secullumAbsenceId" INTEGER;
