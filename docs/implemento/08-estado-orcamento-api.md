# 08 — Máquina de estados do orçamento, emissão de assinaturas e a arte na assinatura (API)

Data: 23/09/2026. Recorte: **DD2** (aprovação do VALOR antes da emissão; emissão exige valor aprovado **e** arte aprovada; assinatura continua existindo e leva a arte do implemento). Complementa o `PLANO.md` (v1) e **substitui** a D-14 dele (que tirava a arte da assinatura) e as partes de M3 passo 4/5 que tocam a arte de orçamentos com assinatura.

Somente leitura: nenhum arquivo de código foi alterado, nenhuma escrita no banco. API em `feat/portal-do-responsavel` HEAD `ad3c65d4`; web em `feat/portal-do-responsavel`; app `mobile-flutter` em `main`.

**Convenções.** **FATO** = li no código ou no banco (cito `arquivo:linha`, caminhos da API relativos a `api/`). **INF** = inferência. **[DONO]** = decisão do dono. Números "no clone" vêm do banco local; ⚠️ **os envelopes de assinatura do clone são quase todos de bateria e2e/seed** (criados em 26/07, 14/09, 20–21/09; um mesmo `File` aparece congelado em 14 envelopes), então as contagens de assinatura **têm de ser refeitas em produção** com o SQL do §2.13.

---

## 0. Resumo

1. **O DD2 já está 80% no enum.** `PRE_APPROVED` significa hoje, literalmente, "o vendedor do cliente aprovou; espera a Ankaa lançar as assinaturas" (`prisma/schema.prisma:4674-4676`). É a "aprovação do VALOR" do dono. `PENDING` já é o estado "ao emitir" ("Aguardando Assinatura", escrito pela própria emissão, `signature-envelope.service.ts:1508-1570`). `SIGNED` é "cliente assinou, falta a Ankaa", e `APPROVED` é o fim.
2. **O que falta não é estado, é portão e disciplina.** Hoje a emissão **não olha o status** do orçamento: emite de qualquer estado e força `PENDING` a partir de qualquer um, menos `CANCELLED`, inclusive de `APPROVED` com cobrança já faturada (`signature-envelope.service.ts:1533-1545`). O único portão de arte é `Budget.layoutFiles` não vazio (`:1077-1108`, preflight `:626-631`). Além disso, `PENDING` é destino **manual** de 4 arestas (`budget.service.ts:5915-5995`). É daí que vêm os 155 `PENDING` sem envelope do clone.
3. **Recomendação: alternativa (a).** Os valores do enum ficam como estão; muda o rótulo de `PRE_APPROVED` para **"Valor aprovado"** e muda a semântica de `PENDING`, que passa a ser só **automático**. Nascem um registro próprio da aprovação do valor (`BudgetValueApproval`, com hash dos termos comerciais) e **um portão único de emissão**: valor aprovado **e** arte `APPROVED` em todo implemento vivo do orçamento. Não há DDL de enum nem de `queueRank`, e o `statusOrder` fica intocado. A alternativa (b) (`APPROVED` vira o "valor aprovado" e nasce um final novo) quebra a fila de faturamento, os filtros salvos, o app instalado, o changelog e 17 consumidores de `APPROVED` (§1.10, §2.2).
4. **O Billing continua nascendo na criação do orçamento** (FATO: `budget.service.ts:639`, e 15 `REQUESTED` do clone já têm Billing). A **aprovação** do Billing (fatura, NFS-e, boleto) continua exigindo `APPROVED` final (`budget.service.ts:3889-3895`). O valor aprovado **não** libera cobrança [DONO confirmar].
5. **A arte na assinatura fica, sem versão nova de recorte.** `layoutFileIds` passa a ser a **união distinta** dos `File.id` da arte `APPROVED` dos implementos do orçamento. Nasce também `layoutCoverage` **condicional**, só quando os veículos têm artes diferentes, reaproveitando a forma `[fileId, taskIds[]]` do commit `3a041693` da outra branch. A versão continua **v7**. Num orçamento de 1 veículo, ou de N veículos com a mesma arte, o hash sai idêntico ao de hoje.
6. **Isso só é verdade se a migração preservar os `File.id`**. É aí que o M3 do v1 quebra as assinaturas. O passo 5a do v1 promove o "gêmeo" da galeria da tarefa, que é **outro** `File.id`, e o passo 4 leva as imagens `APPROVED` da galeria para arte `APPROVED`. FATO no clone: **71 de 134** orçamentos com layout têm imagem aprovada na galeria **fora** do layout do orçamento. O envelope `COMPLETED` do nº 594 tem 4 dessas imagens, e seria invalidado. Regra nova (§3.4): no orçamento, a arte `APPROVED` de cada implemento é **exatamente** o conjunto de `File.id` do layout do orçamento; o resto da galeria vira `SUPERSEDED`/`DRAFT`.
7. **Arte nova depois de assinado não pode derrubar contrato selado.** Hoje uma alteração material derruba também o envelope `COMPLETED`, mesmo com cobrança faturada (`signature-envelope.service.ts:6884-7050`; o status só não regride, `budget.service.ts:3600-3606`). Com a arte mudando no implemento, isso vira rotina. Recomendo (§3.5): durante a coleta (`RUNNING`), a arte nova continua material, e o orçamento volta a "Valor aprovado", não a `PENDING`. Depois de selado (`COMPLETED`), a arte nova vira só registro de deriva, com aditivo de arte opcional [DONO].

---

## 1. Mapa do que existe

### 1.1 Onde a máquina está declarada (e os espelhos)

| O quê | Onde | Observação |
|---|---|---|
| Enum do banco, **ordem = ordem de atenção** | `prisma/schema.prisma:4662-4705` (`enum BudgetStatus`) | recriado em `prisma/migrations/20260920120000_portal_do_responsavel_requisicao_e_pedido/migration.sql:79-124` (DROP TYPE + CREATE, derrubando e recriando `queueRank`) |
| Espelho TS | `src/constants/enums.ts:2802-2857` (`TASK_QUOTE_STATUS`), alias `BUDGET_STATUS` `:2871-2872` | comentário: "os VALORES continuam… é por eles que 3.863 linhas de ChangeLog, o banco e o app instalado se entendem" |
| Rótulos | `src/constants/enum-labels.ts:2110-2123` | `PRE_APPROVED` = "Pré-aprovado"; `PENDING` = "Aguardando Assinatura"; `APPROVED` = "Aprovado" |
| Lista zod **escrita à mão** | `src/schemas/budget.ts:32-45` | estado novo que falte aqui é **apagado do filtro em silêncio** (o próprio comentário avisa) |
| Ordem persistida | `src/constants/sortOrders.ts:189-201` + **gêmeo SQL** em `20260920120000…/migration.sql:140-151` | REQUESTED 1, EXPIRED 2, PRE_APPROVED 3, SIGNED 4, IN_NEGOTIATION 5, PENDING 6, APPROVED 7, CANCELLED 8 |
| **Grafo manual** (única tabela) | `src/modules/production/budget/budget.service.ts:5915-5995` (`ALLOWED` em `validateStatusTransition`) | invólucro público `assertTransitionAllowed` `:5871-5876` (usado pelo portal) |
| Pré-requisitos por destino | `budget.service.ts:6005-6085` (`validateStatusPrerequisites`: só `APPROVED`: último envelope ≠ `INVALIDATED`, ≥1 pagador com total > 0) | |
| Papéis por destino | `src/modules/production/budget/budget.guards.ts:237-254` (`validateQuoteStatusChangeRole`: `APPROVED` → ADMIN/COMMERCIAL; resto → ADMIN/FINANCIAL/COMMERCIAL) | só roda no `update()` genérico e na escrita aninhada da tarefa, **não** em `PUT /:id/status` (`budget.controller.ts:185-216`, que só tem `@Roles(ADMIN, FINANCIAL, COMMERCIAL)`) |
| Arestas do portal | `src/modules/people/portal/portal-decision-transitions.ts:39-48` | PRE_APPROVE `IN_NEGOTIATION→PRE_APPROVED`; REFUSE `IN_NEGOTIATION→REQUESTED` |
| Espelho web | `web/src/utils/permissions/quote-permissions.ts:68-104` (`VALID_TRANSITIONS`) | "drift here breaks the UI" (`budget.service.ts:5899-5900`) |
| Espelho app (instalado) | `mobile-flutter/lib/features/financial/budget_permissions.dart:106-123` | **só conhece 5 estados** (`PENDING`, `SIGNED`, `EXPIRED`, `APPROVED`, `CANCELLED`). `REQUESTED`/`IN_NEGOTIATION`/`PRE_APPROVED` aparecem **crus** (`financial_enums.dart:58-66`: "um estado que o servidor ganhe antes do app é melhor exibido cru") |

### 1.2 `statusOrder` e `queueRank`

