# Rework Implemento — ESTADO (25/09/2026, tarde)

Leia este arquivo primeiro. O plano completo está em `PLANO.md` (Revisão 3.1), e as notas de desenho de cada pacote estão em `notas/`.

## 1. O que o dono pediu (resumo)

- `Truck` passa a se chamar **Implemento**, com **tipo** e **categoria** como campos diretos.
- As medidas ganham a face **frontal** e a configuração da **porta traseira**: bipartida/tripartida, varões 2|3|4 no total, portinholas de 0 a 6.
- O **layout (arte)** sai do orçamento e vai para o implemento. Quem aprova a arte são os **responsáveis**, pelo portal.
- **Projeto da tarefa**: o PDF cotado de colagem. **Projeto do implemento**: o projeto do furgão (Furgões).
- O **número de série** vai para o implemento. Toda tarefa tem exatamente 1 implemento.
- O orçamento ganha a aprovação do **valor** antes da assinatura, e a **assinatura** passa a ser um eixo próprio (`signatureStatus`). A emissão exige o valor aprovado **e** a arte aprovada de todo veículo. O documento assinado leva a arte de cada veículo.
- A **cobrança só é aprovada depois de assinado**. Existe o ato "Assinado fora do sistema", com nota e anexo.
- Arte não aprovada trava a liberação para produção, inclusive a manual, só em trabalho novo. Não existe "dispensar arte".
- Pedido de compra: **quem TEM o papel Compras** informa o número, nas duas cerimônias.
- Editar o valor depois de aprovado continua como hoje.
- Decisões completas: DD1..DD12 no topo do `PLANO.md`.

- **DD13 (24/09, durante o P11a): migração COMPLETA, sem janela bilíngue.** "Não quero nenhum valor antigo, nem mesmo para compatibilidade; será uma migração completa, com atualização em tudo de uma vez." API, web, app e AnkaaAero falam só `implement` e sobem JUNTOS; os dados gravados com o nome velho migram no banco na mesma release; app que não atualizar leva 426 (o G13/P31 liga no mesmo deploy). Contrato de nomes: `NOMENCLATURA.md` (substitui §5.4/D-04 do plano na parte da janela).

- **DD14 (25/09): a série mora SÓ no implemento.** O dono escolheu "tirar tudo agora": sai a série no topo do corpo da tarefa (`serialNumber` fora de `implement` é recusado) e sai a coluna-espelho `Task.serialNumber` (+ `serialNumberNormalized`, gatilhos e índice) na mesma release — migration `20260930120070` (M5s, antes prevista para a R-D). Exceções permanentes: o snapshot congelado v1–v4 (série no topo, hash selado; lido por `taskSerialOf`), o campo `serialNumber` do histórico da tarefa e a chave de aviso `task.field.serialNumber`. `NOMENCLATURA.md` §5.

## 2. Onde está o trabalho (tudo LOCAL, nada foi enviado ao GitHub nem a produção)

| Repo | Branch | Situação |
|---|---|---|
| api | `feat/portal-do-responsavel` | main de 24/09 juntada (`2e38b63c`); fatias re-carimbadas para `20260930…`; P11a (`1772c328`) + nomenclatura completa DD13 (`fdd3588d`) + série só no implemento DD14 (`21c9e493`, `875aaf9f`) + testes do P11a e 2 defeitos achados por eles (`dc17ea42`, `19a48279`, `7ea83eb0`, `afc0102a`) + **P11b** (`b13c9413`, `885b17c2`, `a5a2a636`) + **P12.1** (`9a5e9394`, `5cc474d5`). **Régua verde (29/29, 171 s)** |
| web | `feat/portal-do-responsavel` | main de 24/09 juntada (`17ff1c04`); nomenclatura completa (`43183934`, `80aa1a4d`) e série só no implemento (`9ce33a03`, `6913c34d`, `9c553aaa`); contrato do P11b (`ffcb4685`). Régua: G0/G6/G4/G5 verdes; vitest 641/647 — os 6 vermelhos são do menu (`navigation-context.test.ts`) e falham IGUAIS na `origin/main` |
| app | `feat/implemento` | main (1.4.2+25) juntada; nomenclatura completa no app e no AnkaaAero (`856c2a3`, `901681e`, `1391b83`); AnkaaAero manda versão/plataforma (`acac622`); série só no implemento no app e no AnkaaAero (`2a5cb9a`, `ef5dc44`, `12d46c6`, `8f774b0`). Régua verde (analyze, G6, G5, suíte) |
| app | `patch/p02-sobre-1.4.1+24` | OBSOLETO com a DD13 (era o patch de compatibilidade) |
| api | `wip/p11a-parcial-20260923` | já incorporada; pode ser apagada |

