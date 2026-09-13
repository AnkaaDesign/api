-- O ORÇAMENTO GANHA DOIS ESTADOS QUE JÁ EXISTIAM NA VIDA REAL E NÃO NO BANCO.
--
-- SIGNED — todos os responsáveis do CLIENTE assinaram e falta só a
--   contra-assinatura da Ankaa. Até aqui esse momento era indistinguível de
--   "acabou de ser criado": os dois eram PENDING. Quem precisa saber o que
--   depende de NÓS não tinha como olhar uma lista e ver.
--
-- EXPIRED — passou da validade (`expiresAt`) sem colher todas as assinaturas.
--   `SignatureEnvelope` já expirava de hora em hora desde sempre; o ORÇAMENTO
--   não. Ele ficava PENDING para sempre, misturado com os recém-criados, e
--   ninguém no comercial era avisado de que havia um valor para reanalisar.
--
--   ⚠️ NÃO confundir com `DUE`, que na tela se chama "Vencido" e é OUTRA coisa:
--   parcela vencida, assunto do financeiro, orçamento já aprovado e faturado.
--   Por isso o rótulo de `EXPIRED` é "Aguardando Reanálise" — diz o que o
--   comercial tem de fazer, e não repete uma palavra que já está ocupada.
--
-- `ADD VALUE` é permitido dentro de transação no PG 12+ desde que o valor novo
-- não seja USADO na mesma transação. Esta migração só declara; quem escreve os
-- estados é o código.
ALTER TYPE "TaskQuoteStatus" ADD VALUE IF NOT EXISTS 'SIGNED';
ALTER TYPE "TaskQuoteStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- ESTADO DE AGENDAMENTO DO LEMBRETE, no SIGNATÁRIO.
--
-- A cadência é "os 3 primeiros dias úteis após o convite, depois de 5 em 5
-- dias". Ela é ancorada no ÚLTIMO lembrete enviado, e não numa contagem de dias
-- desde a emissão, de propósito: se a API ficar fora do ar numa quinta, o
-- agendador não dispara dois lembretes na sexta para compensar, e ninguém
-- recebe duas mensagens iguais com minutos de diferença.
--
-- Colunas, e não derivação da trilha de auditoria: decidir se hoje é dia de
-- lembrar precisaria de uma consulta de eventos POR SIGNATÁRIO a cada rodada, e
-- a trilha é append-only justamente para não ser fonte de estado mutável. Ela
-- continua registrando cada envio (`REMINDER_SENT`) — para a prova; estas duas
-- colunas são para o agendamento.
ALTER TABLE "EnvelopeSigner" ADD COLUMN IF NOT EXISTS "lastReminderAt" TIMESTAMP(3);
ALTER TABLE "EnvelopeSigner" ADD COLUMN IF NOT EXISTS "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- O ORÇAMENTO REGISTRA QUE JÁ AVISOU DO VENCIMENTO.
--
-- Sem isto, um envelope expirado hoje e outro do mesmo orçamento expirado
-- amanhã (reemissão que também venceu) mandariam dois avisos; pior, uma falha
-- parcial no meio do laço faria a varredura da hora seguinte reenviar o aviso
-- para quem já o recebeu. O carimbo é do ORÇAMENTO porque é dele que o cliente
-- é avisado — não do envelope, que é detalhe interno.
ALTER TABLE "TaskQuote" ADD COLUMN IF NOT EXISTS "expiryNoticeSentAt" TIMESTAMP(3);

-- Eventos novos da trilha. `REMINDER_SENT` é o lembrete periódico;
-- `EXPIRY_NOTICE_SENT` é o aviso de que a coleta venceu — ambos precisam ficar
-- na cadeia encadeada de hashes como qualquer outra mensagem da cerimônia.
ALTER TYPE "SignatureEventType" ADD VALUE IF NOT EXISTS 'REMINDER_SENT';
ALTER TYPE "SignatureEventType" ADD VALUE IF NOT EXISTS 'REMINDER_FAILED';
ALTER TYPE "SignatureEventType" ADD VALUE IF NOT EXISTS 'EXPIRY_NOTICE_SENT';

-- REORDENA `statusOrder`, QUE É PERSISTIDO.
--
-- A lista de Orçamentos ordena por esta coluna, e ela é gravada na escrita do
-- status — ou seja, os 598 orçamentos que já existem carregam a numeração
-- antiga e não a reveriam sozinhos. Inserir `EXPIRED` (2) e `SIGNED` (3) empurra
-- todo o resto em um, então a numeração inteira é reescrita aqui.
--
-- O `CASE` cobre só os estados ANTIGOS de propósito: nenhuma linha pode estar
-- em SIGNED/EXPIRED ainda, e citar um valor de enum criado nesta mesma
-- transação é justamente o que o Postgres recusa.
UPDATE "TaskQuote" SET "statusOrder" = CASE "status"
  WHEN 'DUE'              THEN 1
  WHEN 'BUDGET_APPROVED'  THEN 4
  WHEN 'BILLING_APPROVED' THEN 5
  WHEN 'UPCOMING'         THEN 6
  WHEN 'PARTIAL'          THEN 7
  WHEN 'SETTLED'          THEN 8
  WHEN 'PENDING'          THEN 9
  WHEN 'CANCELLED'        THEN 10
  ELSE "statusOrder"
END;