- **FATO.** `Budget.statusOrder Int @default(1)` (`schema.prisma:1892`), mas o default do **banco** passou a 6 (`20260920120000…/migration.sql:151`). O Prisma e o banco discordam: um `prisma migrate dev` futuro gera diff. Os escritores usam três fórmulas: `TASK_QUOTE_STATUS_ORDER[s]` puro, `|| 1` (`budget.service.ts:6305-6307`) e `?? 8` (`budget-prisma.repository.ts:242`, `budget.service.ts:524-527`). O comentário em `sortOrders.ts:186-188` proíbe o valor 0 por causa disso.
- **FATO.** `queueRank` é coluna **GERADA** (`schema.prisma:1922`). A expressão vigente está em `prisma/migrations/20260920190000_fila_hibrida_por_estado/migration.sql:47-63`: `REQUESTED, PRE_APPROVED, SIGNED, APPROVED, CANCELLED` → `-epoch(createdAt)` (mais recente primeiro); o resto → `+epoch` (mais antigo primeiro). Trocar a expressão exige `DROP INDEX` + `DROP COLUMN` + recriar (`:44-46`). Histórico: `20260917210000_fila_do_orcamento`, e depois a recriação em `20260920120000` (`:92-124`).
- **FATO (incoerência pequena).** `sortOrders.ts:190-194` põe `EXPIRED` no bloco "a Ankaa deve", e `queueRank` o põe no grupo "espera-se o cliente" (mais antigo primeiro). Sem efeito funcional, mas desmente o comentário do schema (`schema.prisma:1901-1911`).
- **Uso.** Lista interna: `[{statusOrder:'asc'},{queueRank:'asc'}]` (`20260920190000…:34-36`). O portal **não** usa (`PORTAL_BUDGET_ORDER`, `createdAt desc`).

### 1.3 O grafo: toda aresta e quem a dispara

**Arestas manuais** (`ALLOWED`, `budget.service.ts:5915-5995`), percorridas por `PUT /budgets/:id/status` (`budget.controller.ts:185`), `PUT /:id/budget-approve` (`:233`), `update()` genérico com `status` no corpo (`budget.service.ts:1235-1248`) e pelo portal (via `updateStatus`, `portal-decision.service.ts:159`):

| De → Para | Quem dispara | Onde | Efeitos |
|---|---|---|---|
| REQUESTED → IN_NEGOTIATION | comercial ("Enviar para pré-aprovação") | `updateStatus` / `update` | aviso ao requisitante "valores visíveis" (`budget.service.ts:2911-2931` e `:2263-2279`, chave `budget.portal_values_visible`) |
| REQUESTED → PENDING | comercial (cliente sem vendedor) | idem | **nenhum envelope é criado**: nasce um `PENDING` sem coleta |
| REQUESTED → CANCELLED | comercial | `updateStatus` → `cancelForTaskCancellation` (`:2861-2871`) | desmonte |
| IN_NEGOTIATION → PRE_APPROVED | **portal** (`PUT /cliente/me/orcamentos/:id/pre-aprovar`, capacidade `PRE_APPROVE`, `portal-decision.controller.ts:77-78`) **ou** interno em `/status` (ADMIN, **FINANCIAL**, COMMERCIAL, **sem nota**) | `portal-decision.service.ts:113-226` | carimbo `BudgetRequest.preApprovedAt/By` (`schema.prisma:2036-2038`); aviso `budget.portal_pre_approved` ao comercial, "Lance as assinaturas." (`portal-decision.service.ts:183-196`) |
| IN_NEGOTIATION → REQUESTED | portal (recusar, motivo obrigatório, `:97-98`) ou interno | idem | carimbo `refusedAt/By`; aviso `budget.portal_refused` |
| IN_NEGOTIATION → CANCELLED | interno | | desmonte |
| PRE_APPROVED → PENDING | **interno manual** (sem envelope!) — além da emissão | `ALLOWED` `:5985-5989` | nenhum |
| PRE_APPROVED → IN_NEGOTIATION | interno (vendedor se retratou) | | nenhum aviso (só vindo de REQUESTED avisa, `:2919-2922`) |
| PENDING → APPROVED | interno (`budget-approve`, ADMIN/COMMERCIAL) **ou** conclusão do envelope | `budgetApprove` `budget.service.ts:3640-3688` | **portão de layout** (`:3643-3649`); `task_quote.budget_approved` ao financeiro |
| PENDING → IN_NEGOTIATION | interno (cliente pede revisão com envelope lançado) | | não cancela o envelope vivo (INF: nada em `updateStatus` o faz) |
| SIGNED → APPROVED / PENDING / CANCELLED | contra-assinatura (via conclusão) ou manual | `:5935-5939` | |
| EXPIRED → PENDING / REQUESTED / CANCELLED | comercial (reanálise) | `:5945-5953` | `PENDING` de novo **sem envelope** |
| APPROVED → PENDING | "reprovar" (motivo) | `:5954`; recusado se houver Billing congelado (`:2825-2835`) | changelog `ROLLBACK` com motivo (`:2877-2896`) |
| APPROVED → CANCELLED | | `cancelForTaskCancellation` | desmonte (baixa de boleto, cancelamento de NFS-e) |

**Escritores automáticos**, todos por fora de `ALLOWED` (via `update(…, _internal=true)`, que pula a máquina, `budget.service.ts:1193, 1236`, ou por `tx.budget.update` direto):

| # | Aresta | Gatilho | Onde |
|---|---|---|---|
| A1 | qualquer ≠ PENDING/CANCELLED → **PENDING** | **emissão do envelope**, na mesma transação | `signature-envelope.service.ts:1508-1570` (inclusive de `APPROVED`, **sem** olhar `isQuoteMoneyLocked`) |
| A2 | PENDING → SIGNED | grupo 0 (cliente) completo e Ankaa pendente (`advanceEnvelope`, fire-and-forget) | `signature-envelope.service.ts:5851-5875` → `budget.module.ts:88-90` → `markSigned` `budget.service.ts:3367-3420` ("SÓ DE PENDING") |
| A3 | PENDING/SIGNED → APPROVED | envelope `COMPLETED` → `finalize` → `onCompleted` → **`budgetApprove`** (com o portão de layout; best-effort, só loga, `:6699-6725`); reexecução `POST …/reexecutar-conclusao` (`:6086-6150`) | `budget.module.ts:82-84` |
| A4 | PENDING → EXPIRED | varredura horária `deadlineAt < now` (`signature-expiry.scheduler.ts:38-150`) | `markExpiredBySignature` `budget.service.ts:3434-3480` (só de PENDING; `task_quote.expired`) |
| A5 | PENDING → EXPIRED | coleta inteira recusada (`applyRefusal`, `signature-envelope.service.ts:4264-4275`) | `markRefusedBySignature` `budget.service.ts:3500-3556` (`task_quote.refused`, com motivo) |
| A6 | APPROVED/SIGNED/EXPIRED → PENDING | envelope `INVALIDATED` por mudança material (`onQuoteContentChanged`, `signature-envelope.service.ts:6884-7050`, gancho `:7036-7044`) | `markInvalidatedBySignature` `budget.service.ts:3580-3638` (não regride com cobrança congelada) |
| A7 | APPROVED/SIGNED/EXPIRED → PENDING | edição que mexe no **valor** (`hasValueAffectingChange` `:1079-1116`) **sem** `status` no corpo | auto-revert `budget.service.ts:1215-1229`; gêmeo na escrita aninhada da tarefa `task.service.ts:808-820` |
| A8 | → CANCELLED | tarefa/O.S. comercial cancelada; orçamento sem veículo | `task.service.ts:10092-10110`, `service-order.service.ts:1144-1160` e `:3160-3172` (`tx.budget.update` direto) |
| A9 | CANCELLED → status anterior | O.S. comercial reativada (lê o changelog) | `service-order.service.ts:209-230` (direto) |
| A10 | → qualquer valor do changelog | "desfazer" do histórico | `task.service.ts:11060-11086` (direto; recusa valor inexistente) |
| A11 | nasce em **qualquer** status | `POST /budgets` e criação aninhada | `budget.service.ts:521-527` (`data.status \|\| PENDING`, sem máquina); aninhada com gate de papel `task.service.ts:829-842`; zod aceita os 8 (`schemas/budget.ts:923, 973`) |
| A12 | nasce PENDING | cópia de orçamento | `task.service.ts:13400-13408` |
| A13 | nasce REQUESTED | requisição do portal | `portal-request.service.ts:328-333` |
| A14 | nasce APPROVED | conciliação de recebível sem orçamento | `receivable-task-match.service.ts:955-968` (Billing já `approvedAt`) |

**FATO relevante ao "nota de que ninguém escreve SIGNED":** `SIGNED` **é** escrito (A2). O que não existe é escrita **manual**, e é isso que o app diz (`budget_status_control.dart:63-66`). No clone há 0 linhas em `SIGNED` e 1 transição `PENDING→SIGNED` no changelog.

### 1.4 Efeitos de cada estado

| Estado | Billing | Produção | Notificações / WhatsApp | Atenção | Portal |
|---|---|---|---|---|---|
| REQUESTED | a linha `Billing` **já existe** (plano e cobertura; FATO: os 15 do clone têm) | não depende do orçamento | `budget.portal_requested` | — | "com a Ankaa" |
| IN_NEGOTIATION | idem | idem | `budget.portal_values_visible` na entrada vinda de REQUESTED | — | `waitingOnMe.preApproval` (`portal-read.service.ts:785-814`); `canPreApprove` (`:1323-1325`) |
| PRE_APPROVED | idem | idem | `budget.portal_pre_approved` → comercial | — | "com a Ankaa" (web `waiting-on.ts:52`) |
| PENDING | idem | idem | convites `orcamento_para_assinar`, `orcamento_codigo`, lembretes, `orcamento_aguardando_assinatura` (`signature-whatsapp-templates.ts:39-65`) | `NOT_YET_INVOICED` inclui (`attention.service.ts:314`) | `signatureFacts` separa "emitido" e "minha assinatura" (`portal-read.service.ts:1360-1413`) |
| SIGNED | idem | idem | `task_quote.signed` + aviso à Ankaa `orcamento_contra_assinatura` | idem | marco "Orçamento aprovado" já atingido (`portal-read.service.ts:585-598`) |
| EXPIRED | idem | idem | `task_quote.expired` / `task_quote.refused`, `orcamento_vencido`, `orcamento_recusado` | fora de `NOT_YET_INVOICED` | |
| APPROVED | **só aqui a cobrança pode ser aprovada** (`internalApprove`, `budget.service.ts:3872-3895`) | a liberação **não** depende do orçamento: no clone há 45 tarefas em `WAITING_PRODUCTION` com orçamento `PENDING` | `task_quote.budget_approved` / `task_quote.approval_pending` ao financeiro | `budget.billing-customer-incomplete` (`attention.service.ts:560-570`) | marco 1 |
| CANCELLED | Billing cancelado pela cascata (`billing-status-cascade.service.ts:127`) | | | | |

