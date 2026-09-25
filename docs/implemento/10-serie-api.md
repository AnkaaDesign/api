# 10 — O número de série vai para o implemento (API) e toda tarefa tem exatamente 1 implemento

> Recorte: **DD1** (23/09) na API. Mover `Task.serialNumber` para `Implement.serialNumber` e garantir que **toda tarefa tem exatamente 1 implemento**.
> Base lida: `api` em `feat/portal-do-responsavel` (`ad3c65d4`), banco LOCAL (clone de produção com dado real até ~30/06/2026, mais 75 tarefas de QA/e2e criadas depois de 01/07). Somente leitura: nada foi editado, migrado nem gerado.
> Convenção: **[FATO]** foi conferido no código ou no banco, com `arquivo:linha`. **[INF]** é inferência ou recomendação.
> Este relatório **substitui** a D-02 do plano v1 (`PLANO.md:86`, "fica na tarefa nesta entrega") e a recomendação 3 de `01-dados-e-migracao.md:21,760`.

---

## 0. Resumo

1. **Tamanho [FATO].** Excluídos os homônimos (série de certificado ICP, de SSD e de item de estoque), a API tem **502 linhas em 99 arquivos de `src/`**, **153 linhas em 23 arquivos de `tests/`**, cerca de 34 linhas em 11 arquivos de `scripts/` e **257 linhas em `prisma/`**: 2 no schema, 4 nas migrations e 255 nos seeds, das quais 248 são templates de notificação com `{{serialNumber}}`. Em `src/`, por forma: **98** `serialNumber: true` (select explícito), **185** leituras `.serialNumber`, **11** buscas por `serialNumberNormalized`, **32** linhas de faixa (`serialNumberFrom/To`), **2** em SQL cru, 27 em comentários. Para medir o raio de explosão nos clientes: o web tem 431 ocorrências em 110 arquivos, o app Flutter 104.
2. **Escritores [FATO].** Só **6 caminhos de código gravam a série**: criação da tarefa (repositório), atualização da tarefa (repositório), faixa de séries (vira criação), requisição do portal, identificação do portal e rollback do changelog. Os outros ~490 usos só **leem**.
3. **Onde a série viaja em JSON persistido [FATO].** A série está no snapshot do documento assinado (`vehicles[].serialNumber`), mas **fora do recorte material**. Mover a coluna **não muda o hash** se o valor lido for o mesmo. Nos 25 veículos de envelopes RUNNING/COMPLETED do clone, a série congelada bate 100% com a tarefa hoje. O changelog (113 linhas `TASK/serialNumber`), as notificações (chave `task.field.serialNumber`, 37 preferências de usuário) e as `Preferences` (chave de coluna `serialNumber`) guardam o **nome** do campo como identificador. **Recomendação: manter o nome e não reescrever histórico.**
4. **Dados [FATO].** Há 2.253 tarefas e 575 `Truck`. **1.678 tarefas não têm `Truck`**, todas COMPLETED, criadas entre 17/07/2023 e 16/01/2026. São 2.013 séries preenchidas, 240 nulas e 0 vazias, com **0 duplicatas** mesmo depois de `lower/trim`. O histórico está sujo: das 1.567 séries de tarefas sem `Truck`, **204 são placas**, 44 são chassi (`CH-…`), 63 são marcadores (`--7`, `.`, `1/4`) e 18 são texto (`IBIPORÃ`, `USADO`). Só 9 séries violam o regex atual `^[A-Z0-9-]+$`, todas COMPLETED.
5. **Estratégia recomendada [INF]: "a verdade vai para o implemento, a tarefa fica com um ESPELHO por gatilho durante a janela".** A migração `M1s` (entre o M1 e o M2 do v1):
   - cria o implemento que falta em cada tarefa (`spot NULL`);
   - copia a série e cria nele o `@unique`, a coluna gerada e o índice GIN;
   - transforma `Task.serialNumber` em espelho **somente leitura**, mantido por gatilho;
   - instala a garantia "toda tarefa tem implemento" como `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED`.

   Na R-B o código muda **só os 6 escritores**, as 4 checagens de unicidade e 3 pontos de semântica (rollback, datas do aditivo e `truck: null`). Os ~490 leitores e os clientes instalados continuam funcionando sem tradutor. Os leitores migram sob catraca, e o espelho sai na R-D.

   A alternativa (mover seco com tradutor na API, como o v1 fez com `truck`) toca **~500 pontos e os dois clientes num único deploy**. Ela também herda três classes de defeito silencioso: select explícito que descarta, rótulo que recua da série para a placa e SQL cru com `catch → []` (§4.2).
6. **Três armadilhas que o plano precisa fechar mesmo sem esta mudança [FATO]:**
   - `PUT /tasks/:id` com `truck: null` **apaga o caminhão** (`task.service.ts:2562-2645`). Depois do DD1, isso apagaria a série e quebraria a invariante.
   - `PUT /trucks/:id` aceita o setor **WAREHOUSE** (`truck.controller.ts:229-236`). Se a série entrar no `implementUpdateSchema`, o almoxarifado ganha edição de série, que hoje não tem (`task.permissions.ts` só dá `meta` a ele).
   - Os caminhões criados pelo portal nascem **"no pátio"** (`spot` default `YARD_WAIT`): 43 no clone desde 19/09. Com "toda tarefa cria implemento", o default passa a valer para **toda** criação que não passar `spot` explicitamente.

---

## 1. Decisões propostas deste recorte

| # | Decisão | Recomendação | Motivo |
|---|---|---|---|
| S-1 | Nome e tipo da coluna nova | `Implement.serialNumber String? @unique` + `serialNumberNormalized String?` (coluna gerada, fora do Prisma) + GIN trigram | Mesmo contrato de hoje (`schema.prisma:2343,2440`; `20260624150000…/migration.sql:254,365`) |
| S-2 | Transição | **Espelho por gatilho** em `Task.serialNumber` da R-B até a R-D (§4.2) | Muda 6 escritores e não ~500 leitores; clientes instalados intactos; reversão sem perda |
| S-3 | Unicidade | **Só no implemento.** `Task_serialNumber_key` cai em `M1s` | Duas unicidades espelhadas dão P2002 com alvo confuso e travam a troca de séries entre duas tarefas |
| S-4 | "Toda tarefa tem 1 implemento" | FK continua em `Implement.taskId @unique` + `CONSTRAINT TRIGGER` diferido nos dois lados + criação sempre aninhada no repositório | O Prisma não expressa obrigatoriedade do lado da Task; inverter a FK é outro rework (§5.3) |
| S-5 | Changelog da série | Continua `entityType = TASK`, `field = 'serialNumber'`, `entityId = taskId` | Preserva 113 linhas de histórico, o rollback, as datas do aditivo e a chave de notificação |
| S-6 | Nome no JSON congelado | O snapshot continua gravando `vehicles[].serialNumber` | Chave mudada = hash total mudado = `SNAPSHOT_DRIFTED` em todo envelope vivo |
| S-7 | Séries sujas do histórico | Migrar **como estão**, sem normalizar | 15 pares colidiriam se normalizados (`0002-2` × `00022`, `1/4` × `--14`) |
| S-8 | `Implement.spot` | Tirar o `@default(YARD_WAIT)` (`schema.prisma:2536`) | Com criação universal, o default põe veículo não chegado "no pátio" |
| S-9 | Quem grava a série | Só por `identity` (tarefa) ou pelo portal (`WRITE_VEHICLE_IDENTITY`); **nunca** por `PUT /implements/:id` | Evita dar ao WAREHOUSE um poder que ele não tem |

---

## 2. Inventário (API)

### 2.1 Totais por classe

| Classe | Linhas (aprox.) | Arquivos | Risco ao mover |
|---|---:|---:|---|
| A. Banco: schema, índice único, coluna gerada, GIN, `omit` global | 7 | 4 | alto (DDL) |
| B. **Escritores** (gravam a série) | 14 | 6 + scripts/testes | **alto**: se esquecido, 500 (com espelho) ou valor perdido (sem espelho) |
| C. Checagem de unicidade e tradução de P2002 | 20 | 5 | médio |
| D. `where` com a série (igualdade, `null`, `in`, `contains`) | 15 | 9 | médio (500 com `z.any()` sem espelho) |
| E. Busca textual (`serialNumberNormalized`) e SQL cru | 13 | 12 | **silencioso** (`paint.service.ts` devolve `[]`) |
| F. `orderBy` (schemas, padrão do controller, portal) | 10 | 7 | médio |
| G. `select`/`include` explícito com `serialNumber: true` | 98 | ~45 | **silencioso**: sem espelho, o campo some e o rótulo recua para a placa |
| H. Rótulos de identidade com recuo (`série \|\| placa \|\| nome`) | ~45 | ~25 | **silencioso**: NFS-e, boleto, recibo, aditivo, notificações |
| I. Assinatura (snapshot, diff, lacuna tardia, aditivo, dossiê, guarda do portal) | ~45 | 7 | alto (hash) |
| J. Changelog, tracker, rollback, notificação por campo | ~25 | 8 | **silencioso** (a notificação some) |
| K. Notificações e WhatsApp (payload `serialNumber`) | ~75 | 12 | silencioso |
| L. Portal (read, projection, request, identity, schemas) | ~80 | 9 | alto (contrato público) |
| M. Faturamento, NFS-e, boleto, conciliação, bônus, dashboard, busca global | ~120 | 25 | silencioso (rótulos) |
| N. Permissão, whitelist, pipe de query | 5 | 4 | 403/400 |
| O. Scripts `src/scripts` + `scripts/` + seeds | ~60 + 255 | 17 + 2 | quebra em runtime (fora do tsc do build) |
| P. Testes | 153 | 23 | quebram (e devem quebrar) |

