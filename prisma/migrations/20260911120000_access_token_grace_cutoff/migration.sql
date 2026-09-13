-- Piso para o aceite de access token vencido (janela de carência do AuthGuard).
-- Um logout carimba now() aqui, e nenhum token emitido antes volta a ser aceito.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessGraceCutoffAt" TIMESTAMP(3);
