# Cruzamento da Fase A (P01..P05) — colisões e dono único

Nota do P00 (23/09). Lê junto com `P01.md` … `P05.md` e o §9 do `PLANO.md` (Revisão 3). Objetivo: dois agentes nunca editam o mesmo arquivo ao mesmo tempo, e toda infraestrutura compartilhada tem **um** dono por fase.

## Ordem de execução

```
P01 (api, sozinho)
  └─▶ P02 (app, feat/implemento)  ∥  P03 (web, feat/portal-do-responsavel)
        └─▶ P04 (api, checkout principal, commits na base)  ∥  P05 (api no worktree impl/p05-rotulos; web e app no checkout principal)
              └─▶ integração: merge de impl/p05-rotulos na base + as entradas de package.json/pre-deploy do P05 + revisão única sobre a combinação
```

- **Repositórios por fase.** Fase 1: só api. Fase 2: P02 só app; P03 só web (+ **um** arquivo gerado na api, `contracts/queries/web.json` — nenhum agente de api está rodando). Fase 3: P04 só api (checkout principal); P05 api no worktree, web e app no checkout principal — o P04 não toca web nem app.
- **Worktree do P05 (api).** Criado por quem inicia o P05, do **mesmo commit** da base em que o P04 começa (antes do primeiro commit do P04): `git -C /home/kennedy/Documents/repositories/api worktree add -b impl/p05-rotulos /tmp/claude-1000/-home-kennedy-Documents-repositories/b5b01fad-1ec2-4773-82be-b392a838e016/scratchpad/wt/p05/api feat/portal-do-responsavel`; depois `ln -s /home/kennedy/Documents/repositories/api/node_modules node_modules` dentro dele (o P05 não muda dependência nem schema). **Nunca** tocar as worktrees da outra sessão (`/tmp/claude-1000/*/06e55e4d-*/…`); rodar `git worktree list` antes de qualquer faxina.
- **Banco local.** Só o P04 escreve no clone (G15 cria e apaga o que usa). O P01 usa o clone em transação revertida (G4). O P05 não usa banco (testes puros). Nenhum pacote da Fase A roda `migrate`/`db push`.
- **CPU.** A máquina divide com 5 runners de CI: cada pacote roda só os testes dele (listados na nota), nunca a bateria inteira.

## Colisões encontradas e como ficaram

