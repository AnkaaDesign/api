# 01 — API e domínio: o que a branch do Portal + Implemento mudou (análise de 02/10/2026)

Branch: `origin/feat/portal-do-responsavel` = `origin/claude/truck-implemento-ankaa-abn3xd` (tip `b39f5162`).
Base na `main`: `82c7da57` (24/09). 130 commits, 428 arquivos. A `main` andou 8 commits desde então (§8).

Método: li `docs/implemento/ESTADO.md`, `PLANO.md` §2A, `notas/P13b.md`, `notas/P14.md`,
`docs/PORTAL-DO-RESPONSAVEL.md`, `docs/PORTAL-CONTRATO.md` e conferi no código. O diff do schema e a lista de
rotas foram calculados por script (blocos `model`/`enum` e decorators de controller, base × HEAD), não lidos à mão.
Onde algo vem só do documento e não foi reconferido, está marcado **[doc]**.

---

## 0. A frase que resume tudo

A branch faz **duas coisas que já viraram uma só**:

1. **Portal do Responsável** (20/09): o contato do cliente (vendedor, comprador, marketing… da empresa cliente,
   tabela física `"Representative"`) entra por código e **pede orçamento**, acompanha veículos, aprova o valor,
   assina por sessão e informa o pedido de compra.
2. **Rework Implemento** (23–25/09): `Truck` vira `Implement` (1:1 e obrigatório com a tarefa), a **série** e a
   **arte** vão para o implemento, o implemento ganha **frente** e **porta traseira**, e o orçamento ganha **dois
   eixos** — o **valor** (`Budget.status`) e a **assinatura** (`Budget.signatureStatus`) — com a **cobrança só
   depois de assinado**.

O rework foi construído **em cima** do portal (os dois ponteiros remotos são o mesmo commit). Não há "duas
branches para mergear" na api e no web: há **uma**, e ela precisa receber a `main`.

**Estado real:** a API terminou a Fase B (P06..P14 + P13b, régua 38/38 na nuvem). Web e app **não** foram
migrados para o modelo novo de orçamento/arte (Fase C: P20–P24). Por isso o web da branch já quebra contra a
API da branch — o 400 de `PRE_APPROVED` na lista de orçamentos é o primeiro sintoma, não o único (§6.3).

---

## 1. Modelo de dados: base × HEAD

Diff calculado de `prisma/schema.prisma`:

- **Modelos novos:** `Implement`, `LayoutDecision`, `BudgetValueApproval`, `BudgetOfflineSignature`,
  `BudgetRequest`, `PurchaseOrder`.
- **Enums novos:** `ImplementCategory`, `IMPLEMENT_SPOT`, `RearDoorLeaves`, `LayoutApprovalSource`,
  `BudgetSignatureStatus`, `BudgetValueApprovalSource`.
- **Removidos:** `Truck`, `TruckCategory`, `TRUCK_SPOT`, `BudgetLayoutTask` (o modelo sai do Prisma, mas a tabela
  fica no banco até a M4).

### 1.1 `Implement` (ex-`Truck`) — `schema.prisma:2698`

Rename físico da tabela, com os ids mantidos (migration `20260930120000_truck_vira_implement`).

| Campo | Situação | Significado de negócio |
|---|---|---|
| `taskId @unique` | igual (1:1) | **toda tarefa tem exatamente 1 implemento** (DD1). "No máximo um" vem do `@unique`; "pelo menos um" vem de um `CONSTRAINT TRIGGER` diferido **[doc]** |
| `serialNumber @unique` (+ `serialNumberNormalized`) | **novo aqui** (saiu de `Task`) | o nº de série é do implemento (DD14). `Task.serialNumber` e `Task.serialNumberNormalized` **não existem mais** (M5s `20260930120070`) |
| `plate @unique`, `chassisNumber`, `vinPlateId` (plaqueta = foto) | igual | o veículo físico: placa, chassi e plaqueta continuam aqui |
| `type ImplementType?`, `category ImplementCategory?` | `category` vem do `TruckCategory`, renomeado | o que o baú é (isotérmico, carga seca…) e a categoria do veículo |
| `spot IMPLEMENT_SPOT?` | renomeado | a vaga no pátio. Nasce `null` quando o veículo ainda não chegou (portal) |
| `backSide/leftSide/rightSide/frontSideMeasureId` | **`frontSide` é novo** | 4 faces. A medida **não é mais compartilhada** entre implementos (M2) |
| `rearDoorLeaves RearDoorLeaves?` (`BIPARTITE`/`TRIPARTITE`), `rearDoorBarCount` (2–4), `rearDoorHatchCount` (0–6) | **novo** | a porta traseira (DD4). Bipartida/tripartida é um **preset** das folhas da traseira |
| `layouts Layout[]` | **novo** | **a arte é do implemento** |
| `projectFiles File[]` (`IMPLEMENT_PROJECT_FILES`) | **novo** | o **projeto do implemento** (o projeto do furgão, da Furgões) |

"Veículo físico" e "implemento" continuam **na mesma linha**. O plano chama de *veículo* o caminhão (placa,
chassi, plaqueta) e de *implemento* o baú/carroceria (tipo, categoria, medidas, porta, série, arte, projeto).
Não há tabela separada para o caminhão: o N:1 ("o mesmo caminhão volta") foi adiado. Tudo é endereçado por
`implement.id` para que esse N:1 possa entrar depois sem quebrar nada (PLANO V4).

### 1.2 A arte: `Layout` + `LayoutDecision` — `schema.prisma:109`, `:152`

