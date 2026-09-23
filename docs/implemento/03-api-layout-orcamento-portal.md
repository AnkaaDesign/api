# 03 — API: LAYOUT (arte), PROJETO e o fluxo ORÇAMENTO / ASSINATURA / PORTAL

**Recorte:** `api` em `feat/portal-do-responsavel` (HEAD `ad3c65d4`), somente leitura.
**Dados:** SELECT em transação `READ ONLY` no clone local `ankaa_production` (última tarefa 21/09/2026; migrations do portal aplicadas nele, a de `feat/orcamento-veiculos` NÃO).
**Convenção:** **FATO** = li no código ou no dado (com `arquivo:linha`); **INFERÊNCIA** = conclusão minha; **DECISÃO** = só o dono.

---

## 0. O essencial em 12 linhas

1. **O maior risco do R1 não está no orçamento, está na ASSINATURA.** Todas as 7 versões do recorte material levam `layoutFileIds` (`quote-snapshot.service.ts:326,594`) e a conferência de frescor roda **em todo ato de assinar** (OTP `signature-envelope.service.ts:3838`, contra-assinatura `:4620`, sessão do portal `:5269`, selo `:6374`), e também em envelopes **COMPLETED** (`:6916-6920`). Tirar `Budget.layoutFiles` sem uma versão 8 + tolerância **invalida em massa** as coletas vivas e **as assinaturas já concluídas**, e `markInvalidatedBySignature` devolve o orçamento para PENDING (`budget.service.ts:3580-3605`). No clone: **15 de 16 envelopes RUNNING e 2 de 3 COMPLETED têm layout no snapshot.**
2. **Tirar a coluna `File.quoteLayoutId` quebra TODO `DELETE` de arquivo do sistema**: a função SQL `file_blocking_references` cita a coluna pelo nome (`prisma/migrations/20260804180000_file_referenced_delete_guard/migration.sql:44`). É plpgsql e só falha em runtime — a migração passa, e a primeira exclusão de arquivo dá 500.
3. **R6 confirmado com dado:** a coleção `Layout` da tarefa mistura **177 PDFs** (desenho cotado, 169 aprovados) e **196 imagens** (arte); `Task.projectFiles` tem **4 PDFs em 4 tarefas**, e os nomes (`PROJETO 38221 - TARENTO.pdf`, `32567 - LAYOUT.pdf`) são projetos de carroceria da Furgões. O cotador (`/layout-dimensions/:fileId?truckId=`) lê o PDF + as medidas do caminhão — ele é o consumidor do "projeto da tarefa".
4. Hoje quem aprova arte é **COMERCIAL e ADMIN** (`task.service.ts:213-216`), por `layoutStatuses` no `PUT /tasks/:id`; o cliente aprova "por conversa". Em paralelo existe o fluxo da **O.S. de ARTE** (`WAITING_APPROVE` → `COMPLETED`), que é o que de fato solta a tarefa para a produção.
5. O `Layout` é **UMA linha compartilhada por N tarefas** (m2m `TaskLayouts`, `fileId @unique`, **um status só**): 40 layouts estão ligados a 2–40 tarefas cada. Aprovar por implemento exige mudar essa forma.
6. **Recomendação de modelo:** arte = `Layout` com `implementId` (1:N), estados `DRAFT → PENDING_APPROVAL → APPROVED | REPROVED` (+ `SUPERSEDED`), aprovada no Portal por quem hoje RECEBE a seção `LAYOUT` na assinatura (a mesma régua), ou pela Ankaa "em nome do cliente" com nota obrigatória. A aprovação da arte **substitui o `WAITING_APPROVE` da O.S. de ARTE** como gatilho de liberação para produção.
7. **Diferença com o ADR 0121 do monorepo:** lá "a assinatura aprova o layout, e o portal NÃO ganha botão de aprovar arte"; o pedido de hoje é o oposto (ato separado, no portal, no implemento). A consequência jurídica muda: a arte deixa de estar dentro do documento PAdES e passa a ter evidência própria (sessão OTP + trilha + hash do arquivo). **DECISÃO do dono.**
8. A branch `feat/orcamento-veiculos` (8 commits, 23/09) **conflita com R1** em quase tudo (cria `Budget.layoutScope` e `BudgetLayoutTask`), mas **4 peças são reaproveitáveis**: a replicação de medidas entre veículos do mesmo orçamento, o portão que NOMEIA o veículo sem arte, o rótulo de veículo (`vehicleLabel`/`describeVehicleList`) e a tabela de cobertura como FONTE da migração se ela for a produção antes.
9. Há **dados a migrar com conflito**: 52 pares (arte do orçamento × veículo) sem gêmeo na galeria da tarefa e 15 gêmeos em `DRAFT` na tarefa mas "aprovados" no orçamento.
10. **1.729 tarefas** têm O.S. de ARTE concluída e **nenhum** layout no sistema → qualquer portão "exige arte aprovada" só pode valer para trabalho NOVO.
11. `File.layouts` é **to-one** (`schema.prisma:763`) porque `Layout.fileId` é `@unique`. Largar o `@unique` muda o formato de TODA resposta de arquivo (objeto → lista) — silencioso no web e no app.
12. O app instalado manda `layoutFileIds`, `include.layoutFiles` e `quote.include.layoutFiles`; o `include` da tarefa é passthrough (`schemas/task.ts:1098-1140`) → **500** se a relação sumir; o do orçamento é enumerado (`schemas/budget.ts:160`) → some calado. Política de compatibilidade por campo na §7.

---

## 1. Fatos medidos (clone local, 21/09/2026)

| medida | valor | como |
|---|---:|---|
| Tarefas | 2.253 | `Task` |
| `Layout` total / aprovados / rascunho / reprovados | 481 / 392 / 86 / 3 | `Layout` |
| `Layout` de aerografia (`airbrushingId`) | 0 (só 2 `Airbrushing` no clone) | |
| `Layout` ligados a tarefa (distintos) / linhas m2m | 373 / 583 | `_TaskLayouts` |
| … sendo **PDF** (aprov./rasc./reprov.) | 169 / 7 / 1 → **177** | `File.mimetype` |
| … sendo **imagem** (aprov./rasc./reprov.) | 149 / 46 / 1 → **196** | |
| Layout ligado a 1 tarefa / a 2–40 tarefas | 333 / **40** (um deles a 40 tarefas) | agrupando `_TaskLayouts.A` |
| Tarefas com layout | 403 (128 com PDF **e** imagem; 63 só PDF; 212 só imagem) | |
| Layouts órfãos (sem tarefa, sem aerografia) | 108 (24 deles são clones de orçamento) | |
| `Task.projectFiles` | **4 PDFs em 4 tarefas** (`PROJETO 38221 - TARENTO.pdf`, `32567 - LAYOUT.pdf`, `37786 - LAYOUT.pdf`, `CamScanner…pdf`) | `_TASK_PROJECT_FILES` |
| `Task.baseFiles` | 707 arquivos em 281 tarefas | |
| Orçamentos / com layout aprovado | 615 / 135 (133 imagens + 4 PDFs em `File.quoteLayoutId`) | |
| …APPROVED com layout / APPROVED total | 96 / 429 (portão de aprovação é posterior) | |
| Arte do orçamento **sem gêmeo** na galeria do veículo | **52** pares (arquivo × tarefa) | `originalName`+`size` |
| Gêmeo existe mas está `DRAFT` na tarefa | **15** (64 `APPROVED`) | |
| Envelopes RUNNING / com layout no snapshot | 16 / **15** | `quoteSnapshot->'layoutFileIds'` |
| Envelopes COMPLETED / com layout no snapshot | 3 / **2** | |
| `schemaVersion` dos snapshots | 12 em v1, 23 em v4 | |
| `EnvelopeDocument.variantKey` | 35 completos, 2 `…sem LAYOUT` (financeiro), **2 `VEHICLE+LAYOUT`** (marketing) | |
| Papéis de contato | COMMERCIAL 118, FLEET_MANAGER 69, **MARKETING 48**, FINANCIAL 44, SELLER 11, REPRESENTATIVE 4, PURCHASING 3, DRIVER 1 | `unnest(roles)` |
| `Truck` / com medida esq./dir./tras. | 575 / 261 / 261 / 255 | |
| O.S. de ARTE: COMPLETED / PENDING / **WAITING_APPROVE** / IN_PROGRESS | 2.435 / 550 / **31** / 17 | `ServiceOrder.type='ARTWORK'` |
| Tarefas com O.S. de ARTE concluída e **zero** layout | **1.729** | |
| Tarefa com layout mas sem `Truck` | 1 | |
| `NotificationConfiguration` de arte ativas | `artwork.approved`, `artwork.reproved`, `artwork.pending_approval_reminder`, `service_order.waiting_approval.artwork`, `task.field.truck.layout` (+ 3 chaves mortas `task.field.truck.{left,right,back}SideLayoutId`, desligadas) | |

> ⚠️ O clone não é idêntico à produção (o ADR 0121 mediu 283 PDF / 311 imagens / 597 layouts em 03/09). As **proporções** batem; a migração deve rodar a mesma bateria de SELECT no dump de produção antes.

---

## 2. O que existe hoje — mapa completo do recorte

### 2.1 Modelo

