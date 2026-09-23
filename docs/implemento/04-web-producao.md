# 04 — WEB (produção/tarefa/implemento): o que muda com R1..R8

Recorte: `/home/kennedy/Documents/repositories/web`, branch `feat/portal-do-responsavel` (HEAD `989c9f6e`), tudo que toca
truck/implemento/medidas/layout/projeto FORA de orçamento/faturamento/assinatura/portal-do-cliente.
Somente leitura. Nenhum arquivo dos repositórios foi alterado. Nenhum SELECT foi feito (não fui instruído a isso):
as contagens de dados citadas vêm da ADR 0121 do monorepo ou ficam marcadas como INFERÊNCIA.

Legenda: **FATO** = li no código (arquivo:linha). **INFERÊNCIA** = dedução minha, a confirmar.

---

## 0. Resumo em 12 linhas

1. No web a palavra "layout" nomeia **quatro coisas diferentes**: (a) as MEDIDAS do implemento (`ImplementMeasure`: `layoutsData`, `deleteLayout`, `canViewLayout`, acordeão `"layout"`); (b) a ARTE/PDF da tarefa (`Task.layouts`, entidade `Layout`, rótulo "Layout Referência"); (c) o layout aprovado do orçamento (`Budget.layoutFiles`); (d) o cotador de PDF (`lib/layout-dimensions`). O rework tem de desfazer essa ambiguidade primeiro, ou cada troca de nome vai pegar a coisa errada.
2. `Task.layouts` hoje mistura a ARTE (imagem) e o PDF cotado: o campo de upload aceita PDF por padrão (FATO `file-card-upload-field.tsx:105-107`) e o cotador só é oferecido sobre os arquivos de `task.layouts` (FATO `layouts-section.tsx:60,84-87`). É exatamente a separação R2/R6: imagem vai para o IMPLEMENTO (arte que o responsável aprova), PDF vai para o PROJETO DA TAREFA.
3. O cotador (`GET /layout-dimensions/:fileId?truckId=`) usa as medidas do caminhão (FATO `api-client/layoutDimensions.ts:88-99`) e só conhece 3 faces `"MOTORISTA" | "SAPO" | "TRASEIRA"` (FATO `lib/layout-dimensions/types.ts:61`). A face FRONTAL precisa entrar aí também.
4. Existem **32 declarações inline** do tipo de face `'left' | 'right' | 'back'` em 11 arquivos. Adicionar `front` sem antes criar um tipo único (`ImplementFace`) garante que alguma tela fique esquecida.
5. **Armadilha nova, e grave para R2**: o formulário de edição da tarefa reenvia o mapa COMPLETO de status de TODAS as artes em QUALQUER salvamento, tenham os status mudado ou não (FATO `task-edit-form.tsx:1933-1982` multipart; `2199-2213` JSON). Quando o responsável aprovar pelo portal, um formulário interno aberto antes disso sobrescreve a aprovação ao salvar. A arte tem de SAIR do formulário da tarefa, ou o status nunca pode viajar sem uma mudança explícita.
6. **Armadilha do R1 já armada**: `DETAIL_INCLUDE` pede `quote.include.layoutFiles` (FATO `task-detail-page.tsx:226`). É a mesma classe do incidente do `responsible`: removida a relação, `GET /tasks/:id` quebra com 500 para TODA tarefa. O mesmo vale para `task-duplicate-modal.tsx:42` e `set-quote-layout-modal.tsx:173`.
7. O tipo do `include` que o web manda é, na prática, `any`: `TaskGetManyFormData` vem de `z.infer` de um `z.lazy(...)` tipado como `z.ZodSchema` (FATO `schemas/task.ts:17`, `api-client/task.ts:4-18,101`). O `tsc` não pega nenhum include errado. Os schemas zod de include do web não rodam em lugar nenhum (FATO: grep sem uso fora de `src/schemas`), são só espelhos que ficam velhos.
8. Os nomes de campo do FormData têm de bater com os `FileFieldsInterceptor` da API, senão o multer responde 400 "Unexpected field". Uma foto da face frontal exige `implementMeasurePhotos.frontSide` nos 3 interceptors (create, batch, update: FATO `api/.../task.controller.ts:143-165, 285-306, 740-792`). Hoje o create nem tem `implementMeasurePhotos`.
9. Defeito que já existe hoje: a foto da traseira escolhida na CRIAÇÃO da tarefa é perdida em silêncio. O formulário oferece a foto (FATO `task-create-form.tsx:1019`), mas o payload só leva `photoId` (FATO `:455`) e `batch-with-quote` é JSON (FATO `api-client/task.ts:345-353`).
10. Coisas persistidas guardam nomes e quebram em silêncio se forem renomeadas: ids de seção do detalhe (`"layout"`, `"layouts"`, preferências do servidor), chaves de coluna e de filtro do widget do dashboard (`truckCategory`, `implementType`, `hasLayouts`, `truckCategories`, `implementTypes`, `hasTruck`), ids de coluna das DataTables e os presets por setor.
11. Caminhos em STRING que o `tsc` não vê: regras de atenção `truck.chassisNumber`/`truck.plate`/`truck.vinPlateId` (FATO `lib/attention/rules.ts:220,246,271`). Um caminho que não resolve devolve `undefined`, `isNull` dá verdadeiro e o alerta dispara para TODA tarefa que já entrou. Some-se a isso o changelog (`"truck.*"`, `entityType TRUCK`) e os nomes de campo do form (`"truck.category"`).
12. Volume: 309 ocorrências de `.truck` em 77 arquivos (fora o Truck Studio), 33 acessos por `as any`/cast e 31 caminhos `"truck.x"` em string. O Truck Studio NÃO é acoplado ao `Truck` da API (FATO: o motor só importa `updatePaint`, `truck-studio/index.tsx:14`) e fica fora do rework.

---

## 1. Vocabulário: o que existe hoje no web e o nome que proponho

| Hoje (web) | O que é de fato | Onde aparece | Nome proposto |
|---|---|---|---|
| `ImplementMeasure` / "layout" em `layoutsData`, `deleteLayout`, `canViewLayout`, acordeão `value="layout"`, seção `id:"layout"` | Medidas de uma face do implemento | `task-edit-form.tsx:881,914,3807-3940`; `task-detail-page.tsx:1325-1333` | **Medidas** (`measures`), face = `ImplementFace` |
| `Task.layouts` (entidade `Layout`, status DRAFT/APPROVED/REPROVED), rótulo "Layout Referência" | Mistura a ARTE (imagem) e o PDF cotado | `task-edit-form.tsx:431-470, 4372-4440`; `task-create-form.tsx:1110-1170`; `layouts-section.tsx` | Imagem vira **Arte do implemento** (`Implement.layouts`). PDF vira **Projeto da tarefa** |
| `Task.projectFiles` ("Projetos") | Arquivos variados, vídeos/imagens/PDF/EPS (FATO `task-edit-form.tsx:4172-4185`). Pouco usado (≈4 arquivos segundo a ADR 0121) | `task-edit-form.tsx:4148-4210`; `files-section.tsx` | **Projeto da tarefa** = PDF de cotas para colagem (R6) |
| (não existe) | Projeto do furgão (Furgões Ibiporã) | — | **Projeto do implemento** (`Implement.projectFiles`) |
| `Budget.layoutFiles` | Layout aprovado do orçamento | fora do recorte (financeiro); os PONTOS DE CONTATO na produção estão na §3.16 | **Sai** (R1) |
| `lib/layout-dimensions` + `/layout-dimensions` | Cotador de PDF | `inline-pdf-viewer.tsx:416-448` | Fica e passa a operar sobre o **Projeto da tarefa** (PDF), recebendo `implementId` |
| `Truck` | Veículo/implemento | tudo | **`Implement`** (R3) |
| `Truck.implementType` / `Truck.category` | Tipo de baú / porte-montagem | forms, colunas, filtros | `Implement.type` / `Implement.category` (R4) |

Recomendo começar pela troca de VOCABULÁRIO interno no web. No mínimo, renomear `layoutsData` para `measuresData` e `canViewLayout` para `canViewMeasures` no mesmo commit que cria o tipo `ImplementFace`. Sem isso, um `sed truck→implement` combinado com "layout agora é do implemento" vai casar na medida em vez da arte.

---

## 2. Modelo-alvo que este relatório assume (o web depende dele)

Escolhi a forma que minimiza o risco no web. As decisões que mudam essa forma estão na §9.

- `Implement` = `Truck` renomeado, com o **mesmo `id`** (renomear a tabela, não copiar linhas). Sem isso o changelog histórico (`entityType TRUCK`, `entityId = truck.id`) e os favoritos perdem o elo.
- `Implement.type` (enum, hoje `ImplementType`) e `Implement.category` (enum, hoje `TruckCategory`).
- Medidas: `leftSideMeasure`, `rightSideMeasure`, `backSideMeasure` + **`frontSideMeasure`** (novo), todos `ImplementMeasure` (metros no fio; o form trabalha em cm internamente, FATO `implement-measure-form.tsx:453-575`).
- Porta traseira: `rearDoorType` (`BIPARTIDA`|`TRIPARTIDA`), `rearDoorBarCount` (2|3|4), `rearDoorHatchCount` (inteiro ≥0). Onde esses campos moram é decisão (§9, P5).
- `Implement.layouts` = arte (imagem) com status de aprovação e, idealmente, quem aprovou e quando.
- `Implement.projectFiles` = projeto do furgão.
- `Task.projectFiles` = projeto da tarefa (PDF cotado), com os PDFs migrados de `Task.layouts`.
- `Task.layouts` e `Budget.layoutFiles` **deixam de existir**. `Layout.airbrushingId` (arte da aerografia) **continua**. O web usa `airbrushing.layouts` em `utils/airbrushing-submit.ts`, `schemas/airbrushing.ts:109,685-850`, `types/airbrushing.ts:52,158`, e nada disso muda.

