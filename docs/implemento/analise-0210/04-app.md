# 04 — App Flutter + AnkaaAero contra a API nova (análise de 02/10/2026)

Branch do app: `origin/feat/implemento` (tip `8f774b0`), no worktree `mobile-wt-implemento` (branch local
`wt/implemento`). São **20 commits** sobre a `main` (merge-base `114f55f`, 24/09): 131 arquivos, +3.386 / −1.383.
A versão no `pubspec.yaml` da branch é **`1.4.2+25`**. A `main` publicada já tem as 12 funções do responsável
(`c0b4d53`), e a `main` local tem o bump para **`1.4.3+26`** (`c8afc71`), ainda sem push. Esse bump é o app que
está instalado nos celulares.

Base desta análise: relatórios `01-api-dominio.md` e `02-main-e-merge.md`, `PLANO.md` §5.4, §6.7 (P02/P24) e
P31, e varredura do código do worktree. Só leitura: nada foi compilado nem rodado.

---

## 0. Em uma frase

A branch do app fez o **P02 inteiro**:
- cabeçalho de versão e tela de 426;
- leitura de `implement` e da série;
- o rename `truck → implement`;
- a série só no implemento;
- o AnkaaAero lendo `implement`.

Ela **não começou o P24**: o app continua com o modelo de orçamento e de arte de **antes** do P12 e do P14. Por
isso, contra a API desta branch, quebram:
- a arte (todos os formulários de tarefa, o orçamento e o detalhe da tarefa);
- o detalhe da tarefa inteiro, porque o include `layouts` responde 400;
- o AnkaaAero, que também pede `layouts` da tarefa.

E o app ainda não sabe o que são `REQUESTED`, `IN_NEGOTIATION`, o eixo da assinatura e a aprovação do valor.

---

## 1. O que os 20 commits já fizeram

| Commit | O que faz | Pacote |
|---|---|---|
| `451fb36` | `X-App-Version` / `X-App-Patch` / `X-App-Platform` em todo pedido (`lib/core/network/app_version_interceptor.dart`, 206 l.); o 426 ganha sinal próprio | P02 |
| `3757d1b` | Depois de um 426, o app para e o "Agora não" do OTA deixa de valer (`lib/features/updates/upgrade_required_screen.dart`, 250 l.; `ota_update_service.dart`) | P02 |
| `0c74b91` | Leitura tolerante: `implement ?? truck`, `type ?? implementType` e a série nos dois formatos | P02 |
| `27a838d` | O detalhe do orçamento para de pedir `customerConfigs.include.responsible` (a relação já não existe) | P02 |
| `7a03e4e` | O tipo do implemento nasce vazio, sem o padrão "Refrigerado" (D-25) | P02 |
| `3232757` | O patch do P02 sai da tag da release, e não da `main` | P02 |
| `895e536` | Rótulos de tipo, categoria e status de tarefa vêm do contrato gerado (`lib/generated/contracts/labels.dart`, D-18/G5) | P02 |
| `32b760d` | Catraca do resíduo (`scripts/guard-residual.sh`) e `scripts/pre-deploy.sh` próprio | R-B-10/F11 |
| `e08f694` | Criar tarefa sem nenhum dado do caminhão volta a criar o implemento vazio (F4) | P02 |
| `523769a` | Um espelho `implement` mais raso que `truck` não apaga as medidas (F9) | P02 |
| `7693e00` | Merge da `origin/main` (1.4.2+25) | — |
| `7d9c062` | Contrato gerado em dia | — |
| `856c2a3` | **Rename completo `truck → implement`** (DD13: sem janela bilíngue) | P24 (parte) |
| `901681e` | A catraca do resíduo chega a zero | — |
| `1391b83`, `acac622`, `ef5dc44` | **AnkaaAero:** lê `task.implement`, manda versão e plataforma em todo pedido e lê a série do implemento | P24 (Swift, parte) |
| `2a5cb9a` | A série é do implemento: o app lê e grava só `implement.serialNumber` (DD14) | P24 (parte) |
| `12d46c6`, `8f774b0` | Textos dizem "implemento"; "veículo" fica só onde é o físico; o rótulo do histórico do recorte deixa de falar da série na tarefa | — |

