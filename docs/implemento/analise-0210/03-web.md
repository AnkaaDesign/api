# 03 — Web: o que quebra contra a API nova, o que falta e como reorganizar o orçamento (análise de 02/10/2026)

Branch do web: `web-wt-implemento`, tip `db47f659`, base na `main` `2574b7f8`.

Leitura obrigatória antes: `01-api-dominio.md` (o domínio e as rotas). Este documento parte de lá e confere o **web
de hoje**, linha por linha. O plano original da Fase C está em `PLANO.md` §6.4–§6.6 e §6.14. Ele foi escrito antes
da DD13 (nomenclatura) e da DD14 (série), então uma parte já foi feita. Aqui separo o que **ainda** falta, medido
no código.

**Convenção.** Toda linha é `arquivo:linha` relativo a `web-wt-implemento/src/`, salvo quando indicado. Os
sintomas foram **verificados** contra os schemas zod da API: rodei `safeParse` dos formatos que o web manda contra
`taskGetManySchema`, `taskGetByIdSchema`, `taskUpdateSchema`, `budgetGetManySchema` e `budgetUpdateSchema` da
branch. Uma ressalva importante sobre os resultados:

| Formato que o web manda | O que a API faz | Como aparece na tela |
|---|---|---|
| `where.status.in` com `PRE_APPROVED` (orçamento) | **400** (`invalid_union @where.status`) | "Parâmetros de consulta inválidos" |
| `where.layouts` (tarefa) | **400** (`unrecognized_keys`) | idem |
| `include.layouts` (tarefa), `include.layoutFiles` (orçamento) | **descartado calado**: resposta 200 com `include: {}` | a seção fica **vazia**, sem erro nenhum |
| `layoutIds`, `layoutStatuses`, `serialNumber` no topo de `PUT/POST /tasks` | **400** (`.strict()`) | o salvar falha inteiro |
| `layoutFileIds` em `PUT /budgets/:id` | **descartado calado**: 200 | "Salvo com sucesso" e **nada gravado** |
| `status: "APPROVED"` em `PUT /budgets/:id` ou `PUT /budgets/:id/status` **sem nota** | **400** ("aprovar o valor é um ato com nota") | o salvar falha |

O pior grupo é o dos **descartes calados**: a tela parece funcionar e não funciona. É o padrão que a régua da API
(G1/G2) existe para pegar, mas ela só cobre o que chega como `where`, `orderBy` ou corpo de escrita. Para `include`,
ela só conta (`ESTADO.md:117`).

---

## 0. Resumo em uma tela

- O web desta branch **já fala `implement`**: zero `truck` fora do Estúdio 3D, a série vai em
  `implement.serialNumber` e `/implements/*` já está no lugar de `/trucks/*` (DD13/DD14 feitas).
- O que **não** foi feito é o **Modelo C do orçamento** e a **arte do implemento**. O web ainda pensa assim:
  1. o orçamento tem um "layout aprovado" (`layoutFileIds`);
  2. a tarefa tem layouts (`task.layouts`, `layoutIds`, contexto `tasksLayouts`);
  3. existe `PRE_APPROVED`;
  4. aprovar é escrever `status`.

  Na API nova, nenhuma dessas quatro coisas existe.
- **Quebra imediata (400):** quatro telas.
  - Lista de orçamentos.
  - Filtro "Tem layout" do painel.
  - Salvar tarefa com layout mexido, nas variantes criar, editar, lote, criar orçamento e copiar de outra tarefa.
  - Aprovar orçamento pela web.
- **Quebra calada:** cinco telas.
  - Detalhe da tarefa (seção Layouts vazia).
  - Detalhe do orçamento (passo 1 sem layouts; seletor "Layout aprovado" que salva e não grava).
  - Detalhe do faturamento (seletor de layout sem opções).
  - Páginas públicas do orçamento e do relatório (bloco Layout vazio).
  - Copiar de outra tarefa (copia sem arte).
- **Inexistente na web:**
  - os 5 atos novos do orçamento;
  - a arte do implemento (painel com versões e decisão);
  - o checklist "Para emitir falta…";
  - o selo da assinatura no faturamento;
  - todo o pedaço de arte do portal;
  - a frente e a porta traseira.

---

## 1. Inventário de quebras, por tela

Legenda do sintoma: **400** = erro visível · **CALADO** = sem erro, dado some ou não grava · **ERRADO** = mostra
outra coisa.

### 1.1 Financeiro › Orçamentos (lista) — `/financeiro/orcamento`

| # | Onde | O que manda / faz | Sintoma | Conserto |
|---|---|---|---|---|
| L1 | `components/financial/budget/table/budget-table-columns.tsx:492` (`BUDGET_QUOTE_STATUSES`, o `where` padrão da lista) | `status.in` com `"PRE_APPROVED"` | **400** — é o erro que o dono viu | derivar de `generated/contracts/enums.json → orcamento.status` (7 valores) |
| L2 | `constants/enums.ts:2950`, `types/budget.ts:16`, `schemas/budget.ts:48` | o enum, o tipo e o zod do web têm 8 valores | permite montar o filtro errado | tirar `PRE_APPROVED`; gerar do contrato (G5/G31) |
| L3 | `constants/sortOrders.ts:170-171` | ordem com `PRE_APPROVED: 3`, `SIGNED: 4` | ordenação local diverge da `statusOrder` da API (REQUESTED 1 · EXPIRED 2 · PENDING 3 · IN_NEGOTIATION 4 · APPROVED/SIGNED 5 · CANCELLED 6) | usar `orcamento.ordem` do contrato |
| L4 | `constants/enum-labels.ts:2484-2500` | `PENDING` = "Aguardando Assinatura", `IN_NEGOTIATION` = "Em Negociação", `SIGNED` = "Assinado" | **ERRADO**: o contrato diz "Pendente", "Aguardando aprovação do cliente" e "Assinado (legado)" (`generated/contracts/labels.json → tela.TASK_QUOTE_STATUS_LABELS`). Na branch, 155 de 164 `PENDING` não têm coleta (relatório 09 §1.2); o rótulo atual mente | ler os rótulos do contrato |
| L5 | `components/production/task/quote/quote-status-badge.tsx:83` | segundo mapa de rótulo/cor, com `PRE_APPROVED` | ERRADO | um mapa só, lido do contrato |
| L6 | sem coluna | o eixo da assinatura (`signatureStatus`) e o "pronto para emitir" não aparecem | o comercial não sabe quem está travado em quê | coluna "Assinatura" (rótulos `BUDGET_SIGNATURE_STATUS_LABELS` do contrato) + filtro "Pronto para emitir" (`emission.ready`) |