---

## 3. Inventário por camada

### 3.1 Types (`web/src/types`)

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `types/truck.ts:1-171` | `Truck`, `TruckIncludes`, `TruckOrderBy`, FormData, respostas; `category: TRUCK_CATEGORY`, `implementType: IMPLEMENT_TYPE`, 3 `*SideMeasureId`, `spot`, `taskId` | Vira `types/implement.ts`: `Implement` com `type`, `category`, `frontSideMeasure(Id)`, campos da porta traseira, `layouts`, `projectFiles`. `spot` e `taskId` dependem de P1/P2. **Apagar** `types/truck.ts` em vez de manter um alias: o alias silencia o `tsc` |
| `types/task.ts:61,79` | `projectFileIds`, `projectFiles?: File[]` | Continua, com o significado de projeto da tarefa |
| `types/task.ts:85,152-156` | `layouts?: File[]` e `TaskIncludes.layouts`. **Mentira de tipo**: o Prisma devolve `Layout[]`, e a API achata para objetos "File-like" com `layoutId`/`status` (FATO `api/.../task-prisma.repository.ts:810-829`) | **Remover** da `Task`. Criar `ImplementLayout` com o shape verdadeiro (id do Layout, `status`, `file`, aprovador, data). Parar de depender do achatamento |
| `types/task.ts:90,201-205` | `truck?: Truck`, `TaskIncludes.truck` | `implement?: Implement`, `TaskIncludes.implement`. Remover `truck` da interface faz o `tsc` pegar todo acesso `task.truck`/`(task.truck as X)`. Escapam só `(task as any).truck` (FATO `use-task.ts:519-521`, `task-edit-form.tsx:591`, `budget-step-review.tsx:196`) e os objetos `any` (FATO `AdvancedBulkActionsHandler.tsx:521-569`) |
| `types/task.ts:134` | `TaskIncludes.quote.include.layoutFiles` "convida" a pedir a relação | Remover (R1) |
| `types/implementMeasure.ts:12-41` | inversas `trucksLeftSide/RightSide/BackSide` | `implementsLeftSide/.../implementsFrontSide` (conforme o nome que a API der às relações) |
| `types/layout.ts:21-44` | `Layout { fileId, status, airbrushingId, tasks }`, "SHARED across tasks - status changes affect all" | `tasks` sai; entra a relação com implemento (e o aprovador). Ver P3 |
| `types/paintingAnalysis.ts:437-438,555` | `implementMeasureId` (motor de pintura/orçamento de pintura) | Sem mudança de nome. Quando houver face FRONT medida, `faces-card.tsx:39-51` pode trocar a largura inferida de 260 cm pela medida real |
| `types/task-copy.ts:17-29,96-107,229-300` | Campos copiáveis `layoutIds`, `projectFileIds`, `implementType`, `category`, `implementMeasures` (descrição "esquerda, direita, traseira") | `layoutIds` sai ou vira `implementLayoutIds`; `projectFileIds` muda de significado; `implementType` vira `type`; nova descrição inclui a frente; entra "Porta traseira"; talvez `implementProjectFileIds`. **Precisa bater com o enum do `copy-from` da API** |
| `types/index.ts` | reexporta `truck` | reexportar `implement` |

### 3.2 Schemas zod do web (`web/src/schemas`)

FATO: nenhum schema de include/where/getMany do web roda em tempo de execução. O grep por `taskIncludeSchema|truckIncludeSchema|taskGetManySchema|truckGetManySchema` fora de `src/schemas` volta vazio. Eles só servem de fonte de TIPO, e como `taskIncludeSchema` é `z.ZodSchema` (FATO `schemas/task.ts:17`) o tipo resultante é `any`. Rodam de verdade apenas: `taskUpdateSchema` (resolver do form de edição, FATO `task-edit-form.tsx:2681`), `taskCreateFormSchema` local (FATO `task-create-form.tsx:66-87`), `taskDuplicateCopySchema` e schemas locais de modais.

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `schemas/truck.ts:1-691` | include/orderBy/where/getMany/create/update/batch de Truck. Carrega `optionalPlateSchema`/`optionalChassisSchema` (usados por `schemas/task.ts:11`) | Vira `schemas/implement.ts`. Os validadores de placa/chassi podem ficar num `schemas/vehicle-identity.ts`. `implementType`→`type`, filtros `implementTypes`→`types`, `+frontSideMeasureId`, `+rearDoor*` |
| `schemas/task.ts:113-139` | include `layouts` (com sub-includes de File que nem existem em `Layout`), `projectFiles` | `layouts` sai; `implement` com `include` de `layouts`, `projectFiles` e das 4 medidas |
| `schemas/task.ts:171-181` | include `truck: { include: { task } }` | `implement` |
| `schemas/task.ts:368-374,513-518,848` | where/atalho `hasLayouts` → `{ layouts: { some/none } }` | `{ implement: { layouts: { some: {} } } }` ou um novo `hasArt`. Atenção ao filtro que O DASHBOARD monta sozinho (§3.10) |
| `schemas/task.ts:497-502,846` | `hasTruck` → `truck: { isNot: null }` | `hasImplement` → `implement` |
| `schemas/task.ts:646-648,877` | `truckIds` | `implementIds` |
| `schemas/task.ts:998-999` | `truckCategories`, `implementTypes` (nativeEnum) | `implementCategories`, `implementTypes` (o nome do filtro pode ficar; o valor muda de enum) |
| `schemas/task.ts:1135-1182` | `measureSectionSchema`, `measureSideSchema`, `taskTruckCreateSchema` (`category`/`implementType` como `z.string()`, 3 lados, `xPosition/yPosition/garageId` que ninguém usa) | `taskImplementSchema`: 4 lados, porta traseira (enum/inteiros validados), `type`/`category` como `nativeEnum`, e sai o que é morto (`xPosition`, `yPosition`, `garageId`) |
| `schemas/task.ts:1231-1233,1378-1380` | `layoutIds`, `projectFileIds` em create/update | `layoutIds` sai da tarefa. **Entrada NOVA** `implement.layoutIds`/`implement.projectFileIds` (ou endpoints próprios, ver §5) |
| `schemas/task.ts:1567-1570` | `mapTaskToFormData.layoutIds` a partir de `task.layouts` | sai |
| `schemas/airbrushing.ts:39-45` | include de airbrushing com `task.truck.leftSideMeasure/backSideMeasure` | renomear (só afeta tipo) |
| `schemas/{customer,dashboard,observation,paint,sector,serviceOrder,user}.ts` | `truck: z.boolean()` dentro de includes de `task` | renomear (só afeta tipo) |
| `schemas/implementMeasure.ts:9-76` | section/create/update; altura ≤10 m; porta com `doorHeight` | Sem mudança de nome. Se a porta traseira for para `ImplementMeasure` (P5), os campos entram aqui |
| `schemas/budget.ts:210` | `layoutFileIds` max 2 | fora do recorte (R1) |

Observação R8 (FATO `use-edit-form.ts:291-395`): o form de edição submete `form.getValues()`, não a saída do zod. Um campo novo que não esteja em `taskTruckCreateSchema` **não some**, mas também **não é validado nem transformado** no cliente. Ele chega à API cru, e a API decide. Consequência: TODO campo novo precisa entrar no schema do web **e** no da API, senão a validação fica só de um lado.

### 3.3 API client e endpoints consumidos

| Arquivo:linha | Endpoint | Muda |
|---|---|---|
| `api-client/truck.ts:42-100` | `GET /trucks/garages-availability`, `POST /trucks/batch-update-spots`, `POST /trucks/request-movement` (payload `truckId`) | Rota e campo mudam para `implements`/`implementId`. Se `spot` for para a tarefa (P2), vira `taskId` |
| `api-client/implementMeasure.ts:61-62` | `POST /implement-measure/:id/assign-to-truck` `{ truckId, side: 'left'|'right'|'back' }` | `assign-to-implement`, `side` ganha `front`. **Nenhum chamador no web** (INFERÊNCIA: só `implement-measure-selector.tsx`, que é código morto, §3.18) |
| `api-client/implementMeasure.ts:65-69` | `GET /implement-measure/truck/:truckId` | `/implement-measure/implement/:id`; a resposta ganha `frontSideMeasure` |
| `api-client/implementMeasure.ts:80-81` | `POST /implement-measure/truck/:truckId/:side` | idem, `side` ganha `front` |
| `api-client/implementMeasure.ts:35-36` | tipo `ImplementMeasureUsageResponse.trucks[].truckId` | renomear |
| `api-client/layoutDimensions.ts:88-99` | `GET /layout-dimensions/:fileId?truckId=` | `implementId`; a API precisa conhecer a face FRENTE. `PanelSide` (`lib/layout-dimensions/types.ts:61`) ganha `"FRENTE"` |
| `api-client/task.ts:345-353` | `POST /tasks/batch-with-quote` com `tasks: any[]` | `any` esconde o payload inteiro. Tipar com `TaskCreateFormData[]` |
| `api-client/task.ts:101,106` | `getTasks/getTaskById` com include `any` | tipar o include (§7) |
| `api-client/index.ts:78` | `export * from "./truck"` | `./implement` |
| `utils/form-data-helper.ts:93-94` | objeto aninhado (`truck`) vai como `JSON.stringify` num campo | Genérico e sem mudança. O campo passa a chamar `implement`; a `ArrayFixPipe` da API faz o parse de qualquer chave (FATO `api/.../array-fix.pipe.ts:36-60`) |

