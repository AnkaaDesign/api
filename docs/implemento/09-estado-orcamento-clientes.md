# 09 — A máquina de estados do orçamento (DD2) nas telas: web interno, Portal do Responsável e app

Data: 23/09/2026. **Somente análise**: nenhum arquivo dos repositórios foi alterado, nenhuma escrita no banco. Complementa o `PLANO.md` (v1) e os relatórios `01..07`, e **substitui a parte de assinatura/Marketing do D-14** do v1, que caiu com a DD2.

| Repo | Caminho | Branch | HEAD lido |
|---|---|---|---|
| API | `/home/kennedy/Documents/repositories/api` | `feat/portal-do-responsavel` | `ad3c65d4` (main `2bc5eccf`) |
| WEB | `/home/kennedy/Documents/repositories/web` | `feat/portal-do-responsavel` | `989c9f6e` (main `da5c09f8`) |
| APP | `/home/kennedy/Documents/repositories/mobile-flutter` | `main` | `9335286` (`1.4.1+24`, o que está instalado) |

**Convenções.** **FATO** = li no código/dado e cito `arquivo:linha`. **INF** = inferência. **[DONO]** = só o dono decide. Prefixos: `api:`, `web:`, `app:` (raiz de cada repo). Números "no clone" vêm do banco local (dado real até ~30/06 + dados de teste locais até 21/09); refazer em produção.

---

## 0. Resumo executivo

1. **O achado que muda a conta: quase toda a máquina de estados que as telas da branch desenham NUNCA foi a produção.** Os três estados do portal (`REQUESTED`, `IN_NEGOTIATION`, `PRE_APPROVED`), o rótulo "Aguardando Assinatura" do `PENDING`, a ordem de 8 degraus e a fila híbrida (`queueRank`) só existem em `feat/portal-do-responsavel` (FATO: `git show main:prisma/schema.prisma` tem 5 valores, linhas 4527-4540; web main rotula `PENDING` como **"Pendente"**, `main:src/constants/enum-labels.ts:2478`; as migrations `20260920120000` e `20260920190000` não estão na main; o app instalado conhece 5 estados, `app:lib/features/financial/financial_enums.dart:21-33`). Consequência: a regra "prefira mudar rótulo a mudar valor" vale para os **5 valores de produção** (`PENDING`, `APPROVED`, `SIGNED`, `EXPIRED`, `CANCELLED`); os **3 do portal ainda podem ser renomeados ou apagados sem custo de dado persistido** — o preço sobe no dia do primeiro deploy.
2. **O estado de nascimento é `PENDING` em 11 escritores** (6 no web, 1 no app, 4 na API; §6.7) **e quase nenhum `PENDING` tem coleta**: 155 de 164 no clone (FATO, consulta §1). Na branch esses 155 aparecem como "Aguardando Assinatura" sem documento emitido — a própria `web:src/components/cliente/orcamento/waiting-on.ts:108-111` registra "18 de 18" no acervo do dono. O rótulo da branch é uma mentira estrutural; o de produção ("Pendente") é verdadeiro.
3. **A emissão hoje não tem portão de estado.** `createEnvelope` barra coleta viva/concluída, dois pagadores, layout, validade e responsáveis (`api:src/modules/common/signature/services/signature-envelope.service.ts:1056-1108`), e **move qualquer estado ≠ `PENDING`/`CANCELLED` para `PENDING`**, inclusive `APPROVED` (`:1531-1569`). Nas telas o botão "Enviar para assinatura" só depende de `canManage` (`web:src/components/financial/budget/signature-envelope-card.tsx:682-690`; `app:lib/features/signature/envelope_section.dart:251-259`); o bloqueio aparece só **dentro** do diálogo, como **string** do preflight.
4. **`APPROVED` é o eixo do faturamento em ~25 pontos** (web, app, API; §6.6). Qualquer modelo que mude o **significado** de `APPROVED` sem mudar o faturamento muda quando se cobra; qualquer modelo que ponha estados **depois** de `APPROVED` quebra esses 25 pontos. É aqui que as alternativas se separam.
5. **A aprovação manual é o caminho real, não a exceção**: 427 dos 429 orçamentos `APPROVED` do clone não têm envelope nenhum (FATO). O web aprova pelo endpoint genérico `PUT /budgets/:id/status` — **sem** o portão de layout que só existe em `budgetApprove` (`api:src/modules/production/budget/budget.service.ts:6005-6045` × `:3640-3649`); o app aprova por `PUT /budgets/:id/budget-approve` — **com** o portão (`app:lib/features/financial/budget_status_control.dart:450-452`). Duas portas, dois portões.
6. **Três modelos para DD2** (§5): **A** reaproveita valores (`PRE_APPROVED`="Valor aprovado", `PENDING`="Aguardando assinatura"); **B** cria um valor novo para a coleta e devolve `PENDING` a "Pendente"; **C** faz de `APPROVED` o "valor aprovado" (que é o que o dono disse: *"orçamento aprovado será antes"*) e dá à assinatura **um eixo próprio**, como o faturamento ganhou o seu em 16/09. **Recomendo C**, condicionado à pergunta 1 (o faturamento pode começar com o valor aprovado?); **B** se a assinatura tiver de preceder a cobrança; **A não** (inverte o significado de 155 linhas, do preset do comercial, de 283 linhas de histórico e do que o app instalado grava).
7. **Em qualquer modelo** a tela precisa de um **checklist de emissão** que mostre o estado da **arte por veículo** e diga por que não pode emitir; o preflight precisa ganhar um bloco **estruturado** (`gates`) **sem** mudar `blockers: string[]`, porque o app instalado só lê string (`app:lib/features/signature/envelope_models.dart:781-784`) e o web casa "layout" por regex (`web:src/components/financial/budget/signature-send-dialog.tsx:296`).
8. **App instalado**: a lista de Orçamentos filtra `status IN [EXPIRED, SIGNED, PENDING, APPROVED]` (`app:lib/features/financial/budget_list_config.dart:89-91`). **Todo estado fora disso some da lista do celular, sem erro** — já acontece com os três do portal. C é o único modelo que não acrescenta estado de `BudgetStatus` visível ao app.
9. **Telas novas** (§7): checklist de emissão, badge/coluna de arte por veículo, diálogo "Aprovar valor em nome do cliente", cartão "Aprovação do valor" (que hoje só existe para orçamento nascido de requisição), badge/coluna/filtro do estado da assinatura, e no portal o eixo da arte no "Esperando" e o grupo "Valores para aprovar".

---

## 1. Fatos de base (clone e código)

| # | Fato | Evidência |
|---|---|---|
| F1 | Distribuição de `Budget.status` no clone: `APPROVED` 429 (2 com envelope), `PENDING` 164 (9 com envelope, 1 concluído), `REQUESTED` 15 (9 com envelope), `EXPIRED` 6 (6), `CANCELLED` 1 | consulta `SELECT status, count(*) … FROM "Budget"` |
| F2 | Envelope × orçamento: `RUNNING` sobre `PENDING` 7 e **sobre `REQUESTED` 9** (a deriva que a branch consertou em `createEnvelope`); `COMPLETED` sobre `PENDING` 1 (o caso nº 591); `REFUSED` sobre `EXPIRED` 6 | consulta `SignatureEnvelope ⋈ Budget` |
| F3 | Os 155 `PENDING` sem envelope por mês de criação: jan 17, fev 38, mar 16, abr 7, mai 10, **jun 60 (53 com tarefa viva)**, jul 4, set 3. 66 têm tarefa viva, 89 não | consulta por `date_trunc('month', createdAt)` |
| F4 | O changelog guarda valores mortos como string: `PENDING→BUDGET_APPROVED` 283, `BUDGET_APPROVED→COMMERCIAL_APPROVED` 221, `BILLING_APPROVED→UPCOMING` 133 …; `PENDING→SIGNED` 1; `IN_NEGOTIATION→PRE_APPROVED` 1 | `SELECT newValue, oldValue … FROM "ChangeLog" WHERE field='status' AND entityType='TASK_QUOTE'` |
| F5 | `SIGNED` **tem** escritor (`markSigned`, só de `PENDING`) — a nota "ninguém escreve SIGNED" está velha | `api:src/modules/production/budget/budget.service.ts:3367-3387`, chamado em `budget.module.ts:89` |
| F6 | `EXPIRED` só é escrito pela coleta (vencida ou recusada), e só a partir de `PENDING` | `budget.service.ts:3434-3448` (`markExpiredBySignature`), `:3500-3520` (`markRefusedBySignature`) |
| F7 | Pré-aprovação no portal carimba `BudgetRequest` e, se o orçamento não nasceu de requisição, **fabrica** uma (`upsert … create: { briefing: BRIEFING_SEM_REQUISICAO }`) | `api:src/modules/people/portal/portal-decision.service.ts:251-296` |
| F8 | Não existe `Budget.approvedAt`/`approvedById`; a data da aprovação vem do changelog | `api:prisma/schema.prisma:1886-1928`; `portal-read.service.ts:573-577` |
| F9 | Dashboards salvos com `quoteStatuses`: 5 em `Preferences.dashboardLayoutWeb` (1 com `PENDING`), 1 em `dashboardLayoutMobile` | consulta em `"Preferences"` |
| F10 | Migrations de estado só na branch têm data **anterior** a uma já aplicada na main (`20260922130000_envelope_lembra_o_que_ja_avaliou`) | `git ls-tree main prisma/migrations` × branch |

