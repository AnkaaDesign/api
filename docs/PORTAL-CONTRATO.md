# Portal do Responsável — CONTRATO DE IMPLEMENTAÇÃO

> Este arquivo é a fonte única de verdade para quem implementa em paralelo.
> **Ninguém inventa nome de rota, de campo ou de tipo.** Se algo aqui estiver
> errado ou faltando, PARE e relate — não improvise.
> Desenho completo e justificativas: `docs/PORTAL-DO-RESPONSAVEL.md`.

## 0. O QUE JÁ ESTÁ FEITO (a espinha — NÃO refazer, NÃO editar)

| arquivo | estado |
|---|---|
| `api/prisma/schema.prisma` | ✅ `BudgetStatus` (8 valores), `BudgetRequest`, `PurchaseOrder`, `Task.purchaseOrderId`, `Notification.responsibleId`, `SignatureAuthMethod.RESPONSIBLE_SESSION` |
| `api/prisma/migrations/20260920120000_portal_do_responsavel_requisicao_e_pedido/` | ✅ escrita, **NÃO aplicada** |
| `api/src/constants/{enums,sortOrders,enum-labels}.ts` | ✅ |
| `api/src/modules/production/budget/budget.service.ts` → `ALLOWED` | ✅ só a tabela de transições |
| `web/src/constants/{enums,sortOrders,enum-labels}.ts` | ✅ |
| `web/src/types/budget.ts` → `TASK_QUOTE_STATUS` | ✅ |
| `web/src/components/production/task/quote/quote-status-badge.tsx` | ✅ |
| `web/src/components/financial/budget/table/budget-table-columns.tsx` → `BUDGET_QUOTE_STATUSES` | ✅ |
| `web/src/utils/permissions/quote-permissions.ts` → `VALID_TRANSITIONS` | ✅ |

⛔ **ARQUIVOS PROIBIDOS PARA TODO AGENTE** (o orquestrador os costura no fim):
`web/src/App.tsx` · `web/src/constants/routes.ts` · `web/src/constants/navigation.ts` ·
`web/src/utils/route-privileges.ts` · `api/prisma/schema.prisma` · qualquer `migration.sql`.
Precisa de rota/menu? **Relate no seu retorno** a entrada exata que falta.

## 1. A MÁQUINA DE ESTADOS

```
1 REQUESTED           Requisição              roxo      (purple)
2 EXPIRED             Aguardando Reanálise    laranja   (orange)
3 PRE_APPROVED        Pré-aprovado            índigo    (indigo)
4 SIGNED              Assinado                verde     (completed)
5 IN_NEGOTIATION      Em Negociação           verde-água(teal)
6 PENDING             Aguardando Assinatura   âmbar     (pending)
7 APPROVED            Aprovado                azul      (processing)
8 CANCELLED           Cancelado               vermelho  (cancelled)
```

Transições (já implementadas nos dois lados):
```
REQUESTED    → IN_NEGOTIATION, PENDING, CANCELLED
IN_NEGOTIATION → PRE_APPROVED, REQUESTED, CANCELLED
PRE_APPROVED → PENDING, IN_NEGOTIATION, CANCELLED
PENDING      → APPROVED, IN_NEGOTIATION, CANCELLED
SIGNED       → APPROVED, PENDING, CANCELLED
EXPIRED      → PENDING, REQUESTED, CANCELLED
APPROVED     → PENDING, CANCELLED
CANCELLED    → ∅
```
⚠️ `SIGNED` e `EXPIRED` continuam **não sendo destino de ninguém** — só a cerimônia
de assinatura os escreve, via `update(_internal=true)`.

## 2. O EIXO DE PRIVILÉGIO — uma régua, dois consumidores

`sectionsForRoles(roles)` (`api/src/modules/common/signature/quote-sections.ts:188`)
já existe e devolve as seções do PDF. **O portal usa A MESMA função** para recortar
a TELA. Não crie um segundo mapa de seções.

| seção | libera no portal |
|---|---|
| `VEHICLE` | série, placa, chassi, plaqueta, pedido; e o bloco `implement`: tipo, categoria, medidas (4 faces), porta traseira, projeto do implemento |
| `LAYOUT` | artes, logomarca, arquivos-base, cores de pintura |
| `SERVICES` | lista de serviços |
| `PRICING` | preço unitário, subtotal, total, desconto |
| `DELIVERY` | prazo, previsão, andamento das O.S. |
| `PAYMENT` | parcelas, boletos, NFS-e |
| `GUARANTEE` | garantia |

Papéis → seções (já existe, não mexer): COMMERCIAL/SELLER/REPRESENTATIVE/
COORDINATOR/PURCHASING = tudo · FINANCIAL = tudo menos LAYOUT · MARKETING = só
LAYOUT · FLEET_MANAGER/DRIVER = `[]`.

### 2.1 `PORTAL_CAPABILITIES` — as AÇÕES (a criar em API-1)

```ts
export enum PORTAL_CAPABILITY {
  REQUEST_BUDGET         = 'REQUEST_BUDGET',
  APPROVE_VALUE          = 'APPROVE_VALUE',
  WRITE_PURCHASE_ORDER   = 'WRITE_PURCHASE_ORDER',
  WRITE_VEHICLE_IDENTITY = 'WRITE_VEHICLE_IDENTITY',
  TRACK                  = 'TRACK',
  APPROVE_ARTWORK        = 'APPROVE_ARTWORK',   // P13b (D-09, DD5)
}
```
| papel | REQUEST | APPROVE_VALUE | PURCHASE_ORDER | VEHICLE_IDENTITY | TRACK | APPROVE_ARTWORK |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| COMMERCIAL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SELLER | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| REPRESENTATIVE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| COORDINATOR | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PURCHASING | — | — | ✅ | ✅ | ✅ | **—** (DD5) |
| MARKETING | ✅ | — | ✅ | — | ✅ | ✅ |
| FINANCIAL | — | — | ✅ | — | — | — |
| FLEET_MANAGER | — | — | ✅ | ✅ | ✅ | — |
| DRIVER | — | — | ✅ | — | ✅ | — |

União, nunca interseção — mesma semântica de `sectionsForRoles`.
`WRITE_PURCHASE_ORDER` é de todos os papéis (decisão do dono, 20/09); o portão
é o da cerimônia (§7, DD12). `APPROVE_ARTWORK` implica as seções `VEHICLE` e
`LAYOUT` (`SECTION_IMPLIED_BY_CAPABILITY`) — no-op nos cinco papéis de hoje. A
fonte é `ROLE_CAPABILITIES` em `portal-capabilities.ts`; `tests/portal-recorte`
confere as 54 células e `tests/portal-arte` a linha da arte.