Testes novos:
- `test/task_json_contract_test.dart` (324 l.);
- `test/core/app_version_gate_test.dart` (266 l.);
- `test/generated/contract_labels_exhaustive_test.dart` (120 l.).

**Conferido na varredura:** não sobrou nenhum `'truck'`, `/trucks` ou `truckId` em `lib/` nem no `AnkaaAero/`. As
rotas de garagem já usam `/implements/…` (`garage_edit_controller.dart`), e as regras de Atenção usam `'/implements'`
(`attention_types.dart`).

---

## 2. Inventário de quebras contra a API nova

Legenda dos sintomas:
- **400:** a API recusa (zod estrito ou G1).
- **silêncio:** a resposta vem, mas a tela mostra dado errado ou vazio.
- **desatualizado:** a tela funciona, mas mente sobre o estado.

### 2.1 Arte na TAREFA (P12.1: a arte saiu da tarefa e foi para o implemento)

| Arquivo:linha | Tela | Envia hoje | Sintoma | Conserto |
|---|---|---|---|---|
| `lib/features/production/task_detail_config.dart:126-128` | **Detalhe da tarefa** (todos os setores) | `include.layouts{file}` | **400 no detalhe inteiro**: a tela não abre | pedir `implement.include.layouts{file}`; a seção `_layoutsSection` (`:1007-1016`) passa a ler `task.implement.layouts`, com estado |
| `lib/features/production/task_detail_widgets.dart:33-160` (`layoutGalleryRows`, `LayoutGallery`) | Detalhe e ações | lê `task.layouts` achatado | silêncio: a galeria fica vazia | duas galerias (D-08): **Arte** do implemento, com o estado de cada arte, e **Projeto da tarefa** (`projectFiles`) |
| `lib/features/production/task_row_actions.dart:365-396` (`include.layouts`, "Adicionar Layout Referência", `fileContext: 'tasksLayouts'` em `:389`) | Ação de linha da lista de tarefas | `include.layouts` + `PUT /tasks {layoutIds, layoutStatuses}` | **400** | `POST /implements/:id/layouts` (multipart) com o contexto `implementLayouts`, depois `…/send` |
| `lib/features/production/task_form_screen.dart:187,239-300,351,443-448,690,909` | **Criar tarefa** | `layouts[]` → `layoutIds` + `layoutStatuses` | **400 ao salvar** quando há arte anexada (sem arte, passa) | tirar a arte do corpo da tarefa; depois do `POST /tasks`, subir cada imagem em `/implements/:implementId/layouts` |
| `lib/features/production/task_edit_screen.dart:176,233-243,356,445-499,534-616,712-724,1084,1250` | **Editar tarefa** | `include.layouts` + o conjunto COMPLETO `layoutIds/layoutStatuses` a cada save | **400 ao abrir** (pelo include) e **400 ao salvar** | o card de arte vira um componente do implemento, com os atos (send, aprovar em nome com nota, reprovar, nova versão, apagar o DRAFT) |
| `lib/features/production/layout_attach_sheet.dart:33` e `task_form_fields.dart:649-815,696` (`TaskLayoutField`, `fileContext = 'tasksLayouts'`) | Folha "anexar layout" | contexto `tasksLayouts` | **400** (o contexto não existe mais no contrato: `contracts/enums.json → fileContexts` só tem `implementLayouts`, `taskProjectFiles` e `implementProjectFiles`) | reaproveitar a folha com dois destinos, `implementLayouts` e `taskProjectFiles`; um só mapa de rótulos (hoje `kLayoutStatusLabels` está duplicado em `task_enums.dart:54`) |
| `lib/features/tutorial/tutorial_fixtures.dart:243`, `scenes/scene_task_detail.dart:606` | Tutorial | fixture com `layouts` | desatualizado | fixture com `implement.layouts` |

