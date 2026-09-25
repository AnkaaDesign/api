# 01 — Modelo de dados, SQL cru, dados reais e estratégia de migração

Recorte: modelo Prisma atual, SQL cru e objetos de banco, perfil dos dados no clone local, modelo-alvo e migração de dados, decisão 1:1 × implemento independente.
Branch lida: `api@feat/portal-do-responsavel` (`ad3c65d4`). Nada foi escrito em repositório nem no banco. Todas as consultas rodaram em transação `SET TRANSACTION READ ONLY` (script em `scratchpad/q.js`).

Legenda: **[FATO]** = li no código ou no dado (com arquivo:linha ou nome da consulta). **[INF]** = inferência minha. **[DONO]** = decisão que só o dono toma.

---

## 0. Resumo executivo

1. **[FATO] O clone local está congelado em ~30/06/2026.** O último arquivo real (`/srv/files/...`) é de 2026-06-30 19:38; tudo depois disso é teste/seed (tarefas "Teste", "QA Pos-correcao Joint", "Tetetetete", e a bateria e2e-portal de 20–21/09). O `createdAt` mais recente de Task é 2026-09-21 00:57 (`ESPERA273788`, seed do e2e). O ADR 0121 do monorepo (03/09) cita números de produção maiores (597 Layout = 283 PDF + 311 imagem; 157 layouts de orçamento em 153 orçamentos; 2.208 tarefas). **Todos os números abaixo precisam ser medidos de novo em produção, no ensaio em transação revertida (§7).**
2. **[FATO] O `Layout` de hoje é dois objetos diferentes na mesma tabela.** 237 PDFs + 242 imagens + 2 `.eps`. 149 dos 237 PDFs têm nome no padrão `CLIENTE COMPRIMENTO - ALTURA` (`TMR 1550 - 244.pdf`, `BOI GORDO 641-240.pdf`): é o desenho cotado da Ankaa, o "projeto da tarefa" do R6. O próprio app diz isso (`mobile-flutter/lib/features/production/task_detail_widgets.dart:88-91`: "o PDF é o arquivo de PRODUÇÃO — é dele que sai o recorte e é ele que abre cotado").
3. **[FATO] O "projeto do furgão" (Furgões Ibiporã) NÃO está em `projectFiles`: está em `Task.baseFiles`.** `projectFiles` tem só 4 arquivos, e os 4 são projetos da Furgões (`PROJETO 38221 - TARENTO.pdf`, `37786 - LAYOUT.pdf`). Já `baseFiles` tem 152 PDFs no padrão `PROJETO NNNNN - CLIENTE.pdf` / `NNNNN - LAYOUT.pdf`, e em 59 deles o número bate com `Task.serialNumber`. Ou seja, **o nome "projectFiles" hoje significa "projeto do furgão", e o R6 quer usá-lo para "projeto da tarefa"**. Isso é armadilha de transição (app antigo grava o furgão no lugar novo) — ver §4.4.
4. **[FATO] O M2M `_TaskLayouts` compartilha status entre veículos.** 40 layouts estão ligados a mais de uma tarefa (máximo **40 tarefas numa linha só**, `WhatsApp Image 2026-06-09...jpeg`), 3 ligados a clientes diferentes, 10 com tarefas em status diferentes. Aprovar essa linha aprova para os 40. Mover a arte para o implemento resolve isso, **desde que cada implemento tenha a sua linha** (fan-out, §5.3).
5. **[FATO] Três objetos de banco quebram em silêncio ou em cascata se a migração só mexer no Prisma:**
   - `file_blocking_references()` (gatilho `BEFORE DELETE ON "File"`) cita `"quoteLayoutId"` literalmente (`prisma/migrations/20260804180000_file_referenced_delete_guard/migration.sql:43-48`). Derrubar a coluna sem reescrever a função faz **toda exclusão de arquivo do sistema falhar** (plpgsql só resolve a coluna em tempo de execução).
   - `FileReferenceService.getReferences` monta `select` a partir de `OUTBOUND_REFERENCES` (`api/src/modules/common/file/services/file-reference.service.ts:41-53` e `:318-321`). Tirar `quoteLayoutId` do schema quebra o `select`; **esvaziar a lista também quebra** (Prisma recusa `select: {}`), e o serviço falha FECHADO: nenhum arquivo pode mais ser excluído e o organizador noturno para de posicionar arquivos.
   - `paint.service.ts:503-517` faz `LEFT JOIN "Truck"` em SQL cru dentro de `try/catch` que devolve `[]`. Renomear a tabela sem mexer aqui **não dá erro**: a busca de tinta por placa/série simplesmente passa a não achar nada.
6. **[FATO] Renomear tabela é barato e já tem precedente na casa**: `20260917200000_orcamento_vira_budget` (TaskQuote→Budget) e `20260705130000_rename_layout_artwork_borrow_cleanup` (Artwork→Layout, Layout→ImplementMeasure). O schema não usa `@@map` para renomear modelo. Recomendo `ALTER TABLE "Truck" RENAME TO "Implement"` (§5.1).
7. **Recomendação estrutural para ESTA entrega**: manter **1:1** (`Implement.taskId @unique`, `Cascade`), **não** mover `Task.serialNumber` agora, e desenhar de modo que a virada para "implemento independente" seja aditiva depois (§6). Porta traseira em colunas do **implemento** com CHECK; face frontal como 4ª FK (`frontSideMeasureId`); arte como `Layout.implementId` 1:N com status por linha; projeto da tarefa = `_TASK_PROJECT_FILES` (PDFs saem do Layout); projeto do implemento = novo M2M `_IMPLEMENT_PROJECT_FILES`.
8. **[FATO] 15 dos 16 envelopes de assinatura RUNNING do clone guardam `layoutFileIds` no snapshot**, e `layoutFileIds` está no recorte MATERIAL (`api/src/modules/common/signature/services/quote-snapshot.service.ts:594`). Tirar o layout do orçamento sem uma v8 do recorte material **invalida todas as coletas em andamento** na primeira gravação seguinte do orçamento (§5.6).

---

## 1. Mapa do modelo atual (`api/prisma/schema.prisma`)

### 1.1 Truck (`schema.prisma:2530-2562`)

| Campo | Tipo | Observação [FATO] |
|---|---|---|
| `id` | String uuid | |
| `plate` | String? `@unique` | + `@@index([plate])` redundante (há `Truck_plate_key` **e** `Truck_plate_idx` no banco) |
| `chassisNumber` | String? | sem unicidade; 3 grupos duplicados no clone (6 linhas) |
| `category` | `TruckCategory?` | 10 valores, `schema.prisma:4297-4308` |
| `implementType` | `ImplementType?` | 6 valores, `schema.prisma:4310-4317` |
| `spot` | `TRUCK_SPOT?` `@default(YARD_WAIT)` | ⚠️ default: INSERT sem `spot` põe o veículo no pátio de espera |
| `taskId` | String `@unique` | FK `Truck_taskId_fkey` → Task **ON DELETE CASCADE** (apagar tarefa apaga o caminhão) |
| `backSideMeasureId` / `leftSideMeasureId` / `rightSideMeasureId` | String? | FK → ImplementMeasure; no banco **ON DELETE SET NULL** (o Prisma não declara `onDelete`, mas a constraint real é SET NULL) |
| `vinPlateId` | String? | FK → File, **ON DELETE SET NULL** (`schema.prisma:2547`) |
| `chassisNumberNormalized`, `plateNormalized` | String? | **colunas GERADAS** `lower(immutable_unaccent(...)) STORED` (`20260624150000_accent_insensitive_search/migration.sql:296-298`) |
| índices | `spot`, `plate`, `vinPlateId`, 3× `*SideMeasureId` | |

Não há relação `Truck → Layout` nem `Truck → File` de projeto.

### 1.2 ImplementMeasure / ImplementMeasureSection (`schema.prisma:2564-2590`)

| Modelo | Campos | onDelete [FATO, conferido no catálogo] |
|---|---|---|
| `ImplementMeasure` | `height Float` (METROS), `photoId → File` | `photoId` SET NULL. **A linha não sabe a própria face**: a face é dada por qual FK do Truck aponta para ela |
| back-relations | `trucksBackSide`, `trucksLeftSide`, `trucksRightSide` (listas!), `paintingAnalyses` | uma medida PODE ser apontada por N caminhões (e é — §3.3) |
| `ImplementMeasureSection` | `width Float` (m), `isDoor`, `doorHeight?`, `position` | FK → ImplementMeasure **CASCADE**; índice `(implementMeasureId, position)` **sem unicidade** |

Nenhum CHECK no banco (ex.: `doorHeight` só quando `isDoor`) — a regra vive em `portal-request.ts:640-645` (`medidaParaPrisma`).

### 1.3 Layout + `_TaskLayouts` (`schema.prisma:87-100`)

| Campo | Observação [FATO] |
|---|---|
| `fileId` `@unique` | 1 Layout por arquivo, em todo o sistema. FK → File **CASCADE** |
| `status LayoutStatus @default(APPROVED)` | default do banco também é `'APPROVED'` (conferido em `information_schema`). O ADR 0121 registra que os caminhos de aplicação criam `DRAFT` |
| `airbrushingId?` | FK → Airbrushing **CASCADE** (apagar aerografia apaga a arte dela) |
| `tasks Task[] @relation("TaskLayouts")` | M2M implícito `_TaskLayouts(A=Layout, B=Task)`, ambos CASCADE; PK `(A,B)`, índice em `B` |

Histórico de nome: `Artwork` virou `Layout` e o antigo `Layout` (medidas) virou `ImplementMeasure` em `20260705130000_rename_layout_artwork_borrow_cleanup/migration.sql:18-73`. `ChangeLogEntityType.LAYOUT` foi renomeado para `IMPLEMENT_MEASURE` (`:47`); **não existe entityType para a arte**.

### 1.4 Task — campos do recorte (`schema.prisma:2338-2452`)

| Campo | Observação [FATO] |
|---|---|
| `serialNumber String? @unique` (`:2343`) | + coluna gerada `serialNumberNormalized` + índice GIN trigram `Task_serialNumberNormalized_trgm_idx` (`20260624150000.../migration.sql:254,365`) |
| `truck Truck?` (`:2397`) | lado sem FK do 1:1 |
| `layouts Layout[] @relation("TaskLayouts")` (`:2410`) | M2M |
| `projectFiles File[] @relation("TASK_PROJECT_FILES")` (`:2411`) | M2M `_TASK_PROJECT_FILES(A=File, B=Task)` CASCADE, criada em `20260225120000_add_project_checkin_checkout_files/migration.sql:5-17` |
| `baseFiles File[] @relation("TASK_BASE_FILES")` (`:2402`) | M2M. O portal grava a arte que o cliente manda AQUI (`schema.prisma:2031-2032`, comentário de `BudgetRequest.logoName`) |
| `quoteId` (`:2383`) | N tarefas → 1 orçamento desde o multitarefa |