---

## 2. A máquina de hoje (branch), estado por estado

| Valor | Rótulo em produção (main) | Rótulo na branch | Cor (`variant`) | `statusOrder` | `queueRank` | Quem escreve | Sai para (grafo manual) |
|---|---|---|---|:-:|---|---|---|
| `REQUESTED` | — (não existe) | Requisição | `purple` | 1 | mais recente primeiro | requisição do portal; recusa do portal (`IN_NEGOTIATION→`); reanálise (`EXPIRED→`) | `IN_NEGOTIATION`, `PENDING`, `CANCELLED` |
| `EXPIRED` | Aguardando Reanálise | Aguardando Reanálise | `orange` | 2 | mais antigo primeiro | `markExpiredBySignature`/`markRefusedBySignature` (só de `PENDING`) | `PENDING`, `REQUESTED`, `CANCELLED` |
| `PRE_APPROVED` | — | Pré-aprovado | `indigo` | 3 | recente | portal `PRE_APPROVE` (só de `IN_NEGOTIATION`) | `PENDING`, `IN_NEGOTIATION`, `CANCELLED` |
| `SIGNED` | Assinado | Assinado | `completed` (verde) | 4 | recente | `markSigned` (só de `PENDING`) | `APPROVED`, `PENDING`, `CANCELLED` |
| `IN_NEGOTIATION` | — | Em Negociação | `teal` | 5 | antigo | comercial ("Enviar para pré-aprovação") | `PRE_APPROVED`, `REQUESTED`, `CANCELLED` |
| `PENDING` | **Pendente** | **Aguardando Assinatura** | `pending` (âmbar) | 6 | antigo | **padrão de criação** (11 escritores); `createEnvelope`; auto-revert de edição de valor; reprovação | `APPROVED`, `IN_NEGOTIATION`, `CANCELLED` |
| `APPROVED` | Aprovado | Aprovado | `processing` (azul) | 7 | recente | `budgetApprove` (rota própria e gancho da coleta concluída); `PUT /status` | `PENDING`, `CANCELLED` |
| `CANCELLED` | Cancelado | Cancelado | `cancelled` | 8 | recente | cancelamento da tarefa/O.S. comercial | ∅ |

Fontes (FATO): rótulos `web:src/constants/enum-labels.ts:2472-2490` **e** `web:src/components/production/task/quote/quote-status-badge.tsx:31-101` (dois mapas de rótulo: §12 R3); ordem `web:src/constants/sortOrders.ts:166-178` = `api:src/constants/sortOrders.ts:189-201`; `queueRank` `api:prisma/migrations/20260920190000_fila_hibrida_por_estado/migration.sql:50-61`; grafo `api:…/budget.service.ts:5913-5993` = `web:src/utils/permissions/quote-permissions.ts:66-104`; portal `api:src/modules/people/portal/portal-decision-transitions.ts:38-47`.

**O fluxo real de hoje (branch):**

```
  portal: REQUESTED ──"Enviar p/ pré-aprovação"──▶ IN_NEGOTIATION ──vendedor aprova──▶ PRE_APPROVED
     │                                                   │ recusa (motivo) ─▶ REQUESTED        │
     │                                                                                          │ emissão
  interno: (nasce) PENDING ◀────────────── emissão (de QUALQUER estado ≠ CANCELLED) ◀───────────┘
                    │  │ cliente assina tudo ─▶ SIGNED ─contra-assinatura─▶ budgetApprove ─▶ APPROVED ─▶ faturamento
                    │  └ coleta vence/recusa ─▶ EXPIRED ─reanálise─▶ PENDING | REQUESTED
                    └──── "Aprovar" manual (seletor / app) ─────────────────────────────────▶ APPROVED   (427 de 429)
```

---

## 3. O fluxo novo (DD2) em uma página

Palavras do dono: *"orçamento terá aprovação e essa aprovação será do VALOR, que poderá ocorrer ANTES de emitir as assinaturas; para poder emitir as assinaturas o orçamento deve estar aprovado e o layout também […] ao emitir assinaturas deve ter algum status, já que orçamento aprovado será antes"*.

Regras que valem em **qualquer** modelo (e que as telas têm de refletir):

| # | Regra | O que a tela faz |
|---|---|---|
| N1 | Existe um estado "valor aprovado", alcançável por **todo** orçamento (nascido no portal ou por dentro), pelo cliente no portal **ou** pelo comercial em nome dele (nota obrigatória, igual à arte, DD5) | ação "Aprovar valor" + diálogo com nota; cartão "Aprovação do valor" com quem/quando/total aprovado |
| N2 | **Emitir exige**: valor aprovado **∧** arte `APPROVED` em **todo** implemento do orçamento (+ os portões que já existem: validade, pagador único, responsáveis, coleta não viva/concluída) | checklist com o estado da arte **por veículo**, botão desabilitado com o motivo, atalho para resolver cada item |
| N3 | A emissão tem **estado próprio** (o "algum status" do dono) | badge/coluna/filtro do estado da assinatura na lista e no detalhe |
| N4 | Editar o **valor** depois de aprovado derruba a aprovação do valor e, se houver, a coleta (já existe o auto-revert, §6.3) | aviso antes de salvar; mensagem pós-salvar |
| N5 | A assinatura leva a **arte aprovada** de cada veículo (hipótese de trabalho DD2): a seção `LAYOUT` e o Marketing continuam | `MARKETING: ["LAYOUT"]` fica (desfaz D-14 do v1 nas telas: §6.8) |
| N6 | Arte que muda depois da emissão (versão nova aprovada) derruba a coleta, como o valor [DONO, P11] | aviso "a coleta cai" no ato de enviar/aprovar versão nova |

---

## 4. O papel de `APPROVED` hoje — por que ele decide o modelo

| Onde | O que faz com `APPROVED` | Evidência |
|---|---|---|
| web — rota do registro | `isBudgetBillingPhase(status) = status === APPROVED` decide se o clique abre **Orçamento** ou **Faturamento** (menus da agenda, histórico, preparação, dashboard) | `web:src/constants/enum-labels.ts:2518-2525`; `web:src/utils/task.ts:22-42`; usos em `task-schedule-table.tsx:257,267,367`, `task-schedule-table-page.tsx:395,608-611`, `task-table-context-menu.tsx:116`, `task-detail-page.tsx:999,1612`, `task-prep-page.tsx:640`, `dashboard/widgets/task-table.tsx:1926` |
| web — fila do faturamento | padrão do filtro "Status do Orçamento" = `[APPROVED]` | `web:src/components/financial/billing/table/billing-table-filters.tsx:85-90` |
| web — widget Boletos | `quote.is.status = APPROVED` ∧ cobrança aprovada | `web:src/dashboard/widgets/installment-table.tsx:183-190` |
| web — presets | "Faturamento Aguardando Aprovação" com `quoteStatuses: ["APPROVED"]` (2 presets); "Orçamentos Esperando Aprovação" (COMERCIAL) com `["PENDING"]` | `web:src/dashboard/presets.ts:887,941,1075` |
| web — Atenção | janela "ainda não faturado" = `PENDING ∨ SIGNED ∨ APPROVED` (Record total); regra "Faturamento sem cadastro completo" exige `eq APPROVED` | `web:src/lib/attention/rules.ts:72-95,110-113,516` |
| web — preço da tarefa | `calculateTaskPrice` devolve 0 enquanto `PENDING` | `web:src/utils/task.ts:213-217` |
| web — Salvar do assistente | "pin" de `APPROVED` para editar valor sem derrubar a aprovação | `web:src/pages/financial/budget/details/[taskId].tsx:1788-1853` |
| web — faturamento | o assistente de faturamento **fixa** o status no corpo para o auto-revert não derrubar a aprovação | `web:src/pages/financial/billing/details/[id].tsx:1527-1538` |
| app | `isBudgetBillingPhase`; "Aprovar Faturamento" só com `status == 'APPROVED'`; fila do faturamento `quoteStatuses: ['APPROVED']`; Atenção `_budgetApproved` | `app:lib/features/production/task_row_actions.dart:64-65,306-316`; `app:lib/features/financial/budget_sections.dart:172-180`; `app:lib/features/financial/billing_list_config.dart:73`; `app:lib/core/attention/attention_rules.dart:48-73,443`; `app:lib/features/production/budget_section.dart:117` |
| API (coordenação) | fila da home `getTasksAwaitingQuoteApproval`; Atenção `NOT_YET_INVOICED` e regra de cadastro; conciliação; sincronia O.S.→orçamento trata `PENDING ∨ APPROVED` como "rascunho"; marco "Orçamento aprovado" do portal; funil | `api:src/modules/domain/dashboard/repositories/dashboard/dashboard-prisma.repository.ts:3601,3661`; `api:src/modules/common/attention/attention.service.ts:314,568`; `api:src/modules/financial/reconciliation/receivable-task-match.service.ts:966`; `api:src/modules/production/service-order/service-order.service.ts:1957-1960,2067-2068`; `api:src/modules/people/portal/portal-read.service.ts:529-600`; `api:src/modules/financial/invoice/invoice-analytics.service.ts:646-657,818-841` |