### 2.2 A — Banco

| Onde | O quê | [FATO] |
|---|---|---|
| `prisma/schema.prisma:2343` | `serialNumber String? @unique` na `Task` | |
| `prisma/schema.prisma:2440` | `serialNumberNormalized String?` (coluna gerada) | |
| `prisma/migrations/0_init/migration.sql:1160,2623` | coluna e `CREATE UNIQUE INDEX "Task_serialNumber_key"` | btree único no banco |
| `prisma/migrations/20260624150000_accent_insensitive_search/migration.sql:254` | `GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED` | conferido em `pg_attribute`: `attgenerated = 's'` |
| `…/migration.sql:365` | `Task_serialNumberNormalized_trgm_idx` GIN `gin_trgm_ops` | conferido em `pg_indexes` |
| `…/migration.sql:296-298` | `Truck.plateNormalized`/`chassisNumberNormalized` gerados, **sem GIN** | só btree em `plate`; a busca global faz `contains` em placa/chassi sem índice trigram |
| `src/modules/common/prisma/prisma.service.ts:268-272` | `omit.task.serialNumberNormalized` (coluna de filtro nunca sai na resposta) | |
| `src/modules/common/prisma/prisma.service.ts:313-316` | `omit.truck` | ⚠️ depois do rename, a chave vira `implement` e ganha `serialNumberNormalized`. Chave de modelo inexistente no `omit` global quebra o construtor do cliente [INF: validação do Prisma 6.19] |
| catálogo | nenhuma view, função ou gatilho referencia a série | `pg_views`, `pg_matviews` e `pg_proc` vazios para `%serialNumber%` |

### 2.3 B — Escritores (a lista completa)

| # | Onde | Como grava hoje | Depois |
|---|---|---|---|
| W1 | `task/repositories/task-prisma.repository.ts:915,960` (`mapCreateFormDataToDatabaseCreateInput`) | `taskData.serialNumber = serialNumber` | `taskData.implement = { create: { …, serialNumber } }` **sempre** (§5) |
| W2 | `task-prisma.repository.ts:1234,1274` (`mapUpdateFormDataToDatabaseUpdateInput`) | `updateData.serialNumber = serialNumber` | `updateData.implement = { update: { serialNumber } }` (`upsert` enquanto houver tarefa sem implemento, o que deixa de existir depois de `M1s`) |
| W3 | `task/task.service.ts:1152-1164` → `:1869-1925` (`createTasksFromSerialRange`) | `taskData.serialNumber = String(serialNum)` (`:1909`) e depois `batchCreate` → W1 | Sem mudança de forma: passa por W1 |
| W4 | `people/portal/portal-request.service.ts:874-906` (`criarVeiculo`) | `tx.task.create({ data: { serialNumber, …, truck: { create: {…} } } })` (`:880`, `:895-904`) | `implement: { create: { serialNumber, …, spot: null } }`. Hoje o `truck.create` **não passa `spot`** e o veículo nasce `YARD_WAIT` |
| W5 | `people/portal/portal-identity.service.ts:523-534` (`gravar`) | `tx.task.update({ data: { serialNumber } })` + `auditar(TASK, 'serialNumber')` | `tx.implement.update(...)`. O `auditar` continua TASK (S-5). O bloco "o caminhão pode não existir" (`:545-570`) vira código morto |
| W6 | `task/task.service.ts:12117-12160` (rollback genérico, campo `serialNumber`, conversão em `:11290`) | `tasksRepository.updateWithTransaction(tx, id, { serialNumber: old })` → W2 | Passa por W2 **e** precisa de checagem de unicidade antes: hoje o conflito vira P2002 e 500 |
| — | `task.service.ts:10918-10934` (rollback de entidade TRUCK) | `tx.truck.update({ [field]: old })`, sem checagem de unicidade | Não se aplica à série se S-5 for mantida. Se a série for auditada como TRUCK, este ramo passa a gravá-la sem checagem de unicidade (P2002 → 500) |
| Scripts | `src/scripts/seed-test-billing-task.ts:115-120`, `scripts/seed-portal-pagamento-demo.ts:150`, `scripts/test-signature-e2e.js:131`, `scripts/test-signature-deletion.js:105`, `scripts/make-real-signature-test.js:109`, `src/scripts/nfse-homolog-test.ts:105`, `src/scripts/setup-painter-nfse-test.ts:162` | `task.create` direto, a maioria sem `truck` | Criar o implemento aninhado. Com o gatilho diferido, os que não criam **falham no commit**, que é o comportamento desejado |
| Testes | `tests/task-match-integration.test.ts:127-143,651-696`, `tests/billing-entity.test.ts:84`, `tests/orcamento-faturamento-a-db.test.ts:67` | `task.create({ serialNumber, serialNumberNormalized: norm(serial) })`: grava a coluna **gerada** à mão, porque o banco do teste vem de `db push` (`:22-26`) e lá ela é coluna comum | Idem. Ver o risco R-6 (`db push` não tem gatilho nem coluna gerada) |

`copyFromTask` **não** copia a série (`schemas/task-copy.ts:8-39` não tem o token) [FATO]. `budget.service` não cria tarefa: liga as existentes por `taskIds`. `batchCreateWithQuote` (`task.service.ts:2220-2310`) cria via `batchCreate` → W1 [FATO].

### 2.4 C — Unicidade

| Onde | O quê | Depois |
|---|---|---|
| `task.service.ts:10774-10784` (`validateTask`) | `task.findFirst({ where: { serialNumber, id: { not } } })` → 400 "Número de série já está em uso." | `implement.findFirst({ where: { serialNumber, taskId: { not } } })` |
| `portal-identity.service.ts:406-428` (`garantirUnicidade`) | idem, com `conflicts[]` | idem |
| `portal-request.service.ts:772-795` | `task.findMany({ where: { serialNumber: { in } } })` | `implement.findMany(...)` |
| `portal-request.service.ts:1119-1150` (`traduzirErro`) | P2002 com `meta.target` contendo `serialNumber` → 400 nomeado | Continua valendo: o nome do campo não muda [INF] |
| `schemas/portal-request.ts:558-620` (`colisoesNoPayload`) | duplicata dentro do próprio corpo | sem mudança |
| `common/filters/global-exception.filter.ts:83-107` | mapa de mensagem por campo **sem** `serialNumber` → "Este valor já está em uso no sistema." | Acrescentar `serialNumber: 'Este número de série já está em uso.'` (barato) |
| `budget.service.ts:1462-1466` | usa `tasks[0].serialNumber` só na mensagem de "número de orçamento já usado" | leitor (classe H) |

### 2.5 D — `where` com a série

| Onde | Forma | Observação |
|---|---|---|
| `schemas/task.ts:1271` (`taskWhereSchema`, `.strict()` em `:1387`) | `serialNumber: string \| { contains }` | Chave aceita no topo e vinda dos clientes. Sem espelho, exige tradutor, senão 500 "Unknown argument" |
| `schemas/task.ts:1347` | `truck: z.any()` | passthrough (armadilha do v1) |
| `common/attention/attention.service.ts:286,442` | `NO_SERIAL = { OR: [{ serialNumber: null }, { serialNumber: '' }] }` na regra "Entrada sem placa" | Com tradutor, `implement: { serialNumber: null }` **não casa tarefa sem implemento** (filtro de relação nula dá falso). Só é equivalente depois da invariante |
| `portal-identity.service.ts:417`, `portal-request.service.ts:783`, `task.service.ts:10778` | igualdade / `in` | unicidade (C) |
| `portal-read.service.ts:974` | `tasks.some.serialNumber contains insensitive` (lista de orçamentos do portal) | sem índice (não usa a normalizada) |
| `portal-read.service.ts:1425` | `serialNumber contains insensitive` (lista de veículos do portal) | idem |
| `production/purchase-order/purchase-order.service.ts:234` | `serialNumber contains insensitive` | idem |
| `src/scripts/relink-orphan-nfse.ts:100-101`, `scripts/seed-portal-pagamento-demo.ts:71-72,265-266` | **`findUnique({ where: { serialNumber } })`** | Quebra no tipo quando o `@unique` sai da Task. Vira `implement.findUnique(...)` com `select: { task }` |
| `src/scripts/fix-boletos-37438-37441.ts:31` | `invoice.task.serialNumber in` | script histórico |
| clientes | web: `schemas/task.ts:449`, `observation.ts:245`, `customer.ts:530`, `truck.ts:458` (`contains insensitive`); app: `attention_rules.dart:204` (`IsNull('serialNumber')`, avaliado **localmente** sobre o JSON da tarefa) | O app instalado lê `task.serialNumber` do JSON: sem espelho na resposta, a regra "Entrada sem placa" dispara em massa |

### 2.6 E — Busca textual e SQL cru

