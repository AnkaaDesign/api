# Portal do Responsável — documento de decisão

**Data:** 20/09/2026 · **Base:** `api` `e81fd9f1` · `web` `c72799b5`, ambos na `main`
**Branch:** `feat/portal-do-responsavel` (api + web) · **Status:** ✅ IMPLEMENTADO, não commitado
**Método:** 10 auditorias paralelas para desenhar, 12 implementadores paralelos para construir,
2 de reconciliação para fechar. Tudo abaixo é citado.

> ⚠️ **A MIGRATION `20260920120000` NÃO FOI APLICADA.** Ela recria o tipo `BudgetStatus` e
> **apaga 486 linhas de `ServiceOrder`**. Exige decisão do dono e dump antes.
> Ver também: `20260917220000_portal_do_cliente_sessao_por_otp` (a sessão do portal, base
> desta feature) **também segue sem aplicar em produção**.
>
> ⚠️ **`docs/PORTAL-CONTRATO.md` é a fonte de verdade operacional.** Este documento guarda o
> RACIOCÍNIO; onde os dois divergirem, vale o contrato — ele foi corrigido durante a
> implementação, este não.

---

## 0. O RESUMO EM UMA PÁGINA

O portal do cliente **já autentica e não serve nada**. São quatro rotas, todas de auth
(`/cliente/auth/{codigo,entrar,eu,sair}`), e `/cliente/me/*` não existe — grep exaustivo.
O painel é literalmente uma caixa tracejada, e a tela de login promete "Acompanhe seus…
faturamentos".

O que falta **não é autenticação**. É:

1. **superfície de dado com escopo** — e o escopo certo não é óbvio, porque a Furgões não é
   dona do caminhão (§3);
2. **um eixo de privilégio que já existe e nunca foi usado** — `@ResponsibleRoles()` e
   `<ResponsibleRoute roles={…}>` têm **zero call sites** nos dois repositórios;
3. **dois estados novos de orçamento** — e o primeiro deles é a razão de ser da feature;
4. **uma entidade de pedido de compra** que já foi desenhada e nunca construída
   (`REESTRUTURACAO_ORCAMENTO_FATURAMENTO.md` §2.12).

A tese deste documento é que **não se inventa um segundo sistema de permissão**. A régua que
decide qual recorte do PDF cada papel assina é a mesma que decide qual recorte da TELA cada
papel vê. Uma régua, dois consumidores.

---

## 1. O DIAGNÓSTICO

### 1.1 O que já existe, e é bom

| peça | onde | estado |
|---|---|---|
| Sessão do responsável por OTP, token opaco de 256 bits, relida do banco a cada request | `people/responsible-auth/` | pronta |
| `ResponsibleAuthGuard` global; `@ResponsibleOnly()` **é** a guarda ("marcar a rota é guardá-la") | `auth.guard.ts:79-85` | pronta |
| Separação estrutural `request.responsible` × `request.user` | idem | pronta |
| `ResponsibleRole` com **9 valores**, incluindo `PURCHASING` ("Compras") | `schema.prisma:3551` | **pronta** |
| Recorte por papel: `sectionsForRoles()` | `signature/quote-sections.ts:188` | pronta, 2 consumidores |
| `EnvelopeSigner.responsibleId` FK real + `@@unique([envelopeId, responsibleId])` | `schema.prisma:8262` | pronta |
| `SignatureAuthMethod.INTERNAL_SESSION` e `countersign` (assinatura por sessão, sem OTP) | `signature-envelope.service.ts:4190` | pronta, lado Ankaa |
| Furgões Ibiporã fixada por UUID, com regra de atenção de pedido de compra | `config/company.ts:153` | pronta |

**`PURCHASING` já existe.** Entrou em `20260901120000_responsible_role_purchasing`, na mesma
migration que removeu `OWNER`. Não há papel novo a criar.

### 1.2 O que não existe

- **`/cliente/me/*`** — nenhuma rota. Só duas ocorrências de `@ResponsibleOnly()` em todo o `src/`.
- **Notificação para responsável.** `Notification.userId → User` é a única FK de pessoa
  (`schema.prisma:2833`); `getTargetUsers` só resolve `prisma.user`. O cliente é alcançado
  por fora: cerimônia de assinatura e OTP do portal. **Um fluxo com passagens de bastão entre
  vendedor, compras e comercial não tem como avisar ninguém hoje.**
- **`PurchaseOrder`** — desenhada em `REESTRUTURACAO_ORCAMENTO_FATURAMENTO.md` §2.12 (pacote
  P5), nunca construída. `Task.customerOrderNumber` é texto livre, não-unique, máx. 100.
- **Estado de requisição** e **estado de pré-aprovação** no orçamento.
- **Campo de entrega.** `COMPLETED` quer dizer "a logística fez o checkout"; não existe
  `deliveredAt`. É uma lacuna da linha do tempo do cliente (§6.3).

### 1.3 O que existe e atrapalha

**"Em Negociação" não é estado de nada.** É a `description` — **texto livre** — de uma
`ServiceOrder` com `type = COMMERCIAL`, comparada em **três lugares com três normalizações
diferentes** (`em-negociacao-sync.ts:30`, `service-order.service.ts:1877`,
`web/.../service-orders-section.tsx:44`, esta última sensível a caixa E acento). E essa string
**controla a aprovação do orçamento nos dois sentidos**: concluí-la aprova (`:1941-2030`),
reabri-la rebaixa `APPROVED → PENDING` (`:2053-2110`).