| Campo de `Layout` | Antes | Agora |
|---|---|---|
| dono | `tasks` (m:n) e `File.quoteLayoutId` | **um dono só**: `implementId` **xor** `airbrushingId` (CHECK `Layout_one_owner_check`) |
| `fileId` | `@unique` | não é mais único: a linha é única por **(dono, arquivo)**, então o mesmo arquivo pode servir N implementos |
| `status` | `@default(APPROVED)` | `@default(DRAFT)`. Enum `LayoutStatus`: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REPROVED`, `SUPERSEDED` |
| versão | — | `version`, `supersedesId @unique` (cadeia de versões), `sentAt`, `decidedAt` |
| quem decidiu | — | `approvalSource` (`PORTAL`, `ON_BEHALF`, `INTERNAL`, `MIGRATED_*`), `decidedByResponsibleId` **xor** `decidedByUserId`, `decisionNote`, `fileSha256` (hash dos bytes no momento da decisão) |
| trilha | — | `LayoutDecision`, append-only: `toStatus`, `source`, autor, `note`, `fileSha256` |

Saíram do Prisma: `Task.layouts`, `Budget.layoutFiles`, `File.quoteLayoutId` e `Task.quoteLayoutCoverage`.

### 1.3 Orçamento: `Budget` + registros — `schema.prisma:1957`, `:2118`, `:2142`

| Elemento | Situação | Significado |
|---|---|---|
| `BudgetStatus` (`:4901`) | `REQUESTED, EXPIRED, PENDING, IN_NEGOTIATION, APPROVED, SIGNED, CANCELLED` | **eixo do valor**. Na base eram 5 valores. Entraram `REQUESTED` e `IN_NEGOTIATION`, e `PRE_APPROVED` **foi criado e apagado** dentro da branch (nunca foi a produção). `SIGNED` fica no enum, mas é **legado e nunca mais escrito** |
| `statusOrder @default(3)` (`:1965`) | era `@default(1)` | ordem: REQUESTED 1 · EXPIRED 2 · PENDING 3 · IN_NEGOTIATION 4 · APPROVED/SIGNED 5 · CANCELLED 6 |
| `queueRank Float?` (`:2003`, índice `[statusOrder, queueRank]`) | coluna **gerada** pelo banco | o desempate da fila: a mais recente primeiro quando a vez é da Ankaa, a mais antiga primeiro em `IN_NEGOTIATION` (quando a vez é do cliente) |
| `signatureStatus BudgetSignatureStatus @default(NOT_ISSUED)` (`:1971`) | **novo** | **eixo da assinatura**: `NOT_ISSUED, AWAITING_CUSTOMER, AWAITING_ANKAA, SIGNED, SIGNED_OFFLINE, REFUSED, EXPIRED, INVALIDATED, WAIVED` |
| `valueApprovals BudgetValueApproval[]` | **novo** | registro do ato "valor aprovado": `source` (`PORTAL`/`ON_BEHALF`/`SIGNATURE`/`LEGACY_APP`/`MIGRATED`), `responsibleId` **xor** `userId`, `note`, `total`, `decidedAt`, `revokedAt`/`revokedReason`. A aprovação vigente é a que tem `revokedAt` nulo. Não guarda hash (DD8) |
| `offlineSignatures BudgetOfflineSignature[]` | **novo** | o ato "Assinado fora do sistema": `fileId` (anexo obrigatório), `note` obrigatória, `signedAt?`, `createdById`, `revokedAt` |
| `request BudgetRequest?` | **novo** | a requisição do portal |
| `layoutFiles` | **removido** | o orçamento **não seleciona mais arte**. A arte do orçamento é derivada: é a arte APROVADA dos implementos (`src/utils/quote-artwork.ts:81` `quoteArtworkOf`) |

`orderNumberRequirement` **não é coluna**: é um predicado (`src/modules/common/signature/order-number-gate.ts:166`).
Ele decide se o signatário tem o papel Compras (`PURCHASING`) e, nesse caso, exige o nº do pedido de cada
veículo; o pedido já existe se houver `Task.customerOrderNumber` não vazio **ou** `Task.purchaseOrderId`.

### 1.4 Requisição do portal: `BudgetRequest` — `schema.prisma:2170`

1:1 com `Budget`. Campos: `requestedByResponsibleId`, `requestedAt`, `briefing` (texto livre), `logoName`,
`preApprovedAt`/`preApprovedByResponsibleId`, `refusedAt`/`refusedByResponsibleId`, `decisionNote`, e o CHECK
`BudgetRequest_decisao_unica`.

⚠️ Os campos ainda se chamam **`preApproved*`**, mas desde o P14 significam "aprovou o valor". Isso é resíduo de
nome (§7, R7). A fonte de verdade da aprovação é `BudgetValueApproval{PORTAL}`; o carimbo na requisição só
continua porque a tela e o changelog o leem (`portal-decision.service.ts:225-239`).

Os arquivos-base da requisição vão para `Task.baseFiles`.

### 1.5 `PurchaseOrder` — `schema.prisma:2217`

`customerId`, `number`, `issuedAt`, `issuedByResponsibleId`, `@@unique([customerId, number])`, e `Task.purchaseOrderId`
(SetNull). `Task.customerOrderNumber` **continua** como coluna legada, com escrita dupla.

### 1.6 Contato do cliente: `Responsible` (tabela `"Representative"`) — `schema.prisma:3819`

- A autenticação por OTP (`ResponsibleAuthChallenge`, `ResponsibleSession`) **já estava na base**. A branch
  acrescenta o `POST /auth/login-method` (`auth.controller.ts:125`): para o e-mail de um funcionário ele responde
  `PASSWORD`, e para um contato responde `CODE`.
- Relações novas: `budgetRequestsOpened`/`PreApprove`/`Refused`, `purchaseOrdersIssued`, `notifications`,
  `valueApprovals`, `layoutDecisions`, `layoutsDecided`.
- `ResponsibleRole` (`:3891`) tem **9 valores** na branch. ⚠️ A `main` acrescentou 3 (`PRODUCTION_PLANNING`, `SHIPPING`,
  `LOGISTICS`, commit `74f5d453`) — ver §8.

### 1.7 `Notification` — `schema.prisma:3121`

Ganha `responsibleId String?` e o CHECK `Notification_exactly_one_recipient` (exatamente um entre `userId` e
`responsibleId`). A migration `20260920120000…` (`:292-296`) apaga antes os avisos sem destinatário nenhum, que
existiam em dado real.

### 1.8 `Billing` — `schema.prisma:2372`

O modelo **não mudou**. O que mudou foi a regra: aprovar a cobrança exige que o orçamento esteja assinado (§2.5).
O faturamento lê `signatureStatus` e aceita o filtro `?signatureStatuses=` (`billing.controller.ts:202,230,302`).
A leitura do orçamento ganha `billable` (`budget-prisma.repository.ts:102`).

### 1.9 `Task` — `schema.prisma:2494`

| Removido | Novo |
|---|---|
| `truck`, `serialNumber`, `serialNumberNormalized`, `layouts`, `quoteLayoutCoverage` | `implement`, `purchaseOrder`/`purchaseOrderId` |

`Task.projectFiles` é **reaproveitado** como o "projeto da tarefa" (o PDF cotado de colagem). O projeto do furgão é
`Implement.projectFiles`. São dois projetos com nomes parecidos e donos diferentes.

---

## 2. Máquinas de estado (conferidas no código)

### 2.1 Orçamento — eixo do VALOR

O código tem **duas tabelas** em `src/modules/production/budget/budget-transitions.ts`, e as duas saem no contrato
`contracts/enums.json → orcamento.transicoesManuais / transicoesDoSistema`.

```
MANUAIS (BUDGET_MANUAL_TRANSITIONS, :32)            SISTEMA (BUDGET_SYSTEM_TRANSITIONS, :55)
REQUESTED      → IN_NEGOTIATION, PENDING,           REQUESTED      → CANCELLED
                 APPROVED, CANCELLED                PENDING        → EXPIRED, APPROVED, CANCELLED
