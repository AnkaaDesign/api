# P00 — Números de produção (23/09/2026)

Medido em **23/09/2026, 15:17 UTC**, no banco `ankaa_production` do servidor (`ssh ankaa`, `psql` com a `DATABASE_URL` de `~/repositories/api/.env`). Produção estava na API `4fed4b13` (deploy de 23/09: N veículos, layout por veículo, lente do faturamento). Última migração aplicada: `20260923120000_order_number_informed_event` (e `…_layout_aprovado_por_veiculo`, mesmo dia).

**Como.** Três lotes de SELECT, cada um dentro de `BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = '60s'; … ROLLBACK;`, antes testados no clone local (`docker exec ankaa-postgres psql`) para não errar em produção. Nenhuma escrita, nenhum restart. Os SQL estão em `docs/implemento/sql/p00-producao-{1,2,3}.sql` (rodar com `psql "$URL" -X -v ON_ERROR_STOP=1 -f -`; cada arquivo abre `BEGIN TRANSACTION READ ONLY` e termina em `ROLLBACK`) — servem de base para o ensaio da R-B. Logs do nginx lidos com `zcat` (usuário no grupo `adm`), sem tocar em configuração.

Coluna **Clone** = banco local (dado real até ~30/06/2026 + seeds de teste), para comparar com o que o plano (Revisão 2) usava.

---

## 1. Tamanho do acervo

| Medida | Produção | Clone |
|---|---:|---:|
| `Task` | **2.311** | 2.253 |
| `Truck` | **635** | 575 |
| `Budget` | **724** | 615 |
| `max(budgetNumber)` | **991** | 631 |
| última `Task.createdAt` | 22/09 20:25 | 21/09 (seed) |
| último `File.createdAt` | 23/09 14:44 | 21/09 (seed) |

## 2. `Layout` (arte + PDF cotado), fan-out e órfãos

| Tipo × status × aerografia | Produção | Clone |
|---|---:|---:|
| imagem APPROVED (tarefa) | 295 | 168 |
| imagem DRAFT (tarefa) | 64 | 72 |
| imagem REPROVED (tarefa) | 32 | 2 |
| PDF APPROVED (tarefa) | 349 | 222 |
| PDF DRAFT (tarefa) | 25 | 14 |
| PDF REPROVED (tarefa) | 17 | 1 |
| EPS (`application/postscript`) APPROVED | 4 | 2 |
| **de aerografia** (imagem APPROVED 10, DRAFT 6; PDF APPROVED 43, DRAFT 14) | **73** (em 46 aerografias) | 0 |
| **Total** | **859** | 481 |

| Ligação à tarefa (`_TaskLayouts`) | Produção | Clone |
|---|---:|---:|
| imagens ligadas / vínculos | 306 / **557** | 196 / 369 |
| PDFs ligados / vínculos | 267 / **351** | 177 / 214 |
| fan-out máximo (tarefas por linha de `Layout`) | **40** (duas linhas: uma imagem REPROVED e uma APPROVED) | 40 |
| linhas com 1 tarefa / 2–5 / 6–10 / >10 | 515 / 44 / 6 / 8 | 333 / 30 / 5 / 5 |
| vínculos em linhas compartilhadas (fan-out > 1) | 393 | 250 |
| **órfãos** (sem tarefa e sem aerografia) | **213** | 108 |

⚠️ **Aerografia não é zero em produção** (D-20 dizia "0 no clone; produção a medir"): 73 linhas de `Layout` com `airbrushingId`. A M3 não pode tocá-las (o `CHECK` de dono único e o `DELETE` de órfãos precisam do filtro `airbrushingId IS NULL`, que o SQL já tem) e o risco 29 (exclusão de aerografia apagando arte de implemento) deixa de ser teórico.

## 3. `Budget.layoutFiles` (arte do orçamento) e o layout por veículo