É exatamente o nome que o dono quer para o estado novo. **Reusar a palavra sem promover a
coisa cria duas "negociações" que se movem sozinhas.** Ver a decisão D2 (§8).

---

## 2. A TESE — uma régua, dois consumidores

`sectionsForRoles(roles)` devolve, hoje, o conjunto de seções do PDF que um contato recebe
para assinar (`quote-sections.ts:128-141`):

| papel | rótulo | seções |
|---|---|---|
| `COMMERCIAL` `SELLER` `REPRESENTATIVE` `COORDINATOR` `PURCHASING` | Comercial, Vendedor, Representante, Coordenador, Compras | **tudo** |
| `FINANCIAL` | Financeiro | `SERVICES PRICING DELIVERY PAYMENT GUARANTEE` (tudo menos LAYOUT) |
| `MARKETING` | Marketing | `LAYOUT` |
| `FLEET_MANAGER` `DRIVER` | Gestor de Frota, Motorista | `[]` — **não assinam** |

Essas sete seções descrevem, sem nenhuma adaptação, o que uma tela de portal precisa recortar:

| seção | o que libera na TELA |
|---|---|
| `VEHICLE` | série, placa, chassi, plaqueta, pedido; tipo, categoria, medidas (4 faces), porta traseira e projeto do implemento (bloco `implement`, P11b/P13a) |
| `LAYOUT` | artes, logomarca, arquivos-base, cores de pintura |
| `SERVICES` | a lista de serviços contratados |
| `PRICING` | preço unitário, subtotal, total, desconto |
| `DELIVERY` | prazo, previsão, **andamento das O.S.** |
| `PAYMENT` | parcelas, boletos, NFS-e |
| `GUARANTEE` | garantia |

> **Regra:** um campo do portal declara a seção a que pertence. O projetor de resposta corta
> pela interseção com `sectionsForRoles(responsible.roles)`. **No servidor, num `select`, não
> num filtro de React.**

A última frase é o corretivo de um defeito vivo: `findPublic` devolve o cadastro fiscal, as
parcelas, os boletos e as notas de **todos** os pagadores, e o recorte por cliente é um
`.filter()` no navegador (`web/src/pages/public/budget/[id].tsx:161-170`). Num orçamento de
dois pagadores, A recebe o CNPJ, o endereço e o plano de pagamento de B.

### 2.1 As ações não são seções

Seção responde "o que eu vejo". Falta "o que eu faço". **PROPOSTA** — `PORTAL_CAPABILITIES`,
um segundo mapa, pequeno e explícito:

| capacidade | `COMMERCIAL` | `SELLER` | `REPRESENTATIVE` | `COORDINATOR` | `PURCHASING` | `MARKETING` | `FINANCIAL` | `FLEET_MANAGER` | `DRIVER` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `REQUEST_BUDGET` — abrir requisição | ✅ | ✅ | ✅ | ✅ | — | ✅¹ | — | — | — |
| `APPROVE_VALUE` — aprovar o valor/recusar | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| `WRITE_PURCHASE_ORDER` — nº do pedido | — | — | — | — | ✅ | — | ✅ | — | — |
| `WRITE_VEHICLE_IDENTITY` — série/placa/chassi/plaqueta | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — |
| `SIGN` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | ✅² | — | — |
| `TRACK` — acompanhar O.S. | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | — | ✅ | ✅ |

¹ Marketing abre requisição mas **não vê preço** — a seção `PRICING` não está no papel dele.
² Derivada: assina/acompanha **o seu recorte**, não o documento inteiro.

Duas escolhas que valem defesa:

- **`FLEET_MANAGER` ganha `WRITE_VEHICLE_IDENTITY`.** Hoje ele não assina nada — o papel existe
  e não faz nada. Mas é literalmente quem sabe placa e chassi da frota. É o encaixe natural.
- **`WRITE_PURCHASE_ORDER` é de `PURCHASING`**, que é o Compras da Furgões — quem *emite* o
  pedido. A audiência interna do mesmo campo é `ADMIN/FINANCEIRO/COMERCIAL`
  (`task.permissions.ts:44`), e o gerente de produção foi **removido** dela em 17/09. Este
  desenho não devolve o campo a ninguém que o perdeu; acrescenta o lado de fora.

---

### 2.2 A contradição que a implementação expôs — e a regra que a resolve

Dois implementadores, independentemente, bateram no mesmo ponto: **`sectionsForRoles(['FLEET_MANAGER'])`
e `(['DRIVER'])` devolvem `[]`**. Isso está certo para a ASSINATURA — vazio ali significa "este
contato não assina", que é o padrão dos dois, e o schema explica por quê:

> *"Assinar por padrão seria o inverso: colher a assinatura de quem provavelmente não tem
> poderes, o que é justamente a disputa que a declaração de representação existe para
> enfrentar."*

Aplicada à TELA, porém, a mesma régua dava um **portal em branco** justamente a quem o §2.1 deu
trabalho a fazer: o gestor de frota escreve placa e chassi, e os dois acompanham o serviço. O
`PATCH` funcionava e o `GET` vinha vazio.

**Mexer em `ROLE_DEFAULT_SECTIONS` conserta a tela e estraga a cerimônia** — `createEnvelope`
decide quem assina por `sections.length > 0`, então o gestor viraria signatário de todo
orçamento. Era trocar um defeito de tela por um defeito jurídico.

A saída não é um segundo mapa escrito à mão; é **derivação** do mapa de capacidades que já
existe:

> **Você vê o que assinaria, MAIS o que pode fazer.**

