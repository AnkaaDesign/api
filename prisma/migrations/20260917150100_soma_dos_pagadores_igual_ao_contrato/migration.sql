-- A SOMA DOS PAGADORES TEM DE SER O CONTRATO
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Cinco orçamentos do acervo violavam a invariante central da aritmética do
-- orçamento — `Σ TaskQuoteCustomerConfig.total == TaskQuote.total`. Ela não é
-- estética: é ela que faz a soma das faturas reconstruir o valor do contrato
-- (ver `utils/quote-money.ts`), e é dela que dependem o aviso de divergência na
-- aprovação do faturamento, os relatórios por período e o documento assinado.
--
-- São DOIS defeitos diferentes, com duas derivações diferentes. Cada uma está
-- justificada abaixo, e nenhuma delas inventa número.
--
--
-- ─── I. ORÇAMENTOS 259, 260, 261 E 262 — cada pagador com o contrato INTEIRO ──
--
-- Estado encontrado: dois clientes (Ibiporã Implementos e RKO Alimentos), UM
-- `Billing` (mesma cobertura), e CADA pagador carregando o total do contrato
-- inteiro — de modo que a soma dava exatamente 2×. Nenhum serviço tinha
-- `invoiceToCustomerId`, o que é o mesmo que dizer que a repartição entre os
-- dois pagadores nunca foi declarada ao sistema.
--
-- CAUSA. Os quatro nasceram na mesma chamada de criação (os oito pagadores têm
-- `createdAt` no mesmo milissegundo, 19/03/2026 16:46), numa versão em que o
-- servidor PERSISTIA o `subtotal`/`total` que a tela mandava por pagador, em vez
-- de derivá-los. A tela mandava o total do orçamento para os dois.
--
-- A DERIVAÇÃO, e por que ela é a certa. A repartição está escrita — pelo próprio
-- operador, à mão, na OBSERVAÇÃO de cada serviço: "(faturamento ibiporã)" nos
-- itens de pintura, "(faturamento Rko Alimentos)" nos de logomarca. É a intenção
-- registrada de forma contemporânea, na única casa que a tela da época oferecia.
-- Esta migração a transcreve para a coluna que o sistema lê hoje
-- (`TaskQuoteService.invoiceToCustomerId`) e então recalcula cada pagador pela
-- MESMA fórmula de `computeQuoteMoney` — Σ dos serviços dele, menos os 8% de
-- desconto que a linha já declarava.
--
-- A PROVA de que é a derivação certa: o resultado reconstrói, AO CENTAVO e sem
-- nenhum ajuste, tanto `TaskQuote.subtotal` quanto `TaskQuote.total` dos quatro
-- orçamentos — números que já estavam corretos e que esta migração NÃO toca.
-- Uma repartição errada não fecharia.
--
--     259  Ibiporã 15.550,00 → 14.306,00   RKO 15.055,00 → 13.850,60   Σ 28.156,60 = total
--     260  Ibiporã 14.955,00 → 13.758,60   RKO 15.055,00 → 13.850,60   Σ 27.609,20 = total
--     261  idem 260                                                     Σ 27.609,20 = total
--     262  idem 260                                                     Σ 27.609,20 = total
--
-- ⚠️ UMA INFERÊNCIA, declarada. No orçamento 259 só os cinco itens de PINTURA
-- receberam observação ("(AZUL) (FAT. IBIPORÃ)"); os três de logomarca
-- (Logomarca Laterais 13.275,00, Logomarca Traseira 1.780,00 e Plotagem Cabine
-- 0,00) ficaram em branco. Atribuí-los à RKO se apoia em duas coisas: os
-- orçamentos irmãos 260, 261 e 262 — mesmos dois clientes, mesmos três itens,
-- MESMOS VALORES — marcam exatamente esses três como "(faturamento Rko
-- Alimentos)"; e a soma resultante fecha com o total do 259 ao centavo. A
-- alternativa (deixá-los sem pagador) faria `recalcQuoteTotals` dobrar o
-- agregado do 259 para R$ 29.361,00, quebrando um número que hoje está certo.
--
-- RISCO. Os quatro estão em PENDING, sem `Billing` aprovado, sem fatura, sem
-- parcela, sem boleto e sem NFS-e — e sem tarefa vinculada. Nada de fiscal ou
-- financeiro depende destes números. Se a repartição estiver errada, a tela de
-- Orçamento a corrige num save.
--
--
-- ─── II. ORÇAMENTO 49 — o agregado R$ 1.000,00 ABAIXO do que foi pago ────────
--
-- Estado encontrado: um pagador só (Lasaroli), cobrança LIQUIDADA,
-- `config.total = 14.630,00` e `TaskQuote.total = 13.630,00`.
--
-- AQUI A CORREÇÃO VAI NO SENTIDO OPOSTO: quem está certo é o PAGADOR.
-- R$ 14.630,00 foi o valor da fatura emitida (`Invoice` PAID,
-- `totalAmount = paidAmount = 14.630,00`) e foi COBRADO E RECEBIDO em três
-- parcelas conciliadas — 4.900,00 em 20/02, 4.865,00 em 12/03 e 4.865,00 em
-- 01/04, todas PAID. É dinheiro que entrou. O agregado do orçamento, que é
-- derivado da lista de serviços, ficou R$ 1.000,00 abaixo disso.
--
-- CAUSA provável: a linha de serviço "Logomarca Padrão" está em R$ 0,00 e é a
-- única do orçamento com `updatedAt` posterior à criação (04/02/2026 19:36). Não
-- há `ChangeLog` do orçamento 49 que cubra o período — provável lacuna da
-- recuperação de 12/06 —, então a causa é plausível mas NÃO é provada.
--
-- A DERIVAÇÃO. Corrige-se o AGREGADO para 14.630,00, e não a linha de serviço.
-- Escrever R$ 1.000,00 de volta em "Logomarca Padrão" seria inventar um preço
-- por subtração, sobre uma hipótese que o histórico não confirma. Já 14.630,00
-- não é inventado: é lido da fatura e das três parcelas pagas. E é o valor que
-- `recalcQuoteTotals` passa a derivar sozinho a partir de agora — a partir desta
-- leva a função PRESERVA o total de um pagador congelado em vez de reescrevê-lo,
-- e soma esse valor no agregado (correção A10). A migração e o código passam a
-- dizer a mesma coisa.
--
-- O QUE FICA VISÍVEL, de propósito: a lista de itens do orçamento 49 continua
-- somando R$ 13.630,00 enquanto o contrato diz R$ 14.630,00. A diferença é real
-- e não sabemos de qual item ela é; escondê-la com um número fabricado seria
-- pior do que mostrá-la.
--
-- RISCO: nenhum documento fiscal é tocado. `Invoice.totalAmount`, as parcelas, o
-- boleto e a NFS-e ficam exatamente como estão — eles já diziam 14.630,00.
--
--
-- ─── O QUE ESTA MIGRAÇÃO NÃO FAZ ─────────────────────────────────────────────
--
-- Há 2 orçamentos APROVADOS com ZERO pagadores e ZERO cobranças (nº 54 e nº
-- 291). Eles não são corrigidos aqui, e a omissão é deliberada: criar o pagador
-- exigiria inventar o cliente (o 54 não tem sequer tarefa vinculada de onde
-- inferi-lo) e o tipo de desconto (o 291 tem 500,00 → 425,00, que tanto é 15%
-- quanto R$ 75,00 fixos — e as duas leituras divergem assim que o orçamento
-- ganhar um segundo veículo). Rebaixá-los para PENDENTE apagaria uma aprovação
-- comercial que de fato aconteceu. Não há derivação defensável: ficam como
-- estão, e a aprovação de faturamento já os recusa com uma frase clara
-- ("É necessário ter pelo menos uma configuração de cliente...").