### 1.5 Budget.layoutFiles / File.quoteLayoutId

- `Budget.layoutFiles File[] @relation("QUOTE_LAYOUT")` (`schema.prisma:1983`).
- A FK mora NO File: `File.quoteLayoutId` (`:761`), relação `quoteLayout` **ON DELETE SET NULL** (`:774`), índice `File_quoteLayoutId_idx` (`:832`). Nasceu em `20260623130000_quote_layout_files_relation/migration.sql` (máx. 2 por orçamento, regra de app/zod).
- É uma referência de **saída** do File, invisível ao catálogo de FKs de entrada — foi o ponto cego que apagou 32 layouts aprovados em 07/06 (`20260804180000.../migration.sql:1-24`).

### 1.6 File — back-relations envolvidas (`schema.prisma:753-833`)

| Back-relation | Linha | Tabela/coluna real | onDelete |
|---|---|---|---|
| `layouts Layout?` | 764 | `Layout.fileId` (unique) | CASCADE (apagar File apaga Layout) |
| `implementMeasurePhotos` | 767 | `ImplementMeasure.photoId` | SET NULL |
| `truckVinPlates` | 768 | `Truck.vinPlateId` | SET NULL |
| `quoteLayout` | 774 | `File.quoteLayoutId` → Budget | SET NULL |
| `taskBaseFiles` | 790 | `_TASK_BASE_FILES` | CASCADE (só o vínculo) |
| `taskProjectFiles` | 797 | `_TASK_PROJECT_FILES` | CASCADE (só o vínculo) |
| `paintingFaceFiles` / `paintingFaceOverlays` | 777-778 | `PaintingAnalysisFace.fileId/overlayFileId` | sem onDelete (RESTRICT) / SET NULL |
| `taskCuts` | 766 | `Cut.fileId` | RESTRICT |

Além disso: o gatilho `file_no_delete_when_referenced` barra `DELETE FROM "File"` enquanto houver qualquer referência (§2).

### 1.7 PaintingAnalysis (`schema.prisma:8851-8885`)

`implementMeasureId → ImplementMeasure` **SET NULL**, `taskId → Task` SET NULL. `PaintingFaceView` já tem `FRONT` (`:8751-8757`). **[FATO] 0 linhas no clone** — o motor de pintura não tem dado a migrar.

### 1.8 Airbrushing / Cut

- `Airbrushing.layouts Layout[]` (`schema.prisma:73`), via `Layout.airbrushingId` CASCADE. **[FATO] 0 layouts de aerografia no clone** (produção pode ter — aerografia entrou no ar em 05/07, depois do clone).
- `Cut.fileId → File` RESTRICT (`:2518`), `Cut.taskId` sem onDelete. **[FATO] 1 Cut no clone**, nenhum Layout usa o arquivo de um Cut.

### 1.9 Enums

| Enum | Valores | Onde é usado no banco [FATO] | Histórico |
|---|---|---|---|
| `ImplementType` | DRY_CARGO, REFRIGERATED, INSULATED, CURTAIN_SIDE, TANK, FLATBED | só `Truck.implementType` | — |
| `TruckCategory` | MINI, VUC, THREE_QUARTER, RIGID, TRUCK, SEMI_TRAILER, SEMI_TRAILER_2_AXLES, B_DOUBLE_FRONT, B_DOUBLE_REAR, BITRUCK | só `Truck.category` | recriado em `20260610120000_split_b_double_compartments` (B_DOUBLE→FRONT); valores adicionados em `20260415000001` |
| `TRUCK_SPOT` | YARD_WAIT, YARD_EXIT, B1..B3_F1..F3_V1..V3 | só `Truck.spot` | recriado em `20260217000000` (PATIO→NULL) |
| `LayoutStatus` | DRAFT, APPROVED, REPROVED | só `Layout.status` | era `ArtworkStatus` |
| `ChangeLogEntityType` | inclui `TRUCK` e `IMPLEMENT_MEASURE` | ChangeLog: **1.194 linhas TRUCK, 752 IMPLEMENT_MEASURE** | |
| `TruckManufacturer` | (usado em `schema.prisma:1505`, fora do recorte) | não confundir com o implemento | |

---

## 2. SQL cru, colunas geradas, índices, gatilhos e funções

### 2.1 Objetos de banco que citam as tabelas do recorte [FATO, catálogo local]

| Objeto | Onde | O que faz | Impacto do rework |
|---|---|---|---|
| Função `file_blocking_references(text)` | `prisma/migrations/20260804180000_file_referenced_delete_guard/migration.sql:31-81` | referências de ENTRADA lidas do catálogo vivo (dinâmico) + **`"quoteLayoutId"` escrito à mão** (`:43-48`) | ⛔ derrubar `File.quoteLayoutId` exige `CREATE OR REPLACE FUNCTION` sem o bloco, **na mesma migração e ANTES do DROP COLUMN**. A parte de entrada é dinâmica: `Implement.*`, `Layout.implementId` e `_IMPLEMENT_PROJECT_FILES` entram sozinhas |
| Gatilho `file_no_delete_when_referenced` | mesma migração `:116-119` | `BEFORE DELETE ON "File"` | continua; válvula `SET LOCAL ankaa.allow_referenced_file_delete='on'` |
| Colunas geradas `Truck.plateNormalized`, `Truck.chassisNumberNormalized` | `20260624150000.../migration.sql:296-298` | busca sem acento | `RENAME TABLE` e `RENAME COLUMN` de coluna-base funcionam (a expressão fica presa ao attnum). **O que não funciona é `ALTER COLUMN ... TYPE` numa coluna usada por coluna gerada**: aí é DROP da gerada → alterar → recriar (padrão já usado em `20260727150000_truck_vin_plate_image/migration.sql:30-32`) |
| Coluna gerada `Task.serialNumberNormalized` + GIN trigram | `20260624150000.../migration.sql:254,365` | busca por série | só importa se `serialNumber` mudar de tabela (§6) |
| Tabela `_DroppedTruckVinPlateText` | `20260727150000.../migration.sql:18-27` | arquivo morto do texto da plaqueta | 0 linhas no clone; pode sair |
| Views / matviews | — | **nenhuma** no banco | — |
| Outros gatilhos em Truck/Layout/Task/Budget/ImplementMeasure | — | **nenhum** (só o de File) | — |

### 2.2 Migrações que citam as tabelas (histórico, não reexecutam)

| Migração | O que mexe |
|---|---|
| `0_init`, `20260406000000_consolidated_schema_update` | criação de Truck/Artwork/Layout (medidas) |
| `20260217000000_remove_patio_from_truck_spot` | recria `TRUCK_SPOT` (`ALTER ... TYPE ... USING`) |
| `20260222120000_add_yard_spots`, `20260222130000_backfill_yard_wait`, `20260222150000_default_truck_spot_yard_wait` | vagas de pátio + default |
| `20260225120000_add_project_checkin_checkout_files` | cria `_TASK_PROJECT_FILES`; **reescreve `File.path`**: `/Projetos/` → `/Layouts/` e `/Layouts/Orcamentos/` → `/Layouts/` (`:43-50`). Ou seja: a pasta "Projetos" antiga era ARTE e virou "Layouts" |
| `20260415000001_add_bitruck_semi_trailer_2_axles`, `20260610120000_split_b_double_compartments` | `TruckCategory` |
| `20260623130000_quote_layout_files_relation` | cria `File.quoteLayoutId` |
| `20260705130000_rename_layout_artwork_borrow_cleanup` | Layout→ImplementMeasure, Artwork→Layout, `_TaskArtworks`→`_TaskLayouts` (modelo de RENAME completo, com constraints e índices) |
| `20260724120000_truck_vin_plate`, `20260727150000_truck_vin_plate_image` | plaqueta texto → foto |
| `20260804140000_painting_cost_engine` | `PaintingAnalysis.implementMeasureId` (`:51,324`) |
| `20260804180000_file_referenced_delete_guard` | função/gatilho acima |
| `20260917200000_orcamento_vira_budget` | precedente de RENAME de modelo: catálogo só, sem mover byte |

### 2.3 SQL cru e nomes de tabela literais no código da API

| Arquivo:linha | Tipo | O que cita | Falha se não for atualizado |
|---|---|---|---|
| `src/modules/paint/paint.service.ts:503-517` | `$queryRaw` | `LEFT JOIN "Truck" tr1/tr2 ON tr."taskId"`, `tr.plate`, `t."serialNumber"` | ⚠️ **silenciosa**: `catch` devolve `[]` (`:523-526`) — a busca de tinta por placa/série para de achar |
| `src/modules/common/file/services/file-reference.service.ts:41-53` | constante | `OUTBOUND_REFERENCES = [{ column: 'quoteLayoutId', targetTable: 'Budget' }]` | ⛔ select Prisma inválido → `getReferences` lança → falha FECHADO (nada exclui, nada é posicionado) |
| `…/file-reference.service.ts:318-321` | Prisma `select` montado da constante | `select: Object.fromEntries(OUTBOUND_REFERENCES…)` | com lista vazia vira `select: {}` → Prisma recusa. **O bloco inteiro precisa de guarda** |
| `…/file-reference.service.ts:75, 86, 103-107` | chaves `tabela.coluna` | `'Layout.fileId'`, `'_TASK_PROJECT_FILES.A'`, `'ImplementMeasure.photoId'`, `'Truck.vinPlateId'` | silenciosa: chave que não casa vira "referência desconhecida" = protege mas **não posiciona** e o rótulo do erro vira `Implement.vinPlateId` cru. Precisa entrar `'Implement.vinPlateId'`, `'Layout.fileId'` (contexto novo por dono), `'_IMPLEMENT_PROJECT_FILES.A'` |
| `…/file-reference.service.ts:280, 348` | `$queryRaw` / `$queryRawUnsafe` | catálogo `information_schema` + `SELECT 1 FROM "<tabela>" WHERE "<coluna>"` | dinâmico — acompanha o rename sozinho |
| `…/file-organization-scheduler.service.ts:44-62, 287-330, 411-416` | Prisma | `CONTEXT_ENTITY_MAP` (`quote-layouts`, `taskProjectFiles`, `truckVinPlate`), `getCustomerNameForFile` via `layout.tasks`, `file.quoteLayout.tasks`, `truck.task` | compila errado (tsc pega a maioria); ramo sem cliente = arquivo ignorado (não é perda) |
| `src/modules/production/task/task.service.ts:2433-2434` | `$queryRaw` | `SELECT "updatedAt" FROM "Task" … FOR UPDATE` | não afetado |
| `scripts/audit-file-placement.ts:51-69, 99, 121` | `$queryRaw` | `"quoteLayoutId"`, `'_TASK_PROJECT_FILES.A'`, `'Truck.vinPlateId'` | script de manutenção quebra |
| `scripts/dry-run-file-organization.ts:119` | mapa | `_TASK_PROJECT_FILES` | script |
| `tests/signature-refusal.test.ts:123, 226-233` | teste | `quoteLayoutId` | teste quebra (bom sinal) |

