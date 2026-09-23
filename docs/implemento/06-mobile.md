# 06 — APP MOBILE no rework Truck → Implemento (R1..R8)

Recorte: app mobile. Tudo aqui foi feito em SOMENTE LEITURA (grep/sed/git log/git show). Nenhum
comando de build, teste, `flutter`, `shorebird` ou banco foi executado.

Convenção: **[FATO]** = li no código/git; **[INF]** = inferência minha; **[DECISÃO]** = só o dono decide.

---

## 0. Resumo executivo

1. **O app vivo é o Flutter** (`mobile-flutter`, `main` @ `9335286` de 19/09, versão `1.4.1+24`,
   Shorebird). O RN (`mobile/`) está **morto**: mesmo bundle id, último commit 14/08, o servidor de
   instalação tem UM binário por plataforma e é o do Flutter. Não detalho o RN.
2. **Não há codegen**: modelos escritos à mão (`fromJson` manual), nada de `json_serializable`/
   `freezed`/`build_runner`, zero `*.g.dart`. Não há o que "regenerar"; o risco é o inverso — o
   compilador não avisa nada sobre chave de JSON errada.
3. **O app é tolerante na LEITURA e cego na ESCRITA.** Se a API renomear `truck`→`implement` sem
   alias, o app instalado **não quebra na tela** (lê `j['truck'] is Map`, vira `null`), mas:
   - **grava em silêncio no vazio**: `PUT /tasks/:id {truck:{...}}` responde **200** e o dado some
     (`taskUpdateSchema` não é `.strict()`). O editor de medidas diz "Medidas salvas" e não salvou
     nada. Mesma coisa para placa, chassi, categoria, tipo, plaqueta, e para a criação de tarefas
     pelo orçamento (`/tasks/batch-with-quote`);
   - **quebra com 400** onde manda `where` (o `taskWhereSchema` É `.strict()`): tela **Garagens** e os
     widgets "Sem/Com Layouts"/"Aguardando Plotagem" do dashboard;
   - **quebra com 403** se o zod continuar aceitando `truck` mas a whitelist `INCLUDE_WHITELIST.Task`
     o perder (é 403, não descarte) — derruba **toda** listagem e detalhe de tarefa;
   - **quebra com 500** se o zod continuar aceitando `truck`/`layouts`/`layoutFiles` e a relação sair
     do Prisma (includes aninhados passam direto para o Prisma);
   - o **chão de fábrica fica sem a arte e sem o PDF cotado** no celular (galeria "Layouts" vazia)
     se `Task.layouts` sumir sem compat.
4. **Não existe versão mínima nem update forçado.** O app não manda cabeçalho de versão, o servidor
   não sabe quais versões estão em campo, o prompt do Shorebird aceita "Agora não" e só é checado no
   *launch*. Logo: **a ordem de lançamento tem de ser "app tolerante primeiro, API com alias,
   app novo, portão de versão, remove alias"**, e o PRIMEIRO passo é um patch OTA que ainda não
   existe (cabeçalho `X-App-Version` + tratamento de 426). Detalhe na §5.
5. O Shorebird cobre o rework (é só Dart) **desde que não entre glifo de ícone novo** — a fonte
   Tabler é *tree-shaken*, glifo novo muda asset e o Shorebird recusa o patch (FATO, comentário em
   `lib/features/signature/budget_change.dart:254-259`). Telas novas (frente, porta traseira) têm de
   reusar ícones já presentes, ou vira release nativa com reinstalação manual via `/install`
   (iOS ad-hoc!).
6. Tamanho: **~45 arquivos de `lib/`** mudam de verdade (82 mencionam os termos; o resto é
   comentário, ícone `TablerIcons.truck` ou o substantivo "caminhão" da garagem), **~16 telas/fluxos**,
   **13 arquivos de teste**. O maior bloco é o orçamento (`budget_form_screen.dart`, 5.997 linhas, e
   `budget_sections.dart`), onde R1 **apaga** ~400 linhas.
7. Já há prova de que o app anda atrás: a API removeu `BudgetPayer.responsible` em 18/09
   (migration `20260918120000_orcamento_sem_responsavel_proprio`, commit `e81fd9f1`, já na `main`),
   e o app ainda pede `customerConfigs.include.responsible` (`lib/features/financial/budget.dart:1187`)
   e lê `j['responsible']` (`budget.dart:531`). Não quebra só porque o zod do orçamento descarta a
   chave em silêncio — exatamente a classe de defeito que o dono quer evitar.

---

## 1. Qual app está em uso

| Evidência | Flutter (`mobile-flutter`) | RN (`mobile`) |
|---|---|---|
| Último commit | `9335286` 19/09/2026 (150 commits desde 30/06) **[FATO]** | `16d5916d` 14/08/2026 **[FATO]** |
| Versão | `1.4.1+24` (`pubspec.yaml:24`); bumps 28/07→18/09 (`git log -G'^version:'`) **[FATO]** | `1.0` build 9 (`app.json:5,22`) **[FATO]** |
| Bundle id | `com.ankaadesign.management` (`android/app/build.gradle.kts:42`) | o MESMO (`app.json:21,46`) — instalar o Flutter substitui o RN no aparelho **[FATO]** |
| Distribuição | IPA ad-hoc + APK em `/install` (`api/src/modules/system/install/install.service.ts`: um `AnkaaDesign.ipa`/`.apk` por plataforma) + OTA Shorebird (`shorebird.yaml`, `SHOREBIRD_DEPLOY.md`) | OTA Expo em `GET /updates/manifest` (`api/src/modules/system/update/update.controller.ts:23,40`) ainda existe na API, mas ninguém publica |
| README | "essa migração acabou: o repositório `mobile/` não existe mais" (`mobile-flutter/README.md:3-4`) | — |

