# 05 — WEB: Orçamento, Faturamento, Assinatura, Páginas Públicas e Portal do Responsável

Recorte: `web/` na branch `feat/portal-do-responsavel` (HEAD `989c9f6e`), lido em 23/09/2026. Somente leitura, sem tsc/testes/banco.
Convenção: **FATO** = li no código (arquivo:linha). **INF.** = inferência minha. Caminhos relativos a `/home/kennedy/Documents/repositories/web` salvo quando indicado.

---

## 0. Resumo executivo

1. **O "layout aprovado do orçamento" (R1) atravessa 17 arquivos do recorte**, e a maior parte é *plumbing* que existe só para ele: estado `layoutFiles`, reconciliação com os layouts da tarefa, upload em `fileContext: "quote-layouts"`, `layoutFileIds` no corpo do `PUT /budgets/:id`, âncora `#layout-aprovado`, botão "Escolher o layout aprovado" no modal de assinatura, prévia no Resumo, bloco "Layout" nas duas páginas públicas. Tudo isso **sai**; o que fica é a **leitura histórica** (tipos `QuoteSection "LAYOUT"` e `QuoteChangeGroup "LAYOUT"`, rótulo de changelog `layoutFileIds`), porque envelopes e diffs antigos continuam sendo renderizados.
2. **O rename Truck→Implement (R3) no web é mais perigoso nas ESCRITAS do que nas leituras.** Há **4 lugares que escrevem `truck: {...}` dentro do `PUT /tasks/:id`** (budget detalhe, budget criação, grade de veículos do faturamento, e a branch da outra sessão). Como `taskUpdateSchema` **não é strict**, se a API renomear a chave para `implement` sem alias/recusa, essas telas respondem **200 e não gravam nada** — exatamente o defeito que `billing-covered-vehicles.tsx:75-88` já documenta ter acontecido uma vez.
3. **As leituras quebram em 500** em pelo menos 3 constantes de include do recorte que pedem `truck` ANINHADO (`billing/details/[id].tsx:326`, `budget-table-filters.tsx:60`, e `BUDGET_VEHICLE_TASK_INCLUDE` da outra branch) e 2 que pedem `layoutFiles` aninhado em `quote` (`billing/details/[id].tsx:307`, `set-quote-layout-modal.tsx:173`). É a mesma classe do incidente de 20/09 (`responsible: true`).
4. **O Portal já tem 70% do que R5/R7 pedem**, mas com três dívidas que o rework precisa pagar ANTES de crescer: (a) o tipo de escrita `PortalVehicleIdentityInput` **não declara `medidas`** e o card grava com `as never` (`veiculo-medidas-card.tsx:152`); (b) `ImplementMeasureForm` tem `'left' | 'right' | 'back'` literal em ~15 pontos — a face FRONTAL não cabe sem mexer nele; (c) o portal só mostra **artes APROVADAS** e diz que "layout em revisão é conversa interna" (`portal.ts:443-444`) — o contrário do que R2 pede (o responsável é quem aprova).
5. **A outra sessão (`feat/orcamento-veiculos`) conflita frontalmente com R1** na metade de layout (`layoutScope`, `quoteLayoutTasks`, `quote-layout-coverage.ts`, seletor por veículo) e é **reaproveitável** na metade "editar os N veículos na mesma tela" (`useBudgetVehicles`, `BudgetVehicleTabs`, divisão COMUM × POR VEÍCULO do passo 1). Os dois commits estão empilhados (`d6a48bec` → `56139571`), então não dá para pegar um sem resolver o outro.
6. Achei **3 arquivos mortos** no recorte que citam layout/truck e não têm consumidor: `utils/invoice-pdf-generator.ts`, `components/production/task/quote/budget-pdf-export-dialog.tsx`, `components/financial/billing/steps/billing-step-task.tsx`. **Apagar, não migrar.**

---

## 1. R1 — o orçamento perde o "layout aprovado"

### 1.1 Tela de detalhe do orçamento — `src/pages/financial/budget/details/[taskId].tsx` (2322 linhas)

| Linha(s) | O que faz hoje (FATO) | O que muda |
|---|---|---|
| 89-98 | `LAYOUT_STEP = 2`, `LAYOUT_PICKER_ANCHOR_ID = "layout-aprovado"` — endereço do seletor para o atalho do modal de assinatura | **Remover** as duas constantes |
| 147-162 | `useTaskDetail(taskId, { include: { truck: { include: { vinPlate: true } }, layouts: { include: { file: true } }, baseFiles, responsibles, generalPainting, customer } })` | `truck` → `implement` (com `vinPlate`); `layouts` → sai da tarefa e vira `implement.layouts` (arte) + `projectFiles` da tarefa (PDF de cotas, R6). **Ponto de 500** se a relação some antes do bundle novo (ver §7) |
| 192 | `const [layoutFiles, setLayoutFiles]` — a seleção do orçamento | **Remover** |
| 198-206 | `layouts`, `layoutsInitialized`, `layoutStatuses` — os layouts DA TAREFA editados no passo 1 | Viram "artes do implemento" (se a tela continuar editando arte — decisão D3) |
| 212-215 | refs `loadedLayoutIdsRef`, `loadedLayoutStatusesRef` (proteção "ausência = preservar", achado I40) | Seguem, renomeados para o implemento, se D3 = "orçamento edita arte" |
| 284-291 | defaults `category: ""`, `implementType: ""` (com o comentário I39: nunca default concreto) | `implementType` → `type` (R4). Manter a regra "vazio = não toca" |
| 307, 537, 577 | `layoutFileIds` nos defaults, no reset sem orçamento e no reset com orçamento (`existingQuote.layoutFiles.map(f => f.id)`) | **Remover** |
| 504-513 | `taskFields`: `plate/chassisNumber/vinPlateId/category/implementType` lidos de `task.truck` | `task.implement.*` |
| 666-685 | `toLayoutFile` + `setLayoutFiles(existingQuote.layoutFiles…)` | **Remover** |
| 788 | `loadedLayoutIdsRef.current = task.layouts.map(...)` | Implemento |
| 859-905 | efeito que **poda a seleção do orçamento** quando um layout da tarefa é removido/reprovado no passo 1 | **Remover inteiro** — é a sincronização orçamento↔tarefa do lado do cliente (irmã de `sync-quote-task-layouts.ts` na API) |
| 947-973 | `goToLayoutStep()` — rola até `#layout-aprovado` | **Remover** |
| 1174-1205 | upload dos layouts da tarefa (`fileContext: "tasksLayouts"`) e remapeamento de status | Vira upload de arte do implemento (`fileContext` novo, ver §5.4) |
| 1289-1360 | resolve `resolvedLayoutIds` (até 2), sobe arquivo novo com `fileContext: "quote-layouts"` (1317), dedup, toast "Um layout selecionado não pôde ser salvo" | **Remover inteiro** |
| 1418-1441 | `truckPayload` (plate/chassisNumber/category/implementType/vinPlateId) → `taskUpdateData.truck` | **ESCRITA CRÍTICA**: `truck` → `implement`. Ver §7.2 (chave errada some com 200) |
| 1443-1466 | `taskUpdateData.layoutIds/layoutStatuses` (Task.layouts) | Vira escrita no implemento (rota/chave nova) |
| 1640-1662 | `quoteData` (travado e destravado) inclui `layoutFileIds: resolvedLayoutIds` | **Remover** a chave dos dois ramos. ⚠️ No ramo travado a API recusa o CORPO INTEIRO por chave fora de `QUOTE_SAFE_AFTER_BILLING_FIELDS`; se a API tirar `layoutFileIds` da lista segura antes do web parar de mandar, **toda gravação de orçamento faturado dá 400** (só prorrogar validade inclusive) |
| 1688-1698, 1756 | `layoutChanged` e `dirty.layoutFileIds` no portão "algum campo do orçamento mudou?" | **Remover** os dois termos |
| 1949-1951 | `layoutFiles`, `layouts`, `layoutStatuses` nas deps do `handleSubmit` | Ajustar |
| 2034-2075 | `layoutImageOptions` — as opções do seletor (só imagem, só `APPROVED`) | **Remover** |
| 2205-2226 | `<BudgetStepTask layouts onLayoutsChange onLayoutStatusChange vinPlateFiles …>` | Ver §1.2 |
| 2228-2242 | `<BudgetStepInfo layoutFiles onLayoutFilesChange layouts={layoutImageOptions}>` | Tirar as 3 props |
| 2287-2294 | `<BudgetStepReview layoutFiles>` | Tirar a prop (ou trocar por "artes dos implementos", read-only — D4) |
| 2297-2310 | `<SignatureEnvelopeCard onResolveLayout={goToLayoutStep}>` | Tirar a prop |