### 2.2 Orçamento: arte, status e atos (P12.1 + P14)

| Arquivo:linha | Tela | Hoje | Sintoma | Conserto |
|---|---|---|---|---|
| `lib/features/financial/budget.dart:1131-1139` (`kBudgetDetailInclude`: `tasks.include.layouts`, `layoutFiles: true`) | **Detalhe do orçamento** | include `layouts` e `layoutFiles` | **400: o detalhe não abre** | tirar os dois; pedir `tasks.include.implement.include.layouts{file}` |
| `budget.dart:217` (`BudgetTaskLite.layouts`), `:1088-1092` (`layoutFiles`) | Detalhe | parse | silêncio | apagar; ler `implement.layouts` |
| `lib/features/financial/budget/budget_form_screen.dart:508,718,912` (include e parse de `layouts`), `:2060,2138-2139` (`layoutIds/layoutStatuses` no `POST /tasks/batch-with-quote`), `:2173` (`layoutFileIds`), `:4232-4233` (`layoutFileIds` / `layouts` do orçamento), `:4393` (`fileContext: 'quote-layouts'`), `:3037` (card "Layout Referência"), `:6394` (resumo "Layout") | **Wizard do orçamento** | arte no orçamento e na tarefa | **400 ao abrir para editar e ao salvar** | apagar o fluxo de layout aprovado e o "Layout Referência" do wizard (~400 linhas, PLANO §6.7). A arte passa a ser um passo/seção **por veículo**, com o estado vindo do implemento |
| `lib/features/financial/budget/budget_vehicles.dart:149,181,385-386` | Veículos do wizard | `layouts`, `layoutIds`, `layoutStatuses` | **400** | idem |
| `lib/features/financial/budget_sections.dart:356-357` (seção `layouts`, "LAYOUT APROVADO"), `:2495` (`updateFields({'layoutFileIds'})`) | Detalhe do orçamento | seletor de layout aprovado | **400** ao trocar | a seção vira **"ARTE POR VEÍCULO"**: o estado de cada implemento e os atos do comercial; subir a versão da chave de layout das seções (`:142`) |
| `lib/features/financial/financial_enums.dart:11-17,43-51,57-61` | Badge e filtro de status | 5 estados: falta `REQUESTED` e `IN_NEGOTIATION`; `SIGNED` aparece como "Assinado" | **desatualizado**: os orçamentos do portal ficam sem rótulo nem cor | derivar do contrato (`BUDGET_STATUS` e os rótulos da NOMENCLATURA): Requisição, Pendente, Aguardando aprovação do cliente, Aprovado, Aguardando Reanálise, Cancelado; `SIGNED` = "Assinado (legado)" |
| `lib/features/financial/budget_list_config.dart:89-91` (`where.status.in = [EXPIRED, SIGNED, PENDING, APPROVED]`) | **Lista de orçamentos** | sem `REQUESTED`/`IN_NEGOTIATION` | **silêncio**: a requisição do portal e o orçamento que está com o cliente **somem do celular** | derivar a lista da ordem do contrato (`orcamento.ordem`), menos `CANCELLED` |
| `lib/features/financial/budget_permissions.dart:104-125` (`kBudgetValidTransitions`) | Controle de status | o grafo de 5 estados escrito à mão (`SIGNED → APPROVED`…) | **desatualizado**: oferece "Aprovar" a partir de `SIGNED`, sem nota; não conhece `IN_NEGOTIATION` | ler `orcamento.transicoesManuais` do contrato gerado (`--dart`) |
| `lib/features/financial/budget_status_control.dart:66,451-457,473` (`budgetApprove`, `setStatus` salto a salto); `budget_sections.dart:2679`; `budget.dart:1306-1307` (`/budget-approve`), `:1391-1393` (`/status`) | Aprovar ou reprovar o orçamento | `PUT /budget-approve` **sem nota** e `PUT /status` genérico | funciona, mas grava `LEGACY_APP` com nota automática (D-36). Depois da R-C (P31) deixa de ser aceito | os **atos**: `PUT /budgets/:id/value-approval {note}` (nota obrigatória), `DELETE …/value-approval {reason}`, `PUT …/send-to-customer`, `PUT …/withdraw-from-customer` |
| `lib/features/financial/budget_sections.dart:164` (`q.status == 'PENDING' \|\| 'SIGNED'`) e `lib/core/attention/attention_rules.dart:52` (`_budgetSigned = 'SIGNED'`) | Seção de assinatura; regra de Atenção | trata `SIGNED` como "o cliente assinou" | **silêncio**: a API nunca mais escreve `SIGNED` em `Budget.status`; o estado mora em `signatureStatus` | ler `budget.signatureStatus` (`AWAITING_ANKAA` = falta a Ankaa contra-assinar) |
| `lib/features/signature/envelope_models.dart:696-788` (`blockers: List<String>`) | Diálogo de envio para assinatura | só lê `blockers` (string) | funciona (a API preserva `blockers: string[]`), mas a tela não mostra **qual portão** falta | ler `preflight.gates` (E1–E6) e montar o checklist "Para emitir falta…" |
| `budget_form_screen.dart:270-273,464,627` (`orderNumber` por veículo, comentário "Task.customerOrderNumber") | Passo Tarefa | um nº do pedido por veículo | **a conferir depois do merge da `main`**: a `main` (`b1716269`) passou a "um pedido por orçamento, com herança", e o 02 propõe a DD12.1 | seguir a resolução do 02 §2.3; se o campo virar do orçamento, ele sai do passo do veículo |