Bônus e comissão **não leem** o orçamento (FATO: `rg` em `src/modules/personnel-department/bonus/` não acha `quote`/`Budget`).

### 1.5 Travas de edição

| Trava | Onde | Regra |
|---|---|---|
| Trava do dinheiro | `budget.guards.ts:36-40` (`isQuoteMoneyLocked`), `:163-165` (`isBillingFrozen`); aplicada em `budget.service.ts:1259-1280` e `task.service.ts:784-800` | com cobrança congelada, só as chaves de `QUOTE_SAFE_AFTER_BILLING_FIELDS` (`budget.guards.ts:212-220`: `expiresAt, customGuaranteeText, layoutFileIds, status, guaranteeYears, customForecastDays, simultaneousTasks`); `status` só pelo endpoint dedicado |
| Auto-revert por valor | `budget.guards.ts:198-210` (`QUOTE_VALUE_REVERTABLE_STATUSES = [APPROVED, SIGNED, EXPIRED]`) | **não inclui `PRE_APPROVED`** (FATO): mudar serviço de um orçamento com valor pré-aprovado **mantém** `PRE_APPROVED` |
| "Pinar" o status | `budget.service.ts:1173-1180`, `task.service.ts:2516` | quem manda `status` no corpo, mesmo igual ao atual, **suprime** o auto-revert (decisão do dono de 2026-05, `budget.guards.ts:7-10`). ⚠️ **O app instalado pina SEMPRE**: `budgetUpdateBody` manda `'status': currentStatus` em toda gravação (`mobile-flutter/lib/features/financial/budget.dart:1227-1231`) |
| Porta aninhada da tarefa | `task-prisma.repository.ts:2270-2300` | orçamento existente: recusa `status`, serviços, pagadores, modo e escalares materiais pela tarefa |
| No-op | `filterToMaterialChanges` `budget.service.ts:1021-1071` | `layoutFileIds`/`taskIds` comparados por conjunto |
| Envelope vivo ou concluído | `createEnvelope` `signature-envelope.service.ts:1039-1075` + a mesma checagem dentro da transação `:1441-1461` | não reemite sobre `RUNNING` nem sobre `COMPLETED` |

### 1.6 Portões da emissão (hoje)

| Portão | Preflight `getDeliveryPreflight` (`signature-envelope.service.ts:471-795`) | `createEnvelope` (`:907-1750`) |
|---|---|---|
| Estado do orçamento | **nenhum** | **nenhum**. Emite de `REQUESTED`, `IN_NEGOTIATION`, `EXPIRED`, `APPROVED`… e força `PENDING` (`:1533-1545`) |
| Layout | `layoutFiles` vazio → bloqueio (`:626-631`) | idem (`:1077-1108`) |
| Coleta viva/concluída | `:578-597` | `:1039-1075` e na transação `:1441-1461` |
| Dois pagadores | `:599-611` | `:1030-1037` |
| Validade vencida | `:633-638` | `:1112-1117` |
| Responsáveis / recortes / contato | `:640-706` | `:1119-1180` |

### 1.7 O que o portal faz hoje

- **Pré-aprovar / recusar** (`portal-decision.service.ts:94-226`). Escopo por `budgetScopeWhere` (404 fora do escopo), máquina via `assertTransitionAllowed` + `updateStatus(…, '')`, carimbo em `BudgetRequest` gravado antes do movimento e compensado se o movimento falhar. Capacidade `PRE_APPROVE` para COMMERCIAL, SELLER, REPRESENTATIVE e COORDINATOR (`portal-capabilities.ts:134-180`).
- **Assinar / recusar por sessão**: `signByPortalSession` (`signature-envelope.service.ts:5093`) e `refuseByPortalSession` (`:5460`), cada um com conferência de frescor (`:5269`).
- **Resumo `waitingOnMe`** (`portal-read.service.ts:760-948`): `preApproval` (IN_NEGOTIATION), `signatures` (signatário pendente em envelope RUNNING) e `inProduction`. `byStatus` é montado de `Object.values(TASK_QUOTE_STATUS)` (`:775-777`), então um valor novo aparece sozinho.
- **`signatureFacts`** (`:1360-1413`): `emitted` (RUNNING ∨ COMPLETED) e `awaitingMe`. Existe porque "18 de 18" `PENDING` do dono não tinham envelope.
- **Marco "Orçamento aprovado"** (`:585-598`): status vivo ∈ {APPROVED, SIGNED} **ou** o changelog já registrou `APPROVED`/`SIGNED` (`quoteApprovalDates`, `:511-538`).

### 1.8 O que depende de `APPROVED` ser o ÚLTIMO estado

| # | Consumidor | Arquivo:linha |
|---|---|---|
| 1 | Só se fatura orçamento `APPROVED` | `budget.service.ts:3889-3895` |
| 2 | `markSigned`/`markExpired`/`markRefused` só saem de PENDING ("não regride APPROVED") | `:3380-3385`, `:3441-3446`, `:3513-3518` |
| 3 | Reexecução da conclusão: `quote.status === 'APPROVED'` ⇒ "nada a fazer" (**literal string**) | `signature-envelope.service.ts:6132` |
| 4 | `APPROVED` → só PENDING ou CANCELLED | `budget.service.ts:5954` |
| 5 | Atenção: janela "ainda não faturado" e cadastro incompleto para NFS-e | `attention.service.ts:305-331`, `:560-570` |
| 6 | Fila "pronto para faturar" do painel | `dashboard-prisma.repository.ts:3596-3601`, contador `:3924` |
| 7 | Funil de faturamento (`QUOTE_STAGE`: APPROVED = degrau 3; REQUESTED/IN_NEGOTIATION/PRE_APPROVED **ausentes**, caem no `?? 1`) | `invoice-analytics.service.ts:651-706` |
| 8 | Marco do portal | `portal-read.service.ts:530, 589-591` |
| 9 | Conciliação cria orçamento já `APPROVED` | `receivable-task-match.service.ts:955-968` |
| 10 | Sincronia O.S.→orçamento trata `PENDING ∨ APPROVED` como "rascunho editável" | `service-order.service.ts:1957-1961`, `:2066-2068` |
| 11 | Upload anônimo de assinatura aceito em PENDING/APPROVED | `budget.service.ts:5753-5758` |
| 12 | Revert por valor e gate de papel | `budget.guards.ts:198-210`, `:237-254` |
| 13 | Lista do financeiro por filtro **negativo** `notIn [PENDING, SIGNED, EXPIRED]` (deixa passar REQUESTED/IN_NEGOTIATION/PRE_APPROVED) | `src/schemas/task.ts:1766-1776` |
| 14 | Lista de Faturamento no web filtra `quoteStatuses: ["APPROVED"]`, inclusive num **preset** | `web/src/dashboard/presets.ts:941`, `web/src/api-client/billing.ts:12-33`, API `billing.service.ts:484-495` |
| 15 | App: `budgetApprove` = PENDING→APPROVED; "reprovar" = → PENDING | `budget_status_control.dart:448-458`, `budget_permissions.dart:106-123` |
| 16 | Schema e comentários ("APPROVED é o ÚLTIMO estado daqui") | `schema.prisma:4652-4655` |
| 17 | Changelog guarda `APPROVED` (desde 17/09) e `BUDGET_APPROVED` (antes), lidos como "aprovado" por web, app e portal | `ChangeLog` (tabela) |

### 1.9 Números do clone

Por status × último envelope:

| Status | Sem envelope | RUNNING | COMPLETED* | REFUSED | EXPIRED | INVALIDATED | Total | Tarefa viva | Com `Budget.layoutFiles` | Billing (aprovados) |
|---|---|---|---|---|---|---|---|---|---|---|
| REQUESTED | 6 | **9** | — | — | — | — | 15 | 15 | 0 | 15 (0) |
| IN_NEGOTIATION | — | — | — | — | — | — | 0 | | | |
| PRE_APPROVED | — | — | — | — | — | — | 0 | | | |
| PENDING | **155** | 7 | — | 1 | 1 | — | 164 | 75 | 38 | 139 (0) |
| SIGNED | — | — | — | — | — | — | 0 | | | |
| EXPIRED | — | — | — | 6 | — | — | 6 | 1 | 0 | 6 (0) |
| APPROVED | **427** | — | — | — | 1 | 1 | 429 | 134 | 96 | 432 (158) |
| CANCELLED | — | — | 1 | — | — | — | 1 | 0 | 1 | 4 (0) |