-- ─────────────────────────────────────────────────────────────────────────────
-- I. 259–262
-- ─────────────────────────────────────────────────────────────────────────────

-- I.a  A observação escrita à mão vira `invoiceToCustomerId`.
WITH alvo AS (
  SELECT id AS "quoteId" FROM "TaskQuote" WHERE "budgetNumber" IN (259, 260, 261, 262)
),
pagador AS (
  SELECT c."quoteId", c."customerId", cu."fantasyName"
  FROM "TaskQuoteCustomerConfig" c
  JOIN "Customer" cu ON cu.id = c."customerId"
  WHERE c."quoteId" IN (SELECT "quoteId" FROM alvo)
)
UPDATE "TaskQuoteService" s
SET "invoiceToCustomerId" = p."customerId"
FROM alvo a, pagador p
WHERE s."quoteId" = a."quoteId"
  AND p."quoteId" = a."quoteId"
  AND s."invoiceToCustomerId" IS NULL
  AND (
    (unaccent(lower(coalesce(s.observation, ''))) LIKE '%ibipora%'
       AND unaccent(lower(p."fantasyName")) LIKE '%ibipora%')
    OR
    (unaccent(lower(coalesce(s.observation, ''))) LIKE '%rko%'
       AND unaccent(lower(p."fantasyName")) LIKE '%rko%')
  );

