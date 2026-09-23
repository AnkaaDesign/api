# 11 — A série sai da tarefa e vai para o implemento: o que muda nos CLIENTES (web, portal e app)

> Recorte: mover `Task.serialNumber` para `Implement.serialNumber` (DD1, 23/09) em
> `web/` (branch `feat/portal-do-responsavel`, `989c9f6e`) e `mobile-flutter/`
> (`main`, `9335286`, versão instalada `1.4.1+24`, `pubspec.yaml:24`).
> Somente leitura. Banco consultado: clone local (dado real até ~30/06; a tabela
> `Preferences` vai até 16/09).
>
> Convenção: **FATO** = conferido no código ou no banco, com arquivo:linha.
> **INFERÊNCIA** = dedução minha, com o motivo. Rótulos de tela entre aspas.

---

## 0. Resumo em 12 linhas

1. A série aparece em **110 arquivos do web** (431 linhas com `serialNumber`, 4 deles testes) e em **31 do app** (23 em `lib/`, 8 em `test/`). **FATO** (`rg -c serialNumber`).
2. Metade disso **não precisa mudar**: são DTOs que o servidor já monta achatados (`identity.serialNumber` do portal, `taskSerialNumber` da conciliação, NFS-e e dashboard, `serialNumber` do resumo da Home, do plano de tinta e da assinatura). Nesses casos a chave fica e só a **fonte muda na API**.
3. A outra metade lê `task.serialNumber` **do objeto Prisma da tarefa**. Esse campo só chega porque o Prisma devolve todos os escalares quando o pedido usa `include`. Quando a coluna sair da `Task`, esses pontos passam a receber `undefined`, **sem erro**.
4. **No app instalado nada quebra no parse** (`j['serialNumber'] as String?` com a chave ausente dá `null`, `task.dart:438`). O sintoma é silencioso: o IDENTIFICADOR cai para a placa. No clone, **das 2.013 tarefas com série só ~34 têm placa**, então em ~98% das linhas a coluna fica "—".
5. O ponto que **pode derrubar uma tela inteira** é a ordenação. A Agenda do app manda sempre `orderBy[2].serialNumber.{sort,nulls}` (`task_schedule_view.dart:322-323`). Se a API repassar isso ao Prisma, dá 500 e a Agenda some. Se descartar, só perde o desempate. Três telas do web mandam o mesmo tipo de ordenação.
6. O ponto que **perde dado com 200** é a escrita. O app e o web gravam série **no topo** do corpo de `PUT /tasks` e `POST /tasks` (9 caminhos, §6). O `taskUpdateSchema` não é strict: se a chave sair do schema, a série digitada some com 200.
7. **Toda tarefa tem 1 implemento (DD1)**, mas hoje **nenhum cliente garante isso**. Os 6 caminhos de criação vivos omitem `truck` quando não há placa, chassi ou medida. `quick-budget` nem sabe o que é caminhão. Só a API pode garantir o implemento, porque o app instalado não vai mudar.
8. Há **contratos persistidos que citam a série**: 5 de 7 `dashboardLayoutWeb` (colunas e ordenações `serialNumber`), 3 de 3 `detailConfigsWeb` (campo `serialNumber`), 1 `tableConfigsMobile`, 4 `tableConfigsWeb` (`identificador`), 60 templates de notificação com `{{serialNumber}}`, a chave `task.field.serialNumber` e 37 preferências `task_serialNumber`. **Nenhum id de coluna ou campo deve mudar.**
9. O app **não manda cabeçalho de versão** hoje (`dio_client.dart:153-171` só põe `X-Request-ID` e `Authorization`). A API não tem como distinguir o app velho do novo antes do patch P02.
10. **Recomendação central (para a janela):** a API mantém `Task.serialNumber` como **coluna-sombra só de leitura**, sincronizada por gatilho a partir de `Implement.serialNumber`. As escritas no topo são traduzidas para o implemento. Isso cobre de uma vez select, include, orderBy, where, busca e SQL cru de **todos** os clientes velhos, sem uma camada de tradução por rota. A coluna cai no R-D.
11. Nos clientes novos: um helper único de leitura (`taskSerial(t)`), escrita em `implement.serialNumber` só quando a série muda, ordenação por `implement.serialNumber`, e **todo caminho de criação manda `implement`**.
12. Há três artefatos mortos que citam a série e devem ser apagados, não migrados (§8).

---

## 1. O dado (clone local)

| Medida | Valor | Consulta |
|---|---|---|
| Tarefas | 2.253 | `SELECT count(*) FROM "Task"` |
| Com série | 2.013 (nenhuma vazia `''`) | `count("serialNumber")` |
| Sem `Truck` | 1.678, **todas `COMPLETED`**; 1.567 delas têm série | `LEFT JOIN "Truck" ON "taskId"` por status |
| Com série e **sem placa** | COMPLETED 1.735 · PREPARATION 133 · WAITING 86 · CANCELLED 17 · IN_PRODUCTION 8 → **1.979 de 2.013** | idem |
| Séries **não numéricas** | 436 (`38142-2`, `37772-RETRAB`, `GGA7468`, chassi inteiro…) | `!~ '^[0-9]+$'` |
| Séries que **reprovam a regex do web** `^[A-Z0-9-]+$` | **42** (`'9A9SRCA4051DV8066 '` com espaço, `'CH- 014415'`, `'.'`, `'.-1'`…); maior tamanho: 18 | `!~ '^[A-Z0-9-]+$'` |
| Em voo, com entrada, com série e sem placa | 8 (é o universo que o R3b deixaria de proteger) | `status IN (PREP,WAIT,IN_PROD) AND entryDate NOT NULL` |
| `ChangeLog` TASK/`serialNumber` | 113 linhas | `GROUP BY entityType, field` |

**Consequência (INFERÊNCIA a partir desses números):** hoje a série é, na prática, **o** identificador do veículo, e a placa quase nunca existe. Tudo que hoje faz `serial || plate` vira "—" se a série sumir do lugar onde o cliente a procura.

### 1.1 Contratos persistidos que citam a série

| Onde | O que está gravado | Quem lê | Regra |
|---|---|---|---|
| `Preferences.dashboardLayoutWeb` (5 de 7 linhas) | `columns: [..."serialNumber"...]` e `sorts: [{key:"serialNumber"}]` (ex.: widget "Orçamentos Esperando Aprovação") | `web/src/dashboard/widgets/task-table.tsx:375,427,710,1321,3588`; ordenação em `:1612-1637` | id de coluna **fica** `serialNumber`; muda só o `render` e o `ORDER_BY_PATH_MAP` |
| `Preferences.detailConfigsWeb` (3 de 3) | `fieldOrder.overview` e `fieldVisibility` com `serialNumber`; `cut-detail.task` com `serialNumber` | `components/ui/detailpage/use-detail-layout.ts:187-245` (`mergeFieldOrder` descarta id desconhecido e acrescenta o novo, `:15-17`) | id do campo **fica** `serialNumber`. Mudar a seção (overview → Implemento) é seguro: a ordem se reacomoda e a visibilidade é por id |
| `Preferences.tableConfigsMobile` (1) | `production-agenda.order` com `serialNumber` e `identifier` | app, `lib/features/list/layout_prefs.dart` | chave **fica** |
| `Preferences.tableConfigsWeb` (4) | `columnOrder` com `identificador` (task-prep) | web DataTable | id **fica** `identificador` |
| `NotificationConfiguration` | `key`/`eventType` = `task.field.serialNumber`; **60** `templates` com `{{#if serialNumber}} #{{serialNumber}}` | servidor renderiza; o cliente só exibe o texto | a API precisa continuar emitindo **o mesmo evento** quando a série do implemento mudar, e continuar pondo `serialNumber` no contexto do template |
| `UserNotificationPreference.eventType` | **37** × `task_serialNumber` | idem | idem: o evento não pode mudar de nome |
| `Notification.metadata` | 1.523 com `serialNumber` (histórico) | central de notificações (só texto e link) | nada; é histórico |
| `ChangeLog` | 113 × TASK/`serialNumber` | `web/src/utils/changelog-fields.ts:320`; `app changelog_labels.dart:261` | rótulos **ficam** para o histórico; ver §5.9 |

---

## 2. Princípios para os clientes (recomendação)