| Onde | Forma |
|---|---|
| `schemas/task.ts:1414` (`searchingFor` da tarefa) | `{ serialNumberNormalized: { contains } }` |
| `schemas/budget.ts:596` | `tasks.some.serialNumberNormalized` |
| `schemas/customer.ts:598` | `tasks.some.serialNumberNormalized` |
| `schemas/airbrushing.ts:629`, `observation.ts:258`, `layout.ts:355` | `task.serialNumberNormalized` |
| `schemas/truck.ts:245` | `task.serialNumberNormalized` (lista de caminhões) → vira campo do próprio implemento |
| `financial/billing/billing.service.ts:695` | `tasks.some.task.serialNumberNormalized` |
| `domain/search/search.service.ts:203` (busca global, por token) | `serialNumberNormalized` |
| `financial/reconciliation/receivable-task-match.service.ts:190` | idem (conciliação por tarefa) |
| **`paint/paint.service.ts:497-526`** | `$queryRaw` com `t1."serialNumber"`, `t2."serialNumber"` e `LEFT JOIN "Truck"`, dentro de `try/catch` que **devolve `[]`** (`:522-525`). Sem espelho, a busca de tinta por série fica vazia **sem erro**. O rename `Truck` → `Implement` já a quebra do mesmo jeito (`01` R-3) |

### 2.7 F — `orderBy`

| Onde | Forma |
|---|---|
| `schemas/task.ts:1163` | `serialNumber: orderByWithNullsSchema` (lista de tarefas) |
| `task/task.controller.ts:526` | padrão `[{ forecastDate: 'asc' }, { serialNumber: 'asc' }]` em `GET /tasks/in-preparation` |
| `schemas/airbrushing.ts:232,281` | `task.serialNumber` com nulls (coluna "Identificador") |
| `schemas/serviceOrder.ts:107` | `task.serialNumber` |
| `schemas/budget.ts:288,328` | `task.serialNumber`: aceito e **descartado de propósito** pelo repositório (comentário `:318-321`) |
| `portal-read.service.ts:278` | `VEHICLE_ORDER_BY.serialNumber` → `{ serialNumber: { sort, nulls: 'last' } }` (seção `VEHICLE`); `portal-read.controller.ts:118` expõe a chave pública `serialNumber` |
| `types/task.ts:818` | tipo |
| app | `task_schedule_view.dart:322-323`: `orderBy[2].serialNumber.sort=asc&…nulls=last` |

[FATO] A ordenação por relação de-um com `nulls` já roda em produção: `portal-read.service.ts:279`, `{ truck: { plate: vazioNoFim(dir) } }`. `{ implement: { serialNumber: { sort, nulls } } }` é a mesma forma.

### 2.8 G — `select` explícito (98 linhas)

Principais: `schemas/task.ts:83,639,707,928,970,1025,1063` (o v1 manda apagar `:634-1094`), `task-prisma.repository.ts:59,119,560`, `utils/quote-tasks.ts:640` (`QUOTE_COVERAGE_INCLUDE`), `signature-envelope.service.ts:572,8409`, `quote-snapshot.service.ts:436` (`truck: true`, escalares da tarefa implícitos), `budget-prisma.repository.ts:632`, `budget.service.ts:1414,1462,3228,3698,4064,5644`, `service-order.service.ts:1721,1757,1798,1834,3706,3740,3779,3813`, `service-order-prisma.repository.ts:188`, `dashboard-prisma.repository.ts:1823,3409,3453,3493,3562,3625,3666`, `bonus.service.ts:1089,2884`, `nfse-emission.scheduler.ts:364,422,787,843`, `sicredi-boleto.scheduler.ts:320,365,1620,2302`, `sicredi-webhook.service.ts:391`, `invoice-generation.service.ts:952,1001`, `invoice.service.ts:62`, `invoice-prisma.repository.ts:43,93`, `invoice.controller.ts:83,129`, `invoice-analytics.service.ts:1143`, `nfse.controller.ts:116,242`, `painter-nfse.service.ts:478`, `billing.service.ts:137,154,238,355`, `settlement-summary.ts:70,92,171`, `receivable-match.service.ts:1755,1773,2070,2090`, `receivable-task-match.service.ts:333,705`, `purchase-order.service.ts:119`, `paint-production.service.ts:877`, `portal-read.service.ts:207,872,1686,1701`, `portal-identity.service.ts:128`, `portal-request.service.ts:906`, `truck.service.ts:103`, `task.service.ts:6705,9921`, `task-notification.scheduler.ts:541`, `airbrushing-notification.service.ts:145`, `budget-payment.scheduler.ts:92`, `budget-status-cascade.service.ts:47`, `dossier-assembler.service.ts:345,980`, `search.service.ts:234`, `probe-*`/`nfse-diagnose` (scripts).

Duas vias de entrada de **clientes** com `select` repassado:
- `budget-prisma.repository.ts:377-393` repassa `tasks.select` do cliente ao Prisma. O app pede `tasks: { select: { …, serialNumber, truck: { select: { plate } } } }`. Sem espelho, isso dá 500 "Unknown field".
- `SELECT_WHITELIST.Task` (`include-access-control.ts:141-147`) lista `serialNumber`, e `validateSelect` **lança 403** em campo não listado (`:414-419`). A chave tem de continuar na whitelist durante toda a janela.

### 2.9 H — Rótulos de identidade com recuo (a classe silenciosa)

Hoje o identificador de um veículo em quase todo texto é "série, senão placa, senão nome". Se um `select` esquecer a série no lugar novo, **nada quebra**: o texto passa a mostrar a placa ou o nome. Isso vale para a NFS-e, o boleto, o recibo, o aditivo da assinatura e as notificações.

| Onde | Texto |
|---|---|
| `utils/task.ts:192-196` (`formatTaskIdentifier`) | série → placa → `#id` |
| `utils/quote-tasks.ts:391-399` (`coverageLabels`, espelhada em `web/src/utils/quote-tasks.ts`) | série → placa → nome |
| `purchase-order.service.ts:163`, `signature-envelope.service.ts:1882,4982,7746`, `task.service.ts:9928`, `budget.service.ts:372,1421`, `receivable-task-match.service.ts:1588-1591`, `portal-request.service.ts:856`, `paint-production.listener.ts:146,161`, `settlement-summary.ts:613,666` | idem |
| `integrations/nfse/elotech-oxy-nfse.service.ts:1412-1414,1429-1440,1582,1590` | NFS-e municipal: `vehicles[].serialNumber` e o recuo `Ref. OS ${serialNumber}` |
| `integrations/nfse/nfse-discriminacao.ts:40,92,116,148-157` | "de n série: X", "Série X", "(séries A a B)". Regra pura travada em `tests/nfse-discriminacao.test.ts` |
| `integrations/nfse/nfse-emission.scheduler.ts:502-634,907-1019` | monta `vehicles[]` e o `emitTask` |
| `integrations/nfse/painter/dps.builder.ts:453,522-532,545` | NFS-e nacional do pintor. **O comentário `:522-524` diz "o nº de série é da ORDEM DE SERVIÇO, não do veículo"**, o que o DD1 contradiz. O texto "Referente à ordem de serviço ${serialNumber}" (`:545`) continua, mas o comentário precisa mudar. A guarda `temVeiculo` é calculada por **campo** (placa, chassi, tipo) e não pela existência da linha, e tem de continuar assim: com o DD1 a linha sempre existe |
| `integrations/sicredi/sicredi-boleto.scheduler.ts:932-947` e `financial/invoice/invoice-generation.service.ts:1325-1335` | **informativo/mensagem** do boleto ("N.º serie: X", faixa de séries). [FATO] O `seuNumero` **não** usa série: NF → placa → id da parcela (`sicredi-boleto.scheduler.ts:803-828`) |
| `production/budget/budget-receipt.service.ts:88-169` | recibo: "Série X" |
| `common/signature/dossier/dossier-assembler.service.ts:1103` | dossiê: "No de serie X" |

### 2.10 I — Assinatura

| Onde | Papel | [FATO] |
|---|---|---|
| `quote-snapshot.service.ts:94-110` (`QuoteSnapshotVehicle.serialNumber`), `:176-182` (forma v1/v2 `task.serialNumber`) | chave congelada | 12 envelopes do clone ainda estão na forma v1/v2 |
| `quote-snapshot.service.ts:492-499` | `serialNumber: t.serialNumber ?? null` no `build` | passa a ler do implemento, **gravando a mesma chave** |
| `quote-snapshot.service.ts:553-555` | `hash(snapshot)` = sha256 do snapshot **inteiro** → `quoteSnapshotSha256` | a série **entra** neste hash |
| `quote-snapshot.service.ts:566-655` (`materialProjection`) | a série **não entra** (v5+: só `plate`; v1–v2: `plate` + `chassisNumber`) | mudar a série nunca invalida assinatura |
| `signature-envelope.service.ts:3836-3844, 4619, 5268, 6349` | hash inteiro diferente → `onQuoteContentChanged` → só `SNAPSHOT_DRIFTED` (cosmético) se o material bate | se a migração alterar **qualquer** valor de série lido, todo envelope vivo daquele orçamento ganha um evento de deriva na trilha |
| `quote-html.builder.ts:69,85,124,548-561` | lacuna tardia `serialNumber#taskId` ("a registrar", 8ch) | o maior valor do clone tem 18 caracteres (dado de QA). `min-width` e não `width`, então cabe |
| `utils/quote-tasks.ts:155` | `LATE_SLOT_FIELDS = ['serialNumber','plate','chassis']` | chave de âncora congelada no PDF, **não renomear** |
| `signature-envelope.service.ts:7708-7760` (aditivo) | compara `task.serialNumber` atual × congelado | passa a ler do implemento |
| **`signature-envelope.service.ts:7907-7927`** (`lateSlotRegistrationDates`) | busca a data no `ChangeLog` com `entityId = taskId`, `field = 'serialNumber'`; placa e chassi com `entityId = truckId` | **Best-effort, sem erro.** Se a série passar a ser auditada como TRUCK (contra S-5), o aditivo perde a data **em silêncio** |
| `quote-diff.ts:611-615,708-714,746` | diff cosmético `taskSerialNumber:<id>` | só leitura do snapshot |
| `portal-vehicle-identity.ts:62-67,106-112,141,151,235` + `portal-frozen-document.ts:122-170` | a guarda do documento congelado recusa (409) trocar uma série impressa enquanto há envelope RUNNING/COMPLETED | lê o **snapshot**, que não muda. Continua valendo |
| `signature-envelope.service.ts:745-755` | preflight: avisa placa/chassi faltando; série não é exigida | |