## 3. O ESCOPO — `PortalScopeService` (API-1)

```ts
// Recusa (401/403) responsável sem companyId ANTES de montar o where.
// companyId é NULLABLE: sem a guarda, o where vira "todos os órfãos".
budgetScopeWhere(principal): Prisma.BudgetWhereInput {
  return { OR: [
    { billings: { some: { customerConfigs: { some: { customerId: companyId } } } } }, // paga
    { tasks:    { some: { customerId: companyId } } },                                 // é dono
    { tasks:    { some: { responsibles: { some: { id: responsibleId } } } } },          // é contato
  ]};
}
```
Âncora do dinheiro = **`Invoice.customerId` (NOT NULL)**, nunca
`Installment.customerConfigId`. Padrão a copiar:
`DossierAssemblerService.build(quoteId, { customerId })`.

⚠️ Em TODO `include`/`select` de pagador use
`customerConfigs: { where: { customerId } }` — **nunca `customerConfigs: true`**.
`GET /budgets/public/:id` erra exatamente isso hoje e vaza o cadastro fiscal de
todos os pagadores.

### 3.1 ⛔ LER NÃO É ESCREVER — o corte do PEDIDO DE COMPRA

O caminho (c) é **pessoal**: `Task.responsibles` é m:n e **nada** confere contra
`Task.customerId`. Vale para LER (é a única modelagem de intermediação que
existe) e **não** pode autorizar escrita comercial. Por isso existe
`commercialTaskScopeWhere(principal)` — **só (a) PAGADOR e (b) DONO** —, e é ele
que escopa `POST /cliente/me/pedidos`.

A igualdade `task.customerId === responsible.companyId` está **errada nos dois
sentidos**: recusa o caso Furgões (a Ibiporã emite o pedido, o caminhão é da RKO
— orçamentos 259–262) e não é o que protege; quem protege é a ausência de (c).
`PurchaseOrder.customerId` **continua** sendo `responsible.companyId`: o pedido é
de quem o EMITE, e é esse nome que a NFS-e cita.

### 3.2 ⛔ `Budget.nfseDocuments` NÃO TEM DONO EMBUTIDO

A relação pendura as notas de **todos** os pagadores. `projectBudget` EXIGE
`{ customerId }` como terceiro argumento e recorta **lá dentro** — não no
`select` de quem chama, porque o próximo chamador esquece e esquecer não dá erro,
dá a nota fiscal do vizinho. Fica a nota cujo `customerConfig.customerId` **OU**
`invoice.customerId` bate; os dois em `OR` porque `customerConfigId` é `SetNull`
e desaparece numa reversão de faturamento.

## 4. AS ROTAS DA API

Todas `@ResponsibleOnly()`, prefixo `/cliente/me`. **Marcar a rota É guardá-la** —
não acrescente `@UseGuards`. Papel: `@ResponsibleRoles(...)` ou
`@PortalCapability(...)` (API-1 decide, e documenta aqui).

| método | rota | capacidade | devolve |
|---|---|---|---|
| GET | `/cliente/me/resumo` | — | contadores por status + o que espera por mim |
| GET | `/cliente/me/orcamentos` | — | lista escopada, paginada |
| GET | `/cliente/me/orcamentos/:id` | — | detalhe **recortado por seção** |
| POST | `/cliente/me/orcamentos` | `REQUEST_BUDGET` | cria a requisição (§5) |
| PUT | `/cliente/me/orcamentos/:id/aprovar-valor` | `APPROVE_VALUE` | `{ nota? }` → `PRE_APPROVED` |
| PUT | `/cliente/me/orcamentos/:id/recusar` | `APPROVE_VALUE` | `{ motivo }` → `REQUESTED` |
| GET | `/cliente/me/veiculos` | — | frota escopada · `?semPedido=true\|false` (tri-estado) · `?orderBy=` |
| GET | `/cliente/me/veiculos/:taskId` | — | veículo + andamento |
| PATCH | `/cliente/me/veiculos/:taskId/identificacao` | `WRITE_VEHICLE_IDENTITY` | série/placa/chassi/plaqueta/pedido/categoria/tipo/previsão/medidas (4 faces)/porta traseira — com a trava de produção (§4.1) |
| POST | `/cliente/me/veiculos/:taskId/projeto` | `WRITE_VEHICLE_IDENTITY` | anexa o **projeto do implemento** (multipart `implementProject`, PDF ou imagem) — §4.1 |
| GET | `/cliente/me/artes` | seção `LAYOUT` | artes dos veículos que o contato vê, com `canDecide` · `?status=PENDING_APPROVAL[,APPROVED,REPROVED]&page=&take=` — §4.2 |
| PUT | `/cliente/me/veiculos/:taskId/artes/:layoutId/aprovar` | `APPROVE_ARTWORK` | sem corpo → a arte `APPROVED` (projetada) — §4.2 |
| PUT | `/cliente/me/veiculos/:taskId/artes/:layoutId/reprovar` | `APPROVE_ARTWORK` | `{ motivo }` (obrigatório, ≥ 3) → `REPROVED` — §4.2 |
| PUT | `/cliente/me/artes/aprovar` | `APPROVE_ARTWORK` | `{ layoutIds[] }` (1–100, sem repetição) → `{ approved, artworks[] }` — o lote, §4.2 |
| GET | `/cliente/me/pedidos` | — | pedidos de compra do cliente · `?searchingFor=` (nº, ou série/nome/placa de veículo coberto) |
| POST | `/cliente/me/pedidos` | `WRITE_PURCHASE_ORDER` | `{ number, issuedAt?, taskIds[] }` |
| GET | `/cliente/me/assinaturas` | — | envelopes pendentes · inclui `envelope.budgetId`, `veiculos[]` e **`pedidoDeCompra{exigido,pendente,mensagem}`** — o VEREDITO do portão do Compras, decidido no servidor |
| POST | `/cliente/me/assinaturas/:signerId/assinar` | — | assina por sessão (§7) |
| GET | `/cliente/me/cobrancas` | seção `PAYMENT` | parcelas, boletos, NFS-e — aceita `?budgetId=` |
| GET | `/cliente/me/assinaturas/:signerId/documento.pdf` | — | o PDF do **recorte deste signatário**, `no-store` |
| GET | `/cliente/me/clientes` | `REQUEST_BUDGET` | clientes que este contato pode apontar (escopado) |
| GET | `/cliente/me/tintas` | `REQUEST_BUDGET` | catálogo de cores (allowlist — a FÓRMULA não sai) |
| GET | `/cliente/me/tipos-de-tinta` | `REQUEST_BUDGET` | o `paintTypeId` do "cadastrar cor" |
| POST | `/cliente/me/tintas` | `REQUEST_BUDGET` | `{ name, hex, finish, paintTypeId }` |