Não há `$queryRaw` citando `"Layout"`, `"_TaskLayouts"` ou `"ImplementMeasure"` em `src/` (as ocorrências de "Layout" em `quote-html.builder.ts`/`quote-sections.ts`/`quote-assembler.service.ts` são texto de tela).

### 2.4 Pontos cegos ao `tsc` que citam o dado por string (para o time de código)

[FATO, contagem por `rg`]: api `(x as any).truck` 10×, chave `'truck'` 11×; web `(x as any).truck` 11×, chave `'truck'` 41×; Flutter `['truck']`/`'truck':` **43× em 21 arquivos**, e chaves JSON `layouts/projectFiles/layoutFiles/implementType/*SideMeasure` 71×. Exemplos de api: `src/utils/task.ts:194`, `task.service.ts:1312, 1993, 2552, 10788`, e todo `src/utils/sync-quote-task-layouts.ts` (usa `(prisma as any).layout/budget`, `:58-185`, `:243-461`). Em Dart, JSON por string não é checado pelo analisador: é onde o app "fica para trás" sem erro.

### 2.5 Dados persistidos fora das tabelas que carregam os nomes antigos

| Onde | [FATO] | Tratamento |
|---|---|---|
| `TaskFieldChangeLog.field` | `truck.chassisNumber` 251, `truck.rightSideLayoutId` 209, `truck.backSideLayoutId` 206, `truck.leftSideLayoutId` 206, `truck.category` 109, `truck.plate` 73, `truck.implementType` 49, `truck.spot` 10, `baseFiles` 316, `serialNumber` 104 | histórico é imutável: o mapa de rótulos (`src/utils/changelog-fields.ts:~760`) precisa aceitar **as duas grafias** (`truck.*` e `implement.*`) |
| `ChangeLog` entity `TASK`, field | `layouts` 612, `implementType` 113, `serialNumber` 113 | idem |
| `ChangeLog.entityType` | `TRUCK` 1.194 | **não renomear o valor** nesta fase (mesmo raciocínio do `TASK_QUOTE` em `20260917200000…/migration.sql:21-25`); ids preservados pelo RENAME, histórico continua resolvendo |
| `Preferences.tableConfigsWeb/detailConfigsWeb` | chaves `implementType`, `truckCategory`, `truckSpot`, `measures`, `artworks`, `layout`, `serialNumber` (7 usuários) | colunas de tabela salvas por id; renomear o id da coluna no web orfana a configuração (baixo risco: validada no cliente) |
| `SignatureEnvelope.quoteSnapshot` (JSONB) | `layoutFileIds` em 15/16 RUNNING, 2/3 COMPLETED | §5.6 |

---

## 3. Perfil dos dados (clone local, real até ~30/06/2026)

### 3.1 Datação do clone

| Consulta | Resultado [FATO] |
|---|---|
| `max(Task.createdAt)` | 2026-09-21 00:57 (seed e2e `ESPERA273788`) |
| último arquivo em `/srv/files` | **2026-06-30 19:38** |
| tarefas jul–set | 6 em julho ("Teste", "hello"), 69 em setembro (QA, e2e) |
| última migração aplicada | `20260920190000_fila_hibrida_por_estado` (branch do portal, aplicada local) |
| `max(budgetNumber)` | 631 (produção já passou de 990) |

### 3.2 Truck

| Métrica | Valor [FATO] |
|---|---|
| Truck total | **575** (primeiro em 2026-01-16) |
| Task total | 2.253; **1.678 sem Truck, todas COMPLETED** (anteriores a jan/2026) |
| Truck por status da tarefa | COMPLETED 261, PREPARATION 160, WAITING_PRODUCTION 90, CANCELLED 53, IN_PRODUCTION 11 |
| com placa / chassi / plaqueta | 121 / 242 / 0 |
| placa repetida | 0 (há `@unique`) |
| chassi repetido | 3 grupos, 6 linhas, máx 2 |
| `implementType` | REFRIGERATED 399, **NULL 61**, INSULATED 59, DRY_CARGO 36, CURTAIN_SIDE 17, TANK 3, FLATBED 0 |
| `category` | TRUCK 140, SEMI_TRAILER 105, THREE_QUARTER 95, **NULL 75**, BITRUCK 69, RIGID 56, VUC 21, B_DOUBLE_FRONT 5, MINI 4, SEMI_TRAILER_2_AXLES 3, B_DOUBLE_REAR 2 |
| nulos por status | PREPARATION: tipo nulo 51, categoria nula 61 (de 160) — é o cadastro que o portal deve completar |
| `spot` | NULL 482, YARD_WAIT 79, YARD_EXIT 5, B1_* 5, B2_* 4 |
| `Task.serialNumber` | 2.013 preenchidos, todos distintos; 1.535 com 5 dígitos (padrão Furgões) |

### 3.3 Medidas

| Métrica | Valor [FATO] |
|---|---|
| Truck com back / left / right | 255 / 261 / 261; **304 sem medida nenhuma** |
| ImplementMeasure / seções / seções-porta / com foto | 767 / 1.080 / 157 / 9 |
| medidas órfãs (nenhum Truck, nenhuma análise) | 20 |
| **medidas COMPARTILHADAS** por mais de um Truck | **11 linhas apontadas por 41 caminhões** (duas por 10 caminhões cada, de 16/01, 2 clientes) — editar a medida de um muda a dos outros |
| mesma medida em 2 faces do mesmo Truck | 0 |
| traseira: seções | 248 com 1 seção, 2 com 2, 1 com 3; **0 portas modeladas na traseira** |
| laterais: portas | esquerda: 38 com 1 porta, 2 com 2, 1 com 3, 1 com 4; direita: 80/10/1/1 |
| escala | altura 1,00–2,88 e largura 0,85–15,5 → **tudo em METROS** (nenhum valor em cm) |
| fotos de medida | 8 das 9 estão na traseira |
| `PaintingAnalysis` | 0 |

Consequência [INF]: a porta traseira **nunca foi modelada** pelas seções — a traseira é tratada como um painel único. As opções do R5 (bipartida/tripartida, varões, portinholas) são dado novo, sem nada para migrar.

### 3.4 Layout (`_TaskLayouts`)

| Métrica | Valor [FATO] |
|---|---|
| Layout total | 481 (APPROVED 392, DRAFT 86, REPROVED 3) |
| por tipo | **PDF 237** (APPROVED 222, DRAFT 14, REPROVED 1); **imagem 242** (jpeg 159, png 83; APPROVED 170, DRAFT 72, REPROVED 2); `.eps` 2 |
| com aerografia | 0 |
| **órfãos** (sem tarefa, sem aerografia) | 108 (60 PDF, 46 imagem, 2 eps; 2 deles são arquivo de orçamento) |
| vínculos `_TaskLayouts` | 583 vínculos, 373 layouts, 403 tarefas (img: 369 vínculos/196 layouts/340 tarefas; pdf: 214/177/191) |
| fan-out (tarefas por layout) | 1→333, 2→19, 3→5, 4→4, 5→2, 9→3, 10→2, 12→1, 15→1, 27→1, 30→1, **40→1** |
| layouts em N tarefas de clientes diferentes | 3 (`FRONTA E TRASEIRA PRETO.png` em 4 clientes; `WhatsApp…09.27.40.jpeg` Framento+Ibiporã; `marquespan 831-218.pdf` Marquespan+Marquespan RS) |
| layouts compartilhados com tarefas em status diferentes | 10 |
| tarefas com layout | 403 (com PDF 191, com imagem 340, **com os dois 128**) |
| tarefas com layout sem Truck | 1 (COMPLETED, 2024, só PDF) |
| nomes de PDF `NOME COMP - ALT` | 149/237 (resto: `TERRA VERDE-9,40.pdf`, `2 IRMÃOS-tras.pdf`, `DAVACA_NEW_670.pdf`, um `Recibo - 08_2025-1.pdf` perdido) |
| nomes de imagem | 153/242 com dimensão no nome; 147 são foto de WhatsApp/celular |
| pasta física | PDF: 234 em `Clientes/*/Layouts/PDFs`; imagem: 201 em `Clientes/*/Layouts/Imagens`, **41 em `/srv/files/Fotos`** (pasta genérica), 2 em caminho de dev |
| mesmo `path` em mais de um File (layout/orçamento) | 56 grupos, 124 linhas, máx 5 (no File inteiro: 276 grupos, 580 linhas, máx 12) |
| criação por mês | jan 57, fev 103, mar 87, abr 73, mai 53, jun 100 (PDFs caindo: 54 em fev → 28 em jun) |

Conclusão [FATO+INF]: o PDF é o desenho cotado da Ankaa (projeto da tarefa); a imagem é a arte. O ADR 0121 do monorepo chegou à mesma leitura com os números de produção de 03/09.

### 3.5 Projeto (`_TASK_PROJECT_FILES`) e arquivos base