**Clone [FATO]:** envelopes RUNNING = 16 e COMPLETED = 3; 25 veículos neles, **25 com série congelada, 0 divergentes** da `Task.serialNumber` atual. Esta é a régua da migração (§4.5).

### 2.11 J — Changelog, tracker, rollback e notificação por campo

| Onde | O quê | Armadilha |
|---|---|---|
| `task.service.ts:6475-6500` (`fieldsToTrack`) | compara `existingTask[field]` × `updatedTask[field]` e grava `ChangeLog TASK/serialNumber` | **Sem espelho**, se o objeto carregado não trouxer a série no topo, `undefined === undefined` e o log **para de ser escrito sem erro** |
| `task-field-tracker.service.ts:79,185,225-236` | `TRACKED_FIELDS` com `'serialNumber'`: lê `oldTask.serialNumber`/`newTask.serialNumber` e dispara `task.field.serialNumber` | mesma armadilha; a notificação some |
| `utils/changelog-fields.ts:80,206,429,629,705`; `common/changelog/utils/changelog-helpers.ts:360,565,739` | rótulos "Número de Série" | manter a chave |
| `task.service.ts:11290`, `:12117-12160` | rollback de `TASK/serialNumber` | ver W6 |
| `common/notification/notification-preference.service.ts:539` | `eventType: 'task_serialNumber'` | chave persistida (37 linhas) |
| banco | `NotificationConfiguration.key = 'task.field.serialNumber'` (1 linha) | chave persistida |

### 2.12 K — Notificações e WhatsApp

Payload `serialNumber` em: `task/task.listener.ts:125-552` (9 eventos), `cut/cut.listener.ts:91-279` (5 eventos, título e corpo com "(série)"), `task/layout.listener.ts:87-224` (3), `budget-payment.scheduler.ts:156-187`, `airbrushing-notification.service.ts:166`, `notification-template-renderer.service.ts:76-81,391,429` (`context.serialNumber || context.task?.serialNumber`), `notification-dispatch.service.ts:1868,2130`, `templates/notification-template.service.ts:32-884` (10), `templates/template.types.ts:60-84`, `whatsapp/whatsapp-message-formatter.service.ts:58-161` ("*Série:* X"), `task-notification.service.ts:56`, `notification-configuration.service.ts:1180` (Handlebars `{{#if serialNumber}}`).

Os templates (`prisma/scripts/seed-notification-configs.ts`, 244 usos de `{{serialNumber}}`/`{{#if serialNumber}}`; 60 linhas de `NotificationConfiguration.templates` no banco) usam a **variável** `serialNumber` do contexto, e não a coluna. Basta o contexto continuar entregando essa variável. O `{{#if}}` **esconde** a ausência, então se ela sumir o sintoma é silencioso [FATO]. Os templates aprovados pela Meta **não** carregam série: `signature-whatsapp-templates.ts` e `responsible-notice-templates.ts` não têm nenhuma ocorrência [FATO].

### 2.13 L — Portal do responsável

| Arquivo | Linhas | Papel |
|---|---|---|
| `portal-identity.service.ts` | 128 (select), 326-347 (`apenasOQueMuda`), 389-428 (unicidade), 463, 523-534 (escrita) | **O responsável EDITA a série** (`PATCH /cliente/me/veiculos/:taskId/identificacao`, capacidade `WRITE_VEHICLE_IDENTITY`, `portal-identity.controller.ts:54,103-104`). Recusada só pela guarda do documento congelado. **Não há** trava por status (IN_PRODUCTION) nem por NFS-e emitida |
| `portal-request.service.ts` | 15-23, 127, 772-795, 856, 874-951, 1096, 1115-1150 | cria veículo com série (texto) |
| `schemas/portal-request.ts` | 17-28, 403-427 (`portalSerialSchema`: `trim().toUpperCase()`, até 100 caracteres, mesmo regex), 558-620 | |
| `schemas/portal-vehicle-identity.ts` | 116, 252 | |
| `portal-read.service.ts` | 207, 278, 872, 943, 974, 1425, 1686, 1701, 1800 | leitura, busca e ordenação (seção `VEHICLE`) |
| `portal-read.controller.ts` | 118 | chave de ordenação pública |
| `portal-projection.service.ts` | 181, 378, 457, 614 (`vehicleChips`), 695, 842 | projeção por seção |
| `portal-request.controller.ts` | 87 | contrato de erro `{ field: 'serialNumber' \| 'plate' }` |
| `portal-scope.service.ts` | — | **não** usa a série [FATO: 0 ocorrências]. O escopo segue por `taskId`/empresa/contato |

O contrato público do portal fala em `serialNumber` **da identidade do veículo**. Com o DD1 isso continua exato: o implemento é o veículo. **Recomendação: não mudar nenhuma chave do portal.**

### 2.14 M — Faturamento, conciliação, bônus, dashboard, busca

`billing.service.ts:137-695`, `settlement-summary.ts:70-666`, `receivable-match.service.ts:200-2143` (`taskSerialNumber` na resposta), `receivable-task-match.service.ts:190-1591`, `invoice-analytics.service.ts:1143,1373`, `nfse.controller.ts:116-267` (`taskSerialNumber`), `bonus.service.ts:821,1418,3580,3713` (projeções montadas à mão: `serialNumber: task.serialNumber ?? null`), `dashboard-prisma.repository.ts:1823-3682` (16), `dashboard.service.ts:1054`, `search.service.ts:203-289`, `paint-production.service.ts:759-890`, `service-order.service.ts` (8), `purchase-order.service.ts:89-604`, `budget.service.ts` (13), `budget-status-cascade.service.ts:47-52`, `utils/garage-layout.ts:25` + `truck.service.ts:103` (a série da garagem vem da tarefa e passa a vir do próprio implemento). Tipos: `types/task.ts` (8), `invoice.ts` (3), `dashboard.ts` (3), `receivable.ts:105`, `invoice-analytics.ts:179`, `notification-configuration.ts:462`.

### 2.15 N — Permissão, whitelist, pipe

| Onde | O quê | Depois |
|---|---|---|
| `task/task.permissions.ts:10` | `identity: ['name','details','customerId','serialNumber','chassis','serialNumberFrom','serialNumberTo']` | Continua valendo para a chave de topo (legado). `implement.serialNumber` precisa exigir `identity` **além de** `implement`. Hoje os quatro setores com `truck` também têm `identity` (FINANCIAL, COMMERCIAL, LOGISTIC, PRODUCTION_MANAGER; `:130-240`), então não há escalada; mas o acoplamento precisa ser explícito (teste G7) |
| `production/truck/truck.controller.ts:229-236` | `PUT /trucks/:id` aceita **WAREHOUSE** | A série **não** entra em `implementUpdateSchema` (S-9) |
| `include-access-control.ts:141-147` | `SELECT_WHITELIST.Task` com `serialNumber` | manter até a R-D; `Implement` (se ganhar whitelist) com `serialNumber` |
| `common/pipes/zod-validation.pipe.ts:233,458,1114` | rótulo e "manter como string" pelo **nome da chave** | vale também para `implement[serialNumber]` (a checagem é por chave). Série só com dígitos continua texto |

---

## 3. A série dentro de JSON persistido: o que acontece com o histórico

| Tabela.coluna | Linhas no clone | O que guarda | O que fazer |
|---|---:|---|---|
| `ChangeLog.field` | 113 (`TASK/serialNumber/UPDATE`) | nome do campo | **Nada.** Novas escritas seguem o mesmo formato (S-5). Rollback e datas do aditivo continuam achando |
| `ChangeLog.oldValue/newValue` | 953 / 1.818 com a string `serialNumber` dentro do JSON (TASK 793, PREFERENCES 728, SERVICE_ORDER 494, AIRBRUSHING 11, CUSTOMER 9, SEEN_NOTIFICATION 1) | fotos de entidade (tarefa inteira, preferências…) | **Nada.** É histórico. O web que desenha o diff de `TASK` precisa aceitar `serialNumber` no topo **e** em `implement` (escopo do web) |
| `TaskFieldChangeLog.field` | 104 (`serialNumber`) | nome do campo | nada; continuar gravando `serialNumber` |
| `Notification.metadata` | 1.523 | texto e dados já enviados | nada (histórico imutável) |
| `NotificationConfiguration` | `key`/`eventType` = `task.field.serialNumber` (1); `templates` com `{{serialNumber}}` (60) | chave e variável | nada, desde que o contexto continue entregando `serialNumber` (guarda G-S4) |
| `UserNotificationPreference.eventType` | 37 × `task_serialNumber` | chave | nada |
| `Preferences.dashboardLayoutWeb` (5), `detailConfigsWeb` (3), `tableConfigsMobile` (1) | — | **chaves de coluna/ordenação da tela** (`columns: [..., "serialNumber"]`, `sorts: [{ key: "serialNumber" }]`, `fieldOrder.task: [..., "serialNumber"]`) | Nada na API. Web e app continuam aceitando a chave de coluna `serialNumber` (é chave de UI, não caminho Prisma). O `sort` do widget chega à API como `orderBy.serialNumber` e tem de continuar aceito (§6.3) |
| `SignatureEnvelope.quoteSnapshot` | 35 com a string; 12 na forma v1/v2 (`task.serialNumber`) | **o que o signatário viu** | **Intocável.** O builder continua gravando `vehicles[].serialNumber` (S-6). O hash material não muda; o hash inteiro não muda enquanto o valor for o mesmo |
| PDFs assinados, NFS-e emitidas, boletos registrados | — | bytes e texto no fisco e no banco | intocáveis; a série já impressa neles é histórico |

