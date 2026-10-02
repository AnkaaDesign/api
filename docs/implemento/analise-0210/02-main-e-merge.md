# 02 — O que a `main` trouxe e como juntar (02/10/2026)

**Escopo.** Branch de trabalho: api e web = `origin/feat/portal-do-responsavel`
(o mesmo commit de `origin/claude/truck-implemento-ankaa-abn3xd`: api `b39f5162`,
web `db47f659`); mobile = `origin/feat/implemento` (`8f774b0`). A `main` remota
andou **8 commits na api** (merge-base `82c7da57`), **8 na web** (merge-base
`2574b7f8`) e **1 no mobile** (merge-base `114f55f`), mais **1 commit local não
publicado** na `main` do mobile (`c8afc71`).

**Método.** Só leitura: `git merge-tree --write-tree` (árvore simulada api
`b26db08e`, web `388b993c`), `git show`/`git diff` e consultas ao banco
`ankaa_implemento`. Nada foi checado para fora, mesclado ou commitado.

**Resultado em uma linha.** São 6 conflitos textuais (5 na api, 1 na web), todos
pequenos. O risco real está em **5 conflitos semânticos** que o git não acusa:
1. o pedido de compra (a DD12 da branch contra o "pedido único" da `main`);
2. a mesma corrupção de número do `fixArrays` na rota de assinatura do portal;
3. três funções novas do responsável sem capacidade definida no portal (erro de compilação na api, falha silenciosa na web);
4. testes que contam "9 papéis";
5. o contrato gerado da web, que não conhece as funções novas.

---

## 1. Os commits da `main`

### api (8)

| Commit | O que muda no negócio | O que muda no código | Migration |
|---|---|---|---|
| `2f711c23` Lembrete v2 de assinatura no WhatsApp | O lembrete diário de assinatura passa a dizer "a ordem de serviço não avança sem a assinatura" e ganha botão de URL. A rodada sai às **8h** de SP (antes, 9h). | `signature-reminder.scheduler.ts` (cron `0 8 * * *`); `SIGNATURE_WHATSAPP_TEMPLATE_V2_CANDIDATES.REMINDER = 'orcamento_aguardando_assinatura_v2'` (submetido, ainda não está em uso); script de submissão; textos de e-mail e WhatsApp. | — |
| `44836515` Validade do orçamento (`budget-validity`) | A validade conta **a partir de hoje** ("vale até daqui a N dias", fim do dia em SP). Há uma rota nova de **prorrogação**. Orçamento EXPIRED ("Aguardando Reanálise") que é prorrogado volta a PENDING. Na **fusão**, a validade **recomeça hoje** em vez de herdar a mais distante: o caso real foi o nº 421 da Marquespan, que saiu da fusão "válido até 26/06", já vencido. | `utils/budget-validity.ts` (`quoteValidityEnd`, `formatQuoteValidity`, `QUOTE_VALIDITY_DEFAULT_DAYS = 30`); `PUT /budgets/:id/validity` (`budgetExtendValiditySchema { days }`); `budgetMergeSchema.validityDays`; `previewMergeQuotes(taskIds, { validityDays })` com aviso `VALIDITY_RESET`; `judgeMerge` deixa de emitir `EXPIRES_AT`. | — |
| `74f5d453` Funções do responsável: PCP, Expedição, Logística | Três funções novas (`PRODUCTION_PLANNING`, `SHIPPING`, `LOGISTICS`). Na assinatura elas começam **sem seção**: acompanham, não obrigam a empresa. O enum passa a seguir a **ordem de exibição** da empresa (PCP primeiro, Comercial por último). | `schema.prisma` (`enum ResponsibleRole` reordenado); `constants/enums.ts`; `quote-sections.ts` (`ROLE_DEFAULT_SECTIONS` com `[]` para as três); `responsible-auth.decorators.ts`; `verify-signature-sections.ts`. | **`20260928120000_responsible_role_pcp_shipping_logistics`**: recria o tipo `RepresentativeRole` e regrava os arrays na ordem nova, fora do changelog. |
| `b1716269` Assinatura de Compras: pedido único com herança | **Um pedido de compra para o orçamento inteiro**, não um por caminhão. Quando os veículos que já têm número concordam num único valor, os que faltam **herdam** e a página nem mostra o campo. Sem número registrado, vale o informado, **o mesmo para todos**; valores diferentes são recusados. Registros legados divergentes não dão herança. O changelog marca `inherited`. No painel, cada documento ganha `title` ("Orçamento nº 448 - Marquespan 5,20 - Rafael Capobianco") e a Ankaa aparece como signatária em todos os recortes. | `order-number-gate.ts` (`inheritedOrderNumber`, `resolveOrderNumberSubmission` reescrita, `toWrite[].inherited`); `ZodValidationPipe(schema, { coerceFormData: false })` desliga o `fixArrays`, que transformava `orderNumbers[].value: "89920"` em número (400; e "00123" viraria 123); `signature.controller.ts` usa a opção na rota pública; `signature-envelope.service.ts` (`orderNumberGateOf` com `inherited`, `listForQuote` com `title`). | — |
| `9ac25787` build-info (deploy 28/09) | — | `src/build-info.json` | — |
| `c104e5eb` Bonificação | O período fecha no **dia 5 às 00:00 de SP**. Falha de ponto no Secullum vira erro por pessoa (não grava desconto zero). O cargo do vínculo acompanha o do colaborador. Varredura de função e departamento no Secullum às 08:05. | `utils/bonus.ts` (`getBonusPeriodCutoff`), `bonus-cron`, `bonus.service`, `bonus-eligibility`, `bonus-termination.listener`, `contract-position-sync.ts`, `employment-contract.service`, `user.service`, testes novos. | — |
| `ffe245f4` build-info (28/09 à noite) | — | `src/build-info.json` | — |
| `bc97908b` Runbook dos assets 3D | Documenta `site/` com os vídeos do topo do site público. | `docs/DEPLOYMENT-studio-assets.md` | — |