| Medida | Produção | Clone |
|---|---:|---:|
| arquivos em `File.quoteLayoutId` (imagem / PDF) | **311** (307 / 4) | 137 (133 / 4) |
| orçamentos com layout | **301** | 135 |
| … o **mesmo** `File` da galeria (não é clone) | 90 | 24 |
| … por estado do orçamento: APPROVED / CANCELLED / PENDING | 226 (235 arq.) / 73 (74) / 2 (2) | 96 / 1 / 38 |
| orçamentos com layout **e** imagem APPROVED da galeria fora do layout (M-B) | **179 de 301** | 71 de 134 |
| orçamentos com layout e **sem tarefa** | 17 | 14 arquivos |
| "gêmeo" DRAFT na galeria (homônimo, outro `File.id`) | 7 pares | 15 |
| `Budget.layoutScope` | **SHARED 724, PER_VEHICLE 0** | SHARED 615 |
| `BudgetLayoutTask` (linhas / arquivos / tarefas) | **0 / 0 / 0** | 0 |

**Leitura (DD6).** A obra da outra sessão está em produção desde 23/09 (schema e tela), mas às 15:17 **nenhum** orçamento tinha sido posto em "por veículo". A contingência do plano vale (a M3 passo 5 lê `BudgetLayoutTask` quando `layoutScope = PER_VEHICLE`), só que o número real só se conhece no ensaio da R-B: **medir de novo no P30**.

## 4. Orçamento × assinatura × cobrança

`Budget.status` × último envelope (SQL do `08` §2.13; "com cobrança aprovada" = algum `Billing` com `approvedAt` ou status APPROVED/PARTIAL/OVERDUE/SETTLED):

| `Budget.status` | Último envelope | Produção | com cobrança aprovada | Clone |
|---|---|---:|---:|---:|
| APPROVED | (sem envelope) | **504** | 300 | 427 (158) |
| APPROVED | COMPLETED | **30** | 9 | — |
| APPROVED | EXPIRED | 2 | 1 | 1 |
| APPROVED | INVALIDATED | 0 | — | 1 |
| CANCELLED | (sem envelope) | 179 | 0 | — |
| CANCELLED | CANCELLED | 2 | 0 | — |
| CANCELLED | COMPLETED | 0 | — | 1 |
| PENDING | (sem envelope) | **7** | 0 | 155 |
| PENDING | RUNNING / REFUSED / EXPIRED | 0 | — | 7 / 1 / 1 |
| EXPIRED | REFUSED | 0 | — | 6 |
| REQUESTED | qualquer | 0 (o enum de produção não tem `REQUESTED`) | — | 15 |

Com o envelope **vigente** (RUNNING/COMPLETED primeiro, senão o último — a precedência do §2A.10) a distribuição de produção é a mesma: não há COMPLETED escondido atrás de um envelope mais novo.

- **Não há coleta RUNNING em produção** (0). Os 30 COMPLETED têm todos `layoutFileIds` não vazio; nenhum tem `layoutCoverage` (a chave nasceu hoje). 24 dos 30 ainda estão no formato v1/v2 do snapshot (chave `truck`).
- Envelopes por estado: COMPLETED 30, INVALIDATED 11, CANCELLED 9, EXPIRED 2 (todos com arte). Por mês: jul 6, ago 9, **set 37**.
- Documentos com a seção `LAYOUT`: 52.
- Série congelada × série atual nos veículos de envelopes COMPLETED: 6 veículos, **0 divergências** (a régua G11 estendida parte limpa).
- `BudgetStatus` no enum de produção: `EXPIRED, SIGNED, PENDING, APPROVED, CANCELLED` (5 valores; `REQUESTED`, `IN_NEGOTIATION`, `PRE_APPROVED` só existem na branch).
- 7 orçamentos PENDING: nº 397, 561, 562, 563 (maio/junho), 982 (15/09) e **990/991 (22/09, os dois únicos de 2 veículos em produção — o caso Carlotti)**. Nenhum orçamento de produção tem mais de 2 veículos; 105 não têm tarefa.