PENDING        → IN_NEGOTIATION, APPROVED, CANCELLED IN_NEGOTIATION → APPROVED (portal), PENDING (recusa), CANCELLED
IN_NEGOTIATION → PENDING, APPROVED, CANCELLED       APPROVED       → PENDING (auto-revert do valor), CANCELLED
APPROVED       → PENDING, CANCELLED                 EXPIRED        → CANCELLED
EXPIRED        → PENDING, IN_NEGOTIATION, CANCELLED SIGNED         → CANCELLED
SIGNED         → APPROVED, PENDING, CANCELLED       CANCELLED      → REQUESTED, PENDING, IN_NEGOTIATION, EXPIRED
CANCELLED      → (nada)                                              (reativação pela O.S., sem ressuscitar APPROVED)
```

Quem dispara cada ato (`budget.service.ts`):

| Ato | Rota | Serviço | Papel | Guarda e efeito |
|---|---|---|---|---|
| Nascer | `POST /budgets` (interno) ou `POST /cliente/me/orcamentos` | `create` / `portal-request.service.ts:326-346` | ADMIN, COMMERCIAL / capacidade `REQUEST_BUDGET` | o servidor decide o status de nascimento (D-34): pelo portal nasce `REQUESTED` com `statusOrder` 1, total 0 e **sem `BudgetItem`** |
| "Enviar para aprovação do cliente" | `PUT /budgets/:id/send-to-customer` (`controller:240`) | `sendToCustomer` (`service:3050`) | ADMIN, COMMERCIAL | exige ≥1 `BudgetItem` com `amount > 0`. Vai a `IN_NEGOTIATION` e dispara `budget.portal_values_visible` ao contato |
| "Retirar do cliente" | `PUT …/withdraw-from-customer` (`:252`) | `withdrawFromCustomer` (`:3063`) | ADMIN, COMMERCIAL | `IN_NEGOTIATION → PENDING` |
| "Aprovar valor em nome do cliente" | `PUT …/value-approval {note}` (`:269`) | `approveValue` (`:2822`) | ADMIN, COMMERCIAL | nota obrigatória. Grava `BudgetValueApproval{ON_BEHALF}` |
| "Reprovar valor" | `DELETE …/value-approval {reason}` (`:289`) | `revokeValueApproval` (`:3088`) | ADMIN, COMMERCIAL | `APPROVED → PENDING` e revoga a aprovação |
| Mudança genérica | `PUT /budgets/:id/status` (`:188`) | `updateStatus` (`:2775`) | ADMIN, FINANCIAL, COMMERCIAL **na porta**; `validateQuoteStatusChangeRole` barra FINANCIAL ao aprovar (X7) | **delega aos atos**: APPROVED vira `approveValue(ON_BEHALF)`, IN_NEGOTIATION vira `sendToCustomer`, APPROVED→PENDING vira `revokeValueApproval`, IN_NEGOTIATION→PENDING vira `withdraw`; o resto vai para `moveStatus` |
| App antigo | `PUT …/budget-approve` (`:345`) | `budgetApprove` (`:4078`) | ADMIN, COMMERCIAL | sem nota → `LEGACY_APP`; com nota → `ON_BEHALF` |
| Aprovar valor pelo portal | `PUT /cliente/me/orcamentos/:id/aprovar-valor` | `portal-decision.service.ts:78` → `applyPortalDecision` (`budget.service:3123`) | capacidade `APPROVE_VALUE` | só de `IN_NEGOTIATION`. Grava `BudgetValueApproval{PORTAL}` com o contato como ator. O comercial recebe a lista do que ainda falta para emitir (`:165-174`) |
| Recusar pelo portal | `PUT …/recusar {motivo}` | `:83` | `APPROVE_VALUE` | `IN_NEGOTIATION → PENDING` e avisa `budget.portal_refused` |
| Auto-revert | — (sistema) | `hasValueAffectingChange` | — | `APPROVED → PENDING` quando o valor muda **e** o chamador não fixou o status (DD8, como hoje) |

A gravação genérica `PUT /budgets/:id` **não chega mais a `APPROVED`**: responde 400 "aprovar o valor é um ato com
nota". Continua possível fixar o `APPROVED` que já existe [doc P14 §Resultado].

### 2.2 Orçamento — eixo da ASSINATURA

Escritor único: `SignatureEnvelopeService.writeSignatureAxis` (`signature-envelope.service.ts:915`), chamado
**dentro da transação do envelope** (`:966, :1552, :4461, :6393, :6935, :7407, :7727`) e pela varredura de
vencimento (`signature-expiry.scheduler.ts:102`).

```
NOT_ISSUED ─emissão [assertEmissionReady]→ AWAITING_CUSTOMER ─grupo 0 completo→ AWAITING_ANKAA ─contra-assinatura→ SIGNED
     ▲                                       │recusa→REFUSED   │prazo→EXPIRED              │valor/elenco/validade mudou→INVALIDATED
     └──reemitir (de NOT_ISSUED/REFUSED/EXPIRED/INVALIDATED/WAIVED, o mesmo portão)────────┘