Conclusão (INF): mover estados para **depois** de `APPROVED` no mesmo enum obriga a trocar `=== APPROVED` por "aprovado ou além" nesses ~25 pontos **e** no app instalado, que não recebe a troca. Mudar o **significado** de `APPROVED` para "valor aprovado" sem mexer neles só antecipa o momento em que o orçamento entra na fila do financeiro — que já é a prática (F1: 427/429 aprovados sem coleta).

---

## 5. As alternativas de modelagem

### 5.1 Os três modelos

**Modelo A — reaproveitar valores, mudar rótulos (L1: a assinatura fecha o contrato)**

```
REQUESTED("Em elaboração") → IN_NEGOTIATION → PRE_APPROVED("Valor aprovado")
   ─[emissão: valor ∧ arte]→ PENDING("Aguardando assinatura") → SIGNED → APPROVED("Aprovado", final)
```
O nascimento deixa de ser `PENDING` e passa a `REQUESTED` (relabel para servir a interno e portal). Nenhum valor novo.

**Modelo B — um valor novo para a coleta (L1)**

```
REQUESTED("Requisição") → PENDING("Pendente") → IN_NEGOTIATION → PRE_APPROVED("Valor aprovado")
   ─[emissão]→ AWAITING_SIGNATURE("Aguardando assinatura", NOVO) → SIGNED("Assinado pelo cliente") → APPROVED("Aprovado", final)
```
`PENDING` volta ao sentido de produção. Os ganchos da coleta (`markSigned/markExpired/markRefused/markInvalidated`) trocam `PENDING` por `AWAITING_SIGNATURE`.

**Modelo C — `APPROVED` é o valor aprovado; a assinatura ganha eixo próprio (L2: a frase do dono)**

```
Eixo do VALOR (BudgetStatus):  REQUESTED("Requisição") → PENDING("Pendente") → IN_NEGOTIATION("Aguardando aprovação do cliente")
                                → APPROVED("Aprovado" = valor aprovado; abre o faturamento como hoje)      EXPIRED, CANCELLED
Eixo da ASSINATURA (novo, persistido, escrito no mesmo commit do envelope):
   NOT_ISSUED("Não emitida") ─[emissão: APPROVED ∧ arte]→ AWAITING_CUSTOMER("Aguardando assinaturas")
   → AWAITING_ANKAA("Falta a Ankaa") → SIGNED("Assinado")      REFUSED | EXPIRED | INVALIDATED ("reemitir")
```
`PRE_APPROVED` (nunca foi a produção) é **apagado** antes do 1º deploy: a aprovação do vendedor no portal **é** a aprovação do valor (`IN_NEGOTIATION → APPROVED`) [DONO, P3]. `SIGNED` deixa de ser escrito em `BudgetStatus` (vira `APPROVED` + assinatura "Falta a Ankaa"). O vocabulário do eixo já existe no web, para o envelope: `ENVELOPE_LABEL` (`web:src/components/financial/budget/signature-envelope-card.tsx:166-175`: "Aguardando assinaturas", "Assinado", "Recusado", "Prazo expirado", "Invalidado"). É o mesmo movimento de 16/09, quando o ciclo do pagamento saiu de `BudgetStatus` para `Billing.status` (`web:src/constants/enums.ts:2855-2866`).

### 5.2 Comparação (o que cada um custa nas telas, nos dados e no app instalado)

| Critério | A (reaproveitar) | B (valor novo) | C (eixo próprio) |
|---|---|---|---|
| Valores novos em `BudgetStatus` | 0 | 1 (`AWAITING_SIGNATURE`) | 0 (e 1 a menos: `PRE_APPROVED`); **1 enum novo** `BudgetSignatureStatus` + coluna |
| Significado de `APPROVED` | inalterado (final) | inalterado (final) | **muda**: valor aprovado, antes da assinatura |
| ~25 pontos de faturamento (§4) | nada | nada | nada (mas cobrar antes de assinar vira regra — já é a prática) |
| 155 `PENDING` sem coleta (F3) | **viram mentira** ("Aguardando assinatura") → migrar para `REQUESTED` | continuam verdadeiros | continuam verdadeiros |
| `PENDING` com coleta viva (7 no clone) | ficam | migrar para `AWAITING_SIGNATURE` | ficam `PENDING` + eixo "Aguardando assinaturas"; a conclusão aprova como hoje [DONO, P8] |
| Preset "Orçamentos Esperando Aprovação" (`PENDING`) e 1 dashboard salvo (F9) | **inverte o sentido em silêncio** | preservado | preservado |
| 283 linhas de histórico `PENDING→BUDGET_APPROVED` (F4) | lidas como "Aguardando assinatura → Aprovado" (falso) | "Pendente → Aprovado" (verdadeiro) | idem B |
| App instalado cria com `'status':'PENDING'` (`app:…/budget_form_screen.dart:1969`) | nasce "em coleta" sem coleta → API tem de reinterpretar | correto | correto |
| App instalado — lista (`where status IN [EXPIRED,SIGNED,PENDING,APPROVED]`) | **somem todos os orçamentos antes da emissão** (REQUESTED/IN_NEGOTIATION/PRE_APPROVED) | somem os do portal **e os em coleta** | somem só os do portal (igual à branch hoje) |
| App instalado — rótulo | "Pendente" num orçamento em coleta (errado) | `AWAITING_SIGNATURE` cru, cinza | nada novo |
| App instalado — "Aprovar Orçamento" (`PENDING`/`SIGNED` → `/budget-approve`, `budget_sections.dart:164-167`) | aprovaria em coleta sem assinatura → API recusa | `PENDING→APPROVED` pula valor e assinatura → API recusa: o comercial **perde a aprovação pelo celular** até atualizar | `PENDING→APPROVED` **é** "aprovar o valor" — o ato novo; só falta a nota obrigatória (app velho não manda) [DONO, P2] |
| Ganchos da coleta (`markSigned/Expired/Refused/Invalidated`, "só de PENDING") | iguais | trocam a guarda | escrevem o eixo; recusa/vencimento **não** derrubam o valor [DONO, P5] |
| `statusOrder` (persistido) + `queueRank` (coluna gerada) | renumerar + recriar | +1 número; `AWAITING_SIGNATURE` cai no `ELSE` (antigo primeiro) sem recriar | tirar `PRE_APPROVED`/`SIGNED` do mapa; recriar `queueRank` (migrations ainda não publicadas, F10) |
| Portal "Esperando" | mantém a exceção de `PENDING` | simplifica | derivado de (valor, assinatura, arte) — §6.8 |
| Esforço de tela (web+portal+app novo) | médio | médio-alto | médio (+ coluna/badge da assinatura) |

**Recomendação.** **C**, se a resposta à pergunta 1 for "o faturamento pode começar com o valor aprovado" (é o que 99,5% do acervo faz e o que a frase do dono diz). **B**, se a assinatura tiver de preceder a cobrança. **A não**: é o único que inverte o sentido de dado já persistido em produção (155 linhas, o preset do comercial, 283 linhas de histórico) e do que o app instalado grava a cada orçamento criado.

As seções seguintes descrevem a mudança **no Modelo C**; onde B difere, a coluna diz "(B: …)".

---

## 6. Inventário por superfície: hoje × fluxo novo

### 6.1 As fontes espelhadas do estado (mudam juntas)