### 3.4 Hooks, query keys, invalidações

| Arquivo:linha | Hoje | Muda / risco |
|---|---|---|
| `hooks/common/query-keys.ts:758-761` | `truckKeys = createQueryKeyStore("trucks")` | `implementKeys("implements")` |
| `hooks/common/query-keys.ts:355-356` | `layoutKeys = fileKeys` ("task files are now called layouts") | O alias engana: invalidar "layouts" invalida TODOS os arquivos. Apagar e usar `implementKeys`/`fileKeys` explicitamente |
| `hooks/common/query-keys.ts:359-364` | `garageKeys` | sem mudança |
| `hooks/administration/use-implement-measure.ts:10-14` | `byTruck: ["implementMeasures","truck",truckId]` | `byImplement` |
| `hooks/administration/use-implement-measure.ts:38-97` | `useImplementMeasuresByTruck`: se a API não trouxer `sections`, o fallback remonta o objeto **enumerando 3 lados** (FATO `:86-96`) | **Classe "objeto enumerado descarta chave nova"**: um `frontSideMeasure` some no fallback. Trocar por um laço sobre `IMPLEMENT_FACES` ou apagar o fallback ("old API version") |
| `hooks/administration/use-implement-measure.ts:151` | invalida `["trucks","detail",truckId]` escrito à mão, fora da key store | trocar por `implementKeys.detail(id)` |
| `hooks/administration/use-implement-measure-section.ts:66-136` | chaves `["implementMeasures",...]` literais | ok, só centralizar |
| `hooks/production/use-task.ts:28-33,191,314,373-383,519-521,581-584` | invalida `truckKeys`, `garageKeys`, `implementMeasureQueryKeys.byTruck((task as any).truck.id)`, `layoutKeys.byEntity("task", id)` | renomear. A linha 519 usa `as any` e o `tsc` não pega |
| `hooks/inventory/use-maintenance.ts:95,136` | `relatedQueryKeys: [truckKeys, ...]` (manutenção "afeta caminhões"?) | INFERÊNCIA: resquício. Trocar ou remover |
| `lib/attention/use-attention-socket.tsx:40` | `TRUCK: "trucks"` (entityType do socket → raiz do react-query) | `IMPLEMENT: "implements"`. Precisa bater com o `entityType` que a API emitir |
| `components/ui/task-with-service-orders-changelog.tsx:3047` | invalida `truckKeys.all` | renomear |

### 3.5 Constantes, enums, rótulos, permissões

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `constants/enums.ts:1272-1296` | `TRUCK_CATEGORY` (10), `IMPLEMENT_TYPE` (6) | `IMPLEMENT_CATEGORY` e `IMPLEMENT_TYPE` (ou o nome que a API der). Novos enums `REAR_DOOR_TYPE` (BIPARTIDA/TRIPARTIDA); `REAR_DOOR_BAR_COUNT` pode ser número validado 2..4 |
| `constants/enum-labels.ts:545-565` | `TRUCK_CATEGORY_LABELS`, `IMPLEMENT_TYPE_LABELS` (`INSULATED: 'Isoplastic'`) | renomear. Decidir o rótulo "Isoplastic" × "Isotérmico" (P7) |
| `utils/changelog-fields.ts:1723-1751` | **segunda cópia** dos rótulos de categoria/tipo, escrita à mão | trocar por `*_LABELS` (duas cópias divergem) |
| `constants/enum-labels.ts:1328,1791` / `enums.ts` | `ENTITY_TYPE.TRUCK`, `CHANGE_LOG_ENTITY_TYPE.TRUCK` = "Caminhão" | Acrescentar `IMPLEMENT` = "Implemento" e **manter** `TRUCK` para exibir o histórico |
| `constants/sortOrders.ts:995,1009` | ordem de `CHANGE_LOG_ENTITY_TYPE.TRUCK` | acrescentar `IMPLEMENT` |
| `constants/enum-labels.ts:410-413` | `LAYOUT_STATUS_LABELS` | Ver P4: a arte talvez ganhe "Aguardando aprovação do cliente" |
| `hooks/common/use-task-permissions.ts:71-113` | `canViewLayout` (= medidas), `canViewTruckSpot`, `canViewProjectFiles`, `canViewReimbursement` (**é ele que controla o card de artes**: FATO `task-edit-form.tsx:4372`), `canViewLayoutBadges`, `canEditLayout` | Renomear: `canViewMeasures`, `canViewImplementArt`, `canApproveArt` (P4), `canViewTaskProject`, `canViewImplementProject`. Tirar o card de arte de `canViewReimbursement`, que é a flag de reembolso |
| `utils/route-privileges.ts:200,217` | comentários "layouts" = barracões | sem mudança funcional |
| `constants/routes.ts:722-723,928-929` | `/producao/barracoes`; portal `veiculo(taskId)` | Se o implemento ganhar tela própria (§5), criar rota nova |

### 3.6 Formulários da tarefa

#### 3.6.1 Criar tarefa — `components/production/task/form/task-create-form.tsx` (1207 l.)

| Linha | Hoje | Muda com R2..R6 |
|---|---|---|
| 66-87 | schema local: `category`, `implementType` como `z.string()` | `category`/`type` como enum |
| 110-111 | `showLayout` (medidas) = ADMIN/LOGISTIC/PM; `showLayouts` (arte) = ADMIN/COMMERCIAL | renomear. A arte migra de bloco (ver abaixo) |
| 125 | **`implementType` padrão `REFRIGERATED`** | Toda tarefa criada sem mexer no campo nasce refrigerada. Manter? (P8) |
| 227-271 | estado das medidas `'left'|'right'|'back'`; validação diferença de largura >2 cm Motorista×Sapo | 4 faces. Validar também **frente × traseira** (as duas medem a largura do baú) |
| 282-289, 372-400 | arte: sobe cada arquivo antes (`uploadSingleFile(file, { fileContext: 'tasksLayouts' })`, FATO :391) e depois manda `layoutIds` + `layoutStatuses` para N tarefas (a MESMA arte liga-se a todas as combinações placa × série) | Passa a `implement.layoutIds` por veículo, ou "a mesma arte para os N implementos". Com aprovação por implemento, a mesma imagem precisa de status POR implemento (P3). `fileContext` novo: `implementLayouts` |
| 444-460 | `buildLayoutSectionData` lê só 3 lados e **descarta `photoFile`** (FATO :455) | Defeito atual: a foto da traseira escolhida na criação se perde (a UI oferece a foto em :1019). Na refatoração: subir a foto antes (como a arte) e mandar `photoId`, ou esconder a foto na criação (`showPhoto={false}`) |
| 491-505 | `buildTruckData` → `truck: { plate, category, implementType, ...medidas }` | `implement: { plate, type, category, ...4 medidas, porta traseira }` |
| 739-800 | campos Categoria + Tipo de Implemento | rótulos "Categoria" / "Tipo" |
| 962-1030 | acordeão "Medidas do Implemento" com 3 botões de lado | 4 botões + bloco "Porta traseira" |
| 1110-1170 | acordeão "Layout Referência" (LayoutFileUploadField + FileSuggestions `tasksLayouts`) | Vira "Arte do implemento" (imagem, com status) + "Projeto da tarefa" (PDF). Ver P3/P4 |
| (inexistente) | — | Campo "Projeto do implemento" (arquivos do furgão). **Hoje a criação nem oferece `projectFiles`** (FATO: grep `projectFile` sem ocorrência no create) |

#### 3.6.2 Editar tarefa — `components/production/task/form/task-edit-form.tsx` (4548 l.)

É o arquivo mais quente, e a outra sessão também o altera (commit `aea9532b`, −333 linhas, extração da aerografia; §10 Riscos).

