# 07 — Contratos invisíveis: o que o `tsc`/`flutter analyze` NÃO pega (strings e dados persistidos) + plano de GUARDAS

Recorte: referências por STRING e dados PERSISTIDOS em `api` (feat/portal-do-responsavel), `web` (feat/portal-do-responsavel) e `mobile-flutter` (main), mais o plano de guardas para o R8.
Somente leitura. Nenhum SELECT foi rodado (o recorte não me autoriza explicitamente); onde o número importa, deixei a consulta pronta na §9 para quem tiver autorização.

Legenda: **FATO** = li no código, com arquivo:linha. **INFERÊNCIA** = dedução minha, sem execução.

---

## 0. Sumário: os 12 achados que mais pesam

| # | Achado | Onde | Se ninguém mexer |
|---|---|---|---|
| 1 | O hash material das assinaturas usa a chave literal `truck` (v1–v4) e a lista `layoutFileIds` (todas as versões). O "atual" é recalculado a partir do banco e comparado com o congelado | `api/src/modules/common/signature/services/quote-snapshot.service.ts:207,326,342,530,594,606-626`; comparação em `signature-envelope.service.ts:6342` (selo) e `:6952` (coleta) | Com o R1, `Budget.layoutFiles` deixa de existir e o "atual" vira `layoutFileIds: []`. Todo envelope vivo com arte diverge no material: **a coleta é invalidada, e no selo (com todas as assinaturas já colhidas) cai em `PADES_FAILED snapshot_stale_at_seal`**. Trocar `truck` por `implement` na projeção v1–v4 derruba **todas** as assinaturas antigas |
| 2 | A permissão de escrita por setor é uma lista de STRINGS de chave do corpo: `TASK_FIELD_DOMAINS.truck = ['truck']` | `api/src/modules/production/task/task.permissions.ts:52`, uso em `:146-334`, validação em `:395-432` | Se o corpo passar a se chamar `implement` e o domínio não mudar, **todo setor que não é ADMIN leva 400** ("Setor não tem permissão…: implement"). O ADMIN passa direto (`:403`), então teste feito como ADMIN não vê nada |
| 3 | As regras de Atenção leem caminhos pontuados em string (`truck.chassisNumber`, `truck.plate`, `truck.vinPlateId`) com `isNull`; caminho ausente vira `undefined`, e `isNull(undefined) = true` | web `src/lib/attention/rules.ts:220,246,271` + `predicate.ts:23-35,70-73`; Flutter `lib/core/attention/attention_rules.dart:181,205,226` | Depois do rename, **toda tarefa em andamento com data de entrada começa a piscar "Entrada sem chassi / sem placa / sem foto da plaqueta"** para a logística e o gerente de produção, sem nenhum erro |
| 4 | O `FileReferenceService` tem nomes de tabela/coluna em string: `'Truck.vinPlateId'`, `'Layout.fileId'`, `'_TASK_PROJECT_FILES.A'`, `'ImplementMeasure.photoId'` e a coluna de saída `quoteLayoutId` | `api/src/modules/common/file/services/file-reference.service.ts:43-55,75,86,103-107`; `select` montado a partir dessa constante em `:320` | Se `File.quoteLayoutId` cair e a constante ficar, o `select` estoura, `getReferences` lança erro, e **toda exclusão de arquivo passa a falhar** (`file.service.ts:1447`). O organizador também para (`resolveCanonicalContext` devolve null). Relação nova sem entrada = arquivo protegido mas sem pasta canônica |
| 5 | Chaves de notificação `task.field.truck.*` e `truck.movement_request` estão como linhas no banco (`NotificationConfiguration.key`), e as preferências dos usuários ficam em `UserNotificationPreference.eventType` (string) | seed `api/prisma/scripts/seed-notification-configs.ts:7157-7542,8481-8519`; emissores `truck.service.ts:565`, `task.listener.ts:257-263`, `task-field-tracker.service.ts:80-101,537` | Chave do emissor renomeada sem linha nova: `dispatchByConfiguration` só escreve um `warn` e retorna (`notification-dispatch.service.ts:1723-1726`). **A notificação some em silêncio.** Quem tinha silenciado volta a receber |
| 6 | Os widgets de dashboard salvos por usuário (`Preferences.dashboardLayoutWeb`) guardam `truckCategories`, `implementTypes`, `hasTruck` e as colunas `truckCategory`/`implementType`. O widget valida com zod e, **se falhar, troca a configuração INTEIRA pela padrão** | `web/src/dashboard/widgets/task-table.tsx:395-461,1318-1338`; fallback em `web/src/dashboard/components/widget-tile.tsx:130-133`; seed que gravou isso no banco: `api/prisma/scripts/seed-dashboard-defaults-and-message-20260508.ts:103-128` | Tirar ou renomear um valor de `COLUMN_KEY_VALUES` ou do enum `IMPLEMENT_TYPE`: **o usuário perde, sem aviso, colunas, filtros e título de todo widget de tarefas**. Renomear só a chave do filtro: o filtro some (zod descarta) e o widget passa a mostrar mais tarefas |
| 7 | O app Flutter lê e envia tudo por string: `j['truck']`, `'include': {'truck': true}`, `'layoutFiles': true`, `fileContext: 'truckVinPlate'`/`'quote-layouts'`. A API não sabe a versão do app, e o aviso de atualização pode ser adiado | `mobile-flutter/lib/data/models/task.dart:227-244,468-486`; `lib/features/financial/budget.dart:227-243,1141,1162-1183`; `lib/features/updates/native_update_service.dart:224-248` (adiar) | App antigo depois do rename: **placa/chassi/medidas somem da tela sem erro** (o `fromJson` é tolerante), o upload da plaqueta leva 400 (contexto desconhecido), e os `include` aninhados podem dar 500 |
| 8 | Nomes de campo multipart fixos na API (`truckVinPlate`, `quoteLayoutFile`, `implementMeasurePhotos.leftSide/rightSide/backSide`, `layouts`, `projectFiles`) | `api/src/modules/production/task/task.controller.ts:149-156,292-303,744-791`; `portal-identity.controller.ts:107` | Campo desconhecido no multer = erro "Unexpected field" e **a requisição inteira falha**. A face FRONTAL precisa de `implementMeasurePhotos.frontSide` na API ANTES de qualquer cliente mandar |
| 9 | O parâmetro `:side` da rota de medida é tipado só em TS (`'left' \| 'right' \| 'back'`) e não é validado em runtime | `api/src/modules/production/implement-measure/implement-measure.controller.ts:251-262`; mapa em `implement-measure.service.ts:101-103,417-419` | `front` chegando antes da API: `sideFieldMap['front']` dá `undefined` e o Prisma leva `{ undefined: id }`, o que dá 500 ou grava errado. Hoje há **6 vocabulários** para as faces (ver §3.9) |
| 10 | SQL cru com `"Truck"` num `try/catch` que devolve `[]` | `api/src/modules/paint/paint.service.ts:503-523` | Busca de tinta por placa/tarefa **passa a não achar nada, sem erro** (só um log) |
| 11 | O NFS-e e o boleto leem `task.truck` de variável `any`, e há **9 mapas de rótulo** para tipo de implemento e 9 para categoria | `api/src/modules/financial/invoice/invoice-generation.service.ts:1303-1328`; `sicredi-boleto.scheduler.ts:811-935` (entra no `seuNumero`); mapas listados na §3.10 | O documento FISCAL sai **sem placa/chassi/tipo**, e o `seuNumero` cai no fragmento de id. Um valor novo de TIPO sem rótulo sai CRU na nota (ex.: `FURGAO`), e isso é irreversível na prefeitura |
| 12 | Não há CI nem git hook em `api`, `web` e `mobile-flutter`. O build do web não roda `tsc`, o build da API emite mesmo com erro, e testes e scripts rodam em `tsx` sem checar tipos | ausência de `.github/` e de hooks (§5.1); `web/package.json` `"build": "... vite build"`; `api/tsconfig.build.json` `"noEmitOnError": false`, `include: ["src/**/*"]` | **Nenhuma** das armadilhas acima é bloqueada por máquina hoje. Até o `tsc` só protege quem o roda à mão |

A precedência de tudo isso é o rename de 05/07 (`Layout`→`ImplementMeasure`, `Artwork`→`Layout`), que deixou três tipos de lixo que ainda estão no ar (§4).

---

## 1. Método e limites

- Busca com `rg` (sem diferenciar maiúsculas quando fazia sentido) em `api/src`, `api/tests`, `api/scripts`, `api/prisma/{scripts,migrations}`, `web/src`, `mobile-flutter/{lib,test}`, com o Truck Studio excluído (`web/src/pages/tools/truck-studio/**`, que é outro domínio: configurador 3D).
- Branch da outra sessão lida só por `git diff feat/portal-do-responsavel...feat/orcamento-veiculos` (nada em `/tmp/.../api-veiculos`).
- Tamanho do resíduo "truck" (base de uma catraca, §5):

| Diretório | ocorrências | arquivos |
|---|---:|---:|
| api/src | 2.324 | 122 |
| api/tests | 106 | 19 |
| api/scripts + prisma/scripts | 69 | 13 |
| web/src (sem studio) | 2.976 | 205 |
| mobile-flutter/lib | 1.030 | 72 |
| mobile-flutter/test | 191 | 12 |

