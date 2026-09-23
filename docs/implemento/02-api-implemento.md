# 02 — API: Truck → Implemento (R3/R4/R5/R6/R8)

Recorte: tudo na API (`/home/kennedy/Documents/repositories/api`, branch `feat/portal-do-responsavel`, HEAD `ad3c65d4`) que toca Truck / implemento / medidas / spot / categoria / tipo, **fora** orçamento, assinatura, portal e layout-no-orçamento (esses aparecem aqui só como FRONTEIRA, com o ponto exato de contato).

Legenda: **FATO** = li no código (cito arquivo:linha). **INFERÊNCIA** = dedução minha, marcada. Não consultei banco (não fui instruído); onde o número importa deixo a consulta pronta (§12).

---

## 0. Resumo executivo

1. **`Truck` é uma linha POR TAREFA, não um veículo.** `Truck.taskId @unique` + `onDelete: Cascade` (prisma/schema.prisma:2537,2552). Ao mesmo tempo `Truck.plate @unique` (schema.prisma:2532; `0_init` cria `Truck_plate_key`) e `validateTask` recusa placa repetida em outra tarefa (task.service.ts:10787-10798). Ou seja: um veículo que volta para outra tarefa não pode reusar a placa. Antes do rename, o dono precisa dizer se "Implemento" continua sendo 1:1 com a tarefa (o rename puro) ou vira entidade reaproveitável N:1, como no monorepo (`Implement.tasks Task[]`, 46-production.prisma:359). Recomendo **1:1 neste rework** (§10 D1).
2. **Há 9 escritores independentes de medida** (tabela §4). Cada um repete à mão os 3 lados: create, batchCreate, update, batchUpdate, rollback, copyFrom, o módulo `/implement-measure`, `portal-identity` e `portal-request`. Pôr a face FRONTAL (R5) quer dizer mexer nos 9. Esse é o maior risco do R8 ("alguma página esquecida", aqui "algum caminho esquecido"). Recomendo, **antes** do rename, juntar os 9 num `ImplementMeasureWriter` único.
3. **Os portões de tipo não seguram nada.** `tsconfig.build.json` tem `"noEmitOnError": false`, `"strict": false` e `"noImplicitAny": false`, e não há CI nem script `typecheck` no repo da API (package.json:8,18; não existe `.github/workflows`). O build EMITE com erro de tipo. Pior: boa parte do acesso a truck passa por `any` ou chave-string (10 casts `(x as any).truck`; 22 literais `'leftSideMeasureId'`; 61 literais `'truck.`; 9 literais `'trucksLeftSide'`), que o `tsc` não vê. **FATO.**
4. **Três furos que produzem exatamente o 500 / o dado sumido que o dono quer evitar, e que já existem hoje:**
   - `GET /trucks`, `GET /trucks/:id` e `PUT /trucks/:id` repassam `@Query() query: any` → `include: query?.include` direto ao Prisma, sem validação (truck.controller.ts:38,213,245; truck.service.ts:134-145,176). O `truckGetManySchema` existe (schemas/truck.ts:388) e **não está plugado**.
   - `taskIncludeSchema` aceita `cutRequest`/`cutPlan`, que não são relações de `Task` (schemas/task.ts:1143-1144; `model Task` não tem esses campos): passam no zod e estouram no Prisma. `taskWhereSchema` aceita `bonifications`/`cutRequest`/`cutPlan` (task.ts:1335,1369-1370), e a relação real é `bonuses`. `customerIncludeSchema.tasks.include` aceita `budget`, `nfe`, `files`, `airbrushing` (customer.ts:30-40), que não existem em `Task`. É a classe "chave inventada atravessa o zod e estoura no Prisma".
   - Raw SQL `LEFT JOIN "Truck"` em `paint.service.ts:507,510`, dentro de um `try/catch` que devolve `[]` (paint.service.ts:524-527). Se a tabela for renomeada fisicamente, a busca de tinta por placa passa a devolver vazio **sem erro**.
5. **Identificadores persistidos que NÃO podem ser renomeados às cegas** (§7): chaves de notificação `task.field.truck.*` e `truck.movement_request` (em `NotificationConfiguration.key/eventType` e `UserNotificationPreference.eventType`); `ChangeLogEntityType.TRUCK`; `TaskFieldChangeLog.field = 'truck.plate'…`; contextos de arquivo `truckVinPlate` / `implementMeasurePhotos`; as chaves JSON `truck` / `implementType` dentro dos snapshots de assinatura, que entram no hash MATERIAL.
6. **Contrato proposto** (§9): o model Prisma passa a `Implement`, com `@@map("Truck")` e `@map` nos campos. O rename fica **sem DDL**; só entram colunas novas: face frontal e porta traseira. Rotas `/implements`, chave `implement` no payload, include e where. Janela de compatibilidade no servidor: aceita `truck` e traduz, e devolve `truck` espelhado enquanto houver app antigo. A validação de include/select/where passa a ser gerada do DMMF do Prisma e é estrita, com teste de contrato zod×DMMF.

---

## 1. Modelo atual (FATO)

| Model / enum | Onde | O que é hoje | Observação |
|---|---|---|---|
| `Truck` | schema.prisma:2530-2562 | `plate?` @unique, `chassisNumber?`, `category TruckCategory?`, `implementType ImplementType?`, `spot TRUCK_SPOT? @default(YARD_WAIT)`, `taskId @unique`, `vinPlateId?`, `back/left/rightSideMeasureId?`, colunas geradas `plateNormalized`/`chassisNumberNormalized` | 1:1 com `Task`, cascade. O `@default(YARD_WAIT)` é contrariado pelo código, que grava `spot: null` na criação (task-prisma.repository.ts:1065-1066) |
| `ImplementMeasure` | schema.prisma:2564-2576 | `height` (METROS), `photoId?`, `sections[]`, relações inversas `trucksBackSide/LeftSide/RightSide Truck[]`, `paintingAnalyses[]` | **Não tem coluna `face`**: o lado sai de QUAL FK aponta para a linha. Pode ser **compartilhada** entre caminhões (relação 1-N) |
| `ImplementMeasureSection` | schema.prisma:2578-2590 | `width` (m), `isDoor`, `doorHeight?`, `position` | cascade com a medida |
| `enum TruckCategory` | schema.prisma:4297-4308 | MINI, VUC, THREE_QUARTER, RIGID, TRUCK, SEMI_TRAILER, SEMI_TRAILER_2_AXLES, B_DOUBLE_FRONT, B_DOUBLE_REAR, BITRUCK | mistura porte de chassi com montagem (o monorepo separou em `ImplementMounting` + `ChassisClass`, 46-production.prisma:61-81) |
| `enum ImplementType` | schema.prisma:4310-4317 | DRY_CARGO, REFRIGERATED, INSULATED, CURTAIN_SIDE, TANK, FLATBED | |
| `enum TRUCK_SPOT` | schema.prisma:4265-4295 | YARD_WAIT, YARD_EXIT, B{1..3}_F{1..3}_V{1..3} | a vaga é da TAREFA/visita (o monorepo diz isso explicitamente, 46-production.prisma:407) |
| `enum TruckManufacturer` | schema.prisma:4049 | montadora | só em `Paint.manufacturer` (schema.prisma:1505). **Não é do implemento**: fica fora do rename |
| `ChangeLogEntityType.TRUCK` / `IMPLEMENT_MEASURE` | enum ChangeLogEntityType (TRUCK é a 93ª entrada; IMPLEMENT_MEASURE a 43ª) | tipo persistido em `ChangeLog.entityType` | histórico |
| `ChangeLogTriggeredByType.TRUCK` | schema.prisma:4516 | | |
| `File` → `truckVinPlates Truck[] "TRUCK_VIN_PLATE"`, `implementMeasurePhotos`, `taskProjectFiles` | schema.prisma:767-768,797 | | |
| `Task.truck Truck?`, `Task.projectFiles File[] "TASK_PROJECT_FILES"`, `Task.layouts Layout[] "TaskLayouts"` | schema.prisma:2397,2411,2410 | | |
| `PaintingAnalysis.implementMeasureId` | schema.prisma:8861,8877 | FK para UMA medida, `onDelete: SetNull` | remedir apaga a linha antiga e anula o vínculo em silêncio (INFERÊNCIA a partir dos escritores da §4, que apagam a medida velha) |
| `PaintingFaceView` | schema.prisma:8751-8757 | LEFT_SIDE, RIGHT_SIDE, BACK, **FRONT**, ROOF | o motor de pintura já conhece a face frontal; o cadastro de medida não |