| Linha | Hoje | Muda |
|---|---|---|
| 66, 73-75 | importa `LayoutFileUploadField`, `ImplementMeasureForm`, `SpotSelector`, `useImplementMeasuresByTruck` | renomear |
| 429-470 | `uploadedFiles` (arte) a partir de `task.layouts`; `layoutStatuses`; `hasLayoutStatusChanges`; `hasLayoutFileChanges` | Sai da tarefa. Vai para um bloco do implemento com estado próprio, de preferência um componente isolado com as próprias mutações (§5) |
| 572-591 | `projectFiles` (tarefa); `vinPlateFiles` via `(task as any).truck?.vinPlate` | `projectFiles` fica com o significado de projeto da tarefa (aceitar SÓ PDF? P6). `vinPlate` vai para `implement` |
| 694-698, 831-856 | `selectedLayoutSide`, `currentLayoutStates`, `modifiedLayoutSides` com união de 3 lados | `ImplementFace` (4) |
| 753-791 | mapa campo→acordeão: `"truck.category"`, `"truck.implementType"`, `"truck.plate"`, `"truck.chassisNumber"`, `"truck.vinPlateId"`, `leftSideMeasure…`, `spot`, `projectFileIds` | Strings: o `tsc` não pega. Renomear para `"implement.*"`, `frontSideMeasure`, `rearDoor*`, `implementProjectFileIds` |
| 858-913 | `truckId = task.truck?.id`; comprimento do caminhão (medidas esquerda/direita + cabine 2,0/2,4 m) para o SpotSelector | `implementId`. A regra de cabine pode passar a usar `category` (semirreboque não tem cabine) |
| 914-1016 | `deleteLayout` (apaga MEDIDA), sincronização pós-save | renomear (`deleteMeasure`) |
| 1127-1137 | valores iniciais: `layoutIds`, `truck: { plate, chassisNumber, vinPlateId, category, implementType, spot }` | `implement: {...}`; `layoutIds` sai |
| 1325-1336 | `ensureArray` das `sections` de 3 lados | 4 lados |
| 1488-1553 | apaga as 3 medidas; consolida em `changedData.truck[leftSideMeasure|…]` só os lados modificados; nomes das fotos `leftSide|rightSide|backSide` | `frontSide` + porta traseira. **A porta traseira não pode depender de `sections.length > 0`** (a guarda de :1529 descartaria a configuração da porta se a traseira não tivesse seções) |
| 1580-1605, 1619-1672 | multipart: `layouts`, `baseFiles`, `projectFiles`, `truckVinPlate`, `soCheckinFiles`, `soCheckoutFiles`, `observationFiles`, `implementMeasurePhotos.{side}` | Ver §3.7 (tabela dos nomes de campo) |
| 1686-1698 | `excludedFields` com `layoutIds` | remover `layoutIds` |
| 1758-1800 | manda `layoutIds` se `!isFinancialUser && mudou`; `projectFileIds` | sai `layoutIds` |
| **1933-1987** | **`layoutStatuses` de TODAS as artes em todo envio multipart**; `newLayoutStatuses` casado por índice | **Sai.** É o ponto de corrida com a aprovação do portal (§6, A1) |
| **2175-2213** | caminho JSON: manda `layoutIds` sempre que a tarefa já tinha arte (**sem** o filtro de `isFinancialUser` de :1791) e **sempre** `layoutStatuses` completo | **Sai.** Hoje já é assimétrico com o caminho multipart |
| 2221-2222, 2646-2647 | `projectFileIds` | fica (projeto da tarefa) |
| 2680-2700 | `useEditForm` com `fieldsToOmitIfUnchanged: [..., "layoutIds", ...]` | remover |
| 2751-2780 | `handleProjectFilesChange`; plaqueta `form.setValue("truck.vinPlateId")` | `implement.vinPlateId` |
| 3288-3345 | Combobox "Categoria do Caminhão" / "Tipo de Implemento" | "Categoria" / "Tipo" |
| 3374-3450 | Placa, Chassi, Plaqueta (foto) | `implement.*`. Ficam no bloco Implemento |
| 3807-3940 | acordeão "Medidas do Implemento" (`value="layout"`), 3 botões (Motorista/Sapo/Traseira) | 4 faces + porta traseira. **`value="layout"` é também alvo de scroll/erro** (mapa de :776-779) |
| 3944-3975 | acordeão "Vaga" (`truckId && canViewTruckSpot`) | depende de P2 |
| 4148-4210 | acordeão "Projetos" (vídeo/imagem/PDF/EPS; sugestões `taskProjectFiles`) | "Projeto da tarefa". Tipos aceitos: PDF (P6) |
| 4372-4440 | acordeão "Layout Referência" (`value="layouts"`, gate `canViewReimbursement`) com `LayoutFileUploadField` + seletor de status | Vira "Arte do implemento" (upload e status controlados por quem? P4) |
| (novo) | — | acordeão "Projeto do implemento" |

#### 3.6.3 Edição em lote (tabela) — `task/batch-edit/task-batch-edit-table.tsx:270-290`

FATO: só `plate`/`chassisNumber`, dobrados para `truck` **apenas quando mudaram**. O comentário explica o porquê: o repositório faz `upsert` e criaria um caminhão com `spot` nulo. Com o rename, o bloco vira `implement`, e a mesma cautela vale. `cells/general-painting-cell.tsx` não usa truck (só no nome do grep).

#### 3.6.4 Ações em lote — `task/bulk-operations/AdvancedBulkActionsHandler.tsx`

| Linha | Hoje | Muda |
|---|---|---|
| 30 | `BulkOperationType = "arts" | ... | "layout"` ("arts" = arte; "layout" = medidas) | `"arts"` vira operação sobre o IMPLEMENTO; `"layout"`→`"measures"` |
| 81-82, 271-311, 502-510, 624-660 | "Adicionar Layout Referência" em lote: acha as artes em comum por NOME de arquivo e manda `layoutIds` + `layoutStatuses` por tarefa | Aplicar a mesma arte a N implementos. Precisa de endpoint/campo novo (`implement.layoutIds`). O casamento por NOME é frágil, mas é outra discussão |
| 90-157, 516-578 | pré-carrega medidas "em comum" comparando 3 lados | 4 lados + porta traseira |
| 219-228 | include `layouts: { include: { file } }`, `truck.include.{left,right,back}SideMeasure` | `implement.include.{4 medidas, layouts}` |
| 896-996 | monta `truckWithLayouts.{left,right,back}SideMeasure`, `doorHeight` normalizado para `null` (o comentário avisa que `undefined` derruba o lote INTEIRO com 400) | +`frontSideMeasure`, +porta traseira. `hasAnyLayoutState` (:902-905) exige seções; porta traseira sem seção seria ignorada |
| 1116-1222 | `_perTaskTruckUpdates` → `taskData.truck`; FormData com `tasks` JSON + `layouts` + `baseFiles` + `implementMeasurePhotos.{side}` | `taskData.implement`; nomes de campo, ver §3.7 |
| 1253-1260 | títulos "Adicionar Layout Referência", "Aplicar Medidas do Implemento" | "Adicionar arte ao implemento", "Aplicar medidas do implemento" |

#### 3.6.5 Duplicar

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `task/modals/task-duplicate-modal.tsx:40-66` | include `quote.include.layoutFiles` (**R1: 500 se ficar**), `truck.include` 3 medidas | tirar `layoutFiles`; `implement` com 4 medidas |
| `task-duplicate-modal.tsx:174-241` | cópia **compartilha** `layoutIds` (mesmas artes) e **as mesmas `ImplementMeasure`** (`leftSideMeasureId` etc.) | Decidir se a cópia de uma tarefa copia/compartilha o IMPLEMENTO inteiro (P1). Se N:1, "duplicar" pode apontar para o mesmo implemento ou para um novo com medidas copiadas |
| `task-duplicate-modal.tsx:300` | `layoutFileIds` do orçamento | sai (R1) |
| `task/schedule/duplicate-task-modal.tsx` | usa `taskDuplicateCopySchema` (placa/chassi) | `implement` |

#### 3.6.6 Copiar de outra tarefa

`task/schedule/task-schedule-content.tsx:119-135, 194-224` (includes `layouts`, `truck` com 3 medidas), `task/schedule/copy-from-task-modal.tsx`, `dashboard/widgets/task-table.tsx:2090-2112` e `types/task-copy.ts` (§3.1). O endpoint `copy-from` da API define os nomes aceitos, e os dois lados têm de mudar juntos.

#### 3.6.7 Estado do formulário na URL — `hooks/production/task/use-task-form-url-state.ts:80-89, 210-237, 586-669`

FATO: `truck: { xPosition, yPosition, garageId }` + `layoutIds`. **Nenhum chamador** (grep `useTaskFormUrlState` fora de `src/hooks` volta vazio). Recomendo APAGAR em vez de atualizar.

### 3.7 Multipart: nomes de campo do FormData × interceptors da API

| Campo (web) | Quem manda | API create (`task.controller.ts:143-165`) | API batch (`:285-306`) | API update (`:740-792`) | Com o rework |
|---|---|---|---|---|---|
| `layouts` | edit `:1637-1639`; bulk `:1199-1203` | sim | sim | sim | Sai da tarefa. Se a arte subir junto com o PATCH da tarefa, criar `implementLayouts` nos 3 interceptors. **Recomendo endpoint próprio do implemento** |
| `projectFiles` | edit `:1647-1648` | sim | sim | sim | fica (projeto da tarefa) |
| (novo) `implementProjectFiles` | — | — | — | — | adicionar nos 3, ou endpoint próprio |
| `truckVinPlate` | edit `:1650-1651`; portal | sim | sim | sim | `implementVinPlate`, **com o portal junto** (`api/.../portal-identity.service.ts:110,194`, `web/api-client/portal.ts`) |
| `implementMeasurePhotos.leftSide/rightSide/backSide` | edit `:1667-1672`; bulk `:1216-1220` | **não existe** | sim | sim | + `implementMeasurePhotos.frontSide` no batch e no update. Sem isso, **400 "Unexpected field"** do multer |
| `baseFiles`, `observationFiles`, `soCheckinFiles`, `soCheckoutFiles`, `cutFiles` | edit | parcial | parcial | sim | sem mudança |
| `quoteLayoutFile` | (financeiro) | — | — | sim (`:757`) | sai (R1) |
| `_context` | helper/bulk | — | — | — | continua (`entityType: 'task'`) |
| `layoutStatuses[0]` (JSON), `newLayoutStatuses[i]` | edit `:1980-1987`; bulk `:1168-1176` | — | — | — | saem da tarefa |

O `_context` e os nomes de pasta no servidor (`files-storage.service.ts:74-75,205-206,300-301,769-770`: `Traseiras`, `Plaquetas`) são da API. A pasta "Traseiras" para fotos de medida vai receber fotos da frente também. Cabe ao agente da API.

### 3.8 Editor de medidas — `components/production/implement-measure/implement-measure-form.tsx` (1677 l.)