### 1.2 Financeiro › Orçamento (detalhe/edição) — `/financeiro/orcamento/detalhes/:taskId`

Arquivo principal: `pages/financial/budget/details/[taskId].tsx` (**2.804 linhas**). O mapa completo da tela está
no §3.

| # | Onde | O que manda / faz | Sintoma | Conserto |
|---|---|---|---|---|
| D1 | `[taskId].tsx:2163-2168` (salvar com status escolhido) → `api-client/budget.ts:74-75` `PUT /budgets/:id/status {status, reason}` | ao escolher **Aprovado**, manda `reason` **só** quando o passo é `PENDING` | **400**: a API delega `APPROVED` a `approveValue(ON_BEHALF)`, que exige nota (`api: budget.service.ts:2790-2795,2832`) | botão "Aprovar valor em nome do cliente" que abre um diálogo com nota obrigatória e chama `PUT /budgets/:id/value-approval {note}` |
| D2 | `utils/permissions/quote-permissions.ts:66-104` (`VALID_TRANSITIONS` "espelho") + `getQuoteStatusPath` (`:139`) | grafo próprio de 8 estados; `IN_NEGOTIATION → PRE_APPROVED/REQUESTED`; `PRE_APPROVED → PENDING` | o caminho calculado passa por um estado que não existe; `IN_NEGOTIATION → REQUESTED` a API **não** aceita como manual | usar `orcamento.transicoesManuais` do contrato; e trocar a "caminhada" de status por **atos** (D1, D3) |
| D3 | `components/financial/budget/budget-state-actions.tsx:60-101` | "Enviar para pré-aprovação" só de `REQUESTED`; `SIGNATURE_HINT[PRE_APPROVED]` | ERRADO: o ato real é "Enviar para aprovação do cliente" e vale de **`REQUESTED` e `PENDING`** (`PUT …/send-to-customer`, exige ≥1 item com valor). Faltam "Retirar do cliente", "Reprovar valor" e "Aprovar valor em nome do cliente" | reescrever como **atos** que chamam as rotas diretamente (não "escrever estado no formulário e salvar") |
| D4 | `components/financial/budget/steps/budget-step-review.tsx:547` (combobox de status) e `:1307` (diálogo "Rejeitar Orçamento") | oferece as arestas do grafo velho | idem D1/D2 | o combobox some; ficam os atos |
| D5 | `[taskId].tsx:285` + `components/financial/budget/vehicles/use-budget-vehicles.ts:23,31` (`BUDGET_VEHICLE_TASK_INCLUDE` com `layouts: {include:{file}}`) | include de layout **da tarefa** | **CALADO**: `layoutsByTask` fica `{}`; o acordeão "Layout Referência" do passo 1 abre vazio | `implement: { include: { layouts: { where: { status: { not: 'SUPERSEDED' } }, include: { file: true } } } }` ou `GET /implements/:id/layouts` |
| D6 | `[taskId].tsx:344-365, 774-791, 901-916, 1034-1057, 1551, 1861-1882, 1951, 2016, 2212, 2352-2425` (estado `layoutFiles`, `vehicleLayoutFiles`, `layoutsByTask`, `layoutStatusesByTask`, reconciliação, `resolvedLayoutIds`) | máquina inteira do "layout aprovado do orçamento" | **CALADO**: `PUT /budgets/:id {layoutFileIds}` responde 200 e não grava (o zod descarta) | **apagar**: o orçamento não escolhe arte; a arte do documento é a aprovada de cada implemento (`api: utils/quote-artwork.ts:81`) |
| D7 | `components/financial/budget/steps/budget-step-info.tsx:36,71,349,569` (`ApprovedLayoutPicker`) + `components/financial/budget/vehicles/budget-vehicle-layouts-field.tsx` (181 linhas) | seletor "Layout Aprovado" e "por veículo" | CALADO (D6) | remover; no lugar, **leitura** da arte de cada veículo com o estado (§4) |
| D8 | `components/financial/budget/steps/budget-step-task.tsx:738-799` (acordeão "Layout Referência", ADMIN) com `fileContext="tasksLayouts"` (`:774`) e `onLayoutStatusChange` | sobe arquivo no contexto morto e grava `layoutIds/layoutStatuses` na tarefa | **400** ao salvar (corpo `.strict()`); o upload no contexto `tasksLayouts` não existe no contrato (`fileContexts` só tem `implementLayouts`) | trocar por `ImplementArtPanel` (§2.3): upload `POST /implements/:id/layouts`, enviar, decidir em nome, nova versão |
| D9 | `components/financial/budget/steps/budget-step-review.tsx:122,147,1250-1271` (bloco "Layout" do Resumo, até 2 imagens) | lê `layoutFiles` | ERRADO/vazio | "Arte de cada implemento + estado" (leitura); o documento leva exatamente isso |
| D10 | `components/financial/budget/signature-send-dialog.tsx:296` (regex `/layout/i` no texto do bloqueio) + `signature-envelope-card.tsx` `onResolveLayout` + `[taskId].tsx:1099-1120` (`goToLayoutStep`) | atalho "Escolher o layout aprovado" | ERRADO: leva a um seletor que não grava | ler `preflight.gates` (E1–E6) e mostrar uma linha por impedimento com a ação dela; "Arte pendente" leva ao **veículo** sem arte |
| D11 | `signature-envelope-card.tsx` ("Enviar para assinatura" só por `canManage`) | botão sempre ativo | o bloqueio só aparece **dentro** do modal | desabilitar com o motivo vindo de `GET /budgets/:id → emission {ready, blockers}` |
| D12 | `components/financial/budget/budget-request-card.tsx:181-224`, `types/budget-request.ts:38-40,98-102` | selo "Pré-aprovado por…" lido de `request.preApprovedAt` | ERRADO por nome: desde o P14 significa "aprovou o valor"; a fonte da verdade é `budget.valueApproval` (inclusive `ON_BEHALF`, que não passa pela requisição) | cartão **"Aprovação do valor"** lido de `valueApproval` (quem, quando, origem, total, nota, revogar) |
| D13 | `[taskId].tsx` inteiro | não lê `emission`, `valueApproval`, `billable`, `signatureStatus` (nenhuma ocorrência no web) | o comercial não vê os eixos | faixa de estado com os 4 eixos (§4) |