**Conclusão [FATO+INF]:** RN morto. Resíduo teórico: um aparelho que nunca instalou o Flutter ainda
rodaria o RN contra a API. Como verificar sem mexer em produção agora: procurar no log do nginx
requisições com cabeçalho `expo-platform` / `GET /updates/manifest` nos últimos 30 dias. Se houver,
esse aparelho quebra do mesmo jeito que o Flutter antigo (ver §4) e nunca vai receber conserto.

---

## 2. Arquitetura relevante do app Flutter (o que muda o jeito de fazer o rework)

| Tema | Como é | Onde |
|---|---|---|
| Modelos | `fromJson` manual, campos anuláveis, cast defensivo (`j['truck'] is Map ? … : null`) | `lib/data/models/task.dart:140-262,468-486` |
| Codegen | **nenhum** — sem `build_runner`, sem `*.g.dart` (`grep` no `pubspec.yaml` e `find` = 0) | — |
| Rede | Dio; params estilo Prisma (`include`/`where`/`orderBy`) serializados por `QueryEncoder` | `lib/core/network/query_encoder.dart`, `lib/data/repositories/entity_repository.dart` |
| Cache | só em memória (TTL 5 min, 100 entradas) — **não persiste resposta de API** | `lib/core/network/entity_cache.dart` |
| Persistência local | Hive: `form_drafts` (rascunhos de formulário) e outbox de check-in; `shared_preferences` + `Preferences.tableConfigsMobile/detailConfigsMobile` no servidor (ids de coluna/seção) | `lib/main.dart:81-85`, `lib/features/form/form_draft_store.dart`, `lib/features/list/layout_prefs.dart:206-217` |
| Erros | a mensagem do servidor vira toast (`ApiException` garimpa `message`/`response.message`) — **um 400/426 com texto "atualize o app" aparece para o usuário** | `lib/core/network/api_exception.dart:68-75,121-160` |
| Atualização | Shorebird: checa só no launch, "Agora não" permitido; aviso de binário novo via `GET /install/version`, adiável ("snooze") e só informativo | `lib/features/updates/ota_update_service.dart:55-130`, `native_update_service.dart:1-30,118-135` |
| Versão enviada à API | **nenhuma** (só `Authorization` e `X-Request-ID`; `lib/core/network/dio_client.dart:164-169`). `DeviceToken` no banco não guarda versão (`api/prisma/schema.prisma:3010-3025`) | — |

Regra operacional (do README e da memória): **nunca `dart format` global** (reformata 211 arquivos).
Formatar SÓ os arquivos tocados (`dart format <arquivo>`), e `flutter analyze` ao final.

---

## 3. Inventário por arquivo (o que faz hoje → o que muda)

Legenda de R: R1 layout sai do orçamento · R2 arte no implemento · R3 rename · R4 tipo/categoria ·
R5 frente + porta traseira · R6 projeto tarefa × implemento.

### 3.1 Camada de modelo / parse (os 3 únicos pontos que leem o veículo do JSON)

| Arquivo:linha | Hoje | Muda | R |
|---|---|---|---|
| `lib/data/models/task.dart:135-262` | `class Truck` (id, plate, chassisNumber, vinPlateId/vinPlateRaw, `category`, `implementType`, `spot`, taskId, left/right/backSideMeasure crus + larguras achatadas, `bodyLength`, `implementDimensions`) | Vira `Implement`. Parse **tolerante**: `j['implement'] ?? j['truck']`; `type ?? implementType` (se o campo for renomeado — ver D4). Acrescenta `frontSideMeasureRaw`, config de porta traseira, `layouts` (arte) e `projectFiles` (projeto do furgão) do implemento. `spot` depende de D6 | R2 R3 R4 R5 R6 |
| `task.dart:266-270, 298-367, 468-486` | `Task.truck`, `Task.layouts` (Layout+File crus), `Task.projectFiles` | `Task.implement`; `Task.layouts` deixa de existir como arte; o PDF cotado vira o **projeto da tarefa** (nome do campo depende da API — ver D2) | R2 R3 R6 |
| `task.dart:388,398` | `identifier => serialNumber ?? truck?.plate` | idem sobre `implement` | R3 |
| `lib/features/financial/budget.dart:137-243` | `BudgetVehicle`-like: `truckPlate/truckChassis/truckCategory/truckImplementType` lidos de `j['truck']`; `layouts` = pool de arte da tarefa (203-207, 243) | parse `implement ?? truck`; renomear getters; **apagar `layouts` do veículo** (só servia para o pool do "layout aprovado") | R1 R3 R4 |
| `budget.dart:584, 643-646, 1141` | `Budget.layoutFiles` (arte aprovada do orçamento) | **apagar** | R1 |
| `budget.dart:1148-1200` `kBudgetDetailInclude` | `tasks.include.truck`, `task.include.{truck, layouts:{include:{file}}}`, `layoutFiles: true`, `customerConfigs.include.responsible` (já morto na API) | `implement` no lugar de `truck`; tirar `layouts`, `layoutFiles` e `responsible` | R1 R3 |
| `budget.dart:1349-1373` `updateFields` (doc) | cita `layoutFileIds` | limpar doc | R1 |
| `lib/features/financial/billing_task.dart:17,29,38,42,119-120` | `truckPlate` de `j['truck']` | parse tolerante + rename | R3 |

### 3.2 Includes / where enviados à API (onde mora o 400/403/500)