| Métrica | Valor [FATO] |
|---|---|
| `projectFiles` | **4 vínculos, 4 arquivos, 4 tarefas, todas COMPLETED**: `32567 - LAYOUT.pdf`, `CamScanner 26-02-2026 12.51.pdf`, `37786 - LAYOUT.pdf`, `PROJETO 38221 - TARENTO.pdf` — em `Clientes/*/Projetos/PDFs/` |
| `baseFiles` | 707 vínculos, 517 arquivos, 281 tarefas; 459 imagens, 245 PDFs, 3 octet-stream |
| PDFs de base com cara de projeto da Furgões | **152 de 245** (100 `PROJETO NNNNN - CLIENTE.pdf`, 52 `NNNNN - LAYOUT.pdf`); 59 citam o `serialNumber` da própria tarefa |
| clientes desses PDFs | Sem Limite 40, Luxafit 23, Framento 14, TMR 6, RKO 5, Paraopeba 5… |
| fan-out de PDF de base | 1→75, 2→24 … 40→1 (um projeto cobre vários números de série: `PROJETO 38174 ATÉ 38185 - SEM LIMITE.pdf`) |
| onde esses arquivos estão | muitos em `/srv/files/Auxiliares/` (pasta genérica) |

[INF] O "projeto do implemento" do R6 **já existe no dado, mas mora em `baseFiles`**, e um mesmo PDF de projeto cobre N implementos → a relação do implemento com o projeto tem de ser **M2M**.

### 3.6 Layout do orçamento (`File.quoteLayoutId`)

| Métrica | Valor [FATO] |
|---|---|
| arquivos / orçamentos | 137 / 135 (133 com 1, 2 com 2) |
| tipo | jpeg 117, png 16, **pdf 4** |
| status do orçamento | APPROVED 96, PENDING 38, CANCELLED 1 |
| orçamentos com layout por nº de veículos | 1 veículo: 132; 3: 1; 4: 2 (clone anterior ao grosso do multitarefa) |
| classe de correspondência com o Layout das tarefas do MESMO orçamento | **mesmo fileId 22 · mesmo path (outro File) 25 · mesma imagem por nome+tamanho 24 · sem gêmeo, orçamento com tarefa 52 · orçamento sem tarefa nenhuma 14** |
| status do gêmeo na tarefa | APPROVED 64, DRAFT 15 |
| orçamentos sem tarefa | 105 (PENDING 68, APPROVED 32, EXPIRED 5) |

[INF] O reconciliador orçamento→tarefa (`src/utils/sync-quote-task-layouts.ts:51-199`) não materializou 52 artes (ADR 0121 registra que os reconciliadores estiveram mortos desde o multitarefa). A migração tem de fazer, uma última vez e em SQL, o que ele deveria ter feito.

### 3.7 Assinatura, OS e responsáveis

| Métrica | Valor [FATO] |
|---|---|
| envelopes | RUNNING 16, REFUSED 9, COMPLETED 3, EXPIRED 2, INVALIDATED 2, SUPERSEDED 2, CANCELLED 1 |
| envelopes com `layoutFileIds` não vazio no snapshot | **RUNNING 15/16**, COMPLETED 2/3, EXPIRED 1, INVALIDATED 1 |
| ServiceOrder `ARTWORK` | COMPLETED 2.435, PENDING 550, **WAITING_APPROVE 31**, IN_PROGRESS 17, PAUSED 1 |
| `_TaskResponsibles` | 574 vínculos, 142 responsáveis, 496 tarefas |

### 3.8 Arquivos físicos: mover a relação exige mover o arquivo?

**Não.** [FATO]
- `File.path` é gravado por linha; a URL e o download saem do registro, não da relação.
- `getFolderPath` decide a pasta **no upload** pelo contexto (`files-storage.service.ts:381-490`): `tasksLayouts`/`quote-layouts` → `Clientes/{cliente}/Layouts/{PDFs|Imagens}`, `taskProjectFiles` → `Clientes/{cliente}/Projetos/{PDFs|Imagens}`, `implementMeasurePhotos` → `Traseiras`, `truckVinPlate` → `Plaquetas` (`:126-207`).
- O organizador noturno (04:00, `file-organization-scheduler.service.ts:214-226`) resolve o contexto pela REFERÊNCIA (`:704-720`), mas só considera o arquivo fora do lugar quando ele **não está sob `Clientes/{cliente}/`** — `pathContainsEntityName` ignora o contexto (`:261-275`). Então um PDF que passa de "layout" para "projeto da tarefa" **fica em `Layouts/PDFs`** e ninguém o move. Cosmético, não quebra nada.
- A limpeza de órfãos (03:00, `file-cleanup-scheduler.service.ts:80-160`) só apaga **bytes em disco sem linha em File**; nunca apaga linha File sem referência.
- ⚠️ **Mas**: `FileService.deletePhysicalFile` (`file.service.ts:1186-1210`) apaga os bytes sem conferir se outra linha File usa o mesmo `path`, e há 56 grupos de path compartilhado entre arquivos de layout/orçamento (clones antigos; o código atual copia bytes — `file.service.ts:494-524`). **A migração não pode apagar linha File nenhuma** — só religar.
- Para arquivo novo: criar contextos `implementLayouts` (arte do implemento) e `implementProjectFiles` (projeto da Furgões) no `folderMapping` e no `CONTEXT_ENTITY_MAP`, e decidir a pasta (§8, P6).

---

## 4. Leitura do domínio pelos dados (para amarrar R2, R6 e R7)

### 4.1 O que é da TAREFA (serviço Ankaa) × do IMPLEMENTO (Furgões/cliente)

| Dado | Hoje | É de quem [INF] | Alvo |
|---|---|---|---|
| arte (imagem aprovada pelo cliente) | `Layout` imagem, M2M com Task; `Budget.layoutFiles` | do **implemento** (é a pintura daquele baú) | `Layout.implementId` |
| desenho cotado de colagem (PDF) | `Layout` PDF | da **tarefa** (é como a Ankaa executa) | `Task.projectFiles` |
| projeto do furgão (PDF da Furgões) | 4 em `projectFiles`, ~152 em `baseFiles` | do **implemento** | `Implement.projectFiles` (M2M) |
| arquivos que o cliente manda (logo, foto) | `baseFiles` | da **tarefa** (insumo do serviço) | fica |
| medidas das faces | FKs no Truck | do **implemento** | fica no Implement (+ frontal) |
| porta traseira | não existe | do **implemento** | colunas novas no Implement |
| tipo/categoria | `Truck.implementType/category` | do **implemento** | `Implement.type/category` |
| placa/chassi/plaqueta | Truck | do **veículo/implemento** | fica |
| nº de série Furgões | `Task.serialNumber` | do **implemento** | fica na Task nesta entrega (§6) |
| vaga (`spot`) | `Truck.spot` | da **estadia/tarefa** (o monorepo põe a vaga na tarefa) | fica no Implement enquanto for 1:1 (§6) |

### 4.2 Por que PDF não pode seguir com a arte

- **[FATO]** Status do PDF hoje (222 APPROVED) não é aprovação de cliente: é o que o reconciliador e o default `APPROVED` produziram.
- **[FATO]** O cotador `/layout-dimensions` lê por `fileId` (`api/src/modules/production/layout-dimensions/layout-dimensions.service.ts:175-180`) — mover o vínculo não muda o id do File, então o cotador segue funcionando em cima de `projectFiles`.
- **[FATO]** O app espera o início da produção só para PDF e marca "ARTE REPROVADA" por arquivo (`task_detail_widgets.dart:82-100`) — essas regras mudam de galeria.

### 4.3 Arte aprovada por responsável (R2, R7)

[INF] Com a arte 1:N por implemento, "aprovar a arte do orçamento de 40 caminhões" vira aprovar 40 linhas. O dado fica certo (cada veículo tem o seu estado, fim do "aprovar um aprova 40"), e a tela do portal precisa de **aprovação em lote** ("aprovar para todos os veículos deste pedido"). Isso é UX, não modelo.

### 4.4 Armadilha de nome: `projectFiles`

[FATO] Hoje `projectFiles` = projeto da Furgões (os 4 arquivos, a pasta `Projetos`, o rótulo "projeto de tarefa" em `file-reference.service.ts:86`). O R6 muda o significado para "PDF cotado da Ankaa". Durante a transição, **um app Flutter antigo que gravar um projeto da Furgões em `projectFiles` vai colocá-lo no lugar do desenho cotado, sem erro**. Mitigações em §5.7 e P3.

---

## 5. Modelo-alvo e migração

### 5.1 Implement (rename de Truck)

**Recomendação: `ALTER TABLE ... RENAME` (catálogo), não `@@map`.**

| Critério | `@@map("Truck")` | RENAME TABLE |
|---|---|---|
| custo no banco | zero | segundos (catálogo, transacional, reversível) |
| SQL cru (`paint.service.ts`), catálogo do `file-reference`, scripts | continua `"Truck"` — o nome do banco passa a mentir para sempre | precisa atualizar (5 pontos, §2.3) |
| precedente da casa | nenhum `@@map` de modelo no schema | Budget (17/09), Layout/ImplementMeasure (05/07) |
| risco de `migrate diff` propor DROP/CREATE de índice | não | só se esquecer de renomear constraint/índice (a migração do Budget explica, `…/migration.sql:27-29`) |

Campos do Implement:

| Hoje | Alvo | Nota |
|---|---|---|
| `implementType ImplementType?` | `type ImplementType?` (RENAME COLUMN) | enum mantém o nome e os VALORES (NFS-e rotula por valor: `Isoplastic → Isotérmico`) |
| `category TruckCategory?` | `category ImplementCategory?` (RENAME TYPE) | valores intactos |
| `spot TRUCK_SPOT?` | idem | não renomear o tipo agora (garagem usa `TRUCK_SPOT` em api/web/app) |
| `taskId @unique` Cascade | idem (1:1) | §6 |
| — | `frontSideMeasureId String?` → ImplementMeasure SET NULL | R5 |
| — | `rearDoorLayout RearDoorLayout?` (`BIPARTITE`, `TRIPARTITE`) | R5 |
| — | `rearDoorLockBars SmallInt?` CHECK `IN (2,3,4)` | R5 (varões) |
| — | `rearDoorHatches SmallInt?` CHECK `BETWEEN 0 AND 6` | R5 (portinholas; teto a confirmar) |
| — | `layouts Layout[]` | R2 |
| — | `projectFiles File[] @relation("IMPLEMENT_PROJECT_FILES")` | R6 |

