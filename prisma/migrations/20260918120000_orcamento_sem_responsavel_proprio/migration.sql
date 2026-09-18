-- O ORÇAMENTO NÃO TEM MAIS UM RESPONSÁVEL PRÓPRIO.
--
-- `BudgetPayer.responsibleId` nasceu para resolver um problema que deixou de
-- existir: quando a tarefa tinha vários responsáveis, era preciso eleger UM para
-- endereçar o documento ("À Kennedy de Campos") e para a cobrança citar. Hoje o
-- orçamento é endereçado a quem vai assiná-lo, e quem assina é escolhido no
-- envio para assinatura — todos os responsáveis da tarefa são responsáveis pelo
-- orçamento. Eleger um segundo dono em outra tela era guardar duas versões da
-- mesma verdade, e a coluna divergia da lista sem nada acusar.
--
-- O CONTATO DA NFS-E não se perde: `buildNfseCustomer` já ordenava os
-- responsáveis do cliente por função (financeiro primeiro) e só usava esta
-- coluna como preferência à frente daquela ordem. Sem ela, o telefone e o
-- e-mail do tomador saem do cadastro do cliente e, na falta, do contato
-- financeiro — que é a regra que se queria desde o começo.
ALTER TABLE "BudgetPayer" DROP CONSTRAINT IF EXISTS "BudgetPayer_responsibleId_fkey";
DROP INDEX IF EXISTS "BudgetPayer_responsibleId_idx";
ALTER TABLE "BudgetPayer" DROP COLUMN IF EXISTS "responsibleId";