| Arquivo:linha | Envia hoje | Risco se a API mudar sem alias | Muda |
|---|---|---|---|
| `lib/features/production/task_detail_config.dart:61-107,199` `buildTaskDetailInclude` | `truck:{include:{vinPlate, left/right/backSideMeasure{sections[,photo]}}}` (ou `true`), `layouts:{include:{file}}`, `projectFiles:true` | top-level do `taskIncludeSchema` é `.partial()` **sem** `.strict()` (`api/src/schemas/task.ts:1122-1150`) → chave removida do zod = **descartada em silêncio**; chave mantida no zod mas fora da whitelist = **403** (`include-access-control.ts:336-341`, chamada em `task.controller.ts:128,691`); chave mantida no zod e fora do Prisma = **500** | `implement:{include:{vinPlate, front/left/right/backSideMeasure…, layouts, projectFiles}}`; projeto da tarefa no nível da tarefa |
| `lib/features/production/tasks_list_config.dart:108-123` | `truck:{include:{left/rightSideMeasure{sections}}}` (coluna MEDIDAS) | idem → lista sem placa e sem medidas | `implement` |
| `lib/features/garages/garage_screen.dart:196-232` | `where:{truck:{isNot:null}, OR:[{truck:{spot:{not:null}}},…]}` + include `truck` | `taskWhereSchema` É `.strict()` (`task.ts:1347,1387`) → **400: tela Garagens morre** | `where` sobre `implement` (ou `spot` na tarefa — D6) |
| `lib/features/garages/truck_detail_sheet.dart:80-105` | include `truck{vinPlate, left/right…}`, `layouts{file}` | silêncio/403/500 como acima | `implement` + arte do implemento |
| `lib/features/production/task_edit_screen.dart:150-165` | include `truck:{include:{vinPlate}}`, `layouts` | idem | idem |
| `lib/features/production/implement_measure_editor.dart:230-250` | include `truck{left/right/back{sections,photo}}` | idem | + `frontSideMeasure` |
| `lib/features/financial/budget/budget_form_screen.dart:718-790` | `tasks.include.{customer,truck}`; task por id com `truck{vinPlate}` + `layouts` | budget: zod enumerado não-strict (`api/src/schemas/budget.ts:108-144`) → silêncio; task: ver acima | `implement`, sem `layouts` |
| `lib/features/financial/budget_list_config.dart:113-123` | `tasks.include.{customer,truck}` | silêncio (budget) | `implement` |
| `lib/features/production_extra/airbrushing_detail_config.dart:58-68` e `airbrushing_form_screen.dart:208-216` | `task.include.{customer,sector,truck}` | `airbrushingIncludeSchema` enumera `truck` (`api/src/schemas/airbrushing.ts:60-63`) → silêncio ou 500 conforme o zod | `implement` |
| `lib/features/production_extra/observation_form_screen.dart:126-133` | `task.include.{customer,truck}` | `observation.ts:66` | `implement` |
| `lib/features/personnel/bonus_detail_config.dart:27-29`, `lib/features/personal/my_bonus_data.dart:77-79` | `tasks.include.{customer,sector,truck}` | `bonus.ts:56` | `implement` |
| `lib/features/dashboard/widgets/tasks_widget.dart:407-442` | `where:{layouts:{none:{}}}` / `{some:{}}` ("Sem Layouts", "Com Layouts", "Aguardando Plotagem") | `where` strict → **400** se `layouts` sair de `taskWhereSchema` (`task.ts:1319`) | redefinir os 3 widgets: "sem arte aprovada" (implemento) e "sem projeto" (tarefa) — [DECISÃO D8] |
| `lib/features/production/task_row_actions.dart:358-366` | `include:{layouts:true}` para semear o modal | silêncio/403/500 | depende de D2 |

### 3.3 Escritas (onde mora o 200-que-não-gravou)

| Arquivo:linha | Payload hoje | Se a API trocar sem alias | Muda |
|---|---|---|---|
| `implement_measure_editor.dart:38-44, 698-735` | `PUT /tasks/:id {truck:{left/right/backSideMeasure:{id?,height(m),sections[{width,isDoor,doorHeight,position}],photoId?}}}` | **200 e nada gravado**; toast "Medidas salvas" | `implement:{…, frontSideMeasure, rearDoor…}` — ou endpoint próprio do implemento (D1) |
| `implement_measure_editor.dart:550-575` | upload da foto da traseira `POST /files/upload?entityType=truck` | 400 se `entityType` validado e renomeado [INF — não verifiquei a validação] | `entityType=implement` (API aceitar os dois) |
| `task_detail_config.dart:591-600, 627-635, 684-689, 705-710` | edição inline: `{truck:{plate}}`, `{truck:{chassisNumber}}`, `{truck:{category}}`, `{truck:{implementType}}` | **200 e nada gravado** | `implement:{…}` |
| `task_edit_screen.dart:627-667` | `data['truck'] = {plate, chassisNumber, vinPlateId, category, implementType}` (só o que mudou) | 200 silencioso | idem |
| `task_edit_screen.dart:678-695` | `layoutIds` + `layoutStatuses` (conjunto COMPLETO) | se a API remover os campos: **200 silencioso**; se reinterpretar: arte vira projeto ou vice-versa | separar: arte → implemento; PDF → projeto da tarefa (D2) |
| `lib/features/production/task_form_screen.dart:432-472` | criação: `layoutIds`, `layoutStatuses`, `baseFileIds`, `truck:{plate,chassisNumber,vinPlateId,category,implementType}` | tarefa nasce sem placa/categoria, 200 | `implement:{…}` |
| `task_form_screen.dart:930-935`, `task_edit_screen.dart:1230-1235`, `budget_form_screen.dart:2725-2731` | upload da plaqueta com `fileContext:'truckVinPlate'`, `entityType:'truck'` | o contexto é mapeado em `file-reference.service.ts:107` e `file-organization-scheduler.service.ts:66` | aceitar `implementVinPlate` E `truckVinPlate` |
| `lib/features/financial/budget/budget_form_screen.dart:1932-1990` | `POST /tasks/batch-with-quote {tasks:[{…layoutIds, layoutStatuses, truck:{…}}], quote:{…layoutFileIds}}` | tarefas sem veículo, 200 | `implement`; **sem** `layoutFileIds` |
| `budget_form_screen.dart:2100-2135` | `PUT /tasks/:id {layoutIds, layoutStatuses, baseFileIds, truck}` | idem | idem |
| `budget_form_screen.dart:2160-2250` | `PUT /budgets/:id {layoutFileIds}` | `budgetUpdateSchema` não-strict (`budget.ts:1109,1177`) → descartado em silêncio (inofensivo depois de R1) | **apagar** |
| `lib/features/financial/budget_sections.dart:2460-2490` | `updateFields(... {'layoutFileIds': ids})` | idem | **apagar** |
| `lib/features/financial/billing_covered_vehicles.dart:120-160` | `PUT /tasks/:id {truck:{plate|chassisNumber}}` (grade "Veículos desta cobrança") | 200 silencioso | `implement` |
| `lib/features/production/task_row_actions.dart:346-396` | "Adicionar Layout Referência": `PUT /tasks/:id {layoutIds, layoutStatuses}` | 200 silencioso | depende de D2 |
| `lib/features/garages/garage_edit_controller.dart:214-240` | `POST /trucks/batch-update-spots {updates:[{truckId, spot}]}` (`api/src/modules/production/truck/truck.controller.ts:155`) | **404** se o controller for renomeado; toast "Não foi possível salvar" | endpoint novo + alias (D6) |
| `lib/features/production/layout_attach_sheet.dart:92-110` | `GET /files/suggestions?fileContext=tasksLayouts&customerId=…` | `file.controller.ts:313-320` valida a lista FECHADA `tasksLayouts|taskBaseFiles|taskProjectFiles|airbrushingLayouts` → **400** se renomear (toast suprimido; a seção "Reutilizar" some) | contexto da arte do implemento; manter o antigo como alias |
| `lib/features/files/layout/layout_dimensions_repository.dart:19-67` | `GET /layout-dimensions/:fileId?truckId=…&page=` (cotador) | `layout-dimensions.controller.ts:62-70` exige `truckId` → **400: cotador morre** | `implementId` (API aceita os dois) |
| `lib/features/financial/budget_suggestion.dart:169-178` | `GET /budgets/suggest?category&implementType` | se o param for renomeado: sugestão some | `type` se D4 renomear |