| # | Princípio | Por quê |
|---|---|---|
| P1 | **Nenhum id de tela muda**: colunas `serialNumber`, `identificador`, `serialNumberOrPlate`, `taskSerialNumber`; campo de detalhe `serialNumber`; parâmetro de URL `serialNumber`; chaves do portal | Estão gravados em `Preferences` (§1.1) e em URLs; mudar o id apaga a preferência do usuário em silêncio |
| P2 | **DTO achatado pelo servidor mantém a chave** (`identity.serialNumber`, `taskSerialNumber`, `HomeDashboardTask.serialNumber`, `PaintPlanDetailTask.serialNumber`, `vehicles[].serialNumber` da assinatura) | O cliente não sabe de onde o servidor tira o valor. Muda só a fonte, na API |
| P3 | **Leitura por um helper só**: web `taskSerial(t) = t.implement?.serialNumber ?? t.serialNumber ?? null` (em `utils/task.ts`, ao lado de `formatTaskIdentifier`, `:190-194`); app lê no parse `(j['implement'] as Map?)?['serialNumber'] ?? j['serialNumber']` e mantém o getter `Task.serialNumber` | Tolerante aos dois formatos durante a janela. No app, **nenhum dos 60+ leitores muda**, só o `fromJson` |
| P4 | **Escrita em `implement.serialNumber`, e só quando a série mudou** | 42 séries legadas reprovam a regex do web (§1). Reenviar a série junto com cada mudança de placa daria 400 em edições que não tocam nela |
| P5 | **Ordenar por `{ implement: { serialNumber: { sort, nulls: 'last' } } }`** | Caminho de relação 1:1 que o Prisma ordena nativamente |
| P6 | **Toda criação manda `implement`** (nem que seja `{}` com a série), **e** a API cria o implemento quando o corpo não o traz | O app instalado e integrações antigas nunca vão mandar. Só o servidor fecha DD1 |
| P7 | **Rótulos ficam** ("Número de Série", "Nº Série", "Série"). Muda só o **bloco** onde a série aparece (junto de placa, chassi e plaqueta, no bloco Implemento) | DD5: palavra da NF só muda quando o dono escolher. "OS #" e "Ref. OS" são pergunta ao dono (§11) |

---

## 3. O app INSTALADO (1.4.1+24) quando a série sai do topo da `Task`

**FATO base:** não há codegen. Todo `fromJson` é manual e tolerante (`j['serialNumber'] as String?`), e todo pedido de tarefa usa `include`, nunca `select` de escalar da tarefa: o único `'select'` com tarefa é `customer_detail_config.dart:80` (`{'tasks': true}`). O app lê série de **4 modelos**: `Task` (`task.dart:438`), `BudgetTaskLite` (`budget.dart:220`), `BillingTask` (`billing_task.dart:112`) e, por derivação, `GarageTruck` (`garage_model.dart:361`, a partir de `Task`). As tarefas aninhadas em corte, aerografia, observação e bônus passam por `Task.fromJson` (`cut.dart:100`, `airbrushing.dart:144`, `observation.dart:40`, `bonus.dart:271`). O cache é **só em memória** (`core/network/entity_cache.dart:8-68`, TTL de 5 min). O Hive guarda só o outbox de check-in/out, que não carrega série (`checkin_outbox.dart:42,100,389`).

### 3.1 Cenário A: a API **não** espelha (a coluna some e nada é traduzido)

| Superfície | Arquivo:linha | O que acontece | Gravidade |
|---|---|---|---|
| Parse de `Task`/`BudgetTaskLite`/`BillingTask` | `task.dart:438`; `budget.dart:220`; `billing_task.dart:112` | chave ausente vira `null`. **Não lança.** (Lançaria `TypeError` se a API mandasse `serialNumber` como objeto: não fazer isso no espelho) | — |
| IDENTIFICADOR: Cronograma, Agenda, Histórico, seleção de tarefa | `tasks_list_config.dart:218-221,467-473`; `task_selection_step.dart:190`; `production_screens.dart:61` | cai para a placa; ~98% das linhas ficam "—" | alta, silenciosa |
| IDENTIFICADOR: Orçamentos e Faturamento | `budget.dart:209,909-911`; `budget_list_config.dart:182-185`; `billing_task.dart:41-42`; `billing.dart:103-112`; `billing_list_config.dart:78,106` | idem; a cobertura "78000, 78001 +2" vira placa, nome ou 8 caracteres de id | alta |
| Cabeçalho da tarefa (`displayName`) | `task.dart:390-399` | perde o recuo "Série X" (nome → fantasia → **série** → placa) | média |
| Detalhe: campo "Número de Série" | `task_detail_config.dart:553-567` | **some** para quem não tem `canEditIdentity` (`visible` exige valor, `:554-555`); para quem tem, aparece vazio | alta |
| Garagem / pátio | `garage_model.dart:147,193,209,361`; `truck_detail_sheet.dart:283-284` | rótulo do caminhão cai para placa ou 5 finais do chassi; "Nº Série" some da ficha | média |
| Cartão de tarefa vinculada | `linked_task_card.dart:15-23` | idem IDENTIFICADOR | baixa |
| Aerografia, bônus | `airbrushing_form_screen.dart:1010-1012`; `shared/widgets/bonus_shared.dart:560` (`task.identifier`) | idem | baixa |
| Prévia da NFS-e na aprovação da cobrança | `billing_approval_sheet.dart:191-208` → `nfse_discriminacao.dart:134,156,196-200` | a prévia perde "n série: 78000" e a faixa de séries; o recuo vira `'Ref. OS '` vazio. **A nota real é montada no servidor**, então só a prévia mente | média (confunde quem aprova) |
| Rótulos da cobrança e do pedido | `budget_sections.dart:1043,1308,2963`; `order_numbers_sheet.dart:213`; `billing_approval_sheet.dart:138,550`; `billing_covered_vehicles.dart:224` | caem para placa ou nome | média |
| Orçamento (assistente, edição) | `budget_form_screen.dart:841-842,882-883` (semeia `_serial`), `:3240,3383,5051,5219,5242,5506` | campo "Número de Série" vazio; a relação dos veículos sem série | média |
| Busca local da Agenda | `task_schedule_view.dart:462-473` (`hit(t.serialNumber)`) | buscar pela série não acha nada | alta: é como o chão de fábrica procura |
| Atenção R3b "Entrada sem placa" | `core/attention/attention_rules.dart:195-212` (`IsNull('serialNumber')`), snapshot `task_schedule_view.dart:71-78` | **falso positivo**: toda tarefa em voo com série e sem placa pisca "Entrada sem placa" (no clone, 8) | média; ensina a ignorar o alerta |
| **Ordenação da Agenda** | `task_schedule_view.dart:320-323` (`orderBy[2].serialNumber.sort/nulls`, **sempre** no modo Agenda) | depende da API. Chave descartada: perde o desempate, inofensivo. **Chave repassada ao Prisma: 500 e a Agenda inteira some** | **crítica** |
| **Edição da série no detalhe** | `task_detail_config.dart:563-566` (`update(t.id, {'serialNumber': …})`) | chave fora do schema: **200 e a série some** (armadilha `taskUpdateSchema` não strict). Chave repassada ao Prisma: 500 | **crítica** (perde dado) |
| **Edição pela tela de edição** | `task_edit_screen.dart:268` (snapshot), `:296` (control), `:633` (`put('serialNumber', …)`) | só envia se mudou; com a série ausente no GET o original é `null`, então **não envia nada sem o usuário digitar**. Se digitar: igual à linha acima | alta |
| **Criação de tarefa** | `task_form_screen.dart:462-463` (topo); `budget_form_screen.dart:1950-1951` (topo, em `batch-with-quote`) | idem: série descartada com 201, ou 500 | **crítica** |
| Edição pelo assistente de orçamento | `budget_form_screen.dart:2104,2122` (`if (serial.isNotEmpty) 'serialNumber'`) | com o campo vazio (GET sem série) não envia. Se o usuário digitar: perda silenciosa | alta |

### 3.2 Cenário B: a API espelha `serialNumber` no topo **e** traduz a escrita no topo

Nada muda para o usuário do app velho. **Condições**, todas obrigatórias:

1. O espelho sai em **toda** resposta que contém um objeto `Task` com escalares: lista, detalhe, aninhado em `budget.tasks`, `billing.tasks[].task`, `airbrushing.task`, `cut.task`, `observation.task`, `bonus.tasks`, `customer.tasks`. Vale **com ou sem** `include` de `truck`/`implement`: o app pede `tasks: {include: {customer, truck}}` (`budget_list_config.dart:120-122`), mas corte, observação e bônus pedem a tarefa sem caminhão.
2. O espelho é **string ou null**, nunca objeto.
3. `serialNumber` no topo de `POST /tasks`, `PUT /tasks/:id`, `PUT /tasks/batch` (`data.serialNumber`) e em cada item de `POST /tasks/batch-with-quote` vai para `implement.serialNumber`. **Nunca some com 2xx.** Topo e `implement.serialNumber` juntos e diferentes: 400 nomeado.
4. `orderBy` com `serialNumber` no topo vira `implement.serialNumber` (preservando `{sort, nulls}`); `where.serialNumber` idem.
5. A busca `searchingFor` continua achando pela série. Hoje a API usa `serialNumberNormalized` (coluna gerada + GIN, `api/src/schemas/task.ts:1414`).
6. A colisão de unicidade continua dizendo **qual série** colidiu. O app mostra a mensagem do servidor num toast (`api_exception.dart`).