Bancos locais (container `ankaa-postgres`):

- `ankaa_implemento`: banco da Fase B. Tem M0 + M1 + M1s + a nomenclatura (`20260930120060`, Mnom) + a série só no implemento (`20260930120070`, M5s) + **M2** (`20260930120100`) + os avisos da porta (`20260930120110`) + **M3** (`20260930120200`) + as 6 migrations da main de 24/09.
- `ankaa_implemento_p13a`: banco do worktree do P13a (cópia do `ankaa_implemento` antes da M3). Apagar depois da integração.
- `ankaa_implemento_base`: a base (main + M0), criado em 24/09. É onde o ensaio roda a cadeia inteira (8 fatias); manter até o P30.
- `ankaa_taskmatch_impl_test`: descartável do `test:task-match:integration` (db push).
- `ankaa_production` (clone) e `ankaa_veiculos` (outra sessão): não tocar.
- Env: `source ~/Documents/repositories/api/.git/implemento-env.sh` (aponta para `ankaa_implemento` e BLINDA envio: Firebase vazio, WhatsApp/e-mail/Sicredi/Elotech na sentinela, `REDIS_DB=3`). Fica em `.git/` para sobreviver ao reboot.

## 3. O que foi FEITO

### Análise (manhã e tarde)
- 7 + 4 relatórios de mapeamento (`01..11-*.md`).
- `PLANO.md` com modelo-alvo, migração M0..M4, contrato da API, tabelas arquivo:linha por camada, guardas G0..G36 e pacotes.
- Duas auditorias de completude, com 873 e 288+128 arquivos varridos.
- `P00-producao.md`: números de **produção** medidos só com leitura, em 23/09 às 15:17 UTC. Destaques: 0 coletas RUNNING, 30 COMPLETED, 504 aprovados sem coleta, 0 `PER_VEHICLE`, 1.676 tarefas sem `Truck`, 2.051 séries sem duplicata e 73 artes de aerografia.

### Fase A (sem mudar comportamento) — FEITA e revisada
- **P00**:
  - merge da `origin/main` (deploy de 23/09 da outra sessão, com N veículos, layout por veículo e lente do faturamento) na base da api (`cd61b7d1`) e do web (`051a5c04`);
  - branch `feat/implemento` no app;
  - Revisão 3 do plano;
  - notas P01..P05.
- **P01** (api), guardas:
  - G0: build recusa erro de tipo; `src/` com 0 erros; catraca nos 138 de `tests/` e `scripts/`;
  - G1: validador de include/select/where/orderBy derivado do DMMF, com chave inventada virando 400 nomeado (ligado em `/tasks`; em modo relatório em `/customers`, `/files` e `/airbrushings`);
  - G4: contrato de consultas com as formas reais do web, do app e do AnkaaAero;
  - G6: catraca de `truck` residual;
  - G7: matriz setor×campo;
  - G9: chaves de notificação;
  - G10: referências de arquivo;
  - G11: hashes de ouro das assinaturas, inclusive com `build()`;
  - G25: objetos pós-push;
  - G14: `scripts/pre-deploy.sh`.
- **P02** (app):
  - `X-App-Version`, `X-App-Patch` e `X-App-Platform`;
  - tela bloqueante "Atualize o app" no 426;
  - leitura tolerante (`implement`/`truck`, série nos dois lugares, face desconhecida neutra);
  - tipo do implemento nasce vazio, não mais "Refrigerado".
- **P03** (web):
  - tipo `ImplementFace` (3 faces) no lugar de 29 uniões escritas à mão;
  - o vocabulário das medidas deixou de ser "layout" no código;
  - 12 arquivos mortos removidos;
  - correções A7 (foto da face na criação) e A12 (a exportação pedia relação inexistente);
  - `X-Client`, desligado por padrão;
  - extrator do G4 do lado web.