**Migrations: há colisão de ordem?** Não. A única migration nova da `main`,
`20260928120000`, fica entre as da branch (`20260920*` e `20260930*`), e o
`prisma migrate deploy` aplica as pendentes sem reclamar da ordem. Também não há
dependência:
- nenhuma migration da branch toca `RepresentativeRole`;
- no `ankaa_implemento` não há view, regra nem CHECK sobre `Representative.roles`, só o índice GIN, que o próprio `ALTER` reconstrói;
- a coluna `Representative.roles` é a única do tipo, tanto na branch quanto na `main`.

Em produção a `20260928120000` **já está aplicada** e as da branch vêm depois
(`20260930*`) ou já constavam como `20260920*`. A ordem no deploy é coerente.

### web (8)

| Commit | O que muda |
|---|---|
| `ec82295b` Validade do orçamento | Novo `components/financial/budget/validity/` (`ValidityField`, `ValidityPicker`, `ExtendValidityDialog`, `validity.ts` com `quoteValidityEnd`/`QUOTE_VALIDITY_OPTIONS`/`isQuoteValidityExpired`); `budgetService.extendValidity`; campo de validade no passo de informações do orçamento e do faturamento (`budget-step-info.tsx`, `billing-step-budget-info.tsx`); ação de prorrogar na tabela e no detalhe; `validityDays` no diálogo de fusão. |
| `4e5b636d` Funções do responsável | `enums.ts`, `enum-labels.ts`, `types/responsible.ts` (rótulos e cores: PCP pink, Expedição âmbar, Logística vermelho), `responsible-route.tsx`, `changelog-fields.ts`, `pages/cliente/painel.tsx` (`ROLE_LABELS`). |
| `8d016ab7` Assinatura de Compras | `order-number-fields.tsx` passa a ter **campo único** e a esconder o campo quando há `inherited`; `[token].tsx` manda o mesmo valor para todos os `taskId`; `api-client/signature.ts` ganha `inherited?: string \| null`; `signature-envelope-card.tsx` mostra `title`. |
| `b5724ee3` Bonificação | Simulação com a conta da folha e cargo do vínculo no histórico. |
| `595602fc`, `c2bded86`, `a922d6b2`, `18dd8ee5` | Truck Studio (chão do distrito, poste, retextura, variantes do implemento). Tudo em `src/pages/tools/truck-studio`, `public/` e `tools/`, **sem intersecção** com a branch. |

### mobile (1 publicado + 1 local)