**Recomendação de mecanismo (INFERÊNCIA, a decidir com o relatório da API):** as seis condições saem quase de graça se, na janela, `Task.serialNumber` continuar existindo como **coluna-sombra só de leitura**, mantida por gatilho `AFTER INSERT OR UPDATE OF "serialNumber" ON "Implement"`. A coluna gerada `serialNumberNormalized` e o GIN continuam de pé. O `@unique` passa para o implemento, e na tarefa a coluna perde o `@unique`. Nesse arranjo, orderBy, where, select, busca e o SQL cru de hoje (`api/src/modules/paint/paint.service.ts:512-515`) seguem funcionando **para qualquer cliente velho**, e sobra traduzir **só a escrita** (condição 3). A alternativa, uma camada de tradução mais um interceptor de resposta, tem de acertar cada include aninhado e cada `select`. Um espelho pela extensão `result` do Prisma não resolve: pelo meu conhecimento, `needs` aceita só escalares do próprio modelo e não atravessa relação (**INFERÊNCIA**, conferir na versão do Prisma do repo). Uma guarda de CI (grep) proíbe qualquer escrita de `Task.serialNumber` fora do gatilho. A coluna cai no R-D, junto com o alias `truck`.

### 3.3 O patch P02 (OTA, antes de a API mudar) precisa levar a série

O PLANO v1 já prevê o P02 (`PLANO.md:1297-1307`): cabeçalho de versão, 426 e leitura tolerante de `implement`/`truck`. **Acrescentar:**

| Arquivo:linha | Mudança no P02 |
|---|---|
| `lib/data/models/task.dart:438` | `serialNumber: _serialOf(j)`, com `_serialOf(j) = ((j['implement'] as Map?)?['serialNumber'] ?? j['serialNumber']) as String?` |
| `lib/features/financial/budget.dart:220` | idem |
| `lib/features/financial/billing_task.dart:112` | idem |
| `lib/core/network/dio_client.dart:153-171` | `X-App-Version` e `X-App-Patch` (já no v1). **FATO:** hoje não existem |
| `test/` (novo `task_json_contract_test.dart`, já previsto no v1) | fixture com série **no topo** e com série **em `implement`** exigindo o mesmo `Task.serialNumber` |

Com isso, depois do patch, o app lê dos dois lugares e o espelho de leitura pode cair antes do de escrita. A escrita velha (topo) só some quando o 426 empurrar o app novo. **Atenção (FATO, `PLANO.md:1295`):** glifo de ícone novo impede o patch Shorebird. O P02 não pode tocar em ícone. **INFERÊNCIA:** `shorebird.yaml` consta em `pubspec.yaml:137` (assets), mas **não existe** no checkout (`ls` vazio e não está no `.gitignore`). Conferir onde mora antes de contar com o OTA (§11).

---

## 4. O que a API precisa garantir para os clientes (lista para o relatório da API)

| # | Garantia | Quem depende (cliente) |
|---|---|---|
| A1 | `serialNumber` (string ou null) no topo de todo objeto `Task` com escalares, na janela | app instalado inteiro (§3.1); web velho em aba aberta; todo leitor web listado em §5.3-§5.6 até migrar para `taskSerial()` |
| A2 | `implement.serialNumber` presente quando o pedido inclui `implement` (ou `truck` traduzido) | web novo e app pós-P02 |
| A3 | Escrita no topo (`serialNumber`) traduzida para o implemento em `POST/PUT /tasks`, `/tasks/batch` (create e update), `/tasks/batch-with-quote`, `/tasks/duplicate`. Nunca descartar com 2xx | §6 e §3.1 |
| A4 | `orderBy.serialNumber` (direção ou `{sort, nulls}`) aceito no topo de `Task` **e** aninhado (`task.serialNumber` em aerografia, ordem de serviço, caminhão). Traduzido, nunca 500 | app `task_schedule_view.dart:322-323`; web `use-table-state.ts:111-118`, `task-history-table-filters.tsx:160`, `airbrushing-table-page.tsx:84`, `task-table.tsx:1622-1637` + 5 `dashboardLayoutWeb` gravados, `task-table-columns.tsx:169-171` |
| A5 | `select: { serialNumber: true }` em `Task`, no topo e aninhado, continua devolvendo a série | web `pages/production/barracoes/index.tsx:107`; `pages/financial/billing/details/[id].tsx:316` (dentro de `quote.include.tasks.select`) |
| A6 | `searchingFor` acha pela série em `/tasks`, `/budgets`, `/billings`, `/customers` (`tasks.some`), `/trucks` (`task.serialNumber`), `/observations`, `/airbrushings`, `/cuts` e no portal | placeholders que prometem "série": web `task-table.tsx:3090`, `cliente/pedidos.tsx:325`, `cliente/veiculos/list.tsx:258`, `cliente/orcamentos/list.tsx:225`, `pedido-form-dialog.tsx:353`; app `tasks_list_config.dart:52`, `budget_list_config.dart:157`, `billing_list_config.dart:86` |
| A7 | DTOs achatados mantêm a chave (P2): portal (`portal-read.service.ts:207,278,872,943,974`; `portal-identity.service.ts:128,339,411-529`), `taskSerialNumber` (`dashboard-prisma.repository.ts:1937,1950,3507`; `nfse.controller.ts:150,267`; `receivable-match.service.ts:1836,2143`; `receivable-task-match.service.ts:440`; `invoice-analytics.service.ts:1373`), resumo da Home, plano de tinta, assinatura | web `types/dashboard.ts:431,632,652`, `types/receivable.ts:105,184`, `types/financial-analytics.ts:193`, `types/invoice.ts:134`, `api-client/paint.ts:642`, `api-client/signature.ts:209`, `api-client/portal.ts:420,754,902,1020,1349,1426`; app `nfse_detail_screen.dart:324` |
| A8 | Erro de unicidade da série com `field: 'serialNumber'` (não `implement.serialNumber`) no portal | `api-client/portal.ts:1237-1257` (`PortalFieldConflict.field`); `portal-request.service.ts:778-792`, `portal-identity.service.ts:389-430` |
| A9 | Implemento criado **sempre**, mesmo sem `truck`/`implement` no corpo | §6 |
| A10 | Mesmo evento de notificação (`task.field.serialNumber` / `task_serialNumber`) e mesma variável `{{serialNumber}}` nos templates quando a série do implemento mudar | §1.1 |
| A11 | Mudança de série registrada no `ChangeLog` de forma que a aba Histórico da tarefa a mostre | web `task-with-service-orders-changelog.tsx:476,580-590` (junta TASK e TRUCK pelo `truckId`); §5.9 |

---

## 5. Inventário WEB (`/home/kennedy/Documents/repositories/web/src`)

Legenda da coluna **Ação**: **H** = trocar leitura por `taskSerial(t)` · **W** = escrita vai para `implement.serialNumber` · **Q** = pedido à API (select/include/orderBy) · **—** = não muda (DTO do servidor, P2) · **X** = apagar (código morto).