**O `oldValue` do changelog NÃO é migrado.** Reescrever JSON de auditoria para trocar `serialNumber` por `implement.serialNumber` destruiria a prova do que foi gravado, e nenhum leitor precisa disso [INF].

---

## 4. Migração

### 4.1 Contagens no clone [FATO]

| Medida | Valor |
|---|---:|
| Task (total / criadas até 30/06 / depois, QA-e2e) | 2.253 / 2.178 / 75 |
| Truck | 575 |
| **Tarefas sem Truck** | **1.678** (todas COMPLETED; `createdAt` 17/07/2023 → 16/01/2026) |
| Tarefas com Truck por status | PREPARATION 160, WAITING_PRODUCTION 90, IN_PRODUCTION 11, COMPLETED 261, CANCELLED 53 |
| Séries preenchidas / nulas / `''` | 2.013 / 240 / 0 |
| Séries distintas (cruas / `lower(trim)`) | 2.013 / 2.013 → **0 duplicatas** |
| Colisões se normalizar tirando o que não é alfanumérico | 15 grupos (`'-'`×`'.'`, `'0002-2'`×`'00022'`, `'1/4'`×`'--14'`…). Motivo de S-7 |
| Série em tarefa sem Truck (até 30/06) | 1.567: numérica 1.238, **placa 204**, chassi `CH-` 44, marcador 63 (`--7`, `.`, `1/4`), texto 18 (`IBIPORÃ`, `USADO`, `RANDON 1/2 1/3`) |
| Série em tarefa com Truck (até 30/06) | 375: numérica 372, placa 3 |
| Série que é igual à placa do próprio caminhão | 1 |
| Séries fora de `^[A-Z0-9-]+$` | 9 (todas COMPLETED); 5 com espaço na borda; 68 começam com zero |
| Tarefas em andamento sem série | 30 |
| Maior série | 18 caracteres (dado de QA) |
| Caminhões criados desde 19/09 (portal/e2e) com `spot = YARD_WAIT` | 43 de 43 |

Consequência [INF]: nas tarefas antigas, o campo "série" funcionou como **identificador livre** da O.S. Depois do DD1, 204 implementos históricos terão "série" = placa. É dado velho de tarefa COMPLETED, não bloqueia nada, e a limpeza é rodada própria (pergunta 3).

### 4.2 Estratégia: espelho por gatilho (recomendada) × tradutor na API

| | **E — Espelho (recomendada)** | **T — Tradutor (como o `truck` do v1)** |
|---|---|---|
| Verdade | `Implement.serialNumber` | `Implement.serialNumber` |
| `Task.serialNumber` na janela | continua no banco, **somente leitura**, mantida por gatilho a partir do implemento | apagada em R-B |
| O que muda no código em R-B | 6 escritores (§2.3) + 4 unicidades (§2.4) + rollback + unicidade na criação + `truck: null` | os ~500 pontos de `src/` + tradutor de where/orderBy/select/include em qualquer profundidade + interceptor de espelho na resposta |
| App instalado e bundle velho do web | intactos: `where/orderBy/select` com `serialNumber` e `task.serialNumber` na resposta funcionam | dependem do tradutor. Os `select` repassados (`budget-prisma.repository.ts:377-393`) e os `z.any()` (`schemas/task.ts:1347`, `truck.ts:209`, `cut.ts:325`) viram 500 se o tradutor não pegar |
| Classes silenciosas (G, H, J, E) | não disparam: o valor continua onde o leitor procura | disparam em cada leitor esquecido (rótulo recua para a placa na NFS-e, notificação some, busca de tinta vazia) |
| Busca | GIN da Task continua servindo até a R-D; GIN novo no implemento | todas as 11 buscas reescritas |
| Leitor ou escritor esquecido | **escritor** esquecido → erro do gatilho (500 barulhento, nunca silencioso); leitor esquecido → funciona | 500 ou valor sumido |
| Reversão | trivial: a série continua na Task | exige copiar de volta |
| Custo | objeto invisível (gatilho). Banco de teste por `db push` não tem o gatilho (risco R-6) | big bang |
| Fim | R-D: leitores migrados sob catraca (G-S6) → migração `M5s` apaga espelho, gatilhos, GIN e coluna | — |

### 4.3 Ordem relativa ao v1 (M0..M4)

| Migração | Release | Conteúdo | Relação com este recorte |
|---|---|---|---|
| M0 `20260930100000_arte_estados_e_tipos` | R-A | enums | nenhuma |
| M1 `20260930120000_truck_vira_implement` | R-B | rename (catálogo) | **pré-requisito**: `M1s` fala `"Implement"` |
| **M1s `20260930120050_serie_no_implemento_e_implemento_obrigatorio`** | **R-B** | §4.4 | **nova**; roda entre M1 e M2 |
| M2 `20260930120100_…` | R-B | frente, porta, medidas compartilhadas | independente. Os implementos criados por `M1s` não têm medida |
| M3 `20260930120200_…` | R-B | arte, projetos | O passo **1b** (`PLANO.md:470-495`, "implementos faltantes") vira **no-op** porque toda tarefa já tem implemento; o `WHERE NOT EXISTS` o mantém idempotente. Manter o passo e o invariante |
| M4 `…_orcamento_sem_layout_coluna` | R-D | `quoteLayoutId` | nenhuma |
| **M5s `2026XXXX_serie_sai_da_tarefa`** | **R-D**, com a catraca G-S6 zerada | §4.6 | **nova** |

Por que `M1s` não vai na R-A (antecipada) [INF]: o código velho grava `Task.serialNumber`. O gatilho de somente leitura derrubaria todo save, e o gatilho de obrigatoriedade derrubaria toda criação sem `truck` (o repositório atual só cria o caminhão `if (truck)`, `task-prisma.repository.ts:1061-1074`). Os dois precisam do código novo no mesmo deploy, com a API parada (v1 §4.7 passo 3).

### 4.4 `M1s` (SQL)

```sql
-- M1s — 20260930120050_serie_no_implemento_e_implemento_obrigatorio  (R-B, depois de M1)
-- Pré-condição: "Implement" existe (M1). Tudo numa transação (padrão do migrate deploy).

-- 0. ARQUIVO MORTO (reversão e auditoria)
CREATE TABLE IF NOT EXISTS "_Mig0924_SerialImplementCreated" (
  "implementId" text PRIMARY KEY, "taskId" text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskSerial" AS
  SELECT "id" AS "taskId", "serialNumber" FROM "Task" WHERE "serialNumber" IS NOT NULL;

-- 1. UM IMPLEMENTO PARA TODA TAREFA — spot NULL explícito (o default YARD_WAIT
--    poria 1.678 O.S. concluídas "no pátio"). createdAt/updatedAt da TAREFA: listas e
--    sincronizações por updatedAt não podem ver 1.678 linhas "novas".
WITH c AS (
  INSERT INTO "Implement" ("id","taskId","spot","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, t."id", NULL, t."createdAt", t."updatedAt"
  FROM "Task" t
  WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId" = t."id")
  RETURNING "id","taskId")
INSERT INTO "_Mig0924_SerialImplementCreated" ("implementId","taskId") SELECT "id","taskId" FROM c;

-- 2. A SÉRIE NO IMPLEMENTO
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "serialNumber" TEXT;
UPDATE "Implement" i SET "serialNumber" = t."serialNumber"
  FROM "Task" t WHERE t."id" = i."taskId" AND i."serialNumber" IS DISTINCT FROM t."serialNumber";
CREATE UNIQUE INDEX IF NOT EXISTS "Implement_serialNumber_key" ON "Implement"("serialNumber");
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "serialNumberNormalized" text
  GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED;
CREATE INDEX IF NOT EXISTS "Implement_serialNumberNormalized_trgm_idx"
  ON "Implement" USING gin ("serialNumberNormalized" gin_trgm_ops);

-- 3. UMA UNICIDADE SÓ (S-3). A coluna gerada e o GIN da Task FICAM até M5s (espelho).
DROP INDEX IF EXISTS "Task_serialNumber_key";

-- 4. ESPELHO: Implement → Task (sem tocar Task.updatedAt)
CREATE OR REPLACE FUNCTION implement_serial_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Task" SET "serialNumber" = NEW."serialNumber"
   WHERE "id" = NEW."taskId" AND "serialNumber" IS DISTINCT FROM NEW."serialNumber";
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "Implement_serial_mirror" ON "Implement";
CREATE TRIGGER "Implement_serial_mirror" AFTER INSERT OR UPDATE OF "serialNumber","taskId"
  ON "Implement" FOR EACH ROW EXECUTE FUNCTION implement_serial_mirror();

-- 5. Task.serialNumber SÓ muda pelo espelho (profundidade 2). Escrita direta = erro barulhento.
CREATE OR REPLACE FUNCTION task_serial_is_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NEW."serialNumber" IS DISTINCT FROM
     (CASE WHEN TG_OP = 'UPDATE' THEN OLD."serialNumber" ELSE NULL END) THEN
    RAISE EXCEPTION 'Task.serialNumber é espelho de Implement.serialNumber: grave no implemento'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "Task_serial_is_mirror" ON "Task";
CREATE TRIGGER "Task_serial_is_mirror" BEFORE INSERT OR UPDATE OF "serialNumber"
  ON "Task" FOR EACH ROW EXECUTE FUNCTION task_serial_is_mirror();

-- 6. TODA TAREFA TEM IMPLEMENTO (§5) — verificado no COMMIT
CREATE OR REPLACE FUNCTION task_must_have_implement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text;
BEGIN
  tid := CASE WHEN TG_TABLE_NAME = 'Task' THEN NEW."id" ELSE OLD."taskId" END;
  IF EXISTS (SELECT 1 FROM "Task" WHERE "id" = tid)
     AND NOT EXISTS (SELECT 1 FROM "Implement" WHERE "taskId" = tid) THEN
    RAISE EXCEPTION 'Tarefa % sem implemento: toda tarefa tem exatamente um implemento', tid
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "Task_has_implement" ON "Task";
CREATE CONSTRAINT TRIGGER "Task_has_implement" AFTER INSERT ON "Task"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();
DROP TRIGGER IF EXISTS "Implement_keeps_task_covered" ON "Implement";
CREATE CONSTRAINT TRIGGER "Implement_keeps_task_covered" AFTER DELETE OR UPDATE OF "taskId" ON "Implement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();

-- 7. S-8: o default que põe veículo não chegado "no pátio"
ALTER TABLE "Implement" ALTER COLUMN "spot" DROP DEFAULT;
```