| Commit | O que muda |
|---|---|
| `c0b4d53` Funções do responsável | `lib/data/models/responsible.dart` (`kResponsibleRoleLabels` na ordem nova), `administration_enums.dart`, `ui_badge.dart` (`AppBadgeTone.pink`). A branch `feat/implemento` não toca nesses arquivos, então o merge é limpo. |
| `c8afc71` (**local, não publicado**) | Só `pubspec.yaml`: `version: 1.4.2+25 → 1.4.3+26`, "release com as funções do responsável e o envio por responsável". Ver §5. |

---

## 2. Os conflitos textuais, um a um

### 2.1 api — `src/modules/common/pipes/zod-validation.pipe.ts` (1 bloco)

- **Branch:** `constructor(schema, options: ZodValidationPipeOptions = {})`. É a interface do G1 (`queryModel`, `bareRelationArgsIgnored`, `reportOnly`), e o corpo de `transform` foi para `parse()`.
- **Main:** `constructor(schema, options: { coerceFormData?: boolean } = {})`, com o comentário do `fixArrays`.
- **Intenção:** as duas acrescentaram opções ao mesmo construtor e não se excluem.
- **Resolução:** manter o construtor da branch e **acrescentar o campo da main à interface**:

```ts
export interface ZodValidationPipeOptions {
  queryModel?: string;
  bareRelationArgsIgnored?: boolean;
  reportOnly?: boolean;
  /**
   * `coerceFormData: false` desliga o `fixArrays` (strings → número/booleano/
   * null pelo NOME do campo). Ele existe para FormData; num corpo JSON ele
   * corrompe texto que só tem dígitos — `orderNumbers[].value: "89920"` virava
   * número e a assinatura de Compras morria em 400 (e "00123" viraria 123).
   */
  coerceFormData?: boolean;
}
// constructor(private readonly schema: ZodSchema, private readonly options: ZodValidationPipeOptions = {}) {}
```

A linha da main, `this.options.coerceFormData === false ? value : this.fixArrays(value)`,
já entrou sozinha dentro do `parse()` da branch (linha 89 da árvore simulada).

### 2.2 api — `src/modules/production/budget/budget.service.ts` (1 bloco)

- **Branch:** apagou `reuseOwnLayoutFiles` e `resolveLayoutPlan` (P12.1: a arte sai do orçamento; `layoutImageKey`, `LayoutCoveragePlan` e `QuoteLayoutScopeValue` já não são importados).
- **Main:** inseriu `extendValidity()` logo acima desses dois métodos, por isso o bloco os carrega junto.
- **Resolução:** **manter `extendValidity` e apagar os dois helpers de layout.** Ficar com o bloco inteiro da main reintroduziria código morto que não compila, porque os tipos não existem mais.

Conferido na branch: `extendValidity` funciona sem ajuste.
- `update(id, data, userId)` e `updateStatus(id, status, userId, reason?, actorPrivilege?)` têm as assinaturas que ele usa.
- `EXPIRED → PENDING` é aresta manual em `BUDGET_MANUAL_TRANSITIONS` (`budget-transitions.ts:46`).
- `expiresAt` está em `QUOTE_SAFE_AFTER_BILLING_FIELDS` (`budget.guards.ts:213`) e não está em `QUOTE_VALUE_REVERTABLE_STATUSES` como gatilho, então prorrogar não derruba a aprovação do valor.
- O import de `budget-validity` (linha 116) e os hunks de `previewMergeQuotes`/`mergeQuotes` entraram sozinhos. `MergeCandidate.expiresAt` continua existindo (`budget-merge-rules.ts:67`).

### 2.3 api — `src/modules/common/signature/order-number-gate.ts` (2 blocos): o conflito semântico do nº do pedido

**Os dois lados.**
- **Branch (DD12):** um **predicado único**, `orderNumberRequirement({ roles, tasks })`, usado pelas duas cerimônias (página pública por OTP e sessão do portal).
  - Sujeito: quem **tem** `PURCHASING`.
  - Um veículo "tem pedido" quando `customerOrderNumber` não está vazio **ou** quando há `purchaseOrderId` (pedido registrado pelo portal).
  - Exige **o número de cada veículo**, e a recusa nomeia o veículo ("Série 11").
- **Main (produção desde 25/09):** **um pedido só por orçamento**, com **herança** do número único já registrado. O informado vale para todos, e valores diferentes são recusados.
  - Só conhece `customerOrderNumber`: decide quem falta por `!v.value`.
  - Não tem o conceito de pedido do portal.