| Linha | Hoje | Muda |
|---|---|---|
| 26 | `MIN_DOOR_HEIGHT_CM = 90` espelhando o motor 3D | Portas LATERAIS. A porta traseira é outra coisa |
| 28-57 | props `selectedSide`, `layouts {left,right,back}`, `onChange(side,…)`, `showPhoto`, `onSideChange` | `ImplementFace` (4). `showPhoto` só na traseira (:1438,1579,1621). A frente terá foto? (P9) |
| 436-579 | estados por lado inicializados com `{left,right,back}` fixos | laço sobre `IMPLEMENT_FACES` |
| 679, 815, 850 | `selectedSide !== 'back'` sincroniza altura entre lados | A regra "altura igual" vale para as laterais; a frente e a traseira têm largura própria. Definir: frente e traseira compartilham largura? (validação cruzada) |
| 1186-1231 | Copiar/Espelhar Motorista↔Sapo | Oferecer "Copiar da traseira" na frente (largura) |
| 1234-1239 | rótulos Motorista/Sapo/Traseira | + Frente |
| 1446, 1545-1600 | na traseira: sem portas, só "Adicionar Foto" | Novo bloco **Porta traseira**: `Bipartida/Tripartida` (segmented), `Varões` (2/3/4), `Portinholas` (0..N). Desenho SVG da traseira com as folhas (1/2 ou 1/3) e os varões |
| 1101-1315 | `generateSVG`/download SVG por lado | incluir frente e porta traseira |

Outras telas com a mesma lógica de faces (todas com a união de 3 lados inline):

- `task/detail/sections/truck-implement-measure-section.tsx:18,111-127,245-247,356-411,445-470`: prévia SVG com Motorista e Sapo na coluna esquerda e Traseira à direita. A face Frente precisa de posição no desenho, e a porta traseira precisa aparecer.
- `utils/generate-implement-measure-svg.ts:5`: usado só pelo changelog (`changelog-history.tsx`).
- `utils/task-measures.ts:11-80`: m² e "L x A" a partir de esquerda/direita. Não muda (é a lateral).
- `pages/production/barracoes/index.tsx:276-290` e `garage/truck-detail-modal.tsx:100-112`: comprimento a partir das laterais. Não muda.
- `components/cliente/veiculo/veiculo-medidas-card.tsx` (portal, outro agente): usa a mesma união.
- `lib/layout-dimensions/types.ts:61-73`: `PanelSide` e `Panel` (cotador).

**Recomendação**: criar `web/src/constants/implement-faces.ts` com
`IMPLEMENT_FACES = ["left","right","back","front"] as const`, `ImplementFace`,
`FACE_LABEL: Record<ImplementFace,string>` (Motorista, Sapo, Traseira, Frente),
`FACE_MEASURE_FIELD: Record<ImplementFace,"leftSideMeasure"|…>`,
`FACE_PHOTO_FIELD: Record<ImplementFace,"leftSide"|…>` e `FACE_PANEL_SIDE: Record<ImplementFace,PanelSide>`.
Todas as 32 ocorrências passam a derivar daí. Um `Record<ImplementFace, …>` faz o `tsc` apontar cada mapa que esqueceu a frente.

### 3.9 Detalhe da tarefa — `components/production/task/detail/task-detail-page.tsx` (1707 l.)

| Linha | Hoje | Muda |
|---|---|---|
| **202-240 `DETAIL_INCLUDE`** | `truck: true`, `projectFiles: true`, `layouts: { include: { file } }`, **`quote.include.layoutFiles: true` (:226)** | `implement: { include: { vinPlate, layouts: {include:{file}}, projectFiles } }` (as medidas continuam pelo hook). **Remover `layoutFiles` NO MESMO deploy da migration R1**, porque todo detalhe de tarefa passa por aqui. `truck: true` hoje não inclui `vinPlate`, mas a tela lê `t.truck?.vinPlate` (:767). INFERÊNCIA: só aparece se a API incluir por padrão. Verificar |
| 250-253 | `ALL_DETAIL_SECTION_IDS` com `"layouts"`, `"layout"` | **Ids persistidos** nas preferências do usuário (`use-detail-preferences.ts:38-75`: localStorage + servidor). Renomear orfana as configurações. Manter os ids ou migrar |
| 274-280 | padrões por setor citando `"layout"`, `"layouts"` | idem. Acrescentar `"implement-project"`, `"task-project"` |
| 374-386 | `truckDimensions` via `useImplementMeasuresByTruck` | `implementId` |
| 409-431 | `canViewProjectFiles`, `canViewLayoutBadges`, `canViewLayout` | renomear (§3.5) |
| 500-511 | `filteredLayouts` de `task.layouts`; `hasLayout` pelos 3 `*SideMeasureId` via cast | `implement.layouts`; `hasMeasures` inclui `frontSideMeasureId` |
| 730-830 | Visão geral: Placa, Chassi, Plaqueta (foto), `truckCategory`, Tipo de Implemento, dimensões, `truckSpot`, com edição inline `setTaskField({ truck: {...} })` | `setTaskField({ implement: {...} })`. Ids de campo (`truckCategory`, `truckSpot`) também são alvo de atenção/DetailFieldDef. Renomear em conjunto com `rules.ts`. Acrescentar a Porta traseira (resumo) |
| 1325-1333 | seção `id:"layout"` "Medidas do Implemento" | 4 faces + porta traseira |
| 1335-1360 | seção `id:"layouts"` "Layout Referência" | Vira **"Arte (aprovação do cliente)"** a partir de `implement.layouts`, com status, quem aprovou e quando |
| 1362-1386 | seção `id:"files"` Arquivos (base + projetos) | Separar: "Projeto da tarefa" (PDF **com o cotador**; hoje `files-section.tsx:88-93` abre sem `layoutTruckId`) e "Projeto do implemento" |
| 1515-1530 | changelog recebe `truckId` e os 3 `*SideMeasureId` | `implementId` + `frontSideMeasureId` |
| 1554-1567, 1625 | dependências do memo; `task.truck?.plate` no título | renomear |

Seções filhas:

- `sections/layouts-section.tsx:1-126`: toda baseada em `task.layouts` com `LayoutLike` para contornar o tipo errado (:13). Vai para `implement.layouts`. O cotador (`layoutTruckId`, :60,86) sai daqui e vai para o projeto da tarefa (PDF).
- `sections/files-section.tsx:8-114`: `getVisibleTaskFiles` junta base + projetos. Separar e passar `implementId` ao visualizador no projeto da tarefa.
- `sections/truck-implement-measure-section.tsx`: renomear (`implement-measures-section.tsx`), 4 faces.
- `sections/quote-billing-section.tsx:934-950`: miniaturas de `quote.layoutFiles` (R1, outro agente, mas vive no detalhe da tarefa).
- `components/common/file/file-viewer.tsx:19-28,43,104,117,273`; `file-preview-modal.tsx:95-162,1213`; `inline-pdf-viewer.tsx:66,110,416-448`: `layoutTruckId` → `layoutImplementId` (ou `measuresImplementId`).

### 3.10 Listas, DataTables, filtros, favoritos, dashboard, exports

| Arquivo:linha | Hoje | Muda / risco |
|---|---|---|
| `task/list/task-table-columns.tsx:137-190` | colunas `plate`, `spot`, `chassisNumber` via `row.truck` | `row.implement` |
| `task/list/task-table-columns.tsx:424-432` | coluna `hasLayouts` (conta `row.layouts`) | vira "Arte" (a partir de `implement.layouts` e do status) |
| `task/list/task-table.tsx:117` | include `truck: true` | `implement: true` |
| `task/list/task-filters.tsx:179-181,757-759`, `list/filter-utils.ts:73-75,213-215`, `list/filter-indicator.tsx:133` | filtros `hasTruck`, `hasLayouts` | Chaves na URL. Renomear quebra link salvo/favorito. Aceitar o nome antigo na leitura por um tempo |
| `task/history/filter-utils.ts:184-210,258-285,401-447` | `truckCategories`, `implementTypes`, `hasTruck`, `hasLayouts` (via `as any`) | idem |
| `task/history/table/task-history-table-columns.tsx:165-295,527-560` | `measures`, `chassisNumber`, **`truckCategory`**, **`implementType`**; padrões por setor | Os ids de coluna são persistidos (preferências da tabela) |
| `task/history/table/task-history-table-page.tsx:403-415,575,610,737` | includes `layouts`, `truck` com 3 medidas; menus `adv-quote-layout` (R1) e `adv-truck-layout` (medidas) | renomear; remover o menu R1 |
| `task/history/table/task-history-table-filters.tsx:30-34` | include `truck.{left,right,back}SideMeasure.sections` | idem |
| `task/history/task-history-columns.tsx:264-400`, `task-history-table.tsx:190-205`, `task-history-list.tsx:454-460` (lista legada) | idem | idem |
| `task/history/task-export.tsx:129-142,215` | export: `measures` (precisa das medidas), `truckCategory`, `implementType`; o include é só `truck: true` | FATO: com `truck: true` a coluna "Medidas" sai "-" (as medidas não vêm). Defeito já existente. FATO extra: o mesmo include pede `serviceOrders.include.service`, e `ServiceOrder` **não tem** relação `service` (conferido no `schema.prisma`). É a classe de 500 do include passthrough (API `task.ts:1098`). Vale verificar hoje |
| `task/schedule/task-schedule-columns.tsx:95-174`, `task-schedule-export.tsx:37-38` | `measures`, `serialNumberOrPlate`, `spot`, `chassisNumber` | renomear |
| `task/schedule/task-schedule-table-page.tsx:92,476-488,650,685,869` | include `truck`, `layouts`, menus R1/medidas | idem |
| `task/preparation/task-prep-page.tsx:84-115` (`LIST_INCLUDE` com `truck.select{... vinPlateId, implementType, leftSideMeasure, rightSideMeasure}`), `:356-368`, `:843-866` (menu R1), `:949-960` (agrupamento `truckCategory`/`implementType`) | | renomear. **`select` explícito**: campo novo (ex.: porta traseira) só aparece se for acrescentado aqui |
| `task/preparation/task-prep-columns.tsx:264,528-601` | colunas `truckCategory`, `implementType`, `chassisNumber`, `measures` + padrões por setor | ids persistidos |
| `production/airbrushing/table/airbrushing-table-columns.tsx:50-85`, `airbrushing-table-page.tsx:36-47` | identificador e medidas via `task.truck` | renomear |
| `production/airbrushing/form/task-selector.tsx:21-41,143-147` | `select` de `truck` com `category`, `implementType`, medidas | renomear |
| **`dashboard/widgets/task-table.tsx`** | chaves de coluna `truckCategory`, `implementType`, `hasLayouts` (:396-461, 905-925, 1053); filtros zod persistidos `truckCategories`, `implementTypes`, `hasTruck`, `hasLayouts` (:1335-1349, 1375); `where` montado **no cliente**: `{ truck: { category: { in } } }`, `{ truck: { implementType: { in } } }`, `{ layouts: { some/none } }` (:1540-1564); include `truck: true`, `layouts: true` (:1650-1660); coluna de artes `(task as any).layouts` (:535-666); copiar de (:2097-2110) | **O widget valida a configuração salva com zod `.default(...)`**. Uma chave de filtro renomeada faz o valor antigo sumir em silêncio (o filtro salvo do usuário deixa de filtrar) e uma chave de coluna desconhecida é descartada. Usar o versionamento que já existe (`DASHBOARD_LAYOUT_VERSION`, `dashboard/types.ts:110` "Old layouts are migrated lazily") e escrever o migrador |
| **`dashboard/presets.ts:57,288,358,532,545,596,691,759`** | presets por setor usam `hasLayouts`; o DESIGNER tem "Tarefas sem Layouts" (`hasLayouts: "no"`) | Com a arte no implemento, a pergunta do designer vira "tarefas cujo implemento não tem arte aprovada/enviada". O preset precisa do filtro novo, senão a fila do designer esvazia ou dá 500 |
| `components/production/production-period-tasks-modal.tsx:86,128`, `performance-period-modal.tsx:118`, `bonus-value-day-modal.tsx:96` | include `truck: true`; identificador | renomear |
| `components/personnel-department/bonus/detail/bonus-tasks-table.tsx:81`, `payroll/detail/tasks-in-bonus-card.tsx:69-152`, `common/related-tasks-card.tsx:75-203`, `cut/form/cut-create-wizard.tsx:165`, `task/form/selected-tasks-summary.tsx:20`, `pages/public/service-report/[id].tsx:528`, `pages/production/schedule/edit/[id].tsx:136,157`, `pages/production/schedule/batch-edit.tsx:54` | exibem placa/identificador | renomear |
| Busca global (spotlight) | O web não tem campo de truck. Os rótulos de "campo casado" (Chassi, Placa) vêm da API (`spotlight.tsx:76`) | API |

