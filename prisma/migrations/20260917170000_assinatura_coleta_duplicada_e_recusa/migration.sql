-- ⚠️ CONFERIDO CONTRA PRODUÇÃO EM 17/09: OS DOIS COMANDOS SÃO `UPDATE 0` AQUI.
--
-- Os casos que motivaram esta migration foram medidos num CLONE de 16/09 16:52, e
-- lá eram resíduo do próprio `test:signature-refusal` — a trilha de assinatura é
-- append-only, então o `deleteMany` da limpeza do teste sempre falha quando houve
-- coleta, e os envelopes ficam. Em produção não há nenhum envelope `REFUSED` nem
-- nenhum orçamento com duas coletas `COMPLETED`.
--
-- Ela fica mesmo assim, por duas razões: vale para os ambientes que TÊM o resíduo,
-- e é a rede para o intervalo entre este deploy e o gancho de recusa passar a
-- existir. Os `WHERE` são defensivos — reexecutar não faz nada.
--
-- Lição de método, para a próxima: número de clone não é número de produção. Hoje
-- mesmo um "defeito" de parcela cancelada apareceu no clone e, em produção, a
-- parcela estava paga.

-- Assinatura: o rastro dos dois defeitos que o código desta mesma leva fechou.
--
-- Nada de esquema aqui — só o estado que os defeitos deixaram no banco.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DOIS CONTRATOS SELADOS PARA O MESMO NÚMERO DE ORÇAMENTO
--
-- `createEnvelope` só recusava reemissão quando havia coleta em andamento.
-- Reemitir por cima de uma coleta CONCLUÍDA E SELADA era aceito pela rota (a
-- tela e o app escondem o botão, mas esconder não é impedir), e o resultado está
-- no orçamento nº 591: TRÊS envelopes concluídos e selados, um por cima do
-- outro, cada um com bytes diferentes e todos válidos aos olhos do PAdES. À
-- pergunta "qual é o contrato?" o sistema tinha três respostas.
--
-- A partir de agora a rota RECUSA (ver `createEnvelope`). Aqui fica o rastro:
-- de cada orçamento com mais de uma coleta concluída, a de MAIOR versão continua
-- `COMPLETED` — é a última que as duas partes assinaram — e as anteriores passam
-- a `SUPERSEDED`, que é o estado que o sistema já sabe ler (marca d'água "Versão
-- substituída" no PDF servido, e `getPublicQuoteSummary` deixa de oferecer
-- assinatura sobre elas).
--
-- NADA SE PERDE: o artefato selado de cada uma continua no disco, continua
-- verificável pelo código de verificação e continua com a trilha encadeada
-- intacta. O que muda é qual delas o sistema apresenta como o instrumento vivo.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY "quoteId" ORDER BY version DESC) AS rn
  FROM "SignatureEnvelope"
  WHERE status = 'COMPLETED'
)
UPDATE "SignatureEnvelope" e
SET status = 'SUPERSEDED'
FROM ranked r
WHERE e.id = r.id
  AND r.rn > 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O CLIENTE RECUSOU E O ORÇAMENTO CONTINUOU "PENDENTE"
--
-- Não existia gancho de recusa: o envelope ia para `REFUSED` e o `TaskQuote`
-- ficava `PENDING`, indistinguível de um criado naquela manhã em toda lista,
-- filtro e relatório do comercial. É o mesmo buraco que `markExpiredBySignature`
-- fechou no ramo do vencimento — ver `setOnEnvelopeRefused`, criado nesta leva.
--
-- Destino `EXPIRED`, que a interface chama "Aguardando Reanálise": é o estado que
-- significa "o valor volta para a mesa do comercial", e é exatamente o que uma
-- recusa produz. `CANCELLED` seria pior — terminal, e o cliente que recusou um
-- preço costuma aceitar o próximo.
--
-- `statusOrder = 1` porque é o valor de `EXPIRED` em `TASK_QUOTE_STATUS_ORDER`.
-- As duas colunas NUNCA andam separadas: a lista ordena e pagina pela segunda.
--
-- SÓ QUANDO NÃO SOBROU NADA VIVO. Um orçamento com coleta em andamento, ou com
-- uma concluída/substituída (portanto com contrato assinado), não é movido por
-- uma recusa antiga — é o caso do nº 591, que tem recusas E um contrato selado, e
-- cuja pendência é outra (a aprovação que o gancho de conclusão não executou).
--
-- ⚠️ SEM CHANGELOG. Este UPDATE não passa por `TaskQuoteService.update`, então
-- não há linha de `ChangeLog` para estas seis mudanças — o registro delas é este
-- arquivo. A "Em Negociação" não precisa de reconciliação: `PENDING` e `EXPIRED`
-- mapeiam os dois para `IN_PROGRESS` (ver `syncEmNegociacaoForTask`), então
-- nenhuma O.S. fica fora de lugar.
UPDATE "TaskQuote" q
SET status = 'EXPIRED',
    "statusOrder" = 1,
    "updatedAt" = now()
WHERE q.status = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "SignatureEnvelope" e
    WHERE e."quoteId" = q.id AND e.status = 'REFUSED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "SignatureEnvelope" e
    WHERE e."quoteId" = q.id
      AND e.status IN ('RUNNING', 'COMPLETED', 'SUPERSEDED')
  );