*`COMPLETED` como **último** envelope. Existem 3 `COMPLETED` no total (nº 584 v1, nº 591 v6, nº 594 v1); o 584 tem um `INVALIDATED` v2 depois dele, e o 591 um `REFUSED` v7 (reemissões anteriores à correção de 17/09).

- Os 9 `REQUESTED` com `RUNNING` são os resíduos que `:1508-1532` descreve (seed de 20/09).
- Os layouts do orçamento: 137 arquivos, **24 são o mesmo `File` da galeria da tarefa** e **113 são clone/upload próprio** (`cloneFileForQuoteLayout`, `file.service.ts:484-540`). 133 orçamentos têm 1 arquivo, 2 têm 2.
- Envelopes `RUNNING`/`COMPLETED`: nenhum tem PDF no `layoutFileIds` congelado.
- 14 `RUNNING` congelaram o `File` `8d426db1…`, que hoje só pertence ao nº 631: **já estão derivados** (INF: seed que contornou o `resolveLayoutFileIdsForQuote`), e cairiam na próxima escrita de qualquer forma.
- Changelog (`TASK_QUOTE`/`status`): `PENDING→BUDGET_APPROVED` 283, `BUDGET_APPROVED→PENDING` 24, `REQUESTED→PENDING` 5, `PENDING→SIGNED` 1, `IN_NEGOTIATION→PRE_APPROVED` 1. A aprovação **manual sem assinatura** é o caminho dominante.

### 1.10 Defeitos achados no caminho (valem com ou sem DD2)

| # | Defeito | Evidência | Consequência |
|---|---|---|---|
| X1 | Emissão força `PENDING` a partir de `APPROVED` **com cobrança faturada** | `signature-envelope.service.ts:1533-1545` não consulta `isQuoteMoneyLocked` | orçamento faturado volta a "Aguardando Assinatura"; `internalApprove` recusa as fatias restantes (`budget.service.ts:3889`) |
| X2 | `PENDING` é destino manual sem envelope (REQUESTED→, PRE_APPROVED→, EXPIRED→, APPROVED→) | `ALLOWED` `:5915-5995` | "Aguardando Assinatura" sem nada para assinar (155 no clone; "18 de 18" no dono, `portal-read.service.ts:1343-1352`) |
| X3 | `PRE_APPROVED` fora do auto-revert | `budget.guards.ts:198-210` | valor muda e continua "pré-aprovado" pelo cliente |
| X4 | Criação aceita qualquer status sem máquina (inclusive `APPROVED`) | `budget.service.ts:521-527`; `schemas/budget.ts:923,973` | contrato "aprovado" que nunca foi aprovado |
| X5 | `COMPLETED` é invalidado mesmo com cobrança faturada (só o status não regride) | `signature-envelope.service.ts:6917-6926` + `budget.service.ts:3600-3606` | contrato selado vira `INVALIDATED` com NFS-e e boleto na rua |
| X6 | Filtro do financeiro é negativo | `schemas/task.ts:1775` | orçamento em REQUESTED/IN_NEGOTIATION/PRE_APPROVED aparece na fila de faturar |
| X7 | FINANCIAL pode pré-aprovar pelo cliente em `/status` sem nota | `budget.controller.ts:185-186` + `ALLOWED` | aprovação comercial sem autor comercial nem prova |
| X8 | `statusOrder` default diverge (schema 1 × banco 6) | `schema.prisma:1892` × `20260920120000…:151` | drift de migração |
| X9 | `markSigned` é fire-and-forget dentro do POST do cliente | `signature-envelope.service.ts:5866-5874` | se falhar, o orçamento fica `PENDING` com o cliente já assinado (só log) |

---

## 2. A máquina nova (DD2)

### 2.1 O que o DD2 exige, decomposto

- R-a. Existe uma **aprovação do valor**, e ela pode acontecer **antes** de haver arte.
- R-b. **Emitir** exige valor aprovado **e** arte `APPROVED` em todo implemento do orçamento.
- R-c. Emitir leva a um **estado próprio**.
- R-d. A assinatura **continua** e o documento leva a arte (hipótese: por veículo, congelada).
- R-e. Cabe um "orçamento prévio": o valor fica aprovado por semanas esperando a arte.

### 2.2 Alternativas

| Critério | **(a) Reaproveitar valores; mudar rótulo e semântica** | **(b) Mudar valores**: `APPROVED` passa a ser "valor aprovado" e nasce um final novo (ex. `CONTRACTED`) | (c) Valor novo intermediário (`VALUE_APPROVED`) e `PRE_APPROVED` continua do portal |
|---|---|---|---|
| Enum / DDL | nenhum | `CREATE TYPE` + `ALTER COLUMN … TYPE` com `queueRank` derrubado e recriado (mesmo caminho de `20260920120000…:79-124`); valor novo de enum **não pode** ser usado na transação em que nasce ⇒ migração em 2 releases | idem (b) |
| `queueRank` / `statusOrder` | intocados (PRE_APPROVED já está em "bola com a Ankaa") | expressão nova + backfill + gêmeo SQL | idem |
| Dados | só as linhas que mudam de sentido (§2.13) | **429 `APPROVED` → `CONTRACTED`** (clone) + todo `APPROVED` futuro com outro sentido | 0 PRE_APPROVED → novo valor |
| Faturamento | gate continua `APPROVED` (`budget.service.ts:3889`) | gate tem de virar `CONTRACTED`; se esquecer um ponto, **fatura-se orçamento só com valor aprovado**. O preset `quoteStatuses:["APPROVED"]` (`web/src/dashboard/presets.ts:941`) e o filtro negativo `schemas/task.ts:1775` passariam a mostrar orçamento não assinado na fila de faturar | = (a) |
| App instalado | não conhece `PRE_APPROVED` (mostra cru; já é assim desde 20/09); o botão "Aprovar Orçamento" continua querendo dizer "final" | o botão (`budget_status_control.dart:448-449` → `budget-approve`) passa a gravar "valor aprovado" achando que é final; `CONTRACTED` aparece cru; telas de cobrança no app travam | = (a) + valor cru |
| Changelog (append-only) | `APPROVED` continua "final" nos dois lados da história | `APPROVED` de 17/09 a hoje = final, daqui em diante = valor. O "desfazer" (`task.service.ts:11060-11086`) reverteria para o sentido errado; o marco do portal (`portal-read.service.ts:530`) leria errado | ok |
| Filtros salvos / relatórios / notificações | `PENDING` encolhe (só com envelope) | 17 consumidores de `APPROVED` (§1.8) revistos um a um; `task_quote.budget_approved` muda de sentido | + um estado para todo espelho |
| Portal | `canPreApprove` e rótulos ("Aprovar valor") | idem + marcos | dois estados para a mesma frase ("o cliente aprovou o valor") |
| Veredito | **recomendado** | descartado: o ganho é só a palavra "Aprovado" no estado do meio, e isso se consegue com **rótulo** | descartado: duplicaria o que `PRE_APPROVED` já é |

A precedência da casa é a mesma: `PENDING` virou "Aguardando Assinatura" **só no rótulo** (`schema.prisma:4694-4699`), e `TASK_QUOTE` não foi renomeado no changelog (`PLANO.md` V2).

### 2.3 Estados em (a)

| Valor (não muda) | Rótulo hoje → proposto | Significado novo | Quem deve a próxima ação |
|---|---|---|---|
| REQUESTED | Requisição (igual) | pedido do portal, sem preço | Ankaa |
| IN_NEGOTIATION | Em Negociação (igual) | **valor proposto, esperando aprovação do valor**. Passa a ser também o **estado inicial** do orçamento criado por dentro (hoje é `PENDING`) | cliente |
| PRE_APPROVED | Pré-aprovado → **Valor aprovado** [DONO: palavra] | valor aprovado (portal ou em nome do cliente). Subestado **derivado**, sem enum: "aguardando arte (k de N veículos)" / "pronto para assinatura" | Ankaa (arte e emissão) ou cliente (aprovar arte) |
| PENDING | Aguardando Assinatura (igual) | **só** com envelope `RUNNING`; escrito **só** pela emissão | cliente |
| SIGNED | Assinado → "Assinado pelo cliente" (opcional) | falta a contra-assinatura da Ankaa | Ankaa |
| EXPIRED | Aguardando Reanálise (igual) | coleta venceu ou foi recusada | Ankaa |
| APPROVED | Aprovado (igual; alternativa "Contratado" [DONO]) | final: assinado e contra-assinado, **ou** aprovado sem assinatura (legado e caminho manual) | — (cobrança) |
| CANCELLED | Cancelado | terminal | — |

### 2.4 Transições em (a)

M = manual (rota interna), P = portal, S = sistema.