- **P04** (api): `ImplementMeasureWriter` usado pelos 10 escritores de medida, sem medida compartilhada; G15 prova.
- **P05** (api, web e app):
  - fonte única de rótulos por documento (`src/constants/document-labels.ts`), sem mudar nenhuma palavra de NF (G21);
  - `scripts/export-contracts.ts` e testes de exaustividade nos 3 repos.
- **Revisão em duas lentes**: 25 achados, 24 corrigidos. Web e app ganharam `scripts/pre-deploy.sh` próprios.

### Fase B (API) — parcial
- **Notas**: o plano ficou sem duas verdades.
  - DD11 vira `SIGNED_OFFLINE` + `BudgetOfflineSignature` + `POST /budgets/:id/offline-signature`.
  - DD12 vira um predicado único, `orderNumberRequirement`.
  - Protocolo de **promoção de migrations por fatia** (`prisma/staged/r-b/`, com carimbos reservados).
  - Notas P06, P10, P11a, P11b, P12, P13a, P14, P13b e `cruzamento-fase-b.md`.
- **P06**:
  - M0 (`20260930100000_arte_estados_e_tipos`);
  - censo de consultas G3 (`src/modules/common/census`);
  - log de versão do app;
  - CORS aceitando `x-client` e `x-app-*`.
  - **Sem deploy.**
- **P10**:
  - esquema-alvo em `prisma/staged/r-b/schema.alvo.prisma`;
  - 6 fatias idempotentes (M1, M1s, M2, M3, M3o-a, M3o-b);
  - ensaio `scripts/rehearse-implement-migration.ts` em transação revertida, com 59/59 invariantes; quem casava no G11 continua casando, inclusive os nº 584, 591 e 594;
  - G36 mede a distância até o alvo.
  - O ensaio pegou um defeito no gatilho da M1s, e ele foi corrigido.

### 24/09 (esta sessão)
- Merge da main de 24/09 na api e no web; régua da base com os ajustes do que a main trouxe (G9 lê `MAPA.chave`, G6/G5/G4).
- **Re-carimbo**: a main publicou `20260924120000/120100/120200`, os mesmos carimbos de M1/M2/M3. M0 e as seis fatias foram para `20260930…`; regra nova no cruzamento: re-carimbar de novo no P30.
- **P11a** retomado da WIP: promoção de M1/M1s, rename, série no implemento (W1–W6), G15 e layout-per-vehicle com implemento aninhado.
- **DD13**: janela bilíngue removida; nomenclatura completa na API (código, rotas, avisos, histórico, arquivos, testes, scripts) e migração de dados `20260930120060`; G6 de 865 → 5 (rótulos "Truck" da categoria), G6b → 0.
- Defeito achado: select sem tipo com `truck` na cotação do aerografista (código novo da main) → `implement` + `satisfies`.
- App e AnkaaAero migrados (agente). Web migrado (agente).