### 3.4 Telas e componentes (UI)

| Tela / componente | Arquivo:linha | Hoje | Muda | R |
|---|---|---|---|---|
| Detalhe da tarefa — Informações | `task_detail_config.dart:560-725` | Placa, Chassi, Plaqueta (foto), Categoria, "Implemento" (= `implementType`), Local (`spot`) | vira bloco "Implemento" com Tipo + Categoria; rótulos; gates (`canViewTruckDetails` → `canViewImplementDetails`) | R3 R4 |
| Detalhe — Medidas do Implemento | `task_detail_config.dart:891-900`, `implement_measure_preview.dart` (678 l.) | lados Motorista/Sapo/Traseira; foto só na traseira | + **Frente**; traseira desenha bipartida/tripartida, varões, portinholas | R5 |
| Detalhe — Layouts (artes) | `task_detail_config.dart:973-985`, `task_detail_widgets.dart:17-160` (`layoutGalleryRows`, `LayoutGallery`) | uma galeria com imagem (arte) + PDF (cotado, banner "AGUARDANDO INICIAR TAREFA", cotador); ADMIN/COMERCIAL veem tudo, resto só APPROVED | **duas** seções: "Arte" (do implemento, status aprovado pelos responsáveis) e "Projeto da tarefa" (PDF, com cotador e o banner) | R2 R6 |
| Detalhe — Projetos | `task_detail_config.dart:277-285`, gate `task_permissions.dart:344` | `task.projectFiles` (≈4 arquivos no banco, pelo ADR 0121) | vira "Projeto do implemento" (furgão); o que era "projeto" na tarefa vira o PDF cotado — atenção à colisão de nome (D2) | R6 |
| Criar tarefa | `task_form_screen.dart` (≈1.000 l.) — campos `category`/`implementType` 230-330, Layout 240-268, payload 397-472 | categoria/tipo/layout no formulário da tarefa | campos do implemento; "Layout Referência" vira "Projeto da tarefa" (PDF) e a arte vai para o implemento | R2 R4 R6 |
| Editar tarefa | `task_edit_screen.dart` (≈1.300 l.) — 50-52 doc, 107-108, 150-165, 217-360, 422-590 rascunho, 627-720 payload, 963-980 campos, 1038-1040 card "Layout Referência", 1206-1270 | idem | idem | R2 R4 R6 |
| Editor de medidas | `implement_measure_editor.dart` (1.352 l.) — `_Side {left,right,back}` 55-67, rascunho 151-222, `_buildSides` 270-316, `_sidePayload` 624-643, validação 647-690, save 698-735 | 3 lados; altura 100-400 cm; foto só da traseira | + `front`; na traseira: tipo de porta (2 ou 3 folhas), varões (2/3/4), portinholas (N). Validação nova (ex.: nº de portas coerente com bi/tripartida). Rota continua por `taskId` ou passa a `implementId` (D1) | R5 |
| Orçamento — wizard | `budget_form_screen.dart` — card "Layout Aprovados" 3543-3760, resumo "Layout" 5296-5390, estado `_approvedLayoutIds` 295/424/581-590, recarga `layoutFiles` 1238-1300, casamento 1417-1430, `layoutFileIds` 1976/2244, "Layout Referência" no passo Tarefa 2940-2961, `_canManageTaskLayouts` 637-645 | seleção de até 2 artes aprovadas; sobe arte "já aprovada" | **apagar** tudo de layout aprovado; decidir se o wizard ainda mexe na arte (D3). Categoria/tipo (`_category`, `_implementType` default `'REFRIGERATED'` 206-207, 2550-2632, 5082-5119) viram campos do implemento | R1 R4 |
| Orçamento — detalhe | `budget_sections.dart:344-351` (seção `layouts`), `2414-2640` (`BudgetLayoutSection`) | seção "Layout aprovado" com seletor | **apagar** a seção; limpar a chave de layout de seções (o comentário em 142 lembra que mudar seções exige *bump* da chave de layout salva) | R1 |
| Faturamento — veículos / aprovação / NFS-e | `billing_covered_vehicles.dart:89-160`, `billing_approval_sheet.dart:138,198-210,550`, `nfse_discriminacao.dart:49-80` (rótulos DA NOTA: Isotérmico, Prancha/Plataforma), `order_numbers_sheet.dart:213`, `billing.dart:108` | lê `truck*` do veículo | rename de getters; **não unificar** os mapas de rótulo da nota com os da tela (divergem de propósito) | R3 R4 |
| Garagens | `garage_screen.dart` (1.644 l.), `garage_model.dart:84-130,263-335`, `garage_edit_controller.dart:200-240`, `truck_detail_sheet.dart` (671 l.) | "caminhão" na garagem = veículo físico; comprimento vem das laterais | só o fio (where/include/endpoint). **Recomendo NÃO renomear `GarageTruck`/`garage_geometry.dart`** (226 ocorrências de "truck" que falam do veículo na vaga, não do implemento) | R3 (D6) |
| Cronograma/Agenda/Histórico | `tasks_list_config.dart:114,465-486`, `task_schedule_view.dart:77-87,470` | coluna MEDIDAS e busca local pela placa | rename | R3 |
| Visualizador / cotador | `file_viewer_screen.dart:42,78-105,156,206-340,1353-1410`; `file_gallery.dart:154-211,427-469` | `layoutTruckId` liga o cotador a PDF | `layoutImplementId`; cotador só no **projeto da tarefa** | R3 R6 |
| Modal "Adicionar layout" | `layout_attach_sheet.dart:19-180` + `task_form_fields.dart:649-815` (`TaskLayoutField`, `LayoutAttachment`, `kLayoutStatusLabels`) | anexa arte/PDF na tarefa com status | reusar o widget para os DOIS destinos (arte do implemento; projeto da tarefa). Nota: `kLayoutStatusLabels` está **duplicado** em `task_enums.dart:54` e `task_form_fields.dart:652` | R2 R6 |
| Permissões | `task_permissions.dart:403-431` (`canViewTruckDetails`, `canViewLayouts`, `canViewLayoutBadges`, `canApproveLayouts`, `canSetLayoutStatus`), `502-507` (`canAddLayouts`); `implement_measure_preview.dart:26-43` (`canViewImplementMeasure`, `canEditImplementMeasure`); cotador `file_viewer_screen.dart:1353-1361` | comercial/admin aprovam arte na tarefa | se quem aprova é o responsável (R2), `canSetLayoutStatus` vira "aprovar em nome do cliente" ou some (D5) | R2 |
| Aerografia | `airbrushing.dart:13-146`, `airbrushing_detail_config.dart:17-36,455-490`, `airbrushing_form_screen.dart:183-510,1020`, `airbrushing_list_config.dart:55,534-539` | a aerografia tem layouts PRÓPRIOS (`Layout.airbrushingId`) e abre o cotador com `a.task?.truck?.id` (488) | manter os layouts da aerografia (D7); trocar o id do cotador | R3 |
| Atenção (piscar/bipar) | `attention_rules.dart:170-232` (R3a/R3b/R3c: `truck.chassisNumber`, `truck.plate`, `truck.vinPlateId`), `task_schedule_view.dart:77-87` (snapshot), `attention_types.dart:29,64` (`'TRUCK'`, `'/trucks'`) | caminhos pontilhados | `implement.*`; entidade `IMPLEMENT` no socket — a API precisa aceitar `TRUCK` na janela (`api/src/schemas/attention.ts:22-38` é `z.enum` fechado) | R3 |
| Changelog | `changelog_labels.dart:283-317` | rótulos "Caminhão", "Categoria do Caminhão", "Tipo de Implemento" | acrescentar os novos campos; **manter** os antigos (linhas históricas continuam no banco) | R3 R4 R5 |
| Assinatura | `signature/budget_change.dart:41-53` (grupo `'LAYOUT'`) | diff de orçamento vindo do servidor | **manter** o rótulo — snapshots históricos continuam trazendo o grupo LAYOUT | R1 |
| Tutorial | `tutorial_fixtures.dart:28-116`, `scenes/scene_task_detail.dart`, `steps/steps_task_detail.dart` | dados falsos com `truckCategory`, layouts | atualizar dados falsos | — |
| Código morto | `lib/features/production/budget_report_pdf_generator.dart` (`generateBudgetReportPdf` sem chamador: `grep` fora do arquivo = 0) e `lib/shared/pdf/pdf_layout_rasterizer.dart` | lê `truckCategory`/`layoutImageBytes` | **apagar** em vez de migrar | — |
| Rotas | `production_routes.dart:19-47,66-94` (`/producao/{cronograma,agenda}/medidas/:id` → `TruckMeasuresEditorScreen(taskId)`), `menu_lookup.dart:179` | só links internos (nenhum link da API/web aponta para `/medidas/`) | pode manter o caminho; renomear a classe | R3 |