### 1.2 Passos do assistente — `src/components/financial/budget/steps/`

| Arquivo:linha | Hoje (FATO) | Muda |
|---|---|---|
| `budget-step-info.tsx:17,36-37,65-66` | importa `ApprovedLayoutPicker`; props `layoutFiles/onLayoutFilesChange/layouts` | Remover |
| `budget-step-info.tsx:304-344` | `handleLayoutChange` (grava `layoutFileIds`, só UUID) e `handleUploadFiles` (upload "auto-aprovado" no passo 2) | Remover |
| `budget-step-info.tsx:548-567` | `<div id="layout-aprovado"><ApprovedLayoutPicker …/></div>` | Remover. O passo 2 fica só com prazos/clientes |
| `budget-step-task.tsx:19-22,191-250` | Selects "Categoria" (`TRUCK_CATEGORY`) e "Tipo de Implemento" (`IMPLEMENT_TYPE`), campos `category`/`implementType` | Rótulos "Categoria"/"Tipo"; enum/labels renomeados (R4). Ícone `IconTruck` é só ícone |
| `budget-step-task.tsx:59` | tipo local `truck?: { plate; chassisNumber }` dos veículos irmãos | `implement` |
| `budget-step-task.tsx:127-131,658-717` | acordeão ADMIN "Layout Referência" (`LayoutFileUploadField` + `FileSuggestions fileContext="tasksLayouts"`) com status DRAFT/APPROVED/REPROVED | **Dividir** (R6): "Projeto da tarefa (PDF de cotas)" — arquivo da TAREFA, sem status de aprovação do cliente — e "Arte do implemento" (imagem, com status que o portal decide). O comentário 128-130 ("comercial só escolhe o layout aprovado no passo 2") perde o objeto |
| `budget-step-task.tsx:387-400` | Plaqueta (`vinPlateFiles`) — foto do `Truck.vinPlate` | Campo do implemento; `fileContext: "truckVinPlate"` (detalhe:1222) — renomear só se a API renomear a pasta |
| `budget-step-task.tsx:812-866` | tabela de veículos irmãos lendo `vehicle.truck?.plate/chassisNumber` | `implement` |
| `budget-step-review.tsx:122,132,167` | prop `layoutFiles`, `useWatch("layoutFileIds")` | Remover |
| `budget-step-review.tsx:1126-1170` | bloco "Layout" do Resumo (miniaturas das até 2 artes) | Remover, ou trocar por "Arte de cada implemento + status" read-only (D4) |
| `budget-step-review.tsx:32,180,260,304-318,344,419,644-704` | categoria/implemento/placa/chassi/plaqueta de `t.truck` e do formulário | `implement`, `type` |
| `budget-step-services.tsx:73-85` + `hooks/production/use-budget.ts:84-90` | `useBudgetSuggestion({ name, customerId, category, implementType })` — sugestão de serviços por categoria+implemento | Renomear o parâmetro de query em lockstep com a API (a rota de sugestão lê pelo nome) |

### 1.3 Criação — `src/pages/financial/budget/create.tsx` (1131 linhas)

| Linha(s) | Hoje (FATO) | Muda |
|---|---|---|
| 90 | `layoutFiles` state | Remover |
| **168** | **`implementType: IMPLEMENT_TYPE.REFRIGERATED` como DEFAULT** | ⚠️ **Defeito vivo (FATO)**: com o default concreto, `hasTruckFields` (765) é sempre verdadeiro e **todo orçamento criado grava `REFRIGERATED` no caminhão**, escolhido ou não. É o I39 que a tela de detalhe corrigiu (comentário 285-288 de lá) e que sobreviveu aqui. Na migração de R4 isso significa que **"Refrigerado" no banco não é dado confiável** para orçamentos criados por esta tela. Corrigir no rework (default `""`) e avisar quem migrar o dado |
| 185-197 | O.S. padrão "Elaborar Layout", "Elaborar Projeto", "Preparar Arquivos para Plotagem" (tipo ARTWORK) | INF.: "Elaborar Projeto" é o PROJETO DA TAREFA de R6 (o PDF de cotas). Confirmar nome com o dono (D7) |
| 229, 874 | `layoutFileIds` no default e no corpo do `POST /budgets` | Remover |
| 349-421 | reconciliação seleção×layouts (irmã da do detalhe) | Remover |
| 618, 683-720 | contagem e upload `fileContext: "quote-layouts"` + dedup | Remover |
| 630-660 | upload dos layouts da tarefa (`tasksLayouts`) e base (`taskBaseFiles`) | Arte → implemento; PDF de cotas → `taskProjectFiles` |
| 764-775 | `buildTruckData` → `truck: { plate, category, implementType }` em cada tarefa criada | **ESCRITA CRÍTICA** (§7.2): `implement: { plate, category, type }` |
| 1072-1073, 1119 | props de layout para os passos | Remover |

### 1.4 Assinatura — gate, modal, card

| Arquivo:linha | Hoje (FATO) | Muda |
|---|---|---|
| `components/financial/budget/signature-send-dialog.tsx:81,98-107` | prop `onResolveLayout` ("o impedimento do layout é o único que se resolve na MESMA tela") | Remover |
| `…/signature-send-dialog.tsx:291-317` | casa `/layout/i` no texto do *blocker* do servidor e oferece "Escolher o layout aprovado" | Remover. ⚠️ O casamento é por regex no TEXTO: se a API mantiver QUALQUER blocker com a palavra "layout" (ex.: "arte do implemento não aprovada"), o botão reaparece apontando para lugar nenhum |
| `…/signature-send-dialog.tsx:342` | texto "o servidor recusa layout ausente, validade vencida, dois pagadores e coleta já emitida" | Tirar "layout ausente" |
| `…/signature-envelope-card.tsx:327,338-343,1225,1252` | repassa `onResolveLayout` ao modal (criar e reenviar) | Remover |
| `components/financial/budget/budget-request-card.tsx:36` | comentário "passo 2 — prazos, garantia, layout aprovado" | Atualizar texto |
| `api-client/signature.ts:34-42` | `QUOTE_SECTIONS` inclui `"LAYOUT"` (ordem canônica = chave de dedup do recorte na API) | **MANTER no tipo** (envelopes antigos têm `LAYOUT`). Ver D2 sobre oferecer ou não em envelope NOVO |
| `api-client/signature.ts:94,104` | rótulo "Layout" / descrição "As imagens do layout aprovado." | Manter para histórico; se D2 = "sai do documento novo", tirar de `TOGGLEABLE_SECTIONS`/`LOCAL_SECTION_CATALOG` (53-57, 116-124) — o catálogo do servidor tem precedência, o local é recuo e **precisa dizer o mesmo** |
| `components/signature/quote-change-list.tsx:70,96` | grupo `LAYOUT` na lista de mudanças (espelho de `quote-diff.ts`) | **MANTER** — diffs de snapshots antigos com `layoutFileIds` continuam aparecendo |
| `pages/public/signature/[token].tsx`, `pages/public/signature/verify.tsx`, `components/cliente/assinatura-documento.tsx` | desenham o **PDF congelado renderizado no servidor** (não montam arte no cliente) | Nada no web; a renderização de snapshot antigo é da API (`quote-html.builder`) |

