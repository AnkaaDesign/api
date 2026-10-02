# 05 — Decisões de 02/10 e o plano da Fase C (web + app juntos)

Base: relatórios `01-api-dominio.md`, `02-main-e-merge.md`, `03-web.md`, `04-app.md`.

## Estado de partida (02/10)

| Repo | Pasta | Branch local | O que entrou hoje |
|---|---|---|---|
| api | `api-wt-implemento` | `wt/truck-implemento` (= `origin/feat/portal-do-responsavel`) | merge da `main` de 30/09 (DD12.1), funções PCP/Expedição/Logística, contrato exportado |
| web | `web-wt-implemento` | `wt/truck-implemento` | merge da `main` de 30/09, contrato regerado |
| app | `mobile-wt-implemento` | `wt/implemento` (= `origin/feat/implemento`) | merge da `main` local (1.4.3+26) |

Banco: `ankaa_implemento` (clone do `ankaa_dev` com todas as migrations da branch). `.env` da api **blindado**
(push, WhatsApp, e-mail, Sicredi, Elotech e Secullum desligados). API na 3030, web na 5173.

## Decisões do dono (02/10)

1. **Orçamento = assistente reordenado** (alternativa B do relatório 03):
   **① Tarefa → ② Arte → ③ Valor → ④ Cobrança → ⑤ Revisão & Emissão**, seções ABERTAS (sem acordeão de item
   único), veículos em cartões, e a **faixa dos 4 eixos** (Valor · Arte k/N · Assinatura · Cobrança + "Para emitir
   falta…") fixa no topo de todos os passos, com os atos.
   - ① Tarefa: identificação (logomarca, "Cliente (dono do veículo) — Razão Social", detalhes), veículos
     (cartões), responsáveis, arquivos base, projeto da tarefa, aerografias, tintas.
   - ② Arte: um `ImplementArtPanel` por veículo, com estado e ações.
   - ③ Valor: serviços e preço por veículo, desconto, validade, garantia, prazo, cartão "Aprovação do valor".
   - ④ Cobrança: "Faturar para" + pagadores/lotes.
   - ⑤ Revisão & Emissão: checklist `emission.blockers`, prévia, assinatura eletrônica, "Assinado fora do sistema".
   - Atos (enviar/retirar do cliente, aprovar/revogar valor, assinatura fora do sistema, decisões de arte) são
     BOTÕES que chamam a rota na hora; o Salvar grava só dados. O app espelha a mesma ordem.
2. **PCP = Gestor de Frota; Expedição e Logística = Motorista** no portal (api feito; web: espelhar em
   `PORTAL_ROLE_CAPABILITIES`/`PORTAL_ROLE_SECTIONS`, tipados como `Record<RESPONSIBLE_ROLE, …>`).
3. **Web e app juntos**, no máximo dois agentes por vez, um por repo.

## Decisões do dono — 2ª rodada (02/10, 08h)

Substituem a ordem do assistente da decisão 1 (a faixa dos 4 eixos e "ato ≠ formulário" continuam).

4. **Assistente do orçamento: ① Tarefa → ② Veículos → ③ Serviços → ④ Faturamento → ⑤ Resumo.**
   - ① **Tarefa:** logomarca, Razão Social (cliente dono do veículo), detalhes, prazo de entrega, validade da
     proposta, período de garantia, tarefas simultâneas, responsáveis, tintas, arquivos base, **layout** (na
     criação com N veículos: UMA imagem que vale para todos), aerografia.
   - ② **Veículos:** um cartão por veículo — série, placa, chassi, nº do pedido, previsão, categoria, tipo,
     medidas do implemento no desenho estilizado do formulário da tarefa, e a **arte do veículo** (herdada da
     imagem comum; editável veículo a veículo).
   - ③ **Serviços:** como hoje.
   - ④ **Faturamento:** os pagadores. Cada um escolhido num **combobox de cliente** (no lugar do CNPJ digitado
     livre), que aceita **criar** cliente; botão **"+ Adicionar"** abaixo do último faturamento. Os dados do
     cliente (documento, situação, IE/IM, nomes, endereço) e os de faturamento/pagamento (Gerar NF, Gerar Boleto,
     condição, total) ficam no mesmo bloco. ⛔ **Proteção:** os campos pertencem SEMPRE ao cliente selecionado —
     trocar o cliente recarrega tudo do cadastro dele (nada do anterior sobra), a edição grava no id
     selecionado e diz "isto altera o cadastro de X", e criar nunca sobrescreve um cadastro existente (CNPJ já
     cadastrado → seleciona o existente).
   - ⑤ **Resumo:** revisão, checklist "Para emitir falta…", atos e assinatura.
5. **Arte: várias por orçamento.** Quem carrega a arte é a tarefa/implemento (modelo da API); o orçamento só a
   usa no documento. Na criação com vários veículos, sobe-se uma imagem para todos e depois ajusta-se veículo a
   veículo. ⛔ **O documento assinado tem de dizer qual arte é de qual veículo** (série/placa junto de cada
   imagem; artes iguais agrupadas "Veículos 39088, 39089") para ninguém pintar o layout de um no outro.
6. **Faturamento (página) repensado** no mesmo espírito do assistente.
7. **Portal do responsável totalmente responsivo**, e **o celular não é mais mandado para `/install`** ao navegar
   (feito na web: `5c725a73`; `/install` continua, por link).

### Pacotes ajustados
- **A1 (api) — o documento com a arte por veículo** (decisão 5) e o que o assistente novo precisar da API
  (aplicar a imagem comum a todos na criação; cliente criado/atualizado pelo faturamento com a proteção da
  decisão 4).
- **W3/M3** passam a ser a decisão 4. **W4** inclui a decisão 6. **W5** inclui a decisão 7 (responsivo).

## Pacotes

### Web
- **W1 — destravar e base (P20).** Contrato como fonte de enum/rótulo/transição do orçamento; sai `PRE_APPROVED`;
  `SIGNED` deixa de ser status (vai para `signatureStatus`); `isBudgetBillingPhase` passa a seguir `billable`; tudo o
  que manda arte na tarefa/orçamento (`layoutIds`, `layoutStatuses`, `layoutFileIds`, includes `layouts`/`layoutFiles`,
  `where.layouts`, `hasLayouts`, contextos `tasksLayouts`/`quote-layouts`, "Arte em lote" antiga) sai ou é
  redirecionado para a arte do implemento; api-client e tipos dos atos novos; mapas do portal para 12 funções.
  Critério: nenhuma tela da produção/orçamento/faturamento dá 400 nem "salva sem gravar".
- **W2 — arte do implemento e atos (P22a).** `ImplementArtPanel` (tarefa, orçamento, faturamento); projeto do
  implemento × projeto da tarefa; atos do valor (enviar/retirar, aprovar em nome com nota, revogar com motivo);
  "Assinado fora do sistema"; checklist "Para emitir falta…"; trava de "Aprovar cobrança" com o motivo; Atenção
  `budget.ready-to-emit`.
- **W3 — o orçamento reordenado (P22b).** Decisão 1, no detalhe e na criação.
- **W4 — faturamento, listas, presets (P22c).** Selo da assinatura, filtros/presets com os estados novos.
- **W5 — portal web (P23) e páginas públicas.** `implement` em vez de `identity`, arte por veículo com
  `APPROVE_ARTWORK`, `orderNumbers[]` (campo único, oculto com `inherited` — DD12.1), frente e porta traseira,
  "Aprovar o valor" no lugar de "Pré-aprovar".

### App (Flutter + AnkaaAero)
- **M1 — destravar (P24a).** Contrato Dart completo (status do orçamento, assinatura, arte, porta traseira, funções,
  transições) — o gerador fica na api (`scripts/export-contracts.ts --dart`); includes `layouts`/`layoutFiles` fora;
  arte fora dos formulários de tarefa/orçamento; lista de orçamentos por todos os status do contrato; grafo de
  transições do contrato; `SIGNED` → `signatureStatus`; AnkaaAero sem `layouts`. **E na api: o 426 de versão
  mínima (P31)** e a versão mínima configurável. Build alvo `1.4.4+27`.
- **M2 — eixos e atos (P24b).** Componente da arte do implemento; atos do valor e da assinatura; checklist de
  emissão; trava da cobrança.
- **M3 — orçamento reordenado (P24c).** Mesma ordem da decisão 1.
- **M4 — frente/porta traseira, projetos, testes (P24d).**

## Ordem
Rodada 1: **W1 ∥ M1**. Rodada 2: **W2 ∥ M2**. Rodada 3: **W3 ∥ M3**. Rodada 4: **W4+W5 ∥ M4**.
Cada pacote termina com typecheck/analyze limpo, commits pequenos por intenção, e um resumo no fim deste arquivo.

## Regras para os agentes
- Código em inglês; textos de tela e mensagens de commit em pt-BR, no estilo do repo.
- Checagem pesada (`tsc` completo, `flutter analyze`, testes, `pnpm install`) SÓ via
  `$SCRATCH/heavy.sh <cmd>` (uma por vez na máquina de 8 GB).
- `git add <caminhos>` explícitos; nunca `-A`, `stash`, `reset --hard`, `checkout --` ou push.
- Nenhum erro ou aviso fica para depois (corrigir antes de seguir).
- API local blindada; testes que gravam no banco podem rodar, mas nada sai da máquina.

## Resultado M1 (02/10)

**api** (`wt/truck-implemento`):
- `a46d89e4` — o `--dart` do contrato traz status do orçamento (com ordem, grafo manual e do sistema), assinatura,
  aprovação do valor, estados/origens da arte, porta traseira, funções do responsável e faces; caminho padrão
  corrigido para `../mobile_migration`. JSON não mudou (web intocada).
- `dc8aca51` — **P31, o 426**: `MIN_MOBILE_APP_VERSION` (vazio = desligado; documentado no `.env.example`). Barra o
  app Flutter abaixo da mínima e o app SEM cabeçalho de versão (o 1.4.3+26 instalado, identificado pelo UA `Dart/`);
  web (`X-Client`), navegadores, AnkaaAero (cabo, sem OTA), webhooks e scripts passam; `/install/*` e `/version`
  ficam abertos. `test:app-version-gate` (puro + ponta a ponta Nest), tsc e régua de tipos limpos.

**app** (`wt/implemento`): `3a09e45` contrato · `d8bc8b1` arte fora da tarefa (detalhe/edição leem
`implement.layouts`; criar/editar/ação de linha sem arte no corpo; seção "Arte do Implemento" só leitura) ·
`08332e7` arte fora do orçamento (include por implemento; "ARTE POR VEÍCULO" no detalhe; wizard sem Layout
Referência, sem seletor de layout aprovado e sem payload de arte; painel/presets/garagem pela arte do implemento) ·
`9a6bca2` Modelo C (rótulos/ordem/grafo do contrato; lista com REQUESTED e IN_NEGOTIATION; "Aprovar Valor" com nota
pelo ato; reprovar/enviar/retirar pelos atos; financeiro sem os atos comerciais; `signatureStatus` e `billable` no
modelo) · `ef3fb23` AnkaaAero (arte pelo implemento) · `8f4e6a2` versão **1.4.4+27** · `227ec47` teste do include.
`flutter analyze lib test` limpo; `flutter test` 1045/1045.

**Conferido contra a API local:** os includes antigos (`layouts`, `layoutFiles`) NÃO davam 400 — a API os descartava
calada (o detalhe abria com a arte vazia); o 400 era nos CORPOS (`layoutIds`, `layoutFileIds`). `where.layouts` também
respondia 200.

**Fica para o M2/M3 (e para a api):**
- os ATOS da arte (subir, enviar, aprovar em nome, reprovar, nova versão, lote) — hoje a seção é só leitura e diz
  "pelo sistema web por enquanto"; na criação com N veículos, "uma imagem para todos" (decisão 5) entra com eles;
- selo/eixo da assinatura na tela, checklist de emissão (`emission.blockers`), trava de "Aprovar Faturamento" sem
  `billable` (o botão ainda aparece; a API recusa com 400 e o interceptor mostra);
- **api:** `NOT_YET_INVOICED` (`attention.service.ts:305`) ainda conta `status SIGNED` e não conta `IN_NEGOTIATION`;
  o app espelha o servidor e por isso não mudou `_notYetInvoiced` — corrigir os dois juntos;
- `GET /budgets/task/:taskId` (include fixo) não traz `implement.layouts`; quem precisar da arte usa `GET /budgets/:id`.

## Resultado W1 (02/10, web `ade4dcaa` · `4e793e49` · `4df8901e`)

- **Contrato como fonte:** `src/constants/budget-contract.ts` lê `orcamento.{status,ordem,transicoesManuais}` e os
  rótulos de valor, assinatura, origem da aprovação e arte; `budget-contract.test.ts` amarra os enums do web
  (`TASK_QUOTE_STATUS`, `BUDGET_SIGNATURE_STATUS`, `BUDGET_VALUE_APPROVAL_SOURCE`, `LAYOUT_STATUS`,
  `LAYOUT_APPROVAL_SOURCE`, `RESPONSIBLE_ROLE`) ao contrato. Sai `PRE_APPROVED`; um mapa de rótulo só (o badge
  pega o do contrato: `PENDING` = "Pendente", `IN_NEGOTIATION` = "Aguardando aprovação do cliente").
- **Lista de orçamentos** volta (o `where.status.in` vem do contrato, sem o legado `SIGNED`).
- **Orçamento × Faturamento:** `isBudgetBillingPhase(quote)` = `billable` (valor aprovado E assinatura
  resolvida); o aprovado sem assinatura abre o Orçamento.
- **Atos do valor** (`BudgetStateActions` e o seletor do detalhe da tarefa): enviar/retirar do cliente, aprovar
  em nome com nota, reprovar com motivo — chamam a rota na hora; com alterações não salvas ficam desabilitados.
  O combobox de status e o diálogo "Rejeitar" do Resumo saíram; o Salvar não replica mais saltos de status
  (só EXPIRED→PENDING ao renovar a validade). api-client/hooks de todos os atos, de `/implements/:id/layouts/*`,
  `bulk` e `project-files`; tipos de `emission`, `valueApproval`, `billable`, `signatureStatus`, `artwork`.
- **Arte fora da tarefa/orçamento/faturamento:** saem `layoutIds/layoutStatuses/newLayoutStatuses`,
  `layoutFileIds`, includes `layouts`/`layoutFiles`, `where.layouts`, contexto `tasksLayouts`/`quote-layouts`,
  `set-quote-layout-modal`, `ApprovedLayoutPicker`, `BudgetVehicleLayoutsField`, `quote-layout-coverage`. No lugar:
  `ImplementArtSummary` (só leitura, POR VEÍCULO, com o estado e a aprovada) no passo 1 do orçamento, na edição
  da tarefa e no faturamento; o painel/garagem/detalhe leem `implement.layouts`. **Na criação de tarefa e na
  "Arte em lote"** a imagem entra como RASCUNHO no implemento de cada tarefa (`attachArtToTasks`: sobe no
  primeiro e replica com `/implements/layouts/bulk`) — a "uma imagem para todos" da decisão 5, pelo cliente.
  "Adicionar Layout Aprovados" virou "Adicionar arte" (o mesmo modal). Cópia de tarefa: `implementLayouts`,
  `rearDoor`, `implementProjectFiles`. Páginas públicas leem `artwork`, com a legenda do veículo quando difere.
- **Portal:** "Aprovar o valor" no lugar de "Pré-aprovar"; `waiting-on` pelo modelo novo (a vez em `APPROVED`
  depende da assinatura); `PORTAL_ROLE_*` tipados com as 12 funções, `APPROVE_ARTWORK`, e `WRITE_PURCHASE_ORDER`
  implicando só `VEHICLE` (espelho da API).
- **D-34:** web não manda mais `status` na criação de orçamento (o servidor ignorava com WARN).
- **Verificação:** `tsc -p tsconfig.app.json` 0 erro (4076 arquivos); vitest das pastas tocadas 269/269.
- **Fica para W2/W3:** o `ImplementArtPanel` (enviar, aprovar em nome, reprovar, versão nova, por veículo, com
  "aplicar a todos"); o cartão "Aprovação do valor" e o checklist `emission.blockers`; "Assinado fora do
  sistema" (api-client pronto); a trava de "Aprovar cobrança" com o motivo; coluna/filtro de assinatura nas
  listas; a coluna "ARTES" da lista de tarefas e a exportação leem `implement.layouts`, que essas listas ainda não
  incluem (mostram 0); o portal P23 (arte por veículo, `orderNumbers[]`, `implement` × `identity`).
- **Achados na API (não corrigidos):** `PUT /budgets/:id/status` com `IN_NEGOTIATION` passa pela checagem de
  papel genérica (o FINANCEIRO pode), enquanto `PUT …/send-to-customer` é só ADMIN/COMERCIAL — duas portas, dois
  papéis; `BudgetRequest.preApproved*` e `budget.portal_pre_approved` mantêm o nome antigo.

## Resultado A1 (02/10, api)

Commits: `9d83b470` · `49e3cc3b` · `6e325936` · `696d99d7` · `d8ebb9e1` · `4906a948`. tsc e régua de tipos limpos
(src 0; tests+scripts 121 = base); contrato sem mudança (JSON e Dart "igual").

1. **Documento com a arte por veículo (decisão 5)** — já estava no envelope; virou função pura testada:
   `quoteArtworkPlates(artwork, vehicleTasks)` (`src/utils/quote-artwork.ts`). Artes DIFERENTES: uma imagem por
   arquivo, legenda dos veículos que ela cobre (iguais AGRUPADAS: "Veículos 39089, 39090"), na ordem da tabela de
   identificação. Arte IGUAL em todos: uma imagem, SEM legenda (byte a byte o documento de antes; não há o que
   confundir). Veículo sem arte aprovada não chega ao documento: a emissão recusa antes (E2, "Falta a arte aprovada
   do veículo 39089."). O snapshot congela a cobertura (`layoutCoverage`): trocar a arte de veículo depois de
   assinado é mudança MATERIAL. Teste: `test:quote-artwork` (59).
2. **"Uma imagem para todos" — rota atômica:** `POST /implements/layouts/bulk` com **`{ budgetId, fileId }`** (no
   lugar de `{ implementIds, fileId }`; um dos dois, nunca os dois → 400). Aplica o arquivo a TODOS os veículos não
   cancelados do orçamento numa transação, como RASCUNHO, pulando quem já o tem; resposta `{ created, alreadyThere,
   total }`. Fluxo da criação: (a) sobe a imagem no 1º veículo `POST /implements/:id/layouts` (multipart `files`) →
   pega `data[0].fileId`; (b) `POST /implements/layouts/bulk { budgetId, fileId }`. Depois, cada veículo segue
   sozinho (`send`, `approve-on-behalf`, `reprove`, `new-version`, `DELETE`). Papéis: os de edição de arte.
   **W2/M2:** trocar o "sobe no primeiro e replica" pela chamada (b). Teste: `test:implement-layout` (43).
3. **Cliente pelo faturamento (decisão 4 ④):** criar com CNPJ/CPF já cadastrado, ou atualizar um cliente com o
   documento de OUTRO, agora é **409** com `details.existingCustomerId` (antes 400 sem id, e o 409 virava 500). A
   tela do combobox: no 409, SELECIONAR `existingCustomerId` em vez de criar/gravar. Documento guardado só com
   dígitos (a máscara furava a unicidade). O filtro global passou a entregar em `details` os campos estruturados
   das exceções (também o `fields` da trava de produção do portal, que ele jogava fora). Teste:
   `test:customer-document-conflict` (8).
4. **Atenção "ainda não faturado"** = PENDING ∨ IN_NEGOTIATION ∨ APPROVED (SIGNED sai; IN_NEGOTIATION entra).
   ⚠️ **App (`_notYetInvoiced`) e web (`notYetInvoiced()` em `lib/attention/rules.ts`) espelham — o M2/W2 mudam
   igual.** `GET /budgets/task/:taskId` traz `tasks[].implement.layouts` (id, fileId, status, version,
   supersedesId, sentAt, decidedAt, approvalSource, decisionNote, createdAt, file{…thumbnailUrl}).
5. **O ato é a porta (achado do W1):** `PUT /budgets/:id/status` (e o update genérico/aninhado) agora julga o papel
   com o status ATUAL: IN_NEGOTIATION, APPROVED e o PENDING vindo de APPROVED/IN_NEGOTIATION são só ADMIN/COMMERCIAL,
   como os atos. FINANCIAL continua cancelando e reabrindo o vencido. `isQuoteStatusChangeAllowed(to, setor, from)`
   expõe a regra (a tela pode usá-la para esconder o botão). Teste: `test:budget-state-machine` (53).
6. **`preApproved*` → `valueApproved*` (achado do W1):** `BudgetRequest.valueApprovedAt`,
   `valueApprovedByResponsibleId`, relação `valueApprovedBy` (migration `20261002120000_requisicao_valor_aprovado`,
   aplicada no `ankaa_implemento`); aviso `budget.portal_value_approved`. Nunca foi à produção (a `main` não tem a
   tabela). ⚠️ **Web:** `types/budget-request.ts`, `budget-request-card.tsx`, `orcamento-proposta-card.tsx`,
   `api-client/portal.ts`, `pages/cliente/orcamentos/[id].tsx` leem `preApprovedAt/preApprovedBy` — trocar por
   `valueApprovedAt/valueApprovedBy` (inclusive o include `request.include.valueApprovedBy`). App: nenhum uso.

## Resultado W2 (02/10, web `b39b2209` · `123add4c` · `f750c0c7` · `260b8c86` · `f3b476b9` · `c7e1fed7` · `eab855af` · `3e5d61dc`)

- **Arte do implemento:** `ImplementArtPanel` (`components/production/implement-art/`) — versões e estado, subir,
  enviar ao cliente, aprovar em nome (nota), reprovar (motivo), versão nova, excluir rascunho; atos valem na hora
  (`hooks/production/use-implement-art.ts`), botões pelos papéis da API (`utils/permissions/implement-art-permissions.ts`).
  `VehiclesArtSection`: um painel por veículo + "Uma imagem para todos", que passa por UMA função
  (`applyArtToImplements`) e usa o lote ATÔMICO `{ budgetId, fileId }` do A1. Substitui os quadros só-leitura do W1 no
  passo 1 do orçamento, na edição da tarefa e no faturamento; no detalhe da tarefa, quem age sobre a arte vê o painel.
- **Projeto do implemento × da tarefa:** `ImplementProjectFilesPanel` (PUT `/implements/:id/project-files`, na hora) na
  edição da tarefa; o detalhe mostra "Projeto da tarefa" e "Projeto do implemento" separados.
- **Faixa dos 4 eixos** (`BudgetAxesStrip`, lógica pura em `utils/budget-axes.ts` com teste): estado + próximo passo de
  valor · arte k de N · assinatura (9 estados do contrato) · cobrança, e "Para emitir, falta…" de `emission.blockers`
  com o botão que leva ao lugar de resolver. Montada no topo do DETALHE do orçamento (o detalhe passou a ler também
  `GET /budgets/:id`, que traz `emission`/`valueApproval`); na criação não há orçamento ainda — o W3 decide.
- **Cartão "Aprovação do valor"** (quem/quando/origem/nota; "Reprovar valor" saiu dos atos e mora aqui) e
  **"Assinado fora do sistema"** (prova + nota + data, só quando a API aceita).
- **Faturamento:** linha "Assinatura do orçamento" no resumo (não no cabeçalho — decisão de 17/09) e "Aprovar
  Faturamento" desabilitado com o motivo enquanto o orçamento não é cobrável; o handler recusa pela porta de trás.
- **Atenção `task-quote.ready-to-emit`** (gêmeo de `budget.ready-to-emit`, só COMERCIAL), com a flag derivada
  `allVehiclesArtApproved` (indefinida sem a arte na consulta → cala). A lista de orçamentos traz `implement.layouts`.
- **A1 consumido:** `valueApproved*`; "ainda não faturado" = PENDING ∨ IN_NEGOTIATION ∨ APPROVED;
  `isQuoteStatusChangeAllowed` espelhado (Financeiro não vê enviar/retirar/aprovar/reprovar valor).
- **Listas:** coluna "Assinatura" nos orçamentos (em "Colunas", como toda coluna nova); "ARTES" e a exportação de
  tarefas contam a arte APROVADA do implemento.
- **Verificação:** `tsc -p tsconfig.app.json` 0 erro; vitest 416/416 nas pastas tocadas (novos: `budget-axes`,
  `quote-permissions`, `quote-attention`, regra pronto-para-emitir). Não abri as telas no navegador.
- **Pendências da API (não editei):** `budgetWhereSchema` é strict e não aceita `signatureStatus` (sem filtro/ordem
  por assinatura na lista); `GET /budgets/task/:taskId` não traz `emission`/`valueApproval` (o detalhe faz a segunda
  leitura por id). **Aviso conhecido:** `baseline-browser-mapping` velho (transitivo de `@vitejs/plugin-react` →
  `browserslist`, também na main) — pede atualizar o lockfile.

## Resultado M2 (02/10, app `ed0e09c` · `6d216a0` · `818bb26` · `ca25dca` · `1d4dc53` · `0caf3bd`)

- **Arte do implemento com os atos** (`implement_art.dart` + `ImplementArtEntry`): versões com estado e decisão,
  subir (câmera/galeria/arquivo, multipart direto na rota — `pickLocalFiles`, sem `/files/upload`), enviar ao
  cliente, aprovar em nome (nota ≥ 3), reprovar (motivo), nova versão, apagar rascunho e **"Aplicar a todos os
  veículos"** pela rota atômica do A1 (`POST /implements/layouts/bulk {budgetId, fileId}`). Os atos possíveis vêm
  de `implementArtActs` (espelho dos portões do `ImplementLayoutService`; papéis `canEditImplementArt` =
  ADMIN/COMERCIAL/DESIGNER, `canDecideImplementArt` = ADMIN/COMERCIAL). Ligado no detalhe do orçamento (recarrega
  pelo `DetailReloadScope`), no formulário do orçamento (busca as versões ao trocar de veículo), na edição da
  tarefa e na ação "Arte do Implemento" da agenda (que passa a aparecer para o designer). Os stubs "pelo sistema
  web por enquanto" saíram.
- **Quatro eixos** (`budget_axes.dart`, lógica pura): Valor · Arte k de N (veículos vivos com arte APROVADA) ·
  Assinatura (`signatureStatus`) · Cobrança (`billable`, "Aprovada em parte" no faturamento fatiado), cada um com
  a próxima ação; `billingLockReason`; `emissionBlockerAction`. `Budget` lê `emission` e `valueApproval`; o veículo
  traz `implementId`.
- **Detalhe do orçamento/faturamento** (mesmo config, layout `financial-quote-detail-v3`): seção ANDAMENTO no
  topo (faixa 2×2 + "Para emitir falta"), APROVAÇÃO DO VALOR (como/por quem/quando/nota + "Reprovar valor"), e no
  menu ⋮ "Enviar ao cliente", "Retirar do cliente" e "Assinado fora do sistema" (anexo + nota,
  `POST /budgets/:id/offline-signature`, visível com valor aprovado e assinatura em NOT_ISSUED/REFUSED/EXPIRED/
  INVALIDATED). Enviar/retirar/reprovar o valor só ADMIN/COMERCIAL (o "Reprovar Valor" usava a audiência do
  faturamento e dava 403 ao financeiro).
- **Cobrança travada com o motivo:** a folha de "Aprovar Faturamento" mostra "Cobrança bloqueada" e desabilita o
  botão enquanto não `billable` (antes: 400 depois de confirmar).
- **Atenção:** `_notYetInvoiced` = PENDING ∨ IN_NEGOTIATION ∨ APPROVED (espelho do A1).
- **AnkaaAero:** nada a mudar (não lê orçamento, atenção nem os atos novos).
- **Verificação:** `flutter analyze lib test` sem problemas; `flutter test` 1072/1072 (+27: atos da arte, eixos,
  trava da assinatura, atenção). Não abri as telas num aparelho.
- **Fica para o M3:** o assistente Tarefa → Veículos → Serviços → Faturamento → Resumo (com a faixa dos eixos no
  topo e a imagem comum na criação: subir no 1º veículo e `bulk {budgetId, fileId}` depois de o orçamento existir).

## Resultado M3 (02/10, app `5568967` · `8e43053` · `6818964` · `1cf087d` · `3a3458d`)

- **Ordem nova (decisão 4):** ① Tarefa → ② Veículos → ③ Serviços → ④ Faturamento → ⑤ Resumo na criação e na
  edição (`budget_wizard_logic.dart` diz a ordem; a cobrança fica Veículos → Faturamento → Resumo).
- **Um arquivo por passo:** `budget_form_screen.dart` (6.271 → ~3.000 linhas: estado, carga e gravação) e
  `budget_step_{task,vehicles,services,billing,review}.dart` como `part`/extensões do mesmo State — o estado
  continua num lugar só, nenhum campo mudou de dono.
- **① Tarefa:** logomarca, razão social, detalhes; prazo de entrega (dias, documento), validade, garantia,
  tarefas simultâneas; responsáveis, tintas, arquivos base, layout, aerografia. Criação: UMA imagem para todos
  (sobe no 1º implemento e `bulk {budgetId, fileId}` logo depois do `batch-with-quote`, que agora pede
  `include.implement`). ⚠️ Com N veículos, detalhes/tinta/arte/aerografia são de cada um (decisão de 23/09) e
  ficam no cartão do veículo — a Tarefa diz isso.
- **② Veículos:** categoria e tipo comuns no topo; um cartão por veículo (o aberto expande, os outros são
  cabeçalhos tocáveis) com série, placa, chassi, plaqueta, nº do pedido (regra DD12.1 escrita no campo),
  previsão, "Prazo da Tarefa" (a data; o "Prazo de Entrega" em dias é o do documento — um rótulo por dado),
  medidas no desenho do detalhe da tarefa (editar abre a tela de medidas e relê só o implemento) e a arte.
- **④ Faturamento:** uma lista de pagadores com seletor de cliente que aceita criar e "+ Adicionar pagador".
  Trocar o cliente recomeça do cadastro do novo (nada sobra; serviços da linha passam ao novo); "Editar aqui
  altera o cadastro de X"; cliente repetido recusado; 409 `existingCustomerId` → seleciona o existente na
  criação e, na gravação do cadastro, avisa em qual pagador o documento não foi gravado (antes era engolido).
- **⑤ Resumo:** abre com ANDAMENTO (4 eixos + "Para emitir falta…"), aprovação do valor (revogar) e "Assinado
  fora do sistema" — os componentes do M2.
- **Navegação:** livre na edição (`WizardScaffold.freeNavigation`; o Salvar confere todos os passos), linear na
  criação; validação por passo pela lógica pura.
- **Verificação:** `flutter analyze lib test` limpo; `flutter test` 1086/1086 (+14 de `budget_wizard_logic_test`).
  Não abri as telas num aparelho.
- **API:** nada pendente para o M3.