`portalSectionsFor(roles) = sectionsForRoles(roles) ∪ ⋃ SECTION_IMPLIED_BY_CAPABILITY[cap]`,
onde `APPROVE_VALUE ⇒ PRICING` (não se aprova preço que não se vê), `WRITE_PURCHASE_ORDER ⇒
PAYMENT` (o número do pedido é dado fiscal), `TRACK ⇒ DELIVERY`, `WRITE_VEHICLE_IDENTITY ⇒
VEHICLE`.

A régua da assinatura fica **intocada byte a byte**, e a divergência aparece em exatamente três
papéis — os três de recorte estreito, que é onde ela era necessária:

| papel | assina | vê na tela |
|---|---|---|
| `MARKETING` | `VEHICLE LAYOUT` | `VEHICLE DELIVERY LAYOUT` |
| `FLEET_MANAGER` | `[]` | `VEHICLE DELIVERY` |
| `DRIVER` | `[]` | `VEHICLE DELIVERY` |

Nenhum dos três ganhou `PRICING` nem `PAYMENT`. `tests/portal-recorte.test.ts` guarda as **duas**
tabelas-verdade lado a lado, e falha se alguém "unificar" as réguas.

## 3. O ESCOPO DO DADO — o problema que a Furgões cria

A Furgões Ibiporã **não é dona do caminhão**. Ela faz o baú e intermedeia a pintura. Isso já
está em dado de produção, transcrito na migration `20260917150100`:

> Orçamentos 259–262: **dois clientes** (Ibiporã Implementos + RKO Alimentos), **um** `Billing`,
> repartição por linha de serviço — e a repartição estava escrita **à mão, na OBSERVAÇÃO de
> cada serviço**: `"(faturamento ibiporã)"` na pintura, `"(faturamento Rko Alimentos)"` nas
> logomarcas — porque não existia coluna.

Um contato da Furgões tem `companyId = IBIPORA`. O caminhão é da RKO. **Escopar por
`responsible.companyId === Task.customerId` não mostraria nada à Furgões.**

**PROPOSTA — `PortalScopeService`, a união de três caminhos, num único lugar:**

```ts
// (a) minha empresa PAGA por isto            ← o caso 259-262
{ billings: { some: { customerConfigs: { some: { customerId: companyId } } } } }
// (b) minha empresa é a DONA do veículo
{ tasks: { some: { customerId: companyId } } }
// (c) EU sou contato de um dos veículos      ← a única que hoje decide quem assina
{ tasks: { some: { responsibles: { some: { id: responsibleId } } } } }
```

Três observações que mudam a implementação:

1. **`companyId` é nullable** (`schema.prisma:3510`). Uma consulta sem guarda vira
   `WHERE companyId IS NULL`, que não é "nada" — é "todos os órfãos". O serviço **recusa**
   responsável sem empresa antes de montar o `where`.
2. **`Task.responsibles` é m:n e nada confere contra `Task.customerId`.** Um contato da Furgões
   já pode estar preso a um caminhão da RKO — e é, por acidente, a única modelagem de
   intermediação que existe. O caminho (c) transforma esse acidente em regra.
3. **Escopo ≠ projeção.** (a)(b)(c) dizem *quais linhas*. `sectionsForRoles` diz *quais
   colunas*. Os dois são obrigatórios; nenhum substitui o outro.

### 3.1 Âncora do dinheiro

Para faturamento, a âncora confiável é **`Invoice.customerId` (NOT NULL)**, não
`Installment.customerConfigId` (opcional, fica órfão em reversão). O precedente já escrito é
`DossierAssemblerService.build(quoteId, { customerId })`, que **recusa** cliente fora do
faturamento (`dossier-assembler.service.ts:354-363`) e corta boleto e nota por
`invoice.customerId`. **O portal copia esse padrão, não inventa outro.**

⚠️ `MoneyRedactionInterceptor` **não protege o portal**: ele chaveia em `request.user.role`, e
a guarda do responsável escreve em `request.responsible`. Com privilégio indefinido ele deixa
passar intocado. A redação do portal é do projetor, não dele.

---

## 4. A MÁQUINA DE ESTADOS

### 4.1 Hoje

`BudgetStatus`, 5 valores (`api/src/constants/sortOrders.ts:177`):
`EXPIRED(1)` `SIGNED(2)` `PENDING(3)` `APPROVED(4)` `CANCELLED(5)`.
A ordem é de **ATENÇÃO**, não cronológica — mesma doutrina de `BILLING_STATUS`, onde `PARTIAL`
vem antes de `APPROVED` por decisão do dono.

`SIGNED` e `EXPIRED` **não são destino de nenhuma transição** — só a cerimônia os escreve, via
`update(_internal=true)`.

### 4.2 DECIDIDO (20/09/2026, com o dono)

| valor | order | rótulo | **quem está devendo** |
|---|:-:|---|---|
| `REQUESTED` | **1** | Requisição | **a Ankaa** — pediram e ninguém precificou |
| `EXPIRED` | 2 | Aguardando Reanálise | a Ankaa |
| `PRE_APPROVED` | **3** | Pré-aprovado | a Ankaa — falta LANÇAR as assinaturas |
| `SIGNED` | 4 | Assinado | a Ankaa (aprovação interna) |
| `IN_NEGOTIATION` | **5** | Em Negociação | **o vendedor** (lado cliente) |
| `PENDING` | 6 | **Aguardando Assinatura** | o cliente |
| `APPROVED` | 7 | Aprovado | — |
| `CANCELLED` | 8 | Cancelado | — |