**Impacto da DD7 (cobrança só depois de assinado)** — o que o eixo novo diria hoje:

| Grupo | Qtde | `signatureStatus` depois da M3o | Cobrança por aprovar | Efeito da DD7 |
|---|---:|---|---:|---|
| APPROVED sem envelope | 504 | `WAIVED` (legado) | 204 | continuam faturáveis |
| APPROVED + COMPLETED | 30 | `SIGNED` | 21 (Billing PENDING) + 3 PARTIAL + 5 APPROVED + 1 SETTLED | faturáveis |
| APPROVED + EXPIRED | 2 | `EXPIRED` | **1** | **nº 885** (envelope de 03/08 vencido, Billing PENDING) fica **sem poder faturar** até reassinar; nº 741 (Billing PARTIAL desde 19/08) já está faturado. Vão à triagem `LEGACY_APPROVED_UNSIGNED` (plano §4.3 M3o) |

## 5. Tarefas, implementos e série

| Medida | Produção | Clone |
|---|---:|---:|
| tarefas **sem `Truck`** | **1.676**, todas COMPLETED, de 17/07/2023 a 16/01/2026 | 1.678 |
| séries preenchidas / nulas / vazias (`''`) | **2.051 / 260 / 0** | 2.013 / 240 / 0 |
| séries duplicadas (`lower(btrim())`) | **0** | 0 |
| fora de `^[A-Z0-9-]+$` (valor cru, a regex do web **e** da API) | **42** | 42 |
| fora da regex depois de `upper(btrim())` | 36 | 36 |
| maior série | 18 caracteres | 18 |
| tarefas COM `Truck` e série vazia | 149 (CANCELLED 41, COMPLETED 91, PREPARATION 16, IN_PRODUCTION 1) | — |

Forma das séries (heurística): sem `Truck` — numérica 1.179, `NNNNN-N` 54, **placa 199**, **chassi 44**, marcador 28, outra 61, vazia 111; com `Truck` — numérica 477, placa 5, outra 2, `NNNNN-N` 2, vazia 149. Exemplos fora da regex: `"9A9SRCA4051DV8066 "` (espaço), `"CH- 024739"`, `"2/2 BITREM"`, `".1/2"`, `"EVZ-4861 "`, `"TEO-7J59 🚨"` — todos em tarefas COMPLETED.

⚠️ A Revisão 2 dizia "9 séries violam a regex da API e 42 a do web". No código a regex é a **mesma** nas duas pontas (`api/src/schemas/task.ts:2595-2602`, valor cru): são 42 nos dois lados. A conclusão (V15: validar só quando a série muda) fica igual.

## 6. Medidas, projetos e arquivos base

| Medida | Produção | Clone |
|---|---:|---:|
| `ImplementMeasure` total | 1.106 | — |
| medidas **compartilhadas** (mesma linha em > 1 face/implemento) | **11** linhas, **15** implementos, **26** cópias a fazer, até 8 usos numa linha | 11 linhas / 41 implementos (contagem por face) |
| `Task.projectFiles` (`_TASK_PROJECT_FILES`) | **4** vínculos, 4 arquivos, 4 tarefas | 4 |
| PDFs em `baseFiles` — tarefas **vivas** (não COMPLETED) | 106, dos quais **87** com cara de projeto da Furgões (`^PROJETO` ou `^\d{5}.*LAYOUT`), 22 citando a série da própria tarefa | — |
| PDFs em `baseFiles` — tarefas COMPLETED | 247, dos quais 136 com cara de Furgões, 79 citando a série | 152 no total |

A D-11 manda copiar o vínculo **só em tarefas não concluídas**: em produção são **87** PDFs (não os 152 do clone).

## 7. O.S. de ARTE e a liberação para produção

| O.S. `type = ARTWORK` | Produção |
|---|---:|
| COMPLETED | 2.848 |
| PENDING | 471 |
| **WAITING_APPROVE** | **12** (clone: 31) |
| IN_PROGRESS / PAUSED | 3 / 1 |