### 2.3 Medidas, frente e porta traseira (P11b/M2)

| Arquivo:linha | Hoje | Sintoma | Conserto |
|---|---|---|---|
| `lib/data/models/task.dart:208-210,258` | **parse** de `frontSideMeasure` e `rearDoor*` já existe (P02) | ok na leitura | — |
| `lib/features/production/implement_measure_editor.dart` (0 ocorrências de `front`/"Frente") e `implement_measure_preview.dart` (3 faces, `:434-523`) | o editor só tem Esquerda, Direita e Traseira | **desatualizado**: não dá para medir a frente nem a porta, e a API aceita as duas | aba **Frente**; na Traseira: Abertura (Bipartida/Tripartida, `REAR_DOOR_LEAVES`), Varões (2/3/4) e Portinholas (0..6) |
| `lib/features/files/layout/layout_dimensions.dart:22-29` (`enum PanelSide { motorista, sapo, traseira, indefinida }`; `_ => indefinida`) | o cotador chama a FRENTE de "indefinida" | silêncio (já não confunde com Motorista, mas não rotula) | `frente` no enum e no `switch`, como no web (P20) |

### 2.4 Contrato gerado (`--dart`)

`lib/generated/contracts/labels.dart` tem só `ImplementCategory`, `ImplementType` e `TaskStatus` (`:11-188`). Faltam
`BUDGET_STATUS`, `BUDGET_SIGNATURE_STATUS`, `BUDGET_VALUE_APPROVAL_SOURCE`, `LAYOUT_STATUS`, `LAYOUT_APPROVAL_SOURCE`,
`REAR_DOOR_LEAVES`, `RESPONSIBLE_ROLE` (12 papéis depois do merge da `main`) e `orcamento.{transicoesManuais, ordem}`.
Todos existem em `api/contracts/enums.json`.

**Conserto:** estender o `--dart` do `scripts/export-contracts.ts` com esses enums e com as transições, e regerar com
o caminho certo: `--dart ../mobile-wt-implemento/lib/generated/contracts/labels.dart`. O padrão aponta para
`../mobile-flutter`, que não existe neste Mac (01 §4.4). O teste exaustivo (`contract_labels_exhaustive_test.dart`)
passa a cobrir os enums novos.