| peça | onde | fato |
|---|---|---|
| `model Layout` | `prisma/schema.prisma:87-101` | `fileId @unique`, `status LayoutStatus @default(APPROVED)` (⚠️ todo caminho de app cria `DRAFT`), `airbrushingId?`, `tasks Task[] @relation("TaskLayouts")` (m2m). **Não tem** `taskId`, `truckId`, quem aprovou, quando, nem motivo. |
| `enum LayoutStatus` | `schema.prisma:3991-3995` | `DRAFT APPROVED REPROVED` |
| `Task.layouts` | `schema.prisma:2394` | m2m `TaskLayouts` |
| `Task.projectFiles` | `schema.prisma:2395` | m2m `TASK_PROJECT_FILES` |
| `Budget.layoutFiles` | `schema.prisma:1963` | 1:N por `File.quoteLayoutId` (`:762`, `:773`, índice `:808`), `onDelete: SetNull` |
| `File.layouts` | `schema.prisma:763` | **to-one** (`Layout?`) — consequência do `fileId @unique` |
| `Airbrushing.layouts` | `schema.prisma:73` | via `Layout.airbrushingId` (Cascade) |
| `Truck` | `schema.prisma:2530-2562` | `taskId @unique` (1:1 com a tarefa), 3 FKs de medida, `vinPlateId` |
| `ImplementMeasure` / `Section` | `schema.prisma:2564-2590` | `height` + seções `width/isDoor/doorHeight/position`, **em METROS**; sem face FRONTAL, sem opções de porta |

### 2.2 Escrita e aprovação de layout na tarefa (quem aprova hoje)

| o quê | onde | fato |
|---|---|---|
| Permissão de aprovar | `task.service.ts:213-216` `canApproveLayouts` | **COMMERCIAL, ADMIN**. Outro papel que manda `APPROVED` cria `DRAFT` (`:960-968`) ou é ignorado em silêncio (`:995-999`). |
| Converter File→Layout e aplicar status | `task.service.ts:878-1047` `convertFileIdsToLayoutIds` | acha `Layout` por `fileId` (`findUnique`, `:903`) — **a linha é global, "affects all connected tasks"** (`:1004`). Emite `artwork.approved`/`artwork.reproved` (`:1015-1033`). |
| Criar Layout de upload | `task.service.ts:1049-1085` `createLayoutForFile` | status passado pelo chamador |
| Campos do corpo | `schemas/task.ts:2691-2699` (create), `:2955-3003` (update: `layoutIds`, `layoutStatuses` como `record<fileId,status>` com pré-processamento de FormData, `newLayoutStatuses`) | |
| Domínio de permissão por campo | `task.permissions.ts:64` (`layouts`), `:78` (`layoutRemoval`), mapeamentos `:146-357` | ⚠️ campo fora do mapa = **negado a todos menos ADMIN, em silêncio** (`:57-62`). |
| Upload multipart | `task.controller.ts:149,292,744` (`layouts` ≤10), `:160-187` e `:760-787` (`airbrushings[i].layouts` ≤20), `:756` (`quoteLayoutFile` ≤2) | |
| Rota morta | `task.controller.ts:880-887` `POST :id/upload/layouts` | 400 "obsoleto" |
| Diagnóstico | `task.controller.ts:202-230` `GET :id/layouts/diagnostic` | |
| Lote de artes | `task.controller.ts:332-346` `POST /tasks/bulk/arts` (ADMIN) → `task.service.ts:12519` | |
| Upload em lote | `task.service.ts:13161-13260` `bulkUploadFiles` | ⚠️ cria layout **`APPROVED` direto** (`:13244-13251`) — aprovação sem ninguém aprovar |
| Cópia de tarefa | `task.service.ts:14021-14035` (`layoutIds` → `set` da MESMA linha compartilhada), `schemas/task-copy.ts:22,153` | |
| Rollback de campo | `task.service.ts:11418-11440` (`layoutIds → layouts`) | changelog antigo com campo `layouts` continuará existindo |
| Aerografia | `task.service.ts:5445-5490` (formulário da tarefa), `airbrushing.service.ts:366` (visibilidade por papel), `:1000-1045` (exclusão), `:1855-1980` (conversão própria) | a arte da aerografia é outra coleção, dona `Airbrushing` |
| Cortes | `schema.prisma:2499-2528` | `Cut.fileId` é arquivo de plotter próprio, **não** referencia `Layout` (FATO). No clone há 1 corte. |
| Cotador | `layout-dimensions.controller.ts:52-73`, `layout-dimensions.service.ts:139-173` | lê **PDF** por `fileId` + medidas por `truckId`; faces `MOTORISTA`=esq., `SAPO`=dir., `TRASEIRA`. "É a ORDEM, não a geometria, que diz qual é qual" (`:131-134`). **Não tem FRENTE.** |

### 2.3 Eventos, lembretes e o fluxo PARALELO da O.S. de ARTE

| peça | onde | fato |
|---|---|---|
| Eventos | `layout.events.ts:1-35` | `LayoutApprovedEvent(layout, task, approvedBy: User)`, `LayoutReprovedEvent(…, reason?)` — **o aprovador é `User`**; não cabe responsável. |
| Listener | `layout.listener.ts:54-61, 74-118, 146, 201` | `artwork.approved`, `artwork.reproved`, `artwork.pending_approval_reminder` via `dispatchByConfiguration` (só funcionário) |
| Lembrete diário | `task-notification.scheduler.ts:513-560` | `DRAFT` > 24 h com tarefa ativa → COMMERCIAL/ADMIN |
| Templates | `notification-template.service.ts:101-127` (`task.layout.added/updated/removed`), `:355-366` (`service-order.layout-waiting-approval`) | |
| O.S. de ARTE | `schema.prisma:3955-3963` (`WAITING_APPROVE`), `service-order.permissions.ts:37-39,100-104,211` ("Designer → WAITING_APPROVE → Admin → COMPLETED"), `service-order.service.ts:728-750,1675-1684` | **É este fluxo que libera a produção**: `task-service-order-sync.ts:121-151, 614-618` passa PREPARATION→WAITING_PRODUCTION quando ≥1 O.S. de ARTE `COMPLETED` e as comerciais concluídas. **Nada liga a O.S. ao `Layout.status`.** |

**INFERÊNCIA:** hoje existem DUAS aprovações de arte desconectadas — `Layout.status` (comercial/admin, na galeria) e `ServiceOrder{ARTWORK}.WAITING_APPROVE→COMPLETED` (admin, na O.S.) —, e a que manda na produção é a segunda. Os 1.729 veículos com O.S. de arte concluída e nenhum layout provam isso.

### 2.4 `Budget.layoutFiles` — TODOS os pontos (o que R1 remove)