**Por que a porta traseira mora no Implement e não na medida traseira** [INF, apoiada em FATO]:
1. `ImplementMeasure` não sabe a face dela (§1.2): um CHECK "só na traseira" é impossível sem reorganizar a tabela.
2. Medidas são clonadas e compartilhadas (11 linhas × 41 caminhões hoje; a branch `feat/orcamento-veiculos` replica por cópia, commit `cb11ffb3`), e `PaintingAnalysis` também aponta para elas. Configuração de porta presa a uma linha de medida viaja junto com a cópia.
3. O responsável informa a porta sem ter medido nada; nulo = "não informado" sem inventar uma medida vazia.
4. Se o dono quiser as folhas desenhadas, a tela deriva as seções da traseira a partir de `rearDoorLayout` (2 ou 3 folhas) — sem mudar o banco.

**Face frontal: 4ª FK ou reorganizar por face?** Recomendo a **4ª FK** agora. Reorganizar (`ImplementMeasure.implementId + face`, `@@unique([implementId, face])`, como `ImplementFace` do monorepo `46-production.prisma:369-389`) é o desenho certo a prazo, mas mexe em 307 ocorrências de `*SideMeasure` na api (22 arquivos), 201 no web (28), 47 no Flutter (8), no portal (`portal-request.service.ts:213-215` mapeia `esquerda/direita/traseira → coluna`) e na branch de medidas replicadas. Acrescentar `frontSideMeasureId` é o mesmo padrão das outras três e cabe no mapa do portal com uma linha (`{ chave: 'frontal', coluna: 'frontSideMeasureId' }`).

### 5.2 Layout (arte do implemento)

| Hoje | Alvo |
|---|---|
| `fileId @unique` | `fileId` **sem** unique; `@@unique([implementId, fileId])` |
| M2M `tasks` via `_TaskLayouts` | `implementId String?` → Implement **CASCADE**; `_TaskLayouts` some |
| `airbrushingId?` CASCADE | fica (arte de aerografia continua da aerografia) |
| `status @default(APPROVED)` | `@default(DRAFT)` (o default atual contradiz o fluxo) |
| — | `approvedAt`, `approvedByResponsibleId → Responsible SET NULL`, `approvedByUserId → User SET NULL`, `reprovedAt`, `reprovedByResponsibleId`, `reprovalReason Text?`, `approvalSource LayoutApprovalSource?` (`PORTAL`, `INTERNAL`, `LEGACY_BUDGET`, `LEGACY_TASK`) |
| — | CHECK: exatamente um dono — `("implementId" IS NOT NULL) <> ("airbrushingId" IS NOT NULL)` |

Por que 1:N com linha por implemento e não "Layout único + tabela de vínculo com status": a tela, o app e o portal já leem `layout.status` + `layout.file`; com 1:N esse formato sobrevive (muda o dono, não a forma), e o `findUnique({ where: { fileId } })` que hoje existe (`task.service.ts:903`, `airbrushing.service.ts:1878`) passa a não compilar — o `tsc` aponta cada lugar. [INF]

Trilha de decisão: recomendo registrar cada aprovar/reprovar também numa tabela append-only `LayoutDecision(layoutId, decision, source, responsibleId?, userId?, note, createdAt)` — o portal precisa responder "quem aprovou, quando" e a coluna atual só guarda a última palavra. **[DONO]** se entra já.

### 5.3 Projeto da tarefa e projeto do implemento

- **Projeto da tarefa** = `Task.projectFiles` / `_TASK_PROJECT_FILES` (tabela existente, sem mudança estrutural). Recebe os PDFs que saem do `Layout`.
- **Projeto do implemento** = novo M2M implícito `_IMPLEMENT_PROJECT_FILES(A=File, B=Implement)`, CASCADE nos dois lados (padrão das outras M2M de arquivo). M2M porque um PDF da Furgões cobre N números de série (§3.5).
- Os 4 `projectFiles` atuais **saem** da tarefa e vão para o implemento da mesma tarefa.
- PDFs de `baseFiles` com cara de projeto da Furgões: **[DONO]** P4. Recomendo **copiar o vínculo** (acrescentar em `_IMPLEMENT_PROJECT_FILES`, manter em `baseFiles`) só para tarefas não concluídas, por regex conservadora (`^PROJETO` ou `^\d{5}.*LAYOUT`) e registrar em tabela de rastreio. Não mover: base é o que o cliente mandou, e o regex erra.

### 5.4 SQL da migração

Divido em **três migrações** para respeitar "builde ANTES de migrar" e a janela do processo velho. Datas depois de `20260923120000_layout_aprovado_por_veiculo` (outra branch) — ver §5.8.

#### M1 — `20260930120000_truck_vira_implement` (catálogo apenas)

```sql
-- IMPLEMENTO DEIXA DE SE CHAMAR "TRUCK". Catálogo apenas: nenhum byte de dado muda.
-- Constraints e índices renomeados explicitamente (o Postgres não os leva junto).
DO $$ BEGIN
  IF to_regclass('"Truck"') IS NOT NULL AND to_regclass('"Implement"') IS NULL THEN
    ALTER TABLE "Truck" RENAME TO "Implement";
  END IF;
END $$;

ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_pkey"                    TO "Implement_pkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_taskId_fkey"             TO "Implement_taskId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_vinPlateId_fkey"         TO "Implement_vinPlateId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_backSideMeasureId_fkey"  TO "Implement_backSideMeasureId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_leftSideMeasureId_fkey"  TO "Implement_leftSideMeasureId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_rightSideMeasureId_fkey" TO "Implement_rightSideMeasureId_fkey";

ALTER INDEX "Truck_taskId_key"              RENAME TO "Implement_taskId_key";
ALTER INDEX "Truck_plate_key"               RENAME TO "Implement_plate_key";
ALTER INDEX "Truck_plate_idx"               RENAME TO "Implement_plate_idx";
ALTER INDEX "Truck_spot_idx"                RENAME TO "Implement_spot_idx";
ALTER INDEX "Truck_vinPlateId_idx"          RENAME TO "Implement_vinPlateId_idx";
ALTER INDEX "Truck_backSideMeasureId_idx"   RENAME TO "Implement_backSideMeasureId_idx";
ALTER INDEX "Truck_leftSideMeasureId_idx"   RENAME TO "Implement_leftSideMeasureId_idx";
ALTER INDEX "Truck_rightSideMeasureId_idx"  RENAME TO "Implement_rightSideMeasureId_idx";

-- Campos diretos: tipo e categoria (R4). As colunas geradas plateNormalized /
-- chassisNumberNormalized não dependem destas e acompanham o RENAME TABLE.
ALTER TABLE "Implement" RENAME COLUMN "implementType" TO "type";
ALTER TYPE "TruckCategory" RENAME TO "ImplementCategory";

-- NÃO renomeados, de propósito: valor 'TRUCK' de ChangeLogEntityType (1.194 linhas),
-- tipo TRUCK_SPOT (garagem nos três clientes), chaves 'truck.*' de TaskFieldChangeLog.
-- Tabela de arquivo morto sem uso (0 linhas no clone; conferir em produção antes):
-- DROP TABLE IF EXISTS "_DroppedTruckVinPlateText";
```

Reversão de M1: os mesmos RENAMEs com os lados trocados.

#### M2 — `20260930120100_implemento_frente_e_porta_traseira` (aditiva)

```sql
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "frontSideMeasureId" TEXT;
CREATE INDEX IF NOT EXISTS "Implement_frontSideMeasureId_idx" ON "Implement"("frontSideMeasureId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Implement_frontSideMeasureId_fkey') THEN
    ALTER TABLE "Implement" ADD CONSTRAINT "Implement_frontSideMeasureId_fkey"
      FOREIGN KEY ("frontSideMeasureId") REFERENCES "ImplementMeasure"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RearDoorLayout') THEN
    CREATE TYPE "RearDoorLayout" AS ENUM ('BIPARTITE', 'TRIPARTITE');
  END IF;
END $$;

ALTER TABLE "Implement"
  ADD COLUMN IF NOT EXISTS "rearDoorLayout"   "RearDoorLayout",
  ADD COLUMN IF NOT EXISTS "rearDoorLockBars" SMALLINT,
  ADD COLUMN IF NOT EXISTS "rearDoorHatches"  SMALLINT;

ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorLockBars_check"
  CHECK ("rearDoorLockBars" IS NULL OR "rearDoorLockBars" IN (2, 3, 4));
ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorHatches_check"
  CHECK ("rearDoorHatches" IS NULL OR "rearDoorHatches" BETWEEN 0 AND 6);

-- Opcional (recomendado): desfazer as 11 medidas compartilhadas, para que
-- editar a frente/traseira de um implemento não mude a dos outros. Ver §5.5.
```

Reversão: `DROP CONSTRAINT`/`DROP COLUMN`/`DROP TYPE` — sem perda (dado novo).

#### M3 — `20260930120200_arte_do_implemento_e_projeto_da_tarefa` (estrutura + dado)

Ordem obrigatória: arquivo morto → estrutura aditiva → projeto do implemento (antes de encher `_TASK_PROJECT_FILES`) → PDFs → fan-out das imagens → orçamento → órfãos → constraints finais → drop do M2M. **Nenhum `DELETE FROM "File"`.**