### 3.11 Garagem / pátio

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `pages/production/barracoes/index.tsx:83-140` | `useTasks` com `where: { truck: { isNot: null }, OR: [{ truck: { spot: { not: null } } }, …] }` e `select.truck.{id,spot,plate,chassisNumber,leftSideMeasure,rightSideMeasure}` | `implement`. Se `spot` for para a tarefa (P2): `where: { spot: { not: null } }` |
| `barracoes/index.tsx:160-175, 211-403, 485` | `batchUpdateSpots([{ truckId, spot }])`, `requestMovement`, 6 casts `task.truck as any` | idem |
| `components/production/garage/garage-view.tsx`, `single-garage-view.tsx`, `patio-view.tsx` | trabalham sobre um DTO local (`id`, `spot`, `length`, …). O `id` do item é o `truck.id` e o drop chama `onTruckMove(truckId, spot)` | Trocar o nome do id. A lógica não muda |
| `garage/truck-detail-modal.tsx:55-80,100-265` | `useTaskDetail` com `truck.include{vinPlate,left,right}`, `layouts`; 7 casts `as any` | `implement`; artes do implemento |
| `task/form/spot-selector.tsx:9-19,87-91` | `getGaragesAvailability(truckLength, truckId)` | idem |

### 3.12 Produção: corte, aerografia, preparação, observação

- Corte: não usa artes nem projeto (FATO: grep `layouts|projectFiles|baseFiles` vazio em `production/cut`, `multi-cut-selector`, `cut-selector`). Só o identificador `t.truck?.plate` (`cut-create-wizard.tsx:165`).
- Aerografia: tem arte PRÓPRIA (`Layout.airbrushingId`) e fica como está. Detalhe: `airbrushing-detail-page.tsx:296-303,725` (`task.truck` para o identificador).
- Observação: `observation-detail-page.tsx`, sem referência relevante.
- Preparação: §3.10.

### 3.13 Visualizador e cotador (PDF cotado = projeto da tarefa)

FATO: hoje o cotador liga-se só pela seção de artes (`layouts-section.tsx:84-87`). O visualizador libera a cotagem quando há `layoutTruckId` (`file-preview-modal.tsx:162`). O PDF inline pede `layoutDimensionsService.get(fileId, { truckId })` (`inline-pdf-viewer.tsx:416-448`).

Com R6:

1. `FilesSection`/"Projeto da tarefa" passa `layoutImplementId = task.implement.id` ao abrir PDF.
2. "Arte do implemento" (imagem) **não** precisa de cotador.
3. A API do cotador tem de aceitar a face FRENTE (`PanelSide`).
4. O painel de arte do portal (outro agente) não usa cotador.

### 3.14 Changelog (histórico)

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `components/ui/task-with-service-orders-changelog.tsx:3100-3140` | busca changelogs com `entityType: TRUCK, entityId: truckId` e `IMPLEMENT_MEASURE in layoutIds` | Passar a buscar `entityType in [TRUCK, IMPLEMENT]`. Se a API gravar os novos como `IMPLEMENT` e o web só pedir `TRUCK`, **o histórico novo some sem erro**. Exige o **mesmo id** (§2) |
| mesmo arquivo `:535-588,804-806,920-956,1815,2145-2457,3264-3296` | ramos de renderização por `TRUCK`/`IMPLEMENT_MEASURE`; campos `layouts`, `layoutIds`, `leftSideMeasureId`... | Manter os ramos antigos (histórico) e acrescentar os novos (`frontSideMeasureId`, `rearDoor*`, `implement.layouts`) |
| `components/ui/changelog-history.tsx:979-1081,1634,2151-2153,2430-2438` | idem, com `"truck.leftSideMeasureId"` etc. | idem |
| `utils/changelog-fields.ts:343-400,607-625,793-853,1286-1304,1723-1760,2596-2613` | rótulos de `truck.*`, `layouts`, `layoutFileIds`, `implementMeasures` | Acrescentar os nomes novos **sem apagar os antigos**, porque as linhas históricas continuam no banco com os nomes antigos |

### 3.15 Sistema de atenção

- `lib/attention/rules.ts:11-20,206-272`: `truck.chassisNumber`, `truck.plate`, `truck.vinPlateId`, com alvos de campo `chassisNumber`, `plate`, `vinPlate`.
- `lib/attention/predicate.ts:22`: lê caminho pontilhado, e caminho ausente vira `undefined`.
- `lib/attention/types.ts:58`.
- `lib/attention/engine.test.ts:43,132-176,245`: fixtures com `truck`.

**Risco (FATO + INFERÊNCIA):** o predicado `{ op: "isNull", field: "truck.plate" }` sobre uma tarefa que agora traz `implement` (e não `truck`) é VERDADEIRO. As regras R3a/R3b/R3c disparariam para toda tarefa com `entryDate` enquanto estiver em voo. Trocar os caminhos no mesmo commit do rename e deixar um teste que falhe se um caminho de regra não existir no tipo `Task` (ex.: validar os `field` contra uma lista de caminhos conhecidos). A API também consome regras (`api/src/modules/common/attention/attention.service.ts` cita `truck.chassisNumber`) e precisa mudar junto.

### 3.16 R1 visto do lado da produção (menus "Adicionar Layout Aprovados")

O modal `task/schedule/set-quote-layout-modal.tsx` (define `Budget.layoutFiles` em lote, include `quote.include.layoutFiles`, :100-190) é aberto a partir de TELAS DE PRODUÇÃO:

- `task/preparation/task-prep-page.tsx:49,552,570-576,853-866,1115-1119`
- `task/schedule/task-schedule-table.tsx:50,127,245-253,651`
- `task/schedule/task-schedule-table-page.tsx:63,276,289-295,645-651,869`
- `task/schedule/task-table-context-menu.tsx:24,136-141` (ação `"quoteLayout"`)
- `task/history/task-history-context-menu.tsx:17,67,91-215,538-541,758-765,862-865`
- `task/history/table/task-history-table-page.tsx:65,218,570-576,737`

Com R1 tudo isso sai: o modal, os 5 pontos de menu, o tipo `TaskAction "quoteLayout"` e o `ApprovedLayoutPicker` (financeiro, outro agente). Remover o modal sem remover os menus deixa um import quebrado. O `tsc` pega esse caso, mas só se o arquivo for apagado e não esvaziado.

### 3.17 Truck Studio, motor de pintura, orçamento de pintura

- **Truck Studio** (`pages/tools/truck-studio/**`): não consome `Truck` da API. O motor tem medidas e portas próprias (`engine/ui/livery-measures.ts:38-186`, `engine/vehicle/trailer-door.ts` com varão e guias). Com a porta traseira bipartida/tripartida e varões no cadastro, surge uma **oportunidade** futura de abrir o Studio a partir do implemento. Fica fora do rework. As ocorrências `backSide` em `engine/scene/scene.ts`/`sky.ts` são `THREE.BackSide` e não têm relação com isto.
- **Orçamento de pintura** (`components/administration/painting-budget/**`): `PaintingAnalysis.implementMeasureId` e faces `LEFT_SIDE|RIGHT_SIDE|BACK|FRONT|ROOF` (`types/paintingAnalysis.ts:17,89-95`). Já conhece a FRENTE e usa a largura inferida de 260 cm (`faces-card.tsx:39-51`). Quando houver `frontSideMeasure`, a calibração pode usar a medida real. Sem quebra.