```
REQUESTED      → IN_NEGOTIATION, PENDING, CANCELLED
IN_NEGOTIATION → PRE_APPROVED, REQUESTED, CANCELLED
PRE_APPROVED   → PENDING, IN_NEGOTIATION, CANCELLED
PENDING        → APPROVED, IN_NEGOTIATION, CANCELLED
EXPIRED        → PENDING, REQUESTED, CANCELLED
```

**`IN_NEGOTIATION` e não `PRE_APPROVAL`** — decisão do dono. A O.S. comercial
"Em Negociação" foi REMOVIDA na mesma rodada (§1.3 e contrato §8), então a
palavra deixou de estar ocupada: existe uma negociação só, e ela é o estado do
orçamento. `PRE_APPROVED` é o estado SEGUINTE — o vendedor clicou em Aprovar.

**`SIGNED` fica** (decisão do dono): a contra-assinatura da Ankaa continua sendo
um passo visível, e não um efeito.

**"Pendente" vira "Aguardando Assinatura"** — rótulo, não valor de enum. O valor
`'PENDING'` viaja em filtro salvo, no app Flutter em produção e em changelog
gravado como string.

### 4.3 ⛔ As cinco armadilhas de mexer nessa ordem

1. **Ordem 0 é proibida.** `utils/sortOrder.ts:74` e `budget.service.ts:6206-6208` calculam
   `MAP[status] || 1` — **0 vira 1 em silêncio** — enquanto
   `budget-prisma.repository.ts:241` usa `?? 8` e **preserva o 0**. O mesmo status ganharia
   `statusOrder` diferente no CREATE e no UPDATE, sem erro. **Por isso `REQUESTED` é 1 e os
   outros deslocam.**
2. **`statusOrder` é persistido** → migration de backfill sobre as ~720 linhas. Precedentes:
   `20260911160000`, `20260916233000:152-159`. Some o `@default(1)` do schema (`:1891`).
3. **`queueRank` é coluna GERADA** com `IN ('APPROVED','CANCELLED')` **hardcodado**, e alimenta
   o sort padrão `[{statusOrder},{queueRank}]`. Nenhum dos dois estados novos é terminal, então
   a coluna **não precisa mudar** — mas isso tem de ser verificado, não presumido.
4. **`BUDGET_QUOTE_STATUSES`** (`budget-table-columns.tsx:470`) é **ao mesmo tempo** as opções
   do filtro, o `where.status={in:…}` **padrão** da lista e o guard da célula. Status fora dela
   **não aparece na tela de jeito nenhum**.
5. **Listas positivas que tratam desconhecido como pós-aprovação:** `web/src/lib/attention/rules.ts:60`
   (com comentário explícito), `attention.service.ts:305`, e `web/src/utils/task.ts:31`
   (`PRE_BILLING`), que mandaria o comercial de uma **requisição recém-nascida** direto para o
   assistente de **Faturamento**.

Mais: o zod à mão `api/src/schemas/budget.ts:32` (o tsc não confere e o zod apaga em silêncio),
o funil `invoice-analytics.service.ts:648`, e as escritas diretas da automação de O.S.
(`service-order.service.ts:2003, 2087, 1155, 217`), que **ignoram a máquina de transições**.

---

## 5. O MODELO DE DADOS

### 5.1 `BudgetRequest` [NOVO] — 1:1 com `Budget`

O briefing é da **requisição**, não do contrato. Fica fora de `Budget` de propósito: o que mora
em `Budget` corre risco de entrar na projeção material e derrubar assinatura.

```prisma
model BudgetRequest {
  id                       String   @id @default(uuid())
  budgetId                 String   @unique
  requestedByResponsibleId String
  requestedAt              DateTime @default(now())
  briefing                 String   @db.Text
  logoName                 String?
  preApprovedAt            DateTime?
  preApprovedByResponsibleId String?
  refusedAt                DateTime?
  refusedByResponsibleId   String?
  decisionNote             String?  @db.Text
}
```

Arquivos-base vão para `Task.baseFiles` (já existe, `FileFieldsInterceptor` aceita 30).

### 5.2 `PurchaseOrder` [NOVO] — exatamente como §2.12 já desenhou

```prisma
model PurchaseOrder {
  id         String    @id @default(uuid())
  customerId String
  number     String
  issuedAt   DateTime?
  issuedByResponsibleId String?
  @@unique([customerId, number])
}
```

`Task.purchaseOrderId` (nullable, `SetNull`). `Task.customerOrderNumber` **permanece** como
coluna legada — é ela que a regra de atenção `budget.ibipora-missing-order-number` e a NFS-e
leem hoje. Escrita dupla até a limpeza.

⚠️ `api/src/config/company.ts:165` ainda cita `BudgetPayer.orderNumber`, **coluna que não
existe mais**. O gêmeo do web está certo. Corrigir junto.

### 5.3 Alterações mínimas em tabelas existentes

| tabela | mudança | por quê |
|---|---|---|
| `BudgetStatus` (enum PG) | +`REQUESTED` +`PRE_APPROVAL`, tipo **recriado** na ordem nova | a ordem de declaração é semântica; o precedente de recriação é `20260901120000` |
| `Budget.statusOrder` | backfill das ~720 linhas | §4.3.2 |
| `Notification` | +`responsibleId String?` + CHECK `(userId IS NULL) <> (responsibleId IS NULL)` | hoje é impossível avisar um cliente (§1.2) |
| `SignatureAuthMethod` | +`RESPONSIBLE_SESSION` | §7 |
| `File` | +`visibility` +`customerId` | §9, bloqueador |