Rótulo de tela "caminhão/caminhões" (muitos em comentários): api 417 ocorrências em 99 arquivos, web 382 em 109, Flutter 160 em 43.

---

## 2. Mapa das classes de contrato invisível

| Classe | Por que o compilador não vê | Falha típica | Seção |
|---|---|---|---|
| Chave de relação em include/select/where/orderBy mandada pelo cliente | é JSON em query string | 403 (whitelist), 400 (where strict), 500 (passthrough), campo vazio (zod enumerado descarta) | 3.1 |
| Caminho pontuado em string (`truck.plate`) | só existe em runtime | alerta falso, form que não navega até o erro, ordenação ignorada | 3.1 |
| Chave do corpo, nome de campo multipart, `fileContext`, parâmetro de query/rota | string | 400 por setor, "Unexpected field", 400 de contexto, 500 | 3.2 |
| Leitura de resposta por string (`j['truck']`, `as any`) | Dart `Map`, TS `any` | dado some em silêncio | 3.3 |
| Rotas e deep links | string | 404, link antigo morto | 3.4 |
| Dados persistidos (enum de banco, JSON, chaves de config) | ficam gravados | histórico ilegível, assinatura invalidada, notificação muda | 3.5 |
| Armazenamento local (localStorage, SharedPreferences, Hive) | fica no aparelho | preferência perdida, fila reenviada com forma velha | 3.6 |
| Geradores de documento (NFS-e, boleto, PDF, CSV) | texto montado | nota fiscal sem veículo | 3.7 |
| Seeds, scripts, testes, docs | fora do build | bateria quebra só quando roda | 3.8 |

---

## 3. Inventário detalhado

### 3.1 Chaves de relação e caminhos em string nas CONSULTAS

**API — as portas que decidem o que acontece com uma chave desconhecida**

| Porta | arquivo:linha | O que faz hoje | Com `truck`→`implement` |
|---|---|---|---|
| `INCLUDE_WHITELIST.Task` (lista de strings) | `api/src/modules/common/base/include-access-control.ts:54-83` (`'truck'` em `:76`, `'layouts'` `:72`, `'projectFiles'` `:65`) | chave de include fora da lista dá **403** (`:326-330`); entidade fora do mapa (só há User/Task/Customer/Order/Responsible) é liberada sem checar (`:314-319`) | lista não atualizada: o web novo leva 403 em `implement`. Lista atualizada: o app antigo leva 403 em `truck` |
| `SELECT_WHITELIST.Task` | mesmo arquivo `:155-190`, com `'truckId'` em `:166` e `'truck'` em `:173` | FATO: `truckId` **não existe em Task** (o FK é `Truck.taskId`). É uma deriva que já existe hoje | a lista já está desatualizada, o que prova que ninguém a confere |
| `getEntityTypeFromField` | mesmo arquivo `:262-285` | singulariza por heurística; `implement`→`Implement`, `layouts`→`Layout` | sem entrada para `Implement`, o include cai no "libera tudo" |
| `prismaRelationValue` (include aninhado) | `api/src/schemas/task.ts:1097-1121` | `select`/`include` como `z.record` PASSTHROUGH; `where: z.any()` em `:1117` | chave velha aninhada atravessa e **estoura no Prisma** |
| `taskIncludeSchema.truck` | `task.ts:1141` | enumerado, mas o valor é passthrough | chave nova sem entrada: descartada em silêncio (objeto não strict) |
| `taskWhereSchema` | `task.ts:1240-1387`, `.strict()` em `:1387`; `truck: z.any()` em `:1347` | o topo é strict (chave desconhecida = 400); o conteúdo de `truck` é qualquer coisa | `where.truck` velho: 400 (alto, bom). `where.truck.implementType` velho sob chave nova: 500 |
| Filtros de lista que viram `where` | `task.ts:1432-1433,1489-1508,1939-1972,2271-2275` (`truckIds`, `spots`, `truckCategories`, `implementTypes`, `hasTruck`, `hasLayouts`) | o nome do parâmetro de query é o contrato | parâmetro renomeado: o filtro some em silêncio no cliente velho |
| `budgetIncludeSchema` | `api/src/schemas/budget.ts:137` (`truck` aninhado), `:160` (`layoutFiles`) | enumerado e **não** strict; já guarda um alias deprecado `task` porque o app instalado o manda (`:150-158`) | com o R1, se `layoutFiles` sair do schema o zod descarta (sem erro). Se ficar e a relação sumir: 500 |
| `fileIncludeSchema` / where de arquivo | `api/src/schemas/file.ts:17,210`; transform `:457-520` | FATO: aceita `tasksLayouts`, **que não é campo de `File`** (o campo é `layouts`, `schema.prisma:764`). O filtro "órfãos" monta `{ tasksLayouts: { none: {} } }` | é defeito LATENTE da mesma classe, já no ar: INFERÊNCIA de que o filtro `isOrphaned` dá erro de validação do Prisma quando usado |
| `paintIncludeSchema` (tarefas → `truck`) | `api/src/schemas/paint.ts:589,617` | enumerado | mesma armadilha |
| Outras `truck: z.` em include | `user.ts`, `sector.ts`, `serviceOrder.ts`, `observation.ts`, `customer.ts`, `bonus.ts`, `layout.ts` (1 cada) | enumerados | 9 schemas para atualizar juntos |

**Web — onde a chave nasce**

- 751 literais `include: {` e 23 constantes `*_INCLUDE` (FATO, contagem por `rg`). As que tocam `truck`/`layouts`/`projectFiles`: `web/src/components/production/task/detail/task-detail-page.tsx:202-235` (`DETAIL_INCLUDE`: `truck`, `projectFiles`, `layouts: {include:{file}}`, `quote.layoutFiles`), `web/src/dashboard/widgets/task-table.tsx:1644-1659`, `task-schedule-table-page.tsx:88`, `task-prep-page.tsx:88`, `task-history-table-filters.tsx:20`, `task-duplicate-modal.tsx:24`, `budget-table-filters.tsx:59`, `airbrushing-table-page.tsx:40`, `task-selector.tsx:24`, `pages/financial/billing/details/[id].tsx`.
- `where` montado no cliente com relação: `web/src/schemas/task.ts:498-517`, `web/src/dashboard/widgets/task-table.tsx:1540-1564`, `web/src/pages/production/barracoes/index.tsx:87`.
- ORDENAÇÃO por caminho: `task-table.tsx:1612-1620` (`plate: ["truck","plate"]`, `chassisNumber: ["truck","chassisNumber"]`). Com `truck` renomeado: `orderBy { truck: … }` sai errado e dá 400/500 no widget.
- `react-hook-form` por caminho string: `task-edit-form.tsx:3293,3320,3376,3403,3964-3967` (`name="truck.category"` etc.), `setValue("truck.vinPlateId" as never, …)` em `:2772`. O cast `as never` desliga o tipo.
- Mapa "campo com erro → seção" (usado para rolar até o erro): `task-edit-form.tsx:753-759` (`"truck.category": "basic-information"` …). Chave velha: o erro de validação não leva o usuário até o campo.
- Dotted paths das regras de Atenção: `web/src/lib/attention/rules.ts:206-275` + `predicate.ts:22-35` (explicado no achado 3). O `target.field` (`chassisNumber`, `plate`, `vinPlate`, em `:223,249,274`) é o nome do atributo que pisca no formulário, outro contrato por string.

**Flutter**

- 145 literais `'include': {` (FATO). Com `truck`/`layouts`/`layoutFiles`/`projectFiles`: `lib/features/garages/truck_detail_sheet.dart:88-101`, `garage_screen.dart:200-226` (inclusive `where: {'truck': {'isNot': null}}`), `lib/features/financial/budget.dart:1162-1183`, `budget/budget_form_screen.dart:723,762-766`, `production/task_row_actions.dart:365`, `production_extra/airbrushing_form_screen.dart:212-215`, `observation_form_screen.dart:130`, `airbrushing_detail_config.dart:63-68`, `personnel/bonus_detail_config.dart:28`.
- `where` com relação no dashboard: `lib/features/dashboard/widgets/tasks_widget.dart:416,427,440` (`'layouts': {'none'|'some': {}}`). Com o R2 (layout sai de Task): o widget do app antigo quebra.
- FATO: já existe um teste-espelho (`test/task_detail_include_test.dart:13-42`) que copia **à mão** o `INCLUDE_WHITELIST.Task` e o `getEntityTypeFromField` da API. É o embrião do teste de contrato (§5), mas vai derivar no primeiro rename se continuar sendo cópia.

### 3.2 Contratos de ESCRITA por string