Envelope de resposta idêntico ao resto da API (`{ success, message, data, meta }`),
`meta.totalRecords` / `meta.take`.

⛔ **`take` É LIMITADO A 100.** Tela que precisa de "tudo" está errada por desenho, não
por limite: se ela busca a frota inteira para decidir algo, é porque o dado que ela
precisa não está no payload que ela já tem — o lugar de consertar é o `select` do
servidor. Foi assim que a tela de Assinaturas passou a buscar 500 veículos para
recalcular no navegador um veredito (`pedidoDeCompra`) que o servidor já entregava.

⛔ **O CLIENTE TIPADO NÃO É PROPOSTA — ele ESPELHA o servidor.** `web/src/api-client/portal.ts`
tem de casar campo a campo com os `select` de `portal-read.service.ts` e irmãos. Deriva ali
NÃO dá erro de compilação e sai cara: um `canSign` que o servidor chama de `podeAssinarAqui`
deixa o botão de assinar DESABILITADO para todo mundo, e um `declarations` que o servidor
chama de `declaracoes` faz a cerimônia assinar com ZERO declarações aceitas — que é prova
jurídica, não enfeite de tela. Ambos aconteceram nesta rodada.

⚠️ `?budgetId=` em `/cliente/me/cobrancas` é **FILTRO, nunca escopo** — estreita o
que o escopo já permitiu; id de outra empresa devolve lista vazia.

⚠️ `/cliente/me/orcamentos` **não tem `orderBy` de coluna** (só
`orderBy=fila|recentes`), e o motor de tabela do web marca `manualSorting`: a
ordem é inteiramente do servidor e é `BUDGET_QUEUE_ORDER` —
`[{statusOrder},{queueRank}]`, a MESMA da lista interna.

⛔ `…/assinaturas/:signerId/documento.pdf` **não** é substituível pela rota
pública do orçamento: aquela serve o documento COMPLETO, e um signatário do
portal pode ter recorte sem `PRICING`. Serve-se o `EnvelopeDocument` ligado ao
signatário, resolvido por `{ id, responsibleId }`.

⛔ `POST /paints` é `@Roles(WAREHOUSE, ADMIN, COMMERCIAL, FINANCIAL)` — rota de
FUNCIONÁRIO, que o token do portal não chama. Era por isso que o "criar uma cor
se não tiver salvo" do dono dava 403. `POST /cliente/me/tintas` reusa
`PaintService.create` com `userId` **indefinido**.

✅ **FEITA (20/09)**: `PATCH /cliente/me/veiculos/:taskId/identificacao` —
`portal-identity.{controller,service,module}.ts` + `portal-vehicle-identity.ts`
(a regra pura) + `schemas/portal-vehicle-identity.ts` (a borda). Corpo (hoje,
`.strict()`) `{ serialNumber?, plate?, chassisNumber?, purchaseOrderNumber?,
vinPlateFileId?, category?, type?, forecastDate?, medidas?, portaTraseira? }` —
as três últimas e o nome `type` desde o P13a (§4.1). Multipart com `payload` +
`implementVinPlate` (máx. 1, `image/*`; DD13: o nome antigo `truckVinPlate` não
existe mais). Teste: `test:portal-identificacao`; a rota está fixada em
`test:portal-cliente:boot`.

As cinco decisões que valem registro:

1. ⛔ **ESCOPO COMERCIAL, não o de leitura.** `commercialTaskScopeWhere` — (a)
   pagador ∨ (b) dono, **sem** o caminho pessoal (c). É o MESMO predicado do
   pedido de compra, pela mesma razão: escrever a placa é ato comercial. Fora do
   escopo ⇒ **404**, nunca 403.
2. ⛔ **A COLETA DE ASSINATURAS.** Havendo envelope `RUNNING`/`COMPLETED`,
   PREENCHER o que o documento congelado deixou em branco passa (é a lacuna de
   cadastro tardio, e `tolerateLateRegistration` a absolve); **SOBRESCREVER** o
   que ele já imprime devolve **409** nomeando o campo, o valor impresso e quem
   procurar — em vez de invalidar uma coleta que o cliente não tem como
   refazer. Vale para os quatro campos impressos, inclusive o nº do pedido, que
   não é material mas é impresso.
3. ⚠️ **Sub-portão**: `purchaseOrderNumber` só de quem tem
   `WRITE_PURCHASE_ORDER`. O gestor de frota escreve placa e chassi e **não** o
   pedido. A escrita é delegada ao `PurchaseOrderService` (escrita DUPLA);
   **apagar** o número pelo portal é recusado com 400.
4. Toda tarefa tem exatamente um implemento (DD1): placa, chassi, plaqueta,
   categoria, tipo, **série** (DD14), medidas e porta são escritos em
   `tx.implement` — **nunca** `plate` no topo de `Task`. Tarefa sem implemento
   é 500 nomeado, não um implemento criado aqui.
5. A resposta é a releitura por `PortalReadService.getVehicle`, com o recorte
   por seção aplicado.

### 4.1 ✅ P13a (25/09) — frente, porta traseira, projeto do implemento e a trava de produção

PLANO §7.3/§7.4 (rework Implemento). Tudo em `portal-identity.*`,
`portal-request.*`, `schemas/portal-{request,vehicle-identity}.ts` e
`portal-vehicle-identity.ts`.

**A RESPOSTA MUDOU no P11b** (leitura, `GET …/veiculos/:taskId` e a releitura
que o `PATCH` devolve): `identity` perdeu `category`, `implementType` e
`measures`; eles vivem no bloco **`implement`**, na mesma seção `VEHICLE`:

```ts
identity?:  { serialNumber, plate, chassisNumber, vinPlate, customerOrderNumber, purchaseOrder, customer }
implement?: {
  id, type, category,
  measures: { left, right, back, front },          // METROS; chave `back`, nunca `rear`
  rearDoor: { leaves: 'BIPARTITE' | 'TRIPARTITE' | null, barCount, hatchCount } | null,
  projectFiles: PortalFile[],
}
```