| # | arquivo:linha | o que faz hoje | destino no R1 |
|---|---|---|---|
| 1 | `schema.prisma:762,773,808,1963` | FK `File.quoteLayoutId` + relação `QUOTE_LAYOUT` | sai (depois da migração de dados, §6) |
| 2 | `prisma/migrations/20260804180000…/migration.sql:44-48` | `file_blocking_references()` cita `"quoteLayoutId"` pelo nome | **`CREATE OR REPLACE` na MESMA migração que dropa a coluna** — senão todo `DELETE FROM "File"` estoura |
| 3 | `file-reference.service.ts:12-52` | espelho em TS da referência de saída (`quote-layouts`, "layout aprovado de orçamento") e `:75` `Layout.fileId` | tirar a entrada de saída; atualizar a de `Layout` |
| 4 | `file.service.ts:484-528` `cloneFileForQuoteLayout` | clona arquivo para o orçamento | some com o orçamento; **mas** `task.service.ts:13394` o usa para clonar FOTO DE MEDIDA na cópia de tarefa — renomear/realocar, não apagar |
| 5 | `file.service.ts:553-591` `resolveLayoutFileIdsForQuote` | decide clonar | some |
| 6 | `file-organization-scheduler.service.ts:314-337`, `file-migration.service.ts:92-119,219-242`, `files-storage.service.ts:76,207,302,464` | pasta `quote-layouts` → `Clientes/{cliente}/Layouts/{PDFs,Imagens}` | contexto novo para arte do implemento / projetos (§3.9) |
| 7 | `utils/sync-quote-task-layouts.ts` (482 linhas, 3 funções) | orçamento → galeria da tarefa; reprova não-selecionados | **apagar inteiro** (e os imports) |
| 8 | `budget.service.ts:75-77` | import do sync | sai |
| 9 | `budget.service.ts:530-541, 575` (create) | clona e conecta `layoutFileIds`; devolve `layoutFiles` | sai |
| 10 | `budget.service.ts:709-716` (create) | sync + reprovação autoritativa | sai |
| 11 | `budget.service.ts:824, 2191, 5805` | `include layoutFiles` em releituras | sai |
| 12 | `budget.service.ts:1038-1063` `filterToMaterialChanges` | compara `layoutFileIds` por conjunto | sai o ramo; manter a chave no `NON_QUOTE_UPDATE_KEYS`/descarte (§7) |
| 13 | `budget.service.ts:1156-1159, 1494-1510, 1558` (update) | captura antes, `set`, relê | sai |
| 14 | `budget.service.ts:1569-1597` | `layoutFileIds` no changelog do orçamento | sai de `fieldsToTrack` (changelog histórico continua legível: `changelog-fields.ts:781` fica) |
| 15 | `budget.service.ts:1604-1617` (update) | sync + reprovação | sai |
| 16 | `budget.service.ts:2330, 2355` + `utils/budget-merge-rules.ts:71,323-333` | união de orçamentos: aviso `LAYOUT` "o layout aprovado do nº X prevalece" | sai o aviso e o campo do candidato; testar `tests/quote-merge-rules.test.ts` |
| 17 | `budget.service.ts:2627, 2667` (delete) | `layoutFileIds` no snapshot do changelog para rollback | sai do snapshot novo; o **restaurador** (`task.service.ts:11646-11662`) tem de **ignorar** a chave em changelog antigo, não tentar `layoutFiles.set` |
| 18 | `budget.service.ts:3558-3563` (comentário), **`3640-3649` `budgetApprove`** | **portão: "Selecione um layout aprovado antes de aprovar o orçamento."** | **sai** (ver §3.6 para onde vai a exigência de arte) |
| 19 | `budget.service.ts:5511-5514` `findPublic` | página pública devolve `layoutFiles` | sai (a página pública do web precisa do mesmo corte — fora do meu recorte) |
| 20 | `budget.guards.ts:215` | `layoutFileIds` em `QUOTE_SAFE_AFTER_BILLING_FIELDS` | manter enquanto a chave for aceita-e-ignorada (§7), senão a trava do dinheiro recusa a gravação INTEIRA do app antigo |
| 21 | `budget-prisma.repository.ts:248-256, 330-340` | `connect`/`set` crus | sai |
| 22 | `budget-prisma.repository.ts:396-397` | `mapIncludeToDatabaseInclude` repassa `layoutFiles` | **tem de DESCARTAR a chave** (o zod ainda a aceita — senão 500) |
| 23 | `budget-prisma.repository.ts:656` | include padrão | sai |
| 24 | `schemas/budget.ts:160` | `budgetIncludeSchema.layoutFiles` | manter aceito e descartado no mapeador (compat) — ou remover do zod (descarte calado); **nunca** deixar chegar ao Prisma |
| 25 | `schemas/budget.ts:122-136` | `tasks.include.layouts` (forma do app) | vira include do implemento (outra equipe renomeia) |
| 26 | `schemas/budget.ts:935-936, 1008-1009, 1176-1177` | `layoutFileIds` `.max(2)` em create / update / nested | aceitar-e-ignorar com log (§7) |
| 27 | `types/budget.ts:74, 145`; `types/task.ts:748-768` (`quote.include.layoutFiles`) | tipos que "convidam" a pedir relação | remover — é a armadilha "tipo que passa no tsc e pede relação inexistente" |
| 28 | `task-prisma.repository.ts:254` | include PADRÃO da tarefa pede `quote.layoutFiles` | **sai — senão TODA leitura de tarefa dá 500** |
| 29 | `task-prisma.repository.ts:1873-1905, 2001-2004` (create), `2232, 2354, 2461, 2580-2584` (update) | orçamento aninhado com `layoutFileIds` + sync | sai |
| 30 | `task.service.ts:2378, 3455-3490` + `task.controller.ts:756` | upload `quoteLayoutFile` (≤2) vira `quote.layoutFileIds` | aceitar o campo multipart e **recusar com 400 explicativo** ou redirecionar para arte do implemento (§7) |
| 31 | `task.service.ts:6520-6590` | troca de orçamento da tarefa grava `layoutFileIds` antigo/novo no changelog | sai |
| 32 | `task.service.ts:11646-11662, 11700-11705` | rollback recria `layoutFiles` + sync | ignorar chave antiga; sai o sync |
| 33 | `task.service.ts:13350-13430` | copiar orçamento de outra tarefa clona `layoutFiles` | sai (a arte é do implemento, não se copia com o preço) |
| 34 | `task.service.ts:14603` | sync após vincular | sai |
| 35 | `task.service.ts:66`, `task-prisma.repository.ts:37` | imports do sync | saem |
| 36 | `signature-envelope.service.ts:561, 626-631` (preflight) e **`1077-1108` (emissão)** | **portão: "Selecione um layout aprovado antes de enviar o orçamento para assinatura."** | **sai** |
| 37 | `signature-envelope.service.ts:2464-2466, 2567` | imagens do layout no documento | sai (ou vira ilustração — §3.8) |
| 38 | `quote-snapshot.service.ts:207, 326, 389, 530, 594` | snapshot e recorte material | **v8 + tolerância** (§3.8) — NÃO simplesmente apagar |
| 39 | `quote-diff.ts:65, 100, 114, 566, 1103-1120` | linha MATERIAL "Layout aprovado" | pular quando o lado novo não tem a chave (§3.8) |
| 40 | `quote-html.builder.ts:291, 404, 794-799` | seção `LAYOUT` | fica (documentos antigos só existem em PDF congelado; o builder atual sai sem imagem) |
| 41 | `quote-renderer.service.ts:170-182, 455-489, 566-629, 718-726, 1041` | orçamento de altura com arte | fica (sem imagem, caminho sem arte) |
| 42 | `quote-sections.ts:52, 80, 97, 113-118, 137-138` | seção `LAYOUT`; FINANCEIRO sem ela; **MARKETING só com ela** | ver §3.8 (MARKETING passaria a assinar um documento VAZIO) |
| 43 | `portal-read.service.ts:1048, 1115-1117` | detalhe do orçamento no portal seleciona `layoutFiles` | sai |
| 44 | `portal-projection.service.ts:233, 576, 790-791` | `view.layout.files` do orçamento | sai (a arte passa a ser do veículo) |
| 45 | `include-access-control.ts:72, 185` | allowlist de include da tarefa com `layouts` | substituir pelo novo caminho |
| 46 | `scripts/verify-signature-sections.ts`, `scripts/verify-signature-layout.ts`, `tests/quote-diff.test.ts`, `tests/portal-recorte.test.ts`, `tests/quote-merge-rules.test.ts`, `tests/dossier-signed-trail.test.ts`, `tests/signature-refusal.test.ts` | régua existente que menciona layout | atualizar junto — são o que prova que v1–v7 continuam reproduzíveis |

### 2.5 Os portões que exigem layout (todos no ORÇAMENTO)

| portão | onde | mensagem | após R1 |
|---|---|---|---|
| Aprovação comercial (também é o gancho da assinatura concluída — `budget.module.ts:82-84`, `signature-envelope.service.ts:6699-6720`) | `budget.service.ts:3640-3649` | "Selecione um layout aprovado antes de aprovar o orçamento." | **remover** |
| Preflight de emissão | `signature-envelope.service.ts:626-631` | "Selecione um layout aprovado antes de enviar…" | **remover** |
| Emissão do envelope | `signature-envelope.service.ts:1077-1108` | idem + "a coleta ficaria concluída com o orçamento parado" | **remover** |
| Cliente web (espelho) | fora do recorte (web/app) | mesma frase | remover lá (outra equipe) |
| IN_NEGOTIATION / PRE_APPROVED / REQUESTED | `portal-decision*.ts` | **não** exigem layout (FATO: grep) | nada |
| PREPARATION → WAITING_PRODUCTION | `task-service-order-sync.ts:121-151` | exige O.S. de ARTE concluída, **não** layout | **é aqui que a exigência de arte deve morar** (§3.6) |

**Efeito colateral BOM (FATO + INFERÊNCIA):** o beco do nº 591 (três envelopes selados, orçamento PENDING, zero layouts — `signature-envelope.service.ts:1084-1088`) deixa de existir por construção: a conclusão da assinatura aprova o orçamento sem depender de arte.

### 2.6 Portal do Responsável — o que ele já faz com arte, veículo e medidas

| peça | onde | fato |
|---|---|---|
| Recorte de TELA = assinatura ∪ capacidades | `portal-capabilities.ts:268-340` (`SECTION_IMPLIED_BY_CAPABILITY`, `portalSectionsFor`) | `LAYOUT` libera "artes, logomarca, arquivos-base, cores" (`PORTAL-CONTRATO.md:62-63`) |
| Quem vê `LAYOUT` hoje | `quote-sections.ts:128-141` | COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR, PURCHASING, **MARKETING**; FINANCIAL não; FLEET_MANAGER/DRIVER só por capacidade (`REQUEST_BUDGET ⇒ VEHICLE+LAYOUT`, `:301`) |
| Capacidades | `portal-capabilities.ts:48-59, 134-180` | 5: REQUEST_BUDGET, PRE_APPROVE, WRITE_PURCHASE_ORDER (todos), WRITE_VEHICLE_IDENTITY, TRACK. **Nenhuma de arte.** |
| Arte do VEÍCULO no portal | `portal-read.service.ts:1214-1222`, `portal-projection.service.ts:878-891` | só `Layout` **APPROVED** (`where` no select **e** filtro no projetor) → `layout.artworks` |
| Arte do ORÇAMENTO no portal | `portal-read.service.ts:1115-1117`, `portal-projection.service.ts:790-791` | `view.layout.files` |
| Identidade / medidas (leitura) | `portal-read.service.ts:202-229` (`TASK_BASE_SELECT`), `portal-projection.service.ts:841-867` | `identity.measures = { left, right, back }` em **METROS** (conversão é da borda) |
| Escrita de identidade + medidas | `PATCH /cliente/me/veiculos/:taskId/identificacao` — `portal-identity.service.ts:157-161, 472-493, 629-700` | escopo **comercial** (pagador ∨ dono, sem o caminho pessoal), capacidade `WRITE_VEHICLE_IDENTITY`; medidas em CENTÍMETROS com chaves **`esquerda/direita/traseira`**; substitui a face (não acumula) |
| Requisição com medidas | `schemas/portal-request.ts:328-397, 425-448, 626-640` (`medidaParaPrisma`), `portal-request.service.ts:211-215` | idem, `medidas?: { esquerda, direita, traseira }` |
| Guarda do documento congelado | `portal-vehicle-identity.ts:111-158`, `portal-frozen-document.ts` | compara **valor cru de enum** de `category`/`implementType` impresso × desejado → 409 |
| Upload no portal | `portal-request.controller.ts:96` (`baseFiles` ≤30), `portal-identity.controller.ts:107` (`truckVinPlate` ≤1) | **não há upload de arte nem de projeto** |
| Notificação a contato | `portal-notification.service.ts:37-46, 142-190`, CHECK `Notification_exactly_one_recipient` | 4 chaves; `responsibleRecipient()` pronto para reuso |