| Contrato | Onde | Hoje | Se ninguém mexer |
|---|---|---|---|
| Domínio de permissão `truck` | `api/.../task/task.permissions.ts:52,146-334,354` | chave do corpo `truck` | achado 2: 400 para todos os setores menos ADMIN |
| Domínios `layouts`/`layoutRemoval`/`projectFiles` | `task.permissions.ts:64,78,92` | `layoutIds`, `layoutStatuses`, `newLayoutStatuses`, `removeLayoutIds`, `projectFileIds` | o R2/R6 muda de dono (implemento). Um campo que nenhum domínio declara é 400 para todo setor (o comentário em `:30-41` conta que isso já aconteceu com `customerOrderNumber`) |
| Campos multipart da tarefa | `task.controller.ts:149-156,292-303,744-791` | `layouts`, `projectFiles`, `truckVinPlate`, `quoteLayoutFile`, `implementMeasurePhotos.{leftSide,rightSide,backSide}` | achado 8. Sem `frontSide` a foto frontal não tem por onde subir |
| Multipart do portal | `api/.../portal/portal-identity.controller.ts:107`; web `web/src/api-client/portal.ts:1695-1706` | `truckVinPlate` | mesmo |
| FormData do web | `task-edit-form.tsx:1651` (`files.truckVinPlate`), `:1670-1671`; `AdvancedBulkActionsHandler.tsx:1216-1219` (`implementMeasurePhotos.${side}`) | template string | `side` novo sem campo na API: "Unexpected field" |
| `fileContext` de upload | API: mapa em `files-storage.service.ts:19-76,128-207,278-302`, validado em `file.controller.ts:113-119` (400 para desconhecido). Clientes: web `set-quote-layout-modal.tsx:261` (`quote-layouts`), `task-create-form.tsx:391,1147`, `task-edit-form.tsx:4188,4414`, `budget-step-task.tsx:696`, `AdvancedBulkActionsHandler.tsx:1307`; Flutter `task_form_screen.dart:933`, `task_edit_screen.dart:1233`, `budget_form_screen.dart:2730` (`truckVinPlate`), `:3590` (`quote-layouts`), `task_form_fields.dart:696`, `task_row_actions.dart:383`, `layout_attach_sheet.dart:33` (`tasksLayouts`) | string | contexto renomeado sem alias: app antigo leva **400 no upload**. Contexto aceito mas com pasta nova: o arquivo vai para a pasta errada (a mesma classe do incidente de 07/06, `file-reference.service.ts:11-22`) |
| `entityType` no upload | Flutter `task_form_screen.dart:934` (`entityType: 'truck'`); API `files-storage.service.ts:756-771` (`truck: ['truckVinPlate']`) | string | o contexto padrão por entidade quebra sem aviso |
| Parâmetro `:side` | `implement-measure.controller.ts:251-262`; web `api-client/implementMeasure.ts:81` | não validado | achado 9 |
| Rotas de medida com `truck` no caminho | `implement-measure.controller.ts:117,196,217,251` (`truck/:truckId`, `:id/assign-to-truck`) | string | rota renomeada: 404 no cliente antigo |
| Query `truckId` do cotador | `layout-dimensions.controller.ts:61-68`; web `api-client/layoutDimensions.ts:90`; Flutter `lib/features/files/layout/layout_dimensions_repository.dart:25-30` | obrigatório (400 sem ele) | nome trocado: o app antigo **não consegue abrir o cotador** |
| Query `implementType` da sugestão de preço | `api/.../budget/budget.controller.ts:105`; Flutter `lib/features/financial/budget_suggestion.dart:177` | string | parâmetro ignorado em silêncio, e a sugestão perde precisão |
| Campos copiáveis entre tarefas | API `api/src/schemas/task-copy.ts:22-37` (`layoutIds`, `projectFileIds`, `implementType`, `implementMeasures`); web `web/src/types/task-copy.ts:17-121`; execução em `task.service.ts:14021,14054,14201,14253` | enum de strings | nome velho: 400. Campo que mudou de dono (layout/projeto para o implemento): a cópia copia o que não deveria |
| Corpo `truck` no update | `taskUpdateSchema` não é strict (armadilha conhecida) | chave velha some com 200 | o app antigo "salva" placa/chassi e **nada é gravado**. É o pior silêncio, porque o usuário vê sucesso |
| Filtros da lista | `truckIds`, `truckCategories`, `implementTypes`, `hasTruck`, `hasLayouts`: web `schemas/task.ts:497-517,846,877,998-999`, `list/task-list.tsx:112,172`, `list/filter-utils.ts:213-215`, `history/filter-utils.ts:184-410` | chaves de URL | URL salva ou favorita com o nome velho: o filtro some |

### 3.3 Leitura de RESPOSTA por string (dado some em silêncio)

- Flutter: `Truck.fromJson` (`lib/data/models/task.dart:222-245`) lê `plate`, `chassisNumber`, `vinPlateId`, `category`, `implementType`, `leftSideMeasure`… Todas as chaves são opcionais, exceto `j['id'] as String` (lança erro se faltar `id` num `select`). `Task.fromJson` lê `j['truck']`, `j['layouts']`, `j['projectFiles']` (`:468-486`). `budget.dart:227-243` lê `truck.plate/chassisNumber/category/implementType` e `layouts`; `:1141` lê `layoutFiles`.
- Web, leituras com `as any` que escapam do `tsc`: 38 (FATO, contagem). Exemplos: `dashboard/widgets/task-table.tsx:723,745,909,923`; `pages/production/barracoes/index.tsx:211-403`; `components/production/garage/truck-detail-modal.tsx:100-265`; `pages/financial/budget/details/[taskId].tsx:486,513`; `pages/financial/billing/details/[id].tsx:734`; `hooks/production/use-task.ts:519-521`; `utils/invoice-pdf-generator.ts:97` (`task.quote?.layoutFiles` com `f: any`).
- API: 15 leituras `(… as any).truck` (FATO), por exemplo `utils/task.ts:194`, `task.service.ts:1312,1993,2552,7986,8591,10788`, `implement-measure.service.ts:69-71` (`trucksBackSide` etc.), `budget.service.ts:1573,1577,2355,2667` (`(existing as any).layoutFiles`). Delegate Prisma com `any`: `utils/sync-quote-task-layouts.ts:160-461` (8×), `task.service.ts:744` (`client: any`). Dinheiro/fiscal com `any`: `invoice-generation.service.ts:1302-1303` (`const task: any … task?.truck`), mesma forma em `sicredi-boleto.scheduler.ts:910`.

### 3.4 Rotas de URL e deep links

| Rota | Onde | Nota |
|---|---|---|
| `GET/PUT /trucks`, `/trucks/:id`, `/trucks/garages-availability`, `/trucks/lane-availability/:garageId`, `POST /trucks/batch-update-spots`, `/trucks/request-movement`, `/trucks/sector-garage-mapping` | `api/src/modules/production/truck/truck.controller.ts:24-229`; web `api-client/truck.ts:47,76,98`; Flutter `garage_edit_controller.dart:233` | o app antigo usa `/trucks/batch-update-spots`. Renomear exige manter o caminho velho (alias) enquanto houver app antigo |
| `/implement-measure/truck/:truckId[/batch\|/:side]`, `/:id/assign-to-truck` | `implement-measure.controller.ts:117-251`; web `api-client/implementMeasure.ts:62-81` | idem |
| `/implement-measure-section/...` | web `api-client/services/implementMeasureSection.ts:42-46` | FATO: **a API não tem essa rota** (`rg` vazio em api/src). É cliente morto (a `use-task.ts:382` só invalida a chave). Prova de que rota em string deriva sem ninguém ver |
| `/layout-dimensions/:fileId?truckId=` | ver 3.2 | |
| Mapa "caminho base → entidade de atenção" | Flutter `lib/core/attention/attention_types.dart:64` (`'/trucks': truck`) | chave da presença/invalidação |
| Portal `/cliente/painel/veiculos/:taskId`, API `GET /cliente/me/veiculos/:taskId`, `PATCH …/:taskId/identificacao` | web `constants/routes.ts:928-929`; API `portal-read.controller.ts:236`, `portal-identity.controller.ts` | a URL é chaveada por **taskId**. Se o implemento ganhar id próprio e o portal passar a navegar por implemento, os links já mandados (e-mail/WhatsApp) têm de continuar resolvendo (redirecionar de taskId) |
| Deep link de notificação | `truck.service.ts:579-582` (`webUrl`/`mobileUrl` fixos, formato expo-router `/(tabs)/…`, 82 ocorrências na API) | `Notification.actionUrl`/`metadata` ficam gravados, e o Flutter remapeia `(tabs)` (`notification_router.dart:162,253,286`) |

### 3.5 DADOS PERSISTIDOS no banco

#### 3.5.1 `ChangeLog` / `TaskFieldChangeLog` (histórico)

