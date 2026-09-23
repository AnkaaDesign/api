# Revisão da Fase A — correção dos achados (F1–F11, R-B-01–R-B-14)

Nota da correção da revisão (23/09), sobre a combinação P01..P05. Repositórios e branches: **api** `feat/portal-do-responsavel`, **web** `feat/portal-do-responsavel`, **app** `feat/implemento` (+ `patch/p02-sobre-1.4.1+24`, a branch de onde o patch Shorebird sai). Nada empurrado, nenhum deploy, nenhuma migration.

## Resultado por achado

| Id | Sev. | Estado | Onde / commit | O que foi feito |
|---|---|---|---|---|
| F1 | alta | FEITO | api `75db857f` | Export `TRUCK_CATEGORY_PROFILE_LABELS` → `CATEGORY_PROFILE_LABELS` (5 leitores voltam à base); `document-labels.ts` com chaves literais e `Record<Category, …>` (2 ocorrências: importação + apelido). As 2 ficam numa exceção TEMPORÁRIA do `.residual-allowlist` (`até=2026-12-31`, o P11 renomeia o enum); o guard ganhou exceção com vencimento e `--recomando`. Base só desceu (1.240 → 1.230). |
| F2 / R-B-04 | média/alta | FEITO | api `2b6a6cc0` | Verificação de fonte do G15 pelo AST (`tests/helpers/measure-write-scan.ts`), em `src/`, `scripts/`, `prisma/`: escrita direta (ponto e colchete), face dentro de `data/create/update/upsert` (inclusive aninhada, FK literal), operação aninhada numa face, atribuição a coluna de face, chave computada sem o desvio pelo `FACE_FK[…]`, SQL cru. `front` já no padrão. 11 canários de escrita + 4 de leitura no próprio teste. |
| F3 / R-B-13 | média/baixa | FEITO | api `3fc43c44` | `ServiceOrder.select.name → description` em `DEPRECATED_QUERY_KEYS` (handledBy `sanitizeSelectFields`, vence 2027-03-31): volta a 200. Relação do topo só com `where`: `bareRelationArgsIgnored` no `TASK_QUERY_SHAPE` (conta e loga, não recusa; relação inventada segue 400). `TASK_QUERY_SHAPE` saiu do controller para `task-query-shape.ts`. |
| F4 | média | FEITO | web `ee7b1bc6` + `15090225`; app `e08f694` (patch: `8228a14`) | A criação volta a mandar `truck: {}` quando nenhum campo do caminhão foi preenchido: o repositório cria o caminhão vazio (sem tipo, sem categoria, `spot` nulo). A contagem de tarefas sem implemento **não cresce** até a R-B; o que não volta é o "Refrigerado" inventado. Zod de `POST /tasks` e de `batch-with-quote` conferido com `truck: {}`. |
| F5 / R-B-06 | baixa/alta | FEITO | api `e3443397` | `export-contracts.ts --check --irmaos` confere `../web/src/generated/contracts/{labels,enums}.json` e `../mobile-flutter/lib/generated/contracts/labels.dart`; no pre-deploy da api. Mutação 'Sider'→'Sider ZZ' na cópia do web reprova. |
| F6 | baixa | FEITO | api `cc83e8f0` | `/customers`, `/files`, `/airbrushings` passam pelo G1 em **modo relatório** (`reportOnly`): contam e logam a chave que o zod tira e a que chegaria ao Prisma, sem mudar resposta. O pipe passa ao G1 o cru com o `include` em JSON aberto (antes o modo relatório não via o formato do app). |
| F7 | baixa | FEITO | api `371e88f2` | Contador do G1 com teto (2.000 entradas, balde `(outros)`), caminho cortado em 200, detalhe em 300. |
| F8 | baixa | ADIADO (dono) | web `b6f64ccd` intacto | Nenhum commit posterior toca `billing-document-previews.tsx`: o `b6f64ccd` continua revertível sozinho. **Pedir o ok do dono antes de publicar o web** (a prévia do boleto passa a dizer "Isoplastic/Carga Seca/Carroceria", as palavras do boleto registrado). |
| F9 | baixa | FEITO | app `523769a` (patch: `b534afa`) | Com `implement` e `truck` juntos, `implement` vence chave a chave e o que só `truck` trouxe é preenchido. **Contrato do P11**: o espelho `implement` na janela é cópia profunda e igual de `truck` — teste de API deep-equal no P11 (registrado no §5.4 do plano). |
| F10 | baixa | FEITO | api `ddf032e1` | `isOrphaned`/`hasRelations` derivados do DMMF (toda relação de `File`, menos `thumbnailJob`). G10 confere cobertura e órfãos + referenciados = total. Comentário proíbe limpeza em lote sobre o filtro. |
| F11 / R-B-10 | baixa/média | FEITO | web `809baa25`; app `32b760d`; api `d5c28a9a` | `guard-residual.sh` no web (src/, fora truck-studio e generated; base 2.288/149, G6b 0) e no app (lib/, fora generated e `garage_geometry.dart`; base 628/65, G6b 1). `pre-deploy.sh` no web (tsc -b, catraca, extrator G4 `--check`, cópia do contrato, vitest) e no app (flutter analyze, catraca, cópia do contrato, flutter test), com `--rapido`. O guard não cai mais com zero ocorrência (rg sai 1) e reprova padrão inválido. |
| R-B-01 / R-B-09 | alta/média | FEITO | api `8e9e6534` | G6a enxerga `truckId`/`truckData`/`trucksCount` e o tipo `Truck`/`Trucks` (exceções no padrão: `truckSpot`, `truck-studio`, "Truck Studio"). G6b pega o identificador dos dois lados do texto, "Implement Measure" e `"Truck " + x`. Base regravada UMA vez pelo `--recomando` (1.230 → 1.782; 105 → 113 arquivos); o check reprova base de padrão diferente. |
| R-B-02 | alta | FEITO | api `3b0d2e45` | Parte C do G4 zera os contadores por forma e reprova chave descartada calada fora de `DESCARTADAS_CONHECIDAS` (semeada com 14, hoje 21; só encolhe). |
| R-B-03 | alta | FEITO | api `ff9707b2`; web `809baa25` | Pre-deploy da api roda o extrator do web em `--check` (`scripts/check-web-query-contracts.sh`); o web tem o próprio pre-deploy. |
| R-B-05 | alta | FEITO | api `96a94715` | Parte C do G11: cada envelope RUNNING/COMPLETED reconstruído com `buildForQuote` e comparado por `matchesFrozenTerms` (com signatários pendentes). Base em `contracts/signature-golden/build-base.json`: casam 3 de 19 no clone (16 orçamentos editados depois da emissão no próprio clone). Mutação `layoutFileIds: []` reprova. |
| R-B-07 | alta | FEITO | web `f0c4246e` | G18 acusa lista de faces em qualquer ordem (união ou array) que junte lado com `back`/`front`. Portal: `LADOS = IMPLEMENT_FACES`, `LADO_DO_IMPLEMENTO satisfies Record<ImplementFace, string>`, `LadoImplemento = ImplementFace`. |
| R-B-08 | média | FEITO | api `f8007815` | Seção 12b do ouro fiscal: as palavras do documento do orçamento assinado por extenso (`truckCategoryLabel`/`implementTypeLabel`). Nota do P05 (desvio 3) corrigida. |
| R-B-11 | média | FEITO | web `34ab689a`; api `64b00349` | Registrados User, Item, Supplier, ChangeLog (7 schemas): 50 → 140 formas; meta de cobertura 0,34 que só sobe. Veio à tona e ficou catalogado (listas que só encolhem): 79 chaves fantasma nesses schemas, **2 formas reais que já dão 500 em produção** e 7 chaves descartadas caladas. |
| R-B-12 | média | FEITO | api `c3dc30f7` | G10 varre `web/src` e `mobile-flutter/lib` atrás de `fileContext` literal e exige que esteja em `contracts/file-contexts.json` (12 hoje). |
| R-B-14 | baixa | FEITO | api `0d644240` | G0 reprova arquivo NOVO que o `tsconfig.check.json` exclui (`*.spec.ts`, `*.test-utils.ts`, `*.example.ts(x)`, `src/scripts/archive/**`); os 41 de hoje ficam em `foraDoTipo` na base (só encolhe). |