**Duas armadilhas vivas que o rework herda (FATO):**

- `portal-identity.service.ts:654` — `tx.implementMeasure.delete(...).catch(() => undefined)` **dentro de transação interativa**: se o `DELETE` falhar (ex.: FK de `PaintingAnalysis.implementMeasure`), o Postgres aborta a transação e o `catch` engole só o primeiro erro — o comando seguinte falha com "current transaction is aborted". Mesma classe em `sync-quote-task-layouts.ts:106-111, 352-357, 475-480` (engole erro dentro do `tx` do orçamento). O R1 apaga a segunda; a primeira tem de ser corrigida ao mexer em medidas.
- `portal-identity.service.ts:472-493` — o `mexeNoCaminhao` que já custou "200 que não grava". Toda chave nova (frente, porta traseira, projeto) **tem de entrar nessa conta**.

### 2.7 R6 — PROJETO: confirmação

| afirmação | evidência | veredito |
|---|---|---|
| "Layout" da tarefa mistura desenho cotado (PDF) e arte (imagem) | 177 PDF + 196 imagens em `Task.layouts`; nomes de PDF `"TMR 1550 - 244.pdf"`, `"BOI GORDO 540 - 217.pdf"` (cliente + números) | **CONFIRMADO** |
| O PDF é o "projeto da tarefa" (medidas para colagem) | o cotador só aceita PDF + medidas do caminhão (`layout-dimensions.controller.ts:52-73`, `layout-dimensions.service.ts:139-190`) e se diz "o cotador do layout" | **CONFIRMADO** (é o consumidor) |
| `projectFiles` é o projeto da carroceria (Furgões) | 4 arquivos, todos PDF, nomes com número de série de 5 dígitos da Furgões (`PROJETO 38221 - TARENTO.pdf`, `32567 - LAYOUT.pdf`) e um `CamScanner` | **CONFIRMADO** (4 casos; nenhum nome de layout cita "Ibiporã"/"furg") |
| O orçamento só guarda ARTE | `File.quoteLayoutId`: 133 imagens, 4 PDFs | **CONFIRMADO** (4 exceções para triar à mão) |

---

## 3. Desenho proposto

### 3.1 Modelo de dados da ARTE no implemento

O ponto que decide o modelo (FATO): hoje uma linha `Layout` é compartilhada por até 40 tarefas com **um status só** — "aprovar a arte compartilhada por 60 caminhões aprova para os 60 e reprovar em um reprova em todos" (ADR 0121). R2/R7 pedem aprovação **no implemento**.

| opção | forma | a favor | contra |
|---|---|---|---|
| **A (recomendada)** | `Layout.implementId` (1:N, obrigatório para `kind=BRANDING`), `@@unique([implementId, fileId])`, **sem** `fileId @unique`; estado por linha | estado por veículo sem tabela extra; espelha o `Implement 1—N Layout` do monorepo; a mesma imagem pode estar em 60 implementos sem clonar bytes | `File.layouts` vira LISTA → muda o formato de toda resposta de arquivo (`file-prisma.repository.ts:73-75, 115-121`, tipos `types/file.ts:37`) — **renomear a relação** (`File.implementArtworks`) para o erro ser de tipo, não silencioso; reescrever os `findUnique({ where: { fileId } })` (`task.service.ts:903, 1061`, `airbrushing.service.ts:1878`, `file.service.ts:267`, `file-migration.service.ts:101`, `file-organization-scheduler.service.ts:287`) |
| B | `Layout` global (`fileId @unique`) + `ImplementLayout{implementId, layoutId, status, …}` | `File.layouts` continua to-one | o status sai de `Layout` e vai para a junção: TODO leitor de `Layout.status` (portal, aerografia, galeria, cotador) muda de caminho; dois lugares para "a arte" |
| C | clonar o `File` por implemento, manter `fileId @unique` | nenhuma mudança de forma em `File` | ~210 clones só para os 40 layouts compartilhados de hoje, e 60 cópias de bytes a cada orçamento de frota — foi exatamente o `cloneFileForQuoteLayout` que R1 manda embora |

Campos novos em `Layout` (recomendação):

```prisma
model Layout {
  id            String        @id @default(uuid())
  implementId   String?       // obrigatório quando kind = BRANDING (CHECK em SQL)
  airbrushingId String?       // mantém a arte da aerografia onde está (DECISÃO — §8 D7)
  kind          LayoutKind    @default(BRANDING)   // BRANDING | AIRBRUSHING
  fileId        String
  version       Int           @default(1)
  status        LayoutStatus  @default(DRAFT)      // tirar o @default(APPROVED) mentiroso
  sentAt              DateTime?  // entrou em aprovação
  decidedAt           DateTime?
  approvalSource      LayoutApprovalSource?  // PORTAL | ON_BEHALF | MIGRATED
  decidedByResponsibleId String?             // contato do cliente (Representative)
  decidedByUserId        String?             // funcionário, só em ON_BEHALF / reprovação interna
  decisionNote           String?  @db.Text   // obrigatório em REPROVED e em ON_BEHALF
  fileSha256             String?             // hash dos bytes NO ATO da decisão (prova do que foi aprovado)
  supersedesId           String?  @unique
  createdById            String?
  @@unique([implementId, fileId])
  @@index([implementId, status])
}
enum LayoutStatus { DRAFT PENDING_APPROVAL APPROVED REPROVED SUPERSEDED }
```

- ⚠️ `ALTER TYPE "LayoutStatus" ADD VALUE` não pode ser usado na mesma transação em que é criado (o Postgres exige commit antes de usar o valor novo). Migração em **dois arquivos** ou recriar o tipo (precedente `20260901120000`, citado em `PORTAL-DO-RESPONSAVEL.md:357`).
- O web e o app mandam hoje `'DRAFT' | 'APPROVED' | 'REPROVED'` (`schemas/task.ts:2697,2991,3000`, `airbrushing.ts:902-981`). Esses três **continuam valendo** — só se acrescenta. Nada de renomear `REPROVED` para `REJECTED`.
- `Task.layouts` (m2m) **sai** depois do backfill; a leitura "artes desta tarefa" passa a ser `task.implement.layouts`. Enquanto o app antigo existir, o include `layouts` da tarefa deve ser **traduzido** no mapeador para o do implemento (§7), não repassado.

### 3.2 Estados e transições da arte

```
          designer/comercial envia            responsável aprova (portal)
 DRAFT ─────────────────────────────▶ PENDING_APPROVAL ──────────────────────▶ APPROVED
   ▲                                    │   │  comercial/admin "em nome do cliente"  ▲
   │  nova versão (supersede)           │   └──────────────────────────────────────┘
   │                                    │ responsável reprova (motivo obrigatório)
   └──────────── REPROVED ◀─────────────┘
 APPROVED ──(nova versão APROVADA)──▶ SUPERSEDED
```

| transição | quem | efeito colateral |
|---|---|---|
| `DRAFT → PENDING_APPROVAL` | DESIGNER, COMMERCIAL, ADMIN | a O.S. de ARTE vai a `WAITING_APPROVE` (se houver aberta); notifica os aprovadores do cliente |
| `PENDING_APPROVAL → APPROVED` | contato com `APPROVE_ARTWORK` no escopo do veículo (portal) | carimba `decidedAt`, `decidedByResponsibleId`, `fileSha256`, `approvalSource=PORTAL`; a O.S. de ARTE vai a `COMPLETED` → dispara a liberação para produção já existente (`task-service-order-sync.ts:614-618`); versão anterior `APPROVED` → `SUPERSEDED` |
| `PENDING_APPROVAL → REPROVED` | idem, **motivo obrigatório** | O.S. de ARTE volta a `IN_PROGRESS` (o caminho já existe: `service-order.service.ts:700-720`); notifica designer + comercial |
| `DRAFT|PENDING → APPROVED` (ON_BEHALF) | COMMERCIAL, ADMIN (mesma régua de `canApproveLayouts`) | `approvalSource=ON_BEHALF`, `decidedByUserId`, `decisionNote` **obrigatória** ("aprovado por WhatsApp em 23/09, contato Fulano") |
| `APPROVED → REPROVED` | ninguém direto | só por nova versão; **arte aprovada não "desaprova"** — se o cliente mudou de ideia, é versão nova |
| upload em lote (`bulkUploadFiles`, `task.service.ts:13244-13251`) | ADMIN | deixa de nascer `APPROVED`; nasce `DRAFT` ou `ON_BEHALF` com nota |