```sql
-- 0. ARQUIVO MORTO (reversão e auditoria). Mantido até a limpeza de uma rodada futura.
CREATE TABLE IF NOT EXISTS "_Mig0924_Layout"            AS SELECT * FROM "Layout";
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskLayouts"       AS SELECT * FROM "_TaskLayouts";
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskProjectFiles"  AS SELECT * FROM "_TASK_PROJECT_FILES";
CREATE TABLE IF NOT EXISTS "_Mig0924_QuoteLayout"       AS
  SELECT "id" AS "fileId", "quoteLayoutId" FROM "File" WHERE "quoteLayoutId" IS NOT NULL;
-- Origem de cada Layout nascido nesta migração (fan-out, orçamento):
CREATE TABLE IF NOT EXISTS "_Mig0924_LayoutOrigin" (
  "layoutId" text PRIMARY KEY, "sourceLayoutId" text, "sourceQuoteFileId" text,
  "taskId" text NOT NULL, "origin" text NOT NULL
);

-- 1. ESTRUTURA ADITIVA
CREATE TYPE "LayoutApprovalSource" AS ENUM ('PORTAL', 'INTERNAL', 'LEGACY_BUDGET', 'LEGACY_TASK');
ALTER TABLE "Layout"
  ADD COLUMN "implementId"             text,
  ADD COLUMN "approvedAt"              timestamp(3),
  ADD COLUMN "approvedByResponsibleId" text,
  ADD COLUMN "approvedByUserId"        text,
  ADD COLUMN "reprovedAt"              timestamp(3),
  ADD COLUMN "reprovedByResponsibleId" text,
  ADD COLUMN "reprovalReason"          text,
  ADD COLUMN "approvalSource"          "LayoutApprovalSource";
ALTER TABLE "Layout" DROP CONSTRAINT "Layout_fileId_key";   -- índice Layout_fileId_idx continua
-- (FKs de implementId/approvedBy* e CHECK só no passo 8, depois do dado)

CREATE TABLE "_IMPLEMENT_PROJECT_FILES" (
  "A" text NOT NULL REFERENCES "File"("id")      ON DELETE CASCADE ON UPDATE CASCADE,
  "B" text NOT NULL REFERENCES "Implement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_IMPLEMENT_PROJECT_FILES_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_IMPLEMENT_PROJECT_FILES_B_index" ON "_IMPLEMENT_PROJECT_FILES"("B");

-- 2. OS 4 PROJETOS ATUAIS SÃO DA FURGÕES → implemento da mesma tarefa.
--    (Tarefa sem implemento: cria, com spot NULL — o default YARD_WAIT poria
--     tarefa concluída no pátio.)
CREATE TABLE IF NOT EXISTS "_Mig0924_ImplementCreated" ("implementId" text PRIMARY KEY, "taskId" text NOT NULL);

WITH c AS (
  INSERT INTO "Implement" ("id", "taskId", "spot", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, p."B", NULL, now(), now()
  FROM "_Mig0924_TaskProjectFiles" p
  WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId" = p."B")
  GROUP BY p."B"
  RETURNING "id", "taskId"
)
INSERT INTO "_Mig0924_ImplementCreated" SELECT "id", "taskId" FROM c;

INSERT INTO "_IMPLEMENT_PROJECT_FILES" ("A", "B")
SELECT p."A", i."id" FROM "_Mig0924_TaskProjectFiles" p
JOIN "Implement" i ON i."taskId" = p."B"
ON CONFLICT DO NOTHING;

DELETE FROM "_TASK_PROJECT_FILES" p
USING "_Mig0924_TaskProjectFiles" o WHERE o."A" = p."A" AND o."B" = p."B";

-- 3. PDF DO LAYOUT → PROJETO DA TAREFA (um vínculo por tarefa que o tinha).
INSERT INTO "_TASK_PROJECT_FILES" ("A", "B")
SELECT l."fileId", tl."B"
FROM "_TaskLayouts" tl
JOIN "Layout" l ON l."id" = tl."A"
JOIN "File"   f ON f."id" = l."fileId"
WHERE f."mimetype" = 'application/pdf'
ON CONFLICT DO NOTHING;

-- 4. IMAGEM (e o que não for PDF) → ARTE DO IMPLEMENTO, uma linha por implemento.
--    Implemento faltante para tarefa com arte: cria (spot NULL).
WITH c AS (
  INSERT INTO "Implement" ("id", "taskId", "spot", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, tl."B", NULL, now(), now()
  FROM "_TaskLayouts" tl
  JOIN "Layout" l ON l."id" = tl."A" JOIN "File" f ON f."id" = l."fileId"
  WHERE f."mimetype" <> 'application/pdf'
    AND NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId" = tl."B")
  GROUP BY tl."B"
  RETURNING "id", "taskId"
)
INSERT INTO "_Mig0924_ImplementCreated" SELECT "id", "taskId" FROM c;
-- (No clone: 0 — a única tarefa com layout e sem Truck só tem PDF.)
-- O mesmo bloco precisa rodar para as tarefas de orçamentos com layout (passo 5)
-- antes de montar _q.

--    Ordena os vínculos de cada Layout: o 1º herda o id original (histórico que
--    cita o id continua resolvendo), os demais nascem com id novo e MESMO status.
CREATE TEMP TABLE _fan ON COMMIT DROP AS
SELECT tl."A" AS "layoutId", tl."B" AS "taskId", i."id" AS "implementId",
       row_number() OVER (PARTITION BY tl."A" ORDER BY t."createdAt", t."id") AS rn
FROM "_TaskLayouts" tl
JOIN "Layout" l ON l."id" = tl."A" JOIN "File" f ON f."id" = l."fileId"
JOIN "Task" t ON t."id" = tl."B"
JOIN "Implement" i ON i."taskId" = tl."B"
WHERE f."mimetype" <> 'application/pdf';

UPDATE "Layout" l SET "implementId" = fa."implementId",
       "approvalSource" = CASE WHEN l."status" = 'APPROVED' THEN 'LEGACY_TASK'::"LayoutApprovalSource" END
FROM _fan fa WHERE fa."layoutId" = l."id" AND fa.rn = 1;

WITH novos AS (
  INSERT INTO "Layout" ("id", "fileId", "status", "implementId", "approvalSource", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, l."fileId", l."status", fa."implementId",
         CASE WHEN l."status" = 'APPROVED' THEN 'LEGACY_TASK'::"LayoutApprovalSource" END,
         l."createdAt", now()
  FROM _fan fa JOIN "Layout" l ON l."id" = fa."layoutId"
  WHERE fa.rn > 1
  RETURNING "id", "fileId", "implementId"
)
INSERT INTO "_Mig0924_LayoutOrigin" ("layoutId", "sourceLayoutId", "taskId", "origin")
SELECT n."id", fa."layoutId", fa."taskId", 'FANOUT'
FROM novos n JOIN _fan fa ON fa."implementId" = n."implementId"
JOIN "Layout" src ON src."id" = fa."layoutId" AND src."fileId" = n."fileId";

-- 5. LAYOUT DO ORÇAMENTO → ARTE APROVADA EM CADA IMPLEMENTO DO ORÇAMENTO.
--    Gêmeo = mesmo fileId OU mesmo path OU mesma imagem (originalName+size) —
--    a mesma chave do reconciliador (sync-quote-task-layouts.ts:10-14).
--    Com gêmeo: promove DRAFT → APPROVED (REPROVED fica: foi decisão).
--    Sem gêmeo: cria Layout(APPROVED) para o File do orçamento, por implemento.
--    Se a branch de "layout por veículo" tiver ido para produção, restringir T
--    às linhas de "BudgetLayoutTask" quando Budget.layoutScope = 'PER_VEHICLE'.
CREATE TEMP TABLE _q ON COMMIT DROP AS
SELECT qf."id" AS "qFileId", qf."quoteLayoutId" AS "budgetId", t."id" AS "taskId", i."id" AS "implementId",
       lower(btrim(coalesce(qf."originalName", qf."filename"))) || '::' || qf."size" AS ik, qf."path"
FROM "File" qf
JOIN "Task" t ON t."quoteId" = qf."quoteLayoutId"
JOIN "Implement" i ON i."taskId" = t."id"          -- (criar antes os que faltarem, como no passo 4)
WHERE qf."quoteLayoutId" IS NOT NULL AND qf."mimetype" <> 'application/pdf';

UPDATE "Layout" l SET "status" = 'APPROVED', "approvalSource" = 'LEGACY_BUDGET'
FROM _q, "File" lf
WHERE l."implementId" = _q."implementId" AND lf."id" = l."fileId"
  AND l."status" = 'DRAFT'
  AND (lf."id" = _q."qFileId" OR lf."path" = _q."path"
       OR lower(btrim(coalesce(lf."originalName", lf."filename"))) || '::' || lf."size" = _q.ik);

WITH criados AS (
  INSERT INTO "Layout" ("id", "fileId", "status", "implementId", "approvalSource", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, _q."qFileId", 'APPROVED', _q."implementId", 'LEGACY_BUDGET', now(), now()
  FROM _q
  WHERE NOT EXISTS (
    SELECT 1 FROM "Layout" l JOIN "File" lf ON lf."id" = l."fileId"
    WHERE l."implementId" = _q."implementId"
      AND (lf."id" = _q."qFileId" OR lf."path" = _q."path"
           OR lower(btrim(coalesce(lf."originalName", lf."filename"))) || '::' || lf."size" = _q.ik))
  RETURNING "id", "fileId", "implementId"
)
INSERT INTO "_Mig0924_LayoutOrigin" ("layoutId", "sourceQuoteFileId", "taskId", "origin")
SELECT c."id", c."fileId", i."taskId", 'QUOTE' FROM criados c JOIN "Implement" i ON i."id" = c."implementId";

--    PDF de orçamento (4 no clone) → projeto da tarefa de cada tarefa do orçamento.
INSERT INTO "_TASK_PROJECT_FILES" ("A", "B")
SELECT qf."id", t."id" FROM "File" qf JOIN "Task" t ON t."quoteId" = qf."quoteLayoutId"
WHERE qf."mimetype" = 'application/pdf' ON CONFLICT DO NOTHING;
--    Orçamento SEM tarefa (14 arquivos no clone): nada a ligar; fica no arquivo morto.

-- 6. ÓRFÃOS: Layout sem implemento e sem aerografia (inclui as linhas de PDF,
--    que agora vivem em _TASK_PROJECT_FILES). Apaga a LINHA Layout, nunca o File.
DELETE FROM "Layout" WHERE "implementId" IS NULL AND "airbrushingId" IS NULL;

-- 7. O M2M morre.
DROP TABLE "_TaskLayouts";

-- 8. CONSTRAINTS FINAIS (depois do dado, para não barrar o meio do caminho).
ALTER TABLE "Layout" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_implementId_fkey"
  FOREIGN KEY ("implementId") REFERENCES "Implement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_approvedByResponsibleId_fkey"
  FOREIGN KEY ("approvedByResponsibleId") REFERENCES "Responsible"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_reprovedByResponsibleId_fkey"
  FOREIGN KEY ("reprovedByResponsibleId") REFERENCES "Responsible"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_one_owner_check"
  CHECK (("implementId" IS NOT NULL) <> ("airbrushingId" IS NOT NULL));
CREATE UNIQUE INDEX "Layout_implementId_fileId_key" ON "Layout"("implementId", "fileId");
CREATE INDEX "Layout_implementId_idx" ON "Layout"("implementId");
```

Checagem pendente no passo 5: a junção `Layout.status = 'DRAFT'` promove o gêmeo mesmo quando o orçamento está PENDING/CANCELLED. **[DONO]** P5 — recomendo promover só para orçamento `APPROVED` (96 dos 135 no clone) e, para os demais, apenas criar a arte como `DRAFT`.

#### M4 — `2026XXXX_orcamento_sem_layout` (PRÓXIMA entrega, depois de todos os clientes atualizados)