### 5.1 Tipos e schemas zod do cliente

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `types/task.ts:33` | `Task.serialNumber: string \| null` | vira `serialNumber?: string \| null` marcado `@deprecated` (espelho da janela); `Implement.serialNumber: string \| null` no tipo novo (hoje `types/truck.ts:13-25` não tem série) |
| `types/task.ts:229` | `TaskOrderBy.serialNumber` | + `implement?: { serialNumber?: … }`; o do topo fica `@deprecated` |
| `types/budget.ts:108` | `tasks[].task.serialNumber` no faturamento | + `implement?.serialNumber` |
| `types/reconciliation.ts:244,352`; `types/invoice.ts:32` | `task?: {id,name,serialNumber}` | depende de como a API monta: se for `select` Prisma aninhado → **Q**/**H**; se for DTO → **—**. Conferir no relatório da API |
| `schemas/task.ts:276,293` | `taskOrderBySchema.serialNumber` | + `implement.serialNumber`. **Só tipo**: o web não roda `taskGetManySchema` em runtime (usado só em `schemas/task.ts:1526` como tipo) |
| `schemas/task.ts:322` | `taskWhereSchema.serialNumber` | idem (só tipo) |
| `schemas/task.ts:449` | `searchingFor` → `serialNumber contains` | só tipo; **a busca real é da API** (`api/src/schemas/task.ts:1414`) |
| `schemas/task.ts:1192-1199` | `taskCreateSchema.serialNumber` com a regex `^[A-Z0-9-]+$` | vai para o objeto `implement` (estrito) |
| `schemas/task.ts:1213-1214,1300-1326` | `serialNumberFrom/To` (faixa) | **FATO:** nenhum formulário do web manda (a faixa expande no cliente em `serial-number-range-input.tsx`). Manter no tipo só se a API mantiver; ver §11 |
| `schemas/task.ts:1255-1265` | "ao menos um de Cliente, Número de série, Placa ou Nome" lê `data.serialNumber` | ler `data.implement?.serialNumber` |
| `schemas/task.ts:1341-1348` | `taskUpdateSchema.serialNumber` + regex | vai para `implement`. A regex só se aplica **quando a série muda** (P4) |
| `schemas/task.ts:1550` | `mapTaskToFormData` copia `task.serialNumber` | `taskSerial(task)` |
| `schemas/task.ts:1606-1616` | `taskDuplicateCopySchema.serialNumber` | fica (é o campo do formulário); o montador (§5.4) põe em `implement` |
| `schemas/customer.ts:530`; `schemas/truck.ts:203,458`; `schemas/observation.ts:245`; `schemas/airbrushing.ts:185,228`; `schemas/serviceOrder.ts:102` | where/orderBy/busca aninhados em `task.serialNumber` | só tipo; acompanhar o contrato da API |
| `types/monitoring.ts:23,400`; `types/user.ts:140,152`; `components/common/printer/use-printer-client.ts:20,151`; `components/administration/user/fiscal/a1-certificate-card.tsx:179` | série de SSD, de impressora, de certificado A1 e da DPS | **fora do escopo** (homônimos) |

### 5.2 api-client e hooks

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `api-client/task.ts:117,332-353,376` | `createTask`, `batchCreateTasks`, `batchCreateTasksWithQuote`, `duplicateTask` repassam o corpo | nada no cliente HTTP; o corpo muda nos formulários (§6) |
| `api-client/portal.ts:420,754,902,1020,1107,1199,1349,1426` | tipos de DTO do portal com `serialNumber` | **—** (P2). `:1020-1021` (`vehicles[].truckId`, resultado da requisição) é a única chave de caminhão do portal: renomear para `implementId` só se a API renomear (INFERÊNCIA: nenhum leitor no web; conferir) |
| `api-client/portal.ts:1055-1069` | `portalMissingIdentity` põe "série" nas faltas; `portalVehicleLabel` | **—** |
| `api-client/portal.ts:1100-1107,1237-1257` | comentários "`Task.serialNumber` e `Truck.plate` são @unique GLOBAIS" | atualizar o texto (a unicidade passa a ser do implemento); `PortalFieldConflict.field` continua `'serialNumber'` (A8). `portalErrorConflicts` (`:1264`) não tem leitor (FATO, `rg`) |
| `api-client/signature.ts:98` | descrição da seção VEHICLE: "Série, placa, chassi, categoria e tipo de implemento." | **—** |
| `api-client/signature.ts:209`; `api-client/paint.ts:642` | DTO | **—** |
| `hooks/common/use-table-state.ts:109-118` | coluna `identificador` → `orderBy: { serialNumber: {sort, nulls:'last'} }` | **Q**: `{ implement: { serialNumber: {sort, nulls:'last'} } }` |
| `hooks/production/task/use-task-form-url-state.ts:44,111-115,256-257,300,336,561,587,599,613,620` | estado de formulário em URL com `?serialNumber=` | **X**: `useTaskFormUrlState` não tem consumidor (FATO: único uso é o re-export em `hooks/production/use-task.ts:754`) |
| `hooks/common/query-keys.ts` | — | nenhuma query key usa série (FATO) |
| — | persistência do react-query | não existe (`persistQueryClient` ausente, FATO). Aba velha aberta só se corrige com recarga (handshake `X-Min-Web-Build` do v1, `PLANO.md:821`) |

### 5.3 Pedidos à API (select, include, orderBy, where)

| Arquivo:linha | Pedido | Ação |
|---|---|---|
| `pages/production/barracoes/index.tsx:103-124,324` | `select: { serialNumber: true, truck: { select: … } }` | **Q**: `implement: { select: { serialNumber: true, … } }`. **Armadilha**: select explícito descarta a chave nova em silêncio. Se a série for pedida em `truck.select` antes de a API conhecer o campo, o pátio fica sem rótulo |
| `pages/financial/billing/details/[id].tsx:312-330` | `quote.include.tasks.select.serialNumber: true` | **Q**: `implement: { select: { serialNumber, plate, chassisNumber, … } }` no lugar de `truck` |
| `components/production/task/history/table/task-history-table-filters.tsx:160` | `identificador → { serialNumber: d }` | **Q** |
| `components/production/airbrushing/table/airbrushing-table-page.tsx:81-84` | `taskSerialNumber → { task: { serialNumber: {sort, nulls} } }` | **Q**: `{ task: { implement: { serialNumber: … } } }` |
| `dashboard/widgets/task-table.tsx:1609-1637` | `ORDER_BY_PATH_MAP` não tem `serialNumber`, então sai `{ serialNumber: dir }` no topo; **5 layouts gravados** ordenam por ele | **Q**: `serialNumber: ["implement","serialNumber"]` no mapa; a chave gravada não muda (P1) |
| `components/production/task/list/task-table-columns.tsx:169-171` | coluna "Nº SÉRIE" `sortable` → `orderBy.serialNumber` via `convertSortConfigsToOrderBy` (`list/task-table.tsx:130-132`) | **Q** |
| Includes que **dependem do escalar por padrão** e não pedem caminhão: `pages/production/cutting/details/[id].tsx:54` (`task: {include:{customer,sector}}`), `components/production/observation/form/observation-form.tsx:93-114`, `observation/form/task-selector.tsx:158`, `dashboard/widgets/installment-table.tsx:560` (`TASK_INCLUDE`), `administration/customer/detail/customer-tasks-list.tsx` | a série vem porque `include` devolve os escalares da tarefa | **Q**: acrescentar `implement: { select: { serialNumber: true } }`. Sem isso, **com o espelho A1 funciona, sem ele fica vazio** |
| Demais telas que já incluem `truck` (Cronograma, Agenda, Histórico, Preparação, Orçamento, Faturamento, Garagem, bônus, relacionadas) | `truck: true` ou `truck: {…}` | vira `implement` no pacote do v1; a série vem junto |

### 5.4 Formulários (criação, edição, lote, duplicar)

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `components/production/task/form/task-create-form.tsx:72,83,123,186,322-333,372,508-523,549-553,802-822` | `serialNumbers: z.array(z.number())`; produto cartesiano placas × séries; cada tarefa leva `serialNumber` **no topo**; `truck` só se houver placa, categoria, tipo ou medida (`:492-495`) | **W**: cada item leva `implement: { serialNumber, plate, … }` **sempre** (P6). **FATO lateral:** o array é de **número**, então 436 formatos existentes (`37772-RETRAB`) não podem ser criados por aqui (§11) |
| `components/production/task/form/serial-number-range-input.tsx:21-188` | chips de série numérica, faixa | fica (é UI); o valor vai para `implement` no montador |
| `components/production/task/form/task-edit-form.tsx:755` | mapa campo → seção para erro: `serialNumber: "basic-information"` | acrescentar `"implement.serialNumber"` (o erro do zod passa a vir com esse caminho) |
| `task-edit-form.tsx:1076` | default `serialNumber: taskData.serialNumber` | `taskSerial(taskData)` |
| `task-edit-form.tsx:1716,2121` | `nullableFields` com `'serialNumber'` (limpar grava `null`) | a regra vale dentro de `implement` (limpar a série → `implement: { serialNumber: null }`) |
| `task-edit-form.tsx:3345-3372` | campo "Número de Série" (`name="serialNumber"`, `IconHash`, `canEditIdentity`) | **W**: `name="implement.serialNumber"`, **ou** manter o nome do campo e montar `implement` só com as chaves sujas (P4). Recomendo a 2ª: mexe em menos lugares |
| `components/production/task/batch-edit/task-batch-edit-table.tsx:43,113,145,183-193,228,383,457` | lote: `tasks[i].data.serialNumber`, preencher em sequência, "Nº Série" | **W**: `data.implement.serialNumber`; comparação com o original via `taskSerial` |
| `components/production/task/batch-edit/task-batch-result-dialog.tsx:38-39` | "Série: X" | **H** |
| `components/production/task/modals/task-duplicate-modal.tsx:124-147,171-180,229-243,392,485-488` | cópia com `serialNumber` no topo; `truck: null` quando a cópia não tem placa nem chassi **e** a origem não tem caminhão | **W**: `implement: { serialNumber, plate, chassisNumber, type, category }` sempre; `spot: null` continua |
| `components/production/task/schedule/duplicate-task-modal.tsx:18-180` | `DuplicateTaskModal` | **X**: sem consumidor (FATO: todos importam `modals/task-duplicate-modal`) |
| `pages/financial/budget/create.tsx:156,465,783-831` | orçamento que cria tarefas: `serialNumbers` numérico, `vehicleCombinations`, série no topo | **W** (P6) |
| `components/financial/budget/steps/budget-step-task.tsx:57,69,135-157,279-296,416-422,464-473,787-856` | campo "Número de Série" (edição, 1 veículo), contagem placas × séries, leitura dos irmãos `vehicle.serialNumber` | **W** no campo; **H** na leitura |
| `pages/financial/budget/details/[taskId].tsx:269,377,388-396,509,1076-1078,1398-1399,1533,1971` | form `serialNumber`, `taskUpdateData.serialNumber` só quando sujo, `PUT /tasks/:id` | **W**: `taskUpdateData.implement = { serialNumber }` quando sujo (junto com o objeto de caminhão, que já é montado por campo sujo, `:1414-1420`); **H** nas leituras |
| `components/financial/billing/steps/billing-step-task.tsx:163-180` | campo "Número de Série" **editável** no faturamento | **INFERÊNCIA**: a página não grava a série (`rg serialNumber` em `billing/details/[id].tsx` só acha leituras: `:316,425,467,581,757,1749,2012,2031,2042`; `updateTaskAsync` só aparece na lista de dependências, `:1604`). Hoje é campo que aceita digitação e não salva. Decidir: somente leitura, ou gravar em `implement` (§11) |
| `dashboard/widgets/quick-budget.tsx:12,117,158,175,285-286` | cria tarefa com `serialNumber` no topo e **nenhum caminhão**, depois o orçamento | **W** + P6: `implement: { serialNumber }` |
| `components/cliente/solicitacao/*` (portal) | ver §5.7 | **—** |

### 5.5 Exibição (colunas, cartões, títulos, buscas locais)

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `utils/task.ts:190-194` | `formatTaskIdentifier`: série → placa → `#id` | **H**; é o lugar natural de `taskSerial()` |
| `components/production/task/detail/task-detail-page.tsx:696-703` | campo `serialNumber` "Número de Série" em **overview**, edição inline `setTaskField({ serialNumber })` (`:457-463`) | **H** + **W**: `setTaskField({ implement: { serialNumber } })`. Id do campo fica (P1). Mover para a seção Implemento é seguro (§1.1) |
| `task-detail-page.tsx:1518,1624,1628` | título "Nome — Série" e "Série X" | **H** |
| `components/production/task/list/task-table-columns.tsx:92,169-180` | "SN: X" sob o nome; coluna "Nº SÉRIE" | **H** + **Q** |
| `components/production/task/schedule/task-schedule-columns.tsx:140-147`; `column-visibility-manager.tsx:20,68`; `task-schedule-table-page.tsx:114` | coluna `serialNumberOrPlate` "IDENTIFICADOR" | **H**; id fica |
| `components/production/task/schedule/task-schedule-export.tsx:37,76,365,514` | export "Nº Série/Placa" | **H** |
| `components/production/task/schedule/task-schedule-content.tsx:345` | busca local por série | **H** |
| `components/production/task/schedule/copy-from-task-modal.tsx:85,116` | "Nº Série" | **H** |
| `components/production/task/preparation/task-prep-columns.tsx:342-346`; `task-prep-page.tsx:164` | IDENTIFICADOR e ordenação no cliente | **H** |
| `components/production/task/history/task-history-columns.tsx:347`; `history/table/task-history-table-columns.tsx:219-228`; `history/task-export.tsx:132`; `history/task-history-table-skeleton.tsx:20` | IDENTIFICADOR, export | **H** |
| `components/production/task/form/selected-tasks-summary.tsx:20`; `components/production/cut/form/cut-create-wizard.tsx:165` | "série · placa" | **H** |
| `components/production/production-period-tasks-modal.tsx:128` | série → placa → chassi | **H** |
| `components/production/garage/garage-view.tsx:115,500-501`; `garage/patio-view.tsx:150-159`; `garage/truck-detail-modal.tsx:217-224` | rótulo do caminhão no pátio, "Número de Série" | **H** (o `GarageTruck.serialNumber` é montado em `barracoes/index.tsx:324`) |
| `components/production/airbrushing/detail-page/airbrushing-detail-page.tsx:717-727`; `airbrushing/table/airbrushing-table-columns.tsx:56-63` | IDENTIFICADOR da aerografia | **H** |
| `pages/production/cutting/details/[id].tsx:182` | campo `serialNumber` "Número de Série" do corte (id gravado em `detailConfigsWeb.cut-detail`) | **H**; id fica |
| `pages/production/schedule/edit/[id].tsx:152-153` | título "Nome - Série" | **H** |
| `components/production/observation/form/observation-form.tsx:487-493`; `observation/form/task-selector.tsx:487` | "Número de Série" | **H** + **Q** (§5.3) |
| `components/production/painting/production-availability/paint-plan-detail-modal.tsx:243-246` | DTO `PaintPlanDetailTask` | **—** |
| `components/common/related-tasks-card.tsx:73-85,199-202` | busca local e "S/N: X" | **H** |
| `components/personnel-department/payroll/detail/tasks-in-bonus-card.tsx:68,148-151`; `personnel-department/bonus/detail/bonus-tasks-table.tsx:80,123-125` | busca, "S/N", ordenação local | **H** |
| `components/administration/customer/detail/customer-tasks-list.tsx:64` | coluna visível padrão `serialNumber` (id gravado em localStorage `customer-detail-tasks-visible-columns`) | id fica; **Q** (§5.3) |
| `components/administration/customer/detail/related-invoices-card.tsx:54`; `components/production/task/billing/invoice-detail-dialog.tsx:64` | "OS #série" | **H** + pergunta de rótulo (§11) |
| `components/home-dashboard/task-deadline-list.tsx:83`; `completed-tasks-list.tsx:56`; `awaiting-approval-tasks-list.tsx:55` | `HomeDashboardTask` (DTO) | **—** |
| `dashboard/widgets/task-table.tsx:612,710-715,2347-2348` | coluna "Identificador" (`key: "serialNumber"`), títulos de diálogo | **H**; key fica |
| `dashboard/widgets/installment-table.tsx:12,304,397,462,657-659` | `taskSerial` montado de `task.serialNumber` | **H** + **Q** |
| `dashboard/presets.ts:174,187,283,354,687,756,861,919,1053,1394,1402` | presets com a coluna `serialNumber` | fica (P1) |
| `components/financial/reconciliation/receivable-match-section.tsx:469`; `transaction-buckets.tsx:165`; `statement-columns.tsx:42` | "série · nome" | conforme §5.1 (DTO **—** ou select **Q**/**H**) |
| `components/financial/budget/table/quote-row-shared.tsx:68` | IDENTIFICADOR da lista de orçamentos | **H** |
| `utils/quote-tasks.ts:37,122,227,365,640-650` | `vehicleLabel`, `coverageLabels`, "#série · PLACA" | **H** (muda o tipo `QuoteTaskLike`) |
| `components/financial/shared/billing-split-field.tsx:42-49`; `billing/steps/billing-covered-vehicles.tsx:20,185` | rótulo do veículo na divisão e na cobertura | **H** |
| `components/financial/budget/steps/budget-step-review.tsx:181-207,259,303,319-333,407-418,615,635,663-666`; `budget-step-customer-payment.tsx:156-168` | resumo do orçamento, tabela "Nº de série" | **H** (as listas de criação continuam vindo do formulário) |
| `components/financial/billing/steps/billing-step-review.tsx:136,223,373,903,927-930,1989` | idem no faturamento | **H** |
| `pages/financial/billing/details/[id].tsx:409,425,467,581,757,1749,2012,2031,2042` | leituras, aviso "apenas os documentos de <série>" | **H** |
| `components/financial/budget/budget-request-card.tsx:114` | `RequestVehicle.serialNumber` | **H** |