### 1.3 Financeiro › Orçamento (criação) — `/financeiro/orcamento/cadastrar`

`pages/financial/budget/create.tsx` (1.144 linhas).

| # | Onde | Sintoma | Conserto |
|---|---|---|---|
| C1 | `:115-129, 605-612, 832-833` (`layoutIds`/`layoutStatuses` no `POST /tasks/batch-with-quote`) | **400** quando o usuário sobe um layout no passo 1 | a criação não sobe arte (a arte é do implemento e entra depois, com a máquina) ou sobe pela rota do implemento **depois** de criado |
| C2 | `:91, 232, 352-424, 720, 886` (`layoutFiles`, `layoutImageOptions`, `layoutFileIds`) | CALADO | apagar |
| C3 | `:880` (`status: "PENDING"` no corpo) — idem `dashboard/widgets/quick-budget.tsx:191`, `components/production/task/modals/task-duplicate-modal.tsx:285`, `components/production/task/form/task-create-form.tsx:608` | aceito hoje, mas a D-34 diz que o servidor decide o nascimento | não mandar `status` |

### 1.4 Financeiro › Faturamento (detalhe) — `/financeiro/faturamento/detalhes/:id`

`pages/financial/billing/details/[id].tsx` (2.130 linhas).

| # | Onde | Sintoma | Conserto |
|---|---|---|---|
| F1 | `:297` (`layouts: {include:{file}}` na tarefa) e `:308` (`layoutFiles: true` no orçamento) | CALADO: o seletor "Layout Aprovado" não tem opções; a prévia não tem imagem | tirar os dois; a arte vem de `quote.artwork`/implemento |
| F2 | `:614, 806, 1405-1425, 1506, 1516` (`layoutFileIds` no corpo) + `components/financial/billing/steps/billing-step-budget-info.tsx:36,50,125,259` | CALADO (descartado) | remover o 2º consumidor do `ApprovedLayoutPicker` (`components/financial/common/approved-layout-picker.tsx` fica sem uso: apagar) |
| F3 | aprovar a cobrança (`billingService.approve` → `PUT /billings/:id/approve`) | **400** "A cobrança só pode ser aprovada depois da assinatura do orçamento" (DD7) — a tela não avisa antes | selo "Assinatura: …" no cabeçalho; "Aprovar" **desabilitado** com o motivo quando `signatureStatus ∉ {SIGNED, SIGNED_OFFLINE, WAIVED}` (`budget.billable`) |
| F4 | lista de faturamento, `components/financial/billing/table/billing-table-filters.tsx:85-90` (padrão `[APPROVED]`) | ERRADO por significado: agora `APPROVED` = valor aprovado, **antes** de assinar; a fila mostra cobranças que não podem ser aprovadas | manter o padrão + coluna/selo da assinatura + filtro `signatureStatuses` (a API já aceita) |

### 1.5 Produção › Tarefa (detalhe, edição, criação, lote, cópia)

| # | Onde | Sintoma | Conserto |
|---|---|---|---|
| T1 | `components/production/task/detail/task-detail-page.tsx:211` (`layouts` no include) e `:226` (`budgets.include.layoutFiles`) | CALADO: `LayoutsSection` (`sections/layouts-section.tsx`, 126 linhas) mostra "nenhum layout"; `downloadAllLayouts` baixa nada | seção "Arte do implemento" lendo `implement.layouts` (ou `GET /implements/:id/layouts`), com estado e versão |
| T2 | `components/production/task/detail/task-detail-page.tsx:1113-1151` (status do orçamento editável inline) | idem D1/D2: aprovar dá 400; oferece `PRE_APPROVED → PENDING` | só arestas manuais; `→ APPROVED` pede nota; eixo da assinatura ao lado, só leitura |
| T3 | `components/production/task/form/task-edit-form.tsx:207` (include) e `:222-300` (estado `uploadedFiles/layoutStatuses` + `layoutIds` no corpo) e `:4104` (`fileContext="tasksLayouts"`) | CALADO na carga; **400** ao salvar com layout mexido | o acordeão de layout sai do formulário da tarefa; vira o `ImplementArtPanel` |
| T4 | `components/production/task/form/task-create-form.tsx:287-290, 381-399, 500-501, 1146-1180` | **400** ao criar com layout | idem C1 |
| T5 | `components/production/task/bulk-operations/AdvancedBulkActionsHandler.tsx:220` + ação `bulkArts` (`schedule/task-schedule-table.tsx:75,272,404-410`; `schedule/task-table-context-menu.tsx:162`; `dashboard/widgets/task-table.tsx:1953`) | a rota `POST /tasks/bulk/arts` **não existe mais** → 404 | "Arte em lote" = `POST /implements/layouts/bulk {implementIds, fileId}` |
| T6 | `components/production/task/schedule/set-quote-layout-modal.tsx` (inteiro) + aberturas em `schedule/task-schedule-table-page.tsx:276,869`, `history/table/task-history-table-page.tsx:218,737`, `preparation/task-prep-page.tsx:554,1118` | lê `quote.layoutFiles`, sobe em `quote-layouts`, grava `layoutFileIds`: CALADO | **apagar** o modal e a ação "Definir layout do orçamento" |
| T7 | "Copiar de outra tarefa": `schedule/task-schedule-table-page.tsx:476`, `schedule/task-schedule-content.tsx:200`, `preparation/task-prep-page.tsx:358`, `history/task-history-list.tsx:446`, `history/table/task-history-table-page.tsx:403` | CALADO: a fonte vem sem arte; se a cópia mandar `layoutIds`, **400** | decidir se "copiar arte" ainda existe; se sim, é `bulk` no implemento destino (cria `DRAFT`, que precisa de aprovação) |
| T8 | `pages/production/schedule/edit/[id].tsx:111,131` | CALADO | idem T3 |
| T9 | `components/production/task/modals/task-duplicate-modal.tsx:34,42` | CALADO | idem |
| T10 | `components/common/file/file-suggestions.tsx:21` (`fileContext: "tasksLayouts"`), `schemas/file.ts:14,206,453-516`, `schemas/task.ts:119`, `schemas/observation.ts:20`, `schemas/airbrushing.ts:65,90,115`, `types/file.ts:30,55` | sugestão de arquivo com relação `tasksLayouts`: o where vira **400** quando usado | `implementLayouts` (o contexto do contrato) |
| T11 | `utils/quote-layout-coverage.ts` (inteiro), `types/budget.ts:164,187` (`QuoteLayoutFile`, `layoutFiles`) | código morto que ainda decide o que aparece | apagar |