⚠️ A LEITURA fala o enum do banco (`rearDoor.leaves: BIPARTITE`); a ESCRITA
fala português (`portaTraseira.abertura: BIPARTIDA`). A tradução é
`ABERTURA_DA_PORTA`/`portaParaPrisma` (`schemas/portal-request.ts`), e só ela.

**A ESCRITA** (identificação e requisição, a mesma borda):

```ts
medidas?: {                              // CENTÍMETROS; .strict()
  esquerda?, direita?, traseira?, frente?: { height, sections[] } | null,
} | null;
portaTraseira?: {                        // .strict(); faixas = CHECKs do banco
  abertura?: 'BIPARTIDA' | 'TRIPARTIDA' | null;
  varoes?: 2 | 3 | 4 | null;             // NO TOTAL
  portinholas?: 0..6 | null;
} | null;
type?: ImplementType | null;             // era `implementType` — DD13: o nome antigo é 400
```

- Ausente = não mexa; `null` = apague — em cada nível (`medidas: null` apaga as
  quatro faces; `portaTraseira: null` apaga as três colunas; `portaTraseira:
  { varoes: 3 }` muda SÓ os varões). `medidas: {}` e `portaTraseira: {}` não
  pedem nada: sozinhos são 400 "Informe ao menos um campo".
- `medidas`, `portaTraseira` e (na requisição) cada `veiculos[]` são
  `.strict()`: lado ou chave com nome errado (`frontal`, `folhas`,
  `implementType`) é **400 nomeando a chave**, não um 200/201 sem o dado.
- Porta fora da faixa → **400** com a frase da faixa (a mesma da tarefa e do
  `PUT /implements/:id`).
- ⛔ **Frente e porta NÃO entram na guarda do documento congelado** (a folha
  assinada não imprime medida nem porta): nunca dão o 409 da coleta. A guarda
  compara `type` pelo valor cru, lendo a chave selada `implementType` do
  snapshot.
- Face ou porta reenviada IGUAL ao gravado é no-op (sem escrita, sem trilha);
  apagar uma face deixa trilha `IMPLEMENT/<coluna>`; a porta deixa
  `IMPLEMENT/rearDoor*`. `userId: null` e o contato em `metadata`, sempre.
- A requisição: o implemento nasce com a série, `spot: null`, `type`,
  categoria, as faces enviadas e a porta; o recibo traz
  `vehicles[].measureIds: { esquerda, direita, traseira, frente }`.

**⛔ A TRAVA DE PRODUÇÃO (DD5, pergunta 15).** Com a tarefa em `IN_PRODUCTION`
ou `COMPLETED`, o `PATCH` que **muda** medida (qualquer face), porta traseira
ou série é recusado **inteiro**, antes da guarda do documento e de qualquer
escrita:

```ts
409 {
  statusCode: 409, error: 'Conflict',
  message: 'O veículo já está em produção: fale com a Ankaa para corrigir a medida (Frente), a porta traseira e o número de série.',
  fields: ['medidas.frente', 'portaTraseira', 'serialNumber'],   // os caminhos do corpo
}
```

Reenviar o que já está gravado passa (medida comparada em metros, com 0,1 mm
de tolerância). Placa, chassi, plaqueta, categoria, tipo, pedido e previsão
seguem as regras de antes. `CANCELLED` **não** trava (o veículo não está sendo
produzido). A regra é pura: `travaDeProducao` em `portal-vehicle-identity.ts`.

**O PROJETO DO IMPLEMENTO** — `POST /cliente/me/veiculos/:taskId/projeto`:

- multipart, campo **`implementProject`**, até 10 arquivos, cada um
  `application/pdf` ou `image/*` (outro tipo → 400; nenhum arquivo → 400);
- `WRITE_VEHICLE_IDENTITY`, escopo **comercial** (pagador ∨ dono) com a
  conferência dupla; fora dele **404**, nunca 403;
- **acrescenta** a `Implement.projectFiles` (contexto `implementProjectFiles`,
  pasta Projetos; `File` sem `createdById`); tirar um projeto é do lado de
  dentro (`PUT /implements/:id/project-files`);
- trilha `IMPLEMENT/projectFiles` (lista antes × depois), como o caminho interno;
- **sem** trava de produção;
- **201** com a releitura do `GET` (o projeto aparece em `implement.projectFiles`).

⚠️ O projeto, como todo arquivo hoje, é **público por UUID** (bloqueador §9 de
`PORTAL-DO-RESPONSAVEL.md`).

⚠️ **O web do portal (P23) acompanha** tudo isto: `api-client/portal.ts`
(`PortalVehicleIdentityInput` com `type`, `medidas`, `portaTraseira`; o
`implementType` de hoje passa a ser 400), `veiculo-identidade-card`,
`step-veiculos`/`solicitacao-schema` (a requisição manda `veiculos[].type`) e o
tratamento do 409 da trava (painel com a frase + `fields[]`).

✅ **LACUNA FECHADA (20/09)**: `POST /cliente/me/pedidos` escreve o MESMO
`Task.customerOrderNumber` e **não tinha** a guarda do item 2 — um contato com
`WRITE_PURCHASE_ORDER` recebia 409 numa porta e 201 na outra, para a MESMA
escrita. A guarda saiu de `portal-identity.service.ts` para
`portal-frozen-document.ts` (`assertIdentidadeNaoContradizDocumento`) e os
**dois** caminhos chamam a mesma função — nunca duas cópias da regra, que
divergiriam no primeiro conserto.

⚠️ **E só no caminho do PORTAL.** `POST /purchase-orders` e `PUT /tasks/:id`
seguem podendo corrigir o número: o funcionário tem a tela do envelope na frente
e reemite num clique, e para ele invalidar é a resposta certa. A flag é
`guardFrozenDocument` em `UpsertArgs` — ligada em `createFromPortal`, desligada
em `createInternal`. `tests/portal-identificacao.test.ts` roda os dois caminhos
com um `prisma` de mentira e exige a **mesma frase, byte a byte**.

✅ **A TELA (20/09)**: `web/src/components/cliente/veiculo/veiculo-identidade-card.tsx`
edita os cinco campos no lugar. O `purchaseOrderNumber` só é desenhado com
`WRITE_PURCHASE_ORDER` (e fica **visível e trancado** para os demais, em vez de
sumir). As três recusas têm tratamentos distintos: **409** é painel fixo no topo
do card (não-dismissível, com o texto do servidor e o que fazer a seguir),
**400** vai para baixo do campo culpado via `conflicts[]` (`portalErrorConflicts`
em `api-client/portal.ts`), **403** diz que os mapas de capacidade divergiram.