| Item | FATO | Risco |
|---|---|---|
| `ChangeLogEntityType` tem `TRUCK` e `IMPLEMENT_MEASURE` (enum de banco) | `api/prisma/schema.prisma:4424-4538` (`TRUCK`, `IMPLEMENT_MEASURE`); web `constants/enums.ts:1342,1378,1980,2020`; API `constants/enums.ts:1400,2069` | Postgres `ALTER TYPE … RENAME VALUE` move as linhas antigas junto (precedente: `20260705130000_rename_layout_artwork_borrow_cleanup/migration.sql`, `RENAME VALUE 'LAYOUT' TO 'IMPLEMENT_MEASURE'`). Já `ADD VALUE IMPLEMENT` e manter `TRUCK` deixa o histórico partido em dois |
| O histórico da tarefa busca `TRUCK` por `entityId = truckId` | `web/src/components/ui/task-with-service-orders-changelog.tsx:3100-3118`; `IMPLEMENT_MEASURE` em `:3120-3140`; renderização `:535-588,804-806,920,956,1815` e `changelog-history.tsx:979,1081,1634` | se o implemento **não herdar o id do Truck**, todo o histórico de placa/chassi/categoria/vaga fica órfão. E um web antigo mandando `TRUCK` depois do `RENAME VALUE` leva 400 (a lista de changelog valida o enum) |
| `field` gravado como string: `truck.plate`, `truck.chassisNumber`, `truck.vinPlateId`, `truck.category`, `truck.implementType`, `truck.spot`, `truck.{left,right,back}SideMeasureId`, `truck.implementMeasure`, `layouts`, `layoutIds`, `layoutFileIds`, `projectFiles`, `implementMeasures`, `implementType` | emissores: `task-field-tracker.service.ts:80-101,537`, `truck.service.ts:70-75,186`, `task.service.ts:2766,2931,2996,8962`, `implement-measure.service.ts:149-671` | **não reescrever o histórico.** Quem lê precisa de rótulo para chave velha E nova: API `utils/changelog-fields.ts:259-263,630,748-781,1071-1081`, `changelog/utils/changelog-helpers.ts:383-387`; web `utils/changelog-fields.ts:343-400,607-625,793-857,1723-1751,2596-2632`; Flutter `lib/features/changelog/changelog_labels.dart:263-312,360` |
| `oldValue`/`newValue` JSON com forma do Truck/medida (`totalWidth`, `height`, `doorCount`) | formatador web `changelog-fields.ts:2596-2632` | a porta traseira nova (R5) precisa entrar no formatador sem quebrar o JSON antigo |
| `reason` gravado com texto do rename de julho ("ImplementMeasure criado", …) | `implement-measure.service.ts:149,174,209,530,619,671` | já está no banco; ver §4 |
| **DESFAZER** a partir do changelog: `tx.truck.update({ data: { [changeLog.field]: oldValue } })` | `task.service.ts:10822-10955` (`'TRUCK'` na lista `:10827`, update genérico `:10930-10933`); `TASK_QUOTE` com `layoutFileIds` na lista de campos reversíveis (`:10966-10991`, `budget.guards.ts:215`) | depois do R4 (`implementType`→`type`), desfazer um registro antigo manda um campo inexistente ao Prisma: 500. Depois do R1, desfazer um `layoutFileIds` antigo reescreve uma relação que não existe mais. **Precisa de tabela de tradução campo-velho→campo-novo, ou recusar com mensagem** |
| `TaskFieldChangeLog.field` (string) | `schema.prisma:2453-2475` | mesma regra dos rótulos |

#### 3.5.2 Notificações

| Item | Onde | Risco |
|---|---|---|
| Linhas `NotificationConfiguration` com `key` `task.field.truck.{backSideMeasureId,category,chassisNumber,implementType,implementMeasure,leftSideMeasureId,plate,rightSideMeasureId,spot}`, `task.field.layouts`, `truck.movement_request` | seed `api/prisma/scripts/seed-notification-configs.ts:6033-6073,7157-7542,8481-8519`; mortas em `FORCE_DISABLE` `:8897-8900` | o seed faz upsert por chave e **nunca apaga**; renomear emissor sem seedar a chave nova deixa a notificação muda (achado 5). O `metadata.field` do seed repete o caminho (`"truck.category"`) |
| Templates com texto "caminhão" (in-app, push, e-mail, WhatsApp) | mesmo arquivo, ex. `:7219-7233,8497-8512` | é texto, não chave: trocar o rótulo pede reseed |
| `UserNotificationPreference.eventType` (string) | `schema.prisma:3045-3060` | preferência de "silenciar" órfã; precisa de `UPDATE` velho→novo na migração |
| `Notification.metadata.fieldName`, `relatedEntityType='TRUCK'`, `actionUrl` | `schema.prisma:2921-2961`; `task.listener.ts:271`, `truck.service.ts:568` | lista de notificações antigas: o rótulo vem do mapa `task-notification.service.ts:77-86`, e `notification-dispatch.service.ts:2633-2635` traduz valores pelo nome do campo |
| Título e corpo fixos no código | `task.listener.ts:274-276` ("Medidas do Caminhão atualizadas"), `implement-measure.service.ts:901-902,1092-1093` ("ImplementMeasure do Caminhão atualizado") | texto de tela |

#### 3.5.3 Assinatura do orçamento (o mais delicado)

| Item | FATO | Consequência |
|---|---|---|
| `SignatureEnvelope.quoteSnapshot` (JSONB) guarda `truck{plate,chassisNumber,category,implementType}` (v1/v2) ou `vehicles[]{…category, implementType}` (v3+), e `layoutFileIds[]` | tipos em `quote-snapshot.service.ts:94-117,130-210`; leitor de dupla forma `quote-diff.ts:733-751` (`snapshotVehicles`) | **O JSON antigo é para sempre.** Renomear a chave nos TIPOS obriga o leitor a aceitar as duas (o `snapshotVehicles` já faz isso para `task`/`truck`, e é o modelo a seguir) |
| Hash material por versão: `materialProjection` emite `truck` v1–v4 e `layoutFileIds` em todas | `quote-snapshot.service.ts:294-384,566-664`; versões suportadas `[7,6,5,4,3,2,1]` | a projeção v1–v7 precisa sair **byte a byte igual**. A chave `truck` e o nome `implementType` dentro do snapshot NÃO podem ser renomeados por busca-e-troca |
| O "atual" é reconstruído do banco (`QUOTE_SNAPSHOT_INCLUDE`: `layoutFiles` `:389`, `tasks.include.truck` `:436`; `build` `:495-498,530`) | | com o R1, `quote.layoutFiles` some: o "atual" vira `[]` e o congelado tem N arquivos, então há divergência material (achado 1). Os caminhos que decidem são `signature-envelope.service.ts:6342` (selo, e cai em `PADES_FAILED`) e `:6952` (coleta, e invalida) |
| Portões que exigem arte no orçamento | `signature-envelope.service.ts:561,626` e `:1099-1101` | o R1 os remove; outros relatórios cuidam |
| Diff mostra "Layout: N imagens" | `quote-diff.ts:1103-1117` (grupo `LAYOUT` `:1110`) | aditivo e trilha antigos continuam citando layout |
| Recorte `LAYOUT` gravado | `quote-sections.ts:44-52` ("acrescente no fim", "a chave está gravada em `EnvelopeDocument`"), `:138` (`MARKETING: ['LAYOUT']`); `EnvelopeDocument.sections String[]` em `schema.prisma:8376-8378` | **`'LAYOUT'` não pode sair de `QUOTE_SECTIONS`**, porque isso muda o `variantKey` de toda coleta gravada. No máximo, deixar de ser marcável |
| O portal usa `LAYOUT` para decidir se o contato vê a arte | `portal-read.service.ts:1048,1214`, `portal-projection.service.ts:790,878`, `portal-capabilities.ts:301`; web `components/cliente/orcamento/sections.ts:64,78`; Flutter `signature/envelope_models.dart:37,58`, `budget_change.dart:48` | com o R2 a mesma chave passa a significar "arte do implemento", o que é uma mudança de semântica sem mudança de nome. Decisão do dono (§7) |
| A branch da outra sessão acrescenta `layoutCoverage?: Array<[fileId, taskIds[]]>` ao snapshot **sem versão nova** e o põe no hash material | `git diff … quote-snapshot.service.ts` (+`layoutCoverage` na interface, na projeção e no include `quoteLayoutTasks`) | se ela for ao ar antes deste rework, fica um TERCEIRO formato de layout gravado em snapshot para sustentar para sempre |

#### 3.5.4 Preferências e estados de tela gravados no servidor

| Coluna | Chaves com truck/layout | Onde se lê | O que acontece |
|---|---|---|---|
| `Preferences.dashboardLayoutWeb` | filtros `truckCategories`, `implementTypes`, `hasTruck`, `hasArtworks`/`hasLayouts`; colunas `truckCategory`, `implementType`, `hasLayouts` | `task-table.tsx:395-461` (chaves), `:1318-1338` (schema), `widget-tile.tsx:130-133` (fallback **total**); seed que gravou em todos os usuários: `seed-dashboard-defaults-and-message-20260508.ts:103-128` | achado 6 |
| `Preferences.dashboardLayoutMobile` | filtros e presets do Flutter (`tasks_widget.dart:408-440`) | Flutter | análogo |
| `Preferences.tableConfigsWeb` / `detailConfigsWeb` | ids de coluna e campo: `truckCategory`, `implementType`, `truckSpot`, `plate`, `chassisNumber`, `vinPlate`, `layouts`, `layout` (`task-detail-page.tsx:726-820,1328-1340`; `task-prep-columns.tsx:528-585`; `task-history-columns.tsx:358-390`; `task-history-table-columns.tsx:251-281`; `task-schedule-columns.tsx:95-167`) | reconciliação tolerante (`use-table-state.ts:68-76`) | id renomeado: o usuário perde ordem, largura e visibilidade daquela coluna, sem quebrar |
| `Preferences.tableConfigsMobile` / `detailConfigsMobile` | ids de seção `implementMeasure`, `layouts`, `projectFiles` (`task_detail_config.dart:279,893,975`; `budget_sections.dart:347`) | Flutter | idem |
| `AttentionAck` (`ruleId`, `entityType` string) | `schema.prisma:2994-3008`; regras `task.entry-without-{chassis,plate,vin-plate-photo}` | web `rules.ts:210,235,261`; Flutter `attention_rules.dart:175,196,220` | **mantenha os `id` das regras** (mudar só o predicado); id novo zera a soneca e o "visto" de cada usuário |
| `ATTENTION_ENTITY_TYPES` com `'TRUCK'` | API `schemas/attention.ts:22-38`; web `lib/attention/types.ts:39`, `use-attention-socket.tsx:40` (`TRUCK: "trucks"`); Flutter `attention_types.dart:29,64` | o socket valida por `z.enum` | app antigo emitindo `TRUCK` depois da remoção: a presença é recusada no gateway |
| `PaintingStrategyRule` `IMPLEMENT_DEFAULTS.params.rearDoorCount: 2` | `api/src/scripts/seed-painting-config.ts:243-252` | motor de pintura | o R5 traz o dado real (bi/tripartida). Enquanto o motor ler o padrão, ele erra a traseira de quem é tripartida |