### 1.5 Faturamento

| Arquivo:linha | Hoje (FATO) | Muda |
|---|---|---|
| `pages/financial/billing/details/[id].tsx:265` | `layoutFiles` state | Remover |
| `…:283-287` | include `truck: { include: { vinPlate: true } }` | `implement` |
| `…:295-296` | include `layouts: { include: { file: true } }` (pool do seletor) | Remover (sem seletor não há pool) |
| **`…:305-307`** | **`quote: { include: { …, layoutFiles: true } }`** | **REMOVER NA MESMA ENTREGA em que a API tira a relação** — include aninhado de tarefa passa pelo `z.record` passthrough e **estoura 500 no Prisma** (armadilha nº 1 do enunciado; é esta tela que morreu em 500 em 20/09) |
| **`…:319-338`** | `quote.include.tasks.select.truck.select { id, plate, chassisNumber, category, implementType }` | `implement.select { …, type }` — **mesmo risco de 500** |
| `…:408-470` | normaliza veículos a partir de `task.truck` / `v.truck` | `implement` |
| `…:525-545` | `layoutImageOptions` | Remover |
| `…:580-593, 756-763` | defaults de formulário `plate/category/implementType` com **`IMPLEMENT_TYPE.REFRIGERATED`** como recuo (763) | Estes campos só alimentam a prévia (2041-2045); o `PUT /tasks` saiu (1356-1367). Trocar recuo por vazio — a prévia da NFS-e **inventa "Refrigerado"** para caminhão sem tipo |
| `…:611, 802, 873-889` | `layoutFileIds` no form, hidratação | Remover |
| `…:1401-1421, 1502, 1512` | resolve e envia `layoutFileIds` no `PUT /budgets` | Remover |
| `…:1866-1870` | `<BillingStepBudgetInfo layoutFiles onLayoutFilesChange layouts>` | Tirar props |
| `…:2032-2045` | dados da prévia NFS-e/boleto (`t.truck.*`, `form.watch("implementType")`) | `implement`, `type` |
| `components/financial/billing/steps/billing-step-budget-info.tsx:8,35-36,110-119,248-251` | 2º consumidor do `ApprovedLayoutPicker` | Remover |
| **`components/financial/billing/steps/billing-covered-vehicles.tsx:22,88,185-189`** | grade que grava placa/chassi por `PUT /tasks/:id` com corpo `{ truck: { [field]: value } }` | **ESCRITA CRÍTICA** (§7.2). O próprio arquivo (75-86) conta a vez em que a chave no lugar errado deu 200 e a NFS-e saiu com placa velha |
| `components/financial/billing/steps/billing-step-review.tsx:8-9,140-145,224,376,395-419,905-989,1989` | categoria/implemento/placa/chassi/plaqueta da cobrança lidos de `truck` | `implement`, `type` |
| `components/financial/billing/preview/billing-document-previews.tsx:28-57,144-145,296-297` | **cópia dos rótulos da API** para a discriminação da NFS-e (`INSULATED: "Isotérmico"`, `FLATBED: "Prancha/Plataforma"`) — diferentes da UI (`Isoplastic`, `Carroceria`, `constants/enum-labels.ts:558-565`) | Se R4 mudar os VALORES do enum, esta cópia muda em lockstep com `api/src/constants/enum-labels.ts`; se só renomear o campo, muda só `implementType`→`type` (56) |
| `utils/nfse-discriminacao.ts:46,76-78` | monta "Truck Refrigerado de n série X" de `vehicle.implementType` | Renomear a chave |
| `components/financial/billing/steps/billing-step-task.tsx` (349 l.) | **MORTO** (FATO: nenhum import; `billing/details` diz em 1356 que o passo saiu) | **Apagar** — senão o rename o "conserta" à toa e ele continua convidando a religar |

### 1.6 Listas

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `components/financial/budget/table/budget-table-filters.tsx:59-62` | `BUDGET_QUOTE_INCLUDE = { tasks: { include: { truck: true, customer: true } }, customerConfigs: true }` (lista E exportação, `budget-table-page.tsx:97,121`) | `implement: true`. INF.: passa pelo `budgetIncludeSchema` ENUMERADO — se ele **descartar** a chave `truck` em silêncio, a coluna de placa fica vazia sem erro (a outra metade da armadilha) |
| `components/financial/budget/table/quote-row-shared.tsx:68` | `task.serialNumber || task.truck?.plate` | `implement` |
| `components/financial/billing/table/billing-table-page.tsx:108` | **sem include** — grafo do servidor (`BillingService.LIST_INCLUDE`) | Nada no web; o risco está na API |

### 1.7 Páginas públicas (`GET /budgets/public/:id`)

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `pages/public/budget/[id].tsx:64-69` | tipo `PublicQuoteVehicle.truck { plate, chassisNumber, category, implementType }` | `implement { …, type }` |
| `…:111-131` | `signaturesOnOwnSheet`: sem envelope, "havendo arte, ela e as assinaturas dividem a última folha" — lê `quote.layoutFiles.length` | Sem arte no orçamento, o ramo "sem envelope" vira sempre `false` (folha única). **Tem de mudar junto com `quote-renderer.service` (`if (!hasLayout) tryFusedRender`)** — as duas regras são espelho |
| `…:391-420, 982-986, 1059-1061` | `layoutImageUrls` e `layoutBlock` ("Layout", até 2 imagens) | Remover o bloco para orçamentos novos. ⚠️ Orçamento ANTIGO com envelope: a página pública **não** é o documento congelado (é recomposta do orçamento de hoje); se a relação sumir, o público de um orçamento assinado ontem perde a arte — aceitável se o PDF congelado (que a tem) for a fonte de prova (D2) |
| `pages/public/service-report/[id].tsx:93-163` | mesma regra de folha + validação das URLs de `quote.layoutFiles` | Idem |
| `…:528` | `task?.truck?.plate` | `implement` |
| `components/public/quote-vehicle-table.tsx:5,56-58,75-76,88-107` | colunas Categoria/Implemento/Placa/Chassi de `t.truck` | `implement`, rótulo "Tipo" |