### 4.2 ✅ P13b (25/09) — o cliente aprova a arte, e o orçamento visto pelo portal

PLANO §5.1, §6.3, §7.1–§7.7 (rework Implemento). Rotas em
`portal-artwork.{controller,service,module}.ts` + `schemas/portal-artwork.ts`;
leitura em `portal-read.service.ts` e `portal-projection.service.ts`. A máquina
da arte é do `ImplementLayoutService` (P12): o portal chama
`approveFromPortal`/`reproveFromPortal` com o ator `RESPONSIBLE` — o contato vai
em `decidedByResponsibleId`/`LayoutDecision.responsibleId`, **nunca** numa
coluna de `User`. Teste: `test:portal-arte` (HTTP de verdade);
`test:portal-recorte` (as colunas novas × 9 papéis); `test:portal-cliente:boot`
(as quatro rotas existem).

**AS DECISÕES** — `PUT …/veiculos/:taskId/artes/:layoutId/aprovar`,
`…/reprovar { motivo }` e o lote `PUT /cliente/me/artes/aprovar { layoutIds[] }`:

| resposta | quando |
|---|---|
| **200** | `{ data: PortalArtwork }` (o lote: `{ data: { approved, artworks: PortalArtwork[] } }`) |
| **400** | reprovar sem `motivo` (ausente, em branco, < 3 caracteres, ou a chave errada — o corpo é `.strict()`); lote vazio, com id repetido ou com mais de 100; id que não é UUID |
| **403** | o contato não tem `APPROVE_ARTWORK` (o COMPRAS vê a arte e não a decide) |
| **404** | a arte não existe, está fora do escopo **comercial** (pagador ∨ dono, sem o caminho pessoal (c)), não é do veículo da URL, ou nunca foi ao cliente (rascunho) — **nunca 403** |
| **409** | "Esta arte já foi decidida (está …)": aprovada, reprovada ou substituída; ou o veículo foi cancelado |

- ⛔ **Escopo COMERCIAL** (`commercialTaskScopeWhere`), o mesmo da identidade do
  veículo: a Furgões **pagadora** aprova a arte do caminhão da RKO; um contato
  de outra empresa preso ao veículo por cadastro **vê** a arte (leitura é
  `taskScopeWhere`) e leva 404 ao decidir.
- ⛔ **O lote é tudo-ou-nada na CONFERÊNCIA**: as N artes são provadas antes da
  primeira escrita — uma fora do escopo ⇒ 404, uma já decidida ⇒ 409, e **nada**
  é gravado. ⚠️ A escrita é uma decisão por arte (cada uma na transação do
  serviço do P12); se outra pessoa decidir uma delas ENTRE a conferência e a
  escrita (a corrida do G17), as que já passaram ficam aprovadas e a resposta é
  409 "N de M artes foram aprovadas; …". Uma aprovação legítima não se desfaz
  (D-21).
- A aprovação fecha as O.S. "Aprovar com o Cliente" e as de ARTE em
  `WAITING_APPROVE`, libera a tarefa se a arte era a última peça (DD3) e
  reavalia a assinatura do orçamento (D-31) — tudo pelo serviço do P12. A
  reprovação devolve essas O.S. a `IN_PROGRESS`.

**`PortalArtwork`** — a arte como o cliente a lê (§7.4):

```ts
{
  id, fileId, file: PortalFile | null,
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REPROVED',   // DRAFT e SUPERSEDED nunca saem
  statusLabel,                                            // "Aguardando aprovação do cliente" | "Aprovada" | "Reprovada"
  version, sentAt, decidedAt,
  source: 'PORTAL' | 'ON_BEHALF' | 'INTERNAL' | 'MIGRATED_*' | null,   sourceLabel,
  decidedBy: { name } | null,   // o contato pelo nome; a Ankaa como "Ankaa" — NUNCA o nome do funcionário
  note,                         // o motivo do cliente ou a nota "em nome do cliente"; a nota INTERNA não sai
  canDecide,                    // PENDING ∧ APPROVE_ARTWORK ∧ escopo comercial ∧ veículo vivo
}
```

`REPROVED` só aparece se a arte foi **enviada** (`sentAt`): a reprovação interna
de um rascunho nunca foi ao cliente. A lista `GET /cliente/me/artes` devolve
`PortalArtwork & { vehicle: { taskId, name, serialNumber, plate }, budget: { id, budgetNumber } | null }`,
a pendente mais antiga primeiro.

**A LEITURA — o que cresceu** (contrato só cresce: nada que o web lê sumiu):

```ts
// GET /cliente/me/veiculos/:taskId e vehicles[] do orçamento — seção LAYOUT
artworks?: PortalArtwork[]            // NOVO. `layout.artworks` (só os arquivos APROVADOS) continua igual
progress.timeline[]: + { key: 'ARTE_APROVADA', label: 'Arte aprovada', order: 2 }   // e os seguintes sobem 1

// GET /cliente/me/orcamentos[/:id] — cabeçalho, sem seção
signatureStatus, signatureStatusLabel       // o eixo §2A.4, inclusive "Assinada fora do sistema" (DD11)
valueApproval: {                            // a BudgetValueApproval vigente, ou null
  decidedAt, source, sourceLabel, decidedBy: { name } | null, note,
  total: number | null,                     // só com PRICING
} | null
signature: { status, label, emitted, awaitingMe }   // + status/label; `emitted` LIDO DO EIXO
// seção LAYOUT
artwork?: {
  total, approved, awaitingCustomer, awaitingMe, atAnkaa,   // por VEÍCULO vivo (o cancelado não conta)
  groups: [{ fileId, file, vehicles: [{ taskId, layoutId, status, statusLabel, version, canDecide }],
             pendingLayoutIds }],           // "Aprovar para os N veículos" = PUT /cliente/me/artes/aprovar { layoutIds: pendingLayoutIds }
}

// GET /cliente/me/resumo
waitingOnMe.artworks: {                     // NOVO — "Arte esperando a sua aprovação"
  available,                                // tem APPROVE_ARTWORK
  total,                                    // VEÍCULOS com arte pendente no escopo COMERCIAL
  vehicles: [{ taskId, name, serialNumber, plate, pendingLayoutIds, sentAt, budget }],   // até 10
}
budgets.byStatus                            // sem a chave PRE_APPROVED (sai na M3o-b; até lá é contado em APPROVED)
```

