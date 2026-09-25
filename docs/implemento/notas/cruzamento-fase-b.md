# Cruzamento da Fase B (P06..P14) — ordem, donos de arquivo, carimbos e integração dos pares

Nota da preparação da Fase B (23/09, Revisão 3.1 do plano). Lê junto com `P06.md`, `P10.md`, `P11a.md`, `P11b.md`, `P12.md`, `P13a.md`, `P14.md`, `P13b.md` e o §4.1 (protocolo de promoção) e §9 do `PLANO.md`. Objetivo: régua verde ao fim de **cada** pacote, dois agentes nunca no mesmo arquivo, e toda infraestrutura compartilhada com **um** dono por momento.

## Ordem

```
P06 ─▶ P10 ─▶ P11a ─▶ P11b            (sozinhos, checkout principal, commits na base feat/portal-do-responsavel)
  └─▶ [ P12 (checkout principal) ∥ P13a (worktree impl/p13a) ] ─▶ integração do par 1
        └─▶ P14 commit zero (checkout principal) ─▶ [ P14 (checkout principal) ∥ P13b (worktree impl/p13b) ] ─▶ integração do par 2
```

Banco: o checkout principal usa **sempre** `source …/scratchpad/implemento-env.sh` (`ankaa_implemento`); cada worktree usa o seu (`implemento-env-p13a.sh`, `implemento-env-p13b.sh`, já criados no scratchpad; apontam para `ankaa_implemento_p13a`/`_p13b`). Nunca `ankaa_production`, `ankaa_veiculos` nem as worktrees `/tmp/claude-1000/*/06e55e4d-*/`. `git worktree list` antes de qualquer faxina (há também um `web-mt` "prunable" de outra sessão: não mexer).

## Migrações: o protocolo e os carimbos

As fatias da R-B nascem **escritas e ensaiadas** no P10 em `prisma/staged/r-b/` e são **promovidas** (pasta para `prisma/migrations/`, blocos do `schema.alvo.prisma` para `schema.prisma`, `migrate deploy` + `generate`) pelo pacote cujo código as torna verdadeiras, no mesmo commit (§4.1). Última migração da `main`: `20260924190000` (merge de 24/09). **Re-carimbo de 24/09:** a `main` publicou `20260924120000`, `…120100` e `…120200` (aerografia), os mesmos carimbos das fatias; M0 e as seis fatias passaram a `20260930…` (os `_prisma_migrations` do `ankaa_implemento` e do `ankaa_implemento_base` foram renomeados junto). Regra: **no P30, antes do deploy, re-carimbar de novo para depois da última migração da `main` que estiver em produção** — um banco novo (teste, sombra) aplica na ordem lexical, e ela tem de ser a ordem da produção.

| Carimbo | Fatia | Escreve | Promove | Reserva para migração extra do dono |
|---|---|---|---|---|
| `20260930100000_arte_estados_e_tipos` | M0 | P06 | P06 (direto em `prisma/migrations/`) | `20260930100010`–`100090` |
| `20260930120000_truck_vira_implement` | M1 | P10 | P11a | — |
| `20260930120050_serie_no_implemento_e_implemento_obrigatorio` | M1s | P10 | P11a | `20260930120060`–`120090` |
| `20260930120100_implemento_frente_e_porta_traseira` (+ `_IMPLEMENT_PROJECT_FILES`) | M2 | P10 | P11b | `20260930120110`–`120190` |
| `20260930120200_arte_do_implemento_e_projeto_da_tarefa` | M3 | P10 | P12 | `20260930120210`–`120290` |
| — | — | — | P13a (só pela integração do par 1) | `20260930120295`–`120299` |
| `20260930120300_orcamento_eixo_da_assinatura` | M3o-a | P10 | P14 (commit zero) | `20260930120310`–`120340` |
| `20260930120350_orcamento_valor_aprovado` | M3o-b | P10 | P14 (fim) | `20260930120360`–`120390` |
| — | — | — | P13b (só pela integração do par 2) | `20260930120395`–`120399` |
| M4, M5s | R-D | P32 | P32 | datas da R-D |

Os carimbos estão na ordem de promoção: o banco da Fase B aplica as fatias na mesma ordem que a produção aplicará na R-B. Pacote de worktree **nunca** cria migração nem roda `migrate deploy` no banco do checkout principal.

## Par 1 — [P12 ∥ P13a]: donos de arquivo

