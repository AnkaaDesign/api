# Nomenclatura: `truck` → `implement`, migração COMPLETA (DD13, 24/09/2026)

**Decisão do dono (24/09, durante o P11a):** "não quero nenhum valor antigo, nem
mesmo para compatibilidade; será uma migração completa, com atualização em tudo de
uma vez". Isso **substitui** a janela bilíngue do plano (§5.4, D-04, DD5 na parte
"janela bilíngue truck/implement"): API, web, app Flutter e AnkaaAero passam a
falar SÓ o nome novo, e sobem **juntos** num deploy só. Os dados gravados com o nome
velho migram no banco, na mesma release. O app instalado que não atualizar leva
**426 "Atualize o app"** (G13 ligado no mesmo deploy, não na R-C).

Este arquivo é o **contrato**: toda troca de nome nos quatro clientes segue esta
tabela. Nome fora da tabela que contenha `truck`/`Truck`/`TRUCK`/`caminhão` é
defeito, salvo as exceções do fim (que NÃO são o nome antigo do implemento).

## 1. Regra mecânica dos identificadores

| Antes | Depois |
|---|---|
| `truck` | `implement` |
| `Truck` | `Implement` |
| `TRUCK` | `IMPLEMENT` |
| `trucks` (palavra sozinha, variável) | `implementList` (`implements` é palavra reservada em TS/JS) |
| `trucks` dentro de nome composto (`sortedTrucks`, `trucksInLane`) | `…Implements…` (`sortedImplements`, `implementsInLane`) |
| `TruckImplement…` (dobrado, ex. `createOrUpdateTruckImplementMeasure`) | um só `Implement…` (`createOrUpdateImplementMeasure`) |
| `caminhao` / `caminhoes` em identificador | `implemento` / `implementos` |
| campo `implementType` do implemento | `type` |

Textos de tela que falam da ENTIDADE: "Caminhão" → "Implemento" (ex.: "Placa do
Caminhão" → "Placa do Implemento", "Vaga do Caminhão" → "Vaga do Implemento",
"Total de Caminhões" → "Total de Implementos"). Onde o texto fala do veículo
físico que chega à empresa (o caminhão que traz o implemento), avaliar caso a caso.

## 2. Banco (Prisma e dados gravados)

| O quê | Antes | Depois | Como |
|---|---|---|---|
| model / tabela | `Truck` | `Implement` | M1 (feito) |
| coluna | `Truck.implementType` | `Implement.type` | M1 (feito) |
| enum | `TruckCategory` | `ImplementCategory` | M1 (feito) |
| enum (tipo) | `TRUCK_SPOT` | `IMPLEMENT_SPOT` | `ALTER TYPE … RENAME` (migração de nomenclatura) |
| valor de enum | `ChangeLogEntityType.TRUCK` | `ChangeLogEntityType.IMPLEMENT` | `ALTER TYPE … RENAME VALUE` (todas as linhas acompanham) |
| relação | `Task.truck` | `Task.implement` | M1 (feito) |
| inversas | `ImplementMeasure.trucks{Left,Right,Back}Side`, `File.truckVinPlates` | `implements{Left,Right,Back}Side`, `implementVinPlates` | M1 (feito) |
| histórico | `TaskFieldChangeLog.field` `truck.<campo>` (e `truck.implementType`) | `implement.<campo>` (`implement.type`) | `UPDATE` (+ `fieldNormalized`) |
| histórico | `ChangeLog.field` `implementType` das linhas `IMPLEMENT` | `type` | `UPDATE` |
| histórico | `ChangeLog.metadata.copiedFields` com o token `truck` | `implement` | `UPDATE` jsonb |
| avisos | `NotificationConfiguration.key/eventType` `task.field.truck.<campo>`, `truck.movement_request` | `task.field.implement.<campo>` (`implementType` → `type`; o consolidado `implementMeasure` → `measures`), `implement.movement_request` | `UPDATE` no lugar (preserva ids e preferências) + seed |
| eventos | campo de evento/aviso `truck.<campo>`, `truck.implementMeasure` | `implement.<campo>`, `implement.measures` (o evento tem o MESMO nome do campo do histórico) | código |
| avisos | `NotificationConfiguration.metadata.field` `truck.<campo>`, nome/descrição/modelos com "Caminhão" | `implement.<campo>`, "Implemento" | `UPDATE` + seed |
| avisos enviados | `Notification.metadata.configKey/fieldName` | nomes novos | `UPDATE` jsonb |
| preferências de tela | `Preferences.*Web/*Mobile`: ids de coluna e filtros (`truckCategory`, `truckSpot`, `truckCategories`, …) e o filtro `hasTruck` | regra da §1 (`implementCategory`, `implementSpot`, `implementCategories`); `hasTruck` → `implementIdentified` | `UPDATE` do texto do JSON; o valor exato `"truck"` (nome de ÍCONE do painel) NÃO muda |
| Atenção | `AttentionAck.entityType = 'TRUCK'` | `'IMPLEMENT'` | `UPDATE` |

Migração: `prisma/migrations/20260930120060_implemento_nomenclatura_completa` (idempotente; o texto das 19 configurações de aviso que mudaram é gerado do registro, byte a byte).

**Não migra (não é nomenclatura):** texto de negócio digitado por gente que fala do
caminhão de verdade (nome de cliente "Cipriano Caminhões", nome de arquivo,
descrição de NF, observação de O.S., motivo de adiamento "o caminhão não chegou"),
e o TEXTO dos avisos já enviados (`Notification.title/body`, `channelTemplates`):
é o registro do que a pessoa recebeu naquele dia.

## 3. API — rotas, consultas, corpos, multipart, respostas