### 2.5 AnkaaAero (Swift, iPad iOS 12.5, sem OTA)

| Arquivo:linha | Hoje | Sintoma | Conserto |
|---|---|---|---|
| `AnkaaAero/AnkaaAero/Networking/APIClient.swift:138` (`task(id:)`: `include["layouts"] = ["include": ["file": true]]`) | detalhe da tarefa no iPad | **400: o detalhe da tarefa não abre no iPad** | `include["implement"]["include"]["layouts"] = ["include": ["file": true]]` (a PRODUÇÃO recebe só `APPROVED`, pelo filtro por papel da API) |
| `AnkaaAero/AnkaaAero/Models/DomainModels.swift:78,103-104` (`AnkaaTask.layouts`, `layoutFiles`) | seção LAYOUTS | silêncio depois do conserto acima | ler `implement.layouts[].file`, mais os PDFs de `projectFiles` |
| `APIClient.swift:169,183` (`airbrushing.include.layouts`) | aerografia | **ok**: `Layout.airbrushingId` continua (`api/src/schemas/airbrushing.ts:151,921`) | — |
| `APIClient.swift:50-51` | manda `X-App-Version` / `X-App-Platform` | ok | a build nova precisa ser **instalada por cabo** antes do 426 ligar (PLANO §6.7) |

### 2.6 O que NÃO quebra (conferido)

- `'PRE_APPROVED'` e `preApproved` em `lib/`: só existem em `airbrushing_form_screen.dart:131-813`, e são da
  **cotação da aerografia** (outro domínio, que continua válido).
- `airbrushing_form_screen.dart:264-525` com `layoutIds`: é a arte da aerografia, que a API ainda aceita.
- `hasLayouts`: não há em `lib/` (o painel do app usa outro caminho; os presets "Sem Layouts"/"Com Layouts" do
  PLANO §6.7 não existem mais em `dashboard/`).
- `/trucks` e `'truck'`: zerados.
- `budget-approve` e `PUT /status`: continuam aceitos até a R-C (LEGACY_APP).

---

## 3. O que falta construir para a paridade com a web nova

1. **Os quatro eixos do orçamento** no detalhe e na lista, cada um com a próxima ação:
   - **valor:** `status` + `valueApproval` (quem, quando, origem, nota);
   - **arte por veículo:** o estado de cada `implement.layouts`;
   - **assinatura:** `signatureStatus` (9 estados, incluindo "Assinada fora do sistema" e "Dispensada (legado)");
   - **cobrança:** `billable` e o selo no faturamento. O `billing_approval_sheet.dart` (839 l.) precisa do bloqueio
     da DD7, "A cobrança só pode ser aprovada depois da assinatura".
2. **Atos novos**, sempre pelos atos e nunca pelo `PUT /status`:
   - "Enviar para aprovação do cliente" / "Retirar do cliente";
   - "Aprovar valor em nome do cliente" (nota obrigatória) / "Reprovar valor" (motivo);
   - "Assinado fora do sistema": multipart com **um** anexo (foto ou PDF) e nota.

   ⚠️ Câmera e anexo já existem no app; o risco é o **glifo de ícone novo**, que obriga release nativa (PLANO §6.7).
3. **Arte do implemento:**
   - galeria por veículo com o estado de cada arte;
   - subir (`POST /implements/:id/layouts`) e enviar ao cliente (`…/send`);
   - aprovar em nome (`…/approve-on-behalf {note}`), reprovar (`…/reprove`), nova versão (`…/new-version`) e apagar
     o DRAFT;
   - o lote (`POST /implements/layouts/bulk`) para o orçamento de N veículos com a mesma arte.

   Papéis: editar = DESIGNER, COMMERCIAL e ADMIN; decidir = COMMERCIAL e ADMIN; ler = o resto, só `APPROVED`.
   `canSetLayoutStatus` (`task_permissions.dart`) vira "Aprovar em nome do cliente".