#### 3.5.5 Arquivos: caminho em disco, contexto e referência

| Item | Onde | Risco |
|---|---|---|
| Pastas canônicas por contexto: `tasksLayouts`→`Layouts/{PDFs,Imagens}`, `quote-layouts`→`Layouts`, `taskProjectFiles`→`Projetos/{PDFs,Imagens}`, `truckVinPlate`→`Plaquetas`, `implementMeasurePhotos`→`Traseiras` | `files-storage.service.ts:128-207,462-487` | o `File.path` gravado reflete isso. Se os PDFs de "layout" virarem **projeto da tarefa** (R6) e ganharem contexto `taskProjectFiles`, o organizador vai querer MOVER ~283 PDFs de `Layouts/PDFs` para `Projetos/PDFs`, e os designers os procuram pela pasta no servidor de arquivos |
| Inferência de contexto por regex de caminho | `file-organization-scheduler.service.ts:127-184` (`/Clientes/[^/]+/Layouts/` → `tasksLayouts`) | string |
| Resolução do nome do cliente: `layout.tasks[0].customer`, `quoteLayout.tasks[0].customer`, `truck.task.customer` | mesmo arquivo `:282-340,409-415` | layout ligado ao implemento sem caminho implemento→cliente: o arquivo cai em `Clientes/Outros/` |
| `FileReferenceService` | achado 4. O catálogo de FKs fica em cache pelo tempo de vida do processo (`:287-297`) | entre `migrate` e o restart, o processo velho ainda consulta `"Truck"` → `getReferences` lança erro → **exclusão de arquivo falha na janela** (falha fechada, aceitável se for curta) |
| Script de auditoria | `api/scripts/audit-file-placement.ts:26,51-69,99,121` (`quoteLayoutId` em SQL cru) | quebra ao rodar |

#### 3.5.6 Enums e objetos de banco

- Tipos Postgres `"TruckCategory"`, `"ImplementType"`, `"TRUCK_SPOT"` (`schema.prisma:4297-4317`). Os valores ficam gravados em `Truck`, no JSON de snapshot, em `ChangeLog.oldValue/newValue`, nas preferências de widget e nos filtros de URL. **Renomear um VALOR** (não o tipo) obriga a traduzir tudo isso; acrescentar valor é seguro, desde que os 9 mapas de rótulo cresçam juntos (§3.10).
- Colunas geradas `plateNormalized`/`chassisNumberNormalized` (`schema.prisma:2553-2554`, migração `20260624150000_accent_insensitive_search`): seguem um `ALTER TABLE RENAME` sozinhas. Constraints e índices (`Truck_pkey`, `Truck_taskId_key`, `Truck_*_fkey`, `Truck_*_idx`) precisam de `RENAME` explícito para o `prisma migrate diff` não acusar deriva (o precedente de julho faz exatamente isso).
- SQL cru: `paint.service.ts:507,510` (achado 10). Não há view, trigger nem função que cite `"Truck"` (FATO: `rg` nas migrações).

### 3.6 Armazenamento local

| Onde | Chave | Risco |
|---|---|---|
| web `localStorage` | `task-groups-expanded` (`history/task-history-list.tsx:97,111`), larguras de coluna por instância de widget (`task-table.tsx:1702-1728`), visibilidade e ordem de coluna (`use-column-visibility.ts`, `use-column-order.ts`, reconciliam) | baixo |
| web URL | `useTaskFormUrlState` guarda `truck` e `layoutIds` na URL (`hooks/production/task/use-task-form-url-state.ts:210-232,397-406`) | FATO: é **código morto** (só reexportado em `use-task.ts:754`, sem quem chame). Apagar em vez de renomear |
| web React Query | `truckKeys = createQueryKeyStore("trucks")` (`hooks/common/query-keys.ts:761`); literal `["trucks","detail", id]` em `hooks/administration/use-implement-measure.ts:151`; `["implementMeasures","truck",id]` em `:13` | renomear o store e esquecer o literal: **a tela fica velha depois de salvar**, sem erro |
| Flutter `SharedPreferences` | adiamento de atualização (`native_update_service.dart:224-248`) | é o que mantém o app velho em campo |
| Flutter Hive `checkin_outbox` | trabalhos `PUT /tasks/:id` com `soCheckinFiles`/`soCheckoutFiles`, `_soFileMapping`, `expectedUpdatedAt` (`production/checkin_outbox.dart:17-60,343`) | não tem `truck`, mas é corpo PERSISTIDO no aparelho e reenviado mais tarde. Endurecer o `taskUpdateSchema` com `.strict()` tem de manter esses campos (estão no domínio `meta`, `task.permissions.ts:125`) |

### 3.7 Geradores de documento

| Gerador | Onde | O que usa |
|---|---|---|
| NFS-e (Elotech) | `api/src/modules/integrations/nfse/elotech-oxy-nfse.service.ts:39-62,1295-1316,1436-1437`; montagem em `nfse-emission.scheduler.ts:503-673,908-1046` | `truck.{plate,chassisNumber,category,implementType}` e mapa PRÓPRIO de rótulo ("Isotérmico", "Prancha/Plataforma") |
| DPS do pintor | `nfse/painter/dps.builder.ts:455-532` | usa `IMPLEMENT_TYPE_LABELS` da UI ("Isoplastic", "Carroceria"), que **diverge** da nota da Elotech |
| Boleto: `seuNumero` e informativo | `invoice-generation.service.ts:1197-1328,1399-1424`; `sicredi-boleto.scheduler.ts:799-935,1002-1027` | `task: any` → `truck.plate` entra no `seuNumero` (`:811-823`) |
| Orçamento HTML/PDF da assinatura | `signature/document/quote-html.builder.ts:35-37,130-133,501-583,794-798`; `quote-text.ts:335-339`; `quote-renderer.service.ts:455-489`; dossiê `dossier-assembler.service.ts:347,980,1104` | categoria e implemento viram colunas da tabela de veículos; a arte vira seção `LAYOUT` |
| Recibo/nota em PDF no web | `web/src/utils/invoice-pdf-generator.ts:46-47,96-104` ("Layout Aprovados" lê `task.quote.layoutFiles` com `any`) | com o R1 a página da arte **some calada** |
| Prévia do faturamento no web | `web/src/components/financial/billing/preview/billing-document-previews.tsx:37-44` | outro mapa de rótulos |
| Flutter: PDF do orçamento, discriminação | `lib/features/production/budget_report_pdf_generator.dart:123,149,416`; `lib/features/financial/nfse_discriminacao.dart:55-75` (cópia declarada dos mapas da Elotech) | |
| CSV/XLSX/impressão | web `components/production/task/history/task-export.tsx:129-141` (cabeçalhos "Categoria do Caminhão", "Tipo de Implemento"), `schedule/task-schedule-export.tsx:37-38` | cabeçalho é texto de tela; planilha que o cliente consome muda de coluna |

### 3.8 Seeds, demo, scripts, testes, docs

| Item | Onde | Quebra quando |
|---|---|---|
| e2e do portal (`npm run test:portal-e2e`) | `api/tests/e2e-portal/cenarios/01-requisicao-com-medidas.ts:27-35,117-160` (lê `t.truck?.leftSideMeasure` etc.); `03-portao-compras.ts:157-169` e `04-verdade-da-espera.ts:79` (`layoutFiles: { connect }`) | rodam com `tsx` (sem checar tipo) e **quebram em runtime** depois do R1/R3. O 03 e o 04 montam o "layout aprovado" que o R1 elimina, então precisam ser reescritos, não renomeados |
| Testes unitários/integração da API com truck/layout | 19 arquivos em `api/tests/` (lista: `portal-requisicao`, `nfse-line-scale`, `portal-identificacao`, `task-match-integration`, `portal-recorte`, `boleto-informativo-cobertura`, `nfse-discriminacao`, `quote-diff`, `signature-refusal`, `quote-vehicle-share`, `quote-list-query`, `painter-nfse`, `e2e-ui/fase1..6`, `check-faturamento-separado`) | idem, `tsx` |
| Demo do portal | `api/scripts/seed-portal-demo.ts` (sem `truck`, FATO) | não quebra; mas não gera implemento/arte, então o portal novo precisa de demo nova |
| Seeds com chaves | `prisma/scripts/seed-notification-configs.ts`, `seed-dashboard-defaults-and-message-20260508.ts`, `src/scripts/seed-painting-config.ts` | ver 3.5 |
| Scripts avulsos | `scripts/{dry-run-file-organization,verify-signature-sections,test-late-slots,check-layout-dimensions,audit-file-placement,test-signature-seal,test-signature-document}.ts`, `src/scripts/{purge-test-task-d013bc8b,nfse-diagnose,audit-painter-nfse-setup}.ts` | só quando alguém roda |
| Testes do web | `utils/billing-coverage.test.ts`, `lib/attention/engine.test.ts` (fixtures com `truck`) | vitest |
| Testes do Flutter | 12 arquivos (`task_detail_include_test`, `implement_measure_test`, `garage_*`, `nfse_discriminacao_test`, `covered_vehicles_test`, `attention_engine_test`…) | `flutter test` |
| Docs que são CONTRATO | `api/docs/PORTAL-CONTRATO.md`, `PORTAL-DO-RESPONSAVEL.md`, `BUDGET-SIGNATURE-DESIGN.md` (18 docs citam truck) | desatualizam calados |