**Decisão: como os dois convivem.** A regra de negócio da `main` prevalece: um
pedido por orçamento, com herança. É o que roda em produção e o que a web da
`main` desenha (campo único). A DD12 continua valendo em três pontos:
1. o predicado é único;
2. o sujeito é quem **tem** `PURCHASING`;
3. "tem pedido" inclui o `purchaseOrderId`.

A DD12 dizia "o número de **cada** veículo". Essa parte cai e vira "o número do
orçamento". ⚠️ **Isso muda o texto da DD12**: registrar no `PLANO.md` como DD12.1.

**Código final esperado:**

```ts
export interface OrderNumberTask {
  id: string;
  name?: string | null;
  status?: string | null;
  customerOrderNumber?: string | null;
  purchaseOrderId?: string | null;
  /** O nº do pedido do portal, quando a tarefa aponta para um (para a herança). */
  purchaseOrder?: { number?: string | null } | null;
  implement?: { serialNumber?: string | null; plate?: string | null } | null;
}

export function orderNumberVehicles(tasks: readonly OrderNumberTask[]): OrderNumberVehicle[] {
  return orderNumberScope(tasks).map((t, index) => ({
    taskId: t.id,
    label: orderNumberVehicleLabel(t, index),
    // O número VISÍVEL do veículo: o digitado, senão o do pedido do portal.
    value:
      normalizeOrderNumber(t.customerOrderNumber) ||
      normalizeOrderNumber(t.purchaseOrder?.number) ||
      null,
    hasNumber: taskHasOrderNumber(t),
  }));
}

/** O que as DUAS cerimônias devolvem na leitura (DD12 + pedido único da main). */
export interface OrderNumberRequirement {
  /** Falta pedido e não há um único registrado para herdar. */
  required: boolean;
  maxLength: number;
  /** O pedido único que os veículos sem número herdam; `null` se não há ou se divergem. */
  inherited: string | null;
  vehicles: OrderNumberVehicle[];
}

export function inheritedOrderNumber(vehicles: readonly OrderNumberVehicle[]): string | null {
  const registered = new Set(vehicles.map(v => v.value).filter((v): v is string => !!v));
  return registered.size === 1 ? [...registered][0] : null;
}

export function orderNumberRequirement(args: {
  roles: readonly string[] | null | undefined;
  tasks: readonly OrderNumberTask[];
}): OrderNumberRequirement | null {
  if (!signerRequiresOrderNumber(args.roles)) return null;
  const vehicles = orderNumberVehicles(args.tasks);
  const inherited = inheritedOrderNumber(vehicles);
  return {
    required: vehicles.some(v => !v.hasNumber) && !inherited,
    maxLength: ORDER_NUMBER_MAX_LENGTH,
    inherited,
    vehicles,
  };
}

export const ORDER_NUMBER_REQUIRED_MESSAGE = 'Informe o nº do pedido de compra para assinar.';
```

Em `resolveOrderNumberSubmission`, fique com o **corpo da main** (segundo bloco:
herança, "o mesmo para todos", recusa de valores diferentes) e faça **duas
edições à mão fora dos marcadores**, porque o git já as levou para o lado da main:
- linha 225: `const missing = vehicles.filter(v => !v.value);` → **`vehicles.filter(v => !v.hasNumber)`**. Sem isso, o veículo com pedido do portal e sem número digitado seria tratado como "falta" e receberia número por cima, e o teste "veículo com pedido do portal não é cobrado nem sobrescrito" quebra;
- a mensagem final de vazio usa `ORDER_NUMBER_REQUIRED_MESSAGE` (texto idêntico ao da main).

O bloco da branch, com o laço por veículo e `byTask`, sai inteiro.

**Os chamadores precisam trazer `purchaseOrder.number`** para a herança enxergar o
pedido do portal: os `select`/`include` de tarefas nos três pontos de
`signature-envelope.service.ts` que chamam `orderNumberRequirement` (≈ linhas
3591, 5274 e 5454 da árvore simulada) ganham `purchaseOrder: { select: { number: true } }`.
Se o dono preferir não herdar do pedido do portal, basta não acrescentar esse
`select`. A regra fica correta, só herda menos.