- **Estado da arte de um veículo** (os contadores, §7.7): alguma
  `PENDING_APPROVAL` ⇒ aguardando o cliente (mesmo com uma versão anterior
  aprovada); senão alguma `APPROVED` ⇒ aprovado (o critério do portão da
  emissão); senão ⇒ com a Ankaa (sem arte, só rascunho, só reprovada).
  `awaitingMe` ⊆ `awaitingCustomer`: os que ESTE contato pode decidir.
- ⚠️ **"Arte aprovada" é um degrau LATERAL da escada.** O valor, a arte e a
  chegada do veículo vêm em qualquer ordem (§7.6); por isso o degrau só é
  atingido pela PRÓPRIA prova (alguma arte `APPROVED`/`SUPERSEDED`, com a data
  da primeira aprovação — monotônica por D-21) ou quando a espinha chega a "Em
  produção" (o portão da liberação exige a arte; no legado, sem data). Ele não
  arrasta nem é arrastado pelos outros degraus: "Veículo recebido" com a arte
  pendente mostra "Arte aprovada" **não** atingido. `milestone` é o degrau mais
  alto atingido.
- `signature.emitted` = eixo em `AWAITING_CUSTOMER`, `AWAITING_ANKAA` ou
  `SIGNED` (há um documento da coleta para abrir). `SIGNED_OFFLINE` e `WAIVED`
  não são "emitidos" (não há coleta); `awaitingMe` só com o eixo em
  `AWAITING_CUSTOMER` e um signatário DESTE contato pendente no envelope `RUNNING`.
- ⛔ Todas as chaves novas estão no `select` ENUMERADO
  (`PORTAL_ARTWORK_LAYOUT_SELECT`, `budgetSelect`): chave que não entra lá some
  calada. `decidedByUser` nem é selecionado.

**O AVISO** — `layout.portal_pending_approval` (e o lembrete diário) vai aos
contatos ATIVOS da tarefa que **podem aprovar**: papel com `APPROVE_ARTWORK`
(`ARTWORK_APPROVER_ROLES`, derivado de `ROLE_CAPABILITIES`) **e** empresa no
escopo comercial do veículo (`commercialTaskLink`). O contato vai em
`Notification.responsibleId`, nunca em `userId`.

⚠️ **Fica para a integração do par** (P14 ∥ P13b): o `emission { ready,
blockers[] }` do orçamento no portal ("Para emitir o documento falta…", em
linguagem de cliente) liga `emissionOf` do P14 em `portal-read.service.ts`; e o
trecho do P14 (aprovar valor → `APPROVED` com `BudgetValueApproval{PORTAL}`,
recusa → `PENDING`, o `orderNumber` da cerimônia) entra nas linhas das rotas
`aprovar-valor`/`recusar` e no §7.

⚠️ **O web do portal (P23) acompanha**: `api-client/portal.ts` (tipos
`PortalArtwork`, `artworks`, `artwork`, `valueApproval`, `signatureStatus*`,
`signature.status/label`, `waitingOnMe.artworks`, a chave `ARTE_APROVADA` em
`PortalMilestoneKey`), o card **Arte** do veículo, o `OrcamentoLayoutCard` com o
lote e o grupo do Início.

## 5. A REQUISIÇÃO — `POST /cliente/me/orcamentos`

```ts
{
  customerId?: string;          // cliente existente
  novoCliente?: {               // OU criar na hora (combobox "criar")
    fantasyName: string;
    cnpj?: string; cpf?: string;   // ⚠️ EXIGIR um dos dois no zod do portal:
                                   //    /customers/quick pula esse refine e o
                                   //    cliente nasce sem documento, travando a
                                   //    NFS-e lá na frente.
    ...demais campos de customerQuickCreateSchema
  };
  faturarParaCustomerId?: string; // BudgetPayer.customerId ("Faturar Para")
                                  // ⚠️ OPCIONAL: com `novoCliente` o cliente não
                                  // tem id no envio, então exigi-lo tornava
                                  // "faturar para o cliente novo" inexprimível.
                                  // Ausente = o pagador é o DONO do veículo.
  briefing: string;              // BudgetRequest.briefing
  logoName?: string;             // BudgetRequest.logoName
  paintId?: string;              // Task.paintId (tinta geral)
  novaTinta?: { name; hex; finish; paintTypeId };  // POST /paints antes
  veiculos: Array<{               // ⚠️ .strict() desde o P13a (chave errada = 400 nomeado)
    serialNumber?: string;       // ⚠️ TEXTO, não número — mora em Implement.serialNumber (DD14)
    plate?: string;              // PLATE_REGEX, 7 chars
    chassisNumber?: string;      // 17 chars, sem I/O/Q
    category?: ImplementCategory;
    type?: ImplementType;        // ⚠️ `type`, não `implementType` (DD13)
    medidas?: { esquerda?, direita?, traseira?, frente? };  // ⚠️ CENTÍMETROS na borda
    portaTraseira?: { abertura?: 'BIPARTIDA'|'TRIPARTIDA', varoes?: 2|3|4, portinholas?: 0..6 };
  }>;
  // arquivos-base vão por multipart, campo `baseFiles` (máx 30)
}
// ⚠️ FORMA DO MULTIPART: UMA parte `payload` com o JSON inteiro acima + N partes
// `baseFiles`. NÃO é campo-a-campo. (Decidido na integração: era a divergência
// entre o schema da API e o cliente do web, e três pacotes do web já compilavam
// contra esta forma.)
```

Nasce `Budget{ status: REQUESTED, statusOrder: 1, subtotal: 0, total: 0 }`, **sem
`BudgetItem`**, com N `Task` (uma por veículo) e **um** `BudgetPayer`.

### ⛔ As armadilhas obrigatórias
1. **Produto cartesiano viola as unicidades.** `Implement.serialNumber` e `Implement.plate`
   são `@unique` GLOBAIS. N placas × 1 série → N tasks com a mesma série → 400.
   Cada veículo da requisição é um par (série, placa) **explícito**, nunca um
   produto. Faixa de série ("1001 a 1005") expande no CLIENTE para 5 linhas
   editáveis antes de enviar, como já faz o `SerialNumberRangeInput`.
2. **Série só aceita numérico no caminho de criação atual**
   (`z.array(z.number())`). O portal precisa de string — use o caminho de criação
   por veículo, não o de faixa.
3. **Medidas: banco em METROS, formulário em CENTÍMETROS** (÷100 na borda).
4. **`taskUpdateSchema` NÃO é `.strict()`** — chave fora do lugar some em
   silêncio. `implement.plate`, nunca `plate` no topo.