| De → Para | Tipo | Gatilho e ator | Guardas novas | Efeitos |
|---|---|---|---|---|
| REQUESTED → IN_NEGOTIATION | M | comercial monta o preço | ≥1 serviço com valor | aviso `budget.portal_values_visible` (igual) |
| IN_NEGOTIATION → **PRE_APPROVED** | P | vendedor do cliente (capacidade `PRE_APPROVE`, rótulo "aprovar valor") | escopo (igual) | grava `BudgetValueApproval{source:PORTAL}` com `termsSha256`; aviso ao comercial com **o que falta** (artes pendentes ou "pronto para assinatura") |
| IN_NEGOTIATION / REQUESTED → **PRE_APPROVED** | M | "**Aprovar valor em nome do cliente**" — nova rota `PUT /budgets/:id/value-approval`, só ADMIN/COMMERCIAL, **nota obrigatória** | tira PRE_APPROVED como destino de `PUT /:id/status` (fecha X7) | `BudgetValueApproval{source:ON_BEHALF,userId,note}` |
| IN_NEGOTIATION → REQUESTED | P/M | recusa (motivo) | igual | igual |
| PRE_APPROVED → **PENDING** | S | **só a emissão** | portão único §2.6 | igual à de hoje (`:1508-1570`) |
| PRE_APPROVED → IN_NEGOTIATION | S/M | **valor mudou** (hash dos termos ≠ aprovado) ou retratação | — | revoga a aprovação (`revokedAt`, motivo); aviso ao cliente "novos valores" (reusar `budget.portal_values_visible`) |
| PENDING → SIGNED | S | igual (A2) | — | igual |
| PENDING/SIGNED → APPROVED | S | conclusão do envelope | **sem** portão de arte (a arte foi exigida na emissão e congelada; manter um portão aqui recria o nº 591) | igual |
| PENDING/SIGNED → **PRE_APPROVED** | S | envelope `INVALIDATED` por mudança material **que não é de valor** (arte, elenco, validade encurtada) | aprovação de valor ainda válida (hash igual) | **aresta nova**; hoje o destino é PENDING (`budget.service.ts:3608`) |
| PENDING/SIGNED/APPROVED → **IN_NEGOTIATION** | S | mudança de **valor** (auto-revert A7 e invalidação A6 com valor alterado) | sem cobrança congelada (igual) | hoje o destino é PENDING |
| PENDING → EXPIRED | S | prazo do envelope (A4) | — | aprovação de valor **mantida** |
| PENDING → EXPIRED | S | recusa da coleta (A5) | — | aprovação de valor **revogada** (motivo = o da recusa) |
| EXPIRED → PRE_APPROVED | M | reemitir com o mesmo valor (depois de estender a validade) | aprovação de valor válida | — |
| EXPIRED → IN_NEGOTIATION / REQUESTED / CANCELLED | M | reanálise | — | substitui o atual `EXPIRED → PENDING` |
| PRE_APPROVED → APPROVED | M | "**Aprovar sem assinatura**" (caminho legado, que é o dominante: 283 no changelog) — ADMIN/COMMERCIAL, nota obrigatória | [DONO] exigir arte aprovada aqui também? | `task_quote.budget_approved` |
| PENDING/SIGNED → APPROVED | M | aprovação manual com coleta viva (assinado em papel) | [DONO]; se ficar, **cancela** a coleta viva | |
| APPROVED → IN_NEGOTIATION | M | "reabrir negociação" (substitui APPROVED→PENDING) | sem cobrança congelada (igual a `:2825-2835`) | revoga a aprovação de valor |
| * → CANCELLED | M/S | igual (desmonte) | — | igual |

**Tirar `PENDING` de todo destino manual** (fecha X2). Compatibilidade com cliente velho: `PUT /:id/status {PENDING, reason}` vindo do app instalado ("reprovar", `budget_status_control.dart:451-454`) é traduzido para `IN_NEGOTIATION`, com contador e log (janela bilíngue, D-17 do v1).

### 2.5 A aprovação do valor: registro, prova e revogação

**Modelo proposto** (append-only, no mesmo espírito de `LayoutDecision` do v1):

```prisma
model BudgetValueApproval {
  id            String   @id @default(uuid())
  budgetId      String
  termsSha256   String   // hash da projeção COMERCIAL (abaixo) no instante da decisão
  termsVersion  Int      // versão da projeção comercial (começa em 1)
  source        BudgetValueApprovalSource // PORTAL | ON_BEHALF | MIGRATED
  responsibleId String?  // FK "Representative" quando PORTAL (nunca em FK de User)
  userId        String?  // FK User quando ON_BEHALF
  note          String?  // obrigatória em ON_BEHALF (CHECK)
  decidedAt     DateTime @default(now())
  revokedAt     DateTime?
  revokedReason String?
  budget        Budget   @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  @@index([budgetId, decidedAt])
}
```

- **Projeção comercial** (`QuoteSnapshotService.commercialTerms`, derivada do snapshot como a material): serviços, subtotal, total, desconto, condição de pagamento, texto personalizado, garantia, prazo, simultâneas, cliente `{id, document}`, `taskIds` ordenados (a frota **é** o valor, `budget.service.ts:1082-1096`), `billingSplit`, `billingGroups`. **Fora**: arte, signatários, validade, placa e chassi, número. Assim, emplacar ou estender a validade não revoga o valor.
- **Uma pergunta, uma autoridade.** Hoje "o valor mudou?" tem 3 respostas: `hasValueAffectingChange` (`budget.service.ts:1079`), o gêmeo da tarefa (`task.service.ts:811-813`, só serviços e pagadores) e a sincronia O.S.→orçamento, que **escreve serviços direto no `tx`** e só depois chama `onQuoteContentChanged` (`service-order.service.ts:1897`). Com o hash, basta um gancho pós-escrita, `reassessValueApproval(quoteId)`, chamado **nos mesmos pontos** que já chamam `onQuoteContentChanged`: `budget.service.ts:2219`, `:2596`; `service-order.service.ts:1897`; `task.service.ts:12206`. Ele roda **antes** dele, porque a decisão de destino da invalidação depende dele (§2.4).
- **O "pinar" do status.** A decisão do dono de 2026-05 (pinar mantém a aprovação) colide com o DD2, e o app instalado pina em **toda** gravação (`budget.dart:1227-1231`). Recomendação [DONO]: pinar deixa de valer para a aprovação do valor. O hash manda; quem quiser manter precisa refazer a aprovação "em nome do cliente" com nota.
- `BudgetRequest.preApprovedAt/By` (`schema.prisma:2036-2038`) continuam sendo gravados pelo portal (tela e changelog já os leem). A fonte de verdade da aprovação passa a ser `BudgetValueApproval` (o último não revogado).

### 2.6 O portão único de emissão

Uma função `assertEmissionReady(quoteId, tx?)` com a lista de bloqueios, chamada nos **três** lugares que hoje repetem os portões: preflight `:471`, `createEnvelope` `:907` e **dentro da transação** `:1441`, porque a arte pode ser reprovada entre o render e o commit.

| # | Bloqueio (código) | Regra |
|---|---|---|
| E1 | `VALUE_NOT_APPROVED` | `status === PRE_APPROVED` e há aprovação não revogada com `termsSha256 === commercialTerms(atual)`. Legado [DONO]: aceitar também `APPROVED` sem cobrança congelada e sem `COMPLETED` (fecha X1) |
| E2 | `ARTWORK_PENDING` (lista de veículos, reusando `describeVehicleList`/`layoutGateFailure` da outra branch, `PLANO.md` D-16) | toda tarefa **não cancelada** do orçamento tem implemento com ≥1 `Layout` `APPROVED` (vigente). [DONO] "arte dispensada" para serviço sem arte (§4, P6) |
| E3–E7 | os de hoje: coleta viva/concluída, 2 pagadores, validade, responsáveis, recortes | sem mudança |

O **mesmo cálculo** vira campo de leitura, `emission: { ready, blockers[] }`, no detalhe do orçamento e no portal, para as telas não recalcularem. ⚠️ Armadilha conhecida: `select` explícito descarta chave nova (`portal-read.service.ts:202-229`). O campo tem de entrar no mapeador do repositório e nos selects do portal, com teste de contrato.

**Aviso "pronto para assinatura".** Quando a última peça chega (valor aprovado com todas as artes já aprovadas, ou a última arte aprovada com o valor já aprovado), o sistema dispara uma chave nova, `task_quote.ready_for_signature`, para o COMMERCIAL, e a regra de atenção nova `budget.ready-to-emit`. A emissão **não** é automática: o operador escolhe canal, recorte e cerimônia (`createEnvelope` args, `:907-990`).

### 2.7 Emissão, contra-assinatura e conclusão

- A emissão escreve `PENDING` como hoje. Só aceita **vir** de `PRE_APPROVED` (e do legado da E1), e **nunca** mexe em orçamento com cobrança congelada (fecha X1).
- `SIGNED` e a contra-assinatura ficam iguais (A2). Para fechar X9, tornar `markSigned` reexecutável: o `replayCompletion` também deve reconhecer "grupo 0 completo e orçamento ainda PENDING".
- A conclusão (A3) chama `budgetApprove` **sem** portão de layout, e o `budgetApprove` manual passa a exigir **origem** PRE_APPROVED (ou PENDING/SIGNED só pela conclusão). Hoje `budget.service.ts:3643-3649` exige `layoutFiles`; isso sai, como já previa o v1 §6.2 item 17.

### 2.8 Expiração

- **FATO.** Só expira quem tem envelope `RUNNING` (`signature-expiry.scheduler.ts:43`). Orçamento sem envelope nunca expira: 154 `PENDING` e 427 `APPROVED` do clone têm `expiresAt` no passado.
- **Proposta.** `PRE_APPROVED` **não expira sozinho**, porque é o "orçamento prévio" do dono. A validade vencida só **bloqueia a emissão** (E5, como hoje), e estendê-la não revoga o valor (fica fora da projeção comercial). Regra de atenção nova: "valor aprovado há > N dias sem emissão" [DONO: N].

### 2.9 O valor muda depois de aprovado