Unidades: medida em **metros** no banco (o SVG multiplica por 100 em implement-measure.service.ts:730-731; a doc do cotador avisa em layout-dimensions.service.ts:135). O portal digita em centímetros e divide por 100 (fronteira; ver o agente do portal).

Rótulos dos lados: `left`='Motorista', `right`='Sapo', `back`='Traseira` (implement-measure.service.ts:128-130,302-304,832-834,937-939; task-field-tracker.service.ts:99-101; changelog-fields.ts:763-765; layout-dimensions.service.ts:168-170). ⚠️ A memória do Studio registra "`right`=motorista" para a geometria 3D. Aqui, na API, **left = Motorista**. Quem desenhar a face frontal e as telas precisa conferir isso.

---

## 2. Rotas e controllers

### 2.1 `TruckController` — `@Controller('trucks')` (src/modules/production/truck/truck.controller.ts)

| Rota | Linha | Validação hoje | O que muda |
|---|---|---|---|
| `GET /trucks` | 28-45 | **nenhuma**: `@Query() query: any`; o service faz `findMany({ include: query?.include })` sem where nem paginação (truck.service.ts:134-138) | vira `GET /implements` com `implementGetManySchema` (paginado, include estrito). Alias `/trucks` na janela |
| `GET /trucks/sector-garage-mapping` | 50-71 | — | mover para `/garages/sector-mapping` (domínio pátio) ou manter; alias |
| `GET /trucks/garages-availability?truckLength&excludeTruckId` | 78-102 | `ParseFloatPipe` | nomes de query `truckLength`/`excludeTruckId` → `implementLength`/`excludeImplementId`, aceitando os velhos |
| `GET /trucks/lane-availability/:garageId` | 109-140 | garageId à mão | idem |
| `POST /trucks/batch-update-spots` | 146-168 | body tipado só em TS (`{updates: Array<{truckId, spot: string}>}`); **sem zod**; `spot` vai `as any` ao Prisma (truck.service.ts:469). Existe `truckBulkSpotUpdateSchema` (schemas/truck.ts:618) **não plugado** | plugar o schema (spot inválido hoje dá 500 do Prisma); chave `implementId` com alias `truckId`. **Flutter usa esta rota** (mobile-flutter lib/features/garages/garage_edit_controller.dart:233) |
| `POST /trucks/request-movement` | 174-201 | body sem zod (`taskId, truckId, taskName, fromSpot, toSpot`) | plugar zod; `truckId`→`implementId` com alias |
| `GET /trucks/:id` | 203-227 | `ParseUUIDPipe`; `query: any` → include cru | `GET /implements/:id`, include estrito |
| `PUT /trucks/:id` | 229-261 | `truckUpdateSchema` (não strict: chave desconhecida some em silêncio) + `query: any` → `include` cru em `tx.truck.update` (truck.service.ts:176) | `PUT /implements/:id`, schema estrito com tradução de legado |

`TruckService` (truck.service.ts) — pontos:

| Linha | O que faz | Muda com |
|---|---|---|
| 69-76, 186 | `TRUCK_TRACKED_FIELDS`: plate, chassisNumber, vinPlateId, category, implementType, spot | R4 (`implementType`→`type`), R5 (campos da porta traseira), R6 (projeto) |
| 90-132 | emite `task.field.changed` com `field: 'truck.<campo>'` depois do commit | chave de evento persistida (§7) |
| 164-193 | update + `trackAndLogFieldChanges(entityType: ENTITY_TYPE.TRUCK)` | §7 |
| 213-351 | disponibilidade de faixa: comprimento pela soma das seções `left||right` (l.248-255) | a face frontal não entra no comprimento; manter |
| 357-508 | `batchUpdateSpots`: limpa conflito, valida barracão×setor, grava; `trackAndLogFieldChanges` TRUCK | spot (decisão D2) |
| 544-588 | `requestMovement` → `dispatchByConfiguration('truck.movement_request', { entityType: 'TRUCK' })` | chave de notificação persistida (§7) |

### 2.2 `ImplementMeasureController` — `@Controller('implement-measure')` (implement-measure.controller.ts)

| Rota | Linha | Validação | Muda |
|---|---|---|---|
| `GET /implement-measure` | 38-64 | flags string | contagem de uso lê `trucksLeftSide/RightSide/BackSide` (implement-measure.service.ts:58,69-71) → somar a frontal |
| `GET /implement-measure/:id` | 66-94 | **sem ParseUUID**; `query: any` → `include` cru, espalhado no `findUnique` (implement-measure-prisma.repository.ts:13-25) | include estrito |
| `GET /:id/usage` | 96-115 | — | `getTrucksUsingImplementMeasure` (l.246) → incluir a frontal |
| `GET /implement-measure/truck/:truckId` | 117-142 | sem ParseUUID | → `/implement-measure/implement/:implementId`; devolver `frontSideMeasure` |
| `POST /` / `PUT /:id` | 144-182 | `implementMeasureCreate/UpdateSchema` (não strict) | `PUT /:id` edita **no lugar**, sem copy-on-write (repository.ts:110-146): se a linha é compartilhada, altera os outros caminhões |
| `DELETE /:id` | 184-194 | — | |
| `POST /:id/assign-to-truck` | 196-215 | body **sem zod** (`truckId`, `side: 'left'\|'right'\|'back'`); `side` desconhecido vira `undefined` como chave do Prisma | → `assign-to-implement`, zod com `side ∈ {left,right,back,front}` |
| `POST /truck/:truckId/batch` | 217-249 | body sem zod no topo; cada lado com `.parse` | somar `front` |
| `POST /truck/:truckId/:side` | 251-284 | `side` do path **sem validação**; foto só quando `side === 'back'` (implement-measure.service.ts:451) | `side` validado; decidir se a frontal também leva foto |
| `GET /:id/svg` | 286-310 | — | ok |

Mensagens ao usuário vazaram do rename mecânico `Layout→ImplementMeasure` de 05/07: `'ImplementMeasure criado com sucesso'` (controller:157,179,191,246,281,307…), `'ImplementMeasure do Caminhão atualizado'` (implement-measure.service.ts:1086-1087; task-notification.service.ts:86), `'…não possui implementMeasure configurado'` (task.service.ts:12266). Aproveitar o rework e trocar por "Medidas do implemento".

### 2.3 Rotas de `/tasks` que carregam truck (task.controller.ts)

| Rota | Linha | Truck |
|---|---|---|
| `GET /tasks` | 106-131 | `validateIncludes('Task', …)` (whitelist que devolve **403** em chave desconhecida) |
| `POST /tasks` | 133-200 | multipart `truckVinPlate` (l.156); body `truck` aninhado |
| `POST /tasks/batch`, `/batch-with-quote` | 235-272 | `truck` por tarefa |
| `PUT /tasks/batch` | 274-316 | multipart `truckVinPlate` (l.299), `implementMeasurePhotos.leftSide/rightSide/backSide` (l.301-303) |
| `GET /tasks/in-preparation` | 507-547 | include padrão `truck{left,right,back}` e depois `...query.include`: o cliente que manda `truck:true` **apaga** o include aninhado das medidas (l.531-545) |
| `GET /tasks/in-production` | 549-588 | where `truck.OR[left/right/backSideMeasureId not null]` (l.569-576) + include das 3 medidas | somar a frontal nos dois |
| `PUT /tasks/:id/position`, `POST bulk-position`, `POST :id/swap` | 590-620 | spot | decisão D2 |
| `GET /tasks/:id` | 668-694 | `validateIncludes` | |
| `PUT /tasks/:id` | 726-813 | multipart `truckVinPlate` (l.754), `implementMeasurePhotos.*Side` (l.789-791) | ⚠️ multer rejeita campo de arquivo não declarado (`Unexpected field` → 400). A foto da face frontal exige declarar `implementMeasurePhotos.frontSide` aqui e em `PUT /tasks/batch` |
| `PUT /tasks/:id/copy-from` | 696-724 | `taskCopyFromSchema` (z.enum de tokens) | tokens `implementType`, `category`, `implementMeasures`, `projectFileIds` (task-copy.ts:22-37). Renomear token dá **400 no app instalado**: manter os tokens velhos |