### 1.6 Painel (dashboard)

| # | Onde | Sintoma | Conserto |
|---|---|---|---|
| P1 | `dashboard/widgets/task-table.tsx:1566-1567` (`where.layouts.some/none` pelo filtro `hasLayouts`) | **400** com o filtro em "sim" ou "não" | `hasArt: true/false` (já existe em `schemas/task.ts:517-522`, que traduz para `implement.layouts.some{APPROVED}`) e três estados de verdade: "Arte aprovada / pendente / sem arte" |
| P2 | `dashboard/widgets/task-table.tsx:1663, 2104` (include `layouts`) e `:601-614` (contador "N layouts") | CALADO: contador sempre 0 | `implement.layouts` com contagem por estado |
| P3 | `dashboard/presets.ts:887` ("Orçamentos Esperando Aprovação" = `["PENDING"]`) | ERRADO por significado | `["PENDING","IN_NEGOTIATION"]` = "Valor por aprovar" + preset "Prontos para emitir" |
| P4 | `lib/attention/rules.ts:77,94` (`SIGNED: true`, `PRE_APPROVED: false` num `Record` total) | compila só enquanto o enum do web tiver 8 valores | sai com o enum; acrescentar o gêmeo de `budget.ready-to-emit` (`api: attention.service.ts:589`) |
| P5 | `constants/enum-labels.ts` `isBudgetBillingPhase` (`status === APPROVED`) e 6 usos (`utils/task.ts:22-42`, menus da agenda, histórico, preparação, detalhe) | ERRADO por significado: um orçamento com **valor aprovado e sem assinatura** abre direto o **Faturamento**, onde "Aprovar" vai dar 400 (F3) | `isBudgetBillingPhase = status === APPROVED && billable` (ou abrir o orçamento enquanto `!billable`) |

### 1.7 Portal do Responsável (web) — `/cliente/*`

`api-client/portal.ts` (2.068 linhas) e `components/cliente/**` (12.435 linhas no total).

| # | Onde | Sintoma | Conserto |
|---|---|---|---|
| R1 | `api-client/portal.ts:419-436` (`PortalVehicleIdentity` com `category`, `implementType`, `measures{left,right,back}`) × API `portal-projection.service.ts:529-549` (`identity` sem esses campos; bloco **`implement`** `{id, type, category, measures{left,right,back,front}, rearDoor, projectFiles}`) | **ERRADO**: veículo sem categoria, sem tipo e sem medidas no card de identidade e na lista (`veiculo-identidade-card.tsx`, `veiculo-medidas-card.tsx`, `orcamento-veiculos-card.tsx`) | tipo `PortalVehicleImplement`; ler de `vehicle.implement` |
| R2 | `api-client/portal.ts:479-484` (`PortalVehicleLayout.artworks: PortalFile[]`, "só os aprovados") × API `artworks?: PortalArtworkView[]` (`:568`) com estado | a tela do veículo **não mostra arte nenhuma**, nem a que espera o cliente | card "Arte" por veículo com Aprovar / Reprovar (motivo ≥3) + lote "Aprovar para os N veículos" (`PUT /cliente/me/artes/aprovar`) |
| R3 | `utils/portal-capabilities.ts` (5 capacidades) | sem `APPROVE_ARTWORK` | espelhar a API (DD5: Compras **não**; a Furgões pagadora pode) |
| R4 | `api-client/portal.ts:288` (`PortalBudgetStatus = TASK_QUOTE_STATUS`, com `PRE_APPROVED`), `components/cliente/orcamento/waiting-on.ts:52`, `pre-aprovacao-actions.tsx` (281 linhas), `orcamento-proposta-card.tsx:256-279`, `pages/cliente/orcamentos/[id].tsx:108,292,335` | ERRADO: "Pré-aprovado"; "de quem é a vez" só pelo estado do valor | `valueApproval`, `signatureStatus`, `emission` (a API devolve `emission` em língua de cliente: `portal-emission.ts`); "Esperando" derivado dos **três eixos**; faixa "Para emitir o documento falta…" |
| R5 | assinatura por sessão (`components/cliente/assinatura-card.tsx`, `api-client/portal.ts` `POST …/assinaturas/:signerId/assinar`) | o web **não manda `orderNumbers[]`**; a DD12 exige o nº do pedido de cada veículo de quem tem Compras → **400** para esse signatário | campo "Nº do pedido" por veículo no diálogo de assinar quando o signatário tem Compras |
| R6 | requisição (`components/cliente/solicitacao/solicitacao-schema.ts`, `step-veiculos.tsx`, `step-revisao.tsx`) | sem frente e sem porta traseira; tipo `category/implementType` | `IMPLEMENT_FACES` (4, do contrato `faces.todas`), `portaTraseira` (folhas/varões/portinholas), anexar o projeto do furgão; `frente` dentro de `medidasIntocadas` |
| R7 | `pages/cliente/painel.tsx` (conflita com a `main`, ver relatório 02) | grupos por estado velho | "Valores para aprovar", **"Artes para aprovar"**, "Documentos para assinar" |
| R8 | `pages/cliente/veiculos/[taskId].tsx` | sem projeto do implemento | card "Projeto do implemento" (PDFs + envio por quem pode) |

### 1.8 Páginas públicas e enums de base