### 25/09
- **DD14, série só no implemento**: api (`21c9e493`), web (`9ce33a03`, `6913c34d`), app e AnkaaAero (`2a5cb9a`, `ef5dc44`, `12d46c6`). Nenhum select/where/orderBy de `Task` pede a série; o corpo com série no topo é recusado (matriz setor×campo). Os leitores fiscais (NFS-e, boleto nos DOIS construtores, recibo, DPS) leem `implement.serialNumber`; o ouro fiscal (G21, 102 verificações) segue com o texto de hoje.
- **M5s** (`20260930120070`): prova que nenhuma série fica fora do implemento e derruba espelho, guarda, colunas e índice. A M1s ganhou guarda (`IF EXISTS` da coluna) para ser reaplicável depois dela.
- **Ensaio** com 8 fatias (M1, M1s, Mnom, M5s, M2, M3, M3o-a, M3o-b). Na `ankaa_implemento_base`: revertido 68/68; `--deriva` 6/6 (placa/chassi gerados do implemento viraram sobrevivente nomeado: quando a origem ainda tem `Truck`, o diff de antes vê tabela nova, não a deriva antiga). Reaplicar M1s/Mnom/M5s no banco já migrado: sem erro (idempotentes).
- Régua da api 26/26 verde (146 s).
- **Testes do P11a** (`tests/implement-serial.test.ts`, na régua): G19 (W1–W6, unicidade, desfazer para série em uso → 400), G20 (C1–C5 com implemento e `spot` nulo, a rede do banco, varredura da fonte por `task.create` sem implemento), G22 (contexto de `task.created` e `task.field.serialNumber`), G23 (o corpo do app de hoje; série no topo recusada), G24 (nenhuma leitura sem tipo nem SQL cru da série na tarefa), G32 (a URL exata da Agenda pelo parser e pipe da rota → 200 e ordenada) e a busca de tinta por série e placa. 36/36.
- **Defeitos que os testes pegaram** (o espelho escondia): (1) editar a série não gravava a trilha `TASK/serialNumber` que o aditivo da assinatura lê; (2) desfazer a série respondia 200 sem desfazer; (3) a URL antiga da Agenda respondia 200 com OUTRA ordem — o G1 agora recusa com 400 nomeado a chave de `orderBy` que o modelo não tem (no `include`/`select` só conta: o web ainda pede chaves mortas); (4) dois testes com banco criavam tarefa sem implemento; (5) corpos de teste com a série no topo escondidos por `as any`; (6) o portal recuava para `task.serialNumber` num tipo local.
- `signature-refusal` amarrava o código ao PDF errado (um recorte por responsável desde a main de 24/09) e deixava envelope RUNNING a cada execução (G11 acusava): corrigido.
- **P11b** (frente, porta traseira e projeto do implemento), régua 30/30:
  - M2 promovida (30 medidas descompartilhadas no banco da Fase B); `IMPLEMENT_FACES` com `front` e TODO mapa face a face virou laço sobre a lista (escritor, módulo de medidas, tarefa, cópia, desfazer, whitelist, zod, tracker, rótulos `IMPLEMENT_FACE_LABELS`); foto da medida na traseira e na frente; multipart `frontSide` nos 2 interceptores (o `POST /tasks` não aceita foto de medida e continua sem).
  - **G12 pegou um defeito**: `ZodValidationPipe` PULA `param`, então `@Param('side', new ZodValidationPipe(...))` não validava nada — `side=rear` virava 500. Pipe novo `ZodParamValidationPipe`.
  - Porta traseira (`REAR_DOOR_LEAVES` + rótulos, zod, CHECKs, trilha, desfazer, avisos `task.field.implement.rearDoor*` — migration `20260930120110` gerada das linhas do seed).
  - **Cotador**: a frente em DUAS passadas (só disputa o retângulo que sobrou; frente e traseira têm a mesma proporção e numa passada única a traseira desenhada saía como "FRENTE"). Sem versão do app (DD13: o app velho leva 426). Testado com PDF sintético (`tests/layout-dimensions-front.test.ts`); o banco real de PDFs está só no servidor.
  - `PUT /implements/:id/project-files` + contexto `implementProjectFiles` (pasta Projetos) + referência G10 + organizador; tokens de cópia `rearDoor` e `implementProjectFiles`.
  - Portal (leitura, §7.4): bloco `implement` { id, type, category, measures {left,right,back,front}, rearDoor|null, projectFiles } separado de `identity` (que perdeu category/implementType/measures). **O web do portal (P23) tem de acompanhar** (`api-client/portal.ts`, `veiculo-identidade-card`, `step-veiculos`).
  - Fica para os pacotes dos clientes: `PanelSide` do web com `FRENTE` (P20), o app (P24: frente, porta, 426), o aperto do schema da face embutida (`implementMeasureFaceInputSchema`, "junto com os clientes"), a pasta "Traseiras" recebe a frente sem renomear (D-24).