| Arquivo:linha | Hoje | Fluxo novo (C) |
|---|---|---|
| `web:src/constants/enums.ts:2867-2910` (`TASK_QUOTE_STATUS`, 8 membros, "ESPELHO de api") | 8 valores | tira `PRE_APPROVED`; `SIGNED` fica com comentário "legado, não é mais escrito". Novo `BUDGET_SIGNATURE_STATUS` (B: acrescenta `AWAITING_SIGNATURE`) |
| `web:src/types/budget.ts:13-21` (união de strings, comentário diz "cinco") | 8 | idem + tipo `BUDGET_SIGNATURE_STATUS`; corrigir o comentário |
| `web:src/schemas/budget.ts:46-55` (`budgetStatusSchema`), **`:190`** (`status … .default('PENDING')` no aninhado) | embute o enum nos schemas de tarefa (`taskCreateSchema`/`taskUpdateSchema`) | enum sem `PRE_APPROVED`; **o default `PENDING` sai** (o servidor decide o estado de nascimento) |
| `web:src/constants/enum-labels.ts:2472-2490` **e** `web:src/components/production/task/quote/quote-status-badge.tsx:31-101` | **dois** mapas de rótulo, iguais por disciplina | um só: `QUOTE_STATUS_CONFIG` passa a ler o rótulo de `TASK_QUOTE_STATUS_LABELS`. `PENDING` volta a **"Pendente"**; `IN_NEGOTIATION` "Aguardando aprovação do cliente" [DONO, P9]; `APPROVED` "Aprovado" |
| `quote-status-badge.tsx:110-130` (`TRIGGER_CLASS_BY_VARIANT`) | variante nova exige linha aqui | criar `SIGNATURE_STATUS_CONFIG` (rótulo+variante) no mesmo arquivo ou irmão, reusando as variantes de `ENVELOPE_LABEL` |
| `web:src/constants/sortOrders.ts:166-178` (gêmeo da API e do backfill da migration) | 8 números | `REQUESTED 1, EXPIRED 2, PENDING 3, IN_NEGOTIATION 4, APPROVED 5, CANCELLED 6`, `SIGNED`/`PRE_APPROVED` com número de legado. Reescrever o backfill de `20260920120000` **antes** do 1º deploy (F10) |
| `web:src/utils/permissions/quote-permissions.ts:66-104` (`VALID_TRANSITIONS`, "espelha byte a byte") | 8 linhas | `REQUESTED:[IN_NEGOTIATION,PENDING,CANCELLED]`, `PENDING:[IN_NEGOTIATION,APPROVED,CANCELLED]`, `IN_NEGOTIATION:[APPROVED,PENDING,REQUESTED,CANCELLED]`, `APPROVED:[PENDING,CANCELLED]`, `EXPIRED:[PENDING,REQUESTED,CANCELLED]`, `SIGNED:[APPROVED,PENDING,CANCELLED]` (legado). ⚠️ `APPROVED` como destino exige **nota** quando não vem do portal: o grafo não diz isso — o componente sim (§6.3) |
| `quote-permissions.ts:116-126` (`FINANCIAL` não vai a `APPROVED`) | | igual (aprovar valor é do COMERCIAL/ADMIN) |
| `web:src/utils/quote-status.ts:19-24,45-51` (`QUOTE_STATUSES_IN_ORDER`; `REVERTS_INTO_PENDING = [EXPIRED, SIGNED, APPROVED]`) | derivado; "rejeição" é voltar a `PENDING` desses três | `APPROVED→PENDING` continua sendo rejeição ("Reprovar valor", motivo obrigatório); `IN_NEGOTIATION→PENDING` ("Retirar do cliente") **não** pede motivo |
| `web:src/constants/enum-labels.ts:2518-2525` (`isBudgetBillingPhase`) | `=== APPROVED` | **igual em C** (B: igual) |

### 6.2 Web interno — listas, filtros, colunas e ids persistidos

| Arquivo:linha | Hoje | Fluxo novo (C) |
|---|---|---|
| `web:src/components/financial/budget/table/budget-table-columns.tsx:482-498` (`BUDGET_QUOTE_STATUSES`: opções do filtro **+** `where` padrão **+** guarda da célula) | lista positiva de 8 escrita à mão; estado fora dela **some da tela** | derivar de `QUOTE_STATUSES_IN_ORDER` (fecha a classe "estado novo invisível"); sem `PRE_APPROVED` |
| `budget-table-columns.tsx:425-444` (coluna id `quoteStatus`, ordena por `statusOrder`) | badge | igual; **coluna nova** id `signatureStatus` ("Assinatura") e id `artworkReadiness` ("Arte", "3/5 aprovadas") — ids sem ponto (persistem em `localStorage`/`Preferences.tableConfigsWeb` via `tableId: "financial-budget-list"`, `budget-table-page.tsx:233`) |
| `budget-table-columns.tsx:507-509` (`QUOTE_STATUS_EXPORT`) | derivado | + as duas colunas novas na exportação |
| `budget-table-columns.tsx:531` (`quoteStatus → { statusOrder }`) e `:570` (padrão `statusOrder, queueRank`) | | ordenar por `signatureStatus` só se a coluna for persistida (é o argumento para **persistir** o eixo, como `Billing.status`) |
| `web:src/components/financial/budget/table/budget-table-filters.tsx:28,74-80,224-230` (filtro `quoteStatuses`, `status: { in: … }`) | multiselect de estado | + filtro "Assinatura" (multiselect do eixo) + filtro "Pronto para emitir" (booleano: `APPROVED ∧ arte ok ∧ NOT_ISSUED`) — a fila de trabalho nova do comercial |
| Filtros da `DataTable` | vão na **URL** (`filters=` JSON), não em `localStorage` (FATO: `web:src/components/ui/datatable/data-table.tsx:367-373,443`); o layout (colunas, ordenação) vai em `localStorage` + servidor | favoritos/links com `PRE_APPROVED` na URL: o filtro passa um valor que o `z.enum` da API recusa → **400** na lista [INF; conferir]. Custo baixo porque nunca foi a produção |
| `web:src/components/financial/billing/table/billing-table-filters.tsx:85-90` | padrão `[APPROVED]`; opções = `Object.values` | igual em C (B: igual) |
| `web:src/pages/financial/root.tsx:512-519` ("Status dos Orcamentos", rótulo por `TASK_QUOTE_STATUS_LABELS`) | contagem por estado vinda da API | igual; valores de legado ganham rótulo via mapa de legado |
| `web:src/pages/financial/statistics/collection.tsx:139,362,828-832,917,991` (filtro "Estágios do Orçamento", config persistida `quoteStatus: z.array(z.string())`) | **não peneira** valor desconhecido e o repassa à API, que faz `status: { in: status as any }` (`api:…/invoice-analytics.service.ts:1652`) | peneirar como o widget de tarefas já faz (`dashboard/widgets/task-table.tsx:1354-1366`); senão um valor removido vira erro de validação do Prisma [INF] |
| `web:src/dashboard/widgets/task-table.tsx:946-955,1359-1366,2775-2779,3139-3143` (coluna `quoteStatus`, filtro `quoteStatuses` com peneira) | peneira valores mortos | igual; opcional: coluna "Assinatura" |
| `web:src/dashboard/presets.ts:887` ("Orçamentos Esperando Aprovação", COMERCIAL, `quoteStatuses: ["PENDING"]`) | fila do comercial | em C passa a `["PENDING","IN_NEGOTIATION"]` ("valor por aprovar") + preset novo "Prontos para emitir" (A: o preset mudaria de sentido sem ninguém tocar nele) |
| `web:src/dashboard/presets.ts:941,1075` (`["APPROVED"]`, faturamento) | | igual |
| `web:src/components/home-dashboard/awaiting-budget-approval-list.tsx:45` ("Orçamentos Aguardando Aprovação"; API `PENDING ∨ SIGNED`, `dashboard-prisma.repository.ts:3661`) | | título "Valor aguardando aprovação"; API `PENDING ∨ IN_NEGOTIATION` (C) |
| `web:src/components/production/task/preparation/task-prep-columns.tsx:419-440`; `web:src/components/production/task/history/task-export.tsx:180-181` | badge/rótulo do orçamento | igual; "Arte" por veículo é da coluna de produção (v1) |
| `web:src/utils/changelog-fields.ts:1658-1675` (mapa de legado) e `web:src/components/ui/task-with-service-orders-changelog.tsx:1089` | histórico lido com o rótulo **atual** | acrescentar `PRE_APPROVED: "Pré-aprovado"` e `SIGNED: "Assinado"` ao mapa de legado quando saírem do enum; campos novos (`signatureStatus`, `valueApproved*`) ganham rótulo |

### 6.3 Web interno — o assistente do orçamento (`pages/financial/budget/details/[taskId].tsx`, 2.322 linhas)