| Contexto | Antes | Depois |
|---|---|---|
| rota | `/trucks…` | `/implements…` (sem alias) |
| query | `GET /implements/garages-availability?truckLength&excludeTruckId` | `?implementLength&excludeImplementId` |
| corpo | `POST …/batch-update-spots {updates:[{truckId, spot}]}` | `{updates:[{implementId, spot}]}` |
| corpo | `POST …/request-movement {truckId}` | `{implementId}` |
| resposta | `currentTrucks`, `truckLength` | `currentImplements`, `implementLength` |
| rota | `/implement-measure/truck/:truckId[/batch|/:side]` | `/implement-measure/implement/:implementId[/batch|/:side]` |
| rota + corpo | `POST /implement-measure/:id/assign-to-truck {truckId, side}` | `POST /implement-measure/:id/assign-to-implement {implementId, side}` |
| resposta | uso da medida: `{ truckId, taskId, plate }` | `{ implementId, taskId, plate }` |
| query | `GET /layout-dimensions/:fileId?truckId=` | `?implementId=` |
| include/select/where/orderBy | `truck`, `implementType` | `implement`, `type` |
| corpo da tarefa | `truck: {…, implementType}` | `implement: {…, type}` |
| filtros da lista de tarefas | `hasTruck`, `truckIds`, `truckCategories` | `implementIdentified`, `implementIds`, `implementCategories` |
| painel de produção | query `includeTrucks`; resposta `truckMetrics {totalTrucks, trucksInProduction, trucksByManufacturer, trucksByPosition}` | `includeImplements`; `implementMetrics {totalImplements, implementsInProduction, implementsByManufacturer, implementsByPosition}` |
| multipart (tarefa e portal) | `truckVinPlate` | `implementVinPlate` |
| `fileContext` / `entityType` de upload | `truckVinPlate`, `truck` | `implementVinPlate`, `implement` |
| requisição do portal (resposta) | `truckId` | `implementId` |
| entidade da Atenção | `TRUCK` | `IMPLEMENT` |
| contrato exportado (G5) | `TRUCK_CATEGORY`, `TRUCK_SPOT` | `IMPLEMENT_CATEGORY`, `IMPLEMENT_SPOT` |
| valor de entidade | `ENTITY_TYPE.TRUCK`, `CHANGE_LOG_ENTITY_TYPE.TRUCK` | `IMPLEMENT` |

## 4. Exceções (NÃO são o nome antigo do implemento — ficam)

| O quê | Por quê |
|---|---|
| valores de categoria `TRUCK` e `BITRUCK` (`ImplementCategory`) | é o TIPO do caminhão que leva o implemento (Toco, Truck, Bitruck, Carreta): vocabulário do mercado, não o nome da entidade |
| `TruckManufacturer` / `TRUCK_MANUFACTURER` (tinta) | montadora do cavalo (Scania, Volvo): a cor de fábrica é do caminhão, não do implemento |
| Truck Studio (`truck-studio`, `truckStudio`) | nome da ferramenta 3D do site/web |
| JSON selado dos documentos JÁ assinados (`SignatureEnvelope.quoteSnapshot` v1–v4 com `truck` no singular) e o leitor que o entende (`quote-snapshot.service.ts`, `quote-diff.ts`, `portal-frozen-document.ts`) | mudar uma letra do JSON selado muda o hash e invalida a assinatura (G11); documento novo não escreve `truck` |
| migrações já aplicadas (`prisma/migrations/**`) e o ensaio da R-B | registram o que o banco era |
| a palavra-chave `caminhao` na normalização de texto da conciliação | casa com o texto REAL das notas e extratos |
| o ícone `"truck"` (glifo) nas preferências de painel e `IconTruck`/`TablerIcons.truck` | é o desenho do ícone, não o nome da entidade |

## 5. Série: SÓ no implemento (decisão do dono, 25/09 — "tirar tudo agora")

A série é `Implement.serialNumber` (única), e NADA mais a guarda. Saem juntos, na
mesma release: a coluna-espelho `Task.serialNumber` (+ `serialNumberNormalized`,
o gatilho que a copiava e o que a protegia) e a série no TOPO do corpo da tarefa.

| Contexto | Antes | Depois |
|---|---|---|
| escrita (criar, editar, lote, lote com orçamento, duplicar) | `serialNumber` no topo do corpo | `implement: { serialNumber }` (o topo é 400: o schema é estrito) |
| faixa de séries | `serialNumberFrom`/`serialNumberTo` | iguais (a API cria uma tarefa por série, cada uma com `implement.serialNumber`) |
| leitura numa tarefa (objeto do Prisma: `GET /tasks`, includes aninhados) | `task.serialNumber` | `task.implement.serialNumber` — o cliente PEDE o implemento (`implement: { select: { serialNumber: true, … } }` ou `implement: true`) |
| filtro | `where: { serialNumber }` (e `task: { serialNumber }` aninhado) | `where: { implement: { serialNumber } }` |
| ordenação | `orderBy: { serialNumber: { sort, nulls } }` (a Agenda do app) | `orderBy: { implement: { serialNumber: { sort, nulls } } }` |
| busca livre (`searchingFor`) | — | igual: a API busca em `implement.serialNumberNormalized` |
| DTO montado pela API (portal, faturamento, NFS-e, conciliação, painéis, `taskSerialNumber`, `vehicles[].serialNumber`…) | chave do DTO | **a mesma chave**; muda só a fonte, lá dentro |

Ficam, por decisão S-5 do plano (nome do CAMPO de identidade, não a coluna): o
campo `serialNumber` gravado no histórico da tarefa (`TaskFieldChangeLog`/
`ChangeLog` TASK — é o que o aditivo da assinatura lê) e a chave de aviso
`task.field.serialNumber`; e, selado, o `serialNumber` dentro dos documentos já
assinados.