| Estado no momento | Efeito |
|---|---|
| PRE_APPROVED | revoga a aprovação → IN_NEGOTIATION; aviso ao cliente (novos valores) e ao comercial |
| PENDING/SIGNED (coleta viva) | o `onQuoteContentChanged` invalida (já faz) → o gancho de invalidação vê o valor revogado → IN_NEGOTIATION |
| APPROVED sem cobrança congelada | auto-revert → IN_NEGOTIATION (hoje vai a PENDING); o `COMPLETED` é invalidado (igual a hoje) |
| APPROVED com cobrança congelada | recusado (igual a hoje, `budget.service.ts:1259-1280`) |

### 2.10 A arte muda depois de emitido

Detalhe em §3.5. Em resumo: durante a coleta (`RUNNING`), aprovar uma **versão nova** invalida a coleta, e o orçamento volta a **PRE_APPROVED**, pronto para reemitir, porque a arte nova já está aprovada. Depois de selado (`COMPLETED`), a arte nova não invalida nada [DONO].

### 2.11 Cancelamento

Fica igual: qualquer estado não terminal → CANCELLED por `cancelForTaskCancellation` (desmonte, cancela a coleta viva). A revogação da aprovação do valor é registrada. Os escritores diretos A8/A9 (`service-order.service.ts:1144-1160`, `:209-230`; `task.service.ts:10092`) ficam, mas **A9 (reativar) não pode ressuscitar `PENDING` sem envelope**: se o valor salvo no changelog for `PENDING` e não houver coleta viva, traduzir para `PRE_APPROVED` (com aprovação válida) ou `IN_NEGOTIATION`.

### 2.12 Onde o Billing nasce na máquina nova

- **Hoje (FATO)**: a linha `Billing` nasce **na criação** do orçamento, em qualquer status, porque carrega a cobertura e os pagadores (`budget.service.ts:622-660`; `budget-customer-config-sync.ts:890, 996`; cópia `task.service.ts:13458`; conciliação, já aprovada, `receivable-task-match.service.ts:988`). A **aprovação** (fatura, NFS-e, boleto) exige `APPROVED` (`budget.service.ts:3889-3895`). A lista de Faturamento depende do filtro `quoteStatuses` (`billing.service.ts:484-495`).
- **Proposta**: **nada muda**. O Billing continua nascendo como **plano** na criação, e a aprovação da cobrança continua exigindo `APPROVED` final. Valor aprovado **não** fatura. Se o dono quiser cobrar entrada antes da assinatura, isso é um Billing próprio (lote "Entrada") aprovado por exceção, não uma mudança da máquina [DONO, P3]. Corrigir X6 junto: `schemas/task.ts:1775` passa a filtro **positivo** `status: APPROVED`.

### 2.13 Migração dos orçamentos existentes (alternativa a)

Sem DDL de enum. Uma migração de dados, **depois** da criação de `BudgetValueApproval`.

| Estado × situação | Clone | Destino | Aprovação de valor criada |
|---|---|---|---|
| REQUESTED sem envelope | 6 | REQUESTED | — |
| REQUESTED com RUNNING (resíduo) | 9 | **PENDING** (é o que a emissão já faria, `:1508-1532`) | `MIGRATED`, hash atual |
| IN_NEGOTIATION | 0 | igual | — |
| PRE_APPROVED | 0 | igual | `MIGRATED` (autor = `BudgetRequest.preApprovedBy` quando houver) |
| PENDING com RUNNING | 7 | PENDING | `MIGRATED` |
| PENDING com último envelope REFUSED/EXPIRED | 1 + 1 | **EXPIRED** (resíduo anterior aos ganchos A4/A5) | REFUSED: nenhuma; EXPIRED: `MIGRATED` |
| PENDING sem envelope | **155** | **IN_NEGOTIATION** ("proposta com o cliente", o sentido que `PENDING` tinha até 20/09) [DONO] | — |
| SIGNED | 0 | igual | `MIGRATED` |
| EXPIRED | 6 | igual | — |
| APPROVED (qualquer) | 429 | igual | `MIGRATED` (senão o primeiro save revogaria) |
| CANCELLED | 1 | igual | — |

**SQL para medir em produção** (colar no ensaio):

```sql
WITH last AS (SELECT DISTINCT ON ("quoteId") "quoteId", status FROM "SignatureEnvelope" ORDER BY "quoteId", "createdAt" DESC)
SELECT b.status, coalesce(l.status::text,'(sem envelope)') ultimo, count(*),
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Billing" x WHERE x."quoteId"=b.id AND (x."approvedAt" IS NOT NULL OR x.status IN ('APPROVED','PARTIAL','OVERDUE','SETTLED')))) com_cobranca_congelada
FROM "Budget" b LEFT JOIN last l ON l."quoteId"=b.id GROUP BY 1,2 ORDER BY 1,2;
```

Os 155 → IN_NEGOTIATION saem do filtro salvo "PENDING" (preset `web/src/dashboard/presets.ts:887`). É o efeito desejado ("Aguardando Assinatura" passa a ser verdade), mas **muda o que o operador vê** e tem de ir ao dono (P4).

### 2.14 Mudanças por arquivo (API, este recorte)

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `prisma/schema.prisma` | — | `BudgetValueApproval` + enum `BudgetValueApprovalSource`; comentário de `BudgetStatus` (`:4645-4705`) com a semântica nova de `PRE_APPROVED`/`PENDING`; alinhar o default de `statusOrder` (X8) |
| `src/constants/enum-labels.ts:2118` | "Pré-aprovado" | "Valor aprovado" [DONO] |
| `budget.service.ts:5915-5995` (`ALLOWED`) | 4 arestas manuais para PENDING | §2.4: PENDING só por S; novas `PENDING/SIGNED→PRE_APPROVED` (S), `APPROVED→IN_NEGOTIATION`, `EXPIRED→PRE_APPROVED/IN_NEGOTIATION`, `PRE_APPROVED→APPROVED` (M, nota). Separar "arestas manuais" de "arestas de sistema" em duas tabelas, as duas auditadas |
| `budget.service.ts:2791-2957` (`updateStatus`) | aceita `PRE_APPROVED` de FINANCIAL, sem nota | destino `PRE_APPROVED` só pela rota de aprovação de valor; `PENDING` manual → 400 (ou tradução do cliente velho) |
| nova rota `PUT /budgets/:id/value-approval` (+ `DELETE` para revogar) | — | ADMIN/COMMERCIAL, nota obrigatória, grava `BudgetValueApproval` |
| `budget.service.ts:3640-3688` (`budgetApprove`) | portão `layoutFiles` | sem portão de arte; origem exigida (§2.7) |
| `budget.service.ts:3580-3638` (`markInvalidatedBySignature`) | → PENDING | → PRE_APPROVED (valor válido) ou IN_NEGOTIATION |
| `budget.service.ts:3500-3556` (`markRefusedBySignature`) | → EXPIRED | idem + revoga o valor |
| `budget.service.ts:1215-1229` e `task.service.ts:808-820` (auto-revert) | → PENDING; lista sem PRE_APPROVED | substituídos por `reassessValueApproval` (hash); destino IN_NEGOTIATION |
| `budget.guards.ts:198-210` | `QUOTE_VALUE_REVERTABLE_STATUSES` | vira `[PRE_APPROVED, PENDING, SIGNED, APPROVED, EXPIRED]` com destino calculado; `validateQuoteStatusChangeRole` (`:237-254`): `PRE_APPROVED` e `APPROVED` → ADMIN/COMMERCIAL |
| `budget.service.ts:521-527`, `schemas/budget.ts:923,973` | cria em qualquer status; default PENDING | default **IN_NEGOTIATION**; só REQUESTED/IN_NEGOTIATION na criação (fecha X4); `PENDING` vindo de cliente velho é traduzido |
| `task.service.ts:13400-13408` (cópia) | nasce PENDING | nasce IN_NEGOTIATION |
| `signature-envelope.service.ts:471-795, 907-1117, 1441-1461` | portões espalhados | `assertEmissionReady` (§2.6) |
| `signature-envelope.service.ts:1533-1545` | força PENDING de qualquer um | só de PRE_APPROVED (ou do legado aceito na E1); nunca com cobrança congelada |
| `portal-decision.service.ts:183-226` | "Lance as assinaturas" / "vai lançar as assinaturas" | texto condicionado ao `emission.blockers` (artes pendentes) |
| `portal-read.service.ts:760-948` (`resumo`) | 3 grupos | + "artes aguardando você" (P13b do v1) e `emission` no orçamento |
| `portal-read.service.ts:585-598` (marco 1) | APPROVED ∨ SIGNED | [DONO] contar PRE_APPROVED como "Orçamento aprovado" para o cliente (é o que ele fez) |
| `schemas/task.ts:1775` | filtro negativo | positivo `APPROVED` (X6) |
| `invoice-analytics.service.ts:651-706` | sem degraus para REQUESTED/IN_NEGOTIATION/PRE_APPROVED | IN_NEGOTIATION 1, PRE_APPROVED 2 |
| `attention.service.ts:305-331` | `NOT_YET_INVOICED` = PENDING/SIGNED/APPROVED | + PRE_APPROVED; regras novas `budget.ready-to-emit` e "valor aprovado parado" |
| seed de notificação | — | `task_quote.ready_for_signature`, `task_quote.value_approved`, `task_quote.value_approval_revoked` (guarda G9 do v1) |
| `service-order.service.ts:209-230` | ressuscita valor do changelog | não ressuscita PENDING sem coleta (§2.11) |