5. **O caminho de faixa de série DESCARTA os arquivos enviados**
   (`task.service.ts:1879-1936` declara `files` e nunca usa). Não o reuse.

### ✅ O DOCUMENTO QUE JÁ EXISTE REAPROVEITA O CADASTRO (20/09)

O `novoCliente` cujo **CNPJ ou CPF já está cadastrado** não é mais **400**. O
400 (`"O CNPJ … já está cadastrado."`) era um beco: quem abre a requisição
CONHECE a empresa, digita o CNPJ dela, e a porta fecha sem dizer por onde
seguir — porque o cadastro pode estar **fora do escopo** dele, e então nem
`GET /cliente/me/clientes` o encontra. O que a pessoa faz em seguida é mudar
uma letra do nome e criar o **segundo cadastro da mesma empresa**, que parte o
faturamento em dois (é por isso que `POST /customers/merge` existe).

Agora `resolverCliente` decide **nesta ordem**:

1. `clientePeloDocumento` — casou CNPJ **ou** CPF, nas **duas grafias**
   (dígitos e formatado) ⇒ **REAPROVEITA**: nenhum `create`, nenhum `update`;
2. sem casar, `fantasyName` repetido ⇒ **400** (`Customer.fantasyName` é
   `@unique`, e são duas empresas diferentes com o mesmo nome de fachada) —
   a frase diz os dois caminhos de saída;
3. sem nada ⇒ cria, como sempre.

⚠️ **A ORDEM É A REGRA.** Invertida, a checagem de nome recusaria o caso normal
em que se digita o mesmo nome **e** o mesmo documento do cadastro existente.

⚠️ **AS DUAS GRAFIAS SÃO OBRIGATÓRIAS.** `customerCreateSchema` nunca limpou o
documento, então o cadastro guarda `12.345.678/0001-90` ao lado de
`12345678000190`, e a unicidade da coluna não vê os dois como o mesmo
documento.

⛔ **NADA do cadastro encontrado é escrito** — nem nome, nem endereço, nem
inscrições. Ele é o registro-mestre da Ankaa e quem abre a requisição não é dono
dele; divergência entre o digitado e o gravado é **ignorada**, não é erro.

⛔ **E NÃO HÁ ROTA NOVA DE BUSCA POR DOCUMENTO.** O 400 que existia já divulgava
o mesmo fato (nomeava o CNPJ como cadastrado); reaproveitar troca porta fechada
por caminho e **não** acrescenta divulgação. Uma rota de consulta acrescentaria.

O recibo de `POST /cliente/me/orcamentos` ganhou três campos — e o web os espelha
em `PortalBudgetRequestResult` / `PortalReusedCustomer`:

```ts
{
  customerId: string;        // o cadastro DE FATO usado
  customerName: string;      // o nome fantasia DELE, não o digitado
  customerCreated: boolean;  // nasceu nesta requisição?
  customerReused: null | {   // ⚠️ null também quando se ESCOLHE na lista
    id: string;
    fantasyName: string;              // como está no cadastro
    matchedBy: 'cnpj' | 'cpf';
    document: string;                 // JÁ FORMATADO
    typedFantasyName: string | null;  // o digitado, SÓ quando difere
  };
}
```

⚠️ `customerCreated === false` **sozinho não distingue** "reaproveitou" de
"escolheu na lista" — por isso `customerReused` é um objeto, e não um segundo
booleano.

⚠️ A `message` do envelope também cita o reaproveitamento (o interceptor do web
toasta toda escrita bem-sucedida), e a tela **ainda assim** interrompe com
`ClienteReaproveitadoDialog` antes de navegar: um toast some, e trocar o nome do
cliente em silêncio seria pior que o 400 que havia antes.

⚠️ `faturarParaCustomerId` ausente resolve para o id **reaproveitado** —
`resolverPagador` recebe o `customerId` já resolvido, e é isso que mantém
`BudgetPayer` (e a NFS-e) no cadastro certo.

Fixado em `tests/portal-requisicao.test.ts` §12 e §13, que **exercitam o
serviço** com um `prisma` de mentira (não inspecionam a fonte): as duas grafias,
os dois documentos, a recusa por nome, o pagador, e o
`responsibles: { connect }` que faz a requisição — e o cliente dela — seguirem
visíveis para quem a abriu.

## 6. A PRÉ-APROVAÇÃO

`PUT …/aprovar-valor` → grava `BudgetRequest.preApprovedAt/preApprovedByResponsibleId/
decisionNote` e move `IN_NEGOTIATION → PRE_APPROVED`.
`PUT …/recusar` → grava `refusedAt/refusedByResponsibleId/decisionNote` e move
`IN_NEGOTIATION → REQUESTED`.
CHECK do banco: pré-aprovado **e** recusado ao mesmo tempo é recusado pelo banco.
Notifica o comercial (`Notification.userId`) — e a decisão contrária notifica o
requisitante (`Notification.responsibleId`, novo).

## 7. ASSINATURA POR SESSÃO

- Valor novo `SignatureAuthMethod.RESPONSIBLE_SESSION` (**nunca** `INTERNAL_SESSION`:
  `ceremonyKindOf` é um ternário com 4 dependentes que viram lado-Ankaa em silêncio).
- Resolver o signatário por `{ id, responsibleId: principal.responsibleId }` —
  hoje **nenhuma** consulta busca `EnvelopeSigner` por `responsibleId`.
- Reusar a doutrina de `countersign` (`signature-envelope.service.ts:4190+`):
  mesma `assertSignable`, mesma checagem de frescor, mesma evidência + HMAC.
- **Cláusula de aceite**: `acceptanceClauseFor()` (`signature.constants.ts:77-96`)
  é impressa e CONGELADA no PDF e declara autenticação "por código de uso único".
  Precisa de VARIANTE para sessão, com declarações sem `identity` e **com
  `authority`**. A escolha é feita NA EMISSÃO.

### ⛔ O PORTÃO DO PEDIDO DE COMPRA
> Responsável cujo **único** papel é `PURCHASING` só assina se o veículo tiver
> número de pedido. `roles.length === 1 && roles[0] === 'PURCHASING'`.
> Sem número: **403** com a mensagem
> `"Informe o número do pedido de compra antes de assinar."`
> Quem acumula Compras com Comercial/Vendedor/Representante/Coordenador **não** é
> barrado.

## 8. A REMOÇÃO DA O.S. "EM NEGOCIAÇÃO"