As 12 em `WAITING_APPROVE`: 6 em tarefas **PREPARATION** e 6 em tarefas **CANCELLED**; 10 têm imagem em DRAFT na galeria, 2 não têm imagem nenhuma, **0** têm imagem aprovada. Com a DD3 (a aprovação no portal conclui também a O.S. de arte em `WAITING_APPROVE`), as 6 de tarefas vivas são as que a migração precisa deixar com arte `PENDING_APPROVAL`; as 6 de tarefas canceladas vão à triagem.

Tarefas vivas × arte na galeria (o universo do portão da DD3 no dia da R-B, se nada mudar):

| Estado da tarefa | Tarefas | com imagem APPROVED | sem imagem nenhuma | orçamento com layout |
|---|---:|---:|---:|---:|
| PREPARATION | 82 | 37 | 15 | 32 |
| WAITING_PRODUCTION | 41 | 38 | 1 | 7 |
| IN_PRODUCTION | 10 | 8 | 2 | 8 |

O.S. de ARTE abertas: PREPARATION 225 PENDING + 6 WAITING_APPROVE + 1 PAUSED; WAITING_PRODUCTION 79 PENDING; em tarefas CANCELLED 164 PENDING + 6 WAITING_APPROVE + 3 IN_PROGRESS (lixo: tarefa cancelada com O.S. aberta).

**O.S. COMERCIAL "Em Negociação" continua viva em produção** (a remoção dela só existe na `feat/portal-do-responsavel`, commit `591a9281`): "Em Negociação" IN_PROGRESS **74**, WAITING_ARTWORK 10, PENDING 7, COMPLETED 472, CANCELLED 2; mais a grafia "Em Negociacao" (COMPLETED 17, IN_PROGRESS 1, PENDING 2) e "NEGOCIACAO" (1). A migração da branch que apaga essas O.S. precisa ser ensaiada com esses números. Não existe O.S. com descrição "Aprovar com o Cliente" em produção pelo filtro `%aprovar%cliente%` usado aqui (no clone havia 7 "Aprovar com O Cliente"; conferir a grafia exata no ensaio).

## 8. Vaga, enums, preferências, histórico

- `Truck.spot` por estado da tarefa: COMPLETED — nulo 341, YARD_WAIT 57, YARD_EXIT 5, vaga 1; PREPARATION — nulo 78, YARD_WAIT 4; WAITING_PRODUCTION — nulo 34, YARD_WAIT 7; IN_PRODUCTION — 6 em vagas de barracão, 4 YARD_WAIT; CANCELLED — nulo 98.
- `category × implementType` mais comuns: TRUCK/REFRIGERATED 124, SEMI_TRAILER/REFRIGERATED 116, BITRUCK/REFRIGERATED 76, THREE_QUARTER/REFRIGERATED 62, RIGID/REFRIGERATED 55; 15 sem categoria, 13 sem tipo, 1 sem nenhum. Todos os valores em uso existem no enum (sem valor cru).
- `Preferences`: `dashboardLayoutWeb` com chaves truck/layout em **4** usuários; `tableConfigsWeb` **7**; `detailConfigsWeb` **8**; `dashboardLayoutMobile` 0.
- `ChangeLog`: `TRUCK` 1.898 linhas, `IMPLEMENT_MEASURE` 1.090 (motivo do V2: não renomear o valor).
- `NotificationConfiguration` com `truck`/`layout`/`serial`: `task.field.layouts`, `task.field.serialNumber`, `task.field.truck.{category,chassisNumber,implementMeasure,implementType,plate,spot}` ligadas; `task.field.truck.{left,right,back}SideMeasureId` desligadas; `truck.movement_request` ligada.
- Papéis dos responsáveis (`Representative.roles`): COMMERCIAL 129, FLEET_MANAGER 99, MARKETING 75, FINANCIAL 72, SELLER 13, PURCHASING 9, REPRESENTATIVE 6, DRIVER 4, COORDINATOR 1. Os papéis que aprovam arte pela DD5 (MARKETING, COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR) somam 224 atribuições (um contato pode ter mais de um papel).