-- I.b  Os três itens sem observação do 259 — a inferência declarada no cabeçalho.
WITH q AS (SELECT id FROM "TaskQuote" WHERE "budgetNumber" = 259),
rko AS (
  SELECT c."customerId" FROM "TaskQuoteCustomerConfig" c
  JOIN "Customer" cu ON cu.id = c."customerId"
  WHERE c."quoteId" = (SELECT id FROM q) AND unaccent(lower(cu."fantasyName")) LIKE '%rko%'
)
UPDATE "TaskQuoteService" s
SET "invoiceToCustomerId" = (SELECT "customerId" FROM rko)
WHERE s."quoteId" = (SELECT id FROM q)
  AND s."invoiceToCustomerId" IS NULL
  AND (SELECT count(*) FROM rko) = 1;

-- I.c  O total de cada pagador, pela fórmula de `computeQuoteMoney`:
--      Σ dos serviços DELE, menos o desconto percentual já declarado na linha.
--      (Os quatro orçamentos cobrem 1 veículo, então `× N` é a identidade.)
WITH q AS (SELECT id FROM "TaskQuote" WHERE "budgetNumber" IN (259, 260, 261, 262)),
soma AS (
  SELECT c.id AS "configId",
         round(coalesce(sum(s.amount), 0), 2) AS subtotal
  FROM "TaskQuoteCustomerConfig" c
  LEFT JOIN "TaskQuoteService" s
    ON s."quoteId" = c."quoteId" AND s."invoiceToCustomerId" = c."customerId"
  WHERE c."quoteId" IN (SELECT id FROM q)
  GROUP BY c.id
)
UPDATE "TaskQuoteCustomerConfig" c
SET subtotal = soma.subtotal,
    total = round(soma.subtotal - round(soma.subtotal * coalesce(c."discountValue", 0) / 100, 2), 2)
FROM soma
WHERE c.id = soma."configId"
  AND c."discountType" = 'PERCENTAGE';

-- ─────────────────────────────────────────────────────────────────────────────
-- II. 49
-- ─────────────────────────────────────────────────────────────────────────────

-- O agregado passa a ser a soma dos pagadores — que aqui é o valor da fatura
-- paga. Escopado por "existe fatura PAID com este valor" para que a migração
-- seja inerte se o banco não estiver no estado em que foi escrita.
UPDATE "TaskQuote" q
SET subtotal = sub.s_sub,
    total = sub.s_tot
FROM (
  SELECT c."quoteId", sum(c.subtotal) AS s_sub, sum(c.total) AS s_tot
  FROM "TaskQuoteCustomerConfig" c
  GROUP BY c."quoteId"
) sub
WHERE q.id = sub."quoteId"
  AND q."budgetNumber" = 49
  AND EXISTS (
    SELECT 1 FROM "Invoice" i
    JOIN "TaskQuoteCustomerConfig" cc ON cc.id = i."customerConfigId"
    WHERE cc."quoteId" = q.id AND i.status = 'PAID' AND i."totalAmount" = sub.s_tot
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA — a invariante tem de valer para TODO orçamento depois desta leva.
-- Falha ruidosamente em vez de deixar o banco meio corrigido.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  divergentes int;
BEGIN
  SELECT count(*) INTO divergentes FROM (
    SELECT q.id
    FROM "TaskQuote" q
    JOIN "TaskQuoteCustomerConfig" c ON c."quoteId" = q.id
    GROUP BY q.id, q.total
    HAVING abs(sum(c.total) - q.total) > 0.02
  ) d;
  IF divergentes > 0 THEN
    RAISE EXCEPTION
      'Ainda há % orçamento(s) em que a soma dos pagadores diverge do total do contrato.',
      divergentes;
  END IF;
END $$;
