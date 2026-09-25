# Rework Implemento — ESTADO (24/09/2026, noite)

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

## 2. Onde está o trabalho (tudo LOCAL, nada foi enviado ao GitHub nem a produção)

| Repo | Branch | Situação |
|---|---|---|
| api | `feat/portal-do-responsavel` | main de 24/09 juntada (`2e38b63c`); fatias re-carimbadas para `20260930…`; P11a (`1772c328`) + nomenclatura completa DD13 (`fdd3588d`). Régua 23/26: G1+G4, G10 e G5 esperam o web migrado |
| web | `feat/portal-do-responsavel` | main de 24/09 juntada (`17ff1c04`); migração de nomenclatura em andamento (agente) |
| app | `feat/implemento` | main (1.4.2+25) juntada; nomenclatura completa no app e no AnkaaAero (`856c2a3`, `901681e`, `1391b83`); catraca 0, analyze limpo, 1045 testes |
| app | `patch/p02-sobre-1.4.1+24` | OBSOLETO com a DD13 (era o patch de compatibilidade) |
| api | `wip/p11a-parcial-20260923` | já incorporada; pode ser apagada |

Bancos locais (container `ankaa-postgres`):

- `ankaa_implemento`: banco da Fase B. Tem M0 + M1 + M1s + a nomenclatura (`20260930120060`) + as 6 migrations da main de 24/09.
- `ankaa_implemento_base`: a base (main + M0), criado em 24/09 para separar defeito do merge de defeito do P11a. Pode ser apagado.
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
- App e AnkaaAero migrados (agente). Web em andamento (agente).

## 4. O que FALTA (na ordem)

**Antes de tudo (DD13):** fechar a nomenclatura no web (agente), regerar `contracts/queries/web.json` e as cópias do contrato (web e app), conferir os ids de preferência do web contra a migração `20260930120060` (§5 dela), régua da api verde e as réguas do web e do app. Depois, os testes que faltam do P11a: G19 (escritores da série), G20 (toda criação com implemento), G22 (contexto de aviso com série), G23 (agora: corpo novo do app grava a série no implemento), G24 (catraca dos leitores da série), G32 (URL da Agenda), busca de tinta por placa e série. **Pendente com o dono: a série no topo e o espelho `Task.serialNumber` (ver §5).**

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

0. **Série no topo e espelho `Task.serialNumber` (DD13 × DD1).** Com "nenhum valor antigo", o corpo com série no topo (`serialNumber` fora de `implement`) e a coluna-espelho `Task.serialNumber` (gatilho da M1s) são compatibilidade. Tirar os dois agora = migrar ~500 leitores na api, ~430 no web e ~100 no app, e derrubar a coluna (M5s) na mesma release. Mantê-los = a série só se ESCREVE no implemento, mas se LÊ também pela tarefa. Decisão do dono.

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
- O app instalado e o **AnkaaAero** continuam mandando `truck`, `task.serialNumber` e o `orderBy` da Agenda por série. As fixtures do G4 são a prova de que isso segue funcionando.
- `dart format` global reformata 211 arquivos: nunca rodar.