### 3.18 Código morto que convém APAGAR em vez de migrar

| Arquivo | Evidência |
|---|---|
| `components/production/implement-measure/implement-measure-selector.tsx` | só importado pelo próprio diretório; nenhum uso |
| `components/production/task/implement-measure/implement-measure-selector.tsx` + `index.ts` | idem (grep `ImplementMeasureSelector` só nesses arquivos) |
| `hooks/production/task/use-task-form-url-state.ts` | nenhum chamador |
| `hooks/administration/use-implement-measure-list.ts` | usado só pelo seletor morto (INFERÊNCIA: confirmar) |
| fallback "old API version" em `use-implement-measure.ts:66-96` | a API já devolve as seções |
| `schemas/*` de include/where/getMany do web | não rodam. Se forem mantidos como fonte de tipo, gerar a partir da API |

---

## 4. Onde cada coisa passa a aparecer

| Artefato | Dono | Onde aparece no web interno | Quem edita (proposta) |
|---|---|---|---|
| **Arte** (imagem que o cliente aprova) — `Implement.layouts` | IMPLEMENTO | Detalhe da tarefa (seção "Arte", com status, aprovador e data); modal do barracão (`truck-detail-modal`); dashboard (coluna/filtro "Arte"); prep/agenda (coluna); bloco Implemento do form; ação em lote "Adicionar arte" | Upload: COMMERCIAL/DESIGNER/ADMIN. Aprovar/reprovar: **o responsável no portal** (P4) |
| **Projeto da tarefa** (PDF com cotas de colagem) — `Task.projectFiles` | TAREFA | Detalhe (seção "Projeto da tarefa", **com o cotador**); form de edição (acordeão); criação (novo); cópia de tarefa | DESIGNER/ADMIN (hoje `projectFileIds` é editável por ADMIN/COMMERCIAL/LOGISTIC/PM, FATO `task-copy.ts:102`; revisar) |
| **Projeto do implemento** (desenho do furgão, Furgões Ibiporã) — `Implement.projectFiles` | IMPLEMENTO | Detalhe (seção "Projeto do implemento"); bloco Implemento do form; portal (outro agente: o responsável pode enviar?) | COMMERCIAL/LOGISTIC/ADMIN e o responsável pelo portal (P10) |
| **Medidas** (4 faces) + **porta traseira** | IMPLEMENTO | Bloco/Acordeão "Medidas do implemento" (form), seção do detalhe, ações em lote, cotador | LOGISTIC/PM/ADMIN e o responsável pelo portal |
| **Tipo / Categoria / Placa / Chassi / Plaqueta** | IMPLEMENTO | Bloco Implemento (form), visão geral do detalhe, colunas, filtros, exports | como hoje (`canEditIdentity`) |
| **Vaga (spot)** | TAREFA (recomendado) ou IMPLEMENTO | Barracões, acordeão Vaga | LOGISTIC/PM/ADMIN (P2) |

---

## 5. Telas e componentes novos ou alterados (web interno)

1. **`ImplementBlock`** (novo componente, usado no form de edição, na criação e, se couber, no detalhe em modo edição):
   - Identidade: Tipo, Categoria, Placa, Chassi, Plaqueta (foto).
   - Medidas: 4 abas (Motorista, Sapo, Traseira, **Frente**). Validação cruzada: Motorista×Sapo ≤2 cm (hoje) e **Frente×Traseira** (largura).
   - **Porta traseira**: `Tipo de abertura` (Bipartida | Tripartida), `Varões` (2 | 3 | 4), `Portinholas` (0..N). Desenho da traseira com as folhas e os varões no SVG.
   - Arte: upload + estado de aprovação vindo do portal (só leitura para o interno, salvo P4) + histórico de quem aprovou.
   - Projeto do implemento: upload (PDF/DWG/imagem, P6).
   - **Salva por endpoint próprio do implemento** (`PATCH /implements/:id`, `POST /implements/:id/layouts`...) e não pelo multipart gigante da tarefa. Assim a arte e as medidas deixam de viajar no `PUT /tasks/:id`, o que elimina a corrida de status (A1) e tira ~1.000 linhas de estado do `task-edit-form.tsx`.
2. **`TaskProjectSection`**: substitui "Projetos". Aceita PDF e abre com o cotador (`implementId`).
3. **`ImplementArtSection`** no detalhe: substitui `LayoutsSection`, lê `implement.layouts` e mostra status, aprovador e data.
4. **`ImplementProjectSection`** no detalhe.
5. **`ImplementMeasuresSection`**: renomeia `truck-implement-measure-section.tsx` e acrescenta Frente e porta traseira.
6. **`ImplementMeasureForm`**: aba Frente e bloco Porta traseira.
7. Filtro/coluna **"Arte"** (tem arte? aprovada? aguardando cliente?) no dashboard, na preparação e na agenda, com os presets do DESIGNER migrados.
8. Remoção: `SetQuoteLayoutModal` + 5 menus (R1); `LayoutFileUploadField` sai da tarefa (fica para a arte do implemento, e a aerografia usa `FileCardUploadField`).
9. (Opcional, P11) Tela **Implementos** (lista/detalhe por cliente). Só faz sentido se o implemento sobreviver à tarefa (N:1, P1).

---

## 6. Armadilhas da classe R8 encontradas neste recorte

| # | FATO | Efeito | Guarda-corpo |
|---|---|---|---|
| A1 | Status de TODAS as artes reenviado em todo salvamento (`task-edit-form.tsx:1933-1987`, `2199-2213`) | Um formulário velho sobrescreve a aprovação feita pelo responsável no portal | Tirar a arte do form da tarefa. Status só viaja com mudança explícita e com checagem de versão (`updatedAt`) na API |
| A2 | `DETAIL_INCLUDE.quote.include.layoutFiles` (`task-detail-page.tsx:226`), `task-duplicate-modal.tsx:42`, `set-quote-layout-modal.tsx:173` | 500 em todo detalhe de tarefa quando R1 remover a relação (include passthrough da API) | Remover no web ANTES (seguro com a API atual) e tornar o include da API estrito (400 em vez de 500) |
| A3 | Include do web é `any` (`schemas/task.ts:17`, `api-client/task.ts:101`) | Nenhum include errado é pego pelo `tsc` | Tipar os includes com `satisfies` contra um tipo gerado do Prisma (ou exportado pela API) e criar um teste de contrato (§7) |
| A4 | `useImplementMeasuresByTruck` remonta 3 lados (`use-implement-measure.ts:86-96`) | `frontSideMeasure` some em silêncio | laço sobre `IMPLEMENT_FACES` / apagar o fallback |
| A5 | `select` explícitos com medidas (`task-prep-page.tsx:100-115`, `barracoes/index.tsx:113-138`, `airbrushing/form/task-selector.tsx:33-41`) | Campo novo (frente, porta) "não aparece" sem erro | Revisar cada `select` na mesma PR do campo |
| A6 | Interceptors: sem `implementMeasurePhotos.frontSide` | 400 "Unexpected field" ao salvar foto da frente | Teste que monta o FormData do web e confere contra a lista do controller |
| A7 | Foto da traseira na criação só manda `photoId` (`task-create-form.tsx:455`) | Foto perdida em silêncio (já existe hoje) | Subir antes, ou esconder a foto |
| A8 | Regras de atenção em string (`rules.ts:220,246,271`) | Alarme falso em massa | Teste de caminho |
| A9 | Changelog pede só `TRUCK` (`task-with-service-orders-changelog.tsx:3107-3110`) | Histórico novo some | `entityType in [...]` + id preservado |
| A10 | Configs persistidas (detalhe, widget, colunas, presets) com `layout`, `layouts`, `truckCategory`, `implementType`, `hasLayouts`, `hasTruck`, `truckCategories` | Filtro/coluna/seção salvos somem sem erro | Manter os ids estáveis, ou migrar lazy com versão |
| A11 | Duas cópias de rótulos de categoria/tipo (`enum-labels.ts:545-565` e `changelog-fields.ts:1723-1751`) | Rótulo diverge | Usar só `*_LABELS` |
| A12 | `task-export.tsx:215-217`: `truck: true` sem medidas; `serviceOrders.include.service` (relação inexistente) | Coluna Medidas vazia hoje; possível 500 na exportação (INFERÊNCIA, depende da API) | Verificar hoje e corrigir na passada |
| A13 | `task-batch-edit-table.tsx:270-290`: o repositório faz `upsert` do veículo | Mandar `implement: {}` cria implemento do nada | Manter o "só quando mudou" |
| A14 | `Task.layouts` tipado `File[]` mas é `Layout` achatado pela API (`task-prisma.repository.ts:810-829`) | Ao mover para `implement.layouts`, o achatamento precisa ir junto, ou o web baixa pelo id do `Layout` (404) (`layouts-section.tsx:32`) | Definir UM shape (`ImplementLayout` com `file` aninhado) e parar de achatar |

---

## 7. Plano de execução no web (ordem que evita a janela de 500)