| # | Onde | Sintoma | Conserto |
|---|---|---|---|
| U1 | `pages/public/budget/[id].tsx:123-133, 393-405` e `pages/public/service-report/[id].tsx:93-160` (`quote.layoutFiles`) | ERRADO: bloco "Layout" vazio; a regra "folha própria de assinaturas" conta 0 imagens | ler `quote.artwork` (a rota pública já devolve: `api: budget.service.ts:6226-6244`), com legenda por veículo |
| U2 | `constants/enums.ts:674-678` (`LAYOUT_STATUS` com 3 valores) | faltam `PENDING_APPROVAL` e `SUPERSEDED` | gerar do contrato (`LAYOUT_STATUS`) |
| U3 | `constants/enums.ts:2797-2801` (`MEASURE_SIDE` sem `FRONT`) e `types/paintingAnalysis.ts` à parte | a frente não aparece em `ImplementMeasuresSection` nem nos formulários de medida | `IMPLEMENT_FACES` (4) do contrato `faces` |
| U4 | não existe `BUDGET_SIGNATURE_STATUS`, `BUDGET_VALUE_APPROVAL_SOURCE`, `LAYOUT_APPROVAL_SOURCE`, `REAR_DOOR_LEAVES` no web | — | gerar (estão em `generated/contracts/enums.json`) |
| U5 | `generated/contracts/*.json` só é lido por `constants/document-labels.ts` | o web tem o contrato e **não usa** | P20: enums, rótulos, ordem e transições passam a vir dele (a régua G5/G26/G31 da API já confere o lado dela) |

---

## 2. O que falta construir (não existe no web)

### 2.1 Atos do valor (orçamento) — §2.1 do relatório 01

| Ato | Rota | Componente novo | Regra de tela |
|---|---|---|---|
| Enviar para aprovação do cliente | `PUT /budgets/:id/send-to-customer` | botão primário em `REQUESTED`/`PENDING` | desabilitado sem item com valor > 0; diz "o contato X passa a ver os valores (e-mail)" |
| Retirar do cliente | `PUT …/withdraw-from-customer` | ação secundária em `IN_NEGOTIATION` | sem motivo |
| Aprovar valor em nome do cliente | `PUT …/value-approval {note}` | diálogo com **nota obrigatória** | ADMIN e COMMERCIAL |
| Reprovar valor | `DELETE …/value-approval {reason}` | diálogo com motivo | avisa que a coleta viva cai |
| Assinado fora do sistema | `POST …/offline-signature` (multipart `offlineSignatureFile`, `note`, `signedAt?`) | diálogo com anexo + nota | só com E1 (valor aprovado) e E3 (sem envelope vivo); selo **diferente** de "Assinada" |
| Cartão "Aprovação do valor" | lê `GET /budgets/:id → valueApproval` | quem, quando, origem (`PORTAL`/`ON_BEHALF`/`SIGNATURE`/`LEGACY_APP`/`MIGRATED`), total, nota | substitui o selo "Pré-aprovado" do cartão da requisição |

### 2.2 Checklist "Para emitir falta…"

`GET /budgets/:id → emission {ready, blockers}` com os códigos E1–E6 (`api: utils/emission-gate.ts:28-44`). Cada
linha tem uma ação:

- **E1** valor não aprovado → atos do §2.1.
- **E2** arte pendente → leva ao **veículo** sem arte.
- **E3** envelope vivo → leva ao cartão da assinatura.
- **E4** dois pagadores → passo de cobrança.
- **E5** validade vencida → diálogo de prorrogação (que a `main` trouxe, ver relatório 02).
- **E6** sem contato → seção Responsáveis.

O botão "Enviar para assinatura" fica desabilitado até `ready`. O E7 (recortes) continua só dentro do
`createEnvelope` (ver relatório 01, §6.4).

### 2.3 Arte do implemento (`ImplementArtPanel`) — um componente, três telas

Telas: detalhe da tarefa, passo Tarefa do orçamento e (só leitura) o faturamento.

| Ação | Rota | Papel |
|---|---|---|
| Listar versões | `GET /implements/:id/layouts` | leitores do implemento; fora de COMMERCIAL/DESIGNER/LOGISTIC/PRODUCTION_MANAGER/ADMIN só aparece a APROVADA |
| Subir (cria `DRAFT`) | `POST /implements/:id/layouts` (multipart) | DESIGNER, COMMERCIAL, ADMIN |
| Enviar ao cliente | `POST …/:layoutId/send` | idem; avisa contatos com `APPROVE_ARTWORK` + lembrete 24 h |
| Aprovar em nome do cliente | `POST …/:layoutId/approve-on-behalf {note}` | COMMERCIAL, ADMIN, nota obrigatória |
| Reprovar | `POST …/:layoutId/reprove {note}` | COMMERCIAL, ADMIN |
| Nova versão | `POST …/:layoutId/new-version` (1 imagem) | EDIT |
| Apagar | `DELETE …/:layoutId` | só `DRAFT` |
| Lote (mesma arte em N implementos) | `POST /implements/layouts/bulk {implementIds, fileId}` | EDIT — substitui o `bulkArts` |

Estados na tela (`LAYOUT_STATUS` × rótulo do contrato): Rascunho · Aguardando cliente · Aprovada · Reprovada ·
Substituída. Mais a trilha `LayoutDecision`. **Não existe** "dispensar arte" (DD9).

Junto vem o **projeto do implemento** (`PUT /implements/:id/project-files`, contexto `implementProjectFiles`),
**separado** do "projeto da tarefa" (`Task.projectFiles`, o PDF de cotas). Hoje o web chama os dois de "Projeto".

### 2.4 Selo da assinatura e faturamento

- Selo `signatureStatus` (9 rótulos do contrato) no orçamento, na lista de orçamentos, no faturamento e na lista
  de faturamento.
- "Aprovar cobrança" desabilitado com o motivo (F3).

### 2.5 Atenção

Gêmeo do web para `budget.ready-to-emit` ("valor e arte aprovados, falta emitir") em `lib/attention/rules.ts`.

### 2.6 Portal (P23)

R1–R8 do §1.7, mais:
- `orderNumber` por veículo na leitura;
- `emission` em língua de cliente;
- `APPROVE_ARTWORK`;
- o hook `usePortalApproveArtworks`.

---

## 3. Mapa atual do detalhe e do formulário do orçamento

### 3.1 Arquivos e tamanhos