### 5.6 Documentos e prévias gerados no cliente

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `components/financial/billing/preview/billing-document-previews.tsx:53,130-154,295` | prévia do boleto e da NFS-e: "N.º serie: X", `fallbackLabel "Ref. OS <série>"` | **H**. O texto deve continuar **idêntico** ao que o servidor gera (a prévia é "fiel", `:130`) |
| `utils/nfse-discriminacao.ts:14-21,42,85,94,102,118,150-158,236-243` | espelho da discriminação da NFS-e | **H** na entrada (`vehicle.serialNumber` vem de quem chama); o texto não muda (DD5) |
| `components/public/quote-vehicle-table.tsx:71,85-86` | página pública do orçamento: coluna "Nº de série" | **H** (o endpoint público `/budgets/public/:id`, `api-client/budget.ts:161`, precisa trazer `implement` ou o espelho) |
| `pages/public/budget/[id].tsx:55,292` | número do orçamento com recuo para `primaryTask.serialNumber` e depois `"0000"` | **H**. **INFERÊNCIA:** o recuo para a série contradiz a regra do mesmo repo ("o número é o do ORÇAMENTO, não o `serialNumber`", `pages/public/service-report/[id].tsx:576`, e `app/lib/shared/share/document_filename.dart:10`). Recomendo tirar o recuo para a série |
| `pages/public/service-report/[id].tsx:527` | dossiê multi-veículo: "nº série · placa" | **H** |
| `utils/invoice-pdf-generator.ts:45` | "Nº Série: X" | **X**: sem importador (FATO: `rg invoice-pdf-generator` = 0) |