NOT_ISSUED/REFUSED/EXPIRED/INVALIDATED ─"Assinado fora do sistema" (nota+anexo, E1∧E3)→ SIGNED_OFFLINE
SIGNED_OFFLINE ─o orçamento sai de APPROVED→ INVALIDATED (o registro é fechado)
WAIVED: só a migração escreve (aprovados sem coleta nenhuma; 504 em produção em 23/09)
cancelar o envelope → NOT_ISSUED
```

A emissão **não** escreve `Budget.status` (X1). Uma coleta **legada**, emitida sobre `PENDING` antes da release,
ao concluir aprova o valor com `BudgetValueApproval{SIGNATURE}` (`onSignatureCompleted`, `budget.service.ts:4095`).

### 2.3 Portão de emissão — `src/utils/emission-gate.ts`

Os códigos estão em `:28-44`. A função `assertEmissionReady` é chamada em **três lugares**: no preflight
(`signature-envelope.service.ts:652`, que devolve `gates` estruturado ao lado de `blockers: string[]`), no
`createEnvelope` (`:1115`) e dentro da transação (`:1487`).

| Código | Regra (no código) |
|---|---|
| `VALUE_NOT_APPROVED` (E1) | `status = APPROVED` e uma aprovação vigente |
| `ARTWORK_PENDING` (E2) | toda tarefa não cancelada tem um implemento com `Layout` `APPROVED` (`:161-178`). **Não existe dispensa** (DD9) |
| `ENVELOPE_LIVE` (E3) | não há envelope `RUNNING`/`COMPLETED` (`:196`) |
| `TWO_PAYERS` (E4) | um pagador só |
| `VALIDITY_EXPIRED` (E5) | `expiresAt > agora` (`:230`) |
| `RESPONSIBLES` (E6) | ao menos uma tarefa com contato (`:241`) |
| E7 (recortes) | continua dentro do `createEnvelope` e **não** aparece em `gates` |

`GET /budgets/:id` devolve `emission` e `valueApproval` (`budget.service.ts:274-275`). O web precisa disso para o
checklist "Para emitir falta…".

### 2.4 Arte do implemento — `implement-layout.service.ts`

```
DRAFT ─send (EDIT)→ PENDING_APPROVAL ─aprovar (portal APPROVE_ARTWORK | on-behalf COMMERCIAL/ADMIN com nota)→ APPROVED
  │                      └─reprovar (portal com motivo ≥3 | interno com nota)→ REPROVED
  ├─approve-on-behalf / reprove (DECIDE) direto do DRAFT (:369, :383)
  └─DELETE só em DRAFT (:240)