| Arquivo:linha | Hoje | Fluxo novo (C) |
|---|---|---|
| `[taskId].tsx:298,531,561` (form nasce `status: "PENDING"`) e **`:1913`** (criação manda `quoteData.status = "PENDING"`) | o cliente escolhe o estado de nascimento | não mandar `status` na criação |
| `web:src/components/financial/budget/budget-state-actions.tsx:63-101` (`ADVANCES`, `WAITING_HINT`, `SIGNATURE_HINT`) | `REQUESTED` → "Enviar para pré-aprovação"; `IN_NEGOTIATION` → aviso; `PRE_APPROVED`/`REQUESTED` → "vá à Assinatura eletrônica" | **reescrever o mapa**: `REQUESTED`/`PENDING` → "Enviar para aprovação do cliente" (→`IN_NEGOTIATION`) e "Aprovar valor em nome do cliente" (→`APPROVED`, abre diálogo com nota); `IN_NEGOTIATION` → aviso + "Aprovar valor em nome do cliente" (o cliente aprovou por telefone) + "Retirar do cliente" (→`PENDING`); `APPROVED` → **checklist de emissão** (§7 C1) no lugar de `SIGNATURE_HINT`. O texto de `PRE_APPROVED` ("emitir leva a Aguardando Assinatura") sai |
| `budget-state-actions.tsx:135-192` (coleta viva cala os encaminhamentos) | usa `envelopeGlance` | igual, mas lendo o **eixo** do servidor (`signatureStatus`) em vez de reconstruir do envelope |
| `budget-state-actions.tsx:151-154,245-249` ("Ao salvar, o orçamento vai para X") | | igual; para `APPROVED` por dentro, a nota vai junto no Salvar |
| `[taskId].tsx:916-944` (`useQuoteEnvelopes`, `watchedStatus`, `handleRequestAdvance` escreve no formulário) | o estado só é gravado no Salvar | igual; a **nota** da aprovação em nome do cliente viaja como `statusReason` hoje viaja para a rejeição |
| `[taskId].tsx:1788-1853` (**"pin" de `APPROVED`**: editar valor não derruba a aprovação) | decisão do dono de 2026-05, reconfirmada em 10/06 | **conflita com N4**: com a aprovação sendo do VALOR, editar o valor e manter "Aprovado" é afirmar que o cliente aprovou um número que não viu [DONO, P4]. Recomendo tirar o pin do assistente de orçamento (o do faturamento, `billing/details/[id].tsx:1527-1538`, continua: lá não se mexe em valor com cobrança travada) |
| `[taskId].tsx:1855-1911` (replica o caminho hop a hop; toast "voltou para Pendente") | | igual; o texto do toast (`:1889`) passa a "voltou para Pendente: o valor mudou e a aprovação do valor caiu (e a coleta, se havia)" |
| `web:src/components/financial/budget/steps/budget-step-review.tsx:492-575` (combobox de status com `getAvailableQuoteStatusTransitions`) | oferece **toda** aresta legal — inclusive `PRE_APPROVED→PENDING` e `REQUESTED→PENDING`, isto é, "Aguardando Assinatura" **sem emitir nada** | o seletor só oferece estados **manuais**; os de sistema (em C: nenhum do eixo do valor é de sistema salvo o `APPROVED` vindo do portal) ficam desabilitados com dica. Em B: `AWAITING_SIGNATURE`/`SIGNED` desabilitados |
| `budget-step-review.tsx:1179-1225` (diálogo "Rejeitar Orçamento … voltará para **Pendente**") | texto certo em produção, errado na branch | título "Reprovar valor"; nota obrigatória; aviso "se houver coleta em andamento, ela é cancelada" |
| **novo** no Resumo: diálogo "Aprovar valor em nome do cliente" | não existe (aprovar é um item do combobox, sem nota) | §7 C3 |
| `web:src/components/financial/budget/budget-request-card.tsx:180-230` (selos "Pré-aprovada"/"Recusada" lidos de `BudgetRequest`) | só existe para orçamento nascido no portal | a **aprovação do valor** sai de `BudgetRequest` e vai para o `Budget` (quem, quando, origem PORTAL/ON_BEHALF, total aprovado, nota); cartão próprio §7 C4. O cartão da requisição fica só com o briefing e a recusa |
| `budget-request-card.tsx:215` ("refaça o orçamento e reenvie para pré-aprovação") | | "…e reenvie para aprovação do cliente" |
| `web:src/components/financial/budget/steps/budget-step-task.tsx` (tabela de veículos irmãos, v1 `:812-866`) | sem estado de arte | badge de arte por veículo (§7 C2) |
| `[taskId].tsx:89-98,947-966,2301-2310` (`LAYOUT_STEP`, `goToLayoutStep`, `onResolveLayout`) | atalho para o seletor de layout do orçamento | sai (v1 P22); o atalho novo leva ao **veículo** cuja arte falta (painel de arte do implemento) |

### 6.4 Web interno — a assinatura (emitir, reenviar, cancelar, contra-assinar)

| Arquivo:linha | Hoje | Fluxo novo (C) |
|---|---|---|
| `web:src/components/financial/budget/signature-envelope-card.tsx:672-693` ("Nenhuma coleta emitida" + "Enviar para assinatura", só `canManage`) | botão sempre ativo; o "não pode" aparece só no diálogo | botão **desabilitado** enquanto o checklist não fechar, com a lista do que falta ao lado (§7 C1); `title` com o motivo |
| `signature-envelope-card.tsx:634-657` ("Cancelar" em `RUNNING`; "Reenviar" em qualquer estado ≠ RUNNING/COMPLETED) | reenviar não confere estado | "Reenviar" sujeito ao **mesmo** checklist (uma coleta recusada depois de o valor cair não pode ser reemitida sem nova aprovação) |
| `signature-envelope-card.tsx:703-716` ("Ao confirmar, o documento final é emitido **e o orçamento é aprovado**") | contra-assinar aprova | C: "…e a coleta é concluída" (o valor já está aprovado). B: igual a hoje |
| `signature-envelope-card.tsx:166-175` (`ENVELOPE_LABEL`) | rótulos do envelope | viram a base do `SIGNATURE_STATUS_CONFIG` (uma fonte) |
| `web:src/components/financial/budget/signature-send-dialog.tsx:248-261,290-321` (blockers como string; regex `/layout/i` casa o atalho "Escolher o layout aprovado") | | ler `preflight.gates` estruturado (§7 C1): uma linha por impedimento com **código** e ação; **apagar** a regex (v1 já pedia) |
| `signature-send-dialog.tsx:338-345` ("o servidor recusa layout ausente, validade vencida, dois pagadores e coleta já emitida") | | "valor não aprovado, arte pendente em N veículos, validade vencida, …" |
| `web:src/components/financial/budget/use-quote-envelopes.ts:60-96` (`envelopeGlanceOf`) | reconstrói o estado da coleta no cliente | passa a ler o eixo do servidor; o hook continua para o card |
| `web:src/components/production/task/detail/sections/quote-billing-section.tsx:189,934-989` (card embutido na tarefa; bloco "Layout Aprovados" do orçamento) | | card igual (herda o checklist); o bloco vira "Arte deste veículo: estado" (v1) |

### 6.5 Web interno — tarefa, produção, criação

| Arquivo:linha | Hoje | Fluxo novo (C) |
|---|---|---|
| `web:src/components/production/task/detail/task-detail-page.tsx:1088-1135` (campo "Status do Orçamento" editável inline, transições do grafo) | edita o estado do orçamento de dentro da tarefa, inclusive `PRE_APPROVED→PENDING` sem emissão | manter só as arestas manuais; `→APPROVED` pede a nota (mesmo `askReason`, rotulado "Aprovar valor em nome do cliente"). Mostrar o eixo da assinatura ao lado, só leitura |
| `task-detail-page.tsx:144-173` (`QUOTE_STATUS_VARIANTS` derivado) | | igual |
| `web:src/components/production/task/detail/service-orders-section.tsx:125` (`quoteWillCancel`) | | igual |
| `web:src/utils/task.ts:213-217` (`calculateTaskPrice` = 0 em `PENDING`) | preço oculto enquanto pendente | igual em C (B: igual); anotar que `IN_NEGOTIATION`/`REQUESTED` já mostram preço |

### 6.6 Web interno — faturamento que depende de `APPROVED`

Todos os pontos de §4 (linha "web"): **nenhuma mudança em C nem em B**. Em A também nenhuma. O que muda em C é **quando** um orçamento entra na fila (na aprovação do valor, não na conclusão da coleta) — e a notificação `task_quote.budget_approved` ("pronto para aprovação de faturamento", `api:…/budget.service.ts:3655-3666`) passa a sair nesse momento. Só a tela de faturamento deve **mostrar** o eixo da assinatura (badge "Assinatura: Aguardando" no cabeçalho do assistente, `web:src/pages/financial/billing/details/[id].tsx`), para o financeiro saber que está cobrando algo ainda não assinado [DONO, P1].

### 6.7 Os escritores do estado de nascimento (`PENDING`)

| Escritor | Evidência | Em C/B | Em A |
|---|---|---|---|
| web criação de orçamento | `web:src/pages/financial/budget/create.tsx:868` | tirar `status` (o servidor decide) | idem, e obrigatório |
| web assistente (criação) | `[taskId].tsx:1913` | idem | idem |
| web orçamento rápido (widget) | `web:src/dashboard/widgets/quick-budget.tsx:190` | idem | idem |
| web duplicar tarefa | `web:src/components/production/task/modals/task-duplicate-modal.tsx:284` | idem | idem |
| web criar tarefa com orçamento | `web:src/components/production/task/form/task-create-form.tsx:575` | idem | idem |
| web schema aninhado | `web:src/schemas/budget.ts:190` (`.default('PENDING')`) | tirar o default | idem |
| **app instalado** | `app:lib/features/financial/budget/budget_form_screen.dart:1969` (`'status': 'PENDING'` no `batch-with-quote`) | **correto** (Pendente) | **errado**: API tem de traduzir `PENDING` de criação para o novo nascimento e contar |
| API | `api:prisma/schema.prisma:1891` (`@default(PENDING)`), `api:src/schemas/budget.ts:923,973` (`.default(PENDING)`), `budget.service.ts:519-526`, `budget-prisma.repository.ts:241-246` | manter `PENDING` como nascimento; **ignorar `status` na criação** (log + contador) | trocar os 4 |

### 6.8 Portal do Responsável (`web/src/components/cliente/**`, `web/src/pages/cliente/*`)