### 5.7 Portal do Responsável (`pages/cliente`, `components/cliente`)

**FATO:** todo o portal fala com DTOs montados pela API (`PortalVehicleIdentity`, `PortalSummaryVehicle`, `PortalChargeVehicle`, `PortalPurchaseOrderVehicle`, `PortalSignatureVehicle`). A ordenação é uma **allowlist do servidor** (`VEICULO_SORT_FIELD_MAP.serialNumber = "serialNumber"`, `veiculo-table-columns.tsx:92-100` → `api/src/modules/people/portal/portal-read.service.ts:278`). **Nenhuma linha do portal precisa mudar para DD1.** A API muda a fonte em `portal-read.service.ts:207,278,872,943,974`, `portal-identity.service.ts:128,339,347,411-529` e `portal-request.service.ts:778-792,880,906,951,1096`.

| Arquivo:linha | O que faz | Ação |
|---|---|---|
| `pages/cliente/veiculos/[taskId].tsx:5,143-144,257,271` | título "Série X", identificação | **—** |
| `pages/cliente/veiculos/list.tsx:258`; `components/cliente/veiculo/veiculo-table-columns.tsx:95,232-247` | coluna "Série", busca | **—** |
| `components/cliente/veiculo/veiculo-identidade-card.tsx:143,161-163,241-253` | edição inline "Número de série" → `PATCH …/identificacao { serialNumber }` (máx. 120) | **—** (a rota é `.strict()` e a API grava no implemento) |
| `components/cliente/orcamento/orcamento-veiculos-card.tsx:136`; `components/cliente/orcamento/vehicle-chips.tsx:35,56` | "Série" | **—** |
| `pages/cliente/painel.tsx:82-90`; `pages/cliente/pedidos.tsx:77,325`; `components/cliente/pedido-form-dialog.tsx:29,353`; `pages/cliente/orcamentos/list.tsx:131,225`; `pages/cliente/orcamentos/[id].tsx:374`; `pages/cliente/assinaturas.tsx:66` | rótulos, buscas, textos | **—** |
| `pages/cliente/solicitar.tsx:15-16,81,169,194,402`; `components/cliente/solicitacao/solicitacao-schema.ts:7,324,356-360,442-448,533-537,671-672`; `step-veiculos.tsx:9,82,129-181,277`; `step-revisao.tsx:112,237,245` | requisição: série por linha (máx. 60), duplicidade no lote, payload `veiculos[].serialNumber` → `POST /cliente/me/orcamentos` (`api-client/portal.ts:1615-1625`) | **—** no cliente. A API cria o implemento com a série (A9). Os comentários "`Task.serialNumber` … @unique" (`step-veiculos.tsx:9`, `solicitacao-schema.ts:7`) passam a falar do implemento |
| `utils/portal-capabilities.ts:30` | "Escrever série, placa, chassi e plaqueta." | **—** |

### 5.8 Atenção (regra R3b) — só o web precisa mudar

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `lib/attention/rules.ts:11-13,228-250` | R3b "Entrada sem placa": `isNull serialNumber` **e** `isNull truck.plate`. O motor percorre o **objeto cru** da linha | trocar para `implement.serialNumber` (e `implement.plate`, no pacote do v1). **Com o espelho A1 o predicado atual segue certo**; quando o espelho cair, dá falso positivo |
| `lib/attention/engine.test.ts:40,131-159,244,333` | fixtures com `serialNumber` no topo | reescrever para `implement.serialNumber` |
| app `core/attention/attention_rules.dart:204` | `IsNull('serialNumber')` sobre o **snapshot projetado à mão** (`task_schedule_view.dart:71-78`) | **não muda**: o snapshot lê `t.serialNumber` do modelo, e o modelo pós-P02 lê do implemento. O caminho da regra é da projeção, não da API |
| API `modules/common/attention/attention.service.ts:286` (`NO_SERIAL`) | a mesma regra do lado do servidor | relatório da API |

### 5.9 Histórico (changelog)

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `utils/changelog-fields.ts:320` | TASK `serialNumber: "Número de Série"` | **fica** (113 linhas históricas) |
| `utils/changelog-fields.ts:793-815` | seção TRUCK (placa, chassi, plaqueta) **sem** `serialNumber` | acrescentar `serialNumber: "Número de Série"` na seção do implemento (TRUCK ou IMPLEMENT, conforme D-04 do v1), senão a mudança nova aparece com o nome cru do campo |
| `utils/changelog-fields.ts:808,871,953` | `task.serialNumber` em TRUCK, CUT, SERVICE_ORDER | ficam; + `task.implement.serialNumber` se a API passar a registrar esse caminho |
| `components/ui/task-with-service-orders-changelog.tsx:476,580-590` | junta TASK, SERVICE_ORDER e TRUCK pelo `truckId` | se a série passar a ser registrada no implemento, a aba já a mostra desde que receba o id do implemento (A11) |
| app `features/changelog/changelog_labels.dart:261,347` | TASK `serialNumber`; `task.serialNumber` | acrescentar na entidade do implemento |

### 5.10 Testes do web que quebram ou precisam mudar

| Arquivo:linha | Por quê |
|---|---|
| `lib/attention/engine.test.ts:40,131-159,244,333` | fixture no topo (§5.8) |
| `utils/billing-coverage.test.ts:44-47` | fixture `{serialNumber, truck:{plate}}` no topo; muda com o tipo `QuoteTaskLike` |
| `utils/vehicle-combinations.test.ts:21-39` | produto cartesiano. **Não muda** (é o formulário), a menos que a combinação passe a devolver `implement` |
| `components/cliente/solicitacao/solicitacao-schema.test.ts:44-462` (`:330` espera chaves exatas `["medidas","serialNumber"]`) | **não muda** se o payload do portal ficar como está (P2). É exatamente a guarda que prova que o contrato do portal não mexeu |
| **novo** | teste do helper `taskSerial` com série no topo, em `implement` e nos dois |
| **novo** | teste de `orderByEntry("serialNumber")` → `{implement:{serialNumber}}` (widget) e de `use-table-state` para `identificador` |

---

## 6. Caminhos de CRIAÇÃO de tarefa nos clientes (DD1: toda tarefa nasce com implemento)

**FATO comum:** nenhum caminho vivo manda o objeto de caminhão quando não há placa, chassi, categoria, tipo ou medida. A série vai **sempre no topo**.