```sql
-- 1. Função do gatilho sem o bloco de saída (ANTES do DROP COLUMN, mesma migração).
CREATE OR REPLACE FUNCTION file_blocking_references(p_file_id text)
RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE r record; hit boolean; refs text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND ccu.table_name = 'File' AND ccu.column_name = 'id' AND tc.table_name <> 'thumbnail_jobs'
    ORDER BY tc.table_name, kcu.column_name
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', r.tbl, r.col) INTO hit USING p_file_id;
    IF hit THEN refs := refs || (r.tbl || '.' || r.col)::text; END IF;
  END LOOP;
  RETURN refs;
END; $$;

-- 2. A coluna de saída.
ALTER TABLE "File" DROP CONSTRAINT "File_quoteLayoutId_fkey";
DROP INDEX "File_quoteLayoutId_idx";
ALTER TABLE "File" DROP COLUMN "quoteLayoutId";
```

Por que separar M4 [FATO+INF]: entre `migrate deploy` e o `systemctl restart`, o processo VELHO continua respondendo (memória: "builde ANTES de migrar", "pm2 restart falha em silêncio — é systemd"). Se a coluna sumir nessa janela, toda rota que faz `include: { layoutFiles }` ou que exclui arquivo (via `OUTBOUND_REFERENCES`) cai. Com M4 na entrega seguinte, a coluna existe mas ninguém lê: janela sem 500. Ainda assim **M1 e M3 são quebra de contrato** (tabela renomeada, M2M derrubado) — ver §7 sobre parar o serviço.

### 5.5 Medidas compartilhadas (opcional em M2, recomendado)

```sql
-- Para cada (implemento, face) cuja medida é apontada por mais de um implemento,
-- o PRIMEIRO (por createdAt da tarefa) fica com a linha; os outros ganham cópia
-- com as mesmas seções e foto. Mesmo raciocínio do commit cb11ffb3 (outra branch).
CREATE TEMP TABLE _refs ON COMMIT DROP AS
SELECT i."id" AS "implementId", t."createdAt" AS "taskCreatedAt", f.face, f.mid
FROM "Implement" i JOIN "Task" t ON t."id" = i."taskId"
CROSS JOIN LATERAL (VALUES ('back',  i."backSideMeasureId"),
                           ('left',  i."leftSideMeasureId"),
                           ('right', i."rightSideMeasureId")) AS f(face, mid)
WHERE f.mid IS NOT NULL;

CREATE TEMP TABLE _share ON COMMIT DROP AS
SELECT r.*, gen_random_uuid()::text AS "newMid",
       row_number() OVER (PARTITION BY r.mid ORDER BY r."taskCreatedAt", r."implementId") AS rn
FROM _refs r
WHERE r.mid IN (SELECT mid FROM _refs GROUP BY mid HAVING count(*) > 1);
INSERT INTO "ImplementMeasure" ("id", "height", "photoId", "createdAt", "updatedAt")
SELECT s."newMid", m."height", m."photoId", m."createdAt", now()
FROM _share s JOIN "ImplementMeasure" m ON m."id" = s.mid WHERE s.rn > 1;

INSERT INTO "ImplementMeasureSection" ("id", "implementMeasureId", "width", "isDoor", "doorHeight", "position", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."newMid", x."width", x."isDoor", x."doorHeight", x."position", x."createdAt", now()
FROM _share s JOIN "ImplementMeasureSection" x ON x."implementMeasureId" = s.mid WHERE s.rn > 1;

UPDATE "Implement" i SET "backSideMeasureId"  = s."newMid" FROM _share s WHERE s.rn > 1 AND s.face = 'back'  AND s."implementId" = i."id";
UPDATE "Implement" i SET "leftSideMeasureId"  = s."newMid" FROM _share s WHERE s.rn > 1 AND s.face = 'left'  AND s."implementId" = i."id";
UPDATE "Implement" i SET "rightSideMeasureId" = s."newMid" FROM _share s WHERE s.rn > 1 AND s.face = 'right' AND s."implementId" = i."id";
-- (No clone: 11 medidas compartilhadas, 41 referências → 30 cópias.)
-- A foto (photoId) passa a ser compartilhada por 2+ medidas — é só FK de entrada,
-- o gatilho de exclusão continua protegendo o File.
```

Ensaiar no §7 junto com o resto; o volume é pequeno (30 cópias no clone).

### 5.6 Snapshots de assinatura (portão da migração, não do código apenas)

- **[FATO]** `materialProjection` inclui `layoutFileIds` (`quote-snapshot.service.ts:594`), e `quote-diff.ts:1103-1117` classifica troca de layout como diferença; `quote-diff.ts:566` completa ausente com `[]`.
- **[FATO]** 15 dos 16 RUNNING do clone têm layout no snapshot. Se o snapshot NOVO do orçamento deixar de ter `layoutFileIds` (porque `Budget.layoutFiles` morreu), `matchesFrozenTerms` compara `[]` com o congelado e **invalida a coleta**.
- Recomendação: **v8 do recorte material** sem `layoutFileIds`; para envelopes congelados em v≤7, o comparador usa o `layoutFileIds` **do próprio congelado** no lado "fresco" (o campo deixou de ser editável, então não pode ter divergido). Nenhum File citado em snapshot é apagado pela migração (regra de §3.8), então todo snapshot histórico continua renderizável.
- Se a branch `feat/orcamento-veiculos` subir antes, o snapshot passa a dizer de qual veículo é cada arte (commit `3a041693`) — a v8 tem de reconhecer também esse formato.

### 5.7 Compatibilidade com cliente atrasado (Flutter/web velho) — o que o DADO exige

[INF] O app Flutter não atualiza junto com a API. Durante a janela:
1. `include: { truck: … }` de cliente velho: o zod de include da tarefa é passthrough (`api/src/schemas/task.ts:1141`, `prismaRelationValue`) → Prisma recebe `truck` desconhecido → **500**. A API precisa de um tradutor `truck → implement` (e `layouts → implement.layouts`) no normalizador de include por uma versão, ou recusar com 400 legível. Tem que ser decidido antes do deploy.
2. Resposta: cliente velho lê `task.truck` → vem `undefined` e a tela mostra "sem veículo" **sem erro**. Ou a API devolve as duas chaves por uma versão, ou o app sai ANTES (Shorebird) já lendo as duas.
3. Escrita `projectFiles` por app velho (hoje = Furgões) cai no projeto da TAREFA (§4.4). Bloquear a escrita de `projectFiles` vinda de versão de app antiga (header de versão) ou aceitar e registrar.

### 5.8 Convivência com a branch `feat/orcamento-veiculos`

[FATO] Ela acrescenta `Budget.layoutScope` (`QuoteLayoutScope` SHARED|PER_VEHICLE) e a tabela `BudgetLayoutTask(fileId, taskId)` (`api/prisma/migrations/20260923120000_layout_aprovado_por_veiculo/migration.sql` na branch), e `20260922130000_envelope_lembra_o_que_ja_avaliou` já está na `main` (commit `efbeeda4`). A `feat/portal-do-responsavel` está 17 commits à frente e 11 atrás da `main`.
- Se `BudgetLayoutTask` for para produção antes deste rework, **é o melhor insumo que a migração pode ter**: cada linha é exatamente "esta arte é deste veículo" → `Layout(implementId do taskId, fileId, APPROVED, LEGACY_BUDGET)`. O passo 5 de M3 deve ler dela quando `layoutScope = 'PER_VEHICLE'`.
- Se não for, recomendo **não** levar a parte de schema dela (`layoutScope`, `BudgetLayoutTask`) — o R1 a torna obsoleta e seria mais uma coluna a migrar e derrubar. **[DONO]** P1.
- As novas migrações devem ter data posterior a `20260923120000`.

---

## 6. Decisão estrutural: 1:1 × implemento independente

| | A. Manter 1:1 (renomear) | B. Implemento independente (`Task.implementId`, N tarefas) |
|---|---|---|
| Modelo | `Implement.taskId @unique`, Cascade | `Task.implementId`, identidade por série/placa, Implement sobrevive à tarefa |
| Dado que sustenta a identidade [FATO] | não precisa | placa só em 121/575 (21%); chassi com duplicata; série está na TASK (2.013, única) — a única chave viável teria de migrar junto |
| Retorno do mesmo implemento | continua impossível de registrar com série/placa (os `@unique` barram) | resolvido |
| Tarefas históricas sem Truck | 1.678, todas COMPLETED — ficam sem implemento | teria de criar ou deixar nulas |
| Blast radius extra | — | `truck.findUnique({ where: { taskId } })` em ~10 pontos da api; `implement.task` vira lista (dashboard `getTruckMetrics`, garagem, portal-identity, layout-dimensions `:141`); `spot` precisa ir para a Task (vaga é da estadia); `serialNumber` (519 ocorrências api/110 arq, 431 web, 104 Flutter, coluna gerada + GIN, NFS-e, boleto `seuNumero`, bônus, conciliação, lacunas tardias da assinatura) |
| Multiveículo / cobertura de faturamento / portal | intactos (tudo é por tarefa) | a chave "veículo" do faturamento e do portal teria de ser revista |
| Resolve R2/R7? | **sim**: arte e medidas por implemento, que é 1 por veículo do orçamento | sim, e também através dos anos |

**Recomendação para ESTA entrega: A**, com três cuidados para que B seja aditiva depois:
1. APIs e portal endereçam o implemento pelo **`implement.id`**, nunca por `taskId` (URL `/implements/:id/...`), para a virada não mudar contrato.
2. `Layout.implementId` e `_IMPLEMENT_PROJECT_FILES` já apontam para o implemento — sobrevivem à virada sem migração.
3. **Não mover `Task.serialNumber` agora**; mostrar a série na seção "Implemento" da tela (apresentação), mantendo a coluna na tarefa. Mover a série é o gatilho natural da fase B, junto com `spot` para a Task e a identidade (o monorepo faz `Implement.serialNumber @unique`, ADR 0120).

---

## 7. Ensaio, ordem de deploy, idempotência e reversão

### 7.1 Ensaio em transação revertida (produção, por quem tem acesso)

