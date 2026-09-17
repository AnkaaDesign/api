-- A FATURA NÃO MORRE COM O VEÍCULO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `Invoice.taskId` era `ON DELETE CASCADE`. Isso quer dizer que um
-- `DELETE /tasks/:id` — a lixeira da tela de tarefas, ou a exclusão em lote —
-- apagava a FATURA emitida sobre aquele caminhão, e com ela as parcelas, o
-- vínculo do boleto registrado no Sicredi e a referência da NFS-e autorizada na
-- prefeitura. Nada no código impedia: a exclusão de tarefa consultava apenas a
-- guarda de ASSINATURA (`findProtectedTaskIds`); `isQuoteMoneyLocked` jamais era
-- chamada em caminho de exclusão. E a guarda que existe justamente para recusar
-- isto — `orphanedFrozen`, na reconciliação de faturamentos — ficava cega,
-- porque quando ela roda a linha de cobertura (`BillingTask`, também `CASCADE`)
-- já foi apagada pelo banco.
--
-- No clone de produção de 17/09 eram 159 veículos alcançáveis por esse caminho,
-- levando 159 faturas VIVAS (nenhuma cancelada).
--
-- É a MESMA decisão que o P0 tomou para as outras FKs de dinheiro
-- (`Invoice.customerConfigId`, `Installment`, `BankSlip`): dinheiro emitido não
-- é apagado por efeito colateral. Quem quiser excluir o veículo reverte o
-- faturamento primeiro — e aí a reversão apaga a fatura explicitamente, que é o
-- caminho em que alguém decidiu.
--
-- `BillingTask.taskId` CONTINUA `CASCADE`, de propósito: a linha de cobertura
-- afirma "este faturamento cobra este veículo", e sem o veículo ela não tem
-- sujeito. O que a protege é a guarda em código (`findMoneyLockedTaskIds`) mais
-- este `RESTRICT`, que é a rede para todo caminho que não passe por ela.
--
-- Nenhuma linha de dados muda. Nada é apagado, nada é reescrito: só a regra de
-- integridade referencial. É reversível trocando `RESTRICT` de volta.

ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_taskId_fkey";

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
