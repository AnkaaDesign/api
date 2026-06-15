-- Cancelamento de admissão/rescisão: preserva a etapa em que o processo estava
-- ao ser cancelado (cancelledFromStatus) e a justificativa do porquê não foi
-- concluído (cancellationReason). Em Termination, cancellationReason é distinto
-- de `reason` (que é o motivo da rescisão em si).

-- Admission
ALTER TABLE "Admission"
  ADD COLUMN "cancelledFromStatus" "AdmissionStatus",
  ADD COLUMN "cancellationReason"  TEXT;

-- Termination
ALTER TABLE "Termination"
  ADD COLUMN "cancelledFromStatus" "TerminationStatus",
  ADD COLUMN "cancellationReason"  TEXT;