### 2.4 Outras rotas com truck (fora de /tasks)

| Rota | Arquivo:linha | Nota |
|---|---|---|
| `GET /layout-dimensions/...?truckId=` | layout-dimensions.controller.ts:62-70; service 139-170 (`panelsForTruck` monta MOTORISTA/SAPO/TRASEIRA) | acrescentar FRENTE; query `implementId` com alias |
| `GET /dashboard?includeTrucks` | schemas/dashboard.ts:65; dashboard.service.ts:328-359,1286-1300,1425-1430 | `truckMetrics.totalTrucks/trucksInProduction/trucksByManufacturer/trucksByPosition` (types/dashboard.ts:499-503): contrato de resposta lido pelos apps |
| busca global | search.service.ts:213-214,244,267,271,289 | where/select `truck.plateNormalized/chassisNumberNormalized` |

---

## 3. Schemas zod (validação) — cada ponto

### 3.1 `src/schemas/truck.ts`

| Linha | Símbolo | Situação | Ação |
|---|---|---|---|
| 21-86 | `truckIncludeSchema` | objeto enumerado, `.partial()`, **não strict**: chave desconhecida é descartada em silêncio | regenerar do DMMF, estrito; incluir `frontSideMeasure`, `projectFiles`, `layouts` (R2) |
| 92-121 | `truckOrderBySchema` | não tem `*SideMeasureId`, e o tipo `TruckOrderBy` tem (types/truck.ts:77-80): drift tipo×zod | derivar tipo do zod |
| 136-215 | `truckWhereSchema` | `.strict()` no topo, mas `task/leftSideMeasure/rightSideMeasure/backSideMeasure: z.any()` (l.209-212) | where aninhado estrito |
| 221-382 | `truckTransform` | `hasTask:false` → `taskId: null`, impossível porque `taskId` é obrigatório (l.255-257, filtro morto). `inPatio` → `spot: null` (l.298-300), mas `task-truck-spot.ts:16-18` define `spot:null` como "fora das instalações", e o pátio é `YARD_WAIT/YARD_EXIT` | corrigir a semântica ou apagar o filtro |
| 388-483 | `truckGetManySchema` | **não usado por rota nenhuma** | plugar em `GET /implements` |
| 490-529 | `truckCreate/UpdateSchema` | `taskId`, `left/right/backSideMeasureId` aceitos, mas `TruckService.update` só grava 6 campos (truck.service.ts:168-175): o resto some com 200 | schema estrito só com o que é gravável |
| 535-568 | batch/get schemas | sem rota | apagar ou plugar |
| 593-604 | `mapTruckToFormData` | | renomear |
| 611-634 | spot schemas | `truckBulkSpotUpdateSchema` não plugado | plugar |

### 3.2 `src/schemas/task.ts` (3.308 linhas)

| Linha | Símbolo | Situação | Ação |
|---|---|---|---|
| 74-632 (truck em 453-560) | `taskSelectSchema` → `truck.select` | enumerado; o ramo `truck` só aceita `select`, não aceita `include`; os `select` internos **não são strict** (descartam em silêncio) | gerar do DMMF; `implement` + alias `truck` |
| 634-1094 | `taskSelectMinimal/Table/Detail/Form/Preparation/Schedule/History` | **código morto**: ninguém importa fora de schemas/task.ts (grep). São objetos sem tipo `Prisma.TaskSelect`, que o `tsc` não confere | **apagar**, não renomear |
| 1098-1120 | `prismaRelationValue` | `select`/`include` como `z.record(z.string(), …)`: **passthrough** de qualquer chave aninhada; `orderBy/where: z.any()` | trocar por schema gerado do DMMF (§9.4) |
| 1122-1152 | `taskIncludeSchema` | topo enumerado e **não strict** (`implement` antes de ser declarado seria descartado em silêncio); aceita `cutRequest`/`cutPlan` (l.1143-1144), que **não são relações de Task** (500 no Prisma nas rotas sem `validateIncludes`); falta `cuts`, que está na whitelist | enumerar do DMMF; `implement` + alias `truck` |
| 1158-1219 | `taskOrderByFieldsSchema` | sem ordenação por truck | se a lista precisar de ordenar por placa/categoria, `implement: {plate, category}` (relação de-um, o Prisma aceita) |
| 1240-1388 | `taskWhereSchema` | `.strict()` no topo, mas `truck: z.any()` (l.1347), `bonifications` (l.1335, relação real é `bonuses`), `cutRequest/cutPlan: z.any()` (l.1369-1370). **O Flutter usa `where.truck.isNot: null` e seleção aninhada** (garage_screen.dart:200-221) | `implement` estrito com alias `truck` |
| 1431-1433 | busca por `truck.plateNormalized/chassisNumberNormalized` | | `implement` |
| 1488-1494 | `hasTruck` → `truck isNot/is null` | | `hasImplement` + alias |
| 1939-1942 | `truckIds` | | `implementIds` + alias |
| 1954-1958 | `spots` → `truck.spot in` | `spots: z.array(z.string())` (l.2274): **não valida o enum**, e spot inválido dá 500 | `z.nativeEnum(TRUCK_SPOT)` |
| 1960-1968 | `truckCategories` | | `implementCategories` + alias |
| 1970-1974 | `implementTypes` | | mantém o nome (é o tipo do implemento) |
| 2236, 2271-2276 | declarações em `taskGetManySchema` | | idem |
| 2524-2541 | `implementMeasureSectionSchema` / `implementMeasureSideSchema` | cópia **divergente** de `schemas/implement-measure.ts`: aqui `doorHeight: z.number().nullable()` obrigatório, sem máx de 20 m, sem a refine porta⇒altura, sem mín de 1 seção. Não strict | uma fonte só: importar de implement-measure.ts |
| 2544-2550 | `truckCategorySchema`, `implementTypeSchema`, `truckSpotSchema` | duplicados de schemas/truck.ts:128-134 | uma fonte |
| 2553-2580 | `taskTruckSchema` | `spot: z.string()` (l.2564, **sem enum**); `left/right/backSideMeasureId` (l.2574-2576) aceitos e **ignorados** por create/batchCreate/update (só os objetos `*SideMeasure` são processados: task.service.ts:1312-1392, 1993-2087, 2552-3090; repository:1060-1074,1452-1497). Não strict: `frontSideMeasure` mandado por um cliente novo contra API velha **some com 200** | `taskImplementSchema` estrito: `type`, `category`, 4 faces, porta traseira, `projectFileIds`; tradutor de legado antes |
| 2710, 3013 | `truck: taskTruckSchema` em create/update | `taskUpdateSchema` não strict: chave fora do lugar some com 200 (já conhecido) | `implement` + alias; considerar `.strict()` no topo **depois** da tradução de legado |
| 2757-2760 | superRefine exige cliente/série/placa/nome: lê `data.truck?.plate` | | ler do objeto traduzido |
| 3212-3256 | `mapTaskToFormData` | sem truck | — |
| 3262-3289 | `taskPosition*Schema` | spot | D2 |

### 3.3 `src/schemas/implement-measure.ts`

| Linha | O que | Ação |
|---|---|---|
| 9-30 | seção: width ≤ 20 m, refine porta⇒`doorHeight` | fonte única para o task.ts também |
| 47-75 | create/update: `height` ≤ 10 m, 1..10 seções | não strict; acrescentar a porta traseira **se** ela ficar na medida (D5) |

### 3.4 Includes aninhados em OUTROS schemas que citam `truck` (todos precisam da chave `implement` + alias)