Notas:
- **"No máximo 1"** já é garantido por `Implement_taskId_key` (herdado de `Truck_taskId_key`). **"Pelo menos 1"** é o gatilho diferido. Juntos dão exatamente 1.
- `ADD COLUMN … GENERATED … STORED` reescreve a tabela: 2.253 linhas, milissegundos [INF].
- `ERRCODE 23514` (check_violation). O Prisma o devolve como erro desconhecido, que vira 500. É a **última linha** de defesa e nunca deveria disparar se os escritores estiverem certos.
- Prisma: `Task.serialNumber` perde o `@unique` e ganha o comentário `/// ESPELHO somente leitura de Implement.serialNumber (gatilho, M1s). Sai em M5s.` `Implement` ganha `serialNumber String? @unique` e `serialNumberNormalized String?`. `spot` perde o `@default`. O `omit` global ganha `implement.serialNumberNormalized`.

### 4.5 Ensaio (em transação revertida, no clone e depois em produção, junto do §4.6 do v1)

| Invariante | Esperado (clone) |
|---|---|
| `count(Task) = count(Implement)` | 2.253 = 2.253 |
| tarefas sem implemento | 0 |
| `count("_Mig0924_SerialImplementCreated")` | **1.678** |
| criados por `M1s` com `spot IS NOT NULL` | 0 |
| `Implement.serialNumber` preenchidas | 2.013 |
| `Task.serialNumber IS DISTINCT FROM Implement.serialNumber` (join por `taskId`) | 0 |
| `Task.serialNumber` atual × `"_Mig0924_TaskSerial"` | 0 diferenças |
| veículos de envelopes RUNNING/COMPLETED com `vehicles[].serialNumber IS DISTINCT FROM implement.serialNumber` | 0 (hoje: 25 veículos, 0 divergentes) |
| `buildForQuote(q).hash === env.quoteSnapshotSha256` para cada envelope RUNNING/COMPLETED que casava **antes** | 100% (régua G11 do v1, com o builder lendo do implemento) |
| gatilho: `INSERT` de Task sem implemento numa transação → `COMMIT` falha | falha |
| gatilho: `UPDATE "Task" SET "serialNumber"='X'` → erro; `UPDATE "Implement" SET "serialNumber"='X'` → a Task segue sem mudar `Task.updatedAt` | como descrito |
| `DELETE FROM "Task"` de uma tarefa de teste → o implemento vai em cascata e o gatilho não reclama | passa |

### 4.6 `M5s` (R-D) — tirar o espelho

```sql
DROP TRIGGER IF EXISTS "Task_serial_is_mirror" ON "Task";
DROP TRIGGER IF EXISTS "Implement_serial_mirror" ON "Implement";
DROP FUNCTION IF EXISTS task_serial_is_mirror(), implement_serial_mirror();
DROP INDEX IF EXISTS "Task_serialNumberNormalized_trgm_idx";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "serialNumberNormalized";  -- ANTES da base: a gerada depende dela
ALTER TABLE "Task" DROP COLUMN IF EXISTS "serialNumber";
-- Os gatilhos de obrigatoriedade (passo 6 de M1s) FICAM para sempre.
```

Pré-condições: catraca G-S6 zerada, contador de chaves legadas zerado há 14 dias (mesma regra do P32 do v1) e `M1s` em produção há pelo menos uma release.

### 4.7 Reversão

| Passo | Como voltar | Perde? |
|---|---|---|
| `M1s` (dentro da janela) | `DROP` dos 4 gatilhos e 3 funções; `CREATE UNIQUE INDEX "Task_serialNumber_key"` (Task ainda tem os valores pelo espelho); `DROP INDEX "Implement_serialNumberNormalized_trgm_idx"`; `DROP COLUMN "serialNumberNormalized"`, `"serialNumber"` do implemento; `ALTER COLUMN "spot" SET DEFAULT 'YARD_WAIT'`; apagar os implementos de `"_Mig0924_SerialImplementCreated"` **somente se** ainda não têm placa, chassi, medida, arte ou projeto (senão ficam: o código velho aceita tarefa com caminhão) | nada. A Task tinha a série o tempo todo |
| código R-B | reverter `M1s` **antes** (o código velho grava `Task.serialNumber`, e o gatilho o recusaria) | — |
| `M5s` | `ADD COLUMN "serialNumber"` na Task + `UPDATE` a partir do implemento + coluna gerada + GIN + gatilhos | nada |

---

## 5. "Toda tarefa tem exatamente 1 implemento"

### 5.1 Caminhos de criação de tarefa (todos) [FATO]

| # | Caminho | Arquivo:linha | Cria caminhão hoje? | Depois |
|---|---|---|---|---|
| C1 | `POST /tasks` → `TaskService.create` → `tasksRepository.createWithTransaction` → `transaction.task.create` | `task.service.ts:1215`; `task-prisma.repository.ts:1839-1954` | **só `if (truck)`** (`task-prisma.repository.ts:1061-1074`); fallback em `task.service.ts:1323-1334` só quando há medida | `mapCreateFormDataToDatabaseCreateInput` **sempre** põe `implement: { create: {…} }` (vazio se nada vier), com `spot: null` explícito |
| C2 | `POST /tasks` com `serialNumberFrom/To` → `createTasksFromSerialRange` → `batchCreate` | `task.service.ts:1152-1164,1869-1925` | via C3 | via C3 |
| C3 | `POST /tasks/batch` → `batchCreate` → repositório | `task.service.ts:1942-2100` (`:2052`); pós-criação de medida `:2062-2070` (`tx.truck.findUnique … if (truck)`) | como C1 | como C1; o `if (truck)` vira sempre verdadeiro |
| C4 | `POST /tasks/batch-with-quote` → `batchCreateWithQuote` → `batchCreate` | `task.controller.ts:263-272`; `task.service.ts:2220-2310` | via C3 | via C3 |
| C5 | Portal `POST /cliente/me/requisicoes` → `criarVeiculo` | `portal-request.service.ts:874-906` | **sempre** (`truck: { create }`), sem `spot` → `YARD_WAIT` | `implement: { create: { …, spot: null } }` |
| C6 | Scripts e seeds | `src/scripts/seed-test-billing-task.ts:115`, `nfse-homolog-test.ts:105`, `setup-painter-nfse-test.ts:162`; `scripts/test-signature-e2e.js:131`, `test-signature-deletion.js:105`, `make-real-signature-test.js:109`, `seed-portal-pagamento-demo.ts:~146` (`tasks: { create }` aninhado em `Budget`) | não | acrescentar `implement: { create: {} }`. Sem isso, o commit falha (desejado) |
| C7 | Testes com banco | `tests/billing-entity.test.ts:84`, `task-match-integration.test.ts:128,651-696`, `orcamento-faturamento-a-db.test.ts:67` | não | idem |

Não criam tarefa: `copyFromTask` (copia para uma existente), `budget.service` (liga), `airbrushing`, `service-order` [FATO: `rg "\.task\.create\("` em `src/` só acha C1 e C5, fora os scripts].

### 5.2 Caminhos que APAGAM ou deixam de criar o implemento