### 3.9 A face FRONTAL e os seis vocabulários de face

Hoje a mesma face tem nomes diferentes em cada camada (FATO):

| Camada | Esquerda | Direita | Traseira | Onde |
|---|---|---|---|---|
| Colunas Prisma | `leftSideMeasureId` | `rightSideMeasureId` | `backSideMeasureId` | `schema.prisma:2539-2551` |
| Rota da medida | `left` | `right` | `back` | `implement-measure.controller.ts:260` |
| Multipart | `implementMeasurePhotos.leftSide` | `.rightSide` | `.backSide` | `task.controller.ts:301-303` |
| Cotador (faces) | `MOTORISTA` | `SAPO` | `TRASEIRA` | `layout-dimensions.service.ts:168-170` |
| Requisição do portal | `esquerda` | `direita` | `traseira` | `portal-request.service.ts:211-216`, `schemas/portal-request.ts:394-396` |
| Projeção do portal | `left` | `right` | `back` | `portal-projection.service.ts:464-466,854-856` |
| Rótulo (changelog/notificação) | Motorista | Sapo | Traseira | `task-field-tracker.service.ts:98-101`, `task-notification.service.ts:83-85` |
| Pintura | `LEFT_SIDE` | `RIGHT_SIDE` | … | `schema.prisma:8751-8753` (`PaintingFaceView`) |

A frontal precisa entrar nos **oito** de uma vez, e a foto frontal hoje é impossível (`photoFile && side === 'back'`, `implement-measure.service.ts:451`). Recomendação: um único `enum ImplementFace { LEFT RIGHT BACK FRONT }` (o monorepo usa `LEFT/RIGHT/REAR/FRONT/ROOF`, `ankaa/packages/database/prisma/schema/46-production.prisma:50-58`; aqui `BACK` evita reescrever `back`, que é a chave do portal), e todas as outras formas derivadas dele por mapa único exportado.

### 3.10 Mapas de rótulo duplicados (tipo e categoria)

Tipo de implemento, **9 mapas** (FATO): `api/src/constants/enum-labels.ts:406-413`; `web/src/constants/enum-labels.ts:560`; `web/src/utils/changelog-fields.ts:1741-1751`; `web/src/components/financial/billing/preview/billing-document-previews.tsx:44`; `api/.../invoice-generation.service.ts:1415-1424`; `api/.../sicredi-boleto.scheduler.ts:1018-1027`; `api/.../elotech-oxy-nfse.service.ts:1308-1315`; Flutter `production/task_enums.dart:119-126` e `financial/nfse_discriminacao.dart:70-77`. Categoria: os mesmos 9 lugares (`…:1399-1411`, `…:1002-1013`, `…:1295-1306`, etc.). Os rótulos já divergem entre a nota e a UI (`INSULATED`: "Isotérmico" × "Isoplastic"; `FLATBED`: "Prancha/Plataforma" × "Carroceria"). Com o R4 criando TIPO e CATEGORIA como campos do implemento, é a hora de ter UMA fonte na API e um teste de exaustividade em cada repositório.

---

## 4. Lições do rename de 05/07/2026 (a evidência do que dá errado)

O rename `Layout`→`ImplementMeasure` / `Artwork`→`Layout` (`api/prisma/migrations/20260705130000_rename_layout_artwork_borrow_cleanup/migration.sql`) foi feito certo no BANCO (só `RENAME`, com constraints e índices, e `RENAME VALUE` no enum do changelog). Nas STRINGS, deixou três tipos de lixo que estão no ar até hoje:

1. **Texto de tela corrompido por busca-e-troca** (FATO): "ImplementMeasure do Caminhão atualizado" como título de notificação (`implement-measure.service.ts:901,1092`), "ImplementMeasure inválido" como mensagem de validação (`api/src/schemas/truck.ts:505-528`), "ImplementMeasure do Caminhão" como rótulo (`changelog-fields.ts:762`, `task-notification.service.ts:86`), "ImplementMeasure do caminhão salvo com sucesso" (`implement-measure.controller.ts:246`) e, **gravado no banco**, `ChangeLog.reason = 'ImplementMeasure criado'` (`implement-measure.service.ts:149,174,209,530,619,671`).
2. **Chaves mortas que continuam como linha**: `task.field.truck.*SideLayoutId` (citadas em `seed-notification-configs.ts:182`), agora em `FORCE_DISABLE`.
3. **Nomes em inglês que viraram tela**: coluna "Medidas" que no JSON é `implementMeasures`, e rótulos "Lado Sapo" misturados com "Lateral Direita" (`web/src/utils/changelog-fields.ts:381-383` × `:851-853`).

Regra que sai disso: **renomear identificador nunca por `sed` global**. O rename é por AST (TS: `ts-morph`/rename do LSP; Dart: `dart fix`/rename do analyzer), e a busca-e-troca em string literal é proibida pela guarda G6b (§5).

---

## 5. Guardas para o R8

### 5.1 O que existe hoje (FATO)

| Guarda | Onde | Alcance real |
|---|---|---|
| CI | **não existe** em `api`, `web`, `mobile-flutter` (sem `.github/`, sem `core.hooksPath`, sem husky) | zero; tudo é manual |
| `tsc` da API | `nest build` com `api/tsconfig.build.json`: `strict: false`, `noImplicitAny: false`, **`noEmitOnError: false`**, `include: ["src/**/*"]` | só `src/`. `tests/`, `scripts/`, `prisma/scripts/` nunca são checados. INFERÊNCIA: o `dist` é emitido mesmo com erro de tipo, então um deploy que não pare no exit code leva o erro ao ar |
| `tsc` do web | `"build": "rm -rf … && vite build"` (sem `tsc`); existe `build:with-tsc` | o deploy normal **não checa tipo** |
| Testes da API | ~60 scripts `npm run test:*` em `tsx` (sem checagem de tipo), sem agregador; `test:portal-cliente:boot` sobe o grafo do Nest (pega DI, não include); `test:portal-e2e` precisa da pilha dev em 3031/5174 e do log da API (`tests/e2e-portal/run.sh:1-34`) | rodam quando alguém lembra |
| Testes do web | ~31 arquivos vitest | idem |
| Flutter | `flutter analyze` + ~73 testes; `test/task_detail_include_test.dart` espelha a whitelist da API **à mão** | o espelho já é prova do padrão certo, com a fonte errada |
| Porta de include | `INCLUDE_WHITELIST` (403) para 5 entidades | parcial, e já com deriva (`truckId`) |
| `where` de Task `.strict()` | `schemas/task.ts:1387` | só o topo |
| Alias de include deprecado | `schemas/budget.ts:150-158` (`task`), `include-mapper.helper.ts:43-60` (`fieldMappings`) | mecanismo pronto para `truck`→`implement` |
| Conferência de FK de arquivo no boot | `file-reference.service.ts:236-262` (só `warn`) | não bloqueia |
| Upload recusa `fileContext` desconhecido | `file.controller.ts:113-119` | alto (400) |
| Filtro global mapeia `PrismaClientValidationError`→400 | `common/filters/global-exception.filter.ts:251-259` | mas os serviços embrulham em `InternalServerErrorException` (11× só em `task.service.ts`), então na prática é 500 |
| Projeções materiais versionadas + testes | `quote-snapshot.service.ts:294-384`, `tests/quote-diff.test.ts`, `scripts/verify-signature-sections.ts` | bom, mas nenhum teste usa hash REAL gravado |
| Seed de notificações com `--dry-run` e `FORCE_DISABLE` | `seed-notification-configs.ts:182-200,8885-8930` | bom |

### 5.2 O que falta: guardas propostas (por prioridade)