## 9. Clientes da API (logs do nginx)

**Retenção: 15 dias, não 30** (`api.ankaadesign.com.br.access.log` e `.1…14.gz`, de 09/09 a 23/09). O pedido era 30; o que existe é isto.

| Cliente (User-Agent) | Requisições em 15 dias | Observação |
|---|---:|---|
| navegador (web) | 577.412 | — |
| **`Dart/3.12 (dart:io)`** — app Flutter | **40.692** (2–5 mil por dia útil) | **o UA não diz a versão**; um só valor de UA no período |
| **`AnkaaAero/1 CFNetwork/978.0.7 Darwin/18.7.0`** | **345** (quase todo dia útil) | app **nativo iOS 12.5** do iPad da aerografia (`mobile-flutter/AnkaaAero/`, UIKit, instalado por cabo, **sem OTA**) |
| `okhttp/5.3.0` | 2 | favicon (não é app) |
| `Dalvik/2.1.0` | 1 | download de PDF público de assinatura |
| `Expo/…` (RN antigo) | **0** | — |
| `/updates/manifest`, `expo-platform` | **0** | nenhuma requisição de atualização Expo em nenhum vhost |

- O **RN antigo** só aparece no domínio velho `api.ankaa.live`: 7.272 requisições `Expo/1017756 CFNetwork` (iOS), todas de **dez/2025 a 13/01/2026**, sobretudo `GET /messages/unviewed`. O domínio não recebe tráfego desde 13/01/2026. **Conclusão: nenhum aparelho com o RN fala com a API atual.**
- **Versões do app Flutter: não há fonte.** O UA é o do `dart:io` e o app não manda cabeçalho de versão (é o que o P02 corrige). As colunas `appVersion` de `PpeDeliverySignature` e `WarningSignature` estão **vazias** em todo o período. O parque instalado só será conhecido pelo censo `X-App-Version` (G3, P06).
- ⚠️ **Cliente que o plano não conhecia: `AnkaaAero`.** Lê, com o JWT de um usuário da aerografia:
  - `GET /tasks/:id?include={baseFiles, customer, generalPainting{select…}, layouts{include:{file}}, projectFiles, sector, truck{include:{leftSideMeasure{sections}, rightSideMeasure{sections}}}}` (104 vezes);
  - `GET /airbrushings` e `/airbrushings/:id` com `task.include.{customer, sector, truck: true}` (209 vezes); `PUT /airbrushings/:id` (16), `/files/serve|thumbnail`, `/cuts`.
  - Os modelos Swift decodificam `task.truck` (placa, medidas), `task.serialNumber`, `task.layouts` e `task.projectFiles` (`AnkaaAero/AnkaaAero/Models/DomainModels.swift:17-90`, `Networking/APIClient.swift:63-158`).
  - Consequências: (1) entra no **censo e nas fixtures do G4** como terceiro cliente; (2) a janela bilíngue (`truck` → `implement`, `layouts` sintetizado, `serialNumber` espelhado) é o que o mantém vivo depois da R-B; (3) na R-C o 426 por "pedido sem cabeçalho" **derruba o iPad** se o app não for reinstalado com `X-App-Version` — ele não tem OTA; (4) na R-D ele precisa já falar `implement`. O plano (Revisão 3) o acrescenta no §5.4, §6.7, §9 (P01, P24) e no risco 48.

## 10. O que mudou no plano por causa destes números

Registrado na Revisão 3 do `PLANO.md`: §0, §2.2 (D-01, D-07, D-11, D-13, D-15, D-16, D-20), §2A.10, §4.4 (coluna "Produção"), §4.3 M3o (triagem `LEGACY_APPROVED_UNSIGNED`), §5.4 e §6.7 (AnkaaAero), §9 (P00 feito; P01/P24), §11 (riscos 18, 29, 48, 49) e §12 (perguntas 25 e 26).