**Aprovar para N veículos de uma vez:** a UX do portal é "aprovar esta arte para os veículos marcados" (padrão: todos os veículos do mesmo orçamento que têm a MESMA imagem pendente). No servidor são N atualizações numa transação, cada uma com o seu carimbo — o registro é por veículo.

### 3.3 Quem aprova — a matriz (DECISÃO do dono, com recomendação)

**Regra recomendada:** "aprova a arte quem hoje recebe a seção `LAYOUT` para assinar" — é a mesma régua (`sectionsForRoles`) que o portal já usa, e não inventa um terceiro mapa.

| papel | assina `LAYOUT` hoje (`quote-sections.ts:128-141`) | `APPROVE_ARTWORK` proposta | vê arte PENDENTE | vê arte APROVADA |
|---|:-:|:-:|:-:|:-:|
| COMMERCIAL | ✅ | ✅ | ✅ | ✅ |
| SELLER | ✅ | ✅ | ✅ | ✅ |
| REPRESENTATIVE | ✅ | ✅ | ✅ | ✅ |
| COORDINATOR | ✅ | ✅ | ✅ | ✅ |
| PURCHASING | ✅ | ⚠️ ✅ pela régua — **DECISÃO** (Compras aprovar arte é estranho) | ✅ | ✅ |
| **MARKETING** | ✅ (só ela) | ✅ — **é o dono natural** | ✅ | ✅ |
| FINANCIAL | — | — | — | — |
| FLEET_MANAGER | — | — | — | ✅ (via `TRACK`/`VEHICLE`? hoje não vê `LAYOUT`) |
| DRIVER | — | — | — | — |

- `SECTION_IMPLIED_BY_CAPABILITY[APPROVE_ARTWORK] = ['VEHICLE', 'LAYOUT']`.
- `ROLE_CAPABILITIES` é `Record<RESPONSIBLE_ROLE, …>` (`portal-capabilities.ts:108-113, 134`): acrescentar a capacidade obriga decidir para os 9 papéis — bom.
- **Escopo (DECISÃO):** aprovar arte é escrita. Recomendo o **escopo comercial** (`commercialTaskScopeWhere`: pagador ∨ dono), o mesmo de `WRITE_VEHICLE_IDENTITY` (`PORTAL-CONTRATO.md:174-178`) — sem o caminho pessoal (c). Isso deixa a **Furgões (pagadora) aprovar arte de caminhão da RKO**; se o dono quiser que só o DONO da marca aprove, restringe a (b).
- ⚠️ `tests/portal-recorte.test.ts` guarda as DUAS tabelas-verdade (assinatura × tela) e falha se alguém as unificar; ela tem de ganhar a coluna nova.

### 3.4 O que acontece com a ASSINATURA do orçamento (R1 × ADR 0121)

| tema | ADR 0121 (monorepo, 03/09) | pedido de 23/09 | consequência |
|---|---|---|---|
| dono da arte | a TAREFA | o IMPLEMENTO | o monorepo já tem `Implement`; no legado `Truck` é 1:1 com a tarefa, então "por implemento" = "por veículo" |
| quem aprova | **a assinatura do orçamento** ("não existe aprovar layout como gesto separado") | **o responsável, no portal**, como ato próprio | o PDF assinado deixa de conter a arte; a prova da aprovação vira `Layout.decided*` + `fileSha256` + sessão OTP do portal |
| mudar arte aprovada | emenda do orçamento, envelope novo | versão nova da arte, **não mexe no contrato** | o caso nº 973 ("trocaram o layout de um orçamento assinado e as assinaturas caíram", `budget.module.ts:109-120`) deixa de existir |
| portal | "não ganha botão de aprovar arte" | ganha | inverso |
| orçamento tem arquivo de layout? | não | não | **concordam** |

**INFERÊNCIA jurídica (para o dono decidir):** a assinatura PAdES com OTP é prova mais forte que um clique numa sessão OTP do portal. Para arte isso parece suficiente (o litígio típico é "aplicaram a arte errada", e `fileSha256` + quem + quando + IP responde). Se não for, a alternativa é uma **cerimônia leve** da arte (declaração + OTP no ato) — mais custo, mais prova.

### 3.5 Assinatura após R1 — o que NÃO pode quebrar

**O mecanismo (FATO):** `onQuoteContentChanged` (`signature-envelope.service.ts:6884-7004`) reconstrói o snapshot do orçamento AO VIVO (`buildForQuote`) e, se o hash completo mudou, testa o recorte material em TODAS as versões conhecidas (`matchesFrozenTerms`, `quote-snapshot.service.ts:681-723`); nenhuma bateu → `INVALIDATED`, signatários `VOIDED`, e o orçamento volta a PENDING. Roda em RUNNING **e** em COMPLETED, e em todo ato de assinar.

**Sem cuidado:** `build()` passa a emitir `layoutFileIds: []` (ou nada) → nas versões 1–7 a projeção leva `[]` ≠ o `[a,b]` congelado → **toda coleta com arte cai** no próximo toque. `withDefaults` (`quote-diff.ts:560-567`) ainda escreve "2 imagens → Sem layout" como MATERIAL.

**O conserto (recomendação):**

1. `QUOTE_SNAPSHOT_SCHEMA_VERSION = 5` (`quote-snapshot.service.ts:218`): snapshot novo **sem** a chave `layoutFileIds` (tipo passa a `layoutFileIds?: string[]`, `:207`).
2. `QUOTE_MATERIAL_SCHEMA_VERSION = 8` (`:294`), `SUPPORTED_MATERIAL_VERSIONS = [8,7,…,1]` (`:297`): a v8 **não emite** `layoutFileIds`; v1–v7 continuam emitindo `[...(s.layoutFileIds ?? [])].sort()` byte a byte.
3. Nova tolerância `tolerateDetachedLayout(current, frozen)` em `matchesFrozenTerms`, aplicada **sempre** (não como candidata opcional): se `current.layoutFileIds === undefined`, copia `frozen.layoutFileIds`. Justificativa: depois do R1 o orçamento não TEM arte, então a arte congelada é, por definição, a que continua valendo para aquele contrato. Combina com as demais (`:696-715`).
4. `quote-diff.ts:1103-1120`: comparar layout **só quando os dois lados têm a chave**; e `withDefaults` (`:566`) deixa de fabricar `[]`.
5. **Documentos:** nada a re-renderizar — `original.pdf` é imutável (`signature-envelope.service.ts:14`); verificação pública lê o JSON congelado. FATO.
6. Teste obrigatório: para cada envelope RUNNING/COMPLETED de um dump de produção, `matchesFrozenTerms(buildForQuote(), quoteTermsSha256, quoteSnapshot)` ≠ `null` **antes e depois** da migração. É a régua que decide se o deploy pode ir.

**Seções do documento (DECISÃO):** `LAYOUT` não pode sair de `QUOTE_SECTIONS` (a chave `variantKey` já está gravada em `EnvelopeDocument`, `quote-sections.ts:36-44, 57-65`). Mas `ROLE_DEFAULT_SECTIONS[MARKETING] = ['LAYOUT']` (`:138`) passaria a gerar um documento **só com cabeçalho, veículo e linha de assinatura** — marketing assinando papel vazio. Recomendação: MARKETING → `[]` (não assina orçamento; aprova arte no portal), e `LAYOUT` sai de `TOGGLEABLE_SECTIONS` para emissões novas. O modal de emissão do web precisa do mesmo corte (outra equipe). `isFullSections` compara por COMPRIMENTO (`:198-200`) — cuidado ao mexer na lista de alternáveis.

### 3.6 Onde a exigência de arte passa a morar (portão de produção)

- **Hoje:** exigência de arte = orçamento (`budgetApprove`, emissão). Liberação da produção = O.S. de ARTE concluída.
- **Proposta (DECISÃO):** ligar a O.S. de ARTE à arte do implemento:
  - `ServiceOrder{ARTWORK}` só vai a `COMPLETED` se o implemento da tarefa tiver ≥1 arte `APPROVED` (ou `ON_BEHALF`). Designer continua só podendo mandar a `WAITING_APPROVE` (`service-order.permissions.ts:211`).
  - Aprovação no portal fecha a O.S.; reprovação a reabre.
  - O portão automático PREPARATION→WAITING_PRODUCTION continua o mesmo (`task-service-order-sync.ts`), agora com significado real.
  - **Só para trabalho novo:** 1.729 veículos têm O.S. de arte concluída sem layout. Nada retroativo.
  - "Disponibilizar para produção" manual continua sem portão (decisão de 02/07, memória `task-preparation-commercial-gate-2026-07-02`) — **DECISÃO** se passa a exigir arte.

### 3.7 Invalidação quando a arte muda e notificações