| # | Guarda | Pega o quê | Como | Esforço |
|---|---|---|---|---|
| **G1** | **Validador de consulta derivado do DMMF** (uma porta só para include/select/where/orderBy de TODAS as rotas) | chave inventada que hoje dá 500 (passthrough) ou some (enumerado) | pipe/helper na API que percorre a árvore contra `Prisma.dmmf.datamodel.models` (relação vs escalar, entidade de destino recursiva). Chave desconhecida vira **400 com o nome da chave**. Uma tabela `DEPRECATED_QUERY_KEYS = { Task: { truck: 'implement' }, Budget: { layoutFiles: null /* ignorar */ } }` traduz, conta e loga cada uso de chave velha com a data de desligamento. Substitui `prismaRelationValue` passthrough, e o `INCLUDE_WHITELIST` passa a ser só a camada de PERMISSÃO | M |
| **G2** | `.strict()` nos corpos de implemento e no objeto `implement` do `taskUpdateSchema`, com tratamento EXPLÍCITO da chave velha `truck` (traduz na janela de compatibilidade e depois responde 426 "Atualize o app") | o "salvou com 200 e não gravou" | manter aceitos os campos do outbox (`_hasFiles`, `_soFileMapping`, `expectedUpdatedAt`) | P |
| **G3** | **Censo de consultas** (telemetria de leitura, ANTES da migração) | as formas que os clientes REALMENTE mandam, inclusive app velho | middleware que registra no log, por rota, o conjunto distinto de caminhos de chave de `include/select/where/orderBy` + corpo (só as chaves, sem valores) + `User-Agent`/versão do app. Duas semanas em produção dão a lista real. Sem escrita no banco | P |
| **G4** | **Teste de contrato de consultas** | constante de include do web/app que não bate com o schema/banco | (a) extrator estático: `ts-morph` no web (objetos passados em `include`/`select`/`where` nos `api-client` e hooks, mais as constantes `*_INCLUDE`) e script Dart no Flutter (mapas `'include':`) geram `contracts/queries/{web,flutter}.json`; (b) o censo (G3) completa o que é montado dinamicamente; (c) `api/tests/query-contract.test.ts` passa cada forma por: zod da rota → G1 → `prisma.<model>.findFirst({...forma, take: 1})` dentro de transação revertida no clone local. Falha = arquivo e linha de origem | M |
| **G5** | **Fim dos espelhos à mão**: codegen da API para os clientes | whitelist, enums, rótulos, faces, chaves de notificação | `api/scripts/export-contracts.ts` gera um JSON (enums + rótulos + faces + `INCLUDE_WHITELIST` + campos multipart + `fileContext`); web e Flutter importam ou geram código a partir dele; o teste do Flutter (`task_detail_include_test.dart`) lê o JSON em vez da cópia. Teste de exaustividade por repositório: todo valor de enum tem rótulo em cada mapa (§3.10) | M |
| **G6a** | **Portão de resíduo `truck` com catraca** (grep) | resíduo do rename | `scripts/guard-residual.sh` por repositório: `rg -n -i '\btrucks?\b\|Truck[A-Z]\|TRUCK_(?!MANUFACTURER\|SPOT)'` fora de `.residual-allowlist`. Guarda uma contagem-base por arquivo (`.residual-baseline.json`), que só pode cair (catraca). Lista de exceções nomeadas: `TRUCK_MANUFACTURER*`, valores `'TRUCK'`/`'BITRUCK'` de categoria, ícone `"truck"`/`IconTruck` (156 no web), `pages/tools/truck-studio/**`, `studio-*`, `public/models/trucks`, migrações, **`quote-snapshot.service.ts`/`quote-diff.ts` (chave `truck` v1–v4 do hash)**, bloco "legado" dos mapas de rótulo do changelog, chaves mortas do seed de notificação, e o arquivo do shim de compatibilidade (com data de expiração no próprio arquivo). O mesmo portão, depois do R1, vale para `layoutFiles\|quoteLayoutId\|QUOTE_LAYOUT\|sync-quote-task-layouts` (exceções: leitores de snapshot/diff) | P |
| **G6b** | Portão de "identificador em texto de tela" | a corrupção de julho | `rg` por string literal com identificador em inglês colado a português (`'ImplementMeasure [a-zçã]`, `'Implement [a-z]'`, `'Truck [a-z]'`) em `api/src`, `web/src`, `lib/` | P |
| **G7** | **Matriz setor × campo** na escrita da tarefa | achado 2 | teste que, para cada setor de `SECTOR_TASK_UPDATE_ACCESS`/`CREATE_ACCESS`, chama `validateSectorFieldAccess` com o corpo real que o formulário daquele setor manda (fixture do web/Flutter). **Proibido testar só como ADMIN** | P |
| **G8** | Caminhos das regras de Atenção resolvem | achado 3 | teste (web e Flutter) que pega uma tarefa totalmente preenchida vinda da API (fixture gerada pelo include da tela) e exige que TODO `field` de predicado resolva para algo diferente de `undefined`. `isNull` sobre caminho que não existe = falha do teste | P |
| **G9** | Toda chave emitida existe no registro de notificações | achado 5 | varredura estática dos literais de `dispatchByConfiguration(…)`/`dispatchByConfigurationToUsers(…)` e dos `task.field.${field}` gerados pelo tracker, contra as chaves do seed | P |
| **G10** | Referências de arquivo conferidas | achado 4 | transformar o `warn` do boot (`file-reference.service.ts:236-262`) em teste: catálogo de FKs ⊆ `INBOUND_REFERENCES`, `OUTBOUND_REFERENCES[].column` existe em `File` (DMMF), e todo `fileContext` que os clientes mandam (G5) existe em `folderMapping` | P |
| **G11** | **Hashes de ouro das assinaturas** | achado 1 | exportar do clone (anonimizado) N `SignatureEnvelope` reais: `quoteSnapshot`, `quoteTermsSha256`, versão. Teste: `materialHash(snapshot, v) === quoteTermsSha256` para todos, antes e depois do rework. Mais um teste específico: "com o R1 aplicado, o envelope X continua reconhecido como NÃO alterado" | P |
| **G12** | Parâmetros de rota e de query validados em runtime | achado 9 | `ParseEnumPipe`/zod em `:side` e em `truckId`/`implementId` | P |
| **G13** | Portão de versão do app | app velho gravando pela metade | `dio` do Flutter manda `X-App-Version`; a API tem `MIN_APP_VERSION` e responde 426 com a mensagem de atualização. O adiamento (`native_update_service.dart`) deixa de valer quando a versão estiver abaixo do mínimo | P |
| **G14** | Rodar o que já existe, sempre, na mesma ordem | tudo | `api/scripts/pre-deploy.sh`: `tsc --noEmit -p tsconfig.json` (inclui `test/`; somar `tests/` e `scripts/`) + G4…G11 + `test:portal-cliente:boot` + `test:portal-e2e`; `web`: `build:with-tsc` + vitest; Flutter: `flutter analyze` + `flutter test` (nunca `dart format` global). Sem CI, um script único que o operador roda e cujo resultado vai na mensagem de deploy | P |

P = pequeno (até 1 dia), M = médio (2–4 dias). INFERÊNCIA de esforço.

### 5.3 Janela de compatibilidade (necessária por causa do app)

Como a API não conhece a versão do app e o aviso de atualização pode ser adiado, o rename precisa de **duas fases**:

1. **API bilíngue**: aceita `truck` e `implement` em include/where/corpo/multipart/`fileContext`/rota (G1 com alias, G2 com tradução, aliases de rota `/trucks`→novo, `truckVinPlate` ainda aceito). Para cliente que pediu `truck`, a resposta também leva `truck` (cópia de `implement`), para o `fromJson` velho não esvaziar a tela. Tudo com contador no log.
2. **Desligamento**: quando o censo (G3) mostrar zero uso de chave velha por X dias, ou com o G13 forçando a versão mínima, remover os aliases.

---

## 6. Ordem de deploy e checklist

Lembretes gravados na memória do projeto que valem aqui: **builde ANTES de migrar** (janela de 500); `pm2 restart` falha em silêncio (o serviço é **systemd**); health 200 pode ser o processo VELHO (confira o `build-info`); bundle velho do web gera 500 falso; `git diff A...B` mente sobre "já na main" (use `gh pr list`/`git cherry`).

1. **Pré-condição de dados** (consultas da §9): nenhum `SignatureEnvelope` vivo com `layoutFileIds` não vazio, OU a regra de transição do achado 1 implementada e coberta pelo G11. Contar preferências e linhas de notificação que vão ser traduzidas.
2. Censo (G3) no ar há ≥ 2 semanas; lista de formas antigas exportada como fixture do G4.
3. API fase 1 (bilíngue) buildada → `pre-deploy.sh` verde → migração (rename in place: `ALTER TABLE "Truck" RENAME TO …` + constraints + índices + `RENAME VALUE` no `ChangeLogEntityType`, se for a decisão) → `systemctl restart` → conferir `build-info` → `test:portal-e2e`.
4. Na MESMA migração ou num script idempotente: `UserNotificationPreference.eventType` velho→novo; linhas novas de `NotificationConfiguration` (seed com `--dry-run` antes) e velhas em `FORCE_DISABLE`; tradução de `Preferences.dashboardLayoutWeb/Mobile` (filtros e colunas); os ids de `AttentionAck` **não** mudam.
5. Web (bundle novo; chaves novas, API ainda bilíngue).
6. Flutter: patch Shorebird do que for só Dart + release nativa se mudar dependência; ligar `MIN_APP_VERSION`.
7. Com o censo zerado: API fase 2 (remove aliases), portão G6 com a lista de exceções final.

---