| Arquivo / área | Dono no par | O outro faz como |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/staged/**`, `prisma/sql/**` | P12 | P13a não precisa de schema novo (M2 e M1s já estão na base); se precisar: para e reporta |
| `portal-identity.*`, `portal-request.*`, `portal-vehicle-identity.ts`, `portal-frozen-document.ts`, `schemas/portal-request.ts`, `schemas/portal-vehicle-identity.ts` | **P13a** | P12 não toca (nenhum deles cita `layouts`) |
| `portal-read.service.ts`, `portal-projection.service.ts`, `portal-notification.service.ts` | **P12** (só a fonte da arte e o destinatário do lembrete) | P13a não toca (a leitura de frente/porta/projeto já veio no P11b) |
| `src/modules/common/signature/**`, `src/modules/common/file/**`, `contracts/file-contexts.json`, `contracts/signature-golden/**` | P12 | — |
| `task.*`, `service-order.*`, `budget.*`, `src/modules/production/implement/**`, `src/utils/**`, `src/types/**`, `src/constants/**` | P12 | — |
| `prisma/scripts/seed-notification-configs.ts` | P12 (inclusive as chaves de arte que o P13b vai usar) | — |
| `tests/portal-{identificacao,requisicao,cliente-boot}.test.ts`, `tests/e2e-portal/**` | **P13a** | — |
| `tests/portal-recorte.test.ts`, `tests/{signature-golden-hashes,quote-diff,quote-merge-rules,signature-refusal,layout-per-vehicle,implement-layout}.test.ts` | P12 | — |
| `docs/PORTAL-CONTRATO.md`, `docs/PORTAL-DO-RESPONSAVEL.md` | **P13a** | P12 deixa o trecho da arte do orçamento na seção "Resultado" do `P12.md`; o integrador aplica |
| `package.json`, `scripts/pre-deploy.sh`, `.residual-baseline.json`, `.serial-allowlist` | P12 | P13a roda os testes com `npx tsx …`; o integrador registra as linhas |

## Par 2 — [P14 ∥ P13b]: commit zero e donos de arquivo

**Commit zero do P14** (checkout principal, **antes** do worktree do P13b; sem mudança de comportamento): promove a M3o-a (tipos, `BudgetValueApproval`, `BudgetOfflineSignature`, `Budget.signatureStatus` com o eixo calculado), espelhos TS e rótulos das duas enums novas (com "Assinada fora do sistema"), contratos + cópias, e o **rename D-35 inteiro** (capacidade, rota `/aprovar-valor`, `canApproveValue`, `waitingOnMe.valueApproval`) nos arquivos do portal e nos testes. Régua verde, commit, e só então o worktree do P13b nasce **desse** commit.

| Arquivo / área | Dono no par (depois do commit zero) | O outro faz como |
|---|---|---|
| `prisma/**` | P14 (M3o-b no fim) | P13b lê `signatureStatus`/`BudgetValueApproval` da M3o-a, que já está na base dele |
| `portal-capabilities.ts`, `portal-read.*`, `portal-projection.service.ts`, `portal.module.ts`, `portal-artwork.*`, `schemas/portal-artwork.ts`, `portal-notification.service.ts`, `scripts/seed-portal-demo.ts` | **P13b** (inclusive `signatureFacts` pelo eixo e o marco "Arte aprovada") | P14 não toca; o `emission` do portal entra na integração |
| `portal-decision*.ts`, `src/modules/common/signature/**` (inclusive `order-number-gate.ts`, `purchase-order-gate.ts`, `portal-signature.controller.ts`), `src/modules/production/budget/**`, `billing.*`, `attention.service.ts`, `service-order.service.ts`, `task.service.ts`, `schemas/{budget,task,signature}.ts`, `src/utils/**`, `src/constants/**`, `src/modules/common/file/**`, `contracts/file-contexts.json` | **P14** | P13b não toca; o `ImplementLayoutService` (P12) é só **usado** pelo P13b |
| `prisma/scripts/seed-notification-configs.ts` | P14 | P13b usa as chaves de arte que o P12 criou |
| `tests/{portal-recorte,portal-cliente-boot,portal-arte}.test.ts` | **P13b** | — |
| `tests/{portal-decisao,portal-assinatura-compras,budget-*,emission-gate,offline-signature,orcamento-sem-os-negociacao,billing-status}.test.ts`, as linhas do gate em `tests/portal-identificacao.test.ts`, `tests/e2e-portal/cenarios/03*` | **P14** | — |
| `docs/PORTAL-CONTRATO.md`, `docs/PORTAL-DO-RESPONSAVEL.md` | **P13b** | P14 deixa o trecho (aprovar valor, recusa → `PENDING`, `orderNumber` da cerimônia do portal) na seção "Resultado" do `P14.md` |
| `package.json`, `scripts/pre-deploy.sh`, `.residual-baseline.json`, `.serial-allowlist` | P14 | P13b roda com `npx tsx …`; o integrador registra |

## Arquivos gerados: a única exceção à disjunção

`contracts/labels.json`, `contracts/enums.json` e `.residual-baseline.json` são **gerados**. O pacote do worktree pode regerar os dois JSON no próprio ramo quando a régua dele exigir (campo multipart novo, chave nova); **conflito neles nunca se resolve à mão**: na integração, depois do merge, roda-se `npx tsx scripts/export-contracts.ts --irmaos` (e `bash scripts/guard-residual.sh --update`) sobre a combinação e o resultado é o que fica. As cópias no web (`src/generated/contracts/*.json`) e no app (`lib/generated/contracts/labels.dart`) só são escritas por quem está no **checkout principal** (o worktree não tem irmãos: o `--irmaos` pula) e são commitadas nos repositórios irmãos (web `feat/portal-do-responsavel`, app `feat/implemento`) com a mensagem "Contrato gerado da api em dia (Pxx)"; depois, conferir `pnpm exec vitest run src/constants/document-labels.test.ts` no web e `flutter test test/generated` no app. **Contrato só cresce na Fase B**: nenhuma chave que o web ou o app leem hoje some (`TRUCK_CATEGORY`, `IMPLEMENT_TYPE`, os perfis) antes do P20/P24/P32.

## Preparar um worktree (P13a; o P13b é igual, trocando os nomes)

```sh
git -C /home/kennedy/Documents/repositories/api worktree list          # antes de tudo
WT=/tmp/claude-1000/-home-kennedy-Documents-repositories/b5b01fad-1ec2-4773-82be-b392a838e016/scratchpad/wt/p13a/api
git -C /home/kennedy/Documents/repositories/api worktree add -b impl/p13a "$WT" feat/portal-do-responsavel
# node_modules PRÓPRIO (cópia real, ~870 MB no tmpfs; NUNCA symlink): o cliente Prisma do pnpm mora dentro de
# node_modules/.pnpm/@prisma+client…/node_modules/.prisma e o P12 o regera no meio do par.
cp -a /home/kennedy/Documents/repositories/api/node_modules "$WT/node_modules"
cp /home/kennedy/Documents/repositories/api/.env "$WT/.env"                 # ignorado pelo git
# banco PRÓPRIO: cópia do ankaa_implemento (ninguém conectado nele neste instante; ligado no banco "postgres")
source …/scratchpad/implemento-env.sh
echo 'CREATE DATABASE "ankaa_implemento_p13a" TEMPLATE "ankaa_implemento";' \
  | npx prisma db execute --stdin --url "${DATABASE_URL%/ankaa_implemento}/postgres"
cd "$WT" && source …/scratchpad/implemento-env-p13a.sh && npx prisma generate && npx prisma migrate status
```

O P13a cria o worktree **antes** do primeiro commit do P12 (os dois partem do mesmo commit, o fim do P11b). O P13b cria o dele **depois** do commit zero do P14.

## Integração de cada par (depois que os dois pacotes fecham a própria régua)

1. Conferir a disjunção: `comm -12 <(git diff --name-only <base>..feat/portal-do-responsavel | sort) <(git diff --name-only <base>..impl/p13a | sort)` só pode listar os gerados acima.
2. No checkout principal: `git merge --no-ff impl/p13a` (**nunca** rebase); gerados → regerar.
3. Registrar as linhas de teste do pacote do worktree em `package.json` e no bloco dele do `scripts/pre-deploy.sh`; aplicar os trechos de contrato deixados nas notas.
4. **Só no par 2:** ligar o `emission` no orçamento do portal (`emissionOf` do P14 em `portal-read.service.ts`, com a faixa "Para emitir falta…" em linguagem de cliente e um teste) e rodar `bash scripts/check-schema-target.sh --final` (G36 vazio); apagar `prisma/staged/r-b/`.
5. `npx prisma generate`, `migrate status` limpo no `ankaa_implemento`, régua inteira na combinação e **a revisão única sobre a combinação**.
6. Faxina: `git worktree remove "$WT"`, `DROP DATABASE "ankaa_implemento_p13a"` (ligado em `postgres`), apagar a cópia do `node_modules` com o worktree. Nada de `git push`.

## Dono único de cada infraestrutura compartilhada (Fase B)

| Infraestrutura | Dono | Quem só lê/usa |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/sql/objetos-pos-push.sql` | quem promove (P06, P11a, P11b, P12, P14); nos pares, só o checkout principal | todos |
| `prisma/staged/r-b/**` (fatias e alvo), ensaio, G36 | P10 (cada pasta de fatia passa ao promotor) | todos |
| `package.json`, `scripts/pre-deploy.sh` | o pacote sozinho da vez; nos pares, o do checkout principal; entradas do worktree pelo integrador | — |
| G1/`DEPRECATED_QUERY_KEYS`, tradutor, espelho de resposta | P11a → P12 (layouts, layoutFiles) → P14 (`PRE_APPROVED` peneirado) | — |
| `ImplementMeasureWriter`, `implement-faces.ts` | P11b | P13a |
| `ImplementLayoutService`, `quote-artwork.ts` | P12 | P13b, P14 |
| `assertEmissionReady`/`emissionOf`, `isBillableSignatureStatus`, `orderNumberRequirement` | P14 | integrador do par 2 (portal) |
| `export-contracts.ts` e `contracts/**` | quem muda enum/rótulo/multipart/contexto/seed (regenera no mesmo commit) | web, app |
| censo (G3) e `req.appVersion` | P06 | P11a (contador), P11b (cotador) |

## CPU e testes

A máquina divide CPU com 5 runners de CI. Em primeiro plano, um de cada vez; cada pacote roda os testes dele durante o trabalho e a régua inteira **uma vez** no fim (e de novo só se algo mudou). No par, os dois agentes não rodam a régua inteira ao mesmo tempo: quem termina primeiro roda a dele; o outro espera o fim daquela execução.