## Desvios e achados novos (seguiu-se o código)

1. **Web não renomeia `TRUCK_CATEGORY_PROFILE_LABELS`**: a troca tocaria `billing-document-previews.tsx`, e o `b6f64ccd` (F8) deixaria de ser revertível sozinho. Fica para quando o dono decidir o F8; a catraca do web já o conta.
2. **O `build` do web não mudou** para `build:with-tsc`: trocar o passo de quem já faz o deploy sem avisar é arriscado. O `pre-deploy.sh` do web roda o `tsc -b` e o resumo lembra "deploy: `pnpm run build:with-tsc`". Decidir no runbook do deploy.
3. **G6b não vê JSX solto** (`<span>Truck do cliente</span>`): não é literal. Nem o literal que é só o identificador (`'Implement'`), que é também nome de modelo em consulta.
4. **G15 não segue variável**: `const d = { leftSideMeasureId: x }; tx.truck.create({ data: d })` passa (a chave não está dentro da chamada nem tem operação aninhada). O caso `payload = { face: { connect } }` é pego.
5. **Duas formas reais do web dão 500 em produção hoje** (R-B-11, sem G1 nessas rotas): a edição de colaborador pede `include.tasks` em `GET /users/:id` (User não tem `tasks`) e a edição de item filtra `where.measures.some.AND[].type` (Measure não tem `type`). Não corrigido (Fase A = sem mudança de comportamento); catalogado em `FORMAS_QUEBRADAS_CONHECIDAS` do G4 para o dono das telas.
6. **Clone do banco derivado**: 14 coletas RUNNING de 20–21/09 congelaram uma arte que os orçamentos 611–630 já não têm (editados depois no próprio clone). O ouro "antes" do P12 no clone tem só 3 envelopes; **regravar `build-base.json` depois de renovar o clone** (`GRAVAR_BASE_BUILD=1`).
7. **F4/F9 portados para `patch/p02-sobre-1.4.1+24`** (o patch do app instalado sai de lá): `8228a14` e `b534afa`, com um conflito resolvido no assistente de orçamento (na tag, ele cria UMA tarefa).
8. O `--recomando` do guard e a exceção com vencimento viraram parte do contrato da catraca (api, web e app têm o mesmo script).

## Bloqueadores

- **F8**: ok explícito do dono para a palavra da prévia do boleto antes de publicar o web (ou reverter só o `b6f64ccd`).

## Testes (a régua)

- api `bash scripts/pre-deploy.sh` → **23/23 verdes** (G0 src 0 / tests+scripts 138 = base; G6 1.782/39; G4 207 ok; G10 10 ok; G11 11 ok; G15 179; G21 102; G5 com as cópias; G4 do web em dia).
- web `pnpm exec tsc -b` → 0; `bash scripts/pre-deploy.sh --rapido` verde; vitest `client-header`, `solicitacao-schema`, `document-labels`, `implement-faces`, `billing-coverage`, `quote-customers`, `lib/attention/engine` → 180/180.
- app `flutter analyze` → sem problemas; `flutter test` de `task_json_contract`, `test/generated`, `test/core`, `nfse_discriminacao`, `billing_approval_plan`, `test/features/production`, `test/shared` (344) e `test/features/financial` (227) verdes; na branch do patch, `task_json_contract` + `test/core` + `test/features/financial` + `test/features/production` (265) verdes.