| Arquivo:linha | Hoje | Fluxo novo (C) |
|---|---|---|
| `web:src/components/cliente/orcamento/waiting-on.ts:36-81` (`PORTAL_WAITING_BY_STATUS`) | deriva "de quem é a vez" só do estado; exceção para `PENDING` (`:118-131`, `signature.emitted/awaitingMe`) | **derivar de três eixos**: valor, assinatura, arte. Tabela abaixo |
| `waiting-on.ts:92-97` (`NAO_EMITIDO`: "A Ankaa ainda não emitiu") | existe porque `PENDING` não garante coleta | em C some: "não emitido" é `APPROVED ∧ NOT_ISSUED`, e a frase certa depende da arte |
| `web:src/components/cliente/orcamento/orcamento-columns.tsx:113-151` (colunas "Estado" e "Esperando"; ids `quoteStatus`, `waitingOn` persistidos em `tableId: "portal-cliente-orcamentos"`, `pages/cliente/orcamentos/list.tsx:203`) | | "Estado" mostra o valor; acrescentar id `signatureStatus` ("Assinatura"); "Esperando" passa a receber `(status, signature, artwork)` |
| `orcamento-columns.tsx:204-215` (`PORTAL_BUDGET_STATUS_OPTIONS` "na ordem de atenção") | **não** está na ordem de atenção: é a ordem de declaração de `QUOTE_STATUS_CONFIG` (EXPIRED, SIGNED, PENDING, REQUESTED…) — FATO | derivar de `QUOTE_STATUSES_IN_ORDER`; sem `PRE_APPROVED` |
| `web:src/pages/cliente/orcamentos/list.tsx:49-51,108,144-147` (filtro `status`, peneira valores desconhecidos) | peneira | igual (a peneira protege link antigo com `PRE_APPROVED`) |
| `web:src/components/cliente/orcamento/pre-aprovacao-actions.tsx:72-84` (`canDecideBudget`: `status === IN_NEGOTIATION` ∧ capacidade `PRE_APPROVE`) | | igual na condição; capacidade renomeada só no rótulo ("Aprovar valor") — o **valor** `PRE_APPROVE` da capacidade viaja no JSON do portal (`capabilities[]`); manter o valor [INF: nunca foi a produção, pode renomear se o dono quiser] |
| `pre-aprovacao-actions.tsx:172-176` ("Aprovar este orçamento? O orçamento passa a **Pré-aprovado** e volta para a Ankaa, que emite o documento") | | "Aprovar o valor deste orçamento? O valor fica aprovado. O documento para assinatura é emitido quando a arte de todos os veículos estiver aprovada — você também aprova as artes aqui no portal." (C) / "passa a **Valor aprovado**" (B) |
| `pre-aprovacao-actions.tsx:211-217` (recusa "volta ao estado **Requisição**") | recusa → `REQUESTED` | em C a recusa volta a `PENDING` quando o orçamento nasceu por dentro e a `REQUESTED` quando nasceu no portal [DONO, baixa] — o texto diz "volta para a Ankaa refazer", sem nomear estado |
| `web:src/components/cliente/orcamento/orcamento-proposta-card.tsx:254-300` (`OrcamentoDecisaoCard`, lê `budget.request.preApprovedAt/refusedAt`) | depende da `BudgetRequest` (fabricada para orçamento interno, F7) | ler a aprovação do valor do **orçamento** (`budget.valueApproval { at, by, source, note, total }`); "Aprovado em nome da sua empresa pela Ankaa em …" quando `ON_BEHALF` |
| `web:src/pages/cliente/orcamentos/[id].tsx:173,259,270,292-298,323,326-336` (badge, condições `REQUESTED`, ações, cards) | | + card **Arte por veículo** com Aprovar/Reprovar e lote (v1 §7.5, `orcamento-layout-card.tsx`) + faixa "Para emitir o documento falta: aprovar o valor · aprovar a arte de 2 veículos" |
| `web:src/pages/cliente/painel.tsx:140-150` (tiles por `byStatus`, ordenados por `TASK_QUOTE_STATUS_ORDER`), `:258-263` (link `?status=X`) | | igual; valores de legado sem tile |
| `painel.tsx:167-181,299-395` (grupos "Orçamentos para sua decisão" / "Documentos para assinar" / "Em produção") | `waitingOnMe.preApproval` (IN_NEGOTIATION) | "Valores para aprovar" (texto `:329` "Em negociação: você pode pré-aprovar…" → "Aprove o valor ou recuse com o motivo"), **"Artes para aprovar"** (v1), "Documentos para assinar" |
| `web:src/api-client/portal.ts:288` (`PortalBudgetStatus = TASK_QUOTE_STATUS`), `:664-693` (`canPreApprove`, `signature {emitted, awaitingMe}`), `:768-806` (`PortalSummary.waitingOnMe`) | | + `signatureStatus`, + `artwork { total, approved, awaitingCustomer, awaitingMe, atAnkaa }`, + `valueApproval`; `waitingOnMe.artworks` (v1). ⚠️ casar campo a campo com a projeção da API |
| `web:src/components/cliente/orcamento/sections.ts:64` (`MARKETING: ["LAYOUT"]`) | Marketing assina a seção LAYOUT | **fica** (DD2 derruba o D-14 do v1: a assinatura continua levando a arte) |
| `web:src/components/cliente/veiculo/veiculo-identidade-card.tsx:397` (badge do orçamento no veículo) | | igual + badge da arte do veículo (v1 `veiculo-arte-card.tsx`) |
| `web:src/components/cliente/orcamento/orcamento-veiculos-card.tsx:232`, `orcamento-servicos-card.tsx:49` (`status !== "REQUESTED"`) | | igual |
| Marco "Orçamento aprovado" da linha do tempo (API `portal-read.service.ts:573-600`, lê `APPROVED ∨ SIGNED` no estado e no changelog) | | C: continua certo (aprovado = valor); B: incluir `PRE_APPROVED`? não — o marco é do contrato. Acrescentar marco "Arte aprovada" [DONO, baixa] |

**"Esperando" no Modelo C** (substitui `PORTAL_WAITING_BY_STATUS`):

| Valor | Assinatura | Arte | Rótulo | Frase |
|---|---|---|---|---|
| `REQUESTED` | — | — | Com a Ankaa | Requisição recebida. A Ankaa está montando o orçamento. |
| `PENDING` | — | — | Com a Ankaa | A Ankaa está montando o orçamento. |
| `IN_NEGOTIATION` | — | — | **Com você** (se pode aprovar valor) / Com a sua empresa | Aguardando a aprovação do valor. |
| `APPROVED` | `NOT_ISSUED` | alguma `PENDING_APPROVAL` | **Com você** (se `APPROVE_ARTWORK`) / Com a sua empresa | Valor aprovado. Falta aprovar a arte de N veículo(s). |
| `APPROVED` | `NOT_ISSUED` | alguma sem arte/`DRAFT`/`REPROVED` | Com a Ankaa | Valor aprovado. A Ankaa está preparando a arte de N veículo(s). |
| `APPROVED` | `NOT_ISSUED` | todas `APPROVED` | Com a Ankaa | Valor e artes aprovados. A Ankaa vai emitir o documento para assinatura. |
| `APPROVED` | `AWAITING_CUSTOMER` | — | **Com você** (se `awaitingMe`) / Em coleta | O documento aguarda a sua assinatura. / Em coleta de assinaturas. |
| `APPROVED` | `AWAITING_ANKAA` | — | Com a Ankaa | Assinado por vocês. Falta a assinatura da Ankaa. |
| `APPROVED` | `SIGNED` | — | Em andamento | Assinado — daqui em diante quem anda é a produção e a cobrança. |
| `APPROVED` | `REFUSED`/`EXPIRED`/`INVALIDATED` | — | Com a Ankaa | A coleta foi recusada/venceu/caiu. A Ankaa vai reemitir. |
| `EXPIRED` | — | — | Com a Ankaa | (igual a hoje) |
| `CANCELLED` | — | — | — | Orçamento cancelado. |

(B: a mesma tabela, trocando "`APPROVED` + eixo" por `PRE_APPROVED` / `AWAITING_SIGNATURE` / `SIGNED` / `APPROVED`.)

⚠️ Os rótulos de estado que o portal mostra ao **cliente** são os internos (`QUOTE_STATUS_CONFIG`): "Aguardando Reanálise" e "Pendente" são vocabulário da Ankaa. [DONO, baixa]: perfil "cliente" de rótulo (como a nota × tela do v1 D-18).

### 6.9 App Flutter (`mobile-flutter`, `main` `9335286` — é o instalado)