### 3.5 Estado local persistido que carrega nomes antigos

| O quê | Onde | Efeito do rework | Recomendação |
|---|---|---|---|
| Rascunho "nova tarefa" | Hive `form_drafts`, chave `task:new`, campos `category`, `implementType`, `layouts` (`task_form_screen.dart:209-330`) | rascunho antigo restaura "layouts" que agora significam outra coisa | trocar a chave (`task:new:v2`) — `FormDraftStore._schema` é global (`form_draft_store.dart:14`), não serve para um form só |
| Rascunho "editar tarefa" | `task:<id>` (`task_edit_screen.dart:396, 422-590`) | idem | idem (`task:v2:<id>`) |
| Rascunho do orçamento | `budget_form_screen.dart:424-440, 538-615` (`approvedLayoutIds`, `layouts`) | chaves mortas | ignorar/limpar na leitura |
| Rascunho de medidas | `truck-measures:<taskId>` (`implement_measure_editor.dart:151-222`) | sem `front`/porta | leitura tolerante já existe; se a chave passar a `implementId`, os rascunhos antigos só expiram |
| Layout de seções do detalhe | `Preferences.detailConfigsMobile` no SERVIDOR (ids `implementMeasure`, `layouts`, `projectFiles`) | renomear id = o usuário perde ordem/ocultação daquela seção [INF: não conferi como id desconhecido é tratado] | manter ids estáveis, ou mapa de migração de ids como o do dashboard (`dashboard_controller.dart:22-27`) |
| Outbox de check-in | Hive, `PUT /tasks/:id` com fotos (`checkin_outbox.dart:167,343`) | não carrega `truck` | nada |