### 2.15 Compatibilidade (janela bilíngue do v1, D-17)

| Cliente velho faz | Servidor novo responde |
|---|---|
| app: `budget-approve` num PENDING **sem** coleta (não existirá depois da migração) ou num PRE_APPROVED (o app não mostra) | 400 com mensagem ("aprove o valor e as artes, ou use Aprovar sem assinatura no web") |
| app: `PUT /:id/status {PENDING, reason}` ("reprovar") | traduz para IN_NEGOTIATION, conta e loga |
| app: pina `status` em todo save | ignorado para a aprovação do valor (§2.5) |
| web velho: `layoutFileIds` no corpo | aceito e ignorado com log (v1 §6.2 item 22) |
| filtros salvos com `PENDING` | seguem válidos (o valor existe); só encolhem |

---

## 3. A assinatura com a arte do implemento

### 3.1 Como é hoje (FATO)

| Peça | Onde | O que faz com a arte |
|---|---|---|
| Snapshot | `quote-snapshot.service.ts:207` (tipo), `:389` (include `layoutFiles orderBy createdAt`), `:530` (`layoutFileIds: quote.layoutFiles.map(id).sort()`) | ids ordenados, um conjunto só para o orçamento |
| Recorte material | `:326`, `:594` (`layoutFileIds` em **todas** as versões v1–v7), versão `:297` (=7), suportadas `:300` | trocar a arte é material em qualquer versão |
| Tolerâncias | `matchesFrozenTerms` `:681-744`: `tolerateLateRegistration` `:792`, `tolerateSettledRoster` `:750`, `tolerateExtendedValidity` `:873` | nenhuma é de arte |
| Diff | `quote-diff.ts:65,100,114` (grupo `LAYOUT`), `:560-567` (`withDefaults` fabrica `[]`), `:1099-1120` (linha "Layout aprovado": N imagens → M imagens) | |
| Documento | `signature-envelope.service.ts:2464-2466` (`layoutImages` de `quote.layoutFiles`), `quote-html.builder.ts:291, 404, 794-819` (seção "Layout", sem legenda), `quote-renderer.service.ts:455-629` (folha com arte) | sem dizer de qual veículo |
| Recortes | `quote-sections.ts:45-53` (`LAYOUT` é o último de `QUOTE_SECTIONS`), `:138` (`MARKETING: ['LAYOUT']`), `:137` (FINANCEIRO sem LAYOUT) | |
| Invalidação | `onQuoteContentChanged` `signature-envelope.service.ts:6884-7050` (RUNNING, senão COMPLETED); também no OTP `:3838`, na contra-assinatura `:4620`, na sessão do portal `:5269` e no selo `:6330-6376` (`PADES_FAILED snapshot_stale_at_seal`) | |
| Bytes | o PDF congelado é servido do disco (`renderServedDocument` `:7374+`), e o selo confere o hash em disco (`finalize` `:6298-6302`) | **os bytes não dependem do `File.id` da arte depois de congelados**. O que depende é o **hash material** |

### 3.2 O que o v1 previa e o que muda agora

| v1 (D-14, §6.2 "Assinatura") | Agora (DD2) |
|---|---|
| snapshot v5 sem `layoutFileIds`; material v8 sem a chave; `tolerateDetachedLayout` | **cai.** `layoutFileIds` fica, na v7, com fonte nova (arte `APPROVED` dos implementos) |
| `LAYOUT` sai de `TOGGLEABLE_SECTIONS`; `MARKETING: []` | **cai.** `LAYOUT` continua alternável; MARKETING continua assinando LAYOUT |
| "nada acontece com a assinatura quando a arte muda" (`PLANO.md:1533`) | **cai.** A arte é material durante a coleta (§3.5) |
| Portões "Selecione um layout aprovado…" somem | trocados pelo portão E2 (arte do implemento) **e** E1 (valor) |
| M3 passos 4/5: fan-out das imagens da galeria com o status original; o gêmeo `DRAFT` é promovido (outro `File.id`) | **muda** para os orçamentos com layout (§3.4) |
| G11 (hashes de ouro) como portão de deploy | **fica**, e passa a ser a prova de que a preservação de ids funcionou |
| `quote-snapshot.service.ts` escreve as chaves velhas (`truck`, `vehicles[].implementType`) a partir de `implement` | **fica** (P11 do v1) |

### 3.3 Desenho novo

1. **Uma fonte**, `quoteArtworkOf(quote)`, em `@utils/quote-artwork.ts`, usada pelo snapshot, pelo documento e pelo portão E2. Para cada tarefa não cancelada, na ordem canônica (`QUOTE_TASKS_ORDER_BY`), ela devolve a arte `APPROVED` vigente do implemento: `[{ taskId, layoutId, fileId, file }]`. `QUOTE_SNAPSHOT_INCLUDE` (`quote-snapshot.service.ts:387-439`) ganha `tasks.include.implement.include.layouts: { where: { status: 'APPROVED' }, include: { file: true }, orderBy: [{ createdAt: 'asc' }, { fileId: 'asc' }] }`. O `satisfies Prisma.BudgetInclude` pega o erro de nome no `tsc` (G0 do v1).
2. **`layoutFileIds`** = `unique(fileIds).sort()`. O mesmo arquivo em N implementos conta **uma** vez; hoje o conjunto não tem repetição, e a união tem de reproduzir isso.
3. **`layoutCoverage`** (forma do commit `3a041693`: `Array<[fileId, taskIds[] ordenados]>` ordenado por `fileId`) é emitido **só quando a cobertura não é uniforme**, isto é, quando algum veículo não tem exatamente o mesmo conjunto dos outros. É a mesma técnica da outra branch: chave ausente ⇒ hash idêntico ao de hoje, **sem subir a versão** (o comentário dela, `3a041693`, mostra por que subir para v8 faria a troca de cobertura passar calada). O `materialProjection` emite `layoutCoverage` em qualquer versão quando o snapshot a tem, como na outra branch.
   - ⚠️ Se `feat/orcamento-veiculos` for a produção antes (DD6), um orçamento `PER_VEHICLE` com cobertura **uniforme** tem a chave congelada, e a regra "só se não uniforme" não a emitiria. Guardar o `Budget.layoutScope` dela como **flag legado de leitura**, e emitir a chave quando `layoutScope = PER_VEHICLE` **ou** quando a cobertura não for uniforme.
4. **Documento**: legenda por veículo em cada imagem, como `3a041693` faz no `quote-html.builder.ts` (dentro de `.layout-grid`, só quando não uniforme). A ordem das imagens segue o primeiro veículo coberto. Só vale para documento novo, porque os congelados não são re-renderizados (FATO §3.1).
5. **Diff**: a linha "Layout aprovado" (`quote-diff.ts:1103-1120`) vira "Arte aprovada", com a chave `layout` mantida. Ganha a linha por veículo quando há `layoutCoverage`, como na outra branch ("Layout aprovado por veículo").
6. **O que fica gravado como prova da arte**: o PDF congelado (bytes) + `LayoutDecision` (quem aprovou, sessão OTP, `fileSha256`, v1 §6.2). O snapshot **não** ganha `sha256` da arte: acrescentar chave muda o hash completo de todo orçamento e gera deriva cosmética em massa.

### 3.4 Como NÃO invalidar os envelopes vivos na migração

A regra de ouro: **para todo orçamento com `Budget.layoutFiles` não vazio, o conjunto `layoutFileIds` calculado da arte dos implementos depois de M3 tem de ser igual, `File.id` por `File.id`, ao calculado de `Budget.layoutFiles` antes de M3.** Sem versão nova e sem tolerância, isso só acontece se a migração obedecer a quatro regras, que **substituem M3 passo 4 (status) e passo 5a/5b** do v1 para esses orçamentos:

| Regra | Por quê (FATO do clone) |
|---|---|
| M-A. A arte `APPROVED` de cada implemento de um orçamento com layout é criada **com o próprio `File.id` de `Budget.layoutFiles`** (o clone), sempre. **Nunca** se promove o "gêmeo" por `path`/`originalName+size` | 113 dos 137 arquivos de layout de orçamento são clone (outro `File.id` que o da galeria); o 5a do v1 trocaria o id |
| M-B. As imagens da galeria da tarefa que **não** estão no layout do orçamento **não** viram `APPROVED` nesses implementos: gêmeo → `SUPERSEDED` (com `supersedesId` para a linha M-A); as demais → `DRAFT` ou `SUPERSEDED` [DONO] | **71 de 134** orçamentos com layout têm imagem `APPROVED` da galeria fora do layout do orçamento; o nº 594 (`COMPLETED`) tem 4. Com o passo 4 do v1 elas entrariam na união e o contrato cairia |
| M-C. Orçamento com envelope `RUNNING`: a arte do layout vira `APPROVED` com fonte nova `MIGRATED_ENVELOPE`, **mesmo com o orçamento em PENDING/REQUESTED** (o v1 D-13 mandava para `PENDING_APPROVAL`) | a coleta em curso já mostra essa arte ao cliente; `PENDING_APPROVAL` tiraria o arquivo da união e invalidaria. Vai para a triagem do dono |
| M-D. Todos os implementos do orçamento recebem **o mesmo conjunto** (cobertura uniforme), porque hoje o layout vale para todos os veículos (memória 23/09, caso nº 990) | cobertura uniforme ⇒ sem `layoutCoverage` ⇒ hash igual |