- Ids de preferência: os 4 ids antigos gravados (`hasTruck`, `truckCategories`, `truckCategory`, `truckSpot`) viram, pela regra da `20260930120060`, ids que o web e o app usam hoje.
- **P12.1 — a arte sai da tarefa e do orçamento (M3 promovida)**, régua da api verde (29/29, 171 s; o ensaio testa as pendentes M3o-a/M3o-b, 19/19 invariantes, G11-dados sem ninguém que parou de casar):
  - **M3** (`20260930120200`) aplicada no `ankaa_implemento`: `Layout` com UM dono (CHECK `Layout_one_owner_check`: implemento xor aerografia), único por (dono, arquivo); `LayoutDecision`; `File.artLayouts`. Saem do Prisma `Task.layouts`, `Budget.layoutFiles`, `File.quoteLayoutId` e `BudgetLayoutTask` (a coluna e a tabela ficam no banco até a M4; o gatilho de exclusão de `File` continua protegendo o que só elas referenciam).
  - **A arte do orçamento = a arte APROVADA dos implementos** (`src/utils/quote-artwork.ts`: `quoteArtworkOf` + `artworkGateFailure`), para o snapshot, o documento (legenda por veículo), a página pública (`findPublic` devolve `artwork[]`) e o portal. **G11 verde**: dos 19 envelopes RUNNING/COMPLETED, os mesmos 3 casam. O teste puro prova os hashes de antes (snapshot, material v1–v7 e HTML) com a arte vinda dos implementos.
  - **R1**: o orçamento não recebe nem grava arte (zod sem `layoutFileIds`/`layouts`/`layoutFiles`; `budgetApprove` sem portão de arte — o portão fica na emissão; a união de orçamentos não avisa de layout; a cópia de orçamento não leva arte). Apagados `sync-quote-task-layouts.ts` e `quote-layout-coverage.ts`.
  - **Tarefa sem arte**: saem as rotas `GET /tasks/:id/layouts/diagnostic`, `POST /tasks/bulk/arts`, `POST /tasks/bulk/upload-files` e `POST /tasks/:id/upload/layouts`; o multipart `layouts`/`quoteLayoutFile` sai dos interceptores (o Multer responde 400); `layoutIds`/`layoutStatuses`/`newLayoutStatuses`/`removeLayoutIds` saem do zod estrito (400); os domínios `layouts`/`layoutRemoval` saem da matriz setor×campo; o filtro `hasLayouts` vira `hasArt` (arte APROVADA no implemento); o include/select `layouts` vira `implement.layouts` (linha `Layout` com `file`, sem o achatamento em "File com layoutId"); o token de cópia `layoutIds` vira `implementLayouts` (linhas NOVAS, em rascunho, no implemento de destino); desfazer um histórico `layouts` responde 400.
  - **DD13 no lugar da nota P12**: não há "sintetizador legado" de `task.layouts` nem "aceita e ignora" de `layoutFileIds` — cliente que manda o formato velho leva 400 (e o app velho, 426).
  - **Filtro por papel** sobre `implement.layouts` no detalhe e na lista (risco 25): fora de COMMERCIAL, DESIGNER, LOGISTIC, PRODUCTION_MANAGER e ADMIN, só a arte APROVADA.
  - **Aerografia**: a linha de arte é por (aerografia, arquivo) — sem clone nem "adoção" de linha alheia; o `set` da relação virou `deleteMany` (desligar violaria o CHECK); a exclusão só apaga as linhas dela (risco 29); a cópia compartilha o arquivo com linhas novas.
  - **Arquivos**: contexto `tasksLayouts` → `implementLayouts` (sai `quote-layouts`); a referência `Layout.fileId` tem contexto pelo dono; a referência de saída `quoteLayoutId` saiu com a guarda de lista vazia; organizador, migração de arquivos e sugestões acham o cliente pelo implemento ou pela aerografia.
  - **Lembrete diário**: arte `PENDING_APPROVAL` enviada há mais de 24 h (era `DRAFT`), para COMMERCIAL/ADMIN; o do contato do cliente vem no P12.2.
  - **Testes**: `tests/quote-artwork.test.ts` (54, no lugar do `layout-per-vehicle`: puro + portão da emissão + snapshot do banco + filtro por papel + aerografia + replicação de medidas). O G1+G4 e o G10 ganharam listas de **dívida da Fase C** que só encolhem: as 6 formas do web que pedem `quote.include.layoutFiles`, as chaves `Task|include.layouts` e `Budget|include.layoutFiles`, e os contextos `tasksLayouts`/`quote-layouts` que web e app ainda mandam.
  - **Web junto (como na DD13/DD14)**: o filtro da lista e do histórico de tarefas `hasLayouts` virou `hasArt` ("Tem arte aprovada") — o zod da API DESCARTAVA `hasLayouts` calado e a lista voltava inteira. Ficam para o P21 a coluna "ARTES" e a exportação (leem `task.layouts`, que não vem mais: dizem "Não" para todos) e o filtro de três estados do painel (`dashboard/widgets/task-table.tsx`, que monta `where.layouts` → 400 nomeado do G1).
  - **O que quebra nos clientes até a Fase C** (todos já recusados pela API): no web, upload de arte nos formulários de tarefa (criação, edição, lote), `set-quote-layout-modal`, a arte no orçamento (criação, detalhe) e no detalhe do faturamento, sugestões de arquivo com `tasksLayouts`, os includes `layouts`; no app, `layout_attach_sheet`, `task_form_fields`, `task_row_actions` e `budget_form_screen`; no AnkaaAero, o include `layouts` da tarefa.