### 1.8 Tipos, schema, cliente HTTP, utilitários

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `types/budget.ts:175` | `Budget.layoutFiles?: File[]` | Remover (ou `@deprecated` só-leitura enquanto houver consumidor histórico — não há no web; o PDF congelado é da API) |
| `types/budget.ts:110` | `BudgetPayer.billing.tasks[].task.truck` | `implement` |
| `types/task.ts:134` | `TaskIncludes.quote.include.layoutFiles?: boolean` — **tipo que convida a pedir relação morta e passa no tsc** (armadilha 5) | Remover a chave do tipo NA MESMA mudança |
| `types/task.ts:17,79,85,90,152,162,201` | `truck?: Truck`, `layouts?: File[]`, `projectFiles?: File[]` + includes | Tipos do Implement (R3); `layouts` sai da Task; `projectFiles` fica (R6) |
| `schemas/budget.ts:209-210` | `layoutFileIds: z.array(uuid).max(2)` | Remover |
| `api-client/budget.ts:63-70` | `budgetService.updateLayoutFile(id, layoutFileIds)` (usado só por `set-quote-layout-modal.tsx:280`, produção) | Remover junto com o modal |
| `utils/changelog-fields.ts:830` | rótulo `layoutFileIds: "Arquivos de Layout"` | **MANTER** — changelog histórico |
| `utils/invoice-pdf-generator.ts:96-102` | página 2 "Layout Aprovados" de `task.quote.layoutFiles` | **Arquivo MORTO** (FATO: nenhum import em `src/`). Apagar |
| `components/production/task/quote/budget-pdf-export-dialog.tsx` | "Imagens do Projeto aprovado" | **MORTO** (FATO: nenhum consumidor). Apagar |
| `components/financial/common/approved-layout-picker.tsx` (535 l.) | o seletor | Com R1 ficam 0 consumidores no recorte; resta `set-quote-layout-modal.tsx:12,362` (produção, também R1). **Apagar os dois** |

### 1.9 Fora do recorte, mas é R1 e mora em telas vizinhas (para o agente de Produção não perder)

`components/production/task/schedule/set-quote-layout-modal.tsx:100-364` (definir layout do orçamento em lote; include `quote.include.layoutFiles` em :173 = risco de 500), `task-schedule-table*.tsx`, `task-table-context-menu.tsx`, `task-history-*`, `task-prep-page.tsx:853`, `bulk-operations/AdvancedBulkActionsHandler.tsx`, `task/detail/sections/quote-billing-section.tsx` ("Layout Aprovados" do orçamento na tarefa), `task/detail/task-detail-page.tsx` (DETAIL_INCLUDE).

---

## 2. R2 — a arte vai para o implemento e quem aprova é o responsável (Portal)

### 2.1 O que o portal faz hoje (FATO)

| Peça | Onde | Comportamento |
|---|---|---|
| Tipo da arte por veículo | `api-client/portal.ts:438-445` `PortalVehicleLayout { generalPainting, logoPaints, baseFiles, artworks }` | `artworks` = **"Só os Layout APROVADOS. Layout em revisão é conversa interna."** |
| Tipo da arte do orçamento | `api-client/portal.ts:618-629` `PortalBudgetLayout { files }`, `PortalBudget.layout` (699) | as artes penduradas no orçamento (R1 mata) |
| Card | `components/cliente/orcamento/orcamento-layout-card.tsx:246-340` | agrupa POR ARTE (assinatura de IDs, 171-213) e mostra `budget.layout.files` como "Artes do orçamento" (272) + artes por veículo como "Artes aprovadas" (240) — **só leitura, sem ação** |
| Onde aparece | só em `pages/cliente/orcamentos/[id].tsx` (card na linha ~249 do arquivo filtrado) | **A tela do veículo (`pages/cliente/veiculos/[taskId].tsx`) NÃO mostra arte nenhuma** — só identidade, andamento e medidas |
| Régua de seção | `components/cliente/orcamento/sections.ts:64` `MARKETING: ["LAYOUT"]`; `:78` `REQUEST_BUDGET` implica `["VEHICLE","LAYOUT"]` | `LAYOUT` é seção de ASSINATURA e de TELA ao mesmo tempo |
| Capacidades | `utils/portal-capabilities.ts:3-14` | `REQUEST_BUDGET, PRE_APPROVE, WRITE_PURCHASE_ORDER, WRITE_VEHICLE_IDENTITY, TRACK` — **não existe capacidade de aprovar arte** |
| Arquivos | `components/cliente/veiculo/portal-file-url.ts` + comentário `orcamento-layout-card.tsx:62-66` | o portal **não tem `FileViewerProvider`**: arquivo abre em guia nova |

### 2.2 O que falta para (a) APROVAR/REPROVAR a arte do implemento

| # | Mudança | Arquivo | Notas |
|---|---|---|---|
| a1 | Tipo novo da arte com estado: `PortalImplementArtwork { file: PortalFile; status: "AWAITING_CUSTOMER" \| "APPROVED" \| "REPROVED"; decidedAt; decidedBy: PortalNamedRef \| null; note: string \| null }` | `api-client/portal.ts` (substitui `artworks: PortalFile[]`) | A regra "só aprovadas" (443-444) vira "tudo que a Ankaa ENVIOU ao cliente" — precisa de um estado que distinga rascunho interno de enviado (D5). `LAYOUT_STATUS` hoje é `DRAFT/APPROVED/REPROVED` (`constants/enums.ts:633-637`) |
| a2 | Capacidade `APPROVE_ARTWORK` | `utils/portal-capabilities.ts` (+ espelho na API `portal-capabilities.ts`) e `sections.ts:PORTAL_SECTION_IMPLIED_BY_CAPABILITY` (implica `LAYOUT` de TELA) | Papéis: MARKETING certamente; COMMERCIAL/SELLER/REPRESENTATIVE/COORDINATOR provável (D6) |
| a3 | Mutations `usePortalApproveArtwork` / `usePortalReproveArtwork({ taskId, layoutId, motivo })` + `portalKeys` já cobre invalidação (`useInvalidatePortal`) | `api-client/portal.ts:1842-1856, 2012-2068` | Reprovar exige motivo (igual `refuseBudget(id, motivo)` :1813) |
| a4 | Card `VeiculoArteCard` na tela do veículo, no molde `PortalCard` + `DetailRow` (`components/cliente/portal-detail.tsx`) | `components/cliente/veiculo/` + `pages/cliente/veiculos/[taskId].tsx` (inserir após o `PortalBand`, ~linha 245-299) | Botões Aprovar/Reprovar por arte; histórico de decisão; abrir em guia nova (sem provider de viewer). **Proibido** `ui/detailpage/*`, `DataTable`, `PageHeader favoritePage` no portal |
| a5 | Reescrever `OrcamentoLayoutCard` | `orcamento-layout-card.tsx` | Tirar "Artes do orçamento" (`budget.layout.files`); manter o AGRUPAMENTO POR ARTE (é exatamente o que o dono pediu para N implementos com a mesma arte) e adicionar a ação de aprovar o GRUPO ("aprovar para os 3 veículos") — INF.: uma arte compartilhada por N implementos é UMA linha `Layout` com N vínculos (o comentário 9-13 diz que hoje são as MESMAS linhas via N:N) |
| a6 | Pendência no Início ("arte esperando a sua aprovação") | `pages/cliente/painel.tsx`, `api-client/portal.ts:715-800` (`PortalSummary`) | Novo grupo `PortalWaitingGroup<PortalSummaryArtwork>`; `waiting-on.ts` é por estado de ORÇAMENTO e não serve — a vez da arte é por implemento |
| a7 | Coluna/sinal na lista de veículos | `components/cliente/veiculo/veiculo-table-columns.tsx` | "Arte: aguardando você / aprovada / reprovada" |

### 2.3 Lado interno (quem ENVIA a arte ao cliente)

INF.: a tela de tarefa/implemento (produção) precisa de "Enviar ao cliente para aprovação" (DRAFT → AWAITING_CUSTOMER), e o orçamento pode mostrar o status read-only no Resumo (D4). Hoje o status é trocado pelo funcionário no `LayoutFileUploadField` (`budget-step-task.tsx:682-717`, `onStatusChange`) — **decisão D5: o funcionário ainda pode marcar APPROVED "em nome do cliente"?** (ex.: aprovação por WhatsApp). Recomendo sim, com registro de quem marcou, porque 183 responsáveis nunca logaram (memória de 17/09) e o portal ainda não é o canal universal.