### 2.4 api — `signature-envelope.service.ts` (2 blocos)

1. **Imports (linhas 98-110 da árvore simulada).** Ficar com o lado da branch (`TASK_QUOTE_STATUS`, `CHANGE_ACTION`, `CHANGE_TRIGGERED_BY`, `ENTITY_TYPE`, `TASK_QUOTE_STATUS_ORDER`, `orderNumberRequirement`) e **não** trazer `orderNumberVehicles`/`inheritedOrderNumber`: com a resolução 2.3 o serviço não os usa mais. Conferir que `signerRequiresOrderNumber` e `ORDER_NUMBER_MAX_LENGTH` também não ficaram importados sem uso.
2. **`orderNumberGateOf` (linhas 3588-3615).** Ficar com o **corpo da branch**, `return orderNumberRequirement({...})` com tipo `OrderNumberRequirement | null`. O `inherited` que a main calculava aqui passa a vir do predicado único, e a página pública da main (`order-number-fields.tsx`, que lê `orderNumber.inherited`) continua recebendo o campo.

O resto da main neste arquivo entrou sozinho e está coerente com a branch:
- `writeInformedOrderNumbers` com `inherited` no changelog;
- `listForQuote` com `budgetNumber` e `name` no `select`; o `select` já usa `implement: { select: { serialNumber, plate, chassisNumber } }`, sem `Task.serialNumber`;
- `title` dos documentos;
- a Ankaa em todos os recortes.

### 2.5 api — `scripts/verify-order-number-gate.ts` (1 bloco)

- **Branch:** dois testes da regra "por veículo" ("falta um → recusa nomeando a Série 11"; "valor inválido → recusa com o rótulo").
- **Main:** "vários veículos sem número: um só pedido vale para todos".
- **Resolução:** **lado da main.** Os dois testes da branch afirmam a regra que caiu. Acrescente o caso DD12 que a main não cobre:

```ts
check('pedido do portal (purchaseOrderId) conta como número e não é sobrescrito', () => {
  const vehicles = orderNumberVehicles([{ id: A, purchaseOrderId: 'po-1', customerOrderNumber: null }]);
  const r = resolveOrderNumberSubmission(vehicles, [{ taskId: A, value: '9999' }]);
  assert.equal(r.problem, null);
  assert.deepEqual(r.toWrite, []);
});
check('herança a partir do nº do pedido do portal', () => {
  const vehicles = orderNumberVehicles([
    { id: A, purchaseOrderId: 'po-1', purchaseOrder: { number: '4500' } },
    { id: B, customerOrderNumber: null },
  ]);
  assert.equal(inheritedOrderNumber(vehicles), '4500');
});
```

Os testes da branch em `tests/portal-assinatura-compras.test.ts` também precisam
de ajuste, mesmo sem conflito:
- **linha 136**, "1 de 2 sem número → exige": com a herança ele vira **não exige**, com `inherited` igual ao número de `comPedido`. Reescreva como dois casos: "2 sem número → exige" e "1 com e 1 sem → não exige, herda";
- **linha 166** continua valendo: um `taskId` informado basta, e todos os que faltam recebem.

### 2.6 web — `src/pages/cliente/painel.tsx` (1 bloco)

- **Branch:** reescreveu o painel. Não usa mais `ROLE_LABELS` e criou `vehicleLabel()` com o cabeçalho "A tela".
- **Main:** reordenou `ROLE_LABELS` e acrescentou PCP, Expedição e Logística.
- **Resolução:** **lado da branch.** Na árvore simulada nenhum outro ponto do arquivo referencia `ROLE_LABELS`. Se a branch voltar a mostrar funções no painel, use `RESPONSIBLE_ROLE_LABELS` (`constants/enum-labels.ts`, que já veio da main com as três funções novas) em vez de um mapa local.

Os outros arquivos da web mesclaram sozinhos: `api-client/signature.ts`,
`signature-envelope-card.tsx`, `budget-step-info.tsx`, `budget-table-page.tsx`,
`merge-quotes-dialog.tsx`, `enum-labels.ts`, `enums.ts`,
`financial/budget/details/[taskId].tsx` e `changelog-fields.ts`. Os imports novos
da main existem na árvore mesclada: `budgetKeys`, `canCreateQuote`,
`canEditQuote`, `budgetService.extendValidity` e `taskKeys` via `@/hooks`.