qualquer não-SUPERSEDED ─new-version (1 imagem)→ nova linha DRAFT (supersedesId); quando a nova é aprovada, a anterior vira SUPERSEDED
```

Papéis (`implement.controller.ts:94-112`):

- **editar e enviar:** DESIGNER, COMMERCIAL, ADMIN;
- **decidir:** COMMERCIAL, ADMIN;
- **ler:** os papéis do implemento mais o DESIGNER. Fora de COMMERCIAL, DESIGNER, LOGISTIC, PRODUCTION_MANAGER e
  ADMIN, só aparece a arte APROVADA.

`REPROVED` **não volta** a `PENDING_APPROVAL`: `send` só aceita `DRAFT` (`:313-320`). O caminho depois de uma
reprovação é `new-version`. Uma corrida entre duas decisões dá 409 (o `updateMany … where status` do G17).

Efeitos de aprovar [doc ESTADO §3 P12.2]:
- a O.S. "Aprovar com o Cliente" e as O.S. de ARTE em `WAITING_APPROVE` vão a `COMPLETED`;
- a tarefa é liberada se a arte era a última peça;
- `onQuoteContentChanged` roda;
- se o valor já estava aprovado, `task_quote.ready_for_signature` dispara.

Aprovar uma versão nova sobre um contrato `COMPLETED` **não** derruba o contrato: grava a deriva "Arte alterada
depois da assinatura" (D-31).

### 2.5 Tarefa — o portão da produção (`src/utils/artwork-gate.ts`)

`artworkGateOf` (`:39`) devolve `OK`, `PENDING` ou `NOT_APPLICABLE`.

"Trabalho novo" é a tarefa cuja primeira O.S. de ARTE (ou a própria tarefa) nasceu **depois** do `finished_at` da
migration `…_arte_do_implemento_e_projeto_da_tarefa` **neste banco** (`:58-75`). `ARTWORK_GATE_SINCE` sobrepõe esse
corte.

- **Liberação automática** (O.S. de arte concluída → `WAITING_PRODUCTION`): só acontece com arte aprovada.
- **Liberação manual**, que inclui o `/start`, o lote e o desfazer do histórico: responde 400 quando o status
  **entra** em produção e o portão está `PENDING` (`entersProduction`, `:116`; DD10).
- `TaskStatus` **não** ganhou valor novo.

⚠️ **Consequência local:** no clone `ankaa_implemento` que eu montei hoje, a M3 foi aplicada em **02/10 ~07:26**.
Toda tarefa criada daqui em diante é "trabalho novo" e trava sem arte aprovada. As tarefas anteriores ficam livres.

### 2.6 Faturamento

`internalApprove` (`budget.service.ts:4211`; o portão está em `:4355-4356`) exige `status = APPROVED` **e**
`isBillableSignatureStatus` (`src/utils/budget-signature.ts:20-36`: `SIGNED`, `SIGNED_OFFLINE` ou `WAIVED`). Sem
isso, responde 400 com a frase "A cobrança só pode ser aprovada depois da assinatura do orçamento".

O `Billing` **nasce junto com o orçamento**, como plano. Na requisição do portal ele vem de
`reconcileQuoteCustomerConfigs → ensureBillingForCoverage` (`portal-request.service.ts:388-405`). Liquidar e
reverter não passam pelo portão. A regra de Atenção `budget.ready-to-emit` está em `attention.service.ts:589`
(o gêmeo do web, P22, ainda não existe).

---

## 3. O fluxo ponta a ponta do portal

| # | Passo | Endpoint | Serviço | Aviso | Quem pode |
|---|---|---|---|---|---|
| 1 | Login | `POST /auth/login-method` → `/cliente/auth/codigo` → `/cliente/auth/entrar` | OTP | código por e-mail ou WhatsApp | qualquer contato ativo |
| 2 | **Pedir orçamento** | `POST /cliente/me/orcamentos` (multipart: **uma** parte `payload` com o JSON e N partes `baseFiles`, máx. 30) | `portal-request.service.ts` | `budget.portal_requested` ao comercial (`:478-485`) | `REQUEST_BUDGET` (COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR, MARKETING) |
| 2a | — efeitos: | | 1 `Budget{REQUESTED}` sem itens; **1 `Task` por veículo** em `PREPARATION`, cada uma com o requisitante ligado como contato (escopo c) e um `implement.create` com série (texto), placa, chassi, tipo, categoria e porta (`:882-920`); medidas em **cm na borda, metros no banco**; 1 `BudgetPayer` + `Billing`; `BudgetRequest{briefing, logoName}`; tinta existente ou nova (`POST /cliente/me/tintas`); cliente novo pelo combobox, com CNPJ **ou** CPF obrigatório | | |
| 3 | Comercial precifica | `PUT /budgets/:id` (itens) | `BudgetService.update` | — | ADMIN, COMMERCIAL |
| 4 | Enviar ao cliente | `PUT /budgets/:id/send-to-customer` | `sendToCustomer` | `budget.portal_values_visible` ao contato, por **e-mail**: o WhatsApp é pulado enquanto `PORTAL_NOTICE_WHATSAPP_TEMPLATE` estiver vazio (`responsible-notice-templates.ts:39-54`) | ADMIN, COMMERCIAL |
| 5 | Cliente aprova ou recusa o valor | `PUT /cliente/me/orcamentos/:id/aprovar-valor` ou `…/recusar {motivo}` | `portal-decision.service.ts` | `budget.portal_pre_approved` (nome legado) ou `portal_refused`, ao comercial | `APPROVE_VALUE` (COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR) |
| 5' | …ou a Ankaa aprova em nome dele | `PUT /budgets/:id/value-approval {note}` | `approveValue` | `task_quote.value_approved` | ADMIN, COMMERCIAL |
| 6 | Designer sobe a arte | `POST /implements/:id/layouts` (multipart) ou `POST /implements/layouts/bulk {implementIds, fileId}` | `ImplementLayoutService.upload/bulk` | — | DESIGNER, COMMERCIAL, ADMIN |
| 7 | Envia a arte ao cliente | `POST /implements/:id/layouts/:layoutId/send` | `send` | `layout.portal_pending_approval` aos contatos com `APPROVE_ARTWORK` no escopo comercial, mais lembrete diário depois de 24 h | EDIT |
| 8 | Cliente aprova ou reprova a arte | `PUT /cliente/me/veiculos/:taskId/artes/:layoutId/aprovar`, `…/reprovar {motivo}` ou o lote `PUT /cliente/me/artes/aprovar {layoutIds[]}`, que é **atômico** | `PortalArtworkService` → `approveFromPortal` / `approveManyFromPortal` | `artwork.approved`; `task_quote.ready_for_signature` se o valor já estava aprovado | `APPROVE_ARTWORK` (não PURCHASING; o pagador Furgões pode) |
| 8' | …ou a Ankaa aprova em nome dele | `POST /implements/:id/layouts/:layoutId/approve-on-behalf {note}` | `approveOnBehalf` | idem | COMMERCIAL, ADMIN |
| 9 | Emitir para assinatura | preflight → `createEnvelope` (rotas de assinatura que já existiam) | `assertEmissionReady` E1–E6 + E7 | convites (`orcamento_para_assinar`…) | ADMIN, COMMERCIAL |
| 10 | Assinar | pela página pública OTP **ou** pelo portal `POST /cliente/me/assinaturas/:signerId/assinar {orderNumbers[]}` | `portal-signature.controller.ts:123` | `task_quote.signed` e contra-assinatura | o signatário; quem tem Compras precisa informar o nº do pedido (DD12) |
| 10' | …ou "Assinado fora do sistema" | `POST /budgets/:id/offline-signature` (multipart `offlineSignatureFile`, `note`, `signedAt?`) | `registerOfflineSignature` (`:2896`) | `task_quote.signed` | ADMIN, COMMERCIAL |
| 11 | Cobrança | `PUT /billings/:id/approve` → `internalApprove` | portão DD7 | ⚠️ aprovar no ambiente local **emite NFS-e e boleto de verdade** | ADMIN, FINANCIAL |
| 12 | Produção | liberação automática quando a O.S. de arte conclui, ou manual | portão da arte (§2.5) | `task.status.changed` | — |

O passo 8 pode vir **antes** do passo 5: o valor e a arte são independentes. A emissão só sai quando os dois estão
aprovados. O "pronto para emitir" dispara pelos dois lados, mas a emissão **não é automática** (PLANO §2A.7).

**Escopo do portal** (`portal-scope.service.ts`):
- **leitura:** (a) minha empresa paga, ∨ (b) minha empresa é dona do veículo, ∨ (c) eu sou contato do veículo;
- **escrita comercial**, que cobre identificação, arte e pedido: só (a) ∨ (b). Fora do escopo responde **404**,
  nunca 403.
- O recorte de **colunas** vem de `sectionsForRoles` (`quote-sections.ts:188`), a mesma régua que recorta o PDF
  da assinatura.

---

## 4. Catálogo de rotas (base × HEAD, extraído dos decorators)

### 4.1 Novas — interno (web e app precisam consumir)

| Método | Rota | Arquivo:linha |
|---|---|---|
| PUT | `/budgets/:id/send-to-customer` | `budget.controller.ts:240` |
| PUT | `/budgets/:id/withdraw-from-customer` | `:252` |
| PUT / DELETE | `/budgets/:id/value-approval` (`{note}` / `{reason}`) | `:269` / `:289` |
| POST | `/budgets/:id/offline-signature` (multipart) | `:309` |
| GET / PUT | `/implements`, `/implements/:id` | `implement.controller.ts:171,282,300` |
| PUT | `/implements/:id/project-files` (multipart) | `:317` |
| GET / POST | `/implements/:id/layouts` | `:343,354` |
| POST | `/implements/:id/layouts/:layoutId/{send,approve-on-behalf,reprove,new-version}` | `:369,384,401,418` |
| DELETE | `/implements/:id/layouts/:layoutId` | `:435` |
| POST | `/implements/layouts/bulk` | `:157` |
| * | `/implements/{batch-update-spots,garages-availability,lane-availability/:garageId,request-movement,sector-garage-mapping}` | ex-`/trucks/*` |
| * | `/implement-measure/implement/:implementId[/:side|/batch]`, `/implement-measure/:id/assign-to-implement` | ex-`…/truck/*` |
| GET / POST | `/purchase-orders`, `/purchase-orders/customer/:customerId` | `purchase-order.controller.ts:60-131` (⚠️ dois `@Post` na mesma rota, `:70` e `:131`: conferir qual vence) |
| POST | `/auth/login-method` | `auth.controller.ts:125` |

**Alterada no comportamento** (rota igual): `PUT /budgets/:id/status` delega aos atos;
`PUT /budgets/:id/budget-approve` é LEGACY_APP; `GET /budgets/:id` traz `emission`, `valueApproval` e `billable`;
`GET /billings` aceita `signatureStatuses`; o preflight devolve `gates`.

### 4.2 Removidas (o cliente velho leva 400 ou 404)

- `/trucks/*` inteiro;
- `/implement-measure/truck/*`;
- `GET /tasks/:id/layouts/diagnostic`, `POST /tasks/:id/upload/layouts`, `POST /tasks/bulk/arts`,
  `POST /tasks/bulk/upload-files`;
- `POST /budgets/:id/sync-em-negociacao`;
- **chaves recusadas** (400 pelo zod estrito ou pelo G1): os campos multipart `layouts`/`quoteLayoutFile`;
  `layoutIds`/`layoutStatuses`/`newLayoutStatuses`/`removeLayoutIds`; `serialNumber` no topo da tarefa;
  `include.layouts` da Task; `include.layoutFiles` do Budget; `where.layouts`; o filtro `hasLayouts` (agora é
  `hasArt`); `PRE_APPROVED` em qualquer filtro de status.

### 4.3 Portal (`/cliente/me/*`, todas novas)

`resumo`, `orcamentos` (GET lista, GET :id, POST requisição), `orcamentos/:id/aprovar-valor|recusar`,
`veiculos` (GET lista e :taskId), `veiculos/:taskId/identificacao` (PATCH multipart), `veiculos/:taskId/projeto`,
`artes` (GET), `veiculos/:taskId/artes/:layoutId/aprovar|reprovar`, `artes/aprovar` (lote),
`assinaturas` (GET; POST `:signerId/assinar|recusar`; GET `:signerId/documento.pdf`), `cobrancas`, `clientes`,
`tintas` (GET/POST), `tipos-de-tinta`. A tabela completa está em `docs/PORTAL-CONTRATO.md` §4.

### 4.4 O contrato gerado

`scripts/export-contracts.ts` (`npm run contracts:export`) grava `contracts/{enums,labels,file-contexts}.json`
com as seções `enums`, `orcamento{status,transicoesManuais,transicoesDoSistema,ordem}`, `faces`, `notificacoes`,
`multipart` e `fileContexts`.

As formas de consulta aceitas ficam em `contracts/queries/{web,web.seed,flutter.seed,ankaa-aero,negativas}.json`
(G1/G4).

O `--irmaos` copia para `WEB_COPY_DIR = ../web/src/generated/contracts` e
`APP_COPY_FILE = ../mobile-flutter/lib/generated/contracts/labels.dart` (`:66-75`).

⚠️ **Neste Mac os dois caminhos estão errados:**
- rodado de `api-wt-implemento`, o `../web` é o **checkout da `main`**, não o worktree da branch;
- o app se chama `mobile_migration`, não `mobile-flutter`.

Use `--out ../web-wt-implemento/src/generated/contracts` e
`--dart ../mobile_migration/lib/generated/contracts/labels.dart` explicitamente (§7, R10).

---

## 5. As decisões em linguagem de negócio

| Decisão | O que significa na tela e no dado |
|---|---|
| **DD1** | Toda tarefa tem um implemento, e a série é do implemento. Não existe mais tarefa "sem veículo"; as 1.676 tarefas antigas sem `Truck` ganharam um implemento vazio na migração |
| **DD2 / Modelo C** | "Aprovado" passa a significar **valor aprovado**. A assinatura vira um selo à parte ("Assinatura: Aguardando / Assinada / Fora do sistema…"). Para emitir, o valor **e** a arte de todo veículo têm de estar aprovados |
| **DD3 / DD9 / DD10** | Sem arte aprovada, o trabalho novo não entra em produção, nem pelo botão manual. **Não existe** "dispensar arte". Quem precisa liberar sem o cliente aprova "em nome do cliente", com nota |
| **DD4** | Porta traseira: bipartida/tripartida, 2 a 4 varões, 0 a 6 portinholas |
| **DD5** | Quem aprova arte no cliente: marketing, comercial, vendedor, representante, coordenador. Compras **não**. A Furgões pagadora pode. Aprovar em nome do cliente exige nota |
| **DD6** | api e web nesta branch; o app em `feat/implemento` |
| **DD7** | **A cobrança só é aprovada depois de assinado.** O financeiro vê o selo da assinatura e o botão "Aprovar cobrança" fica bloqueado. Os 504 aprovados antigos sem coleta migraram como "Dispensada (legado)" e continuam faturáveis |
| **DD8** | Editar o valor depois de aprovado funciona **como hoje**: sem fixar o status, o orçamento volta a Pendente e a coleta cai; com o status fixado no assistente, continua Aprovado |
| **DD11** | Existe o botão "Assinado fora do sistema" (nota + anexo obrigatórios). Ele libera a cobrança como "assinada", mas aparece **diferente** na tela e na trilha |
| **DD12** | Quem tem o papel Compras, mesmo acumulando outros papéis, só assina informando o nº do pedido de cada veículo, nas duas cerimônias |
| **DD13** | Migração **completa e de uma vez**: nenhum nome velho (`truck`) aceito. API, web, app e AnkaaAero sobem **juntos**. O app desatualizado deveria levar 426 — **ainda não implementado** (P31) |
| **DD14** | A série sai de vez da tarefa (coluna, espelho e índice) |
| **D-34** | O status de nascimento é decidido pelo servidor, não pela tela |
| **D-35** | "Pré-aprovar" virou "aprovar o valor" (rota `aprovar-valor`, capacidade `APPROVE_VALUE`) |
| **D-36** | O app antigo, que aprova sem nota, grava `LEGACY_APP` com uma nota automática |
| **D-31** | Arte nova sobre contrato já assinado não derruba o contrato; vira deriva registrada |
| **M0..M5s / R-B** | M0 estados da arte · M1/M1s Truck→Implement e série · Mnom nomenclatura · M2 frente e porta · M3 a arte vai para o implemento · M3o-a eixo da assinatura · M3o-b remove `PRE_APPROVED` · M5s série só no implemento. R-B é a release da API; o plano agora é release única com web, app e AnkaaAero |

---

## 6. Feito × pendente × defeitos conhecidos

### 6.1 Feito na API (conferido)

Rename e nomenclatura · série no implemento · frente e porta · projeto do implemento · arte do implemento com
máquina, portal e lote atômico · portão da produção · Modelo C com os dois eixos · portão de emissão ·
DD7/DD11/DD12 · `PRE_APPROVED` removido do enum · portal de leitura, escrita, arte e assinatura · contrato gerado.

### 6.2 Pendente

- **Revisão da Fase B** (duas lentes sobre P06..P14).
- **Rodar localmente a régua com dado real** (G11 com os 19 envelopes reais e o ensaio da R-B no
  `ankaa_implemento_base`): na nuvem ela passou com o banco vazio.
- **Fase C:**
  - **P20** — base do web: tipos, `PanelSide` com a frente;
  - **P21** — produção: coluna ARTES, exportação, filtro de 3 estados do painel;
  - **P22** — orçamento e faturamento: botões dos atos de valor, checklist de emissão, "Assinado fora do sistema",
    selo no faturamento, gêmeo do `ready-to-emit`;
  - **P23** — portal web: `orderNumber`, `emission`, artes, `APPROVE_ARTWORK`;
  - **P24** — app e AnkaaAero;
  - **P26** — e2e.
- **P30** — re-carimbar as migrations depois da última da `main`, ensaio em produção, deploy.
- **P31** — o 426 de versão mínima: confirmei que **não existe** nenhum 426 ou versão mínima em `src/`.
- **M4** — dropar `BudgetLayoutTask` e `File.quoteLayoutId` do banco.

### 6.3 Quebra conhecida nos clientes da branch (a API já recusa)

- **Web:**
  - `PRE_APPROVED` em `enums.ts`, `sortOrders.ts`, `budget-table-columns.tsx:492`, `quote-permissions.ts`,
    `schemas/budget.ts`, `budget-state-actions.tsx` e no portal (`waiting-on.ts`, `pre-aprovacao-actions.tsx`).
    Por causa disso a **lista de orçamentos dá 400 hoje**.
  - upload de arte nos formulários de tarefa;
  - `set-quote-layout-modal`;
  - a arte no orçamento e no detalhe do faturamento;
  - os includes `layouts`/`layoutFiles`;
  - o contexto `tasksLayouts`;
  - `where.layouts` no painel.
- **App:** `layout_attach_sheet`, `task_form_fields`, `task_row_actions`, `budget_form_screen`.
- **AnkaaAero:** o include `layouts`.

### 6.4 Defeitos e achados

1. `PUT /budgets/:id/status {CANCELLED}` responde "cancelado com sucesso" e **não cancela** quando ainda há veículo
   ativo (`cancelForTaskCancellation` sai em silêncio, `budget.service.ts:5551`). Vem de antes do rework e segue
   aberto **[doc]**.
2. A decisão do portal **não é atômica**: `stampDecision` grava em `BudgetRequest` **antes** de
   `applyPortalDecision` e, se o movimento falha, tenta desfazer com `restoreDecision`. Se o desfazer também
   falhar, o carimbo fica errado (`portal-decision.service.ts:117-131`). Recomendo pôr os dois na mesma transação.
3. Nomes residuais do modelo antigo:
   - chave de notificação `budget.portal_pre_approved` (`portal-notification.service.ts:41`);
   - colunas `BudgetRequest.preApproved*`;
   - método `preAprovar` no controller (`portal-decision.controller.ts:77`).
   O dado diz "valor aprovado" e o nome diz "pré-aprovado".
4. O `--irmaos` do contrato escreve no checkout errado neste Mac (§4.4).
5. Duas telas do web já dão 500 em produção, fora do rework: `GET /users/:id` com `include.tasks`, e o item com
   `where.measures.some.AND[].type` **[doc]**.
6. `paint.service.ts` faz `LEFT JOIN "Truck"` em SQL cru dentro de `catch`: depois do rename, volta vazio sem erro
   **[doc, armadilha §6]**. Conferir se foi corrigido.
7. Em `purchase-order.controller.ts` há dois `@Post` sem sufixo de rota (`:70` e `:131`), provavelmente em
   controllers distintos no mesmo arquivo. Conferir se não há sombra de rota.

---

## 7. Riscos de desenho e recomendações

| # | Risco | Recomendação |
|---|---|---|
| R1 | **Duas portas para aprovar o valor** (`PUT /:id/status APPROVED` e `PUT /:id/value-approval`), mais o `budget-approve` legado. Hoje as três convergem em `approveValue`. A dívida é de UI: cada tela escolhe uma porta | Web e app usam **só os atos** (`send-to-customer`, `value-approval`, `withdraw`). `PUT /:id/status` fica para CANCELLED/EXPIRED. `budget-approve` morre com o 426 |
| R2 | **Três "aprovados" diferentes na tela**: valor (`status`), assinatura (`signatureStatus`), cobrança (`Billing.status`), e a arte por veículo como quarto eixo | No detalhe do orçamento, **quatro trilhas visíveis lado a lado** (Valor · Arte por veículo · Assinatura · Cobrança), cada uma com rótulo e próxima ação. O portal já faz isso com `artwork{total,approved,…}` e `emission.missing` |
| R3 | O portão da produção depende do **momento em que a M3 foi aplicada em cada banco**. Clone local, produção e e2e terão cortes diferentes | Em produção, fixar `ARTWORK_GATE_SINCE` explicitamente no deploy, para não depender do relógio da migration |
| R4 | `REPROVED` não pode ser reenviada, só substituída por uma versão nova. A tela precisa deixar isso explícito ("Enviar nova versão") | — |
| R5 | **E7 fora de `gates`**: o checklist estruturado não mostra o problema de recorte, que só aparece como erro do `createEnvelope` | Incluir E7 em `emissionGatesOf` |
| R6 | **Validade duplicada**: o E5 compara `expiresAt <= now` direto, e a `main` criou `src/utils/budget-validity.ts` (fim do dia em São Paulo). Depois do merge, conviverão duas regras de validade | No merge, o E5 deve usar a regra da `main` |
| R7 | Os nomes `preApproved*` mentem sobre o dado | Renomear antes do primeiro deploy (custo zero de dado: nunca foi a produção) |
| R8 | **A release precisa ser única e sincronizada** (DD13): API sem `/trucks`, sem série na tarefa e sem `PRE_APPROVED`, com o app 1.4.x instalado no chão de fábrica | O 426 (P31) e o AnkaaAero novo instalado por cabo **antes** do deploy são pré-condição. Sem eles, o app quebra em silêncio |
| R9 | A decisão do portal não é atômica (§6.4-2) | Uma transação |
| R10 | Os caminhos irmãos do contrato estão errados neste Mac | Passar `--out`/`--dart` explícitos ou ajustar `WEB_COPY_DIR`/`APP_COPY_FILE` por variável de ambiente |
| R11 | `ROLE_CAPABILITIES: Record<RESPONSIBLE_ROLE, …>` é **total** sobre 9 papéis (`portal-capabilities.ts:159`), e a `main` acrescenta 3 papéis | No merge, o `tsc` acusa (bom). É preciso decidir as capacidades de PCP, Expedição e Logística no portal. Recomendo `TRACK` (e `WRITE_VEHICLE_IDENTITY` para Expedição/Logística?) — **decisão do dono**. As seções de assinatura deles nascem vazias, como as do gestor de frota |
| R12 | Na requisição, o veículo nasce com `spot: null` e a tarefa em `PREPARATION`, sem O.S. comercial. A Ankaa precisa ver "Requisições" como fila própria (`statusOrder` 1 garante o topo) | — |
| R13 | O e-mail é o único canal ao contato enquanto não existir template da Meta para `portal_values_visible` | Submeter o template UTILITY |

---

## 8. A `main` desde a base (8 commits na api) — o que conflita

`git merge-tree` (branch × `origin/main`) dá **5 conflitos de conteúdo**:

- `scripts/verify-order-number-gate.ts`
- `src/modules/common/pipes/zod-validation.pipe.ts`
- `src/modules/common/signature/order-number-gate.ts`
- `src/modules/common/signature/services/signature-envelope.service.ts`
- `src/modules/production/budget/budget.service.ts`

Os commits da `main` que pesam:

- **`b1716269`** (assinatura de Compras: **um pedido para o orçamento**, com herança `inheritedOrderNumber`;
  `coerceFormData: false` para o nº do pedido não virar número). Colide **frontalmente** com a DD12
  (`orderNumberRequirement`, `orderNumbers[]` por veículo).
  - A `main` diz: "o cliente emite **um** pedido para o lote; os veículos sem número herdam".
  - A branch diz: "um número por veículo".
  - **O merge precisa juntar as duas regras**: o predicado da branch (quem tem Compras, número ∨ `purchaseOrderId`)
    com a herança e o valor único da `main`. A leitura `orderNumber{required,…}` do portal tem de expor
    `inherited`.
- **`44836515`** (validade como regra própria: `budget-validity.ts`, prorrogação, fusão) — conflita no
  `budget.service.ts` e pede o ajuste do E5 (R6).
- **`74f5d453`** (papéis PCP, Expedição e Logística; recria o enum `RepresentativeRole`) — merge automático no
  schema, mas o `Record` total do portal quebra a compilação (R11). A migration da `main` (28/09) vai ser aplicada
  **depois** das `20260930*` num banco que já tem a branch; o Prisma aplica fora de ordem, mas é preciso conferir a
  recriação do tipo contra as colunas novas que usam `ResponsibleRole`.
- `2f711c23` (lembrete v2 da assinatura no WhatsApp), `c104e5eb` (bonificação) e os build-info: sem relação com o
  domínio.