---

## 3. R3/R4 — Truck → Implement; tipo e categoria diretos

### 3.1 Inventário de `truck`/`implementType`/`category` no recorte (contagem por arquivo, FATO via grep)

| Arquivo | Ocorrências | Natureza |
|---|---:|---|
| `pages/financial/billing/details/[id].tsx` | 28 | include aninhado (500), leitura, prévia NFS-e |
| `pages/financial/budget/details/[taskId].tsx` | 28 | include, leitura, **escrita `truck:`** |
| `components/financial/billing/steps/billing-step-review.tsx` | 26 | leitura |
| `components/financial/budget/steps/budget-step-review.tsx` | 24 | leitura |
| `components/financial/budget/steps/budget-step-task.tsx` | 18 | formulário |
| `components/financial/billing/steps/billing-step-task.tsx` | 12 | **morto** |
| `components/financial/billing/preview/billing-document-previews.tsx` | 8 | rótulos da API (NFS-e) |
| `components/public/quote-vehicle-table.tsx` | 8 | leitura |
| `pages/financial/budget/create.tsx` | 6 | **escrita `truck:`** + default REFRIGERATED |
| `components/financial/billing/steps/billing-covered-vehicles.tsx` | 5 | **escrita `truck:`** |
| `utils/nfse-discriminacao.ts` | 4 | chave `implementType` |
| `components/financial/budget/steps/budget-step-services.tsx` | 3 | parâmetro de sugestão |
| `pages/public/budget/[id].tsx` | 2 | tipo público |
| `budget-table-filters.tsx`, `quote-row-shared.tsx`, `budget-request-card.tsx:115`, `service-report/[id].tsx:528`, `utils/invoice-pdf-generator.ts` (morto) | 1-2 cada | include/leitura |

Portal (`src/components/cliente`, `src/pages/cliente`, `api-client/portal.ts`):

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `api-client/portal.ts:419-436` | `PortalVehicleIdentity { …, category, implementType, vinPlate, measures{left,right,back} }` | Recomendo bloco próprio `implement` (§5.1) com `type`, `category`, `measures{left,right,back,front}`, `rearDoor`, `projectFiles`; a identidade fica com série/placa/chassi/pedido (placa é do implemento? — D8) |
| `api-client/portal.ts:1016-1024` | recibo da requisição: `vehicles[].truckId`, `measureIds` | `implementId` |
| `api-client/portal.ts:1114-1122` | `PortalBudgetRequestVehicleInput.category/implementType` | `type` |
| `api-client/portal.ts:1203-1216` | `PortalVehicleIdentityInput.category/implementType` (a rota é `.strict()` no servidor, 1196) | `type` — ⚠️ strict = chave velha dá **400 nomeado** (bom), mas só se o web e a API subirem juntos |
| `components/cliente/veiculo/veiculo-identidade-card.tsx:62-65,100-107,142-155,329-372` | editor inline de Categoria e Implemento (`PortalInlineField`, `gravar("implementType", v)`) | `type`; rótulo "Tipo" |
| `components/cliente/orcamento/orcamento-veiculos-card.tsx:75-78,98-102,157-158` | linhas "Implemento" e "Categoria" | idem |
| `components/cliente/solicitacao/step-veiculos.tsx:56,417-425,555-600` | selects Categoria/Implemento da requisição (uma vez para o lote) | idem |
| `components/cliente/solicitacao/solicitacao-schema.ts:406-407,683-686` | `category`, `implementType` no form e no payload | idem |
| `components/cliente/veiculo/portal-file-url.ts:51` | comentário `Truck.vinPlate` | texto |

### 3.2 Recomendação de nomes (para o web não virar um segundo dicionário)

- Manter os **VALORES** dos enums (`DRY_CARGO`, `REFRIGERATED`, `TRUCK`, …) idênticos. Assim a migração é rename de coluna/tipo, os rótulos em `constants/enum-labels.ts:558-565` e a cópia da NFS-e (`billing-document-previews.tsx:30-49`) não mudam de conteúdo, e snapshots antigos (que guardam os valores) continuam legíveis.
- Campo: `Implement.type` e `Implement.category` (R4). No web: `IMPLEMENT_TYPE` pode continuar como nome do enum TS (é "o tipo do implemento"); o que precisa sumir é o CAMPO `implementType`.
- Alinhamento com o monorepo (`ankaa/packages/database/prisma/schema/46-production.prisma`): lá a face é `ImplementFaceKind { LEFT, RIGHT, REAR, FRONT }` e há `ImplementBodyType`/`ImplementMounting`. **Não copiar** `REAR`: no legado a chave é `back` em todo lugar (portal, form, e2e) — trocar para `rear` agora cria exatamente o defeito "face vazia sem erro" que `veiculo-medidas-card.tsx:24-25` documenta. Acrescentar só `front`.

---

## 4. R5 — medidas com FRONTAL e opções da PORTA TRASEIRA

### 4.1 Onde a face está codificada hoje (FATO)

| Arquivo:linha | Literal |
|---|---|
| `components/production/implement-measure/implement-measure-form.tsx:29,37,56,436,443-444,487,519,550,579,679` | `'left' \| 'right' \| 'back'` em ~15 pontos; `if (selectedSide !== 'back')` (679) tem regra própria da traseira |
| `components/cliente/veiculo/veiculo-medidas-card.tsx:38-49,98-102,226-230` | `FACES` (3), `interface Medidas {left,right,back}`, `layouts`, `LADO_PARA_PAYLOAD` → `esquerda/direita/traseira` |
| `components/cliente/solicitacao/solicitacao-schema.ts:211-215,227-247,632-655` | `medidasSchema {esquerda,direita,traseira}`, `novasMedidas()` (3 lados), `LADO_DO_IMPLEMENTO`, `ROTULO_DO_LADO`, `medidasIntocadas` (3), `medidasParaPayload` (3) |
| `components/cliente/solicitacao/step-revisao.tsx:77,116,287` | `LADOS = ["left","right","back"]` |
| `components/cliente/solicitacao/step-veiculos.tsx:426-655` | `MedidasDoImplemento`, botões por lado, "Comprimento total" |
| `api-client/portal.ts:427-432, 1083-1134` | `measures {left,right,back}`; input `medidas {esquerda,direita,traseira}` |

### 4.2 O que muda

| # | Mudança | Onde |
|---|---|---|
| m1 | Face `front` no formulário de desenho (o componente é compartilhado com produção) | `implement-measure-form.tsx` — trocar os literais por um tipo exportado `ImplementSide = 'left'\|'right'\|'back'\|'front'` e um array `IMPLEMENT_SIDES`. **Sem isto cada consumidor mantém a sua lista e um esquece a frontal** |
| m2 | Portal leitura: `FACES` + `front` ("Frente") | `veiculo-medidas-card.tsx:38-49`, `LADO_PARA_PAYLOAD` + `front: "frente"` (ou o nome que a API escolher) |
| m3 | Requisição: `medidasSchema.frente`, `novasMedidas()`, `medidasIntocadas`, `medidasParaPayload`, `LADO_DO_IMPLEMENTO`, `ROTULO_DO_LADO`, `LADOS` da revisão | `solicitacao-schema.ts`, `step-revisao.tsx`, `step-veiculos.tsx` |
| m4 | Tipos: `PortalVehicleIdentity.measures.front`, `PortalBudgetRequestVehicleInput.medidas.frente` | `api-client/portal.ts` |
| m5 | **Porta traseira** — grupo novo no passo de veículos da requisição e no card do veículo: `rearDoorLeaves: "BIPARTIDA" \| "TRIPARTIDA"`, `rearDoorBars: 2 \| 3 \| 4` (varões), `rearDoorHatches: number` (portinholas, ≥0) | form: `solicitacao-schema.ts` (zod com `z.enum`/`z.union([z.literal(2),…])`, `z.number().int().min(0).max(N)`); leitura/edição: card novo ou seção do `veiculo-medidas-card`; tipos em `portal.ts` |
| m6 | **Declarar `medidas` em `PortalVehicleIdentityInput`** (hoje ausente; o card grava com `as never` em `veiculo-medidas-card.tsx:152`, e `layouts as never`/`aoMudar as never` em 207/209) | `api-client/portal.ts:1198-1233`. É o defeito-classe de R8 ("tipo que mente") já instalado: se a API renomear `medidas`→outra coisa, o tsc não avisa e o `.strict()` devolve 400 só em runtime |
| m7 | Sentinela "medida intocada" (`medidasIntocadas`) — a frontal nasce com o mesmo padrão 2,00×2,00 e **tem de entrar na checagem**, senão toda requisição passa a mandar uma frente que ninguém mediu | `solicitacao-schema.ts:632-638` |