| evento | regra | notificação |
|---|---|---|
| nova versão enviada com uma `APPROVED` vigente | a vigente continua valendo para a produção até a nova ser aprovada; a nova nasce `PENDING_APPROVAL` com `supersedesId` | "Nova versão da arte aguardando sua aprovação" → contatos com `APPROVE_ARTWORK` no escopo |
| nova versão aprovada | anterior → `SUPERSEDED` | produção (`artwork.approved`, existente) + designer |
| reprovada | motivo obrigatório | designer + comercial (`artwork.reproved`, existente — o `reprovedBy` passa a poder ser contato) |
| pendente > 24 h | lembrete | hoje só para COMMERCIAL/ADMIN (`task-notification.scheduler.ts:513-560`); acrescentar o lembrete ao CONTATO pelo `PortalNotificationService` (`responsibleRecipient`), chave nova `layout.portal_pending_approval` |
| arte trocada com coleta de assinatura viva | **nada acontece com a assinatura** (por construção, §3.5) | — |

⚠️ `LayoutApprovedEvent`/`LayoutReprovedEvent` tipam o ator como `User` (`layout.events.ts:6-23`); `layout.listener.ts:93,146` passa `approvedBy.id` como `userId` do dispatch. Com aprovação por contato, **não** pode gravar id de `Responsible` em FK de `User` — é o GOTCHA-mestre do `@UserId()` (memória de 17/09). O evento precisa de ator discriminado `{ kind: 'USER'|'RESPONSIBLE', id }`.

### 3.8 O que o responsável informa do implemento pelo portal

| dado | onde grava (legado renomeado) | rota | capacidade | observação |
|---|---|---|---|---|
| medidas esq./dir./tras. | faces do implemento (METROS) | `PATCH …/identificacao` (existe) | `WRITE_VEHICLE_IDENTITY` | chaves da borda `esquerda/direita/traseira` (requisição e PATCH); leitura `left/right/back` |
| **medida FRONTAL** (R5) | face nova | idem + requisição | idem | chave de borda **`frente`**, de leitura **`front`**; entrar em `LADOS_DA_MEDIDA` (`portal-identity.service.ts:157-161`), `portal-request.service.ts:211-215`, `portalMedidasSchema` (`schemas/portal-request.ts:393-397`), `TASK_BASE_SELECT` (`portal-read.service.ts:224-226`), `projectVehicle` (`portal-projection.service.ts:857-861`) e no `mexeNoCaminhao`. Cotador ganha `FRENTE` — mas ele identifica face por ORDEM (`layout-dimensions.service.ts:131-134`): acrescentar uma quarta página muda a heurística (risco do motor, não do portal). |
| **porta traseira** (R5): bipartida/tripartida, nº de varões 2/3/4, nº de portinholas | implemento ou face traseira (DECISÃO da equipe de modelo) | idem | idem | zod: `tipo: z.enum(['BIPARTIDA','TRIPARTIDA'])` na borda → enum em inglês no banco; `varoes: 2|3|4` (CHECK em SQL); `portinholas: int ≥ 0`. **Não é impresso** no orçamento → fora de `VEHICLE_IDENTITY_FIELDS` (sem 409) |
| **projeto do implemento** (Furgões) | `Implement.projectFiles` (relação nova) | rota nova `POST /cliente/me/veiculos/:taskId/projeto` (multipart, PDF/imagem) | `WRITE_VEHICLE_IDENTITY` ou capacidade nova `WRITE_IMPLEMENT_PROJECT` (DECISÃO) | a Furgões é PAGADORA no caso 259–262 → entra no escopo comercial. ⚠️ bloqueador de §9 do desenho do portal: **todo arquivo é público por UUID** |
| categoria / tipo | implemento | idem (existe) | idem | ⚠️ se R4 **mudar os VALORES** do enum, a guarda do documento congelado compara valor cru (`portal-vehicle-identity.ts:155-157`) e devolve **409** a quem reenviar o mesmo dado com o nome novo; e o snapshot congelado guarda os valores antigos (`quote-snapshot.service.ts:488-496`). Precisa de **tabela de equivalência** antigo→novo na comparação. |
| aprovar / reprovar arte | `Layout` | `PUT /cliente/me/veiculos/:taskId/artes/:layoutId/{aprovar,reprovar}` + variante em lote `PUT /cliente/me/artes/aprovar { layoutIds[] }` | `APPROVE_ARTWORK` | `404` fora do escopo (nunca 403); motivo obrigatório na reprovação |
| ver artes pendentes | `GET /cliente/me/artes?status=PENDING_APPROVAL` | leitura | seção `LAYOUT` | entra no "o que espera por mim" do `/cliente/me/resumo` |

⚠️ **Chaves do snapshot são contrato congelado.** O rename `Truck→Implement` e `implementType→type` NÃO pode renomear as chaves JSON `vehicles[].category` / `vehicles[].implementType` / `truck` do snapshot (`quote-snapshot.service.ts:92-120, 176-182, 488-496`). Mudar a chave muda o hash COMPLETO de todo envelope → cada ato de assinar roda o diff e grava `SNAPSHOT_DRIFTED`. O `build()` lê do campo novo e escreve na chave velha.

### 3.9 Projeto da TAREFA × projeto do IMPLEMENTO (R6)

| | projeto da TAREFA | projeto do IMPLEMENTO |
|---|---|---|
| o que é | o PDF cotado de colagem (hoje "layout" PDF) | o desenho da carroceria (Furgões Ibiporã) |
| hoje | 177 `Layout` PDF em `Task.layouts` | 4 PDFs em `Task.projectFiles` |
| dono | tarefa (serviço da Ankaa) | implemento (do cliente/fabricante) |
| aprovação | interna (não vai ao cliente) — DECISÃO se tem estado `DRAFT/READY` como o `ExecutionPlan` do ADR 0121 | nenhuma (é documento de referência) |
| quem escreve | designer / comercial | comercial, logística, **responsável pelo portal** |
| consumidor | cotador `/layout-dimensions` (PDF + medidas), plotter/corte | designer (para desenhar), portal |
| relação sugerida | `Task.projectFiles` (reaproveitar `TASK_PROJECT_FILES`) **ou** nome novo `Task.applicationPlanFiles` — DECISÃO | `Implement.projectFiles` (`IMPLEMENT_PROJECT_FILES`) |

**Recomendação de nome:** **não reaproveitar** `Task.projectFiles` com significado novo. O app instalado envia `projectFileIds`/`projectFiles` pensando no significado antigo e cairia no lugar errado sem erro. Criar nomes novos (`Task.stickerPlanFiles` / "Projeto de aplicação" e `Implement.bodyProjectFiles` / "Projeto do implemento") e fazer a chave antiga `projectFiles` responder 400 "campo renomeado" depois da janela de compatibilidade. Pasta física: `files-storage.service.ts:137` já tem `taskProjectFiles: 'Projetos'`; o projeto do implemento precisa de contexto próprio.

---

## 4. A branch `feat/orcamento-veiculos` (outra sessão)

**FATO:** 8 commits de 23/09 (`2b58fc6a … 2d4e729b`) sobre `2bc5eccf` (main de 22/09), **não** sobre a branch do portal (merge-base `e81fd9f1`). 25 arquivos, +3.140/−195. Migration `20260923120000_layout_aprovado_por_veiculo` **não aplicada** no clone local.

| commit | o que muda | conflito com R1 | reaproveitável? |
|---|---|---|---|
| `2b58fc6a` | `Budget.layoutScope` (`SHARED`/`PER_VEHICLE`), tabela `BudgetLayoutTask(fileId, taskId)` | **total** — cria mais estado de layout no orçamento | ❌ o modelo. ✅ **como fonte da migração**: se chegar à produção antes do rework, suas linhas são exatamente o mapa "arte → veículo" que o backfill precisa (§6 passo 3) |
| `079e6c82` | galeria de cada veículo recebe e impõe só o layout aprovado DELE (reescreve `sync-quote-task-layouts.ts`, +323/−?) | total — R1 apaga o arquivo | ❌ |
| `e0df4b50` | campo `layouts: [{fileId, taskIds?}]` em create/update; portas legadas (`layoutFileIds`) recusadas em PER_VEHICLE com 400; `QUOTE_SAFE_AFTER_BILLING_FIELDS += 'layouts'`; limites 2/veículo, 20/orçamento | total | ✅ a IDEIA de "porta legada recusa com endereço da tela nova" (mensagem `PER_VEHICLE_LEGACY_WRITE_MESSAGE`) é o molde da política de compatibilidade (§7) |
| `b9bfb190` | portões de layout exigem layout de CADA veículo e **nomeiam o que falta** (`layoutGateFailure`, `tasksWithoutLayout`, `describeVehicleList`) | o portão sai do orçamento | ✅ **a função que nomeia o veículo sem arte** vai direto para o portão de produção / O.S. de ARTE (§3.6) |
| `3a041693` | snapshot ganha `layoutCoverage` condicional (sem versão nova), diff "Layout aprovado por veículo", legenda da arte no documento (`layoutCaptions`) | conflita com a v8 do §3.5 | ✅ o raciocínio "chave CONDICIONAL que não muda o hash de quem não a tem" é o mesmo da tolerância proposta. ⚠️ Se isto for à produção, envelopes congelados COM `layoutCoverage` precisam da MESMA tolerância na v8 (copiar do congelado) |
| `cb11ffb3` | **medir um veículo mede os demais do mesmo orçamento** (`utils/implement-measure-replication.ts`, por CÓPIA de linha, só o lado que difere, exclusão não replica) | nenhum com R1 | ✅✅ **reaproveitável inteiro** — mas: (a) não cobre o caminho do PORTAL (`portal-identity.service.ts`, que só existe na outra branch); (b) só conhece `left/right/back` (`MEASURE_SIDES`) — precisa da FRENTE e das opções de porta; (c) com o rename, "irmão" continua sendo "tarefa do mesmo orçamento" |
| `6bcb6a56` | retirar veículo e reenviar layout não deixa cobertura órfã | total | ❌ |
| `2d4e729b` | `tests/layout-per-vehicle.test.ts` (903 linhas) | parcial | ✅ os casos de replicação de medida e de rótulo de veículo |

