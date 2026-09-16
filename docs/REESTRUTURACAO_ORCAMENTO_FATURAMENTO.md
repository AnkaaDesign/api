# Reestruturação Orçamento × Faturamento — documento de decisão

**Data:** 15/09/2026 · **Base:** `api` + `web` na `main` · **Gatilho:** orçamento nº 604, 4 veículos
**Status:** decidido. Quatro implementadores podem começar em paralelo a partir da seção 6.

---

## ▶ ESTADO DA EXECUÇÃO — 16/09/2026

O sintoma **(B)** desta seção 1 deixou de ser verdade: **o faturamento agora é uma
entidade**, e por isso passou a ter tela própria. O que está no banco e no código:

| feito | onde |
|---|---|
| `Billing` — entidade com `id`, sem número (o número é do ORÇAMENTO) | `schema.prisma` · migration `20260916120000_billing_entity` |
| `BillingTask` — a cobertura, com `@@unique([taskId])`: **um veículo, um faturamento** | idem |
| `Billing.approvedAt` — o ESTADO próprio do faturamento | migration `20260916180000_billing_owns_its_state` |
| `TaskQuoteCustomerConfig` virou **o PAGADOR**: perdeu `coveredTasks` e `billingApprovedAt`, ganhou `billingId NOT NULL` | idem |
| `QuoteBillingTask` **não existe mais** — a cobertura era guardada em duplicata quando havia dois pagadores do mesmo recorte | idem |
| Trocar de modo **destrói e cria entidades**, com ids novos — não é campo que muda de valor | `reconcileBillingsForQuote` + `tests/billing-entity.test.ts` |
| Módulo HTTP próprio: `GET /billings/:id`, `/billings/by-task/:taskId`, `/billings/quote/:id`, `PUT /billings/:id/approve` | `src/modules/financial/billing/` |
| `internalApprove` endereça o FATURAMENTO (`billingId`), não mais só um veículo representante | `task-quote.service.ts` |
| App Flutter lê a cobertura do faturamento e aprova por `billingId` | `mobile-flutter/lib/features/financial/` |

**Correção ao próprio documento:** a seção 6 propunha dar NÚMERO ao faturamento
(`QuoteBilling.number`). O dono decidiu o contrário, e ele está certo: o número é
do orçamento — é ele que o cliente recebe, assina e cita. Uma segunda série a
reservar e a não repetir existiria para identificar algo que o `id` já identifica.
Quem precisa nomear um faturamento o nomeia pelo que ele cobra: os veículos.

**Segunda correção — `Invoice`/`Installment` continuam no PAGADOR, e é o certo.**
Um relato anterior listou "pendurar a fatura no `Billing`" como pendência. Não é:
a fatura é emitida PARA UM PAGADOR, com o CNPJ dele, o desconto dele e o plano de
parcelas dele. Num faturamento de dois pagadores saem DUAS faturas e duas NFS-e,
e movê-las para o faturamento obrigaria a reintroduzir o pagador como coluna
delas — o mesmo dado, um nível acima. O índice parcial
`UNIQUE (customerConfigId) WHERE status <> 'CANCELLED'` já significa exatamente
"uma fatura viva por pagador por faturamento", que é a regra verdadeira. Quem
quer as faturas de uma cobrança pergunta `billing.customerConfigs[].invoices`,
um salto indexado.