| Arquivo:linha | Contexto | Comportamento hoje |
|---|---|---|
| schemas/airbrushing.ts:60-81 | `task.include.truck` com `left/right/backSideMeasure.include.sections` (coluna "Medidas" da aerografia) | enumerado; somar a frontal |
| schemas/customer.ts:39 | `tasks.include.truck` | irmãs **fantasmas** no mesmo objeto: `budget`, `nfe`, `files`, `airbrushing` (l.30-40) não existem em `Task` → 500 |
| schemas/budget.ts:137 | `task(s).include.truck` | fronteira (agente do orçamento) |
| schemas/serviceOrder.ts:37, user.ts:676, layout.ts:65, observation.ts:66, bonus.ts:56, sector.ts:76, paint.ts:589,617 | `task.include.truck: z.boolean()` | booleano; o Flutter manda `include.truck` em bônus/aerografia/observação (bonus_detail_config.dart:28; airbrushing_detail_config.dart:63; observation_form_screen.dart:130) |
| schemas/portal-request.ts:41,444; portal-vehicle-identity.ts:57,175 | `z.nativeEnum(TruckCategory/ImplementType)` de `@prisma/client` | fronteira (portal): renomear o enum Prisma quebra o import. Com `@@map` no enum, o nome TS muda: atualizar |

### 3.5 Whitelists de include/select (include-access-control.ts)

| Linha | O que | Ação |
|---|---|---|
| 53-82 | `INCLUDE_WHITELIST.Task` tem `truck`, `projectFiles`, `layouts` | chave fora da lista = **403** (l.336-341), e o include inteiro cai. Acrescentar `implement` **e manter `truck`** na janela |
| 137-201 | `SELECT_WHITELIST.Task` tem `'truckId'` (l.166) | **`Task` não tem `truckId`**: a whitelist autoriza um campo que o Prisma recusa (500). Tipo que convida relação que não existe |
| 305-318 | entidade sem whitelist = "allow all" | `Truck`/`Implement` não têm whitelist: include aninhado `truck.include.<qualquer coisa>` passa |