Também:

- **PDF no layout do orçamento** (4 no clone): o v1 manda para o projeto da tarefa (5c), e aí ele sai da união. Nenhum envelope vivo do clone tem PDF congelado. **Medir em produção.** Se houver, esse PDF fica também como arte `APPROVED` (só nesse orçamento), para preservar o id.
- **Orçamentos sem envelope vivo**: a regra M-A/M-B/M-D continua certa, porque é a arte que o comercial escolheu, e deixa todo orçamento reemissível sem surpresa. Para `EXPIRED`/`CANCELLED`, v1 D-13 (nada).
- **Prova (G11 do v1, com o código novo)**: no ensaio em transação revertida, rodar para cada envelope `RUNNING`/`COMPLETED` a verificação `matchesFrozenTerms(buildForQuote(), quoteTermsSha256, quoteSnapshot, pendentes) !== null` **antes e depois** de M3. O critério é: **quem casava antes, casa depois**. Os 14 `RUNNING` do seed que já não casam hoje ficam fora.
- **Rede de segurança** (só se o G11 achar resíduo): uma tabela de rastreio `_Mig0924_ArtworkFromQuote(budgetId, quoteFileId, layoutId)` e uma tolerância `tolerateMigratedArtwork(current, frozen, trace)` que devolve ao conjunto congelado os ids que o rastreio diz terem virado arte no mesmo orçamento. **Não recomendo ligar por padrão**, porque toda tolerância é um lugar por onde uma troca real passa calada.

### 3.5 Arte nova depois de emitido ou assinado

Premissa (D-21 do v1): a arte aprovada não se "desaprova". Uma versão nova nasce `DRAFT` → `PENDING_APPROVAL`, e a vigente continua `APPROVED` até a nova ser aprovada. Nesse momento a anterior vira `SUPERSEDED`. **Só a aprovação da nova versão muda `layoutFileIds`.** Por isso o `ImplementLayoutService` (P12 do v1) tem de chamar `reassessValueApproval` e depois `onQuoteContentChanged` do orçamento da tarefa em **toda** mudança de estado de arte, nos mesmos pontos em que hoje o `update` do orçamento o faz. Senão a coleta não fica sabendo.

| Momento | Recomendação | Alternativa |
|---|---|---|
| Valor aprovado, sem coleta | nada: só recalcula `emission` e dispara "pronto para assinatura" | — |
| Coleta `RUNNING` | **material**: invalida (motivo "Arte do veículo X mudou"); o orçamento vai a **PRE_APPROVED** (valor válido) e fica pronto para reemitir, porque a arte nova já está aprovada. Enquanto houver coleta viva, a tela de "Enviar nova versão para aprovação" avisa que a aprovação vai anular a coleta | bloquear o envio de versão nova enquanto houver `RUNNING` (mais rígido; obriga a cancelar a coleta antes) |
| Coleta `COMPLETED` (contrato selado) | **não invalida**: tolerância `tolerateArtworkAfterSeal` aplicada **só** quando o envelope comparado está `COMPLETED` (`onQuoteContentChanged` já sabe qual achou, `:6910-6921`). Grava deriva (`recordDriftOnce`) e mostra "arte alterada depois da assinatura"; oferece **aditivo de arte** assinado, no molde de `issueVehicleAddendum` (`:7644`), opcional [DONO] | comportamento de hoje: invalida o contrato selado. Com cobrança faturada o status não regride, mas o documento vira `INVALIDATED` com NFS-e e boleto na rua (X5). Com a arte mudando no implemento, isso vira rotina |

Nos dois primeiros casos o envelope invalidado é a regra que já existe (CC art. 431, OWASP, citados em `:6881-6882`). No terceiro, a prova da arte nova é a decisão registrada no portal (quem, sessão, `fileSha256`), que o v1 já desenhou.

---

## 4. Perguntas ao dono

| # | Pergunta | Recomendação |
|---|---|---|
| P1 | O estado do meio se chama como na tela? "Valor aprovado" (e o final continua "Aprovado")? | **Sim**: `PRE_APPROVED` = "Valor aprovado"; `APPROVED` = "Aprovado". Os valores gravados não mudam |
| P2 | Quem aprova o valor? | No portal, quem já pré-aprova (Comercial, Vendedor, Representante, Coordenador). Por dentro, só ADMIN/COMERCIAL, **em nome do cliente**, com **nota obrigatória**. O Financeiro deixa de poder |
| P3 | Valor aprovado já libera cobrança (sinal, entrada)? | **Não.** A cobrança continua saindo só do orçamento Aprovado (final) |
| P4 | Os orçamentos "Pendente" **sem** coleta de assinatura (155 no clone; "18 de 18" no seu acervo) viram "Em Negociação"? | **Sim.** "Aguardando Assinatura" passa a ser sempre verdade |
| P5 | Ainda se pode **aprovar sem assinatura** (hoje é o caminho mais usado)? Exige arte aprovada? | **Sim**, só a partir de "Valor aprovado", com nota; sem exigir arte (a arte já trava a produção, DD3) |
| P6 | Serviço sem arte (só pintura): pode "dispensar a arte" de um veículo para liberar a emissão? | **Sim**, como ato explícito (Comercial, com nota), registrado no implemento |
| P7 | Editar valor com o status "pinado" continua mantendo a aprovação (decisão de 05/2026)? O app pina em todo salvamento | **Não** para a aprovação do valor: mudou o valor, o cliente aprova de novo (ou o comercial, em nome dele, com nota) |
| P8 | Arte nova aprovada **depois do contrato assinado**: derruba o contrato ou vira registro (+ aditivo opcional)? | **Registro** + aditivo de arte opcional. Durante a coleta em curso, derruba e volta a "Valor aprovado" |
| P9 | "Valor aprovado" vence sozinho se a arte demorar? | **Não.** Só a validade vencida bloqueia a emissão, e um alerta avisa "parado há N dias" (sugestão N = 15) |
| P10 | O marco do portal "Orçamento aprovado" acende no "Valor aprovado"? | **Sim** (é o que o cliente fez) |
| P11 | Na migração, a arte de coleta **em andamento** entra como "Aprovada"? | **Sim** (`MIGRATED_ENVELOPE`), com lista para você conferir; senão a coleta cai |
| P12 | As imagens aprovadas da galeria que **não** foram escolhidas no orçamento viram "Substituída" no implemento? | **Sim**, para os orçamentos com layout. Senão elas entram no contrato e derrubam assinaturas |

---

## 5. Riscos

| # | Risco | Grav. | Prob. | Mitigação |
|---|---|---|---|---|
| R1 | Migração da arte troca `File.id` (gêmeo) ou soma imagens da galeria ⇒ **coletas RUNNING/COMPLETED invalidadas** e orçamentos de volta | ⛔ jurídica | **alta** se o M3 do v1 for usado como está (71/134 no clone; nº 594 `COMPLETED`) | regras M-A…M-D (§3.4); G11 antes/depois no ensaio como portão de deploy |
| R2 | Algum escritor de arte não chama `onQuoteContentChanged` ⇒ coleta assina arte que não é mais a aprovada, sem invalidar | ⛔ | média (o `ImplementLayoutService` é código novo; o portal aprova arte por outra porta) | chamada num único ponto do serviço; e2e "aprovar arte nova com coleta viva invalida" |
| R3 | Portão de emissão duplicado divergir (preflight diz "pode", POST dá 400) | alto | média | `assertEmissionReady` único, usado nos 3 lugares (§2.6) |
| R4 | Revogação por hash revoga demais (campo cosmético dentro da projeção comercial) ⇒ cliente reaprova à toa | médio | média | projeção comercial com testes de ouro; placa, chassi, validade, número e signatários **fora** |
| R5 | App instalado: pina status, "reprova" para PENDING, não conhece PRE_APPROVED | médio | certa | tradução e contador na janela bilíngue (§2.15); P24 do v1 ganha os estados |
| R6 | `select` explícito / include enumerado descartam `emission`, `valueApproval` e `artworks` em silêncio (portal `portal-read.service.ts:202-229`, repositório do orçamento) | médio | alta | teste de contrato por rota (G4 do v1) com a chave nova |
| R7 | Lista zod à mão (`schemas/budget.ts:32-45`) não acompanha: filtro é apagado e devolve a tabela | médio | baixa (a alternativa (a) não cria valor) | manter; G5 do v1 |
| R8 | Os 155 `PENDING` → `IN_NEGOTIATION` somem do filtro/preset "Pendente" de quem os usa | baixo/médio | certa | aviso no deploy; preset `presets.ts:887` revisto |
| R9 | `layoutCoverage` da outra branch em produção antes deste rework ⇒ cobertura uniforme `PER_VEHICLE` sem a chave ⇒ invalidação | alto | depende de DD6 | flag `layoutScope` legado (§3.3 item 3); G11 |
| R10 | Conclusão do envelope volta a ter portão (o de hoje, ou um novo de arte) ⇒ contrato selado com orçamento parado (nº 591) | alto | baixa | portão só na emissão; conclusão sem portão (§2.7) |
| R11 | X1/X5 continuam: emissão sobre orçamento faturado; invalidação de contrato selado com cobrança | alto | média | corrigir junto (§2.7, §3.5) |
| R12 | A reativação da O.S. comercial (A9) ressuscita `PENDING` sem coleta | baixo | baixa | tradução em `service-order.service.ts:209-230` (§2.11) |