4. **Projeto do implemento:**
   - `PUT /implements/:id/project-files` (contexto `implementProjectFiles`);
   - separado do **projeto da tarefa** (`projectFiles`);
   - alargar `canViewProjectFiles` (`task_permissions.dart:344`, hoje = `canViewBaseFiles`) para a PRODUÇÃO e o
     GERENTE DE PRODUÇÃO (PLANO V3).
5. **Checklist "Para emitir falta…":**
   - `GET /budgets/:id → emission{ready, blockers}` e `preflight.gates`;
   - o botão "Enviar para assinatura" desabilitado com o motivo, em vez de o bloqueio aparecer só dentro do diálogo.
6. **Frente e porta traseira:** editor e preview (§2.3) e `PanelSide.frente`.
7. **Portão da produção (DD10):**
   - concluir a O.S. de ARTE de trabalho novo sem arte aprovada **não** libera a tarefa;
   - o "Disponibilizar para produção" responde 400.

   O app precisa mostrar o porquê (`task_permissions.dart:255-280`, transições da O.S. de ARTE) e oferecer "Aprovar
   arte em nome do cliente".
8. **Portal do responsável no app interno:**
   - mostrar que o orçamento nasceu de **requisição** (`BudgetRequest`: briefing, logomarca, arquivos-base,
     requisitante);
   - tratar os avisos novos (`budget.portal_requested`, `budget.portal_pre_approved` [nome legado],
     `budget.portal_refused`, `layout.portal_pending_approval`, `task_quote.value_approved`,
     `task_quote.ready_for_signature`).

   O roteador (`lib/core/router/notification_router.dart`) navega por `actionUrl`/`relatedEntityType`, então basta
   a API mandar a URL certa. Falta conferir se as URLs desses avisos existem no app.