1. **PR-0 (antes de tudo, compatível com a API atual)**:
   - Remover `quote.layoutFiles` de `DETAIL_INCLUDE`, `task-duplicate-modal` e `set-quote-layout-modal` (R1).
   - Tirar os menus R1 da produção.
   - Criar `constants/implement-faces.ts` e trocar as 32 uniões inline (sem mudar comportamento).
   - Renomear o vocabulário interno (`layoutsData`→`measuresData`...).
   - Apagar o código morto (§3.18).
   - Corrigir A7 e A12.

   Tudo isso vai para produção sem depender da migration.
2. **Teste de contrato de include** (web, vitest): exportar `DETAIL_INCLUDE`, `LIST_INCLUDE` e os demais como constantes nomeadas e validá-los contra um JSON de relações gerado do `schema.prisma` da API (o DMMF). Um include com chave que não é relação falha no CI, não em produção. Mesmo teste para os `field` das regras de atenção e para os nomes de campo do FormData × interceptors.
3. **PR-1 (junto com a API do rework)**:
   - `types/implement.ts`; remover `truck` e `layouts` de `Task` (o `tsc` aponta ~300 locais; os 3 `(task as any).truck` + objetos `any` do §3.1 à mão).
   - `schemas/implement.ts`, api-client, hooks e query keys.
   - Form (bloco Implemento com endpoint próprio), detalhe, colunas, filtros, garagem, changelog (duplo) e atenção.
4. **Migração de configs persistidas**: versão nova do layout do dashboard + migrador (`truckCategories`→`implementCategories` etc.), mapa de aliases na leitura das URLs de filtro e ids de seção estáveis.
5. **Deploy** (regra da casa: buildar ANTES de migrar). O bundle web velho aberto nas abas vai mandar `include: { truck }` para a API nova. Opções:
   - (a) a API aceita `truck` como alias de `implement` por um release, em include/where/select/body;
   - (b) handshake de versão que força reload.

   Recomendo (b). Se o dono aceitar um alias temporário, (a) + (b).
6. **PR-2**: presets do DESIGNER com o filtro de arte novo; remover os aliases.

---

## 8. Testes

Existentes afetados (web, vitest):

- `src/lib/attention/engine.test.ts:43,132-176,245`: fixtures `truck: { chassisNumber, plate, vinPlateId }`.
- `src/utils/billing-coverage.test.ts:44-47`: `truck: { plate }` (faturamento, mas quebra no rename).
- `src/components/cliente/solicitacao/solicitacao-schema.test.ts` (portal, outro agente; medidas).
- `src/utils/quote-layout-coverage.test.ts`: só existe na branch `feat/orcamento-veiculos` e morre com R1.
- `src/pages/tools/truck-studio/engine/project/file.spec.ts` e `tools/verify-manifests/catalog-resolves.test.ts`: citam "truck" do Studio, **sem impacto**.

E2E (Playwright, dentro do repositório da API):

- `api/tests/e2e-ui/helpers/ui.ts:138-205` ("Layout Aprovados", `layoutFile`) e `fase3-assinatura.ts:93-291` (seção LAYOUT no PDF): R1, agente de orçamento.
- `api/tests/e2e-portal/cenarios/01-requisicao-com-medidas.ts:117-134`: lê `t.truck?.leftSideMeasure/rightSideMeasure/backSideMeasure`. Vai quebrar no rename e deve ganhar a frente.

Não há teste de unidade para `task-edit-form`, `task-create-form`, `AdvancedBulkActionsHandler`, `ImplementMeasureForm`, `use-implement-measure` nem `DETAIL_INCLUDE`.

A criar:

1. Contrato de include/select (§7.2).
2. `IMPLEMENT_FACES` exaustivo.
3. Regras de atenção: todo `field` existe em `Task`.
4. FormData × interceptors.
5. Migrador da configuração do dashboard (entra config antiga, sai config nova com os filtros preservados).
6. Validação da porta traseira (enum/2..4/≥0).
7. Cenário e2e "responsável aprova arte → o form interno salva outra coisa → a aprovação continua" (A1).

---

## 9. Perguntas ao dono

- **P1. Implemento 1:1 com a tarefa (como `Truck.taskId @unique` hoje) ou N:1 (o implemento sobrevive e volta em outra tarefa)?**
  - Recomendo **N:1** (`Task.implementId`). É o que dá sentido a "o responsável informa as medidas do implemento" e ao projeto da Furgões: o furgão volta anos depois com as mesmas medidas.
  - Custo no web: `duplicar`/`copiar de`/`criar N placas` precisam decidir se reaproveitam ou criam implemento, e o `upsert` do lote muda.
  - Se for 1:1 agora, o rework é quase só renome.
- **P2. A VAGA (spot do barracão) fica no implemento ou vai para a tarefa?** Recomendo **tarefa**: é estado operacional da Ankaa, e o monorepo já decidiu assim ("a vaga é da tarefa, não do implemento"). O responsável nunca deve vê-la. Afeta os barracões e `/trucks/*`.
- **P3. A mesma arte para N implementos (frota igual): um status compartilhado, como hoje (`Layout` único por arquivo, "status changes affect all"), ou status POR implemento?** O caso Carlotti (nº 990) e a outra sessão mostram a necessidade de status por veículo. Recomendo uma tabela de junção implemento×arte com status, aprovador e data próprios.
- **P4. Depois de R2, o interno ainda pode marcar a arte como Aprovada/Reprovada?** Recomendo: o interno sobe a arte e a "envia para aprovação". Só o responsável aprova ou reprova, com override do ADMIN registrado. O portal hoje só mostra ao cliente as artes APROVADAS ("Layout em revisão é conversa interna"), e isso se inverte.
- **P5. Onde moram os campos da porta traseira: no `Implement` ou na `ImplementMeasure` da traseira?** Recomendo **no Implement** (escalares simples, o portal e os filtros ficam triviais, e não dependem de a traseira ter seções). Perguntas de domínio:
  - Os "varões" (2/3/4) são o total ou por folha?
  - Na tripartida as folhas são iguais?
  - As portinholas ficam em qual folha? Têm medida (altura/largura/posição) ou é só a quantidade?
  - A porta lateral (seções `isDoor`) continua como está?
- **P6. Tipos de arquivo:**
  - Projeto da tarefa: SÓ PDF? (O cotador só funciona em PDF.)
  - Projeto do implemento: PDF/DWG/DXF/imagem?
  - Os ~4 `projectFiles` de hoje: são projetos da Furgões (vão para o implemento) ou cotas (ficam na tarefa)? Precisa de um SELECT de conferência.
- **P7. Rótulo de `INSULATED`: "Isoplastic" (UI hoje) ou "Isotérmico" (nota)?** Com "tipo" virando campo de primeira classe no portal, vale unificar.
- **P8. O padrão "Refrigerado" na criação (`task-create-form.tsx:125`) continua?** Se o responsável vai informar o tipo, talvez seja melhor nascer vazio.
- **P9. A face FRONTAL tem seções/portas e foto, como as laterais, ou é só altura × largura (+ foto)?** Existe região do aparelho de refrigeração a reservar?
- **P10. O responsável pode ENVIAR o projeto do implemento pelo portal?** E pode editar medidas depois de a tarefa entrar em produção?
- **P11. Precisa de uma tela interna "Implementos" (lista/detalhe por cliente)?** Só se P1 = N:1.
- **P12. Os ids persistidos (`"layout"`, `"layouts"`, `truckCategory`, `hasLayouts`...): manter para não perder configurações dos usuários, ou migrar para nomes novos?** Recomendo migrar com versão, sem manter nome velho.

---

## 10. Riscos

1. **Conflito com a outra sessão** (`feat/orcamento-veiculos`, web 3 commits à frente da `main`):
   - `aea9532b` corta 333 linhas do `task-edit-form.tsx` (aerografia);
   - `d6a48bec` cria "layout aprovado por veículo" no orçamento (`Budget.layoutScope`, `quote-layout-coverage.ts`, detalhe da tarefa mostrando as artes do veículo), que R1 mata;
   - `56139571` reescreve `pages/financial/budget/details/[taskId].tsx` (+1532 linhas) com edição de N veículos (placa, medidas).

   O rework precisa nascer DEPOIS do merge (ou do descarte explícito) dessas branches, senão é conflito certo no arquivo mais quente.
2. **Janela de bundle velho**: abas abertas com o web antigo chamando a API nova (`include: { truck }`, `layoutIds`). Sem alias ou reload forçado, dá 500/400 por minutos a horas (memória: "bundle velho gera 500 falso").
3. **Corrida de aprovação (A1)**: se a arte continuar no form da tarefa, a aprovação do cliente será sobrescrita. É o risco de negócio mais alto do recorte, porque o cliente aprova e o sistema desaprova.
4. **Configurações persistidas somem em silêncio** (dashboard, colunas, seções, filtros de URL), e a fila do DESIGNER ("Tarefas sem Layouts") esvazia ou quebra.
5. **Alarme falso em massa** das regras de atenção (A8).
6. **Histórico partido** se o id do implemento não for o id do truck (A9).
7. **`tsc` verde não prova nada** sobre includes e caminhos em string (A3, A8, A10). Sem os testes de contrato da §7.2 a validação é manual.
8. **Snapshot de assinatura** (outro agente): os `layoutFileIds` históricos no recorte MATERIAL precisam continuar renderizáveis. No web isso toca `pages/public/budget/[id].tsx` e `invoice-pdf-generator.ts:96-98`.
9. **Fotos de medida**: a pasta "Traseiras" do servidor passa a receber fotos da frente. O nome de campo novo precisa entrar nos 3 interceptors (A6).
10. **Semântica do `projectFiles`**: o mesmo campo passa a significar outra coisa. Arquivos antigos que eram "projeto do furgão" ficariam no lugar errado sem a migração guiada pelos dados (P6).