| Arquivo:linha | Hoje (instalado) | App novo (C) | O que o instalado faz quando a API mudar |
|---|---|---|---|
| `app:lib/features/financial/financial_enums.dart:21-33` (`kBudgetStatusLabels`, **5** estados; `PENDING`="Pendente") | não conhece `REQUESTED/IN_NEGOTIATION/PRE_APPROVED` | + `REQUESTED` "Requisição", `IN_NEGOTIATION` "Aguardando aprovação do cliente"; `PENDING` segue "Pendente" | estado desconhecido aparece **cru** (`budgetStatusLabel` devolve o valor, `:57-61`), badge cinza (`:78-93`) |
| `financial_enums.dart:45-52` (`kLegacyBudgetStatusAliases`) | traduz valores mortos de cobrança para `APPROVED` | + `PRE_APPROVED→APPROVED` e `SIGNED→APPROVED` (C) | — |
| `financial_enums.dart:78-104` (tons e `kBudgetStatusOptions`) | 5 opções | + as novas; tons iguais aos do web | — |
| `app:lib/features/financial/budget_list_config.dart:74-91` (**`where status IN [EXPIRED, SIGNED, PENDING, APPROVED]`**), `:330-366` (coluna e filtro) | lista positiva | derivar de `kBudgetStatusOptions` sem `CANCELLED` | **orçamento em `REQUESTED`/`IN_NEGOTIATION` some do celular** (já é assim com a branch); em B somem também os em coleta |
| `app:lib/features/financial/budget_permissions.dart:105-127` (`kBudgetValidTransitions`: `PENDING:[APPROVED, CANCELLED]`) | sem arestas do portal | espelhar §6.1 | tenta `PENDING→APPROVED`: em C é o ato certo, mas a API passa a exigir nota → **400** com a mensagem [DONO, P2] |
| `app:lib/features/financial/budget_status_control.dart:45,66,72,403-460` (`kBudgetSurfaceStatuses = {PENDING, APPROVED}`; `APPROVED`→`repo.budgetApprove`; `PENDING`→`repo.reject`; opção "Aprovar Orçamento") | | rótulo "Aprovar valor"; coletar a nota; `kAutomaticBudgetStatuses` recebe o eixo da assinatura só leitura | — |
| `budget_status_control.dart:466-476` (`kBudgetStatusOrder`, 5) | | espelhar a ordem nova | — |
| `app:lib/features/financial/budget_sections.dart:160-180` (ação "Aprovar Orçamento" visível em `PENDING ∨ SIGNED`; "Aprovar Faturamento" em `APPROVED`) | | "Aprovar valor" em `PENDING ∨ IN_NEGOTIATION`; faturamento igual | — |
| `budget_sections.dart:344-351,2414-2640` (seção "LAYOUT APROVADO" com seletor) | | vira "ARTE POR VEÍCULO" só leitura, com o estado (v1 P24) | — |
| `app:lib/features/signature/envelope_section.dart:233-262` ("Nenhuma coleta emitida" + "Enviar para assinatura" sem portão) | | checklist e botão desabilitado (igual ao web) | continua ativo; o bloqueio chega **como string** no `send_sheet` (`widgets/send_sheet.dart:301-305,699-722`) e o envio fica travado — **desde que a API mantenha `blockers: string[]`** |
| `app:lib/features/signature/envelope_models.dart:714-741,781-784` (`blockers` só `String`) | objeto é descartado em silêncio | ler também `gates` | se `blockers` virar objeto: lista vazia → `blocked=false` → botão ativo → 400 no POST |
| `envelope_models.dart:15` (`'RUNNING': 'Coletando'`) × web "Aguardando assinaturas" | vocabulário divergente | alinhar com o eixo | — |
| `app:lib/features/production/budget_section.dart:117,186-187` (badge do orçamento na tarefa) | | + badge da assinatura | — |
| `app:lib/features/production/task_row_actions.dart:64-65,306-316` (`isBudgetBillingPhase`, rota) | `== APPROVED` | igual | igual (C/B) |
| `app:lib/features/financial/billing_list_config.dart:73,276-283` (padrão `['APPROVED']`) | | igual | igual |
| `app:lib/core/attention/attention_rules.dart:48-73,443` (janela `PENDING ∨ SIGNED ∨ APPROVED`) | espelho da API | espelhar a janela nova (§9 do web: `INVOICE_WINDOW`) | regra de pedido de compra pisca em conjunto ligeiramente diferente do web até atualizar [INF] |
| `app:lib/features/financial/budget/budget_form_screen.dart:1969` (`'status': 'PENDING'`) | | não mandar `status` | C/B: correto; A: errado |
| Persistência | `Preferences.tableConfigsMobile` guarda colunas e ordenação, **não filtros** (`app:lib/features/list/layout_prefs.dart:45-65`) | ids de coluna novos estáveis (`signatureStatus`) | — |

Regra de lançamento (v1 D-17, §6.7): **nenhum glifo de ícone novo** (o badge do eixo reusa `TablerIcons.signature`/`send` já presentes) para caber em patch Shorebird.

---

## 7. Telas e componentes NOVOS

| # | Componente | Onde | O que mostra / faz | Dados que precisa (API) |
|---|---|---|---|---|
| C1 | **Checklist de emissão** (`budget-issue-checklist.tsx`) | web: Resumo do assistente, acima do `SignatureEnvelopeCard`, e dentro do card embutido na tarefa; app: `envelope_section` | ✓/✗ **Valor aprovado** (por quem, quando, origem; ação "Aprovar valor" / "Enviar para aprovação do cliente"); ✓/✗ **Arte de cada veículo** (série/placa, miniatura, estado, desde quando; ações "Enviar ao cliente", "Aprovar em nome do cliente", "Abrir arte"); ✓/✗ validade, pagador único, responsáveis, coleta viva. Frase de topo: "Para emitir faltam 2 itens". O botão "Enviar para assinatura" só habilita com tudo ✓ | preflight com `gates: { value: {ok, at, by, source, total}, artworks: [{taskId, serialNumber, plate, implementId, layoutId, status, sentAt, decidedAt}], validity, payers, responsibles, envelope }` **além** de `blockers: string[]` |
| C2 | **Badge de arte** (`artwork-status-badge.tsx` + `ARTWORK_STATUS_CONFIG`) e **resumo por orçamento** ("3/5 aprovadas") | web: veículos do passo 1, Resumo, lista (coluna `artworkReadiness`), tarefa; portal (molde próprio); app | rótulos do v1: Sem arte, Rascunho, Aguardando aprovação do cliente, Aprovada, Reprovada, Substituída | `tasks[].implement.layouts[]` com status, ou agregado `artworkSummary` no orçamento (preferível na lista, para não trazer N×M linhas) |
| C3 | **Diálogo "Aprovar valor em nome do cliente"** | web Resumo/tarefa; app | total que está sendo aprovado, pagadores, **nota obrigatória** ("aprovado por WhatsApp em 23/09, contato Fulano"), aviso "o orçamento entra na fila do faturamento" (C) | `PUT /budgets/:id/status { status: APPROVED, reason }` ou rota própria `/approve-value { note }` |
| C4 | **Cartão "Aprovação do valor"** | web: assistente (no lugar do selo "Pré-aprovada" do cartão da requisição); portal: `OrcamentoDecisaoCard` | "Valor aprovado por Fulano (portal) em 23/09 — R$ 12.000,00" ou "…pela Ankaa em nome do cliente — nota: …"; "O valor mudou desde a aprovação" quando o total atual ≠ aprovado | campos novos no `Budget`: `valueApprovedAt`, `valueApprovedByUserId` / `valueApprovedByResponsibleId` (ator discriminado — nunca id de `Responsible` em FK de `User`), `valueApprovalSource`, `valueApprovalNote`, `valueApprovedTotal` |
| C5 | **Badge/coluna/filtro do estado da assinatura** (`SIGNATURE_STATUS_CONFIG`) | web: lista de Orçamentos, cabeçalho do assistente, faturamento, tarefa; portal: coluna "Assinatura"; app: lista e detalhe | Não emitida · Aguardando assinaturas (2/3) · Falta a Ankaa · Assinado · Recusada · Vencida · Invalidada | `Budget.signatureStatus` persistido (ordena e filtra no servidor, como `Billing.status`) |
| C6 | **Preset "Prontos para emitir"** e filtro booleano | web dashboard do comercial; lista | `APPROVED ∧ arte ok ∧ NOT_ISSUED` | filtro `readyToIssue` na rota da lista |
| C7 | **Faixa do portal "Para emitir o documento falta…"** | portal, detalhe do orçamento | a mesma régua do C1, em linguagem de cliente | `PortalBudget.artwork`, `signatureStatus` |
| C8 | **Grupo "Valores para aprovar"** e **"Artes para aprovar"** | portal Início | renomeia o grupo atual; o de arte vem do v1 | `waitingOnMe.preApproval` (renomear só o rótulo) + `waitingOnMe.artworks` |
| C9 | Modelo B apenas: ação **"Aprovar sem assinatura"** | web/app | `PRE_APPROVED→APPROVED` com nota, para o cliente que nunca assina (hoje 427/429) | aresta nova + nota |

---

## 8. App instalado — matriz de convivência (Modelo C)

| Situação | Instalado (`1.4.1+24`) | Consequência | Mitigação |
|---|---|---|---|
| Orçamento em `REQUESTED`/`IN_NEGOTIATION` | fora do `where` da lista | invisível no celular | já é o custo da branch; portão 426 (v1 D-17) |
| Orçamento `APPROVED` com coleta em andamento | aparece "Aprovado", faturamento liberado | financeiro pode cobrar antes da assinatura — é a regra nova em C | nenhuma (intencional) [DONO, P1] |
| Comercial toca "Aprovar Orçamento" em `PENDING` | `PUT /budget-approve` sem nota | se a API exigir nota: 400 com mensagem | aceitar sem nota com `source=LEGACY_APP` durante a janela, ou 426 [DONO, P2] |
| Toca "Enviar para assinatura" sem valor/arte | abre o `send_sheet` | vê o bloqueio como texto (lê `blockers: string[]`) e o botão fica travado | **não** mudar a forma de `blockers` |
| Cria orçamento | manda `'status':'PENDING'` | nasce "Pendente" (correto) | API ignora `status` na criação e conta |
| Lê `SIGNED` legado | "Assinado" verde | coerente | — |
| Lê `PRE_APPROVED` (se algum sobreviver) | cru, cinza | feio, raro | migrar para `APPROVED` antes do deploy |