Só `GET /tasks` e `GET /tasks/:id` chamam `validateIncludes` (task.controller.ts:128,691). As outras rotas de task (create, update, in-production, in-preparation, bulk/*) ficam só com o zod passthrough.

---

## 4. Os 9 escritores de medida (o ponto mais perigoso do R5)

| # | Caminho | Arquivo:linhas | Lados hoje | Compartilhamento | Observação |
|---|---|---|---|---|---|
| 1 | `POST /tasks` (create) | task.service.ts:1310-1394 | 3, hard-coded (1390-1392) | cria linha nova | `truck.*SideMeasureId` ignorado |
| 2 | `POST /tasks/batch` | task.service.ts:1958-2090 | 3 (1993-2008, 2060-2087) | cria linha por tarefa | |
| 3 | `PUT /tasks/:id` | task.service.ts:2551-3090 | 3 (3016-3031); fotos por `implementMeasurePhotos.{left,right,back}Side` (3041-3079) | copy-on-write (2850-2885); apaga órfã (2569-2605, 2748-2806) | 540 linhas só de medida |
| 4 | `PUT /tasks/batch` | task.service.ts:7939-8000, 8582-8900 | 3 | copy-on-write próprio (8607-8735), desconexão (8737-8780) | 2ª implementação da mesma regra |
| 5 | rollback de changelog | task.service.ts:11937-12090 (`implementMeasures`), 11749-11774 (`truck.*`), 10915-10945 (entidade TRUCK) | 3 (11978-11990) | apaga órfã | `data: { [fieldToRevert]: … }` com o campo **vindo do changelog**: depois de renomear `implementType`→`type`, reverter uma linha histórica dá 500 |
| 6 | `PUT /tasks/:id/copy-from` | task.service.ts:14254-14400 | 3 (14327-14331, 14394-14400) | clona e apaga órfã (14293-14325) | cria `Truck` se faltar (14213, 14239, 14365) |
| 7 | módulo `/implement-measure` | implement-measure.service.ts:343-720, 923-1040; repository:85-146 | `left/right/back` (100-104, 416-425) | `PUT /:id` **edita no lugar sem guarda** (repository:110-146) | a foto só na traseira (451) |
| 8 | portal: identidade do veículo | portal-identity.service.ts:640-700 | `esquerda/direita/traseira` (158-160) | **edita no lugar sem copy-on-write** (663-676); apagar faz `.delete().catch(() => undefined)` (654), engolindo o erro de FK quando a linha é compartilhada | FRONTEIRA (agente do portal), mas é o mesmo defeito de escrita |
| 9 | portal: requisição | portal-request.service.ts:213-215, 924-993 | 3 | cria | FRONTEIRA |

Somam-se os **leitores** que enumeram os 3 lados: `getLaneAvailability` (truck.service.ts:232-255), `getTaskDimensions` (utils/task.ts:374-395, recebe `task: any`), `calculateTruckWidth/Length` (task.service.ts:12475-12510, **mortos**, ninguém chama), `in-production`/`in-preparation` (task.controller.ts:531-545, 569-585), `layout-dimensions.panelsForTruck` (service.ts:139-170), repository de medidas `findByTruckId` (repository.ts:28-83), `getTrucksUsingImplementMeasure` (service.ts:246-276), contagem de uso (service.ts:220-244), portal-projection (projection.service.ts:197-199, 854-856), portal-read (read.service.ts:224-226), rótulos do field tracker, das notificações e do changelog (§6), e a aerografia (schemas/airbrushing.ts:63-78).

⚠️ **A branch `feat/orcamento-veiculos` (outra sessão) acrescenta um 10º participante.** `src/utils/implement-measure-replication.ts` (288 linhas, commit `cb11ffb3`, "Medir um veículo mede os demais do mesmo orçamento") com `MEASURE_SIDES = ['left','right','back']` e `SIDE_FK/SIDE_REL` hard-coded. O commit pluga a réplica em edição de tarefa, lote, cópia e no módulo de medidas. Se essa branch entrar, a face frontal também passa por lá. O dono decidiu ali: "mesmo orçamento ⇒ mesmo tamanho… os N caminhões são o mesmo implemento". Isso pesa na D1.

**Recomendação (INFERÊNCIA de engenharia):** um `ImplementMeasureWriter` único, com três operações: `setFace(tx, implementId, face, dados | null, { actor, reason })`, `cloneFaces(tx, fromImplementId, toImplementId)` e `faceOf(fk)`. Nele ficam `FACES = ['left','right','back','front'] as const`, `FACE_FK: Record<Face, keyof Prisma.ImplementUncheckedUpdateInput>` (tipado: o `tsc` pega renome) e **uma** política de compartilhamento. Os 9 caminhos passam a chamar o writer. Essa troca é **refatoração sem mudança de comportamento** e vai **antes** do rename, testada com os 3 lados. Depois, a face frontal é uma linha no array.

---

## 5. Types (`src/types`) — o que "convida" relação inexistente

| Arquivo:linha | O que | Ação |
|---|---|---|
| types/truck.ts:21-38 | `interface Truck` escrita à mão (não derivada do Prisma) | derivar de `Prisma.ImplementGetPayload` ou do zod |
| types/truck.ts:44-66 | `TruckIncludes` | idem |
| types/truck.ts:72-86 | `TruckOrderBy` com `*SideMeasureId` que o zod não aceita | idem |
| types/implement-measure.ts:5-6 | importa `./implementMeasureSection` (existe), mas **nenhum dos dois é reexportado** em types/index.ts (só `./truck`, l.51) | |
| types/implement-measure.ts:24-41 | `trucksLeftSide/RightSide/BackSide` | `implementsLeft/Right/Back/FrontSide` |
| types/task.ts:25,78,272,338,474,544,632,784-787 | `truck?: Truck`, `TruckIncludes`, formas parciais `{ id, plate, spot }` | `implement` |
| types/garage.ts:7,26,33 | reexporta `TRUCK_SPOT` | ok |
| types/dashboard.ts:499-503 | `truckMetrics` | contrato de resposta: renomear com espelho ou manter |
| types/summary.ts:345 | `currentTrucks` | idem |
| types/paint.ts:16,53,423-428,757 | `TRUCK_MANUFACTURER` | **fora do rename** (montadora da tinta) |

---

## 6. Enums, rótulos e textos (pt-BR)

| Arquivo:linha | Conteúdo | Problema / ação |
|---|---|---|
| constants/enums.ts:1223-1310 | `TRUCK_SPOT`, `TRUCK_MANUFACTURER`, `TRUCK_CATEGORY`, `IMPLEMENT_TYPE` (espelho TS dos enums Prisma) | `IMPLEMENT_CATEGORY` (alias `TRUCK_CATEGORY` na janela). O espelho escrito à mão pode divergir do Prisma sem ninguém notar: derivar de `$Enums` |
| constants/enums.ts:1358,1400 / 2020,2069 | `ENTITY_TYPE.IMPLEMENT_MEASURE/TRUCK`, `CHANGE_LOG_ENTITY_TYPE.*` | §7 |
| constants/enum-labels.ts:393-404 | `TRUCK_CATEGORY_LABELS` (UI) | |
| constants/enum-labels.ts:406-413 | `IMPLEMENT_TYPE_LABELS` (UI): INSULATED='Isoplastic', FLATBED='Carroceria' | |
| constants/enum-labels.ts:415-448 | `TRUCK_SPOT_LABELS` | |
| constants/enum-labels.ts:1112,1154,1541,1584 | 'Medidas do Implemento', 'Caminhão' | 'Caminhão' → 'Implemento' |
| **rótulos fiscais duplicados** | elotech-oxy-nfse.service.ts:1295-1315 (`INSULATED:'Isotérmico'`, `FLATBED:'Prancha/Plataforma'`, `DRY_CARGO:'Carga seca'`); invoice-generation.service.ts:1399-1425 e sicredi-boleto.scheduler.ts:1002-1028 (`'Isoplastic'`, `'Carroceria'`, `'Carga Seca'`); dps.builder.ts:22,514-520 (NFS-e do pintor usa os rótulos da **UI**: sai 'Isoplastic' na nota) | **4 dicionários, 2 versões.** Uma constante `IMPLEMENT_TYPE_FISCAL_LABELS` / `IMPLEMENT_CATEGORY_FISCAL_LABELS` em constants, usada pelos 4. Atualizar tests/nfse-discriminacao.test.ts e painter-nfse.test.ts |
| constants/sortOrders.ts:665-672, 945, 993, 1008 | ordem de montadora; ordem de entidade no changelog | TRUCK fica |
| constants/routes.ts:510-516 | rotas web `/producao/caminhoes/*` | fronteira web |
| modules/common/pipes/zod-validation.pipe.ts:243 | rótulo de erro `truck: 'Caminhão'` | `implement: 'Implemento'`, mantendo `truck` |
| modules/production/task/task.permissions.ts:51-52, 148-328, 354 | domínio de permissão `truck: ['truck']`; rótulo 'caminhão' | ⚠️ Campo aceito pelo zod e ausente do mapa = **400 para todo setor não-ADMIN** (l.438-457; o incidente do `customerOrderNumber` está documentado em l.32-44). **`implement` precisa entrar em `TASK_FIELD_DOMAINS` no mesmo commit em que entra no zod**, e `truck` continua lá na janela. A DESIGNER não tem o domínio `truck`: se o projeto do implemento (R6) ficar dentro de `implement`, o designer não consegue anexar. Decidir o domínio de `implement.projectFiles` |

---

## 7. Identificadores PERSISTIDOS (não renomear sem migração de dados)

| Identificador | Onde grava / lê | Risco se renomear | Recomendação |
|---|---|---|---|
| chave de notificação `task.field.truck.{plate,chassisNumber,vinPlateId,category,implementType,spot,left/right/backSideMeasureId,implementMeasure}` e `truck.movement_request` | `NotificationConfiguration.key/eventType` (schema.prisma:3090-3116) e `UserNotificationPreference.eventType` (3045-3058); seed prisma/scripts/seed-notification-configs.ts:7157-7545, 8479-8519; emissores truck.service.ts:565, task.listener.ts:257-285, implement-measure.service.ts:879-884,1075 | a preferência do usuário (silenciar, canal) se perde, e a config some → notificação não dispara (em silêncio) | **manter as chaves** (são identificadores); trocar só título e corpo ("Implemento"). Se a face frontal/porta ganhar notificação, usar chave nova no mesmo prefixo |
| `ChangeLogEntityType.TRUCK` | `ChangeLog.entityType`; rollback aceita 'TRUCK' (task.service.ts:10823-10830, 10919) | histórico sem rótulo; rollback recusa | **manter `TRUCK` como valor persistido** e rotular "Implemento" na UI; opcional: `ADD VALUE 'IMPLEMENT'` e aceitar os dois no rollback |
| `TaskFieldChangeLog.field = 'truck.*'` e `ChangeLog.field` com `implementType` | field tracker (task-field-tracker.service.ts:80-101); rótulos em changelog-helpers.ts:376-391,795 e changelog-fields.ts:238-263,630,748-765,1069-1089; notification-dispatch.service.ts:2633-2635 | rótulo cru na trilha; rollback de `truck.*` (task.service.ts:11750-11763) grava `[truckField]` → 500 depois de `implementType`→`type` | mapa `LEGACY_FIELD_ALIASES = { 'truck.implementType': 'implement.type', 'implementType': 'type', 'truck.*': 'implement.*' }` usado pelo rollback e pelos rótulos; mapas de rótulo com as **duas** grafias |
| contexto de arquivo `truckVinPlate`, `implementMeasurePhotos` | files-storage.service.ts:74-75,205-206,300-301,769-770; file-organization-scheduler.service.ts:58,66,137,409-415; o Flutter manda `fileContext: 'truckVinPlate', entityType: 'truck'` (task_form_screen.dart:933-934) | upload do app instalado cai em contexto desconhecido → pasta genérica | **manter** os contextos como identificadores internos; acrescentar `implementProjectFiles` (R6) |
| `file-reference.service.ts` `INBOUND_REFERENCES['Truck.vinPlateId']` (l.107), `'ImplementMeasure.photoId'` (l.102-105), `'_TASK_PROJECT_FILES.A'` (l.86) | chave = nome **físico** de tabela.coluna do catálogo | com `@@map("Truck")` nada muda. Renomear a tabela física faz a chave não casar: fail-closed (arquivo protegido, só não é arquivado; a service avisa no boot, l.249-255) | com `@@map`, só **acrescentar** a relação nova do projeto do implemento (`_IMPLEMENT_PROJECT_FILES.A`) |
| `OUTBOUND_REFERENCES.quoteLayoutId` | file-reference.service.ts:45-52 | FRONTEIRA R1: quando `File.quoteLayoutId` cair, esta entrada tem de sair **no mesmo deploy**. Senão a checagem falha fechada em todo arquivo e a faxina para | avisar o agente do orçamento |
| JSON do snapshot de assinatura: `truck`, `vehicles[].implementType`, chaves de diff `truckPlate/truckChassis/truckCategory/truckImplement` | quote-snapshot.service.ts:182,342,436,495-498,598-623,832-840; quote-diff.ts:658-750 | as chaves entram no `materialHash`: mudar o nome **emitido** muda o hash de todo orçamento assinado → "termos mudaram" em massa | FRONTEIRA (agente da assinatura): ler de `implement.type` e **emitir** `implementType` para sempre |
| `AttentionAck.entityType` (string) e `ATTENTION_ENTITY_TYPES` inclui `'TRUCK'` | schemas/attention.ts:31; schema.prisma:2994-3008 | nenhuma regra emite TRUCK hoje (grep): as regras R3a-c são de TASK (attention.service.ts:284-289,436-448) | manter; as regras passam a ler `implement` |

---

## 8. Resto da API que lê truck (atualização mecânica, mas precisa estar na lista)

| Área | Arquivo:linhas | Leitura |
|---|---|---|
| Atenção | attention.service.ts:284-289, 436-448 | `NO_CHASSIS`, `NO_PLATE`, `NO_VIN_PLATE_PHOTO` com `truck: null` / `truck.{chassisNumber,plate,vinPlateId}`. Candidata a regra nova: "sem medidas da frente", "porta traseira sem configuração" (decisão) |
| NFS-e (tarefa) | nfse-emission.scheduler.ts:365-370, 426-431, 503-531, 614-638, 673, 788-793, 846-851, 908-1046; elotech-oxy-nfse.service.ts:39-62, 1295-1315, 1436-1439, 1583 | select `truck{plate,chassisNumber,category,implementType}` → objeto `truck` de entrada da emissão |
| NFS-e (pintor) | painter/dps.builder.ts:455-532; painter-nfse.service.ts:480-485 | idem, rótulo UI (§6) |
| Boleto Sicredi | sicredi-boleto.scheduler.ts:321, 366, 799-935, 1002-1028 | `seuNumero` usa `truck.plate` (811-823) |
| Fatura | invoice-generation.service.ts:953, 1002, 1197-1328, 1399-1425 | idem |
| Faturamento | billing.service.ts:141, 158, 243, 355, 704-705 | select e busca por placa/chassi |
| Conciliação | receivable-task-match.service.ts:193-194, 342, 442 | busca por placa |
| Pedido de compra | purchase-order.service.ts:127, 160-164, 236 (`plate contains` sem normalizar), 590-605 | |
| Bônus | bonus.service.ts:827, 1096, 1424, 2906, 3573-3586, 3719 | repassa `task.truck` na resposta (contrato do app) |
| Dashboard | dashboard-prisma.repository.ts:1759, 1827, 1936-1949, 2279-2412, 3415-3683 | `prisma.truck.findMany/count` |
| Estatística | task-analytics.service.ts:384-430 | `prisma.truck.findMany` por vaga |
| Busca global | search.service.ts:213-289 | |
| Pessoal | personal.service.ts:871 | select truck |
| Tinta (produção) | paint-production.service.ts:882, 898 | |
| Tinta (busca) | **paint.service.ts:503-517 raw SQL `"Truck"`** | ver §0 |
| Recibo de orçamento | budget-receipt.service.ts:49, 89-100 | FRONTEIRA |
| Sugestão de orçamento | budget.service.ts:5439, 5661 ("mesmo nome, cliente, categoria e tipo") | FRONTEIRA |
| Utilitários | utils/task.ts:194 (`(task as any).truck?.plate`), 367-455 (`getTaskDimensions/formatTaskMeasures/generateBaseFileName`, todos `task: any`: o arquivo base perde as medidas no nome **em silêncio**); utils/quote-tasks.ts:387-404, 643; utils/task-truck-spot.ts (`syncTruckSpotWithCleared`, chamado em task.service.ts:14570, 14922 e repository:2591) | |
| Prisma omit | prisma.service.ts:313-316 | `truck: { chassisNumberNormalized, plateNormalized }` → a chave do omit segue o nome do **model** (`implement:`); com `@@map` o nome muda aqui |
| Garagem | utils/garage-layout.ts (sem importador na API: código morto aqui), constants/garage.ts, types/garage.ts | vocabulário "truck" do pátio; manter neste rework |
| Scripts | src/scripts/purge-test-task-d013bc8b.ts, nfse-diagnose.ts, audit-painter-nfse-setup.ts; scripts/{test-signature-*, test-late-slots, audit-file-placement, dry-run-file-organization, check-layout-dimensions, verify-signature-sections}.ts; prisma/scripts/seed-{notification-configs,dashboard-defaults-…}.ts | `scripts/` e `tests/` **não estão no `include` do tsconfig** (tsconfig.json:57 inclui `src` e `test`, não `tests`/`scripts`): quebram só quando alguém roda |

---

## 9. Contrato novo proposto

### 9.1 Banco / Prisma (sem DDL de rename)

```prisma
model Implement {
  id                 String             @id @default(uuid())
  plate              String?            @unique
  chassisNumber      String?
  category           ImplementCategory?             // enum TruckCategory com @@map("TruckCategory")
  type               ImplementType?     @map("implementType")
  spot               TRUCK_SPOT?        @default(YARD_WAIT)   // D2
  taskId             String             @unique      // D1: 1:1 neste rework
  vinPlateId         String?
  backSideMeasureId  String?
  leftSideMeasureId  String?
  rightSideMeasureId String?
  frontSideMeasureId String?                         // NOVO (R5)
  rearDoorLeaves     RearDoorLeaves?                  // NOVO: BIPARTIDA | TRIPARTIDA (D5)
  rearDoorBarCount   Int?                             // NOVO: CHECK IN (2,3,4)
  rearDoorHatchCount Int?                             // NOVO: portinholas, CHECK >= 0
  // relações: vinPlate, back/left/right/frontSideMeasure ("IMPLEMENT_*_SIDE"), task,
  // projectFiles File[] @relation("IMPLEMENT_PROJECT_FILES")   // NOVO (R6)
  // layouts …  (R2, ver agente do layout)
  @@map("Truck")
}
enum ImplementCategory { … @@map("TruckCategory") }
```

- Nomes de relação Prisma (`"TRUCK_BACK_SIDE"` etc.) **não existem no banco**: dá para renomear livremente para `IMPLEMENT_*`. As relações inversas `trucksLeftSide…` viram `implementsLeftSide…` e ganham `implementsFrontSide` (9 literais de string para trocar; §0).
- `@@map`/`@map` fazem o rename **sem tocar em tabela, constraint, índice nem coluna gerada**. O raw SQL `"Truck"` continua funcionando. A reprojeção física (`ALTER TABLE "Truck" RENAME TO "Implement"`) vira passo opcional e posterior, e aí sim exige mexer em paint.service.ts:507/510 e em `INBOUND_REFERENCES`.
- DDL real (**só aditivo**): `frontSideMeasureId` + FK + índice; 3 colunas da porta traseira + CHECKs; tabela `_IMPLEMENT_PROJECT_FILES`; enum `RearDoorLeaves`. Aditivo pode ir **antes** do código: o código velho ignora coluna nova. Isso inverte a regra "builde antes de migrar", que vale para migração destrutiva. Não há `DROP` neste recorte. O `DROP` de `Budget.layoutFiles` é do R1 e vai **depois** do código novo estar no ar.

### 9.2 Rotas

| Hoje | Novo | Janela |
|---|---|---|
| `GET/PUT /trucks`, `/trucks/:id` | `GET/PUT /implements`, `/implements/:id` | `/trucks/*` delega ao mesmo handler + header `Deprecation: true` + contador por rota |
| `/trucks/garages-availability`, `lane-availability/:g`, `sector-garage-mapping`, `batch-update-spots`, `request-movement` | `/garages/…` (domínio pátio) com `implementId` | alias; o Flutter usa `batch-update-spots` |
| `/implement-measure/truck/:truckId[/batch\|/:side]`, `POST /:id/assign-to-truck` | `/implement-measure/implement/:implementId…`, `/:id/assign-to-implement`; `side ∈ {left,right,back,front}` | alias |
| `GET /layout-dimensions?truckId=` | `?implementId=` | aceita os dois |

### 9.3 Chaves de payload, include e where

| Contexto | Legado (aceito na janela) | Novo |
|---|---|---|
| corpo de task create/update/batch | `truck: { plate, chassisNumber, vinPlateId, category, implementType, spot, left/right/backSideMeasure, *SideMeasureId }` | `implement: { plate, chassisNumber, vinPlateId, category, type, spot, left/right/back/frontSideMeasure, rearDoor{Leaves,BarCount,HatchCount}, projectFileIds }`. Os `*SideMeasureId` **saem**: nunca foram gravados (§3.2) |
| multipart | `truckVinPlate`, `implementMeasurePhotos.{left,right,back}Side` | + `implementVinPlate`, `implementMeasurePhotos.frontSide` (declarar no `FileFieldsInterceptor`) |
| include/select | `truck` | `implement` |
| where | `truck` | `implement` |
| filtros | `hasTruck`, `truckIds`, `truckCategories` | `hasImplement`, `implementIds`, `implementCategories` (`implementTypes` e `spots` ficam) |
| copy-from | tokens `implementType`, `category`, `implementMeasures` | os mesmos tokens (são nomes de operação); acrescentar `rearDoor`, `implementProjectFiles` |
| resposta | `task.truck` | `task.implement` **e**, na janela, `task.truck` espelhado (com `implementType = type`) |

**Mecânica da janela (recomendação):**
1. Uma função `translateLegacyImplementKeys(input, where: 'body'|'include'|'select'|'where'|'filters')`, **única**, aplicada **antes** do zod: num `ZodEffects.preprocess` dos schemas de task/budget/customer/airbrushing/bonus/… ou num pipe. Recebeu `truck` sem `implement` → move para `implement` e traduz `implementType`→`type`. Recebeu os dois → **400** ("envie só `implement`"), nunca mescla em silêncio.
2. Um interceptor `ImplementLegacyMirrorInterceptor` com profundidade limitada: em objeto que tem `implement` e não tem `truck`, põe `truck = { ...implement, implementType: implement.type }`. Liga por flag de ambiente. Mede o uso pelo contador de (1).
3. **Pré-requisito:** hoje a API **não sabe a versão do cliente** (grep de `x-app-version`/`appVersion` fora do PPE: nada). Pôr `X-Client: flutter@<versão>` / `web@<build>` **antes** do rework, para saber quando desligar a janela. O Shorebird OTA (memória 02/07) permite empurrar o app para as chaves novas rápido; o corte seco sem isso reproduz o "mobile muito atrás" do R8.
4. Desligar (fase de contrato) só depois de N dias com contador zero **por rota**.

### 9.4 Como garantir que não há passthrough (R8)

1. **Gerar** os schemas de include/select/where a partir de `Prisma.dmmf.datamodel`: `buildRelationSchema('Implement', depth)`. Relação conhecida → objeto enumerado `.strict()`. Chave desconhecida → **400 com a chave no texto**, nunca 500 e nunca descarte. Isso substitui `prismaRelationValue` (task.ts:1098-1120), `z.any()` em where (task.ts:1347; truck.ts:209-212) e os `query: any` (truck.controller.ts:38,213,245; implement-measure.controller.ts:77).
2. **Teste de contrato** (sem banco): para cada schema de include/select/where/orderBy exportado, percorrer as chaves e exigir `chave ∈ DMMF(model)`. O teste pega hoje, de saída: `cutRequest`, `cutPlan`, `bonifications`, `customer.tasks.include.{budget,nfe,files,airbrushing}`, `SELECT_WHITELIST.Task.truckId`.
3. **Teste de cobertura de permissão:** toda chave de topo aceita por `taskCreate/UpdateSchema` pertence a algum `TASK_FIELD_DOMAINS` (pega o incidente do `customerOrderNumber` e o futuro `implement`).
4. **Constantes de include/select tipadas** `satisfies Prisma.TaskInclude/TaskSelect`: as do repository já são (task-prisma.repository.ts:54-555); as de schemas/task.ts:634-1094 não, e estão mortas → apagar.
5. **Portão de tipo real:** `"typecheck": "tsc -p tsconfig.json --noEmit"` como passo de deploy, e `noEmitOnError: true` no build. Incluir `tests/` e `scripts/` num tsconfig de checagem. Sem isso, o `tsc` do rename é conselho, não portão (§0 item 3).
6. **Proibir `any` nos acessos a implemento:** trocar `(data as any).truck` (10 lugares) e os `Record<string, any>` do portal por tipos derivados do zod. Os mapas de lado viram `Record<Face, keyof Prisma.ImplementUncheckedUpdateInput>`.

### 9.5 Testes

**Quebram com o rename (FATO, pelo que usam):**

| Teste | Linhas | Por quê |
|---|---|---|
| tests/task-match-integration.test.ts | 94, 141 | `prisma.truck.deleteMany/create` |
| tests/painter-nfse.test.ts | 873, 890, 900, 961 | fixture `truck{category,implementType}`; texto 'Bitruck Refrigerado' (muda se unificar o rótulo fiscal) |
| tests/nfse-discriminacao.test.ts | 39, 103, 108 | `vehicles[].implementType` |
| tests/nfse-line-scale.test.ts | 83 | `category` |
| tests/boleto-informativo-cobertura.test.ts | 51 | fixture `truck` |
| tests/quote-list-query.test.ts | 185-186, 248-253 | include `truck` em budget (FRONTEIRA) |
| tests/quote-diff.test.ts | 60, 303-383 | snapshot `truck`, chaves `truckPlate/Chassis` (FRONTEIRA: **não devem** mudar, §7) |
| tests/portal-identificacao/recorte/requisicao.test.ts | várias | FRONTEIRA |
| tests/e2e-portal/cenarios/01-requisicao-com-medidas.ts | 117-140 | select `truck.*SideMeasure` |
| tests/e2e-ui/fase1..6, check-faturamento-separado | 1 a 9 cada | rótulo de categoria na tela ('Truck') |

**Faltam (nenhum teste cobre hoje truck.controller, implement-measure, posicionamento na garagem nem os escritores de medida da task.service):**
1. contrato zod×DMMF (§9.4-2);
2. cobertura de permissão (§9.4-3);
3. tabela escritor×face: os 9 caminhos da §4 × 4 faces × {criar, atualizar, apagar, foto}, com asserção no banco (valor em metros, `position`);
4. compartilhamento: editar a medida de A não altera B (hoje falha em `PUT /implement-measure/:id` e no portal-identity);
5. legado: corpo `truck{…implementType}` grava em `implement.type`; include `truck` devolve `truck` e `implement`; corpo com os dois → 400;
6. rollback de linha histórica `TRUCK/implementType` e `truck.implementType` depois do rename;
7. notificações: `task.field.truck.*` continua disparando depois do rename (chave estável);
8. raw SQL: busca de tinta por placa acha a tinta (hoje engole o erro);
9. porta traseira: `barCount ∈ {2,3,4}`, `leaves ∈ {BIPARTIDA,TRIPARTIDA}`, `hatchCount ≥ 0`, nulos permitidos;
10. rótulo fiscal único (NFS-e tarefa, NFS-e pintor, boleto, fatura dizem a mesma palavra para INSULATED).

---

## 10. Decisões que só o dono toma (com recomendação)

| # | Pergunta | Recomendação | Por quê |
|---|---|---|---|
| D1 | Implemento continua 1:1 com a tarefa (rename) ou vira entidade reaproveitável (N tarefas, como no monorepo)? | **1:1 agora**; `implementId` estável na API para permitir N:1 depois | N:1 muda todas as consultas `task.truck` para uma FK nova, e o `plate @unique` + `taskId @unique` de hoje já proíbem o veículo que volta. É outro rework |
| D2 | A vaga (`spot`) é do implemento ou da tarefa? | **mantê-la fisicamente no implemento neste rework**, fora do contrato do portal (o portal já a exclui: portal-read.service.ts:199) e marcada como dívida; mover para `Task` numa rodada própria | a vaga é da visita (monorepo concorda), mas mover mexe em ~30 pontos de garagem e dispara as notificações `task.field.truck.spot` |
| D3 | `serialNumber` é da tarefa (OS) ou do implemento (nº de série do furgão)? | **perguntar**: a NFS-e do pintor diz "é da OS" (dps.builder.ts:522-524); o monorepo o pôs no implemento (46-production.prisma:330) | define o que o responsável pode editar pelo portal |
| D4 | Face frontal como **4ª FK** (como os 3 lados) ou tabela de faces (`ImplementFace` com `face` enum, como o monorepo)? | **4ª FK** + writer único (§4) | tabela de faces muda o formato do fio para web, Flutter e portal ao mesmo tempo; o writer único já elimina a repetição |
| D5 | Opções da porta traseira ficam no **implemento** ou na **medida traseira**? | **no implemento** (`rearDoorLeaves`, `rearDoorBarCount`, `rearDoorHatchCount`) | a medida não sabe a própria face (§1) e é geometria; porta é especificação do furgão. Pergunta derivada: bipartida/tripartida deve **gerar** as seções da traseira ou só ser registrada? |
| D6 | Medida compartilhada entre caminhões continua permitida? | **proibir daqui para frente** (uma linha por face por implemento) e migrar as compartilhadas por cópia | o compartilhamento exige 4 implementações de copy-on-write e já falha em 2 caminhos (§4 #7, #8); a outra sessão também escolheu cópia |
| D7 | Renomear as chaves de notificação `task.field.truck.*`? | **não**; trocar só título e corpo | preferências dos usuários ficam intactas |
| D8 | `ChangeLogEntityType.TRUCK` vira `IMPLEMENT`? | **não neste rework**; rótulo "Implemento" na UI | histórico e rollback continuam valendo |
| D9 | Janela de compatibilidade ou corte seco? | **janela** (§9.3), com versão do cliente no header e Shorebird | sem o header não dá para saber quando cortar |
| D10 | O que fazer com a branch `feat/orcamento-veiculos` (layout POR VEÍCULO no orçamento + réplica de medidas)? | decidir **antes** de começar: o R1 tira o layout do orçamento, mas a réplica de medida ("mesmo orçamento ⇒ mesmo tamanho") é independente e toca os mesmos escritores | ela muda task.service.ts em 172 linhas e implement-measure.service.ts em 95 (diff `--stat`); rebasear o rework em cima dela ou descartá-la |
| D11 | Rótulo fiscal de INSULATED/FLATBED: 'Isotérmico'/'Prancha/Plataforma' (elotech) ou 'Isoplastic'/'Carroceria' (boleto, fatura e NFS-e do pintor)? | uma palavra só, decidida pelo dono | hoje a NFS-e da tarefa e a do pintor dizem coisas diferentes do mesmo furgão |
| D12 | Os ~4 `Task.projectFiles` atuais (ADR 0121) vão para o projeto do **implemento** ou da **tarefa**? | revisar à mão (são 4) | |
| D13 | Categoria continua um enum só (10 valores) ou separa montagem de porte, como no monorepo? | **um só** (o dono disse "tipo e categoria") | |
| D14 | Nome da rota: `/implements` (inglês, como `/tasks`) ou pt? | `/implements` | consistência com o resto da API |

---

## 11. Ordem de execução sugerida (para a atualização limpa)

1. **Fase 0, sem mudar comportamento:** header de versão no web e no Flutter; `typecheck` + `noEmitOnError: true`; teste de contrato zod×DMMF (vai falhar nos fantasmas da §9.4-2: corrigir); writer único de medida (§4) com os 3 lados, coberto pelo teste da §9.5-3; dicionário fiscal único (D11).
2. **Fase 1, DDL aditivo** (pode ir antes do código): `frontSideMeasureId`, porta traseira, `_IMPLEMENT_PROJECT_FILES`.
3. **Fase 2, API:** `model Implement @@map("Truck")`; schemas gerados; `/implements`; tradutor de legado + espelho; face frontal no writer; `TASK_FIELD_DOMAINS.implement`; `INBOUND_REFERENCES` do projeto; multipart `frontSide`; rótulos.
4. **Fase 3, clientes:** web e Flutter nas chaves novas (Shorebird).
5. **Fase 4, contrato:** contador zero → desligar alias e espelho; opcional: rename físico da tabela (e aí paint.service.ts:507/510 + `INBOUND_REFERENCES`).

---

## 12. Consultas para quem tiver acesso de leitura ao banco

```sql
-- compartilhamento real de medidas (decide D6)
SELECT m.id, count(*) AS usos FROM "ImplementMeasure" m
JOIN "Truck" t ON m.id IN (t."leftSideMeasureId", t."rightSideMeasureId", t."backSideMeasureId")
GROUP BY m.id HAVING count(*) > 1 ORDER BY 2 DESC;
-- medidas órfãs (nenhum caminhão aponta)
SELECT count(*) FROM "ImplementMeasure" m WHERE NOT EXISTS (SELECT 1 FROM "Truck" t
 WHERE m.id IN (t."leftSideMeasureId", t."rightSideMeasureId", t."backSideMeasureId"));
-- distribuição de categoria e tipo, e caminhão sem nada
SELECT category, "implementType", count(*) FROM "Truck" GROUP BY 1, 2 ORDER BY 3 DESC;
-- vaga por situação (decide D2)
SELECT spot IS NULL AS sem_vaga, spot IN ('YARD_WAIT','YARD_EXIT') AS patio, count(*) FROM "Truck" GROUP BY 1, 2;
-- preferências de usuário presas às chaves truck (decide D7)
SELECT "eventType", count(*) FROM "UserNotificationPreference" WHERE "eventType" LIKE '%truck%' GROUP BY 1;
-- histórico de changelog de caminhão (decide D8)
SELECT field, count(*) FROM "ChangeLog" WHERE "entityType" = 'TRUCK' GROUP BY 1 ORDER BY 2 DESC;
-- projectFiles da tarefa (decide D12)
SELECT "B" AS task_id, count(*) FROM "_TASK_PROJECT_FILES" GROUP BY 1;
-- análises de pintura com vínculo de medida perdido
SELECT count(*) FILTER (WHERE "implementMeasureId" IS NULL) AS sem, count(*) AS total FROM "PaintingAnalysis";
```

---

## Perguntas ao dono

1. (D1) Um furgão que volta para outro serviço é o **mesmo implemento** (histórico junto) ou um cadastro novo por tarefa? Hoje a placa não pode se repetir entre tarefas.
2. (D3) O "número de série" é da ordem de serviço da Ankaa ou do furgão da Furgões Ibiporã?
3. (D5) Bipartida/tripartida deve **montar sozinha** as seções da medida traseira (2 ou 3 folhas), ou é só um registro? Portinhola tem medida (largura/altura) ou só quantidade?
4. (D2) A vaga no pátio pode continuar no implemento por enquanto, ou já deve ir para a tarefa neste rework?
5. (D11) Na nota fiscal, o isotérmico é "Isotérmico" ou "Isoplastic"? A plataforma é "Prancha/Plataforma" ou "Carroceria"?
6. (D10) A branch `feat/orcamento-veiculos` (layout por veículo + réplica de medida no orçamento) entra antes do rework, é absorvida por ele ou é descartada?
7. (D6) Posso proibir a medida compartilhada entre caminhões (cada implemento com as suas faces, cópia na réplica)?
8. A face **frontal** leva foto como a traseira? Quem mede a frente: Logística, responsável pelo portal, ou os dois?
9. O **projeto do implemento** (PDF da Furgões) quem anexa: comercial, designer, responsável pelo portal? Isso define o domínio de permissão (hoje a DESIGNER não tem o domínio `truck`).
10. Aceita a janela de compatibilidade (`truck` e `implement` aceitos e devolvidos) por pelo menos um ciclo de versão do app, com o header de versão entrando antes?

## Riscos

1. **Caminho de escrita de medida esquecido** (9 hoje, 10 com a outra branch): a face frontal grava num caminho e some noutro. Mitigação: writer único + teste escritor×face.
2. **Build que emite com erro de tipo** (`noEmitOnError: false`, sem CI): o rename "passa" com erros de `tsc` e quebra em runtime. Mitigação: `typecheck` como passo de deploy.
3. **Passthrough e chaves fantasma** (`prismaRelationValue`, `z.any()`, `query: any`, `cutRequest/cutPlan/bonifications`, `customer.tasks.include.budget/nfe/files/airbrushing`, whitelist `truckId`): um nome velho enviado por app antigo vira 500. Mitigação: schemas gerados do DMMF + teste de contrato.
4. **Descarte silencioso** (objetos zod não strict; `implementMeasureSideSchema` e `taskTruckSchema` não strict): o app novo contra API velha, ou vice-versa, perde `frontSideMeasure`/`implement` com 200. Mitigação: strict depois da tradução de legado; deploy da API **antes** dos clientes.
5. **Hash de snapshot de assinatura:** renomear as chaves emitidas (`truck`, `implementType`) muda o `materialHash` e faz todo orçamento assinado parecer alterado. Mitigação: chaves do snapshot congeladas (FRONTEIRA).
6. **Preferências de notificação e histórico:** renomear `task.field.truck.*` ou `ChangeLogEntityType.TRUCK` apaga preferências e quebra rollback. Mitigação: D7/D8, com alias de campo no rollback.
7. **Raw SQL que engole erro** (paint.service.ts:503-527): rename físico = busca vazia sem alarme. Mitigação: `@@map` + teste.
8. **Multer rejeita campo de arquivo novo** (`implementMeasurePhotos.frontSide`) se o controller não declarar. Mitigação: declarar nas 2 listas (task.controller.ts:301-303, 789-791).
9. **Permissão por domínio:** a chave `implement` aceita pelo zod e ausente de `TASK_FIELD_DOMAINS` = 400 para todo setor não-ADMIN. Mitigação: teste de cobertura de permissão.
10. **Edição no lugar de medida compartilhada** (`PUT /implement-measure/:id`, portal-identity): um responsável corrige o próprio furgão e altera o de outro. Já acontece hoje. Mitigação: D6.
11. **Conflito com a sessão viva** em `feat/orcamento-veiculos`: task.service.ts, implement-measure.service.ts, task-prisma.repository.ts e sync-quote-task-layouts.ts mudam nas duas linhas. Mitigação: D10 antes de começar.
12. **`PaintingAnalysis.implementMeasureId` com `SetNull`:** remedir apaga a medida velha e desliga a análise em silêncio. Mitigação: apontar a análise para o implemento, ou não apagar a linha no writer.