| Arquivo | Linhas | Papel |
|---|---:|---|
| `pages/financial/budget/details/[taskId].tsx` | **2.804** | página-orquestradora: ~30 `useState`, carga, reconciliação de layout, montagem do corpo, salvar em 2–N chamadas, passos |
| `components/financial/budget/steps/budget-step-review.tsx` | 1.390 | Resumo + combobox de status + "Rejeitar" + bloco Layout |
| `components/financial/budget/signature-envelope-card.tsx` | 1.266 | Assinatura eletrônica (envelopes, reenviar, cancelar) |
| `pages/financial/budget/create.tsx` | 1.144 | criação (mesmos passos, outro orquestrador) |
| `components/financial/budget/steps/budget-step-services.tsx` | 835 | Serviços e preços |
| `components/financial/budget/steps/budget-step-task.tsx` | 832 | passo 1 (acordeões) |
| `components/financial/budget/steps/budget-step-customer-payment.tsx` | 740 | um passo por pagador |
| `components/financial/budget/signature-send-dialog.tsx` | 720 | modal de emissão (preflight por string + regex) |
| `components/financial/budget/steps/budget-step-info.tsx` | 579 | "Faturar Para" + layout aprovado + prazos |
| `components/financial/budget/budget-request-card.tsx` | 327 | a requisição do portal (acima dos passos) |
| `components/financial/budget/budget-state-actions.tsx` | 253 | ações de estado (só no último passo) |
| `components/financial/budget/vehicles/*` | 377 | abas de veículo, seletor de layout por veículo, include |

### 3.2 Estrutura de hoje (edição)

Passos: `[taskId].tsx:1131-1156`; render: `:2602-2797`.

```
[Cabeçalho: breadcrumb · Anterior/Próximo · Salvar]
[FormSteps]  1 Tarefa|Veículos · 2 Informações · 3 Serviços · 4..N Cliente k · N+1 Resumo
[BudgetRequestCard]  ← fora dos passos; variante por passo (requestVariant)
Passo 1  BudgetStepTask (acordeão de UM item aberto por vez; abre em "Informações Básicas")
         ├─ Informações Básicas  : Logomarca (TaskNameAutocomplete :226) · Razão Social (CustomerSelector :229, o DONO
         │                         do veículo) · Categoria · Tipo · Medidas (leitura) · [bloco "Deste veículo":
         │                         Série · Placa · Nº do Pedido · Chassi · Plaqueta (foto) ] · Previsão · Prazo
         │                         (só PM/ADMIN) · Detalhes
         ├─ Responsáveis          (ADMIN/COMMERCIAL)  — "comum a todos os veículos"
         ├─ Tintas                (ADMIN/COMMERCIAL)  — por veículo
         ├─ Arquivos Base         — comum
         ├─ Layout Referência     (ADMIN) — por veículo   ← contexto morto (D8)
         └─ Aerografias           — por veículo
         + abas de veículo (BudgetVehicleTabs) quando N ≥ 2
Passo 2  BudgetStepInfo: Faturar Para (escolha dos pagadores, com logo) · Layout Aprovado (picker/por veículo) ·
         Prazos e Configurações (Validade · Garantia · Prazo de entrega · Tarefas simultâneas · Texto de garantia)
Passo 3  BudgetStepServices: Serviços e preços (por veículo; desconto)
Passo 4+ BudgetStepCustomerPayment ×N: dados fiscais do pagador (CNPJ/CPF, razão social sobrescrita pela
         BrasilAPI) · condição de pagamento · vencimentos · divisão em lotes
Último   BudgetStateActions · BudgetStepReview (cliente/logomarca/veículos/serviços/LAYOUT/combobox de status/
         Rejeitar) · SignatureEnvelopeCard
```

A criação (`create.tsx:428-446`) repete os passos 1–3 + Clientes + Resumo, com outro orquestrador.

### 3.3 Problemas de organização (medidos)

1. **"Razão Social" significa duas coisas.** No passo 1 é o **dono do veículo** (`Task.customer`, rótulo padrão do
   `CustomerSelector`). No passo 2 é **quem paga** ("Faturar Para"). No passo 4+ a razão social do pagador é
   **editada de novo** e pode ser sobrescrita pela BrasilAPI (`budget-step-customer-payment.tsx:264-275`). A mesma
   palavra aparece em três lugares com três sentidos.
2. **A arte tem três lugares, e nenhum deles vale no modelo novo:** passo 1 "Layout Referência", passo 2 "Layout
   Aprovado" e Resumo "Layout". São cerca de 600 linhas de estado e reconciliação em `[taskId].tsx`, mais 181 em
   `budget-vehicle-layouts-field.tsx` e o `approved-layout-picker.tsx`.
3. **O acordeão de um item só esconde metade do passo 1.** Responsáveis, Arquivos Base, Arte e Aerografias ficam
   fechados atrás de "Informações Básicas", e o `pb-64` (`budget-step-task.tsx:195`) existe para compensar a
   rolagem do acordeão.
4. **"Comum" e "deste veículo" se intercalam no mesmo acordeão.** O bloco "Deste veículo" (`:334`) fica no meio de
   "Informações Básicas". Responsáveis e Arquivos Base são comuns; Tintas, Layout e Aerografias são por veículo,
   mas as abas de veículo moram só no passo 1.
5. **As decisões moram no último passo.** Ações de estado, combobox de status, "Rejeitar" e assinatura só aparecem
   depois de "Próximo" ×(3+N). Quem abre um orçamento `IN_NEGOTIATION` para "retirar do cliente" percorre o
   assistente inteiro.
6. **Os passos 2 e 4+ falam da mesma coisa, que é a cobrança.** "Faturar Para" escolhe os pagadores e o passo de
   cada pagador configura a cobrança dele. Os prazos (validade, garantia, entrega) estão no mesmo passo que
   "Faturar Para", sem relação.
7. **Status como formulário.** O estado é um campo do form (`form.setValue("status")`, `:1094`) aplicado no Salvar
   por uma caminhada de N `PUT …/status` (`:2163`). Isso é o oposto do Modelo C, em que cada ato é uma chamada com
   regra própria.
8. **Uma página de 2.804 linhas com 2 orquestradores** (`[taskId].tsx` e `create.tsx`). Toda mudança de campo
   precisa ser feita duas vezes.