---

## 3. Conflitos SEMÂNTICOS (o git não acusa)

**Nomes renomeados pela branch.** Varri as **2.222 linhas acrescentadas pela
main na api** e as linhas da web (fora do Truck Studio) atrás de
`truck`/`Truck`, `serialNumber` na tarefa, `PRE_APPROVED`, `SIGNED`,
`layout`/`layouts`/`layoutFiles`, `TaskQuote`/`taskQuote` e `hasLayouts`:
**zero ocorrências.**
- O único `serialNumber` que a main tocou em código vivo (`listForQuote`) já saiu mesclado como `implement.serialNumber`.
- O `quoteTaskId: 'x'` do script de templates é o nome de um parâmetro de template, não de entidade.
- Os `TASK_QUOTE_STATUS` usados pela main (`EXPIRED`, `PENDING`, `CANCELLED`) existem no enum da branch.

O que **quebra** ou **muda o comportamento** depois do merge:

| # | Onde | O que acontece | Conserto |
|---|---|---|---|
| S1 | `src/modules/common/signature/portal-signature.controller.ts:127` (api, só na branch) | `@Body(new ZodValidationPipe(portalSignSchema))`: a assinatura **pela sessão do portal** recebe o mesmo `orderNumbers[].value` e passa pelo mesmo `fixArrays`, então "89920" vira número e dá 400. É o bug que a main consertou só na rota pública. | `new ZodValidationPipe(portalSignSchema, { coerceFormData: false })` |
| S2 | `src/modules/people/portal/portal-capabilities.ts:159` (api) | `ROLE_CAPABILITIES: Record<RESPONSIBLE_ROLE, …>` sem `PRODUCTION_PLANNING`, `SHIPPING` e `LOGISTICS`. **Erro de compilação de propósito** (o comentário da linha 130 pede a decisão). | Proposta, pelo mesmo raciocínio da main ("acompanham a produção e a saída do veículo, não obrigam a empresa"):<br>• **PCP** = `WRITE_VEHICLE_IDENTITY`, `WRITE_PURCHASE_ORDER`, `TRACK` (igual ao Gestor de Frota: o PCP confere a identidade do veículo que entra na produção);<br>• **Expedição** e **Logística** = `WRITE_PURCHASE_ORDER`, `TRACK` (igual ao Motorista).<br>Nenhuma das três aprova valor ou arte, nem pede orçamento. **[DONO confirma]** |
| S3 | `web: src/utils/portal-capabilities.ts:57` (`PORTAL_ROLE_CAPABILITIES: Record<string,…>`) e `web: src/components/cliente/orcamento/sections.ts:57` (`PORTAL_ROLE_SECTIONS: Record<string,…>`) | O tipo é `Record<string>`, então **não dá erro**: a função nova cai em `undefined` e o portal mostra **tela em branco** para um contato que só é PCP, Expedição ou Logística. | Espelhar S2 em `PORTAL_ROLE_CAPABILITIES`, pôr `[]` nas três em `PORTAL_ROLE_SECTIONS` (como a main fez em `quote-sections.ts`) e tipar os dois como `Record<RESPONSIBLE_ROLE, …>` para isso nunca mais passar calado. |
| S4 | Testes da api: `tests/portal-identificacao.test.ts:484` (`length === 9`), `tests/portal-recorte.test.ts` (`SECOES_ESPERADAS:132`, `SECOES_PORTAL_ESPERADAS:168`, `CAPS_ESPERADAS:262`, `celulas === 63` na :219), `tests/portal-arte.test.ts:132` (`papeis.length === 9`) | Falham com 12 funções. | 12 papéis e `celulas === 84`. Nos mapas, as três entram com:<br>• **assinatura:** `[]`;<br>• **portal:** `['VEHICLE','DELIVERY']`, que é o que `WRITE_VEHICLE_IDENTITY`/`WRITE_PURCHASE_ORDER` (VEHICLE) e `TRACK` (DELIVERY) implicam pela proposta S2;<br>• **capacidades:** conforme S2;<br>• **`APROVA_ARTE`:** `false`. |
| S5 | `web: src/generated/contracts/enums.json` e `labels.json` (gerados da api) | Não conhecem as três funções. As réguas G4/G6 da web comparam o contrato com o código. | Depois do merge da api: `pnpm contracts:export` na api e regerar na web (o mesmo passo dos commits "Contrato gerado da api em dia"). |
| S6 | `tests/portal-assinatura-compras.test.ts:136` | Ver 2.5: a herança muda o veredito. | Reescrever o caso. |
| S7 | Portal web (P23, ainda não feito) | A sessão do portal ainda não desenha `orderNumbers`. Quando desenhar, deve seguir a **página pública da main**: campo único, oculto quando há `inherited`. | Nota para o P23. Nada a mudar agora. |
| S8 | Mobile `feat/implemento` | Os únicos mapas de função do app são os que a main mudou (`responsible.dart`, `administration_enums.dart`); a branch não tem `switch` próprio sobre função. | Nada. |