## 4. O que FALTA (na ordem)

**P11a e P11b FECHADOS em 25/09.** Em curso: **[P12 ∥ P13a]**. O P13a terminou no worktree (`impl/p13a`, 5 commits sobre `ba33e570`: `673be92e`, `a99c55bc`, `38463180`, `e1335211`, `44cb33b4`) e espera a integração (`merge --no-ff`; só `contracts/enums.json` se cruza, e ele é regerado). Do P12 falta: **P12.2** (`ImplementLayoutService` + rotas `/implements/:id/layouts/*` e `/implements/layouts/bulk` + `LayoutDecision` + eventos com ator discriminado + `LAYOUT_STATUS` com 5 e `LAYOUT_APPROVAL_SOURCE` + `onQuoteContentChanged` + recalcular o estado da tarefa + chaves `layout.portal_pending_approval`), **P12.3** (`artworkGate` DD3/DD10 nas duas funções puras e nos 6 chamadores, liberação manual inclusive; aprovar a arte fecha "Aprovar com o Cliente" e a O.S. de ARTE em `WAITING_APPROVE`) e o lembrete ao contato. Fora do rework: `billing-entity` e `orcamento-faturamento-a-db` apontam para o banco `ankaa_qa_e2e`, que está sem esquema neste ambiente (não rodaram).

Com a DD13 o plano encurta: não existe mais R-C/R-D separadas nem P32 "remove aliases"; web (P20–P23), app (P24) e AnkaaAero entram na MESMA release da API, e o 426 (P31) liga nela.

```
P11a (retomar) → P11b → [P12 ∥ P13a] → [P14 ∥ P13b] → revisão da Fase B
→ Fase C: P20 (web base) → [P21 produção ∥ P22 orçamento/faturamento] → [P23 portal web ∥ P24 app novo + AnkaaAero] → P26 (e2e, dados persistidos)
→ P30 (ensaio em produção + deploy R-B, COM o dono) → P31 (versão mínima / 426) → [P28a ∥ P28b] (leitores da série) → P32 (remove aliases + M4)
```

| Pacote | O que falta |
|---|---|
| **P11a** | Terminar o rename `Truck`→`Implement` e a série no implemento, com a API aceitando os dois formatos: tradutor da escrita, espelho da leitura, aliases `/trucks`, `DEPRECATED_QUERY_KEYS` e implemento em toda criação de tarefa. Retomar da `wip/p11a-parcial-20260923` ou refazer da base. Nota em `notas/P11a.md` |
| **P11b** | Face FRENTE (4 faces no writer, multipart `frontSide`, cotador condicionado à versão do app) e porta traseira (colunas, CHECKs, preset das folhas) |
| **P12** | Arte do implemento (`/implements/:id/layouts/*`, `LayoutDecision`), R1 inteiro, portão de liberação (automática e manual), `quoteArtworkOf` no snapshot v7, página pública com a arte, sintetizador legado de `task.layouts`/`layoutFiles`, G11 real |
| **P13a** | Portal: frente, porta, projeto do implemento e série; trava em `IN_PRODUCTION` |
| **P14** | Máquina do orçamento (§2A): aprovação do valor, eixo da assinatura, `assertEmissionReady`, portão da cobrança (DD7/DD11), `SIGNED_OFFLINE`, `orderNumberRequirement` (DD12) |
| **P13b** | Portal: `APPROVE_ARTWORK`, `APPROVE_VALUE`, aprovar/reprovar a arte, resumo em três eixos, seed da demo |
| **P20..P26** | Web (tipos, produção, orçamento/faturamento, portal), app novo (P24) e **AnkaaAero** (Swift, build nova instalada por cabo antes da R-C), e2e |
| **P30..P32** | Ensaio em produção, deploy e o fim do período em que a API aceita os dois formatos. **Tudo com o dono** |