**Unidade**: nada muda — formulário em cm, borda do servidor `/100`, banco e projeção em metros (`veiculo-medidas-card.tsx:12-22`, `portal.ts:325-336`). As opções da porta são contagens/enum, sem unidade.

**Decisão D9** (ver §9): a porta traseira mora no IMPLEMENTO (campos diretos) ou na FACE traseira (`ImplementMeasure` back)? Recomendo no implemento — é característica da carroceria, não medida de chapa — e usar a escolha como PRESET do desenho da face traseira (bipartida = 2 seções porta; tripartida = 3), sem duplicar a verdade.

---

## 5. R6/R7 — projeto do implemento no portal e separação tarefa × implemento

### 5.1 Forma recomendada da resposta do portal (INF., para alinhar com o agente da API)

```
PortalVehicle {
  id (taskId), name, milestone, milestoneLabel, cancelled,
  identity?: { serialNumber, plate?, chassisNumber?, customerOrderNumber, purchaseOrder, customer, vinPlate? }  // seção VEHICLE
  implement?: {                                    // seção VEHICLE
    id, type, category,
    measures: { left, right, back, front },        // METROS
    rearDoor: { leaves, bars, hatches } | null,
    projectFiles: PortalFile[],                    // projeto do furgão (Furgões Ibiporã)
  }
  artworks?: PortalImplementArtwork[]              // seção LAYOUT (com estado, §2.2)
  layout?: { generalPainting, logoPaints, baseFiles } // tinta/referência da TAREFA
  progress?: …                                     // seção DELIVERY
}
```

A tela hoje depende de `undefined` = "sem seção" e `null` dentro = traço (`portal.ts:467-470`). Um bloco `implement` separado preserva essa régua e torna explícito o que é "da Furgões/cliente" × "da Ankaa" (R7).

### 5.2 Projeto do implemento (c)

| # | Mudança | Onde |
|---|---|---|
| p1 | Card "Projeto do implemento" (lista de PDFs, abrir em guia nova; upload para quem tem capacidade) | `components/cliente/veiculo/veiculo-projeto-card.tsx` (novo) na tela `pages/cliente/veiculos/[taskId].tsx` |
| p2 | Upload pelo portal: reaproveitar o molde multipart de campo único `payload` + arquivo (`portal.ts:1518-1534`, usado por `updateVehicleIdentity` com `truckVinPlate`, 1698-1718) com campo `implementProject` | `api-client/portal.ts` |
| p3 | Capacidade: `WRITE_VEHICLE_IDENTITY` já é "quem sabe da frota" — recomendo estender para projeto e medidas, ou criar `WRITE_IMPLEMENT` (D6) | `utils/portal-capabilities.ts` |
| p4 | Requisição: anexar o projeto do furgão já na requisição (passo Veículos), igual aos `baseFiles` do passo Pintura (`step-pintura.tsx:37-52,267-277`) | `components/cliente/solicitacao/*` |
| p5 | O **projeto da TAREFA** (PDF de cotas da Ankaa) — mostrar ao cliente? | D10. Recomendo **não** na primeira entrega (é insumo interno de plotagem) |

### 5.3 Lado interno (orçamento)

- O acordeão "Layout Referência" do passo 1 (`budget-step-task.tsx:658-717`) mistura PDF e imagem numa mesma lista com status (a pista do ADR 0121: ~283 PDFs × ~311 imagens). Separar em "Projeto da tarefa (PDF)" e "Arte do implemento (imagem)". **Não verifiquei os números no banco** (não fui instruído a consultar) — fica para o agente de dados.
- `fileContext` (pasta no servidor): hoje `tasksLayouts`, `taskBaseFiles`, `taskProjectFiles`, `quote-layouts`, `truckVinPlate` (`components/common/file/file-suggestions.tsx:21`; detalhe:1196,1222,1256,1317). Precisa de `implementLayouts` e `implementProjectFiles`; `quote-layouts` morre. `FileSuggestions` ("reusar layout já usado por este cliente", `budget-step-task.tsx:693-716`) passa a sugerir artes de implementos do mesmo cliente.

### 5.4 Pré-requisito de dados que o web assume (FATO do schema da API)

`Truck.taskId @unique` (`api/prisma/schema.prisma`, model Truck) — hoje o implemento é 1:1 com a tarefa, e **todo o portal é endereçado por `taskId`** (`/cliente/me/veiculos/:taskId`, `/identificacao`). Se o rework mantiver 1:1, nenhuma rota do portal muda de endereço. Se o implemento passar a sobreviver a várias tarefas (repintura anos depois), o portal precisa de rota por `implementId` e de regra de escopo nova (D1).

---

## 6. A branch da outra sessão (`feat/orcamento-veiculos`, web)

FATO: `git log feat/portal-do-responsavel..feat/orcamento-veiculos` = 7 commits; relevantes: `d6a48bec` "Layout aprovado por veículo" e `56139571` "Orçamento de N veículos: todos os caminhões editáveis na mesma tela" (empilhado sobre o primeiro). Merge-base `c72799b5`; a branch **não** contém os 19 commits do portal. Não toca em `components/cliente/**`.