### 3.6 Testes (`test/`, 73 arquivos)

| Arquivo | Por quê |
|---|---|
| `test/task_detail_include_test.dart` | espelha à mão a whitelist `INCLUDE_WHITELIST.Task` (`truck`, `layouts`, `projectFiles`) — **tem de mudar junto com a API**; é o único guarda-chuva contra o 403 |
| `test/features/production/implement_measure_test.dart` | geometria/parse das faces (+frente, +porta) |
| `test/features/garages/garage_geometry_test.dart`, `garage_screen_test.dart` | fixtures com `truck` |
| `test/core/attention/attention_engine_test.dart`, `test/features/attention_surfaces_test.dart` | caminhos `truck.*` |
| `test/features/financial/covered_vehicles_test.dart`, `billing_approval_blockers_test.dart`, `billing_row_test.dart`, `nfse_discriminacao_test.dart`, `budget_suggestion_test.dart` | veículo do orçamento, rótulos da nota, sugestão por categoria/tipo |
| `test/features/navigation/menu_gates_test.dart`, `test/shared/pdf/document_money_encoding_test.dart` | referências menores |

**Teste que falta e eu escreveria primeiro:** um teste de contrato por JSON gravado (fixture) que
alimenta `Task.fromJson` com os DOIS formatos (`truck` e `implement`) e exige o mesmo resultado —
é o que garante a janela de compatibilidade do lado do app.

---

## 4. O que acontece com o app JÁ INSTALADO (1.4.1+24 e patches) — matriz

Premissa: a API faz o rework **sem** camada de compatibilidade.

| Ação no app antigo | Mecanismo na API | Resultado | Gravidade |
|---|---|---|---|
| Abrir Cronograma/Agenda/Histórico | include `truck` descartado pelo zod | lista sem placa (identificador cai no nº de série), MEDIDAS "-" | média, silenciosa |
| Idem, se o zod mantiver `truck` e a whitelist não | `validateIncludes` → **403** | **nenhuma lista/detalhe de tarefa abre** | crítica |
| Idem, se o zod mantiver `truck` e o Prisma não tiver a relação | include vai direto ao Prisma → **500** | idem | crítica |
| Detalhe da tarefa | `truck`/`layouts` somem | sem placa/chassi/categoria/medidas; **galeria de layouts vazia → produção sem arte e sem PDF cotado no celular** | **crítica operacional** |
| Salvar medidas | `PUT {truck:{…}}`, update não-strict | **200 + "Medidas salvas" + nada gravado** | **crítica (perda de dado silenciosa)** |
| Editar placa/chassi/categoria/tipo; criar tarefa; orçamento criando N tarefas; grade de veículos da cobrança | idem | 200 e perda silenciosa | crítica |
| Anexar layout (tarefa/cronograma) | `layoutIds` removido do schema | 200 e perda silenciosa | alta |
| Garagens (abrir) | `where.truck` em schema strict | **400** — tela morta | alta |
| Garagens (salvar vagas) | `/trucks/batch-update-spots` inexistente | 404, toast | alta |
| Cotador (abrir PDF) | `?truckId` obrigatório | 400 — ferramenta some/erro | média |
| Dashboard "Sem/Com Layouts", "Aguardando Plotagem" | `where.layouts` strict | 400 no widget | baixa |
| Orçamento: seleção de layout aprovado | `layoutFileIds`/`layoutFiles` descartados | card vazio, seleção não persiste (inofensivo pós-R1, mas confuso) | baixa |
| Presença/atenção no socket com `TRUCK` | `attentionEntityTypeSchema` fechado | evento rejeitado | baixa |
| Unidade (se o banco passar a CENTÍMETRO como no monorepo) | app antigo manda METRO (`implement_measure_editor.dart:624-643`: `heightCm/100`) | **valor 100× menor gravado sem erro** | **crítica** — ver D9 |

**Cobertura do Shorebird [FATO+INF]:** o rework no app é Dart puro → cabe em *patch* sobre
1.4.1+24, sem reinstalar. Limites: (a) o usuário pode dizer "Agora não", e o patch só é checado no
launch (`ota_update_service.dart:55-65,102-115`) — um celular que fica dias aberto continua no
código antigo; (b) glifo de ícone novo, plugin novo ou asset novo exigem **release** (reinstalação
manual via `/install`; no iOS ad-hoc depende da lista de UDIDs — `README.md` "Aparelho novo na lista
ad-hoc"); (c) aparelhos que nunca instalaram ≥1.2.1+17 nem recebem o aviso de binário novo (o aviso
nasceu em `c5cd5be`, 28/07).

**Mecanismo de versão mínima [FATO]: não existe.** Nem cabeçalho de versão, nem 426, nem registro
de versão por aparelho.

---

## 5. Ordem de lançamento proposta

A regra: **nenhum passo da API pode depender de o usuário ter atualizado o app**, e nenhuma remoção
de alias acontece sem telemetria dizendo que ninguém mais usa o formato antigo.