| Onde | Hoje | Depois |
|---|---|---|
| `task.service.ts:2562-2645` + `task-prisma.repository.ts:1452-1455` | `PUT /tasks/:id` com **`truck: null`** apaga o caminhão (e as medidas não compartilhadas) e grava `ChangeLog TRUCK/DELETE` "Caminhão removido da tarefa". O `taskTruckSchema` é `.nullable()` (`schemas/task.ts:2553-2580`) | **400** "O implemento não pode ser removido da tarefa; limpe os campos." O gatilho diferido barraria no commit com 500; o 400 vem antes. Na janela bilíngue, `truck: null` vindo do app velho → 400 com a mesma frase |
| `Implement.task onDelete: Cascade` (`schema.prisma:2551`) | tarefa apagada leva o caminhão | continua; o gatilho aceita (a tarefa não existe mais) |
| `task.service.ts:1326`, `:2654`, `:8806`, `:14213`, `:14239`, `:14365`; `portal-identity.service.ts:557` | "cria o caminhão se não existir" | vira código morto → trocar por `update` e apagar o ramo (senão fica uma segunda fonte de criação sem `spot: null`, como `portal-identity.service.ts:557-568` já é hoje) |
| `task-prisma.repository.ts:1488-1495` | `upsert` do caminhão na atualização | pode continuar `upsert` (inofensivo), mas o `create` do `upsert` deixa de ser alcançável |

### 5.3 Como garantir no banco: três opções

| Opção | Como | Prós | Contras | Veredito |
|---|---|---|---|---|
| **G-a** FK no implemento (`Implement.taskId @unique`) + `CONSTRAINT TRIGGER` diferido (§4.4 passo 6) | já é o desenho do v1 | nenhuma mudança de forma para o código de 1:1 (86 acessos `tx.truck.*`/`prisma.truck.*` em `src/`, 19 deles `findUnique/findFirst/update/upsert` por `where: { taskId }`); diferido funciona com o `create` aninhado do Prisma, que roda numa transação [INF: comportamento documentado do Prisma para escritas aninhadas] | objeto invisível ao Prisma; não existe em banco de `db push` | **recomendada** |
| G-b Inverter a FK: `Task.implementId String @unique` obrigatório | o Prisma passa a exigir `implement` em `TaskCreateInput` | obrigatoriedade no tipo e no `NOT NULL`, e o N:1 futuro vira só "tirar o `@unique`" | reescreve M1 a M3, os acessos por `taskId` (19 diretos, 46 linhas que cruzam `taskId` com caminhão/implemento), a cascata (apagar a tarefa deixaria o implemento órfão) e a garagem. E o tipo não protege: o build **emite com erro de tipo** (`noEmitOnError: false`, v1 §8) | rejeitar agora; registrar como caminho do N:1 |
| G-c Só no código (repositório sempre cria) | — | simples | scripts, testes e o próximo `tx.task.create` esquecido furam em silêncio: é exatamente como nasceram as 1.678 tarefas sem caminhão | insuficiente sozinha |

**Recomendação: G-a + G-c juntos**: o repositório sempre cria, e o gatilho é a rede.

### 5.4 Efeitos colaterais da invariante (o que muda de SIGNIFICADO)

| Onde | Hoje | Depois | [FATO/INF] |
|---|---|---|---|
| `schemas/task.ts:1488-1493` filtro `hasTruck` (web: "Com caminhão", `filter-utils.ts:213`) | tem ou não linha de caminhão | `true` = todas; `false` = nenhuma | FATO no código; decidir o novo sentido (pergunta 4) |
| `attention.service.ts:284-289` (`NO_CHASSIS`, `NO_PLATE`, `NO_VIN_PLATE_PHOTO` com `{ truck: null }`) | caminhão ausente conta como "sem placa" | continua correto: o ramo `truck: null` só deixa de casar | INF |
| `utils/task.ts:374`, `task.service.ts:11757,12253,12409` (`if (!task.truck)`) | ramo "sem caminhão" | inalcançável | FATO |
| `dps.builder.ts:522-524` (`temVeiculo` por campo) | aerografia sem caminhão não cita veículo | idem, **desde que continue por campo** | FATO |
| `quote-diff.ts:741`, `bonus.service.ts:827,3586` (`truck ?? null`) | — | sempre objeto | INF |

---

## 6. Contrato (janela bilíngue)

### 6.1 Escrita

| Entrada | Rotas | Tratamento | Por quê |
|---|---|---|---|
| `serialNumber` no topo | `POST/PUT /tasks`, `POST /tasks/batch`, `PUT /tasks/batch`, `POST /tasks/batch-with-quote` (`tasks[]`) | **Aceitar para sempre, ou ao menos até a R-D**, e traduzir para `implement.serialNumber` num único ponto (o mapeador do repositório, W1/W2) | O `taskUpdateSchema` **não é `.strict()`**: tirar a chave do zod faz o app velho receber **200 sem gravar**. É a armadilha "chave fora do lugar some com 200" |
| `implement.serialNumber` | as mesmas | caminho novo (dentro de `taskImplementSchema.strict()` do v1) | |
| as duas com valores diferentes | as mesmas | **400** "Envie o número de série só em `implement`" | mesma regra do v1 para `truck` × `implement` |
| `serialNumberFrom/To` | `POST /tasks` | sem mudança (gera W1) | |
| `truck: null` / `implement: null` | `PUT /tasks/:id` | **400** (§5.2) | |
| `serialNumber` em `PUT /implements/:id` (e no alias `/trucks/:id`) | — | **não aceito** (S-9); `.strict()` → 400 "a série se edita na tarefa" | a rota aceita WAREHOUSE |
| Portal `PATCH …/identificacao` `{ serialNumber }` e requisição `veiculos[].serialNumber` | portal | **contrato inalterado**; o serviço grava no implemento | o campo já é "do veículo" |
| Validação | todas | **o mesmo regex e a mesma transformação de hoje** (`schemas/task.ts:2595-2602`, `portal-request.ts:403-427`), sem apertar | 9 séries históricas violam o regex. Apertar faria um save de tarefa antiga dar 400 |
| Permissão | `PUT /tasks` | `implement.serialNumber` exige o domínio `identity` (G7). A chave legada no topo continua em `identity` (`task.permissions.ts:10`) | |

### 6.2 Leitura

| O quê | Com a estratégia E | Com a estratégia T |
|---|---|---|
| `task.serialNumber` na resposta | vem da coluna-espelho, **sem código** | interceptor copia `implement.serialNumber` para cada objeto Task em qualquer profundidade (e o `include` precisa trazer o implemento) |
| `task.implement.serialNumber` | vem quando o cliente inclui `implement` | idem |
| `SELECT_WHITELIST.Task.serialNumber` | manter | manter como chave **sintética** |
| Ordem canônica do orçamento | `createdAt, id` (`utils/quote-tasks.ts:28-38`), não é por série | sem mudança |

### 6.3 `where` / `orderBy` / busca vindos dos clientes

| Chave do cliente | E (R-B → R-D) | Forma final (depois de M5s) |
|---|---|---|
| `where.serialNumber` (string, `{contains}`, `null`) | passa direto (espelho) | `{ implement: { serialNumber: … } }`. `null` só é equivalente porque toda tarefa tem implemento (§5) |
| `where.task.serialNumber` (airbrushing, service-order, observation, layout, cut: `task: z.any()`/objetos abertos) | passa direto | tradutor de `DEPRECATED_QUERY_KEYS` (G1 do v1): `Task.serialNumber → implement.serialNumber` em qualquer profundidade |
| `where.tasks.some.serialNumber` (portal, web `customer.ts:530`) | passa direto | idem |
| `orderBy.serialNumber` (lista de tarefas, `task_schedule_view.dart:322-323`, widget com `sorts: [{ key: "serialNumber" }]`) | passa direto | `{ implement: { serialNumber: { sort, nulls } } }` (forma já usada em `portal-read.service.ts:279`) |
| `orderBy.task.serialNumber` (airbrushing, service-order) | passa direto | `{ task: { implement: { serialNumber } } }` |
| `searchingFor` | as 10 buscas continuam em `Task.serialNumberNormalized` (GIN) | trocar por `implement: { serialNumberNormalized: { contains } }` (GIN novo); `paint.service.ts:497-526` reescrito em SQL com `LEFT JOIN "Implement"` **e sem o `catch → []`** |
| `select.serialNumber` em Task (whitelist, `budget-prisma.repository.ts:377-393`) | passa direto | tradutor: `serialNumber: true` → `implement: { select: { serialNumber: true } }` + achatar na volta (só enquanto o cliente velho existir) |
| Chaves públicas do portal (`sort=serialNumber`, `field: 'serialNumber'`) | inalteradas | inalteradas (o builder muda por dentro) |

Na estratégia E, os leitores internos migram entre a R-B e a R-D, arquivo por arquivo, sob a catraca G-S6. Ordem sugerida: primeiro os **rótulos fiscais** (NFS-e, boleto, recibo), com os testes de discriminação na frente; depois portal e assinatura; por último dashboard, notificações, busca e scripts.

### 6.4 Changelog e notificação (S-5)

- Gravar sempre `ChangeLog { entityType: TASK, entityId: taskId, field: 'serialNumber' }` e `TaskFieldChangeLog.field = 'serialNumber'`, **qualquer que seja o caminho** (tarefa, portal, rollback).
- `TRACKED_FIELDS`/`fieldsToTrack` passam a ler a série do objeto novo (`implement.serialNumber`), mas **emitem** o campo `serialNumber` → a chave `task.field.serialNumber` (NotificationConfiguration e as 37 `UserNotificationPreference`) continua disparando.
- Rollback de `TASK/serialNumber`: checar a unicidade no implemento **antes** de gravar (hoje o conflito dá 500).
- `lateSlotRegistrationDates` (`signature-envelope.service.ts:7907-7927`): sem mudança com S-5. Se S-5 cair, acrescentar `serialNumber` ao ramo do implemento **e** manter o da tarefa para o histórico.