**O que conflita com R1, em uma frase (INFERÊNCIA):** a outra sessão resolveu "arte por veículo" **dentro do orçamento**; R2 resolve o mesmo problema **no implemento**, e R1 tira o orçamento da conversa. As duas são vizinhas na intenção (Carlotti nº 990: cada caminhão com a sua pintura) e opostas no lugar.

**DECISÃO do dono:** a branch vai à produção como remendo até o rework? Se sim, (1) o rework herda `BudgetLayoutTask`/`layoutScope` e precisa migrá-los; (2) a v8 precisa tolerar `layoutCoverage`; (3) o merge com `feat/portal-do-responsavel` tem conflito certo em `budget.service.ts`, `task.service.ts`, `task-prisma.repository.ts`, `quote-snapshot.service.ts`, `signature-envelope.service.ts`, `schemas/budget.ts`. **Recomendação:** não levar os commits de layout (`2b58fc6a`, `079e6c82`, `e0df4b50`, `b9bfb190`, `3a041693`, `6bcb6a56`); levar só `cb11ffb3` (medidas) — rebaseado sobre o portal — e extrair `vehicleLabel`/`describeVehicleList`/`layoutGateFailure` para o portão novo.

---

## 5. Contrato do Portal — o que muda (resumo para quem implementar)

| item | hoje | depois |
|---|---|---|
| `PORTAL_CAPABILITY` | 5 | +`APPROVE_ARTWORK` (+ talvez `WRITE_IMPLEMENT_PROJECT`) |
| `SECTION_IMPLIED_BY_CAPABILITY[REQUEST_BUDGET]` | `['VEHICLE','LAYOUT']` | manter (quem pede descreve arte) |
| `PortalBudgetView.layout` (`portal-projection.service.ts:576`) | artes do orçamento | **remover**; a arte vive em `vehicles[].layout` |
| `PortalVehicleView.layout.artworks` | só `APPROVED` | `artworks: [{ id, file, status, version, decidedAt, decidedBy: { name }, canDecide }]`; `PENDING_APPROVAL` visível a quem tem `LAYOUT`; `DRAFT`/`SUPERSEDED` nunca |
| `PortalVehicleView.identity.measures` | `{ left, right, back }` | `{ left, right, back, front }` + `rearDoor: { type, lockRods, hatches } | null` (METROS; chave `back`, nunca `rear`) |
| `PortalVehicleView.identity` | — | `projectFiles: PortalFileRow[]` (projeto do implemento) |
| `web/src/api-client/portal.ts` | espelho | **tem de casar campo a campo** (`PORTAL-CONTRATO.md:199-206`: deriva não dá erro de compilação e já custou `canSign`/`declaracoes`) |
| Testes | `test:portal-recorte`, `test:portal-escopo`, `test:portal-identificacao`, `test:portal-cliente:boot` | + `test:portal-arte` (tabela-verdade de `APPROVE_ARTWORK`, 404 fora do escopo, motivo obrigatório, lote atômico) e as rotas novas no teste de boot |

---

## 6. Migração de dados — ordem sugerida (INFERÊNCIA; SQL à mão, como a casa faz)

1. **Pré-condição:** bateria de SELECT do §1 no dump de produção; e a régua do §3.5-6 (todo envelope RUNNING/COMPLETED casa) **antes**.
2. Criar colunas novas de `Layout` (nullable), enum novo (em migração separada do uso), `Implement` já renomeado (outra equipe).
3. **Arte (imagem) → implemento:** para cada linha m2m `(Layout L, Task T)` com `File.mimetype LIKE 'image/%'`, criar/atribuir `Layout(implementId = implemento de T, fileId = L.fileId, status = L.status)`. Os 40 layouts compartilhados viram N linhas (uma por implemento). `approvalSource = 'MIGRATED'` nos `APPROVED`.
4. **Arte do orçamento → implemento:** para cada `File` com `quoteLayoutId = Q` e cada tarefa de Q: se há gêmeo (nome+tamanho) no implemento → gêmeo vira `APPROVED` (**15 casos hoje `DRAFT`** — DECISÃO: o orçamento manda?); se não há (**52 pares**) → nova `Layout APPROVED`, `MIGRATED`, com o **mesmo `fileId`** do orçamento (os bytes já são cópia privada). Se `BudgetLayoutTask` existir (a outra branch foi à produção), usar as linhas dela em `PER_VEHICLE` em vez do "todos os veículos".
5. **PDF → projeto da tarefa:** `Layout` PDF (177) → relação nova de projeto da tarefa (sem estado de aprovação, ou `READY`); os 4 PDFs de orçamento, triagem manual.
6. **`Task.projectFiles` (4) → projeto do implemento.**
7. O.S. de ARTE `WAITING_APPROVE` (31): cada uma precisa de uma arte `PENDING_APPROVAL` no implemento, senão o portal não mostra nada para aprovar. Triagem.
8. `CREATE OR REPLACE FUNCTION file_blocking_references` **sem** `quoteLayoutId` — **na mesma migração** do passo 9.
9. Dropar `File.quoteLayoutId` e a m2m `_TaskLayouts` (só depois de o app antigo sair da janela de compatibilidade — §7), e `Budget.layoutFiles` do schema.
10. Deploy: **builde antes de migrar** (janela de 500 conhecida); `systemctl`, não `pm2` (memória de 16–17/09).

---

## 7. Compatibilidade — política por campo (o app instalado fica para trás)

| entrada antiga | origem provável | hoje | política recomendada | por quê |
|---|---|---|---|---|
| `layoutFileIds` em create/update de orçamento (e no bloco `quote` da tarefa) | app, faturamento, modal "Layout do Orçamento" da Agenda | grava | **aceitar e IGNORAR**, `logger.warn` com rota e versão; manter em `QUOTE_SAFE_AFTER_BILLING_FIELDS` | o formulário do app reenvia o orçamento inteiro; recusar derrubaria o save TODO (preço, validade) por um campo que não existe mais |
| `include: { layoutFiles }` no orçamento | app (`kTaskQuoteDetailInclude` em cache — `schemas/budget.ts:150-156`) | vira include | aceitar no zod, **descartar no mapeador** (`budget-prisma.repository.ts:396-397`) | zod enumerado; o que passar chega ao Prisma e dá 500 |
| `include: { quote: { include: { layoutFiles } } }` na tarefa | web `DETAIL_INCLUDE`, app | passthrough | **sanitizar no mapeador da tarefa** (remover a chave em qualquer profundidade) | `prismaRelationValue` é `z.record` recursivo (`schemas/task.ts:1098-1119`) — 500 garantido |
| `include: { layouts }` na tarefa / `truck.include.task.include.layouts` (`schemas/truck.ts:38`) | web, app | m2m | traduzir para `implement.layouts` durante a janela, devolvendo no formato antigo (`task-prisma.repository.ts:810-830` já achata `layout.file`) | galeria do app não some |
| `layoutIds` / `layoutStatuses` / `newLayoutStatuses` no `PUT /tasks/:id` | web, app | cria/aprova | aceitar e **redirecionar** para a arte do implemento; `APPROVED` só com `approvalSource=ON_BEHALF` e sem nota → **400 pedindo a nota** (DECISÃO: ou `DRAFT` silencioso, como hoje para não-aprovadores) | não perder upload do designer no app antigo |
| multipart `quoteLayoutFile` | web/app antigos | clona | **400** "o layout agora é do veículo: use a aba Arte" | é gesto do fluxo que morreu; engolir o arquivo seria perder a arte |
| multipart `layouts` / `airbrushings[i].layouts` | web, app | cria Layout | aceitar; PDF → projeto da tarefa? **DECISÃO** (roteamento automático por mimetype é conveniente e mágico) | |
| `projectFiles` / `projectFileIds` | web, app | `TASK_PROJECT_FILES` | se o nome for reaproveitado com outro sentido, o app antigo grava no lugar errado **sem erro** → usar nomes novos (§3.9) | |
| novos campos (arte, projeto, frente, porta) em `PUT /tasks/:id` | web novo | — | **incluir no mapa de domínio** `task.permissions.ts` | campo fora do mapa = negado a todos menos ADMIN, em silêncio (`:57-62`) |

---

## 8. Checklist anti-regressão R8 — no meu recorte