---

## 4. Banco local `ankaa_implemento` depois do merge

Estado medido: o clone tem tudo da branch aplicado, até `20260930120350`.
**Não tem** a `20260928120000_responsible_role_pcp_shipping_logistics`; o clone
veio do `ankaa_dev`, que também não a tem.

Ordem, toda no worktree `api-wt-implemento` e **nunca** contra o `ankaa_dev`:

1. `npx prisma migrate status`: deve listar só a `20260928120000` como pendente.
2. `npx prisma migrate deploy`: aplica essa migration. Não há view nem CHECK dependente (conferido em `pg_depend`), só o índice GIN, que o `ALTER` reconstrói.
3. `npx prisma generate` (o `node_modules` do worktree é próprio, não é symlink).
4. Reiniciar a api (o `ts-node-dev` reinicia sozinho ao mudar o `.ts`, mas o client novo do Prisma pede um restart limpo).
5. `pnpm contracts:export` e regerar o contrato da web (S5).

---

## 5. O commit local não publicado da `main` do mobile (`c8afc71`)

**O que é:** só o bump `version: 1.4.2+25 → 1.4.3+26` em `pubspec.yaml`, com a
mensagem "release com as funções do responsável e o envio por responsável". É a
marca de um build que provavelmente **já foi distribuído** (1.4.3+26) sem que o
commit tivesse sido publicado. A `origin/main` e a `origin/feat/implemento`
continuam em `1.4.2+25`.

**Como tratar (nada foi publicado):**
- Não fazer push sem o dono: ele decide se o 1.4.3+26 de fato saiu.
- Ao trazer a `main` para a `feat/implemento`, mesclar a **`main` local** (que contém `c8afc71`), não só a `origin/main`. Assim a branch nasce com `1.4.3+26` e o próximo release dela sobe para **`1.4.4+27` ou mais**. Se o app da branch sair com um build menor ou igual ao instalado, o aviso de atualização nativa (`GET /install/version` contra o instalado) não dispara.
- O merge é limpo: só `pubspec.yaml`, que a branch não toca.

---

## Lista curta de resoluções

1. **zod pipe:** construtor da branch, mais `coerceFormData?: boolean` em `ZodValidationPipeOptions`.
2. **budget.service:** manter `extendValidity` e apagar `reuseOwnLayoutFiles` e `resolveLayoutPlan`.
3. **order-number-gate:**
   - predicado único da branch, mais `inherited`;
   - corpo de `resolveOrderNumberSubmission` da main;
   - `missing` por `!v.hasNumber`;
   - `value` inclui `purchaseOrder.number`;
   - selects ganham `purchaseOrder.number`;
   - DD12.1 no PLANO: um pedido por orçamento.
4. **envelope.service:** imports e corpo da branch (`orderNumberRequirement`).
5. **verify-order-number-gate:** lado da main, mais dois casos DD12. Ajustar o teste `portal-assinatura-compras:136`.
6. **web painel.tsx:** lado da branch (sem `ROLE_LABELS`).
7. **S1:** `coerceFormData: false` na rota de assinatura do portal.
8. **S2–S4:** capacidades e seções de PCP, Expedição e Logística na api, na web e nos testes (proposta acima, **dono confirma**).
9. **S5:** regerar o contrato da web.
10. **Banco:** `migrate deploy` (aplica só a `20260928120000`) e `generate` no `ankaa_implemento`.
11. **Mobile:** mesclar a `main` local (`c8afc71`) e subir a versão da branch acima de `1.4.3+26`; não publicar sem o dono.