```text
BEGIN;
  \i M1.sql  \i M2.sql  \i M3.sql
  -- invariantes (todas devem voltar 0 ou o número esperado):
  SELECT count(*) FROM "File";                                    -- igual ao antes (nenhum File apagado)
  SELECT count(*) FROM "Layout" WHERE ("implementId" IS NULL) = ("airbrushingId" IS NULL);   -- 0
  SELECT count(*) FROM "_Mig0924_TaskLayouts" x JOIN "_Mig0924_Layout" l ON l.id = x."A"
    JOIN "File" f ON f.id = l."fileId" WHERE f.mimetype = 'application/pdf'
    AND NOT EXISTS (SELECT 1 FROM "_TASK_PROJECT_FILES" p WHERE p."A" = l."fileId" AND p."B" = x."B");  -- 0
  SELECT count(*) FROM "_Mig0924_TaskLayouts" x JOIN "_Mig0924_Layout" l ON l.id = x."A"
    JOIN "File" f ON f.id = l."fileId" JOIN "Implement" i ON i."taskId" = x."B"
    WHERE f.mimetype <> 'application/pdf'
    AND NOT EXISTS (SELECT 1 FROM "Layout" n WHERE n."implementId" = i.id AND n."fileId" = l."fileId"
                    AND n.status = l.status);                                                -- 0 (salvo promoções do passo 5)
  SELECT count(*) FROM "_Mig0924_TaskProjectFiles" o JOIN "Implement" i ON i."taskId" = o."B"
    WHERE NOT EXISTS (SELECT 1 FROM "_IMPLEMENT_PROJECT_FILES" p WHERE p."A" = o."A" AND p."B" = i.id);  -- 0
  -- cobertura do orçamento: todo quote file de orçamento COM tarefa tem arte APPROVED (própria ou gêmea)
  -- em cada implemento do orçamento.
  SELECT count(*) FROM "Implement" WHERE "spot" = 'YARD_WAIT' AND "createdAt" > now() - interval '1 minute';  -- 0
  SELECT status, count(*) FROM "SignatureEnvelope" GROUP BY 1;  -- anotar RUNNING com layout
ROLLBACK;
```

Rodar com `psql` no servidor (o local não tem `psql`), ou via `node` + `$transaction` com `throw` no fim. Tempo esperado: segundos (clone: 575 implementos, 583 vínculos). Nada de `ALTER TYPE ... ADD VALUE` (que não é usável na mesma transação) — só `CREATE TYPE`/`RENAME`.

### 7.2 Ordem de deploy (proposta)

1. `pg_dump` antes (precedente: backup pré-billing).
2. Build da api/web novos **antes** de qualquer migração.
3. App Flutter publicado ANTES (Shorebird) lendo `implement` **e** `truck`, `layouts` do implemento **e** da tarefa (§5.7).
4. **Parar a api (`systemctl stop`)** → `prisma migrate deploy` (M1+M2+M3) → subir → conferir que o processo é o NOVO (memória: health 200 pode ser o processo velho).
5. Rodar as invariantes de 7.1 fora da transação (agora valendo).
6. Entrega seguinte: M4 (derruba `File.quoteLayoutId` + reescreve a função do gatilho), quando nenhum cliente em uso pedir `layoutFiles`.

### 7.3 Idempotência

- Migração Prisma roda uma vez; ainda assim: `IF NOT EXISTS` nas criações, `DO $$ … to_regclass … $$` no RENAME TABLE, `ON CONFLICT DO NOTHING` nos M2M, `WHERE NOT EXISTS` nas criações de Implement/Layout. O passo 4 (fan-out) só é seguro uma vez porque lê `_TaskLayouts`, que é derrubada no passo 7 da mesma transação — se a migração falhar no meio, o Postgres reverte tudo (DDL é transacional).

### 7.4 Reversão

| Migração | Como voltar |
|---|---|
| M1 | RENAMEs invertidos (catálogo) |
| M2 | DROP das colunas/CHECK/tipo (dado novo, sem perda — exceto o que usuários já tiverem digitado depois) |
| M3 | recriar `_TaskLayouts` a partir de `_Mig0924_TaskLayouts`; `DELETE FROM "Layout" WHERE id IN (SELECT "layoutId" FROM "_Mig0924_LayoutOrigin")`; restaurar `status`/`implementId=NULL` das linhas originais a partir de `_Mig0924_Layout` (e reinserir as órfãs apagadas no passo 6); `_TASK_PROJECT_FILES` := `_Mig0924_TaskProjectFiles`; recriar `Layout_fileId_key` (só possível depois de apagar as linhas do fan-out); `DROP TABLE "_IMPLEMENT_PROJECT_FILES"`; `DELETE FROM "Implement" WHERE id IN (SELECT "implementId" FROM "_Mig0924_ImplementCreated")` |
| M4 | re-`ADD COLUMN "quoteLayoutId"` + `UPDATE` a partir de `_Mig0924_QuoteLayout` + função antiga |

As tabelas `_Mig0924_*` ficam até uma rodada de limpeza explícita (padrão `_DroppedTruckVinPlateText`).

---

## 8. Perguntas ao dono

| # | Pergunta | Minha recomendação e por quê |
|---|---|---|
| P1 | A branch `feat/orcamento-veiculos` (layout por veículo NO orçamento) vai para produção antes deste rework? | Se ainda não foi usada em produção, **não levar a parte de schema** (`layoutScope`, `BudgetLayoutTask`): o R1 a torna obsoleta. Se já foi, a migração usa `BudgetLayoutTask` como verdade (§5.8). |
| P2 | Implemento 1:1 com a tarefa agora, ou independente (N tarefas, identidade por série)? | **1:1 agora** (§6). Independente exige mover série/vaga e redefinir identidade; os dados não sustentam identidade por placa (21%). |
| P3 | `projectFiles` da tarefa passa a significar "PDF cotado". Aceita o risco de app velho gravar projeto da Furgões ali, ou prefere um nome novo na tarefa (ex.: `stickerPlanFiles`) e deixar `projectFiles` só no implemento? | Nome novo evita a ambiguidade na transição, mas o dono chamou de "projeto da tarefa". Recomendo **manter `projectFiles`** e bloquear a escrita dele por versão de app antiga. |
| P4 | Os ~152 PDFs de `baseFiles` com nome de projeto da Furgões devem ir para o projeto do implemento? | Copiar o vínculo (sem tirar de base) só para tarefas não concluídas, por regex conservadora, com trilha. |
| P5 | Layout do orçamento PENDING/CANCELLED: promove a arte para APPROVED no implemento? | Só orçamento **APPROVED** promove; os demais viram arte `DRAFT` para o responsável aprovar no portal. |
| P6 | Pasta física para arte e projeto do implemento | `Clientes/{cliente}/Layouts/{Imagens}` (a mesma de hoje) para arte; `Clientes/{cliente}/Projetos/` (a mesma dos 4 atuais) para o projeto da Furgões; PDFs cotados ficam onde estão (`Layouts/PDFs`) — mover byte não traz nada. |
| P7 | Porta traseira: quantidade máxima de portinholas? varões dependem de bipartida/tripartida (ex.: tripartida exige 3+)? | CHECK `0..6` portinholas e varões `IN (2,3,4)` independentes até o dono dizer a regra. |
| P8 | A arte continua aparecendo no PDF do orçamento assinado? | O R1 diz que não. Então v8 do recorte material sem layout (§5.6) e o documento perde a seção "Layout". |
| P9 | Arte de aerografia também vai para o implemento? | Não nesta entrega: continua `Layout.airbrushingId` (0 linhas no clone; produção a medir). |
| P10 | O `spot` (vaga) continua no implemento? | Sim enquanto for 1:1; vai para a tarefa na fase do implemento independente. |

## 9. Riscos

| # | Risco | Gravidade | Mitigação |
|---|---|---|---|
| R-1 | Derrubar `File.quoteLayoutId` sem reescrever `file_blocking_references` → **toda exclusão de arquivo falha** | crítica | M4 com `CREATE OR REPLACE FUNCTION` antes do DROP; teste que exclui um File no ensaio |
| R-2 | `OUTBOUND_REFERENCES` com `quoteLayoutId` fora do schema, ou lista vazia → `select` inválido → serviço de referências falha fechado (nada exclui, organizador para) | crítica | remover o bloco de saída inteiro com guarda de lista vazia |
| R-3 | `paint.service.ts:503-517` com `"Truck"` → busca de tinta por placa/série volta vazia sem erro | alta (silenciosa) | atualizar junto com M1; teste de busca por placa |
| R-4 | Coletas de assinatura em andamento invalidadas (15/16 RUNNING com layout no clone) | alta | v8 do recorte material + carregar `layoutFileIds` do congelado; contar RUNNING em produção no ensaio |
| R-5 | Cliente atrasado (Flutter) pede `include.truck` → 500 pelo zod passthrough; lê `task.truck` → tela vazia sem erro | alta | tradutor de include por uma versão + resposta com as duas chaves, ou app publicado antes |
| R-6 | Apagar linha File na migração/limpeza apaga bytes de outra linha com o mesmo `path` (56 grupos entre arquivos de layout/orçamento) | alta | regra: a migração não apaga File; `deletePhysicalFile` deveria conferir path compartilhado (fora deste recorte) |
| R-7 | INSERT de Implement sem `spot` herda `YARD_WAIT` e põe tarefa concluída no pátio | média | `spot` NULL explícito nos INSERTs (já no SQL) |
| R-8 | Fan-out gera N linhas de Layout; histórico (`TaskFieldChangeLog.layouts`) cita o id antigo | baixa | o 1º vínculo herda o id original; `_Mig0924_LayoutOrigin` mapeia os demais |
| R-9 | Chaves `truck.*` e `layouts` no histórico e nas preferências salvas deixam de ter rótulo | baixa | mapa de rótulos aceita as duas grafias |
| R-10 | Números do clone (jun/2026) não representam produção (set/2026: 597 layouts, >990 orçamentos, aerografia no ar, orçamentos multitarefa com 60 veículos) | média | todo número decisório refeito no ensaio; em especial fan-out máximo, layouts de aerografia e RUNNING |
| R-11 | Medidas compartilhadas (11 linhas × 41 implementos): editar frente/traseira de um altera outros | média | de-compartilhar em M2 (§5.5) |
| R-12 | `projectFiles` muda de significado (Furgões → cotado) e app velho grava no lugar errado sem erro | média | P3 |
| R-13 | Janela entre `migrate deploy` e o restart com processo velho lendo tabela renomeada | alta | parar a api durante M1–M3 (segundos); M4 separada |
| R-14 | Conflito de migrações com a branch `feat/orcamento-veiculos` e com a `main` (portal 11 commits atrás) | média | datar depois de `20260923120000`; rebase/merge da `main` na branch do portal antes |