| armadilha (classe) | onde neste rework | como pegar |
|---|---|---|
| include passthrough → 500 | `quote.include.layoutFiles`, `layouts`, `truck` (renomeado) em `schemas/task.ts:1120-1145` | teste: `GET /tasks/:id?include=` com o `DETAIL_INCLUDE` do web e o `kTaskQuoteDetailInclude` do app, depois da migração, contra banco clonado |
| include enumerado → some calado | `budgetIncludeSchema`, `quoteTasksIncludeSchema.layouts` | asserção de que a chave nova (arte do implemento) aparece na resposta |
| `select` explícito descarta chave nova | `portal-read.service.ts:202-229, 1212-1222`, `QUOTE_SNAPSHOT_INCLUDE`, `DEFAULT_TASK_INCLUDE` | grep por cada `select:` que cita `truck`/`layouts`; o portal tem `toPortalPlainNumbers` mas nada que ache chave faltando |
| tipo convida relação inexistente | `types/budget.ts:74,145`, `types/task.ts:233,428,607,748-768`, `types/file.ts:37` | remover junto com o schema |
| função SQL cita coluna | `file_blocking_references` (`quoteLayoutId`) | `DELETE` de arquivo de teste depois da migração |
| erro engolido dentro de `tx` | `sync-quote-task-layouts.ts` (sai), `portal-identity.service.ts:654` (fica) | trocar `.catch(() => undefined)` por verificação prévia |
| hash congelado muda por nome de chave | chaves JSON do snapshot (`category`, `implementType`, `truck`, `layoutFileIds`) | régua §3.5-6 |
| enum renomeado × valor congelado | `TruckCategory`/`ImplementType` na guarda de 409 e no snapshot | tabela de equivalência; teste com snapshot v4 real |
| capacidade/papel novo sem decidir | `ROLE_CAPABILITIES` é `Record` total (bom), `ROLE_DEFAULT_SECTIONS` também | tsc pega |
| campo novo fora do mapa de permissão | `task.permissions.ts` | teste por setor (DESIGNER, LOGISTIC, COMMERCIAL) mandando cada campo novo |
| "200 que não grava" | `mexeNoCaminhao` (`portal-identity.service.ts:472-493`) | teste: PATCH só com `medidas.frente` grava |
| notificação com id de contato em FK de `User` | `layout.listener.ts:93,146` | ator discriminado |
| lembrete/cron lendo relação que sumiu | `task-notification.scheduler.ts:523-548` (`layout.tasks`) | cron não aparece no teste de rota — grep `prisma.layout` |
| arquivos de pasta/organização | `file-organization-scheduler.service.ts:287, 314-337`, `file-migration.service.ts:101-119` (`layout.tasks[0].customer`) | idem |

---

## 9. Decisões que só o dono pode tomar (com recomendação)

| # | decisão | recomendação | por quê |
|---|---|---|---|
| D1 | A aprovação da arte sai de dentro da assinatura do orçamento (contra o ADR 0121)? | **Sim**, ato próprio no portal, com `fileSha256` e trilha | é o pedido; separa contrato (dinheiro) de arte (marketing); acaba com o nº 591 e o nº 973 |
| D2 | Quem aprova (matriz §3.3) — PURCHASING entra? | régua da assinatura: quem recebe `LAYOUT` hoje; **tirar PURCHASING** se o dono achar estranho | uma régua só |
| D3 | Escopo: pagador (Furgões) pode aprovar arte de caminhão de outro dono? | **sim** (escopo comercial, igual à identidade) | caso 259–262 |
| D4 | MARKETING deixa de assinar orçamento? | **sim** (`ROLE_DEFAULT_SECTIONS[MARKETING] = []`) | senão assina documento vazio |
| D5 | A arte aprovada vira portão de PRODUÇÃO (via O.S. de ARTE)? | **sim, só para trabalho novo**; "Disponibilizar" manual continua livre | 1.729 veículos sem arte registrada |
| D6 | Modelo A (Layout 1:N implemento) × B (junção) | **A**, renomeando `File.layouts` | estado por veículo sem tabela extra |
| D7 | Arte de AEROGRAFIA também vai para o implemento? | **não** nesta rodada (fica em `Airbrushing`); `kind` já prevê a mudança | 0 linhas no clone; o pintor é outro fluxo (NFS-e, pagamento) |
| D8 | Nomes: projeto da tarefa / do implemento | nomes NOVOS, não reaproveitar `projectFiles` | app antigo gravaria no lugar errado sem erro |
| D9 | Na migração, os 15 gêmeos `DRAFT` na tarefa e "aprovados" no orçamento viram `APPROVED`? | **sim**, `MIGRATED` | o orçamento era a autoridade de "aprovado" desde 06/2026 |
| D10 | `feat/orcamento-veiculos` vai à produção antes? | **só** o commit de medidas (`cb11ffb3`), rebaseado | o resto é apagado pelo R1 |
| D11 | Arte aprovada em nome do cliente exige nota? | **sim**, obrigatória | é a única prova de um ato que aconteceu fora do sistema |
| D12 | Janela de compatibilidade do app antigo (quanto tempo aceitar-e-ignorar `layoutFileIds`) | até o Shorebird/loja cobrir ≥95% dos aparelhos; depois 400 | o app fica atrás (R8) |

---

## Perguntas ao dono

1. A aprovação da arte pelo responsável **substitui** a assinatura como prova (ADR 0121 dizia o contrário)? Ou você quer uma "cerimônia leve" (declaração + código) no ato de aprovar arte?
2. Quais papéis do cliente aprovam arte? Só MARKETING? MARKETING + COMERCIAL/VENDEDOR/REPRESENTANTE/COORDENADOR? Compras também?
3. A Furgões (que paga, mas não é dona do caminhão) pode aprovar a arte do caminhão do cliente dela?
4. O contato de MARKETING continua assinando o orçamento depois que a arte sair dele?
5. Arte não aprovada deve **impedir** a produção (O.S. de arte não conclui) ou só avisar?
6. Uma arte aprovada pode ser "desaprovada" pelo cliente, ou mudança é sempre versão nova?
7. Quando o designer manda uma versão nova, a produção continua vendo a aprovada anterior até a nova ser aprovada?
8. Porta traseira: "quantidade de varões" é por folha ou total? "Portinholas" é contagem total? Isso é dado do implemento ou só da face traseira? Vale para todo tipo (sider/prancha não têm porta)?
9. O projeto da Furgões pode ser enviado pelo portal (o contato da Furgões sobe o PDF)? Só PDF ou imagem também?
10. O PDF cotado (projeto da tarefa) passa a ter estado próprio (rascunho/pronto) ou é só arquivo?
11. A aerografia continua com a arte dela na própria aerografia?
12. A branch `feat/orcamento-veiculos` (Carlotti nº 990) vai à produção como remendo antes do rework?

## Riscos

| # | risco | gravidade | mitigação |
|---|---|---|---|
| R-1 | Invalidação em massa de coletas RUNNING **e COMPLETED** (e volta do orçamento a PENDING) ao remover o layout do snapshot | ⛔ crítica | v8 + `tolerateDetachedLayout` + régua sobre todos os envelopes vivos (§3.5) antes do deploy |
| R-2 | Todo `DELETE` de arquivo passa a dar 500 por causa de `file_blocking_references` | ⛔ crítica | `CREATE OR REPLACE` na mesma migração (§6-8) |
| R-3 | `DEFAULT_TASK_INCLUDE` com `quote.layoutFiles` → 500 em TODA leitura de tarefa | ⛔ crítica | item 28 da §2.4; teste de boot com includes reais |
| R-4 | App instalado continua mandando `layoutFileIds`/`quoteLayoutFile`/`include.layoutFiles` | alta | política da §7 (aceitar-e-ignorar / descartar / 400 explicativo) |
| R-5 | `File.layouts` muda de objeto para lista → telas quebram caladas | alta | renomear a relação (modelo A) |
| R-6 | Mudança de valores de enum (R4) gera 409 falso na guarda do documento congelado e drift de snapshot | alta | tabela de equivalência + manter chaves JSON do snapshot |
| R-7 | Aprovação por contato gravando id de `Responsible` em FK de `User` (eventos/listener) | alta | ator discriminado no evento |
| R-8 | Portão novo de arte bloquear veículos antigos (1.729 sem layout) | alta | só para trabalho novo, por data ou por existência de arte `PENDING` |
| R-9 | Conflito de merge com `feat/orcamento-veiculos` em 6 arquivos centrais | média | decidir D10 antes de começar |
| R-10 | Cotador identifica face por ORDEM; face FRONTAL muda a heurística | média | tratar no motor (fora do recorte), com o bench existente |
| R-11 | `ALTER TYPE ADD VALUE` usado na mesma transação | média | migração em dois arquivos |
| R-12 | Arquivos públicos por UUID: arte pendente e projeto da Furgões acessíveis a quem tiver o link | média (pré-existente) | pacote R10 do portal (§9 de `PORTAL-DO-RESPONSAVEL.md`) |
| R-13 | Dados do clone ≠ produção (clone tem 1 corte, 0 análises de pintura, 2 aerografias) | média | repetir as queries do §1 no dump de produção |
| R-14 | `sync-quote-task-layouts` engole erro dentro de `tx` hoje (pode abortar a transação do orçamento) — some com R1; `portal-identity.service.ts:654` fica | baixa/média | corrigir junto |