### 5.4 Multi-série — o que o modelo diz hoje

**`Task.serialNumber` é UM `String?` com `@unique` GLOBAL.** Não é array, não há tabela filha;
`grep -rn "serialNumbers" api/src` → zero. O que parece multi-série é `serialNumberFrom`/`To`,
que se abre em **N Tasks separadas** (`task.service.ts:1912-1918`), e no web o formulário emite
o **produto cartesiano** como N payloads.

⛔ E o produto cartesiano **viola as duas unicidades**: N placas × 1 série → N tasks com a mesma
série → 400; 1 placa × N séries → placa duplicada → 400. `budget-step-task.tsx:364-368` guarda
pela metade; o formulário simples não guarda.

Logo: **um veículo = uma série; várias séries = vários veículos** — que é o que a requisição
precisa e já funciona. Resta saber se o dono quer isso ou um veículo com várias séries
(bitrem / `COMPOSICAO` dianteira + traseira). Decisão **D1** (§8).

⚠️ Série digitada na criação só pode ser **numérica** (`z.array(z.number())`) — `ABC-123456` é
impossível no cadastro. A requisição do portal precisa aceitar texto.

---

## 6. AS TELAS

### 6.1 Rotas — e a colisão que já está fixada em teste

`/cliente/:customerId/orcamento/:id` (a pública) pontua **acima** de `/cliente/painel/*` no
React Router: uma seção do portal chamada `orcamento` **nunca seria alcançada** — a pública a
engole com `customerId="painel"`. Fixado em `web/src/constants/routes.customer.test.ts:128-131`.
A rota-mãe do provider também **não pode ganhar `path`**.

**PROPOSTA** (segmentos escolhidos para não colidir; cada um ganha linha no teste espelho):

| rota | tela | portão |
|---|---|---|
| `/cliente/painel` | Início: o que espera por mim, o que está em produção, o que vence | sessão |
| `/cliente/painel/orcamentos` | Lista (plural — não casa com a pública) | sessão |
| `/cliente/painel/orcamentos/:budgetId` | Detalhe, recortado por seção | sessão + recorte |
| `/cliente/painel/solicitar` | **A requisição** (assistente) | `REQUEST_BUDGET` |
| `/cliente/painel/veiculos` | Frota: série, placa, chassi, plaqueta, pedido | `VEHICLE` |
| `/cliente/painel/veiculos/:taskId` | Veículo: identidade + **andamento** | `VEHICLE`/`DELIVERY` |
| `/cliente/painel/assinaturas` | O que está comigo para assinar | `SIGN` |
| `/cliente/painel/cobrancas` | Parcelas, boletos, NFS-e | `PAYMENT` |

### 6.2 O assistente de requisição

O formulário que o dono descreveu, mapeado campo a campo no que já existe:

| campo pedido | onde grava | nota |
|---|---|---|
| cliente (escolher ou cadastrar) | `Task.customerId` | ⚠️ ver D3 — autocadastro foi removido **de propósito** |
| briefing (textarea) | `BudgetRequest.briefing` | |
| nome da logomarca | `BudgetRequest.logoName` | |
| para quem irá faturar | `BudgetPayer.customerId` | é o rótulo "Faturar Para" que a UI já usa |
| arquivos-base (imagens) | `Task.baseFiles` | `FileFieldsInterceptor`, 30 arquivos |
| medidas do implemento | `ImplementMeasure` (esq./dir./traseira/**frente**) | ⚠️ banco em **metros**, formulário em **centímetros**; a frente desde o P13a |
| porta traseira | `Implement.rearDoorLeaves/BarCount/HatchCount` | P13a: `portaTraseira: { abertura: BIPARTIDA\|TRIPARTIDA, varoes: 2\|3\|4, portinholas: 0..6 }` |
| tipo e categoria | `Implement.type`, `Implement.category` | corpo `type` (não `implementType`, DD13) |
| série (múltiplas), placa, chassi | `Implement.serialNumber`, `Implement.plate`, `Implement.chassisNumber` | ⚠️ §5.4; a série mora só no implemento (DD14) |
| plaqueta | `Implement.vinPlateId → File` | é **imagem**, não texto, desde `20260727150000` |
| cor de pintura geral | `Task.paintId` (`generalPainting`) | `Budget` **não tem** campo de tinta |
| criar tinta nova | `POST /paints` | mínimo: `{name, hex, finish, paintTypeId}` |

A requisição nasce `Budget{ status: REQUESTED, subtotal: 0, total: 0 }` **sem `BudgetItem`** —
serviço e preço são do comercial. ⚠️ `customerConfigs` é `.min(1)` obrigatório no schema de
criação, e `BudgetPayer.billingId` é NOT NULL: a requisição precisa declarar **um pagador**, que
é justamente "para quem irá faturar". Encaixa.

### 6.3 Acompanhamento — o que o dado sustenta

| marco | fonte | confiabilidade |
|---|---|---|
| Orçamento enviado | `Budget.createdAt` | 100% |
| Em produção | `Task.startedAt` | **a mais alta** — 3 caminhos de escrita carimbam |
| Etapa X | `ServiceOrder{PRODUCTION}.startedAt/finishedAt` | alta, granularidade certa |
| Check-in / check-out | presença de foto → `finishedAt` da O.S. de checklist | alta quando há foto |
| Veículo recebido | `Task.entryDate` | **parcial** — auto-copiado de `startedAt` quando vazio |
| Concluído | `Task.finishedAt` | alta, **reversível** |
| **Entregue** | **não existe campo** | **lacuna** |

⛔ **A linha do tempo tem de ser evento projetado append-only, nunca leitura ao vivo.** Os
carimbos são apagados: O.S. `→PENDING` zera todas as datas (`service-order.service.ts:824-841`);
cancelar toda O.S. de produção zera `Task.startedAt` (`:1059-1066`); `COMPLETED → PREPARATION`
é transição legal. Um cliente que viu "Concluído" não pode ver "Em Preparação" na semana seguinte.

⛔ **Nenhuma O.S. `COMMERCIAL` vai para o cliente.** São 52 descrições, incluindo "Aplicar
Desconto", "Contraproposta" e "Tratar Reclamação". Hoje `GET /task-quotes/public/:id` **já as
devolve a quem tiver o link** (`budget.service.ts:5640-5653`, sem filtro de tipo) — a página só
desenha as que têm foto, mas o JSON cru está no DevTools do cliente. Corrigir junto.

### 6.4 Conformidade visual

O portal hoje é **só header** — sem sidebar, sem navegação, sem breadcrumb
(`responsible-layout.tsx`, 56 linhas). As telas novas usam os mesmos blocos do sistema:
`PageHeader`, `DataTablePage`/`DataTable`, `DetailPage`, `Form*` + `FormSteps` +
`useUnsavedChangesGuard`, `Badge`/`getBadgeVariant`, `Card*`, `EmptyState`/`Skeleton`.
Preferências permanentes do dono valem aqui: **checkbox em vez de switch**, **cada seção em seu
próprio card contornado**, acordeão de expansão única, diálogo que abraça o conteúdo.

⚠️ Três armadilhas de UI que custam tempo: `Input` entrega o **valor** e `Textarea` entrega o
**evento**; `toast` só de `@/components/ui/sonner`, e o interceptor do axios **já** toasta erro
de API e sucesso de escrita; a árvore do portal precisa do **`<Toaster/>` próprio** (já tem).

---

## 7. ASSINAR PELO PORTAL

Estruturalmente quase pronto. `EnvelopeSigner.responsibleId` é FK real, sempre preenchida no
lado cliente, com `@@unique([envelopeId, responsibleId])` — **o signatário não é só contato
copiado**. `SignatureAuthMethod.INTERNAL_SESSION` existe desde a primeira migration, e
`countersign` já é uma assinatura por sessão **sem OTP**, com evidência, HMAC e declarações
próprias. `SigningChallenge.signerId` é FK dura para `EnvelopeSigner`, mas **isso não atrapalha**:
assinatura por sessão não emite desafio nenhum.

O que falta:

1. **Valor novo `RESPONSIBLE_SESSION`**, não reuso de `INTERNAL_SESSION`. `ceremonyKindOf`
   (`:1582-1584`) é **um ternário com quatro dependentes** (`assertOtpCeremony`,
   `resendInvitation`, `noticeChannelOf`, `getPublicState.canSign`): dar `INTERNAL_SESSION` a
   signatário-cliente faz os quatro virarem comportamento **lado-Ankaa**, em silêncio.
2. **Rota `@ResponsibleOnly()`** resolvendo `EnvelopeSigner` por
   `{ id, responsibleId: request.responsible.id }` — hoje **nenhuma consulta no sistema** busca
   `EnvelopeSigner` por `responsibleId`.
3. ⛔ **O bloqueador real é texto jurídico, não schema.** `acceptanceClauseFor()`
   (`signature.constants.ts:77-96`) é **impressa e congelada no PDF** e diz que o CONTRATANTE se
   autentica *"por código de uso único enviado…"*. Assinar por sessão torna essa frase **falsa
   no instrumento assinado**. Exige variante de cláusula + conjunto de declarações — largando
   `identity`, **mantendo `authority`**, que o próprio código (`:123-131`) chama de a que de fato
   importa no tribunal (CC art. 118; ver `BUDGET-SIGNATURE-DESIGN.md` §4.4).
4. **A escolha é na EMISSÃO**, antes de congelar bytes. Não se converte signatário OTP em
   signatário de sessão depois — é por isso que `countersign:4231-4236` recusa envelope
   pré-reforma.

⚠️ Três coisas que **não** podem entrar sem pensar:
- `createEnvelope` **recusa orçamento multi-pagador** (`:976-986`) — e o caso Furgões **é**
  multi-pagador. Decisão **D4** (§8).
- **Editar telefone ou e-mail de signatário pendente é mudança MATERIAL e derruba a coleta**
  (`quote-snapshot.service.ts:641-647` põe `emailNormalized` e `phoneDigits` na projeção). Uma
  tela de "meus dados" no portal deixaria o contato **derrubar o próprio envelope**.
- Recusa **parcial** trava o envelope em `RUNNING` para sempre (`advanceEnvelope:4749` conta
  REFUSED como pendente); só `resendInvitation` destrava, e só enquanto `RUNNING` (`:7628`).

---

## 8. AS DECISÕES DO DONO — RESOLVIDAS (20/09/2026)

| # | decisão | **o que foi decidido** |
|---|---|---|
| **D1** | Multi-série | **N séries = N veículos** (o modelo já era assim). O assistente expande a faixa "1001 a 1005" em 5 linhas EDITÁVEIS no cliente; nunca produto cartesiano, que violava as duas unicidades globais. |
| **D2** | Nome do estado do vendedor | **`IN_NEGOTIATION` / "Em Negociação"** — porque a O.S. que ocupava a palavra foi REMOVIDA na mesma rodada. `PRE_APPROVED` é o estado seguinte (o vendedor clicou em Aprovar). |
| **D3** | Cliente novo pelo portal | **Entra direto no cadastro**, criado pela opção "criar" DENTRO do combobox. O zod do portal **exige CNPJ ou CPF** — `customerQuickCreateSchema` não tem nem o campo `cpf`, e cliente sem documento trava a NFS-e depois. |
| **D4** | Multi-pagador na assinatura | A requisição nasce com **um** pagador. `createEnvelope` segue recusando multi-pagador; liberar isso é rodada própria. |
| **D5** | "Pendente" → "Aguardando Assinatura" | **Nas duas telas.** Rótulo, não valor: `'PENDING'` viaja em filtro salvo, no app Flutter e em changelog gravado como string. |
| **D6** | `FLEET_MANAGER` e `DRIVER` no portal | **Sim.** E isso expôs uma contradição do próprio desenho — ver §2.2. |

### 8.1 A O.S. "Em Negociação" — o recorte real da remoção

O dono pediu "remover completamente a ordem de serviço comercial". A consulta a produção
mostrou que isso apagaria **1.703 linhas de "Enviar Orçamento"**, que é outra O.S. comercial,
viva e em uso. O tipo `COMMERCIAL` tem 2.213 linhas:

| descrição | linhas | destino |
|---|---:|---|
| Enviar Orçamento | 1.703 | **fica** |
| Em Negociação (3 grafias) | 486 | **sai** |
| Detalhar / Elaborar / Esclarecer / Outros | 24 | ficam |

Sai **uma descrição**, não o tipo. As três grafias em produção — `Em Negociação`,
`Em Negociacao`, `NEGOCIACAO` — confirmam por que ela tinha de morrer: a comparação do web era
sensível a caixa E acento, então **20 dessas linhas já eram invisíveis para ela** enquanto
controlavam aprovação de orçamento. Das 486, **120 estavam abertas** — e como `Task → COMPLETED`
exige toda O.S. concluída, cada uma era um veículo que não fechava.

⚠️ **O WEB era quem criava a O.S.** (`task-create-form.tsx`, `budget/create.tsx` enviavam-na em
`serviceOrders` a cada tarefa nova). Apagar só o servidor e migrar as linhas não teria parado
nada: toda tarefa nova recriaria exatamente o que a migration deleta.

## 9. ⛔ O BLOQUEADOR: TODO ARQUIVO É PÚBLICO POR UUID

Confirmado, e pior que o enunciado. `@Public()` em `file.controller.ts:237,259,277,531`; CORS
`*` escrito em `file.service.ts:625,752` **depois** do `enableCors` de `main.ts:204`,
sobrescrevendo a allowlist de produção; o mount estático de `main.ts:233-247` **nunca alcança o
`APP_GUARD`** (o próprio arquivo explica, `:267-271`). Apagar `@FileOperationBypass()` **não**
religa o rate limit: `custom-throttler.guard.ts:307-311` devolve `true` para todo endpoint cujo
controller se chame `FileController`.

Agravantes: `/files/storage/` expõe a **árvore literal** — `Clientes/{razão social}/Boletos/`,
`Colaboradores/{nome}/Exames Medicos/`; a API devolve o link público do CDN **em toda resposta**;
`GET /files` e `POST /files/upload` não têm `@Roles`. **O repositório já sabe**: o `.pfx` fiscal
foi deliberadamente não modelado como `File` por causa disso (`schema.prisma:5144-5147`).

O conserto tem padrão pronto no próprio repositório — `PublicSignatureController:484-510` serve
PDF a terceiro por **token de capability** + `no-store` + `@Throttle(20/min)`:

1. migration dando `visibility` + `customerId` ao `File` (backfill por `FileReferenceService`);
2. rotas deixam de ser `@Public()` e passam a aceitar funcionário, **responsável**
   (`file.customerId === responsible.companyId` — a guarda **já é global**) ou token;
3. `GET /files/:id/link` devolvendo URL assinada HMAC de 5–15 min;
4. tapar o mount estático + `internal;` no nginx (**que não está no repositório**).

⛔ **Ordem obrigatória: unificar os 13 construtores de URL do web ANTES de fechar.** Exigir
`Authorization` primeiro **apaga todas as imagens do sistema** — `<img src>` não passa pelo
interceptor do axios.

⚠️ Desde o P13a o próprio cliente ANEXA o **projeto do implemento** (`POST
/cliente/me/veiculos/:taskId/projeto`), e o projeto da Furgões passa a ficar tão
público por UUID quanto a plaqueta (PLANO do Implemento, §7.3).

**Este item não é opcional para um portal que mostra plaqueta, arte e boleto.** Mas é
pré-existente: o portal não o cria, e a fatia dele que a feature precisa (2, para responsável) é
pequena.

---

## 10. O QUE FOI CONSTRUÍDO

12 pacotes em paralelo + 2 de reconciliação. Nada commitado.

| # | pacote | entregue |
|---|---|---|
| **API-1** | `PortalScopeService`, `PortalProjectionService`, `PORTAL_CAPABILITY`, `@PortalCapability` | + `tests/portal-{escopo,recorte}.test.ts` — **o primeiro teste do portão por papel deste repositório** |
| **API-2** | `/cliente/me/{resumo,orcamentos,orcamentos/:id,veiculos,veiculos/:taskId,cobrancas}` | linha do tempo como **projeção monotônica** (carimbo apagado não regride) |
| **API-3** | `POST /cliente/me/orcamentos` + `BudgetRequest` | + `tests/portal-requisicao.test.ts` |
| **API-4** | pré-aprovação/recusa + `Notification.responsibleId` | + `tests/portal-decisao.test.ts` |
| **API-5** | `PurchaseOrder`, assinatura por sessão, portão do Compras | + `tests/portal-assinatura-compras.test.ts` |
| **API-6** | remoção da O.S. "Em Negociação" + 4 defeitos vivos | + `tests/orcamento-sem-os-negociacao.test.ts` |
| **WEB-1** | `api-client/portal.ts` + Início | instalou o interceptor de resposta que o portal não tinha |
| **WEB-2** | lista e detalhe do orçamento, recortados | pré-aprovação/recusa com motivo obrigatório |
| **WEB-3** | assistente de requisição (5 passos) | + 19 testes do schema |
| **WEB-4** | frota e acompanhamento | destravou `DataTable` no portal (`useOptionalAuth`) |
| **WEB-5** | assinaturas, cobranças, pedidos | portão do Compras resolvível **na própria tela** |
| **WEB-6** | o lado ANKAA dos estados novos | 6 defeitos que o fluxo novo teria causado |

### P13a (25/09, rework Implemento) — o que o cliente escreve sobre o implemento

A identificação e a requisição passaram a gravar a **frente** (4ª face) e a
**porta traseira**; o cliente anexa o **projeto do implemento**; e, com a
tarefa em produção (`IN_PRODUCTION`/`COMPLETED`), medida, porta e série não
mudam mais pelo portal — 409 "O veículo já está em produção: fale com a Ankaa
para corrigir …" (DD5, pergunta 15). Frente e porta não são impressas na folha
assinada e ficam fora da guarda do documento congelado. O contrato exato
(corpos, 409, rota do projeto, a resposta com o bloco `implement`) está em
`PORTAL-CONTRATO.md` §4.1. Testes: `test:portal-identificacao` (inclusive um
bloco contra o banco numa transação desfeita), `test:portal-requisicao`,
`test:portal-cliente:boot`, e2e-portal 01.

### Os quatro defeitos vivos consertados de passagem

1. ⛔ **`GET /billings/:id` estava quebrada em produção** — `billing.service.ts:167` pedia
   `responsible: true`, relação dropada em `20260918120000`. A varredura daquele commit procurou
   `responsibleId` (o FK) e não `responsible` (a RELAÇÃO); `tsc` não via por causa de
   `(this.prisma as any)`. Derrubava junto `/by-task/:taskId` e `/quote/:quoteId`.
2. ⛔ **`GET /changelogs/task/:id/history` devolvia as 20 alterações de O.S. MAIS ANTIGAS DA BASE
   INTEIRA**, iguais para qualquer tarefa — sem filtro de `taskId` e com o `take` padrão de 20.
3. ⚠️ `PUT /budgets/:id/status` descartava `reason` em silêncio, com o diálogo de reprovação do
   web exigindo o motivo.
4. ⚠️ Restos de `responsible?` em `web/src/types/{budget,task}.ts` e `api/src/schemas/budget.ts`.

### E os seis que o fluxo novo teria causado

`notYetInvoiced` (requisição lida como pós-aprovação) · `PRE_BILLING` (requisição abrindo o
assistente de **Faturamento**) · `budgetStatusSchema` em **ambos** os repos (5 valores escritos à
mão; no `api` deixava o `pnpm build` VERMELHO e apagava `status=IN_NEGOTIATION` do filtro em
silêncio) · `STATUS_OPTIONS` (a transição `IN_NEGOTIATION` não era oferecida por tela nenhuma) ·
o funil de vendas sem os três estados · e o **diálogo "Rejeitar Orçamento"** abrindo no caminho
feliz `REQUESTED → PENDING`, exigindo motivo de recusa e gravando-o no changelog.

## 11. COMO ESTA BRANCH SE VERIFICA

`api` e `web` **não têm hook, CI nem PR** — tudo sempre caiu na `main` à mão. `api` não tem
`test`, `typecheck`, `format:check` nem `gate`; o único typecheck é `pnpm build`, com
`strict:false` e `**/*.test.ts` **excluído** do tsconfig. No `web`, `pnpm build` **não**
typecheca (é `build:with-tsc`) e `pnpm test` é **watch** (é `test:run`).

Logo, esta branch carrega a própria régua, no estilo que o portal já usa
(`test:responsible-otp` roda **sem infraestrutura nenhuma** — cripto puro e forma de SQL):

- `test:portal-escopo` — o `where` dos três caminhos (§3), sem banco;
- `test:portal-recorte` — projeção × `sectionsForRoles`, tabela-verdade dos 9 papéis, sem banco;
- `test:budget-status-requisicao` — transições novas e as 5 armadilhas de §4.3, sem banco;
- espelho em `web/src/constants/routes.customer.test.ts` para cada rota nova (§6.1).

⚠️ O histórico de migrations **não é replayável do zero** (`Item_isManualMaxQuantity_idx` e dois
irmãos são criados sem guarda em `0_init` **e** em `20260406000000`, e só dropados em
`20260515130000`): todo banco de teste tem de ser **clone de produção**; `migrate reset` é
inutilizável.

⚠️ Migration aqui é **SQL escrito à mão** (231 de 249 com timestamp redondo), abrindo com bloco
em prosa dizendo *por quê* e com o `SELECT` de produção que prova que nada se perde.

⚠️ **`20260917220000_portal_do_cliente_sessao_por_otp` ainda não foi aplicada em produção.**
Esta feature empilha sobre uma migration que não subiu.