Regime: no máximo 2 agentes por vez. Um pacote que cria exigência para o repositório inteiro roda sozinho. Revisão em duas lentes sobre a combinação. Nunca push, deploy ou patch sem o dono. Os pares da API rodam em worktree próprio (`impl/p13a`, `impl/p13b`), com banco próprio (`ankaa_implemento_p13a` e `_p13b`, criados com `CREATE DATABASE … TEMPLATE ankaa_implemento`) e `node_modules` próprio. O roteiro usado está em `~/.claude/projects/-home-kennedy-Documents-repositories-api/b5b01fad-…/workflows/scripts/implemento-fase-b-*.js` e pode ser reaproveitado, pulando os passos já feitos.

## 5. Pendências com o dono

0. ~~Série no topo e espelho `Task.serialNumber`~~ — RESOLVIDO em 25/09: "tirar tudo agora" (DD14, feito).
0b. **Web: 6 testes do menu vermelhos na `origin/main`** (`src/contexts/__tests__/navigation-context.test.ts`: árvore do ACCOUNTING, Gratificações no DP, contexto gravado). O menu mudou na main (Contas a Receber no financeiro, Custo de Colaborador) e o teste não acompanhou. Não é do rework; a régua do web fica vermelha por isso até a main corrigir. Corrigir na main, ou a sessão da main corrige?

1. **F8**: a prévia do boleto no web passa a mostrar as palavras reais do boleto registrado ("Isoplastic / Carga Seca / Carroceria") no lugar de "Isotérmico / Prancha/Plataforma". Aceitar, ou reverter só o commit web `b6f64ccd`?
2. **Duas telas do web já dão 500 em PRODUÇÃO**, fora do rework:
   - edição de colaborador (`include.tasks` em `GET /users/:id`);
   - edição de item (`where.measures.some.AND[].type`).

   Corrigir na `main`?
3. **Push de segurança** das branches (api/web `feat/portal-do-responsavel`, app `feat/implemento`): ainda não autorizado.
4. Recomendação do Notas, ainda sem resposta: o ato "Assinado fora do sistema" **não** exige a arte aprovada, porque a arte já trava a produção.
5. A notificação de troca da foto da plaqueta (`task.field.truck.vinPlateId`) fica sem configuração **por ordem do dono**. Não mexer.
6. Palavras da nota fiscal (Isotérmico/Isoplastic, Prancha/Carroceria, "OS #"/"Série"): nada muda até o dono escolher.

## 6. Armadilhas que já custaram (ler antes de continuar)

- A **outra sessão** trabalha na `main` e faz deploy. Antes de cada fase: `git fetch` e, se a `main` andou, `git merge origin/main` na base (nunca rebase).
- Números do clone local ≠ produção. Use `P00-producao.md` e os SQL em `sql/p00-producao-*.sql` (sempre `BEGIN TRANSACTION READ ONLY … ROLLBACK`).
- O gatilho de exclusão de `File` (`file_blocking_references`) cita `quoteLayoutId`: a coluna só cai na M4.
- `paint.service.ts` faz `LEFT JOIN "Truck"` em SQL cru com `catch` → volta vazio sem erro depois do rename.
- O include padrão da tarefa (`task-prisma.repository.ts`) e o de `File` (`file-prisma.repository.ts`) pedem relações que o rework remove, o que daria 500 em toda leitura.
- O app instalado (1.4.2+25) e o **AnkaaAero** instalado continuam mandando `truck`, `task.serialNumber` e o `orderBy` da Agenda por série, e SEM cabeçalho de versão. Com a DD13/DD14 isso deixa de funcionar na release: por isso o 426 (P31) sobe junto, e o AnkaaAero novo tem de estar instalado por cabo ANTES do deploy. O 426 precisa isentar downloads de arquivo, `/ping`, `socket.io` e as rotas públicas de assinatura (o Dio cru do Flutter não manda versão).
- `dart format` global reformata 211 arquivos: nunca rodar.