| Passo | Onde | O quê | Por quê |
|---|---|---|---|
| **P0 — agora, antes do rework** | app, **patch OTA** | (1) cabeçalho `X-App-Version: 1.4.1+24` e `X-App-Patch: <n>` (o `shorebird_code_push` informa o patch) em todo request (`dio_client.dart:160-170`); (2) interceptor: **426** → tela bloqueante "Atualize o app" com botão que força `checkForUpdate` + `/install`; (3) parse tolerante `implement ?? truck` nos 3 pontos de §3.1; (4) parar de pedir `customerConfigs.include.responsible`. Sem ícone novo. | cria o portão que hoje não existe e deixa o app pronto para ler os dois formatos |
| P0' | API | logar `X-App-Version` por usuário (ou gravar em `DeviceToken`) | saber quando o parque inteiro está no P0 |
| **P1 — API com alias** | API | migration Truck→Implement + camada de compat **explícita e testada**: (a) include/where/select aceitam `truck` e traduzem para `implement`, e a resposta devolve **também** a chave `truck` quando a requisição pediu `truck`; (b) create/update/batch aceitam `truck:{…}` e normalizam (z.preprocess) — incluindo `implementType`→`type` se D4 renomear; (c) `/trucks/batch-update-spots`, `/layout-dimensions?truckId=`, `fileContext=tasksLayouts/truckVinPlate`, `entityType=truck`, socket `TRUCK` continuam aceitos; (d) `task.layouts` **sintetizado** na leitura (arte do implemento + PDFs do projeto da tarefa, mesmo formato achatado de hoje) para o chão de fábrica não ficar cego; (e) escrita legada de `layoutIds` na tarefa → **recusar com 400 e mensagem "Atualize o app para anexar arte/projeto"** (o app mostra a mensagem do servidor em toast) — melhor que adivinhar se é arte ou PDF; (f) cada uso de alias gera log com a versão do app | o app antigo segue funcionando para ler e para as escritas que têm tradução inequívoca; as ambíguas falham ALTO |
| P1' | API | whitelist `INCLUDE_WHITELIST.Task`, zod de include de Task/Budget/Airbrushing/Observation/Bonus e Prisma mudam **no mesmo commit**, com teste que percorre as três listas e exige igualdade (o 403/500 nasce da divergência entre elas) | fecha a classe "schema/include/type desatualizado" |
| **P2 — app novo** | app, patch OTA (ou release se entrar ícone/asset) | fala `implement`; frente + porta traseira; arte no implemento; projeto da tarefa com cotador; remove layout aprovado do orçamento; testes de contrato com fixtures dos dois formatos | — |
| **P3 — portão** | API | `MIN_MOBILE_VERSION = P2` → requests de versão menor recebem 426 (P0 já sabe mostrar); request **sem** cabeçalho (pré-P0) também recebe 426 — a mensagem do corpo aparece no toast do app antigo | força a convergência |
| **P4 — remover alias** | API | só quando o log de alias ficar zerado por N dias | evita remover em cima de alguém |

Regras de deploy herdadas: builde ANTES de migrar; `systemctl`, não `pm2`; e o P1 precisa de ensaio
da migration contra cópia do banco (o snapshot de assinatura com `layoutFileIds` tem de continuar
renderizando — isso é do recorte da API, mas o app lê o diff via `budget_change.dart`, então o grupo
`LAYOUT` continua existindo em histórico).

---

## 6. Decisões que só o dono toma (com minha recomendação)

| # | Pergunta | Recomendação | Por quê (impacto no app) |
|---|---|---|---|
| D1 | O implemento continua **1:1 com a tarefa** (como `Truck.taskId @unique` hoje, `api/prisma/schema.prisma:2537`) ou vira entidade reutilizável 1:N (como o `Implement` do monorepo, `46-production.prisma:326-366`, com `tasks Task[]` e dono `customerId`)? | 1:N é o que R7 pede (o implemento é da Furgões/cliente e volta em outras tarefas), mas é outro projeto. Para o app: **editar o implemento por rota própria** (`/implements/:id`), não pelo `PUT /tasks/:id {truck}` | define se o editor de medidas e os campos continuam dentro do formulário da tarefa |
| D2 | Nomes na API: "projeto da tarefa" = o PDF cotado. O campo `Task.projectFiles` já existe com ≈4 arquivos e **outro** significado (projeto). Reusar o nome ou criar outro? | **Não reusar** `projectFiles` para o PDF cotado: criar nome novo (ex. `stickerPlanFiles`/`executionPlan`) e mover os 4 atuais para `Implement.projectFiles`. Reusar o nome com semântica nova é exatamente o dado que "some sem erro" | o app antigo leria o PDF cotado na seção "PROJETOS" e o projeto do furgão sumiria |
| D3 | O wizard de orçamento do app continua mexendo em arte? | Não. Orçamento sem arte (R1); a arte é anexada no implemento e aprovada no portal | apaga ~400 linhas em `budget_form_screen.dart` e `budget_sections.dart` |
| D4 | Renomear `implementType`→`type` no fio? | Sim no modelo novo, **com alias de escrita** na janela; valores do enum iguais (`DRY_CARGO`…) para não mexer nos mapas de rótulo (`task_enums.dart:104-128`, `nfse_discriminacao.dart:58-80`) | rótulos da nota ≠ rótulos da tela (Isoplastic×Isotérmico) — manter os dois mapas |
| D5 | Com a aprovação da arte no portal, o comercial/admin ainda aprova "em nome do cliente" pelo app? | Sim, como ação explícita e registrada (quem/quando), não como seletor de status solto | hoje `canSetLayoutStatus` (`task_permissions.dart:428-431`) deixa ADMIN/COMERCIAL pôr APROVADO em 1 toque |
| D6 | `spot` (vaga na garagem) fica no implemento ou na tarefa? | **Na tarefa** se D1 = 1:N (é estado operacional da Ankaa naquela visita); pode ficar no implemento se D1 = 1:1 | muda `where` da Garagens e o endpoint `batch-update-spots` |
| D7 | Os layouts da **aerografia** (`Layout.airbrushingId`) seguem na aerografia? | Sim — é arte do serviço da Ankaa, não do implemento | evita mexer no fluxo dos aerografistas |
| D8 | Os widgets "Sem Layouts"/"Com Layouts"/"Aguardando Plotagem" do dashboard medem o quê depois? | "sem arte aprovada" (implemento) e "sem projeto da tarefa" | hoje `where.layouts` → 400 quando `layouts` sair |
| D9 | Unidade das medidas no banco continua METRO? | **Continuar METRO neste rework.** Se mudar para cm, mudar também o NOME do campo (`heightCm`, `widthCm`) para o payload antigo falhar alto em vez de gravar 100× menor | o app manda metro (`implement_measure_editor.dart:624-643`), o portal manda cm e converte (`medidaParaPrisma /100`) |
| D10 | O projeto da tarefa (PDF) tem status? Hoje o PDF está no `Layout` e produção só vê APROVADO (`task_detail_widgets.dart:32-49`, `task_permissions.dart:425-426`) | Dar um estado mínimo (RASCUNHO/PRONTO) ao projeto da tarefa e mostrar à produção só PRONTO | sem isso, produção passa a ver PDF em rascunho no celular |
| D11 | Frente tem foto (como a traseira)? Porta traseira: portinholas é número livre ou 0..N limitado? | foto opcional nas duas; portinholas 0..4 | desenho do preview e validação do editor |