| Peça | Arquivo (na outra branch) | Veredito frente a R1 | Por quê |
|---|---|---|---|
| `Budget.layoutScope`, `QuoteLayoutScope`, `QuoteLayoutFile.quoteLayoutTasks` | `types/budget.ts` (+22) | **CONFLITA — descartar** | Modela arte POR VEÍCULO **dentro do orçamento**; R1 tira a arte do orçamento |
| `utils/quote-layout-coverage.ts` (+119) e `.test.ts` (+93) | idem | **Descartar**; a IDEIA "cobertura por veículo" vira "cada implemento tem as suas artes" | `perVehicleLayoutsPayload` → não há payload de orçamento |
| `budget-vehicle-layouts-field.tsx` (+165), chave "um layout para cada veículo", "Usar em todos os veículos" | `components/financial/budget/vehicles/` | **Descartar o campo; reaproveitar a UX** "aplicar esta arte aos demais implementos do orçamento" | Mesma necessidade (Carlotti nº 990), outro dono do dado |
| `approved-layout-picker.tsx` (`title`, `headerAction`) | `components/financial/common/` | **Descartar** (o seletor some) | — |
| `billing-step-budget-info.tsx` `layoutNotice` e `billing/details/[id].tsx` aviso PER_VEHICLE | | **Descartar** | Some junto com o seletor |
| `pages/public/budget/[id].tsx` legendas "Veículo 39088" por arte | | **Descartar no orçamento**; a ideia de legenda por veículo serve para o card do portal (§2.2 a5) | |
| `quote-billing-section.tsx` `layoutFilesForTask` | produção | **Descartar** | |
| `budget/details/[taskId].tsx` (+1532/−~500): `layoutPerVehicle`, `layoutsByTask`, `layoutStatusesByTask`, `layouts: [{fileId, taskIds}]` no save | | **Conflita** na metade de layout; **reaproveitável** na metade N-veículos | ver abaixo |
| `use-budget-vehicles.ts` (`useBudgetVehicles`, `BUDGET_VEHICLE_TASK_INCLUDE`) | `components/financial/budget/vehicles/` | **REAPROVEITAR**, com `truck`→`implement` e sem `layouts` na tarefa | Carrega cada tarefa do orçamento com a MESMA chave de cache do `useTaskDetail`; é o que permite editar medidas/tipo/arte de cada implemento na mesma tela. ⚠️ `BUDGET_VEHICLE_TASK_INCLUDE` pede `truck: { include: { vinPlate } }` e `layouts: { include: { file } }` — **mais uma constante de include que estoura 500 no rename** |
| `budget-vehicle-tabs.tsx` (+96) e a divisão do passo 1 "COMUM (logomarca, cliente, categoria, implemento, tamanho, responsáveis, arquivos base) × DE CADA caminhão (série, placa, chassi, plaqueta, pedido, previsão, pintura geral, aerografia)" | | **REAPROVEITAR** | É exatamente a fronteira R7 aplicada à tela; categoria/tipo como COMUM bate com a requisição do portal (perguntados uma vez por lote, `step-veiculos.tsx:555`) |
| `useImplementMeasuresByTruck(openTruckId)` + `formatTaskMeasures` → "ainda não medido" | budget detalhe | **Reaproveitar** com rename (`…ByImplement`) | Resumo de medidas no orçamento |
| "Medir um veículo mede os demais" | API (`implement-measure-replication.ts`), não web | Reaproveitável em R5 | Casa com a requisição do portal, que já copia a mesma medida para o lote (`solicitacao-schema.ts:676-681`) |
| `airbrushing-reconcile.ts` (+373), `paint-purchase-dialog.tsx`, bônus, pedidos | | **Independente de R1** — pode ir para a main à parte | |
| remoção de `responsible: true` em DETAIL_INCLUDE e billing | | **Já feito no portal** por `25655d6f` | conflito trivial de merge |

**Recomendação de ordem (D11)**: não mergear `d6a48bec` na main. Extrair os commits sem layout (paint, bônus, pedido, aerografia) direto; reescrever `56139571` sem a parte de layout (é empilhado, cherry-pick puro vai conflitar em `budget/details/[taskId].tsx`). Se o dono preferir pôr a outra branch NO AR antes do rework, a migração de R1 terá de migrar também `Budget.layoutScope` + a tabela de cobertura `QuoteLayoutTask` para `Implement.layouts` — trabalho a mais e um estado intermediário a mais.

---

## 7. R8 — como o web evita as falhas clássicas neste rework

### 7.1 Constantes de include no recorte que precisam mudar NA MESMA entrega da API (500 se esquecidas)

| # | Arquivo:linha | Chave(s) mortas |
|---|---|---|
| 1 | `pages/financial/billing/details/[id].tsx:287` | `truck` (topo do include de tarefa) |
| 2 | `…/billing/details/[id].tsx:296` | `layouts` (se sair da tarefa) |
| 3 | `…/billing/details/[id].tsx:307` | `quote.include.layoutFiles` (**aninhado → passthrough → 500**) |
| 4 | `…/billing/details/[id].tsx:326-337` | `quote.include.tasks.select.truck.select{…implementType}` (**aninhado → 500**) |
| 5 | `pages/financial/budget/details/[taskId].tsx:152,153` | `truck`, `layouts` |
| 6 | `components/financial/budget/table/budget-table-filters.tsx:60` | `tasks.include.truck` (via `budgetIncludeSchema` — pode ser **descarte silencioso** em vez de 500) |
| 7 | outra branch `use-budget-vehicles.ts` `BUDGET_VEHICLE_TASK_INCLUDE` | `truck`, `layouts` |
| 8 | `components/production/task/schedule/set-quote-layout-modal.tsx:173` (vizinho) | `quote.include.layoutFiles`, `layouts` |
| 9 | `types/task.ts:134` (TIPO) | `quote.include.layoutFiles` — convida a pedir |

### 7.2 ESCRITAS com a chave `truck` (o risco silencioso)

| # | Arquivo:linha | Corpo |
|---|---|---|
| w1 | `pages/financial/budget/details/[taskId].tsx:1418-1441` | `PUT /tasks/:id { truck: { plate, chassisNumber, category, implementType, vinPlateId } }` |
| w2 | `pages/financial/budget/create.tsx:764-775` | `truck: { plate, category, implementType }` em cada tarefa criada |
| w3 | `components/financial/billing/steps/billing-covered-vehicles.tsx:88` | `{ truck: { [field]: value } }` |
| w4 | outra branch (budget detalhe multi-veículo) | idem, por veículo |

`taskUpdateSchema` não é strict → chave `truck` depois do rename = **200 sem gravar**. Pedido explícito ao agente da API: durante a janela de transição, o schema deve **aceitar `truck` como alias** (o app Flutter instalado nos aparelhos também manda `truck` — mesmo precedente de `include: { task }` → `tasks`, `types/budget.ts:210`) **ou recusar com 400 nomeado** — nunca descartar. O portal é `.strict()` e já falha alto (`portal.ts:1196`).

### 7.3 Guarda-corpos propostos (web)

1. **Uma fonte por relação**: exportar `IMPLEMENT_INCLUDE = { vinPlate: true }` de um lugar (ex.: `constants/includes.ts`) e usar nos 5 includes acima; nenhum literal `truck:`/`implement:` solto em tela.
2. **Teste de contrato barato (vitest)**: importar todas as constantes de include/select exportadas e falhar se contiverem as chaves proibidas (`truck`, `layoutFiles`, `layoutFileIds`, `implementType`, `layoutScope`). Allowlist explícita para os leitores HISTÓRICOS (`quote-change-list.tsx`, `signature.ts`, `changelog-fields.ts`).
3. **Varredura de texto no CI** (rg) sobre `src/` pelas mesmas chaves em objetos de corpo (`truck:`, `layoutFileIds`), com a mesma allowlist — pega o `as any`/`as never` que o tsc não pega.
4. **Tipos primeiro**: remover `Budget.layoutFiles`, `TaskIncludes.quote.include.layoutFiles`, `Task.truck` NO MESMO commit que troca as telas, para o tsc apontar cada consumidor (hoje há `(task.truck as any)` em `budget/details:486,513` e `billing/details:734` que escapam; varrer `as any` perto de `truck`).
5. **Apagar código morto antes** (3 arquivos, §0.6) para o rename não "consertar" o que ninguém usa.
6. **Deploy**: API com alias (lê `truck` e `implement`) → web → Flutter → remover alias. Buildar antes de migrar (memória de 16/09); bundle velho no navegador gera 500 falso — o include antigo aninhado é exatamente o que o bundle velho manda.

---

## 8. Testes afetados

### 8.1 Web (vitest) — FATO por grep