| # | Cliente | Onde | Rota | Série hoje | Caminhão hoje | Muda para |
|---|---|---|---|---|---|---|
| C1 | web | `task-create-form.tsx:508-600` | `POST /tasks/batch-with-quote` (com orçamento mínimo) **ou** `POST /tasks` um a um (sem cliente ou sem papel COMMERCIAL/ADMIN, `:569-600`) | topo, `serialNumber.toString()` (`:512,521,552`) | só se `plate \|\| category \|\| implementType \|\| hasLayoutChanges` (`:492-495`) | `implement: { serialNumber, plate?, category?, type?, medidas… }` **sempre** |
| C2 | web | `pages/financial/budget/create.tsx:783-884` | `POST /tasks/batch-with-quote` | topo (`:831`) | `buildTruckData(plate)` (mesma regra) | idem C1 |
| C3 | web | `dashboard/widgets/quick-budget.tsx:170-190` | `POST /tasks` e depois `POST /budgets` | topo (`:175`) | **nunca** | `implement: { serialNumber? }` sempre. **FATO lateral:** são duas requisições (a mesma forma que já gerou órfãos, `budget_form_screen.dart:1915-1921`). Fora do recorte, mas vale migrar para `batch-with-quote` no mesmo pacote |
| C4 | web | `modals/task-duplicate-modal.tsx:171-243,300-360` | `POST /tasks`, `POST /tasks/batch` ou `POST /tasks/batch-with-quote` | topo (`:180`) | `null` se a cópia não tem placa nem chassi **e** a origem não tem caminhão (`:229-243`) | `implement: { serialNumber, plate, chassisNumber, category, type }` sempre. O modo "quantidade" (`:389-393`) cria N cópias **sem série**: continua, cada uma com seu implemento vazio |
| C5 | web (portal) | `solicitacao-schema.ts:663-690` → `api-client/portal.ts:1615` | `POST /cliente/me/orcamentos` | `veiculos[].serialNumber` | a API cria `truck` quando há medida (`portal-request.service.ts:895,990`) | **cliente não muda**; a API cria o implemento sempre (A9) |
| C6 | app | `task_form_screen.dart:440-470,495-501` | `POST /tasks` | topo, maiúscula (`:462-463`) | `_truck()` devolve `null` se tudo vazio (`:379-402`) | `implement: {…}` sempre (P24); o instalado depende de A3 e A9 |
| C7 | app | `budget_form_screen.dart:1926-1960` | `POST /tasks/batch-with-quote` | topo (`:1950-1951`) | `'truck': ?_truckPayload(...)` omite quando nulo (`:1952`) | idem C6 |
| — | web | `schedule/duplicate-task-modal.tsx` | — | — | — | **morto**, apagar (§8) |
| — | app | cópia de tarefa (`copy-from`) | tokens de `api/src/schemas/task-copy.ts:15-40` | a série **não** é copiável (FATO) | — | nada |

**Consequência para a API (A9):** o implemento tem de nascer no **servidor**, em `create`, `batchCreate`, `batch-with-quote`, `duplicate` e na requisição do portal, quando o corpo não trouxer `truck`/`implement`. Os clientes novos mandarem sempre `implement` é defesa em profundidade, não a garantia. O app instalado (C6, C7) e o `quick-budget` de uma aba velha (C3) nunca vão mandar.

---

## 7. Inventário APP (`/home/kennedy/Documents/repositories/mobile-flutter`)

Legenda igual à §5. **P02** = patch OTA de compatibilidade; **P24** = app novo (pacotes do v1).

### 7.1 Modelos e parse

| Arquivo:linha | Hoje | Pacote | Ação |
|---|---|---|---|
| `lib/data/models/task.dart:279,322,438` | `Task.serialNumber` de `j['serialNumber']` | **P02** | ler `implement.serialNumber ?? serialNumber` (§3.3); o campo do modelo fica |
| `task.dart:387-399` | `identifier`, `displayName` ("Série X") | — | nada (lê o campo do modelo) |
| `lib/features/financial/budget.dart:137-161,209,220,909-911` | `BudgetTaskLite.serialNumber`, `identifier`, `identifierLabel` | **P02** | idem no `fromJson` |
| `lib/features/financial/billing_task.dart:26,35,41-42,112` | `BillingTask.serialNumber` | **P02** | idem |
| `lib/features/garages/garage_model.dart:114,147,193,209,361` | `GarageTruck.serialNumber` a partir de `task.serialNumber` | — | nada |
| `lib/features/financial/nfse_discriminacao.dart:85,93,134,156,196-200` | `DiscriminacaoVehicle.serialNumber` | — | nada (quem chama passa `v.serialNumber` do modelo) |
| `lib/features/production/budget_report_pdf_generator.dart:119,145,412` | "nº de série" no relatório | **X** | `generateBudgetReportPdf` (`:362`) não tem chamador (FATO: `rg` só acha a definição) |

### 7.2 Pedidos à API

| Arquivo:linha | Pedido | Pacote | Ação |
|---|---|---|---|
| `lib/features/production/task_schedule_view.dart:320-323` | `orderBy[2].serialNumber.sort/nulls` (Agenda, sempre) | **P24** (+ A4 para o instalado) | `orderBy[2].implement.serialNumber.sort/nulls` |
| `lib/features/production/tasks_list_config.dart:322-327` | comentário "`serialNumber` stays a valid orderBy/sort field"; a coluna IDENTIFICADOR não é ordenável | P24 | atualizar o comentário |
| buscas no servidor (`tasks_list_config.dart:52`, `budget_list_config.dart:157,349`, `billing_list_config.dart:86`) | `searchingFor` | — | A6 |
| includes de lista (`budget_list_config.dart:120-122` `tasks: {include:{customer, truck}}`; demais com `truck: true`) | escalares vêm de graça | P24 | `truck` vira `implement` (v1); a série vem em `implement` |

### 7.3 Escrita

| Arquivo:linha | Hoje | Pacote | Ação |
|---|---|---|---|
| `task_form_screen.dart:163,262,296,338-339,462-463,484,490,608-610` | criação: control, rascunho, "ao menos um de…", `base['serialNumber']` | **P24** | `base['implement'] = {..., 'serialNumber': …}` sempre (C6) |
| `task_edit_screen.dart:268,296,353,448,563,604-610,633,944-946` | edição: snapshot, control, rascunho (`'serial'`), `put('serialNumber', _nnUpper(…))` | **P24** | `put` dentro do mapa `implement`, só quando mudou (P4). O rascunho local (`'serial'`) é por formulário, não precisa migrar |
| `task_detail_config.dart:329,553-567` | edição inline `update(t.id, {'serialNumber': …})` | **P24** | `{'implement': {'serialNumber': …}}` |
| `budget/budget_form_screen.dart:215-218,841-842,882-883,1766,1926-1952,2104,2122,2638-2657,2742-2749` | assistente de orçamento: produto placas × séries, série no topo na criação (`:1950`) e na edição (`:2122`) | **P24** | `implement` sempre (C7); na edição, só quando mudou |
| `lib/features/financial/vehicle_combinations.dart:15-55` | combinação placa × série | — | nada (é do formulário) |

### 7.4 Exibição (não muda depois do P02: tudo lê o campo do modelo)

`task_detail_config.dart:553-567` ("Número de Série"; o `visible` exige valor ou `canEditIdentity`) · `tasks_list_config.dart:215-221,465-473` (IDENTIFICADOR) · `task_schedule_view.dart:78` (snapshot de atenção), `:462-473` (busca local) · `linked_task_card.dart:15-23,79-82` · `garages/truck_detail_sheet.dart:283-284` ("Nº Série") · `financial/budget_sections.dart:267,1026-1046,1292-1308,2963` · `financial/billing.dart:103-112` · `financial/billing_approval_sheet.dart:138,191-208,550` ("Ref. OS") · `financial/order_numbers_sheet.dart:213` · `financial/billing_covered_vehicles.dart:224` · `budget/budget_form_screen.dart:3240,3383,5018-5051,5188-5242,5506` · `production_extra/airbrushing_form_screen.dart:1010` · `production/task_selection_step.dart:190` · `shared/widgets/bonus_shared.dart:560` · `financial/nfse_detail_screen.dart:324` (DTO `taskSerialNumber`, **—**) · `changelog/changelog_labels.dart:261,347` (§5.9).

**Comentários que afirmam o contrário de DD1** (atualizar no P24; não é código, mas engana quem lê): `linked_task_card.dart:17-19` ("o de série é o da ordem de serviço"); `task_form_screen.dart:89-91` ("a Task holds a single globally-`@unique` `serialNumber`"); `core/attention/attention_rules.dart:15`; `list/list_scaffold.dart:113`.

**Tutorial** (`features/tutorial/scenes/scene_task_detail.dart:302`, `steps/steps_task_detail.dart:24`, `steps/steps_cronograma.dart:60,70`): dado fictício e texto; nada muda.

### 7.5 Testes do app

| Arquivo:linha | Muda? |
|---|---|
| `test/core/attention/attention_engine_test.dart:122,218,228,236,250,378,503` | não (o snapshot fica `serialNumber`, §5.8) |
| `test/features/attention_surfaces_test.dart:114,133,157-166,274` | não; `_taskPredicatePaths` continua listando `'serialNumber'` |
| `test/features/financial/billing_row_test.dart:23`; `billing_approval_plan_test.dart:27,82,100`; `covered_vehicles_test.dart:22` | fixtures JSON com série no topo. **Manter** (provam a leitura legada) e **duplicar** com série em `implement` |
| `test/features/financial/nfse_discriminacao_test.dart:40,172`; `billing_approval_blockers_test.dart:55`; `vehicle_combinations_test.dart:15,28,44` | não (constroem o objeto de domínio, não JSON) |
| **novo** `task_json_contract_test.dart` (P02) | série no topo × em `implement` × nos dois → mesmo `Task.serialNumber` |

---

## 8. Código morto que cita a série: apagar, não migrar