**Ainda NÃO feito:** `QuoteTerms` (extrair o instrumento assinado), `Invoice` como
ciclo, `QuoteServiceOverride` (preço por veículo — a LACUNA "sem tela para
acrescentar veículo", que continua estrutural). São P2, P3 e P4. E a LISTA de
faturamento ainda tem uma linha por TAREFA: `GET /billings` já serve a lista por
COBRANÇA, falta a tela consumi-la.

---

## 1. O DIAGNÓSTICO

### 1.1 Os dois sintomas, e o que cada um prova

**(A) A O.S. comercial "Em Negociação" fechou em UMA tarefa; as outras três ficaram "Em Andamento" para sempre.**
Causa imediata: todo caminho de mudança de estado do orçamento fazia `prisma.task.findFirst({ where: { quoteId } })` e reconciliava aquela tarefa. Com `Task.quoteId` `@unique` (modelo antigo) isso era correto por construção; depois da migração `20260903120000_multitask_quote` virou sorteio.
Já corrigido por `syncEmNegociacaoForQuote` (`src/utils/em-negociacao-sync.ts`) — **um laço**, não uma mudança de modelo. E o conserto teve de ser um laço porque `ServiceOrder.taskId` é `NOT NULL` e não existe `ServiceOrder.quoteId`: a entidade "negociação de um orçamento" não tem onde morar.
O que (A) prova: **o código está cheio de resíduos do arquétipo "1 orçamento = 1 tarefa", e o schema ainda os obriga.** A seção 5 tem os 54 que restam.

**(B) `/financeiro/faturamento/detalhes/<taskId>` é UMA página, indexada por UMA tarefa, com um wizard "Tarefa → Proposta → Serviços → Fatura 1 → Fatura 2 → Fatura 3 → Fatura 4 → Resumo" para quatro veículos. O passo 1 corrige os dados de um veículo só.**
A rota recebe um `taskId` (`web/src/App.tsx:1636` ← `routes.ts:195`); os passos "Fatura k" são gerados de `customerConfigs.length`. A página é **indexada por um objeto (tarefa) e edita coleções de outro (fatias do orçamento)**.
O que (B) prova: **o faturamento não tem entidade própria, então não tem tela própria.** Uma tela só pode ser endereçada por aquilo que existe no modelo, e o que existe é `TaskQuoteCustomerConfig` — uma linha sem nome, sem número, sem estado e sem identidade de rota.

### 1.2 A causa estrutural que liga os dois

**Não existe um modelo chamado Faturamento. Existe uma configuração do orçamento que produz dinheiro como efeito colateral.**

`TaskQuoteCustomerConfig` é uma linha com três verdades e um único `updatedAt`:

| verdade | campos | dono | ciclo |
|---|---|---|---|
| PROPOSTA (assinada) | `subtotal`, `total`, `discountType/Value/Reference`, `paymentCondition`, `customPaymentText` | comercial | morre na assinatura |
| FATURAMENTO (execução) | `generateInvoice`, `generateBankSlip`, `paymentConfig`, `billingApprovedAt`, `invoice`, `installments`, `coveredTasks` | financeiro | revisável para sempre |
| ASSINATURA | `customerSignatureId`, `responsibleId` | jurídico | congela |

Disso decorrem, em cadeia, as três cardinalidades que o schema erra:

1. **Estado.** `TaskQuoteStatus` mistura o ciclo da PROPOSTA (`PENDING`/`SIGNED`/`EXPIRED`/`BUDGET_APPROVED`/`CANCELLED`) com o ciclo do RECEBÍVEL (`BILLING_APPROVED`/`UPCOMING`/`DUE`/`PARTIAL`/`SETTLED`) numa coluna só, com um `statusOrder` só. Quatro faturas com quatro estados colapsam num escalar em `task-quote-status-cascade.service.ts:409`. A única marca por fatia é `billingApprovedAt` — **uma data fazendo papel de estado**.
2. **Fatura por fatia.** `Invoice.customerConfigId` é `@unique` (no schema; no banco é índice parcial — ver 1.3): uma fatia tem no máximo UMA fatura, para sempre. Refaturar exige **HARD-DELETE** da fatura cancelada e das parcelas dela (`invoice-generation.service.ts:173-199`), abortando quando há parcela paga. Histórico financeiro apagado para caber numa restrição.
3. **Veículo.** Não existe preço por veículo: existe `TaskQuote.total ÷ TaskQuote.vehicleCount` (`perVehicleAmount`, `quote-tasks.ts`). Uma lista de serviços, compartilhada, preço uniforme, e o comentário literal no schema: *"veículo que precisa de outra lista é outro orçamento"*. É a LACUNA de 15/09 ("sem tela para acrescentar veículo") vista pelo lado do modelo — **ela é estrutural, não de tela**.

E há uma quarta consequência, a mais cara: **a decisão de cobrança está DENTRO do instrumento assinado.** `materialProjection` (`quote-snapshot.service.ts:532`) inclui `paymentCondition`, `customPaymentText`, `discount{type,value,reference}`, `billingSplit` e `billingGroups`. Refatiar a cobrança derruba assinaturas já colhidas.

### 1.3 O que já está quebrado hoje, antes de qualquer reforma

Verificado no repositório, e **precondição de tudo**:

- **Drift de schema.** `prisma/schema.prisma:4670` declara `customerConfigId String? @unique` (global). A migration `20260506000001_invoice_customer_config_partial_unique` **dropou** esse índice e criou `Invoice_customerConfigId_active_unique ON "Invoice"("customerConfigId") WHERE status != 'CANCELLED'`. Qualquer `prisma migrate dev` / `db push` / baseline recria o unique global e **mata o refaturamento**. Pior: o cliente Prisma trata `customerConfig.invoice` como to-one enquanto o banco pode ter duas linhas (uma `CANCELLED`, uma ativa) — a leitura que decide `frozen` em `task-quote-customer-config-sync.ts:250` pode receber a CANCELADA e liberar a reescrita da cobertura de um faturamento vivo.
- **Beco sem saída do cancelamento.** `invoice.service.ts:271-297` devolve o orçamento a `BUDGET_APPROVED` quando todas as faturas ficam canceladas, mas **nunca zera** `TaskQuoteCustomerConfig.billingApprovedAt`. Depois disso: `internalApprove` diz "todas as fatias já tiveram o faturamento aprovado" e `revertBillingApproval` diz "status não revertível". Só cirurgia no banco sai.
- **Cascade que apaga dinheiro.** `Installment.customerConfig`, `Invoice.customerConfig` e `BankSlip.installment` são `onDelete: Cascade`; a guarda de obrigação viva (`task-quote-customer-config-sync.ts:511`) consulta faturas `status != CANCELLED`, então uma fatura CANCELADA com parcela PAGA passa despercebida e o `deleteMany` da fatia cascateia sobre a parcela paga, o boleto e o `ReconciliationMatch`.
- **Segundo caminho de escrita.** `PUT /tasks/:id` e `/tasks/batch` com bloco `quote` aninhado (`task-prisma.repository.ts:2245-2440`) alteram status, serviços, fatias, refatiam cobertura e recalculam totais **sem guardas** e **sem `onQuoteContentChanged`** — é o único ponto da API que pode fazer alteração material sem reavaliar assinatura.
- **Sem índice único sobre `NfseDocument`.** "Uma nota viva por ciclo" é regra só de código. Foi esse buraco que produziu as notas duplas na prefeitura em 15/09.

### 1.4 A tese da reestruturação

> **Promover a fatia a entidade, e extrair dela o que é instrumento assinado.**
> `TaskQuoteCustomerConfig` vira `QuoteBilling` — com número, estado, cobertura, reversão e refaturamento próprios. O que nela é termo comercial (desconto, cláusula de pagamento, contato que assina) sai para `QuoteTerms`, uma linha por (orçamento, pagador, lote negociado), que é o que o PDF imprime e o hash protege. `Invoice` deixa de ser 0..1 eterno e vira ciclo. O preço por veículo passa a existir como dado (`QuoteServiceOverride`), sem destruir o preço uniforme que o documento imprime como "×60".

**O que NÃO fazemos nesta rodada, e por quê** (os três painéis convergiram):

| recusado | por quê |
|---|---|
| `Contract` + `ContractAmendment` no meio | 14 tabelas novas e uma máquina de aditivos para resolver um problema (mudança pós-assinatura) que hoje tem ZERO ocorrências registradas. Triplica o escopo e cria duas séries numéricas redundantes (`budgetNumber` = `contractNumber`). |
| Tirar cobertura/lote do hash material | O PDF assinado **imprime uma cláusula por grupo de cobertura**, com o valor da fatia e a contagem de veículos (`signature-envelope.service.ts:1666-1760` → `quote-text.ts:147-180`). Tirar do hash sem tirar do documento é pior que hoje: o texto do instrumento muda e a assinatura continua válida. |
| Substituir `invoiceToCustomerId` por rateio por veículo | "A pintura do caminhão 1 é do cliente A e a aerografia do caminhão 1 é do cliente B" é um modo **em produção** (`task-quote-totals.ts:67`). Rateio por veículo o apaga e o backfill não tem como reconstruí-lo. |
| `ServiceOrder.taskId` nullable + O.S. no orçamento | 964 referências em 62 arquivos da api e 105 da web; `COMMERCIAL` é um catálogo de 52 descrições; "Em Negociação" é a O.S. padrão de toda tarefa, com ou sem orçamento. E o sintoma (A) **já está corrigido** pelo laço. |
| Partir o enum `TaskQuoteStatus` agora | Os 5 valores de cobrança viajam para fora da API: filtros salvos com `where.quote.is.status in [...]`, o app Flutter em produção, `invoice-analytics.service.ts:638-649` (funil comercial), `em-negociacao-sync.ts:36-43`, changelog histórico em string. Precisa de uma release que aceite-e-traduza a entrada antiga. Fica para a rodada seguinte; nesta rodada os 5 valores viram **derivados**. |
| `NfseDocument.invoiceId NOT NULL` | O schema documenta que a nota **sobrevive** à remoção da fatura, e `src/scripts/relink-orphan-nfse.ts:156` cria notas autorizadas reconciliadas da Elotech com `invoiceId: null`. São notas fiscais municipais: não se inventa fatura para elas. |

---

## 2. O MODELO-ALVO

Convenção: **[MANTÉM]** = tabela/coluna intocada. **[RENOMEIA]** = rename físico, mesmo `id`, mesmos dados. **[NOVO]** = tabela nova. **[ALTERA]** = coluna adicionada/mudada.

### 2.1 Visão

```
                      TaskQuote  (PROPOSTA — o que foi vendido)
                      │
       ┌──────────────┼───────────────┬──────────────────┐
       │              │               │                  │
  TaskQuoteService  QuoteTerms   SignatureEnvelope    QuoteBilling  (FATURAMENTO — o que se cobra)
       │            (instrumento)                        │
  QuoteServiceOverride                                   ├── QuoteBillingTask   (cobertura, móvel)
  (preço por veículo)                                    ├── Invoice (N, por ciclo)
                                                         │     ├── InvoiceCoverage  (cobertura CONGELADA)
                                                         │     ├── Installment → BankSlip
                                                         │     └── NfseDocument → NfseDocumentTask
                                                         └── BillingAdjustment
```

Regra de ouro que separa os dois lados:

> **O orçamento guarda a REGRA e a REPARTIÇÃO acordadas (material, hasheada, impressa).
> O faturamento guarda a EXECUÇÃO — datas concretas, números de nota, números de boleto, ciclos (nunca hasheada).**

Consequência prática: reajustar as **datas** de vencimento, reemitir um boleto, refaturar um ciclo, ligar/desligar `generateBankSlip` **não** é alteração material. Mudar o desconto, a cláusula, o preço, o pagador, a frota ou **o desenho dos lotes** continua sendo — porque as três coisas estão impressas no documento que o cliente assinou.

### 2.2 `TaskQuote` [MANTÉM + ALTERA]

| campo | mudança | justificativa |
|---|---|---|
| `id`, `budgetNumber`, `subtotal`, `total`, `expiresAt`, `guarantee*`, `customForecastDays`, `commercialUserId` | — | |
| `status TaskQuoteStatus` | **[ALTERA] semântica**: os 5 valores de cobrança (`BILLING_APPROVED`…`SETTLED`) passam a ser **derivados**, escritos SÓ por `cascadeFromQuote` a partir dos `QuoteBilling.status`. Nenhum outro escritor pode gravá-los. | Corrige a cardinalidade sem quebrar filtros salvos, app Flutter e funil comercial. O enum físico não muda nesta rodada. |
| `billingSplit` | [MANTÉM], redeclarado como **INTENÇÃO de refatiamento automático**, não como verdade de cobrança | `planCoverage` continua usando; a verdade é `QuoteBillingTask`. Continua **material** (imprime no PDF). |
| `billingApprovedAt` | [MANTÉM] **derivado** = `max(QuoteBilling.approvedAt)`; recalculado em toda transição | `avgSalesCycleDays` já depende dele. |
| `vehicleCount` | [MANTÉM] derivado de `tasks.length`, escrito só por `recalcQuoteTotals` | |
| `simultaneousTasks` | **[ALTERA]** validar `1 ≤ v ≤ tasks.length` na gravação; default = `tasks.length` | Hoje é uma segunda contagem digitada à mão, impressa na cláusula de prazo do PDF assinado (`quote-html.builder.ts:1208`). |
| `hasVehiclePricing Boolean @default(false)` | **[NOVO]** | Escrito por `recalcQuoteTotals` quando existe ao menos um `QuoteServiceOverride`. Liga o caminho caro (linhas por veículo na NFS-e) só quando necessário; sem override, tudo se comporta exatamente como hoje. |

**Não ganha `customerId`.** Multi-pagador é de primeira classe (`customerCount()`, `quote-tasks.ts:414`) e um orçamento pode existir sem tarefa vinculada. Quem afirma o cliente é `QuoteTerms` / `QuoteBilling`.

### 2.3 `QuoteTerms` [NOVO] — o instrumento assinado

Uma linha por **(orçamento, pagador, lote negociado)**. É o que o PDF imprime e o hash protege. Imutável depois de `SIGNED` (alteração ⇒ nova versão de envelope).

```prisma
model QuoteTerms {
  id                  String   @id @default(uuid())
  quoteId             String
  customerId          String
  label               String   @default("")   // "" = termos únicos do cliente; "Lote 1 a 20" quando há mais de um
  discountType        DiscountType
  discountValue       Decimal? @db.Decimal(10,2)
  discountReference   String?
  paymentCondition    String?                  // texto livre legado, ainda impresso quando não há spec
  paymentSpec         Json?                    // forma tipada (zod na borda): { type, installmentCount, anchor, firstDueDays, intervalDays, dueDayOfMonth, weekendRoll }
  customPaymentText   String?
  responsibleId       String?
  customerSignatureId String?
  @@unique([quoteId, customerId, label])
}
```

Decisões, cada uma corrigindo um furo apontado pelo painel:

- **`label` é `NOT NULL DEFAULT ''`, nunca nullable.** Em Postgres NULLs não colidem: com `label` nullable, duas linhas de termos para o mesmo (quote, cliente) seriam legais e a promessa "o banco garante que o desconto dos 4 caminhões é um só fato" não se cumpriria.
- **`label` NÃO é derivado da faixa de veículos.** Deriva do lote **negociado** (ordinal estável, `Lote 1`, `Lote 2`), com o rótulo de séries montado na renderização. Se o rótulo entrasse na chave única, relabelar ao mover um caminhão colidiria.
- **FK composta obrigatória:** `QuoteBilling(quoteId, customerId)` → `QuoteTerms(quoteId, customerId)`, para que uma fatia não possa apontar para os termos de outro orçamento.
- **`paymentCondition` e `paymentSpec` coexistem** por mais uma release. A precedência passa a ser escrita **uma vez**, em `src/utils/payment-terms.ts` (`resolvePaymentTerms(terms)`), e consumida por `invoice-generation.service.ts` e `quote-text.ts` — hoje são duas ordens de precedência em dois arquivos.

### 2.4 `QuoteServiceOverride` [NOVO] — o preço por veículo

```prisma
model QuoteServiceOverride {
  id        String   @id @default(uuid())
  serviceId String   // TaskQuoteService
  taskId    String
  included  Boolean  @default(true)
  amount    Decimal? @db.Decimal(10,2)   // null + included=true → usa o preço padrão da linha
  @@unique([serviceId, taskId])
}
```

**Tabela vazia = comportamento idêntico ao de hoje**, bit a bit. O preço de um (serviço, veículo) é `override?.included === false ? 0 : (override?.amount ?? service.amount)`.

A aritmética continua **num lugar só** (`src/utils/quote-money.ts`). A fórmula generalizada, compatível com a atual:

```
subtotalDaFatia = Σ_{v ∈ cobertos} Σ_{s ∈ serviços do pagador} preço(s, v)
descontoDaFatia = PERCENTAGE ? subtotalDaFatia × p
                : FIXED_VALUE ? valorFixo × |cobertos|     ← por veículo, como hoje (quote-money.ts:29-35)
                : 0
totalDaFatia    = subtotalDaFatia − descontoDaFatia
```

Sem override, `Σ_s preço(s,v)` é igual para todo `v` e a fórmula colapsa exatamente em `(Σ serviços − desconto) × cobertos`. **Nenhum número na tela muda ao ligar a tabela.** O desconto permanece onde está hoje (em `QuoteTerms`), aplicado sobre o subtotal da fatia — o que evita o erro que afundou a proposta "Contrato no meio", onde `Σ linhas` era declarado igual ao total e o desconto ficava sem lugar.

**Emissão de NFS-e com override** (o ponto que o painel marcou como não-emissível, e a regra que fecha):
`nfse-emission.scheduler.ts` passa a agrupar as linhas por **(descrição, valor unitário)** entre os veículos cobertos, emitindo `quantidade = nº de veículos naquele grupo`. Sem override há um grupo por serviço, e a saída é byte-idêntica à de hoje. Com override, um serviço vira 1..k linhas. Duas travas, ambas na transição `READY → APPROVED` (não no banco):
1. `Σ linhas emitidas` ≥ `Invoice.totalAmount` — o gap vira desconto global, que **nunca pode ser negativo** (a NFS-e não representa acréscimo). Override que **aumenta** o preço é representado como linha própria, jamais como desconto negativo.
2. Número de linhas ≤ 11 e discriminação ≤ 255 caracteres (tetos da Elotech/Ibiporã). Estourando: a aprovação é **recusada** com a mensagem "esta fatia tem preços distintos demais para uma nota só — divida a cobertura". Recusar é o produto; emitir errado, não.

### 2.5 `QuoteBilling` [RENOMEIA de `TaskQuoteCustomerConfig`] — o faturamento

**Rename físico. Mesmo `id` (uuid preservado), mesmas FKs, mesmas linhas.** É o que torna a convivência possível: `Invoice`, `Installment` e `QuoteBillingTask` continuam apontando para o mesmo valor.

| campo | origem | mudança |
|---|---|---|
| `id`, `quoteId`, `customerId` | — | idênticos |
| `billingNumber Int @unique` | **[NOVO]** | O faturamento passa a ter número, como o orçamento tem. Série própria, visível ao operador. **Não vai para `seuNumero` do boleto** (ver 2.7). |
| `status QuoteBillingStatus` | **[NOVO]** | a máquina em 2.6 |
| `approvedAt` | ← `billingApprovedAt` | rename |
| `approvedById`, `revertedAt`, `revertedById`, `revertReason` | **[NOVO]** | reversão por fatia precisa de autoria |
| `supersedesBillingId String?` | **[NOVO]** | refaturamento encadeado (nada é apagado) |
| `generateInvoice`, `generateBankSlip`, `paymentConfig`, `responsibleId` | — | ficam (execução) |
| `subtotal`, `total` | — | ficam, **congelados** a partir de `APPROVED` (ver 2.8) |
| `discountType`, `discountValue`, `discountReference`, `paymentCondition`, `customPaymentText`, `customerSignatureId` | → `QuoteTerms` | removidos na Fase 6, espelhados até lá |
| `termsId String` | **[NOVO]** | FK para `QuoteTerms` (composta com quoteId+customerId) |

**Sem `@@unique`.** K fatias por (orçamento, pagador) são legais e desejadas: é o que dá JOINT / PER_TASK / CUSTOM sem ramificação de código. `billingSplit` vira um **assistente de criação**, não um modo.

### 2.6 A máquina de `QuoteBillingStatus`

```
DRAFT ──► READY ──► APPROVED ──► ISSUED ──► UPCOMING ⇄ DUE ⇄ PARTIAL ──► SETTLED
  ▲         │           │            │            └──────┬──────┘
  └─────────┘           │            │                   │
  (edição volta)        ▼            ▼                   │
                    REVERTED ◄───────┴───────────────────┘
                        │
                        └──► (nova fatia via supersedesBillingId, ciclo+1)

qualquer estado ──► CANCELLED  (terminal, só sem parcela paga)
```

| estado | significado | quem escreve |
|---|---|---|
| `DRAFT` | cobertura e valores editáveis | reconciliação de fatias, tela do compositor |
| `READY` | cobertura fechada, pré-requisitos fiscais do cliente conferidos, aguardando aprovação | validação explícita |
| `APPROVED` | valor e cobertura **congelados**; `deliveredAt` carimbado por veículo | `approveBilling(billingId)` |
| `ISSUED` | fatura criada, NFS-e emitida (ou dispensada), boletos registrados | pipeline de emissão |
| `UPCOMING`/`DUE`/`PARTIAL`/`SETTLED` | derivados das parcelas **desta fatia** | `cascadeFromBilling` |
| `REVERTED` | boletos baixados e confirmados, fatura marcada `CANCELLED` (nunca deletada), `QuoteBillingTask.active=false` | `revertBilling(billingId)` |
| `CANCELLED` | fatia abandonada | reconciliação / cancelamento de tarefa |

Transições com pré-requisito duro:
- `READY → APPROVED`: cobertura **não vazia**; cadastro fiscal do tomador completo; `Σ QuoteBilling.total` das fatias do pagador == valor devido pelo pagador; travas de linha de NFS-e (2.4).
- `* → REVERTED`: **escopo da fatia**, não do orçamento. Guarda de parcela paga **só desta fatia** — é isto que acaba com "o cliente pagou o caminhão 1, logo o erro do caminhão 4 é eterno". Boletos desta fatia baixados e confirmados no Sicredi antes de qualquer escrita.
- `* → CANCELLED`: idem, guarda por fatia.

**Cobertura vazia continua legal em `DRAFT`.** `quote-money.ts:179-183` a produz de propósito: *"orçamento ainda sem veículo vinculado — devolver lista vazia faria a reconciliação apagar a configuração do cliente e, com ela, o desconto combinado"*. A ilegalidade é **na transição**, não no banco. E o duplo sentido de `covered.length === 0` morre: `invoice-generation.service.ts:123` deixa de tratá-la como "fatura tudo", porque em `APPROVED` ela não pode existir.

### 2.7 `Invoice` como ciclo [ALTERA]

```prisma
model Invoice {
  id             String  @id @default(uuid())
  billingId      String?          // ← era customerConfigId (mesma coluna renomeada)
  cycle          Int     @default(1)
  externalOperationId String? @unique
  taskId         String?          // [MANTÉM] por ora, só como atalho de leitura; deixa de ser fonte
  customerId     String
  totalAmount    Decimal          // congelado, NUNCA reescrito
  paidAmount     Decimal
  status         InvoiceStatus
  supersededByInvoiceId String?
  @@unique([billingId, cycle])
}
```

- **`@@unique([billingId, cycle])` substitui o 0..1 eterno.** Refaturar é ciclo 2. `invoice-generation.service.ts:173-199` (hard-delete) é **deletado**.
- **`Invoice.totalAmount` nunca é reescrito.** É o que o boleto registrado no Sicredi e a NFS-e autorizada dizem. Divergência contra `Σ` das linhas é **reportada**, nunca "consertada".
- **NÃO se cria o CHECK `num_nonnulls(billingId, externalOperationId) = 1`.** O acervo tem faturas antigas sem `customerConfigId` — `invoicesOfQuote` (`task-quote.service.ts:3315`) mantém um ramo por `task` exatamente por isso. O CHECK as rejeitaria. Fica uma validação de aplicação para linhas novas.
- `ExternalOperation` **não é absorvida** nesta rodada. Decisão explícita (seção 7).

### 2.8 `InvoiceCoverage` [NOVO] — a cobertura congelada

```prisma
model InvoiceCoverage {
  invoiceId String
  taskId    String
  amount    Decimal @db.Decimal(10,2)   // o que ESTA fatura cobrou por ESTE veículo
  serialNumber String?                  // COPIADOS, não referenciados
  plate        String?
  @@id([invoiceId, taskId])
}
```

`QuoteBillingTask` continua existindo e continua **móvel** (é a cobertura de trabalho, editável em `DRAFT`). `InvoiceCoverage` é o **snapshot do que foi efetivamente cobrado**, escrito na emissão e nunca alterado. Isso resolve de uma vez:

- apagar/mover uma tarefa deixa de reescrever silenciosamente o que uma nota autorizada cobriu (`task-quote-totals.ts:64` só toca fatias em `DRAFT`/`READY`);
- `Σ InvoiceCoverage.amount == Invoice.totalAmount` é invariante verificável, com o centavo residual no último item;
- a pergunta "quanto esta fatura cobrou por este caminhão" passa a ter resposta.

`Task` ganha `Restrict` vindo de `InvoiceCoverage` (não se apaga veículo já cobrado). O `Cascade` de `Invoice.task` é **removido** junto — hoje apagar um veículo apaga a fatura dele, o que é indefensável e contradiz o `Restrict` novo. `task-prisma.repository.ts:2485-2506` passa a recusar o delete com mensagem ("este veículo já foi faturado; reverta o faturamento nº X antes") em vez de cascatear.

### 2.9 `NfseDocument` [ALTERA] + `NfseDocumentTask` [NOVO]

- `invoiceId` **permanece nullable + SetNull**. O schema documenta a razão e há notas reconciliadas da Elotech sem fatura nossa.
- `quoteId` **permanece** (âncora durável). `taskId` permanece por ora, como atalho.
- **[NOVO]** `billingId String?` + `cycle Int?` — denormalizados na emissão.
- **[NOVO]** `NfseDocumentTask (nfseDocumentId, taskId, serialNumber, plate)` — cobertura da nota, série e placa **copiadas**. Se a tarefa mudar depois, a nota continua dizendo o que disse à prefeitura.
- **O índice único parcial**, e a forma exata importa:

```sql
CREATE UNIQUE INDEX CONCURRENTLY nfse_live_per_billing_cycle
  ON "NfseDocument" ("billingId", "cycle")
  WHERE "billingId" IS NOT NULL
    AND status IN ('PENDING','PROCESSING','AUTHORIZED','CANCEL_REQUESTED','CANCEL_REJECTED');
```

Três decisões dentro dele:
1. **O conjunto de status é `NFSE_LIVE_STATUSES` (`enums.ts:2890`) + `PENDING` + `PROCESSING`.** `CANCEL_REJECTED` é nota cujo cancelamento o fiscal **recusou** — ela vale com mais força ainda. Omiti-la (como duas das propostas faziam) reintroduz exatamente o defeito de 14/08 e de 15/09.
2. **O escopo é `(billingId, cycle)`, não `billingId`.** A substituição em dois passos que Ibiporã obriga (`supersedePreviousNfses`, `task-quote.service.ts:3221-3250`) exige que a nota NOVA esteja `AUTHORIZED` enquanto a ANTIGA ainda está viva em `CANCEL_REQUESTED`. Ciclos diferentes ⇒ sem colisão. Dentro de um ciclo, duas notas vivas continuam impossíveis.
3. **`WHERE billingId IS NOT NULL`** preserva as notas órfãs do acervo e as do `relink-orphan-nfse.ts`.

`supersedePreviousNfses` passa a encontrar as antigas por `billingId` + `cycle < cicloAtual` + status vivo, em vez de `quoteId + invoiceId: null` — mais preciso, e sobrevive ao fato de a reversão não deletar mais a fatura.

### 2.10 `Installment` / `BankSlip` [ALTERA mínimo]

- **[NOVO]** `@@unique([invoiceId, number])` como índice **parcial** `WHERE invoiceId IS NOT NULL`. O unique antigo `([customerConfigId, number])` só cai depois que a numeração for portada (abaixo).
- **Único escritor de numeração:** `src/utils/installment-numbering.ts`, `nextInstallmentNumber(invoiceId)`. Hoje `receivable-task-match.service.ts:1227-1240` numera por `max(number) WHERE customerConfigId` e anexa a uma fatura existente — no ciclo 2 isso gera buraco ou colisão dependendo da fonte.
- `Installment.invoice` vira `Restrict`. **Não** se torna `NOT NULL`: a mesma coluna serve `ExternalOperation`, que pode ter parcela sem fatura (`generateInvoice=false`, e `invoice-generation.service.ts:611` consulta literalmente `{ externalOperationId, invoiceId: null }`).
- `seuNumero` **não muda de gramática** (`buildSeuNumero`, `invoice-generation.service.ts:1024-1047`): teto de 10 caracteres, sufixo do número da parcela, e boleto já registrado é imutável no Sicredi. Muda só o **degrau de recuo**: quando não há número de NFS-e nem placa única, usa a placa do primeiro veículo de `InvoiceCoverage` ordenada por série, em vez de fragmento de UUID.

### 2.11 `BillingAdjustment` [NOVO]

```prisma
model BillingAdjustment {
  id        String @id @default(uuid())
  billingId String
  invoiceId String?
  kind      BillingAdjustmentKind  // SURCHARGE | REBATE | RECONCILIATION_CREDIT | ROUNDING
  amount    Decimal @db.Decimal(10,2)  // sinalizado
  reason    String
  createdById String
}
```

Existe para que **o extrato bancário nunca mais escreva em dinheiro de contrato**. Hoje `receivable-task-match.service.ts:1163-1189` acrescenta um `TaskQuoteService` com o valor cheio do crédito e soma em `subtotal`/`total` — e como `TaskQuoteService.amount` é preço por veículo, R$ 1.000 vira R$ 4.000 no primeiro recálculo. O mesmo arquivo em `:1290` promove o orçamento a `BILLING_APPROVED` direto, sem fatura, sem nota, sem boleto e sem carimbar fatia.

### 2.12 `PurchaseOrder` [NOVO]

```prisma
model PurchaseOrder {
  id         String @id @default(uuid())
  customerId String
  number     String
  issuedAt   DateTime?
  @@unique([customerId, number])
}
```

`Task.purchaseOrderId` (nullable, SetNull). `Task.customerOrderNumber` permanece como coluna legada até a Fase 6. "Os 20 primeiros no pedido 8842" vira consulta, em vez de reconstrução por `orderNumbersOfTasks()`/`orderNumberLabel()`.

### 2.13 `ContractVehicleDelivery` → não existe; `deliveredAt` vive em `QuoteBillingTask` [ALTERA]

`QuoteBillingTask` ganha `deliveredAt DateTime?`, carimbado na transição `READY → APPROVED` a partir de `Task.finishedAt`. A partir daí, **fechar uma O.S. de produção não move mais o vencimento de um boleto** (hoje move: `invoice-generation.service.ts:216-226`). Antes da aprovação, a data continua sendo lida ao vivo e é **editável na tela de faturamento** (2.14 / seção 3).

### 2.14 `ServiceOrder` [ALTERA mínimo]

- **[NOVO]** `kind ServiceOrderKind` (`NEGOTIATION | PRODUCTION | ARTWORK | LOGISTIC | COMMERCIAL_OTHER`), backfillado de `type` + `descriptionNormalized`. Mata `EM_NEGOCIACAO_DESC` e a comparação de string.
- **[NOVO]** índice parcial `UNIQUE (taskId) WHERE kind='NEGOTIATION' AND status <> 'CANCELLED'` — impede duplicata **por tarefa**, que é o que de fato acontece hoje.
- `taskId` **continua NOT NULL**. `ServiceOrder.quoteId` **não é criado** nesta rodada. `syncEmNegociacaoForQuote` continua sendo o laço, agora casando por `kind` em vez de texto.

### 2.15 A assinatura: `materialProjection` v7

**v7 corrige um defeito real e NÃO afrouxa nada.** O defeito: `build()` lê desconto, condição e texto customizado apenas de `customerConfigs[0]` (`quote-snapshot.service.ts:439, 484-488`), enquanto o documento imprime **uma cláusula por grupo**. Hoje, trocar a condição de pagamento do 2º lote muda o PDF e **não invalida** as assinaturas colhidas. É o inverso do que a v6 foi criada para garantir.

**v7 inclui:** número do orçamento, garantia, prazo, `simultaneousTasks`, veículos (`taskId`, série, placa, chassi), serviços com preço padrão, **todos os `QuoteServiceOverride`**, `billingSplit`, **todos os grupos de cobertura com contagem e valor** (`billingGroups`), e **todas as `QuoteTerms`** (desconto, `paymentSpec`/`paymentCondition`, `customPaymentText`, rótulo do lote) — não só a primeira.

**v7 exclui:** datas concretas de vencimento já calculadas, número de boleto, número de nota, `generateInvoice`, `generateBankSlip`, `QuoteBilling.status`, `cycle`, qualquer `Invoice`/`Installment`.

**Compatibilidade — a parte inegociável.** O risco que afundou as outras duas propostas não é o lado congelado, é o **lado vivo**: `onQuoteContentChanged` chama `buildForQuote(quoteId)` no banco atual e `matchesFrozenTerms` projeta esse snapshot vivo em v1..v6 procurando casar com o hash selado (`quote-snapshot.service.ts:660-677`, `signature-envelope.service.ts:4821-4871`). Se uma coluna que a projeção v5/v6 lê desaparecer, **todo envelope aberto vai a `INVALIDATED` e todo signatário a `VOIDED`, com e-mail**.

Por isso:
1. Nenhuma coluna que v5/v6 leem é removida nesta rodada. `billingSplit` fica. `QuoteBillingTask` fica (renomeada? **não** — mantém o nome). O rename de `TaskQuoteCustomerConfig` para `QuoteBilling` preserva `quoteId`, `customerId` e as coberturas, então a projeção v5/v6 continua computável — e o projetor passa a lê-las do novo nome, produzindo **os mesmos bytes**.
2. **Portão bloqueante (P9-G1):** recomputar v5 e v6 de **todos** os envelopes `SEALED` **e** de todos os envelopes ABERTOS (comparando `buildForQuote` vivo × `matchesFrozenTerms`), antes e depois de cada passo de backfill. Um único hash divergente, ou um único envelope aberto que deixe de casar, **aborta a migração**.
3. v7 só vale para envelopes criados **depois** do corte. `SignatureEnvelope.snapshotVersion` grava a versão usada; envelopes existentes nunca são reprojetados em v7.

### 2.16 Aditivo de identificação de veículo

O preenchimento tardio de placa/chassi continua **tolerado** (`tolerateLateRegistration`, `matchesFrozenTerms:660-668`) e **não** vira aditivo numerado. O que muda é só a estrutura de armazenamento, e só quando `lateSlots` precisar ser consultável: **[NOVO]** `EnvelopeVehicleSlot (envelopeId, taskId, field PLATE|CHASSIS|SERIAL, value, filledAt, filledById)`, escrito **em espelho** com o Json `lateSlots` (que permanece, porque a projeção v5/v6 o lê). O aditivo em si continua sendo um por envelope nesta rodada.

---

## 3. AS TELAS

Princípio: **cada tela é endereçada pela entidade que ela edita.** Hoje a tela de orçamento é endereçada por tarefa (4 URLs para 1 documento) e a de faturamento também (1 URL para 4 cobranças). Os dois erros são simétricos e opostos.

### 3.1 Orçamento

| rota | o que mostra | por que faz sentido |
|---|---|---|
| `/financeiro/orcamento` | Lista de **orçamentos**, uma linha por orçamento: nº, cliente(s), **N veículos** (chips de série/placa), total do CONTRATO, validade, status da proposta, assinaturas (3/4), medidor "faturado 2/4", comercial. Ordenação e filtro de valor sobre **o mesmo número que a célula exibe**. | Hoje é `useTasks` (`budget-table-page.tsx:88`): o 604 é 4 linhas idênticas, com a coluna "Veículos" **oculta por padrão** só para explicar a duplicação. E a célula divide por N enquanto ordenação (`budget-table-columns.tsx:368`) e filtro (`budget-table-filters.tsx:201`) usam o total cheio — a coluna sai visivelmente fora de ordem e "até R$ 50.000" esconde linhas que exibem R$ 12.000. |
| `/financeiro/orcamento/cadastrar` | Inalterado em forma (placas × séries → produto cartesiano), **mas termina no orçamento criado**, não na preparação do primeiro caminhão. | `create.tsx:949` hoje deposita o operador na tela de produção de um dos quatro, sem link de volta. |
| `/financeiro/orcamento/:quoteId` | Detalhe do orçamento, abas em vez de wizard: **Proposta** (validade, garantia, prazo, simultâneas) · **Veículos** (a grade) · **Serviços** · **Pagadores** (um card por `QuoteTerms`) · **Assinatura** · **Resumo**. Cabeçalho: "Orçamento 604 — Marquespan — 4 veículos — R$ 730.224,00". | Elimina as 4 URLs, o título batizado com o nome de um caminhão (`[taskId].tsx:1744`), o breadcrumb com o nome de outro e o paginador prev/next que **reabre o mesmo orçamento** (`:357`). A tela **pública** já é chaveada por `quoteId` e está certa; a interna passa a concordar com ela. |
| `/financeiro/orcamento/:quoteId/veiculos` | **A GRADE.** Linhas = veículos (série, placa, chassi, pedido, layout), colunas = serviços, células = `QuoteServiceOverride.amount` editável com checkbox "incluído". Rodapé por coluna (total do serviço) e por linha (total do veículo). Ações em massa: aplicar valor a todos, incluir/excluir serviço em todos, **Adicionar veículo**, **Remover veículo**. | É **a resposta a "onde o usuário corrige o valor de cada tarefa"** no lado da venda. Hoje não existe: o preço por veículo é `total ÷ vehicleCount` e **nenhuma tela do repositório acrescenta ou remove um veículo** (`[taskId].tsx:335` é só leitura). |
| `/financeiro/orcamento/:quoteId/veiculos/:taskId` | Drawer sobre a grade, com URL própria: nome, categoria, implemento, série, placa, chassi, foto da plaqueta, pedido, **layout deste veículo**, aerografias, previsão, prazo, responsáveis, tinta, e os serviços/preço dele. Navegação lateral com os outros N−1. | Substitui o passo 1 do wizard, que grava só na tarefa da URL (`[taskId].tsx:1335`) e **não diz que existem outros três** (`taskCount` é fixado em 1 na edição, `budget-step-task.tsx:110`). Corrige também o layout, hoje escolhido entre as artes **do veículo aberto** (`:1730`), e as aerografias, que na edição aparecem e **somem no save sem erro** (`budget-step-task.tsx:677`). |
| `/financeiro/orcamento/:quoteId/pagadores` | Um card por `QuoteTerms`: pagador, lote, desconto, cláusula de pagamento, contato que assina, e os serviços atribuídos àquele pagador (`invoiceToCustomerId`). | Hoje o passo "Cliente k" mistura isso com a edição do **cadastro mestre** do cliente (`[taskId].tsx:1366`) e esconde o controle junto/separado/lotes dentro do card do **primeiro** cliente (`budget-step-customer-payment.tsx:623`) — inalcançável sem pagador selecionado, invisível com um veículo só. |
| `/financeiro/orcamento/:quoteId/assinatura` | Envelopes, versões, signatários por recorte, prazo, lembretes, o PDF, o hash material com **a lista do que ele cobre**, e a fila de slots tardios por veículo. | O operador precisa saber, antes de editar, o que vai derrubar a coleta. |
| `/cliente/:customerId/orcamento/:quoteId` (pública) | **Só a proposta**: escopo, valor, validade, cláusulas, assinatura. Nada de fatura, parcela, boleto ou NFS-e. | Hoje `findPublic` (`task-quote.service.ts:4227`) serve fatura, parcela, boleto e NFS-e atrás de uma capability que é só o UUID do orçamento. Aprovação e cobrança têm públicos, janelas de vida e sensibilidades diferentes. |

### 3.2 Faturamento — e a resolução explícita do sintoma (B)

O sintoma (B) tem **duas metades**, e só corrigir uma delas seria trocar um defeito por outro:

1. *"Tudo vive numa página só, indexada por uma tarefa."* → **Quebrar em N páginas, uma por faturamento.**
2. *"O passo 1 corrige valores de UMA tarefa só."* → Isto **não** se resolve mandando o operador ao módulo de orçamento. Os campos do passo 1 (`plate`, `chassisNumber`, `customerOrderNumber`, `serialNumber`, foto da plaqueta, `finishedAt`) são **fiscais**: saem na NFS-e (`orderNumber`, discriminação), no `seuNumero` do boleto e no **vencimento** das parcelas. O financeiro os corrige na véspera da emissão, com a fatia aberta na frente. A resposta certa é **"corrija os N veículos COBERTOS aqui"** — uma grade dentro da própria fatia, não 20 idas e voltas a outro módulo.

| rota | o que mostra | por que faz sentido |
|---|---|---|
| `/financeiro/faturamento` | Lista de **faturamentos** (`QuoteBilling`), uma linha por fatia: nº, orçamento de origem (link), pagador, **cobertura** ("2 de 4 veículos" + chips), valor, status da fatia, próximo vencimento, NFS-e (nº), boleto. No 604: **4 linhas, 4 estados independentes**. | Responde diretamente a "com faturamento por veículo, onde o usuário vê cada faturamento". Hoje a lista é `useTasks` (`billing-table-page.tsx:105`) e os 4 estados colapsam num escalar: caminhão 1 quitado + caminhão 2 vencido lê **"Vencido"** (`cascade:409`). |
| `/financeiro/faturamento/:billingId` | **Uma cobrança, uma página, sem wizard.** Cabeçalho: nº, orçamento, pagador, cobertura, status, total. Blocos: **(1) Veículos cobertos** — uma linha por veículo com série, **placa**, **chassi**, **pedido de compra**, **foto da plaqueta**, **`finishedAt`/entrega** e valor, tudo editável enquanto `DRAFT`/`READY`, tudo congelado a partir de `APPROVED`, com o delta contra o preço vendido em destaque. **(2) Condição e parcelas** com datas. **(3) Documentos**: NFS-e do ciclo vigente + substituídas, boletos, recibos. **(4) Ajustes** (`BillingAdjustment`). **(5) Histórico**: aprovado por, revertido por, refaturado de. Ações: **Aprovar**, **Reverter esta fatia**, **Refaturar (novo ciclo)**, **Cancelar**. | É o sintoma (B) desmontado inteiro. As duas metades: N páginas, e o bloco (1) é o "passo 1" corrigido — não de um veículo, mas **dos veículos que esta fatura cobra**, que é exatamente o escopo de quem vai emitir a nota. E **Reverter alcança uma fatia só**: hoje `revertBillingApproval` (`:3605`) baixa os boletos dos caminhões 1–3 para corrigir o 4, e a guarda de parcela paga (`:3662`) é quote-wide, logo uma parcela paga do caminhão 1 torna o erro do caminhão 4 **irreversível para sempre**. |
| `/financeiro/faturamento/:billingId/ciclo/:invoiceId` | Um ciclo: parcelas, nota daquele ciclo (inclusive cancelada/substituída), boletos, conciliação. Ciclo 1 cancelado visível ao lado do ciclo 2. | Refaturar deixa de exigir hard-delete de fatura e parcelas para caber no `@unique`. |
| `/financeiro/orcamento/:quoteId/faturar` | **O compositor.** Veículos do orçamento em cartões, mostrando entregue? / já coberto por fatia viva? Três atalhos: "Faturar juntos" (1 fatia com N), "Um por veículo" (N fatias), "Criar lote com os selecionados" (repetível). Cada fatia nasce em `DRAFT` com valores herdados e editáveis; nada é emitido antes de Aprovar. Veículo não coberto fica realçado. | Torna os quatro modos **a mesma operação sobre conjuntos**. Aposenta o `BillingSplitField` enterrado no passo "Cliente 1". E resolve o caso "JOINT deixa de ser JOINT em silêncio": acrescentar um veículo depois de aprovar hoje cria uma segunda fatia sem aviso (`quote-money.ts:173` + `sync:304-306`); aqui o compositor mostra a fatia nova como um cartão, explícito. |
| `/financeiro/faturamento/a-faturar` | A fila: veículos **entregues** (`finishedAt` preenchido) sem fatia ativa. Agrupável por cliente, orçamento e pedido de compra; seleção múltipla leva ao compositor. | É a pergunta que hoje não se pode fazer — "o que entreguei e não cobrei?" — e a única defesa contra o custo da flexibilidade nova: veículo sem faturamento passa a ser estado legal; sem esta tela, é estado **invisível**. |
| `/producao/tarefa/:taskId` → aba **Comercial e cobrança** | Para um veículo: o orçamento em que foi vendido (nº, preço, serviços) e a(s) fatia(s) que o cobram (nº, valor, status, NFS-e, boletos) — a nota lida por `NfseDocumentTask`. Leitura, com links. | Hoje `GET /invoices/task/:taskId/nfse-history` consulta `where: { taskId }` (`invoice.controller.ts:2028`), que é **nulo por construção** em nota conjunta: num JOINT de 4 veículos com nota autorizada, os quatro exibem histórico fiscal **vazio**. |
| `/financeiro/faturamento/detalhes/:id` (legado) | **Redirect com desambiguação por tipo.** Resolve o `:id` em três tentativas, nesta ordem: (a) é um `Invoice.id`? → `/financeiro/faturamento/:billingId/ciclo/:id`; (b) é um `Task.id`? → uma fatia ativa cobrindo-o ⇒ 302 para ela; várias ⇒ tela curta de escolha; nenhuma ⇒ `/financeiro/faturamento/a-faturar?task=<id>`; (c) nada disso ⇒ 404 com busca. | A rota **não recebe só taskId**: `fiscal-documents-columns.tsx:178` e `fiscal-documents-by-date-accordion.tsx:628` passam um **invoiceId**, e `deep-link-redirect.tsx:48` mapeia `bankslip` para cá. Um redirect que só entende taskId quebraria esses dois. Links já enviados com a string literal `null` (ver 5, defeitos 6–8) passam a cair na busca em vez de numa tela morta. |
| `/cliente/:customerId/faturamento/:billingId` (pública) | Para o cliente: veículos cobrados, valor, parcelas, boletos, NFS-e. Nada da proposta. | Separa a capability de cobrança da de aprovação. |

---

## 4. A MIGRAÇÃO

Regra absoluta, aplicada a cada passo: **nenhuma NFS-e emitida, nenhum boleto registrado e nenhuma assinatura coletada pode ser perdida, alterada ou invalidada.** Onde houver dúvida, a migração **trava** e pede decisão humana; nunca escolhe em silêncio.

Legenda: `[SQL]` migration · `[BF]` backfill (script idempotente, transação por orçamento, relatório antes/depois) · `[COD]` código · `[GATE]` portão de verificação bloqueante.

### FASE 0 — Estancamento (nada muda de forma; cada item entrega valor sozinho)

Executável **hoje**, antes e independentemente do resto. Se a reforma morrer, isto ainda vale.

| # | tipo | o quê |
|---|---|---|
| 0.1 | `[SQL]`+`[COD]` | Alinhar schema ao banco: remover `@unique` de `Invoice.customerConfigId` no `schema.prisma` e declarar o índice parcial existente como não gerenciado (migration vazia com `-- managed manually`). **Primeiro de tudo.** |
| 0.2 | `[SQL]` | `CREATE UNIQUE INDEX CONCURRENTLY nfse_live_per_invoice_tmp ON "NfseDocument"("invoiceId") WHERE "invoiceId" IS NOT NULL AND status IN ('PENDING','PROCESSING','AUTHORIZED','CANCEL_REQUESTED','CANCEL_REJECTED')` — trava provisória contra nota dupla, substituída em 4.4 pelo índice por ciclo. Rodar antes um `SELECT` de duplicatas vivas e resolvê-las à mão. |
| 0.3 | `[SQL]` | `Cascade → Restrict` em `Installment.customerConfig`, `Invoice.customerConfig`, `BankSlip.installment`. **Pré-requisito de todo o resto**: sem isto a própria migração pode apagar parcela paga. |
| 0.4 | `[COD]` | `cancelInvoice` (`invoice.service.ts:271`) passa a zerar `billingApprovedAt` da fatia. Destrava o beco sem saída; dados nesse estado **não migram**. |
| 0.5 | `[COD]` | `PUT /tasks/:id` e `/tasks/batch` deixam de aceitar o bloco `quote` aninhado; passam a delegar ao serviço de orçamento (com guardas e `onQuoteContentChanged`). Enquanto houver dois caminhos, o backfill corre atrás da escrita. |
| 0.6 | `[COD]` | Trocar os cinco `findFirst({quoteId})` sem `orderBy` por laço ou ordenação determinística (`service:1064, 2186, 2732, 3810`; `cascade:38`). Dado sorteado não migra reprodutivelmente. |
| 0.7 | `[COD]` | Guardar o nulo nos dois deep links (`sicredi-webhook.service.ts:389,392` e `invoice.controller.ts:148,151`) — os vizinhos no mesmo arquivo já guardam. |
| 0.8 | `[COD]` | Histórico de NFS-e e faturas por tarefa passam a usar o `OR` que `assertBillingArtifactsConfirmed` já usa (`task-quote.service.ts:3409`): `OR: [{taskId}, {quote:{tasks:{some:{id:taskId}}}}]`. |
| 0.9 | `[COD]` | `hasValueAffectingChange` (`:870`) passa a olhar `data.taskIds`. Hoje acrescentar/retirar veículo muda o total e **não** derruba a aprovação. |
| 0.10 | `[COD]` | Corrigir o rollback de `internalApprove`: o catch (`:3114`) deixa de forçar `BUDGET_APPROVED` cegamente (restaura o status anterior), reverte `billingApprovedAt` das fatias carimbadas no claim (`:2927`) e o `billingApprovedAt` do orçamento (`:2912`). |
| 0.11 | `[COD]` | Guarda de remoção de fatia (`task-quote-customer-config-sync.ts:511`) passa a olhar **parcela PAID independentemente do status da fatura**. |

**`[GATE]` 0-G:** suíte verde; recomputar v5/v6 de todos os envelopes `SEALED` e confirmar hash byte-idêntico; nenhum envelope aberto muda de veredito em `matchesFrozenTerms`.

### FASE 1 — Tabelas e colunas novas, vazias `[SQL]`

Puramente aditivo, zero downtime, nenhuma constraint nova, nenhuma coluna removida:
`QuoteTerms`, `QuoteServiceOverride`, `InvoiceCoverage`, `NfseDocumentTask`, `BillingAdjustment`, `PurchaseOrder`, `EnvelopeVehicleSlot`.
Colunas nullable: `TaskQuoteCustomerConfig.billingNumber/status/approvedById/revertedAt/revertedById/revertReason/supersedesBillingId/termsId`, `Invoice.cycle`, `NfseDocument.billingId/cycle`, `QuoteBillingTask.deliveredAt`, `Task.purchaseOrderId`, `ServiceOrder.kind`, `SignatureEnvelope.snapshotVersion`, `TaskQuote.hasVehiclePricing`.

### FASE 2 — Backfill `[BF]`

Ordem obrigatória. Cada passo emite relatório **antes** (o que vai mudar) e **depois** (o que mudou), e cada um é reexecutável.

| # | o quê | regra |
|---|---|---|
| 2.1 | `SignatureEnvelope.snapshotVersion` | `= 6` onde `quoteSnapshot` existe e a projeção v6 casa; `= 5` onde casa v5; `NULL` + relatório onde nenhuma casa. **Roda primeiro**, para que o portão de hash tenha baseline. |
| 2.2 | `PurchaseOrder` + `Task.purchaseOrderId` | `DISTINCT (customerId, customerOrderNumber)`. `customerOrderNumber` fica. |
| 2.3 | `ServiceOrder.kind` | `NEGOTIATION` onde `type=COMMERCIAL` **e** `descriptionNormalized` casa "em negociacao"; senão `PRODUCTION`/`ARTWORK`/`LOGISTIC` por `type`; demais comerciais → `COMMERCIAL_OTHER`. |
| 2.4 | `QuoteTerms` | Uma linha por `(quoteId, customerId, label)`. **Chave de dedup:** `(discountType, discountValue, discountReference, customPaymentText, resolvePaymentTerms(...) normalizado com chaves ordenadas)` — **sem** `customerSignatureId`, que é por fatia. Fatias idênticas ⇒ um `QuoteTerms` com `label=''`. Fatias divergentes ⇒ `Lote 1`, `Lote 2`… **pela ordem de `createdAt`**, e a de menor `createdAt` ganha `label=''` — que é exatamente a que `customerConfigs[0]` já alimentava no hash, de modo que a projeção v5/v6 não muda. Divergências vão para relatório, nunca são silenciadas. |
| 2.5 | `QuoteBilling.termsId` | liga cada fatia ao seu `QuoteTerms`. |
| 2.6 | `QuoteBilling.billingNumber` | sequence nova, ordenada por `(billingApprovedAt NULLS LAST, createdAt)`. |
| 2.7 | `QuoteBilling.status` | derivado **por fatia**: sem `billingApprovedAt` → `DRAFT`; com `approvedAt` e sem fatura → `APPROVED`; com fatura ativa e parcelas todas pagas → `SETTLED`; alguma vencida → `DUE`; alguma paga e outras não → `PARTIAL`; todas a vencer → `UPCOMING`; só faturas CANCELADAS **e** `approvedAt` nulo (pós-0.4) → `DRAFT`; só faturas CANCELADAS **e** `approvedAt` preenchido → `REVERTED`. |
| 2.8 | `Invoice.cycle` | `1` para a fatura não-cancelada; `1..n-1` para as canceladas por ordem de `createdAt`, a viva com o maior ciclo. `supersededByInvoiceId` encadeia. |
| 2.9 | `InvoiceCoverage` | Para cada `Invoice`: os veículos de `QuoteBillingTask` da fatia; `amount = totalAmount ÷ nº cobertos` com o **centavo residual no último item**, de modo que `Σ == totalAmount` **exatamente**. Série e placa copiadas. **Fatia com cobertura vazia E fatura viva: a migração TRAVA** — a cobertura é deduzida da discriminação da NFS-e e exige conferência humana antes de prosseguir. |
| 2.10 | `QuoteBillingTask.deliveredAt` | `= Task.finishedAt` apenas para fatias em `APPROVED` ou além. |
| 2.11 | `NfseDocumentTask` + `NfseDocument.billingId/cycle` | `taskId` preenchido → 1 linha; nulo com `invoiceId` → as tasks da `InvoiceCoverage` daquela fatura; só `quoteId` → todas as tasks do orçamento, marcadas `inferred=true` no relatório. `billingId`/`cycle` de `Invoice`. **Órfãs sem fatura ficam com `billingId` nulo** e conservam `quoteId`/`taskId`. Nada em `elotechNfseId`, `nfseNumber`, `status`, `cancel*` ou `superseded*` é tocado. |
| 2.12 | `Installment.invoiceId` órfão | Adotar pela fatia: parcela com `customerConfigId` e sem `invoiceId` recebe a `Invoice` do maior ciclo daquela fatia; se não houver nenhuma, cria-se uma `Invoice` histórica `status=CANCELLED`, `cycle` novo, `totalAmount = Σ` das órfãs. Parcelas de `externalOperationId` **não são tocadas**. Renumerar `number` por fatura preservando ordem de `dueDate`. |
| 2.13 | `EnvelopeVehicleSlot` | Parse de `lateSlots` nas **duas gramáticas** (`plate` cru e `plate#<taskId>`). O Json **permanece**. |

**`[GATE]` 2-G (bloqueante, roda após cada um de 2.4 a 2.12):**
(a) recomputar v5/v6 de todo envelope `SEALED` ⇒ hash byte-idêntico;
(b) para todo envelope ABERTO, `matchesFrozenTerms(buildForQuote(quoteId))` devolve o **mesmo** veredito de antes;
(c) `Σ InvoiceCoverage.amount == Invoice.totalAmount` para toda fatura, tolerância 0;
(d) nenhuma parcela `PAID` sem `invoiceId`;
(e) contagem de `NfseDocument` por status inalterada.

### FASE 3 — Rename e convivência

| # | tipo | o quê |
|---|---|---|
| 3.1 | `[SQL]` | `ALTER TABLE "TaskQuoteCustomerConfig" RENAME TO "QuoteBilling"`; `Invoice.customerConfigId → billingId`; `Installment.customerConfigId → billingId`; `billingApprovedAt → approvedAt`. Renomear índices e constraints nominalmente. **Ids preservados.** Conferir colunas geradas em SQL cru (`ServiceOrder.descriptionNormalized`, `Invoice.notesNormalized`) e índices parciais nomeados literalmente. |
| 3.2 | `[COD]` | Varredura dos 30 arquivos `.ts` que citam `customerConfigId`/`TaskQuoteCustomerConfig`, **incluindo scripts de produção** (`resubstitute-tati-minas-nfse.ts`, `cleanup-test-billing-task.ts`, `nfse-tomador.mapper`). |
| 3.3 | `[COD]` | `QuoteBillingService` novo em `modules/financial/billing`: `create`, `approve(billingId)`, `revert(billingId)`, `reissue(billingId)`, `cancel(billingId)`. Recebe as ~1.400 linhas hoje em `task-quote.service.ts`. As rotas antigas (`PUT /task-quotes/:id/internal-approve[/:taskId]`, `/revert-billing`) viram **alias depreciado** por uma release. |
| 3.4 | `[COD]` | `cascadeFromBilling(billingId)` deriva o status da fatia; `cascadeFromQuote` passa a apenas **agregar** os `QuoteBilling.status` para o rollup em `TaskQuote.status`, e vira o **único** escritor dos 5 valores de cobrança. |
| 3.5 | `[COD]` | `receivable-task-match.service.ts` para de escrever em `TaskQuoteService`/`subtotal`/`total` (`:1163`) e em `TaskQuote.status` (`:1290`): passa a criar `BillingAdjustment` e a delegar o estado a `cascadeFromBilling`. |
| 3.6 | `[COD]` | Numeração de parcelas centralizada em `nextInstallmentNumber(invoiceId)`. |

**Duração mínima da convivência:** um ciclo de faturamento completo com dados reais, incluindo **pelo menos uma reversão e um refaturamento de fatia** — o ciclo 2 é a capacidade central e não pode chegar à Fase 4 sem ter sido exercitada.

### FASE 4 — Constraints `[SQL]`, só depois do backfill conferido

(a) `UNIQUE (billingId, cycle)` em `Invoice`; **drop** de `Invoice_customerConfigId_active_unique`.
(b) `UNIQUE (invoiceId, number) WHERE invoiceId IS NOT NULL` em `Installment`; drop de `(customerConfigId, number)` **só depois de 3.6 em produção**.
(c) `nfse_live_per_billing_cycle` (2.9); drop do índice provisório 0.2.
(d) `UNIQUE (quoteId, customerId, label)` em `QuoteTerms`; FK composta `QuoteBilling(quoteId,customerId) → QuoteTerms`.
(e) `UNIQUE (taskId) WHERE kind='NEGOTIATION' AND status <> 'CANCELLED'` em `ServiceOrder`.
(f) `InvoiceCoverage.task` `Restrict`; **remover** `Invoice.task onDelete: Cascade`.
(g) `UNIQUE (serviceId, taskId)` em `QuoteServiceOverride`.

Cada `CREATE UNIQUE INDEX` roda precedido de `SELECT` de violação: se algum falhar, há dado que o código vinha violando em silêncio, e isso é um achado, não um obstáculo.

### FASE 5 — v7 `[COD]`, sem SQL

`materialProjection` v7 conforme 2.15. `QUOTE_MATERIAL_SCHEMA_VERSION = 7`. Envelopes existentes guardam `snapshotVersion` e nunca são reprojetados. Teste obrigatório com um envelope selado real, com PAdES e carimbo de tempo, antes de subir.

### FASE 6 — Remoção (≥ 30 dias e um fechamento fiscal após a Fase 4, com dump antes) `[SQL]`

`DROP` das colunas de `QuoteBilling` espelhadas em `QuoteTerms` (`discount*`, `paymentCondition`, `customPaymentText`, `customerSignatureId`); `Task.customerOrderNumber`; `Invoice.taskId`.
**NÃO se remove nesta rodada:** `TaskQuote.billingSplit` (material, impresso, lido por v5/v6), `QuoteBillingTask` (cobertura de trabalho), `SignatureEnvelope.lateSlots` (lido por v5/v6), `NfseDocument.quoteId`/`taskId` (âncoras duráveis + dossiê).
`[COD]` deletar: `generateInstallmentsFromCondition` (morto, `:4815`), `EM_NEGOCIACAO_DESC`, `BudgetPdfExportDialog` (morto), o `orderNumber` inexistente em `task-quote-prisma.repository.ts:235`.

### Janela de execução — obrigatório para as Fases 3 e 4

Schedulers **parados** (`nfse-emission`, `sicredi-boleto`, `task-quote-payment`). Zero boletos em `CREATING`/`REGISTERING`, zero notas em `PENDING`/`PROCESSING`/`CANCEL_REQUESTED`. Consultar Sicredi e Elotech antes (é o que `assertBillingArtifactsConfirmed` já faz) e **abortar** se houver artefato em voo. Dump completo antes de cada fase.

### O dossiê — cuidado explícito

`dossier-assembler.service.ts:878-930` acha notas por `{quoteId}` e `{invoice:{customerConfig:{quoteId}}}`, e boletos por `{customerConfig:{quoteId}}`. Como `QuoteBilling` **continua tendo `quoteId`** e `NfseDocument.quoteId` **não é removido**, o dossiê continua correto sem alteração — mas os testes do dossiê entram no `[GATE]` 3-G, porque o rename atravessa aqueles caminhos.

---

## 5. CATÁLOGO DE DEFEITOS "1 ORÇAMENTO = 1 TAREFA"

54 ocorrências. `G` = gravidade: **Q** quebra · **C** confunde · **X** cosmético. `P` = pacote que resolve (seção 6).

### API — estado, aprovação, reversão

| # | G | arquivo:linha | o que o usuário vê | P |
|---|---|---|---|---|
| 1 | Q | `task-quote.service.ts:3605` (+`:3662`, `:3315`) | Corrigir a fatura do caminhão 4 baixa os boletos dos caminhões 1–3 e apaga as faturas deles. Se o caminhão 1 tiver parcela paga, o 4 fica **irreversível para sempre**. | P2 |
| 2 | Q | `invoice.service.ts:271-297` | Cancelou a fatura: o orçamento volta a "Aprovado" mas não aceita nem aprovar ("já aprovado") nem reverter ("status não revertível"). Beco sem saída. | P0 |
| 3 | Q | `task-quote.service.ts:2927` | Falha na geração ⇒ fatia carimbada como faturada sem fatura. Próxima tentativa: "este veículo já teve o faturamento aprovado" sobre um caminhão nunca faturado. | P0 |
| 4 | Q | `task-quote.service.ts:3114` | Falha ao aprovar o caminhão 31 rebaixa o orçamento inteiro para "Orçamento Aprovado", com 1–30 já faturados, boletos vivos e notas autorizadas. | P0 |
| 5 | Q | `task-quote.service.ts:2912` | Após rollback, orçamento em `BUDGET_APPROVED` com `billingApprovedAt` preenchido — enviesa `avgSalesCycleDays`. | P0 |
| 6 | Q | `task-quote.service.ts:2439` | Notificação de boleto pago leva a `/financeiro/faturamento/detalhes/null`. | P0 |
| 7 | Q | `sicredi-webhook.service.ts:389,392` | Idem, a partir do webhook do banco. | P0 |
| 8 | Q | `invoice.controller.ts:148,151` | Idem, a partir da fatura. | P0 |
| 9 | Q | `invoice.controller.ts:2028` | Histórico fiscal do veículo **vazio** em toda nota conjunta ou de lote: não vê nº da NF, nem pedido de cancelamento, nem substituição. | P0 |
| 10 | Q | `invoice-prisma.repository.ts:239-247` | `GET /invoices/task/:taskId` devolve vazio em fatura conjunta (a web já contorna com `/invoices/quote/:id`). | P0 |
| 11 | Q | `task.service.ts:7283` / `task-quote.service.ts:3795` | Cancelar o caminhão 4 (que nem começou) **destrói a cobrança do caminhão 1**, já entregue e faturado, e cancela na prefeitura uma nota de serviço prestado. Com parcela paga, o erro é engolido (`:7287`) e tarefa e orçamento ficam meio-a-meio. | P2 |
| 12 | Q | `task-quote-customer-config-sync.ts:511` | Remover um cliente cuja fatura está CANCELADA apaga em cascata parcela **PAGA**, boleto e `ReconciliationMatch`. | P0 |
| 13 | Q | `task-quote-totals.ts:64` | Apagar um caminhão de um JOINT já faturado faz a tela mostrar valor menor que o boleto cobra e que a nota autorizada diz. | P2 |
| 14 | Q | `receivable-task-match.service.ts:1290` | Conciliação bancária promove o orçamento a `BILLING_APPROVED` sem fatura, sem nota, sem boleto e sem carimbar fatia. | P5 |
| 15 | Q | `receivable-task-match.service.ts:1163-1189` | Extensão de R$ 1.000 pelo extrato vira **R$ 4.000** no primeiro recálculo; `Invoice.totalAmount` fica divergente (log "AMOUNT DIVERGENCE"). | P5 |
| 16 | Q | `task-prisma.repository.ts:2245-2440` | `PUT /tasks/:id` altera contrato sem guarda e **sem reavaliar assinatura** — alteração material entra e nenhum envelope é invalidado. | P0 |
| 17 | Q | `schema.prisma:4670` vs `20260506000001` | Um `migrate dev` recria o unique global e mata o refaturamento; o Prisma pode entregar a fatura CANCELADA na relação to-one e liberar reescrita de cobertura viva. | P0 |
| 18 | Q | `task-quote.service.ts:870-902` | Acrescentar/retirar veículo muda o total e o orçamento **continua "aprovado"** — com as assinaturas caindo em silêncio. | P0 |
| 19 | Q | sem índice em `NfseDocument` | Duas notas vivas para o mesmo ciclo na prefeitura (defeito de 15/09). | P2 |
| 20 | Q | `quote-snapshot.service.ts:439,484-488` | Trocar a condição de pagamento do 2º lote **muda o PDF e não invalida** as assinaturas colhidas. | P3 |
| 21 | Q | `task-quote-prisma.repository.ts:235` | Qualquer chamada a `repository.create` morre em 500 (`orderNumber` é coluna inexistente). | P8 |
| 22 | C | `task-quote-status-cascade.service.ts:409` | Caminhão 1 quitado + caminhão 2 vencido ⇒ o orçamento inteiro lê **"Vencido"**. | P1 |
| 23 | C | `task-quote.service.ts:2842-2844` | Aprovar sem `:taskId` num PER_TASK de 60 emite 60 faturas, 60 NFS-e e 240 boletos num clique — inclusive de veículos não terminados, cujo vencimento passa a correr da aprovação. | P1 |
| 24 | C | `quote-money.ts:173-205` + `sync:304-306` | JOINT deixa de ser JOINT: acrescentar um veículo depois de aprovar cria uma **segunda fatura em silêncio** num orçamento que a tela declara "conjunto". | P7 |
| 25 | X | `invoice-generation.service.ts:1031` | `seuNumero` do boleto vira fragmento de UUID quando a fatura cobre >1 veículo e o cliente não tem NFS-e. | P2 |
| 26 | X | `invoice-generation.service.ts:216-226` | Fechar uma O.S. de produção **move o vencimento** de um boleto. | P5 |
| 27 | C | `task-quote.service.ts:2178-2409` | Mudar o status para "Quitado" **cria faturas** e **cancela boletos no Sicredi**. | P1 |
| 28 | C | `task-quote.controller.ts:320` / `:3970-4022` | Rota chamada "customer-config-order-number" não toca em configuração nenhuma: grava `Task.customerOrderNumber`; o `customerId` do corpo é decoração. | P5 |
| 29 | C | `task-quote-receipt.service.ts:83-84,159` | O recibo de quitação de 4 veículos sai com o nome do arquivo baseado na série do **primeiro**. | P8 |
| 30 | C | `task-quote.service.ts:4227` | A página pública de aprovação do cliente serve fatura, parcela, boleto e NFS-e atrás de um UUID. | P7 |
| 31 | X | `task-quote.service.ts:4815-4889` | Gerador de parcelas morto e divergente do vivo (sem piso hoje+3, sem rolagem de fim de semana/feriado). | P8 |
| 32 | C | `task-quote.service.ts:1064` | O responsável de **todas** as fatias de cobrança é o da primeira tarefa encontrada, sem ordenação. | P0 |
| 33 | C | `task-quote.service.ts:2186` | `settleManually` escolhe por sorteio a tarefa que gera **todas** as faturas. | P0 |
| 34 | C | `task-quote.service.ts:2732` | O veículo que batiza a notificação e o deep link muda entre duas leituras. | P0 |
| 35 | C | `task-quote.service.ts:3810` | A âncora da desmontagem é sorteada. | P0 |
| 36 | C | `task-quote-status-cascade.service.ts:38` | A notificação nomeia um dos quatro caminhões, ao acaso. | P0 |

### WEB — orçamento

| # | G | arquivo:linha | o que o usuário vê | P |
|---|---|---|---|---|
| 37 | Q | `routes.ts:203` / `details/[taskId].tsx` | O orçamento 604 tem **quatro URLs**, cada uma com um passo 1 diferente. A tela pública do mesmo documento é chaveada pelo orçamento. | P6 |
| 38 | Q | `budget-table-page.tsx:88` | Filtrar "Nº do Orçamento = 604" devolve **quatro linhas idênticas**; a coluna "Veículos", que explica a duplicação, vem oculta. | P6 |
| 39 | Q | `budget-table-columns.tsx:367-368` | Clicar em "Valor" produz uma coluna visivelmente fora de ordem. | P6 |
| 40 | Q | `budget-table-filters.tsx:201-202` | "Até R$ 50.000" esconde linhas que exibem R$ 12.000 e mostra linhas que exibem R$ 3.000. | P6 |
| 41 | Q | `[taskId].tsx:335-347` | **Não existe tela que acrescente ou remova um veículo.** Um quinto caminhão exige outro orçamento, outro número, outra cerimônia. | P6 |
| 42 | Q | `[taskId].tsx:498-503` | Em PER_TASK com 4 fatias, o wizard mostra **um** passo "Cliente 1": desconto, condição, gerar NF e gerar boleto são editáveis só em bloco; as parcelas das fatias 2..N são lidas e nunca exibidas nem reenviadas. | P6 |
| 43 | Q | `[taskId].tsx:1706-1730` | A arte aprovada anexada ao caminhão 3 é invisível para quem abriu pelo caminhão 1. | P6 |
| 44 | Q | `budget-step-task.tsx:663-682` | Na edição, o acordeão de Aerografias aparece, aceita digitação e **some ao salvar, sem erro**. | P6 |
| 45 | Q | `budget-step-info.tsx:496-517` | Um orçamento de 4 veículos pode sair assinado dizendo "2 tarefas simultâneas" — ou 12 — sem aviso. | P6 |
| 46 | Q | `[taskId].tsx:1330-1358` | Série, placa, chassi, plaqueta, pedido, nome, previsão, prazo, tinta, layouts, arquivos-base e responsáveis: num orçamento de 4, só alcançam 1. Corrigir a placa do veículo 2 exige adivinhar a URL. | P6 |
| 47 | C | `budget-step-task.tsx:110` | Na edição, nada no passo 1 diz que este é um dos quatro caminhões. | P6 |
| 48 | C | `[taskId].tsx:822-835` | A tira diz "Tarefa" sem dizer de qual; e numera "Cliente 1..4" como se fossem veículos. | P6 |
| 49 | C | `[taskId].tsx:354-368` | "Próximo" desmonta o wizard e **reabre o mesmo orçamento**; o contador lê "1/4 … 4/4" para um documento só. | P6 |
| 50 | C | `[taskId].tsx:1643-1645,1744,1751` | Aba do navegador, cabeçalho e breadcrumb batizam o orçamento com o nome de um caminhão — um nome diferente em cada URL. | P6 |
| 51 | C | `budget-step-services.tsx:162-188` | A lista de serviços do contrato nasce diferente conforme a URL por onde se entrou. | P6 |
| 52 | C | `budget-step-customer-payment.tsx:623` | A decisão junto/separado/lotes está enterrada no card do primeiro cliente; sem pagador selecionado é inalcançável; com 1 veículo, invisível. | P6 |
| 53 | C | `create.tsx:949-951` | Depois de cadastrar quatro veículos, o operador é depositado na tela de Preparação de um deles, sem link de volta. | P6 |
| 54 | C | `[taskId].tsx:893-901` vs `create.tsx:454-459` | Dois esquemas de validação no mesmo componente; `plates`/`serialNumbers` lêem sempre vazio na edição e cada consumidor arranjou o seu recuo. | P6 |

### WEB — faturamento (sintoma B)

| # | G | arquivo:linha | o que o usuário vê | P |
|---|---|---|---|---|
| 55 | Q | `pages/financial/billing/details/[id].tsx` + `App.tsx:1636` | **O sintoma (B):** uma página, um wizard de 8 passos, quatro veículos, um passo 1 que corrige um só. | P7 |
| 56 | Q | `billing-table-page.tsx:105,146` | A lista de Faturamento é lista de tarefas: quatro linhas para uma negociação, cada uma abrindo o assistente inteiro. | P7 |
| 57 | C | `fiscal-documents-columns.tsx:178`, `fiscal-documents-by-date-accordion.tsx:628`, `deep-link-redirect.tsx:48` | A mesma rota recebe `taskId`, `invoiceId` e boleto — qualquer redirect ingênuo quebra dois dos três. | P7 |
| 58 | X | `budget-pdf-export-dialog.tsx` | Componente morto, não importado por ninguém. | P8 |

---

## 6. PACOTES DE TRABALHO

Nove pacotes. Cada um cabe em um implementador. Dependências declaradas; onde não há seta, roda em paralelo.

```
P0 ──┬── P1 ──┬── P2 ── P7
     ├── P3   ├── P5
     ├── P4   └── P8
     ├── P6
     └── P9 (transversal, acompanha P1..P5)
```

---

### **P0 — Estancamento** `[api]` · **bloqueia todos os outros** · ~2 dias
**Entrega:** Fase 0 inteira (0.1 a 0.11) + portão 0-G.
**Defeitos resolvidos:** 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 17, 18, 32, 33, 34, 35, 36.
**Critério de pronto:** `migrate dev` numa cópia do banco de produção **não** recria o unique global; um `SELECT` de notas vivas duplicadas devolve zero; um teste que cancela a fatura e reaprova passa; nenhum `findFirst({quoteId})` sem `orderBy` sobra (`grep`); recomputação de v5/v6 dos envelopes selados é byte-idêntica.
**Não faz:** nenhuma tabela nova, nenhum rename.

---

### **P1 — `QuoteBilling`: rename, número e máquina de status** `[api]` · dep: **P0** · ~4 dias
**Entrega:** Fase 1 (parte de `QuoteBilling`), 2.6, 2.7, 3.1, 3.2, 3.3 (esqueleto do serviço), 3.4, 4.e.
Enum `QuoteBillingStatus` + transições + `cascadeFromBilling` + `cascadeFromQuote` reduzida a agregador (**único escritor** dos 5 valores de cobrança em `TaskQuote.status`). `settleManually` deixa de ser transição de status do contrato: "quitado" passa a ser derivado das parcelas; "dê baixa nestes títulos" vira ação do financeiro sobre a fatura.
**Defeitos:** 22, 23, 27.
**Critério de pronto:** no 604, as quatro fatias têm status independentes; nenhum outro escritor grava `BILLING_APPROVED..SETTLED` (teste que faz `grep` + teste de integração); os 30 arquivos que citavam `customerConfigId` compilam, scripts de produção inclusive.
**Não faz:** reversão por fatia (é P2), extração de `QuoteTerms` (é P3).

---

### **P2 — Ciclo de fatura, reversão por fatia, nota por ciclo** `[api]` · dep: **P1** · ~5 dias
**Entrega:** `Invoice.cycle` + `@@unique([billingId,cycle])`; `InvoiceCoverage`; `NfseDocumentTask`; índice `nfse_live_per_billing_cycle`; `supersedePreviousNfses` reescrita para `(billingId, cycle)`; `revert(billingId)` / `reissue(billingId)` / `cancel(billingId)` com guarda **por fatia**; deleção do hard-delete (`invoice-generation.service.ts:173-199`); `cancelForTaskCancellation` escopado à(s) fatia(s) que cobrem a tarefa; `Restrict` em `InvoiceCoverage.task` e remoção do `Cascade` de `Invoice.task`; degrau de recuo de `buildSeuNumero` via `InvoiceCoverage`.
**Defeitos:** 1, 11, 13, 19, 25.
**Critério de pronto:** teste ponta a ponta que aprova 4 fatias, reverte **só** a 4ª (com parcela paga na 1ª), refatura a 4ª em ciclo 2 e vê a nota do ciclo 1 ser substituída em dois passos sem violar índice; apagar tarefa faturada é recusado com mensagem, não cascateia.
**Não faz:** telas.

---

### **P3 — `QuoteTerms` e o hash v7** `[api]` · dep: **P0** (pode correr junto de P1) · ~4 dias
**Entrega:** tabela `QuoteTerms`, backfill 2.4/2.5 com relatório de divergência, `resolvePaymentTerms` como fonte única de precedência, `materialProjection` v7 (2.15), `snapshotVersion`, gerador de PDF lendo `QuoteTerms` em vez de `customerConfigs[0]`, portão de hash automatizado (reutilizado por P9).
**Defeitos:** 20.
**Critério de pronto:** teste que altera a condição do **2º lote** e vê o envelope ser invalidado (hoje não é); recomputação v5/v6 de todo envelope selado byte-idêntica; envelope selado real com PAdES + carimbo verificado manualmente; `paymentCondition ?? paymentConfig` não aparece mais em dois arquivos.
**Coordenação:** P3 e P1 tocam o mesmo modelo; P3 **não** renomeia nada, só adiciona e espelha. Merge de P1 primeiro.

---

### **P4 — Preço por veículo** `[api]` · dep: **P0** · ~4 dias
**Entrega:** `QuoteServiceOverride`; `quote-money.ts` generalizado (2.4) mantendo compatibilidade bit a bit com tabela vazia; `TaskQuote.hasVehiclePricing`; agrupamento de linhas por (descrição, valor) em `nfse-emission.scheduler.ts`; as duas travas de aprovação (desconto não-negativo; teto de 11 linhas / 255 caracteres) com mensagens de recusa; agrupamento "×N" preservado na renderização do PDF.
**Defeitos:** a LACUNA estrutural de 15/09 (lado do modelo).
**Critério de pronto:** com a tabela vazia, `quote-money` devolve **exatamente** os mesmos números para uma amostra de 200 orçamentos reais (teste de regressão numérica); com override, uma fatia de 4 veículos com preços distintos emite nota que fecha no centavo com o boleto; override que aumenta o preço não gera desconto negativo; fatia com variedade demais é recusada com a mensagem certa.
**Não faz:** a tela da grade (é P6).

---

### **P5 — Execução: pedido de compra, entrega congelada, ajustes** `[api]` · dep: **P1** · ~3 dias
**Entrega:** `PurchaseOrder` + backfill 2.2; `QuoteBillingTask.deliveredAt` carimbado na aprovação e usado pelo gerador de vencimentos; `BillingAdjustment` + reescrita de `receivable-task-match.service.ts:1163-1189` e `:1290`; `orderNumbersOfTasks`/`orderNumberLabel` passam a ler `PurchaseOrder`; rota `customer-config-order-number` renomeada para o que ela faz.
**Defeitos:** 14, 15, 26, 28.
**Critério de pronto:** fechar uma O.S. de produção depois da aprovação **não** move nenhum vencimento; um crédito de conciliação de R$ 1.000 continua valendo R$ 1.000 depois de `recalcQuoteTotals`; `Invoice.totalAmount` nunca é reescrito por conciliação.

---

### **P6 — Telas de orçamento por `quoteId`** `[web]` · dep: **P0** (consome P4 quando pronto) · ~6 dias
**Entrega:** todas as rotas de 3.1. Lista por orçamento (`useTaskQuotes`, não `useTasks`) com ordenação/filtro coerentes; detalhe `/financeiro/orcamento/:quoteId` em abas; **a grade veículo × serviço** com adicionar/remover veículo; drawer por veículo; aba Pagadores com `QuoteTerms`; `simultaneousTasks` validado; aerografias na edição (ler, salvar, ou remover o acordeão — não deixar como está); layout por veículo; redirect de `/detalhes/:taskId` → `/orcamento/:quoteId`; cadastro do cliente sai do wizard para um diálogo explícito.
**Defeitos:** 37 a 54 (18 itens).
**Critério de pronto:** o 604 aparece como **uma** linha; existe um caminho de tela que acrescenta um quinto veículo; nenhuma rota de orçamento recebe `taskId` como identidade primária.
**Contrato com a api:** enquanto P4 não estiver pronto, a grade renderiza em modo leitura com o preço uniforme e o botão de override desabilitado com tooltip.

---

### **P7 — Telas de faturamento por `billingId`** `[web]` · dep: **P1, P2** · ~6 dias
**Entrega:** todas as rotas de 3.2. Lista de fatias; `/financeiro/faturamento/:billingId` com os cinco blocos — **incluindo o bloco (1), a grade de veículos cobertos com os campos fiscais editáveis** (série, placa, chassi, pedido, plaqueta, entrega) e congelados a partir de `APPROVED`; tela de ciclo; **o compositor** em `/financeiro/orcamento/:quoteId/faturar`; `/financeiro/faturamento/a-faturar`; aba "Comercial e cobrança" na tarefa; **o redirect de três tentativas** (taskId / invoiceId / boleto); página pública de faturamento separada da de orçamento.
**Defeitos:** 24, 30, 55, 56, 57.
**Critério de pronto:** **o wizard de faturamento deixa de existir**; no 604 há quatro páginas de cobrança; um deep link antigo com `invoiceId` resolve; um com `null` cai na busca; corrigir o chassi dos quatro veículos de uma fatia não exige sair da página.

---

### **P8 — Limpeza** `[api+web]` · dep: **P1** · ~2 dias
**Entrega:** deletar `generateInstallmentsFromCondition`, `EM_NEGOCIACAO_DESC` (substituído por `ServiceOrder.kind`, backfill 2.3 + índice 4.e), `BudgetPdfExportDialog`, o `orderNumber` de `task-quote-prisma.repository.ts:235`; nome do arquivo do recibo de quitação passa a citar o orçamento e a contagem de veículos.
**Defeitos:** 21, 29, 31, 58.

---

### **P9 — Backfill e portões** `[api]` · transversal, acompanha P1–P5 · ~4 dias
**Entrega:** o script de backfill da Fase 2 inteiro, idempotente, transação por orçamento, com os relatórios obrigatórios (divergência de termos, cobertura vazia com fatura viva, cliente divergente entre tarefas, parcela órfã, nota inferida); o portão 2-G automatizado (hash v5/v6 selados e abertos, `Σ InvoiceCoverage`, parcela paga sem fatura, contagem de NfseDocument); o runbook da janela (schedulers parados, checagem Sicredi/Elotech, dump).
**Critério de pronto:** rodar duas vezes seguidas sobre uma cópia de produção produz o mesmo estado; **trava** nos casos ambíguos em vez de escolher; o relatório de cobertura vazia com fatura viva é revisado e assinado pelo dono antes da Fase 3.

---

### Alocação sugerida para quatro implementadores

| onda | A | B | C | D |
|---|---|---|---|---|
| 1 | **P0** (todos revisam) | — | — | — |
| 2 | P1 | P3 | P4 | P6 |
| 3 | P2 | P9 | P5 | P6 (continua) |
| 4 | P7 | P9 (portões) | P8 | P7 (continua) |

---

## 7. O QUE FICA EM ABERTO — decisões do dono

1. **`ExternalOperation` continua existindo?** No modelo novo, uma `QuoteBilling` sem orçamento é exatamente uma venda de balcão, e `ExternalOperation` replica literalmente quatro campos (`generateInvoice`, `generateBankSlip`, `paymentCondition`, `paymentConfig`). Absorvê-la dobra o escopo; deixá-la mantém `Invoice` servindo a dois domínios sem CHECK de exclusividade. **Recomendação:** sobrevive esta rodada, absorvida na seguinte. Deixar implícito é como chegamos aqui.

2. **Duas cobranças vivas do mesmo veículo para o mesmo pagador** — entrada de 50% na assinatura + saldo na entrega, com duas notas; ou um complemento faturado depois. Hoje é impossível (`QuoteBillingTask.@@unique([taskId,customerId])`) e o modelo-alvo mantém a proibição. Se o dono precisar disso, a regra vira "no máximo uma fatia **não-quitada** por (veículo, pagador)" e o índice muda. **Isso é negócio, não engenharia.**

3. **Mover um veículo de lote depois de faturado.** Hoje é recusado (`task-quote.service.ts:1394-1404`). Com reversão por fatia (P2) passa a ser possível **pelo caminho longo**: reverter a fatia A, recompor, refaturar A e B em ciclos novos, com substituição de nota. Deve existir um botão que faça isso em um gesto (com confirmação que lista o que será cancelado na prefeitura), ou o operador faz os três passos à mão? **Recomendação:** os três passos à mão nesta rodada; o gesto único depois que a reversão por fatia estiver rodando em produção.

4. **Quem assina ≠ quem paga.** `QuoteTerms` é chaveada por `customerId` e carrega o `responsibleId` que assina, endurecendo a hipótese de que o signatário é contato do **pagador**. Existe hoje, ou está previsto, contrato em que o contratante assina e um terceiro paga? Se sim, `QuoteTerms` precisa separar `signerCustomerId` de `payerCustomerId` — mudança pequena **agora**, cara depois.

5. **Partir o enum `TaskQuoteStatus`.** Adiada com razão (filtros salvos, app Flutter, funil comercial, changelog em string). Quando? Sugestão: uma release que aceite-e-traduza os valores antigos na entrada, depois o corte. **Precisa de data**, senão os 5 valores "derivados" viram permanentes.

6. **O que o PDF imprime sobre parcelas.** Hoje a cláusula imprime a **data** da 1ª parcela quando ela existe (`quote-text.ts` via `signature-envelope.service.ts:1735-1740`). O modelo-alvo diz que datas são execução. Duas saídas: (a) o PDF passa a imprimir só a **regra** ("3× 30/60/90 a contar da entrega de cada veículo") e as datas ficam no boleto e na nota — mais limpo, mas muda o documento que os clientes conhecem; (b) as datas continuam impressas e continuam materiais — e então reagendar vencimento continua derrubando assinatura. **Recomendação: (a)**, com aprovação do dono, porque é o que libera o refatiamento sem perder assinatura.

7. **Cobertura vazia com fatura viva no acervo.** O relatório de P9 vai listar as fatias em que não se sabe quais veículos uma nota **autorizada** cobriu. Cada linha é uma decisão do dono; a migração trava até que estejam resolvidas. **Rodar esse relatório é a primeira coisa a fazer depois de P0**, para saber o tamanho do problema antes de comprometer o cronograma.

8. **Aerografias na edição de orçamento** (defeito 44): mostrar e salvar, ou remover o acordeão? Hoje aceita digitação e descarta em silêncio, que é a única opção inaceitável.