Sai o acoplamento inteiro, nos dois sentidos:
- `api/src/utils/em-negociacao-sync.ts` — arquivo inteiro
- `service-order.service.ts:1877` (`EM_NEGOCIACAO_DESC`), `:1941-2030` (concluir
  aprova o orçamento), `:2053-2110` (reabrir rebaixa APPROVED→PENDING)
- `POST /budgets/:id/sync-em-negociacao` (`budget.controller.ts:315`)
- `web/src/components/production/task/detail/service-orders-section.tsx:44`
- `constants/service-descriptions.ts` — tirar a descrição da lista de sugestões

⚠️ **NÃO** remova o tipo `ServiceOrderType.COMMERCIAL` nem as outras descrições:
"Enviar Orçamento" tem **1.703 linhas** em produção e continua em uso. O que sai é
UMA descrição (486 linhas, 120 abertas), já tratada pela migration.

## 9. ACOMPANHAMENTO — o que pode ir para o cliente

| marco | fonte |
|---|---|
| Orçamento enviado | `Budget.createdAt` |
| Em produção | `Task.startedAt` (a mais confiável) |
| Etapa X | `ServiceOrder{PRODUCTION}.startedAt/finishedAt` |
| Check-in/out | **`Task.checkinFiles` / `Task.checkoutFiles`** — ver correção abaixo |
| Concluído | `Task.finishedAt` |

⚠️ **CORREÇÃO (20/09, achada na implementação):** a linha de check-in/out acima
dizia "O.S. de checklist", e as O.S. de checklist são **`LOGISTIC`**, não
`PRODUCTION` (`service-descriptions.ts:288-289`). `LOGISTIC` carrega 41
descrições de coordenação INTERNA — "Cobrar Setor Produção", "Escalar
Prioridade", "Registrar Avarias Entrada". Liberar o tipo repetiria o vazamento do
`COMMERCIAL` noutro tipo. A fonte certa é `Task.checkinFiles`/`checkoutFiles`,
que não depende de comparar texto livre.

⛔ **NENHUMA O.S. `COMMERCIAL` vai para o cliente** — são 52 descrições, incluindo
"Aplicar Desconto", "Contraproposta", "Tratar Reclamação". Filtre por TIPO no
servidor.
⛔ **NUNCA** exponha: `totalActiveTimeSeconds`, `assignedTo`/`startedById`/
`completedById`, `PAUSED`/`pausedAt`, `Implement.spot`, bonificação, `Observation`,
`Task.details`, `Cut.reason`, `Airbrushing.price`/`painterId`, `Task.term`.
⚠️ Carimbos de produção são APAGADOS (O.S.→PENDING zera datas; cancelar toda O.S.
de produção zera `Task.startedAt`; `COMPLETED→PREPARATION` é legal). A linha do
tempo do cliente é **projeção monotônica**: um marco atingido não regride.

## 10. CONVENÇÕES QUE NÃO SE NEGOCIAM

**API** — `@ResponsibleOnly()` basta para guardar · principal em
`request.responsible`, **jamais** `request.user` · **nunca** `@UserId()` no portal
(827 pontos, 46 FKs NOT NULL de `User`) · zod na borda; lembre que nada é
`.strict()` e chave desconhecida some em silêncio · `.optional().default(x)` e
`.default(x).optional()` têm semântica OPOSTA.

**WEB** — `Input` entrega o **valor**, `Textarea` entrega o **evento** ·
`Combobox.onValueChange` · `Checkbox/Switch.onCheckedChange` ·
`DateTimeInput.onChange(Date|null)` · `toast` só de `@/components/ui/sonner`, e o
interceptor do axios **já** toasta erro de API e sucesso de escrita · envelope é
`meta.totalRecords`/`meta.take` · erro é `error._statusCode`, **não**
`error.response.status` · id de coluna de DataTable **sem ponto** · usar
`PageHeader`, `DataTablePage`, `DetailPage`, `Form*`+`FormSteps`,
`useUnsavedChangesGuard`, `Card*`, `EmptyState`, `Skeleton` · **proibido**
`ui/data-table.tsx`, `ui/detail-page-header.tsx`, `ui/detail-page-layout.tsx`,
`ui/standardized-table.tsx`.

⛔ **CORREÇÃO (20/09): `DetailPage` NÃO SERVE NO PORTAL.** Ele puxa
`useDetailLayout`, `useFieldGate`, `usePrivileges` e `useAttentionEntity` — todos
do `AuthProvider`/`AttentionProvider` do FUNCIONÁRIO, e o portal é irmão deles de
propósito. Idem `PageHeader` com a prop `favoritePage` (`useFavorites()` LANÇA).
Use **cards empilhados**, que é a preferência permanente do dono de qualquer
forma. `DataTablePage`/`DataTable` FUNCIONAM — mas só porque `useMyPreferences`
passou a usar `useOptionalAuth`; sem isso toda tabela do portal era tela branca.

⚠️ **ALTURA:** `DataTable` é `h-full → flex-1 min-h-0 → overflow-auto`. A cadeia
de altura mora em `responsible-layout.tsx` (`h-dvh` → `shrink-0` → `flex-1
min-h-0`); dentro dela use `h-full` e **nunca** um `calc(100dvh-Nrem)` à mão — o
cabeçalho do portal já mudou de altura duas vezes nesta rodada.

**Preferências permanentes do dono** — checkbox em vez de switch · cada seção em
seu **próprio card contornado**, nunca um scroll contínuo · acordeão de expansão
única · diálogo abraça o conteúdo · rótulo não pode ser menor que o controle ao
lado.

**Portal (web)** — a árvore do portal **não** herda o `AuthProvider` do
funcionário e tem `<Toaster/>` próprio · cliente HTTP isolado
(`api-client/responsible-auth.ts`, chave `ankaa_cliente_token`) · `hasRole` é
união · `restoreFailed` ≠ deslogado.

⚠️ **COLISÃO DE ROTA FIXADA EM TESTE**: `/cliente/:customerId/orcamento/:id` (a
pública) pontua **acima** de `/cliente/painel/*`. Seção do portal chamada
`orcamento` (singular) **nunca é alcançada**. Use `orcamentos` (plural).
A rota-mãe do provider **não pode ganhar `path`**.

## 11. VERIFICAÇÃO

`api`: `pnpm build` é o único typecheck (`strict:false`, `tests/` excluído).
`web`: `pnpm build:with-tsc` (o `build` puro NÃO typecheca) e `pnpm test:run`
(o `test` puro é WATCH e trava um agente).
Teste novo segue o estilo de `test:responsible-otp`: **tsx puro, sem banco**.