### 6.5 Erros esperados

| Situação | Hoje | Depois |
|---|---|---|
| Série repetida (tarefa, portal) | 400 "Número de série já está em uso." / 400 com `conflicts[]` | igual (checagem no implemento) |
| Corrida (P2002) | 409 genérico "Este valor já está em uso no sistema." (filtro global) | 409 "Este número de série já está em uso." (acrescentar ao mapa) |
| `serialNumber` e `implement.serialNumber` diferentes | — | 400 |
| `truck: null` / `implement: null` | apaga o caminhão | 400 |
| Série em `PUT /implements/:id` | — | 400 |
| Escrita direta em `Task.serialNumber` por código esquecido (E) | — | 500 com a mensagem do gatilho no log (barulhento de propósito) |
| Tarefa criada sem implemento por código esquecido | passa em silêncio | 500 no commit (gatilho diferido) |

---

## 7. Guardas deste recorte (somam-se às G0..G18 do v1)

| # | Guarda | Pega | Como | Pacote |
|---|---|---|---|---|
| **G-S1** | Tabela escritor × série | escritor esquecido | os 6 escritores (§2.3) + rollback: cada um grava e o teste confere `Implement.serialNumber`, `Task.serialNumber` (espelho) e `ChangeLog TASK/serialNumber` | P11 |
| **G-S2** | Toda criação tem implemento | criação sem implemento | C1–C5 contra o banco de QA **com migrations** (não `db push`): `count(Task sem Implement) = 0` e `spot IS NULL` depois de cada caminho | P10/P11 |
| **G-S3** | Rótulos fiscais de ouro | recuo silencioso para a placa | fixtures de veículo (com série, só placa, só chassi, sem nada) → `buildDiscriminacao`, `dps.builder`, `buildBoletoLines`, recibo, `coverageLabels`, `formatTaskIdentifier`, com o **texto exato** esperado, rodando sobre o objeto carregado pelo `select` real de cada serviço (não sobre um objeto montado à mão) | P05/P11 |
| **G-S4** | Contexto de notificação | `{{#if serialNumber}}` escondendo a ausência | para cada evento de `task.listener`/`cut.listener`/`layout.listener`/tracker: tarefa com série → o `data.serialNumber` do dispatch não é vazio | P11 |
| **G-S5** | Régua da assinatura | deriva de hash | a G11 do v1, com a asserção extra "`vehicles[].serialNumber` congelado = `implement.serialNumber`" para todo RUNNING/COMPLETED | P10/P12 |
| **G-S6** | Catraca dos leitores do espelho | `M5s` antes da hora | `rg -n 'serialNumber' src` fora de `.serial-allowlist` (snapshot, diff, lacuna, rótulos de changelog, chaves públicas do portal, tradutor legado); a contagem-base só cai; `M5s` exige a contagem final | P11 (liga), P32 (zera) |
| **G-S7** | Objetos de banco em teste | falso verde em banco de `db push` | script `prisma/sql/objetos-pos-push.sql` (gatilhos, colunas geradas, GIN) aplicado depois de todo `db push` de teste. Os testes que escrevem `serialNumberNormalized` à mão (`task-match-integration.test.ts:137`) passam a depender dele | P01/P10 |

---

## 8. Onde entra no plano de pacotes do v1

| Pacote v1 | Acréscimo deste recorte |
|---|---|
| P00 | respostas às perguntas 1–6 abaixo; medir em produção as contagens do §4.1 (mesmas consultas) |
| P01 | G-S7; acrescentar `serialNumber` ao mapa de mensagens P2002 do filtro global |
| P05 | G-S3 (rótulos fiscais de ouro) **antes** de mexer em qualquer leitor fiscal |
| **P10** (sozinho) | `M1s` + schema (`Implement.serialNumber @unique`, `serialNumberNormalized`, `spot` sem default, `Task.serialNumber` sem `@unique` e anotado como espelho, `omit`) + ensaio §4.5 dentro do `rehearse-implement-migration.ts` |
| **P11** (sozinho) | W1–W6; unicidades (§2.4); `truck/implement: null` → 400; ramos "cria se não existir" → `update`; `implementUpdateSchema` sem série; G7 com `implement.serialNumber` ⊂ `identity`; tracker e changelog (§6.4); `quote-snapshot.service.ts:494` lendo do implemento com a **mesma chave**; comentário de `dps.builder.ts:522-524`; G-S1, G-S2, G-S4 e G-S6 ligadas |
| P13a | `portal-identity.service.ts:523-534` e `portal-request.service.ts:874-906` (W4/W5) com `spot: null`; a projeção do portal continua `identity.serialNumber` |
| P26 | e2e-portal 01–04 e `tests/e2e-ui/*` (criam por série e ordenam por série) conferindo `Implement.serialNumber`; scripts C6 |
| entre P31 e P32 | migração dos leitores sob a catraca G-S6 (ordem do §6.3) |
| **P32** | `M5s`; tirar a tradução de `serialNumber` de `DEPRECATED_QUERY_KEYS` **só se** o censo (G3) mostrar zero clientes mandando a chave. Senão a tradução fica permanente: é barata |

---

## 9. Perguntas ao dono (com recomendação)

1. **A série continua saindo igual na NFS-e, no boleto, no recibo e no documento de assinatura** ("n série: 38174", "Série 38174", "(séries A a B)")? **Recomendo: sim, sem mudar uma palavra.** Só muda de onde o sistema tira o número.
2. **O responsável do cliente pode trocar a série pelo portal depois que o veículo entrou em produção?** Hoje pode a qualquer momento, salvo se contradisser um documento já assinado. **Recomendo: a mesma regra da medida (DD5): não edita depois de IN_PRODUCTION.** A série sai na nota fiscal.
3. **Séries antigas que não são séries** (204 placas, 44 chassis "CH-…", 63 marcadores como "--7" e "1/4", 18 textos como "IBIPORÃ", todas em O.S. concluídas antes de jan/2026): **recomendo migrar como estão.** Limpar é outra rodada, e normalizar agora criaria 15 colisões.
4. **O filtro "Com caminhão" da lista de tarefas perde o sentido** (todo veículo passa a ter implemento). **Recomendo: trocar para "Implemento identificado"** (tem série, placa ou chassi) ou retirar.
5. **Veículo criado pelo portal nasce hoje "aguardando no pátio" antes de chegar** (43 casos no clone). **Recomendo: nascer sem vaga.** A logística marca a vaga na chegada.
6. **Na passagem, a tarefa fica com uma cópia automática da série (só leitura) até o fim da janela do app antigo.** **Recomendo aceitar**: é o que permite trocar o lugar da série sem quebrar o app instalado, a busca e a nota fiscal no mesmo dia.

---

## 10. Riscos (ranqueados)

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R-1 | **Rótulo fiscal recua em silêncio da série para a placa** (select esquecido na migração dos leitores) → NFS-e/boleto emitidos sem a série | média (estratégia T: alta) | **alto** (nota fiscal não se edita) | estratégia E; G-S3 antes de mexer em leitor fiscal; migrar leitores fiscais primeiro |
| R-2 | Escritor esquecido | média | E: 500 barulhento; T: série perdida com 200 | G-S1; estratégia E |
| R-3 | Criação sem implemento em caminho esquecido (script, teste, código novo) | média | 500 no commit | G-S2; repositório sempre cria; gatilho diferido |
| R-4 | `truck: null` do app instalado apagando o implemento | baixa | **alto** (apaga série, medidas e arte do implemento) | 400 no P11 **antes** de `M1s` entrar em produção |
| R-5 | Deriva do hash inteiro do snapshot (valor lido diferente, por exemplo `trim`) → `SNAPSHOT_DRIFTED` em todo envelope vivo | baixa | médio (trilha poluída; nada invalidado, porque a série está fora do material) | copiar o valor **byte a byte**; G-S5 |
| R-6 | **Banco de teste por `db push` sem gatilho nem coluna gerada** → testes verdes que em produção dariam erro (escrita direta em `Task.serialNumber`) ou busca vazia | alta | médio | G-S7; os testes de invariante (G-S2) rodam no QA com migrations (`ankaa_qa_e2e`, como `tests/billing-entity.test.ts:28`) |
| R-7 | Notificação por campo some (tracker lê `undefined`) | média (T) / baixa (E) | baixo, silencioso | G-S4; S-5 |
| R-8 | Busca de tinta por série/placa vazia (`paint.service.ts` com `catch → []`) | alta no rename M1, independe da série | baixo, silencioso | reescrever no P11 **sem** o `catch` que engole |
| R-9 | Almoxarifado ganha edição de série via `PUT /implements/:id` | média se ninguém olhar | médio | S-9 + `.strict()` |
| R-10 | Espelho esquecido para sempre (`M5s` nunca roda) | média | baixo (dívida: dois lugares, um gatilho) | catraca G-S6 com data no próprio arquivo |
| R-11 | Serial de QA com 18 caracteres e a lacuna tardia de 8ch no PDF | baixa | cosmético (`min-width` cresce a linha) | nenhuma; se a Furgões passar de 8, subir `LATE_SLOT_WIDTH_CH.serialNumber` (`quote-html.builder.ts:85`) **só** para envelopes novos |
| R-12 | A `feat/orcamento-veiculos` (outra sessão) chegar à produção antes e criar tarefas por outro caminho | média | médio | antes do P10, `rg "\.task\.create\(\|tasks: \{ create"` na branch combinada; G-S2 cobre qualquer caminho novo |