| Onde | Prova |
|---|---|
| web `hooks/production/task/use-task-form-url-state.ts` (inteiro) | único uso é o re-export `hooks/production/use-task.ts:754` |
| web `components/production/task/schedule/duplicate-task-modal.tsx` (inteiro) | `DuplicateTaskModal` não é importado; as 5 telas usam `modals/task-duplicate-modal` |
| web `utils/invoice-pdf-generator.ts` (inteiro) | nenhum importador |
| app `lib/features/production/budget_report_pdf_generator.dart` (`generateBudgetReportPdf`) | nenhum chamador (o arquivo irmão `budget_report_pdf_merge.dart` só o cita em comentário) |

---

## 9. Ordem sugerida nos clientes (encaixe nos pacotes do v1)

| Passo | Onde | O quê | Pré-condição |
|---|---|---|---|
| 1 | app **P02** (OTA) | leitura tolerante da série nos 3 `fromJson` + cabeçalho de versão + teste de contrato | nenhuma; **antes** de a API mudar |
| 2 | API (outro relatório) | coluna-sombra + gatilho (ou camada de tradução), A1–A11 | P02 publicado e adotado |
| 3 | web | `taskSerial()` + troca das leituras (§5.3-§5.6), `ORDER_BY_PATH_MAP`, `use-table-state`, histórico, aerografia; includes que dependiam do escalar | API aceitando `implement.serialNumber` em include/orderBy |
| 4 | web | formulários C1–C4 com `implement` sempre; `task-edit-form`, lote, detalhe inline, orçamento `[taskId]` | API aceitando `implement.serialNumber` na escrita |
| 5 | app **P24** | escrita C6/C7 e edição com `implement`; `orderBy` da Agenda | idem |
| 6 | web | regra R3b para `implement.serialNumber`; rótulos do changelog do implemento | — |
| 7 | web + app | apagar o código morto da §8 | — |
| 8 | R-D (API) | derrubar a coluna-sombra e a tradução da escrita no topo | contador de uso zerado há 14 dias (`PLANO.md:824`) e app mínimo ≥ P24 via 426 |

**Guardas a criar antes (no espírito de G0..G18 do v1):**
- **GS1** (web, CI): `rg "\.serialNumber\b" src --glob '!*.test.*'` fora de `utils/task.ts`, dos tipos de DTO listados em A7 e dos homônimos (§5.1, última linha) **falha**. Catraca: o número só desce.
- **GS2** (app, teste): o `task_json_contract_test` da §3.3.
- **GS3** (API, e2e contra o app velho): gravar pelo corpo do app 1.4.1 (`PUT /tasks/:id {serialNumber}`) e reler. A série tem de estar no implemento e no espelho, nunca descartada com 200.
- **GS4** (API, e2e): `GET /tasks?orderBy[0].forecastDate.sort=asc&…&orderBy[2].serialNumber.sort=asc&orderBy[2].serialNumber.nulls=last`, **a URL exata da Agenda**, responde 200 e ordenado.

---

## 10. Divergências e achados laterais (FATO), para decidir no mesmo pacote

| # | Achado | Onde | Efeito |
|---|---|---|---|
| L1 | Criação em lote só aceita série **numérica** | web `task-create-form.tsx:72`, `budget/create.tsx:156`, `serial-number-range-input.tsx:25` (`number[]`); app aceita texto | 436 séries existentes (`37772-RETRAB`, chassi usado como série) só nascem pela edição, pelo app ou pelo portal |
| L2 | **Quatro validações diferentes** para a mesma série | web interno `^[A-Z0-9-]+$` (`schemas/task.ts:1197,1346`); portal requisição máx. 60 livre (`solicitacao-schema.ts:324`); portal identificação máx. 120 livre (`veiculo-identidade-card.tsx:252`); app só maiúscula (`task_edit_screen.dart:604-610`) | 42 séries legadas reprovam a regex do web. Com a série no implemento, vale unificar numa regra só do implemento (§11) |
| L3 | Campo "Número de Série" editável no faturamento que não grava | `billing-step-task.tsx:163-180` (INFERÊNCIA, §5.4) | digitação perdida sem aviso |
| L4 | Número do documento público com recuo para a série | `pages/public/budget/[id].tsx:292` | contradiz a regra "o número é o do orçamento" do próprio repo |
| L5 | "OS #série" e "Ref. OS <série>" tratam a série como número da O.S. | `related-invoices-card.tsx:54`, `invoice-detail-dialog.tsx:64`, `billing-document-previews.tsx:295`; app `billing_approval_sheet.dart:208`; a prévia espelha o boleto do servidor | com DD1 a série é **do implemento**; o rótulo passa a mentir. DD5 manda não mexer na palavra da NF sem o dono |

---

## 11. Perguntas ao dono (curtas, com recomendação)

1. **Na janela, a API mantém `Task.serialNumber` como cópia só de leitura, preenchida pelo implemento, até o app antigo sair?** *Recomendo sim:* protege o app instalado e as abas velhas do web em ordenação, busca e listas sem traduzir rota por rota. A coluna cai no R-D.
2. **"OS #78000" e "Ref. OS 78000" (fatura, boleto, prévia da NFS-e): o que a série é, para o cliente?** *Recomendo manter a palavra até você decidir (DD5)*; se for trocar, "Série 78000". Muda junto no servidor e nas prévias.
3. **A série vira texto livre em todas as portas (portal e interno), ou vale a regra "maiúsculas, números e hífen"?** *Recomendo uma regra só no implemento:* maiúsculas, números, hífen e **espaço interno**, até 30 caracteres, sem espaço nas pontas. Corrigir as 5 com espaço sobrando e as 42 fora do padrão na migração.
4. **Criar em lote com série alfanumérica (ex.: `37772-RETRAB`)?** *Recomendo aceitar texto* no campo de séries do web (hoje só número), como o app e o portal já aceitam.
5. **O campo "Número de Série" do faturamento deve gravar ou virar só leitura?** *Recomendo só leitura:* série se corrige na tarefa e no portal, não na cobrança.
6. **Posso apagar os 4 arquivos mortos da §8 no mesmo pacote?** *Recomendo sim.*
7. **O binário do app em produção é gerado pelo Shorebird (o `shorebird.yaml` não está no repositório)?** Se não for, o P02 vira release nativa e a janela precisa ser mais longa.

---

## 12. Riscos (ranqueados)

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | A Agenda do app instalado dá **500** porque `orderBy[2].serialNumber` chega ao Prisma sem a coluna | alta se nada for feito | **crítico**: a tela principal do chão de fábrica some | coluna-sombra (Q1) ou tradução de orderBy (A4) + GS4 |
| R2 | Série digitada no app velho ou em aba velha do web **some com 200** (`taskUpdateSchema` não strict) | alta | alto (dado perdido, ninguém percebe) | A3 + GS3; nunca tirar `serialNumber` do topo do schema antes do R-D |
| R3 | IDENTIFICADOR vira "—" em ~98% das linhas no app instalado | alta sem espelho | alto (operação cega) | A1 + P02 antes da API |
| R4 | Tarefa nasce **sem implemento** (C3, C6, C7, portal) e quebra a premissa DD1 (arte, porta, medida sem onde morar) | certa, se só o cliente garantir | alto | A9 no servidor + CHECK/guarda de contagem `Task` × `Implement` pós-deploy |
| R5 | `select` explícito (`barracoes/index.tsx:107`, `billing/details/[id].tsx:316`) **descarta a chave nova em silêncio** e a tela perde a série sem erro | média | médio | A5; na troca, pedir `implement.select.serialNumber` e testar a tela |
| R6 | Reenviar a série junto com o objeto `implement` em toda edição dá **400** nas 42 séries legadas fora da regex | média | médio (edição de placa travada sem motivo aparente) | P4: só chave suja; regex só quando a série muda |
| R7 | Evento `task.field.serialNumber` deixa de disparar quando a série passa a ser escrita no implemento: **37 preferências** e a configuração param sem aviso | média | médio | A10 + teste de notificação na troca de série |
| R8 | Falso positivo do R3b "Entrada sem placa" no web quando o espelho cair | média | baixo (ruído, mas ensina a ignorar) | trocar a regra no passo 6 da §9, antes do R-D |
| R9 | Renomear ids de coluna ou campo (`serialNumber`, `identificador`, `serialNumberOrPlate`) na limpeza apaga preferências gravadas (§1.1) | baixa | médio | P1 + revisão do diff |
| R10 | O espelho sair como objeto, não string, e derrubar o parse do app (`as String?` lança `TypeError` e a lista inteira falha) | baixa | alto | contrato do espelho = string ou null; GS2 no lado do app; teste de contrato na API |
| R11 | Web velho em aba aberta (sem persistência do react-query) grava pelo formato antigo por horas | alta | baixo com A3 | A3 + handshake `X-Min-Web-Build` (v1) |