### 3.4 Sobreposição com a tarefa e o faturamento

- **Detalhe da tarefa** (`components/production/task/detail/task-detail-page.tsx`, 1.716 linhas; seções em `sections/`):
  - já tem `ResponsiblesSection`, `ImplementMeasuresSection`, `LayoutsSection` (morta, T1), `FilesSection`
    (base + projeto), `AirbrushingsSection` e `PaintsSection`;
  - o `quote-billing-section.tsx` (1.102 linhas) embute o orçamento e tem o seu próprio bloco "Layout Aprovados";
  - Responsáveis, arquivos base, arte e aerografias aparecem tanto aqui quanto no passo 1 do orçamento, com
    componentes diferentes.
- **Detalhe do faturamento** (`pages/financial/billing/details/[id].tsx`, 2.130 linhas): passos "Veículos" →
  "Fatura k / Cliente k" → "Resumo".
  - O passo "Veículos" reedita placa/chassi/tipo de cada implemento (`billing-covered-vehicles.tsx`), a terceira
    tela que edita identidade do implemento.
  - O passo opcional de info do orçamento reusa o `ApprovedLayoutPicker` (F2).

---

## 4. Proposta de arquitetura de informação do orçamento

O pedido do dono: "na primeira página, Tarefa: logomarca, Razão Social, detalhes; aí responsáveis, arquivos base,
layout, aerografias". A primeira página já tem esse **conteúdo**, mas escondido em acordeão e misturado com os
campos por veículo. O que muda é a **forma**, e o que sai é tudo o que o Modelo C aposentou.

Princípios que valem para as duas alternativas:

- **P1. Os quatro eixos sempre visíveis.** Uma faixa fixa abaixo do cabeçalho mostra Valor · Arte (k de N veículos)
  · Assinatura · Cobrança, cada um com o estado e **a próxima ação**. Ela também diz "Para emitir falta…" com
  `emission.blockers`.
- **P2. Ato ≠ formulário.** Enviar ao cliente, aprovar ou reprovar o valor, assinatura fora do sistema e decisões
  de arte são **botões que chamam a rota na hora**, com diálogo próprio. O Salvar grava só **dados**.
- **P3. Comum × por veículo.** O que é do orçamento ou da tarefa comum aparece uma vez. O que é do veículo fica numa
  **lista de veículos** (cartão por implemento) e não em abas escondidas num acordeão.
- **P4. A arte é do implemento.** O orçamento **mostra** a arte de cada veículo com o estado. Agir sobre ela
  (subir, enviar, decidir em nome) usa o mesmo `ImplementArtPanel` do detalhe da tarefa.
- **P5. "Razão Social" com dono claro.** Na Tarefa, "Cliente (dono do veículo) — Razão Social". Na Cobrança,
  "Faturar para".

### Alternativa A — "Ficha do orçamento" com abas livres (RECOMENDADA)

O detalhe deixa de ser assistente. Vira **ficha com abas navegáveis em qualquer ordem**, porque os eixos são
independentes: a arte pode vir antes do valor (relatório 01, §3). Abas:

1. **Tarefa** — identificação, veículos, responsáveis, arquivos base, projeto da tarefa, arte (estado por veículo),
   aerografias e tintas.
2. **Valor** — serviços e preço por veículo, desconto, validade, garantia, prazo de entrega e tarefas simultâneas.
   O cartão "Aprovação do valor" fica aqui.
3. **Cobrança** — "Faturar para" + um bloco por pagador ou lote (o atual passo 4+).
4. **Documento & Assinatura** — prévia do documento, checklist de emissão, Assinatura eletrônica e "Assinado fora
   do sistema".
5. **Histórico** — trilha do orçamento: valor, arte, assinatura e changelog.

A **criação** continua assistente, com Tarefa → Valor → Cobrança → Revisar. As abas são as mesmas seções, então os
componentes são compartilhados e o segundo orquestrador some.

Wireframe da primeira aba (orçamento de 3 veículos vindo do portal):