(Modelo B: acrescentar a linha "orçamento em `AWAITING_SIGNATURE` some da lista e aparece cru no detalhe" e "Aprovar Orçamento em `PENDING` passa a ser recusado: o comercial não aprova pelo celular até atualizar".)

---

## 9. Dados persistidos que as telas leem (e o que fazer com eles)

| Persistido | Onde | C | B | A |
|---|---|---|---|---|
| `Budget.status` | banco | `SIGNED→APPROVED`; `PRE_APPROVED→APPROVED` (só clone/teste); resto igual | `PENDING`+coleta `RUNNING` → `AWAITING_SIGNATURE` | 155 `PENDING` sem coleta → `REQUESTED` |
| `Budget.statusOrder` | coluna comum, persistida | `UPDATE` pelo mapa novo | +1 número | renumerar |
| `Budget.queueRank` | coluna **gerada** (DROP INDEX + DROP COLUMN + ADD) | recriar sem `PRE_APPROVED`/`SIGNED` — **reescrevendo** `20260920190000`, que não foi publicada | nada (`ELSE` = antigo primeiro, que é o certo para "aguardando assinatura") | recriar |
| `Budget.signatureStatus` (novo) | banco | backfill a partir do último envelope | — | — |
| Changelog `field='status'` | string | rótulo de legado para `SIGNED`/`PRE_APPROVED` | rótulo novo | histórico relido com sentido novo (falso) |
| Filtros da lista interna | URL (`filters=`) | valor removido: 400 da API [INF] | — | valor `PENDING` muda de sentido |
| Dashboards salvos (`Preferences.dashboardLayoutWeb/Mobile`) | JSON | peneira do widget descarta valores mortos | idem | "Orçamentos Esperando Aprovação" passa a listar coleta |
| Config da página de estatística | `pageConfigSchema` sem peneira | peneirar | idem | idem |
| Colunas persistidas (`tableId`) | `localStorage` + `Preferences.tableConfigsWeb` | ids novos `signatureStatus`, `artworkReadiness` nascem visíveis por `defaultVisible` | idem | idem |
| Links do portal `?status=` | URL | a lista peneira | idem | idem |

---

## 10. Sequência sugerida (encaixe nos pacotes do v1; no máximo 2 agentes por vez)

1. **Decidir P1–P3** antes de qualquer código: definem se `PRE_APPROVED` existe e o que `APPROVED` significa.
2. **Guardas antes** (API + web): teste que o grafo do web é igual ao da API (hoje só comentário), teste que `BUDGET_QUOTE_STATUSES`/`where` do app cobrem o enum, teste que `blockers` continua `string[]`.
3. **API**: estado de nascimento decidido no servidor; aprovação do valor com carimbo no `Budget`; eixo `signatureStatus`; portão da emissão (valor ∧ arte) no preflight **e** no `createEnvelope`; preflight com `gates`; reescrever as duas migrations da branch (F10).
4. **Web interno**: fontes espelhadas (§6.1) → assistente (§6.3) → assinatura (§6.4) → listas (§6.2).
5. **Portal**: "Esperando" em três eixos, aprovação do valor, arte por veículo (junto com o P23 do v1).
6. **App** (branch nova a partir da `main`, DD6): enums, lista, ações, checklist; depois o portão 426.

---

## 11. Perguntas ao dono (curtas, com recomendação)

| # | Pergunta | Recomendação |
|---|---|---|
| P1 | O que libera o **faturamento**: o **valor aprovado** ou a **assinatura concluída**? | **Valor aprovado** (Modelo C). É o que acontece em 427 de 429 orçamentos aprovados, e é o que "orçamento aprovado será antes" diz |
| P2 | "Aprovar o valor em nome do cliente" (comercial/admin) continua existindo, com **nota obrigatória**? E o app antigo, que aprova sem nota, é aceito até atualizar? | **Sim**, com nota; o app antigo aceito com origem "app antigo" durante a janela, depois 426 |
| P3 | A aprovação do vendedor do cliente **no portal** já é a aprovação do valor, ou a Ankaa confirma depois? | **Já é**: apagar o estado "Pré-aprovado" antes do primeiro deploy (nunca foi a produção) |
| P4 | Editar o valor depois de aprovado **derruba** a aprovação? (hoje o assistente "fixa" o Aprovado ao salvar — decisão de maio, reconfirmada em 10/06) | **Derruba** sempre; o "fixar" sai do orçamento e fica só no faturamento |
| P5 | Coleta **recusada ou vencida** derruba o valor aprovado? | **Não**: a coleta fica "Recusada/Vencida — reemitir"; "Aguardando Reanálise" só quando o comercial decide rever o preço |
| P6 | Orçamento criado **por dentro** fica visível ao cliente no portal desde a criação? | **Não**: nasce "Pendente"; aparece para o cliente decidir quando o comercial clica "Enviar para aprovação do cliente" |
| P7 | Quem pode **emitir** com valor aprovado mas arte de um veículo pendente? Ninguém, ou o admin com justificativa? | **Ninguém** (a regra é sua); o caminho é aprovar a arte em nome do cliente, com nota |
| P8 | Os orçamentos antigos em "Pendente" **com coleta em andamento** (7 no clone): promover a "Aprovado" ou deixar a coleta concluir e aprovar como hoje? | **Deixar concluir**; o portão novo vale só para emissão nova |
| P9 | Rótulos: "Pendente" (o de produção) ou "Aguardando Assinatura" (o da branch) para `PENDING`? E "Em Negociação" vira "Aguardando aprovação do cliente"? | **"Pendente"** e **"Aguardando aprovação do cliente"** |
| P10 | O portal mostra ao cliente os rótulos internos ("Aguardando Reanálise", "Pendente")? | Criar um perfil de rótulo "cliente" (baixa prioridade) |
| P11 | Arte que muda (versão nova aprovada) **depois** da emissão derruba a coleta? | **Sim**, se o documento leva a arte (hipótese DD2); a tela avisa antes de enviar a versão nova |
| P12 | O financeiro deve ver "Assinatura: aguardando" no faturamento? Cobrar antes de assinar exige confirmação? | **Mostrar**, sem bloquear |

---

## 12. Riscos

| # | Risco | Onde | Mitigação |
|---|---|---|---|
| R1 | **Escolher o modelo errado para P1**: C antecipa a cobrança; se o dono quiser a assinatura antes, C cobra contrato não assinado | §5 | responder P1 antes do código |
| R2 | **Lista positiva que esconde estado**: `BUDGET_QUOTE_STATUSES` (web), `where` do app, `QUOTE_STAGE` do funil (API, não total: `REQUESTED/IN_NEGOTIATION/PRE_APPROVED` ficam fora, `invoice-analytics.service.ts:646-657`) | §6.2, §6.9 | derivar do enum; teste de cobertura |
| R3 | **Dois mapas de rótulo** no web + app + mensagens da API (`TASK_QUOTE_STATUS_LABELS` da API aparece nas mensagens de erro do portal, `portal-decision.service.ts:140-145`) | §6.1 | uma fonte no web; teste de igualdade com a API |
| R4 | **Seletor manual escrevendo estado de sistema**: hoje o combobox e o campo inline da tarefa escrevem `PENDING` ("Aguardando Assinatura" na branch) sem emitir coleta | `budget-step-review.tsx:535-575`; `task-detail-page.tsx:1088-1135` | separar arestas manuais das de sistema |
| R5 | **`blockers` como texto**: regex `/layout/i` ressuscita atalho; app descarta objeto | `signature-send-dialog.tsx:296`; `envelope_models.dart:781-784` | `gates` estruturado ao lado, `blockers` intocado |
| R6 | **"Pin" de status** mantém "Aprovado" sobre valor novo | `[taskId].tsx:1829-1840` | P4 |
| R7 | **`BudgetRequest` fabricada** na pré-aprovação de orçamento interno faz o assistente desenhar "Requisição do cliente" com briefing de sistema | `portal-decision.service.ts:286-296`; `budget-request-card.tsx` | aprovação do valor no `Budget` (C4) |
| R8 | **Migrations da branch com data anterior** a uma já aplicada na main | F10 | reescrever/renomear antes do 1º deploy; conferir `prisma migrate status` no ensaio |
| R9 | **Portão divergente**: `/status` aprova sem o portão de `budgetApprove` | `budget.service.ts:6005-6045` × `:3640-3649` | um só caminho de aprovação no serviço |
| R10 | **Envelope vivo sobre `REQUESTED`** (9 no clone) — deriva anterior à correção | F2 | backfill do eixo lê o envelope, não o estado |
| R11 | **Estatística com valor removido** repassado à API sem peneira (`status as any`) → erro de validação | `collection.tsx:362,991`; `invoice-analytics.service.ts:1652` | peneirar no web e na API |
| R12 | **App instalado sem os estados do portal**: orçamentos somem do celular | `budget_list_config.dart:89-91` | janela + 426 (v1 D-17); aceitar em P2 |
| R13 | **Comentário que mente sobre ordem**: `PORTAL_BUDGET_STATUS_OPTIONS` diz "ordem de atenção" e não é | `orcamento-columns.tsx:204-215` | derivar de `QUOTE_STATUSES_IN_ORDER` |