| # | Colisão | Onde | Resolução |
|---|---|---|---|
| C1 | P04 e P05 (api) acrescentariam scripts de teste ao **`package.json`** e linhas ao **`scripts/pre-deploy.sh`** | api | **Dono na fase 3: P04.** O P05 roda os testes dele com `npx tsx tests/…` e registra as entradas (`test:fiscal-labels`, `test:labels-exhaustive`, `contracts:export`) **na integração**. Assim os dois ramos são disjuntos em arquivo |
| C2 | A constante de faces da API: o P04 precisa dela (writer) e o G5 do P05 queria exportá-la | api `src/constants/implement-faces.ts` | **Dono: P04.** O P05 **não** exporta faces na Fase A (o arquivo não existe no worktree); faces entram no G5 no P11, com `'front'` |
| C3 | `src/schemas/task.ts`: o P01 apaga `:634-1094` e mexe nos schemas de consulta; o P04 tira a cópia do zod de medida `:2524-2541` | api | Sequencial (P01 na fase 1, P04 na fase 3): sem colisão. Dentro da fase 3, **só o P04** edita `schemas/task.ts` |
| C4 | `task.service.ts`: o P04 (escritores #1–#6); o P05 lê rótulos? | api | O P05 **não** edita `task.service.ts` (os rótulos fiscais não moram nele). Dono na fase 3: P04 |
| C5 | Dicionários de rótulo lidos pelo writer (changelog de medida em `implement-measure-replication.ts`) × fonte única do P05 | api | O writer não usa rótulo de tipo/categoria; `implement-measure-replication.ts` é do P04 e o `enum-labels.ts` é do P05. Nenhum dos dois edita o arquivo do outro |
| C6 | `contracts/`: o P01 cria `contracts/queries/**` (G4); o P05 cria `contracts/{labels,enums}.json` (G5); o P03 gera `contracts/queries/web.json` | api | Pastas/arquivos distintos. **Donos:** `contracts/queries/` estrutura + `ankaa-aero.json` + sementes → P01; `contracts/queries/web.json` → P03 (fase 2); `contracts/{labels,enums}.json` + `scripts/export-contracts.ts` → P05 (fase 3) |
| C7 | Rótulos no web: o P03 renomeia vocabulário ("layout" = medidas) e o P05 troca a origem dos rótulos | web | Sequencial (P03 fase 2, P05 fase 3). O P03 **não** toca `enum-labels.ts`, `changelog-fields.ts`, `billing-document-previews.tsx` nem `utils/nfse-discriminacao.ts` (donos: P05) |
| C8 | App: o P02 mexe em modelos e rede; o P05 em enums de rótulo | app | Sequencial (fase 2 × fase 3) e arquivos distintos: `task.dart`, `budget.dart`, `billing_task.dart`, `dio_client.dart`, `api_exception.dart`, `ota/native_update_service.dart` → P02; `task_enums.dart` (os dois), `nfse_discriminacao.dart` → P05 |
| C9 | Portal: o P04 mexe nos blocos de medida de `portal-identity.service.ts` e `portal-request.service.ts` | api | Só o P04 na fase 3. O P05 não toca `src/modules/people/portal/**` |
| C10 | Tela de N veículos da `main` (web) e `implement-measure-replication.ts` (api) vieram no merge do P00 | web/api | Web: **ninguém** da Fase A a edita (fica para o P22). Api: dono P04 (é o 10º escritor de medida) |

**Conferência de disjunção na integração (obrigatória antes do merge):**
`comm -12 <(git diff --name-only <base-do-P04>..feat/portal-do-responsavel | sort) <(git diff --name-only <base-do-P04>..impl/p05-rotulos | sort)` tem de sair **vazio**. Se aparecer arquivo, o dono é o da tabela abaixo e o outro pacote desfaz a sua mudança nele.

## Dono único de cada infraestrutura compartilhada (Fase A)

| Infraestrutura | Dono | Quem só lê/usa |
|---|---|---|
| G0 (`tsconfig*.json`, `typecheck`, `noEmitOnError`) | P01 | todos |
| G1 (`src/modules/common/query/**`, `DEPRECATED_QUERY_KEYS`), `INCLUDE_WHITELIST`, filtro global de exceção | P01 | P04, P05 |
| G4 harness (`tests/query-contract.test.ts`, `contracts/queries/` + `ankaa-aero.json`) | P01 | P03 (gera `web.json`) |
| G6a/G6b (`guard-residual.sh`, baseline, allowlist) | P01 | todos (a catraca só cai) |
| `package.json` e `scripts/pre-deploy.sh` da api | P01 (fase 1) → P04 (fase 3) → integrador (entradas do P05) | P05 |
| `src/constants/implement-faces.ts` (api) | P04 | P05 (não usa na Fase A), P11 |
| `ImplementMeasureWriter` e o zod de medida (`schemas/implement-measure.ts`) | P04 | P11, P13a |
| Fonte única de rótulos (`src/constants/{enum-labels,document-labels}.ts`) e os 4 dicionários fiscais | P05 | P28 |
| G5 (`scripts/export-contracts.ts`, `contracts/{labels,enums}.json`) e G21 | P05 | P20, P24, P28 |
| Cabeçalho `X-App-Version`/`X-App-Patch` (app) | P02 | P06 (API lê) |
| Cabeçalho `X-Client` (web) e `web/src/constants/implement-faces.ts` | P03 | P06, P21 |
| Extrator G4 do web (`web/scripts/extract-query-contracts.ts`) | P03 | P20 |

## O que continua fora da Fase A (para não escorregar para dentro)

Schema Prisma, migrações, qualquer chave nova de API (`implement`), rótulo novo de tela, a face frontal, a porta traseira, `signatureStatus`, `BudgetValueApproval`, o portão da cobrança (DD7) e o da arte (DD3/DD9/DD10): tudo isso é Fase B (P06 em diante). A Fase A termina com **nenhuma mudança de comportamento** para o web em produção e o app 1.4.1 instalado, salvo as correções nomeadas nas notas (500 → 400 do G1; cópia em vez de medida compartilhada no P04; A7/A12 e defaults "Refrigerado" vazios no P03; defaults vazios, leitura tolerante e cabeçalhos no P02 — a tela de 426 só aparece quando a API a mandar, na R-C).