---

## 7. Tamanho estimado (app)

| Bloco | Arquivos | Telas | Esforço [INF] |
|---|---|---|---|
| Modelo/parse + includes/where | 14 (§3.1, §3.2) | — | baixo, mas é onde mora o risco |
| Detalhe/criar/editar tarefa, permissões | 6 (`task_detail_config`, `task_form_screen`, `task_edit_screen`, `task_detail_widgets`, `task_permissions`, `task_form_fields`) | 3 | médio |
| Medidas (frente + porta traseira) | 2 (`implement_measure_editor` 1.352 l., `implement_measure_preview` 678 l.) + 1 teste | 2 | **alto** (geometria e desenho novos) |
| Arte × projeto (galerias, modal, cotador) | 6 (`layout_attach_sheet`, `task_row_actions`, `file_viewer_screen`, `file_gallery`, `layout_dimensions_repository`, `task_detail_widgets`) | 3 | médio |
| Orçamento (R1 apaga) | 4 (`budget_form_screen`, `budget_sections`, `budget`, `budget_list_config`) | 2 | médio (mais remoção que escrita) |
| Faturamento/NFS-e (rename) | 6 (`billing_task`, `billing_covered_vehicles`, `billing_approval_sheet`, `nfse_discriminacao`, `order_numbers_sheet`, `billing`) | 2 | baixo |
| Garagens (só fio) | 4 (`garage_screen`, `garage_model`, `garage_edit_controller`, `truck_detail_sheet`) | 1 | baixo |
| Aerografia/observação/bônus (includes) | 6 | 4 | baixo |
| Atenção, changelog, dashboard, tutorial, rotas, sugestão | 10 | 1 | baixo |
| Código morto a apagar | 2 | — | trivial |
| Rede/versão (P0) | 2-3 (`dio_client`, interceptor, tela 426) | 1 | baixo |
| **Total** | **~45 em `lib/`** + **13 em `test/`** | **~16** | — |

---

## 8. Perguntas ao dono

1. D1: o implemento volta em outras tarefas (1:N, com dono = cliente) ou continua um por tarefa neste rework?
2. D2: o PDF de colagem ganha nome novo na API (recomendo) ou reusa `projectFiles`? E os ≈4 `projectFiles` atuais vão para o implemento?
3. D5: comercial/admin ainda podem aprovar arte em nome do cliente pelo app?
4. D6: a vaga na garagem é da tarefa ou do implemento?
5. D9: as medidas continuam em metro no banco?
6. D10/D11: o projeto da tarefa tem estado "pronto"? A frente tem foto? Portinholas vão de 0 a quanto?
7. Aceita o **P0** (patch OTA com versão no cabeçalho + tela de 426) **antes** de qualquer mudança na API? Sem ele não há como forçar atualização nem saber quem está atrás.
8. Pode verificar (ou autorizar alguém a verificar) no log do nginx se ainda chega `GET /updates/manifest` com `expo-platform` — se sim, há aparelho no app RN, que quebra sem conserto possível.
9. O trabalho da outra sessão (`feat/orcamento-veiculos`: layout por veículo no orçamento, medidas replicadas entre veículos do mesmo orçamento) morre com R1, ou a parte "medir um veículo mede os demais" (`api/src/utils/implement-measure-replication.ts`, 288 l.) deve sobreviver no implemento? O app hoje não sabe dela, mas o editor de medidas a dispararia.

## 9. Riscos

1. **Perda de dado silenciosa** (o pior): escrita com a chave antiga respondendo 200. Mitigação: alias de escrita testado no P1; escrita ambígua recusada com 400 e mensagem.
2. **403/500 em todas as telas de tarefa** se zod, whitelist e Prisma não mudarem juntos. Mitigação: um teste na API que cruza as três listas; `test/task_detail_include_test.dart` no app atualizado no mesmo PR.
3. **Chão de fábrica sem arte/PDF** no celular antigo. Mitigação: `task.layouts` sintetizado na janela.
4. **Patch que vira release** por causa de um ícone novo → reinstalação manual em todos os aparelhos (iOS ad-hoc). Mitigação: conferir o conjunto de glifos da release antes de usar ícone.
5. **Parque que não converge**: "Agora não" no Shorebird + checagem só no launch. Mitigação: P0 + P3 (426).
6. **Unidade**: mudar metro→cm sem renomear campo grava 100× menor em silêncio (D9).
7. **Ids de seção salvos no servidor** (`detailConfigsMobile`): renomear `layouts`/`implementMeasure`/`projectFiles` pode bagunçar a ordem/ocultação de cada usuário. Mitigação: ids estáveis ou mapa de migração.
8. **Rascunhos Hive** restaurando `layouts` com o significado antigo. Mitigação: trocar as chaves de rascunho.
9. **Rótulos da NF**: tentação de unificar `kImplementTypeLabels` com `kNfseImplementTypeLabels` no rename — mudaria o texto que vai para a prefeitura.
10. **`dart format` global** no PR: 211 arquivos reformatados, revisão impossível. Formatar só os tocados.
11. **Colisão com a outra sessão**: `feat/orcamento-veiculos` reescreve `sync-quote-task-layouts.ts` e cria `quote-layout-coverage.ts` (602 l.) — tudo isso é R1 na contramão; se for mergeado antes, o rework precisa desfazer mais.