```
┌ Orçamento nº 1042 · Furgões Carlotti ─────────────────────────────── [Histórico] [Salvar] ┐
│ VALOR: Aguardando aprovação do cliente  [Retirar do cliente] [Aprovar em nome do cliente]  │
│ ARTE: 1 de 3 aprovadas  [ver]      ASSINATURA: Não emitida      COBRANÇA: plano (2 lotes)   │
│ Para emitir falta: aprovar o valor · aprovar a arte de 2 veículos                          │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ Tarefa ]  Valor   Cobrança   Documento & Assinatura   Histórico                          │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▸ Requisição do portal: pedida por Ana (Comercial) em 28/09 · briefing · logomarca "Carlotti"│
│                                                                                            │
│ IDENTIFICAÇÃO                                                                              │
│  [logo]  Logomarca  [ Carlotti Transportes        ]                                        │
│          Cliente (dono do veículo) — Razão Social  [ CARLOTTI TRANSPORTES LTDA  ▾ ]        │
│          Detalhes  [ texto livre .................................................. ]      │
│                                                                                            │
│ VEÍCULOS (3)                                           [+ veículo]  [Repetir nos demais ▾] │
│  ┌ 39088 · ABC1D23 ─ Baú isotérmico · 8,50 m ─ Arte: ✔ Aprovada (v2) ── Pedido: 4471 ─ ▾ ┐ │
│  ├ 39089 · ABC1D24 ─ Baú isotérmico · 8,50 m ─ Arte: ⏳ Aguardando cliente ──────────── ▸ ┤ │
│  └ 39090 · —       ─ Baú isotérmico · 8,50 m ─ Arte: ✖ sem arte  [Subir arte] ───────── ▸ ┘ │
│    (aberto: Série · Placa · Chassi · Plaqueta · Nº do pedido · Previsão · Prazo ·          │
│     Medidas 4 faces + porta traseira (leitura, Logística) · Tinta · ImplementArtPanel)     │
│                                                                                            │
│ RESPONSÁVEIS (comum)          ARQUIVOS BASE (comum)          PROJETO DA TAREFA (PDF cotas) │
│  Ana · Comercial · ✉ ☎        3 arquivos  [+]                 1 PDF  [+]                    │
│  João · Compras  · ✉          ...                                                          │
│                                                                                            │
│ AEROGRAFIAS (por veículo: 39088 ▾)                                                         │
│  Aerografia "Águia" · cotação aprovada · R$ —                                              │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Custo:** grande. Quebra `[taskId].tsx` em hooks por aba (`useBudgetForm`, `useBudgetVehicles`,
  `useBudgetActs`) e seções. Funde `create.tsx` ao mesmo conjunto de seções. Remove cerca de 1.000 linhas de
  layout morto. Estimativa: 5–7 dias de trabalho focado, mais a conferência visual na bancada.
- **Ganho:**
  - cada eixo tem lugar e ação a um clique;
  - "Razão Social" ganha dono;
  - a arte fica junto do veículo;
  - acaba o "Próximo ×6 para chegar na assinatura".
- **Risco:** o comercial está acostumado ao assistente. Mitigação: na criação, o assistente continua; no detalhe,
  a primeira aba é a mesma do passo 1 de hoje, só que aberta.

### Alternativa B — assistente reordenado (menor)

Mantém `FormSteps`, mas com ordem e conteúdo novos:

1. **Tarefa** — o mesmo conteúdo da aba A1, com as seções **abertas** (sem acordeão de item único) e a lista de
   veículos em cartões.
2. **Arte** — um painel por veículo, com o estado.
3. **Valor** — serviços + prazos.
4. **Cobrança** — "Faturar para" + pagadores.
5. **Revisão & Emissão** — checklist + assinatura.

A faixa dos 4 eixos (P1) fica no topo de todos os passos, com os atos.

- **Custo:** médio. Mantém o orquestrador e reorganiza os passos. Remove o layout morto, que é obrigatório nas duas
  alternativas. Estimativa: 3–4 dias.
- **Perde:**
  - continua sendo "assistente" para um documento que vive semanas;
  - os dois orquestradores (`create.tsx` e `[taskId].tsx`) ficam;
  - quem só quer "Retirar do cliente" usa a faixa do topo (o que resolve o pior caso), mas o resto da navegação
    continua linear.

**Recomendação: A.** Os quatro eixos são independentes e o orçamento é revisitado várias vezes (portal → precificar
→ enviar → arte → emitir → assinar → cobrar). Um assistente modela uma ida só. B é aceitável como passo
intermediário se o tempo apertar, porque o conteúdo das seções é o mesmo nas duas e a migração de B para A é só de
casca.

---

## 5. Ordem de execução sugerida (Fase C no web)

Tamanho: **P** ≤ meio dia · **M** 1–2 dias · **G** 3+ dias.

| # | Item | Destrava | Tam. |
|---|---|---|---|
| 1 | **Hotfix do enum**: tirar `PRE_APPROVED` de `enums.ts`, `types/budget.ts`, `schemas/budget.ts`, `sortOrders.ts`, `enum-labels.ts`, `quote-status-badge.tsx`, `quote-permissions.ts`, `budget-state-actions.tsx`, `budget-table-columns.tsx:492`, `lib/attention/rules.ts`, `waiting-on.ts`, portal; rótulos e ordem lidos do contrato | **a lista de orçamentos volta** (L1–L5) | P |
| 2 | **P20 base**: enums gerados (`BUDGET_SIGNATURE_STATUS`, `LAYOUT_STATUS` 5, `IMPLEMENT_FACES` 4, `REAR_DOOR_LEAVES`, fontes de aprovação); tipos do `Budget` (`signatureStatus`, `valueApproval`, `emission`, `billable`, `artwork`); `api-client` dos atos (§2.1) e do `implement` (layouts, project-files, bulk); transições do contrato | tudo o que vem depois | M |
| 3 | **Fechar os 400 da produção**: `where.layouts` do painel → `hasArt` (P1); `layoutIds/layoutStatuses` fora dos corpos de tarefa (T3, T4, C1); `bulkArts` → `/implements/layouts/bulk` (T5); contexto `tasksLayouts` → `implementLayouts` (T10) | criar/editar tarefa, painel e lote | M |
| 4 | **`ImplementArtPanel`** + seção "Arte do implemento" no detalhe da tarefa (T1) + projeto do implemento separado do projeto da tarefa | o designer e o comercial voltam a trabalhar arte | G |
| 5 | **Apagar o "layout do orçamento"**: `[taskId].tsx`, `create.tsx`, `budget-step-info.tsx`, `budget-vehicle-layouts-field.tsx`, `approved-layout-picker.tsx`, `set-quote-layout-modal.tsx`, `quote-layout-coverage.ts`, faturamento F1/F2, includes calados (T7–T9) | acaba o "salvou e não gravou" | M |
| 6 | **Atos do valor + cartão da aprovação + checklist de emissão + assinatura gated + "Assinado fora do sistema"** (D1–D4, D10–D13, §2.1–§2.2) | o fluxo do Modelo C ponta a ponta no interno | G |
| 7 | **Reorganização do detalhe/criação** (§4 A, ou B como passo intermediário) | o pedido do dono | G (A) / M (B) |
| 8 | **Faturamento**: selo + "Aprovar" travado com o motivo (F3); lista com selo e filtro (F4); `isBudgetBillingPhase` com `billable` (P5) | o financeiro não bate no 400 | P–M |
| 9 | **Listas e painel**: coluna Assinatura, filtro "Pronto para emitir", presets (L6, P3), gêmeo do `ready-to-emit` (P4) | visão de fila | P |
| 10 | **Portal P23** (R1–R8): identidade × implemento, arte por veículo + lote, `valueApproval`/`emission`/"Esperando" em 3 eixos, `orderNumbers` na assinatura, frente/porta na requisição, `APPROVE_ARTWORK`, painel | o cliente aprova arte e assina com pedido | G |
| 11 | **Públicas** (U1) por `quote.artwork` | o documento público mostra a arte certa | P |

Os itens 1–3 podem ir para a branch **antes** do merge da `main` sem conflito relevante: o único conflito do web
é `pages/cliente/painel.tsx`, que é do item 10. O item 7 depende de 2, 4, 5 e 6. Fazer 7 antes seria redesenhar
sobre o que vai ser apagado.

Itens 1–6 e 8 são a Fase C mínima para a release única (DD13). O 10 também é obrigatório para a release, porque o
portal da API já recusa os formatos velhos.