| Teste | Linhas | Motivo |
|---|---|---|
| `src/components/cliente/solicitacao/solicitacao-schema.test.ts` | 21-30, 70, 138-330 (payload e chaves exatas — 330 espera `["medidas","serialNumber"]`), 379, 472-570 (`medidasIntocadas`, padrão) | frontal, porta traseira, `implementType`→`type` |
| `src/utils/billing-coverage.test.ts` | 44-47 | fixtures `truck: { plate }` |
| `src/lib/attention/engine.test.ts` | 43, 132, 160, 171, 245, 333 | fixtures `truck` (as regras de atenção leem `task.truck.plate/chassisNumber/vinPlateId`) |
| `src/constants/routes.customer.test.ts` | — | só se nascerem rotas novas no portal |
| outra branch `src/utils/quote-layout-coverage.test.ts` | — | apagar com o util |
| Novos a escrever | — | `veiculo-medidas-card` (4 faces, cm↔m, não grava ao montar); aprovação de arte (capacidade, 403 esconde botão); `implement-measure-form` com `front`; contrato de includes (§7.3-2) |

Não há Playwright no repo web (FATO: sem `e2e/`/`tests/`).

### 8.2 API `tests/e2e-portal` (bateria 65/65 do dia 20/09)

| Cenário | Linhas | Quebra por |
|---|---|---|
| `cenarios/01-requisicao-com-medidas.ts` | 27-35 (CM/METROS por lado), 97, 117-134 (`truck.select.leftSideMeasure/rightSideMeasure/backSideMeasure`), 179 (`identity.measures`), 208-227 (tela fala em medida) | rename Truck→Implement, face frontal, possível mudança de `identity.measures`→`implement.measures` |
| `cenarios/03-portao-compras.ts` | 157-169 (`layoutFiles: { connect }` no orçamento porque "a emissão o exige") | R1: a relação e o portão somem — a montagem precisa sair |
| `cenarios/04-verdade-da-espera.ts` | 79 (`layoutFiles: { connect }`) | idem |
| Novos | — | aprovar/reprovar arte pelo portal; medidas com frente; porta traseira; upload do projeto |

---

## 9. Perguntas ao dono

| # | Pergunta | Minha recomendação | Por quê |
|---|---|---|---|
| D1 | O implemento continua 1:1 com a tarefa (`Truck.taskId @unique`) ou passa a sobreviver a várias tarefas? | **1:1 neste rework** | Todo o portal é endereçado por `taskId`; N:1 é projeto próprio (unicidade de placa/série, escopo do portal) |
| D2 | O documento do orçamento (PDF/assinatura) deixa de mostrar arte? E a seção `LAYOUT` sai dos envelopes NOVOS? | **Sim e sim**; o tipo `LAYOUT` fica para ler envelopes antigos; o MARKETING deixa de ASSINAR o orçamento e passa a APROVAR arte | Coerente com R1/R2; hoje `MARKETING: ["LAYOUT"]` é a única seção dele (`sections.ts:64`) — sem ela o recorte fica vazio e o card de Assinaturas some para ele (`portalRoleSigns`), o que está certo |
| D3 | A tela de orçamento continua editando arte (upload/status) ou só MOSTRA a do implemento? | **Só mostra** (read-only com status no Resumo); editar arte vai para a tela do implemento/tarefa | Evita recriar a sincronização orçamento↔arte que R1 manda matar |
| D4 | Enviar o orçamento para assinatura exige arte aprovada? | **Não.** O portão de arte vai para a PRODUÇÃO (plotagem/entrada em produção) | Arte e preço têm donos e tempos diferentes (R7); é o que tira o "passo sem saída" |
| D5 | Estados da arte: precisa de "enviada ao cliente" separado de "rascunho interno"? O funcionário pode aprovar em nome do cliente? | **Sim** (`AWAITING_CUSTOMER`) e **sim, com registro de quem** | O portal hoje esconde tudo que não é APPROVED; 183 responsáveis nunca logaram |
| D6 | Quem aprova arte e quem escreve medidas/projeto no portal? | Arte: MARKETING + COMMERCIAL/SELLER/REPRESENTATIVE/COORDINATOR. Medidas/porta/projeto: quem tem `WRITE_VEHICLE_IDENTITY` (inclui FLEET_MANAGER e PURCHASING) | Reusa a régua existente; zero papel novo |
| D7 | "Elaborar Projeto" (O.S. padrão, `create.tsx:190`) é o nome do PROJETO DA TAREFA? | Confirmar o vocabulário: "Projeto da tarefa" × "Projeto do implemento" em toda a UI | Evita duas coisas chamadas "projeto" na mesma tela |
| D8 | Placa/chassi/plaqueta são do implemento ou do veículo (cavalo)? | Manter onde estão (no implemento) neste rework | Mudar exige reescrever a guarda do documento congelado (placa impressa) |
| D9 | Porta traseira: campos do implemento ou da face traseira? | **Do implemento**, usados como preset do desenho da face traseira | Configuração de carroceria ≠ medida de chapa |
| D10 | O cliente vê o projeto da TAREFA (PDF de cotas)? | **Não** na primeira entrega | Insumo interno de plotagem |
| D11 | O que fazer com `feat/orcamento-veiculos`? | Não mergear a parte de layout; extrair o resto; reescrever o N-veículos sobre o implemento | §6 |

## 10. Riscos

| # | Risco | Mitigação |
|---|---|---|
| X1 | **Escrita `truck` descartada com 200** em 3 telas (w1-w3) + app instalado | Alias ou 400 nomeado na API durante a janela; teste de contrato §7.3 |
| X2 | **500 em Faturamento e no detalhe de orçamento** por include aninhado de relação removida (`billing/details:307,326`) — repete 20/09 | Trocar web e API na mesma entrega; API com alias de include; build antes de migrar |
| X3 | Orçamento faturado passa a dar **400 em toda gravação** se a API tirar `layoutFileIds` da lista segura antes do web parar de mandar (`budget/details:1640-1650`) | Ordem: web para de mandar → API remove a chave |
| X4 | Dado de `implementType = REFRIGERATED` **não é confiável** (default de `create.tsx:168`; recuo de `billing/details:763`) — a migração de R4 herda lixo | Corrigir os defaults; avisar quem migra; não usar o tipo para regra automática sem revisão |
| X5 | Face `front` adicionada num consumidor e esquecida em outro (15 literais no `ImplementMeasureForm` + 5 listas no portal) | Tipo/array únicos exportados (m1) |
| X6 | Frente "padrão 2,00×2,00" viajando em toda requisição | Incluir a frente em `medidasIntocadas` (m7) + teste |
| X7 | Página pública de orçamento ANTIGO perde a arte quando a relação sumir (não é o PDF congelado) | Aceitar e apontar para o PDF congelado como prova; ou manter leitura histórica via snapshot no endpoint público (decisão da API) |
| X8 | Regra da "folha própria de assinaturas" (`public/budget:129-131`, `service-report:101-103`) diverge do renderer se só um lado mudar | Mudar junto com `quote-renderer.service` |
| X9 | Botão "Escolher o layout aprovado" reaparece se QUALQUER blocker futuro contiver "layout" (regex em `signature-send-dialog.tsx:296`) | Remover o casamento por regex junto com o atalho |
| X10 | Merge com `feat/orcamento-veiculos` traz de volta `layoutScope`/`quoteLayoutTasks` e um 4º include com `truck` | D11 |
| X11 | Tipo do portal sem `medidas` (`as never`) esconde a próxima renomeação | m6 antes de mexer nas medidas |
| X12 | Mobile atrás: `mobile-flutter/lib/features/financial/budget.dart`, `budget_sections.dart`, `budget/budget_form_screen.dart` usam `layoutFiles` (FATO por grep); o Flutter não tem portal | Fora do meu recorte — sinalizo ao agente do app; o alias de API (X1/X2) é o que o protege |