9. **426 de versão mínima (P31), lado do app:** **feito** na branch (interceptor, tela bloqueante e fim do "Agora
   não"). Falta o lado da **API**: não há 426 nem `MIN_APP_VERSION` em `src/`. Só existe o censo de cabeçalhos
   (`src/modules/common/census/census-shape.ts:286`).

---

## 4. Mapa atual do formulário e do detalhe do orçamento no app

### 4.1 Arquivos (linhas)

| Arquivo | Linhas | Papel |
|---|---|---|
| `lib/features/financial/budget/budget_form_screen.dart` | **7.078** | wizard de criar e editar (5 passos) |
| `lib/features/financial/budget_sections.dart` | **3.841** | seções do detalhe (VALORES … ASSINATURA), parcelas, NFS-e, liquidar, reprovar |
| `lib/features/financial/budget.dart` | 1.500 | modelo, includes e repositório |
| `lib/features/signature/envelope_section.dart` | 1.269 | assinatura no detalhe |
| `lib/features/financial/billing_approval_sheet.dart` | 839 | aprovar cobrança |
| `budget_list_config.dart` / `budget_merge.dart` / `budget_status_control.dart` / `budget/budget_vehicles.dart` | 579 / 492 / 478 / 477 | lista, fusão, controle de status, veículos do wizard |

### 4.2 Wizard (`budget_form_screen.dart:2737-2783`)

1. **Tarefa / Veículos** (`_stepTarefa`, `:2836-3976`, ~1.140 linhas). Contém:
   - Informações Básicas: Logomarca, Razão Social, Categoria e Tipo do implemento;
   - Tintas: Pintura Geral;
   - Arquivos Base;
   - **Layout Referência**, por veículo;
   - Números de Série, Nº do Pedido, Placas, Chassi, Plaqueta;
   - Previsão de Liberação, Prazo de Entrega e Detalhes;
   - **AEROGRAFIAS** (status, início e preço).
2. **Informações** (`_stepInfo`, `:3977-4771`): Faturar Para, Prazos e Configurações (Validade da Proposta, Prazo de
   Entrega).
3. **Serviços** (`_stepServices`, `:4772-5351`): serviços e "Cliente (faturar para)" por linha.
4. **Cliente N** (`_stepCustomer`, `:5352-5820`): um passo **por pagador** (condições e parcelas).
5. **Resumo** (`_stepReview`, `:5821-`): Serviços, Faturamento e Pagamento, Resumo da Tarefa, da Cobrança e dos
   Veículos, **Layout**, Prazo de Entrega, Garantia, Recibo de Quitação, Reprovar orçamento e Situação.

### 4.3 Detalhe (`budget_sections.dart:241-364`)

VALORES · INFORMAÇÕES · VEÍCULOS · SERVIÇOS · CLIENTES E CONDIÇÕES · PARCELAS · NFS-e · **LAYOUT APROVADO** ·
ASSINATURA DO CLIENTE.

### 4.4 Problemas

- **O passo 1 tem ~1.140 linhas e mistura quatro coisas:** a identidade do cliente (logomarca, razão social), a
  identificação do veículo (série, placa, chassi, plaqueta), a produção (tintas, aerografias, previsão de
  liberação) e a arte ("Layout Referência"), que agora pertence ao implemento e tem máquina própria.
- **"Prazo de Entrega" aparece em três lugares:** no passo Tarefa, no passo Informações e no Resumo
  (`:3152/3264`, `:4079` e `:6537`). Também está no detalhe.
- **Os responsáveis (contatos) não aparecem no wizard do orçamento**: 0 ocorrências em `budget_sections.dart`; o
  form só os toca indiretamente (36 menções a `responsible` no form, todas no fluxo da tarefa). O portão E6
  ("ao menos uma tarefa com contato") e o portal dependem deles.
- **O Nº do Pedido está no passo do veículo**, e a `main` mudou para um pedido por orçamento (02 §2.3).
- **Não existe lugar para os eixos novos:** a aprovação do valor, o estado da arte por veículo, o selo da
  assinatura e o checklist de emissão. A "Situação" do Resumo e o `budget_status_control` só conhecem o grafo
  antigo.
- **O arquivo único de 7 mil linhas** torna inviável espelhar a web por partes. Os passos precisam virar arquivos
  próprios, com `budget_vehicles.dart` como precedente.

### 4.5 Como espelhar a arquitetura proposta para a web

O pedido do dono: "na primeira página, Tarefa: logomarca, Razão Social, detalhes, responsáveis, arquivos base,
layout, aerografias". O app segue os mesmos passos da web, um arquivo por passo:

| Passo (app) | Conteúdo | De onde sai hoje |
|---|---|---|
| **1. Tarefa** (`budget_step_task.dart`) | logomarca, razão social, detalhes; **responsáveis** (contatos por veículo, com funções); arquivos-base; tintas; **aerografias** | `_stepTarefa` sem o bloco de layout e sem a identificação; responsáveis novos |
| **2. Veículos** (`budget_step_vehicles.dart`) | por implemento: série, placa, chassi, plaqueta, tipo e categoria, medidas (com frente e porta), previsão e prazo | `_stepTarefa` + `budget_vehicles.dart` |
| **3. Arte por veículo** (`budget_step_artwork.dart`) | o estado de cada arte do implemento, subir/enviar/aprovar em nome/reprovar/nova versão, lote "mesma arte para todos" | substitui "Layout Referência" e "Layout Aprovado" |
| **4. Serviços e valor** | serviços, preço por veículo, validade; atos do valor (enviar ao cliente, aprovar em nome) | `_stepServices` + parte de `_stepInfo` |
| **5. Pagamento / Faturar para** | pagadores, condições e parcelas; o nº do pedido do orçamento (DD12.1) | `_stepInfo` + `_stepCustomer` |
| **6. Resumo e emissão** | os quatro eixos com a próxima ação, checklist "Para emitir falta…" e o botão "Enviar para assinatura" | `_stepReview` + `envelope_section` |

No **detalhe**, as seções seguem a mesma ordem: Tarefa → Veículos → Arte por veículo → Serviços/Valor →
Pagamento/Parcelas/NFS-e → Assinatura. O cabeçalho mostra os quatro selos (valor, arte x/N, assinatura, cobrança).

---

## 5. Ordem de execução (P24) e o que bloqueia no dia do deploy

### 5.1 Bloqueante para o app instalado (`1.4.3+26`, da `main`)

O app instalado **não manda `X-App-Version`**: o interceptor só existe na branch. Ele usa `truck` (23 arquivos) e
`layouts` (54 ocorrências) da `main`. Com a DD13 (sem janela bilíngue), no dia em que a API desta branch subir:
- o detalhe da tarefa, as Garagens, as medidas, o orçamento e a arte respondem **400**;
- a lista de orçamentos esconde as requisições.

E como o 426 (P31) **não existe na API**, o usuário verá erros soltos, e não a tela "Atualize o app".

**Condições para o deploy:**
1. **P31 na API:** 426 para pedido sem `X-App-Version` e para versão menor que `MIN_APP_VERSION`.
2. **Build nova do app (≥ `1.4.4+27`)** com o P24, publicada **antes**, pela loja ou por `/install`. Se algum glifo
   de ícone novo entrar (a tela de upgrade, os atos novos), o Shorebird recusa o patch e a entrega precisa ser
   release nativa.
3. **AnkaaAero** com build nova instalada **por cabo** nos iPads antes do deploy (§2.5).

### 5.2 Ordem sugerida

Tamanho: P = até 1 dia, M = 1–3 dias, G = 3–5 dias.

| # | Item | Tamanho | Destrava |
|---|---|---|---|
| 0 | Merge da `main` do app na `wt/implemento` (limpo, 02 §5) e versão `1.4.4+27`; regerar `labels.dart` com os enums de §2.4 | P | base |
| 1 | **Destravar o 400 do detalhe da tarefa** (`task_detail_config.dart:126`) e do **detalhe do orçamento** (`budget.dart:1131-1139`), lendo `implement.layouts` | P | o app abre de novo |
| 2 | **AnkaaAero:** include `implement.layouts` (`APIClient.swift:138`) e decode (`DomainModels.swift:78,103`) | P | iPad da aerografia |
| 3 | Status do orçamento pelo contrato: rótulos, lista (`budget_list_config.dart:89`), transições (`budget_permissions.dart:104`); `SIGNED` → `signatureStatus` (`budget_sections.dart:164`, `attention_rules.dart:52`) | M | lista e Atenção corretas |
| 4 | **Arte do implemento:** componente único (galeria com estado e atos), usado no detalhe da tarefa, no editar e criar tarefa, na ação de linha e no orçamento; arte fora do save da tarefa; `layout_attach_sheet` com dois destinos | **G** | DD3/DD9/DD10 (produção destravada pela arte) |
| 5 | Atos do valor e da assinatura (send/withdraw, value-approval, offline-signature); fim do `budgetApprove` sem nota | M | Modelo C |
| 6 | Checklist de emissão (`gates`) e bloqueio da cobrança (DD7) no `billing_approval_sheet` | M | emissão e faturamento |
| 7 | Reestruturar o wizard em 6 arquivos (§4.5), apagando o fluxo de layout aprovado (~400 l.) | **G** | o redesenho pedido pelo dono |
| 8 | Frente e porta traseira no editor/preview; `PanelSide.frente` | M | M2 |
| 9 | Projeto do implemento e da tarefa; `canViewProjectFiles` alargado | P | produção vê o PDF |
| 10 | Testes: contrato JSON com `implement.layouts`, `signatureStatus` e `emission`; exaustividade dos enums novos; `flutter analyze` só nos arquivos tocados (nunca `dart format` global) | M | régua |

Os itens 1–3 tiram o app da quebra. O 4 é o maior e é o que a produção sente. Os itens 5–7 são o redesenho do
orçamento, que deve ser feito **junto com o P22 da web**, com os mesmos rótulos e a mesma ordem de passos. O item 0
precisa vir antes de tudo.