## 7. Decisões que só o dono pode tomar (com recomendação)

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D1 | O Implemento herda o **id** do Truck (rename in place) ou nasce entidade nova, 1 implemento para N tarefas, casando por série/placa? | Rename in place agora; consolidar N tarefas → 1 implemento numa segunda etapa, com tabela de mapeamento `oldTruckId → implementId` | `ChangeLog.entityId`, `Notification.relatedEntityId`, `triggeredById`, `AttentionAck`, a URL do portal e o `taskId` do snapshot apontam para esses ids. Ids novos deixam órfão tudo que já foi gravado |
| D2 | `ChangeLogEntityType.TRUCK` vira `IMPLEMENT` por `RENAME VALUE`? | Sim, `RENAME VALUE` (precedente de julho), com o web aceitando os dois nomes na fase 1 | o histórico continua inteiro |
| D3 | Envelopes em coleta com arte no orçamento no dia do R1 | Não fazer o deploy com envelope vivo com arte; se não der para esperar, criar a regra de transição "layoutFileIds do congelado é satisfeito pelas mesmas file ids ligadas ao(s) implemento(s)", **provada pelo G11** | a alternativa é derrubar assinatura colhida |
| D4 | O recorte `LAYOUT` (seção do documento e capacidade do portal para MARKETING) passa a significar "arte do implemento"? | Manter a chave `LAYOUT` e mudar a semântica, documentando | a chave está gravada em `EnvelopeDocument.sections` e é o `variantKey` |
| D5 | Os ~283 PDFs cotados que hoje são "layout" viram "projeto da tarefa": mudam de pasta no servidor de arquivos? | Não mover na migração; pasta nova só para o que for enviado depois, e mover o acervo antigo num segundo passo, avisando os designers | o organizador moveria em massa arquivos que as pessoas abrem pela pasta |
| D6 | Renomear valores de enum (ex.: `INSULATED` → algo) ou só acrescentar? | Só acrescentar valores; se precisar mudar rótulo, mudar o RÓTULO | o valor está em snapshot, changelog, preferências e URLs |
| D7 | Unificar os rótulos da nota fiscal com os da tela ("Isotérmico" × "Isoplastic")? | Fonte única na API, com dois perfis ("nota" e "tela") no mesmo arquivo, e teste de exaustividade | hoje são 9 mapas e dois já divergem |
| D8 | Rótulo "Caminhão" nas telas e templates vira "Implemento" em todo lugar? | Sim na tela; templates de notificação por reseed; mensagens de WhatsApp aprovadas pela Meta só se citarem o termo (FATO: os templates de assinatura não citam "caminhão"/"layout", `src/templates/signature-whatsapp.ts`) | |
| D9 | Portão de versão mínima do app (G13) | Sim, antes do rework | sem ele não há como desligar a compatibilidade com segurança |

---

## 8. Perguntas ao dono

1. O app React Native antigo (`/home/kennedy/Documents/repositories/mobile`, último commit 14/08) ainda está instalado em algum aparelho? A API continua servindo o protocolo de atualização do Expo (`api/src/modules/system/update/update.controller.ts`), e o app lê `truck` em 140 arquivos. Um jeito de responder sem mexer no código: procurar requisições com cabeçalho `expo-runtime-version` no log de acesso dos últimos 30 dias.
2. A branch `feat/orcamento-veiculos` (layout aprovado por veículo, `layoutCoverage` no snapshot) vai ao ar antes deste rework? Se for, o snapshot ganha um terceiro formato de arte para sustentar.
3. Com a arte no implemento, o status (rascunho/aprovado/reprovado) é **por implemento**? Hoje `Layout.status` é um só por arquivo (`schema.prisma:87-100`), compartilhado por todas as tarefas que usam o mesmo arquivo.
4. O histórico antigo de "layout aprovado do orçamento" (`ChangeLog` de `TASK_QUOTE` com `layoutFileIds`) continua podendo ser desfeito? Recomendo que não (recusar com mensagem).
5. O "projeto do implemento" (Furgões Ibiporã) entra por qual contexto de pasta? Proposta: `Clientes/{cliente}/Implementos/{série}/Projeto/`, fora de `Projetos/` da tarefa.

---

## 9. Consultas para quem tem autorização (somente SELECT, clone local)

```sql
-- Histórico
SELECT "entityType", count(*) FROM "ChangeLog" WHERE "entityType" IN ('TRUCK','IMPLEMENT_MEASURE') GROUP BY 1;
SELECT field, count(*) FROM "ChangeLog"
 WHERE field ILIKE 'truck%' OR field IN ('layouts','layoutIds','layoutFileIds','projectFiles','projectFileIds','implementType','category','implementMeasures')
 GROUP BY 1 ORDER BY 2 DESC;
SELECT field, count(*) FROM "TaskFieldChangeLog" WHERE field ILIKE 'truck%' OR field ILIKE 'layout%' OR field ILIKE 'project%' GROUP BY 1;

-- Notificações
SELECT key, enabled FROM "NotificationConfiguration" WHERE key ILIKE '%truck%' OR key ILIKE 'task.field.layout%' OR key ILIKE 'task.field.project%';
SELECT "eventType", count(*) FROM "UserNotificationPreference" WHERE "eventType" ILIKE '%truck%' OR "eventType" ILIKE '%layout%' GROUP BY 1;
SELECT count(*) FROM "Notification" WHERE "relatedEntityType" = 'TRUCK' OR metadata::text ILIKE '%"truck.%';

-- Assinatura (achado 1): envelopes vivos com arte e formato do snapshot
SELECT status, count(*) FILTER (WHERE jsonb_array_length("quoteSnapshot"->'layoutFileIds') > 0) AS com_arte,
       count(*) FILTER (WHERE "quoteSnapshot" ? 'truck') AS formato_v1_v2, count(*)
  FROM "SignatureEnvelope" GROUP BY status;
SELECT count(*) FROM "EnvelopeDocument" WHERE 'LAYOUT' = ANY(sections);

-- Preferências
SELECT count(*) FILTER (WHERE "dashboardLayoutWeb"::text ~ '"(truckCategories|implementTypes|hasTruck|truckCategory|implementType|hasLayouts)"') AS dash_web,
       count(*) FILTER (WHERE "dashboardLayoutMobile"::text ILIKE '%layouts%') AS dash_mobile,
       count(*) FILTER (WHERE "tableConfigsWeb"::text ~ '(truckCategory|implementType|truckSpot)') AS table_web,
       count(*) FILTER (WHERE "detailConfigsWeb"::text ~ '(truckCategory|implementType|truckSpot|"layouts")') AS detail_web
  FROM "Preferences";
SELECT "ruleId", "entityType", count(*) FROM "AttentionAck" WHERE "ruleId" LIKE 'task.entry-without-%' OR "entityType" = 'TRUCK' GROUP BY 1,2;

-- Arquivos (R1/R2/R6)
SELECT count(*) FROM "File" WHERE "quoteLayoutId" IS NOT NULL;
SELECT (f.mimetype = 'application/pdf') AS pdf, count(*) FROM "Layout" l JOIN "File" f ON f.id = l."fileId" WHERE l."airbrushingId" IS NULL GROUP BY 1;
SELECT count(*) FROM "_TASK_PROJECT_FILES";
SELECT split_part(path, '/', 5) AS pasta, count(*) FROM "File" WHERE path ~ '/Clientes/[^/]+/(Layouts|Projetos|Plaquetas|Traseiras)/' GROUP BY 1;

-- Enums (valores em uso)
SELECT category, "implementType", count(*) FROM "Truck" GROUP BY 1,2 ORDER BY 3 DESC;
```

---

## 10. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Assinaturas colhidas invalidadas no deploy do R1 (achado 1) | alta se houver envelope vivo com arte | **jurídico/comercial** (coleta perdida, `PADES_FAILED` no selo) | D3 + G11 + pré-condição do §6.1 |
| Setores sem permissão de gravar o implemento (achado 2) | alta, se testado como ADMIN | produção parada no formulário | G7 |
| Enxurrada de alertas falsos de Atenção (achado 3) | alta | a equipe aprende a ignorar o sistema | G8 + manter os ids das regras |
| Notificações mudas (achado 5) | média | ninguém fica sabendo de mudança de placa/medida | G9 + reseed |
| App instalado gravando pela metade ("salvou" e não gravou) | alta | dado perdido sem sinal | G2 + G13 + §5.3 |
| NFS-e sem identificação do veículo ou com enum cru (achado 11) | média | **fiscal, irreversível** | G5 (fonte única + exaustividade) + teste de discriminação existente (`tests/nfse-discriminacao.test.ts`) atualizado ANTES |
| Exclusão de arquivo travada / organizador parado (achado 4) | média | operacional | G10 + restart logo após a migração |
| Busca de tinta por placa vazia (achado 10) | alta se esquecer | baixo | G6a (o SQL cru entra no portão) |
| Widget de dashboard volta ao padrão (achado 6) | alta se mexer em enum/coluna | irritação e confiança | tradução do JSON + `z.preprocess` com alias no schema do widget |
| Build com erro de tipo indo ao ar | média | qualquer | G14 (`build:with-tsc`, `tsc --noEmit` que inclua `tests/` e `scripts/`) |
| Busca-e-troca corrompendo texto de tela e dado gravado | alta (já aconteceu em julho) | cosmético, mas vai para o banco (`ChangeLog.reason`) | rename por AST + G6b |
| Terceiro formato de arte no snapshot (branch da outra sessão) | depende do dono | dívida permanente de leitura | pergunta 2 |
