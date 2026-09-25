# PLANO ÚNICO (Revisão 3.1) — Implemento: Truck vira Implement, a arte e a série vão para o implemento, e o orçamento ganha a aprovação do valor

Data: 23/09/2026. **Revisão 2** no mesmo dia, depois das decisões do dono (DD1..DD6, bloco abaixo). **Revisão 3.1** (fim da Fase A e preparação da Fase B, mesmo dia): DD11, DD12 e a confirmação da DD10 entraram no **corpo** do plano (D-15, D-28, D-30, D-34, §2A, §3, §4, §5, §6, §8, §9, §11, §12) — não resta "pergunta 25/26 em aberto" nem "confirmar a DD10"; o valor **`SIGNED_OFFLINE`** com o registro **`BudgetOfflineSignature`** (DD11) e o **predicado único do pedido de compra** (DD12) estão desenhados; a Fase B ganhou o **protocolo de promoção das fatias de migração** (§4.1) e a divisão de donos dos pares em `notas/cruzamento-fase-b.md`. **Revisão 3** (P00, mesmo dia): a base absorveu a `main` do deploy de 23/09, os números decisórios passaram a ser os de **produção** (`P00-producao.md`) e entraram as decisões **DD7..DD10**, com a **DD6 reescrita** (a obra da outra sessão já está em produção: caminho de contingência). Consolida os onze relatórios de mapeamento desta pasta `docs/implemento/` — `01-dados-e-migracao.md` … `07-contratos-invisiveis.md` (v1) e `08-estado-orcamento-api.md`, `09-estado-orcamento-clientes.md`, `10-serie-api.md`, `11-serie-clientes.md` (Revisão 2) — e a conferência que fiz no código onde eles divergiam. Até a Revisão 2 era **somente plano**. No P00 (Revisão 3) houve só o merge da `main` na base (api e web), a branch nova do app e a medição de produção **somente leitura**; nenhum código do rework foi escrito.

**Repositórios e branches**

| Repo | Caminho | Branch | HEAD lido |
|---|---|---|---|
| API | `/home/kennedy/Documents/repositories/api` | `feat/portal-do-responsavel` | Revisão 2: `ad3c65d4`. **P00: `cd61b7d1`** = merge da `main` `4fed4b13` (deploy de 23/09; a branch não está mais atrás da `main`) |
| WEB | `/home/kennedy/Documents/repositories/web` | `feat/portal-do-responsavel` | Revisão 2: `989c9f6e`. **P00: `051a5c04`** = merge da `main` `ebec27f9` |
| APP | `/home/kennedy/Documents/repositories/mobile-flutter` | **`feat/implemento`** (criada no P00 a partir de `origin/main`, sem upstream, para nenhum push cair na `main`) | `9335286` (versão `1.4.1+24`, Shorebird; `shorebird.yaml` versionado na raiz). O mesmo repositório tem o app nativo **`AnkaaAero/`** (iPad iOS 12.5 da aerografia), que também chama a API (§5.4, §6.7) |
| RN antigo | `/home/kennedy/Documents/repositories/mobile` | — | morto: mesmo bundle id do Flutter, último commit em 14/08 (§6.7) |

**Convenções.** **FATO**: li no código ou no dado, e cito `arquivo:linha` (⚠️ as linhas citadas são do HEAD da Revisão 2; depois do merge do P00 os arquivos grandes da API — `budget.service.ts`, `signature-envelope.service.ts`, `task.service.ts` — andaram algumas centenas de linhas: localizar pelo nome da função). **INF**: é inferência. **DECIDIDO (DDn)**: decisão do dono de 23/09 (bloco da Revisão 2). **[pergunta N]**: depende da pergunta N do §12; o plano segue a recomendação dada até o dono dizer outra coisa. Caminhos sem prefixo são relativos à raiz de cada repositório: `src/…` é da API quando a tabela é de API e do web quando é de web; o app usa `lib/…` e `test/…`. Números "no clone" vêm do banco local, que tem dado real **só até ~30/06/2026**. **Revisão 3:** os números decisórios foram medidos em **produção** em 23/09 (`P00-producao.md`) e o texto cita "produção" onde trocou; os que continuam "no clone" não foram medidos lá ou só servem de histórico. Todos são refeitos no ensaio (§4.6).

**Mapa de pastas da API** (para achar os arquivos citados só pelo nome):
`src/modules/production/{truck,implement-measure,task,budget,layout-dimensions,service-order,airbrushing,purchase-order}/`, `src/modules/people/portal/` (todos os `portal-*.ts`), `src/modules/common/signature/{services,document,dossier}/` + `src/modules/common/signature/quote-sections.ts`, `src/modules/common/file/{file.service.ts,file.controller.ts,services/}`, `src/modules/common/base/{include-access-control.ts,include-mapper.helper.ts}`, `src/modules/common/notification/`, `src/modules/integrations/{nfse,sicredi}/`, `src/modules/financial/{invoice,billing,reconciliation}/`, `src/modules/domain/{dashboard,search}/`, `src/utils/`, `src/schemas/`, `src/types/`, `src/constants/`.

---

## Revisões 2 e 3 (23/09) — decisões do dono

As decisões abaixo valem **sobre** o v1 (DD1..DD6, Revisão 2) e **sobre a Revisão 2** (DD6 reescrita e DD7..DD10, Revisão 3). Onde o v1 dizia outra coisa, o texto foi reescrito no lugar (não há duas verdades no documento). O que o v1 recomendava e o dono não tocou continua valendo (DD5).

| # | Decisão do dono | O que muda em relação ao v1 | Onde |
|---|---|---|---|
| **DD1** | Implemento 1:1 com a tarefa **e toda tarefa tem exatamente 1 implemento**. O **número de série** vai para o implemento | Cai a D-02 do v1 ("a série fica na tarefa"). Nasce a migração **M1s** (entre M1 e M2): cria o implemento das **1.678** tarefas sem `Truck` (todas COMPLETED, com `spot NULL`), move a série para `Implement.serialNumber` com `@unique`, coluna gerada e GIN, deixa `Task.serialNumber` como **espelho somente leitura por gatilho** até a R-D e instala a garantia "toda tarefa tem implemento" com `CONSTRAINT TRIGGER` diferido. O passo 1b da M3 vira no-op. `PUT /tasks` com `truck: null` passa a 400. `Implement.spot` perde o `@default(YARD_WAIT)`. Nasce a **M5s** (R-D), que derruba o espelho | D-01, D-02, D-03; §3.1; §4.2 (M1s); §4.3 (M5s); §5.2; §6.13 |
| **DD2** | O orçamento ganha **aprovação do VALOR**, que pode vir **antes** da arte. Para **emitir** as assinaturas, valor **e** arte têm de estar aprovados. A emissão tem **estado próprio**. **A assinatura continua existindo** e leva a arte | Cai a D-14 do v1 inteira: não há snapshot v5, recorte v8 nem `tolerateDetachedLayout`; `LAYOUT` continua alternável e o MARKETING continua assinando `LAYOUT`. Modelo escolhido: **C** — `APPROVED` passa a ser "valor aprovado" (é a frase do dono: "orçamento aprovado será antes") e a assinatura ganha **eixo próprio**, `Budget.signatureStatus` (mesmo movimento do `Billing.status` de 16/09). `PRE_APPROVED`, que nunca foi a produção, é apagado. Portão único de emissão (`assertEmissionReady`: valor ∧ arte de cada implemento). A arte entra na assinatura **na v7, sem versão nova**, como a união dos `File.id` da arte aprovada dos implementos, e o passo 5 da M3 é reescrito para **preservar os `File.id`** (regras M-A..M-D). Nasce a migração **M3o** (estados do orçamento). `Budget.layoutFiles` continua saindo (o orçamento não seleciona arte: ela vem do implemento) | §2A (nova); D-13, D-14, D-26..D-36; §3; §4.3 (M3 passo 5 e M3o); §6.2; §6.14; §7.6 |
| **DD3** | Arte não aprovada **trava a liberação para produção, só em trabalho novo**; a aprovação no portal conclui a O.S. "Aprovar com o Cliente" quando ela existir | D-15 e a antiga pergunta 22 viram DECIDIDO: o portão fica na **regra de liberação**, não em cada O.S. de ARTE | D-15; §6.2; §7.1 |
| **DD4** | Porta traseira: **varões 2, 3 ou 4 no total**; **portinholas 0 a 6, só quantidade**; bipartida/tripartida é **preset** das folhas da traseira | D-06 vira DECIDIDO; a antiga pergunta 5 sai | D-06; §3.3 |
| **DD5** | As demais recomendações do §12 do v1 valem: quem aprova arte (MARKETING, COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR; **não** PURCHASING); a Furgões pagadora pode aprovar; aprovar em nome do cliente com nota obrigatória; janela bilíngue + `X-App-Version`/426; medida não compartilhada; layout de orçamento APPROVED vira arte APPROVED e os pendentes `PENDING_APPROVAL`; frente com foto opcional; o responsável não edita medida depois de `IN_PRODUCTION`; a nota fiscal não muda de palavra até o dono escolher | Todas as perguntas do §12 do v1 saem (respondidas). D-03, D-05, D-07, D-09..D-12, D-17, D-18, D-20..D-22, D-24, D-25 viram DECIDIDO. Na D-18, "não mudar palavra" quer dizer **cada documento continua com o texto de hoje** (hoje eles divergem entre si) | §2.2; §12 |
| **DD6** (reescrita na Revisão 3) | API e web na branch `feat/portal-do-responsavel`; o app numa **branch nova a partir da `main`** (`feat/implemento`). A `feat/orcamento-veiculos` **já está na `main` e em produção** (deploy de 23/09, api `4fed4b13`): `Budget.layoutScope` (`SHARED`/`PER_VEHICLE`) e `BudgetLayoutTask` existem em produção. Vale o **caminho de contingência**: `BudgetLayoutTask` é **fonte** da migração da arte do orçamento; `quoteArtworkOf` e o snapshot **honram `layoutScope`**; o G11 inclui envelopes `PER_VEHICLE`. **A tela de N veículos da `main` fica**; perde só o seletor de layout por veículo (P22) | D-16 reescrita: não é mais "se chegar", é o estado de produção. A `main` foi absorvida no P00 (merge `cd61b7d1` na api, `051a5c04` no web). Em produção, às 15:17 de 23/09, **0** orçamentos `PER_VEHICLE` e **0** linhas em `BudgetLayoutTask` (`P00-producao.md` §3): o número real só no ensaio (P30). A M3 passo 5 **lê** `BudgetLayoutTask` sempre que `layoutScope = PER_VEHICLE` (deixa de ser condicional); o builder emite `layoutCoverage` quando `layoutScope = PER_VEHICLE` **ou** a cobertura não é uniforme | D-16; §2A.9; §4.3 (M3 passo 5); §6.2; §6.5; §9 (P12, P22) |
| **DD7** (Revisão 3) | **Cobrança só depois de assinado.** Aprovar a cobrança (fatura, NFS-e, boleto) exige `Budget.status = APPROVED` **e** `signatureStatus = SIGNED` (ou `SIGNED_OFFLINE`, DD11). O legado migrado como `WAIVED` continua faturável. O ato manual "Assinado fora do sistema" **existe** desde a Revisão 3.1 (DD11) | Cai a D-30 ("a cobrança abre no valor aprovado") e a pergunta 3. O portão da cobrança ganha a condição `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}` no ponto único que já existe (`budget.service.ts` `internalApprove`, a checagem `status === APPROVED`, `:4229` depois do merge do P00). Sai o ato manual "Dispensar assinatura" (`PUT /budgets/:id/signature-waiver`): `WAIVED` só nasce na migração e na conciliação (D-34). Produção: dos 536 aprovados, 504 sem coleta viram `WAIVED` (faturáveis) e 30 com COMPLETED viram `SIGNED`; **o nº 885** (coleta vencida, cobrança pendente) fica travado até reassinar — triagem `LEGACY_APPROVED_UNSIGNED` | D-28, D-30, D-34; §2A.2, §2A.4, §2A.8; §4.3 (M3o); §5.1; §7.6; §8 (G34); §12 |
| **DD8** (Revisão 3) | **Editar o valor depois de aprovado: mantém como hoje.** O "fixar Aprovado" do assistente **fica**; **não há** revogação por hash do valor. A coleta emitida continua sendo invalidada por mudança material, como hoje | Cai a pergunta 5. Saem `commercialTerms()`, `reassessValueApproval`, `termsSha256`/`termsVersion` e o script pós-migração do hash; a G30 é retirada. "O valor mudou?" continua com a resposta de hoje (`hasValueAffectingChange` + o auto-revert de `budget.service.ts` e o gêmeo de `task.service.ts`, respeitando o status fixado pelo chamador). `BudgetValueApproval` continua como **registro** (quem, quando, origem, nota, total); a vigente é fechada (`revokedAt`) quando o orçamento **sai** de `APPROVED` por qualquer caminho de hoje | D-27; §2A.2, §2A.5, §2A.6; §3.1; §4.3 (M3o); §5.2; §6.14; §8 |
| **DD9** (Revisão 3) | **Não existe "Dispensar arte".** Todo serviço tem arte (até a pintura geral manda a arte do baú na cor). O portão E2 não tem dispensa; só trabalho novo é travado | Cai a D-33 inteira e a metade "arte" da pergunta 11: saem `Implement.artworkWaived*`, a rota `PUT/DELETE /implements/:id/artwork-waiver`, o CHECK e o rótulo "Dispensada" da arte. E2 e o portão de liberação (D-15) exigem arte `APPROVED`, sem alternativa | D-15, D-29, D-33; §1; §2A.7; §3; §4.3 (M3); §5.1; §7.1; §7.6; §7.7; §8 (G28) |
| **DD10** (Revisão 3) | **A liberação manual "Disponibilizar para produção" respeita a arte** (recomendação do plano, **confirmada pelo dono na Revisão 3.1**) | A pergunta 23 vira decisão. Sem dispensa (DD9), não há "saída registrada" para furar o portão: quem precisa liberar sem a arte do cliente aprova "em nome do cliente" (nota obrigatória) | D-15; §6.2; §9 (P12); §12 |
| **DD11** (Revisão 3.1, respostas do dono em 23/09 à tarde) | **Existe o ato "Assinado fora do sistema"** (resposta à pergunta 25): COMMERCIAL/ADMIN registram que o cliente assinou por fora (papel, WhatsApp), com **nota e anexo obrigatórios** (foto ou PDF da assinatura); o eixo da assinatura passa a um estado que **libera a cobrança** como `SIGNED`, mas distinguível dele na tela ("Assinada fora do sistema") e na trilha. O nº 885 sai da triagem por esse caminho | **Desenho (Revisão 3.1):** valor novo **`SIGNED_OFFLINE`** em `BudgetSignatureStatus` (rótulo "Assinada fora do sistema"), que libera a cobrança como `SIGNED` e é distinto dele na tela e na trilha. Escolhido contra "`SIGNED` com `source = OFFLINE`" porque cada leitor de `SIGNED` (G29, "Falta a Ankaa → Assinada", o selo, o filtro) passaria a ter de olhar uma segunda coluna para não mentir; um valor próprio faz o `tsc`/a exaustividade (G5, G31) apontar cada lugar. O ato é `POST /budgets/:id/offline-signature` (COMMERCIAL/ADMIN; multipart com **um** anexo, PDF ou imagem, e `note` obrigatória; `signedAt` opcional); grava o registro append-only **`BudgetOfflineSignature`** (anexo em `File` com FK `Restrict`, nota, autor `User`, `revokedAt`) e a linha de `ChangeLog` do eixo com a nota como motivo, na mesma transação. Exige o valor aprovado (E1) e nenhuma coleta viva ou concluída (E3). Se o orçamento **sai** de `APPROVED`, o eixo vai a `INVALIDATED` e o registro é fechado. O tipo e a tabela nascem na **M3o-a** (§4.1); o ato é do **P14** | D-28, D-30, D-34; §2A.2, §2A.4, §2A.5, §2A.8; §3.1; §4.3; §5.1; §8 (G29, G34); P10, P14 |
| **DD12** (Revisão 3.1) | **Pedido de compra na assinatura: vale a regra da `main`** (resposta à pergunta 26): **quem TEM o papel PURCHASING** (mesmo acumulando outros) só assina informando o nº do pedido de cada veículo, **nas duas cerimônias** (página pública OTP e sessão do portal). O `purchase-order-gate` da branch (só quem é SÓ Compras) passa a seguir a regra da `main` | **Desenho (Revisão 3.1):** um predicado em `src/modules/common/signature/order-number-gate.ts` — `orderNumberRequirement({ roles, tasks })`: **sujeito** = `roles` contém `PURCHASING` (`signerRequiresOrderNumber`, o da `main`); **escopo** = as tarefas vivas do orçamento (`orderNumberScope`: canceladas fora, salvo se todas estiverem); **tem número** = `customerOrderNumber` não vazio **ou** `purchaseOrderId` (a união das duas leituras de hoje). As duas cerimônias leem `orderNumber: { required, maxLength, vehicles }`, recebem `orderNumbers[]` no corpo do ato, resolvem com `resolveOrderNumberSubmission` (falta → **400** com a frase da `main`) e gravam só o vazio com `writeInformedOrderNumbers`. Sai `purchase-order-gate.ts` inteiro (`isSolePurchasingContact`, o 403, o filtro `canIssuePurchaseOrder`: o beco sem saída que ele tapava some quando o próprio ato aceita o número). Guarda **G35** | assinatura e portal no **P14** (a leitura e o ato da cerimônia do portal moram em `signature-envelope.service.ts` e `portal-signature.controller.ts`); a tela, no P23 |
| **DD10 confirmada** (Revisão 3.1) | O dono **confirmou**: a liberação manual "Disponibilizar para produção" exige a arte aprovada (só trabalho novo) | Feito na Revisão 3.1: D-15, §6.2, §9, §11 e §12 dizem "confirmada" | P12 |
| **Pendência de baixa prioridade** (Revisão 3.1) | `task.field.truck.vinPlateId` é emitida pelo tracker e **não tem configuração no seed** — trocar a foto da plaqueta nunca notificou ninguém. **O dono mandou ignorar por enquanto: não criar a chave nem mudar quem recebe aviso** | registrado no G9 como exceção conhecida | — |

**Também decidido pela DD3 (Revisão 3):** a aprovação da arte no portal conclui a O.S. "Aprovar com o Cliente" **e** a O.S. de ARTE que estiver em `WAITING_APPROVE` na tarefa (era a pergunta 24).

**O que a Revisão 3 conferiu e mudou por conta própria** (P00, FATO): (1) merge da `main` na base — api `cd61b7d1`, web `051a5c04` (conflitos e decisões nas mensagens de commit; os dois portões de pedido de compra que convivem viraram a pergunta 26, respondida na Revisão 3.1 pela DD12); (2) produção medida (`P00-producao.md`): 2.311 tarefas, 1.676 sem `Truck`, 2.051 séries (0 duplicadas, 42 fora da regex), 859 `Layout` (73 de aerografia, 213 órfãos, fan-out 40), 311 arquivos de layout em 301 orçamentos (179 com imagem aprovada da galeria fora do layout), 0 `PER_VEHICLE`, **0 coletas RUNNING**, 30 COMPLETED, 12 O.S. de ARTE em `WAITING_APPROVE`; (3) um **terceiro cliente** da API que o plano não conhecia, o app nativo `AnkaaAero` (§5.4, risco 48); (4) o RN antigo **não** fala mais com a API (0 requisições Expo no domínio atual em 15 dias de log; o domínio velho está mudo desde 13/01/2026); (5) a `main` trouxe um 10º escritor de medida (`src/utils/implement-measure-replication.ts`, réplica por cópia aos irmãos do orçamento), que entra no P04.

**Auditoria da Revisão 2** (§14, feita depois desta revisão): varredura independente da série e dos estados do orçamento, 16 afirmações conferidas no código e no clone, 14 correções no lugar (marcadas "auditoria §14") e as lacunas na §6.15.

**O que a Revisão 2 conferiu por conta própria** (FATO, comandos só de leitura em 23/09): `git show main:prisma/schema.prisma` tem só 5 valores em `BudgetStatus` (`:4522-4540`) e a `main` não tem `portal-decision.service.ts` nem a capacidade `PRE_APPROVE`; as migrações `20260920120000_portal_do_responsavel_requisicao_e_pedido` e `20260920190000_fila_hibrida_por_estado` só existem na branch, e a `main` tem `20260922130000_envelope_lembra_o_que_ja_avaliou`, que a branch ainda não tem; web `main:src/constants/enum-labels.ts:2478` rotula `PENDING` como "Pendente" e a branch (`:2481`) como "Aguardando Assinatura"; no clone, `Budget` × último envelope bate com `08` §1.9 (427 APPROVED sem envelope, 158 deles com cobrança aprovada; 155 PENDING sem envelope; 9 REQUESTED com RUNNING); 2.253 tarefas, 1.678 sem `Truck`, 2.013 séries; `mobile-flutter/shorebird.yaml` **existe e é versionado** (`11` §3.3 e a pergunta 7 dele diziam o contrário: o `ls` de lá caiu no alias do `eza`). As divergências entre os relatórios 08×09 e 10×11 estão resolvidas na §2.1 (V11..V16).

---

## 0. Resumo executivo

1. **O que se pede, em seis movimentos.** O orçamento deixa de **selecionar** arte (R1): `Budget.layoutFiles` sai. A arte que o cliente aprova passa a ser do **implemento** e é aprovada pelo **responsável no portal** (R2, R7). `Truck` é renomeado para `Implement`, com `type` e `category` como campos diretos (R3, R4), **toda tarefa tem exatamente um implemento** e o **número de série passa a ser do implemento** (DD1). O implemento ganha a face **frontal** e a configuração da **porta traseira** (R5, DD4). A coleção "Layout" da tarefa é repartida em dois: o PDF cotado vira o **projeto da tarefa** e o PDF da Furgões vira o **projeto do implemento** (R6). O orçamento ganha a **aprovação do valor**, que pode vir antes da arte; a **emissão** das assinaturas exige valor **e** arte aprovados, tem estado próprio, e o documento assinado **continua levando a arte** — agora a arte aprovada de cada implemento (DD2).
2. **Os dados confirmam a separação** (FATO, **produção** em 23/09, `P00-producao.md`). A tabela `Layout` mistura 391 PDFs de desenho cotado com 391 imagens de arte (mais 4 EPS e **73 linhas de aerografia**, que ficam onde estão), e só 4 arquivos estão em `projectFiles` (projetos da Furgões). Outros 223 PDFs com cara de projeto da Furgões estão em `baseFiles` (87 em tarefas vivas). Uma única linha de `Layout` chega a servir **40 tarefas com um status só**. Das 2.311 tarefas, **1.676 não têm `Truck`** (todas COMPLETED) e 2.051 têm série (0 duplicadas); das séries das tarefas antigas, 199 são placas e 44 são chassis (histórico sujo, migra como está).
3. **Formato do modelo.** Implemento **1:1 e obrigatório** (DD1): `Implement.taskId @unique` garante "no máximo um", um `CONSTRAINT TRIGGER` diferido garante "ao menos um". Rename físico da tabela, mantendo os ids. `Implement.serialNumber @unique` (+ coluna gerada e GIN); `Task.serialNumber` fica como **espelho somente leitura por gatilho** até a R-D. `Layout.implementId` com uma linha por implemento e estado próprio. Face frontal como 4ª FK. Porta traseira em três colunas do implemento, com CHECK. Projeto do implemento como M2M nova; o projeto da tarefa reaproveita `Task.projectFiles`. No orçamento (§2A): os **valores de produção** de `BudgetStatus` ficam (`PENDING`, `SIGNED`, `EXPIRED`, `APPROVED`, `CANCELLED`), `REQUESTED` e `IN_NEGOTIATION` ficam, `PRE_APPROVED` (nunca foi a produção) **sai**; `APPROVED` significa **valor aprovado**; a assinatura ganha o eixo `Budget.signatureStatus`; a aprovação do valor é registrada em `BudgetValueApproval` (quem, quando, origem, nota; **sem hash**: editar o valor depois de aprovado segue como hoje, DD8). A **cobrança** só é aprovada com a assinatura concluída (`signatureStatus = SIGNED`; o legado migra `WAIVED` e continua faturável, DD7).
4. **O maior risco continua na assinatura, mas mudou de lugar.** A arte **continua** no hash material (v7, `layoutFileIds`). Não há versão nova de recorte nem tolerância para a migração (a `tolerateArtworkAfterSeal` da D-31 vale só para arte aprovada depois do selo): a fonte da chave passa a ser a arte aprovada dos implementos, e o hash só se mantém se a migração **preservar os `File.id`** que estão congelados. O M3 do v1 os trocava: promovia o "gêmeo" da galeria (outro `File.id`) e levava imagens aprovadas da galeria que não estavam no orçamento (**179 de 301** orçamentos com layout, em produção; no clone eram 71 de 134, e o nº 594 tem envelope COMPLETED). Em produção não há coleta RUNNING e há **30 COMPLETED**, todas com arte congelada. As regras **M-A..M-D** (§2A.9, §4.3) e a régua G11 "quem casava antes casa depois" são pré-condição de deploy.
5. **O segundo maior risco é o silêncio.** Hoje o `PUT /tasks` com a chave velha `truck` responde **200 sem gravar** (o schema não é strict). Includes aninhados passam direto ao Prisma e dão **500**. A whitelist dá **403**. As regras de Atenção com `isNull('truck.x')` disparam para toda tarefa. As notificações ficam mudas. O app instalado não manda versão. A série soma três casos da mesma classe: a Agenda do app manda sempre `orderBy[2].serialNumber` (500 se chegar ao Prisma sem a coluna), a série digitada no app velho sumiria com 200, e todo rótulo "série, senão placa" (NFS-e, boleto, recibo, notificação) recuaria para a placa sem erro. O plano responde com uma **janela bilíngue** na API (aceita `truck` e `implement`, traduz, conta e loga), o **espelho da série por gatilho**, um **portão de versão do app** (patch OTA com cabeçalho e tela de 426), **escrita estrita** e **testes de contrato** que nascem *antes* do rename (§8).
6. **Objetos de banco que quebram por nome ou que o teste não vê.** Se não forem tratados junto, um quebra calado e os outros em cascata: `file_blocking_references()` cita `quoteLayoutId` (toda exclusão de arquivo passaria a falhar); `OUTBOUND_REFERENCES` monta `select` com essa coluna; o SQL cru `LEFT JOIN "Truck"` do `paint.service.ts` engole o erro; e a coluna gerada `Budget.queueRank` cita os valores de `BudgetStatus` (trocar o tipo exige derrubá-la e recriá-la). Os gatilhos novos (espelho da série, série somente leitura, implemento obrigatório) **não existem** em banco de teste criado por `db push`: sem a guarda G25, o teste fica verde e a produção falha.
7. **Ordem.** Guardas e refatorações sem mudança de comportamento → patch do app (versão + leitura tolerante de `implement` e da série) → schema e migração (rodando sozinho: M1, M1s, M2, M3, M3o) → API bilíngue (implemento e série) → arte, orçamento e assinatura → web → app novo → portão de versão → leitores da série sob catraca → remoção dos aliases, da coluna `File.quoteLayoutId` e do espelho da série (M4, M5s). No máximo 2 agentes em paralelo; o que cria exigência para o repositório inteiro roda sozinho (§9).
8. **A obra da outra sessão** (`feat/orcamento-veiculos`) **já está na `main` e em produção** (DD6, reescrita na Revisão 3) e foi absorvida pela base no P00. Vale o caminho de contingência: `BudgetLayoutTask`/`layoutScope` são fonte da M3 passo 5 e da regra que emite `layoutCoverage` (§2A.9), e o G11 inclui envelopes `PER_VEHICLE`. O desenho de `layoutCoverage` dela (`3a041693`) é reaproveitado para a arte por veículo na assinatura. A tela de N veículos do orçamento fica; sai só o seletor de layout por veículo (a arte vem do implemento).

### O que muda para o usuário

| Quem | Antes | Depois |
|---|---|---|
| Comercial (orçamento) | Escolhe até 2 "layouts aprovados" no passo 2. Sem isso não aprova nem envia para assinatura. O estado nasce "Pendente" e "Aprovar" é um item do seletor | O orçamento **não seleciona arte**: ela vem do implemento, e o Resumo mostra a arte de cada veículo com o estado dela. Novo ato **"Enviar para aprovação do cliente"** (Pendente → Aguardando aprovação do cliente) e **"Aprovar valor em nome do cliente"** (com nota obrigatória). "Enviar para assinatura" só habilita com o **checklist de emissão** fechado: valor aprovado e arte aprovada **em cada veículo** (a tela diz qual falta) |
| Financeiro | Fatura quando o orçamento está "Aprovado" | **Só fatura com o orçamento aprovado e assinado** (DD7): valor aprovado **e** "Assinatura: Assinada". Os aprovados antigos sem coleta (504 em produção) migram como "Assinatura dispensada (legado)" e continuam faturáveis. Vê o selo **"Assinatura: …"** no faturamento; aprovar a cobrança de um orçamento não assinado dá a mensagem "A cobrança só pode ser aprovada depois da assinatura do orçamento" |
| Designer | Sobe PDF e imagem na mesma lista "Layout Referência" da tarefa, com status | Dois lugares: **Arte do implemento** (imagem, com "Enviar para aprovação do cliente") e **Projeto da tarefa** (PDF cotado, abre no cotador) |
| Comercial / Admin (arte) | Marca APROVADO na tarefa com 1 clique; a aprovação vale para todas as tarefas que dividem a arte | Continua podendo aprovar **em nome do cliente**, mas é um ato registrado, com **nota obrigatória** (DD5). A aprovação é **por implemento** |
| Produção / chão de fábrica | Vê as artes e os PDFs APROVADOS numa galeria só; a liberação da produção vem da O.S. de ARTE concluída | Vê a **arte aprovada do implemento** e o **projeto da tarefa** separados. A liberação para produção (automática **e** manual) exige arte aprovada, **só em trabalho novo** (DD3, DD9, DD10). Não existe dispensa de arte |
| Logística | Mede 3 faces (Motorista, Sapo, Traseira) | Mede **4 faces** (+ Frente) e registra a **porta traseira**: bipartida/tripartida, varões (2, 3 ou 4 no total) e portinholas (0 a 6) |
| Todos (série) | A série é um campo da tarefa | A série aparece no bloco **Implemento**, junto de placa, chassi e plaqueta. Nenhum texto muda na nota, no boleto, no recibo ou no documento assinado (DD5) |
| Responsável (portal) | Vê só as artes já aprovadas; informa medidas de 3 faces. (Na branch, ainda não em produção, o vendedor "pré-aprova" o valor) | **Aprova o valor** (COMERCIAL, VENDEDOR, REPRESENTANTE, COORDENADOR) e **aprova ou reprova a arte** de cada veículo (os mesmos + MARKETING), uma a uma ou em lote, com motivo obrigatório para reprovar. Vê o que falta para o documento ser emitido. Informa medidas de **4 faces**, a **porta traseira** e envia o **projeto do implemento** (PDF da Furgões). Vê "valores para aprovar", "artes para aprovar" e "documentos para assinar" no Início |
| Marketing do cliente | Assina o orçamento só pela seção LAYOUT | **Continua assinando a seção LAYOUT** (DD2) — que agora mostra a arte aprovada de cada veículo — e **também aprova a arte** no portal, antes da emissão |

---

## 1. Glossário novo (vocabulário único, com o rótulo exato de tela)

| Conceito | Nome no código (API/web/app) | Rótulo pt-BR na tela | Dono | O que NÃO é |
|---|---|---|---|---|
| **Implemento** | `Implement` (model; tabela `"Implement"`), relação `task.implement`, rota `/implements` | **Implemento** (singular), **Implementos** | IMPLEMENTO (do cliente/Furgões), 1:1 com a tarefa nesta entrega | Não é a tarefa nem o cavalo mecânico. "Caminhão" sai das telas; a garagem pode continuar dizendo "caminhão" para o veículo na vaga (§6.7) |
| **Tipo** | `Implement.type` (enum `ImplementType`: `DRY_CARGO`, `REFRIGERATED`, `INSULATED`, `CURTAIN_SIDE`, `TANK`, `FLATBED`; **valores não mudam**) | **Tipo** (opções: Carga Seca, Refrigerado, Isoplastic*, Sider, Tanque, Carroceria*) | IMPLEMENTO | Não existe mais "Tipo de Implemento" como conceito à parte. *Rótulo de tela × rótulo da nota: D-18 |
| **Categoria** | `Implement.category` (enum `ImplementCategory`, que é o `TruckCategory` renomeado; **valores não mudam**) | **Categoria** (rótulos atuais, `api/src/constants/enum-labels.ts:393-404`: Mini, VUC, 3/4, Toco, Truck, Semirreboque, Semirreboque 2 Eixos, Bitrem Composição Dianteira, Bitrem Composição Traseira, Bitruck) | IMPLEMENTO | Não é "Categoria do Caminhão" |
| **Face** | `ImplementFace = 'left' \| 'right' \| 'back' \| 'front'` (tipo único exportado em cada repo). Colunas `leftSideMeasureId`, `rightSideMeasureId`, `backSideMeasureId`, **`frontSideMeasureId`** | **Motorista** (left), **Sapo** (right), **Traseira** (back), **Frente** (front) | IMPLEMENTO | Nunca `rear` (o portal e o e2e usam `back`). Na borda do portal (entrada em cm) as chaves são `esquerda/direita/traseira/frente`. No cotador as faces são `MOTORISTA/SAPO/TRASEIRA/FRENTE` |
| **Medidas** | `ImplementMeasure` (altura em **METROS**) + `ImplementMeasureSection` (largura em m, `isDoor`, `doorHeight`) | **Medidas do implemento** | IMPLEMENTO | No web a palavra "layout" também nomeava as medidas (`layoutsData`, `canViewLayout`, acordeão `value="layout"`). Esse uso sai (§6.4) |
| **Porta traseira** | `Implement.rearDoorLeaves` (`BIPARTITE` \| `TRIPARTITE`), `rearDoorBarCount` (2 \| 3 \| 4), `rearDoorHatchCount` (0..6) | **Porta traseira**: **Abertura** (Bipartida / Tripartida), **Varões** (2 / 3 / 4), **Portinholas** (0 a 6) | IMPLEMENTO | Não é seção `isDoor` da medida traseira. As portas laterais continuam como seções |
| **Arte** (layout do implemento) | `Layout` com `implementId`; relação `implement.layouts`; estados `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REPROVED`, `SUPERSEDED` | **Arte**; estados: **Rascunho**, **Aguardando aprovação do cliente**, **Aprovada**, **Reprovada**, **Substituída** | IMPLEMENTO | Não é o PDF cotado. Não mora no orçamento. `Layout.airbrushingId` (arte de aerografia) **continua** onde está |
| **Projeto da tarefa** | `Task.projectFiles` (relação `TASK_PROJECT_FILES`, tabela `_TASK_PROJECT_FILES`); contexto de upload `taskProjectFiles` | **Projeto da tarefa** (legenda: "PDF com as cotas de colagem") | TAREFA (serviço da Ankaa) | Hoje o nome guarda 4 PDFs da Furgões. Eles saem daqui para o implemento na migração (D-11) |
| **Projeto do implemento** | `Implement.projectFiles` (relação `IMPLEMENT_PROJECT_FILES`, tabela `_IMPLEMENT_PROJECT_FILES`); contexto `implementProjectFiles` | **Projeto do implemento** (legenda: "Projeto da carroceria — ex.: Furgões Ibiporã") | IMPLEMENTO | É M2M porque um PDF da Furgões cobre N números de série (`PROJETO 38174 ATÉ 38185 - SEM LIMITE.pdf`) |
| **Arquivos base** | `Task.baseFiles` (sem mudança) | **Arquivos base** | TAREFA | O que o cliente manda (logo, foto) |
| **Aprovar em nome do cliente** | `approvalSource = ON_BEHALF`, com `decisionNote` obrigatória | **Aprovar em nome do cliente** | ato interno | Não é um seletor de status solto |
| **Número de série** | `Implement.serialNumber` (`@unique`; busca por `serialNumberNormalized`). Na janela, `Task.serialNumber` é **espelho somente leitura** (gatilho); sai em M5s. Chave JSON e nome de campo continuam `serialNumber` em toda parte (changelog `TASK/serialNumber`, notificação `task.field.serialNumber`, snapshot `vehicles[].serialNumber`, portal `identity.serialNumber`) | **Número de Série** / **Nº Série** / **Série** (rótulos de hoje, sem mudança) | IMPLEMENTO (DD1) | Não é o número do orçamento nem o da O.S. (o comentário `dps.builder.ts:522-524` que diz "a série é da ORDEM DE SERVIÇO" passa a mentir e é corrigido) |
| **Estado do orçamento** (eixo do valor) | `Budget.status` (`BudgetStatus`): `REQUESTED`, `PENDING`, `IN_NEGOTIATION`, `APPROVED`, `EXPIRED`, `CANCELLED`; `SIGNED` fica no enum como **legado, nunca mais escrito** | **Requisição**, **Pendente**, **Aguardando aprovação do cliente**, **Aprovado**, **Aguardando Reanálise**, **Cancelado**; `SIGNED` = "Assinado (legado)" | ORÇAMENTO | "Aprovado" é o **valor** aprovado (DD2), não "assinado". `PRE_APPROVED` deixa de existir |
| **Aprovação do valor** | `BudgetValueApproval` (append-only, **registro**: `source` PORTAL/ON_BEHALF/SIGNATURE/LEGACY_APP/MIGRATED, autor, nota, total, `revokedAt`/`revokedReason` quando o orçamento sai de `APPROVED`; **sem hash**, DD8) | **Aprovar valor** (portal) / **Aprovar valor em nome do cliente** (interno, nota obrigatória) | ORÇAMENTO | Não é a assinatura. Não aprova a arte. Não libera a cobrança sozinha (DD7) |
| **Estado da assinatura** (eixo próprio) | `Budget.signatureStatus` (`BudgetSignatureStatus`): `NOT_ISSUED`, `AWAITING_CUSTOMER`, `AWAITING_ANKAA`, `SIGNED`, `SIGNED_OFFLINE`, `REFUSED`, `EXPIRED`, `INVALIDATED`, `WAIVED` | **Assinatura**: Não emitida, Aguardando assinaturas, Falta a Ankaa, Assinada, **Assinada fora do sistema**, Recusada, Vencida, Invalidada, Dispensada (legado) | ORÇAMENTO (escrito só pela coleta; `SIGNED_OFFLINE` só pelo ato "Assinado fora do sistema", DD11; `WAIVED` só pela migração e pela conciliação) | Não é `SignatureEnvelope.status` (o envelope é a coleta; o eixo é o resumo do orçamento). `SIGNED`, `SIGNED_OFFLINE` (DD11) ou `WAIVED` do legado é o que libera a cobrança (DD7) |
| **Pronto para emitir** | derivado: `status = APPROVED` ∧ aprovação do valor vigente ∧ todo implemento vivo com arte `APPROVED` ∧ portões de hoje; exposto como `emission: { ready, blockers[] }` e `preflight.gates` | **Pronto para emitir** / checklist "Para emitir faltam N itens" | ORÇAMENTO | Não é estado persistido. Não há dispensa de arte (DD9) |
| **Assinatura dispensada (legado)** | `signatureStatus = WAIVED`, escrito **só** pela migração (aprovados sem coleta nenhuma: 504 em produção) e pela conciliação que cria orçamento já aprovado e pago (D-34) | **Dispensada (legado)** | sistema | Não é ato de tela: "Dispensar assinatura" **não existe** nesta entrega (DD7); o ato manual que existe é "Assinado fora do sistema", com nota e anexo, e ele escreve `SIGNED_OFFLINE`, não `WAIVED` (DD11). **"Dispensar arte" também não existe** (DD9) |
| **Assinada fora do sistema** | `signatureStatus = SIGNED_OFFLINE` + registro `BudgetOfflineSignature` (anexo em `File`, nota, autor, `revokedAt`); ato `POST /budgets/:id/offline-signature` | **Assinado fora do sistema** (botão, COMMERCIAL/ADMIN); selo **Assinada fora do sistema** | ato interno (DD11) | Não é coleta eletrônica: não tem documento congelado nem hash. Libera a cobrança como `SIGNED`. Não é "Dispensar assinatura" |

---

## 2. Decisões

### 2.1 Divergências entre os relatórios e qual vale (conferido no código)

| # | Divergência | Veredito | Evidência |
|---|---|---|---|
| V1 | Rename físico da tabela (`01`) × `@@map("Truck")` sem DDL (`02`) | **Rename físico** (`ALTER TABLE "Truck" RENAME TO "Implement"` + constraints e índices). O precedente mais recente da casa é físico e só de catálogo. O custo são 5 pontos que citam o nome físico, todos listados (§6.1, §6.8), e o deploy para a API durante a migração (§4.7). ⚠️ O mesmo precedente **não** renomeou chaves que viajam como string (`quoteId`: "116 ocorrências… o zod não é strict… fase própria, com os três clientes atualizados juntos", `migration.sql:13-18`). Aqui a relação `Task.truck` **é** renomeada, porque o dono pediu o rework em todas as camadas. É exatamente por isso que a janela bilíngue (D-17) e os portões do §8 são obrigatórios, e não opcionais | `prisma/migrations/20260917200000_orcamento_vira_budget/migration.sql:1-35` (TaskQuote→Budget por RENAME); `20260705130000_rename_layout_artwork_borrow_cleanup` |
| V2 | `ChangeLogEntityType.TRUCK`: `RENAME VALUE` para `IMPLEMENT` (`07`) × manter (`01`, `02`) | **Manter `TRUCK`** como valor persistido, com rótulo "Implemento" na tela. Mesma decisão e mesmo motivo do precedente de 17/09: os espelhos TS e os filtros salvos seguiriam o valor antigo | `20260917200000…/migration.sql:19-23` (não renomeou `TASK_QUOTE`: 3.863 linhas) |
| V3 | Reaproveitar `Task.projectFiles` para o PDF cotado (`01`) × criar nome novo (`03`, `06`) | **Reaproveitar `Task.projectFiles`** (DECIDIDO, DD5). O argumento do nome novo era "o app instalado grava projeto da Furgões no lugar errado sem erro". Conferi: **o Flutter só LÊ `projectFiles`, nunca escreve**. Só o web escreve, e o web sobe junto com a API. Reaproveitar mantém a simetria com o vocabulário do dono ("projeto da tarefa" / "projeto do implemento"). ⚠️ Correção da auditoria (§13): a seção "Projetos" do app só aparece para ADMIN, COMERCIAL, LOGÍSTICA e DESIGNER (`task_permissions.dart:341-344`, `canViewProjectFiles => canViewBaseFiles`), e o include só pede `projectFiles` para eles (`task_detail_config.dart:199`). A PRODUÇÃO e o GERENTE DE PRODUÇÃO no app instalado continuam vendo o PDF cotado **só pelo `task.layouts` sintetizado** (§5.4); no app novo (P24) `canViewProjectFiles` precisa ser alargado. No web a produção já vê (`use-task-permissions.ts:78`). Pelo mesmo motivo, o DESIGNER, que não tem o domínio `projectFiles` na escrita (`task.permissions.ts:177-185`), precisa ganhá-lo (§5.3 item 5) | `mobile-flutter/lib`: `projectFile` só aparece em `data/models/task.dart:266-486` (parse) e `features/production/task_detail_config.dart:199,279-284` (leitura) |
| V4 | 1:1 (`01`, `02`, `05`) × N:1, implemento que volta (`04`) | **1:1 e obrigatório** (DECIDIDO, DD1), sempre endereçando por `implement.id` para que o N:1 venha depois de forma aditiva | 21% dos implementos têm placa; `plate @unique` + `taskId @unique` (`schema.prisma:2532,2537`); o portal é todo por `taskId` |
| V5 | Estados da arte: manter 3 + `approvalSource` (`01`) × acrescentar `PENDING_APPROVAL`/`SUPERSEDED` (`03`) × `AWAITING_CUSTOMER` (`05`) | **Acrescentar `PENDING_APPROVAL` e `SUPERSEDED`**, sem renomear nenhum dos 3 atuais. O portal precisa distinguir "rascunho interno" de "enviado ao cliente" | `schema.prisma:3991-3995`; web e app mandam `DRAFT/APPROVED/REPROVED` |
| V6 | FK do aprovador para `"Responsible"` (SQL do `01`) | **A tabela física é `"Representative"`**: `model Responsible` tem `@@map("Representative")`. O SQL do `01` foi corrigido no §4 | `schema.prisma:3619` + `@@map("Representative")` |
| V7 | Contagens de Layout: 237 PDF / 242 imagens (`01`) × 177 / 196 (`03`) | As duas valem. `01` conta o **total** (inclui 108 órfãos); `03` conta os **ligados a tarefa** | `01` §3.4, `03` §1 |
| V8 | Branch da outra sessão com "8 commits" | Hoje são **11 commits na api** (três novos às 09:18–09:28: `7efe59db`, `550f9274`, `36a3f098`) e **4 no web** (`aea9532b`, `d6a48bec`, `56139571` e `58a92ba8`, este às 09:33, que mexe em `budget-step-task.tsx`, `budget-vehicle-layouts-field.tsx`, `approved-layout-picker.tsx` e `details/[taskId].tsx`). A branch é **só local** (não há remoto) e está viva: recontar no P00 | `git log main..feat/orcamento-veiculos` (reconferido na auditoria, §13) |
| V9 | Linhas do schema (`Budget.layoutFiles` 1963 × 1983 etc.) | Valem as linhas do HEAD `ad3c65d4`: Layout `87-100`, File `753-833` (`quoteLayoutId` 761, relação 774, índice 832), Budget `1886` (`layoutFiles` 1983), Task `2338` (`truck` 2397, `layouts` 2410, `projectFiles` 2411), Truck `2530-2562`, ImplementMeasure `2564-2576` | conferido com `grep -n` |
| V10 | Face frontal: 4ª FK (todos) × tabela de faces (monorepo) | **4ª FK** + escritor único de medida (D-05) | `02` §4, `01` §5.1 |
| V11 | Máquina do orçamento: `08` recomenda a alternativa (a) — `PRE_APPROVED` = "Valor aprovado", `PENDING` só com coleta, `APPROVED` continua final — × `09` recomenda o **Modelo C** — `APPROVED` = valor aprovado, assinatura em eixo próprio | **Modelo C** (§2A.1). O argumento central do `08` ("sem DDL de enum, sem mexer em `queueRank`") perde força diante do fato que o `09` achou e eu conferi: `REQUESTED`, `IN_NEGOTIATION` e `PRE_APPROVED`, o rótulo "Aguardando Assinatura" do `PENDING`, os 8 degraus de `statusOrder` e a fila híbrida **nunca foram a produção**. A alternativa (a) é a que inverte dado de produção: os 155 `PENDING` sem coleta mudariam de sentido, o app instalado cria orçamento com `'status': 'PENDING'` e lista só `[EXPIRED, SIGNED, PENDING, APPROVED]` (todo orçamento antes da emissão sumiria do celular). C deixa os 5 valores de produção com o sentido de produção e bate com a frase do dono ("orçamento aprovado será antes"). Do `08` o plano adota: `BudgetValueApproval` (como **registro**, sem o hash e sem `reassessValueApproval`, que a DD8 derrubou), `assertEmissionReady`, a arte na v7 e as regras M-A..M-D | `git show main:prisma/schema.prisma:4522-4540`; `mobile-flutter/lib/features/financial/budget_list_config.dart:89-91`; `budget/budget_form_screen.dart:1969`; web `main:src/constants/enum-labels.ts:2478` |
| V12 | Quem libera a cobrança: `08` P3 "valor aprovado **não** fatura" × `09` P1 "valor aprovado fatura" | **DECIDIDO (DD7, Revisão 3): só depois de assinado.** O portão da cobrança (`internalApprove`, `status === APPROVED`, `budget.service.ts:4229` depois do merge do P00) ganha a condição `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}` no mesmo ponto, sem remodelar; `WAIVED` é só o legado migrado e a conciliação, e `SIGNED_OFFLINE` é o ato "Assinado fora do sistema" (DD11). Em produção, 504 dos 536 aprovados não têm coleta (viram `WAIVED`, faturáveis) | `budget.service.ts:4229`; `P00-producao.md` §4 |
| V13 | Imagens aprovadas da galeria fora do layout do orçamento: `08` P12 manda **todas** para `SUPERSEDED` (nos 134 orçamentos com layout) | **Só** nos orçamentos com coleta `RUNNING`/`COMPLETED` (onde o hash obriga). Nos demais elas ficam `APPROVED` (`MIGRATED_TASK`), porque `SUPERSEDED` as **esconderia do chão de fábrica** em tarefas em voo (a produção só vê `APPROVED`, `task.service.ts:10281-10300`), e isso não foi pedido. Pergunta 10 | `08` §3.4 regra M-B; §6.12 (filtro por papel) |
| V14 | Arte de coleta em andamento na migração: DD5 manda layout de orçamento **pendente** para `PENDING_APPROVAL`; `08` M-C manda para `APPROVED` quando há coleta `RUNNING` | **`APPROVED` com `MIGRATED_ENVELOPE`** nos orçamentos com coleta `RUNNING` (exceção estreita ao DD5: 7 PENDING + 9 REQUESTED no clone, a maioria de seed; **em produção, 0 coletas RUNNING em 23/09**, então hoje a regra não atinge nenhum orçamento — medir de novo no ensaio). `PENDING_APPROVAL` tiraria o arquivo da união e a próxima conferência de frescor (OTP, assinatura, selo) invalidaria a coleta. Pergunta 9 | `signature-envelope.service.ts:3838,4620,5269,6342` |
| V15 | Regra da série: `10` "manter o regex e a transformação de hoje, sem apertar" × `11` "uma regra só no implemento e corrigir as 42 na migração" | **Manter a de hoje e validar só quando a série muda** nesta entrega (9 séries violam a regra da API e 42 a do web: apertar trava edição de tarefa antiga). A unificação é rodada própria. Pergunta 19 | `schemas/task.ts:2595-2602`; `portal-request.ts:403-427`; web `schemas/task.ts:1197,1346` |
| V16 | `11` §3.3 e a pergunta 7 dele: "`shorebird.yaml` não existe no checkout" | **Errado.** O arquivo existe e é versionado (`git ls-files shorebird.yaml`); o `ls` do relatório caiu no alias do `eza`. O P02 pode contar com o OTA | `mobile-flutter/shorebird.yaml`; `pubspec.yaml:137` |

### 2.2 Decisões (recomendação e motivo)

Coluna **Estado**: **DECIDIDO (DDn)** = o dono decidiu em 23/09; **DECIDIDO (DD5)** = era recomendação do v1 e o dono a aceitou; **[pergunta N]** = depende da pergunta N do §12; **técnica** = decisão de engenharia, sem pergunta.

| # | Ponto | Decisão / recomendação | Por quê | Estado |
|---|---|---|---|---|
| D-01 | Implemento × tarefa | **1:1 e obrigatório**: toda tarefa tem **exatamente um** implemento. "No máximo um" = `Implement.taskId @unique` (já existe, `schema.prisma:2537`). "Ao menos um" = `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` nos dois lados (`Task` AFTER INSERT; `Implement` AFTER DELETE/UPDATE OF `taskId`) **e** o repositório sempre cria (`implement: { create }` aninhado em todo caminho de criação, `10` §5.1 C1–C7). A M1s cria os implementos das **1.676** tarefas sem `Truck` (produção, 23/09; 1.678 no clone). API e portal continuam endereçando o implemento por `implement.id`. Inverter a FK (`Task.implementId` obrigatório) fica registrado como caminho do N:1 futuro, não agora | A identidade de um furgão que volta não se sustenta nos dados (placa em 21%, chassi com duplicatas). A FK invertida reescreveria M1–M3, 19 acessos por `taskId` e a cascata, e o tipo não protegeria nada enquanto o build emitir com erro de tipo (`10` §5.3). Só o gatilho pega o próximo `tx.task.create` esquecido — foi assim que nasceram as 1.676 | **DECIDIDO (DD1)** |
| D-02 | O número de série | **Vai para o implemento**: `Implement.serialNumber String? @unique` + `serialNumberNormalized` (coluna gerada, `lower(immutable_unaccent(...))`) + índice GIN trigram. Estratégia **E (espelho)** do `10` §4.2: de R-B a R-D, `Task.serialNumber` continua no banco como **espelho somente leitura** mantido por gatilho a partir do implemento (escrita direta → erro 23514), sem `@unique` (a unicidade é só do implemento), com a coluna gerada e o GIN da tarefa ainda de pé; M5s o derruba. Mudam na R-B só os **6 escritores** (`10` §2.3 W1–W6), as 4 checagens de unicidade e 3 pontos de semântica; os ~490 leitores migram sob catraca (G24) entre R-B e R-D. Nomes que **não** mudam: `ChangeLog TASK/serialNumber` (S-5), `vehicles[].serialNumber` do snapshot (S-6), chaves do portal, variável `{{serialNumber}}` dos templates, ids de coluna e de campo das telas. Séries sujas do histórico migram **como estão** (S-7). A série **não** se edita por `PUT /implements/:id` (S-9: a rota aceita WAREHOUSE) | O espelho muda 6 escritores em vez de ~500 pontos num deploy só, mantém o app instalado, a busca, a Agenda e a NFS-e intactos, e transforma o escritor esquecido em erro **barulhento** (o gatilho recusa) em vez de dado perdido com 200 | **DECIDIDO (DD1)**; o espelho na janela [pergunta 16]; séries sujas [pergunta 17] |
| D-03 | A vaga (`spot`) | **Fica no implemento**, fora do contrato do portal (`portal-read.service.ts:199`). O `@default(YARD_WAIT)` de `Implement.spot` **sai** (S-8): com a criação universal, ele poria todo veículo não chegado "no pátio" (os 43 criados pelo portal desde 19/09 já nasceram assim). Todo INSERT passa `spot` explícito | Mover o `spot` mexe em ~30 pontos da garagem e nas notificações `task.field.truck.spot` | **DECIDIDO (DD5)**; o default: técnica [pergunta 18] |
| D-04 | Rename: o que muda de nome e o que NÃO muda | **Muda:** model/tabela `Truck`→`Implement`; relação `Task.truck`→`Task.implement`; coluna `implementType`→`type`; tipo `TruckCategory`→`ImplementCategory`; rotas `/trucks`→`/implements`; relações inversas `trucks*Side`→`implements*Side`. **Não muda:** valores de enum, `ImplementType` (nome do tipo), `TRUCK_SPOT`, `ChangeLogEntityType.TRUCK`, chaves de notificação `task.field.truck.*` e `truck.movement_request`, contextos de arquivo `truckVinPlate`/`implementMeasurePhotos` (ganham alias `implementVinPlate`), chaves JSON do snapshot de assinatura (`truck`, `vehicles[].implementType`, `vehicles[].serialNumber`), ids das regras de Atenção, o nome `serialNumber` em todo identificador gravado (D-02) | Cada "não muda" é um identificador **gravado** (banco, preferência, hash), e renomeá-lo invalida histórico, preferência ou assinatura (§6.8) | técnica |
| D-05 | Face frontal | **4ª FK `frontSideMeasureId`**, foto **opcional** também na frente. Os 9 escritores de medida passam antes por um **`ImplementMeasureWriter` único** | Há 9 escritores independentes (10 com a outra branch), cada um repetindo os 3 lados | **DECIDIDO (DD5)** |
| D-06 | Porta traseira | **Colunas do `Implement`**: `rearDoorLeaves` (`BIPARTITE`/`TRIPARTITE`), `rearDoorBarCount` = **varões no total**, CHECK `IN (2,3,4)`; `rearDoorHatchCount` = **portinholas, só quantidade**, CHECK `BETWEEN 0 AND 6` (sem medida nem posição). Os três são **independentes** (nenhuma regra cruzada: tripartida não exige mínimo de varões). `NULL` = não informado ou não se aplica (sider/prancha). Bipartida/tripartida é **preset**: desenha 2 ou 3 folhas nas seções da traseira quando o usuário escolhe, sem virar segunda fonte da verdade | A medida não sabe a própria face e era compartilhada; o responsável informa a porta sem medir nada; nenhuma traseira tem porta modelada hoje (0 no clone) | **DECIDIDO (DD4)** |
| D-07 | Medida compartilhada entre implementos | **Proibida daqui para frente** (uma linha por face por implemento; réplica por cópia) e **desfeita** na M2 (produção: 11 linhas compartilhadas, 15 implementos, 26 cópias; a `main` já replica medida aos irmãos do orçamento **por cópia**, `src/utils/implement-measure-replication.ts`, que o P04 absorve) | `PUT /implement-measure/:id` e `portal-identity` editam **no lugar**: corrigir o próprio furgão alterava o de outro cliente | **DECIDIDO (DD5)** |
| D-08 | Forma da arte | **`Layout.implementId` (1:N)**, estado por linha, `@@unique([implementId, fileId])`, sem `fileId @unique`. Trilha append-only `LayoutDecision`. `File.layouts` (to-one) é **renomeada** para `File.artLayouts Layout[]`, para que a mudança de objeto para lista **quebre no tsc** | Uma junção com status espalharia "a arte" em dois lugares; clonar o File repetiria o `cloneFileForQuoteLayout` que o R1 manda embora | técnica |
| D-09 | Quem aprova a arte no portal | Capacidade **`APPROVE_ARTWORK`** para **MARKETING, COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR**; **PURCHASING não**. Escopo **comercial** (pagador ∨ dono), o mesmo da `WRITE_VEHICLE_IDENTITY`: a Furgões pagadora aprova | Reusa a régua e o escopo que já existem | **DECIDIDO (DD5)** |
| D-10 | O interno ainda aprova a arte? | **Sim**, como ato "Aprovar em nome do cliente" (COMMERCIAL, ADMIN), com `decisionNote` **obrigatória** e `approvalSource=ON_BEHALF`. O `bulkUploadFiles`, que criava arte já `APPROVED`, é apagado (não tem chamador) | 183 responsáveis nunca logaram; a nota é a única prova de um ato fora do sistema | **DECIDIDO (DD5)** |
| D-11 | Os 4 `Task.projectFiles` atuais e os PDFs da Furgões em `baseFiles` | Os **4 vão para `Implement.projectFiles`**. Dos PDFs de `baseFiles` com cara de projeto da Furgões (produção: 223, dos quais **87 em tarefas não concluídas**; 152 no clone): **copiar o vínculo** (sem tirar de base) para o projeto do implemento **só em tarefas não concluídas**, por regex conservadora (`^PROJETO\s` ou `^\d{5}.*LAYOUT`), com tabela de rastreio | Base é o que o cliente mandou; a regex erra, por isso só vínculo e com trilha | **DECIDIDO (DD5)** |
| D-12 | Os PDFs de `Layout` | **Todos viram `Task.projectFiles`** da(s) tarefa(s) ligada(s); os que estão em `DRAFT/REPROVED` (7+1 ligados, no clone) saem numa **lista de triagem** antes do deploy. O projeto da tarefa **não tem estado** nesta entrega | O status do PDF nunca foi aprovação do cliente | **DECIDIDO (DD5)** |
| D-13 | Destino de `Budget.layoutFiles` (histórico) | Vira **arte do implemento de cada tarefa do orçamento**, **sempre com o próprio `File.id` do orçamento** (regra M-A; nunca se promove o "gêmeo" da galeria, que é outro `File.id`) e com **o mesmo conjunto em todos os implementos** do orçamento (M-D, cobertura uniforme). Estado: orçamento `APPROVED`/`SIGNED` → `APPROVED` (`MIGRATED_BUDGET`); orçamento com coleta `RUNNING`/`COMPLETED` → `APPROVED` (`MIGRATED_ENVELOPE`) mesmo em PENDING/REQUESTED (M-C, V14); demais vivos → `PENDING_APPROVAL` (DD5); `EXPIRED`/`CANCELLED` sem coleta → nada (arquivo morto). Nos orçamentos com coleta `RUNNING`/`COMPLETED`, as **outras** imagens `APPROVED` da galeria desses implementos → `SUPERSEDED` (M-B, V13). O gêmeo `DRAFT` da galeria fica `DRAFT`. PDF de orçamento → projeto da tarefa, **salvo** PDF congelado em coleta viva (0 no clone; medir), que fica também como arte. A coluna `File.quoteLayoutId` fica no banco até M4 | Com a arte de volta ao hash material (D-14), trocar um `File.id` ou somar imagem derruba contrato. Em produção, **221 dos 311** arquivos de layout de orçamento são **clones** (outro `File.id` que o da galeria) e **179 de 301** orçamentos com layout têm imagem aprovada da galeria fora do layout (no clone: 113/137 e 71/134, `08` §3.4) | **DECIDIDO (DD5)** no estado; M-A..M-D técnica; exceções [perguntas 9 e 10] |
| D-14 | A assinatura do orçamento congela a arte? | **Sim** (DD2). Snapshot **v4** e recorte material **v7**, **sem versão nova e sem tolerância de migração** (a única tolerância nova é `tolerateArtworkAfterSeal`, D-31, restrita a envelope `COMPLETED` e a arte aprovada **depois** do selo; `tolerateMigratedArtwork` do §2A.9 item 6 é rede desligada — texto alinhado pela auditoria §14): `layoutFileIds` passa a ser a **união distinta ordenada** dos `File.id` da arte `APPROVED` vigente dos implementos de **todas** as tarefas do orçamento — o mesmo conjunto que já alimenta `vehicles[]` do snapshot, **inclusive as canceladas** (`quoteArtworkOf`, fonte única para snapshot e documento; o portão E2 usa a mesma função, mas só exige arte das tarefas não canceladas). Correção da auditoria §14: com "só as não canceladas", o nº 594 (4 tarefas CANCELLED, envelope COMPLETED, 1 arquivo congelado) teria `layoutFileIds = []` e deixaria de casar. `layoutCoverage` (`[fileId, taskIds[]]`, forma do commit `3a041693` da outra branch) só é emitido quando a cobertura **não é uniforme** — chave ausente mantém o hash de hoje. O documento novo leva a arte **com legenda por veículo** quando não uniforme. `LAYOUT` continua em `QUOTE_SECTIONS` **e alternável**; `ROLE_DEFAULT_SECTIONS[MARKETING] = ['LAYOUT']` **fica**. Prova da arte = PDF congelado (bytes) + `LayoutDecision` (quem, sessão OTP, `fileSha256`); o snapshot **não** ganha `sha256` da arte (chave nova mudaria o hash inteiro de todo orçamento). Arte nova depois da emissão: D-31 | É o pedido do dono. Subir para v8 faria a troca de cobertura passar calada (argumento do próprio `3a041693`); a chave condicional reproduz o hash atual nos orçamentos de 1 veículo e nos de N veículos com a mesma arte | **DECIDIDO (DD2)**; a hipótese "o documento leva a arte aprovada de cada veículo" confirmada pela DD2 (Revisão 3; era a pergunta 1) |
| D-15 | Para onde vai a exigência de arte na produção | **Portão na regra de liberação** PREPARATION→WAITING_PRODUCTION (`task-service-order-sync.ts:121-151,614-618`): `anyLayoutCompleted ∧ implemento com arte APPROVED` — **sem dispensa** (DD9). **Só trabalho novo**: vale para tarefa cuja primeira O.S. de ARTE foi criada **depois** da R-B (INF: definição operacional; 1.729 tarefas do clone têm O.S. de arte concluída e nenhum layout). A aprovação no portal conclui a O.S. **"Aprovar com o Cliente"** quando ela existir **e** a O.S. de ARTE que estiver em `WAITING_APPROVE` na tarefa (DD3, Revisão 3); a reprovação as devolve a `IN_PROGRESS`. As demais O.S. de ARTE ("Elaborar Layout", "Formular Cor"…) seguem livres. **A liberação manual "Disponibilizar para produção" também respeita o portão da arte** (DD10, **confirmada pelo dono na Revisão 3.1**): hoje ela fura o portão comercial de propósito (`task-service-order-sync.ts:614-618`); como não há dispensa, quem precisa liberar sem o cliente aprova a arte "em nome do cliente", com nota. **Correções da auditoria §14:** (1) a regra de liberação são duas **funções puras** que só recebem a lista de O.S. (`calculateCorrectTaskStatus`, `:118`; `getTaskUpdateForServiceOrderStatusChange`, `:365`): o portão exige um argumento novo (`artworkGate: 'OK' \| 'PENDING' \| 'NOT_APPLICABLE'`) calculado pelos **6 chamadores** (`task.service.ts:4528,4829`; `service-order.service.ts:1279,1432,3284,3441`, linhas da Revisão 2) — não é "sem mudança de código"; (2) a O.S. "Aprovar com o Cliente" se acha por descrição **normalizada** (`lower(unaccent)`): no clone as 7 que existem estão gravadas como "Aprovar com **O** Cliente"; **em produção não há nenhuma** (filtro `%aprovar%cliente%`, 23/09); (3) em produção há **12** O.S. de ARTE em `WAITING_APPROVE` (6 em tarefas PREPARATION, 6 em tarefas CANCELLED; 10 com imagem em rascunho na galeria, 2 sem imagem; no clone eram 31 "Elaborar Layout"): com a DD3 a aprovação da arte as fecha, e a M3 deixa a arte dessas tarefas `PENDING_APPROVAL` | Uma tarefa tem várias O.S. de ARTE (`constants/service-descriptions.ts:183-191`) e a liberação dispara quando **qualquer uma** conclui; portão em cada O.S. travaria "Formular Cor" sem motivo | **DECIDIDO (DD3, DD9, DD10)** |
| D-16 | Branch `feat/orcamento-veiculos` (outra sessão) | **Já está na `main` e em produção** (deploy de 23/09, api `4fed4b13`; DD6 reescrita na Revisão 3) e foi absorvida pela base no P00 (merge `cd61b7d1`/`051a5c04`). Caminho de **contingência**: `BudgetLayoutTask` (+ `Budget.layoutScope`) é **fonte** da M3 passo 5 (restringe a arte de cada implemento às linhas dela quando `layoutScope = PER_VEHICLE`); `quoteArtworkOf` e o builder do snapshot **honram `layoutScope`** e emitem `layoutCoverage` quando `layoutScope = PER_VEHICLE` **ou** a cobertura não for uniforme (senão um `PER_VEHICLE` uniforme congelado com a chave cairia, `08` §3.3 item 3); o G11 inclui envelopes `PER_VEHICLE` (em produção, em 23/09: 0 orçamentos `PER_VEHICLE`, 0 linhas em `BudgetLayoutTask`; reconferir no ensaio). O que ela trouxe e o rework absorve: `layoutGateFailure`/`describeVehicleList` (`src/utils/quote-layout-coverage.ts`, reusados pelo E2), o 10º escritor de medida (`src/utils/implement-measure-replication.ts`, entra no `ImplementMeasureWriter` e no G15), `pruneQuoteLayoutCoverage` (morre com o R1), a tela de N veículos do web (**fica**, perde só o seletor de layout por veículo `budget-vehicle-layouts-field.tsx`, P22) | Não há mais "se chegar": é o estado de produção. As worktrees da outra sessão (`/tmp/claude-1000/*/06e55e4d-*/`) continuam intocáveis | **DECIDIDO (DD6)** |
| D-17 | Janela de compatibilidade × corte seco | **Janela** com prazo: API bilíngue (aceita `truck` e `implement`, devolve `truck` a quem pediu `truck`; série no topo traduzida para o implemento) por **no mínimo 1 ciclo de versão do app e até o contador de alias zerar por 14 dias**. Antes dela: patch OTA com `X-App-Version` + 426. Depois: `MIN_APP_VERSION` | Não existe versão mínima nem cabeçalho de versão hoje (`dio_client.dart:164-169`); o "Agora não" do Shorebird deixa o app velho em campo | **DECIDIDO (DD5)** |
| D-18 | Rótulos de tipo na tela e na nota | **Nenhuma palavra muda em documento fiscal até o dono escolher.** Como hoje os documentos **divergem** entre si (NFS-e da tarefa: "Isotérmico"/"Prancha/Plataforma"; boleto, fatura e NFS-e do pintor: "Isoplastic"/"Carroceria"), a fonte única (P05) nasce com **um perfil por documento** que reproduz o texto de hoje byte a byte, travado por teste de ouro (G21). O mesmo vale para a série: "n série", "Série X", "(séries A a B)", "Ref. OS X", "OS #X" continuam iguais. Quando o dono escolher, os perfis convergem | A nota é irreversível na prefeitura; "não mudar palavra" com uma fonte única que unificasse já mudaria duas delas | **DECIDIDO (DD5)**; as palavras [pergunta 22] |
| D-19 | Categoria: um enum ou dois | **Um só**, com os mesmos 10 valores | O dono disse "tipo e categoria" | técnica |
| D-20 | Arte de aerografia | **Fica em `Layout.airbrushingId`** (0 linhas no clone; **73 em produção**, em 46 aerografias: a M3 filtra `airbrushingId IS NULL` em todo passo e o risco 29 é real) | Outro fluxo (pintor, NFS-e, pagamento) | **DECIDIDO (DD5)** |
| D-21 | Arte aprovada pode ser "desaprovada"? | **Não.** Mudança é **versão nova** (`supersedesId`): a vigente vale até a nova ser aprovada; aí a anterior vira `SUPERSEDED` | Evita "o cliente aprovou e o sistema desaprovou" | **DECIDIDO (DD5)** |
| D-22 | O cliente vê o projeto da TAREFA (PDF cotado)? | **Não** nesta entrega | Insumo interno de plotagem | **DECIDIDO (DD5)** |
| D-23 | Unidade das medidas | **Continua METRO no banco**; o portal segue em cm na borda (`/100`) | Mudar a unidade sem mudar o nome do campo grava valores 100× menores sem erro | técnica |
| D-24 | Pasta física dos arquivos | Arte: `Clientes/{cliente}/Layouts/Imagens`. Projeto do implemento: `Clientes/{cliente}/Projetos/`. PDFs cotados ficam em `Layouts/PDFs`; a migração não move bytes nem apaga `File` | 56 grupos de `path` compartilhado; `deletePhysicalFile` não confere (`file.service.ts:1186-1210`) | **DECIDIDO (DD5)** |
| D-25 | Padrão "Refrigerado" na criação | **Nasce vazio** (web `create.tsx:168`, `task-create-form.tsx:125`, billing `[id].tsx:593` e `:763`; app `budget_form_screen.dart:206-207` e `task_form_screen.dart:181`). `implementType=REFRIGERATED` no banco **não é dado confiável** para orçamentos criados pela tela de criação do web nem pelo wizard do app | Default concreto grava REFRIGERATED em todo orçamento criado | **DECIDIDO (DD5)** |
| D-26 | **Modelo da máquina do orçamento** | **Modelo C** (§2A.1): eixo do **valor** em `Budget.status` com os valores de produção preservados — `PENDING` = "Pendente" (montagem, nascimento interno), `IN_NEGOTIATION` = "Aguardando aprovação do cliente", **`APPROVED` = valor aprovado** — e eixo da **assinatura** em `Budget.signatureStatus`. `PRE_APPROVED` sai do enum (nunca foi a produção); `SIGNED` fica no enum como legado, **nunca mais escrito** (o app instalado filtra por ele: tirá-lo daria 400 na lista do celular) | V11: é o único modelo que não inverte dado de produção nem o que o app instalado grava, e é a frase do dono. O custo (recriar o tipo e o `queueRank`) cai numa migração que ainda não foi a produção | **DECIDIDO (DD2)** na regra e no modelo (Revisão 3; era a pergunta 2) |
| D-27 | **Registro da aprovação do valor** | Tabela append-only **`BudgetValueApproval`** como **registro** do ato: `source` PORTAL/ON_BEHALF/SIGNATURE/LEGACY_APP/MIGRATED, `responsibleId` **ou** `userId`, `note` obrigatória em ON_BEHALF, `total` aprovado, `decidedAt`, `revokedAt/revokedReason`. **Sem hash dos termos e sem autoridade nova de "o valor mudou?"** (DD8, Revisão 3): editar o valor depois de aprovado **fica como hoje** — `hasValueAffectingChange` (`budget.service.ts`) e o gêmeo de `task.service.ts` devolvem `APPROVED → PENDING` quando o valor muda, **salvo** quando o chamador fixa o status (o "fixar Aprovado" do assistente **fica**). A aprovação vigente é fechada (`revokedAt`, motivo) sempre que o orçamento **sai** de `APPROVED` por qualquer caminho existente (auto-revert, "Reprovar valor", cancelamento); com o status fixado, o registro continua vigente | O dono decidiu manter o comportamento de hoje (DD8). O registro dá ao portal e ao documento o "quem aprovou, quando e como"; o app instalado pina `status` em toda gravação (`budget.dart:1227-1231`) e continua com o efeito de hoje | **DECIDIDO (DD8)** |
| D-28 | **Eixo da assinatura** | `Budget.signatureStatus BudgetSignatureStatus @default(NOT_ISSUED)` **persistido** (ordena e filtra no servidor, como `Billing.status`). Escrito **só** pelo `SignatureEnvelopeService`, **na mesma transação** da mudança do envelope (emissão → `AWAITING_CUSTOMER`; grupo 0 completo → `AWAITING_ANKAA`; `COMPLETED` → `SIGNED`; vencido → `EXPIRED`; recusado → `REFUSED`; invalidado → `INVALIDATED`; cancelado → `NOT_ISSUED`). `WAIVED` nasce **só** na migração (aprovados sem coleta) e na conciliação (D-34): **não há ato manual "Dispensar assinatura"** (DD7). O único escritor manual do eixo é o ato "Assinado fora do sistema" (DD11: COMMERCIAL/ADMIN, nota e anexo obrigatórios) → `SIGNED_OFFLINE`, na transação do `BudgetOfflineSignature`; quando o orçamento sai de `APPROVED`, `SIGNED_OFFLINE → INVALIDATED`. `SIGNED`/`SIGNED_OFFLINE`/`WAIVED` é o que libera a cobrança (D-30). Coerência com o envelope vigente vigiada pela guarda G29. `markSigned` passa a ser reexecutável no `replayCompletion` (fecha o X9) | Um eixo derivado a cada leitura custaria um `JOIN` com `DISTINCT ON` em toda lista; persistido, é o mesmo desenho do `Billing.status` de 16/09 | técnica; `WAIVED` manual: **DECIDIDO (DD7)** que não existe; `SIGNED_OFFLINE`: **DECIDIDO (DD11)** |
| D-29 | **Portão único de emissão** | `assertEmissionReady(quoteId, tx?)` chamado no preflight (`signature-envelope.service.ts:471`), no `createEnvelope` (`:907`) **e dentro da transação** (`:1441`) (linhas da Revisão 2). Bloqueios: **E1** `VALUE_NOT_APPROVED` (`status = APPROVED` ∧ aprovação do valor vigente); **E2** `ARTWORK_PENDING` (toda tarefa não cancelada tem implemento com ≥1 arte `APPROVED` vigente — **sem dispensa**, DD9; mensagem lista os veículos, reusando `describeVehicleList`/`layoutGateFailure` de `src/utils/quote-layout-coverage.ts`, que a `main` já trouxe); **E3–E7** os de hoje (coleta viva/concluída, 2 pagadores, validade, responsáveis, recortes). Sai o portão de `Budget.layoutFiles` (`:626-631`, `:1077-1108`) e o de cobertura por veículo que a `main` pôs no lugar dele. O preflight ganha **`gates`** estruturado **sem mudar `blockers: string[]`** (o app instalado só lê string, `envelope_models.dart:781-784`). O mesmo cálculo sai como `emission: { ready, blockers[] }` no detalhe do orçamento e no portal. A emissão **não escreve mais `Budget.status`** (sai o bloco que força `PENDING`, `:1525-1570`, e com ele o X1) | Portões repetidos em 3 lugares divergem (preflight diz "pode", POST dá 400); a arte pode ser reprovada entre o render e o commit | **DECIDIDO (DD2, DD9)** na regra; forma: técnica |
| D-30 | **Onde o Billing nasce e quando se cobra** | O `Billing` continua nascendo na **criação** do orçamento como plano (`budget.service.ts:622-660`; `budget-customer-config-sync.ts:890,996`; cópia `task.service.ts:13458`; conciliação `receivable-task-match.service.ts:988`) — nada muda aí. **A aprovação da cobrança muda (DD7, Revisão 3):** exige `status === APPROVED` **e** `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}` no ponto único que já existe (`internalApprove`, `budget.service.ts:4229` depois do merge do P00; rotas `PUT /billings/:id/approve` e a antiga por tarefa chegam nele). Recusa: 400 "A cobrança só pode ser aprovada depois da assinatura do orçamento." O faturamento mostra o selo "Assinatura: …" e o filtro. Corrigir junto o filtro **negativo** do financeiro (`schemas/task.ts:1775`, `notIn [PENDING, SIGNED, EXPIRED]`) para **positivo** `APPROVED` (X6). As telas de faturamento (web, app) desabilitam "Aprovar" com o motivo quando o eixo não é `SIGNED`/`SIGNED_OFFLINE`/`WAIVED` | Decisão do dono. Mudar quando nasce o Billing reabriria o P2 de 17/09 sem pedido. Impacto medido em produção: 504 aprovados sem coleta → `WAIVED` (faturáveis); 30 com COMPLETED → `SIGNED`; **nº 885** (coleta vencida, cobrança pendente) trava até reassinar ou até o "Assinado fora do sistema" (triagem `LEGACY_APPROVED_UNSIGNED`) | **DECIDIDO (DD7, DD11)** |
| D-31 | **Arte que muda depois da emissão** | Só a **aprovação** de uma versão nova muda `layoutFileIds` (D-21). O `ImplementLayoutService` chama `onQuoteContentChanged` do orçamento da tarefa em **toda** mudança de estado de arte. Coleta `RUNNING`: **material** — invalida (motivo "Arte do veículo X mudou"), `signatureStatus → INVALIDATED`, o valor **continua** `APPROVED`, e a reemissão já sai com a arte nova; a tela de "Enviar nova versão" avisa que a coleta cai. Coleta `COMPLETED` (contrato selado): **não invalida** — tolerância `tolerateArtworkAfterSeal` aplicada **só** quando o envelope comparado está `COMPLETED`; grava deriva (`recordDriftOnce`), mostra "arte alterada depois da assinatura" e oferece **aditivo de arte** opcional, no molde de `issueVehicleAddendum` (`signature-envelope.service.ts:7644`) | Hoje uma alteração material derruba também o `COMPLETED`, mesmo com cobrança faturada (`:6884-7050`; X5). Com a arte mudando no implemento, isso viraria rotina | técnica; [pergunta 8] |
| D-32 | **Contrato da série** | Escrita no topo (`serialNumber` em `POST/PUT /tasks`, `/tasks/batch`, `/tasks/batch-with-quote`) é **traduzida** para `implement.serialNumber` num ponto só (mapeador do repositório) **até a R-D, ou para sempre se o censo não zerar** (é barata); nunca sai do zod antes disso (sairia com 200). Topo e `implement.serialNumber` diferentes → 400. Validação **igual à de hoje** e **só quando a série muda** (V15). Na leitura, o espelho responde tudo (`where`, `orderBy`, `select`, busca, SQL cru) sem tradutor | O `taskUpdateSchema` não é strict; a Agenda do app ordena por `serialNumber` em toda chamada | técnica; [pergunta 19] |
| D-33 | **Dispensar arte** de um implemento | **Não existe** (DD9, Revisão 3): todo serviço tem arte (até a pintura geral manda a arte do baú na cor). Saem do plano as colunas `Implement.artworkWaived*`, o CHECK, as rotas `PUT/DELETE /implements/:id/artwork-waiver`, o rótulo "Dispensada" da arte e toda menção de "ou dispensada" no E2, no portão de produção, no portal e no checklist. O que protege o legado é o "só trabalho novo" da D-15 | O v1/Revisão 2 temia "serviço sem arte travado para sempre"; o dono afirma que esse serviço não existe | **DECIDIDO (DD9)** |
| D-34 | **Nascimento do orçamento** | **O servidor decide**: `PENDING` para criação interna (aninhada, `POST /budgets`, cópia), `REQUESTED` para a requisição do portal. `status` no corpo de criação é **ignorado** com log e contador (fecha X4: hoje nasce em qualquer status, inclusive `APPROVED`, `budget.service.ts:521-527`). A exceção é a conciliação, que cria o orçamento já `APPROVED` com cobrança aprovada (`receivable-task-match.service.ts:955-968`) quando o dinheiro já entrou: continua, com `BudgetValueApproval{source: MIGRATED}` e `signatureStatus = WAIVED` (é o único escritor de `WAIVED` fora da migração; a conciliação **não** usa o "Assinado fora do sistema", DD11) | 11 escritores mandam `PENDING` (6 web, 1 app, 4 API); o app instalado não muda | técnica |
| D-35 | **Nomes do portal que nunca foram a produção** | Renomear **agora** (o preço sobe no 1º deploy): capacidade `PRE_APPROVE` → **`APPROVE_VALUE`** (rótulo "aprovar o valor"), rota `PUT /cliente/me/orcamentos/:id/pre-aprovar` → **`…/aprovar-valor`**, `canPreApprove` → `canApproveValue`, `waitingOnMe.preApproval` → `waitingOnMe.valueApproval`. `BudgetRequest.preApprovedAt/By` continua sendo gravado (tela e changelog o leem), mas a fonte de verdade é `BudgetValueApproval`, e o portal **para de fabricar** `BudgetRequest` para orçamento nascido por dentro (`portal-decision.service.ts:251-296`) | "Pré" deixa de ser verdade; nada disso está na `main` (conferido) | técnica |
| D-36 | **App instalado aprovando sem nota** | `PUT /budgets/:id/budget-approve` e `PUT /:id/status {APPROVED}` vindos do app 1.4.1 (sem nota) são aceitos com `source = LEGACY_APP` e nota automática "Aprovado pelo app antigo, sem nota" **até a R-C** (426); `PUT /:id/status {PENDING, reason}` ("reprovar") continua valendo e revoga a aprovação | O comercial perderia a aprovação pelo celular até atualizar | [pergunta 6] |

---

## 2A. Máquina de estados do orçamento (Revisão 2, DD2)

Fontes: `08-estado-orcamento-api.md` (API) e `09-estado-orcamento-clientes.md` (web, portal, app), mais a conferência da Revisão 2. Tudo o que está em `08` §1 e `09` §1–§4 como FATO foi lido por eles com `arquivo:linha`; o que eu reconferi está no bloco da Revisão 2 no topo.

### 2A.1 A alternativa escolhida e por quê

Três desenhos foram postos na mesa. **(a)** do `08`: os valores ficam, `PRE_APPROVED` vira "Valor aprovado", `PENDING` passa a existir só com coleta e `APPROVED` continua sendo o fim. **B** do `09`: um valor novo `AWAITING_SIGNATURE` para a coleta, e `PENDING` volta ao sentido de produção. **C** do `09`: `APPROVED` passa a ser o valor aprovado e a assinatura ganha um eixo próprio.

| Critério | (a) | B | **C (escolhida)** |
|---|---|---|---|
| Valores de `BudgetStatus` que **estão em produção** (`PENDING`, `SIGNED`, `EXPIRED`, `APPROVED`, `CANCELLED`; FATO `git show main:prisma/schema.prisma:4522-4540`) | `PENDING` muda de sentido ("Pendente" → "só com coleta"): os 155 `PENDING` sem coleta migram para `IN_NEGOTIATION` | preservados | preservados |
| Sentido de `APPROVED` | final, depois da assinatura (ou manual) | final | **valor aprovado**, antes da emissão (a frase do dono: "orçamento aprovado será antes") |
| ~25 pontos que tratam `APPROVED` como "pode faturar" (`09` §4) | nada muda | nada muda | os leitores não mudam; o **portão** da cobrança ganha `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}` (DD7), num ponto só |
| App instalado cria com `'status': 'PENDING'` (`budget_form_screen.dart:1969`) | errado: a API teria de traduzir | certo | certo |
| App instalado lista só `status IN [EXPIRED, SIGNED, PENDING, APPROVED]` (`budget_list_config.dart:89-91`) | **todo orçamento antes da emissão some do celular** | somem também os em coleta | somem só `REQUESTED`/`IN_NEGOTIATION`, como já acontece na branch |
| App instalado "Aprovar Orçamento" em `PENDING` → `/budget-approve` (`budget_sections.dart:164-167`) | aprovaria um orçamento "em coleta" | a API recusa: o comercial perde a aprovação pelo celular até atualizar | **é o ato certo** (aprovar o valor); falta só a nota (D-36) |
| Histórico: 283 linhas `PENDING→BUDGET_APPROVED` (`09` F4) | relidas como "Aguardando assinatura → Aprovado" (falso) | certas | certas |
| DDL | nenhuma no enum, mas 155 linhas mudam de sentido | +1 valor; `queueRank` não precisa ser recriado | recriar o tipo sem `PRE_APPROVED` e recriar `queueRank`. As duas migrações que criaram esses objetos (`20260920120000`, `20260920190000`) **ainda não foram a produção** |
| "Cobrar só depois de assinar" (**decidido pelo dono, DD7**) | exige remodelar | já é assim | uma condição a mais **num ponto** (`internalApprove`, `budget.service.ts:4229` depois do merge do P00) |
| Veredito | descartada: inverte dado de produção e esconde do app tudo o que está antes da emissão | descartada: acrescenta estado que o app instalado mostra cru e tira a aprovação pelo celular | **escolhida** |

**Por que (a) parecia mais barata e não é** (INF sobre FATO): o argumento do `08` é "nenhuma DDL de enum, nenhuma mexida em `queueRank`". Mas o tipo `BudgetStatus` com 8 valores, o `statusOrder` de 8 degraus e o `queueRank` híbrido **só existem na branch**. A DDL que (a) economiza é sobre objetos que ainda nem foram publicados; o dado que (a) muda de sentido (155 `PENDING`, o preset "Orçamentos Esperando Aprovação", 1 dashboard salvo com `PENDING`, 283 linhas de histórico) **é** de produção.

### 2A.2 O grafo novo

```
EIXO DO VALOR — Budget.status                                   M = manual (interno)  P = portal  S = sistema

 portal ▶ REQUESTED ─┐                     "Enviar para aprovação do cliente" (M)
 interno ▶ PENDING ──┴───────────────────────────────────────────▶ IN_NEGOTIATION ──"Aprovar valor" (P, APPROVE_VALUE)──▶ APPROVED ──▶ cobrança SÓ com
             ▲   │                                                     │                                                    │   signatureStatus SIGNED/SIGNED_OFFLINE/WAIVED (DD7, DD11)
             │   │                                                     └─ recusa (P, motivo) ──▶ PENDING                   │
             │   └──────── "Aprovar valor em nome do cliente" (M, nota obrigatória; também de REQUESTED) ─────────────────▶│
             └──────────── valor mudou sem status fixado (S, auto-revert de hoje, DD8) · "Reprovar valor" (M, motivo) · "Retirar do cliente" (M)
 EXPIRED ◀─(S, só coleta LEGADA sobre PENDING)    EXPIRED ─reanálise (M)─▶ PENDING | IN_NEGOTIATION
 qualquer não terminal ─▶ CANCELLED (M/S, desmonte)                     SIGNED: legado, nunca mais escrito

EIXO DA ASSINATURA — Budget.signatureStatus (anda com Budget.status = APPROVED; as coletas legadas andam sobre PENDING)

 NOT_ISSUED ──emissão [assertEmissionReady: E1 valor ∧ E2 arte ∧ E3–E7]──▶ AWAITING_CUSTOMER ──grupo 0 completo──▶ AWAITING_ANKAA ──contra-assinatura──▶ SIGNED
   ▲                                                                            │ recusa ─▶ REFUSED                  │
   │    WAIVED: só migração e conciliação (DD7; sem ato de tela)               │ prazo ─▶ EXPIRED                    │ arte nova aprovada / elenco / validade ─▶ INVALIDATED
   └───── reemitir (de NOT_ISSUED, REFUSED, EXPIRED, INVALIDATED, WAIVED; mesmo portão) ◀──────────────────────────────┘
 SIGNED, SIGNED_OFFLINE (DD11) ou WAIVED (legado) ─▶ a cobrança pode ser aprovada (DD7)
 NOT_ISSUED/REFUSED/EXPIRED/INVALIDATED ──"Assinado fora do sistema" (M, COMMERCIAL/ADMIN, nota + anexo; E1 ∧ E3)──▶ SIGNED_OFFLINE
 SIGNED_OFFLINE ──o orçamento sai de APPROVED (S)──▶ INVALIDATED (o BudgetOfflineSignature vigente é fechado)
 SIGNED + arte nova aprovada ─▶ fica SIGNED (deriva registrada; aditivo opcional, D-31)
 valor mudou com coleta RUNNING ─▶ a coleta ─▶ INVALIDATED por mudança material (como hoje) e, sem status fixado,
                                    Budget.status APPROVED→PENDING pelo auto-revert de hoje (DD8)
```

### 2A.3 Eixo do valor: estado → rótulo → quem move → efeitos

| Valor (não muda) | Rótulo de tela | Significado novo | Entra por (quem move) | Efeitos | Próxima ação é de |
|---|---|---|---|---|---|
| `REQUESTED` | Requisição | pedido do portal, sem preço | P: requisição (`portal-request.service.ts:328-333`, capacidade `REQUEST_BUDGET`) | `budget.portal_requested` (igual) | Ankaa |
| `PENDING` | **Pendente** (volta ao rótulo de produção; a branch dizia "Aguardando Assinatura") | orçamento em montagem ou revisão pela Ankaa; **nascimento interno** (D-34) | nascimento (servidor); S: valor mudou sem status fixado (auto-revert de hoje, DD8); M: "Reprovar valor" (motivo); M: "Retirar do cliente"; P: recusa do valor (motivo); M: reanálise de `EXPIRED`; M: requisição assumida por dentro (`REQUESTED → PENDING`) | fecha a aprovação vigente (`revokedAt`, motivo); se havia coleta `RUNNING`, ela é invalidada (como hoje) | Ankaa |
| `IN_NEGOTIATION` | **Aguardando aprovação do cliente** | valor enviado ao cliente | M: "Enviar para aprovação do cliente" (ADMIN/COMMERCIAL) de `REQUESTED`, `PENDING`, `EXPIRED` | `budget.portal_values_visible` ao requisitante/contatos (hoje só quando vem de `REQUESTED`, `budget.service.ts:2911-2931`; passa a valer de qualquer origem) | cliente |
| `APPROVED` | **Aprovado** | **valor aprovado**. Habilita a emissão quando a arte estiver aprovada. **Não libera a cobrança sozinho**: a cobrança espera `signatureStatus = SIGNED` ou `SIGNED_OFFLINE` (DD7, DD11) | P: "Aprovar valor" (`APPROVE_VALUE`, D-35) de `IN_NEGOTIATION`; M: "Aprovar valor em nome do cliente" (ADMIN/COMMERCIAL, **nota obrigatória**) de `REQUESTED`/`PENDING`/`IN_NEGOTIATION`, com ≥1 serviço e total > 0; S: conclusão de coleta **legada** (`PENDING` → `APPROVED`, `budget.module.ts:82-84`); M (app 1.4.1): `/budget-approve` sem nota → `LEGACY_APP` (D-36) | grava `BudgetValueApproval`; `task_quote.budget_approved` ao financeiro (igual, `budget.service.ts:3655-3666`; o texto passa a dizer que a cobrança espera a assinatura); **novo** `task_quote.value_approved` ao comercial com o que falta (artes); se nada falta, **novo** `task_quote.ready_for_signature` e regra de Atenção `budget.ready-to-emit` | Ankaa (arte, emissão) ou cliente (arte) |
| `EXPIRED` | Aguardando Reanálise | coleta **legada** (emitida sobre `PENDING` antes da R-B) venceu ou foi recusada | S: `markExpiredBySignature`/`markRefusedBySignature`, só de `PENDING` (`budget.service.ts:3434-3480`, `:3500-3556`) | igual a hoje | Ankaa |
| `SIGNED` | Assinado (legado) | **nunca mais escrito**; fica no enum porque o app instalado filtra por ele | — (linhas existentes migram para `APPROVED` + `AWAITING_ANKAA`, §2A.10) | — | — |
| `CANCELLED` | Cancelado | terminal | M/S: `cancelForTaskCancellation` e os escritores diretos de tarefa/O.S. (`task.service.ts:10092-10110`; `service-order.service.ts:1144-1160`, `:3160-3172`) | desmonte (igual); revoga a aprovação; cancela a coleta viva | — |
| `PRE_APPROVED` | — | **sai do enum** (nunca foi a produção) | — | linhas existentes (0 no clone) → `APPROVED` com `BudgetValueApproval{MIGRATED}` autorada por `BudgetRequest.preApprovedBy` | — |

**Ordem e fila** (colunas persistidas, `§3.3`): `statusOrder` = `REQUESTED 1, EXPIRED 2, PENDING 3, IN_NEGOTIATION 4, APPROVED 5, SIGNED 5, CANCELLED 6`, com `@default(3)` no Prisma **e** no banco (fecha o X8: hoje o schema diz 1 e o banco 6). `queueRank` recriado: mais recente primeiro para `REQUESTED, EXPIRED, PENDING, APPROVED, SIGNED, CANCELLED` (a bola é da Ankaa ou terminou); mais antigo primeiro para `IN_NEGOTIATION` (espera-se o cliente). O `EXPIRED` muda de grupo, o que corrige a incoerência que o `08` §1.2 apontou, **e o `PENDING` também** (auditoria §14, FATO: a expressão viva, `20260920190000_fila_hibrida_por_estado/migration.sql:52-60`, põe `PENDING` no grupo "espera-se o cliente", mais antigo primeiro, porque na branch ele era "Aguardando Assinatura"; no Modelo C ele é "com a Ankaa" e vai para mais recente primeiro — são os 164 `PENDING` do clone; em produção, 7). INF: confirmar com quem usa a fila no P00.

### 2A.4 Eixo da assinatura: estado → rótulo → escritor → efeitos

| Valor | Rótulo | Escritor (sempre na transação do envelope, salvo `WAIVED` e `SIGNED_OFFLINE`) | Efeitos |
|---|---|---|---|
| `NOT_ISSUED` | Não emitida | padrão; envelope `CANCELLED` pela Ankaa | conta no filtro "Prontos para emitir" quando o checklist fecha |
| `AWAITING_CUSTOMER` | Aguardando assinaturas (k/n) | `createEnvelope` (`signature-envelope.service.ts:907+`, na transação `:1441-1570`) | convites e lembretes de hoje (`orcamento_para_assinar`, `orcamento_codigo`, `orcamento_aguardando_assinatura`, `signature-whatsapp-templates.ts:39-65`) |
| `AWAITING_ANKAA` | Falta a Ankaa | `advanceEnvelope` quando o grupo 0 completa (`:5851-5875`; hoje chama `markSigned`, `budget.service.ts:3367-3420`) | `task_quote.signed` + `orcamento_contra_assinatura` (iguais) |
| `SIGNED` | Assinada | `finalize` → `onCompleted` (`:6699-6725`) | **libera a aprovação da cobrança** (DD7); coleta legada sobre `PENDING`: chama `budgetApprove` (sem portão de layout) → `APPROVED` + `BudgetValueApproval{SIGNATURE}`; coleta nova: não mexe em `Budget.status` |
| `REFUSED` | Recusada | `applyRefusal` (`:4264-4275`) | coleta nova: o valor **continua** `APPROVED` [pergunta 7]; coleta legada: `markRefusedBySignature` → `EXPIRED` (igual) |
| `EXPIRED` | Vencida | varredura horária (`signature-expiry.scheduler.ts:38-150`) | idem |
| `INVALIDATED` | Invalidada — reemitir | `onQuoteContentChanged` (`:6884-7050`) | se o valor mudou sem status fixado, `Budget.status` já foi a `PENDING` pelo auto-revert de hoje (DD8); se foi arte/elenco/validade (ou valor com status fixado), o valor segue `APPROVED` e o orçamento volta a "Pronto para emitir" assim que o checklist fechar. Com contrato `COMPLETED`, arte nova não invalida (D-31). A cobrança fica travada até reassinar (DD7) |
| `WAIVED` | Dispensada (legado) | **só** a migração (aprovados sem coleta nenhuma; 504 em produção) e a conciliação que cria orçamento já pago (D-34). **Nenhum ato de tela** escreve `WAIVED` (DD7; o ato de tela equivalente, "Assinado fora do sistema", escreve `SIGNED_OFFLINE`, DD11) | libera a cobrança como `SIGNED`; a emissão continua possível (volta a `AWAITING_CUSTOMER`) |
| `SIGNED_OFFLINE` | **Assinada fora do sistema** | `BudgetService.registerOfflineSignature` (ato "Assinado fora do sistema": COMMERCIAL/ADMIN, **nota e anexo obrigatórios**, DD11), na mesma transação do `BudgetOfflineSignature` e da linha de `ChangeLog` (campo `signatureStatus`, motivo = a nota) | **libera a cobrança como `SIGNED`** (DD7), mas aparece distinto na tela e na trilha; não se reemite por cima (como `SIGNED`: E3 conta o registro vigente); se o orçamento **sai** de `APPROVED` (valor mudou sem status fixado, "Reprovar valor", cancelamento), vai a `INVALIDATED` e o registro é fechado (`revokedAt`, motivo). É o caminho do nº 885 |

### 2A.5 Transições: tabela única (manual, portal, sistema)

| De → Para | Tipo | Gatilho e ator | Guardas | Efeitos |
|---|---|---|---|---|
| REQUESTED/PENDING/EXPIRED → IN_NEGOTIATION | M | "Enviar para aprovação do cliente" (ADMIN/COMMERCIAL) | ≥1 serviço com valor | `budget.portal_values_visible` |
| IN_NEGOTIATION → APPROVED | P | "Aprovar valor" (`APPROVE_VALUE`: COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR; escopo `budgetScopeWhere`, 404 fora) | máquina via `assertTransitionAllowed` (`portal-decision.service.ts:113-226`) | `BudgetValueApproval{PORTAL, responsibleId}`; `BudgetRequest.preApprovedAt/By` também (sem fabricar requisição, D-35); aviso ao comercial com o que falta |
| REQUESTED/PENDING/IN_NEGOTIATION → APPROVED | M | "Aprovar valor em nome do cliente" — rota nova `PUT /budgets/:id/value-approval { note }` **e** `PUT /:id/status { APPROVED, reason }` pelo mesmo serviço (ADMIN/COMMERCIAL) | nota obrigatória; ≥1 serviço, total > 0; `validateQuoteStatusChangeRole` aplicado **também** em `PUT /:id/status` (hoje só no `update()` genérico, `budget.guards.ts:237-254`; fecha o X7: FINANCIAL não aprova valor) | `BudgetValueApproval{ON_BEHALF, userId, note}` |
| PENDING/SIGNED → APPROVED | M (app 1.4.1) | `PUT /:id/budget-approve` sem nota | só na janela (até R-C) | `BudgetValueApproval{LEGACY_APP}`, nota automática (D-36) |
| IN_NEGOTIATION → PENDING | P | recusa do valor (motivo obrigatório) | escopo | `budget.portal_refused` (igual); `BudgetRequest.refusedAt/By` |
| IN_NEGOTIATION → PENDING | M | "Retirar do cliente" | sem motivo | — |
| REQUESTED → PENDING | M | assumir a requisição por dentro (cliente sem vendedor no portal; aresta que já existe) | ADMIN/COMMERCIAL | — |
| APPROVED → PENDING | S | valor mudou: o auto-revert de hoje (`hasValueAffectingChange` em `budget.service.ts` e o gêmeo em `task.service.ts`), **salvo** quando o chamador fixa o status (o "fixar Aprovado" do assistente fica, DD8) | sem cobrança congelada (a edição com cobrança congelada já é recusada, `budget.service.ts:1259-1280`) | fecha a aprovação vigente; a coleta `RUNNING` cai por mudança material (como hoje, `onQuoteContentChanged`); aviso ao cliente "novos valores" e ao comercial. **É** o mecanismo de hoje, sem hash novo |
| APPROVED → PENDING | M | "Reprovar valor" (motivo obrigatório; app 1.4.1 manda `{PENDING, reason}`) | sem cobrança congelada (`:2825-2835`) | revoga; changelog `ROLLBACK` com motivo (igual) |
| PENDING → EXPIRED | S | coleta **legada** vence ou é recusada | só de `PENDING` (igual) | igual |
| EXPIRED → PENDING / IN_NEGOTIATION / CANCELLED | M | reanálise | — | — |
| * → CANCELLED | M/S | desmonte | — | revoga; cancela coleta viva |
| CANCELLED → estado anterior | S | O.S. comercial reativada (`service-order.service.ts:209-230`) | **não ressuscita** `PENDING` "com coleta" nem `APPROVED` sem aprovação vigente: se o valor do changelog for `APPROVED` e a aprovação estiver revogada, volta a `PENDING` | — |
| (eixo) NOT_ISSUED/REFUSED/EXPIRED/INVALIDATED/WAIVED → AWAITING_CUSTOMER | M | "Enviar para assinatura" (ADMIN/COMMERCIAL) | `assertEmissionReady` (D-29) | não toca em `Budget.status` |
| (eixo) NOT_ISSUED/REFUSED/EXPIRED/INVALIDATED → SIGNED_OFFLINE | M | "Assinado fora do sistema" (ADMIN/COMMERCIAL) — `POST /budgets/:id/offline-signature` (DD11) | E1 (valor aprovado e aprovação vigente) ∧ E3 (nenhuma coleta `RUNNING`/`COMPLETED`: "Cancele a coleta em andamento"); **nota e anexo obrigatórios**; não exige E2 (a arte continua travando a produção pela DD3, não a cobrança) | `BudgetOfflineSignature` + `ChangeLog`; `task_quote.signed` ao financeiro (a cobrança pode ser aprovada) |
| (eixo) SIGNED_OFFLINE → INVALIDATED | S | o orçamento sai de `APPROVED` por qualquer caminho de hoje | — | fecha o `BudgetOfflineSignature` vigente (`revokedAt`, motivo); cobrança já aprovada não se desfaz (a trava é na aprovação) |

**O que sai do grafo** (fecha X2): `PENDING` deixa de ser "Aguardando Assinatura" e nenhum destino manual finge coleta. `PRE_APPROVED` sai. `APPROVED → PENDING` continua sendo a "reprovação" (é o que o app instalado manda). O grafo manual (`budget.service.ts:5915-5995`, `ALLOWED`) é separado em duas tabelas — **arestas manuais** e **arestas de sistema** — e o espelho do web (`quote-permissions.ts:66-104`) e o do app (`budget_permissions.dart:106-123`) passam a ser **gerados** do JSON do G5 e conferidos pelo G26.

### 2A.6 A aprovação do valor: registro e prova (Revisão 3, DD8)

- **Modelo** `BudgetValueApproval` (§3.1): append-only, **registro** do ato; a vigente é a última com `revokedAt IS NULL`. `note` obrigatória em `ON_BEHALF` (CHECK). Ator discriminado: `responsibleId` (FK para a tabela física `"Representative"`) **ou** `userId` — nunca id de contato em FK de `User` (GOTCHA do `@UserId()` de 17/09).
- **Sem hash e sem autoridade nova** (DD8): não há `commercialTerms()`, `reassessValueApproval` nem `termsSha256`. "O valor mudou?" continua com a resposta de hoje (`hasValueAffectingChange` + auto-revert em `budget.service.ts`, gêmeo em `task.service.ts`), e o registro só **acompanha**: quando o orçamento sai de `APPROVED` por qualquer caminho existente, a vigente ganha `revokedAt` e o motivo ("valor alterado", "reprovado: …", "cancelado").
- **Pinar** o status **fica como hoje** (DD8): o "fixar Aprovado ao salvar" do assistente de **orçamento** (`web [taskId].tsx:1788-1853`, linhas da Revisão 2) e o do **faturamento** (`web billing/details/[id].tsx:1527-1538`) continuam; com o status fixado o orçamento segue `APPROVED` e o registro segue vigente. A coleta emitida continua caindo por mudança material, como hoje.
- **Leitura**: `valueApproval { at, source, by{name}, note, total, current: boolean }` no detalhe do orçamento e no portal; entra no mapeador do repositório **e** nos `select` do portal (armadilha "select explícito descarta chave nova", `portal-read.service.ts:202-229`), com teste de contrato (G4).

### 2A.7 O portão de emissão, com a arte por implemento

| # | Bloqueio (`gates[].code`) | Regra | O que a tela oferece |
|---|---|---|---|
| E1 | `VALUE_NOT_APPROVED` | `status = APPROVED` ∧ aprovação do valor vigente (`BudgetValueApproval` com `revokedAt` nulo) | "Enviar para aprovação do cliente" / "Aprovar valor em nome do cliente" |
| E2 | `ARTWORK_PENDING` | cada tarefa **não cancelada** do orçamento tem implemento com ≥1 `Layout` `APPROVED` vigente — **sem dispensa** (DD9). A lista nomeia os veículos (série/placa) e o estado de cada arte (Sem arte, Rascunho, Aguardando aprovação do cliente, Reprovada) | por veículo: "Abrir arte", "Enviar ao cliente", "Aprovar em nome do cliente" (nota) |
| E3 | `ENVELOPE_LIVE` | não há coleta `RUNNING` nem `COMPLETED` (igual, `:578-597`, `:1039-1075`, `:1441-1461`) | "Cancelar a coleta" |
| E4 | `TWO_PAYERS` | igual (`:599-611`, `:1030-1037`) | — |
| E5 | `VALIDITY_EXPIRED` | igual (`:633-638`, `:1112-1117`); estender a validade **não** revoga o valor | "Estender validade" |
| E6 | `RESPONSIBLES` | igual (`:640-706`, `:1119-1180`) | — |
| E7 | `SECTIONS` | recortes válidos (igual) | — |

- Chamado em **três** lugares (preflight, `createEnvelope`, transação). O preflight devolve `blockers: string[]` **como hoje** (o app instalado só lê string; o web casava "layout" por regex em `signature-send-dialog.tsx:296`, que sai) **e** `gates: [{ code, ok, detail }]` estruturado, com `detail.artworks[] = { taskId, serialNumber, plate, implementId, layoutId, status, sentAt, decidedAt }` e `detail.value = { at, by, source, total }`.
- O **documento** novo leva, na seção `LAYOUT`, as imagens de `quoteArtworkOf(quote)` (a mesma fonte do E2 e do snapshot), com legenda por veículo quando a cobertura não é uniforme (§2A.9).
- **"Pronto para assinatura"**: quando a última peça chega (valor aprovado com todas as artes já aprovadas, ou a última arte aprovada com o valor já aprovado), dispara `task_quote.ready_for_signature` ao COMMERCIAL e acende o filtro/preset "Prontos para emitir". A emissão **não** é automática: o operador escolhe canal, recorte e cerimônia.

### 2A.8 Onde o Billing nasce e quando se cobra (Revisão 3, DD7)

D-30. Resumo: **nasce na criação** do orçamento, como plano (FATO: os 15 `REQUESTED` do clone já têm `Billing`); a **aprovação** da cobrança (fatura, NFS-e, boleto) exige `Budget.status = APPROVED` **e** `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}` — **cobrança só depois de assinado** (DD7), com o legado migrado `WAIVED` faturável. Um ponto só no código (`internalApprove`, `budget.service.ts:4229` depois do merge do P00, onde já está a checagem de `APPROVED`); as rotas `PUT /billings/:id/approve` e a antiga por tarefa chegam nele. O faturamento **mostra** o selo "Assinatura: …" no cabeçalho do assistente (`web pages/financial/billing/details/[id].tsx`) e na lista, e desabilita "Aprovar" com o motivo. O único ato manual que libera a cobrança sem a coleta eletrônica é "Assinado fora do sistema" (DD11: COMMERCIAL/ADMIN, nota e anexo obrigatórios; eixo `SIGNED_OFFLINE`). O filtro negativo do financeiro vira positivo (X6). A cascata `Billing ↔ Budget` (`billing-status-cascade.service.ts:127`) não muda. Liquidar e reverter uma cobrança **já aprovada** não passam pelo portão novo (a trava é na aprovação).

### 2A.9 A arte na assinatura

1. **Fonte única** `quoteArtworkOf(quote)` em `src/utils/quote-artwork.ts`: para **cada tarefa do orçamento, canceladas inclusive** (o mesmo conjunto de `vehicles[]`, que o `build()` monta sem filtro, `quote-snapshot.service.ts:426-438,491`; auditoria §14), na ordem canônica (`QUOTE_TASKS_ORDER_BY`, `utils/quote-tasks.ts:28-38`), a arte `APPROVED` vigente do implemento, `[{ taskId, layoutId, fileId, file }]`. `QUOTE_SNAPSHOT_INCLUDE` (`quote-snapshot.service.ts:387-439`) ganha `tasks.include.implement.include.layouts: { where: { status: 'APPROVED' }, include: { file: true }, orderBy: [{ createdAt: 'asc' }, { fileId: 'asc' }] }`, com `satisfies Prisma.BudgetInclude`.
2. **`layoutFileIds`** = `unique(fileIds).sort()` (o mesmo arquivo em N implementos conta uma vez; hoje o conjunto não tem repetição).
3. **`layoutCoverage`** só quando a cobertura **não** é uniforme (auditoria §14: tarefa **cancelada sem nenhuma arte** fica fora do teste de uniformidade, senão todo cancelamento de veículo depois da R-B emitiria a chave e mudaria o hash; tarefa cancelada **com** arte conta, como no conjunto migrado pela M-D); `materialProjection` a emite em qualquer versão quando o snapshot a tem. Como a `feat/orcamento-veiculos` está em produção (DD6, Revisão 3), emite também quando `Budget.layoutScope = PER_VEHICLE` (o flag deixa de ser escrito pela tela — a arte vem do implemento — mas é lido para os orçamentos que o tiverem, e o G11 tem envelope `PER_VEHICLE` como caso nomeado).
4. **Diff**: a linha "Layout aprovado" (`quote-diff.ts:1103-1120`) vira "Arte aprovada", mantendo a chave `layout`; ganha a linha por veículo quando há `layoutCoverage`. `withDefaults` para de fabricar `[]` (`:560-567`).
5. **Documento**: `quote-html.builder.ts:291,404,794-819` com legenda por veículo; `quote-renderer.service.ts:455-629` continua com o caminho "orçamento com arte" (a regra da folha própria de assinaturas é espelho de `web pages/public/budget/[id].tsx:111-131` e `service-report/[id].tsx:93-163` e passa a contar a arte dos implementos nos três lugares ao mesmo tempo).
6. **Migração sem derrubar coleta**: regras M-A..M-D (D-13, §4.3 M3 passo 5). Critério de aceite no ensaio: para todo envelope `RUNNING`/`COMPLETED`, `matchesFrozenTerms(buildForQuote(), quoteTermsSha256, quoteSnapshot) !== null` **antes e depois**, com o código novo — **quem casava antes casa depois** (os 14 `RUNNING` de seed que congelaram o `File` `8d426db1…` já não casam hoje e ficam fora, `08` §1.9). Rede de segurança (só se o ensaio achar resíduo): tabela `_Mig0924_ArtworkFromQuote` + tolerância `tolerateMigratedArtwork`, **desligada por padrão**.
7. **Arte nova depois da emissão**: D-31.

### 2A.10 Migração dos orçamentos existentes (produção medida em 23/09; refazer no ensaio com o SQL do §4.3 M3o)

O eixo usa o envelope **vigente**: RUNNING/COMPLETED primeiro, senão o último (auditoria §14). Em produção a distribuição pelo vigente é igual à pelo último (`P00-producao.md` §4). Coluna "Produção" = 23/09; "Clone" = banco local (histórico e dado de teste).

| `Budget.status` × envelope vigente | Produção | Clone | `status` depois | `signatureStatus` | `BudgetValueApproval` criada | Cobrança depois (DD7) |
|---|---:|---:|---|---|---|---|
| APPROVED, sem envelope | **504** (300 com cobrança aprovada, 204 por aprovar) | 427 (158) | APPROVED | `WAIVED` (legado) | `MIGRATED` | faturável |
| APPROVED, COMPLETED | **30** (9 com cobrança aprovada; 21 `Billing` PENDING) | — | APPROVED | `SIGNED` | `MIGRATED` | faturável |
| APPROVED, EXPIRED | **2** (nº 741 com cobrança PARTIAL; **nº 885** com cobrança PENDING) | 1 | APPROVED | `EXPIRED` | `MIGRATED` | **travada até reassinar** — triagem `LEGACY_APPROVED_UNSIGNED` (o nº 741 já faturou; o 885 sai por coleta nova ou pelo "Assinado fora do sistema", DD11) |
| APPROVED, INVALIDATED | 0 | 1 (nº 584, que tem um COMPLETED anterior — dado de teste de 26/07) | APPROVED | **`SIGNED`** pela precedência | `MIGRATED` | faturável |
| CANCELLED, sem envelope ou CANCELLED | 181 | — | CANCELLED | `NOT_ISSUED` | — | — |
| CANCELLED, COMPLETED | 0 | 1 (nº 594) | CANCELLED | `SIGNED` | — | — |
| EXPIRED, REFUSED | 0 | 6 | EXPIRED | `REFUSED` | — | — |
| PENDING, sem envelope | **7** (nº 397, 561–563, 982, 990, 991) | 155 | **PENDING** ("Pendente") | `NOT_ISSUED` | — | — |
| PENDING, EXPIRED / REFUSED / COMPLETED | 0 | 1 / 1 (nº 591, com COMPLETED v6) / — | EXPIRED; o nº 591 vira **APPROVED** (triagem `LEGACY_COMPLETED_NOT_APPROVED`) | `EXPIRED`; `SIGNED` | nº 591: `MIGRATED` | — |
| PENDING, RUNNING | **0** | 7 | PENDING (coleta **legada**: a conclusão aprova, como hoje) | `AWAITING_CUSTOMER` ou `AWAITING_ANKAA` | — (nasce `SIGNATURE` na conclusão) | depois de concluída |
| REQUESTED (qualquer) | **0** (o valor não existe no enum de produção) | 15 (9 com RUNNING de seed) | REQUESTED; com RUNNING → **PENDING** | `NOT_ISSUED` / `AWAITING_*` | — | — |
| SIGNED | 0 | 0 | APPROVED | `AWAITING_ANKAA` | `MIGRATED` | depois de concluída |
| PRE_APPROVED / IN_NEGOTIATION | 0 (não existem em produção) | 0 | APPROVED / IN_NEGOTIATION | `NOT_ISSUED` | `MIGRATED` (autor `BudgetRequest.preApprovedBy`) / — | — |

### 2A.11 Defeitos achados pelo `08` (§1.10) e o destino de cada um

| # | Defeito | Destino no Modelo C |
|---|---|---|
| X1 | Emissão força `PENDING` a partir de `APPROVED` com cobrança faturada (`signature-envelope.service.ts:1533-1545`) | some por construção: a emissão não escreve `Budget.status` (D-29) |
| X2 | `PENDING` como destino manual sem coleta (155 no clone) | `PENDING` volta a ser "Pendente": deixa de ser mentira |
| X3 | `PRE_APPROVED` fora do auto-revert (`budget.guards.ts:198-210`) | `PRE_APPROVED` sai; o auto-revert de hoje cobre `APPROVED` (DD8) |
| X4 | Criação aceita qualquer status (`budget.service.ts:521-527`) | o servidor decide (D-34) |
| X5 | `COMPLETED` invalidado com cobrança faturada (`:6917-6926`) | para a arte, `tolerateArtworkAfterSeal` (D-31); para o valor, a edição com cobrança congelada já é recusada |
| X6 | Filtro negativo do financeiro (`schemas/task.ts:1775`) | positivo `APPROVED` (D-30) |
| X7 | FINANCIAL pré-aprova em `/status` sem nota (`budget.controller.ts:185-186`) | `validateQuoteStatusChangeRole` também em `/status`; aprovar valor é ADMIN/COMMERCIAL com nota |
| X8 | `statusOrder` default diverge (schema 1 × banco 6) | `@default(3)` nos dois (§3.3) |
| X9 | `markSigned` fire-and-forget (`:5866-5874`) | `replayCompletion` reconhece "grupo 0 completo e eixo ainda `AWAITING_CUSTOMER`" (D-28) |

### 2A.12 O app instalado (1.4.1+24) na máquina nova

| Situação | O que o app faz | Consequência | Mitigação |
|---|---|---|---|
| Orçamento em `REQUESTED`/`IN_NEGOTIATION` | fora do `where` da lista (`budget_list_config.dart:89-91`) | invisível no celular (já é assim na branch) | janela + 426 (D-17); P24 deriva a lista do enum |
| Orçamento `APPROVED` sem assinatura concluída | mostra "Aprovado" e oferece "Aprovar Faturamento" (`budget_sections.dart:160-180`) | a API **recusa** a cobrança (DD7) com 400 e a frase "A cobrança só pode ser aprovada depois da assinatura do orçamento.", que o app mostra em toast (`api_exception.dart:68-75`) | selo "Assinatura" e botão desabilitado com o motivo no app novo (P24) |
| "Aprovar Orçamento" em `PENDING` (`/budget-approve`, sem nota) | aprova | aceito como `LEGACY_APP` até R-C (D-36) | 426 depois |
| "Reprovar" (`PUT /:id/status {PENDING, reason}`) | reprova | aceito (é `APPROVED → PENDING`) | — |
| "Enviar para assinatura" sem valor/arte | abre o `send_sheet` | vê o bloqueio como **texto** (`blockers: string[]`, `widgets/send_sheet.dart:301-305,699-722`) e o envio fica travado | **não** mudar a forma de `blockers` (G27) |
| Cria orçamento com `'status':'PENDING'` | cria | nasce "Pendente" (certo) | a API ignora `status` e conta (D-34) |
| Lê `SIGNED` legado | "Assinado" verde | coerente | — |
| Lê `PRE_APPROVED` | cru, cinza | não acontece: 0 linhas depois da M3o | — |
| Pina `status` em todo save (`budget.dart:1227-1231`) | manda o status atual | **como hoje** (DD8): com o status fixado, o valor editado continua `APPROVED` | — |

---

## 3. Modelo-alvo (`api/prisma/schema.prisma`)

### 3.1 Diff do schema

```diff
 model Task {
   …
-  serialNumber          String?  @unique
+  /// ESPELHO somente leitura de Implement.serialNumber (gatilho, M1s). Sem @unique:
+  /// a unicidade é só do implemento. Sai em M5s (R-D). Escrever aqui = erro 23514.
+  serialNumber          String?
+  /// (serialNumberNormalized, coluna gerada, e o GIN da tarefa ficam até M5s; a coluna segue DECLARADA
+  ///  no Prisma como hoje, schema.prisma:2440, com `omit` global — auditoria §14: o texto dizia "fora do Prisma")
   …
-  truck                 Truck?
+  /// DD1: toda tarefa tem EXATAMENTE um implemento (Implement.taskId @unique +
+  /// CONSTRAINT TRIGGER diferido "Task_has_implement"). O Prisma não expressa o
+  /// "ao menos um": o tipo continua opcional e o banco garante.
+  implement             Implement?
   …
-  layouts               Layout[]              @relation("TaskLayouts")
-  projectFiles          File[]                @relation("TASK_PROJECT_FILES")
+  /// PROJETO DA TAREFA: o PDF com as cotas de colagem (o que abre no cotador).
+  /// Até 09/2026 este nome guardava o projeto da Furgões — os 4 arquivos foram
+  /// para Implement.projectFiles (migração 20260930120200).
+  projectFiles          File[]                @relation("TASK_PROJECT_FILES")
 }

-model Truck {
+/// IMPLEMENTO: a carroceria do cliente (Furgões/cliente), 1:1 com a tarefa.
+/// Toda tarefa tem exatamente um (DD1). Endereçar SEMPRE por Implement.id (nunca
+/// por taskId) — a virada N:1 fica aditiva.
+model Implement {
   id                 String            @id @default(uuid())
+  /// DD1: o número de série é do implemento (Implement_serialNumber_key).
+  serialNumber       String?           @unique
   plate              String?           @unique
   chassisNumber      String?
-  category           TruckCategory?
-  implementType      ImplementType?
+  type               ImplementType?
+  category           ImplementCategory?
-  spot               TRUCK_SPOT?       @default(YARD_WAIT)
+  spot               TRUCK_SPOT?                        // D-03: fica aqui; SEM default (S-8, M1s)
   taskId             String            @unique
   createdAt          DateTime          @default(now())
   updatedAt          DateTime          @updatedAt
   backSideMeasureId  String?
   leftSideMeasureId  String?
   rightSideMeasureId String?
+  frontSideMeasureId String?
+  /// Porta traseira (R5). Nulo = não informado. CHECKs em SQL (§3.3).
+  rearDoorLeaves     RearDoorLeaves?
+  rearDoorBarCount   Int?              @db.SmallInt   // varões: 2 | 3 | 4
+  rearDoorHatchCount Int?              @db.SmallInt   // portinholas: 0..6 (só quantidade, DD4)
+  // (Revisão 3, DD9: sem "Dispensar arte" — as colunas artworkWaived* saíram do desenho)
   vinPlateId         String?
-  vinPlate           File?             @relation("TRUCK_VIN_PLATE", fields: [vinPlateId], references: [id], onDelete: SetNull)
-  backSideMeasure    ImplementMeasure? @relation("TRUCK_BACK_SIDE", fields: [backSideMeasureId], references: [id])
-  leftSideMeasure    ImplementMeasure? @relation("TRUCK_LEFT_SIDE", fields: [leftSideMeasureId], references: [id])
-  rightSideMeasure   ImplementMeasure? @relation("TRUCK_RIGHT_SIDE", fields: [rightSideMeasureId], references: [id])
+  vinPlate           File?             @relation("IMPLEMENT_VIN_PLATE", fields: [vinPlateId], references: [id], onDelete: SetNull)
+  backSideMeasure    ImplementMeasure? @relation("IMPLEMENT_BACK_SIDE",  fields: [backSideMeasureId],  references: [id], onDelete: SetNull)
+  leftSideMeasure    ImplementMeasure? @relation("IMPLEMENT_LEFT_SIDE",  fields: [leftSideMeasureId],  references: [id], onDelete: SetNull)
+  rightSideMeasure   ImplementMeasure? @relation("IMPLEMENT_RIGHT_SIDE", fields: [rightSideMeasureId], references: [id], onDelete: SetNull)
+  frontSideMeasure   ImplementMeasure? @relation("IMPLEMENT_FRONT_SIDE", fields: [frontSideMeasureId], references: [id], onDelete: SetNull)
   task               Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)
+  layouts            Layout[]          @relation("IMPLEMENT_LAYOUTS")          // ARTE (R2)
+  projectFiles       File[]            @relation("IMPLEMENT_PROJECT_FILES")    // PROJETO DO IMPLEMENTO (R6)

   chassisNumberNormalized String?
   plateNormalized         String?
+  serialNumberNormalized  String?   // coluna GERADA (M1s) + GIN trigram; só para filtro, `omit` global

   @@index([spot])
   @@index([plate])
   @@index([vinPlateId])
   @@index([backSideMeasureId])
   @@index([leftSideMeasureId])
   @@index([rightSideMeasureId])
+  @@index([frontSideMeasureId])
 }

 model ImplementMeasure {
   …
-  trucksBackSide   Truck[]                   @relation("TRUCK_BACK_SIDE")
-  trucksLeftSide   Truck[]                   @relation("TRUCK_LEFT_SIDE")
-  trucksRightSide  Truck[]                   @relation("TRUCK_RIGHT_SIDE")
+  implementsBackSide  Implement[]           @relation("IMPLEMENT_BACK_SIDE")
+  implementsLeftSide  Implement[]           @relation("IMPLEMENT_LEFT_SIDE")
+  implementsRightSide Implement[]           @relation("IMPLEMENT_RIGHT_SIDE")
+  implementsFrontSide Implement[]           @relation("IMPLEMENT_FRONT_SIDE")
   paintingAnalyses PaintingAnalysis[]        @relation("PAINTING_ANALYSIS_IMPLEMENT_MEASURE")
 }

 model Layout {
   id            String       @id @default(uuid())
-  fileId        String       @unique
-  status        LayoutStatus @default(APPROVED)
+  fileId        String
+  status        LayoutStatus @default(DRAFT)        // o APPROVED padrão mentia
+  /// Dono: exatamente UM de implementId / airbrushingId (CHECK em SQL).
+  implementId   String?
   airbrushingId String?
+  version                Int                   @default(1)
+  supersedesId           String?               @unique
+  sentAt                 DateTime?             // entrou em PENDING_APPROVAL
+  decidedAt              DateTime?
+  approvalSource         LayoutApprovalSource?
+  decidedByResponsibleId String?               // contato do cliente (tabela "Representative")
+  decidedByUserId        String?               // funcionário (ON_BEHALF ou reprovação interna)
+  decisionNote           String?               @db.Text   // obrigatória em REPROVED e ON_BEHALF (regra de serviço)
+  fileSha256             String?               // hash dos bytes NO ATO da decisão
+  createdById            String?
   createdAt     DateTime     @default(now())
   updatedAt     DateTime     @updatedAt
+  implement     Implement?   @relation("IMPLEMENT_LAYOUTS", fields: [implementId], references: [id], onDelete: Cascade)
   airbrushing   Airbrushing? @relation(fields: [airbrushingId], references: [id], onDelete: Cascade)
   file          File         @relation(fields: [fileId], references: [id], onDelete: Cascade)
-  tasks         Task[]       @relation("TaskLayouts")
+  supersedes    Layout?      @relation("LAYOUT_SUPERSEDES", fields: [supersedesId], references: [id], onDelete: SetNull)
+  supersededBy  Layout?      @relation("LAYOUT_SUPERSEDES")
+  decidedByResponsible Responsible? @relation("LAYOUT_DECIDED_BY_RESPONSIBLE", fields: [decidedByResponsibleId], references: [id], onDelete: SetNull)
+  decidedByUser        User?        @relation("LAYOUT_DECIDED_BY_USER",        fields: [decidedByUserId],        references: [id], onDelete: SetNull)
+  decisions     LayoutDecision[]

+  @@unique([implementId, fileId])
+  @@unique([airbrushingId, fileId])
   @@index([fileId])
   @@index([airbrushingId])
   @@index([status])
+  @@index([implementId, status])
 }

+/// Trilha append-only de cada gesto sobre a arte (enviar, aprovar, reprovar, substituir).
+/// Layout guarda só a ÚLTIMA palavra; o portal precisa responder "quem, quando, por quê".
+model LayoutDecision {
+  id               String               @id @default(uuid())
+  layoutId         String
+  toStatus         LayoutStatus
+  source           LayoutApprovalSource
+  responsibleId    String?
+  userId           String?
+  note             String?              @db.Text
+  fileSha256       String?
+  createdAt        DateTime             @default(now())
+  layout           Layout               @relation(fields: [layoutId], references: [id], onDelete: Cascade)
+  responsible      Responsible?         @relation("LAYOUT_DECISION_RESPONSIBLE", fields: [responsibleId], references: [id], onDelete: SetNull)
+  user             User?                @relation("LAYOUT_DECISION_USER",        fields: [userId],        references: [id], onDelete: SetNull)
+  @@index([layoutId, createdAt])
+}

 model File {
   …
-  quoteLayoutId                          String?        // (a COLUNA fica no banco até M4 — ver §4)
-  layouts                                Layout?
-  quoteLayout                            Budget?        @relation("QUOTE_LAYOUT", …)
-  truckVinPlates                         Truck[]        @relation("TRUCK_VIN_PLATE")
+  artLayouts                             Layout[]                 // era `layouts Layout?` (to-one) — renomeado de propósito
+  implementVinPlates                     Implement[]    @relation("IMPLEMENT_VIN_PLATE")
+  implementProjectFiles                  Implement[]    @relation("IMPLEMENT_PROJECT_FILES")
+  budgetOfflineSignatures                BudgetOfflineSignature[] @relation("BUDGET_OFFLINE_SIGNATURE_FILE")
   taskProjectFiles                       Task[]         @relation("TASK_PROJECT_FILES")
-  @@index([quoteLayoutId])
 }

 model Budget {
-  status       BudgetStatus      @default(PENDING)
-  statusOrder  Int               @default(1)
+  status       BudgetStatus      @default(PENDING)   // EIXO DO VALOR (§2A): APPROVED = valor aprovado
+  statusOrder  Int               @default(3)         // = BUDGET_STATUS_ORDER[PENDING]; alinha schema e banco (X8)
+  /// EIXO DA ASSINATURA (§2A.4). Escrito só pelo SignatureEnvelopeService na transação
+  /// do envelope; WAIVED só pela migração e pela conciliação (DD7); SIGNED_OFFLINE só pelo ato
+  /// "Assinado fora do sistema" (DD11). SIGNED/SIGNED_OFFLINE/WAIVED liberam a cobrança. Guarda G29.
+  signatureStatus BudgetSignatureStatus @default(NOT_ISSUED)
+  valueApprovals  BudgetValueApproval[]
+  offlineSignatures BudgetOfflineSignature[]
-  layoutFiles  File[]            @relation("QUOTE_LAYOUT")
+  @@index([signatureStatus])
 }

+/// Aprovação do VALOR (D-27). REGISTRO append-only: a vigente é a última com revokedAt nulo;
+/// é fechada quando o orçamento sai de APPROVED (sem hash: DD8). Ator discriminado:
+/// responsibleId OU userId, nunca os dois.
+model BudgetValueApproval {
+  id            String                    @id @default(uuid())
+  budgetId      String
+  source        BudgetValueApprovalSource
+  responsibleId String?                   // tabela física "Representative"
+  userId        String?
+  note          String?                   @db.Text   // obrigatória em ON_BEHALF (CHECK)
+  total         Decimal?                  @db.Decimal(12, 2)  // o total que foi aprovado (leitura)
+  decidedAt     DateTime                  @default(now())
+  revokedAt     DateTime?
+  revokedReason String?                   @db.Text
+  budget        Budget                    @relation(fields: [budgetId], references: [id], onDelete: Cascade)
+  responsible   Responsible?              @relation("BUDGET_VALUE_APPROVAL_RESPONSIBLE", fields: [responsibleId], references: [id], onDelete: SetNull)
+  user          User?                     @relation("BUDGET_VALUE_APPROVAL_USER",        fields: [userId],        references: [id], onDelete: SetNull)
+  @@index([budgetId, decidedAt])
+}

+/// "Assinado fora do sistema" (DD11, Revisão 3.1). REGISTRO append-only: o vigente é o último com
+/// revokedAt nulo; fechado quando o orçamento sai de APPROVED. O anexo é a prova (Restrict: não se
+/// apaga o arquivo nem o orçamento por baixo dele).
+model BudgetOfflineSignature {
+  id            String    @id @default(uuid())
+  budgetId      String
+  fileId        String                          // foto ou PDF do documento assinado (obrigatório)
+  note          String    @db.Text              // obrigatória (CHECK: não vazia)
+  signedAt      DateTime?                       // quando o cliente assinou, se informado
+  createdById   String
+  createdAt     DateTime  @default(now())
+  revokedAt     DateTime?
+  revokedReason String?   @db.Text
+  budget        Budget    @relation(fields: [budgetId], references: [id], onDelete: Restrict)
+  file          File      @relation("BUDGET_OFFLINE_SIGNATURE_FILE", fields: [fileId], references: [id], onDelete: Restrict)
+  createdBy     User      @relation("BUDGET_OFFLINE_SIGNATURE_USER", fields: [createdById], references: [id], onDelete: Restrict)
+  @@index([budgetId, createdAt])
+}

 model Responsible {   // @@map("Representative")
+  layoutsDecided   Layout[]         @relation("LAYOUT_DECIDED_BY_RESPONSIBLE")
+  layoutDecisions  LayoutDecision[] @relation("LAYOUT_DECISION_RESPONSIBLE")
+  valueApprovals   BudgetValueApproval[] @relation("BUDGET_VALUE_APPROVAL_RESPONSIBLE")
 }
 model User {
+  layoutsDecided   Layout[]         @relation("LAYOUT_DECIDED_BY_USER")
+  layoutDecisions  LayoutDecision[] @relation("LAYOUT_DECISION_USER")
+  valueApprovals   BudgetValueApproval[] @relation("BUDGET_VALUE_APPROVAL_USER")
+  offlineSignatures BudgetOfflineSignature[] @relation("BUDGET_OFFLINE_SIGNATURE_USER")
 }

 enum LayoutStatus {
   DRAFT
   APPROVED
   REPROVED
+  PENDING_APPROVAL   // enviada ao cliente (ADD VALUE — migração própria, M0)
+  SUPERSEDED         // uma versão nova aprovada tomou o lugar
 }
+enum LayoutApprovalSource { PORTAL  ON_BEHALF  MIGRATED_TASK  MIGRATED_BUDGET  MIGRATED_ENVELOPE }
 enum BudgetStatus {          // recriado em M3o, na ordem de atenção
   REQUESTED
   EXPIRED
-  PRE_APPROVED               // nunca foi a produção (D-26)
-  SIGNED
-  IN_NEGOTIATION
   PENDING
+  IN_NEGOTIATION
   APPROVED                   // = VALOR aprovado (DD2)
+  SIGNED                     // LEGADO: nunca mais escrito; o app 1.4.1 filtra por ele
   CANCELLED
 }
+enum BudgetSignatureStatus { NOT_ISSUED  AWAITING_CUSTOMER  AWAITING_ANKAA  SIGNED  SIGNED_OFFLINE  REFUSED  EXPIRED  INVALIDATED  WAIVED }
+enum BudgetValueApprovalSource { PORTAL  ON_BEHALF  SIGNATURE  LEGACY_APP  MIGRATED }
+enum RearDoorLeaves { BIPARTITE  TRIPARTITE }
-enum TruckCategory { … }
+enum ImplementCategory { MINI VUC THREE_QUARTER RIGID TRUCK SEMI_TRAILER SEMI_TRAILER_2_AXLES B_DOUBLE_FRONT B_DOUBLE_REAR BITRUCK }
 // SEM MUDANÇA: enum ImplementType, enum TRUCK_SPOT, enum TruckManufacturer (montadora da tinta — fora do rename),
 // ChangeLogEntityType.TRUCK/IMPLEMENT_MEASURE, ChangeLogTriggeredByType.TRUCK, PaintingFaceView (já tem FRONT).
```

Notas:
- As relações implícitas M2M seguem a ordem alfabética do Prisma: em `_IMPLEMENT_PROJECT_FILES`, `A=File` e `B=Implement`; em `_TASK_PROJECT_FILES`, `A=File` e `B=Task`. O SQL do §4 foi escrito assim.
- Nomes de relação 1:N (`"TRUCK_BACK_SIDE"` etc.) **não existem no banco** e podem ser renomeados à vontade. As FKs reais de medida já são `ON DELETE SET NULL` no catálogo, e a declaração nova só alinha o Prisma com o banco.
- `Layout` ganha dois `@@unique` com colunas anuláveis. O Postgres trata nulos como distintos, então linhas de aerografia (com `implementId` nulo) não colidem com a unicidade do implemento, e vice-versa.
- O `spot` **perde o `@default(YARD_WAIT)`** (S-8 do `10`, D-03): com a criação universal de implemento (DD1), o default poria todo veículo não chegado "no pátio". Todo INSERT (migração e código) passa `spot` explícito; a M1s cria os 1.678 com `spot = NULL`.
- `Task.serialNumber` perde o `@unique` e vira espelho (D-02); `Implement.serialNumber` ganha o `@unique`. O `omit` global do `PrismaClient` (`src/modules/common/prisma/prisma.service.ts:268-272,313-316`) passa a omitir `implement.serialNumberNormalized` (a chave do `omit` segue o nome do model: `truck` → `implement`, no mesmo commit do rename, senão o construtor do cliente quebra).
- `BudgetStatus` é **recriado** em M3o (ordem de atenção nova, sem `PRE_APPROVED`, `SIGNED` no fim como legado); a coluna gerada `Budget.queueRank` cai e volta na mesma migração (§3.3).
- O "ao menos um implemento" **não aparece no Prisma** (o tipo de `Task.implement` segue opcional). A garantia é do banco (gatilho diferido) e do repositório (sempre cria), e o G20 prova.

### 3.2 Enums: valores e rótulos

| Enum | Valores | Rótulo de tela | Observação |
|---|---|---|---|
| `LayoutStatus` | DRAFT, APPROVED, REPROVED, **PENDING_APPROVAL**, **SUPERSEDED** | Rascunho, Aprovada, Reprovada, **Aguardando aprovação do cliente**, **Substituída** | `ALTER TYPE ADD VALUE` numa migração própria (M0), commitada antes de qualquer uso |
| `LayoutApprovalSource` | PORTAL, ON_BEHALF, MIGRATED_TASK, MIGRATED_BUDGET, **MIGRATED_ENVELOPE** | Pelo cliente (portal), Em nome do cliente, Migrado da tarefa, Migrado do orçamento, Migrado de coleta em andamento | criado em M0 já com os 5 valores (M0 ainda não foi a produção) |
| `RearDoorLeaves` | BIPARTITE, TRIPARTITE | Bipartida, Tripartida | Na borda do portal o zod aceita `BIPARTIDA`/`TRIPARTIDA` e traduz (ou o web manda o valor do banco, D a fechar no pacote do portal) |
| `ImplementCategory` | os 10 de `TruckCategory` | inalterados | `ALTER TYPE "TruckCategory" RENAME TO "ImplementCategory"` |
| `ImplementType` | inalterado | inalterado (D-18: perfis por documento) | a coluna muda de `implementType` para `type` |
| `BudgetStatus` | REQUESTED, EXPIRED, PENDING, IN_NEGOTIATION, APPROVED, SIGNED (legado), CANCELLED; **sai PRE_APPROVED** | Requisição, Aguardando Reanálise, **Pendente**, **Aguardando aprovação do cliente**, **Aprovado**, Assinado (legado), Cancelado | recriado em M3o (DROP/CREATE, mesmo caminho de `20260920120000…/migration.sql:79-124`); os espelhos TS (`src/constants/enums.ts:2802-2857`), a lista zod à mão (`src/schemas/budget.ts:32-45`), os rótulos (`enum-labels.ts:2110-2123`) e a ordem (`sortOrders.ts:189-201`) mudam no mesmo commit |
| `BudgetSignatureStatus` (novo) | NOT_ISSUED, AWAITING_CUSTOMER, AWAITING_ANKAA, SIGNED, SIGNED_OFFLINE, REFUSED, EXPIRED, INVALIDATED, WAIVED | Não emitida, Aguardando assinaturas, Falta a Ankaa, Assinada, Assinada fora do sistema (DD11), Recusada, Vencida, Invalidada, Dispensada (legado) | `CREATE TYPE` em M3o-a (tipo criado e usado na mesma transação: permitido, só `ADD VALUE` tem a restrição) |
| `BudgetValueApprovalSource` (novo) | PORTAL, ON_BEHALF, SIGNATURE, LEGACY_APP, MIGRATED | Pelo cliente (portal), Em nome do cliente, Pela assinatura, App antigo (sem nota), Migrado | idem |

### 3.3 CHECKs, índices e objetos de banco

| Objeto | SQL | Por quê |
|---|---|---|
| `Implement_rearDoorBarCount_check` | `CHECK ("rearDoorBarCount" IS NULL OR "rearDoorBarCount" IN (2,3,4))` | R5 |
| `Implement_rearDoorHatchCount_check` | `CHECK ("rearDoorHatchCount" IS NULL OR "rearDoorHatchCount" BETWEEN 0 AND 6)` | DD4: portinholas de 0 a 6, só quantidade |
| `Layout_one_owner_check` | `CHECK (("implementId" IS NOT NULL) <> ("airbrushingId" IS NOT NULL))` | arte tem exatamente um dono |
| `Layout_decision_note_check` | `CHECK ("status" <> 'REPROVED' OR "approvalSource" IS DISTINCT FROM 'PORTAL' OR "decisionNote" IS NOT NULL)`: motivo obrigatório na reprovação pelo portal | a regra de serviço também exige nota em ON_BEHALF (mas as linhas migradas não têm nota, por isso não vira CHECK geral) |
| `Layout_implementId_fileId_key`, `Layout_airbrushingId_fileId_key` (UNIQUE) | via `@@unique` | substituem `Layout_fileId_key` |
| `Layout_implementId_status_idx` | via `@@index` | portal "arte pendente" e portão de produção |
| `Implement_frontSideMeasureId_idx` + FK `SET NULL` | M2 | R5 |
| `_IMPLEMENT_PROJECT_FILES` (PK `(A,B)`, índice em `B`, FKs CASCADE) | M3 | R6 |
| função `file_blocking_references(text)` | **reescrita em M4**, sem o bloco `quoteLayoutId` | `20260804180000_file_referenced_delete_guard/migration.sql:43-48` |
| gatilho `file_no_delete_when_referenced` | **sem mudança**. As FKs novas (`Implement.*`, `Layout.implementId`, `_IMPLEMENT_PROJECT_FILES.A`) entram sozinhas pela parte dinâmica | idem `:31-81,116-119` |
| colunas geradas `plateNormalized`/`chassisNumberNormalized` | acompanham o `RENAME TABLE` sem ação | `20260624150000_accent_insensitive_search/migration.sql:296-298` |
| `_DroppedTruckVinPlateText` | pode ser apagada em M4, se tiver 0 linhas em produção | `20260727150000…/migration.sql:18-27` |
| `Implement_serialNumber_key` (UNIQUE) | M1s; `Task_serialNumber_key` **cai** na mesma migração | DD1, S-3 (uma unicidade só) |
| `Implement.serialNumberNormalized` + `Implement_serialNumberNormalized_trgm_idx` (GIN `gin_trgm_ops`) | M1s: `GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED` | mesma forma de `20260624150000_accent_insensitive_search/migration.sql:254,365` |
| `Task.serialNumberNormalized` + `Task_serialNumberNormalized_trgm_idx` | **ficam** até M5s (o espelho alimenta a busca dos leitores ainda não migrados) | estratégia E |
| gatilho `Implement_serial_mirror` (AFTER INSERT OR UPDATE OF `serialNumber`,`taskId` ON `Implement`) | M1s; copia para `Task.serialNumber` sem tocar `Task.updatedAt` | espelho da janela; sai em M5s |
| gatilho `Task_serial_is_mirror` (BEFORE INSERT OR UPDATE OF `serialNumber` ON `Task`) | M1s; `pg_trigger_depth() = 1` e valor diferente → `RAISE … ERRCODE 23514` | escritor esquecido vira erro barulhento; sai em M5s |
| `CONSTRAINT TRIGGER "Task_has_implement"` (AFTER INSERT ON `Task`) e `"Implement_keeps_task_covered"` (AFTER DELETE OR UPDATE OF `taskId` ON `Implement`), ambos `DEFERRABLE INITIALLY DEFERRED` | M1s; checados no COMMIT | DD1 "ao menos um"; **ficam para sempre** |
| `Implement.spot` sem default | M1s: `ALTER COLUMN "spot" DROP DEFAULT` | S-8 |
| `BudgetValueApproval_note_check` | `CHECK ("source" <> 'ON_BEHALF' OR "note" IS NOT NULL)` | nota obrigatória na aprovação em nome do cliente |
| `BudgetValueApproval_actor_check` | `CHECK (NOT ("responsibleId" IS NOT NULL AND "userId" IS NOT NULL))` | ator discriminado (nunca id de contato em FK de `User`) |
| `Budget_signatureStatus_idx` | M3o | filtro e ordenação da coluna "Assinatura" e do "Prontos para emitir" |
| `Budget.queueRank` (coluna GERADA) + `Budget_statusOrder_queueRank_idx` | M3o: `DROP INDEX` + `DROP COLUMN` antes de trocar o tipo; recriados com a expressão nova (§2A.3) | a coluna cita valores do enum; `ALTER … USING` não vale para coluna gerada (`20260920190000…/migration.sql:44-46`) |
| `Budget.statusOrder` default | M3o: `SET DEFAULT 3` + backfill por extenso | X8; o valor tem de casar com `BUDGET_STATUS_ORDER` (`src/constants/sortOrders.ts`) exatamente |

---

## 4. Migração de dados

### 4.1 Releases e migrações (datas **depois** da última migração da `main`: `20260924190000` em 24/09; re-carimbar no P30)

| Migração | Release | Conteúdo | Destrutiva? | Pode ir antes do código? |
|---|---|---|---|---|
| **M0** `20260930100000_arte_estados_e_tipos` | **R-A** (antecipada) | `ALTER TYPE "LayoutStatus" ADD VALUE 'PENDING_APPROVAL'`, `ADD VALUE 'SUPERSEDED'`; `CREATE TYPE "LayoutApprovalSource"` (com os 5 valores, inclusive `MIGRATED_ENVELOPE`); `CREATE TYPE "RearDoorLeaves"` | não | **sim**: o código velho ignora valor e tipo novos. Vai antes, para que o ensaio de M1–M3 rode numa transação revertida (valor novo de enum não pode ser usado na mesma transação em que nasce) |
| **M1** `20260930120000_truck_vira_implement` | R-B | RENAME de tabela, constraints, índices, coluna `implementType`→`type`, tipo `TruckCategory`→`ImplementCategory` | quebra o processo velho | não. Build antes; API **parada** durante a migração |
| **M1s** `20260930120050_serie_no_implemento_e_implemento_obrigatorio` | R-B | Implemento para **toda** tarefa sem (produção 23/09: 1.676; clone: 1.678; `spot NULL`, datas da tarefa); `Implement.serialNumber` + cópia + `@unique` + coluna gerada + GIN; `DROP INDEX "Task_serialNumber_key"`; gatilhos do espelho e de somente leitura; `CONSTRAINT TRIGGER` diferidos de "ao menos um implemento"; `spot` sem default | não (aditiva; o espelho mantém `Task.serialNumber`) | **não**: o código velho grava `Task.serialNumber` (o gatilho recusaria) e cria tarefa sem `truck` (o gatilho diferido recusaria no COMMIT, `task-prisma.repository.ts:1061-1074`). Vai com o código novo, API parada |
| **M2** `20260930120100_implemento_frente_e_porta_traseira` | R-B | `frontSideMeasureId` + FK + índice; 3 colunas da porta + CHECKs; desfaz as medidas compartilhadas; **cria `_IMPLEMENT_PROJECT_FILES`** (DDL movido da M3 na Revisão 3.1: o P13a precisa do projeto do implemento antes da M3) | não | depende de M1 (nome da tabela) |
| **M3** `20260930120200_arte_do_implemento_e_projeto_da_tarefa` | R-B | Arquivo morto; colunas novas de `Layout`; `LayoutDecision`; projeto do implemento (só os dados: a tabela nasce na M2); PDFs → projeto da tarefa; fan-out das imagens; **arte do orçamento com preservação de `File.id` (M-A..M-D)**; O.S. em `WAITING_APPROVE`; órfãos; constraints; **DROP `_TaskLayouts`**. O passo 1b vira no-op (M1s já criou todos os implementos), mas fica, idempotente | sim (M2M) | não |
| **M3o-a** `20260930120300_orcamento_eixo_da_assinatura` | R-B | Passos 0–2 do SQL do §4.3: arquivo morto; `BudgetSignatureStatus` (com `SIGNED_OFFLINE`, DD11), `BudgetValueApprovalSource`, `BudgetValueApproval`, **`BudgetOfflineSignature`**, `Budget.signatureStatus`; eixo calculado do envelope vigente; `WAIVED` do legado; triagem `LEGACY_APPROVED_UNSIGNED` | não (aditiva) | sim, na base de desenvolvimento: o código velho ignora coluna e tabela novas (é o "commit zero" do par [P14 ∥ P13b], §9) |
| **M3o-b** `20260930120350_orcamento_valor_aprovado` | R-B | Passos 3 em diante: resíduos do eixo do valor; `BudgetStatus` recriado sem `PRE_APPROVED` (com `queueRank` derrubado e recriado); `BudgetValueApproval{MIGRATED}`; `statusOrder` renumerado e default 3 | sim (tipo recriado) | não: o código velho escreve `PENDING` na emissão e lê `PRE_APPROVED` |
| **M4** `2026XXXX_orcamento_sem_layout_coluna` | **R-D** (depois da janela) | `CREATE OR REPLACE FUNCTION file_blocking_references` sem `quoteLayoutId`; `DROP` da FK, do índice e da coluna `File.quoteLayoutId`; `DROP TABLE "BudgetLayoutTask"` (DD6; `Budget.layoutScope` fica como flag de leitura); `DROP TABLE _DroppedTruckVinPlateText` (se 0 linhas) | sim | só quando nenhum cliente em uso ler `layoutFiles` |
| **M5s** `2026XXXX_serie_sai_da_tarefa` | **R-D** | `DROP` dos gatilhos do espelho e de somente leitura, do GIN e das colunas `Task.serialNumberNormalized` (antes) e `Task.serialNumber`. Os gatilhos de "ao menos um implemento" **ficam** | sim | só com a catraca G24 zerada, o contador de chaves legadas zerado por 14 dias e a M1s há ≥ 1 release em produção |

**Protocolo de promoção da Fase B (Revisão 3.1).** O §9 exige a régua verde ao fim de **cada** pacote, e as migrações da R-B quebram o código velho (o rename quebra o `tsc` inteiro; o gatilho da série recusa os escritores velhos; a M3 tira `Task.layouts` e o to-one `File.layouts`; a M3o-b tira `PRE_APPROVED`). Por isso o **P10 escreve e ensaia todas** as fatias, mas as deixa em `prisma/staged/r-b/<carimbo>_<nome>/migration.sql`, junto com o esquema-alvo inteiro (`prisma/staged/r-b/schema.alvo.prisma`); o Prisma não lê essa pasta. **Cada fatia é promovida** (`git mv` para `prisma/migrations/`, a parte correspondente do esquema-alvo copiada para `schema.prisma`, `prisma migrate deploy` + `prisma generate` no banco da Fase B) **pelo pacote cujo código a torna verdadeira, no mesmo commit** em que o código passa a falar a língua nova: **M1 e M1s → P11a**; **M2 → P11b**; **M3 → P12**; **M3o-a → P14 (commit zero do par)**; **M3o-b → P14 (fim)**. Os carimbos já estão na ordem de promoção, então o banco da Fase B aplica as fatias na mesma ordem que a produção aplicará na R-B. O ensaio (`scripts/rehearse-implement-migration.ts`) aplica, numa transação revertida, **as fatias ainda não aplicadas**, lendo de `prisma/migrations/` ou de `prisma/staged/r-b/`, e vale do P10 até o P30. A guarda **G36** mede a distância entre `schema.prisma` e o esquema-alvo; ela zera na integração do par [P14 ∥ P13b], quando `prisma/staged/r-b/` é apagada. O SQL do §4.2/§4.3 é o **rascunho**: a fonte passa a ser `prisma/staged/r-b/`. Carimbos reservados para migração extra, que só entram na fatia do dono: P06 `20260930100010`–`100090`; P11a `20260930120060`–`120090`; P11b `20260930120110`–`120190`; P12 `20260930120210`–`120290`; P13a `20260930120295`–`120299` (só pela integração do par); P14 `20260930120310`–`120340` e `20260930120360`–`120390`; P13b `20260930120395`–`120399` (só pela integração do par). Todos depois de `20260924190000`, a última da `main` em 24/09 (re-carimbo de 24/09: a `main` ocupou `20260924120000`–`120200`).

⚠️ **Ordem das migrações da branch** (FATO, conferido): a `feat/portal-do-responsavel` tem `20260920120000_portal_do_responsavel_requisicao_e_pedido` e `20260920190000_fila_hibrida_por_estado`, que **não** estão na `main`, e a `main` tem `20260922130000_envelope_lembra_o_que_ja_avaliou`, já aplicada em produção e ausente da branch. Depois do merge do P00, as duas da branch ficam com data **anterior** a uma já aplicada. INF: `prisma migrate deploy` aplica as pendentes, mas o ensaio (§4.6) tem de rodar `prisma migrate status` e `migrate diff` contra o dump de produção para provar a ordem e a ausência de deriva. A M3o **não reescreve** essas duas (migração publicada ou não, o arquivo aplicado no clone e nos bancos de QA não se edita): ela recria o tipo e o `queueRank` por cima.

Por que `File.quoteLayoutId` sobrevive até M4 (FATO + INF): o schema Prisma do código novo **não** declara a coluna, e o Prisma ignora coluna desconhecida. A função do gatilho continua protegendo esses arquivos contra exclusão, o que é inofensivo. Na janela entre `migrate deploy` e o restart, o processo velho ainda lê a coluna: derrubá-la nessa janela dá 500 em toda rota que inclui `layoutFiles` e em toda exclusão de arquivo.

### 4.2 M0, M1 e M1s

```sql
-- M0 — 20260930100000_arte_estados_e_tipos  (release R-A, antecipada; aditiva)
ALTER TYPE "LayoutStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "LayoutStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LayoutApprovalSource') THEN
    -- (auditoria §14: o SQL tinha só 4 valores; sem MIGRATED_ENVELOPE o passo 5 da M3 falha
    --  inteiro com "invalid input value for enum". M0 nunca foi aplicada: corrigir aqui, não com ADD VALUE.)
    CREATE TYPE "LayoutApprovalSource" AS ENUM ('PORTAL','ON_BEHALF','MIGRATED_TASK','MIGRATED_BUDGET','MIGRATED_ENVELOPE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RearDoorLeaves') THEN
    CREATE TYPE "RearDoorLeaves" AS ENUM ('BIPARTITE','TRIPARTITE');
  END IF;
END $$;
-- ⚠️ Em R-A o schema.prisma já precisa declarar os dois valores e os dois enums
--    (senão o próximo `migrate diff` acusa deriva). Nenhum código os usa ainda.
```

```sql
-- M1 — 20260930120000_truck_vira_implement  (catálogo apenas; nenhum byte de dado muda)
-- NÃO renomeados, de propósito (ver D-04): valor 'TRUCK' de ChangeLogEntityType,
-- tipo TRUCK_SPOT, tipo ImplementType, chaves 'truck.*' de TaskFieldChangeLog e de notificação.
DO $$ BEGIN
  IF to_regclass('"Truck"') IS NOT NULL AND to_regclass('"Implement"') IS NULL THEN
    ALTER TABLE "Truck" RENAME TO "Implement";
  END IF;
END $$;
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_pkey"                    TO "Implement_pkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_taskId_fkey"             TO "Implement_taskId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_vinPlateId_fkey"         TO "Implement_vinPlateId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_backSideMeasureId_fkey"  TO "Implement_backSideMeasureId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_leftSideMeasureId_fkey"  TO "Implement_leftSideMeasureId_fkey";
ALTER TABLE "Implement" RENAME CONSTRAINT "Truck_rightSideMeasureId_fkey" TO "Implement_rightSideMeasureId_fkey";
ALTER INDEX "Truck_taskId_key"             RENAME TO "Implement_taskId_key";
ALTER INDEX "Truck_plate_key"              RENAME TO "Implement_plate_key";
ALTER INDEX "Truck_plate_idx"              RENAME TO "Implement_plate_idx";
ALTER INDEX "Truck_spot_idx"               RENAME TO "Implement_spot_idx";
ALTER INDEX "Truck_vinPlateId_idx"         RENAME TO "Implement_vinPlateId_idx";
ALTER INDEX "Truck_backSideMeasureId_idx"  RENAME TO "Implement_backSideMeasureId_idx";
ALTER INDEX "Truck_leftSideMeasureId_idx"  RENAME TO "Implement_leftSideMeasureId_idx";
ALTER INDEX "Truck_rightSideMeasureId_idx" RENAME TO "Implement_rightSideMeasureId_idx";
ALTER TABLE "Implement" RENAME COLUMN "implementType" TO "type";
ALTER TYPE "TruckCategory" RENAME TO "ImplementCategory";
-- ⚠️ Antes de escrever: listar no catálogo de PRODUÇÃO todos os nomes reais
--    (SELECT conname FROM pg_constraint WHERE conrelid='"Truck"'::regclass;
--     SELECT indexname FROM pg_indexes WHERE tablename='Truck';) — o clone pode divergir.
-- Reversão: os mesmos RENAMEs com os lados trocados.
```

```sql
-- M1s — 20260930120050_serie_no_implemento_e_implemento_obrigatorio  (R-B, logo depois de M1)
-- DD1. Fonte: 10-serie-api.md §4.4. Pré-condição: "Implement" existe (M1). Uma transação.

-- 0. ARQUIVO MORTO (reversão e auditoria)
CREATE TABLE IF NOT EXISTS "_Mig0924_SerialImplementCreated" (
  "implementId" text PRIMARY KEY, "taskId" text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskSerial" AS
  SELECT "id" AS "taskId", "serialNumber" FROM "Task" WHERE "serialNumber" IS NOT NULL;

-- 1. UM IMPLEMENTO PARA TODA TAREFA (produção 23/09: 1.676; clone: 1.678; todas COMPLETED, 17/07/2023 → 16/01/2026).
--    spot NULL EXPLÍCITO (o default YARD_WAIT poria O.S. concluídas "no pátio");
--    createdAt/updatedAt DA TAREFA (listas e sincronizações por updatedAt não podem ver 1.678 "novos").
WITH c AS (
  INSERT INTO "Implement" ("id","taskId","spot","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, t."id", NULL, t."createdAt", t."updatedAt"
  FROM "Task" t
  WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId" = t."id")
  RETURNING "id","taskId")
INSERT INTO "_Mig0924_SerialImplementCreated" ("implementId","taskId") SELECT "id","taskId" FROM c;

-- 2. A SÉRIE NO IMPLEMENTO — cópia BYTE A BYTE (sem trim/upper: S-7; o hash inteiro do
--    snapshot compara o valor lido, e 0 dos 25 veículos congelados do clone diverge hoje).
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "serialNumber" TEXT;
UPDATE "Implement" i SET "serialNumber" = t."serialNumber"
  FROM "Task" t WHERE t."id" = i."taskId" AND i."serialNumber" IS DISTINCT FROM t."serialNumber";
CREATE UNIQUE INDEX IF NOT EXISTS "Implement_serialNumber_key" ON "Implement"("serialNumber");   -- clone: 0 duplicatas
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "serialNumberNormalized" text
  GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED;
CREATE INDEX IF NOT EXISTS "Implement_serialNumberNormalized_trgm_idx"
  ON "Implement" USING gin ("serialNumberNormalized" gin_trgm_ops);

-- 3. UMA UNICIDADE SÓ (S-3). A coluna gerada e o GIN da Task FICAM até M5s (espelho).
DROP INDEX IF EXISTS "Task_serialNumber_key";

-- 4. ESPELHO Implement → Task (sem tocar Task.updatedAt)
CREATE OR REPLACE FUNCTION implement_serial_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Task" SET "serialNumber" = NEW."serialNumber"
   WHERE "id" = NEW."taskId" AND "serialNumber" IS DISTINCT FROM NEW."serialNumber";
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "Implement_serial_mirror" ON "Implement";
CREATE TRIGGER "Implement_serial_mirror" AFTER INSERT OR UPDATE OF "serialNumber","taskId"
  ON "Implement" FOR EACH ROW EXECUTE FUNCTION implement_serial_mirror();

-- 5. Task.serialNumber SÓ muda pelo espelho (profundidade 2). Escrita direta = erro barulhento.
CREATE OR REPLACE FUNCTION task_serial_is_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NEW."serialNumber" IS DISTINCT FROM
     (CASE WHEN TG_OP = 'UPDATE' THEN OLD."serialNumber" ELSE NULL END) THEN
    RAISE EXCEPTION 'Task.serialNumber é espelho de Implement.serialNumber: grave no implemento'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "Task_serial_is_mirror" ON "Task";
CREATE TRIGGER "Task_serial_is_mirror" BEFORE INSERT OR UPDATE OF "serialNumber"
  ON "Task" FOR EACH ROW EXECUTE FUNCTION task_serial_is_mirror();
-- ⚠️ Consequência: a criação da tarefa grava a série no IMPLEMENTO aninhado (W1); o INSERT da
--    Task vem com serialNumber NULL e o espelho a preenche. `tx.task.create({ data: { serialNumber } })`
--    passa a falhar — é o que G19 caça.

-- 6. TODA TAREFA TEM IMPLEMENTO — verificado no COMMIT (o create aninhado do Prisma roda na
--    mesma transação, então o diferido funciona; INF documentada no 10 §5.3)
CREATE OR REPLACE FUNCTION task_must_have_implement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text;
BEGIN
  tid := CASE WHEN TG_TABLE_NAME = 'Task' THEN NEW."id" ELSE OLD."taskId" END;
  IF EXISTS (SELECT 1 FROM "Task" WHERE "id" = tid)
     AND NOT EXISTS (SELECT 1 FROM "Implement" WHERE "taskId" = tid) THEN
    RAISE EXCEPTION 'Tarefa % sem implemento: toda tarefa tem exatamente um implemento', tid
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "Task_has_implement" ON "Task";
CREATE CONSTRAINT TRIGGER "Task_has_implement" AFTER INSERT ON "Task"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();
DROP TRIGGER IF EXISTS "Implement_keeps_task_covered" ON "Implement";
CREATE CONSTRAINT TRIGGER "Implement_keeps_task_covered" AFTER DELETE OR UPDATE OF "taskId" ON "Implement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();
-- DELETE da Task leva o implemento em cascata (onDelete: Cascade) e o gatilho aceita: a tarefa não existe mais.

-- 7. S-8: sem o default que põe veículo não chegado "no pátio"
ALTER TABLE "Implement" ALTER COLUMN "spot" DROP DEFAULT;

-- Reversão (dentro da janela; nada se perde, a Task teve a série o tempo todo pelo espelho):
--   DROP dos 4 gatilhos e 3 funções; CREATE UNIQUE INDEX "Task_serialNumber_key" ON "Task"("serialNumber");
--   DROP INDEX "Implement_serialNumberNormalized_trgm_idx"; DROP COLUMN "serialNumberNormalized", "serialNumber" do implemento;
--   ALTER COLUMN "spot" SET DEFAULT 'YARD_WAIT';
--   DELETE dos implementos de "_Mig0924_SerialImplementCreated" SÓ se ainda sem placa, chassi, medida, arte,
--   e projeto (senão ficam: o código velho aceita tarefa com caminhão).
```

### 4.3 M2, M3, M3o, M4 e M5s

```sql
-- M2 — 20260930120100_implemento_frente_e_porta_traseira
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "frontSideMeasureId" TEXT;
CREATE INDEX IF NOT EXISTS "Implement_frontSideMeasureId_idx" ON "Implement"("frontSideMeasureId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Implement_frontSideMeasureId_fkey') THEN
    ALTER TABLE "Implement" ADD CONSTRAINT "Implement_frontSideMeasureId_fkey"
      FOREIGN KEY ("frontSideMeasureId") REFERENCES "ImplementMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "Implement"
  ADD COLUMN IF NOT EXISTS "rearDoorLeaves"     "RearDoorLeaves",
  ADD COLUMN IF NOT EXISTS "rearDoorBarCount"   SMALLINT,
  ADD COLUMN IF NOT EXISTS "rearDoorHatchCount" SMALLINT;
ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorBarCount_check"
  CHECK ("rearDoorBarCount" IS NULL OR "rearDoorBarCount" IN (2,3,4));
ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorHatchCount_check"
  CHECK ("rearDoorHatchCount" IS NULL OR "rearDoorHatchCount" BETWEEN 0 AND 6);

-- D-07: desfaz medidas COMPARTILHADAS (o 1º implemento por createdAt da tarefa fica com a linha;
-- os demais ganham cópia com as mesmas seções e a mesma foto). Clone: 11 linhas × 41 implementos → 30 cópias.
CREATE TABLE IF NOT EXISTS "_Mig0924_MeasureUnshare" ("implementId" text, face text, "oldMid" text, "newMid" text);
CREATE TEMP TABLE _refs ON COMMIT DROP AS
SELECT i."id" AS "implementId", t."createdAt" AS tc, f.face, f.mid
FROM "Implement" i JOIN "Task" t ON t."id" = i."taskId"
CROSS JOIN LATERAL (VALUES ('back', i."backSideMeasureId"), ('left', i."leftSideMeasureId"),
                           ('right', i."rightSideMeasureId")) AS f(face, mid)
WHERE f.mid IS NOT NULL;
CREATE TEMP TABLE _share ON COMMIT DROP AS
SELECT r.*, gen_random_uuid()::text AS "newMid",
       row_number() OVER (PARTITION BY r.mid ORDER BY r.tc, r."implementId") AS rn
FROM _refs r WHERE r.mid IN (SELECT mid FROM _refs GROUP BY mid HAVING count(*) > 1);
INSERT INTO "ImplementMeasure" ("id","height","photoId","createdAt","updatedAt")
SELECT s."newMid", m."height", m."photoId", m."createdAt", now() FROM _share s JOIN "ImplementMeasure" m ON m."id" = s.mid WHERE s.rn > 1;
INSERT INTO "ImplementMeasureSection" ("id","implementMeasureId","width","isDoor","doorHeight","position","createdAt","updatedAt")
SELECT gen_random_uuid()::text, s."newMid", x."width", x."isDoor", x."doorHeight", x."position", x."createdAt", now()
FROM _share s JOIN "ImplementMeasureSection" x ON x."implementMeasureId" = s.mid WHERE s.rn > 1;
UPDATE "Implement" i SET "backSideMeasureId"  = s."newMid" FROM _share s WHERE s.rn>1 AND s.face='back'  AND s."implementId"=i."id";
UPDATE "Implement" i SET "leftSideMeasureId"  = s."newMid" FROM _share s WHERE s.rn>1 AND s.face='left'  AND s."implementId"=i."id";
UPDATE "Implement" i SET "rightSideMeasureId" = s."newMid" FROM _share s WHERE s.rn>1 AND s.face='right' AND s."implementId"=i."id";
INSERT INTO "_Mig0924_MeasureUnshare" SELECT "implementId", face, mid, "newMid" FROM _share WHERE rn > 1;
-- Reversão: DROP das colunas/CHECK; para as cópias, restaurar a FK a partir de _Mig0924_MeasureUnshare e apagar as cópias.
```

```sql
-- M3 — 20260930120200_arte_do_implemento_e_projeto_da_tarefa
-- Ordem obrigatória: arquivo morto → estrutura aditiva → projeto do implemento (ANTES de encher
-- _TASK_PROJECT_FILES) → PDFs → fan-out das imagens → orçamento → O.S. aguardando → órfãos →
-- constraints → drop do M2M.  REGRA: nenhum DELETE FROM "File"; nenhum byte movido.

-- 0. ARQUIVO MORTO (reversão e auditoria; fica até uma limpeza explícita)
CREATE TABLE IF NOT EXISTS "_Mig0924_Layout"           AS SELECT * FROM "Layout";
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskLayouts"      AS SELECT * FROM "_TaskLayouts";
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskProjectFiles" AS SELECT * FROM "_TASK_PROJECT_FILES";
CREATE TABLE IF NOT EXISTS "_Mig0924_QuoteLayout"      AS
  SELECT "id" AS "fileId", "quoteLayoutId" FROM "File" WHERE "quoteLayoutId" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "_Mig0924_LayoutOrigin" ("layoutId" text PRIMARY KEY, "sourceLayoutId" text,
  "sourceQuoteFileId" text, "taskId" text NOT NULL, origin text NOT NULL);
CREATE TABLE IF NOT EXISTS "_Mig0924_ImplementCreated" ("implementId" text PRIMARY KEY, "taskId" text NOT NULL);
CREATE TABLE IF NOT EXISTS "_Mig0924_Triage" (kind text, "fileId" text, "taskId" text, note text);

-- 1. ESTRUTURA ADITIVA
ALTER TABLE "Layout"
  ADD COLUMN "implementId" text, ADD COLUMN "version" integer NOT NULL DEFAULT 1,
  ADD COLUMN "supersedesId" text, ADD COLUMN "sentAt" timestamp(3), ADD COLUMN "decidedAt" timestamp(3),
  ADD COLUMN "approvalSource" "LayoutApprovalSource", ADD COLUMN "decidedByResponsibleId" text,
  ADD COLUMN "decidedByUserId" text, ADD COLUMN "decisionNote" text, ADD COLUMN "fileSha256" text,
  ADD COLUMN "createdById" text;
-- O Prisma cria @unique como ÍNDICE único (não constraint): os dois comandos cobrem as duas formas.
ALTER TABLE "Layout" DROP CONSTRAINT IF EXISTS "Layout_fileId_key";
DROP INDEX IF EXISTS "Layout_fileId_key";                           -- o índice "Layout_fileId_idx" continua
CREATE TABLE "_IMPLEMENT_PROJECT_FILES" (
  "A" text NOT NULL REFERENCES "File"("id")      ON DELETE CASCADE ON UPDATE CASCADE,
  "B" text NOT NULL REFERENCES "Implement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_IMPLEMENT_PROJECT_FILES_AB_pkey" PRIMARY KEY ("A","B"));
CREATE INDEX "_IMPLEMENT_PROJECT_FILES_B_index" ON "_IMPLEMENT_PROJECT_FILES"("B");
CREATE TABLE "LayoutDecision" (
  "id" text PRIMARY KEY, "layoutId" text NOT NULL REFERENCES "Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "toStatus" "LayoutStatus" NOT NULL, "source" "LayoutApprovalSource" NOT NULL,
  "responsibleId" text REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE,   -- ⚠️ tabela física do model Responsible
  "userId" text REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "note" text, "fileSha256" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "LayoutDecision_layoutId_createdAt_idx" ON "LayoutDecision"("layoutId","createdAt");

-- 1b. IMPLEMENTOS FALTANTES (spot NULL) — Revisão 2: a M1s já criou o implemento de TODA tarefa
--     (DD1), então este passo é NO-OP (0 linhas). Fica, idempotente, como rede: se a M3 algum dia
--     rodar sem a M1s (ensaio parcial), a arte não vira "órfã" no passo 7.
--     Texto original (auditoria §13):
--     Os passos 2, 4 e 5 fazem JOIN INTERNO com "Implement": sem esta etapa, uma arte ligada
--     só a tarefas sem implemento fica com implementId NULL e o passo 7 a APAGA como "órfã",
--     e o invariante do §4.6 (que também faz JOIN interno) não percebe. Hoje há ~575
--     implementos para ~2.208 tarefas: tarefa sem implemento é a REGRA, não a exceção.
--     No clone: 4 tarefas COMPLETED (passo 2), 0 no passo 4 — medir em produção.
WITH need AS (
  SELECT DISTINCT x."taskId" FROM (
    SELECT p."B" AS "taskId" FROM "_Mig0924_TaskProjectFiles" p
    UNION
    SELECT tl."B" FROM "_TaskLayouts" tl JOIN "Layout" l ON l."id"=tl."A" JOIN "File" f ON f."id"=l."fileId"
     WHERE f."mimetype" <> 'application/pdf'
    UNION
    SELECT t."id" FROM "File" qf JOIN "Budget" b ON b."id"=qf."quoteLayoutId" JOIN "Task" t ON t."quoteId"=b."id"
     WHERE qf."mimetype" <> 'application/pdf' AND b."status" NOT IN ('EXPIRED','CANCELLED')
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId" = x."taskId")
), c AS (
  INSERT INTO "Implement" ("id","taskId","spot","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, "taskId", NULL, now(), now() FROM need
  RETURNING "id","taskId")
INSERT INTO "_Mig0924_ImplementCreated" ("implementId","taskId") SELECT "id","taskId" FROM c;

-- 2. OS 4 projectFiles ATUAIS SÃO DA FURGÕES → implemento da mesma tarefa (D-11)
INSERT INTO "_IMPLEMENT_PROJECT_FILES" ("A","B")
SELECT p."A", i."id" FROM "_Mig0924_TaskProjectFiles" p JOIN "Implement" i ON i."taskId" = p."B"
ON CONFLICT DO NOTHING;
--    Só remove da tarefa o vínculo que DE FATO foi copiado (antes: apagava os 4 mesmo sem implemento).
DELETE FROM "_TASK_PROJECT_FILES" p
USING "_Mig0924_TaskProjectFiles" o, "Implement" i, "_IMPLEMENT_PROJECT_FILES" ip
WHERE o."A"=p."A" AND o."B"=p."B" AND i."taskId"=o."B" AND ip."A"=o."A" AND ip."B"=i."id";
--    D-11 (DECIDIDO, DD5): cópia do VÍNCULO dos PDFs da Furgões em baseFiles, só tarefas não
--    concluídas, por regra de nome, com trilha (o arquivo continua em baseFiles).
WITH c AS (
  INSERT INTO "_IMPLEMENT_PROJECT_FILES" ("A","B")
  SELECT bf."A", i."id" FROM "_TASK_BASE_FILES" bf JOIN "File" f ON f."id"=bf."A"
    JOIN "Task" t ON t."id"=bf."B" JOIN "Implement" i ON i."taskId"=t."id"
   WHERE f."mimetype"='application/pdf' AND t."status" NOT IN ('COMPLETED','CANCELLED')
     AND (f."originalName" ~* '^PROJETO\s' OR f."originalName" ~ '^\d{5}.*LAYOUT')
  ON CONFLICT DO NOTHING
  RETURNING "A","B")
INSERT INTO "_Mig0924_Triage" SELECT 'BASE_TO_IMPLEMENT_PROJECT', c."A", i."taskId", NULL
FROM c JOIN "Implement" i ON i."id"=c."B";

-- 3. PDF DO LAYOUT → PROJETO DA TAREFA (um vínculo por tarefa que o tinha) (D-12)
INSERT INTO "_TASK_PROJECT_FILES" ("A","B")
SELECT l."fileId", tl."B" FROM "_TaskLayouts" tl
JOIN "Layout" l ON l."id"=tl."A" JOIN "File" f ON f."id"=l."fileId"
WHERE f."mimetype"='application/pdf' ON CONFLICT DO NOTHING;
INSERT INTO "_Mig0924_Triage" SELECT 'PDF_NOT_APPROVED', l."fileId", tl."B", l."status"::text
FROM "_TaskLayouts" tl JOIN "Layout" l ON l."id"=tl."A" JOIN "File" f ON f."id"=l."fileId"
WHERE f."mimetype"='application/pdf' AND l."status" <> 'APPROVED';

-- 4. IMAGEM (tudo que não é PDF) → ARTE DO IMPLEMENTO, UMA LINHA POR IMPLEMENTO (fan-out)
--    (implementos faltantes já criados no passo 1b)
--    ⚠️ PRÉ-CHECAGEM (auditoria §13): uma linha Layout que tem airbrushingId E está em _TaskLayouts
--    herdaria implementId no rn=1 e violaria Layout_one_owner_check no passo 8 (a migração
--    falha inteira — alto, não calado). Se o ensaio achar alguma, o rn=1 dessa linha NÃO herda
--    o id: todas as tarefas dela recebem linha nova (condição "AND l.\"airbrushingId\" IS NULL"
--    no UPDATE abaixo e "rn > 1 OR airbrushingId IS NOT NULL" no INSERT).
--    ⚠️ "tudo que não é PDF" inclui EPS/AI (2 no clone): viram arte, mas o upload novo só aceita
--    imagem (§5.1). Levar à triagem (_Mig0924_Triage 'ART_NOT_IMAGE').
CREATE TEMP TABLE _fan ON COMMIT DROP AS
SELECT tl."A" AS "layoutId", tl."B" AS "taskId", i."id" AS "implementId", l."airbrushingId" AS "abId",
       row_number() OVER (PARTITION BY tl."A" ORDER BY t."createdAt", t."id") AS rn
FROM "_TaskLayouts" tl JOIN "Layout" l ON l."id"=tl."A" JOIN "File" f ON f."id"=l."fileId"
JOIN "Task" t ON t."id"=tl."B" JOIN "Implement" i ON i."taskId"=tl."B"
WHERE f."mimetype" <> 'application/pdf';
--    o 1º vínculo HERDA o id original (histórico que cita o id continua resolvendo),
--    salvo se a linha já tem dono de aerografia (pré-checagem acima)
UPDATE "Layout" l SET "implementId"=fa."implementId",
  "approvalSource" = CASE WHEN l."status"='APPROVED' THEN 'MIGRATED_TASK'::"LayoutApprovalSource" END
FROM _fan fa WHERE fa."layoutId"=l."id" AND fa.rn=1 AND fa."abId" IS NULL;
--    os demais nascem com id novo e o MESMO status
WITH src AS (SELECT fa.*, gen_random_uuid()::text AS "newId" FROM _fan fa WHERE fa.rn > 1 OR fa."abId" IS NOT NULL),
ins AS (INSERT INTO "Layout" ("id","fileId","status","implementId","approvalSource","createdAt","updatedAt")
  SELECT s."newId", l."fileId", l."status", s."implementId",
         CASE WHEN l."status"='APPROVED' THEN 'MIGRATED_TASK'::"LayoutApprovalSource" END, l."createdAt", now()
  FROM src s JOIN "Layout" l ON l."id"=s."layoutId" RETURNING "id")
INSERT INTO "_Mig0924_LayoutOrigin" ("layoutId","sourceLayoutId","taskId","origin")
SELECT s."newId", s."layoutId", s."taskId", 'FANOUT' FROM src s;

-- 5. LAYOUT DO ORÇAMENTO → ARTE EM CADA IMPLEMENTO DO ORÇAMENTO (D-13, §2A.9) — REESCRITO na Revisão 2.
--    A arte CONTINUA no hash material da assinatura (v7, layoutFileIds). Para que todo envelope
--    RUNNING/COMPLETED que casava antes case depois, valem as regras do 08 §3.4:
--    M-A: a arte nasce SEMPRE com o próprio File.id do orçamento (113 de 137 são clones: outro
--         File.id que o da galeria). NUNCA se promove o "gêmeo" (o 5a do v1 fazia isso e trocava o id).
--    M-B: nos orçamentos com coleta RUNNING/COMPLETED, as outras imagens APPROVED desses implementos
--         saem de APPROVED (SUPERSEDED), senão entram na união e o contrato cai (71 de 134 orçamentos
--         com layout têm imagem aprovada fora do layout; o nº 594 COMPLETED tem 4). Nos demais
--         orçamentos elas FICAM (V13: SUPERSEDED esconderia arte do chão em tarefa em voo).
--    M-C: coleta RUNNING/COMPLETED ⇒ APPROVED (MIGRATED_ENVELOPE) mesmo com o orçamento PENDING/REQUESTED (V14).
--    M-D: todo implemento do orçamento SHARED recebe o MESMO conjunto (cobertura uniforme ⇒ sem layoutCoverage ⇒ hash igual).
--    DD6 (Revisão 3, a feat/orcamento-veiculos ESTÁ em produção): em Budget."layoutScope"='PER_VEHICLE' cada
--    implemento recebe SÓ os pares ("fileId","taskId") de "BudgetLayoutTask" — é a verdade do que foi congelado
--    com layoutCoverage. Produção em 23/09: 0 orçamentos PER_VEHICLE, 0 linhas; reconferir no ensaio.
CREATE TEMP TABLE _q ON COMMIT DROP AS
SELECT qf."id" AS "qFileId", b."id" AS "budgetId", b."status"::text AS bstatus, t."id" AS "taskId", i."id" AS "implementId",
       qf."mimetype" AS mime, qf."path",
       lower(btrim(coalesce(qf."originalName", qf."filename"))) || '::' || qf."size" AS ik,
       EXISTS (SELECT 1 FROM "SignatureEnvelope" e
               WHERE e."quoteId" = b."id" AND e."status" IN ('RUNNING','COMPLETED')) AS live
FROM "File" qf JOIN "Budget" b ON b."id" = qf."quoteLayoutId"
JOIN "Task" t ON t."quoteId" = b."id" JOIN "Implement" i ON i."taskId" = t."id"
WHERE qf."quoteLayoutId" IS NOT NULL;
DELETE FROM _q WHERE NOT live AND bstatus IN ('EXPIRED','CANCELLED');       -- sem coleta: só o arquivo morto
DELETE FROM _q WHERE mime = 'application/pdf' AND NOT live;                   -- PDF vai ao projeto (5c); com coleta viva fica também como arte (0 no clone)
DELETE FROM _q q USING "Budget" b                                             -- DD6: por veículo, só a cobertura gravada
WHERE b."id" = q."budgetId" AND b."layoutScope" = 'PER_VEHICLE'
  AND NOT EXISTS (SELECT 1 FROM "BudgetLayoutTask" c WHERE c."fileId" = q."qFileId" AND c."taskId" = q."taskId");
ALTER TABLE _q ADD COLUMN target "LayoutStatus", ADD COLUMN asrc "LayoutApprovalSource";
UPDATE _q SET
  target = CASE WHEN bstatus IN ('APPROVED','SIGNED') OR live THEN 'APPROVED'::"LayoutStatus"
                ELSE 'PENDING_APPROVAL'::"LayoutStatus" END,                     -- DD5: pendentes → PENDING_APPROVAL
  asrc   = CASE WHEN bstatus IN ('APPROVED','SIGNED') THEN 'MIGRATED_BUDGET'::"LayoutApprovalSource"
                WHEN live THEN 'MIGRATED_ENVELOPE'::"LayoutApprovalSource" END;
--    5a. o MESMO File.id já é arte deste implemento (galeria e orçamento com o mesmo arquivo: 24 de 137):
--        sobe para APPROVED quando o alvo é APPROVED; nunca rebaixa um APPROVED da galeria.
UPDATE "Layout" l SET
  "status" = CASE WHEN q.target = 'APPROVED' OR l."status" = 'APPROVED' THEN 'APPROVED'::"LayoutStatus" ELSE q.target END,
  "approvalSource" = CASE WHEN q.target = 'APPROVED' AND l."status" <> 'APPROVED' THEN q.asrc ELSE l."approvalSource" END
FROM _q q WHERE l."implementId" = q."implementId" AND l."fileId" = q."qFileId";
--    5b. M-A: linha nova com o File.id DO ORÇAMENTO (os bytes já são cópia privada). O gêmeo da galeria
--        (mesmo path ∨ originalName+size, chave do reconciliador src/utils/sync-quote-task-layouts.ts:10-14)
--        NÃO é tocado aqui.
WITH n AS (SELECT q.*, gen_random_uuid()::text AS "newId" FROM _q q
  WHERE NOT EXISTS (SELECT 1 FROM "Layout" l WHERE l."implementId" = q."implementId" AND l."fileId" = q."qFileId")),
ins AS (INSERT INTO "Layout" ("id","fileId","status","implementId","approvalSource","createdAt","updatedAt")
  SELECT "newId", "qFileId", target, "implementId", asrc, now(), now() FROM n RETURNING "id")
INSERT INTO "_Mig0924_LayoutOrigin" ("layoutId","sourceQuoteFileId","taskId","origin")
SELECT "newId", "qFileId", "taskId", 'QUOTE' FROM n WHERE "newId" IN (SELECT "id" FROM ins);
--    (unicidade (implementId, fileId) por construção: um File de orçamento pertence a um orçamento só
--     — quoteLayoutId é escalar —, cada tarefa tem um implemento, e o NOT EXISTS cobre o 5a.)
--    5b'. M-B: só onde há coleta RUNNING/COMPLETED — o que não é do orçamento sai de APPROVED.
CREATE TEMP TABLE _mb ON COMMIT DROP AS
SELECT DISTINCT l."id" AS "layoutId", l."implementId", q."budgetId"
FROM _q q JOIN "Layout" l ON l."implementId" = q."implementId"
WHERE q.live AND l."status" = 'APPROVED'
  AND l."fileId" NOT IN (SELECT q2."qFileId" FROM _q q2 WHERE q2."budgetId" = q."budgetId");
UPDATE "Layout" l SET "status" = 'SUPERSEDED' FROM _mb m WHERE m."layoutId" = l."id";
INSERT INTO "_Mig0924_Triage" SELECT 'GALLERY_SUPERSEDED_BY_QUOTE', l."fileId", i."taskId", m."budgetId"
FROM _mb m JOIN "Layout" l ON l."id" = m."layoutId" JOIN "Implement" i ON i."id" = m."implementId";
--        elo de versão: a arte do orçamento "substitui" o gêmeo; supersedesId é @unique ⇒ um par por lado.
WITH pairs AS (
  SELECT nl."id" AS new_id, ol."id" AS old_id, ol."createdAt" AS oc
  FROM _q q JOIN "Layout" nl ON nl."implementId" = q."implementId" AND nl."fileId" = q."qFileId"
  JOIN _mb m ON m."implementId" = q."implementId" JOIN "Layout" ol ON ol."id" = m."layoutId"
  JOIN "File" ofl ON ofl."id" = ol."fileId"
  WHERE ofl."path" = q."path" OR lower(btrim(coalesce(ofl."originalName", ofl."filename"))) || '::' || ofl."size" = q.ik),
one_new AS (SELECT DISTINCT ON (new_id) new_id, old_id FROM pairs ORDER BY new_id, oc DESC),
one_old AS (SELECT DISTINCT ON (old_id) new_id, old_id FROM one_new ORDER BY old_id, new_id)
UPDATE "Layout" nl SET "supersedesId" = o.old_id FROM one_old o WHERE nl."id" = o.new_id AND nl."supersedesId" IS NULL;
--    5b''. triagem para o dono (perguntas 9 e 10)
INSERT INTO "_Mig0924_Triage" SELECT DISTINCT 'QUOTE_ART_APPROVED_BY_LIVE_ENVELOPE', q."qFileId", q."taskId", q."budgetId"
FROM _q q WHERE q.asrc = 'MIGRATED_ENVELOPE';
INSERT INTO "_Mig0924_Triage" SELECT DISTINCT 'GALLERY_APPROVED_VS_QUOTE_PENDING', l."fileId", q."taskId", q."budgetId"
FROM _q q JOIN "Layout" l ON l."implementId" = q."implementId"
WHERE q.target = 'PENDING_APPROVAL' AND l."status" = 'APPROVED' AND l."fileId" <> q."qFileId";
--    5c. PDF de orçamento (4 no clone) → projeto da tarefa de cada tarefa do orçamento + triagem
INSERT INTO "_TASK_PROJECT_FILES" ("A","B")
SELECT qf."id", t."id" FROM "File" qf JOIN "Budget" b ON b."id"=qf."quoteLayoutId"
JOIN "Task" t ON t."quoteId"=b."id"
WHERE qf."mimetype"='application/pdf' AND b."status" NOT IN ('EXPIRED','CANCELLED') ON CONFLICT DO NOTHING;
INSERT INTO "_Mig0924_Triage" SELECT 'QUOTE_PDF', qf."id", NULL, qf."originalName" FROM "File" qf
WHERE qf."quoteLayoutId" IS NOT NULL AND qf."mimetype"='application/pdf';

-- 6. O.S. DE ARTE EM WAITING_APPROVE (31 no clone): a arte mais recente em DRAFT do
--    implemento passa a PENDING_APPROVAL (senão o portal não mostra nada para aprovar);
--    implemento sem arte vai para a triagem.
UPDATE "Layout" l SET "status"='PENDING_APPROVAL', "sentAt"=now()
FROM (SELECT DISTINCT ON (i."id") l2."id"
      FROM "ServiceOrder" so JOIN "Implement" i ON i."taskId"=so."taskId"
      JOIN "Layout" l2 ON l2."implementId"=i."id"
      WHERE so."type"='ARTWORK' AND so."status"='WAITING_APPROVE' AND l2."status"='DRAFT'
      ORDER BY i."id", l2."createdAt" DESC) x WHERE l."id"=x."id";
INSERT INTO "_Mig0924_Triage" SELECT 'OS_WAITING_NO_ART', NULL, so."taskId", so."id"
FROM "ServiceOrder" so WHERE so."type"='ARTWORK' AND so."status"='WAITING_APPROVE'
  AND NOT EXISTS (SELECT 1 FROM "Implement" i JOIN "Layout" l ON l."implementId"=i."id"
                  WHERE i."taskId"=so."taskId" AND l."status" IN ('PENDING_APPROVAL','APPROVED'));

-- 7. ÓRFÃOS: Layout sem implemento e sem aerografia (inclui as linhas de PDF, que agora
--    vivem em _TASK_PROJECT_FILES). Apaga a LINHA Layout — NUNCA o File.
DELETE FROM "Layout" WHERE "implementId" IS NULL AND "airbrushingId" IS NULL;

-- 8. CONSTRAINTS FINAIS (depois do dado)
ALTER TABLE "Layout" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_implementId_fkey" FOREIGN KEY ("implementId") REFERENCES "Implement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decidedByResponsibleId_fkey" FOREIGN KEY ("decidedByResponsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_one_owner_check" CHECK (("implementId" IS NOT NULL) <> ("airbrushingId" IS NOT NULL));
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decision_note_check"
  CHECK ("status" <> 'REPROVED' OR "approvalSource" IS DISTINCT FROM 'PORTAL' OR "decisionNote" IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "Layout_implementId_fileId_key"   ON "Layout"("implementId","fileId");
CREATE UNIQUE INDEX IF NOT EXISTS "Layout_airbrushingId_fileId_key" ON "Layout"("airbrushingId","fileId");
CREATE UNIQUE INDEX "Layout_supersedesId_key" ON "Layout"("supersedesId");
CREATE INDEX "Layout_implementId_status_idx" ON "Layout"("implementId","status");
-- trilha: uma linha de decisão para cada arte migrada já decidida
INSERT INTO "LayoutDecision" ("id","layoutId","toStatus","source","createdAt")
SELECT gen_random_uuid()::text, l."id", l."status", l."approvalSource", now()
FROM "Layout" l WHERE l."approvalSource" IN ('MIGRATED_TASK','MIGRATED_BUDGET','MIGRATED_ENVELOPE');
--    (as linhas SUPERSEDED do M-B guardam approvalSource=MIGRATED_TASK e ganham aqui a decisão
--     toStatus=SUPERSEDED; o porquê está na triagem GALLERY_SUPERSEDED_BY_QUOTE)

-- 9. O M2M morre (o arquivo morto do passo 0 guarda tudo)
DROP TABLE "_TaskLayouts";
```

```sql
-- M3o — (R-B, depois de M3; DD2, §2A). Revisão 3.1: em DUAS fatias (§4.1) — M3o-a 20260930120300_orcamento_eixo_da_assinatura
--        (passos 0–2, aditiva) e M3o-b 20260930120350_orcamento_valor_aprovado (passo 3 em diante).
-- Precedente do caminho DROP/CREATE do tipo com a coluna gerada: 20260920120000…/migration.sql:79-124.

-- 0. ARQUIVO MORTO
CREATE TABLE IF NOT EXISTS "_Mig0924_BudgetStatus" AS
  SELECT "id", "status"::text AS status, "statusOrder" FROM "Budget";

-- 1. TIPOS E TABELA NOVOS (CREATE TYPE pode ser usado na mesma transação; só ADD VALUE não pode)
CREATE TYPE "BudgetSignatureStatus" AS ENUM
  ('NOT_ISSUED','AWAITING_CUSTOMER','AWAITING_ANKAA','SIGNED','SIGNED_OFFLINE','REFUSED','EXPIRED','INVALIDATED','WAIVED');  -- SIGNED_OFFLINE: DD11
CREATE TYPE "BudgetValueApprovalSource" AS ENUM ('PORTAL','ON_BEHALF','SIGNATURE','LEGACY_APP','MIGRATED');
CREATE TABLE "BudgetValueApproval" (
  "id" text PRIMARY KEY,
  "budgetId" text NOT NULL REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "source" "BudgetValueApprovalSource" NOT NULL,                                   -- sem hash dos termos (DD8)
  "responsibleId" text REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE,  -- tabela física do model Responsible
  "userId" text REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "note" text, "total" decimal(12,2),
  "decidedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" timestamp(3), "revokedReason" text,
  CONSTRAINT "BudgetValueApproval_note_check"  CHECK ("source" <> 'ON_BEHALF' OR "note" IS NOT NULL),
  CONSTRAINT "BudgetValueApproval_actor_check" CHECK (NOT ("responsibleId" IS NOT NULL AND "userId" IS NOT NULL)));
CREATE INDEX "BudgetValueApproval_budgetId_decidedAt_idx" ON "BudgetValueApproval"("budgetId","decidedAt");
ALTER TABLE "Budget" ADD COLUMN "signatureStatus" "BudgetSignatureStatus" NOT NULL DEFAULT 'NOT_ISSUED';
CREATE INDEX "Budget_signatureStatus_idx" ON "Budget"("signatureStatus");
-- DD11 (Revisão 3.1): o registro do "Assinado fora do sistema". Nasce vazio (nenhum orçamento migra para SIGNED_OFFLINE).
CREATE TABLE "BudgetOfflineSignature" (
  "id" text PRIMARY KEY,
  "budgetId" text NOT NULL REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fileId" text NOT NULL REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "note" text NOT NULL, "signedAt" timestamp(3),
  "createdById" text NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" timestamp(3), "revokedReason" text,
  CONSTRAINT "BudgetOfflineSignature_note_check" CHECK (length(btrim("note")) > 0));
CREATE INDEX "BudgetOfflineSignature_budgetId_createdAt_idx" ON "BudgetOfflineSignature"("budgetId","createdAt");

-- 2. EIXO DA ASSINATURA a partir do envelope VIGENTE (§2A.10): RUNNING/COMPLETED primeiro — a MESMA
--    precedência do portão E3, que recusa emitir se existir QUALQUER coleta RUNNING ou COMPLETED
--    (signature-envelope.service.ts:590-597) —, senão o último. Auditoria §14: com "o último" puro,
--    o nº 584 (COMPLETED v1 + INVALIDATED v2) ficaria "Invalidada — reemitir" com a reemissão travada
--    pelo E3, e o nº 591 (COMPLETED v6 + REFUSED v7) cairia em EXPIRED (os dois são dado de teste de 26/07).
--    RUNNING com o grupo 0 (cliente) completo = "Falta a Ankaa": predicado do advanceEnvelope
--    (`status !== SIGNED`, :5830,5852); VOIDED só existe em envelope encerrado (0 em RUNNING no clone).
WITH last AS (
  SELECT DISTINCT ON ("quoteId") "id", "quoteId", "status" FROM "SignatureEnvelope"
  ORDER BY "quoteId", CASE WHEN "status"::text IN ('RUNNING','COMPLETED') THEN 0 ELSE 1 END, "createdAt" DESC)
UPDATE "Budget" b SET "signatureStatus" = CASE l."status"::text
    WHEN 'RUNNING' THEN CASE WHEN NOT EXISTS (
        SELECT 1 FROM "EnvelopeSigner" s WHERE s."envelopeId" = l."id" AND s."orderGroup" = 0
          AND s."status"::text <> 'SIGNED')
      THEN 'AWAITING_ANKAA' ELSE 'AWAITING_CUSTOMER' END
    WHEN 'COMPLETED'   THEN 'SIGNED'
    WHEN 'REFUSED'     THEN 'REFUSED'
    WHEN 'EXPIRED'     THEN 'EXPIRED'
    WHEN 'INVALIDATED' THEN 'INVALIDATED'
    ELSE 'NOT_ISSUED' END::"BudgetSignatureStatus"          -- DRAFT, CANCELLED, SUPERSEDED
FROM last l WHERE l."quoteId" = b."id";
--    aprovados sem coleta nenhuma: "Dispensada (legado)" — continuam FATURÁVEIS (DD7). Produção 23/09: 504 (clone 427).
UPDATE "Budget" b SET "signatureStatus" = 'WAIVED'
WHERE b."status"::text = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId" = b."id");
--    DD7 (Revisão 3): aprovado cuja coleta vigente NÃO concluiu (vencida, recusada, invalidada) perde a cobrança
--    até reassinar. Produção 23/09: nº 741 (cobrança PARTIAL, já faturada) e nº 885 (cobrança PENDING, trava).
--    Vai à triagem para o dono decidir caso a caso: nova coleta ou "Assinado fora do sistema" (DD11).
INSERT INTO "_Mig0924_Triage" SELECT 'LEGACY_APPROVED_UNSIGNED', NULL, NULL, "id"
FROM "Budget" WHERE "status"::text = 'APPROVED' AND "signatureStatus" IN ('EXPIRED','REFUSED','INVALIDATED','NOT_ISSUED');

-- ═══ fim da M3o-a (20260930120300) · início da M3o-b (20260930120350) ═══
-- 3. EIXO DO VALOR: resíduos (§2A.10), ANTES de recriar o tipo
UPDATE "Budget" SET "status" = 'PENDING'                                       -- REQUESTED com coleta RUNNING (9, seed)
WHERE "status"::text = 'REQUESTED' AND "signatureStatus" IN ('AWAITING_CUSTOMER','AWAITING_ANKAA');
UPDATE "Budget" SET "status" = 'EXPIRED'                                       -- PENDING cuja coleta já venceu/foi recusada (clone: 1, com a precedência)
WHERE "status"::text = 'PENDING' AND "signatureStatus" IN ('REFUSED','EXPIRED');
--    (auditoria §14) PENDING com coleta legada CONCLUÍDA que não aprovou (o gancho de conclusão
--    esbarrou no portão de layout — o "nº 591"): vira APPROVED, que é o que budgetApprove teria feito;
--    ganha a aprovação MIGRATED no passo 4 e vai à triagem. Clone: 1 (nº 591, dado de teste).
INSERT INTO "_Mig0924_Triage" SELECT 'LEGACY_COMPLETED_NOT_APPROVED', NULL, NULL, "id"
FROM "Budget" WHERE "status"::text = 'PENDING' AND "signatureStatus" = 'SIGNED';
UPDATE "Budget" SET "status" = 'APPROVED'
WHERE "status"::text = 'PENDING' AND "signatureStatus" = 'SIGNED';
UPDATE "Budget" SET "status" = 'APPROVED', "signatureStatus" = 'AWAITING_ANKAA'   -- SIGNED (0 no clone)
WHERE "status"::text = 'SIGNED';

-- 4. APROVAÇÃO DO VALOR para quem já está aprovado: o registro que o E1 e o portal leem.
--    Sem hash (DD8): não há script pós-migração.
INSERT INTO "BudgetValueApproval" ("id","budgetId","source","responsibleId","decidedAt")
SELECT gen_random_uuid()::text, b."id", 'MIGRATED',
       CASE WHEN b."status"::text = 'PRE_APPROVED' THEN r."preApprovedByResponsibleId" END,
       coalesce(r."preApprovedAt", b."updatedAt")
FROM "Budget" b LEFT JOIN "BudgetRequest" r ON r."budgetId" = b."id"
WHERE b."status"::text IN ('APPROVED','PRE_APPROVED');
--    (BudgetRequest: budgetId @unique, preApprovedAt, preApprovedByResponsibleId → Responsible; conferido
--     no schema da branch. Só Budget.status usa o tipo "BudgetStatus" no schema — conferir no catálogo de produção, passo 5.)

-- 5. O TIPO SEM PRE_APPROVED (e SIGNED no fim, como legado). queueRank cai e volta.
UPDATE "Budget" SET "status" = 'APPROVED' WHERE "status"::text = 'PRE_APPROVED';   -- 0 no clone
DROP INDEX IF EXISTS "Budget_statusOrder_queueRank_idx";
ALTER TABLE "Budget" DROP COLUMN IF EXISTS "queueRank";
ALTER TABLE "Budget" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Budget" ALTER COLUMN "status" TYPE text USING "status"::text;
DROP TYPE "BudgetStatus";
CREATE TYPE "BudgetStatus" AS ENUM
  ('REQUESTED','EXPIRED','PENDING','IN_NEGOTIATION','APPROVED','SIGNED','CANCELLED');
ALTER TABLE "Budget" ALTER COLUMN "status" TYPE "BudgetStatus" USING "status"::"BudgetStatus";
ALTER TABLE "Budget" ALTER COLUMN "status" SET DEFAULT 'PENDING';
-- ⚠️ Antes: listar no catálogo de PRODUÇÃO toda coluna do tipo "BudgetStatus" fora de Budget.status
--    (SELECT table_name, column_name FROM information_schema.columns WHERE udt_name = 'BudgetStatus';)
--    — cada uma precisa do mesmo ALTER … TYPE text / volta, senão o DROP TYPE falha (alto, não calado).
ALTER TABLE "Budget" ADD COLUMN "queueRank" double precision
  GENERATED ALWAYS AS (
    CASE
      -- a bola está com a Ankaa, ou terminou: mais recente primeiro
      WHEN "status" IN ('REQUESTED','EXPIRED','PENDING','APPROVED','SIGNED','CANCELLED')
        THEN -extract(epoch from "createdAt")
      -- espera-se o cliente (IN_NEGOTIATION): mais antigo primeiro
      ELSE extract(epoch from "createdAt")
    END) STORED;
CREATE INDEX "Budget_statusOrder_queueRank_idx" ON "Budget" ("statusOrder", "queueRank");

-- 6. statusOrder POR EXTENSO (tem de casar com BUDGET_STATUS_ORDER em src/constants/sortOrders.ts
--    e web/src/constants/sortOrders.ts EXATAMENTE — duas fontes, um número; G26 confere)
UPDATE "Budget" SET "statusOrder" = CASE "status"
  WHEN 'REQUESTED' THEN 1 WHEN 'EXPIRED' THEN 2 WHEN 'PENDING' THEN 3 WHEN 'IN_NEGOTIATION' THEN 4
  WHEN 'APPROVED' THEN 5 WHEN 'SIGNED' THEN 5 WHEN 'CANCELLED' THEN 6 END;
ALTER TABLE "Budget" ALTER COLUMN "statusOrder" SET DEFAULT 3;

-- Reversão: a partir de "_Mig0924_BudgetStatus" (status e statusOrder), recriar o tipo de 8 valores
-- (20260920120000…:97-107) e o queueRank de 20260920190000; DROP COLUMN "signatureStatus";
-- DROP TABLE "BudgetValueApproval"; DROP TYPE dos dois enums novos. Perde as aprovações do valor
-- gravadas depois do deploy (anotar antes).
```

```sql
-- M4 — release R-D, DEPOIS da janela de compatibilidade (nenhum cliente pede layoutFiles)
-- 1. Função do gatilho SEM o bloco de saída — ANTES do DROP COLUMN, na MESMA migração.
CREATE OR REPLACE FUNCTION file_blocking_references(p_file_id text)
RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE r record; hit boolean; refs text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
      AND ccu.table_name='File' AND ccu.column_name='id' AND tc.table_name <> 'thumbnail_jobs'
    ORDER BY tc.table_name, kcu.column_name
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', r.tbl, r.col) INTO hit USING p_file_id;
    IF hit THEN refs := refs || (r.tbl || '.' || r.col)::text; END IF;
  END LOOP;
  RETURN refs;
END; $$;
-- ⚠️ Copiar o corpo ATUAL de 20260804180000…/migration.sql:31-81 e remover SÓ o bloco :43-48;
--    o texto acima é o esqueleto — conferir filtros extras (ex.: thumbnail_jobs) contra o original.
-- 2. A coluna de saída.
ALTER TABLE "File" DROP CONSTRAINT IF EXISTS "File_quoteLayoutId_fkey";
DROP INDEX IF EXISTS "File_quoteLayoutId_idx";
ALTER TABLE "File" DROP COLUMN IF EXISTS "quoteLayoutId";
-- 3. (se 0 linhas em produção) DROP TABLE IF EXISTS "_DroppedTruckVinPlateText";
-- 4. DD6 (Revisão 3): a cobertura por veículo do orçamento já virou arte de cada implemento na M3 passo 5.
--    DROP TABLE IF EXISTS "BudgetLayoutTask";  (as FKs para File/Task caem junto)
--    Budget."layoutScope" FICA como flag legado de leitura: o builder do snapshot emite layoutCoverage quando
--    ele é PER_VEHICLE, e envelope congelado assim precisa continuar casando. Só sai numa rodada futura,
--    quando nenhum envelope RUNNING/COMPLETED de orçamento PER_VEHICLE depender dele.
```

```sql
-- M5s — R-D, com a catraca G24 zerada e o contador de chaves legadas zerado há 14 dias (10 §4.6)
DROP TRIGGER IF EXISTS "Task_serial_is_mirror" ON "Task";
DROP TRIGGER IF EXISTS "Implement_serial_mirror" ON "Implement";
DROP FUNCTION IF EXISTS task_serial_is_mirror(), implement_serial_mirror();
DROP INDEX IF EXISTS "Task_serialNumberNormalized_trgm_idx";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "serialNumberNormalized";  -- ANTES da base: a gerada depende dela
ALTER TABLE "Task" DROP COLUMN IF EXISTS "serialNumber";
-- Os gatilhos de "ao menos um implemento" (M1s passo 6) FICAM para sempre.
-- Reversão: ADD COLUMN "serialNumber" na Task + UPDATE a partir do implemento + coluna gerada + GIN + gatilhos.
```

### 4.4 Contagens esperadas (produção medida em 23/09 no P00; **refazer no ensaio**)

Fonte da coluna "Produção": `P00-producao.md` (SELECT em transação somente leitura, 23/09 15:17 UTC). O ADR 0121 (03/09) tinha 597 `Layout` (283 PDF / 311 imagem) e 157 layouts de orçamento em 153 orçamentos: os números abaixo o substituem.

| Medida | Clone | Produção (23/09) | Invariante depois da migração |
|---|---:|---:|---|
| `Truck` → `Implement` | 575 | **635** | **`count(Implement) = count(Task)`** (produção: 635 + **1.676** criados pela M1s = 2.311); 0 tarefas sem implemento; os 1.676 com `spot IS NULL`; o passo 1b da M3 cria 0 |
| séries (`Task.serialNumber`) preenchidas / nulas / duplicadas | 2.013 / 240 / 0 | **2.051 / 260 / 0** | 2.051 em `Implement.serialNumber`; `Task.serialNumber IS DISTINCT FROM Implement.serialNumber` = 0; `Task.serialNumber` × `_Mig0924_TaskSerial` = 0 diferenças |
| séries fora da regex `^[A-Z0-9-]+$` (a mesma na API e no web, valor cru) | 42 | **42** | migram como estão (S-7, V15) |
| veículos em envelopes RUNNING/COMPLETED com série congelada ≠ `implement.serialNumber` | 0 de 25 | **0 de 6** (só COMPLETED; não há RUNNING) | 0 (G11 com a asserção da série) |
| `Layout` total (PDF / imagem / EPS) sem aerografia | 481 (237 / 242 / 2) | **786** (391 / 391 / 4) | — |
| `Layout` de aerografia | 0 | **73** (46 aerografias) | intocados (todo passo da M3 filtra `airbrushingId IS NULL`) |
| `Layout` ligados a tarefa: PDF / imagem (vínculos) | 177 / 196 (214 / 369) | **267 / 306 (351 / 557)** | PDFs viram vínculos em `_TASK_PROJECT_FILES` (351); imagens viram 557 linhas (uma por vínculo) |
| fan-out máximo (tarefas por layout) | 40 | **40** | 0 layouts com >1 implemento |
| órfãos (sem tarefa, sem aerografia) | 108 | **213** | apagadas como LINHA; `count(File)` inalterado |
| medidas compartilhadas | 11 linhas | **11 linhas, 15 implementos, 26 cópias** | 0 compartilhadas |
| `projectFiles` da tarefa | 4 | **4** | 0 dos antigos em `_TASK_PROJECT_FILES`; 4 em `_IMPLEMENT_PROJECT_FILES` |
| PDFs com cara de projeto da Furgões em `baseFiles` | 152 | **223** (87 em tarefas vivas) | vínculo copiado para o projeto do implemento **só nos 87** (D-11) |
| arquivos de layout do orçamento | 137 (133 imagem + 4 PDF) em 135 orçamentos; 24 são o mesmo `File` da galeria | **311 (307 + 4) em 301 orçamentos; 90 são o mesmo `File` da galeria**, 221 são clone; por estado: APPROVED 226, CANCELLED 73, PENDING 2 | toda imagem de orçamento vivo (e de orçamento com coleta RUNNING/COMPLETED) vira arte **com o mesmo `File.id`** em cada implemento coberto (todos em `SHARED`; só os de `BudgetLayoutTask` em `PER_VEHICLE`): APPROVED (APPROVED/SIGNED/coleta viva) ou PENDING_APPROVAL (demais) |
| `Budget.layoutScope` / `BudgetLayoutTask` | — | **SHARED 724, PER_VEHICLE 0 / 0 linhas** | `PER_VEHICLE`: arte só nos pares de `BudgetLayoutTask` (DD6) |
| gêmeo DRAFT da galeria | 15 pares | **7 pares** | **não promovido** (M-A): fica DRAFT |
| orçamentos com layout e imagem APPROVED da galeria fora do layout | 71 de 134 | **179 de 301** | SUPERSEDED **só** nos com coleta RUNNING/COMPLETED (M-B, triagem `GALLERY_SUPERSEDED_BY_QUOTE`); nos demais ficam APPROVED |
| orçamentos com layout e sem tarefa | 14 arquivos | **17 orçamentos** | ficam só no arquivo morto |
| O.S. ARTE em WAITING_APPROVE | 31 | **12** (6 em tarefas PREPARATION, 6 em CANCELLED) | as 6 vivas com arte PENDING_APPROVAL (a aprovação as fecha, DD3); as 6 canceladas na triagem |
| envelopes RUNNING / COMPLETED com `layoutFileIds` | 15 de 16 / 2 de 3 | **0 / 30 de 30** (24 no formato v1/v2) | **quem casava antes casa depois** (régua G11 com o código novo) |
| `Budget.status` × último envelope | APPROVED 429, PENDING 164, REQUESTED 15, EXPIRED 6, CANCELLED 1 | **APPROVED 536 (504 sem envelope, 30 COMPLETED, 2 EXPIRED), CANCELLED 181, PENDING 7** | depois da M3o: `PRE_APPROVED` = 0; `SIGNED` = 0; `REQUESTED` com coleta = 0; `PENDING` com coleta encerrada = 0 |
| `Budget.signatureStatus` | — | **esperado: `WAIVED` 504, `SIGNED` 30, `EXPIRED` 2, `NOT_ISSUED` 188** | coerência com o envelope vigente = 100% (G29); triagem `LEGACY_APPROVED_UNSIGNED` = 2 (nº 741, 885) |
| `BudgetValueApproval` | — | **esperado: 536 `MIGRATED`** | uma `MIGRATED` para cada APPROVED e PRE_APPROVED (sem hash, DD8) |
| O.S. "Em Negociação" (a branch apaga) | — | **IN_PROGRESS 74, WAITING_ARTWORK 10, PENDING 7, COMPLETED 472, CANCELLED 2** (+ grafias "Em Negociacao" 20, "NEGOCIACAO" 1) | a migração da branch (`591a9281`) ensaiada com esses números |
| `Preferences` com chaves truck/layout | 7 usuários | **dash web 4, tabela web 7, detalhe web 8, dash app 0** | migrador do dashboard (§6.8) |

### 4.5 Idempotência

`IF NOT EXISTS` nas criações (⚠️ auditoria §13: ainda **não** em todas — `ADD COLUMN` do passo 1 de M3, `CREATE TABLE "_IMPLEMENT_PROJECT_FILES"`/`"LayoutDecision"` e os `ADD CONSTRAINT` de M2/M3 estão sem guarda; como cada arquivo roda numa transação só, isso não corrompe nada, mas re-rodar M3 à mão depois de um sucesso parcial exige as guardas — acrescentá-las no P10); `DO $$ … to_regclass … $$` no RENAME; `ON CONFLICT DO NOTHING` nos M2M; `WHERE NOT EXISTS` na criação de Implement e Layout. O fan-out do passo 4 só é seguro uma vez porque lê `_TaskLayouts`, derrubada no passo 9 da mesma transação. Se a migração falhar no meio, o Postgres reverte tudo, já que DDL é transacional. M0 **não pode** rodar na mesma transação que usa os valores novos, e por isso vai numa release anterior. **M1s**: `IF NOT EXISTS`/`CREATE OR REPLACE`/`DROP TRIGGER IF EXISTS` em tudo, e o INSERT de implementos é `WHERE NOT EXISTS` — re-rodável. **M3o**: `CREATE TYPE`/`CREATE TABLE` sem guarda (rodar duas vezes falha alto, que é o desejado: a segunda rodada recriaria o tipo em cima de dado já migrado); os `UPDATE` de backfill são idempotentes por construção (filtram pelo estado de origem).

### 4.6 Ensaio em transação revertida (pré-condição de deploy)

1. **Contra o clone local primeiro, depois contra produção** (quem tem acesso; `psql` no servidor, porque o local não tem `psql`), com M0 já aplicada:
```text
BEGIN;
  \i M1.sql  \i M1s.sql  \i M2.sql  \i M3.sql  \i M3o.sql
  SELECT count(*) FROM "File";                                                   -- = antes
  -- M1s (10 §4.5)
  SELECT (SELECT count(*) FROM "Task") - (SELECT count(*) FROM "Implement");     -- 0
  SELECT count(*) FROM "Task" t WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId"=t.id);   -- 0
  SELECT count(*) FROM "_Mig0924_SerialImplementCreated";                        -- produção 23/09: 1.676 (clone 1.678)
  SELECT count(*) FROM "_Mig0924_SerialImplementCreated" c JOIN "Implement" i ON i.id=c."implementId"
   WHERE i."spot" IS NOT NULL;                                                   -- 0
  SELECT count(*) FROM "Task" t JOIN "Implement" i ON i."taskId"=t.id
   WHERE t."serialNumber" IS DISTINCT FROM i."serialNumber";                     -- 0
  SELECT count(*) FROM "_Mig0924_TaskSerial" o JOIN "Task" t ON t.id=o."taskId"
   WHERE t."serialNumber" IS DISTINCT FROM o."serialNumber";                     -- 0
  -- gatilhos (dentro de SAVEPOINTs, cada um deve FALHAR onde indicado):
  --   SAVEPOINT a; UPDATE "Task" SET "serialNumber"='X' WHERE id=<t>;          -- ERRO 23514; ROLLBACK TO a;
  --   UPDATE "Implement" SET "serialNumber"='X' WHERE "taskId"=<t>;            -- a Task passa a 'X', updatedAt igual
  --   SAVEPOINT b; INSERT INTO "Task" (...) sem implemento; SET CONSTRAINTS ALL IMMEDIATE;  -- ERRO; ROLLBACK TO b;
  -- M3o (§2A.10)
  SELECT status, "signatureStatus", count(*) FROM "Budget" GROUP BY 1,2 ORDER BY 1,2;   -- bater com §2A.10
  SELECT count(*) FROM "Budget" b WHERE b.status='APPROVED'
     AND NOT EXISTS (SELECT 1 FROM "BudgetValueApproval" v WHERE v."budgetId"=b.id AND v."revokedAt" IS NULL);  -- 0
  SELECT count(*) FROM "Budget" WHERE status='PENDING' AND "signatureStatus" IN ('REFUSED','EXPIRED');         -- 0
  -- arte do orçamento (M-A/M-D): todo implemento de orçamento vivo tem, como arte, EXATAMENTE os File.id do layout dele
  SELECT count(*) FROM "_Mig0924_QuoteLayout" q JOIN "Budget" b ON b.id=q."quoteLayoutId" JOIN "Task" t ON t."quoteId"=b.id
    JOIN "Implement" i ON i."taskId"=t.id JOIN "File" f ON f.id=q."fileId"
   WHERE (b.status NOT IN ('EXPIRED','CANCELLED') OR EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId"=b.id AND e.status IN ('RUNNING','COMPLETED')))
     AND (f.mimetype <> 'application/pdf' OR EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId"=b.id AND e.status IN ('RUNNING','COMPLETED')))
     AND NOT EXISTS (SELECT 1 FROM "Layout" l WHERE l."implementId"=i.id AND l."fileId"=q."fileId"
                     AND l.status IN ('APPROVED','PENDING_APPROVAL'));          -- 0
  -- M-B: nos orçamentos com coleta viva/concluída, nenhuma arte APPROVED fora do layout do orçamento
  SELECT count(*) FROM "Budget" b JOIN "Task" t ON t."quoteId"=b.id JOIN "Implement" i ON i."taskId"=t.id
    JOIN "Layout" l ON l."implementId"=i.id AND l.status='APPROVED'
   WHERE EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId"=b.id AND e.status IN ('RUNNING','COMPLETED'))
     AND EXISTS (SELECT 1 FROM "_Mig0924_QuoteLayout" q WHERE q."quoteLayoutId"=b.id)
     AND NOT EXISTS (SELECT 1 FROM "_Mig0924_QuoteLayout" q WHERE q."quoteLayoutId"=b.id AND q."fileId"=l."fileId");  -- 0
  SELECT count(*) FROM "Layout" WHERE ("implementId" IS NULL) = ("airbrushingId" IS NULL);   -- 0
  -- todo PDF antes ligado a tarefa está no projeto da tarefa:
  SELECT count(*) FROM "_Mig0924_TaskLayouts" x JOIN "_Mig0924_Layout" l ON l.id=x."A" JOIN "File" f ON f.id=l."fileId"
   WHERE f.mimetype='application/pdf' AND NOT EXISTS (SELECT 1 FROM "_TASK_PROJECT_FILES" p WHERE p."A"=l."fileId" AND p."B"=x."B"); -- 0
  -- toda imagem antes ligada a tarefa virou arte daquele implemento com o mesmo status (salvo promoções do passo 5/6):
  SELECT count(*) FROM "_Mig0924_TaskLayouts" x JOIN "_Mig0924_Layout" l ON l.id=x."A" JOIN "File" f ON f.id=l."fileId"
    JOIN "Implement" i ON i."taskId"=x."B"
   WHERE f.mimetype<>'application/pdf' AND NOT EXISTS (SELECT 1 FROM "Layout" n WHERE n."implementId"=i.id AND n."fileId"=l."fileId"); -- 0
  SELECT count(*) FROM "_Mig0924_TaskProjectFiles" o JOIN "Implement" i ON i."taskId"=o."B"
   WHERE NOT EXISTS (SELECT 1 FROM "_IMPLEMENT_PROJECT_FILES" p WHERE p."A"=o."A" AND p."B"=i.id);  -- 0
  -- (auditoria §14) a M1s copia createdAt DA TAREFA, então "createdAt > now() - 5 min" não pega nada;
  -- o que se confere é spot nos implementos criados pela migração (M1s + passo 1b da M3):
  SELECT count(*) FROM "Implement" i WHERE i."spot" IS NOT NULL AND (
    i.id IN (SELECT "implementId" FROM "_Mig0924_SerialImplementCreated")
    OR i.id IN (SELECT "implementId" FROM "_Mig0924_ImplementCreated"));                        -- 0
  -- (auditoria §13) toda imagem antes ligada a tarefa virou arte — SEM join interno com Implement,
  -- que escondia justamente a tarefa sem implemento:
  SELECT count(*) FROM "_Mig0924_TaskLayouts" x JOIN "_Mig0924_Layout" l ON l.id=x."A" JOIN "File" f ON f.id=l."fileId"
    LEFT JOIN "Implement" i ON i."taskId"=x."B"
   WHERE f.mimetype<>'application/pdf'
     AND (i.id IS NULL OR NOT EXISTS (SELECT 1 FROM "Layout" n WHERE n."implementId"=i.id AND n."fileId"=l."fileId")); -- 0
  -- (auditoria §13) pré-checagem, ANTES de M3: Layout com dois donos (aerografia + tarefa)
  SELECT count(*) FROM "Layout" l JOIN "_TaskLayouts" tl ON tl."A"=l.id WHERE l."airbrushingId" IS NOT NULL;   -- anotar
  SELECT count(*) FROM "_Mig0924_Layout" l JOIN "_Mig0924_TaskLayouts" x ON x."A"=l.id JOIN "File" f ON f.id=l."fileId"
   WHERE f.mimetype <> 'application/pdf' AND f.mimetype NOT LIKE 'image/%';                                    -- EPS/AI que viraram arte: triagem
  SELECT kind, count(*) FROM "_Mig0924_Triage" GROUP BY 1;                       -- anotar e levar ao dono
  -- teste do gatilho: exclusão de um File de teste sem referência continua funcionando
ROLLBACK;
```
2. **Régua da assinatura (G11)**, no mesmo ensaio: para cada `SignatureEnvelope` em RUNNING ou COMPLETED, `matchesFrozenTerms(buildForQuote(), quoteTermsSha256, quoteSnapshot) !== null` **antes e depois**, e o critério é **quem casava antes casa depois** (os 14 RUNNING de seed que já não casam hoje ficam fora e são listados). Precisa rodar com o **código novo** (`quoteArtworkOf` alimentando `layoutFileIds` na v7, `build()` lendo série e tipo do implemento e gravando as chaves velhas) apontando para o banco em transação. Mais: `vehicles[].serialNumber` congelado = `implement.serialNumber` para todo RUNNING/COMPLETED (G11 estendida). Na prática, um script `node` que abre `$transaction`, aplica M1, M1s, M2, M3 e M3o, roda a régua e dá `throw` no fim.
3. **Ordem das migrações**: `prisma migrate status` e `prisma migrate diff --from-migrations … --to-schema-datamodel …` contra o dump de produção (as duas da branch têm data anterior a `20260922130000`, já aplicada; §4.1).
4. **Banco de teste**: os bancos de QA (`ankaa_qa_e2e`) sobem **por migração**, nunca por `db push`, para que gatilhos, colunas geradas e o GIN existam (G25).
5. Tempo esperado: segundos (produção em 23/09: 635 + 1.676 implementos, 908 vínculos de `_TaskLayouts`, 724 orçamentos; a coluna gerada da M1s reescreve 2.311 linhas; clone: 575 + 1.678, 583, 615).

### 4.7 Ordem de deploy

| Passo | Ação | Verificação |
|---|---|---|
| 0 | `pg_dump` completo (precedente: backup pré-billing) | arquivo e tamanho anotados |
| 1 | **R-A** (antecipada, dias antes): M0 + schema com os enums novos + patch OTA do app (P02: versão + leitura tolerante de `implement` **e da série**) + censo de consultas (G3) + header de versão no web | `X-App-Version` aparecendo no log |
| 2 | **Build** da API e do web novos (R-B) **antes** de migrar | `build-info` gerado |
| 3 | Janela de baixo uso: **`systemctl stop` da API** (não `pm2`) → `prisma migrate deploy` (as duas da branch, M1, **M1s**, M2, M3, **M3o**) → `systemctl start` (sem script pós-migração: a aprovação migrada não tem hash, DD8) | conferir que o processo é o NOVO (`build-info`, não só health 200) |
| 4 | Invariantes do §4.6 **fora** da transação (agora valendo); `test:portal-cliente:boot`; `test:portal-e2e` contra a pilha | todas zero ou no número esperado |
| 5 | Web novo publicado; handshake de versão força reload das abas velhas | contador de `include.truck` vindo do web cai a zero |
| 6 | App novo (P24) por patch Shorebird (ou release, se entrar glifo novo) | versão nova no log |
| 7 | **R-C**: `MIN_APP_VERSION` = P24 (426 para versões menores e para quem não manda cabeçalho); fim do `LEGACY_APP` (D-36) | contador de alias caindo |
| 7b | Entre R-C e R-D: leitores internos da série migram para `implement.serialNumber` sob a catraca G24 (P28), primeiro os fiscais (G21 na frente) | G24 caindo |
| 8 | **R-D** (contador de alias zerado por 14 dias **e** G24 zerada): remover aliases e o espelho de resposta; **M4**; **M5s**; catraca do portão de resíduo no valor final | `test:*` verdes; G6a e G24 na catraca |

### 4.8 Reversão

| Migração | Como voltar |
|---|---|
| M0 | não precisa (aditiva e inerte) |
| M1 | RENAMEs invertidos (catálogo) |
| M2 | restaurar FKs de medida a partir de `_Mig0924_MeasureUnshare` e apagar as cópias; `DROP` dos CHECKs e das colunas novas. Perde o que alguém tiver digitado depois |
| M3 | recriar `_TaskLayouts` a partir de `_Mig0924_TaskLayouts`; `DELETE FROM "Layout" WHERE id IN (SELECT "layoutId" FROM "_Mig0924_LayoutOrigin")`; restaurar `status`/`implementId=NULL` das linhas originais e reinserir as órfãs a partir de `_Mig0924_Layout`; `_TASK_PROJECT_FILES` := `_Mig0924_TaskProjectFiles`; `DROP TABLE "_IMPLEMENT_PROJECT_FILES", "LayoutDecision"`; recriar `Layout_fileId_key` (só depois de apagar o fan-out); `DELETE FROM "Implement" WHERE id IN (SELECT "implementId" FROM "_Mig0924_ImplementCreated")` |
| M1s | ver o fim do SQL da M1s (§4.2): derrubar gatilhos e funções, recriar `Task_serialNumber_key`, tirar as colunas do implemento, devolver o default do `spot`, apagar só os implementos criados que continuam vazios. Nada se perde: a tarefa teve a série o tempo todo |
| M3 (arte do orçamento) | além do acima: as linhas `SUPERSEDED` do M-B voltam a `APPROVED` a partir de `_Mig0924_Layout` (o arquivo morto guarda o status original) |
| M3o | a partir de `_Mig0924_BudgetStatus`: recriar o tipo de 8 valores e o `queueRank` de `20260920190000`; `DROP COLUMN "signatureStatus"`; `DROP TABLE "BudgetValueApproval"`; `DROP TYPE` dos dois enums novos. Perde as aprovações do valor gravadas depois do deploy (exportar antes) |
| M4 | `ADD COLUMN "quoteLayoutId"` + `UPDATE` a partir de `_Mig0924_QuoteLayout` + função antiga |
| M5s | `ADD COLUMN "serialNumber"` na tarefa + `UPDATE` a partir do implemento + coluna gerada + GIN + os dois gatilhos do espelho |
| código | reverter o deploy exige reverter as migrações **antes**, porque o código velho não conhece `Implement`, grava `Task.serialNumber` (o gatilho da M1s recusaria) e escreve `PENDING` na emissão |

As tabelas `_Mig0924_*` ficam até uma limpeza explícita numa rodada futura (padrão `_DroppedTruckVinPlateText`).

---

## 5. Contrato da API

### 5.1 Rotas

| Hoje | Novo | Validação nova | Janela (alias até R-D) |
|---|---|---|---|
| `GET /trucks` (`query: any`, sem where nem paginação; `truck.controller.ts:28-45`, `truck.service.ts:134-138`) | `GET /implements` | `implementGetManySchema` (paginado, include/where estritos gerados do DMMF) | `/trucks` delega ao mesmo handler + `Deprecation: true` + contador |
| `GET /trucks/:id`, `PUT /trucks/:id` (`query: any` → include cru, `:203-261`; `truck.service.ts:176`) | `GET/PUT /implements/:id` | `ParseUUIDPipe`; `implementUpdateSchema.strict()` (só o que é gravável: `plate, chassisNumber, vinPlateId, type, category, spot, rearDoorLeaves, rearDoorBarCount, rearDoorHatchCount`). **`serialNumber` não** (S-9: a rota aceita WAREHOUSE, `truck.controller.ts:229-236`; a série se edita pela tarefa, domínio `identity`, ou pelo portal) → 400 "a série se edita na tarefa" | alias; corpo com `implementType` traduzido |
| `GET /trucks/garages-availability?truckLength&excludeTruckId` (`:78-102`) | `GET /implements/garages-availability?implementLength&excludeImplementId` | zod | aceita os dois nomes de query |
| `GET /trucks/lane-availability/:garageId`, `GET /trucks/sector-garage-mapping` | `/implements/lane-availability/:garageId`, `/implements/sector-garage-mapping` | `ParseUUIDPipe` | alias |
| `POST /trucks/batch-update-spots` `{updates:[{truckId, spot}]}` (sem zod; `spot as any` em `truck.service.ts:469`) | `POST /implements/batch-update-spots` `{updates:[{implementId, spot}]}` | plugar `truckBulkSpotUpdateSchema` renomeado (`schemas/truck.ts:618`); `spot: z.nativeEnum(TRUCK_SPOT)` | **alias obrigatório**: o Flutter usa (`garage_edit_controller.dart:233`) |
| `POST /trucks/request-movement` (sem zod, `:174-201`) | `POST /implements/request-movement` | zod | `truckId`→`implementId` |
| `/implement-measure/truck/:truckId`, `/truck/:truckId/batch`, `/truck/:truckId/:side`, `POST /:id/assign-to-truck` (`implement-measure.controller.ts:117-284`) | `/implement-measure/implement/:implementId…`, `/:id/assign-to-implement` | `side` validado em runtime: `z.enum(['left','right','back','front'])` (hoje só tipado em TS, `:260`); `ParseUUIDPipe` em `:66-94,117-142` | alias |
| — | **`POST /implements/:id/layouts`** (multipart `files`; cria arte `DRAFT`) | contexto `implementLayouts`; só imagem (PDF → 400 "PDF cotado vai em Projeto da tarefa") | — |
| — | **`POST /implements/:id/layouts/:layoutId/send`** (DRAFT → PENDING_APPROVAL) | DESIGNER, COMMERCIAL, ADMIN | — |
| — | **`POST /implements/:id/layouts/:layoutId/approve-on-behalf`** `{ note }` | COMMERCIAL, ADMIN; `note` obrigatória | — |
| — | **`POST /implements/:id/layouts/:layoutId/reprove`** `{ note }` (reprovação interna) | COMMERCIAL, ADMIN | — |
| — | **`POST /implements/:id/layouts/:layoutId/new-version`** (multipart; cria linha com `supersedesId`) | idem upload | — |
| — | **`DELETE /implements/:id/layouts/:layoutId`** (só DRAFT) | | — |
| — | **`POST /implements/layouts/bulk`** `{ implementIds[], fileId }` (a mesma arte para N implementos; substitui a ação em lote "Adicionar Layout Referência") | transação; uma linha por implemento | — |
| — | **`PUT /implements/:id/project-files`** `{ fileIds[] }` + multipart `implementProjectFiles` | contexto `implementProjectFiles` | — |
| `GET /layout-dimensions/:fileId?truckId=` (`layout-dimensions.controller.ts:62-70`, obrigatório) | `?implementId=` | UUID; o arquivo precisa estar em `Task.projectFiles` da tarefa do implemento | **aceita `truckId`** (o app antigo o manda: `layout_dimensions_repository.dart:19-67`) |
| `GET /tasks/:id/layouts/diagnostic` (`task.controller.ts:202-230`) | apagar ou reescrever sobre o implemento | | — |
| `POST /tasks/:id/upload/layouts` (morta, 400, `:880-887`) | apagar | | — |
| `POST /tasks/bulk/arts` (ADMIN, `:332-346`; `task.service.ts:12519`) | substituída por `POST /implements/layouts/bulk` | | 400 nomeado |
| Portal: `PATCH /cliente/me/veiculos/:taskId/identificacao` (existe) | continua por `taskId` (D-01) | `.strict()`; ganha `medidas.frente` e `portaTraseira` | — |
| — | **`GET /cliente/me/artes?status=PENDING_APPROVAL`** | seção `LAYOUT` | — |
| — | **`PUT /cliente/me/veiculos/:taskId/artes/:layoutId/aprovar`**, **`…/reprovar`** `{ motivo }` | `APPROVE_ARTWORK` + escopo comercial; **404 fora do escopo** (nunca 403) | — |
| — | **`PUT /cliente/me/artes/aprovar`** `{ layoutIds[] }` (lote atômico) | idem | — |
| — | **`POST /cliente/me/veiculos/:taskId/projeto`** (multipart `implementProject`, PDF/imagem) | `WRITE_VEHICLE_IDENTITY` (D-09; alternativa `WRITE_IMPLEMENT_PROJECT`) | — |
| **Orçamento (§2A)** | | | |
| — | **`PUT /budgets/:id/send-to-customer`** (REQUESTED/PENDING/EXPIRED → IN_NEGOTIATION) e **`…/withdraw-from-customer`** (IN_NEGOTIATION → PENDING) | ADMIN, COMMERCIAL; ≥1 serviço com valor | — |
| — | **`PUT /budgets/:id/value-approval`** `{ note }` ("Aprovar valor em nome do cliente") e **`DELETE /budgets/:id/value-approval`** `{ reason }` ("Reprovar valor") | ADMIN, COMMERCIAL; nota/motivo obrigatórios; grava/revoga `BudgetValueApproval` | — |
| `PUT /budgets/:id/status` (`budget.controller.ts:185-216`; `@Roles(ADMIN, FINANCIAL, COMMERCIAL)`, sem `validateQuoteStatusChangeRole`) | igual, **delegando** aos atos acima: `APPROVED` → value-approval (`reason` = nota), `PENDING` vindo de `APPROVED` → reprovação, `IN_NEGOTIATION` → send-to-customer | `validateQuoteStatusChangeRole` aplicado aqui também (X7); `PENDING` de `REQUESTED`/`EXPIRED` sem coleta segue permitido (é "Pendente"); `PRE_APPROVED` → 400 nomeado | cliente velho: `{APPROVED}` sem `reason` → `LEGACY_APP` até R-C (D-36) |
| `PUT /budgets/:id/budget-approve` (`budget.controller.ts:233`; o app 1.4.1 usa) | vira alias de value-approval | ADMIN, COMMERCIAL; **sem** portão de layout (sai `budget.service.ts:3640-3649`) | sem nota → `LEGACY_APP` até R-C |
| `PUT /billings/:id/approve` (`billing.controller.ts:357`) e as rotas antigas `PUT /budgets\|task-quotes/:id/internal-approve[/:taskId]` (`budget.controller.ts:255,299`) → `internalApprove` | igual | **DD7**: além de `status = APPROVED`, exige `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}`; senão **400** "A cobrança só pode ser aprovada depois da assinatura do orçamento." Não há rota de "Dispensar assinatura"; o ato manual é o "Assinado fora do sistema" (linha abaixo, DD11) | a rota antiga por tarefa continua (o app 1.4.1 a usa) com o mesmo portão |
| — | **`POST /budgets/:id/offline-signature`** (multipart `offlineSignatureFile`, 1 arquivo, PDF ou imagem; `note` obrigatória; `signedAt` opcional) — "Assinado fora do sistema" (DD11) | ADMIN, COMMERCIAL; exige `status = APPROVED` com aprovação do valor vigente e eixo em `NOT_ISSUED`/`REFUSED`/`EXPIRED`/`INVALIDATED`; coleta `RUNNING`/`COMPLETED` → **409** "Cancele a coleta em andamento antes"; eixo já `SIGNED`/`SIGNED_OFFLINE`/`WAIVED` → **409**; grava `BudgetOfflineSignature` + eixo `SIGNED_OFFLINE` + `ChangeLog` numa transação; contexto de arquivo `budgetOfflineSignature` | — |
| `POST /cliente/me/assinaturas/:signerId/assinar` (sessão do portal, `portal-signature.controller.ts:123`) e `POST …/publico/:token/assinar` (OTP, `signature.controller.ts:539`) | iguais | **DD12**: um predicado nas duas (`orderNumberRequirement`, `order-number-gate.ts`): quem **tem** `PURCHASING` informa, no corpo (`orderNumbers: [{ taskId, value }]`), o nº do pedido de cada veículo vivo que ainda não o tem; falta → **400** com a frase de `resolveOrderNumberSubmission`; só preenche vazio. Sai o 403 "só Compras" da sessão do portal (`purchase-order-gate.ts`). A leitura da cerimônia devolve `orderNumber: { required, maxLength, vehicles }` nas duas | nenhuma (a sessão do portal nunca foi a produção) |
| `GET /budgets/:id` e listas | + `valueApproval`, `signatureStatus`, `offlineSignature { at, by{name}, note, file }` quando vigente (DD11), `billable` (valor aprovado ∧ assinatura `SIGNED`/`SIGNED_OFFLINE`/`WAIVED`, DD7), `emission { ready, blockers[] }`, `artworkSummary { total, approved, awaitingCustomer, atAnkaa }` | entram no mapeador **e** no include enumerado (armadilha "include enumerado descarta em silêncio") com teste de contrato (G4) | — |
| `GET /budgets` filtros | + `signatureStatuses[]`, `readyToIssue: boolean` | zod; a lista positiva de estados deriva do enum (G31) | `quoteStatuses` com `PRE_APPROVED` → peneirado (nunca 400: link antigo) |
| `GET …/signature/preflight` (`getDeliveryPreflight`, `signature-envelope.service.ts:471-795`) | + `gates: [{ code, ok, detail }]` | `blockers: string[]` **inalterado** (G27) | — |
| Portal `PUT /cliente/me/orcamentos/:id/pre-aprovar` (`portal-decision.controller.ts:77`, só na branch) | **`PUT /cliente/me/orcamentos/:id/aprovar-valor`** (D-35) | capacidade `APPROVE_VALUE`; IN_NEGOTIATION → APPROVED; escopo `budgetScopeWhere` (404 fora) | nenhuma (nunca foi a produção) |
| Portal `PUT /cliente/me/orcamentos/:id/recusar` `{ motivo }` | igual; destino passa a `PENDING` | motivo obrigatório | — |
| Portal `GET /cliente/me/orcamentos/:id` | + `valueApproval`, `signatureStatus`, `artwork { total, approved, awaitingCustomer, awaitingMe, atAnkaa }`, `emission.blockers` em linguagem de cliente | `select` do portal enumerado (§6.3) | — |

### 5.2 Chaves de corpo, multipart, include, where e filtros

| Contexto | Legado (aceito só na janela) | Novo | Tratamento do legado |
|---|---|---|---|
| Corpo de `POST/PUT /tasks`, `/tasks/batch`, `/tasks/batch-with-quote`, `PUT /tasks/batch` | `truck: { plate, chassisNumber, vinPlateId, category, implementType, spot, left/right/backSideMeasure, *SideMeasureId }` | `implement: { plate, chassisNumber, vinPlateId, type, category, spot, left/right/back/frontSideMeasure, rearDoorLeaves, rearDoorBarCount, rearDoorHatchCount }` (objeto **`.strict()`**) | tradutor único **antes** do zod: `truck`→`implement`, `implementType`→`type`, `*SideMeasureId` **descartados** (nunca foram gravados). **Os dois juntos → 400** "envie só `implement`" |
| Série no corpo da tarefa (DD1, D-32) | `serialNumber` no **topo** de `POST/PUT /tasks`, `POST /tasks/batch`, `PUT /tasks/batch` (`data.serialNumber`), cada item de `POST /tasks/batch-with-quote` e o `/tasks/duplicate` | `implement: { serialNumber }` (dentro do `taskImplementSchema.strict()`, domínio `identity` **além de** `implement`, G7) | **traduzido** para o implemento no mapeador do repositório (W1/W2), nunca descartado com 2xx; topo e `implement.serialNumber` diferentes → **400** "Envie o número de série só em `implement`"; mesma regra e mesma transformação de hoje, aplicadas **só quando a série muda** (V15). Fica até a R-D, ou para sempre se o censo não zerar |
| Remover o implemento | `truck: null` (`schemas/task.ts:2553-2580` é `.nullable()`; hoje **apaga** o caminhão, `task.service.ts:2562-2645`) | `implement: null` | **400** "O implemento não pode ser removido da tarefa; limpe os campos" (antes do gatilho diferido, que daria 500 no COMMIT) |
| Série em `serialNumberFrom/To` | faixa | igual (gera W1) | — |
| Estado na criação do orçamento | `status` no corpo de `POST /budgets`, do bloco `quote` aninhado e de `batch-with-quote` (o app 1.4.1 manda `'PENDING'`, `budget_form_screen.dart:1969`; o web manda em 6 lugares, `09` §6.7) | — (o servidor decide, D-34) | aceito e **ignorado** com log e contador; nunca cria `APPROVED` por aqui (X4) |
| Estado na edição do orçamento | `status` igual ao atual ("pinar"; o app manda em toda gravação, `budget.dart:1227-1231`; o assistente do web também) | — | **como hoje** (DD8): o status fixado mantém `APPROVED` mesmo com o valor editado; sem ele, o auto-revert de hoje devolve a `PENDING` e fecha a aprovação vigente |
| Arte na tarefa | `layoutIds`, `layoutStatuses`, `newLayoutStatuses`, `removeLayoutIds`; multipart `layouts` | endpoints `/implements/:id/layouts/*` | **no-op tolerante**: se o mapa pedido é **igual** à visão legada sintetizada (§5.4), retira a chave e loga. Se **muda** algo → **400** "A arte agora é do implemento: atualize o app". Isso protege o app antigo, que reenvia o conjunto COMPLETO a cada save (`task_edit_screen.dart:678-695`), e impede que o app sobrescreva a aprovação do portal |
| Projeto da tarefa | `projectFileIds`, multipart `projectFiles` | os mesmos (significado novo: PDF cotado) | aceito (o Flutter só lê, V3) |
| Projeto do implemento | — | `PUT /implements/:id/project-files`; multipart `implementProjectFiles` | — |
| Orçamento | `layoutFileIds` em `POST/PUT /budgets` e no bloco `quote` da tarefa; `layouts: [{ fileId, taskIds }]` (layout por veículo, `main`, DD6) | — (a arte vem do implemento, D-14) | **aceitar e ignorar** com `logger.warn` (rota + versão). **Manter** em `QUOTE_SAFE_AFTER_BILLING_FIELDS` (`budget.guards.ts:215`) até R-D, senão toda gravação de orçamento faturado do cliente velho leva 400 |
| Multipart orçamento | `quoteLayoutFile` (≤2; `task.controller.ts:756-757`) | — | **400** "o layout agora é do implemento: use a aba Arte" (engolir o arquivo perderia a arte) |
| Multipart foto de medida | `implementMeasurePhotos.{leftSide,rightSide,backSide}` | + **`implementMeasurePhotos.frontSide`** declarado nos **3** `FileFieldsInterceptor` (create `:143-165` — hoje nem tem fotos —, batch `:285-306`, update `:740-792`) | sem declarar, o multer responde 400 "Unexpected field" |
| Multipart plaqueta | `truckVinPlate` (tarefa e portal `portal-identity.controller.ts:107`) | `implementVinPlate` | aceitar os dois |
| `fileContext` / `entityType` de upload | `truckVinPlate`, `tasksLayouts`, `quote-layouts`, `entityType=truck` | + `implementVinPlate`, `implementLayouts`, `implementProjectFiles`, `entityType=implement` | `truckVinPlate` e `entityType=truck` continuam aceitos; `tasksLayouts` vira alias de `implementLayouts` para imagem; `quote-layouts` → 400 |
| `GET /files/suggestions?fileContext=` (lista FECHADA, `file.controller.ts:313-320`) | `tasksLayouts` | `implementLayouts` | alias (o app usa: `layout_attach_sheet.dart:92-110`) |
| Include/select de Task (e aninhado em budget, customer, airbrushing, bonus, observation, serviceOrder, user, sector, paint, layout) | `truck`, `layouts`, `quote.include.layoutFiles` | `implement` (com `layouts`, `projectFiles`, 4 medidas, `vinPlate`) | `truck` → traduzido para `implement` **e a resposta devolve também `truck`** (cópia com `implementType = type`) quando o pedido veio com `truck`. `layouts` → **sintetizado** (§5.4). `layoutFiles` → **descartado no mapeador em qualquer profundidade** (nunca chega ao Prisma) |
| Where de Task | `truck: {...}`, `layouts: { some/none }`, `hasTruck`, `truckIds`, `truckCategories`, `hasLayouts` | `implement: {...}` (estrito), `implementIdentified` (série ∨ placa ∨ chassi; **não** `hasImplement`, que com a DD1 seria sempre verdadeiro — auditoria §14, pergunta 18), `implementIds`, `implementCategories`, `hasArt`/`artStatus` | `truck`→`implement`; `layouts: {none}`/`{some}` → `implement.layouts` com status `APPROVED` (os widgets "Sem/Com Layouts" do app, `tasks_widget.dart:407-442`); filtros velhos traduzidos |
| `orderBy` | `truck.plate`, `truck.chassisNumber` (`web task-table.tsx:1612-1620`) | `implement.plate`… | traduzido |
| Copy-from (`schemas/task-copy.ts:22-37`) | tokens `implementType`, `category`, `implementMeasures`, `layoutIds`, `projectFileIds` | **mesmos tokens** + `rearDoor`, `implementProjectFiles`. `layoutIds` passa a copiar arte do implemento de origem (novas linhas DRAFT, **nunca** o status) | tokens velhos não mudam de nome (renomear seria 400 no app) |
| Sugestão de orçamento `GET /budgets/suggest?category&implementType` (`budget.controller.ts:105`) | `implementType` | `type` | aceitar os dois |
| Socket de Atenção `entityType` (`schemas/attention.ts:22-38`, `z.enum` fechado) | `TRUCK` | `TRUCK` continua (D-04); se nascer `IMPLEMENT`, aceitar os dois | — |

### 5.3 Schemas zod: regras

1. **Um validador de consulta derivado do DMMF** (G1, §8) para include/select/where/orderBy de **todas** as rotas. Relação conhecida → objeto enumerado `.strict()`. Chave desconhecida → **400 com o nome da chave**, nunca 500 e nunca descarte calado. Substitui: `prismaRelationValue` (`schemas/task.ts:1098-1120`, passthrough), `z.any()` em where (`task.ts:1347`, `truck.ts:209-212`), os `query: any` (`truck.controller.ts:38,213,245`; `implement-measure.controller.ts:77`).
2. Tabela **`DEPRECATED_QUERY_KEYS`** (única, com data de expiração no próprio arquivo): `Task.truck → implement` (traduz), `Task.layouts → sintetiza`, `Budget.layoutFiles → descarta`, `BudgetPayer.responsible → descarta` (o app já pede isso hoje, `budget.dart:1187`), `Budget.task → tasks` (alias existente, `schemas/budget.ts:150-158`). Cada uso incrementa um contador por rota e loga `X-App-Version`.
3. **Corpos estritos:** `taskImplementSchema.strict()` (substitui `taskTruckSchema`, `task.ts:2553-2580`), `implementUpdateSchema.strict()`, `implementMeasureCreate/UpdateSchema` (uma fonte só: `schemas/implement-measure.ts`; apagar a cópia divergente `task.ts:2524-2541`), e o topo do `taskUpdateSchema` **estrito depois do tradutor**, preservando os campos do outbox do app (`_hasFiles`, `_soFileMapping`, `expectedUpdatedAt`: `checkin_outbox.dart:17-60,343`; domínio `meta` em `task.permissions.ts:125`).
4. **Enums de verdade:** `spot` e `spots` com `z.nativeEnum(TRUCK_SPOT)` (hoje `z.string()`, `task.ts:2274,2564`); `category`/`type` com `nativeEnum`; porta traseira `z.nativeEnum(RearDoorLeaves)`, `z.union([z.literal(2),z.literal(3),z.literal(4)])`, `z.number().int().min(0).max(6)`.
5. **Permissão no mesmo commit do zod:** `implement` entra em `TASK_FIELD_DOMAINS` (`task.permissions.ts:51-52`) **junto com** `truck` (na janela). Domínios novos para a arte (`implementLayouts`: DESIGNER, COMMERCIAL, ADMIN) e para o projeto do implemento (`implementProjectFiles`: COMMERCIAL, LOGISTIC, DESIGNER, ADMIN). A DESIGNER não tem o domínio `truck` hoje. **A DESIGNER também não tem `projectFiles`** (`task.permissions.ts:177-185`; o domínio é `projectFiles: ['projectFileIds']`, `:92`): como o PDF cotado passa a ser o projeto da tarefa (D-12), ela **ganha `projectFiles`** no mesmo commit — senão quem produz o PDF cotado toma 400 ao anexá-lo (V3; acrescentado pela auditoria §13). **Série (DD1):** `implement.serialNumber` exige o domínio `identity` **além de** `implement` (hoje os quatro setores com `truck` — FINANCIAL, COMMERCIAL, LOGISTIC, PRODUCTION_MANAGER — também têm `identity`, `task.permissions.ts:130-240`, então não há escalada; o acoplamento fica explícito). Teste G7.
6. **Whitelist no mesmo commit:** `INCLUDE_WHITELIST.Task` (`include-access-control.ts:53-82`) ganha `implement` e **mantém `truck` e `layouts`** na janela. `layouts` passa a ser chave **sintética**, que o G1 conhece e nunca repassa ao Prisma: tirá-la da whitelist daria **403 em toda tela de tarefa do app instalado**. Sai só em R-D; corrigir `SELECT_WHITELIST.Task.truckId` (`:166`, campo inexistente). Um teste cruza whitelist × zod × DMMF (G4).

### 5.4 Compatibilidade com o app instalado e o bundle velho (janela com prazo)

| Mecanismo | Onde | Prazo |
|---|---|---|
| **Cabeçalho de versão**: Flutter `X-App-Version: 1.4.1+24` e `X-App-Patch`; web `X-Client: web@<build>` | `mobile-flutter/lib/core/network/dio_client.dart:160-170`; web `api-client` base | nasce em R-A e fica para sempre |
| **Tradutor único** `translateLegacyImplementKeys(input, kind)` aplicado **antes** do zod (pipe ou `z.preprocess`) em task, budget, customer, airbrushing, bonus, observation, serviceOrder, user, sector, paint e layout | API | até R-D |
| **Espelho de resposta** `ImplementLegacyMirrorInterceptor`: quando o pedido trouxe `truck`, põe `truck = { ...implement, implementType: implement.type }` em cada objeto que tem `implement` (profundidade limitada) | API | até R-D |
| **Contrato do espelho (revisão da Fase A, F9)**: na janela, `truck` e `implement` saem como cópias **profundas e iguais** (mesmos includes aninhados, inclusive as medidas por face); o P11 prova com teste de API deep-equal da resposta. O app mescla os dois (chave de `implement` vence; a que só `truck` trouxe é preenchida), mas isso é o cinto, não a regra | API (P11) + app (`implementJsonOf`) | até R-D |
| **`task.layouts` sintetizado** quando o pedido traz `include.layouts`: artes do implemento (imagem, com `status`; `PENDING_APPROVAL` e `SUPERSEDED` aparecem como `DRAFT` para o cliente velho) + PDFs do projeto da tarefa (como `APPROVED`), no **mesmo formato achatado** de hoje (`task-prisma.repository.ts:810-830`: objeto File-like com `layoutId`/`status`) | API | até R-D (evita "chão de fábrica sem arte e sem PDF no celular") |
| **426 Upgrade Required** com texto "Atualize o app" (o app antigo mostra a mensagem do servidor num toast: `api_exception.dart:68-75,121-160`) para versões `< MIN_APP_VERSION` e para pedidos **sem** cabeçalho | API | liga em R-C |
| Handshake do web: resposta com `X-Min-Web-Build`; o web compara com o próprio build e força reload | web + API | R-B |
| Contador por rota × chave legada × versão (log estruturado) | API | até R-D; desliga quando zerar por 14 dias |
| **Série: coluna-espelho** `Task.serialNumber` (gatilho, M1s). Cobre, sem tradutor, `where.serialNumber` (inclusive `null` e `contains`), `orderBy.serialNumber` com `{sort, nulls}` (a Agenda do app manda **sempre** `orderBy[2].serialNumber`, `task_schedule_view.dart:320-323`), `select: { serialNumber: true }` (whitelist `include-access-control.ts:141-147` e `select` repassado de `budget-prisma.repository.ts:377-393`), `searchingFor` (GIN da tarefa), SQL cru e `task.serialNumber` em **toda** resposta, aninhada ou não. Contrato: sempre **string ou null**, nunca objeto (o `as String?` do app lança `TypeError` com objeto, `task.dart:438`) | API (banco) | R-B → R-D (M5s) |
| **Série: escrita no topo traduzida** para `implement.serialNumber` (§5.2) | API | até R-D, ou permanente se o censo não zerar |
| **Série: leitura tolerante no app** `_serialOf(j) = (j['implement']?['serialNumber'] ?? j['serialNumber'])` em `Task`, `BudgetTaskLite`, `BillingTask` | `mobile-flutter/lib/data/models/task.dart:438`; `lib/features/financial/budget.dart:220`; `billing_task.dart:112` (P02) | para sempre |
| **Orçamento: `blockers: string[]` intocado** no preflight; o estruturado vai em `gates` ao lado (o app só lê string, `envelope_models.dart:781-784`; se `blockers` virar objeto, a lista sai vazia, `blocked=false`, e o POST dá 400) | API | para sempre |
| **Orçamento: `LEGACY_APP`** — aprovação sem nota vinda do app 1.4.1 (`/budget-approve`, `PUT /status {APPROVED}`) aceita com nota automática (D-36); `PUT /status {PENDING, reason}` segue sendo a reprovação | API | até R-C |
| **Orçamento: `status` na criação ignorado** (o app manda `'PENDING'`); `PRE_APPROVED` em filtro peneirado | API | para sempre (é barato) |
| **Terceiro cliente: `AnkaaAero`** (Revisão 3; app nativo iOS 12.5 do iPad da aerografia, `mobile-flutter/AnkaaAero/`, instalado por cabo, **sem OTA**; UA `AnkaaAero/1 CFNetwork/978.0.7`; 345 requisições em 15 dias). Lê `GET /tasks/:id` com `include {layouts{file}, projectFiles, truck{left/rightSideMeasure{sections}}, …}` e `GET /airbrushings[/:id]` com `task.include.truck: true`; decodifica `task.truck`, `task.serialNumber`, `task.layouts`, `task.projectFiles` (`AnkaaAero/AnkaaAero/Networking/APIClient.swift:63-158`, `Models/DomainModels.swift:17-90`) | a janela bilíngue o mantém: `truck` traduzido e espelhado, `layouts` sintetizado, série pelo espelho; entra no censo (G3) e nas fixtures do G4 **como terceiro cliente**; ⚠️ o 426 para "pedido sem cabeçalho" da R-C o **derruba**: antes da R-C ele precisa de build nova com `X-App-Version` (reinstalar por cabo) ou de exceção nomeada por UA | até R-D; build nova antes da R-C |

### 5.5 Erros esperados (o que o cliente vê)

| Situação | Hoje | Depois |
|---|---|---|
| Include com chave que não é relação | 500 (passthrough) ou campo vazio (enumerado) | **400** `Chave de include desconhecida: Task.<chave>` |
| `truck` e `implement` no mesmo corpo | — | **400** `Envie só "implement"` |
| Setor sem domínio mandando `implement` | 400 para todos, menos ADMIN | continua 400, mas o teste G7 pega antes do deploy |
| Foto da frente sem campo multipart declarado | 400 `Unexpected field` | declarado nos 3 interceptors |
| `side` desconhecido na rota de medida | 500 (`{ undefined: id }`) | **400** |
| Cliente velho mudando arte pelo `PUT /tasks` | grava | **400** "A arte agora é do implemento: atualize o app" |
| Aprovar/reprovar arte fora do escopo no portal | — | **404** |
| Reprovar sem motivo | — | **400** |
| Aprovar arte já `APPROVED`/`SUPERSEDED` | — | **409** "Esta arte já foi decidida" |
| Porta traseira fora da faixa | — | **400** (zod) e CHECK no banco como última linha |
| App abaixo da versão mínima | — | **426** |
| Excluir File referenciado | 409 do gatilho | igual (as FKs novas entram sozinhas) |
| Série repetida (tarefa, portal) | 400 "Número de série já está em uso." / 400 com `conflicts[]` (`field: 'serialNumber'`) | igual (checagem no implemento; o `field` do portal continua `'serialNumber'`) |
| Corrida de série (P2002) | 409 genérico "Este valor já está em uso no sistema." (`global-exception.filter.ts:83-107`) | 409 "Este número de série já está em uso." (entrada nova no mapa) |
| `serialNumber` no topo e `implement.serialNumber` diferentes | — | **400** |
| `truck: null` / `implement: null` no `PUT /tasks/:id` | apaga o caminhão | **400** "O implemento não pode ser removido da tarefa; limpe os campos" |
| Série em `PUT /implements/:id` | — | **400** "a série se edita na tarefa" |
| Escrita direta em `Task.serialNumber` por código esquecido | — | **500** com a mensagem do gatilho no log (barulhento de propósito; G19 pega antes) |
| Tarefa criada sem implemento por código esquecido | passa em silêncio | **500** no COMMIT (gatilho diferido; G20 pega antes) |
| Emitir sem valor aprovado / com arte pendente | emite de qualquer estado | **400** com `blockers[]` ("Aprove o valor do orçamento"; "Falta aprovar a arte de: 38174, 38175") e `gates` |
| Aprovar valor em nome do cliente sem nota | — (hoje aprova sem nota) | **400** (salvo `LEGACY_APP` na janela) |
| `PUT /budgets/:id/status { PRE_APPROVED }` | aceito | **400** "estado inexistente: use aprovar valor" |
| Aprovar valor por setor FINANCIAL | aceito em `/status` (X7) | **403** |
| Aprovar valor já aprovado | — | **409** "O valor já está aprovado" |
| Aprovar a cobrança de orçamento não assinado (DD7) | aprova | **400** "A cobrança só pode ser aprovada depois da assinatura do orçamento." (`SIGNED_OFFLINE` e o `WAIVED` do legado passam) |
| "Assinado fora do sistema" sem nota ou sem anexo (DD11) | — | **400** |
| "Assinado fora do sistema" com coleta em andamento ou já assinado (DD11) | — | **409** "Cancele a coleta em andamento antes" / "O orçamento já está assinado" |
| Contato de Compras assinando sem o nº do pedido de algum veículo (DD12) | OTP: 400 com a frase da `main`; portal: 403 "Informe o número do pedido de compra antes de assinar." (só para quem é **só** Compras) | **400** com a frase da `main` nas duas cerimônias, para quem **tem** Compras |

---

## 6. Mudanças por camada

Coluna **Pct** = pacote do §9 que faz a mudança. "Renomear" = trocar `truck`→`implement` / `implementType`→`type` **por AST** (rename do LSP/ts-morph; no Dart, rename do analyzer), **nunca por `sed` global**. O rename de 05/07 corrompeu texto de tela e deixou `ChangeLog.reason = 'ImplementMeasure criado'` gravado no banco (`implement-measure.service.ts:149,174,209,530,619,671`).

### 6.1 API — implemento (modelo, rotas, schemas, escritores e leitores)

**Modelo e tipos**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `prisma/schema.prisma:2530-2562` | `model Truck` | §3.1 (`Implement`, `type`, `category ImplementCategory`, frente, porta, `layouts`, `projectFiles`) | P10 |
| `prisma/schema.prisma:2564-2576` | inversas `trucksBackSide/LeftSide/RightSide` | `implements{Back,Left,Right,Front}Side` (9 literais de string na api: `'trucksLeftSide'`…) | P10 |
| `prisma/schema.prisma:753-833` | `File.layouts Layout?` (764), `truckVinPlates` (768), `quoteLayoutId` (761/774/832), `taskProjectFiles` (797) | `artLayouts Layout[]`, `implementVinPlates`, `implementProjectFiles`; tira `quoteLayoutId` do Prisma | P10 |
| `prisma/schema.prisma:2397,2410,2411` | `Task.truck`, `Task.layouts`, `Task.projectFiles` | `implement`; `layouts` sai; `projectFiles` fica com comentário do significado novo | P10 |
| `prisma/schema.prisma:4297-4317` | `TruckCategory`, `ImplementType` | `ImplementCategory`; `ImplementType` igual | P10 |
| `prisma/schema.prisma:8851-8885` (`PaintingAnalysis.implementMeasureId` SetNull) | remedir apaga a medida velha e desliga a análise em silêncio | o writer único **não apaga** linha apontada por `PaintingAnalysis` (reaponta ou mantém); 0 linhas no clone | P04 |
| `src/types/truck.ts:21-38,44-66,72-86` | `interface Truck`, `TruckIncludes`, `TruckOrderBy` escritos à mão (com `*SideMeasureId` que o zod não aceita) | `types/implement.ts` **derivado** (`Prisma.ImplementGetPayload` / `z.infer`). Apagar `types/truck.ts`: um alias faria o tsc ficar calado | P11 |
| `src/types/implement-measure.ts:5-6,24-41` | `trucks*Side`; não é reexportado em `types/index.ts` | `implements*Side` (+Front); reexportar | P11 |
| `src/types/task.ts:25,78,233,272,338,428,474,544,607,632,748-768,784-787` | `truck?: Truck`, `TruckIncludes`, `quote.include.layoutFiles`, formas parciais `{id,plate,spot}` | `implement`; tirar `layoutFiles` e `layouts` | P11/P12 |
| `src/types/index.ts:51` | reexporta `./truck` | `./implement` | P11 |
| `src/types/garage.ts:7,26,33` | reexporta `TRUCK_SPOT` | igual | — |
| `src/types/dashboard.ts:499-503`, `src/types/summary.ts:345` | `truckMetrics.{totalTrucks,trucksInProduction,trucksByManufacturer,trucksByPosition}`, `currentTrucks` (contrato lido pelos apps) | manter as chaves na janela; nomes novos com espelho | P11 |
| `src/types/paint.ts:16,53,423-428,757` | `TRUCK_MANUFACTURER` | **fora do rename** (montadora da tinta) | — |
| `src/modules/common/prisma/prisma.service.ts:313-316` | `omit: { truck: { chassisNumberNormalized, plateNormalized } }` | a chave segue o nome do model: `implement:` | P11 |

**Rotas, controllers e services**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `src/modules/production/truck/truck.controller.ts:24-261` (todas as rotas; `query: any` em `:38,213,245`; body sem zod em `:146-201`) | `@Controller('trucks')` | módulo `implement/` com `@Controller('implements')` + `TruckAliasController` fino delegando, com `Deprecation` e contador (§5.1) | P11 |
| `truck.service.ts:69-76,186` | `TRUCK_TRACKED_FIELDS` (plate, chassisNumber, vinPlateId, category, implementType, spot) | `type`, + `rearDoorLeaves/BarCount/HatchCount`, `frontSideMeasureId`. Linhas NOVAS de changelog gravam `implement.<campo>`; os leitores aceitam as duas grafias (§6.8). ⚠️ O tracker monta a chave de notificação como `task.field.${field}`: um **mapa explícito** campo→chave (`implement.type` → `task.field.truck.implementType`, `implement.plate` → `task.field.truck.plate`…) evita que a notificação fique muda. G9 confere | P11 |
| `truck.service.ts:90-132` | emite `task.field.changed` com `field: 'truck.<campo>'` | a chave de NOTIFICAÇÃO continua `task.field.truck.<campo>` (D-04); o mapeamento campo→chave fica explícito | P11 |
| `truck.service.ts:134-145,176` | `findMany/update` com `include: query?.include` cru | include pelo validador G1 | P11 |
| `truck.service.ts:164-193` | update + `trackAndLogFieldChanges(ENTITY_TYPE.TRUCK)` | igual (valor `TRUCK` mantido) | P11 |
| `truck.service.ts:213-351` (248-255 comprimento pelas laterais) | disponibilidade de faixa | igual (a frente não entra no comprimento) | P11 |
| `truck.service.ts:357-508` (469 `spot as any`) | `batchUpdateSpots` | zod + `implementId` | P11 |
| `truck.service.ts:544-588` (565) | `dispatchByConfiguration('truck.movement_request', {entityType:'TRUCK'})` | **chave mantida**; texto "Implemento" | P11 |
| `src/modules/production/implement-measure/implement-measure.controller.ts:38-64,66-94,96-115,117-142,144-182,184-194,196-215,217-249,251-284,286-310` | rotas por `truck`; `side` só tipado; mensagens "ImplementMeasure criado…" (`:157,179,191,246,281,307`) | rotas por `implement` + alias; `side` com zod; mensagens "Medidas do implemento salvas" | P11 |
| `implement-measure.service.ts:58,69-71,220-244,246-276` | contagem de uso e `getTrucksUsingImplementMeasure` leem 3 inversas | 4 inversas | P11 |
| `implement-measure.service.ts:100-104,416-425` (`sideFieldMap`) | 3 lados | tipo `ImplementFace` + `FACE_FK: Record<ImplementFace, …>` do writer | P04 |
| `implement-measure.service.ts:128-130,302-304,832-834,937-939` | rótulos Motorista/Sapo/Traseira | + Frente (do mapa único) | P11 |
| `implement-measure.service.ts:343-720,923-1040` | escritor #7 | passa pelo `ImplementMeasureWriter` | P04 |
| `implement-measure.service.ts:451` | foto só com `side === 'back'` | foto também na frente (D-05) | P11 |
| `implement-measure.service.ts:149,174,209,530,619,671` | `reason: 'ImplementMeasure criado'` gravado | texto certo daqui para frente (o gravado fica) | P11 |
| `implement-measure.service.ts:879-884,901-902,1075,1086-1093` | notificação "ImplementMeasure do Caminhão atualizado" | "Medidas do implemento atualizadas"; chave mantida | P11 |
| `implement-measure.service.ts:730-731` | SVG ×100 (metros) | + frente e porta traseira no desenho | P11 |
| `repositories/implement-measure-prisma.repository.ts:13-25` | `query: any` espalhado no `findUnique` | G1 | P11 |
| `…repository.ts:28-83` (`findByTruckId`) | 3 lados | `findByImplementId`, 4 lados | P11 |
| `…repository.ts:85-146` (110-146 edita no lugar, sem copy-on-write) | escritor | writer (D-07: sem compartilhamento, edição no lugar passa a ser segura) | P04 |
| `src/modules/production/task/task.controller.ts:106-131,128,691` | `validateIncludes('Task', …)` só em 2 rotas | G1 em **todas** as rotas de task | P01 |
| `task.controller.ts:143-165,285-306,740-792` | `FileFieldsInterceptor` (create sem fotos de medida; `truckVinPlate` em 156/299/754; fotos 301-303/789-791; `quoteLayoutFile` 756-757; `layouts` 149/292/744) | + `implementMeasurePhotos.{left,right,back,front}Side` nos 3; + `implementVinPlate`; `layouts` só com o tratamento de legado (§5.2); `quoteLayoutFile` → 400 | P11/P12 |
| `task.controller.ts:160-187,760-787` | `airbrushings[i].layouts` | sem mudança (arte da aerografia) | — |
| `task.controller.ts:507-547` (531-545) | `in-preparation`: include padrão `truck{3 medidas}` + `...query.include`; o cliente que manda `truck:true` **apaga** o include aninhado | `implement{4 medidas}`; mesclar em profundidade, não sobrescrever | P11 |
| `task.controller.ts:549-588` (569-576) | `in-production`: where `truck.OR[3 FKs not null]` | `implement.OR[4 FKs]` | P11 |
| `task.controller.ts:590-620` | `position`, `bulk-position`, `swap` (spot) | igual (D-03) | — |
| `task.controller.ts:696-724` | `copy-from` (`taskCopyFromSchema`) | tokens mantidos + novos (§5.2) | P11 |
| `task.controller.ts:202-230,332-346,880-887` | diagnóstico de layouts, bulk arts, rota morta | §5.1 | P12 |
| `src/modules/production/task/task.service.ts:1310-1394` (1312, 1390-1392) | escritor #1 (create) | writer; `(data as any).truck` sai | P04/P11 |
| `task.service.ts:1958-2090` (1993-2008, 2060-2087) | escritor #2 (batch create) | writer | P04 |
| `task.service.ts:2551-3090` (2552, 2569-2605, 2748-2806, 2850-2885, 3016-3031, 3041-3079; changelog em 2766, 2931, 2996) | escritor #3 (update; 540 linhas de medida; copy-on-write próprio) | writer; foto da frente | P04 |
| `task.service.ts:7939-8000` (7986), `8582-8900` (8591, 8607-8735, 8737-8780), `8962` | escritor #4 (batch update; 2ª implementação do copy-on-write) | writer | P04 |
| `task.service.ts:11937-12090` (11978-11990), `11749-11774` (11750-11763), `10822-10955` (10827, 10915-10945, 10919, 10930-10933) | escritor #5 (rollback do changelog: `tx.truck.update({ data: { [changeLog.field]: oldValue } })`) | tabela `LEGACY_FIELD_ALIASES` (`truck.implementType`→`implement.type`, `implementType`→`type`, `truck.*`→`implement.*`) usada pelo rollback; campo sem tradução → **400 com mensagem**, nunca 500 | P11 |
| `task.service.ts:14201-14400` (14213, 14239, 14254-14400, 14293-14325, 14327-14331, 14365, 14394-14400) | escritor #6 (copy-from; cria Truck se faltar) | writer (`cloneFaces`); o ramo "cria se faltar" (`:14213,14239,14365`) vira código morto com a DD1 (o implemento sempre existe): trocar por `update` e **apagar** o ramo, senão fica uma segunda fonte de criação sem `spot` explícito (`10` §5.2) | P04/P11 |
| `task.service.ts:10787-10798` (`validateTask` recusa placa repetida em outra tarefa) | igual | igual (D-01) | — |
| `task.service.ts:10788, 1312, 1993, 2552, 7986, 8591` | `(x as any).truck` | tipado (sem `any`) | P11 |
| `task.service.ts:12266` | "…não possui implementMeasure configurado" | "…não tem medidas do implemento" | P11 |
| `task.service.ts:12475-12510` | `calculateTruckWidth/Length` **mortos** | apagar | P11 |
| `task.service.ts:14570,14922` + `repositories/task-prisma.repository.ts:2591` | `syncTruckSpotWithCleared` (`src/utils/task-truck-spot.ts`) | renomear; semântica igual | P11 |
| `task.service.ts:744` | `client: any` | tipado | P11 |
| `src/modules/production/task/repositories/task-prisma.repository.ts:54-555` | constantes de include `satisfies Prisma.TaskInclude` (bom) | renomear (o tsc aponta) | P11 |
| `task-prisma.repository.ts:810-830` | achata `layouts` em File-like | vira o **sintetizador legado** (§5.4) sobre `implement.layouts` + `projectFiles` | P12 |
| `task-prisma.repository.ts:1060-1074` (1065-1066 `spot: null`), `1452-1497` | cria/atualiza truck aninhado (`upsert`); cria **só `if (truck)`** | `implement`; **criar SEMPRE** (DD1, W1): `implement: { create: { …, serialNumber, spot } }` com `spot` explícito (`null` salvo quando o corpo traz vaga), **mesmo sem nenhum campo** — a armadilha A13 do web ("`implement: {}` vazio cria veículo com spot nulo") deixa de ser defeito e vira a regra. Na atualização (W2), `implement: { update: {…} }`; o `create` do `upsert` fica inalcançável | P11 |
| `src/modules/production/task/task.permissions.ts:30-44,51-52,57-62,64,78,92,125,146-357,354,395-457,403` | domínio `truck: ['truck']`, `layouts`, `layoutRemoval`, `projectFiles`; campo fora do mapa = 400 para todos menos ADMIN | §5.3 item 5 | P11 |
| `src/modules/production/task/task-field-tracker.service.ts:80-101,537` | rótulos `truck.*` (Motorista/Sapo/Traseira) | + frente, porta; duas grafias | P11 |
| `src/modules/production/task/task.listener.ts:257-285` (274-276 "Medidas do Caminhão atualizadas") | emite `task.field.truck.*` | chave igual; texto "Implemento" | P11 |
| `src/modules/common/notification/task-notification.service.ts:77-86` (86 "ImplementMeasure do Caminhão") | rótulos | corrigir | P11 |
| `src/modules/common/notification/notification-dispatch.service.ts:1723-1726` | chave sem config → `warn` e retorna (notificação muda) | G9 impede chave emitida sem linha | P01 |
| `notification-dispatch.service.ts:2633-2635` | traduz valor por nome de campo | + `type`, porta | P11 |
| `src/modules/production/layout-dimensions/layout-dimensions.controller.ts:52-73` (62-70 `truckId` obrigatório) | cotador | `implementId` + alias `truckId` | P11 |
| `layout-dimensions.service.ts:131-135,139-173` (`panelsForTruck`: MOTORISTA/SAPO/TRASEIRA; "é a ORDEM, não a geometria, que diz qual é qual"), `:175-180` (lê por `fileId`) | 3 faces | + `FRENTE`. ⚠️ Uma 4ª página muda a heurística por ordem: validar com o bench do cotador (`scripts/check-layout-dimensions.ts`). Aceitar só `fileId` que esteja em `Task.projectFiles` | P11 |

**Schemas zod**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `src/schemas/truck.ts:21-86` | `truckIncludeSchema` enumerado **não** strict | `schemas/implement.ts`, gerado do DMMF, estrito | P11 |
| `truck.ts:92-121` | `truckOrderBySchema` (sem `*SideMeasureId`; o tipo tem) | derivar o tipo do zod | P11 |
| `truck.ts:128-134` | `truckCategorySchema` etc. (duplicados em `task.ts:2544-2550`) | fonte única | P11 |
| `truck.ts:136-215` (209-212 `z.any()`) | `truckWhereSchema` | where aninhado estrito | P11 |
| `truck.ts:221-382` (255-257 `hasTask:false` → `taskId: null`, filtro impossível; 298-300 `inPatio` → `spot:null`, que na verdade significa "fora das instalações") | `truckTransform` | apagar os filtros mortos ou corrigir a semântica (pátio = `YARD_WAIT/YARD_EXIT`, `task-truck-spot.ts:16-18`) | P11 |
| `truck.ts:388-483` | `truckGetManySchema` **não plugado** | plugar em `GET /implements` | P11 |
| `truck.ts:490-529` (505-528 "ImplementMeasure inválido") | create/update aceitam `taskId`, `*SideMeasureId` que o service não grava (some com 200) | estrito, só o gravável; mensagens corrigidas | P11 |
| `truck.ts:535-568,593-604,611-634` | batch/get sem rota; `mapTruckToFormData`; `truckBulkSpotUpdateSchema` não plugado | apagar o que não tem rota; plugar spots | P11 |
| `src/schemas/task.ts:74-632` (truck em 453-560) | `taskSelectSchema.truck.select` (só `select`; internos não strict) | G1 | P01/P11 |
| `task.ts:634-1094` | `taskSelectMinimal/Table/Detail/Form/Preparation/Schedule/History` **mortos** | **apagar** | P01 |
| `task.ts:1098-1120` | `prismaRelationValue` passthrough | G1 | P01 |
| `task.ts:1122-1152` (1141 `truck`; 1143-1144 `cutRequest/cutPlan` que **não são relações de Task**; falta `cuts`) | `taskIncludeSchema` | G1 (os fantasmas somem) | P01 |
| `task.ts:1158-1219` | `taskOrderByFieldsSchema` | + `implement: { plate, category }` se a lista precisar | P11 |
| `task.ts:1240-1388` (1319 `layouts`, 1335 `bonifications` — a relação real é `bonuses`, 1347 `truck: z.any()`, 1369-1370 `cutRequest/cutPlan`, 1387 `.strict()`) | `taskWhereSchema` | G1; `implement` estrito; `layouts`→tradução (§5.2) | P01/P11 |
| `task.ts:1431-1433,1488-1508,1939-1974,2236,2271-2276` | busca por `truck.plateNormalized`; `hasTruck`; `hasLayouts`; `truckIds`; `spots` (`z.string()`); `truckCategories`; `implementTypes` | `implementIdentified` (no lugar de `hasTruck`; ver §6.13 "semântica" e pergunta 18 — `hasImplement` seria sempre verdadeiro com a DD1), `hasArt`, `implementIds`, `spots` com enum, `implementCategories`; `implementTypes` fica | P11 |
| `task.ts:2524-2541` | `implementMeasureSection/SideSchema` **divergente** de `schemas/implement-measure.ts` (sem máx de 20 m, sem refine porta⇒altura, sem mín de 1 seção) | importar de `implement-measure.ts` | P04 |
| `task.ts:2544-2550` | enums duplicados | fonte única | P11 |
| `task.ts:2553-2580` | `taskTruckSchema` (`spot: z.string()`, `*SideMeasureId` aceitos e ignorados, não strict) | `taskImplementSchema.strict()` | P11 |
| `task.ts:2691-2699,2955-3003` (2697, 2991, 3000) | `layoutIds`, `layoutStatuses` (record fileId→status, pré-processamento FormData), `newLayoutStatuses` | tratamento legado (§5.2), depois saem | P12 |
| `task.ts:2710,3013,2757-2760` | `truck: taskTruckSchema` em create/update; superRefine lê `data.truck?.plate` | `implement`, lendo do objeto traduzido | P11 |
| `task.ts:3212-3256,3262-3289` | `mapTaskToFormData`; `taskPosition*Schema` | sem mudança | — |
| `src/schemas/implement-measure.ts:9-30,47-75` | seção (≤20 m, porta⇒altura) e create/update (≤10 m, 1..10 seções), não strict | fonte única, strict | P04 |
| `src/schemas/task-copy.ts:22-37,153` | tokens | §5.2 | P11 |
| `src/schemas/airbrushing.ts:60-81` | `task.include.truck` com 3 medidas (coluna "Medidas") | `implement` + frente | P11 |
| `src/schemas/customer.ts:30-40` (39 `truck`; **fantasmas** `budget`, `nfe`, `files`, `airbrushing` em `tasks.include` → 500) | | G1 remove os fantasmas | P01 |
| `src/schemas/budget.ts:137`, `serviceOrder.ts:37`, `user.ts:676`, `layout.ts:65`, `observation.ts:66`, `bonus.ts:56`, `sector.ts:76`, `paint.ts:589,617` | `task.include.truck: z.boolean()` | `implement` (+ alias) | P11 |
| `src/schemas/file.ts:17,210,457-520` | aceita `tasksLayouts`, **que não é campo de File**; filtro órfão `{ tasksLayouts: { none: {} } }` | G1; `artLayouts` | P01 |
| `src/schemas/attention.ts:22-38` | `ATTENTION_ENTITY_TYPES` inclui `'TRUCK'` | mantém | — |
| `src/schemas/dashboard.ts:65` | `includeTrucks` | alias `includeImplements` | P11 |
| `src/modules/common/base/include-access-control.ts:53-82,137-201,262-285,305-319,326-341` | whitelist (403), `truckId` fantasma (166), singularização heurística, "allow all" para entidade sem whitelist | §5.3 item 6; `Implement` com whitelist própria | P01/P11 |
| `src/modules/common/base/include-mapper.helper.ts:43-60` | `fieldMappings` (mecanismo de alias pronto) | usar para `truck`→`implement` | P11 |
| `src/modules/common/pipes/zod-validation.pipe.ts:243` | rótulo `truck: 'Caminhão'` | `implement: 'Implemento'` + `truck` | P11 |
| `src/modules/common/pipes/array-fix.pipe.ts:36-60` | parse de qualquer chave JSON no FormData | sem mudança | — |
| `src/common/filters/global-exception.filter.ts:251-259` | `PrismaClientValidationError`→400, mas os serviços embrulham em `InternalServerErrorException` (11× em `task.service.ts`) | parar de embrulhar erro de validação do Prisma | P01 |

**Constantes e rótulos**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `src/constants/enums.ts:1223-1310` | espelho TS de `TRUCK_SPOT`, `TRUCK_MANUFACTURER`, `TRUCK_CATEGORY`, `IMPLEMENT_TYPE` | derivar de `$Enums`; `IMPLEMENT_CATEGORY` (+ alias `TRUCK_CATEGORY` na janela); `REAR_DOOR_LEAVES`; `LAYOUT_STATUS` com os 5 | P11 |
| `src/constants/enums.ts:1358,1400,2020,2069` | `ENTITY_TYPE.TRUCK/IMPLEMENT_MEASURE`, `CHANGE_LOG_ENTITY_TYPE.*` | mantém | — |
| `src/constants/enum-labels.ts:393-404,406-413,415-448,1112,1154,1541,1584` | `TRUCK_CATEGORY_LABELS`, `IMPLEMENT_TYPE_LABELS` (INSULATED 'Isoplastic', FLATBED 'Carroceria'), `TRUCK_SPOT_LABELS`, 'Medidas do Implemento', 'Caminhão' | `IMPLEMENT_CATEGORY_LABELS`, perfis "tela" e "nota" (D-18); 'Caminhão'→'Implemento'; `LAYOUT_STATUS_LABELS` com 5; `REAR_DOOR_LEAVES_LABELS` | P05 |
| **4 dicionários fiscais**: `src/modules/integrations/nfse/elotech-oxy-nfse.service.ts:1295-1316`; `src/modules/financial/invoice/invoice-generation.service.ts:1399-1425`; `src/modules/integrations/sicredi/sicredi-boleto.scheduler.ts:1002-1028`; `src/modules/integrations/nfse/painter/dps.builder.ts:22,514-520` (usa os rótulos da **tela**) | 2 versões | uma constante `IMPLEMENT_*_FISCAL_LABELS` usada pelos 4 + teste de exaustividade | P05 |
| `src/constants/sortOrders.ts:665-672,945,993,1008` | ordens | `TRUCK` fica | — |
| `src/constants/routes.ts:510-516` | rotas web `/producao/caminhoes/*` | espelho das rotas do web | P11 |
| `src/constants/garage.ts`, `src/utils/garage-layout.ts` (sem importador na API) | vocabulário do pátio | manter; `garage-layout.ts` é morto na API | — |

**Leitores de `truck` (atualização mecânica, mas todos precisam estar na lista)**

| Área | Arquivo:linhas | Pct |
|---|---|---|
| Atenção (API) | `src/modules/common/attention/attention.service.ts:284-289,436-448` (`NO_CHASSIS`, `NO_PLATE`, `NO_VIN_PLATE_PHOTO` com `truck: null`/`truck.*`) — regras novas "sem medida da frente" e "porta traseira não informada" ficam **fora** desta entrega (ideia registrada; não foram pedidas) | P11 |
| NFS-e da tarefa | `src/modules/integrations/nfse/nfse-emission.scheduler.ts:365-370,426-431,503-531,614-638,673,788-793,846-851,908-1046`; `elotech-oxy-nfse.service.ts:39-62,1436-1439,1583` | P11 |
| NFS-e do pintor | `nfse/painter/dps.builder.ts:455-532` (522-524: "a série é da OS"); `nfse/painter/painter-nfse.service.ts:480-485` | P11 |
| Boleto | `src/modules/integrations/sicredi/sicredi-boleto.scheduler.ts:321,366,799-935` (811-823: `truck.plate` entra no `seuNumero`; 910 `task: any`) | P11 |
| Fatura | `src/modules/financial/invoice/invoice-generation.service.ts:953,1002,1197-1328` (1302-1303 `const task: any`) | P11 |
| Faturamento | `src/modules/financial/billing/billing.service.ts:141,158,243,355,704-705` | P11 |
| Conciliação | `src/modules/financial/reconciliation/receivable-task-match.service.ts:193-194,342,442` | P11 |
| Pedido de compra | `src/modules/production/purchase-order/purchase-order.service.ts:127,160-164,236` (`plate contains` sem normalizar), `590-605` | P11 |
| Bônus | `src/modules/personnel-department/bonus/bonus.service.ts:827,1096,1424,2906,3573-3586,3719` (repassa `task.truck` na resposta: contrato do app) | P11 |
| Dashboard | `src/modules/domain/dashboard/dashboard.service.ts:328-359,1286-1300,1425-1430`; `repositories/dashboard/dashboard-prisma.repository.ts:1759,1827,1936-1949,2279-2412,3415-3683` (`prisma.truck.findMany/count`) | P11 |
| Estatística | `src/modules/production/task/task-analytics.service.ts:384-430` | P11 |
| Busca global | `src/modules/domain/search/search.service.ts:213-214,244,267,271,289` | P11 |
| Pessoal | `src/modules/people/personal/personal.service.ts:871` | P11 |
| Tinta (produção) | `src/modules/paint/paint-production.service.ts:882,898` | P11 |
| **Tinta (busca, SQL cru)** | `src/modules/paint/paint.service.ts:503-517` (`LEFT JOIN "Truck" tr1/tr2`), `523-527` (`catch` devolve `[]`: falha **silenciosa para o usuário**). Trocar para `"Implement"` **no mesmo commit de M1** + teste de busca por placa. (Correção da auditoria §13: o `catch` **já** loga com `logger.error` em `:525`; o defeito é devolver `[]` como se não houvesse resultado. Com `relation "Truck" does not exist` o erro deve subir, não virar lista vazia) | P11 |
| Recibo/sugestão de orçamento | `src/modules/production/budget/budget-receipt.service.ts:49,89-100`; `budget.service.ts:5439,5661` ("mesmo nome, cliente, categoria e tipo"); `budget.controller.ts:105` | P11 |
| Aerografia | `src/modules/production/airbrushing/airbrushing.service.ts:366,1000-1045,1855-1980` (1878 `findUnique({where:{fileId}})`) | P12 |
| Utilitários | `src/utils/task.ts:194` (`(task as any).truck?.plate`), `367-455` (`getTaskDimensions/formatTaskMeasures/generateBaseFileName`, `task: any`: o nome do arquivo base perde as medidas em silêncio); `src/utils/quote-tasks.ts:387-404,643`; `src/utils/task-truck-spot.ts` | P11 |
| Changelog | `src/utils/changelog-fields.ts:238-263,630,748-765,1069-1089`; `src/modules/common/changelog/utils/changelog-helpers.ts:376-391,795` | P11 (duas grafias) |

### 6.2 API — layout (arte), orçamento e assinatura (R1, R2, R6)

**Arte na tarefa → arte no implemento**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `src/modules/production/task/task.service.ts:213-216` (`canApproveLayouts`: COMMERCIAL, ADMIN) | aprova arte na tarefa | vira a permissão de "aprovar em nome do cliente" do serviço novo `ImplementLayoutService` | P12 |
| `task.service.ts:878-1047` (`convertFileIdsToLayoutIds`; 903 `findUnique({where:{fileId}})`; 960-968 e 995-999 rebaixam ou ignoram em silêncio; 1004 "affects all connected tasks"; 1015-1033 emite `artwork.approved/reproved`) | arte global por arquivo | **sai da tarefa**. `ImplementLayoutService` com `upload`, `send`, `approveOnBehalf`, `reprove`, `newVersion`, `approveFromPortal`, `reproveFromPortal`, cada uma gravando `LayoutDecision` e carimbando `fileSha256` | P12 |
| `task.service.ts:1049-1085` (`createLayoutForFile`; 1061) | status passado pelo chamador | `ImplementLayoutService.upload` (sempre `DRAFT`) | P12 |
| `task.service.ts:5445-5490` | arte da aerografia pelo formulário da tarefa | sem mudança | — |
| `task.service.ts:11418-11440` (rollback `layoutIds → layouts`) | reescreve o M2M | changelog antigo com campo `layouts`: **recusar o desfazer com mensagem** (a relação não existe mais) | P12 |
| `task.service.ts:12519` (`POST /tasks/bulk/arts`) | lote de artes na tarefa | `POST /implements/layouts/bulk` | P12 |
| `task.service.ts:13161-13260` (`bulkUploadFiles`; 13244-13251 cria Layout **`APPROVED` direto**) | aprovação sem aprovador | **apagar** (correção da auditoria §13): a rota `POST /tasks/bulk/upload-files` (`task.controller.ts:413`) não tem chamador no web nem no app, e o schema dela (`schemas/task-bulk.ts:79`, `fileType: 'layouts'`) morre junto (§6.11) | P12 |
| `task.service.ts:14021-14035,14054` (copy `layoutIds` → `set` da MESMA linha compartilhada) | cópia compartilha o status | cria linhas **novas** `DRAFT` no implemento destino | P12 |
| `src/modules/production/task/layout.events.ts:1-35` (6-23: ator `User`) | `LayoutApprovedEvent(layout, task, approvedBy: User)` | ator **discriminado** `{ kind: 'USER' \| 'RESPONSIBLE', id, name }` + `implementId`. ⚠️ Nunca gravar id de `Responsible` em FK de `User` (o GOTCHA do `@UserId()` de 17/09) | P12 |
| `src/modules/production/task/layout.listener.ts:54-61,74-118,93,146,201` | `artwork.approved`, `artwork.reproved`, `artwork.pending_approval_reminder` (só funcionário; passa `approvedBy.id` como `userId`) | ramo por tipo de ator; chaves mantidas; nova chave `layout.portal_pending_approval` para o contato (seed) | P12 |
| `src/modules/production/task/task-notification.scheduler.ts:513-560` (523-548 lê `layout.tasks`) | lembrete diário: `DRAFT` > 24 h → COMMERCIAL/ADMIN | `PENDING_APPROVAL` > 24 h → contato (`PortalNotificationService.responsibleRecipient`) + interno; lê `implement.task` | P12 |
| `src/modules/common/notification/templates/notification-template.service.ts:101-127,355-366` | `task.layout.added/updated/removed`, `service-order.layout-waiting-approval` | textos "arte do implemento" | P12 |
| `src/modules/production/service-order/service-order.permissions.ts:37-39,100-104,211`; `service-order.service.ts:700-720,728-750,1675-1684` | O.S. de ARTE: Designer → `WAITING_APPROVE` → Admin → `COMPLETED` | D-15/DD3 (corrigido pela auditoria §14; o texto anterior punha o portão em cada O.S., que é o que a DD3 descartou): **nenhuma O.S. de ARTE ganha portão próprio** — "Concluir" continua livre. A aprovação da arte (portal ou em nome do cliente) conclui a O.S. "Aprovar com o Cliente" aberta (achada por descrição normalizada) **e** a O.S. de ARTE que estiver em `WAITING_APPROVE` na tarefa (DD3, Revisão 3; produção: 12 em `WAITING_APPROVE`, 6 em tarefas vivas); a reprovação devolve essas O.S. a `IN_PROGRESS` | P12 |
| `src/utils/task-service-order-sync.ts:118-151` (`calculateCorrectTaskStatus`), `:365-700` (`getTaskUpdateForServiceOrderStatusChange`; comentário `:614-618`) | PREPARATION→WAITING_PRODUCTION com O.S. de ARTE concluída; funções **puras**, recebem só a lista de O.S. | **muda** (auditoria §14; o texto dizia "sem mudança de código"): parâmetro novo `artworkGate` (`'OK'` = implemento com arte `APPROVED` — sem dispensa, DD9; `'PENDING'`; `'NOT_APPLICABLE'` = trabalho antigo, primeira O.S. de ARTE criada antes da R-B). A liberação **manual** "Disponibilizar para produção" (`task.service.ts` e `service-order.service.ts`, hoje "bypasses it") também recebe o argumento e respeita `'PENDING'` (DD10, confirmada na Revisão 3.1). Com `'PENDING'`, a ida automática a WAITING_PRODUCTION não acontece; a volta a PREPARATION continua igual. Os 6 chamadores montam o argumento: `task.service.ts:4528,4829`; `service-order.service.ts:1279,1432,3284,3441`. Teste de tabela das duas funções com os três valores | P12 |
| `src/modules/production/airbrushing/airbrushing.service.ts:1878` (`findUnique({where:{fileId}})`), `src/modules/common/file/file.service.ts:267`, `src/modules/common/file/services/file-migration.service.ts:101`, `file-organization-scheduler.service.ts:287` | buscam Layout por `fileId` único | `findFirst` com dono (`airbrushingId` ou `implementId`). O tsc aponta cada um, porque `fileId` deixa de ser único. ⚠️ O tsc **não** aponta `airbrushing.service.ts:1040`: `tx.layout.deleteMany({ where: { fileId } })` na exclusão da aerografia continua válido e, depois do fan-out, **apaga também a arte de implementos** que usem o mesmo File. Restringir a `{ fileId, airbrushingId }` (acrescentado pela auditoria §13) | P12 |

**R1 — o orçamento perde o "layout aprovado"** (tudo que existe só para ele)

| # | Arquivo:linha | Hoje | Destino | Pct |
|---|---|---|---|---|
| 1 | `prisma/schema.prisma:761,774,832,1983` | `File.quoteLayoutId` + relação `QUOTE_LAYOUT` | sai do Prisma em R-B; a coluna cai em M4 | P10 |
| 2 | `prisma/migrations/20260804180000_file_referenced_delete_guard/migration.sql:43-48` | a função cita `"quoteLayoutId"` | `CREATE OR REPLACE` em M4, **antes** do `DROP COLUMN` | P32 |
| 3 | `src/modules/common/file/services/file-reference.service.ts:11-22,41-55` (`OUTBOUND_REFERENCES = [{column:'quoteLayoutId'…}]`), `:318-321` (`select` montado da constante), `:75` (`'Layout.fileId'`), `:86` (`'_TASK_PROJECT_FILES.A'` rotulado "projeto de tarefa"), `:102-107` (`'ImplementMeasure.photoId'`, `'Truck.vinPlateId'`) | espelho TS das referências | tirar a entrada de saída **no mesmo deploy em que o Prisma deixa de declarar a coluna**, com guarda para lista vazia (Prisma recusa `select: {}`). Senão `getReferences` lança erro, **toda exclusão de arquivo falha fechada** (`file.service.ts:1447`) e o organizador para. Chaves: `'Implement.vinPlateId'`, `'_IMPLEMENT_PROJECT_FILES.A'` (contexto `implementProjectFiles`), `'Layout.fileId'` com contexto por dono, `'LayoutDecision'` não referencia File | P12 |
| 4 | `src/modules/common/file/file.service.ts:484-528` (`cloneFileForQuoteLayout`), `553-591` (`resolveLayoutFileIdsForQuote`) | clona arquivo para o orçamento | `resolve…` sai. `clone…` é **renomeado** (`cloneFileBytes`), não apagado: `task.service.ts:13394` o usa para clonar a foto de medida na cópia de tarefa | P12 |
| 5 | `src/modules/common/file/services/file-organization-scheduler.service.ts:44-66` (`CONTEXT_ENTITY_MAP`: `quote-layouts`, `taskProjectFiles`, `truckVinPlate`), `127-184` (regex de caminho), `282-340` (314-337 `quote-layouts`; `layout.tasks[0].customer`, `quoteLayout.tasks[0].customer`), `409-416` (`truck.task.customer`), `704-720` | resolve cliente e pasta | `implementLayouts`, `implementProjectFiles`, `implementVinPlate` com caminho implemento→tarefa→cliente. Sem o caminho, o arquivo cai em `Clientes/Outros/` | P12 |
| 6 | `src/modules/common/file/services/file-migration.service.ts:92-119,219-242`; `files-storage.service.ts:19-76` (74-76), `126-207` (137 `taskProjectFiles: 'Projetos'`), `205-207`, `278-302`, `381-490` (462-487, 464), `756-771` (`truck: ['truckVinPlate']`) | pastas por contexto | `quote-layouts` morre (400); `implementLayouts` → `Layouts/Imagens`; `implementProjectFiles` → `Projetos`; `implementMeasurePhotos` "Traseiras" também recebe a frente (a pasta **não** é renomeada: D-24, DD5); `entityType: implement` com os contextos | P12 |
| 7 | `src/modules/common/file/file.controller.ts:113-119` (400 para contexto desconhecido), `313-320` (lista fechada das sugestões) | | contextos novos + aliases (§5.2) | P12 |
| 8 | `src/utils/sync-quote-task-layouts.ts` (482 linhas; `(prisma as any)` em 58-185 e 243-461; engole erro dentro de `tx` em 106-111, 352-357, 475-480) | orçamento → galeria da tarefa | **apagar inteiro** e os imports (`budget.service.ts:75-77`, `task.service.ts:66`, `task-prisma.repository.ts:37`) | P12 |
| 9 | `src/modules/production/budget/budget.service.ts:530-541,575` (create: clona e conecta `layoutFileIds`) | | sai | P12 |
| 10 | `budget.service.ts:709-716,1604-1617` | sync + reprovação autoritativa | sai | P12 |
| 11 | `budget.service.ts:824,2191,5805` | `include layoutFiles` em releituras | sai | P12 |
| 12 | `budget.service.ts:1038-1063` (`filterToMaterialChanges`) | compara `layoutFileIds` | sai o ramo; a chave fica em `NON_QUOTE_UPDATE_KEYS` (aceita e ignorada) | P12 |
| 13 | `budget.service.ts:1156-1159,1494-1510,1558` | update: captura, `set`, relê | sai | P12 |
| 14 | `budget.service.ts:1569-1597` (1573, 1577 `(existing as any).layoutFiles`) | `layoutFileIds` no changelog do orçamento | sai de `fieldsToTrack`; o rótulo histórico fica (`changelog-fields.ts:781`) | P12 |
| 15 | `budget.service.ts:2330,2355` + `src/utils/budget-merge-rules.ts:71,323-333` | união de orçamentos: aviso `LAYOUT` "o layout aprovado do nº X prevalece" | sai; atualizar `tests/quote-merge-rules.test.ts` | P12 |
| 16 | `budget.service.ts:2627,2667` (delete: `layoutFileIds` no snapshot de rollback) | | sai do snapshot novo; o restaurador **ignora** a chave em changelog antigo | P12 |
| 17 | `budget.service.ts:3558-3563` (comentário), **`3640-3649`** (`budgetApprove`: "Selecione um layout aprovado antes de aprovar o orçamento.") | portão | **sai**. `budgetApprove` vira o caminho único de "aprovar valor" (D-27, §2A.5): exige origem REQUESTED/PENDING/IN_NEGOTIATION (ou coleta **legada** concluída), grava `BudgetValueApproval`; a exigência de arte mora só na **emissão** (E2), nunca na conclusão (senão volta o nº 591) | P12/P14 |
| 18 | `budget.service.ts:3580-3638` (`markInvalidatedBySignature` devolve o orçamento a PENDING) | | **muda** (§2A.4): coleta nova invalidada só move o eixo (`signatureStatus = INVALIDATED`) e **não** toca `Budget.status` (o valor segue APPROVED, salvo se o próprio valor mudou sem status fixado, e aí o auto-revert de hoje já o levou a PENDING, DD8); coleta legada sobre `PENDING` segue igual | P14 |
| 19 | `budget.service.ts:5511-5514` (`findPublic` devolve `layoutFiles`, num `select` **explícito**) | página pública | **troca de fonte, não sai** (DD2; corrigido pela auditoria §14 — "sai" era resíduo do v1, que tirava a arte do documento): `findPublic` passa a devolver `artwork: [{ taskId, fileId, filename, originalName, mimetype, size }]` de `quoteArtworkOf` (a mesma do documento assinado), e a chave nova entra **no `select`** (armadilha "select explícito descarta chave nova"); `layoutFiles` sai no mesmo deploy do web (§6.5 itens 36–37) | P12 |
| 20 | `src/modules/production/budget/budget.guards.ts:215` (`QUOTE_SAFE_AFTER_BILLING_FIELDS` com `layoutFileIds`) | trava do dinheiro | **manter** até R-D | P32 |
| 21 | `src/modules/production/budget/repositories/budget-prisma.repository.ts:248-256,330-340` (`connect`/`set`), `396-397` (`mapIncludeToDatabaseInclude` repassa `layoutFiles`), `656` (include padrão) | | sai; o mapeador **descarta** `layoutFiles` em qualquer profundidade | P12 |
| 22 | `src/schemas/budget.ts:122-136` (`tasks.include.layouts`), `137` (`truck`), `150-158` (alias `task`), `160` (`layoutFiles`), `935-936,1008-1009,1176-1177` (`layoutFileIds .max(2)`), `1109` | | `layouts`→`implement.layouts`; `layoutFiles` aceito e descartado; `layoutFileIds` aceito e ignorado com log | P12 |
| 23 | `src/types/budget.ts:74,145`; `src/types/task.ts:748-768` (`quote.include.layoutFiles`); `src/types/file.ts:37` | tipos que "convidam" a pedir relação morta | remover no mesmo commit | P12 |
| 24 | **`src/modules/production/task/repositories/task-prisma.repository.ts:254`** (include PADRÃO da tarefa pede `quote.layoutFiles`) | | **sai, senão TODA leitura de tarefa dá 500** | P12 |
| 25 | `task-prisma.repository.ts:1873-1905,2001-2004` (create), `2232,2312-2362,2354,2461-2469,2580-2584` (update) | orçamento aninhado com `layoutFileIds` + sync (variável chamada `resolvedImplementMeasureIds`: resto do rename de julho) | sai | P12 |
| 26 | `task.service.ts:2378,3455-3490` + `task.controller.ts:756-757` | multipart `quoteLayoutFile` → `quote.layoutFileIds` | 400 explicativo | P12 |
| 26b | (DD6, Revisão 3 — veio da `main` no P00) `src/utils/quote-layout-coverage.ts` (`pruneQuoteLayoutCoverage`, `withLayoutCoverageInclude`, `layoutGateFailure`, `describeVehicleList`, `vehicleLabel`), `budget.service.ts` (corpo `layouts: [{ fileId, taskIds }]` e `layoutScope`), `budget-prisma.repository.ts` (`quoteLayoutTasks`), `src/utils/sync-quote-task-layouts.ts` (reescrito pela `main` para `PER_VEHICLE`), `schemas/budget.ts` (`layoutFiles` aceita objeto) | cobertura do layout do orçamento por veículo | os **escritores** saem com o R1 (a chave `layouts` do corpo é aceita e ignorada com log na janela, como `layoutFileIds`); **ficam** `describeVehicleList`/`vehicleLabel` e `layoutGateFailure` reescrito sobre a arte do implemento (mensagem do E2); `BudgetLayoutTask` passa a ser só **lido** (M3 passo 5 e o flag do builder) até a M4 | P12 |
| 27 | `task.service.ts:6520-6590` | troca de orçamento grava `layoutFileIds` antigo/novo no changelog | sai | P12 |
| 28 | `task.service.ts:11646-11662,11700-11705` | rollback recria `layoutFiles` + sync | ignora a chave antiga com mensagem | P12 |
| 29 | `task.service.ts:13350-13430` | copiar orçamento de outra tarefa clona `layoutFiles` | sai | P12 |
| 30 | `task.service.ts:14603` | sync após vincular | sai | P12 |
| 31 | `task.service.ts:10966-10991` | `TASK_QUOTE` com `layoutFileIds` entre os campos reversíveis | tira da lista (desfazer recusa com mensagem) | P12 |
| 32 | `src/modules/production/budget/budget.module.ts:82-84,88-90,109-120` | ganchos: assinatura concluída → aprova; grupo 0 completo → `markSigned`; comentário do caso nº 973 | conclusão de coleta **legada** (orçamento em PENDING) → `budgetApprove` sem portão de layout + `BudgetValueApproval{SIGNATURE}`; coleta **nova** (orçamento já APPROVED) → só o eixo (`SIGNED`); `markSigned` → eixo `AWAITING_ANKAA`, nunca mais `Budget.status = SIGNED` | P14 |

**Assinatura (o ponto mais delicado; Revisão 2: a arte CONTINUA no documento e no hash, D-14)**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `src/modules/common/signature/services/signature-envelope.service.ts:561,626-631` (preflight) e **`1077-1108`** (emissão, 1103) | "Selecione um layout aprovado antes de enviar o orçamento para assinatura." (`Budget.layoutFiles` vazio) | **trocado** pelo `assertEmissionReady` (D-29): E1 valor aprovado + E2 arte `APPROVED` em **cada** implemento (sem dispensa, DD9); o preflight ganha `gates` e mantém `blockers: string[]` | P14 |
| `signature-envelope.service.ts:471-795` (preflight), `907-1117` (`createEnvelope`), **`1441-1461`** (checagem dentro da transação) | portões repetidos em três lugares | os três chamam `assertEmissionReady(quoteId, tx?)` | P14 |
| `signature-envelope.service.ts:1508-1570` (força `PENDING` de qualquer estado ≠ PENDING/CANCELLED, inclusive de APPROVED faturado: X1) | a emissão escreve `Budget.status` | **sai**: a emissão escreve **só** `Budget.signatureStatus = AWAITING_CUSTOMER`, na mesma transação do envelope | P14 |
| `signature-envelope.service.ts:2464-2466,2567` (`layoutImages` de `quote.layoutFiles`) | imagens do layout no documento | imagens de `quoteArtworkOf(quote)` (arte aprovada de cada implemento), com legenda por veículo quando não uniforme | P12 |
| `signature-envelope.service.ts:3838` (OTP), `4620` (contra-assinatura), `5269` (sessão do portal), `6342`/`6374` (selo, `PADES_FAILED snapshot_stale_at_seal`), `6884-7050` (`onQuoteContentChanged`; 6916-6920 também em COMPLETED; 6952 coleta; 7036-7044 gancho) | conferência de frescor contra o snapshot congelado | **sem mudança de código** na conferência; o que a protege é a fonte nova preservar os `File.id` (M-A..M-D) e o G11. Muda só o **destino** da invalidação (eixo, §2A.4) e a tolerância `tolerateArtworkAfterSeal` **só** para envelope `COMPLETED` (D-31) | P12/P14 |
| `signature-envelope.service.ts:5851-5875` (`advanceEnvelope` → `markSigned`, fire-and-forget, `:5866-5874`) | `Budget.status = SIGNED` | eixo `AWAITING_ANKAA`, na transação; `replayCompletion` (`:6086-6150`) passa a reconhecer "grupo 0 completo e eixo ainda `AWAITING_CUSTOMER`" (X9) | P14 |
| `signature-envelope.service.ts:6699-6720` (conclusão → `budgetApprove`, best-effort) e `:6132` (`quote.status === 'APPROVED'` ⇒ "nada a fazer", **literal**) | assinatura concluída aprova o orçamento | coleta legada: igual, sem portão de layout; coleta nova: só o eixo `SIGNED`. O literal de `:6132` passa a olhar o eixo (`signatureStatus === 'SIGNED'`) | P14 |
| `signature-envelope.service.ts:4264-4275` (`applyRefusal`), `signature-expiry.scheduler.ts:38-150` | recusa/vencimento → `EXPIRED` só de PENDING | eixo `REFUSED`/`EXPIRED`; `Budget.status` só muda na coleta legada [pergunta 7] | P14 |
| `signature-envelope.service.ts:7644` (`issueVehicleAddendum`) | aditivo de veículo | molde do **aditivo de arte** opcional depois do selo (D-31) | P14 (opcional) |
| `src/modules/common/signature/services/quote-snapshot.service.ts:207` (`layoutFileIds: string[]`), `:220` (`QUOTE_SNAPSHOT_SCHEMA_VERSION = 4`), `:297` (`QUOTE_MATERIAL_SCHEMA_VERSION = 7`), `:300` (`SUPPORTED_MATERIAL_VERSIONS = [7..1]`), `:326`, `:389` (include `layoutFiles orderBy createdAt`), `:530` (`build`: `quote.layoutFiles.map(id).sort()`), `:594` (projeção material), `:681-744` (`matchesFrozenTerms`; tolerâncias `:750`, `:792`, `:873`) | a arte entra no hash material de todas as versões, a partir de `Budget.layoutFiles` | **versões inalteradas** (snapshot v4, material v7, `SUPPORTED` igual). `:389` passa a `tasks.include.implement.include.layouts { where: APPROVED, include: file, orderBy: [createdAt, fileId] }`; `:530` passa a `unique(quoteArtworkOf(quote).map(fileId)).sort()`; `layoutCoverage` (tipo e projeção do commit `3a041693`, **já na `main`**) emitido quando a cobertura não é uniforme **ou** `layoutScope = PER_VEHICLE` (DD6, Revisão 3: é produção). Não nasce projeção comercial (DD8) | P12 |
| `quote-snapshot.service.ts:92-120,176-182,342,436,488-498,598-626,832-840` | chaves JSON `truck` (v1–v4), `vehicles[].category/implementType/serialNumber`, include `tasks.include.truck` | **o `build()` lê de `implement.type`/`implement.serialNumber` e ESCREVE nas chaves velhas, para sempre** (renomear a chave emitida muda o hash de todo envelope → `SNAPSHOT_DRIFTED` em massa; a série está fora do material, mas dentro do hash inteiro). Include `tasks.include.implement` | P11 |
| `src/modules/common/signature/services/quote-diff.ts:65,100,114` (grupo `LAYOUT`), `560-567` (`withDefaults` fabrica `[]`), `611-615,708-714,746` (`taskSerialNumber:<id>`), `658-750` (733-751 `snapshotVehicles` já lê duas formas), `1099-1120` (linha MATERIAL "Layout aprovado") | | linha "Arte aprovada" (chave `layout` mantida) + linha por veículo quando há `layoutCoverage`; `withDefaults` para de fabricar `[]`; chaves `truckPlate/Chassis/Category/Implement` e `taskSerialNumber` **mantidas** | P12 |
| `src/modules/common/signature/document/quote-html.builder.ts:35-37,69,85,124,130-133,291,404,501-583,548-561,794-819` | seção `LAYOUT` sem legenda; colunas categoria/implemento; lacuna tardia `serialNumber#taskId` (8ch) | seção `LAYOUT` **com** a arte dos implementos e legenda por veículo quando não uniforme (dentro de `.layout-grid`, como `3a041693`); colunas lendo `implement`; lacuna tardia igual (`LATE_SLOT_FIELDS` é chave congelada no PDF) | P12 |
| `src/modules/common/signature/document/quote-renderer.service.ts:170-182,455-489,566-629,718-726,1041` | orçamento de altura com arte; `if (!hasLayout) tryFusedRender` | `hasLayout` passa a ser "`quoteArtworkOf` não vazio". **A regra da "folha própria de assinaturas" é espelho** de `web/src/pages/public/budget/[id].tsx:111-131` e `service-report/[id].tsx:93-163`: mudar os três juntos | P12 |
| `src/modules/common/signature/document/quote-text.ts:335-339`; `src/modules/common/signature/dossier/dossier-assembler.service.ts:345,347,980,1103,1104` | categoria/implemento/série no texto e no dossiê ("No de serie X") | ler de `implement`; texto e chaves congeladas intactos | P11 |
| `src/modules/common/signature/quote-sections.ts:36-65` (`QUOTE_SECTIONS`, `LAYOUT` é o último), `80,97,113-118`, `128-141` (`ROLE_DEFAULT_SECTIONS`), `137-138` (`MARKETING: ['LAYOUT']`, FINANCIAL sem `LAYOUT`), `198-200` (`isFullSections` compara por comprimento) | | **sem mudança** (D-14 da Revisão 2): `LAYOUT` continua alternável e o MARKETING continua assinando `LAYOUT` | — |

### 6.3 API — Portal do Responsável (`src/modules/people/portal/`)

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `portal-capabilities.ts:48-59,61-66,70+` | 5 capacidades, nenhuma de arte | + `APPROVE_ARTWORK` (rótulo "aprovar arte") | P13b |
| `portal-capabilities.ts:108-113,134-180` (`ROLE_CAPABILITIES: Record<ResponsibleRole,…>` total) | | decidir para os 9 papéis (D-09). O tsc obriga | P13b |
| `portal-capabilities.ts:268-340` (301: `REQUEST_BUDGET ⇒ ['VEHICLE','LAYOUT']`) | recorte de TELA = assinatura ∪ capacidade | `SECTION_IMPLIED_BY_CAPABILITY[APPROVE_ARTWORK] = ['VEHICLE','LAYOUT']` | P13b |
| `portal-read.service.ts:199` | exclui `spot` do contrato | igual | — |
| `portal-read.service.ts:202-229` (`TASK_BASE_SELECT`, 224-226 medidas) | `select` explícito: chave nova **não aparece** se não entrar aqui | `implement.select` com `type, category, 4 medidas, rearDoor*, projectFiles` | P13a |
| `portal-read.service.ts:1048,1115-1117` (detalhe do orçamento seleciona `layoutFiles`) | | sai | P12 |
| `portal-read.service.ts:1212-1222` (1214-1222: só `Layout` **APPROVED**, `where` no select) | arte do veículo | `implement.layouts` com `status IN (PENDING_APPROVAL, APPROVED, REPROVED)` e o último `LayoutDecision` | P13b |
| `portal-projection.service.ts:197-199,464-466,841-867` (854-861 `measures {left,right,back}` em METROS) | projeção | `implement: { id, type, category, measures{left,right,back,front}, rearDoor{leaves,barCount,hatchCount}\|null, projectFiles }` (§7.4); chave `back`, nunca `rear` | P13a |
| `portal-projection.service.ts:233,576,790-791` (`PortalBudgetView.layout.files`, lido de `Budget.layoutFiles`) | artes do orçamento | **trocar a fonte**: a arte do orçamento no portal passa a ser a dos implementos (`artwork { total, approved, awaitingCustomer, awaitingMe, atAnkaa }` + as artes por veículo, agrupáveis por arquivo para o lote "Aprovar para os N veículos"); `Budget.layoutFiles` sai | P12/P13b |
| `portal-projection.service.ts:878-891` (filtro só APPROVED no projetor) | | `artworks: [{ id, file, status, version, decidedAt, decidedBy{name}, canDecide, note }]`; `DRAFT/SUPERSEDED` nunca aparecem | P13b |
| `portal-identity.service.ts:110,194` (`truckVinPlate`) | multipart da plaqueta | aceita `implementVinPlate` também | P13a |
| `portal-identity.service.ts:157-161` (`LADOS_DA_MEDIDA`) | `esquerda/direita/traseira` | + `{ chave: 'frente', coluna: 'frontSideMeasureId' }` | P13a |
| **`portal-identity.service.ts:472-493`** (`mexeNoCaminhao`: já custou "200 que não grava") | decide se toca no implemento | **toda chave nova** (frente, porta traseira) entra nesta conta; teste "PATCH só com `medidas.frente` grava" | P13a |
| `portal-identity.service.ts:629-700` (640-700; **654** `tx.implementMeasure.delete(...).catch(() => undefined)` dentro de transação interativa; 663-676 edita no lugar sem copy-on-write) | escritor #8 | passa pelo `ImplementMeasureWriter`; sem `.catch` dentro de `tx` (o Postgres aborta a transação e o erro seguinte vira "current transaction is aborted") | P04 |
| `portal-identity.controller.ts:107` | `FileFieldsInterceptor` com `truckVinPlate ≤1` | + `implementVinPlate` | P13a |
| `portal-request.service.ts:211-216` (mapa lado→coluna), `924-993` (cria medidas) | escritor #9 | writer; + frente | P04/P13a |
| `src/schemas/portal-request.ts:41,444` (`z.nativeEnum(TruckCategory/ImplementType)` de `@prisma/client`) | | `ImplementCategory`; `type` | P11 |
| `src/schemas/portal-request.ts:328-397` (393-397 `portalMedidasSchema`), `425-448`, `626-645` (640-645 `medidaParaPrisma` /100, regra porta⇒altura) | medidas da requisição em cm | + `frente`; `portaTraseira: { abertura: 'BIPARTIDA'\|'TRIPARTIDA', varoes: 2\|3\|4, portinholas: 0..6 }` traduzida para o enum do banco | P13a |
| **Dois arquivos com o mesmo nome** (corrigido pela auditoria §13): `src/schemas/portal-vehicle-identity.ts:57,175-176` (enums de `@prisma/client`), `:219` (`medidas`), `:232` (`.strict()`), `:251-257` (lista de campos) — é aqui que entram `medidas.frente` e `portaTraseira` e onde `implementType` vira `type`; e `src/modules/people/portal/portal-vehicle-identity.ts:111-158,242` (155-157: a guarda do documento congelado compara **valor cru** de `category`/`implementType` impresso × desejado → 409) | | ler `type`; como os **valores** não mudam, não precisa de tabela de equivalência. **A porta traseira e a frente não são impressas** → ficam fora de `VEHICLE_IDENTITY_FIELDS` (sem 409) | P13a |
| `portal-frozen-document.ts` | guarda | idem | P13a |
| `portal-read.controller.ts:236` (`GET /cliente/me/veiculos/:taskId`) | por `taskId` | igual (D-01) | — |
| novo `portal-artwork.controller.ts` + `portal-artwork.service.ts` | — | rotas do §5.1 (aprovar, reprovar, lote, listar pendentes); escopo `commercialTaskScopeWhere`; 404 fora do escopo; motivo obrigatório; lote atômico; chama `ImplementLayoutService.approveFromPortal` com ator `RESPONSIBLE` e `fileSha256` | P13b |
| novo `POST /cliente/me/veiculos/:taskId/projeto` (em `portal-identity.controller.ts`) | — | multipart `implementProject`; PDF/imagem; `WRITE_VEHICLE_IDENTITY` | P13a |
| `src/modules/common/notification/portal-notification.service.ts:37-46,142-190` (4 chaves; CHECK `Notification_exactly_one_recipient`; `responsibleRecipient()`) | | + `layout.portal_pending_approval` ("Arte esperando sua aprovação") e lembrete | P13b |
| `portal-scope.service.ts` | escopos | reusar `commercialTaskScopeWhere` | — |
| resumo `/cliente/me/resumo` (`portal-read.service.ts:760-948`; `byStatus` de `Object.values(TASK_QUOTE_STATUS)` `:775-777`; `waitingOnMe.preApproval` `:785-814`) | "o que espera por mim" é por estado de ORÇAMENTO | + grupo "artes aguardando você" (por implemento); `preApproval` → **`valueApproval`** (IN_NEGOTIATION ∧ `APPROVE_VALUE`, D-35); `byStatus` perde `PRE_APPROVED` sozinho | P13b/P14 |
| `portal-read.service.ts:1323-1325` (`canPreApprove`), `:1343-1352` ("18 de 18" PENDING sem coleta), `:1360-1413` (`signatureFacts`: `emitted`, `awaitingMe`) | | `canApproveValue`; `signatureFacts` passa a ler o eixo `signatureStatus` (o "emitido" deixa de ser reconstruído do envelope); o comentário dos "18 de 18" fica verdadeiro às avessas (PENDING = "Pendente") | P14 |
| `portal-read.service.ts:511-538,573-600` (marco "Orçamento aprovado": `APPROVED ∨ SIGNED` no estado ou no changelog, `quoteApprovalDates`) | | continua certo no Modelo C (aprovado = valor); acrescentar o marco "Arte aprovada" [baixa] | P14 |
| `portal-decision.service.ts:94-226` (pré-aprovar/recusar), `:183-196` ("Lance as assinaturas."), `:251-296` (fabrica `BudgetRequest` para orçamento interno), `portal-decision.controller.ts:66-78,97-98`, `portal-decision-transitions.ts:39-48` (`PRE_APPROVE: IN_NEGOTIATION→PRE_APPROVED`; `REFUSE: →REQUESTED`) | | `APPROVE_VALUE: IN_NEGOTIATION→APPROVED` com `BudgetValueApproval{PORTAL}`; `REFUSE: →PENDING`; rota `/aprovar-valor`; o aviso ao comercial diz **o que falta** (artes pendentes por veículo, ou "pronto para assinatura"); **para de fabricar** `BudgetRequest` (D-35) | P14 |
| `portal-capabilities.ts:52,63,72,137-160` (`PRE_APPROVE` em COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR) | | `APPROVE_VALUE` (mesmos papéis; rótulo "aprovar o valor ou recusar orçamento") | P14 |
| `docs/PORTAL-CONTRATO.md:62-63,174-178,199-206`, `docs/PORTAL-DO-RESPONSAVEL.md` | contrato | atualizar no mesmo PR (o espelho `web/src/api-client/portal.ts` tem de casar campo a campo) | P13a/P13b |

### 6.4 WEB — produção, tarefa, implemento (`web/src/…`)

**Base compartilhada (tipos, schemas, cliente HTTP, hooks, constantes): pacote P20, roda sozinho**

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `types/truck.ts:1-171` | `Truck`, includes, orderBy, FormData | `types/implement.ts` (`Implement` com `type`, `category`, `frontSideMeasure(Id)`, `rearDoor*`, `layouts: ImplementLayout[]`, `projectFiles`). **Apagar** `types/truck.ts` (sem alias) |
| `types/task.ts:17,61,79,85,90,134,152-156,162,201-205` | `truck?`, `projectFileIds`, `projectFiles?`, `layouts?: File[]` (**tipo mentiroso**: a API devolve Layout achatado), `TaskIncludes.quote.include.layoutFiles` (convida a pedir relação morta) | `implement?: Implement`; tirar `layouts`, `truck`, `layoutFiles`; `projectFiles` fica. O tsc aponta cerca de 300 locais; os `as any` são caçados à mão (abaixo) |
| `types/implementMeasure.ts:12-41` | `trucks*Side` | `implements*Side` (+Front) |
| `types/layout.ts:21-44` | `Layout { tasks }`, "SHARED across tasks - status changes affect all" | `ImplementLayout { id, status, version, file, implementId, decidedAt, decidedBy, approvalSource, note }` |
| `types/task-copy.ts:17-29,96-107,229-300` | `layoutIds`, `projectFileIds`, `implementType`, `category`, `implementMeasures` ("esquerda, direita, traseira") | tokens iguais aos da API (§5.2); descrição com a frente; + `rearDoor`, `implementProjectFiles` |
| `types/paintingAnalysis.ts:437-438,555` | `implementMeasureId` | sem mudança; `components/administration/painting-budget/detail/faces-card.tsx:39-51` pode usar a frente medida no lugar dos 260 cm inferidos (oportunidade) |
| `types/index.ts` | reexporta `truck` | `implement` |
| `types/budget.ts:110,175` | `BudgetPayer.billing.tasks[].task.truck`, `Budget.layoutFiles` | `implement`; remover `layoutFiles` |
| `schemas/truck.ts:1-691` | include/where/getMany/create/update de Truck + `optionalPlateSchema`/`optionalChassisSchema` (usados por `schemas/task.ts:11`) | `schemas/implement.ts`; validadores de placa/chassi em `schemas/vehicle-identity.ts` |
| `schemas/task.ts:17` (`taskIncludeSchema` tipado `z.ZodSchema` → include vira `any`), `113-139` (include `layouts` com sub-includes de File que nem existem em `Layout`; `projectFiles`), `171-181` (`truck.include.task`), `368-374,513-518,848` (`hasLayouts`), `497-502,846` (`hasTruck`), `646-648,877` (`truckIds`), `998-999` (`truckCategories`, `implementTypes`), `1135-1182` (`measureSectionSchema`, `measureSideSchema`, `taskTruckCreateSchema` com `category/implementType` como `z.string()` e `xPosition/yPosition/garageId` mortos), `1231-1233,1378-1380` (`layoutIds`, `projectFileIds`), `1567-1570` (`mapTaskToFormData.layoutIds`) | os schemas de include/where **não rodam** (só servem de tipo) | tipar o include com o tipo gerado da API (G5) em vez do `ZodSchema` opaco; `taskImplementSchema` com 4 faces, porta (enum e inteiros), `type/category` `nativeEnum`; sai o que é morto; `layoutIds` sai da tarefa |
| `schemas/airbrushing.ts:39-45`; `schemas/{customer,dashboard,observation,paint,sector,serviceOrder,user}.ts` (`truck: z.boolean()`) | | `implement` |
| `schemas/implementMeasure.ts:9-76` | seção/create/update | sem mudança de nome |
| `schemas/budget.ts:209-210` | `layoutFileIds .max(2)` | remover |
| `api-client/truck.ts:42-100` | `/trucks/garages-availability`, `batch-update-spots` (`truckId`), `request-movement` | `api-client/implement.ts` com `/implements/*` e `implementId`; + funções de arte (`uploadImplementLayouts`, `sendLayout`, `approveLayoutOnBehalf`, `reproveLayout`, `newLayoutVersion`, `bulkApplyLayout`) e de projeto (`setImplementProjectFiles`) |
| `api-client/implementMeasure.ts:35-36,61-62,65-69,80-81` | `truckId` na resposta de uso; `assign-to-truck` (sem chamador); `/implement-measure/truck/:truckId[/:side]` | rotas novas; `side` ganha `front` |
| `api-client/services/implementMeasureSection.ts:42-46` | `/implement-measure-section/...` — **a API não tem essa rota** | apagar |
| `api-client/layoutDimensions.ts:88-99` | `?truckId=` | `?implementId=` |
| `api-client/task.ts:4-18,101,106` (include `any`), `345-353` (`batch-with-quote` com `tasks: any[]`) | | tipar (`TaskCreateFormData[]`, include gerado) |
| `api-client/budget.ts:63-70` (`updateLayoutFile`, só usado por `set-quote-layout-modal.tsx:280`) | | remover |
| `api-client/index.ts:78` | `export * from "./truck"` | `./implement` |
| `utils/form-data-helper.ts:93-94` | objeto aninhado vira JSON num campo | sem mudança (o campo passa a `implement`) |
| `hooks/common/query-keys.ts:355-356` (`layoutKeys = fileKeys`: invalidar "layouts" invalida TODOS os arquivos), `758-761` (`truckKeys`) | | `implementKeys("implements")`, `implementLayoutKeys`; apagar o alias enganoso |
| `hooks/administration/use-implement-measure.ts:10-14` (`byTruck`), `38-97` (**fallback que remonta 3 lados**: `frontSideMeasure` some em silêncio, 86-96), `151` (literal `["trucks","detail",id]` fora do store) | | `byImplement`; apagar o fallback "old API version"; `implementKeys.detail(id)` |
| `hooks/administration/use-implement-measure-section.ts:66-136` | chaves literais | centralizar |
| `hooks/production/use-task.ts:28-33,191,314,373-383,519-521` (`(task as any).truck.id`), `581-584` | invalida `truckKeys`, `layoutKeys` | `implementKeys` |
| `hooks/inventory/use-maintenance.ts:95,136` | `relatedQueryKeys: [truckKeys…]` (resquício) | remover |
| `lib/attention/use-attention-socket.tsx:40` | `TRUCK: "trucks"` | `TRUCK: "implements"` (o valor emitido continua `TRUCK`, D-04) |
| `constants/enums.ts:633-637` (`LAYOUT_STATUS`), `1272-1296` (`TRUCK_CATEGORY`, `IMPLEMENT_TYPE`), `1328,1342,1378,1791,1980,2020` (`ENTITY_TYPE/CHANGE_LOG_ENTITY_TYPE.TRUCK`) | | `IMPLEMENT_CATEGORY`, `REAR_DOOR_LEAVES`, `LAYOUT_STATUS` com 5, `LAYOUT_APPROVAL_SOURCE`; `TRUCK` mantido e rotulado "Implemento" |
| `constants/enum-labels.ts:410-413` (`LAYOUT_STATUS_LABELS`), `545-565` (`TRUCK_CATEGORY_LABELS`, `IMPLEMENT_TYPE_LABELS`), `1328,1791` | | rótulos do §3.2 |
| `constants/sortOrders.ts:995,1009` | ordem de `TRUCK` | igual |
| **novo** `constants/implement-faces.ts` | 32 uniões inline `'left'\|'right'\|'back'` em 11 arquivos | `IMPLEMENT_FACES = ['left','right','back','front'] as const`, `ImplementFace`, `FACE_LABEL`, `FACE_MEASURE_FIELD`, `FACE_PHOTO_FIELD`, `FACE_PANEL_SIDE` como `Record<ImplementFace,…>` (o tsc aponta o mapa que esquecer a frente). Criado **antes** em P03, com 3 faces |
| `hooks/common/use-task-permissions.ts:71-113` | `canViewLayout` (= MEDIDAS), `canViewTruckSpot`, `canViewProjectFiles`, **`canViewReimbursement` controla o card de artes** (`task-edit-form.tsx:4372`), `canViewLayoutBadges`, `canEditLayout` | `canViewMeasures`, `canViewImplementArt`, `canApproveArtOnBehalf`, `canViewTaskProject`, `canViewImplementProject`; tirar a arte de `canViewReimbursement` |
| `constants/routes.ts:722-723,928-929` | `/producao/barracoes`; portal `veiculo(taskId)` | igual (tela "Implementos" só se N:1) |
| `lib/layout-dimensions/types.ts:61-73` | `PanelSide = "MOTORISTA"\|"SAPO"\|"TRASEIRA"` | + `"FRENTE"` |
| `utils/changelog-fields.ts:343-400,607-625,793-857,1286-1304,1723-1760` (**segunda cópia** dos rótulos de categoria/tipo em 1723-1751), `2596-2632` (formatador de JSON de medida) | rótulos `truck.*`, `layouts`, `layoutFileIds`, `implementMeasures` | acrescentar as chaves novas **sem apagar as antigas**; usar `*_LABELS` no lugar da cópia; porta traseira no formatador |
| `utils/generate-implement-measure-svg.ts:5` | SVG por lado (changelog) | + frente, porta |
| `utils/task-measures.ts:11-80` | m² e "L x A" pelas laterais | sem mudança |

**Formulários, detalhe e ações: pacote P21**

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `components/production/task/form/task-create-form.tsx:66-87` | schema local `category/implementType` `z.string()` | enums |
| `task-create-form.tsx:110-111` | `showLayout` (medidas) / `showLayouts` (arte) | `showMeasures` / `showArt` |
| `task-create-form.tsx:125` | **`implementType` padrão `REFRIGERATED`** | vazio (D-25) |
| `task-create-form.tsx:227-271` | estado de 3 lados; validação Motorista×Sapo >2 cm | 4 faces; validar também Frente×Traseira (largura do baú) |
| `task-create-form.tsx:282-289,372-400` (391 `fileContext:'tasksLayouts'`) | sobe arte e manda `layoutIds + layoutStatuses` para N tarefas | depois de criar, `POST /implements/layouts/bulk` (a mesma arte em cada implemento, `DRAFT`); PDF vai em `projectFileIds` |
| `task-create-form.tsx:444-460` (455: `buildLayoutSectionData` **descarta `photoFile`** — defeito vivo, a foto da traseira escolhida na criação se perde) | | subir a foto antes e mandar `photoId` (P03 corrige já) |
| `task-create-form.tsx:491-505` (`buildTruckData`) | `truck: {…}` | `implement: {…}` com 4 faces e porta |
| `task-create-form.tsx:739-800,962-1030,1019,1110-1170,1147` | campos Categoria/"Tipo de Implemento"; acordeão de 3 lados; "Layout Referência" | "Categoria"/"Tipo"; 4 abas + bloco Porta traseira; dividir em "Arte do implemento" e "Projeto da tarefa"; **novo** campo "Projeto do implemento" (a criação nem oferece `projectFiles` hoje) |
| `components/production/task/form/task-edit-form.tsx:66,73-75` | imports | renomear |
| `task-edit-form.tsx:429-470,456,472-543` | estado `uploadedFiles`/`layoutStatuses` a partir de `task.layouts` | **sai do formulário da tarefa**; vai para o componente isolado `ImplementArtPanel` com mutações próprias |
| `task-edit-form.tsx:572-591` | `projectFiles`; `vinPlateFiles` via `(task as any).truck?.vinPlate` (591) | `projectFiles` = projeto da tarefa (**só PDF**, D-12); `implement.vinPlate` |
| `task-edit-form.tsx:694-698,831-856` | `selectedLayoutSide`, `currentLayoutStates`, `modifiedLayoutSides` (3 lados) | `ImplementFace` |
| `task-edit-form.tsx:753-791` (mapa campo→acordeão em STRING: `"truck.category"`, `"truck.implementType"`, … `projectFileIds`) | o tsc não vê | `"implement.*"`, `frontSideMeasure`, `rearDoor*` |
| `task-edit-form.tsx:858-913` | `truckId`; comprimento = laterais + cabine 2,0/2,4 m | `implementId`; cabine por `category` (semirreboque não tem cabine) |
| `task-edit-form.tsx:914-1016` (`deleteLayout` apaga MEDIDA) | | `deleteMeasure` |
| `task-edit-form.tsx:1127-1137,1325-1336` | valores iniciais com `truck` e `layoutIds`; `ensureArray` de 3 lados | `implement`; 4 faces |
| `task-edit-form.tsx:1488-1553` (1529: guarda `sections.length > 0`) | consolida os lados modificados em `changedData.truck[...]`; fotos `leftSide\|rightSide\|backSide` | + `frontSide`; **a porta traseira NÃO depende de a traseira ter seções** |
| `task-edit-form.tsx:1580-1605,1619-1672` (1637-1639 `layouts`, 1647-1648 `projectFiles`, 1650-1651 `truckVinPlate`, 1667-1672 fotos) | multipart | tabela §5.2 |
| `task-edit-form.tsx:1686-1698,1758-1800,1784,1791` | `excludedFields` com `layoutIds`; manda `layoutIds` se não financeiro | sai |
| **`task-edit-form.tsx:1933-1987`** (multipart) e **`2162-2215`** (JSON, sem o filtro de financeiro) | **reenvia o status de TODAS as artes em QUALQUER salvamento** | **sai** (armadilha A1: um formulário aberto antes sobrescreveria a aprovação do cliente). A API também recusa (§5.2) |
| `task-edit-form.tsx:2071,2221-2222,2646-2647,2680-2700,2721` | `layoutIds` em `fieldsToOmitIfUnchanged`; limpeza de status | remover; `projectFileIds` fica |
| `task-edit-form.tsx:2751-2780` (2772 `setValue("truck.vinPlateId" as never, …)`) | | `implement.vinPlateId` sem `as never` |
| `task-edit-form.tsx:3288-3345,3293,3320,3374-3450,3376,3403` | Combobox "Categoria do Caminhão"/"Tipo de Implemento"; Placa/Chassi/Plaqueta (`name="truck.*"`) | "Categoria"/"Tipo"; `implement.*` |
| `task-edit-form.tsx:3807-3940` (acordeão `value="layout"`, alvo de scroll e erro) | medidas, 3 botões | 4 + porta; `value="measures"` e mapa de :776-779 junto |
| `task-edit-form.tsx:3944-3975,3964-3967` | acordeão Vaga | igual (D-03) |
| `task-edit-form.tsx:4148-4210,4172-4188` (aceita vídeo/imagem/PDF/EPS) | "Projetos" | "Projeto da tarefa", só PDF, abre no cotador |
| `task-edit-form.tsx:4372-4440,4398,4414` | "Layout Referência" com seletor de status | `ImplementArtPanel` (upload, "Enviar para aprovação do cliente", "Aprovar em nome do cliente" com nota, histórico) |
| (novo) | — | acordeão "Projeto do implemento" |
| `components/production/task/batch-edit/task-batch-edit-table.tsx:270-290` | dobra `plate/chassisNumber` em `truck` **só quando mudou** (o repositório faz `upsert` e criaria veículo com spot nulo) | `implement`, mesma cautela |
| `components/production/task/bulk-operations/AdvancedBulkActionsHandler.tsx:30,81-82,90-157,219-228,271-311,502-510,516-578,521-569 (objetos any),624-660,896-996 (902-905 `hasAnyLayoutState` exige seções; `doorHeight` null),1116-1222 (1168-1176, 1199-1203, 1216-1220),1253-1260,1307` | "arts" (arte) e "layout" (medidas) em lote; casa arte por NOME de arquivo; `truckWithLayouts` | "arts" → `POST /implements/layouts/bulk`; "layout" → "measures" com 4 faces + porta; títulos "Adicionar arte ao implemento" / "Aplicar medidas do implemento" |
| `components/production/task/modals/task-duplicate-modal.tsx:24,40-66` (42 `quote.include.layoutFiles` → **500** sem R1), `174-241` (compartilha `layoutIds` e as MESMAS medidas), `300` (`layoutFileIds`) | | sem `layoutFiles`; `implement` com 4 medidas; a cópia **copia** medidas e arte como linhas novas `DRAFT` (D-07) |
| `components/production/task/schedule/duplicate-task-modal.tsx` | `DuplicateTaskModal`: **sem consumidor** (as 5 telas importam `modals/task-duplicate-modal`; `11` §8) | **apagar** (§6.11) |
| `components/production/task/schedule/task-schedule-content.tsx:119-135,194-224`, `schedule/copy-from-task-modal.tsx`, `dashboard/widgets/task-table.tsx:2090-2112` | copiar de outra tarefa | tokens (§5.2) |
| `hooks/production/task/use-task-form-url-state.ts:80-89,210-237,397-406,586-669` | **nenhum chamador** | apagar |
| `components/production/implement-measure/implement-measure-form.tsx:26,28-57,29,37,56,436-579 (443-444,487,519,550),679,815,850,1101-1315,1186-1231,1234-1239,1438,1446,1545-1600,1579,1621` | editor com `'left'\|'right'\|'back'` em ~15 pontos; foto só na traseira; `selectedSide !== 'back'` sincroniza altura; Copiar/Espelhar Motorista↔Sapo; SVG | `ImplementFace`; aba **Frente** ("Copiar largura da traseira"); bloco **Porta traseira** (segmented Bipartida/Tripartida, Varões 2/3/4, Portinholas 0..6) com desenho das folhas e varões no SVG; a porta gera o **preset** de seções da traseira (D-06). Componente compartilhado com o portal |
| `components/production/task/detail/sections/truck-implement-measure-section.tsx:18,111-127,245-247,356-411,445-470` | prévia: Motorista e Sapo à esquerda, Traseira à direita | `implement-measures-section.tsx`; posição da Frente; porta traseira |
| `components/production/task/detail/task-detail-page.tsx:202-240` (**`DETAIL_INCLUDE`**: `truck: true`, `projectFiles`, `layouts{file}`, **`quote.include.layoutFiles` em 226**) | include de TODO detalhe de tarefa | `implement: { include: { vinPlate, layouts: { include: { file } }, projectFiles } }`. **Remover `layoutFiles` no MESMO deploy da API R1** (antes disso ainda é válido). Conferir `t.truck?.vinPlate` (767): hoje só aparece se a API incluir por padrão |
| `task-detail-page.tsx:250-253,274-280` (`ALL_DETAIL_SECTION_IDS` com `"layouts"`, `"layout"`; padrões por setor) | **ids persistidos** (`components/ui/detailpage/use-detail-preferences.ts:38-75`: localStorage + servidor) | manter os ids ou migrar com versão; + `"implement-art"`, `"task-project"`, `"implement-project"` |
| `task-detail-page.tsx:374-386,409-431,500-511,730-830 (767),1325-1336,1335-1360,1362-1386,1515-1530,1554-1567,1625` | medidas pelo hook; permissões; `filteredLayouts`; visão geral com edição inline `setTaskField({ truck: {...} })` e ids `truckCategory`/`truckSpot`; seções "Medidas", "Layout Referência", "Arquivos"; changelog com `truckId` e 3 `*SideMeasureId`; título com `task.truck?.plate` | `implement`; resumo da porta traseira; seção **"Arte"** (status, quem aprovou, quando); separar **"Projeto da tarefa"** (com cotador) e **"Projeto do implemento"**; changelog com `frontSideMeasureId` |
| `task/detail/sections/layouts-section.tsx:1-126` (13 `LayoutLike`; 32 baixa pelo id do Layout; 60,84-87 cotador) | galeria de arte + cotador | `ImplementArtSection` lendo `implement.layouts` com `file` aninhado (parar de depender do achatamento, A14); o cotador sai daqui |
| `task/detail/sections/files-section.tsx:8-114` (88-93 abre PDF sem `layoutTruckId`) | base + projetos | separar; `layoutImplementId` no projeto da tarefa |
| `task/detail/sections/quote-billing-section.tsx:934-950` | miniaturas de `quote.layoutFiles` | remover (R1) |
| `components/common/file/file-viewer.tsx:19-28,43,104,117,273`; `file-preview-modal.tsx:95-162,162,1213`; `inline-pdf-viewer.tsx:66,110,416-448` | `layoutTruckId` | `layoutImplementId` |
| `components/common/file/file-suggestions.tsx:21` | contextos `tasksLayouts`, `taskProjectFiles`… | + `implementLayouts`, `implementProjectFiles` (sugere artes de implementos do mesmo cliente) |
| `components/production/task/list/task-table-columns.tsx:137-190,424-432`; `list/task-table.tsx:117`; `list/task-filters.tsx:179-181,757-759`; `list/filter-utils.ts:73-75,213-215`; `list/filter-indicator.tsx:133`; `list/task-list.tsx:112,172` | colunas via `row.truck`; coluna `hasLayouts`; filtros `hasTruck`/`hasLayouts` (chaves de URL) | `row.implement`; coluna **"Arte"** (sem / aguardando cliente / aprovada / reprovada); ler o nome antigo do filtro na URL por um tempo |
| `task/history/filter-utils.ts:184-210,258-285,401-447`; `history/table/task-history-table-columns.tsx:165-295,251-281,527-560`; `history/table/task-history-table-page.tsx:65,218,403-415,570-576,575,610,737`; `history/table/task-history-table-filters.tsx:20,30-34`; `history/task-history-columns.tsx:264-400,358-390`; `history/task-history-table.tsx:190-205`; `history/task-history-list.tsx:97,111,454-460`; `history/task-history-context-menu.tsx:17,67,91-215,538-541,758-765,862-865` | includes `layouts`, `truck` com 3 medidas; colunas `truckCategory`, `implementType` (ids persistidos); menus `adv-quote-layout` (R1) e `adv-truck-layout` (medidas) | `implement`; remover o menu R1; ids de coluna estáveis ou migrados |
| `task/history/task-export.tsx:129-142,215-217` | include `truck: true` **sem medidas** (coluna "Medidas" sai "-" hoje) e `serviceOrders.include.service` (**relação inexistente** → possível 500) | corrigir já (P03); cabeçalhos "Categoria"/"Tipo" |
| `task/schedule/task-schedule-columns.tsx:95-174`; `schedule/task-schedule-export.tsx:37-38`; `schedule/task-schedule-table-page.tsx:63,88,92,276,289-295,476-488,645-651,650,685,869`; `schedule/task-schedule-table.tsx:50,127,245-253,651`; `schedule/task-table-context-menu.tsx:24,136-141` (ação `"quoteLayout"`) | | `implement`; remover menu/ação R1 |
| `task/preparation/task-prep-page.tsx:49,84-115` (**`LIST_INCLUDE` com `truck.select{…}`**: campo novo só aparece se entrar aqui), `356-368,552,570-576,843-866,853-866,949-960,1115-1119`; `preparation/task-prep-columns.tsx:264,528-601` | agrupamento por `truckCategory`/`implementType`; menu R1 | `implement.select` com os campos novos; remover menu R1 |
| `components/production/task/schedule/set-quote-layout-modal.tsx:12,100-364,173,261,280,362` | define `Budget.layoutFiles` em lote (include `quote.include.layoutFiles` → 500) | **apagar** junto com os 5 menus e o tipo `TaskAction "quoteLayout"`. Apagar o arquivo, não esvaziar: só assim o tsc pega o import |
| `components/financial/common/approved-layout-picker.tsx` (535 l.) | seletor | **apagar** |
| **`dashboard/widgets/task-table.tsx:395-461,535-666,723,745,905-925,909,923,1053,1318-1349,1375,1540-1564,1612-1620,1644-1660,1702-1728,2097-2110`** | chaves de coluna `truckCategory`, `implementType`, `hasLayouts`; filtros zod persistidos `truckCategories`, `implementTypes`, `hasTruck`, `hasLayouts`; `where` montado no cliente (`{ truck: { category } }`, `{ layouts: { some/none } }`); `orderBy ["truck","plate"]`; include `truck`, `layouts` | **migrador** com `DASHBOARD_LAYOUT_VERSION` (`dashboard/types.ts:110`, "Old layouts are migrated lazily"): `truckCategories`→`implementCategories`, `hasLayouts`→`artStatus`, colunas renomeadas. ⚠️ Se o zod do widget falhar, `dashboard/components/widget-tile.tsx:130-133` troca a configuração INTEIRA pela padrão |
| **`dashboard/presets.ts:57,288,358,532,545,596,691,759`** | presets usam `hasLayouts`; o DESIGNER tem "Tarefas sem Layouts" | "Tarefas sem arte aprovada" / "Tarefas sem projeto da tarefa" |
| `pages/production/barracoes/index.tsx:83-140 (87,113-138),160-175,211-403,276-290,485` | `where { truck: { isNot: null } … }`, `select.truck{…}`, `batchUpdateSpots([{ truckId }])`, 6 casts `as any` | `implement` |
| `components/production/garage/garage-view.tsx`, `single-garage-view.tsx`, `patio-view.tsx` | DTO local; id = `truck.id`; `onTruckMove` | renomear o id; lógica igual |
| `components/production/garage/truck-detail-modal.tsx:55-80,100-112,100-265` (7 casts `as any`) | `truck.include{vinPlate,left,right}`, `layouts` | `implement`; artes do implemento |
| `components/production/task/form/spot-selector.tsx:9-19,87-91` | `getGaragesAvailability(truckLength, truckId)` | `implementId` |
| `components/production/airbrushing/table/airbrushing-table-columns.tsx:50-85`; `airbrushing-table-page.tsx:36-47,40`; `airbrushing/form/task-selector.tsx:21-41,24,33-41,143-147` (`select` explícito); `airbrushing/detail-page/airbrushing-detail-page.tsx:296-303,725` (caminho corrigido pela auditoria §13: a pasta é `detail-page/`) | identificador e medidas via `task.truck` | `implement` (aerografia mantém a arte própria: `utils/airbrushing-submit.ts`, `schemas/airbrushing.ts:109,685-850`, `types/airbrushing.ts:52,158` sem mudança) |
| `components/production/production-period-tasks-modal.tsx:86,128`, `performance-period-modal.tsx:118`, `bonus-value-day-modal.tsx:96`; `components/personnel-department/bonus/detail/bonus-tasks-table.tsx:81`; `payroll/detail/tasks-in-bonus-card.tsx:69-152`; `common/related-tasks-card.tsx:75-203`; `cut/form/cut-create-wizard.tsx:165`; `task/form/selected-tasks-summary.tsx:20`; `pages/production/schedule/edit/[id].tsx:136,157`; `pages/production/schedule/batch-edit.tsx:54` | include `truck: true`; identificador | `implement` |
| `components/ui/task-with-service-orders-changelog.tsx:535-588,804-806,920-956,1815,2145-2457,3047,3100-3140 (3107-3110),3264-3296` | busca changelog com `entityType: TRUCK, entityId: truckId` e `IMPLEMENT_MEASURE`; ramos por campo | `entityId = implement.id` (mesmo id, por ser rename); **manter os ramos antigos** e somar `frontSideMeasureId`, `rearDoor*`, eventos de arte |
| `components/ui/changelog-history.tsx:979-1081,1634,2151-2153,2430-2438` | idem | idem |
| `lib/attention/rules.ts:11-20,206-275` (220,246,271 caminhos `truck.*`; `field` alvo 223,249,274); `predicate.ts:22-35,70-73`; `types.ts:39,58` | caminho ausente vira `undefined` e `isNull(undefined) = true` | caminhos `implement.*` **no mesmo commit** do rename; **ids das regras mantidos** (`task.entry-without-*`, gravados em `AttentionAck`) |
| Truck Studio (`pages/tools/truck-studio/**`) | não consome `Truck` da API (só `updatePaint`, `truck-studio/index.tsx:14`) | **fora do rework** (oportunidade futura: abrir o Studio a partir do implemento com a porta configurada) |

### 6.5 WEB — orçamento, faturamento, assinatura e páginas públicas (pacote P22)

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `pages/financial/budget/details/[taskId].tsx:89-98` | `LAYOUT_STEP`, `LAYOUT_PICKER_ANCHOR_ID="layout-aprovado"` | remover |
| `…/[taskId].tsx:147-162` | include `truck{vinPlate}`, `layouts{file}` (**500** se ficar depois da API nova sem alias) | `implement{vinPlate, layouts{file}}`; o PDF fica em `projectFiles` |
| `…/[taskId].tsx:192,307,537,577,666-685,859-905,947-973,1289-1360 (1317),1640-1662,1688-1698,1756,1949-1951,2034-2075,2228-2242,2287-2294,2297-2310` | estado `layoutFiles`, reconciliação orçamento↔tarefa (859-905), `goToLayoutStep`, upload `quote-layouts`, `layoutFileIds` no corpo (travado e destravado), `layoutChanged`, opções do seletor, props de layout para os passos, `onResolveLayout` | **remover tudo**. ⚠️ **Ordem:** o web para de mandar `layoutFileIds` **antes** da API tirar a chave de `QUOTE_SAFE_AFTER_BILLING_FIELDS`, senão toda gravação de orçamento faturado leva 400 |
| `…/[taskId].tsx:198-215,788,1174-1205,1443-1466,2205-2226` | layouts da tarefa editados no passo 1 (`layoutStatuses`, refs "ausência = preservar", upload `tasksLayouts`, `taskUpdateData.layoutIds/layoutStatuses`) | D3 do relatório 05: o orçamento **só mostra** a arte de cada implemento (só leitura); editar arte vai para `ImplementArtPanel` |
| `…/[taskId].tsx:284-291` | defaults `category: ""`, `implementType: ""` (regra I39: nunca default concreto) | `type`; manter a regra |
| `…/[taskId].tsx:486,504-513` (`(task.truck as any)`) | `taskFields` lidos de `task.truck` | `task.implement.*` |
| **`…/[taskId].tsx:1418-1441`** | **ESCRITA** `PUT /tasks/:id { truck: { plate, chassisNumber, category, implementType, vinPlateId } }` | `implement: { …, type }` |
| `…/[taskId].tsx:1222,1256` | `fileContext: "truckVinPlate"`, `taskBaseFiles` | aceitos (alias) |
| `components/financial/budget/steps/budget-step-info.tsx:17,36-37,65-66,304-344,548-567` | `ApprovedLayoutPicker`, `handleLayoutChange`, upload "auto-aprovado", âncora `#layout-aprovado` | remover; o passo 2 fica com prazos e clientes |
| `components/financial/budget/vehicles/budget-vehicle-layouts-field.tsx` e o `layoutSlot` de `budget-step-info.tsx`; em `[taskId].tsx` os estados `layoutPerVehicle`, `vehicleLayoutFiles`, `handleUseLayoutForAll`, `handleLayoutPerVehicleChange` e o corpo `layouts: [{ fileId, taskIds }]` (vieram da `main` no P00, DD6) | seletor de layout por veículo do orçamento | **apagar** junto com o `ApprovedLayoutPicker` (a arte vem do implemento). A âncora `#layout-aprovado` (que hoje embrulha os dois seletores) sai com eles |
| `components/financial/budget/vehicles/use-budget-vehicles.ts` (`BUDGET_VEHICLE_TASK_INCLUDE`, `useBudgetVehicles`), `budget-vehicle-tabs.tsx`, os campos `vehicles.<i>.` do formulário, "Repetir nos demais" (`applyToOtherVehicles`) e o aviso de divergência (`commonDivergence`) em `budget-step-task.tsx`/`[taskId].tsx` | a tela de N veículos editáveis (`main`, 23/09) | **ficam** (DD6). Mudam só as chaves: `BUDGET_VEHICLE_TASK_INCLUDE` troca `truck{vinPlate}` → `implement{vinPlate, layouts{file}}` e perde `layouts` da tarefa; cada aba de veículo ganha o selo da arte do implemento (só leitura) |
| `budget-step-task.tsx:19-22,191-250` | selects "Categoria" / "Tipo de Implemento" | "Categoria" / "Tipo" |
| `budget-step-task.tsx:59,812-866` | tipo local `truck?`; tabela de veículos irmãos | `implement` |
| `budget-step-task.tsx:127-131,658-717 (682-717, 693-716)` | acordeão ADMIN "Layout Referência" (PDF e imagem com status) | dividir: "Projeto da tarefa (PDF de cotas)" e "Arte do implemento" (status vindo do portal, só leitura, salvo "em nome do cliente") |
| `budget-step-task.tsx:387-400` | Plaqueta | campo do implemento |
| `budget-step-review.tsx:32,122,132,167,180,196 (as any),260,304-318,344,419,644-704,1126-1170` | `layoutFiles`, `useWatch("layoutFileIds")`, bloco "Layout" do Resumo; categoria/implemento/placa de `t.truck` | remover `layoutFiles`; Resumo com "Arte de cada implemento + status" só leitura (DD2: é o que o documento vai levar); `implement`, `type`; combobox de status (`:492-575`) só com arestas **manuais** e "Aprovar valor em nome do cliente" pedindo nota (§6.14) |
| `budget-step-services.tsx:73-85` + `hooks/production/use-budget.ts:84-90` | `useBudgetSuggestion({ …, implementType })` | `type` (API aceita os dois) |
| `pages/financial/budget/create.tsx:90,229,349-421,618,683-720,874,1072-1073,1119` | `layoutFiles`, reconciliação, upload `quote-layouts`, `layoutFileIds` no `POST /budgets` | remover |
| **`create.tsx:168`** | **`implementType: IMPLEMENT_TYPE.REFRIGERATED` como default**: todo orçamento criado grava REFRIGERATED (defeito vivo; `hasTruckFields` em 765 é sempre verdadeiro) | default vazio (P03 corrige já); avisar que o dado "Refrigerado" não é confiável |
| `create.tsx:185-197` | O.S. padrão "Elaborar Layout", "Elaborar Projeto", "Preparar Arquivos para Plotagem" | vocabulário do glossário (DD5): "Elaborar Projeto" = projeto da tarefa (PDF de cotas); rótulos "Arte", "Projeto da tarefa", "Projeto do implemento" |
| `create.tsx:630-660` | upload dos layouts da tarefa e base | arte → implemento; PDF → `taskProjectFiles` |
| **`create.tsx:764-775`** (`buildTruckData`) | **ESCRITA** `truck: { plate, category, implementType }` | `implement: { plate, category, type }` |
| `components/financial/budget/signature-send-dialog.tsx:81,98-107,291-317 (296 regex /layout/i no texto do blocker),342` | atalho "Escolher o layout aprovado" | remover o atalho **e** o casamento por regex (senão qualquer bloqueio futuro com "layout" no texto ressuscita o botão); ler `preflight.gates` e desenhar uma linha por impedimento com a ação dela (checklist de emissão, §6.14); texto "o servidor recusa valor não aprovado, arte pendente em N veículos, validade vencida…" |
| `components/financial/budget/signature-envelope-card.tsx:327,338-343,1225,1252` | repassa `onResolveLayout` | remover |
| `components/financial/budget/budget-request-card.tsx:36,115` | comentário "layout aprovado"; placa | texto; `implement` |
| `api-client/signature.ts:34-42,53-57,94,104,116-124` | `QUOTE_SECTIONS` com `"LAYOUT"`; catálogo local (recuo) | **sem mudança** (D-14 da Revisão 2: `LAYOUT` continua alternável); o tipo do preflight ganha `gates` |
| `components/signature/quote-change-list.tsx:70,96` | grupo `LAYOUT` no diff | **manter** (diffs antigos) |
| `pages/public/signature/[token].tsx`, `pages/public/signature/verify.tsx`, `components/cliente/assinatura-documento.tsx` | desenham o PDF congelado do servidor | nada |
| `pages/financial/billing/details/[id].tsx:265,283-287,295-296,**305-307** (`quote.include.layoutFiles` → **500**), **319-338** (`quote.include.tasks.select.truck.select{…implementType}` → **500**), 408-470,525-545,580-593,611,734 (as any),756-763 (**recuo REFRIGERATED** que inventa "Refrigerado" na prévia da NFS-e),802,873-889,1401-1421,1502,1512,1866-1870,2032-2045` | | tirar `layoutFiles` e `layouts`; `implement`/`type`; recuo vazio; sem `layoutFileIds` |
| `components/financial/billing/steps/billing-step-budget-info.tsx:8,35-36,110-119,248-251` | 2º consumidor do seletor | remover |
| **`components/financial/billing/steps/billing-covered-vehicles.tsx:22,75-88,185-189`** | **ESCRITA** `PUT /tasks/:id { truck: { [field]: value } }` (o próprio arquivo conta a vez em que a chave no lugar errado deu 200 e a NFS-e saiu com a placa velha) | `implement` |
| `components/financial/billing/steps/billing-step-review.tsx:8-9,140-145,224,376,395-419,905-989,1989` | categoria/implemento/placa/plaqueta de `truck` | `implement`, `type` |
| `components/financial/billing/preview/billing-document-previews.tsx:28-57,30-49,56,144-145,296-297` | **cópia** dos rótulos fiscais da API ("Isotérmico", "Prancha/Plataforma") | importar da fonte única gerada (G5); `type` |
| `utils/nfse-discriminacao.ts:46,76-78` | "Truck Refrigerado de n série X" a partir de `vehicle.implementType` | `type` |
| `components/financial/budget/table/budget-table-filters.tsx:59-62,60` (`BUDGET_QUOTE_INCLUDE = { tasks: { include: { truck: true … } } }`, lista E exportação: `budget-table-page.tsx:97,121`) | passa pelo `budgetIncludeSchema` enumerado: se descartar `truck` em silêncio, a coluna de placa fica vazia sem erro | `implement: true` |
| `components/financial/budget/table/quote-row-shared.tsx:68` | `task.serialNumber \|\| task.truck?.plate` | `implement` |
| `components/financial/billing/table/billing-table-page.tsx:108` | sem include (grafo do servidor) | nada no web |
| `pages/public/budget/[id].tsx:64-69,111-131,391-420,982-986,1059-1061` | tipo público `truck{…implementType}`; regra da folha própria de assinaturas lendo `quote.layoutFiles.length`; bloco "Layout" | `implement{…type}`; o bloco "Layout" **fica** (DD2: a página pública é a leitura do mesmo documento que se assina), alimentado por `quote.artwork` (§6.2 item 19), com legenda por veículo quando a cobertura não é uniforme; **a regra da folha conta `artwork.length` e muda junto com `quote-renderer.service.ts`** (espelho). Corrigido pela auditoria §14: o texto dizia "bloco sai" |
| `pages/public/service-report/[id].tsx:93-163,101-103,105-160,528` | mesma regra + validação das URLs de `quote.layoutFiles`; `task?.truck?.plate` | idem: regra da folha e imagens por `quote.artwork`; `implement` |
| `components/public/quote-vehicle-table.tsx:5,56-58,75-76,88-107` | colunas Categoria/Implemento/Placa/Chassi de `t.truck` | `implement`; rótulo "Tipo" |
| `utils/changelog-fields.ts:830` | rótulo `layoutFileIds: "Arquivos de Layout"` | **manter** (histórico) |

### 6.6 WEB — Portal do Responsável (pacote P23)

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `api-client/portal.ts:419-436,427-432` (`PortalVehicleIdentity { category, implementType, vinPlate, measures{left,right,back} }`) | | bloco **`implement`** separado (§7.4): `type`, `category`, `measures{left,right,back,front}`, `rearDoor`, `projectFiles`; a identidade fica com série, placa, chassi, pedido |
| `api-client/portal.ts:438-445` (`PortalVehicleLayout.artworks`: "Só os Layout APROVADOS. Layout em revisão é conversa interna.") | | `artworks: PortalImplementArtwork[]` com `status`, `decidedAt`, `decidedBy`, `note`, `canDecide` |
| `api-client/portal.ts:618-629,699` (`PortalBudgetLayout`, `PortalBudget.layout`) | artes do orçamento | **remover** |
| `api-client/portal.ts:715-800` (`PortalSummary`) | pendências por estado de orçamento | + `PortalWaitingGroup<PortalSummaryArtwork>` |
| `api-client/portal.ts:1016-1024` (recibo: `vehicles[].truckId`, `measureIds`) | | `implementId` |
| `api-client/portal.ts:1083-1134,1114-1122` (`PortalBudgetRequestVehicleInput.category/implementType`, `medidas{esquerda,direita,traseira}`) | | `type`; `medidas.frente`; `portaTraseira` |
| `api-client/portal.ts:1196-1233,1203-1216` (`PortalVehicleIdentityInput`, rota `.strict()`) | **não declara `medidas`** (o card grava com `as never`) | declarar `medidas` e `portaTraseira` (m6: é o "tipo que mente" já instalado) |
| `api-client/portal.ts:1518-1534,1695-1718` (multipart `payload` + `truckVinPlate`) | | `implementVinPlate`; novo `uploadImplementProject` (campo `implementProject`) |
| `api-client/portal.ts:1813,1842-1856,2012-2068` | `refuseBudget(id, motivo)`; `portalKeys`/`useInvalidatePortal` | `usePortalApproveArtwork`, `usePortalReproveArtwork({ taskId, layoutId, motivo })`, `usePortalApproveArtworks(layoutIds)` |
| `utils/portal-capabilities.ts:3-14` | 5 capacidades | + `APPROVE_ARTWORK` (espelho da API) |
| `components/cliente/orcamento/sections.ts:64,78` (`MARKETING: ["LAYOUT"]`; `REQUEST_BUDGET` ⇒ `VEHICLE,LAYOUT`) | | `MARKETING: ["LAYOUT"]` **fica** na assinatura (DD2); `APPROVE_ARTWORK` ⇒ `VEHICLE,LAYOUT` de tela |
| `components/cliente/veiculo/veiculo-medidas-card.tsx:12-25,38-49,98-102,152 (as never),207,209 (as never),226-230` | `FACES` (3), `Medidas {left,right,back}`, `LADO_PARA_PAYLOAD` → `esquerda/direita/traseira`; cm↔m | `IMPLEMENT_FACES` (4) + `front: "frente"`; sem `as never`; bloco **Porta traseira** (ou card próprio) |
| `components/cliente/veiculo/veiculo-identidade-card.tsx:62-65,100-107,142-155,329-372` (`gravar("implementType", v)`) | editor inline Categoria/Implemento | `type`, rótulo "Tipo" |
| `components/cliente/orcamento/orcamento-veiculos-card.tsx:75-78,98-102,157-158` | linhas Implemento/Categoria | idem |
| `components/cliente/orcamento/orcamento-layout-card.tsx:9-13,62-66,171-213,240,246-340,272` | agrupa POR ARTE; "Artes do orçamento" + "Artes aprovadas", só leitura | tirar "Artes do orçamento"; **manter o agrupamento por arte** e acrescentar "Aprovar para os N veículos" (lote) |
| **novo** `components/cliente/veiculo/veiculo-arte-card.tsx` em `pages/cliente/veiculos/[taskId].tsx` (após o `PortalBand`, ~245-299) | a tela do veículo **não mostra arte nenhuma** hoje | card no molde `PortalCard` + `DetailRow` (`components/cliente/portal-detail.tsx`): miniatura, abrir em guia nova (o portal não tem `FileViewerProvider`), Aprovar / Reprovar (motivo), histórico. **Proibido** `ui/detailpage/*`, `DataTable`, `PageHeader favoritePage` no portal |
| **novo** `components/cliente/veiculo/veiculo-projeto-card.tsx` | — | "Projeto do implemento": lista de PDFs + envio (quem tem capacidade) |
| `components/cliente/veiculo/veiculo-table-columns.tsx` | lista de veículos | coluna "Arte: aguardando você / aprovada / reprovada" |
| `pages/cliente/painel.tsx` | Início | grupo "Arte esperando a sua aprovação" |
| `components/cliente/solicitacao/solicitacao-schema.ts:211-215,227-247,406-407,632-655 (632-638 medidasIntocadas),676-681,683-686` | medidas 3 lados; `category`/`implementType`; sentinela "medida intocada" (2,00×2,00) | + `frente` **dentro de `medidasIntocadas`** (senão toda requisição manda uma frente que ninguém mediu); `portaTraseira` com `z.enum`/`z.union` de literais/`int().min(0).max(6)`; `type` |
| `components/cliente/solicitacao/step-veiculos.tsx:56,417-425,426-655,555-600` | selects Categoria/Implemento; `MedidasDoImplemento`; "Comprimento total" | + Frente; grupo Porta traseira; anexar o projeto do furgão (molde `step-pintura.tsx:37-52,267-277`) |
| `components/cliente/solicitacao/step-revisao.tsx:77,116,287` (`LADOS = ["left","right","back"]`) | | `IMPLEMENT_FACES` |
| `components/cliente/veiculo/portal-file-url.ts:51` | comentário `Truck.vinPlate` | texto |
| `constants/routes.ts:928-929` | `veiculo(taskId)` | igual |

### 6.7 APP Flutter (`mobile-flutter/`, pacotes P02 e P24) e o RN antigo

**FATO**: o app vivo é o Flutter `1.4.1+24` (Shorebird). **Não há codegen** (`fromJson` à mão), então o compilador não avisa nada sobre chave de JSON. A leitura é tolerante (`j['truck'] is Map ? … : null`). A **escrita é cega**: `PUT /tasks {truck:{…}}` responde 200 e perde o dado. **Não há cabeçalho de versão nem update forçado**; o Shorebird checa só no launch e aceita "Agora não". **Regras:** nunca `dart format` global (reformata 211 arquivos; formatar só os tocados); `flutter analyze` ao final; **nenhum glifo de ícone novo** (a fonte Tabler é *tree-shaken*, glifo novo muda asset e o Shorebird recusa o patch, `lib/features/signature/budget_change.dart:254-259`). Com glifo novo, vira release nativa com reinstalação manual por `/install` (iOS ad-hoc por UDID). **Rótulos da NOTA ≠ rótulos da TELA**: não unificar `kImplementTypeLabels` com `kNfseImplementTypeLabels`.

**P02 — patch OTA "P0", antes de qualquer mudança na API (só Dart, sem ícone novo)**

| Arquivo:linha | Muda |
|---|---|
| `lib/core/network/dio_client.dart:160-170` | cabeçalhos `X-App-Version` (de `package_info`) e `X-App-Patch` (do `shorebird_code_push`) em todo request |
| `lib/core/network/api_exception.dart:68-75,121-160` + novo interceptor | **426** → tela bloqueante "Atualize o app" com botão que força `checkForUpdate` + link `/install` |
| `lib/features/updates/ota_update_service.dart:55-130`, `native_update_service.dart:1-30,118-135,224-248` | o adiamento ("Agora não"/snooze) deixa de valer quando o servidor responde 426 |
| `lib/data/models/task.dart:135-262,222-245,468-486` | leitura tolerante `j['implement'] ?? j['truck']`, `type ?? implementType`; aceita `frontSideMeasure` e `rearDoor*` se vierem |
| `lib/features/financial/budget.dart:137-243,227-243`; `lib/features/financial/billing_task.dart:17,29,38,42,119-120` | idem |
| `lib/features/financial/budget.dart:531,1187` | parar de pedir `customerConfigs.include.responsible` (a relação já morreu em 18/09 e o zod descarta calado) |
| `test/` novo `task_json_contract_test.dart` | fixture com os **dois** formatos (`truck` e `implement`) exigindo o mesmo `Task` |

**P24 — app novo (fala `implement`; frente e porta traseira; arte no implemento; projeto da tarefa; sem layout de orçamento)**

*Modelo e parse*

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `lib/data/models/task.dart:135-262` | `class Truck` (…`category`, `implementType`, `spot`, 3 medidas cruas + larguras achatadas, `bodyLength`, `implementDimensions`) | `class Implement` (+ `frontSideMeasureRaw`, porta, `layouts` com status, `projectFiles`) |
| `task.dart:266-270,298-367,388,398,468-486` | `Task.truck`, `Task.layouts`, `Task.projectFiles`; `identifier => serialNumber ?? truck?.plate` | `Task.implement`; `layouts` sai; `projectFiles` = projeto da tarefa |
| `lib/features/financial/budget.dart:137-243,203-207,243,584,643-646,1141,1148-1200 (kBudgetDetailInclude),1349-1373` | `truckPlate/…/truckImplementType`; pool `layouts`; `Budget.layoutFiles`; include com `truck`, `layouts`, `layoutFiles`, `responsible` | `implement`; apagar `layouts` do veículo, `layoutFiles` e a doc de `layoutFileIds` |

*Includes e where (onde nascem 400, 403 e 500)*

| Arquivo:linha | Envia hoje | Muda |
|---|---|---|
| `lib/features/production/task_detail_config.dart:61-107,199` (`buildTaskDetailInclude`) | `truck{vinPlate, 3 medidas{sections,photo}}`, `layouts{file}`, `projectFiles` | `implement{vinPlate, 4 medidas, layouts{file}}`, `projectFiles` |
| `lib/features/production/tasks_list_config.dart:108-123,114,465-486` | `truck{left/right…}` (coluna MEDIDAS) | `implement` |
| `lib/features/garages/garage_screen.dart:196-232` | `where{truck:{isNot:null}, OR:[{truck:{spot:{not:null}}}…]}` (**`where` strict → 400: tela Garagens morre** sem alias) | `implement` |
| `lib/features/garages/truck_detail_sheet.dart:80-105` | include `truck`, `layouts` | `implement` + arte |
| `lib/features/production/task_edit_screen.dart:150-165` | include `truck{vinPlate}`, `layouts` | idem |
| `lib/features/production/implement_measure_editor.dart:230-250` | include `truck{3 medidas}` | + frente |
| `lib/features/financial/budget/budget_form_screen.dart:718-790 (723,762-766)`; `budget_list_config.dart:113-123` | `tasks.include{customer,truck}`, `layouts` | `implement`, sem `layouts` |
| `lib/features/production_extra/airbrushing_detail_config.dart:58-68`; `airbrushing_form_screen.dart:208-216`; `observation_form_screen.dart:126-133`; `lib/features/personnel/bonus_detail_config.dart:27-29`; `lib/features/personal/my_bonus_data.dart:77-79` | `task.include.truck` | `implement` |
| `lib/features/dashboard/widgets/tasks_widget.dart:407-442 (416,427,440)` | `where{layouts:{none\|some}}` ("Sem Layouts", "Com Layouts", "Aguardando Plotagem") | "Sem arte aprovada" (implemento) e "Sem projeto da tarefa" (decisão D8 do relatório 06); mapa de migração de preset (`dashboard_controller.dart:22-27`) |
| `lib/features/production/task_row_actions.dart:346-396,358-366,365,383` | `include{layouts}` e "Adicionar Layout Referência" (`PUT {layoutIds, layoutStatuses}`) | endpoints de arte do implemento |

*Escritas (onde mora o "200 que não gravou")*

| Arquivo:linha | Payload hoje | Muda |
|---|---|---|
| `implement_measure_editor.dart:38-44,55-67,151-222,270-316,550-575,624-643,647-690,698-735` | `PUT /tasks/:id {truck:{left/right/back…}}` em METROS; `_Side {left,right,back}`; foto da traseira com `entityType=truck`; altura 100–400 cm; toast "Medidas salvas" | `implement:{…, frontSideMeasure, rearDoor…}`; aba Frente; na traseira: Abertura (Bipartida/Tripartida), Varões (2/3/4), Portinholas (0..6); `entityType=implement`. **Continua em metro** (D-23) |
| `lib/features/production/implement_measure_preview.dart` (678 l.; 26-43 permissões) | desenho de 3 faces | + frente; traseira com folhas, varões e portinholas |
| `task_detail_config.dart:560-725 (591-600,627-635,684-689,705-710),891-900,973-985,277-285` | edição inline `{truck:{plate}}`, `{truck:{chassisNumber}}`, `{truck:{category}}`, `{truck:{implementType}}`; seções Medidas, "Layouts", "Projetos" | `implement`; bloco "Implemento" com Tipo e Categoria; seções **Arte** (status do cliente) e **Projeto da tarefa** (PDF com cotador e o banner "AGUARDANDO INICIAR TAREFA"); "Projeto do implemento" |
| `lib/features/production/task_detail_widgets.dart:17-160 (32-49,82-100)` (`layoutGalleryRows`, `LayoutGallery`) | uma galeria com imagem + PDF; ADMIN/COMERCIAL veem tudo, o resto só APPROVED | duas galerias |
| `task_edit_screen.dart:50-52,107-108,217-360,396,422-590,627-667,678-695,963-980,1038-1040,1206-1270,1230-1235` | `data['truck'] = {…}`; `layoutIds + layoutStatuses` (**conjunto COMPLETO a cada save**); rascunho Hive; card "Layout Referência"; plaqueta `truckVinPlate`/`entityType:'truck'` | `implement`; arte fora do save da tarefa; `implementVinPlate` |
| `lib/features/production/task_form_screen.dart:209-330,230-330,240-268,397-472,432-472,930-935` | criação: `layoutIds`, `layoutStatuses`, `truck:{…}`; plaqueta | `implement`; arte e projeto separados |
| `budget_form_screen.dart:206-207 (default 'REFRIGERATED'),295,424-440,538-615,581-590,637-645,1238-1300,1417-1430,1932-1990 (batch-with-quote com truck e layoutFileIds),1976,2100-2135,2160-2250,2244,2550-2632,2725-2731,2940-2961,3543-3760,3590 (quote-layouts),5082-5119,5296-5390` | wizard: card "Layout Aprovados", resumo "Layout", `_approvedLayoutIds`, `layoutFileIds`, "Layout Referência" no passo Tarefa, `_category`/`_implementType` | **apagar** tudo de layout aprovado (~400 linhas); `implement` no batch; default vazio |
| `lib/features/financial/budget_sections.dart:142,344-351,2414-2640,2460-2490` | seção "Layout aprovado" com seletor; `updateFields({'layoutFileIds'})` | o seletor sai; a seção vira **"ARTE POR VEÍCULO"** só leitura, com o estado de cada arte (DD2); subir a versão da chave de layout de seções (142) |
| `lib/features/financial/billing_covered_vehicles.dart:89-160,120-160` | `PUT /tasks/:id {truck:{plate\|chassisNumber}}` | `implement` |
| `lib/features/garages/garage_edit_controller.dart:200-240,214-240,233` | `POST /trucks/batch-update-spots {truckId, spot}` | `/implements/…` + `implementId` |
| `lib/features/production/layout_attach_sheet.dart:19-180,33,92-110` + `task_form_fields.dart:649-815,652,696` (`TaskLayoutField`, `LayoutAttachment`, `kLayoutStatusLabels` **duplicado** em `task_enums.dart:54`) | anexa arte/PDF na tarefa; `fileContext=tasksLayouts` | reusar para os dois destinos; `implementLayouts`; um só mapa de rótulo |
| `lib/features/files/layout/layout_dimensions_repository.dart:19-67,25-30` | `?truckId=` | `?implementId=` |
| `lib/features/financial/budget_suggestion.dart:169-178,177` | `?category&implementType` | `type` |

*Telas, permissões e o resto*

| Arquivo:linha | Muda |
|---|---|
| `lib/features/production/task_permissions.dart:344,403-431,425-431,502-507` (`canViewTruckDetails`, `canViewLayouts`, `canViewLayoutBadges`, `canApproveLayouts`, `canSetLayoutStatus`, `canAddLayouts`) | `canViewImplementDetails`; `canSetLayoutStatus` vira "Aprovar em nome do cliente" (ação registrada com nota) |
| `lib/features/files/file_viewer_screen.dart:42,78-105,156,206-340,1353-1410,1353-1361`; `file_gallery.dart:154-211,427-469` | `layoutTruckId` → `layoutImplementId`; cotador só no projeto da tarefa |
| `lib/features/production_extra/airbrushing.dart:13-146`; `airbrushing_detail_config.dart:17-36,455-490 (488 a.task?.truck?.id)`; `airbrushing_form_screen.dart:183-510,1020`; `airbrushing_list_config.dart:55,534-539` | arte própria da aerografia fica; id do cotador → implemento |
| `lib/core/attention/attention_rules.dart:170-232 (175,181,196,205,220,226)`; `attention_types.dart:29,64` (`'TRUCK'`, `'/trucks'`); `task_schedule_view.dart:77-87,470` | caminhos `implement.*` no mesmo release; ids das regras mantidos; `'/implements'` |
| `lib/features/changelog/changelog_labels.dart:263-317,360` | acrescentar os campos novos, **manter** os antigos |
| `lib/features/signature/budget_change.dart:41-53,48`; `signature/envelope_models.dart:37,58` | manter o grupo/seção `LAYOUT` (histórico) |
| `lib/features/financial/billing_approval_sheet.dart:138,198-210,550`; `nfse_discriminacao.dart:49-80,55-75,58-80,70-77`; `order_numbers_sheet.dart:213`; `billing.dart:108`; `lib/features/production/task_enums.dart:104-128,119-126` | rename de getters; **mapas da nota separados** dos da tela |
| `lib/features/garages/garage_model.dart:84-130,263-335`; `garage_screen.dart` (1.644 l.) | só o fio. **Não renomear** `GarageTruck`/`garage_geometry.dart` (226 ocorrências que falam do veículo na vaga) |
| `lib/features/production/production_routes.dart:19-47,66-94`; `menu_lookup.dart:179` | caminho `/medidas/:id` pode ficar; renomear a classe `TruckMeasuresEditorScreen` |
| `lib/features/tutorial/tutorial_fixtures.dart:28-116`, `scenes/scene_task_detail.dart`, `steps/steps_task_detail.dart` | dados falsos |
| Estado local: Hive `form_drafts` `task:new` e `task:<id>` (`task_form_screen.dart:209-330`, `task_edit_screen.dart:396,422-590`; `form_draft_store.dart:14` schema global) | chaves novas `task:new:v2`, `task:v2:<id>`; rascunho do orçamento ignora `approvedLayoutIds`/`layouts`; rascunho de medidas `truck-measures:<taskId>` (`implement_measure_editor.dart:151-222`) tolerante |
| `Preferences.detailConfigsMobile/tableConfigsMobile` (ids `implementMeasure`, `layouts`, `projectFiles`: `task_detail_config.dart:279,893,975`; `budget_sections.dart:347`) | ids estáveis ou mapa de migração |
| Outbox Hive (`lib/features/production/checkin_outbox.dart:17-60,167,343`) | sem `truck`; o `.strict()` da API preserva `_hasFiles`, `_soFileMapping`, `expectedUpdatedAt` |

**RN antigo (`/home/kennedy/Documents/repositories/mobile`)**: morto (FATO). Mesmo bundle id (`app.json:21,46` × `android/app/build.gradle.kts:42`), último commit `16d5916d` em 14/08, e o servidor `/install` tem um binário por plataforma, que é o do Flutter (`api/src/modules/system/install/install.service.ts`). O resíduo possível é um aparelho que nunca instalou o Flutter. Para verificar: procurar no log do nginx dos últimos 30 dias `GET /updates/manifest` com cabeçalho `expo-platform`/`expo-runtime-version` (`api/src/modules/system/update/update.controller.ts:23,40`). Se houver, esse aparelho quebra e nunca recebe conserto. A regra de 426 para pedido **sem** `X-App-Version` cobre esse caso com uma mensagem. **Verificado no P00 (FATO, `P00-producao.md` §9):** o nginx guarda 15 dias (09/09–23/09), não 30; **0** requisições `Expo/` e **0** `/updates/manifest` no domínio atual; o RN só aparece no domínio velho `api.ankaa.live` (7.272 requisições `Expo/1017756`, dez/2025 a 13/01/2026, mudo desde então). Nenhum aparelho com o RN fala com a API atual.

**App nativo `AnkaaAero` (`mobile-flutter/AnkaaAero/`, Revisão 3)**: companheiro UIKit do Flutter para os iPads iOS 12.5 da aerografia (o Flutter exige iOS 15), instalado por cabo pelo Xcode, **sem OTA**, bundle `com.ankaadesign.aerografia`. Está vivo: 345 requisições em 15 dias (UA `AnkaaAero/1 CFNetwork/978.0.7 Darwin/18.7.0`). Lê `task.truck` (placa e medidas esquerda/direita com seções), `task.serialNumber`, `task.layouts{file}`, `task.projectFiles` e `airbrushing.task.truck` (`AnkaaAero/AnkaaAero/Networking/APIClient.swift:63-158`, `Models/DomainModels.swift:17-90`); só grava `PUT /airbrushings/:id`. Na janela bilíngue ele funciona sem mudança (tradução de `truck`, `layouts` sintetizado, série pelo espelho). **Precisa de build nova antes da R-C** (manda `X-App-Version` e lê `implement` com recuo para `truck`) e de reinstalação por cabo no iPad; sem isso, o 426 para pedido sem cabeçalho o derruba. Entra no P24 (Swift, à parte do Dart) e nas fixtures do G4 (P01).

### 6.8 Contratos invisíveis e dados persistidos

| Identificador | Onde grava / lê | Decisão | Pct |
|---|---|---|---|
| `ChangeLogEntityType.TRUCK` (1.194 linhas no clone) e `IMPLEMENT_MEASURE` (752) | `ChangeLog.entityType`; rollback aceita `'TRUCK'` (`task.service.ts:10823-10830,10919`); web `task-with-service-orders-changelog.tsx:3100-3118` busca `TRUCK` por `entityId = truckId` | **manter o valor**; rótulo "Implemento". O id do implemento é o mesmo do Truck (rename), então o histórico continua ligado | — |
| `TaskFieldChangeLog.field` / `ChangeLog.field` = `truck.chassisNumber` (251), `truck.rightSideLayoutId` (209), `truck.backSideLayoutId` (206), `truck.leftSideLayoutId` (206), `truck.category` (109), `truck.plate` (73), `truck.implementType` (49), `truck.spot` (10), `layouts` (612), `implementType` (113), `layoutFileIds`… | emissores: `task-field-tracker.service.ts:80-101,537`, `truck.service.ts:70-75,186`, `task.service.ts:2766,2931,2996,8962`, `implement-measure.service.ts:149-671`; leitores: api `utils/changelog-fields.ts:238-263,630,748-781,1069-1089`, `changelog-helpers.ts:376-391,795`; web `utils/changelog-fields.ts:343-400,607-625,793-857,1723-1760,2596-2632`; app `changelog_labels.dart:263-317` | **não reescrever o histórico.** Gravar os novos como `implement.*`; os três leitores aceitam **as duas grafias**; o rollback usa `LEGACY_FIELD_ALIASES` e **recusa com mensagem** o que não traduz (`layouts`, `layoutFileIds`) | P11/P21/P24 |
| `ChangeLog.reason = 'ImplementMeasure criado'` (gravado desde 07/2026) | `implement-measure.service.ts:149,174,209,530,619,671` | fica; o texto novo é o certo | P11 |
| Chaves de notificação `task.field.truck.{plate,chassisNumber,vinPlateId,category,implementType,spot,left/right/backSideMeasureId,implementMeasure}`, `task.field.layouts`, `truck.movement_request`; mortas `task.field.truck.*SideLayoutId` (em `FORCE_DISABLE`) | `NotificationConfiguration.key/eventType`, `UserNotificationPreference.eventType`; seed `prisma/scripts/seed-notification-configs.ts:182-200,6033-6073,7157-7545,8479-8519,8885-8930` | **manter as chaves** (preferência de silenciar e canal continuam valendo); trocar só título e corpo por reseed (`--dry-run` antes). Novas: `task.field.truck.frontSideMeasureId`, `task.field.truck.rearDoor` (mesmo prefixo), `layout.portal_pending_approval`. G9 impede chave emitida sem linha (`notification-dispatch.service.ts:1723-1726` só dá `warn`) | P11/P12 |
| `Notification.relatedEntityType='TRUCK'`, `metadata.fieldName`, `actionUrl` | `schema.prisma:2921-2961`; `task.listener.ts:271`; `truck.service.ts:568,579-582` (URLs fixas no formato expo-router, remapeadas no app: `notification_router.dart:162,253,286`) | manter | — |
| Contextos de arquivo `truckVinPlate`, `implementMeasurePhotos` (pasta "Traseiras"), `tasksLayouts`, `quote-layouts`, `taskProjectFiles` | `files-storage.service.ts`, `file-organization-scheduler.service.ts:58,66,137,409-415`; app `task_form_screen.dart:933-934` | manter os velhos como alias; novos `implementVinPlate`, `implementLayouts`, `implementProjectFiles`; `quote-layouts` → 400 | P12 |
| JSON do snapshot de assinatura: `truck` (v1/v2), `vehicles[].category/implementType` (v3+), `layoutFileIds`; chaves de diff `truckPlate/truckChassis/truckCategory/truckImplement` | `quote-snapshot.service.ts`, `quote-diff.ts:658-750` | **chaves congeladas para sempre**; o `build()` lê do novo e escreve no velho; `layoutFileIds` da arte dos implementos na v7, `layoutCoverage` condicional; G11 | P11/P12 |
| `EnvelopeDocument.sections` com `'LAYOUT'` / `variantKey` (35 completos, 2 "sem LAYOUT", 2 `VEHICLE+LAYOUT` no clone) | `quote-sections.ts:36-65`; `schema.prisma:8376-8378` | `LAYOUT` fica em `QUOTE_SECTIONS` e continua alternável; MARKETING continua assinando (D-14) | — |
| `Preferences.dashboardLayoutWeb/Mobile` (filtros `truckCategories`, `implementTypes`, `hasTruck`, `hasLayouts`/`hasArtworks`; colunas `truckCategory`, `implementType`, `hasLayouts`) | web `dashboard/widgets/task-table.tsx:395-461,1318-1338`; fallback **total** em `dashboard/components/widget-tile.tsx:130-133`; seed que gravou em todos: `prisma/scripts/seed-dashboard-defaults-and-message-20260508.ts:103-128` | migrador lazy por versão no cliente **e** script idempotente que traduz o JSON no banco (na migração ou logo depois) | P21 |
| `Preferences.tableConfigsWeb/detailConfigsWeb` (ids `truckCategory`, `implementType`, `truckSpot`, `plate`, `chassisNumber`, `vinPlate`, `layouts`, `layout`) | reconciliação tolerante (`use-table-state.ts:68-76`) | ids **estáveis** (renomear só o rótulo) | P21 |
| `AttentionAck.ruleId` (`task.entry-without-{chassis,plate,vin-plate-photo}`), `entityType` string; `ATTENTION_ENTITY_TYPES` com `'TRUCK'` | `schema.prisma:2994-3008`; web `rules.ts:210,235,261`; app `attention_rules.dart:175,196,220` | **ids das regras mantidos** (id novo zera a soneca e o "visto"); só os predicados mudam | P11/P21/P24 |
| URLs de filtro/favoritos (`hasTruck`, `hasLayouts`, `truckCategories`, `truckIds`) | web `list/filter-utils.ts:213-215`, `history/filter-utils.ts:184-410` | leitura aceita o nome antigo por um tempo | P21 |
| React Query: `truckKeys`, literal `["trucks","detail",id]`, `["implementMeasures","truck",id]` | `hooks/common/query-keys.ts:761`; `use-implement-measure.ts:13,151` | trocar o store **e** os literais (senão a tela fica velha depois de salvar, sem erro) | P20 |
| `PaintingStrategyRule` `IMPLEMENT_DEFAULTS.params.rearDoorCount: 2` | `src/scripts/seed-painting-config.ts:243-252` | o motor de pintura passa a ler `rearDoorLeaves` quando houver (oportunidade; enquanto isso, erra a traseira tripartida) | fora |
| Tipos Postgres `"TruckCategory"`→`"ImplementCategory"`, `"ImplementType"`, `"TRUCK_SPOT"` | valores gravados em implemento, snapshot, changelog, preferência, URL | **nenhum VALOR muda**; acrescentar valor é seguro se os 9 mapas de rótulo crescerem juntos (teste de exaustividade, G5) | P05 |
| Os 6 vocabulários de face (colunas `*SideMeasureId`; rota `left/right/back`; multipart `*Side`; cotador `MOTORISTA/SAPO/TRASEIRA`; portal `esquerda/direita/traseira`; projeção `left/right/back`; rótulo Motorista/Sapo/Traseira; pintura `LEFT_SIDE/RIGHT_SIDE/BACK/FRONT`) | §1 | **a frente entra em todos de uma vez**, derivada de um mapa único por repositório (`ImplementFace`); nunca `rear`. ⚠️ Na API, `left = Motorista` (`implement-measure.service.ts:128-130`); a memória do Studio diz "`right`=motorista" para a geometria 3D. Conferir antes de desenhar a frente | P04/P11 |
| `ChangeLog TASK/serialNumber` (113 linhas), `TaskFieldChangeLog.field = 'serialNumber'` (104), 953/1.818 `oldValue/newValue` com a string `serialNumber` dentro do JSON | `task.service.ts:6475-6500,11290,12117-12160`; `signature-envelope.service.ts:7907-7927` (datas do aditivo) | **não reescrever**; gravar a série nova sempre como `TASK/serialNumber` (S-5), qualquer que seja o caminho (tarefa, portal, rollback) | P11 |
| `NotificationConfiguration.key = 'task.field.serialNumber'` (1), 60 `templates` com `{{serialNumber}}`, 37 `UserNotificationPreference.eventType = 'task_serialNumber'` | seed `prisma/scripts/seed-notification-configs.ts` (244 usos) | chave e variável **mantidas**; o contexto continua entregando `serialNumber` (G22) | P11 |
| `SignatureEnvelope.quoteSnapshot` com `vehicles[].serialNumber` (35 com a string; 12 na forma v1/v2 `task.serialNumber`) | `quote-snapshot.service.ts:94-110,176-182,492-499` | **intocável**; o builder lê do implemento e grava a mesma chave; cópia byte a byte na M1s | P11 |
| `Preferences.dashboardLayoutWeb` (5 de 7 com `columns`/`sorts` `serialNumber`), `detailConfigsWeb` (3 de 3, `fieldOrder`/`fieldVisibility` com `serialNumber`, `cut-detail.task`), `tableConfigsMobile` (1: `production-agenda.order` com `serialNumber`/`identifier`), `tableConfigsWeb` (4: `identificador`) | `web dashboard/widgets/task-table.tsx:375,427,710,1321,3588,1612-1637`; `components/ui/detailpage/use-detail-layout.ts:187-245`; app `lib/features/list/layout_prefs.dart` | ids **fixos** (`serialNumber`, `identificador`, `serialNumberOrPlate`, `taskSerialNumber`); muda só o `render` e o `ORDER_BY_PATH_MAP` | P21/P24 |
| Valores de `BudgetStatus` gravados: `Budget.status`; `ChangeLog TASK_QUOTE/status` (`PENDING→BUDGET_APPROVED` 283, `BUDGET_APPROVED→PENDING` 24, `REQUESTED→PENDING` 5, `PENDING→SIGNED` 1, `IN_NEGOTIATION→PRE_APPROVED` 1); `Preferences.dashboardLayoutWeb` com `quoteStatuses` (5, 1 com `PENDING`) e `dashboardLayoutMobile` (1); URLs de filtro (`filters=`); config da estatística (`collection.tsx`, sem peneira) | `08` §1.9; `09` F4, F9 | os 5 valores de produção **não mudam de sentido** (Modelo C); `PRE_APPROVED` sai (0 linhas; mapa de legado para o histórico); peneira em todo filtro salvo (G31) | P14/P22 |
| Capacidade `PRE_APPROVE` no JSON `capabilities[]` do portal; rota `/pre-aprovar`; `waitingOnMe.preApproval` | só na branch (nunca foi a produção, conferido) | renomeados **agora** (D-35) | P13b/P14 |
| SQL cru e catálogo por nome físico | `paint.service.ts:507,510`; `file-reference.service.ts:75,86,102-107`; `scripts/audit-file-placement.ts:51-69,99,121`; `scripts/dry-run-file-organization.ts:119` | atualizar no mesmo commit de M1 | P11 |
| Cache do catálogo de FKs em `FileReferenceService` pelo tempo de vida do processo (`:287-297`) | entre `migrate` e restart o processo velho consultaria `"Truck"` | a API fica **parada** na migração (§4.7) | P30 |

### 6.9 Testes que quebram (e devem quebrar) ou precisam ser reescritos

| Repo | Teste:linhas | Por quê | Pct |
|---|---|---|---|
| api | `tests/task-match-integration.test.ts:94,141` | `prisma.truck.deleteMany/create` | P11 |
| api | `tests/painter-nfse.test.ts:873,890,900,961` | fixture `truck{category,implementType}`; texto "Bitruck Refrigerado" (muda se o rótulo fiscal mudar) | P05/P11 |
| api | `tests/nfse-discriminacao.test.ts:39,103,108`; `tests/nfse-line-scale.test.ts:83`; `tests/boleto-informativo-cobertura.test.ts:51` | `vehicles[].implementType`, `category`, fixture `truck` | P05/P11 |
| api | `tests/quote-list-query.test.ts:185-186,248-253` | include `truck` em budget | P11 |
| api | `tests/quote-diff.test.ts:60,303-383` | snapshot `truck`, chaves `truckPlate/Chassis`. **Não devem mudar** (as chaves ficam); ganham casos de `layoutCoverage` condicional (uniforme → sem chave → hash igual; não uniforme → chave) e de "Arte aprovada" por veículo | P12 |
| api | `tests/quote-merge-rules.test.ts`; `tests/dossier-signed-trail.test.ts`; `tests/signature-refusal.test.ts:123,226-233` (`quoteLayoutId`) | aviso LAYOUT na união; trilha; layout no orçamento | P12 |
| api | `tests/quote-vehicle-share.test.ts` | veículo do orçamento | P11 |
| api | `tests/portal-identificacao.test.ts`, `tests/portal-recorte.test.ts` (guarda as DUAS tabelas-verdade, assinatura × tela, e falha se alguém as unificar: ganha a coluna `APPROVE_ARTWORK`), `tests/portal-requisicao.test.ts` | medidas, recorte, requisição | P13 |
| api | `tests/e2e-portal/cenarios/01-requisicao-com-medidas.ts:27-35,97,117-140,117-160,179,208-227` | `truck.select.*SideMeasure`; `identity.measures` | P13a |
| api | `tests/e2e-portal/cenarios/03-portao-compras.ts:157-169`; `04-verdade-da-espera.ts:79` | montam `layoutFiles: { connect }` porque "a emissão o exige" → **reescrever**: o portão passa a ser valor aprovado ∧ arte `APPROVED` do implemento (E1/E2) | P12/P14 |
| api | `tests/e2e-ui/fase1..6`, `check-faturamento-separado`; `tests/e2e-ui/helpers/ui.ts:138-205` ("Layout Aprovados", `layoutFile`); `fase3-assinatura.ts:93-291` (seção LAYOUT no PDF) | rótulo "Truck" na tela; R1 (o passo de "Layout Aprovados" sai); `fase3-assinatura` continua esperando a seção LAYOUT no PDF, agora com a arte do implemento e legenda por veículo; o fluxo passa a aprovar valor e arte antes de emitir | P12/P14/P30 |
| web | `src/lib/attention/engine.test.ts:43,132-176,160,171,245,333` | fixtures `truck` | P21 |
| web | `src/utils/billing-coverage.test.ts:44-47` | `truck: { plate }` | P22 |
| web | `src/components/cliente/solicitacao/solicitacao-schema.test.ts:21-30,70,138-330 (330 espera chaves exatas ["medidas","serialNumber"]),379,472-570` | frente, porta, `type`, `medidasIntocadas` | P23 |
| web | `src/utils/quote-layout-coverage.test.ts` e `src/utils/quote-layout-coverage.ts` (vieram da `main` no P00, DD6) | morrem com o seletor de layout por veículo no P22 (a arte vem do implemento); a API mantém a sua `quote-layout-coverage.ts` para `describeVehicleList`/`layoutGateFailure` (E2) | P22 |
| web | `src/pages/tools/truck-studio/engine/project/file.spec.ts`, `tools/verify-manifests/catalog-resolves.test.ts` | "truck" do Studio | sem impacto |
| app | `test/task_detail_include_test.dart:13-42` (espelha **à mão** `INCLUDE_WHITELIST.Task` e `getEntityTypeFromField`) | passa a ler o JSON gerado pela API (G5) | P24 |
| app | `test/features/production/implement_measure_test.dart`; `test/features/garages/garage_geometry_test.dart`, `garage_screen_test.dart`; `test/core/attention/attention_engine_test.dart`, `test/features/attention_surfaces_test.dart`; `test/features/financial/covered_vehicles_test.dart`, `billing_approval_blockers_test.dart`, `billing_row_test.dart`, `nfse_discriminacao_test.dart`, `budget_suggestion_test.dart`; `test/features/navigation/menu_gates_test.dart`; `test/shared/pdf/document_money_encoding_test.dart` | fixtures `truck`, faces, rótulos da nota, sugestão | P24 |

Nenhum teste cobre hoje `truck.controller`, `implement-measure`, posicionamento na garagem, os escritores de medida da `task.service`, `task-edit-form`, `task-create-form`, `AdvancedBulkActionsHandler`, `ImplementMeasureForm`, `use-implement-measure` nem `DETAIL_INCLUDE`. Os testes novos estão no §8.

### 6.10 Seeds, scripts e documentos

| Arquivo | Muda | Pct |
|---|---|---|
| `api/prisma/scripts/seed-notification-configs.ts:182-200,6033-6073,7157-7545,8479-8519,8885-8930` | títulos e corpos "Implemento"; chaves novas no mesmo prefixo; `layout.portal_pending_approval`; `--dry-run` antes | P12 |
| `api/prisma/scripts/seed-dashboard-defaults-and-message-20260508.ts:103-128` | presets com as chaves novas (o script de tradução do §6.8 cuida dos já gravados) | P21 |
| `api/src/scripts/seed-painting-config.ts:243-252` | (oportunidade) `rearDoorCount` pela porta real | fora |
| `api/scripts/seed-portal-demo.ts` | criar implemento com arte `PENDING_APPROVAL`, 4 faces e porta para a demo do portal | P13b |
| `api/scripts/{audit-file-placement.ts:26,51-69,99,121, dry-run-file-organization.ts:119, verify-signature-sections.ts, verify-signature-layout.ts, test-signature-seal.ts, test-signature-document.ts, test-late-slots.ts, check-layout-dimensions.ts}` | nomes físicos, `quoteLayoutId`, seção LAYOUT; o cotador com a FRENTE | P11/P12 |
| `api/src/scripts/{purge-test-task-d013bc8b.ts, nfse-diagnose.ts, audit-painter-nfse-setup.ts}` | `truck`→`implement` | P11 |
| `api/docs/PORTAL-CONTRATO.md`, `PORTAL-DO-RESPONSAVEL.md`, `BUDGET-SIGNATURE-DESIGN.md`, `REESTRUTURACAO_ORCAMENTO_FATURAMENTO.md` e os demais que citam truck (18 docs) | contrato novo; ADR local "Arte é do implemento, o responsável a aprova no portal **antes** da emissão, e a assinatura a congela" — **converge** com o ADR 0121 do monorepo ("a assinatura aprova o layout") na parte da assinatura e **acrescenta** a aprovação prévia por implemento; ADR local "Aprovação do valor e eixo da assinatura (Modelo C)" | P12/P13/P14 |
| `mobile-flutter/README.md`, `SHOREBIRD_DEPLOY.md` | processo do 426 e da versão mínima | P02 |

⚠️ `api/tsconfig.json:57` inclui `src` e `test`, **não** `tests/` nem `scripts/`. Esses arquivos rodam em `tsx` sem checagem de tipo e só quebram quando alguém os executa. G14 inclui os dois.

### 6.11 Código morto: apagar em vez de migrar

| Repo | Arquivo | Evidência |
|---|---|---|
| api | `src/schemas/task.ts:634-1094` (`taskSelectMinimal/…/History`) | ninguém importa fora do arquivo |
| api | `src/modules/production/task/task.service.ts:12475-12510` (`calculateTruckWidth/Length`) | sem chamador |
| api | `src/modules/production/task/task.controller.ts:880-887` (`POST :id/upload/layouts`) | responde 400 "obsoleto" |
| api | `src/utils/garage-layout.ts` | sem importador na API |
| api | `src/schemas/truck.ts:535-568` | batch/get sem rota |
| web | `components/production/implement-measure/implement-measure-selector.tsx`; `components/production/task/implement-measure/implement-measure-selector.tsx` + `index.ts`; `hooks/administration/use-implement-measure-list.ts` (confirmar) | sem uso |
| web | `hooks/production/task/use-task-form-url-state.ts` | sem chamador |
| web | fallback "old API version" em `hooks/administration/use-implement-measure.ts:66-96` | a API já devolve as seções |
| web | `api-client/services/implementMeasureSection.ts` | rota inexistente na API |
| web | `utils/invoice-pdf-generator.ts`; `components/production/task/quote/budget-pdf-export-dialog.tsx`; `components/financial/billing/steps/billing-step-task.tsx` | nenhum import |
| app | `lib/features/production/budget_report_pdf_generator.dart`; `lib/shared/pdf/pdf_layout_rasterizer.dart` | sem chamador |
| api | `POST /tasks/bulk/upload-files` (`task.controller.ts:413`) + `task.service.ts:13161-13260` (`bulkUploadFiles`) + `src/schemas/task-bulk.ts:79` (`fileType: [… 'layouts']`) | nenhum chamador no web nem no app (auditoria §13); era o único caminho que criava arte `APPROVED` sem aprovador |
| api | `src/schemas/layout.ts` (include de `Layout` com a relação fantasma `task`; `Layout` tem `tasks`) | nenhuma rota usa; só os tipos. Apagar ou gerar do DMMF (G1) (auditoria §13) |
| web | `components/production/task/bulk-operations/BulkOperationsSimplified.tsx` + `SimpleBulkActionsTest.tsx` ("Adicionar Layout Referência") | só se importam um ao outro (auditoria §13) |
| web | `components/production/task/schedule/duplicate-task-modal.tsx` | `DuplicateTaskModal` não é importado (Revisão 2, `11` §8) |
| api | ramos "cria o caminhão se não existir" (`task.service.ts:1326,2654,8806,14213,14239,14365`; `portal-identity.service.ts:545-570`) e "sem caminhão" (`src/utils/task.ts:374`; `task.service.ts:11757,12253,12409`) | inalcançáveis com a DD1 (`10` §5.2, §5.4) |
| api | `src/modules/people/portal/portal-decision.service.ts:251-296` (fabricar `BudgetRequest` para orçamento interno) | a aprovação do valor mora em `BudgetValueApproval` (D-35) |

### 6.12 Lacunas achadas pela auditoria de completude (§13), já com destino

Arquivos (ou trechos de arquivos já citados) que o plano não cobria. Cada linha entra no pacote indicado com o mesmo peso das tabelas acima.

**API**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `src/modules/common/file/repositories/file-prisma.repository.ts:73-74` (`mapIncludeToDatabaseInclude` repassa `include.layouts`), `:114-120` (`getDefaultInclude()` pede `layouts: { select: { id, status } }` em **toda** leitura de File por este repositório) | relação to-one `File.layouts` | `artLayouts` (lista), ou sair do include padrão. Com o rename de D-08 e o build que emite com erro de tipo (`noEmitOnError: false`), toda leitura de arquivo por esse repositório vira 500 | P12, no mesmo commit do schema (P10) |
| `src/schemas/file.ts:16` | include `layouts: z.boolean()` | `artLayouts` | P12 |
| `src/modules/production/task/task.service.ts:10281-10300` (`findById`) e `:10386-10400` (`findMany`) | **filtro por papel**: fora de COMMERCIAL, DESIGNER, LOGISTIC, PRODUCTION_MANAGER e ADMIN, só aparecem layouts `APPROVED` | o mesmo filtro sobre `implement.layouts` e no sintetizador legado de `task.layouts`. Sem ele, a PRODUÇÃO passa a ver, calada, arte `DRAFT`, `PENDING_APPROVAL` e `REPROVED` pelo include novo | P12 |
| `task.service.ts:10421-10475` (`migrateTaskFilesOnCustomerChange`) e `:10541-10640` (`migrateTaskFilesToCustomerFolder`) | ao trocar o cliente, move base, projeto e `layouts` (e as artes da aerografia) para a pasta do cliente novo | incluir `implement.layouts.file`, `implement.projectFiles` e `implement.vinPlate`. Senão a arte e o projeto da Furgões ficam na pasta do cliente antigo (D-24) | P12 |
| `task.service.ts`, sítios de `layouts`/`layoutIds` que não estavam citados por linha: `create` 1127-1248, 1500-1526, 1677, 1843; `batchCreate` 2012-2035; `update` 2453, 3510-3555, 5679-6068, 6341-6453, 6882-6902, 7372, mais os includes `layouts: true` do snapshot de changelog em 4489, 4567, 4637, 4692, 4780, 4861, 5196 e 5267; `batchUpdate` 7499-7524, 7722-7872, 8006-8352, 8537-8564 (validação final que **lança** "layout ID(s) don't exist"), 9011-9040, 9784 e o include de 8225; `rollbackFieldChange` 11427, 11499; `copyFromTask` 13637-13834 | caminho da arte pela tarefa | **todos** saem, ou passam pelo tratamento legado do §5.2 (no-op/400) **antes** de qualquer um deles. Com `Task.layouts` fora do Prisma, cada `layouts: true` vira 500 em runtime (o build emite mesmo assim). `layouts` entra no padrão da catraca G6a | P12 |
| `src/modules/common/notification/task-notification.service.ts:37,52,101` (`TaskField.ATTACHMENTS = 'layouts'`, rótulo "Anexos", chave `task.field.layouts`) + `src/modules/common/notification/tests/task-notification.service.spec.ts:25,114-123,194` | detecta a mudança por diff de `task.layouts` | sem `Task.layouts` a notificação de anexo morre calada. Ligar aos eventos de arte do implemento e/ou a `projectFiles`, manter a chave `task.field.layouts` (D-04) e ajustar o spec | P12 |
| `src/modules/production/task/layout.listener.ts:94-109,147-164,205-222` | `relatedEntityType: task ? 'TASK' : 'ARTWORK'` | o evento novo carrega `implementId`, e o listener resolve `implement.taskId` **sempre**. Se cair no ramo `'ARTWORK'`, o app (`notification_router.dart:357-366`) abre `/producao/cronograma/detalhes/<id da arte>`, uma tarefa que não existe | P12 |
| `src/modules/production/layout-dimensions/engine/types.ts:61,69-71`; `engine/faces.ts:33-67`; `engine/doctrine.ts:292-315` ("NA TRASEIRA A ALTURA SAI SEMPRE DO TETO") | `PanelSide` do **motor** do cotador (a API tem o seu, além do web) | `"FRENTE"` no tipo e regra de altura da frente (provavelmente a mesma `rearFromTop` da traseira); bench antes (risco 21) | P11 |
| `src/modules/production/task/task.events.ts:60-62` | evento sintético `truck.implementMeasure` com resumo "Motorista/Sapo/Traseira" | + Frente e porta traseira | P11 |
| `src/modules/production/implement-measure/repositories/implement-measure.repository.ts:6-14` (interface `findByTruckId` com 3 faces); `src/modules/production/truck/truck.module.ts`; `src/app.module.ts:80-82,186-188` | interface e DI | `findByImplementId` (4 faces); `ImplementModule`; o boot test pega a DI | P11 |
| `src/schemas/index.ts:116` | `export * from './truck'` | `./implement`. (`src/utils/index.ts:89` → `utils/truck.ts` é `TRUCK_MANUFACTURER`: fica) | P11 |
| `src/modules/production/budget/repositories/budget.repository.ts:47-53` | interface da sugestão com `implementType` | `type`, junto com `budget.service.ts:5439,5661` | P11 |
| `src/modules/domain/dashboard/repositories/dashboard/dashboard.repository.ts:195` | `abstract getTruckMetrics()` | acompanha o `dashboard-prisma.repository.ts` (chaves do contrato mantidas na janela) | P11 |
| `src/modules/people/portal/portal-request.controller.ts:84` + `portal-request.service.ts:126,909-950` | o recibo da requisição devolve `truckId` | `implementId` (+ `truckId` espelhado na janela), casando com `web api-client/portal.ts:1016-1024` | P13a |
| `src/constants/service-descriptions.ts:183-191,286` (espelho: `web/src/constants/service-descriptions.ts:191-192,305`) | descrições das O.S. de ARTE, com "Elaborar Layout" como padrão | vocabulário do glossário (DD5); "Aprovar com o Cliente" é a O.S. que o portal conclui, e o portão fica na regra de liberação (DD3) | P12/P21 |
| `src/types/layout.ts:23,69,83,90` | `status: 'DRAFT' \| 'APPROVED' \| 'REPROVED'`. A linha do plano sobre `types/layout.ts` era só a do web | 5 estados, derivados de `$Enums` | P12 |

**WEB**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `components/production/task/layout/layout-status-badge.tsx:18-40`, `layout-status-selector.tsx:32-60` (só COMMERCIAL/ADMIN aprovam), `layout/index.ts`; `components/production/task/form/layout-file-upload-field.tsx` | selo e seletor de 3 estados, **compartilhados** por tarefa, orçamento (`budget-step-task.tsx`, `[taskId].tsx`, `approved-layout-picker.tsx`), lote (`AdvancedBulkActionsHandler.tsx`) e **aerografia** (`airbrushing-form.tsx`, `multi-airbrushing-selector.tsx`, `airbrushing/detail-page/airbrushing-files-section.tsx`, `task/detail/sections/airbrushings-section.tsx`) | a arte do implemento ganha selo próprio de 5 estados (hoje `getLayoutStatusVariant` manda o valor desconhecido para "default"). O seletor livre **fica só para a aerografia** e nunca oferece `PENDING_APPROVAL`/`SUPERSEDED`. Tarefa e orçamento deixam de importá-los | P21/P22 |
| `components/common/file/file-card-upload-field.tsx:54-68,101,295,340`, `file-upload-field.tsx:275`, `file-uploader.tsx:20` | tipo `status?: 'DRAFT'\|'APPROVED'\|'REPROVED'` escrito à mão; cartão "Layout Aprovado" do orçamento | tipo gerado (G5) com 5 estados; o cartão do orçamento morre com o R1 | P20/P22 |
| `components/production/task/list/task-export.tsx:73,186` (não é o `history/task-export.tsx`) | exportação da LISTA: "tem layout" por `task.layouts?.length` | "Arte aprovada: Sim/Não" por `implement.layouts`, com o include junto | P21 |
| `components/production/task/detail/service-orders-section.tsx:61-79`; `form/service-selector-auto-grouped.tsx:563,659,771-785`; `form/designar-service-order-dialog.tsx:154`; `utils/permissions/service-order-permissions.ts:179-242` | máquina de estados da O.S. de ARTE na tela (Admin leva `WAITING_APPROVE` → `COMPLETED`) | refletir D-15/DD3 (corrigido pela auditoria §14: o portão é da **liberação**, não da O.S.): "Concluir" continua disponível; quando a O.S. de ARTE conclui e a arte do implemento não está aprovada (trabalho novo), a tela avisa "a tarefa só vai para produção quando a arte for aprovada pelo cliente" e mostra o selo da arte (sem dispensa, DD9) | P21 |
| `pages/cliente/solicitar.tsx:170-182` | valor inicial do veículo da requisição (`implementType: null`, medidas) | `type: null`, `frente: null`, `portaTraseira: null` (sem valor de partida, mesma regra) | P23 |
| `pages/production/root.tsx:72,484` | `includeTrucks: true`; `truckMetrics.trucksInProduction` | nomes novos com espelho (a API mantém as chaves na janela, §6.1) | P21 |
| `utils/file-relationship.ts:18` | `taskLayouts: { entityType: TASK, "layouts da tarefa" }` | `implementLayouts` ("arte do implemento") + `implementProjectFiles` | P20 |
| `hooks/common/use-column-widths.ts:173` | largura pelo id de coluna `truckCategory` | fica, se o id da coluna ficar estável (§6.8); se ele mudar, muda junto | P21 |
| `components/production/garage/index.ts:2,6`; `dashboard/widgets/production-calendar.tsx:32,514` | exportam/usam `TruckDetailModal` e `GarageTruck` | só o rename do modal (o "Layout" de `:743` é layout de tela) | P21 |

**APP**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `lib/features/files/layout/layout_dimensions.dart:15-21` (ficou fora da varredura porque não cita nenhum dos identificadores) | `enum PanelSide { motorista, sapo, traseira }`; `_sideFrom` com `_ => PanelSide.motorista` | **o app instalado desenharia a FRENTE como "Motorista", sem erro.** P11: o cotador só devolve painel `FRENTE` para `X-App-Version` ≥ P24, ou a face vai num campo que o app velho ignora (decidir no P11). P24: `frente` no enum e fim do fallback silencioso | P11/P24 |
| `lib/features/production/linked_task_card.dart:15-23,82` | identificador `serialNumber \|\| t.truck?.plate` | `implement` | P24 |
| `lib/features/files/app_file.dart:35-38` | `status` do Layout achatado (3 valores) | aceitar os 5 (o sintetizador manda `DRAFT` ao app velho; o novo lê o valor real) | P24 |
| `lib/features/dashboard/presets/presets.dart:70-79` | presets do DESIGNER `sem_artes`/`com_artes`, com os títulos "Sem Layouts"/"Com Layouts" | títulos novos e as variantes do `tasks_widget.dart` (§6.7) | P24 |
| `lib/features/production/task_permissions.dart:255-280` | transições da O.S. de ARTE no app ("Enviar para Aprovação", `WAITING_APPROVE`) | refletir D-15/DD3 como no web (aviso da liberação travada; "Concluir" continua disponível) | P24 |
| `lib/features/list/list_scaffold.dart:111-121` | doc de `attentionSnapshot` com o exemplo `{'truck': {'plate': …}}` | exemplo com `implement` (o código real está em `task_schedule_view.dart:77-87`, que o plano já cobre) | P24 |

**Testes que estas lacunas exigem** (somam-se ao §10.1): (a) P12: a PRODUÇÃO pede `implement.layouts` e recebe só `APPROVED`; (b) P12: excluir uma aerografia não apaga a arte de implemento que use o mesmo File; (c) P12: trocar o cliente da tarefa move a arte e o projeto do implemento de pasta; (d) P12: evento de arte aprovada no portal gera notificação com `relatedEntityType='TASK'` e o id da tarefa; (e) P11/P24: o app na versão instalada não recebe painel `FRENTE` do cotador (ou o ignora); (f) P12/P21/P24 (reescrito pela auditoria §14): concluir a O.S. de ARTE de trabalho novo sem arte aprovada **não** leva a tarefa a WAITING_PRODUCTION e a tela diz por quê; aprovar a arte depois libera a tarefa sem outro clique.

### 6.13 Número de série → implemento (DD1): todos os pontos, por repositório

Fontes: `10-serie-api.md` §2–§6 (API) e `11-serie-clientes.md` §3–§8 (web e app). Coluna **Quando**: **R-B** = muda no deploy da M1s (escritores, unicidade, semântica); **P28** = leitor migra sob a catraca G24 entre R-C e R-D (funciona pelo espelho até lá); **—** = não muda (DTO montado pelo servidor ou chave gravada). Classes do `10` §2.1: A banco, B escritor, C unicidade, D `where`, E busca/SQL cru, F `orderBy`, G `select` explícito, H rótulo com recuo, I assinatura, J changelog/notificação por campo, K notificação/WhatsApp, L portal, M faturamento/fiscal/painel, N permissão.

**API — banco, escritores, unicidade e semântica (R-B, pacote P11 salvo indicação)**

| Classe | Arquivo:linha | Hoje | Muda |
|---|---|---|---|
| A | `prisma/schema.prisma:2343` | `Task.serialNumber String? @unique` | espelho sem `@unique` (§3.1) — P10 |
| A | `prisma/schema.prisma:2440` | `Task.serialNumberNormalized` (gerada) | fica até M5s — P10 |
| A | `prisma/migrations/0_init/migration.sql:1160,2623` | coluna e `Task_serialNumber_key` | índice cai na M1s — P10 |
| A | `prisma/migrations/20260624150000_accent_insensitive_search/migration.sql:254,365` | gerada + GIN da tarefa | mesma forma no implemento (M1s); a da tarefa cai na M5s — P10 |
| A | `src/modules/common/prisma/prisma.service.ts:268-272`, `:313-316` | `omit.task.serialNumberNormalized`; `omit.truck` | + `omit.implement.serialNumberNormalized` (a chave `truck` vira `implement` no commit do rename) |
| B (W1) | `src/modules/production/task/repositories/task-prisma.repository.ts:915,960` (`mapCreateFormDataToDatabaseCreateInput`) | `taskData.serialNumber = serialNumber` | `taskData.implement = { create: { …, serialNumber, spot } }` **sempre** |
| B (W2) | `task-prisma.repository.ts:1234,1274` (`mapUpdateFormDataToDatabaseUpdateInput`) | `updateData.serialNumber = serialNumber` | `updateData.implement = { update: { serialNumber } }` |
| B (W3) | `src/modules/production/task/task.service.ts:1152-1164` → `:1869-1925` (`createTasksFromSerialRange`, `:1909`) | `taskData.serialNumber = String(serialNum)` → `batchCreate` | igual na forma; passa por W1 |
| B (W4) | `src/modules/people/portal/portal-request.service.ts:874-906` (`criarVeiculo`, `:880`, `:895-904`) | `tx.task.create({ data: { serialNumber, …, truck: { create } } })` sem `spot` (nasce YARD_WAIT) | `implement: { create: { serialNumber, …, spot: null } }` — P13a |
| B (W5) | `src/modules/people/portal/portal-identity.service.ts:523-534` (`gravar`) | `tx.task.update({ data: { serialNumber } })` + `auditar(TASK, 'serialNumber')` | `tx.implement.update(...)`; o `auditar` continua `TASK` (S-5); o bloco "o caminhão pode não existir" (`:545-570`) vira código morto e sai — P13a |
| B (W6) | `task.service.ts:12117-12160` (rollback genérico; conversão `:11290`) | `updateWithTransaction(tx, id, { serialNumber: old })` | passa por W2 **com checagem de unicidade antes** (hoje o conflito vira P2002 → 500) |
| B | `task.service.ts:10918-10934` (rollback de entidade TRUCK) | `tx.truck.update({ [field]: old })` sem unicidade | não se aplica à série com S-5; se alguém auditar a série como TRUCK, este ramo grava sem checagem |
| B (scripts) | `src/scripts/seed-test-billing-task.ts:115-120`; `scripts/seed-portal-pagamento-demo.ts:150`; `scripts/test-signature-e2e.js:131`; `scripts/test-signature-deletion.js:105`; `scripts/make-real-signature-test.js:109`; `src/scripts/nfse-homolog-test.ts:105`; `src/scripts/setup-painter-nfse-test.ts:162` | `task.create` direto, a maioria sem `truck` | criar o implemento aninhado (sem isso, o COMMIT falha: desejado) — P26 |
| B (testes) | `tests/task-match-integration.test.ts:127-143,651-696`; `tests/billing-entity.test.ts:84`; `tests/orcamento-faturamento-a-db.test.ts:67` | `task.create({ serialNumber, serialNumberNormalized: norm(serial) })` (grava a gerada à mão: banco de `db push`) | implemento aninhado; banco por migração (G25) — P26 |
| C | `task.service.ts:10774-10784` (`validateTask`) | `task.findFirst({ where: { serialNumber, id: { not } } })` → 400 | `implement.findFirst({ where: { serialNumber, taskId: { not } } })` |
| C | `portal-identity.service.ts:406-428` (`garantirUnicidade`) | idem com `conflicts[]` | idem no implemento — P13a |
| C | `portal-request.service.ts:772-795` | `task.findMany({ where: { serialNumber: { in } } })` | `implement.findMany(...)` — P13a |
| C | `portal-request.service.ts:1119-1150` (`traduzirErro`) | P2002 com `meta.target` ⊇ `serialNumber` → 400 nomeado | continua (o nome do campo não muda) |
| C | `src/schemas/portal-request.ts:558-620` (`colisoesNoPayload`) | duplicata no próprio corpo | sem mudança |
| C | `src/common/filters/global-exception.filter.ts:83-107` | mapa P2002 sem `serialNumber` → mensagem genérica | + `serialNumber: 'Este número de série já está em uso.'` — P01 |
| semântica | `task.service.ts:2562-2645` + `task-prisma.repository.ts:1452-1455` (`truck: null` apaga o caminhão e grava `ChangeLog TRUCK/DELETE`) | apaga | **400** (§5.2); o `taskTruckSchema.nullable()` (`schemas/task.ts:2553-2580`) deixa de aceitar `null` |
| semântica | `task.service.ts:1326`, `:2654`, `:8806`, `:14213`, `:14239`, `:14365`; `portal-identity.service.ts:557` | "cria o caminhão se não existir" | trocar por `update`, apagar o ramo |
| semântica | `task-prisma.repository.ts:1061-1074` (`if (truck)`), `:1488-1495` (`upsert`) | cria só com `truck` | cria sempre (W1); o `create` do `upsert` fica inalcançável |
| semântica | `task.service.ts:2062-2070` (batch: `tx.truck.findUnique … if (truck)`) | pós-criação de medida | o `if` vira sempre verdadeiro |
| semântica | `src/utils/task.ts:374`, `task.service.ts:11757,12253,12409` (`if (!task.truck)`) | ramo "sem caminhão" | inalcançável; apagar sob G6a |
| semântica | `src/schemas/task.ts:1488-1493` (filtro `hasTruck`) | tem ou não caminhão | `true` = todas, `false` = nenhuma: trocar por "Implemento identificado" (série ∨ placa ∨ chassi) [pergunta 18] |
| N | `src/modules/production/task/task.permissions.ts:10` | `identity: ['name','details','customerId','serialNumber','chassis','serialNumberFrom','serialNumberTo']` | vale para a chave de topo (legado); `implement.serialNumber` exige `identity` **além de** `implement` (G7) |
| N | `src/modules/production/truck/truck.controller.ts:229-236` | `PUT /trucks/:id` aceita WAREHOUSE | a série **não** entra no `implementUpdateSchema` (S-9) |
| N | `src/modules/common/base/include-access-control.ts:141-147`, `:414-419` | `SELECT_WHITELIST.Task` com `serialNumber`; `validateSelect` → 403 em campo fora | manter até R-D; `Implement` com `serialNumber` na whitelist própria |
| N | `src/modules/common/pipes/zod-validation.pipe.ts:233,458,1114` | rótulo e "manter como string" pelo **nome da chave** | vale também para `implement[serialNumber]` (série só com dígitos continua texto) |
| I | `src/modules/common/signature/services/quote-snapshot.service.ts:492-499` (`serialNumber: t.serialNumber ?? null`) | lê da tarefa | lê de `t.implement.serialNumber`, **gravando a mesma chave** `vehicles[].serialNumber` (S-6) — P11 |
| I | `quote-snapshot.service.ts:94-110,176-182` (tipo `QuoteSnapshotVehicle.serialNumber`; forma v1/v2 `task.serialNumber`, 12 envelopes no clone) | chave congelada | intocável |
| I | `quote-snapshot.service.ts:553-555` (`hash(snapshot)` inteiro), `:566-655` (`materialProjection`: série **fora**) | série no hash inteiro, fora do material | nada; valor copiado byte a byte (M1s) evita `SNAPSHOT_DRIFTED` |
| I | `signature-envelope.service.ts:3836-3844, 4619, 5268, 6349` | hash inteiro diferente → só deriva cosmética | nada (G11 estendida confere 0 divergências) |
| I | `src/modules/common/signature/document/quote-html.builder.ts:69,85,124,548-561`; `src/utils/quote-tasks.ts:155` (`LATE_SLOT_FIELDS`) | lacuna tardia `serialNumber#taskId` (8ch) | chave de âncora congelada no PDF, **não renomear** |
| I | `signature-envelope.service.ts:7708-7760` (aditivo: série atual × congelada) | lê da tarefa | lê do implemento — P28 |
| I | **`signature-envelope.service.ts:7907-7927`** (`lateSlotRegistrationDates`: `ChangeLog entityId = taskId, field = 'serialNumber'`) | best-effort, sem erro | nada com S-5 (se a série fosse auditada como TRUCK, a data sumiria calada) |
| I | `src/modules/common/signature/services/quote-diff.ts:611-615,708-714,746` (`taskSerialNumber:<id>`) | diff cosmético do snapshot | nada |
| I | `src/schemas/portal-vehicle-identity.ts` + `src/modules/people/portal/portal-vehicle-identity.ts:62-67,106-112,141,151,235`; `portal-frozen-document.ts:122-170` | guarda do documento congelado (409 ao trocar série impressa) | lê o snapshot: continua |
| I | `signature-envelope.service.ts:745-755` (preflight avisa placa/chassi; série não exigida) | | nada |
| J | `task.service.ts:6475-6500` (`fieldsToTrack`: `existingTask[field]` × `updatedTask[field]`) | grava `ChangeLog TASK/serialNumber` | lê de `implement.serialNumber` e **emite** `field = 'serialNumber'` (sem isso, `undefined === undefined` e o log para calado) |
| J | `src/modules/production/task/task-field-tracker.service.ts:79,185,225-236` (`TRACKED_FIELDS`) | dispara `task.field.serialNumber` | idem (G22) |
| J | `src/utils/changelog-fields.ts:80,206,429,629,705`; `src/modules/common/changelog/utils/changelog-helpers.ts:360,565,739` | rótulos "Número de Série" | manter a chave |
| J | `src/modules/common/notification/notification-preference.service.ts:539` (`eventType: 'task_serialNumber'`, 37 preferências); `NotificationConfiguration.key = 'task.field.serialNumber'` | chave persistida | intocável |
| K | `task/task.listener.ts:125-552` (9 eventos); `cut/cut.listener.ts:91-279` (5, título/corpo com "(série)"); `task/layout.listener.ts:87-224` (3); `budget-payment.scheduler.ts:156-187`; `airbrushing-notification.service.ts:166`; `notification-template-renderer.service.ts:76-81,391,429` (`context.serialNumber \|\| context.task?.serialNumber`); `notification-dispatch.service.ts:1868,2130`; `templates/notification-template.service.ts:32-884` (10); `templates/template.types.ts:60-84`; `whatsapp/whatsapp-message-formatter.service.ts:58-161` ("*Série:* X"); `task-notification.service.ts:56`; `notification-configuration.service.ts:1180` (`{{#if serialNumber}}`) | payload `serialNumber` do contexto | o contexto continua entregando a **variável** `serialNumber` (60 templates, 244 usos em `prisma/scripts/seed-notification-configs.ts`; o `{{#if}}` esconde a ausência) — P28 com G22 |

**API — leitores (funcionam pelo espelho; migram no P28 sob G24, fiscais primeiro com G21 na frente)**

| Classe | Arquivo:linha | Forma |
|---|---|---|
| D | `src/schemas/task.ts:1271` (`taskWhereSchema`, `.strict()` `:1387`) | `serialNumber: string \| { contains }` no topo (vem dos clientes) → na forma final `{ implement: { serialNumber } }` |
| D | `src/schemas/task.ts:1347` | `truck: z.any()` (passthrough; G1) |
| D | `src/modules/common/attention/attention.service.ts:286,442` | `NO_SERIAL = { OR: [{ serialNumber: null }, { serialNumber: '' }] }` (só equivalente em `implement` porque toda tarefa tem implemento) |
| D | `portal-identity.service.ts:417`, `portal-request.service.ts:783`, `task.service.ts:10778` | igualdade / `in` (unicidade, acima) |
| D | `src/modules/people/portal/portal-read.service.ts:974` (orçamentos do portal: `tasks.some.serialNumber contains`), `:1425` (veículos do portal) | sem índice (não usa a normalizada) |
| D | `src/modules/production/purchase-order/purchase-order.service.ts:234` | `serialNumber contains insensitive` |
| D | `src/scripts/relink-orphan-nfse.ts:100-101`; `scripts/seed-portal-pagamento-demo.ts:71-72,265-266` | **`findUnique({ where: { serialNumber } })`** — quebra no tipo quando o `@unique` sai da tarefa: vira `implement.findUnique(...)` com `select: { task }` (R-B, porque o tipo quebra) |
| D | `src/scripts/fix-boletos-37438-37441.ts:31` | `invoice.task.serialNumber in` (script histórico) |
| E | `src/schemas/task.ts:1414` (`searchingFor`) | `{ serialNumberNormalized: { contains } }` |
| E | `src/schemas/budget.ts:596`; `src/schemas/customer.ts:598` | `tasks.some.serialNumberNormalized` |
| E | `src/schemas/airbrushing.ts:629`; `src/schemas/observation.ts:258`; `src/schemas/layout.ts:355` | `task.serialNumberNormalized` |
| E | `src/schemas/truck.ts:245` | `task.serialNumberNormalized` na lista de caminhões → campo do próprio implemento |
| E | `src/modules/financial/billing/billing.service.ts:695` | `tasks.some.task.serialNumberNormalized` |
| E | `src/modules/domain/search/search.service.ts:203` | busca global por token |
| E | `src/modules/financial/reconciliation/receivable-task-match.service.ts:190` | conciliação por tarefa |
| E | **`src/modules/paint/paint.service.ts:497-526`** | `$queryRaw` com `t1."serialNumber"`, `t2."serialNumber"`, `LEFT JOIN "Truck"`, `catch → []` (`:522-525`): reescrito **no commit da M1** com `"Implement"` e **sem** devolver `[]` (R-B) |
| F | `src/schemas/task.ts:1163` | `serialNumber: orderByWithNullsSchema` |
| F | `src/modules/production/task/task.controller.ts:526` | padrão `[{ forecastDate: 'asc' }, { serialNumber: 'asc' }]` em `GET /tasks/in-preparation` |
| F | `src/schemas/airbrushing.ts:232,281` | `task.serialNumber` com nulls |
| F | `src/schemas/serviceOrder.ts:107` | `task.serialNumber` |
| F | `src/schemas/budget.ts:288,328` | `task.serialNumber` aceito e **descartado de propósito** (`:318-321`) |
| F | `portal-read.service.ts:278` (`VEHICLE_ORDER_BY.serialNumber`), `portal-read.controller.ts:118` (chave pública `serialNumber`) | forma final `{ implement: { serialNumber: { sort, nulls } } }` (a de `:279` para placa já roda) |
| F | `src/types/task.ts:818` | tipo |
| G | `src/schemas/task.ts:83,639,707,928,970,1025,1063` | `select` (os de `:634-1094` são apagados no P01) |
| G | `task-prisma.repository.ts:59,119,560`; `src/utils/quote-tasks.ts:640` (`QUOTE_COVERAGE_INCLUDE`) | `serialNumber: true` |
| G | `signature-envelope.service.ts:572,8409`; `quote-snapshot.service.ts:436` (`truck: true`, escalares implícitos) | idem |
| G | `src/modules/production/budget/repositories/budget-prisma.repository.ts:632`; **`:377-393`** (repassa `tasks.select` do cliente ao Prisma: o app pede `tasks: { select: { …, serialNumber, truck: { select: { plate } } } }`) | idem; o repasse é o ponto que daria 500 "Unknown field" sem o espelho |
| G | `budget.service.ts:1414,1462,3228,3698,4064,5644` | idem |
| G | `src/modules/production/service-order/service-order.service.ts:1721,1757,1798,1834,3706,3740,3779,3813`; `service-order-prisma.repository.ts:188` | idem |
| G | `src/modules/domain/dashboard/repositories/dashboard/dashboard-prisma.repository.ts:1823,3409,3453,3493,3562,3625,3666` | idem |
| G | `src/modules/personnel-department/bonus/bonus.service.ts:1089,2884` | idem |
| G | `src/modules/integrations/nfse/nfse-emission.scheduler.ts:364,422,787,843` | idem (fiscal) |
| G | `src/modules/integrations/sicredi/sicredi-boleto.scheduler.ts:320,365,1620,2302`; `sicredi-webhook.service.ts:391` | idem (fiscal) |
| G | `src/modules/financial/invoice/invoice-generation.service.ts:952,1001`; `invoice.service.ts:62`; `invoice-prisma.repository.ts:43,93`; `invoice.controller.ts:83,129`; `invoice-analytics.service.ts:1143` | idem |
| G | `src/modules/integrations/nfse/nfse.controller.ts:116,242`; `nfse/painter/painter-nfse.service.ts:478` | idem |
| G | `billing.service.ts:137,154,238,355`; `settlement-summary.ts:70,92,171` | idem |
| G | `src/modules/financial/reconciliation/receivable-match.service.ts:1755,1773,2070,2090`; `receivable-task-match.service.ts:333,705` | idem |
| G | `purchase-order.service.ts:119`; `src/modules/paint/paint-production.service.ts:877` | idem |
| G | `portal-read.service.ts:207,872,1686,1701`; `portal-identity.service.ts:128`; `portal-request.service.ts:906` | idem (portal) |
| G | `src/modules/production/truck/truck.service.ts:103`; `task.service.ts:6705,9921`; `task-notification.scheduler.ts:541`; `airbrushing-notification.service.ts:145`; `budget-payment.scheduler.ts:92`; `budget-status-cascade.service.ts:47`; `dossier-assembler.service.ts:345,980`; `search.service.ts:234` | idem |
| G | scripts `probe-*`, `nfse-diagnose` | idem |
| H | `src/utils/task.ts:192-196` (`formatTaskIdentifier`: série → placa → `#id`) | rótulo com recuo |
| H | `src/utils/quote-tasks.ts:391-399` (`coverageLabels`, espelhada no web) | série → placa → nome |
| H | `purchase-order.service.ts:163`; `signature-envelope.service.ts:1882,4982,7746`; `task.service.ts:9928`; `budget.service.ts:372,1421`; `receivable-task-match.service.ts:1588-1591`; `portal-request.service.ts:856`; `paint-production.listener.ts:146,161`; `settlement-summary.ts:613,666` | idem |
| H | `src/modules/integrations/nfse/elotech-oxy-nfse.service.ts:1412-1414,1429-1440,1582,1590` | NFS-e municipal: `vehicles[].serialNumber`, recuo `Ref. OS ${serialNumber}` |
| H | `src/modules/integrations/nfse/nfse-discriminacao.ts:40,92,116,148-157` | "de n série: X", "Série X", "(séries A a B)" — travada em `tests/nfse-discriminacao.test.ts` |
| H | `nfse-emission.scheduler.ts:502-634,907-1019` | monta `vehicles[]` e o `emitTask` |
| H | `nfse/painter/dps.builder.ts:453,522-532,545` | NFS-e do pintor; **o comentário `:522-524` ("o nº de série é da ORDEM DE SERVIÇO") passa a mentir e muda**; o texto `:545` fica; `temVeiculo` continua calculado **por campo** |
| H | `sicredi-boleto.scheduler.ts:932-947`; `invoice-generation.service.ts:1325-1335` | informativo do boleto ("N.º serie: X"); o `seuNumero` **não** usa série (`:803-828`) |
| H | `src/modules/production/budget/budget-receipt.service.ts:88-169` | recibo "Série X" |
| H | `dossier-assembler.service.ts:1103` | dossiê "No de serie X" |
| L | `portal-identity.service.ts:128,326-347,389-428,463,523-534`; `portal-request.service.ts:15-23,127,772-795,856,874-951,1096,1115-1150`; `src/schemas/portal-request.ts:17-28,403-427,558-620`; `src/schemas/portal-vehicle-identity.ts:116,252`; `portal-read.service.ts:207,278,872,943,974,1425,1686,1701,1800`; `portal-read.controller.ts:118`; `portal-projection.service.ts:181,378,457,614,695,842`; `portal-request.controller.ts:87` | **nenhuma chave pública do portal muda**; o serviço grava/lê no implemento (R-B nos escritores, P28 nos leitores) |
| M | `billing.service.ts:137-695`; `settlement-summary.ts:70-666`; `receivable-match.service.ts:200-2143` (`taskSerialNumber`); `receivable-task-match.service.ts:190-1591`; `invoice-analytics.service.ts:1143,1373`; `nfse.controller.ts:116-267` (`taskSerialNumber`); `bonus.service.ts:821,1418,3580,3713` (projeções à mão `serialNumber: task.serialNumber ?? null`); `dashboard-prisma.repository.ts:1823-3682` (16); `dashboard.service.ts:1054`; `search.service.ts:203-289`; `paint-production.service.ts:759-890`; `service-order.service.ts` (8, acima); `purchase-order.service.ts:89-604`; `budget.service.ts` (13); `budget-status-cascade.service.ts:47-52`; `src/utils/garage-layout.ts:25` + `truck.service.ts:103` (série da garagem passa a vir do próprio implemento) | DTOs mantêm a chave (`taskSerialNumber`, `serialNumber`); muda só a fonte |
| tipos | `src/types/task.ts` (8), `invoice.ts` (3), `dashboard.ts` (3), `receivable.ts:105`, `invoice-analytics.ts:179`, `notification-configuration.ts:462` | acompanham |
| seeds | `prisma/scripts/seed-notification-configs.ts` (244 usos de `{{serialNumber}}`/`{{#if serialNumber}}`) | nada (variável do contexto) |
| testes | 153 linhas em 23 arquivos de `tests/` (`10` §0) — os que criam tarefa estão na classe B acima; `tests/nfse-discriminacao.test.ts`, `painter-nfse.test.ts`, `boleto-informativo-cobertura.test.ts` viram ouro do G21 | reescritos/estendidos no P05 (G21) e P26 |

**WEB (`web/src/…`; pacotes P20/P21/P22; ação: H = ler por `taskSerial(t)`, W = escrever em `implement.serialNumber` só quando muda, Q = pedido à API, — = não muda, X = apagar)**

| Arquivo:linha | Hoje | Ação |
|---|---|---|
| `utils/task.ts:190-194` (`formatTaskIdentifier`) | série → placa → `#id` | **H**: nasce aqui `taskSerial(t) = t.implement?.serialNumber ?? t.serialNumber ?? null` |
| `types/task.ts:33` | `Task.serialNumber: string \| null` | `@deprecated` (espelho); `Implement.serialNumber` no tipo novo (`types/truck.ts:13-25` não tem série) |
| `types/task.ts:229` | `TaskOrderBy.serialNumber` | + `implement.serialNumber`; o do topo `@deprecated` |
| `types/budget.ts:108` | `tasks[].task.serialNumber` no faturamento | + `implement?.serialNumber` |
| `types/reconciliation.ts:244,352`; `types/invoice.ts:32` | `task?: {id,name,serialNumber}` | DTO (—) ou `select` aninhado (Q/H), conforme a API |
| `schemas/task.ts:276,293,322,449` | orderBy/where/busca (só tipo: o web não roda `taskGetManySchema`, `:1526`) | + `implement.serialNumber` |
| `schemas/task.ts:1192-1199` | `taskCreateSchema.serialNumber` com `^[A-Z0-9-]+$` | vai para o objeto `implement` (estrito) — **W** |
| `schemas/task.ts:1213-1214,1300-1326` | `serialNumberFrom/To` (nenhum formulário manda) | manter só se a API mantiver |
| `schemas/task.ts:1255-1265` | "ao menos um de Cliente, Número de série, Placa ou Nome" | ler `data.implement?.serialNumber` |
| `schemas/task.ts:1341-1348` | `taskUpdateSchema.serialNumber` + regex | vai para `implement`; regex só quando muda (V15) |
| `schemas/task.ts:1550` | `mapTaskToFormData` copia `task.serialNumber` | **H** |
| `schemas/task.ts:1606-1616` | `taskDuplicateCopySchema.serialNumber` | fica (campo do formulário); o montador põe em `implement` |
| `schemas/customer.ts:530`; `schemas/truck.ts:203,458`; `schemas/observation.ts:245`; `schemas/airbrushing.ts:185,228`; `schemas/serviceOrder.ts:102` | where/orderBy/busca aninhados em `task.serialNumber` | só tipo; acompanha a API |
| `api-client/task.ts:117,332-353,376` | repassa o corpo | nada; muda nos formulários |
| `api-client/portal.ts:420,754,902,1020,1107,1199,1349,1426`; `:1055-1069` (`portalMissingIdentity`, `portalVehicleLabel`) | DTOs do portal | **—** |
| `api-client/portal.ts:1100-1107,1237-1257` | comentários "`Task.serialNumber` … @unique GLOBAIS"; `PortalFieldConflict.field = 'serialNumber'` | texto; o `field` fica |
| `api-client/signature.ts:98,209`; `api-client/paint.ts:642` | DTO | **—** |
| `hooks/common/use-table-state.ts:109-118` | coluna `identificador` → `orderBy: { serialNumber: {sort, nulls:'last'} }` | **Q**: `{ implement: { serialNumber: … } }` |
| `hooks/production/task/use-task-form-url-state.ts:44,111-115,256-257,300,336,561,587,599,613,620` | sem consumidor (só o re-export `hooks/production/use-task.ts:754`) | **X** |
| `pages/production/barracoes/index.tsx:103-124,324` | `select: { serialNumber: true, truck: { select } }` | **Q**: `implement: { select: { serialNumber, … } }` (select explícito descarta chave nova em silêncio) |
| `pages/financial/billing/details/[id].tsx:312-330` | `quote.include.tasks.select.serialNumber` | **Q** |
| `components/production/task/history/table/task-history-table-filters.tsx:160` | `identificador → { serialNumber: d }` | **Q** |
| `components/production/airbrushing/table/airbrushing-table-page.tsx:81-84` | `{ task: { serialNumber: {sort, nulls} } }` | **Q** |
| `dashboard/widgets/task-table.tsx:1609-1637` (`ORDER_BY_PATH_MAP` sem `serialNumber`; 5 layouts gravados ordenam por ele) | `{ serialNumber: dir }` no topo | **Q**: `serialNumber: ["implement","serialNumber"]`; a chave gravada fica |
| `components/production/task/list/task-table-columns.tsx:169-171` + `list/task-table.tsx:130-132` | coluna "Nº SÉRIE" ordenável | **Q** |
| `pages/production/cutting/details/[id].tsx:54`; `components/production/observation/form/observation-form.tsx:93-114`; `observation/form/task-selector.tsx:158`; `dashboard/widgets/installment-table.tsx:560`; `components/administration/customer/detail/customer-tasks-list.tsx` | includes que dependem do escalar por padrão | **Q**: + `implement: { select: { serialNumber: true } }` |
| `components/production/task/form/task-create-form.tsx:72,83,123,186,322-333,372,508-523,549-553,802-822` | série no topo; `truck` só se houver placa/categoria/tipo/medida (`:492-495`); `serialNumbers: z.array(z.number())` | **W**: `implement: { serialNumber, … }` **sempre**; aceitar texto [pergunta 19] |
| `components/production/task/form/serial-number-range-input.tsx:21-188` | chips de série | fica (UI) |
| `components/production/task/form/task-edit-form.tsx:755,1076,1716,2121,3345-3372` | mapa campo→seção; default; `nullableFields`; campo "Número de Série" (`canEditIdentity`) | `"implement.serialNumber"` no mapa; **H**; `implement: { serialNumber: null }` ao limpar; **W** só com chaves sujas |
| `components/production/task/batch-edit/task-batch-edit-table.tsx:43,113,145,183-193,228,383,457` | lote `data.serialNumber` | **W** `data.implement.serialNumber`; comparação por `taskSerial` |
| `components/production/task/batch-edit/task-batch-result-dialog.tsx:38-39` | "Série: X" | **H** |
| `components/production/task/modals/task-duplicate-modal.tsx:124-147,171-180,229-243,392,485-488` | série no topo; `truck: null` quando a cópia não tem placa nem chassi | **W**: `implement: {…}` sempre, `spot: null` |
| `components/production/task/schedule/duplicate-task-modal.tsx:18-180` | sem consumidor | **X** |
| `pages/financial/budget/create.tsx:156,465,783-831` | `serialNumbers` numérico; série no topo | **W** sempre |
| `components/financial/budget/steps/budget-step-task.tsx:57,69,135-157,279-296,416-422,464-473,787-856` | campo "Número de Série"; placas × séries; irmãos | **W** no campo; **H** na leitura |
| `pages/financial/budget/details/[taskId].tsx:269,377,388-396,509,1076-1078,1398-1399,1533,1971` | `taskUpdateData.serialNumber` quando sujo | **W**: `taskUpdateData.implement = { serialNumber }` junto do objeto do implemento (`:1414-1420`); **H** |
| `components/financial/billing/steps/billing-step-task.tsx:163-180` | campo editável que **não grava** (INF, `11` §5.4) | só leitura [pergunta 20] |
| `dashboard/widgets/quick-budget.tsx:12,117,158,175,285-286` | cria tarefa com série e **sem caminhão** | **W** + implemento sempre (e migrar para `batch-with-quote`) |
| `components/production/task/detail/task-detail-page.tsx:457-463,696-703,1518,1624,1628` | campo `serialNumber` em overview com edição inline; títulos | **H** + **W** (`setTaskField({ implement: { serialNumber } })`); id do campo fica; pode ir à seção Implemento |
| `components/production/task/list/task-table-columns.tsx:92,169-180` | "SN: X"; coluna "Nº SÉRIE" | **H** |
| `components/production/task/schedule/task-schedule-columns.tsx:140-147`; `column-visibility-manager.tsx:20,68`; `task-schedule-table-page.tsx:114` | coluna `serialNumberOrPlate` | **H**; id fica |
| `components/production/task/schedule/task-schedule-export.tsx:37,76,365,514`; `task-schedule-content.tsx:345`; `copy-from-task-modal.tsx:85,116` | export, busca local, "Nº Série" | **H** |
| `components/production/task/preparation/task-prep-columns.tsx:342-346`; `task-prep-page.tsx:164` | IDENTIFICADOR, ordenação local | **H** |
| `components/production/task/history/task-history-columns.tsx:347`; `history/table/task-history-table-columns.tsx:219-228`; `history/task-export.tsx:132`; `history/task-history-table-skeleton.tsx:20` | IDENTIFICADOR, export | **H** |
| `components/production/task/form/selected-tasks-summary.tsx:20`; `components/production/cut/form/cut-create-wizard.tsx:165`; `components/production/production-period-tasks-modal.tsx:128` | "série · placa" | **H** |
| `components/production/garage/garage-view.tsx:115,500-501`; `garage/patio-view.tsx:150-159`; `garage/truck-detail-modal.tsx:217-224` | rótulo no pátio | **H** |
| `components/production/airbrushing/detail-page/airbrushing-detail-page.tsx:717-727`; `airbrushing/table/airbrushing-table-columns.tsx:56-63` | IDENTIFICADOR | **H** |
| `pages/production/cutting/details/[id].tsx:182`; `pages/production/schedule/edit/[id].tsx:152-153` | campo/título | **H**; ids ficam |
| `components/production/observation/form/observation-form.tsx:487-493`; `observation/form/task-selector.tsx:487` | "Número de Série" | **H** + **Q** |
| `components/production/painting/production-availability/paint-plan-detail-modal.tsx:243-246` | DTO | **—** |
| `components/common/related-tasks-card.tsx:73-85,199-202`; `components/personnel-department/payroll/detail/tasks-in-bonus-card.tsx:68,148-151`; `personnel-department/bonus/detail/bonus-tasks-table.tsx:80,123-125` | busca local, "S/N" | **H** |
| `components/administration/customer/detail/customer-tasks-list.tsx:64` | coluna padrão `serialNumber` (localStorage) | id fica; **Q** |
| `components/administration/customer/detail/related-invoices-card.tsx:54`; `components/production/task/billing/invoice-detail-dialog.tsx:64` | "OS #série" | **H**; palavra fica (D-18) [pergunta 22] |
| `components/home-dashboard/task-deadline-list.tsx:83`; `completed-tasks-list.tsx:56`; `awaiting-approval-tasks-list.tsx:55` | DTO | **—** |
| `dashboard/widgets/task-table.tsx:612,710-715,2347-2348` | coluna "Identificador" (`key: "serialNumber"`) | **H**; key fica |
| `dashboard/widgets/installment-table.tsx:12,304,397,462,657-659` | `taskSerial` de `task.serialNumber` | **H** + **Q** |
| `dashboard/presets.ts:174,187,283,354,687,756,861,919,1053,1394,1402` | presets com a coluna `serialNumber` | fica |
| `components/financial/reconciliation/receivable-match-section.tsx:469`; `transaction-buckets.tsx:165`; `statement-columns.tsx:42` | "série · nome" | conforme o DTO |
| `components/financial/budget/table/quote-row-shared.tsx:68`; `utils/quote-tasks.ts:37,122,227,365,640-650` | IDENTIFICADOR; `vehicleLabel`, `coverageLabels` | **H** (tipo `QuoteTaskLike`) |
| `components/financial/shared/billing-split-field.tsx:42-49`; `billing/steps/billing-covered-vehicles.tsx:20,185` | rótulo na divisão e na cobertura | **H** |
| `components/financial/budget/steps/budget-step-review.tsx:181-207,259,303,319-333,407-418,615,635,663-666`; `budget-step-customer-payment.tsx:156-168` | Resumo, "Nº de série" | **H** |
| `components/financial/billing/steps/billing-step-review.tsx:136,223,373,903,927-930,1989`; `pages/financial/billing/details/[id].tsx:409,425,467,581,757,1749,2012,2031,2042` | faturamento | **H** |
| `components/financial/budget/budget-request-card.tsx:114` | `RequestVehicle.serialNumber` | **H** |
| `components/financial/billing/preview/billing-document-previews.tsx:53,130-154,295`; `utils/nfse-discriminacao.ts:14-21,42,85,94,102,118,150-158,236-243` | prévias fiéis ao servidor | **H** na entrada; texto idêntico (D-18) |
| `components/public/quote-vehicle-table.tsx:71,85-86` | página pública, "Nº de série" | **H** (o endpoint público traz `implement` ou o espelho) |
| `pages/public/budget/[id].tsx:55,292` | número do documento com recuo para a série | **H**; tirar o recuo (contradiz `service-report/[id].tsx:576`) |
| `pages/public/service-report/[id].tsx:527` | "nº série · placa" | **H** |
| `utils/invoice-pdf-generator.ts:45` | sem importador | **X** |
| `pages/cliente/**`, `components/cliente/**` (`veiculos/[taskId].tsx:5,143-144,257,271`; `veiculos/list.tsx:258`; `veiculo-table-columns.tsx:95,232-247`; `veiculo-identidade-card.tsx:143,161-163,241-253`; `orcamento-veiculos-card.tsx:136`; `vehicle-chips.tsx:35,56`; `painel.tsx:82-90`; `pedidos.tsx:77,325`; `pedido-form-dialog.tsx:29,353`; `orcamentos/list.tsx:131,225`; `orcamentos/[id].tsx:374`; `assinaturas.tsx:66`; `solicitar.tsx:15-16,81,169,194,402`; `solicitacao-schema.ts:7,324,356-360,442-448,533-537,671-672`; `step-veiculos.tsx:9,82,129-181,277`; `step-revisao.tsx:112,237,245`; `utils/portal-capabilities.ts:30`) | DTOs do portal | **—** (só os comentários "`Task.serialNumber` … @unique" de `step-veiculos.tsx:9` e `solicitacao-schema.ts:7`) |
| `lib/attention/rules.ts:11-13,228-250` (R3b "Entrada sem placa": `isNull serialNumber` ∧ `isNull truck.plate`) | objeto cru | `implement.serialNumber` (e `implement.plate`) **antes** de a M5s derrubar o espelho |
| `lib/attention/engine.test.ts:40,131-159,244,333` | fixture no topo | `implement.serialNumber` |
| `utils/changelog-fields.ts:320` (TASK `serialNumber`), `:793-815` (seção TRUCK sem série), `:808,871,953` | rótulos | fica; + `serialNumber` na seção do implemento |
| `components/ui/task-with-service-orders-changelog.tsx:476,580-590` | junta TASK, SERVICE_ORDER e TRUCK pelo `truckId` | nada com S-5 |
| `utils/billing-coverage.test.ts:44-47`; `utils/vehicle-combinations.test.ts:21-39`; `components/cliente/solicitacao/solicitacao-schema.test.ts:44-462` (`:330` chaves exatas `["medidas","serialNumber"]`) | fixtures | o 1º muda com `QuoteTaskLike`; os outros dois **não** mudam (o de `:330` prova que o contrato do portal não mexeu) |
| **novos** | — | teste de `taskSerial` (topo / `implement` / os dois); `orderByEntry("serialNumber")` → `{implement:{serialNumber}}`; `use-table-state` para `identificador` (GS1 do `11` = G24 lado web) |

**APP (`mobile-flutter/lib/…`; P02 = patch OTA de compatibilidade, P24 = app novo)**

| Arquivo:linha | Hoje | Pacote | Ação |
|---|---|---|---|
| `data/models/task.dart:279,322,438` | `Task.serialNumber` de `j['serialNumber']` | **P02** | `_serialOf(j) = ((j['implement'] as Map?)?['serialNumber'] ?? j['serialNumber']) as String?`; o campo do modelo fica |
| `features/financial/budget.dart:137-161,209,220,909-911` | `BudgetTaskLite.serialNumber` | **P02** | idem |
| `features/financial/billing_task.dart:26,35,41-42,112` | `BillingTask.serialNumber` | **P02** | idem |
| `data/models/task.dart:387-399` (`identifier`, `displayName`); `features/garages/garage_model.dart:114,147,193,209,361`; `features/financial/nfse_discriminacao.dart:85,93,134,156,196-200` | leem o campo do modelo | — | nada |
| `features/production/task_schedule_view.dart:320-323` | `orderBy[2].serialNumber.sort/nulls` (Agenda, sempre) | **P24** | `orderBy[2].implement.serialNumber…` (o instalado depende do espelho; G32) |
| `features/production/tasks_list_config.dart:322-327` | comentário "`serialNumber` stays a valid orderBy" | P24 | texto |
| `tasks_list_config.dart:52`; `features/financial/budget_list_config.dart:157,349`; `billing_list_config.dart:86` | `searchingFor` | — | a busca da API continua achando (espelho + GIN) |
| `budget_list_config.dart:120-122` e demais `truck: true` | includes | P24 | `implement` (a série vem junto) |
| `features/production/task_form_screen.dart:89-91,163,262,296,338-339,462-463,484,490,608-610` | criação: série no topo; `_truck()` devolve `null` se vazio (`:379-402`) | **P24** | `base['implement'] = {…, 'serialNumber'}` **sempre**; o instalado depende da tradução e da criação no servidor |
| `features/production/task_edit_screen.dart:268,296,353,448,563,604-610,633,944-946` | `put('serialNumber', …)` no topo | **P24** | dentro de `implement`, só quando mudou |
| `features/production/task_detail_config.dart:329,553-567` | edição inline `{'serialNumber': …}`; campo some sem `canEditIdentity` | **P24** | `{'implement': {'serialNumber': …}}` |
| `features/financial/budget/budget_form_screen.dart:215-218,841-842,882-883,1766,1926-1952,2104,2122,2638-2657,2742-2749,3240,3383,5018-5051,5188-5242,5506` | assistente: placas × séries; série no topo na criação (`:1950`) e na edição (`:2122`) | **P24** | `implement` sempre; na edição, só quando mudou |
| `features/financial/vehicle_combinations.dart:15-55` | combinação | — | nada |
| `features/production/tasks_list_config.dart:215-221,465-473`; `task_schedule_view.dart:78,462-473`; `linked_task_card.dart:15-23,79-82`; `features/garages/truck_detail_sheet.dart:283-284`; `features/financial/budget_sections.dart:267,1026-1046,1292-1308,2963`; `billing.dart:103-112`; `billing_approval_sheet.dart:138,191-208,550`; `order_numbers_sheet.dart:213`; `billing_covered_vehicles.dart:224`; `features/production_extra/airbrushing_form_screen.dart:1010`; `features/production/task_selection_step.dart:190`; `shared/widgets/bonus_shared.dart:560`; `features/changelog/changelog_labels.dart:261,347` | exibição | — | nada depois do P02 (leem o modelo); `changelog_labels` ganha a série na entidade do implemento (P24) |
| `features/financial/nfse_detail_screen.dart:324` | DTO `taskSerialNumber` | — | nada |
| `core/attention/attention_rules.dart:15,204`; `list/list_scaffold.dart:113` | `IsNull('serialNumber')` sobre o snapshot projetado à mão (`task_schedule_view.dart:71-78`) | — | não muda (o snapshot lê do modelo); comentários que contradizem a DD1 (`linked_task_card.dart:17-19`, `task_form_screen.dart:89-91`, `attention_rules.dart:15`, `list_scaffold.dart:113`) mudam no P24 |
| `features/production/budget_report_pdf_generator.dart:119,145,412` | sem chamador | **X** | apagar |
| testes: `test/core/attention/attention_engine_test.dart:122,218,228,236,250,378,503`; `test/features/attention_surfaces_test.dart:114,133,157-166,274`; `test/features/financial/billing_row_test.dart:23`; `billing_approval_plan_test.dart:27,82,100`; `covered_vehicles_test.dart:22`; `nfse_discriminacao_test.dart:40,172`; `billing_approval_blockers_test.dart:55`; `vehicle_combinations_test.dart:15,28,44` | fixtures | P02/P24 | as de JSON com série no topo **ficam** (provam a leitura legada) e ganham a gêmea com série em `implement`; + `task_json_contract_test.dart` (topo × `implement` × os dois) |

### 6.14 Estados do orçamento (DD2, Modelo C): todos os pontos, por superfície

Fontes: `08-estado-orcamento-api.md` §1–§2 (API) e `09-estado-orcamento-clientes.md` §4–§9 (web, portal, app). Pacote **P14** (API), **P22** (web interno), **P23** (portal), **P24** (app). O que é da assinatura já está na §6.2 ("Assinatura"); aqui fica o eixo do valor, o eixo da assinatura e as telas.

**API**

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `prisma/schema.prisma:4645-4705` (`enum BudgetStatus` + comentários "APPROVED é o ÚLTIMO estado", `:4652-4655`, e o rótulo de `PENDING`, `:4694-4699`) | 8 valores na ordem de atenção | 7 valores (sem `PRE_APPROVED`; `SIGNED` legado no fim); comentários com o sentido do Modelo C — P10 |
| `prisma/schema.prisma:1891-1892,1901-1911,1922` (`status`, `statusOrder @default(1)`, comentário da fila, `queueRank` gerada) | | `statusOrder @default(3)`; + `signatureStatus`, `valueApprovals`; comentário da fila atualizado — P10 |
| `prisma/schema.prisma:2036-2038` (`BudgetRequest.preApprovedAt/ByResponsibleId`, `refusedAt/By`) | fonte da pré-aprovação | continuam gravados; fonte de verdade vira `BudgetValueApproval` |
| `src/constants/enums.ts:2802-2857` (`TASK_QUOTE_STATUS`), `:2871-2872` (alias `BUDGET_STATUS`) | 8 membros | 7 + `BUDGET_SIGNATURE_STATUS` + `BUDGET_VALUE_APPROVAL_SOURCE`, derivados de `$Enums` — P10 |
| `src/constants/enum-labels.ts:2110-2123` | "Pré-aprovado", "Aguardando Assinatura", "Aprovado" | "Pendente", "Aguardando aprovação do cliente", "Aprovado", "Assinado (legado)"; `BUDGET_SIGNATURE_STATUS_LABELS` — P14 |
| `src/constants/sortOrders.ts:186-201` | ordem de 8 degraus (e o comentário que proíbe o 0) | `REQUESTED 1, EXPIRED 2, PENDING 3, IN_NEGOTIATION 4, APPROVED 5, SIGNED 5, CANCELLED 6` (gêmeo SQL na M3o) — P10 |
| `src/schemas/budget.ts:32-45` (lista zod **à mão**: estado que falte é apagado do filtro em silêncio), `:923,973` (`.default(PENDING)` e os 8 aceitos na criação) | | derivar do enum (G31); na criação, `status` aceito e ignorado (D-34) — P14 |
| `src/modules/production/budget/budget.service.ts:5871-5876` (`assertTransitionAllowed`), **`:5915-5995`** (`ALLOWED` em `validateStatusTransition`) | uma tabela; `PENDING` destino manual de 4 arestas | duas tabelas (manuais × sistema), §2A.5; `PRE_APPROVED` fora; `PENDING` manual só como "Reprovar valor"/"Retirar do cliente"/reanálise |
| `budget.service.ts:6005-6085` (`validateStatusPrerequisites`: só `APPROVED`, último envelope ≠ INVALIDATED, ≥1 pagador com total > 0) | | `APPROVED` exige ≥1 serviço e total > 0; a condição do envelope sai (a assinatura não é mais pré-requisito do valor) |
| `src/modules/production/budget/budget.guards.ts:36-40,163-165` (`isQuoteMoneyLocked`, `isBillingFrozen`), `:198-210` (`QUOTE_VALUE_REVERTABLE_STATUSES = [APPROVED, SIGNED, EXPIRED]`), `:212-220` (`QUOTE_SAFE_AFTER_BILLING_FIELDS`), `:237-254` (`validateQuoteStatusChangeRole`) | | trava do dinheiro igual; a lista de revertíveis **fica como hoje** (DD8), só sem `SIGNED` como destino novo; `validateQuoteStatusChangeRole` também em `PUT /:id/status` (X7) |
| `budget.service.ts:521-527` (`data.status \|\| PENDING`), `budget-prisma.repository.ts:241-246` (`?? 8`), `budget.service.ts:524-527`, `:6305-6307` (`\|\| 1`) | nasce em qualquer status; três fórmulas de `statusOrder` | o servidor decide o nascimento (D-34); `statusOrder` só pela tabela |
| `budget.service.ts:1079-1116` (`hasValueAffectingChange`), `:1173-1180` (pin), `:1215-1229` (auto-revert → PENDING), `:1235-1248` (`update` com status), `:1259-1280` (trava) | três respostas para "o valor mudou?" | **ficam como hoje** (DD8, Revisão 3): o auto-revert e o "fixar" continuam; a única coisa nova é fechar a `BudgetValueApproval` vigente (`revokedAt`, motivo) quando o auto-revert tira o orçamento de `APPROVED` |
| `src/modules/production/task/task.service.ts:784-800` (trava), `:808-820` (gêmeo do auto-revert), `:829-842` (gate de papel na criação aninhada), `:2516` (pin), `:13400-13408` (cópia nasce PENDING), `:10092-10110` (A8), `:11060-11086` (A10 "desfazer" grava qualquer valor do changelog) | | gêmeo **fica** (DD8), fechando a aprovação vigente quando rebaixa; cópia nasce PENDING (igual); A10 recusa `PRE_APPROVED` e `SIGNED` com mensagem |
| `budget.service.ts:2791-2957` (`updateStatus`; `:2825-2835` recusa com Billing congelado; `:2861-2871` cancela; `:2877-2896` changelog `ROLLBACK`; `:2911-2931` aviso "valores visíveis" só vindo de REQUESTED) | aceita `PRE_APPROVED` de FINANCIAL, sem nota | delega aos atos (send-to-customer, value-approval, reprovar); aviso "valores visíveis" em toda entrada em IN_NEGOTIATION |
| `budget.service.ts:3367-3420` (`markSigned`, "SÓ DE PENDING"), `:3434-3480` (`markExpiredBySignature`), `:3500-3556` (`markRefusedBySignature`), `:3580-3638` (`markInvalidatedBySignature`; `:3600-3606` não regride com cobrança) | escrevem `Budget.status` | escrevem o **eixo**; `Budget.status` só na coleta legada (§2A.4) |
| `budget.service.ts:3640-3688` (`budgetApprove`; `:3643-3649` portão de layout; `:3655-3666` `task_quote.budget_approved`) | portão de layout | vira "aprovar valor" (§6.2 item 17) |
| `budget.service.ts:3872-3895` (`internalApprove`: só fatura `APPROVED`; `:4229` depois do merge do P00) | | **muda (DD7, D-30)**: exige também `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}`; 400 "A cobrança só pode ser aprovada depois da assinatura do orçamento."; guarda G34 |
| (DD11, novo) `budget.controller.ts` (`POST /budgets/:id/offline-signature`), `budget.service.ts` (`registerOfflineSignature`; e o fechamento do registro quando o orçamento sai de `APPROVED`), `files-storage.service.ts` (contexto `budgetOfflineSignature`), `file-reference.service.ts` (`BudgetOfflineSignature.fileId`) | | ato "Assinado fora do sistema" (§5.1, §2A.5); P14 |
| (DD12) `src/modules/common/signature/order-number-gate.ts`, `purchase-order-gate.ts` (apagado), `signature-envelope.service.ts` (`signWithOtp`, `signByPortalSession`, leitura das duas cerimônias), `portal-signature.controller.ts`, `schemas/signature.ts` (`portalSignSchema` ganha `orderNumbers`) | | um predicado, duas cerimônias (§5.1, G35); P14 |
| `budget.service.ts:5753-5758` (upload anônimo de assinatura aceito em PENDING/APPROVED) | | PENDING (coleta legada) e APPROVED: igual |
| `budget.service.ts:622-660` (Billing nasce na criação), `src/utils/budget-customer-config-sync.ts:890,996`, `task.service.ts:13458`, `src/modules/financial/reconciliation/receivable-task-match.service.ts:955-968,988` (orçamento já APPROVED pela conciliação) | | sem mudança; a conciliação grava `BudgetValueApproval{MIGRATED}` e `signatureStatus = WAIVED` (D-34) |
| `src/modules/production/budget/budget.controller.ts:185-216` (`PUT /:id/status`), `:233` (`/budget-approve`), `:105` | | §5.1 (novas rotas; alias; papéis) |
| `src/modules/production/budget/budget.module.ts:82-84,88-90,109-120` | ganchos da coleta | §6.2 item 32 |
| `src/modules/production/service-order/service-order.service.ts:209-230` (A9 reativa lendo o changelog), `:1144-1160`, `:3160-3172` (A8 direto), `:1957-1961,2066-2068` (sincronia trata `PENDING ∨ APPROVED` como "rascunho") | | A9 não ressuscita `APPROVED` sem aprovação vigente; a sincronia O.S.→orçamento segue como hoje (DD8) |
| `src/modules/common/attention/attention.service.ts:305-331` (`NOT_YET_INVOICED` = PENDING/SIGNED/APPROVED, `:314`), `:560-570` (cadastro incompleto para NFS-e, `eq APPROVED`) | | janela **igual à de hoje** (`PENDING`, `SIGNED` legado, `APPROVED`): corrigido pela auditoria §14 — o texto punha `IN_NEGOTIATION` dentro, mas o motivo registrado para deixá-lo fora continua valendo no Modelo C ("o que falta é o acordo, não o cadastro", web `lib/attention/rules.ts:85-95`), e a janela tem **três espelhos** que precisam mudar juntos ou não mudar (API aqui; web `lib/attention/rules.ts:60-95`, mapa `Record<TASK_QUOTE_STATUS, boolean>` que ainda tem `PRE_APPROVED: false` em `:93` e perde essa linha no P22; app `core/attention/attention_rules.dart:48-73`, `_notYetInvoiced`). Regras novas `budget.ready-to-emit` e "valor aprovado parado há N dias" [pergunta 14] |
| `src/modules/domain/dashboard/repositories/dashboard/dashboard-prisma.repository.ts:3596-3601,3924` (fila "pronto para faturar"), `:3601,3661` (`getTasksAwaitingQuoteApproval`: `PENDING ∨ SIGNED`) | | faturar: igual; "aguardando aprovação": `PENDING ∨ IN_NEGOTIATION` |
| `src/modules/financial/invoice/invoice-analytics.service.ts:646-706` (`QUOTE_STAGE`: REQUESTED/IN_NEGOTIATION/PRE_APPROVED ausentes → `?? 1`), `:818-841`, `:1652` (`status: { in: status as any }`) | | degraus IN_NEGOTIATION 1, APPROVED 3 (igual); peneirar valor desconhecido antes do Prisma |
| `src/schemas/task.ts:1766-1776` (filtro do financeiro `notIn [PENDING, SIGNED, EXPIRED]`) | negativo | positivo `APPROVED` (X6) |
| `src/modules/financial/billing/billing.service.ts:484-495` (`quoteStatuses`) | | aceita `signatureStatuses` também |
| `src/modules/financial/billing/billing-status-cascade.service.ts:127` | cascata Billing ← CANCELLED | igual |
| `src/modules/people/portal/**` | ver §6.3 (resumo, `canPreApprove`, `signatureFacts`, marco, decisão, capacidades) | P14 |
| `src/modules/common/signature/services/signature-whatsapp-templates.ts:39-65` | templates Meta da coleta | iguais (a coleta é a mesma) |
| seed `prisma/scripts/seed-notification-configs.ts` | — | + `task_quote.value_approved`, `task_quote.value_approval_revoked` (o valor voltou a Pendente pelo auto-revert ou pela reprovação), `task_quote.ready_for_signature` (G9) |
| `src/modules/production/budget/budget.service.ts:2219,2596`; `service-order.service.ts:1897`; `task.service.ts:12206` | chamam `onQuoteContentChanged` | **sem mudança** (DD8: não há `reassessValueApproval`) |

**WEB interno (`web/src/…`)**

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `constants/enums.ts:2867-2910` (`TASK_QUOTE_STATUS`, "ESPELHO de api") | 8 | 7; + `BUDGET_SIGNATURE_STATUS` (gerado do G5) |
| `types/budget.ts:13-21` (união; comentário diz "cinco") | 8 | 7 + tipo do eixo; comentário corrigido |
| `schemas/budget.ts:46-55` (`budgetStatusSchema`), **`:190`** (`.default('PENDING')` no aninhado) | | sem `PRE_APPROVED`; **sem default** (o servidor decide) |
| `constants/enum-labels.ts:2472-2490` **e** `components/production/task/quote/quote-status-badge.tsx:31-101` (dois mapas iguais "por disciplina") | "Aguardando Assinatura" para `PENDING` | **um** mapa (o badge lê `TASK_QUOTE_STATUS_LABELS`); rótulos do §2A.3; `SIGNATURE_STATUS_CONFIG` (rótulo + variante) ao lado, reusando `ENVELOPE_LABEL` |
| `quote-status-badge.tsx:110-130` (`TRIGGER_CLASS_BY_VARIANT`) | | linhas para as variantes novas |
| `constants/sortOrders.ts:166-178` | gêmeo da API | mesma tabela da M3o (G26) |
| `utils/permissions/quote-permissions.ts:66-104` (`VALID_TRANSITIONS`, "espelha byte a byte"), `:116-126` (FINANCIAL não vai a APPROVED) | 8 linhas | gerado do grafo da API (G26); FINANCIAL igual |
| `utils/quote-status.ts:19-24,45-51` (`QUOTE_STATUSES_IN_ORDER`; `REVERTS_INTO_PENDING = [EXPIRED, SIGNED, APPROVED]`) | | `APPROVED→PENDING` = "Reprovar valor" (motivo); `IN_NEGOTIATION→PENDING` = "Retirar do cliente" (sem motivo) |
| `constants/enum-labels.ts:2518-2525` (`isBudgetBillingPhase = status === APPROVED`) e usos (`utils/task.ts:22-42`; `task-schedule-table.tsx:257,267,367`; `task-schedule-table-page.tsx:395,608-611`; `task-table-context-menu.tsx:116`; `task-detail-page.tsx:999,1612`; `task-prep-page.tsx:640`; `dashboard/widgets/task-table.tsx:1926`) | | **igual** (Modelo C) |
| `components/financial/budget/table/budget-table-columns.tsx:425-444` (coluna `quoteStatus`), `:482-498` (`BUDGET_QUOTE_STATUSES`: opções + `where` padrão + guarda, lista positiva à mão), `:507-509` (export), `:531,570` (ordem) | estado fora da lista some da tela | derivar de `QUOTE_STATUSES_IN_ORDER` (G31); colunas novas `signatureStatus` ("Assinatura") e `artworkReadiness` ("Arte", "3/5 aprovadas"), ids sem ponto (`tableId: "financial-budget-list"`, `budget-table-page.tsx:233`) |
| `components/financial/budget/table/budget-table-filters.tsx:28,74-80,224-230` | filtro `quoteStatuses` | + "Assinatura" (multiselect) + "Pronto para emitir" (booleano) |
| `components/ui/datatable/data-table.tsx:367-373,443` | filtros na URL | link com `PRE_APPROVED` peneirado pela API |
| `components/financial/billing/table/billing-table-filters.tsx:85-90` (padrão `[APPROVED]`) | | igual; + selo da assinatura na lista |
| `pages/financial/root.tsx:512-519` ("Status dos Orcamentos") | | igual; legado com rótulo |
| `pages/financial/statistics/collection.tsx:139,362,828-832,917,991` (config persistida `quoteStatus: z.array(z.string())` sem peneira) | | peneirar como `dashboard/widgets/task-table.tsx:1354-1366` |
| `dashboard/widgets/task-table.tsx:946-955,1359-1366,2775-2779,3139-3143` (`quoteStatus`, `quoteStatuses` com peneira) | | igual; coluna "Assinatura" opcional |
| `dashboard/presets.ts:887` ("Orçamentos Esperando Aprovação", `["PENDING"]`), `:941,1075` (`["APPROVED"]`, faturamento) | | `:887` → `["PENDING","IN_NEGOTIATION"]` ("Valor por aprovar") + preset novo "Prontos para emitir"; `:941,1075` iguais |
| `components/home-dashboard/awaiting-budget-approval-list.tsx:45` | "Orçamentos Aguardando Aprovação" | "Valor aguardando aprovação" |
| `components/production/task/preparation/task-prep-columns.tsx:419-440`; `components/production/task/history/task-export.tsx:180-181` | badge | igual |
| `utils/changelog-fields.ts:1658-1675` (legado); `components/ui/task-with-service-orders-changelog.tsx:1089` | histórico com o rótulo atual | + `PRE_APPROVED: "Pré-aprovado"` e `SIGNED: "Assinado"` no mapa de legado; rótulos de `signatureStatus` e da aprovação do valor |
| `pages/financial/budget/details/[taskId].tsx:298,531,561,1913` (nasce `"PENDING"`) | | não manda `status` na criação |
| `components/financial/budget/budget-state-actions.tsx:63-101` (`ADVANCES`, `WAITING_HINT`, `SIGNATURE_HINT`), `:135-192` (coleta viva cala os encaminhamentos), `:151-154,245-249` | "Enviar para pré-aprovação"; "vá à Assinatura eletrônica" | **reescrever**: REQUESTED/PENDING → "Enviar para aprovação do cliente" + "Aprovar valor em nome do cliente" (nota); IN_NEGOTIATION → aviso + "Aprovar valor em nome do cliente" + "Retirar do cliente"; APPROVED → **checklist de emissão**; lendo o eixo do servidor |
| `[taskId].tsx:916-944` (`useQuoteEnvelopes`, `handleRequestAdvance`) | | a nota viaja como `statusReason` |
| **`[taskId].tsx:1788-1853`** ("pin" de APPROVED), `:1855-1911` (toast "voltou para Pendente", `:1889`) | editar valor mantém "Aprovado" | **fica como hoje** (DD8, Revisão 3) |
| `components/financial/budget/steps/budget-step-review.tsx:492-575` (combobox com `getAvailableQuoteStatusTransitions`, oferece `PRE_APPROVED→PENDING`), `:1179-1225` ("Rejeitar Orçamento … voltará para Pendente") | | só arestas manuais; "Reprovar valor" com motivo; aviso de coleta cancelada; **novo** diálogo "Aprovar valor em nome do cliente" |
| `components/financial/budget/budget-request-card.tsx:180-230` (selos "Pré-aprovada"/"Recusada" de `BudgetRequest`), `:215` | | a aprovação do valor sai do cartão da requisição para o **cartão "Aprovação do valor"** (quem, quando, origem, total, nota) |
| `components/financial/budget/steps/budget-step-task.tsx:812-866` (veículos irmãos) | sem estado de arte | badge de arte por veículo |
| `[taskId].tsx:89-98,947-966,2301-2310` (`LAYOUT_STEP`, `goToLayoutStep`, `onResolveLayout`) | atalho para o seletor de layout | sai; o atalho novo leva ao **veículo** cuja arte falta |
| `components/financial/budget/signature-envelope-card.tsx:166-175` (`ENVELOPE_LABEL`), `:634-657` (Cancelar/Reenviar), `:672-693` ("Enviar para assinatura" só por `canManage`), `:703-716` ("…e o orçamento é aprovado") | botão sempre ativo | botão **desabilitado** até o checklist fechar, com o motivo; "Reenviar" sob o mesmo checklist; texto "…e a coleta é concluída" |
| `components/financial/budget/signature-send-dialog.tsx:248-261,290-321,338-345` | blockers string + regex | `preflight.gates` (§6.2) |
| `components/financial/budget/use-quote-envelopes.ts:60-96` (`envelopeGlanceOf`) | reconstrói o estado da coleta | lê o eixo do servidor |
| `components/production/task/detail/sections/quote-billing-section.tsx:189,934-989` | card embutido; bloco "Layout Aprovados" | herda o checklist; "Arte deste veículo: estado" |
| `components/production/task/detail/task-detail-page.tsx:144-173` (variantes), `:1088-1135` (status do orçamento editável inline, inclusive `PRE_APPROVED→PENDING`) | | só arestas manuais; `→APPROVED` pede nota; eixo da assinatura ao lado, só leitura |
| `components/production/task/detail/service-orders-section.tsx:125` (`quoteWillCancel`); `utils/task.ts:213-217` (`calculateTaskPrice` = 0 em PENDING) | | iguais |
| `pages/financial/billing/details/[id].tsx:1527-1538` (pin no faturamento) | | **fica**; + selo "Assinatura: …" no cabeçalho e "Aprovar" desabilitado com o motivo quando a assinatura não é `SIGNED`/`SIGNED_OFFLINE`/`WAIVED` (DD7) |
| `pages/financial/budget/create.tsx:868`; `dashboard/widgets/quick-budget.tsx:190`; `components/production/task/modals/task-duplicate-modal.tsx:284`; `components/production/task/form/task-create-form.tsx:575` | mandam `status: 'PENDING'` na criação | tirar `status` |
| **novos** `components/financial/budget/budget-issue-checklist.tsx` (C1), `artwork-status-badge.tsx` + `ARTWORK_STATUS_CONFIG` (C2), diálogo "Aprovar valor em nome do cliente" (C3), cartão "Aprovação do valor" (C4), `SIGNATURE_STATUS_CONFIG` (C5), preset/filtro "Prontos para emitir" (C6) | — | `09` §7 |

**Portal do Responsável (`web/src/components/cliente/**`, `web/src/pages/cliente/*`)**

| Arquivo:linha | Hoje | Muda |
|---|---|---|
| `components/cliente/orcamento/waiting-on.ts:36-81` (`PORTAL_WAITING_BY_STATUS`), `:92-97` (`NAO_EMITIDO`), `:108-111` ("18 de 18"), `:118-131` (exceção de PENDING) | "de quem é a vez" só pelo estado | derivado de **três eixos** (valor, assinatura, arte): tabela da §7.7 |
| `components/cliente/orcamento/orcamento-columns.tsx:113-151` (colunas "Estado"/"Esperando"; ids `quoteStatus`, `waitingOn` em `tableId: "portal-cliente-orcamentos"`, `pages/cliente/orcamentos/list.tsx:203`), `:204-215` (`PORTAL_BUDGET_STATUS_OPTIONS`, "na ordem de atenção" — não está) | | + coluna `signatureStatus` ("Assinatura"); opções derivadas de `QUOTE_STATUSES_IN_ORDER` |
| `pages/cliente/orcamentos/list.tsx:49-51,108,144-147` | peneira status desconhecido | igual (protege link com `PRE_APPROVED`) |
| `components/cliente/orcamento/pre-aprovacao-actions.tsx:72-84` (`canDecideBudget`), `:172-176` ("passa a Pré-aprovado… a Ankaa emite"), `:211-217` (recusa "volta ao estado Requisição") | | capacidade `APPROVE_VALUE`; texto "Aprovar o valor deste orçamento? O valor fica aprovado. O documento para assinatura é emitido quando a arte de todos os veículos estiver aprovada — você também aprova as artes aqui no portal."; recusa "volta para a Ankaa refazer" (destino PENDING, sem nomear estado) |
| `components/cliente/orcamento/orcamento-proposta-card.tsx:254-300` (`OrcamentoDecisaoCard`, lê `budget.request.preApprovedAt/refusedAt`) | | lê `budget.valueApproval`; "Aprovado em nome da sua empresa pela Ankaa em …" quando `ON_BEHALF` |
| `pages/cliente/orcamentos/[id].tsx:173,259,270,292-298,323,326-336` | badge, condições, cards | + card **Arte por veículo** (Aprovar/Reprovar, lote) + faixa "Para emitir o documento falta: aprovar o valor · aprovar a arte de 2 veículos" (C7) |
| `pages/cliente/painel.tsx:140-150` (tiles por `byStatus`), `:167-181,299-395` (grupos; `:329` "você pode pré-aprovar") | | "Valores para aprovar", **"Artes para aprovar"**, "Documentos para assinar" (C8) |
| `api-client/portal.ts:288` (`PortalBudgetStatus`), `:664-693` (`canPreApprove`, `signature {emitted, awaitingMe}`), `:768-806` (`PortalSummary.waitingOnMe`) | | `canApproveValue`, `signatureStatus`, `artwork {…}`, `valueApproval`, `waitingOnMe.valueApproval` e `.artworks` — casar campo a campo com a projeção |
| `components/cliente/orcamento/sections.ts:64` (`MARKETING: ["LAYOUT"]`) | | **fica** (DD2) |
| `utils/portal-capabilities.ts:3-14` | 5 capacidades | `APPROVE_VALUE` (no lugar de `PRE_APPROVE`) + `APPROVE_ARTWORK` |
| `components/cliente/veiculo/veiculo-identidade-card.tsx:397`; `orcamento-veiculos-card.tsx:232`; `orcamento-servicos-card.tsx:49` | badge; `status !== "REQUESTED"` | igual + badge da arte do veículo |

**APP (`mobile-flutter/lib/…`, instalado `1.4.1+24`; P24)**

| Arquivo:linha | Hoje (instalado) | App novo | O instalado quando a API mudar |
|---|---|---|---|
| `features/financial/financial_enums.dart:21-33` (`kBudgetStatusLabels`, 5 estados; `PENDING`="Pendente"), `:45-52` (`kLegacyBudgetStatusAliases`), `:57-61,78-104` | não conhece REQUESTED/IN_NEGOTIATION | + `REQUESTED` "Requisição", `IN_NEGOTIATION` "Aguardando aprovação do cliente"; aliases `PRE_APPROVED→APPROVED`, `SIGNED→APPROVED` | estado desconhecido aparece cru, badge cinza |
| `features/financial/budget_list_config.dart:74-91` (`where status IN [EXPIRED, SIGNED, PENDING, APPROVED]`), `:330-366` | lista positiva | derivar de `kBudgetStatusOptions` sem `CANCELLED` | REQUESTED/IN_NEGOTIATION somem do celular (já é assim na branch) |
| `features/financial/budget_permissions.dart:105-127` (`kBudgetValidTransitions`) | | espelhar o grafo (G26) | `PENDING→APPROVED` = aprovar valor, aceito como `LEGACY_APP` |
| `features/financial/budget_status_control.dart:45,63-66,72,403-460,466-476` (`kBudgetSurfaceStatuses`, "Aprovar Orçamento" → `budgetApprove`, `PENDING` → `reject`, ordem) | | rótulo "Aprovar valor" + nota; eixo só leitura | — |
| `features/financial/budget_sections.dart:160-180` ("Aprovar Orçamento" em `PENDING ∨ SIGNED`; "Aprovar Faturamento" em `APPROVED`), `:344-351,2414-2640` (seção "LAYOUT APROVADO") | | "Aprovar valor" em `PENDING ∨ IN_NEGOTIATION`; "Aprovar Faturamento" só com a assinatura `SIGNED`/`SIGNED_OFFLINE`/`WAIVED` (DD7), senão desabilitado com o motivo; seção "ARTE POR VEÍCULO" só leitura | o "Aprovar Faturamento" do app instalado recebe 400 com a frase da DD7 (toast) |
| `features/signature/envelope_section.dart:233-262` ("Enviar para assinatura" sem portão), `widgets/send_sheet.dart:301-305,699-722`, `envelope_models.dart:15` (`'RUNNING': 'Coletando'`), `:714-741,781-784` (`blockers` só String) | | checklist e botão desabilitado; ler `gates`; vocabulário do eixo | vê o bloqueio como texto — **desde que `blockers` continue `string[]`** (G27) |
| `features/production/budget_section.dart:117,186-187`; `task_row_actions.dart:64-65,306-316`; `features/financial/billing_list_config.dart:73,276-283`; `core/attention/attention_rules.dart:48-73,443` | `isBudgetBillingPhase`, fila `['APPROVED']`, janela de atenção | badge da assinatura; o resto igual (Modelo C) | igual |
| `features/financial/budget/budget_form_screen.dart:1969` (`'status': 'PENDING'`) | | não manda `status` | nasce "Pendente" (certo) |
| `features/financial/budget.dart:1227-1231` (`budgetUpdateBody` pina `status` sempre) | | **continua pinando** (DD8) | como hoje |
| `features/list/layout_prefs.dart:45-65` (`Preferences.tableConfigsMobile` guarda colunas, não filtros) | | id `signatureStatus` estável | — |

### 6.15 Lacunas da auditoria da Revisão 2 (§14), já com destino

Achadas pela varredura independente de `serialNumber|serialNumberNormalized` e dos estados do orçamento (§14.1) e pela conferência das afirmações no código (§14.3). Arquivos que o plano não citava, ou trechos que faltavam em arquivos já citados. Cada linha entra no pacote indicado com o mesmo peso das tabelas acima.

**Série (DD1)**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `api/scripts/backfill-boleto-pdfs.ts:179,199` | `select: { name, serialNumber }` na tarefa; rótulo `#série` | ler `implement.serialNumber` **antes** da M5s (pasta `scripts/` fora do `tsconfig`: sem o G0 estendido, quebra só em runtime) | P28 |
| `api/src/scripts/reconcile-missing-nfse.ts:4,74,146,153` | casa NFS-e órfã pela série da tarefa (`Task.serialNumber` × "n série: NNNNN") | ler do implemento; o critério não muda | P28 |
| `api/src/scripts/test-nfse-cancel-roundtrip.ts:62`, `test-nfse-tomador-contact.ts:117` (e `probe-nfse-dryrun.ts:107`, já no grupo `probe-*`) | montam à mão o DTO de `elotech.emitNfse({ task: { id, name, serialNumber } })` e emitem **NFS-e real** de homologação/produção | **nada**, desde que o DTO de entrada de `emitNfse` mantenha `task.serialNumber` (regra "DTO mantém a chave", §6.13 classe M). Se o P28 mudar a forma do DTO, estes scripts perdem a série **em silêncio** (a nota sai com "Ref. OS"): o G21 passa a cobrir também este DTO | P28 (G21) |
| `api/tests/e2e-ui/{check-faturamento-separado.ts:47-60,105; fase1-criacao.ts:36,45; fase2-lotes.ts:30-66; fase4-faturamento.ts:68-202; fase5-ciclo.ts:132-523; fase6-troca-de-modo.ts:45-102}` | leem `Task.serialNumber` direto pelo Prisma (`select`, `orderBy: { serialNumber }`) para achar os veículos na tela | funcionam pelo espelho até a R-D; **trocar por `implement: { select: { serialNumber } }` antes da M5s** (o plano só os cobria como grupo pelo `truck`/layout) | P26 (forma nova), P32 (antes da M5s) |
| `api/tests/multitask-quote-e2e.test.ts:141-147,254,575-580` | cria 4 veículos pelo `batchCreateWithQuote` **passando pelo zod** com a série no topo; ordena por `Task.serialNumber` | é o lugar natural do **G23** (série no topo → implemento + espelho): acrescentar a asserção em `implement.serialNumber`; o `orderBy` muda antes da M5s | P11, P32 |
| `web/src/utils/vehicle-combinations.ts:14-39` | monta `{ plate, serialNumber }` para a criação em lote | nada (quem grava é `create.tsx`, já em W; §6.13) | — |

**Estados do orçamento (DD2)**

| Arquivo:linha | Hoje | Muda | Pct |
|---|---|---|---|
| `api/src/modules/financial/billing/billing.controller.ts:172-220,288` | `@Query('quoteStatuses')` peneirado contra `Object.values(TASK_QUOTE_STATUS)` antes do serviço | `signatureStatuses` entra aqui (o §6.14 citava só `billing.service.ts:484-495`, que nunca vê a chave se o controller não a ler); a peneira passa a descartar `PRE_APPROVED` sozinha | P14 |
| `web/src/api-client/billing.ts:12-33` | `quoteStatuses?: string[]` | + `signatureStatuses?: BudgetSignatureStatus[]` (selo/filtro "Assinatura" no faturamento) | P22 |
| `web/src/utils/permissions/task-column-permissions.ts:27-35` (`FINANCIAL_COLUMN_IDS`) | `price`, `quoteTotal`, `quoteStatus` só para ADMIN/COMMERCIAL/FINANCIAL | se a coluna "Assinatura" entrar na tabela de tarefas (§6.14, `task-table.tsx`), o id `signatureStatus` entra aqui, senão ela aparece para a produção | P22 |
| `web/src/lib/attention/rules.ts:60-95` (`:93` `[TASK_QUOTE_STATUS.PRE_APPROVED]: false`) | espelho de `NOT_YET_INVOICED` como `Record<TASK_QUOTE_STATUS, boolean>` | sai a linha `PRE_APPROVED` (o web builda sem `tsc`: sem o G0, o mapa fica com uma chave morta e sem erro); janela igual nos três espelhos (§6.14) | P22 |
| `api/tests/portal-decisao.test.ts:9-18,145-173` | trava `PRE_APPROVE: IN_NEGOTIATION→PRE_APPROVED` e `REFUSE: →REQUESTED` | reescrever para `APPROVE_VALUE: IN_NEGOTIATION→APPROVED` e `REFUSE: →PENDING` (D-35) — hoje quebraria no P14 sem estar na lista | P14 |
| `api/tests/portal-cliente-boot.test.ts:123` | exige a rota `PUT /cliente/me/orcamentos/:id/pre-aprovar` | `…/aprovar-valor` + as rotas de arte do portal (§5.1) | P13b/P14 |
| `api/tests/orcamento-sem-os-negociacao.test.ts:180-199` | exige o rótulo `[IN_NEGOTIATION]: 'Em Negociação'` e registra que "é a palavra que o dono quis na tela" | acompanha a resposta da pergunta 12: se o rótulo virar "Aguardando aprovação do cliente", o teste muda no mesmo commit; as asserções de `:225-240` (a O.S. não escreve APPROVED/PENDING) ficam | P14 |
| `api/tests/orcamento-faturamento-a.test.ts:360-385` | exige `PENDING, SIGNED, APPROVED, EXPIRED, CANCELLED` em `TASK_QUOTE_STATUS_ORDER` | **fica** — é a guarda existente que prova "`SIGNED` fica no enum" (D-26) | — |
| `api/scripts/make-signature-demo.js:24` | põe o orçamento em `PENDING` para emitir uma coleta de demonstração | no Modelo C o E1 recusa: pôr `APPROVED` + `BudgetValueApproval{ON_BEHALF, note:'demo'}` + arte `APPROVED` em cada implemento | P26 |
| `mobile-flutter/test/features/financial/budget_status_transitions_test.dart:43-85` | trava `kBudgetValidTransitions` (`PENDING→[APPROVED,CANCELLED]`, `SIGNED→…`, `APPROVED→[PENDING,CANCELLED]`) | reescrever com o grafo novo, gerado do JSON do G5 (G26) | P24 |
| sem mudança (conferidos): `api/src/utils/sortOrder.ts:88-89` (`getTaskQuoteStatusOrder` lê a tabela), `api/tests/billing-status.test.ts`, `api/src/scripts/repair-billing-residue.ts:80`, `web/src/components/financial/shared/quote-sibling-nav.ts:253` (comentário), app `test/core/attention_budget_rules_test.dart`, `test/features/financial/billing_list_scope_test.dart`, `budget_attention_test.dart` | | | — |

**Trechos que faltavam em arquivos já citados (conferência do §14.3)**

| Arquivo:linha | O que faltava | Destino | Pct |
|---|---|---|---|
| `src/utils/task-service-order-sync.ts:118,365` + 6 chamadores | o portão da DD3 exige argumento novo nas duas funções puras | §6.2 (linha reescrita) | P12 |
| `ImplementLayoutService.approveFromPortal/approveOnBehalf` | aprovar a arte de trabalho novo tem de **recalcular o estado da tarefa** (a O.S. de ARTE pode já estar concluída, esperando só a arte); sem isso a tarefa fica em PREPARATION até alguém mexer numa O.S. | chamar o mesmo recálculo de `calculateCorrectTaskStatus` na transação da decisão | P12 |
| `src/modules/production/service-order/service-order.service.ts` (fechamento da O.S. pela aprovação) | a O.S. "Aprovar com o Cliente" está gravada como "Aprovar com **O** Cliente" nas 7 linhas do clone; e as 31 em `WAITING_APPROVE` são "Elaborar Layout" | casar por descrição normalizada; fechar também a O.S. em `WAITING_APPROVE` (DD3, Revisão 3; produção: 12, 6 em tarefas vivas) | P12 |
| `src/modules/production/budget/budget.service.ts:5511-5514` (`findPublic`) + web `pages/public/{budget,service-report}/[id].tsx` | a página pública continua desenhando a arte (DD2) | §6.2 item 19 e §6.5 itens 36–37 (reescritos) | P12/P22 |
| `quote-snapshot.service.ts:426-438,491` × `quoteArtworkOf` | conjunto de tarefas | §2A.9 item 1 e D-14 (reescritos): todas as tarefas, canceladas inclusive | P12 |
| M3o passo 2 × `signature-envelope.service.ts:590-597` (E3) | precedência do envelope vigente | §4.3 M3o (reescrito) e G29 | P10/P14 |
| M0 (`LayoutApprovalSource`) | faltava `MIGRATED_ENVELOPE` no SQL | §4.2 (corrigido) | P06 |

---

## 7. Portal do Responsável

### 7.1 Fluxo de aprovação da arte

```
 designer/comercial sobe            designer/comercial "Enviar para           responsável aprova (portal)
 (POST /implements/:id/layouts)     aprovação do cliente" (send)              ─────────────────────────▶ APPROVED
        DRAFT ─────────────────────────────────▶ PENDING_APPROVAL ──┤                                        │
          ▲                                                          │ responsável reprova (motivo obrigatório)│
          │  nova versão (new-version, supersedesId)                 ▼                                        │
          └──────────────────────────────────────────────────── REPROVED                                     │
                                                                                                             │
 comercial/admin "Aprovar em nome do cliente" (nota obrigatória): DRAFT|PENDING ──▶ APPROVED (ON_BEHALF)     │
 nova versão APROVADA ────────────────────────────────────────────────────────────────▶ anterior SUPERSEDED ◀┘
```

| Transição | Quem | Efeitos |
|---|---|---|
| DRAFT → PENDING_APPROVAL | DESIGNER, COMMERCIAL, ADMIN | `sentAt`; `LayoutDecision`; notifica os contatos com `APPROVE_ARTWORK` no escopo (`layout.portal_pending_approval`); se houver O.S. "Aprovar com o Cliente" aberta, ela vai a `WAITING_APPROVE` |
| PENDING_APPROVAL → APPROVED (portal) | contato com `APPROVE_ARTWORK` no escopo comercial | `decidedAt`, `decidedByResponsibleId`, `fileSha256` (hash dos bytes no ato), `approvalSource=PORTAL`; `LayoutDecision`; O.S. **"Aprovar com o Cliente"** → `COMPLETED` quando ela existir (DD3; achada por descrição normalizada) **e** a O.S. de ARTE em `WAITING_APPROVE` (DD3, Revisão 3); **recalcula o estado da tarefa** na mesma transação (auditoria §14); a regra de liberação (`task-service-order-sync.ts:121-151,614-618`) passa a exigir `anyLayoutCompleted ∧ arte APPROVED` (só trabalho novo, D-15); versão anterior APPROVED → SUPERSEDED; `artwork.approved` para produção e designer; `onQuoteContentChanged` do orçamento da tarefa (coleta `RUNNING` cai, D-31) e recálculo de `emission` (pode disparar `task_quote.ready_for_signature`) |
| PENDING_APPROVAL → REPROVED (portal) | idem, **motivo obrigatório** | O.S. "Aprovar com o Cliente" volta a `IN_PROGRESS` (`service-order.service.ts:700-720`); `artwork.reproved` para designer e comercial (o "reprovado por" pode ser contato: ator discriminado) |
| DRAFT/PENDING → APPROVED (ON_BEHALF) | COMMERCIAL, ADMIN | `decidedByUserId`, `decisionNote` obrigatória ("aprovado por WhatsApp em 23/09, contato Fulano"); mesmos efeitos da aprovação pelo portal |
| APPROVED → REPROVED | ninguém | a correção é sempre versão nova (D-21) |
| Lote | contato | "Aprovar esta arte para os veículos marcados". O padrão marca todos os veículos do mesmo orçamento com a MESMA imagem pendente. No servidor são N atualizações numa transação, cada uma com seu carimbo e sua linha de trilha |
| Concorrência | — | aprovar exige `status = PENDING_APPROVAL` na mesma instrução (`updateMany … where status`); se nada foi atualizado → 409. O formulário interno **não** carrega mais status de arte (fim da corrida A1) |
| Assinatura do orçamento | — | só a **aprovação** de uma versão muda a arte do documento. Coleta `RUNNING`: a coleta cai (`INVALIDATED`), o valor segue aprovado e a reemissão já leva a arte nova. Contrato `COMPLETED`: não cai; deriva registrada e aditivo de arte opcional (D-31) |

### 7.2 Quem vê e quem decide (D-09, DECIDIDO pelo DD5)

| Papel do contato | Assina (`ROLE_DEFAULT_SECTIONS`, `quote-sections.ts:128-141`; **continua**, DD2) | `APPROVE_VALUE` (era `PRE_APPROVE`) | `APPROVE_ARTWORK` | Vê arte pendente | Vê arte aprovada | Medidas, série, porta e projeto (`WRITE_VEHICLE_IDENTITY`) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| COMMERCIAL | todas as seções | **sim** | **sim** | sim | sim | como hoje |
| SELLER | todas | **sim** | **sim** | sim | sim | como hoje |
| REPRESENTATIVE | todas | **sim** | **sim** | sim | sim | como hoje |
| COORDINATOR | todas | **sim** | **sim** | sim | sim | como hoje |
| MARKETING | só `LAYOUT` | não | **sim** (dono natural) | sim | sim | não |
| PURCHASING | todas | não | **não** (DD5) | sim | sim | como hoje |
| FINANCIAL | SERVICES, PRICING, DELIVERY, PAYMENT, GUARANTEE (sem `LAYOUT`) | não | não | não | não | não |
| FLEET_MANAGER | nenhuma (só por marcação na emissão) | não | não | não | sim (via `VEHICLE`) | como hoje |
| DRIVER | nenhuma | não | não | não | não | não |

Escopo: **comercial** (`commercialTaskScopeWhere`: pagador ∨ dono, sem o caminho pessoal), o mesmo da `WRITE_VEHICLE_IDENTITY` (`PORTAL-CONTRATO.md:174-178`). A Furgões pagadora (caso 259–262) aprova a arte do caminhão da RKO. Se o dono quiser só o DONO da marca, restringir ao caminho (b).

### 7.3 O que o responsável informa sobre o implemento

| Dado | Onde grava | Rota | Capacidade | Regras |
|---|---|---|---|---|
| Medidas Motorista/Sapo/Traseira | faces (METROS) | `PATCH …/identificacao` e requisição | `WRITE_VEHICLE_IDENTITY` | borda em **cm**, `medidaParaPrisma /100`; substitui a face (não acumula); sem copy-on-write necessário (D-07) |
| **Medida da Frente** | `frontSideMeasureId` | idem | idem | chave de borda `frente`, de leitura `front`; entra em `LADOS_DA_MEDIDA`, `portalMedidasSchema`, `TASK_BASE_SELECT`, projeção e **`mexeNoCaminhao`**; entra na sentinela `medidasIntocadas` do web |
| **Porta traseira** | `rearDoorLeaves`, `rearDoorBarCount`, `rearDoorHatchCount` | idem | idem | `abertura: BIPARTIDA\|TRIPARTIDA`, `varoes: 2\|3\|4`, `portinholas: 0..6`; **não é impressa** no orçamento → fora de `VEHICLE_IDENTITY_FIELDS` (sem 409 da guarda do documento congelado) |
| **Projeto do implemento** | `Implement.projectFiles` | `POST /cliente/me/veiculos/:taskId/projeto` | `WRITE_VEHICLE_IDENTITY` (DECIDIDO, DD5) | PDF/imagem; ⚠️ **todo arquivo é público por UUID** hoje (bloqueador do §9 de `PORTAL-DO-RESPONSAVEL.md`): o projeto da Furgões e a arte pendente ficam acessíveis a quem tiver o link |
| Tipo / Categoria | `type`, `category` | idem (existe) | idem | valores inalterados, então a guarda de 409 (`portal-vehicle-identity.ts:155-157`) segue funcionando sem tabela de equivalência |
| **Número de série** (DD1) | `Implement.serialNumber` | `PATCH …/identificacao` `{ serialNumber }` e requisição `veiculos[].serialNumber` — **contrato inalterado** | idem | a unicidade passa a ser do implemento, mas o conflito continua voltando com `field: 'serialNumber'`; a guarda do documento congelado (409) segue lendo o snapshot |
| Editar depois de entrar em produção? | — | — | — | **Não**, para medidas e porta (DD5): 409 "o veículo já está em produção; fale com a Ankaa" quando a tarefa estiver `IN_PRODUCTION` ou além. Para a **série**, a mesma trava [pergunta 15] |

### 7.4 Formato da resposta do portal (`PortalVehicle`)

```
PortalVehicle {
  id (taskId), name, milestone, milestoneLabel, cancelled,
  identity?:  { serialNumber, plate?, chassisNumber?, customerOrderNumber, purchaseOrder, customer, vinPlate? }  // seção VEHICLE
  implement?: {                                                     // seção VEHICLE — "o que é da Furgões/cliente" (R7)
    id, type, category,
    measures: { left, right, back, front },                         // METROS; chave back, nunca rear
    rearDoor: { leaves, barCount, hatchCount } | null,
    projectFiles: PortalFile[],
  }
  artworks?: [{ id, file, status, version, decidedAt, decidedBy: { name } | null, note, canDecide }]   // seção LAYOUT
  layout?:    { generalPainting, logoPaints, baseFiles }            // referência da TAREFA ("o que é da Ankaa")
  progress?:  …                                                     // seção DELIVERY
}
```
`undefined` = "sem seção"; `null` dentro = traço (régua atual, `web api-client/portal.ts:467-470`). `PortalBudgetView.layout` deixa de vir de `Budget.layoutFiles` e passa a ser a arte dos implementos do orçamento (`artwork` + artes por veículo, §6.3). `identity.serialNumber` continua com o mesmo nome (a fonte passa a ser o implemento). `web/src/api-client/portal.ts` tem de casar **campo a campo** com a projeção (`PORTAL-CONTRATO.md:199-206`: a deriva não dá erro de compilação e já custou `canSign`/`declaracoes`).

### 7.5 Telas do portal

| Tela | O que entra |
|---|---|
| Veículo (`pages/cliente/veiculos/[taskId].tsx`) | card **Arte** (novo: pendentes com Aprovar/Reprovar, aprovadas com quem e quando, histórico); card **Medidas** com 4 faces + **Porta traseira**; card **Projeto do implemento** (novo) |
| Orçamento (`pages/cliente/orcamentos/[id].tsx`) | `OrcamentoLayoutCard` com a arte **dos implementos** (sem "Artes do orçamento" vindas de `Budget.layoutFiles`); agrupado por arte com "Aprovar para os N veículos"; ações "Aprovar valor"/"Recusar"; cartão "Aprovação do valor"; faixa "Para emitir o documento falta…" (§7.6); coluna/selo "Assinatura" |
| Início (`pages/cliente/painel.tsx`) | grupos "Valores para aprovar", "Arte esperando a sua aprovação", "Documentos para assinar" |
| Lista de veículos | coluna "Arte" |
| Requisição (`components/cliente/solicitacao/*`) | Frente, Porta traseira e anexo do projeto do furgão no passo Veículos |

Molde visual: `PortalCard` + `DetailRow` (`components/cliente/portal-detail.tsx`); arquivos abrem em guia nova (o portal não tem `FileViewerProvider`); proibido `ui/detailpage/*`, `DataTable`, `PageHeader favoritePage`.

### 7.6 Fluxo completo do orçamento: aprovar valor → aprovar arte → emitir → assinar (por papel)

As etapas 2 e 3 são **independentes e podem vir em qualquer ordem** (o "orçamento prévio" do dono: o valor aprovado espera semanas pela arte). A emissão (4) só acontece quando as duas fecharam. Tudo o que o cliente faz no portal, a Ankaa também pode fazer "em nome do cliente", com nota.

| # | Etapa | Quem (portal: papel/capacidade; interno: setor) | Onde | Estado antes → depois | Efeitos e avisos |
|---|---|---|---|---|---|
| 0 | Requisição (opcional) | portal: `REQUEST_BUDGET` (COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR, MARKETING) | `pages/cliente/solicitar.tsx` | — → `REQUESTED`; cria tarefa **e implemento** por veículo (série, medidas, frente, porta, projeto) | `budget.portal_requested` ao comercial |
| 1 | Montar o preço e enviar ao cliente | interno: COMMERCIAL, ADMIN ("Enviar para aprovação do cliente") | assistente do orçamento | `REQUESTED`/`PENDING` → `IN_NEGOTIATION` | `budget.portal_values_visible` aos contatos; aparece em "Valores para aprovar" |
| 2 | **Aprovar o valor** | portal: `APPROVE_VALUE` (COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR), escopo do orçamento; **ou** interno "Aprovar valor em nome do cliente" (COMMERCIAL, ADMIN, nota) | `pre-aprovacao-actions.tsx` (renomeado) / Resumo do assistente | `IN_NEGOTIATION` → `APPROVED` (recusa com motivo → `PENDING`) | `BudgetValueApproval` (registro, sem hash, DD8); `task_quote.budget_approved` ao financeiro (a cobrança **ainda não**: espera a assinatura, DD7); `task_quote.value_approved` ao comercial com a lista de artes que faltam |
| 3 | **Aprovar a arte** de cada veículo | portal: `APPROVE_ARTWORK` (MARKETING, COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR), escopo comercial (a Furgões pagadora pode); **ou** interno "Aprovar em nome do cliente" (COMMERCIAL, ADMIN, nota). Não há dispensa (DD9) | card Arte do veículo; card do orçamento com lote "Aprovar para os N veículos"; Início | por implemento: `PENDING_APPROVAL` → `APPROVED` (reprovar com motivo → `REPROVED`, e o designer manda versão nova) | `LayoutDecision` (quem, sessão, `fileSha256`); O.S. "Aprovar com o Cliente" concluída; a produção pode ser liberada (DD3); se o valor já estava aprovado e esta era a última arte: `task_quote.ready_for_signature` |
| 4 | **Emitir** o documento para assinatura | interno: COMMERCIAL, ADMIN ("Enviar para assinatura", com checklist) | `SignatureEnvelopeCard` / `send_sheet` | eixo `NOT_ISSUED`/`REFUSED`/`EXPIRED`/`INVALIDATED`/`WAIVED` → `AWAITING_CUSTOMER`; `Budget.status` **não muda** | só com `assertEmissionReady` verde (E1 valor ∧ E2 arte ∧ E3–E7); o documento leva a arte aprovada de cada veículo na seção `LAYOUT`; convites por WhatsApp/e-mail como hoje |
| 5 | **Assinar** | portal/link: cada signatário no seu recorte (`ROLE_DEFAULT_SECTIONS`: COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR, PURCHASING assinam tudo; FINANCIAL sem `LAYOUT`; **MARKETING só `LAYOUT`**; FLEET_MANAGER e DRIVER só se marcados) | `pages/public/signature/[token].tsx`, `components/cliente/assinatura-documento.tsx` | `AWAITING_CUSTOMER` → (grupo 0 completo) `AWAITING_ANKAA` | `task_quote.signed` + `orcamento_contra_assinatura`; quem **tem** o papel Compras informa o nº do pedido de cada veículo na própria cerimônia, nas duas (DD12) |
| 6 | Contra-assinar | interno (Ankaa) | `SignatureEnvelopeCard` | `AWAITING_ANKAA` → `SIGNED` | documento final selado (PAdES); o valor já estava aprovado |
| 7 | **Aprovar a cobrança** (fatura, NFS-e, boleto) | interno: FINANCIAL, ADMIN | faturamento (`PUT /billings/:id/approve`) | `Billing` PENDING → APPROVED | **só com `signatureStatus = SIGNED`** (ou `SIGNED_OFFLINE`, DD11, ou `WAIVED` do legado) (DD7); antes disso o botão fica desabilitado com o motivo e a API recusa |
| — | Desvios | sistema | — | recusa → `REFUSED`; prazo → `EXPIRED`; arte nova aprovada / elenco / validade durante a coleta → `INVALIDATED`; valor mudou sem status fixado → `Budget.status` volta a `PENDING` (auto-revert de hoje, DD8) e a coleta cai por mudança material | reemitir sob o mesmo checklist; valor rebaixado exige nova aprovação do valor (etapa 2); a cobrança continua esperando a nova assinatura |

### 7.7 "Esperando" (de quem é a vez) em três eixos

Substitui `PORTAL_WAITING_BY_STATUS` (`web components/cliente/orcamento/waiting-on.ts:36-81`), que olhava só o estado.

| Valor | Assinatura | Arte | Rótulo | Frase |
|---|---|---|---|---|
| `REQUESTED` | — | — | Com a Ankaa | Requisição recebida. A Ankaa está montando o orçamento. |
| `PENDING` | — | — | Com a Ankaa | A Ankaa está montando o orçamento. |
| `IN_NEGOTIATION` | — | — | **Com você** (se `APPROVE_VALUE`) / Com a sua empresa | Aguardando a aprovação do valor. |
| `APPROVED` | `NOT_ISSUED` | alguma `PENDING_APPROVAL` | **Com você** (se `APPROVE_ARTWORK`) / Com a sua empresa | Valor aprovado. Falta aprovar a arte de N veículo(s). |
| `APPROVED` | `NOT_ISSUED` | alguma sem arte, `DRAFT` ou `REPROVED` | Com a Ankaa | Valor aprovado. A Ankaa está preparando a arte de N veículo(s). |
| `APPROVED` | `NOT_ISSUED` | todas `APPROVED` | Com a Ankaa | Valor e artes aprovados. A Ankaa vai emitir o documento para assinatura. |
| `APPROVED` | `AWAITING_CUSTOMER` | — | **Com você** (se `awaitingMe`) / Em coleta | O documento aguarda a sua assinatura. / Em coleta de assinaturas. |
| `APPROVED` | `AWAITING_ANKAA` | — | Com a Ankaa | Assinado por vocês. Falta a assinatura da Ankaa. |
| `APPROVED` | `SIGNED`, `SIGNED_OFFLINE` ou `WAIVED` (legado) | — | Em andamento | Daqui em diante quem anda é a produção e a cobrança (a cobrança só abre aqui, DD7). |
| `APPROVED` | `REFUSED`/`EXPIRED`/`INVALIDATED` | — | Com a Ankaa | A coleta foi recusada/venceu/caiu. A Ankaa vai reemitir. |
| `PENDING` com coleta legada | `AWAITING_*` | — | como as linhas de coleta acima | (só enquanto existirem coletas emitidas antes da R-B) |
| `EXPIRED` | — | — | Com a Ankaa | Aguardando reanálise. |
| `CANCELLED` | — | — | — | Orçamento cancelado. |

Os rótulos de estado que o portal mostra ao **cliente** são os internos ("Pendente", "Aguardando Reanálise"); um perfil "cliente" de rótulo fica como melhoria de baixa prioridade, fora desta entrega.

---

## 8. Guardas anti-regressão (R8): criar ANTES de mexer

Situação de hoje (FATO): **não há CI** em `api`, `web` e `mobile-flutter` (nem `.github/`, nem hooks). `api/tsconfig.build.json` tem `noEmitOnError: false`, `strict: false`, `noImplicitAny: false`, e o build **emite com erro de tipo**. O `build` do web é `vite build` **sem `tsc`** (existe `build:with-tsc`). Os testes da API rodam em `tsx` sem checar tipo e não há agregador. Nenhuma armadilha deste rework é barrada por máquina hoje.

| # | Guarda | Pega o quê | Como | Quando nasce |
|---|---|---|---|---|
| **G0** | **Portão de tipo real** | build que emite com erro | `api`: `"typecheck": "tsc -p tsconfig.json --noEmit"` + tsconfig de checagem que inclui `tests/` e `scripts/`; `noEmitOnError: true` no build. `web`: deploy usa `build:with-tsc` | P01 |
| **G1** | **Validador de consulta derivado do DMMF** (uma porta para include, select, where e orderBy de todas as rotas) + `DEPRECATED_QUERY_KEYS` | chave inventada (500), chave nova descartada (vazio), passthrough | percorre a árvore contra `Prisma.dmmf.datamodel.models`; desconhecida → 400 nomeado; legado → traduz/descarta + contador. A `INCLUDE_WHITELIST` fica só como permissão. Já pega `cutRequest`, `cutPlan`, `bonifications`, `customer.tasks.include.{budget,nfe,files,airbrushing}`, `SELECT_WHITELIST.Task.truckId`, `File.tasksLayouts`, `serviceOrders.include.service` (web `task-export.tsx:215-217`) | P01 |
| **G2** | Corpos `.strict()` com tratamento explícito do legado | "salvou com 200 e não gravou" | `taskImplementSchema.strict()`, topo do `taskUpdateSchema` estrito **depois** do tradutor (preservando os campos do outbox) | P11 |
| **G3** | **Censo de consultas** (telemetria só de leitura) | as formas que os clientes REALMENTE mandam, inclusive o app velho | middleware que loga, por rota, o conjunto de caminhos de chave de include/select/where/orderBy/corpo (sem valores) + `X-App-Version`/`User-Agent`. Duas semanas em produção dão a lista real, que vira fixture do G4 | P06 (R-A) |
| **G4** | **Teste de contrato de consultas** | constante de include do web/app que não bate com o schema | extrator estático (ts-morph no web: constantes `*_INCLUDE`, objetos passados em `include/select/where`; script Dart no app: mapas `'include':`) gera `contracts/queries/{web,flutter}.json`, **mais `contracts/queries/ankaa-aero.json` escrito à mão** a partir de `AnkaaAero/AnkaaAero/Networking/APIClient.swift` (terceiro cliente, Revisão 3: 4 formas de include); `api/tests/query-contract.test.ts` passa cada forma por zod da rota → G1 → `prisma.<model>.findFirst({...forma, take: 1})` em transação revertida no clone. O mesmo teste cruza **whitelist × zod × DMMF** (a origem do 403/500) | P01 (base), P20/P24 (extratores) |
| **G5** | **Fim dos espelhos à mão**: `api/scripts/export-contracts.ts` | whitelist, enums, rótulos (tela e nota), faces, chaves de notificação, campos multipart, `fileContext` | JSON gerado; web e app importam/geram a partir dele; `test/task_detail_include_test.dart` lê o JSON; **teste de exaustividade** por repo (todo valor de enum tem rótulo em cada mapa: hoje são 9 mapas de tipo e 9 de categoria) | P05 |
| **G6a** | **Portão de resíduo com catraca** | `truck`, `layoutFiles`, `quoteLayoutId`, `QUOTE_LAYOUT`, `sync-quote-task-layouts` esquecidos | `scripts/guard-residual.sh` por repo: `rg -n -i '\btrucks?\b\|Truck[A-Z]\|TRUCK_(?!MANUFACTURER\|SPOT)'` fora de `.residual-allowlist`; contagem-base por arquivo em `.residual-baseline.json` que **só pode cair**. Exceções nomeadas: `TRUCK_MANUFACTURER*`, valores `'TRUCK'`/`'BITRUCK'`, ícone `IconTruck`/`TablerIcons.truck`, `pages/tools/truck-studio/**`, `public/models/trucks`, migrações, `quote-snapshot.service.ts`/`quote-diff.ts` (chaves do hash), bloco legado dos mapas de changelog, chaves de notificação, `ChangeLogEntityType.TRUCK`, `TRUCK_SPOT`, `GarageTruck`/`garage_geometry.dart`, o arquivo do shim (com data de expiração). Base de hoje: **não reproduz** (auditoria §13). Com a regex exatamente como escrita (`rg -P -i`) dá api/src 2.075 ocorrências/121 arquivos, web/src 3.916/217 (2.456/151 sem `truck-studio`), app lib 930/72. Sem `-i` dá 1.305/103, 3.071/186 e 619/59. Com `-i`, `Truck[A-Z]` e `TRUCK_(?!…)` perdem o sentido (casam `truckSpot`, `truck_studio`…). O P01 grava no próprio `guard-residual.sh` o comando exato, **sem `-i`**, e a base sai da primeira execução dele, nunca deste parágrafo | P01 (catraca ligada), P32 (valor final) |
| **G6b** | Identificador em inglês colado a texto de tela | a corrupção de julho | `rg` por literal `'ImplementMeasure [a-zçã]'`, `'Implement [a-z]'`, `'Truck [a-z]'` | P01 |
| **G7** | **Matriz setor × campo** na escrita da tarefa | `implement` aceito pelo zod e ausente de `TASK_FIELD_DOMAINS` → 400 para todo setor, menos ADMIN | para cada setor de `SECTOR_TASK_UPDATE_ACCESS/CREATE_ACCESS`, chamar `validateSectorFieldAccess` com o corpo real que o formulário daquele setor manda (fixture de web e app). **Proibido testar só como ADMIN**. Mais: toda chave de topo aceita pelo zod pertence a algum domínio | P01 (base), P11 |
| **G8** | Caminhos das regras de Atenção resolvem | alerta falso em massa (`isNull(undefined)=true`) | web e app: tarefa totalmente preenchida (fixture do include real) → todo `field` de predicado resolve para algo ≠ `undefined` | P21/P24 |
| **G9** | Toda chave de notificação emitida existe no seed | notificação muda | varredura dos literais de `dispatchByConfiguration*` e dos `task.field.${field}` do tracker contra as chaves do seed | P01 |
| **G10** | Referências de arquivo conferidas | exclusão travada, organizador parado | catálogo de FKs ⊆ `INBOUND_REFERENCES`; `OUTBOUND_REFERENCES[].column` existe em `File` (DMMF); todo `fileContext` que os clientes mandam existe em `folderMapping` (o `warn` do boot, `file-reference.service.ts:236-262`, vira teste) | P01 |
| **G11** | **Hashes de ouro das assinaturas** | invalidação em massa; troca de `File.id` da arte na migração; deriva da série | exportar do banco (anonimizado) os `SignatureEnvelope` reais (`quoteSnapshot`, `quoteTermsSha256`, versão): `materialHash(snapshot, v) === quoteTermsSha256` para todos, antes e depois; com M1s/M3/M3o aplicadas e o código novo (`quoteArtworkOf` na v7), **quem casava antes casa depois**; `vehicles[].serialNumber` congelado = `implement.serialNumber`; casos sintéticos: 1 veículo, N veículos com a mesma arte (sem `layoutCoverage`), N com artes diferentes (com `layoutCoverage`), **orçamento `PER_VEHICLE` com cobertura uniforme e não uniforme** (DD6: o flag emite a chave); em produção os casos reais são os **30 COMPLETED** (24 no formato v1/v2) | P01 (base), P12, P14, P30 |
| **G12** | Parâmetros de rota e de query validados em runtime | `side` desconhecido, `implementId` malformado | `ParseEnumPipe`/zod | P11 |
| **G13** | Portão de versão do app | app velho gravando pela metade | `X-App-Version` + `MIN_APP_VERSION` + 426 | P02/P06 (cabeçalho), P31 (liga) |
| **G14** | `pre-deploy.sh` único (sem CI, o operador roda e cola o resultado na mensagem de deploy) | tudo | api: G0 + G1…G12 + `test:portal-cliente:boot` + `test:portal-e2e`; web: `build:with-tsc` + vitest + G4/G8; app: `flutter analyze` + `flutter test` (nunca `dart format` global) | P01 |
| **G15** | **Tabela escritor × face** | caminho de escrita esquecido | os 9 escritores × 4 faces × {criar, atualizar, apagar, foto}, com asserção no banco (metros, `position`, sem compartilhamento) | P04 (3 faces), P11 (4 faces) |
| **G16** | Multipart × interceptors | 400 "Unexpected field" | teste que monta o FormData real do web (`task-edit-form`, `AdvancedBulkActionsHandler`, portal) e confere contra as listas dos `FileFieldsInterceptor` | P11/P21 |
| **G17** | Corrida da aprovação (A1) | formulário velho sobrescreve a aprovação do cliente | e2e: responsável aprova no portal → formulário interno aberto antes salva outra coisa → a aprovação continua | P13b/P21 |
| **G18** | `IMPLEMENT_FACES` exaustivo | frente esquecida numa tela | `Record<ImplementFace, …>` em todo mapa + teste que percorre as faces em cada componente de medida | P03 (3), P21 (4) |
| **G19** | **Escritor × série** (`10` G-S1) | escritor da série esquecido | os 6 escritores (W1–W6) + rollback: cada um grava e o teste confere `Implement.serialNumber`, o espelho `Task.serialNumber` e `ChangeLog TASK/serialNumber` | P11 |
| **G20** | **Toda criação tem implemento** (`10` G-S2) | tarefa sem implemento (script, teste, caminho novo, a outra branch) | C1–C7 contra o banco de QA **com migrações**: `count(Task sem Implement) = 0` e `spot` explícito depois de cada caminho; o gatilho diferido é a rede | P10/P11 |
| **G21** | **Rótulos fiscais de ouro** (`10` G-S3) | série recuando para a placa na NFS-e/boleto/recibo; palavra da nota mudando sem o dono (D-18) | fixtures (com série, só placa, só chassi, sem nada) → `buildDiscriminacao`, `dps.builder`, `buildBoletoLines`, recibo, `coverageLabels`, `formatTaskIdentifier`, com o **texto exato** de hoje, sobre o objeto carregado pelo `select` real de cada serviço | P05 (antes de tocar qualquer leitor fiscal) |
| **G22** | **Contexto de notificação** (`10` G-S4) | `{{#if serialNumber}}` escondendo a ausência; `task.field.serialNumber` mudo | para cada evento de `task.listener`/`cut.listener`/`layout.listener`/tracker: tarefa com série → `data.serialNumber` não vazio; trocar a série no implemento dispara `task.field.serialNumber` | P11 |
| **G23** | **App velho grava série** (`11` GS3) | série some com 200 | e2e com o corpo do app 1.4.1 (`PUT /tasks/:id {serialNumber}`, `POST /tasks/batch-with-quote` com série no topo) → a série está no implemento e no espelho | P11/P26 |
| **G24** | **Catraca dos leitores do espelho** (`10` G-S6 + `11` GS1) | M5s antes da hora; leitor novo lendo o espelho | api: `rg -n 'serialNumber' src` fora de `.serial-allowlist` (snapshot, diff, lacuna, rótulos de changelog, chaves públicas do portal, tradutor); web: `rg "\.serialNumber\b" src` fora de `utils/task.ts`, dos DTOs e dos homônimos; a contagem-base só cai; M5s exige o valor final | P11 (liga), P28 (desce), P32 (zera) |
| **G25** | **Objetos de banco em teste** (`10` G-S7) | teste verde em banco de `db push` sem gatilho, coluna gerada nem GIN | bancos de teste sobem por migração; onde houver `db push`, `prisma/sql/objetos-pos-push.sql` (gatilhos, colunas geradas, GIN) roda depois; testes que escrevem `serialNumberNormalized` à mão (`task-match-integration.test.ts:137`) deixam de fazê-lo | P01/P10 |
| **G26** | **Um grafo, três espelhos** | web ou app oferecendo transição que a API recusa; `statusOrder` divergente | o grafo (manuais × sistema) e a ordem saem do JSON do G5; teste compara `quote-permissions.ts`, `budget_permissions.dart`, `sortOrders.ts` (api e web) e o `CASE` da M3o com a fonte | P14/P22/P24 |
| **G27** | **`blockers` continua `string[]`** | app instalado liberando o envio (lista vazia) | teste de contrato do preflight: `blockers` é array de string; `gates` é o estruturado | P14 |
| **G28** | **Portão único de emissão** | preflight diz "pode" e o POST dá 400 (ou o contrário) | mesmo cenário pelos três caminhos (preflight, `createEnvelope`, transação) com: valor não aprovado; valor rebaixado pelo auto-revert; 1 de 3 artes pendente; arte reprovada entre o render e o commit; veículo sem arte nenhuma (não há dispensa, DD9) | P14 |
| **G29** | **Eixo coerente com o envelope** | `signatureStatus` desencontrado do último envelope (terceiro escritor) | para todo orçamento: o eixo é a função do envelope **vigente** — RUNNING/COMPLETED primeiro, senão o último, a mesma precedência do portão E3 (auditoria §14) — (§2A.4), salvo `WAIVED` e `SIGNED_OFFLINE` com `BudgetOfflineSignature` vigente; roda no teste e como consulta no pós-deploy | P14/P30 |
| **G30** | *(retirada na Revisão 3)* | — | A DD8 manteve o comportamento de hoje para "editar o valor depois de aprovado": não há projeção comercial nem revogação por hash para testar. O que continua valendo (auto-revert sem status fixado; status fixado mantém `APPROVED`; a aprovação vigente fecha quando o orçamento sai de `APPROVED`) entra em `budget-state-machine.test.ts` (§10.1) | — |
| **G31** | **Listas positivas cobrem o enum** | estado que some da tela sem erro | `BUDGET_QUOTE_STATUSES` (web), `where` do app, `QUOTE_STAGE` do funil, `schemas/budget.ts:32-45`, `PORTAL_BUDGET_STATUS_OPTIONS`: todas derivadas do enum, teste de exaustividade | P14/P22/P24 |
| **G32** | **A URL da Agenda** (`11` GS4) | 500 na tela principal do chão | `GET /tasks?orderBy[0].forecastDate.sort=asc&…&orderBy[2].serialNumber.sort=asc&orderBy[2].serialNumber.nulls=last` (a URL exata de `task_schedule_view.dart:320-323`) → 200 e ordenado, antes e depois da M5s (depois, pelo tradutor) | P11/P32 |
| **G33** | **Arte que muda derruba a coleta certa** | coleta assinando arte que não é mais a aprovada; contrato selado derrubado por arte nova | e2e: aprovar versão nova com coleta `RUNNING` → `INVALIDATED` e valor segue `APPROVED`; com `COMPLETED` → continua `SIGNED` e grava deriva; aprovar pelo portal e pelo interno passam pelo mesmo ponto (`ImplementLayoutService`) | P12/P14/P26 |
| **G34** | **Cobrança só depois de assinado** (DD7, Revisão 3) | aprovar fatura/NFS-e/boleto de orçamento com valor aprovado e assinatura não concluída | `internalApprove` pelos três caminhos (`PUT /billings/:id/approve`, `PUT /budgets/:id/internal-approve`, `…/internal-approve/:taskId`): `signatureStatus` `NOT_ISSUED`, `AWAITING_*`, `REFUSED`, `EXPIRED`, `INVALIDATED` → 400 com a frase da DD7; `SIGNED`, `SIGNED_OFFLINE` e `WAIVED` → passa; liquidar/reverter cobrança já aprovada não passa pelo portão; o app 1.4.1 recebe a mensagem em toast | P14 |
| **G35** | **Pedido de compra: um predicado, duas cerimônias** (DD12, Revisão 3.1) | a página pública e a sessão do portal voltando a tratar o mesmo contato de jeitos diferentes | tabela-verdade (papéis × veículos com/sem número × canceladas) pelo `orderNumberRequirement` e pelos **dois** atos (`signWithOtp`, `signByPortalSession`) com o mesmo resultado; varredura de fonte: ninguém importa `purchase-order-gate`, e as duas cerimônias chamam o predicado | P14 |
| **G36** | **Esquema-alvo alcançado** (protocolo de promoção, Revisão 3.1) | fatia esquecida em `prisma/staged/r-b/`, ou `schema.prisma` divergindo do alvo ensaiado | `prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datamodel prisma/staged/r-b/schema.alvo.prisma`: informativo do P10 ao P14; **vazio** na integração do par [P14 ∥ P13b], quando a pasta é apagada | P10 (cria), P14 (zera) |

---

## 9. Plano de execução em pacotes

**Regras da casa** (ADR 0207 e lições das rodadas 6 a 8):
- No máximo **2 agentes implementando em paralelo**.
- Pacote que cria exigência para o repositório inteiro (schema compartilhado, tipo compartilhado, portão novo) **roda sozinho**; quem depende dele nasce depois.
- **Nota de desenho antes do código**, com uma página por pacote.
- **Revisar uma vez sobre a combinação**, não por pacote isolado.
- Régua com **catraca**; teste em primeiro plano.
- Nunca push direto na `main`; só squash. Pacote empilhado nasce sobre a branch da PR, nunca sobre a combinação.
- `git worktree list` antes de qualquer faxina. A outra sessão tem worktrees em `/tmp/claude-1000/*/06e55e4d-*/scratchpad/{api,web}-veiculos` e **não se toca**.
- Nenhum `sed` global; rename por AST.
- Base: `feat/portal-do-responsavel` (api e web), atualizada com a `main` no P00 (api `cd61b7d1`, web `051a5c04`). O app trabalha em `feat/implemento`, criada da `main` no P00.
- **Execução da Fase B (Revisão 3.1):** P06 → P10 → P11a → P11b, cada um **sozinho** no checkout principal → [P12 no checkout principal ∥ P13a num worktree `…/scratchpad/wt/p13a/api`, branch `impl/p13a`] → [P14 no checkout principal ∥ P13b num worktree `…/scratchpad/wt/p13b/api`, branch `impl/p13b`, criado **depois** do commit zero do P14]. Cada worktree tem **banco próprio** (cópia do banco da Fase B) e **`node_modules` próprio** (cliente Prisma próprio): o pacote do checkout principal promove fatia de migração no meio do par. As migrações seguem o protocolo de promoção do §4.1. Donos de arquivo, carimbos e a integração de cada par em `notas/cruzamento-fase-b.md`; cada pacote tem a sua nota em `notas/Pxx.md`.
- **Execução da Fase A (Revisão 3):** P01 sozinho → P02 (app) ∥ P03 (web) → P04 (api, checkout principal) ∥ P05 (a parte **API** do P05 num worktree próprio `…/scratchpad/wt/p05/api` na branch `impl/p05-rotulos`; a parte web e app do P05 no checkout principal). P04 e a parte API do P05 são **disjuntos em arquivo** — a divisão de donos está em `notas/cruzamento-fase-a.md`, e cada pacote tem a sua nota de desenho em `notas/Pxx.md`.

```
Fase A (sem mudar comportamento)              Fase B (o rework)                                                                    Fase C (ar)
P00 ─▶ P01* ─▶ [P02 ∥ P03] ─▶ [P04 ∥ P05] ─▶ P06* ─▶ P10* ─▶ P11* ─▶ [P12 ∥ P13a] ─▶ [P14 ∥ P13b] ─▶ P20* ─▶ [P21 ∥ P22] ─▶ [P23 ∥ P24] ─▶ P26 ─▶ P30 ─▶ P31 ─▶ [P28a ∥ P28b] ─▶ P32*
(* = roda sozinho: cria exigência para o repositório inteiro — schema, tipo compartilhado, portão novo, remoção de alias)
```

**Donos de arquivo quando dois pacotes rodam juntos** (para a revisão sobre a combinação não virar conflito de merge; a tabela completa está em `notas/cruzamento-fase-b.md`): em [P12 ∥ P13a], `portal-identity.*`/`portal-request.*`/`schemas/portal-request.ts`/`portal-vehicle-identity.*` são do P13a, e `quote-snapshot.service.ts`/`signature-envelope.service.ts`/`portal-read.service.ts`/`portal-projection.service.ts` são do P12 (neste par ele só troca a fonte da arte; a leitura da frente, da porta e do projeto no portal foi para o P11b). Em [P14 ∥ P13b], o **commit zero** do P14 (antes de o worktree do P13b nascer) promove a M3o-a e faz o rename D-35 inteiro (`PRE_APPROVE → APPROVE_VALUE`, `/pre-aprovar → /aprovar-valor`, `canPreApprove → canApproveValue`, `waitingOnMe.preApproval → valueApproval`) sem mudar comportamento; depois dele, `portal-capabilities.ts`, `portal-read.service.ts` e `portal-projection.service.ts` inteiros são do **P13b** (inclusive `signatureFacts` pelo eixo e o marco "Arte aprovada", que o §6.3 punha no P14), e `budget.*`, `signature-envelope.service.ts`, `portal-decision.*`, `order-number-gate.ts`, `portal-signature.controller.ts` são do **P14**. O `emission` do portal (faixa "Para emitir falta…") entra na integração do par, porque depende do `assertEmissionReady` do P14. Em [P21 ∥ P22], o `task-detail-page.tsx` é do P21, e o bloco de estado do orçamento dentro dele (`:1088-1135`) entra pelo P22 depois do merge do P21.

| Pct | Escopo | Arquivos principais | Pronto quando | Testes |
|---|---|---|---|---|
| **P00** — preparação (dono + 1 agente, sozinho) — **FEITO em 23/09 (Revisão 3)** | Merge da `main` na base (api `cd61b7d1`, web `051a5c04`; migrações da `main` aplicadas no clone local); branch `feat/implemento` no app; números de produção em `P00-producao.md` (SELECT em transação somente leitura + logs do nginx); Revisão 3 deste plano com DD6..DD10; notas de desenho P01..P05 e o cruzamento da Fase A em `notas/`. **Continuam abertas** as perguntas do §12 (1, 2, 3, 5, 11, 23 e 24 foram respondidas pelas DD2, DD7..DD10 e DD3; a 25 e a 26, que nasceram aqui, foram respondidas na Revisão 3.1 pelas DD11 e DD12) | `docs/implemento/**` | decisões registradas; branch atualizada e verde; números de produção anotados | api: tsc 3 erros antes e depois (os mesmos, pré-existentes); `test:quote-diff`, `quote-merge`, `portal-recorte`, `portal-decisao`, `portal-requisicao`, `billing-coverage`, `nfse-discriminacao`, `billing-lens`, `orcamento-sem-os-negociacao`, `layout-per-vehicle` verdes; web: `tsc -b` 0 erros antes e depois, vitest de orçamento/portal/faturamento 118/118 |
| **P01** — portões de máquina (**sozinho**, api) | G0, G1 (+ `DEPRECATED_QUERY_KEYS` com `BudgetPayer.responsible` e `Budget.task`), base do G4 (API), G6a/G6b com catraca na contagem atual, base do G7, G9, G10, base do G11 (exportar envelopes reais anonimizados), G14, **G25** (bancos de teste por migração / `objetos-pos-push.sql`). Apagar `schemas/task.ts:634-1094`. Fixtures do G4 incluem o terceiro cliente `AnkaaAero` (§5.4). Corrigir os fantasmas que o G1 acusar (`cutRequest`, `cutPlan`, `bonifications`, `customer.tasks.include.*`, `truckId`, `File.tasksLayouts`). Parar de embrulhar `PrismaClientValidationError` em 500. Mensagem P2002 de `serialNumber` no filtro global | `src/schemas/task.ts`, `customer.ts`, `file.ts`, `include-access-control.ts`, `include-mapper.helper.ts`, novo `src/modules/common/query/dmmf-query-validator.ts`, `task.controller.ts` (G1 em todas as rotas), `common/filters/global-exception.filter.ts:83-107`, `tsconfig*.json`, `package.json`, `scripts/pre-deploy.sh`, `scripts/guard-residual.sh`, `prisma/sql/objetos-pos-push.sql`, `tests/query-contract.test.ts`, `tests/sector-field-matrix.test.ts`, `tests/notification-keys.test.ts`, `tests/file-references.test.ts`, `tests/signature-golden-hashes.test.ts` | `pre-deploy.sh` verde; **nenhuma mudança de comportamento** para os clientes atuais (o censo e as fixtures dos includes reais de web e app passam) | os novos acima + a bateria existente |
| **P02** — app P0 (∥ P03; app, branch nova da `main`) | patch OTA do §6.7 "P02" **+ leitura tolerante da série** (`_serialOf` em `task.dart:438`, `budget.dart:220`, `billing_task.dart:112`) + defaults REFRIGERATED vazios (`budget_form_screen.dart:206-207`, `task_form_screen.dart:181`). **Sem glifo novo** | `dio_client.dart`, `api_exception.dart`, interceptor novo, `ota_update_service.dart`, `native_update_service.dart`, `task.dart`, `budget.dart`, `billing_task.dart`, teste de contrato JSON | `flutter analyze` limpo; patch Shorebird publicado; o log da API mostra `X-App-Version` | `task_json_contract_test.dart` (truck × implement; série no topo × em `implement` × nos dois); `flutter test` |
| **P03** — web PR-0 (∥ P02; web) | `constants/implement-faces.ts` (3 faces) e troca das 32 uniões; vocabulário (`layoutsData`→`measuresData`, `canViewLayout`→`canViewMeasures`, `deleteLayout`→`deleteMeasure`, acordeão `value="measures"`); apagar o código morto (§6.11, inclusive `schedule/duplicate-task-modal.tsx`, `use-task-form-url-state.ts`, `invoice-pdf-generator.ts`); corrigir A7 (foto da traseira na criação) e A12 (`task-export`); defaults REFRIGERATED → vazio (`create.tsx:168`, `task-create-form.tsx:125`, `billing/details/[id].tsx:593` e `:763`); `X-Client`; exportar as constantes `*_INCLUDE` e o extrator do G4 (web) | §6.4/§6.5 nos pontos citados | vai a produção **sem depender** da API nova; `build:with-tsc` verde | vitest + G4 (web) + G18 (3 faces) |
| **P04** — escritor único de medida (∥ P05; api) | `ImplementMeasureWriter` (`setFace`, `cloneFaces`, `FACES`, `FACE_FK`), sem compartilhamento, sem `.catch` dentro de `tx`, sem apagar linha apontada por `PaintingAnalysis`; os **10** escritores passam por ele **com 3 faces** (o 10º veio da `main` no P00: `src/utils/implement-measure-replication.ts`, réplica por cópia aos irmãos do orçamento; o `MeasureSide`/`SIDE_FK` dele vira o `FACES`/`FACE_FK` do writer); fonte única do zod de medida | `task.service.ts` (#1–#6), `implement-measure.service.ts`/repository (#7), `portal-identity.service.ts:629-700` (#8), `portal-request.service.ts:924-993` (#9), `schemas/task.ts:2524-2541`, `schemas/implement-measure.ts` | comportamento idêntico, exceto o compartilhamento, que passa a copiar | **G15** (9 × 3 × {criar, atualizar, apagar, foto}); "editar a medida de A não altera B" |
| **P05** — rótulos e contratos exportados (∥ P04; api + web + app; a parte api num worktree `impl/p05-rotulos`, disjunta do P04) | uma fonte de rótulos com **perfis por documento** que reproduzem o texto de hoje (D-18), `export-contracts.ts` (G5: enums, rótulos, faces, grafo e ordem do orçamento, chaves de notificação, multipart, `fileContext`), testes de exaustividade nos 3 repos; os 4 dicionários fiscais passam a usar a fonte; **G21** (rótulos fiscais de ouro, com a série) **antes** de qualquer leitor fiscal mudar | `api/src/constants/enum-labels.ts`, `elotech-oxy-nfse.service.ts:1295-1316`, `invoice-generation.service.ts:1399-1425`, `sicredi-boleto.scheduler.ts:1002-1028`, `dps.builder.ts:514-520`; web `enum-labels.ts:545-565`, `changelog-fields.ts:1723-1751`, `billing-document-previews.tsx:28-57`; app `task_enums.dart:104-128`, `nfse_discriminacao.dart:55-80` | nenhuma palavra muda na nota; testes de discriminação com o texto de hoje | `nfse-discriminacao`, `painter-nfse`, `boleto-informativo-cobertura`, exaustividade, G21 |
| **P06** — release R-A (**sozinho**, curto, api) | M0 (`20260930100000`, com `MIGRATED_ENVELOPE`) aplicada no banco da Fase B + os três enums **só** no `schema.prisma` (nenhum espelho TS, nenhum rótulo: o contrato do G5 não muda); G3 (censo de formas, sem valores) e log de `X-App-Version`/`X-App-Patch`/`X-Client`/UA; `scripts/census-to-fixture.ts`. **O deploy R-A é do dono** (o agente não publica): o pacote termina "pronto para R-A" | `prisma/migrations/20260930100000…`, `schema.prisma` (3 enums), `src/modules/common/census/**` (novo), `src/app.module.ts` (registro) | M0 aplicada no banco da Fase B, `migrate status` limpo; censo testado; runbook da R-A na nota | `test:census` (novo) + boot + a régua |
| **P10** — migrações da R-B, escritas e ensaiadas (**sozinho**, api) | §3 inteiro como **esquema-alvo** (`prisma/staged/r-b/schema.alvo.prisma`: implemento com série, espelho, `spot` sem default, arte, `BudgetValueApproval`, `BudgetOfflineSignature`, `signatureStatus` com `SIGNED_OFFLINE`, `BudgetStatus` sem `PRE_APPROVED`) e as **seis fatias** M1, M1s, M2 (+ `_IMPLEMENT_PROJECT_FILES`), M3 (passo 5 com M-A..M-D), M3o-a, M3o-b em `prisma/staged/r-b/` (§4.1, protocolo de promoção: **nada** em `prisma/migrations/` nem em `schema.prisma`); objetos de banco para o G25 (`prisma/staged/r-b/objetos-pos-push.r-b.sql`); ensaio `scripts/rehearse-implement-migration.ts` (`$transaction` → fatias não aplicadas → invariantes → contagens → triagem → `throw`) e prova "sem deriva" num banco descartável; triagem `LEGACY_APPROVED_UNSIGNED` (DD7; saída por coleta nova ou DD11); G36 informativo; sem colunas de dispensa de arte (DD9) e sem hash (DD8). Os espelhos TS do enum do orçamento passam ao P14 | `prisma/staged/r-b/**`, `scripts/rehearse-implement-migration.ts`, `scripts/check-schema-target.sh`, `tests/implement-migration-rehearsal.test.ts`, `package.json`/`pre-deploy.sh` (as duas linhas) | `prisma validate` do alvo ok; **ensaio verde no banco da Fase B**; alvo sem deriva contra as fatias; triagem gerada; régua verde (o código não mudou) | ensaio + invariantes (§4.6) + G20 (lado banco, no ensaio) + G25 (objetos no ensaio) |
| **P11a** — API: rename, janela bilíngue e série (**sozinho**, api) | promove **M1 + M1s**; §6.1 menos a frente e a porta: `Implement` no Prisma e no código, rotas `/implements` + alias `/trucks`, tradutor `translateLegacyImplementKeys`, `ImplementLegacyMirrorInterceptor` (espelho profundo e igual, F9), `DEPRECATED_QUERY_KEYS`, whitelist, `TASK_FIELD_DOMAINS.implement` junto com o zod, `paint.service.ts` (SQL cru) e `file-reference.service.ts` no mesmo commit, `omit`, contexto `implementVinPlate`; `build()` do snapshot lendo o implemento com as chaves congeladas; **série inteira**: W1–W6 (**inclusive W4/W5 do portal**, que o gatilho da M1s recusaria até o P13a), as 4 unicidades (inclusive as duas do portal), `truck/implement: null` → 400, criação **sempre** com implemento, ramos "cria se não existir" apagados (inclusive `portal-identity.service.ts:557`), `implementUpdateSchema` sem série, tracker e changelog `TASK/serialNumber`, `dps.builder.ts:522-524` (comentário); `objetos-pos-push.sql` com os gatilhos da M1s | §6.1, §6.13 (API, R-B), `quote-snapshot.service.ts`, `quote-text.ts`, `dossier-assembler.service.ts`, os escritores e unicidades do portal | tsc sem erro (G0); G6a caindo; G24 ligada; **nenhum 403/500** com as fixtures dos clientes velhos (G4); G11 verde | G2, G7, G19, G20, G22, G23, G32, legado (`truck{…implementType}` grava em `implement.type`; include `truck` devolve `truck` e `implement` iguais; os dois juntos → 400), rollback de `TRUCK/implementType` e de `TASK/serialNumber`, `task.field.truck.*` e `task.field.serialNumber` disparando, busca de tinta por placa e por série |
| **P11b** — API: frente, porta e projeto do implemento (**sozinho**, api) | promove **M2** (frente, porta, medidas descompartilhadas, `_IMPLEMENT_PROJECT_FILES`); frente e porta no writer (4 faces; `IMPLEMENT_FACES` com `front`, que entra no G5), multipart `frontSide` nos 3 interceptors, `side` validado, cotador com FRENTE condicionado à versão do app, SVG, tracker/notificação da porta, `REAR_DOOR_LEAVES` com rótulo; `PUT /implements/:id/project-files` + contexto `implementProjectFiles` + referência de arquivo; **a leitura do portal** da frente, da porta e do projeto (`TASK_BASE_SELECT`, bloco `implement` da projeção, §7.4), que o §6.3 punha no P13a | §6.1 (frente/porta), `portal-read.service.ts:202-229`, `portal-projection.service.ts:197-199,464-466,841-867` | as 4 faces por todos os escritores; porta fora da faixa → 400 e CHECK; o portal **lê** frente/porta/projeto | G12, G15 (4 faces), G16, bench do cotador, `portal-recorte` com o bloco `implement` |
| **P12** — API: arte do implemento, R1 e arte na assinatura (∥ P13a; api, checkout principal) | promove **M3** (e tira `Budget.layoutFiles`/`File.quoteLayoutId` do Prisma, a coluna fica até a M4); `ImplementLayoutService` + rotas `/implements/:id/layouts/*` (**sem** dispensa de arte, DD9); eventos com ator discriminado; lembrete; portão de liberação (D-15, DD3), inclusive a liberação **manual** (DD10, **confirmada** na Revisão 3.1), e o fechamento da O.S. "Aprovar com o Cliente" e da O.S. de ARTE em `WAITING_APPROVE`; escritores do layout por veículo da `main` saem (§6.2 item 26b), `layoutGateFailure` passa a falar da arte do implemento; todo o R1 (§6.2 itens 1–32, exceto M4, `budget.guards.ts:215` e os itens 17/18/32, que são do P14); **`quoteArtworkOf`** alimentando snapshot (v7, `layoutFileIds` + `layoutCoverage` condicional), documento (legenda por veículo) e diff; toda mudança de estado de arte chama `onQuoteContentChanged`; `file-reference` sem saída; contextos de arquivo; sintetizador legado de `task.layouts`; tratamento no-op/400 de `layoutIds` | §6.2, `portal-read.service.ts:1048,1115-1117`, `portal-projection.service.ts:233,576,790-791` | **G11 verde: quem casava antes casa depois**; `Budget.layoutFiles` fora do Prisma; exclusão de arquivo funciona | G11, `quote-diff` (coverage condicional), `quote-merge-rules`, `signature-refusal`, arte: send/approve-on-behalf (nota)/reprove/new-version/bulk, liberação automática e manual só com arte (trabalho novo), G11 com `PER_VEHICLE`, G33 (lado arte) |
| **P13a** — API portal: gravar frente, porta, projeto e a trava da série (∥ P12; api, worktree `impl/p13a`) | §6.3 nas linhas de **escrita**: `medidas.frente` e `portaTraseira` no PATCH de identificação e na requisição (`schemas/portal-request.ts`, `schemas/portal-vehicle-identity.ts`), `LADOS_DA_MEDIDA` + frente, mapa lado→coluna da requisição, `mexeNoCaminhao` (toda chave nova conta), multipart `implementVinPlate`, `POST /cliente/me/veiculos/:taskId/projeto`, guarda do documento congelado sem a frente/porta (sem 409), trava de edição de medida e de série em `IN_PRODUCTION` (DD5, pergunta 15); docs do contrato. **Não** faz W4/W5 nem as unicidades (P11a) nem a leitura do portal (P11b) | `portal-identity.*`, `portal-request.*`, `schemas/portal-request.ts`, `schemas/portal-vehicle-identity.ts`, `portal-vehicle-identity.ts`, `portal-frozen-document.ts`, `docs/PORTAL-CONTRATO.md` | "PATCH só com `medidas.frente` grava"; porta fora da faixa → 400; série e medida travadas em produção; projeto enviado cai em `Implement.projectFiles` | `portal-identificacao`, `portal-requisicao`, `portal-cliente:boot`, e2e-portal 01 (+ frente, + porta, + projeto) |
| **P14** — API: máquina do orçamento (∥ P13b; api, checkout principal) | **commit zero** (antes do worktree do P13b): promove a **M3o-a** e faz o rename D-35 sem mudar comportamento; **fim**: promove a **M3o-b** e os espelhos TS do enum (`src/constants/enums.ts`, `sortOrders.ts`). §2A inteiro e §6.14 (API); **DD11** ("Assinado fora do sistema", `SIGNED_OFFLINE`, `BudgetOfflineSignature`); **DD12** (um predicado do pedido de compra nas duas cerimônias, `purchase-order-gate.ts` apagado); `BudgetValueApproval` como registro (sem hash, DD8; fecha a vigente quando o orçamento sai de `APPROVED`); atos (send-to-customer, value-approval, reprovar, retirar — **sem** "dispensar assinatura", DD7); **portão da cobrança** `signatureStatus ∈ {SIGNED, SIGNED_OFFLINE, WAIVED}` em `internalApprove` (DD7, DD11, G34); grafo em duas tabelas; `budgetApprove` como "aprovar valor"; eixo `signatureStatus` escrito na transação do envelope (emissão, grupo 0, conclusão, recusa, vencimento, invalidação); `assertEmissionReady` nos três lugares + `gates` + `emission`; conclusão sem portão; `tolerateArtworkAfterSeal`; `LEGACY_APP`; nascimento decidido no servidor; X1–X9; portal: `portal-decision.*` (aprovar valor, recusa → PENDING, sem fabricar requisição); notificações novas no seed | `budget.service.ts`, `budget.guards.ts`, `budget.controller.ts`, `budget.module.ts`, `signature-envelope.service.ts`, `signature-expiry.scheduler.ts`, `portal-decision.*`, `attention.service.ts`, `dashboard-prisma.repository.ts`, `invoice-analytics.service.ts`, `schemas/{budget,task}.ts`, `service-order.service.ts:209-230,1897`, `task.service.ts:808-820,11060-11086` | máquina do §2A.5 inteira por teste; nenhum escritor de `Budget.status` fora da tabela; o app 1.4.1 aprova e reprova pela janela | **G26–G29, G31**, G33 (lado coleta), **G34**, **G35**, G36 (zera na integração), `portal-decisao` e `portal-assinatura-compras` reescritos, e2e-portal 03/04 reescritos (valor → arte → emitir → assinar) |
| **P13b** — API portal: aprovar a arte, e o orçamento visto pelo portal (∥ P14; api, worktree `impl/p13b`, criado depois do commit zero do P14) | `APPROVE_ARTWORK` (D-09) e `SECTION_IMPLIED_BY_CAPABILITY`; `portal-artwork.controller/service` + `schemas/portal-artwork.ts` (chamam `ImplementLayoutService.approveFromPortal/reproveFromPortal`, do P12); leitura do portal: artes por veículo (`PENDING_APPROVAL`/`APPROVED`/`REPROVED` + a última decisão), a arte do orçamento pelos implementos (agrupável por arquivo), `valueApproval`, `signatureStatus` (com "Assinada fora do sistema"), `artwork {…}`, o resumo (`valueApproval`, "artes aguardando você"), `signatureFacts` lendo o eixo e o marco "Arte aprovada" (estes três vinham do P14 no §6.3); notificação ao contato; seed da demo. **Não** faz o `emission` do portal (integração do par) | §6.3 nas linhas de arte, de resumo e de leitura do orçamento, `portal-notification.service.ts`, `scripts/seed-portal-demo.ts`, `docs/PORTAL-CONTRATO.md` | tabela-verdade das capacidades; 404 fora do escopo; motivo obrigatório; lote atômico; 409 em decisão repetida | novo `test:portal-arte`; `portal-recorte` com as colunas novas; `test:portal-cliente:boot` com as rotas novas; G17 (lado API) |
| **P20** — web: base compartilhada (**sozinho**, web) | tipos, schemas, api-client, hooks, query keys, constantes, permissões (§6.4, primeira tabela); `IMPLEMENT_FACES` com 4 faces; **`taskSerial()`**; espelhos do orçamento gerados do G5 (enum de 7, eixo, grafo, ordem; um mapa de rótulo só) | `types/*`, `schemas/*`, `api-client/*`, `hooks/common/*`, `hooks/administration/*`, `constants/*`, `utils/task.ts`, `utils/quote-status.ts`, `utils/permissions/quote-permissions.ts` | `tsc` lista os consumidores (esperado: cerca de 300); os `as any` perto de `truck` caçados à mão | G4 (web), G18, G26, G31 (web) |
| **P21** — web: produção (∥ P22; web) | §6.4, segunda tabela; `ImplementArtPanel`, `ImplementMeasuresSection`, porta traseira, projetos separados, garagem, changelog nas duas grafias, atenção (R3b com `implement.serialNumber`), dashboard (migrador + presets do DESIGNER), listas, exports; **§6.13 web nas telas de produção** (W nos formulários de tarefa, lote, duplicar, detalhe; Q nos pedidos) | §6.4, §6.13 | `build:with-tsc` verde; nenhum `layoutStatuses` sai do form da tarefa; nenhuma criação de tarefa sem `implement` | G8, G16, migrador do dashboard, `engine.test.ts`, testes de `taskSerial` e de `orderBy` do widget |
| **P22** — web: orçamento, faturamento, assinatura, públicas (∥ P21; web) | §6.5 inteiro; as 3 ESCRITAS `truck:` (w1–w3) primeiro; **§6.14 web interno** (checklist de emissão, badge de arte, "Aprovar valor em nome do cliente", cartão da aprovação do valor, coluna/filtro "Assinatura", preset "Prontos para emitir"; o "fixar Aprovado" do assistente **fica**, DD8; faturamento com o selo e o "Aprovar" travado sem assinatura, DD7); **sai o seletor de layout por veículo da `main`** (`budget-vehicle-layouts-field.tsx`, `layoutSlot`) e **fica a tela de N veículos** (DD6); §6.13 web nas telas de orçamento/faturamento | §6.5, §6.14 | nenhuma constante de include com `truck`/`layoutFiles`; web para de mandar `layoutFileIds` e `status` na criação | `billing-coverage.test.ts`, G4, testes do checklist (valor/arte/validade) |
| **P23** — web: portal (∥ P24; web) | §6.6 inteiro + §6.14 portal ("Esperando" em três eixos, aprovar valor, cartão da decisão, faixa "Para emitir falta…", "Valores/Artes para aprovar") | §6.6, §6.14 | `api-client/portal.ts` casa campo a campo com a projeção | `solicitacao-schema.test.ts` (o `:330` continua passando), testes novos de `veiculo-medidas-card` e de aprovação de arte e de valor, tabela do `waiting-on` |
| **P24** — app novo (∥ P23; app, branch nova da `main`) | §6.7 "P24" inteiro + §6.13 app (escrita da série em `implement`, `orderBy` da Agenda) + §6.14 app (enums de 7, lista derivada, "Aprovar valor" com nota, eixo da assinatura, checklist, arte por veículo) | ~50 arquivos de `lib/` + 13 de `test/`; **e o `AnkaaAero`** (Swift: `X-App-Version`, leitura de `implement` com recuo para `truck`; build nova reinstalada por cabo nos iPads **antes da R-C**, §6.7) | fala só `implement`; nenhuma chave legada no censo vinda desta versão; **sem glifo novo** (ou release nativa planejada) | `flutter analyze`, `flutter test`, `task_detail_include_test` lendo o JSON do G5, G8, G26, G31 |
| **P26** — e2e e dados persistidos (api) | reescrever `tests/e2e-portal/cenarios/{01,03,04}`, `tests/e2e-ui/*` (R1 + fluxo valor → arte → emitir → assinar); cenários novos (aprovar/reprovar arte, cobrança travada até assinar (G34), frente, porta, upload do projeto, G17, G23, G33); scripts e seeds que criam tarefa sem implemento (§6.13 classe B); script idempotente de tradução de `Preferences.dashboardLayoutWeb/Mobile` + reseed de notificações (`--dry-run`) | `tests/e2e-*`, `scripts/translate-preferences-implement.ts`, `prisma/scripts/seed-notification-configs.ts`, scripts da §6.13 | `test:portal-e2e` verde com a pilha dev | e2e |
| **P30** — ensaio em produção e deploy R-B (dono + 1 agente) | ensaio §4.6 em produção (quem tem acesso) + **revisão única sobre a combinação** + triagem levada ao dono (inclusive `QUOTE_ART_APPROVED_BY_LIVE_ENVELOPE`, `GALLERY_SUPERSEDED_BY_QUOTE`, `GALLERY_APPROVED_VS_QUOTE_PENDING`) + `pg_dump` + ordem §4.7 | — | invariantes zeradas; G11 "quem casava casa"; G29 100%; `build-info` do processo novo | pós-deploy: boot, e2e-portal, busca de tinta por placa e por série, a URL da Agenda (G32), exclusão de um arquivo de teste |
| **P31** — R-C (sozinho, curto) | **pré-condição: o `AnkaaAero` novo já reinstalado nos iPads** (ou exceção nomeada por UA); `MIN_APP_VERSION` = versão do P24; 426 para quem não manda cabeçalho; fim do `LEGACY_APP` | config da API | contador de alias caindo | — |
| **P28a / P28b** — leitores da série (api ∥ web) | §6.13, linhas "P28": os leitores passam a `implement.serialNumber`, **fiscais primeiro** (G21 na frente), depois portal e assinatura, por último painel, notificações, busca e scripts; web troca as leituras restantes por `taskSerial()` | §6.13 | G24 no valor final nos dois repos | G21, G22, G24 |
| **P32** — R-D (**sozinho**) | remover tradutor, espelho de resposta, aliases de rota e de contexto, sintetizador de `task.layouts`, `layoutFileIds` de `QUOTE_SAFE_AFTER_BILLING_FIELDS`; **M4**; **M5s**; tradução de `serialNumber` em `DEPRECATED_QUERY_KEYS` só sai se o censo mostrar zero clientes mandando a chave (senão fica: é barata); catraca do G6a e do G24 no valor final; `TRUCK_CATEGORY` alias fora | `DEPRECATED_QUERY_KEYS`, controllers alias, `budget.guards.ts:215`, M4, M5s | contador **zerado por 14 dias** e G24 zerada antes de começar | `pre-deploy.sh`; exclusão de arquivo depois de M4; G32 depois de M5s |

---

## 10. Plano de testes e de deploy

### 10.1 Camadas de teste (o que prova cada coisa)

| Camada | Onde | O que prova | Quando roda |
|---|---|---|---|
| Contrato de consultas (G1/G4) | `api/tests/query-contract.test.ts` + extratores web/app + fixtures do censo (G3) | toda forma de include/select/where que um cliente manda é aceita, traduzida ou recusada com 400 nomeado, nunca com 500 nem descartada calada | todo pacote, a partir do P01 |
| Matriz setor × campo (G7) | `api/tests/sector-field-matrix.test.ts` | nenhum setor leva 400 por campo novo | P01, P11, P12 |
| Hashes de ouro (G11) | `api/tests/signature-golden-hashes.test.ts` + régua no ensaio | quem casava antes casa depois (arte dos implementos na v7, `layoutCoverage` condicional, série lida do implemento) | P01 (base), P12, P14, P30 |
| Escritor × face (G15) | `api/tests/implement-measure-writer.test.ts` | as 4 faces gravam por todos os 9 caminhos | P04, P11 |
| Legado | `api/tests/implement-legacy-compat.test.ts` | `truck{…}` grava; include `truck` devolve `truck` e `implement`; os dois juntos → 400; `layoutIds` no-op passa, `layoutIds` com mudança → 400; `layoutFileIds` ignorado; `quoteLayoutFile` → 400; `/trucks/batch-update-spots` funciona; `?truckId=` no cotador funciona; **série no topo grava no implemento (G23)**; `truck: null` → 400; a URL exata da Agenda → 200 (G32); `status` na criação ignorado; `/budget-approve` sem nota → `LEGACY_APP` | P11, P12, P14 |
| Série | `api/tests/implement-serial.test.ts` + `tests/implement-required.test.ts` (banco de QA por migração) | W1–W6 gravam no implemento e o espelho acompanha (G19); todo caminho de criação gera implemento com `spot` explícito (G20); escrita direta em `Task.serialNumber` falha; tarefa sem implemento falha no COMMIT; rollback de série confere unicidade; notificação `task.field.serialNumber` dispara (G22) | P10, P11, P13a |
| Rótulos fiscais | G21 (`tests/nfse-discriminacao.test.ts`, `painter-nfse.test.ts`, `boleto-informativo-cobertura.test.ts` + recibo e `coverageLabels`) | o texto de hoje, byte a byte, com série, só placa, só chassi e sem nada | P05, P28 |
| Orçamento | `api/tests/budget-state-machine.test.ts`, `budget-value-approval.test.ts`, `emission-gate.test.ts` | §2A.5 inteira (manuais × sistema); editar o valor como hoje — auto-revert sem status fixado, status fixado mantém `APPROVED`, a aprovação vigente fecha ao sair de `APPROVED` (DD8; a G30 foi retirada); cobrança só com `SIGNED`/`SIGNED_OFFLINE`/`WAIVED` (G34); portão igual nos três caminhos (G28); `blockers` string (G27); eixo coerente (G29); arte que muda com coleta RUNNING/COMPLETED (G33); X1–X9 | P14 |
| Arte | `api/tests/implement-layout.test.ts` + `test:portal-arte` | máquina de estados do §7.1; nota obrigatória; 404 fora do escopo; lote atômico; 409 em repetição; O.S. só fecha com arte (trabalho novo); ator discriminado nunca grava `Responsible.id` em FK de `User` | P12, P13b |
| Boot | `test:portal-cliente:boot` | o grafo do Nest sobe com as rotas novas (pega DI, não include) | todo pacote de API |
| e2e do portal | `npm run test:portal-e2e` (pilha dev em 3031/5174; `tests/e2e-portal/run.sh:1-34`) | fluxo real: requisição com série, 4 faces e porta (implemento nasce com a série); **valor enviado → aprovado no portal**; arte enviada → aprovada no portal → O.S. "Aprovar com o Cliente" fecha → produção liberada; **emissão só com os dois** → assinatura (MARKETING assina `LAYOUT`) → contra-assinatura; arte nova durante a coleta derruba a coleta; reprovação com motivo; projeto enviado pelo portal; **G17** | P26, P30 |
| e2e da UI | `tests/e2e-ui/fase1..6` (Chromium + banco clonado + sentinela Elotech/Sicredi local) | orçamento sem seleção de layout do começo ao fim: aprovar valor em nome do cliente (nota) → arte aprovada em cada veículo → checklist verde → emitir → assinar (documento com a arte de cada veículo) → faturar; NFS-e com o mesmo rótulo e a mesma série de antes | P26, P30 |
| Web | vitest (`engine.test.ts`, `billing-coverage.test.ts`, `solicitacao-schema.test.ts`, migrador do dashboard, `veiculo-medidas-card`, `taskSerial`, `orderByEntry("serialNumber")`, `use-table-state`, checklist de emissão, `waiting-on` em três eixos, G8, G16, G18, G26, G31) + `build:with-tsc` | telas e contratos do web | P03, P20–P23 |
| App | `flutter analyze` + `flutter test` (13 arquivos afetados + contrato JSON dos dois formatos, inclusive a série) | parse tolerante, faces, arte, rótulos da nota, estados e eixo do orçamento | P02, P24 |
| Ensaio de migração | `scripts/rehearse-implement-migration.ts` (clone) e §4.6 (produção) | invariantes (M1s, M3 passo 5, M3o), contagens, triagem, G11, `migrate status` | P10, P30 |

### 10.2 Janela de deploy

| Release | Conteúdo | Pré-condições | Duração/risco |
|---|---|---|---|
| **R-0** (a qualquer momento) | P01, P03, P04, P05 (sem mudança de comportamento) | `pre-deploy.sh` verde | deploy comum (build antes; `systemctl`; conferir `build-info`). ⚠️ se a `feat/portal-do-responsavel` inteira ainda não foi a produção, R-0 sai da `main` (cherry-pick só dos portões) ou espera a R-B |
| **R-A** | P02 (patch OTA) + P06 (M0 + censo + log de versão) | P01 no ar | M0 aditiva; sem janela de 500 |
| (espera) | censo gravando por **≥ 2 semanas**; parque de apps com `X-App-Version` ≥ 90% | — | — |
| **R-B** | P10–P14, P13a/b, P20–P23, P26 (e as migrações da branch do portal que ainda não foram a produção) | ensaio verde em produção; G11 "quem casava casa"; triagem aprovada pelo dono; `pg_dump` | **API parada** durante M1, M1s, M2, M3, M3o (segundos a 1 minuto; a coluna gerada reescreve `Implement`), em horário de baixo uso; o web novo força o reload das abas velhas; o app velho continua funcionando pela janela bilíngue e pelo espelho da série |
| **R-B'** | P24 (app novo por patch; release nativa se entrar glifo) | R-B no ar | — |
| **R-C** | P31 (`MIN_APP_VERSION`) | ≥ 90% do parque na versão P24 | quem ficar atrás vê "Atualize o app" |
| (entre R-C e R-D) | P28a/P28b (leitores da série) | R-C no ar | deploy comum; nenhum contrato muda |
| **R-D** | P32 (remoção dos aliases + M4 + M5s) | contador de alias zerado por 14 dias; G24 zerada; M1s há ≥ 1 release em produção | M4 e M5s destrutivas: build antes, API parada |

Lembretes operacionais (memória): **buildar antes de migrar**; `pm2 restart` falha em silêncio, porque o serviço é **systemd**; health 200 pode ser o processo VELHO (confira o `build-info`); o bundle velho do web gera 500 falso; `git diff A...B` mente sobre "já na main" (use `git cherry`/`gh pr list`); `git push | tail` esconde falha.

---

## 11. Riscos ranqueados

| # | Risco | Gravidade | Probabilidade sem o plano | Mitigação no plano |
|---|---|---|---|---|
| 1 | Coletas de assinatura **RUNNING e COMPLETED invalidadas** (e `PADES_FAILED` no selo) porque a fonte nova de `layoutFileIds` (arte dos implementos) não reproduz o conjunto congelado: gêmeo da galeria promovido (outro `File.id`) ou imagem aprovada da galeria somada à união | ⛔ jurídica/comercial | **alta** se o M3 do v1 for usado como está (71/134 orçamentos com layout; nº 594 `COMPLETED`) | regras M-A..M-D na M3 passo 5; `layoutCoverage` só quando não uniforme; chaves congeladas; G11 "quem casava antes casa depois" como portão de deploy; rede `tolerateMigratedArtwork` desligada salvo resíduo |
| 2 | **Perda silenciosa de dado**: escrita com `truck`/`layoutIds` respondendo 200 (app instalado, bundle velho, 3 telas do web) | ⛔ dado | alta | tradutor + `.strict()` (G2); no-op/400 para arte; P02 antes; 426 depois |
| 3 | **403/500 em toda tarefa** por divergência entre zod, whitelist e Prisma, ou por `DEFAULT_TASK_INCLUDE`/`DETAIL_INCLUDE` com `quote.layoutFiles` | ⛔ operacional | alta | G1/G4 cruzando as três listas; P12 tira a chave do include padrão (`task-prisma.repository.ts:254`) no mesmo deploy; o mapeador descarta `layoutFiles` em qualquer profundidade |
| 4 | **Toda exclusão de arquivo falha** (`file_blocking_references` cita `quoteLayoutId`; `OUTBOUND_REFERENCES` monta `select` inválido ou vazio) e o organizador para | ⛔ operacional | certa, se só o Prisma mudar | coluna fica até M4; `CREATE OR REPLACE` antes do `DROP` na mesma migração; guarda de lista vazia; G10; teste de exclusão pós-deploy |
| 5 | **Corrida da aprovação**: formulário interno reenvia os status de todas as artes e desfaz a aprovação do cliente | alta (o cliente aprova e o sistema desaprova) | certa, se a arte ficar no form | arte sai do `PUT /tasks` (endpoints próprios); API recusa mudança de arte pelo caminho velho; `updateMany … where status`; G17 |
| 6 | **Setores sem permissão** de gravar `implement` (400 para todos menos ADMIN) | alta | alta, se testado como ADMIN | domínio no mesmo commit do zod; G7 proibindo teste só como ADMIN |
| 7 | **Alerta falso em massa** da Atenção (`isNull('truck.x')`) | alta (a equipe aprende a ignorar) | alta | caminhos no mesmo commit; ids das regras mantidos; G8 (web e app) |
| 8 | **Caminho de escrita de medida esquecido** (9 hoje, 10 com a outra branch): a frente grava num e some no outro | alta | alta | P04 (writer único) antes; G15 |
| 9 | **App que não converge** ("Agora não" do Shorebird; patch recusado por glifo novo; sem versão mínima) | alta | alta | P02 + censo + R-C; proibição de glifo novo; release nativa planejada se inevitável |
| 10 | **Notificações mudas** / preferências de silenciar perdidas | média | média | chaves mantidas; reseed com `--dry-run`; G9 |
| 11 | **NFS-e com rótulo divergente ou enum cru** (irreversível na prefeitura) | média/fiscal | média | valores de enum intactos; fonte única com perfil "nota"; exaustividade (G5); `nfse-discriminacao` atualizado antes |
| 12 | Busca de tinta por placa **vazia sem erro** (`paint.service.ts:503-527`) | média | certa, se esquecer | mesmo commit de M1; teste; `catch` loga como erro; G6a |
| 13 | Janela entre `migrate deploy` e restart com processo velho lendo `"Truck"`/`_TaskLayouts` | alta | certa, sem parar a API | API parada durante M1–M3; M4 separada |
| 14 | Medida compartilhada: o responsável corrige o próprio furgão e altera o de outro | média | já acontece | D-07 + de-compartilhamento em M2 |
| 15 | Configurações salvas somem (dashboard volta ao padrão, colunas, seções, filtros de URL); a fila do DESIGNER esvazia | média | alta, se mexer em enum/coluna | ids estáveis; migrador versionado; script de tradução; presets novos |
| 16 | Portão novo de arte bloqueia veículos antigos (1.729 com O.S. concluída e sem layout) | alta | certa, se retroativo | DD3: só trabalho novo (primeira O.S. de ARTE criada depois da R-B); sem dispensa (DD9: todo serviço tem arte); a liberação manual também respeita a arte (DD10) |
| 17 | A `feat/orcamento-veiculos` (outra sessão) **chegou à `main` e à produção** (23/09) — **aconteceu**; absorvida no P00 (merge api `cd61b7d1`, web `051a5c04`). O que sobra de risco: `BudgetLayoutTask` como fonte da M3, `layoutCoverage` congelado com `PER_VEHICLE`, o 10º escritor de medida (`implement-measure-replication.ts`) e caminhos novos de criação de tarefa | média | certa (já está na base) | DD6 (contingência): M3 passo 5 lê `BudgetLayoutTask` em `PER_VEHICLE`; flag `layoutScope` no builder; G11 com envelope `PER_VEHICLE`; P04 absorve a réplica de medida; G15 e G20 cobrem os caminhos novos; `rg "\.task\.create\(\|tasks: \{ create"` na combinação antes do P10 |
| 18 | Números do clone (jun/2026) ≠ produção | média | **medido no P00** (`P00-producao.md`, 23/09): 2.311 tarefas, 859 `Layout` (73 de aerografia), 311 layouts de orçamento em 301 orçamentos, 991 orçamentos numerados, 0 RUNNING, 30 COMPLETED, no máximo 2 veículos por orçamento | os números decisórios do plano são os de produção desde a Revisão 3; o ensaio (§4.6) mede de novo no dump da R-B |
| 19 | `File.layouts` muda de objeto para lista e telas quebram caladas | média | alta | relação renomeada para `artLayouts` (erro de tipo) |
| 20 | Arquivos públicos por UUID (arte pendente, projeto da Furgões) | média (pré-existente) | — | pacote próprio do portal (§9 de `PORTAL-DO-RESPONSAVEL.md`); fora deste plano, registrado |
| 21 | Cotador identifica a face por ORDEM: uma 4ª página muda a heurística | média | média | bench do cotador (`scripts/check-layout-dimensions.ts`) no P11 |
| 22 | Busca-e-troca corrompendo texto de tela e dado gravado (já aconteceu em julho) | baixa (cosmético, mas vai ao banco) | alta com `sed` | rename por AST; G6b |
| 23 | `deletePhysicalFile` apaga bytes de outra linha com o mesmo `path` (56 grupos) | alta, se a migração apagar `File` | baixa (a migração não apaga `File`) | regra "nenhum `DELETE FROM File`"; correção do `deletePhysicalFile` fica registrada como dívida |
| 24 | Dado `implementType = REFRIGERATED` não confiável (default de tela) | baixa | certa | defaults vazios (P03); não criar regra automática sobre o tipo sem revisão |
| 25 | (auditoria §13) **Arte não aprovada vazando para o chão**: o filtro por papel que hoje esconde layout não aprovado da PRODUÇÃO (`task.service.ts:10281-10300,10386-10400`) filtra `task.layouts`, que deixa de existir | alta | certa, se só renomear | mesmo filtro sobre `implement.layouts` e no sintetizador (§6.12); teste (a) |
| 26 | (auditoria §13) **Portão de D-15 no alvo errado**: várias O.S. de ARTE por tarefa e liberação por "qualquer uma concluída" | alta | alta | DD3: portão na regra de liberação, não em cada O.S.; o portal conclui só "Aprovar com o Cliente" |
| 27 | (auditoria §13) **Frente desenhada como "Motorista"** no app instalado (`layout_dimensions.dart:17-21`, fallback silencioso) | média | certa, se o cotador emitir `FRENTE` a todos | cotador condicionado à versão do app (P11) + enum no P24; teste (e) |
| 28 | (auditoria §13) **Toda leitura de arquivo em 500** pelo include padrão `layouts` de `file-prisma.repository.ts:114-120`, ao renomear `File.layouts` | alta | certa, se esquecido (o build emite com erro de tipo) | §6.12, no mesmo commit do schema; G0 (`noEmitOnError: true`) antes |
| 29 | (auditoria §13) **Exclusão de aerografia apaga arte de implemento** (`airbrushing.service.ts:1040`, `deleteMany({ where: { fileId } })`) depois do fan-out | média | média (File compartilhado; produção tem **73** linhas de `Layout` de aerografia, P00) | escopo `{ fileId, airbrushingId }`; teste (b) |
| 30 | (Revisão 2) **A Agenda do app instalado some (500)**: `orderBy[2].serialNumber` chega ao Prisma sem a coluna na tarefa | ⛔ operacional (tela principal do chão) | alta, se a série sair seca da tarefa | espelho por gatilho até a R-D; depois, tradução em `DEPRECATED_QUERY_KEYS`; G32 com a URL exata |
| 31 | (Revisão 2) **Série digitada some com 200** (app 1.4.1 e abas velhas do web gravam `serialNumber` no topo; o `taskUpdateSchema` não é strict) | ⛔ dado | alta | tradução da escrita no topo (D-32); nunca tirar a chave do zod antes da R-D; G23 |
| 32 | (Revisão 2) **Rótulo fiscal recua da série para a placa em silêncio** (select esquecido na migração dos leitores): NFS-e/boleto emitidos sem a série | alto (nota não se edita) | média | espelho (leitores intactos na R-B); G21 antes de mexer em leitor fiscal; P28 com os fiscais primeiro |
| 33 | (Revisão 2) **Tarefa sem implemento** por caminho esquecido (script, teste, `quick-budget`, app instalado, a outra branch) | alto (arte, porta e medida sem onde morar) | média | repositório sempre cria; gatilho diferido; G20; banco de teste por migração (G25) |
| 34 | (Revisão 2) **Banco de teste por `db push`** sem gatilho, coluna gerada nem GIN: teste verde, produção quebrada | médio | alta | G25; os testes de invariante rodam no QA com migrações |
| 35 | (Revisão 3, DD7) **Cobrança travada** para orçamento aprovado que não concluiu a assinatura: o que hoje se fatura com o valor aprovado (504 dos 536 aprovados de produção nunca tiveram coleta) passa a exigir coleta concluída; o nº 885 (coleta vencida, cobrança pendente) trava no dia da R-B | alto (caixa) | certa para trabalho novo | legado sem coleta migra `WAIVED` (faturável); triagem `LEGACY_APPROVED_UNSIGNED` levada ao dono; mensagem clara no web e no app (400 com a frase da DD7); o ato "Assinado fora do sistema" (DD11, nota e anexo) é a saída para o que foi assinado por fora, inclusive o nº 885; G34 |
| 36 | (Revisão 2) **Emissão com portão divergente** (preflight diz "pode", POST dá 400) ou **app instalado liberando o envio** porque `blockers` virou objeto | alto | média | `assertEmissionReady` único nos três lugares (G28); `blockers: string[]` intocado (G27) |
| 37 | (Revisão 3, DD8) **Valor editado continua "Aprovado"** quando o assistente fixa o status: o cliente aprovou um valor e o registro continua vigente com outro. É o comportamento de hoje, mantido pelo dono | médio (comercial) | média | a coleta cai por mudança material (como hoje), então **nada se assina nem se cobra** (DD7) com o valor novo sem nova coleta; o cartão "Aprovação do valor" mostra o total aprovado ao lado do atual |
| 38 | (Revisão 2) **Eixo da assinatura desencontrado** do envelope (escritor fora da transação — a classe "terceiro escritor" de 17/09) | médio | média | um escritor, na transação do envelope; G29 no teste e no pós-deploy |
| 39 | (Revisão 2) **Arte nova derruba contrato selado** com NFS-e e boleto na rua (X5), agora que a arte muda no implemento | alto | média | `tolerateArtworkAfterSeal` só para `COMPLETED`; deriva registrada; aditivo opcional (D-31); G33 |
| 40 | (Revisão 2) **Estados que somem da tela**: lista positiva à mão (web `BUDGET_QUOTE_STATUSES`, app `where`, `QUOTE_STAGE`, zod `schemas/budget.ts:32-45`) sem acompanhar o enum; link salvo com `PRE_APPROVED` dando 400 | médio | média | G31 (derivar do enum); peneira nos filtros de URL e nas configs salvas |
| 41 | (Revisão 2) **Migrações da branch fora de ordem** (datas anteriores a `20260922130000`, já aplicada em produção) | médio | média | `migrate status`/`migrate diff` no ensaio contra o dump (§4.6 item 3) |
| 42 | (Revisão 2) **Os 155 "Pendente" e o preset do comercial** mudam de sentido se alguém reaproveitar `PENDING` como "Aguardando Assinatura" (o rótulo da branch) | médio | baixa no Modelo C | o rótulo volta a "Pendente" (§2A.3); G26 confere o mapa de rótulo |
| 43 | (auditoria §14) **Contrato selado com tarefa cancelada deixa de casar**: `quoteArtworkOf` só sobre tarefas não canceladas zeraria `layoutFileIds` do nº 594 (4 tarefas CANCELLED, envelope COMPLETED) | ⛔ jurídica | certa, com o texto anterior | o conjunto é o de `vehicles[]` (todas as tarefas); E2 é que ignora as canceladas; G11 com o nº 594 como caso nomeado |
| 44 | (auditoria §14) **Tarefas presas em PREPARATION depois da migração**: 28 tarefas do clone (em produção, **6** tarefas vivas com O.S. de ARTE em `WAITING_APPROVE`) cuja única O.S. de arte é "Elaborar Layout" em `WAITING_APPROVE` recebem arte `PENDING_APPROVAL` (M3 passo 6), o cliente aprova no portal e nada fecha a O.S. | alta (chão parado sem aviso) | alta | DD3 (Revisão 3); aprovação da arte fecha a O.S. em `WAITING_APPROVE` e recalcula o estado da tarefa (§6.15); teste (f) |
| 45 | (auditoria §14) **Portão da DD3 que não existe**: a regra de liberação é função pura sem acesso à arte; com a linha "sem mudança de código", o portão nunca seria escrito, ou seria posto em cada O.S. (o que a DD3 descartou) | alta | média | §6.2 reescrito (argumento `artworkGate` + 6 chamadores); a liberação manual respeita a arte (DD10, confirmada na Revisão 3.1) |
| 46 | (auditoria §14) **Página pública do orçamento sem a arte** que o documento assinado leva ("bloco sai" do v1): o cliente aprova numa página e assina outra | alta (comercial) | certa, com o texto anterior | §6.2 item 19 e §6.5 itens 36–37 reescritos; `artwork` entra no `select` do `findPublic` |
| 47 | (auditoria §14) **M0 sem `MIGRATED_ENVELOPE`**: a M3 falharia inteira no ensaio (alto, não calado), mas a R-A já teria publicado o tipo errado e exigiria `ADD VALUE` fora de transação | média | certa, com o SQL anterior | SQL da M0 corrigido antes de qualquer aplicação |
| 48 | (Revisão 3, P00) **Terceiro cliente esquecido: `AnkaaAero`** (iPad iOS 12.5 da aerografia, sem OTA) lendo `truck`, `layouts`, `projectFiles` e a série: sai do ar na R-C (426 sem cabeçalho) ou na R-D (aliases removidos) | alta (a aerografia pinta pela tela dele) | certa, se ninguém lembrar | censo e fixtures do G4 com as 4 formas de include dele (P01); build nova com `X-App-Version` e leitura de `implement` reinstalada por cabo antes da R-C (P24, P31) |
| 49 | (Revisão 3, merge do P00) **Duas regras de pedido de compra na assinatura**: a da `main` (página pública OTP: quem **tem** `PURCHASING` informa o nº do pedido de cada veículo na cerimônia) e a da branch (sessão do portal: quem tem **só** `PURCHASING` leva 403 sem pedido no veículo) convivem, uma por cerimônia | média (o mesmo contato é tratado de dois jeitos conforme o canal) | certa | **resolvido pela DD12** (Revisão 3.1): vale a regra da `main` nas duas cerimônias, com um predicado só (`orderNumberRequirement`) e a guarda G35 (P14) |

---

## 12. Perguntas ao dono (curtas, com a recomendação)

As 22 perguntas do v1 foram respondidas pelas DD1..DD6 (a 1 pela DD6, a 2 e a 3 pela DD1, a 5 pela DD4, a 6 e a 20 pela DD2, a 9 e a 22 pela DD3, as demais pela DD5) e saíram daqui. A antiga 21 (aparelho com o RN antigo) foi feita no P00: nenhum aparelho com o RN fala com a API atual (§6.7).

**Revisão 3 — respondidas pelo dono em 23/09 e retiradas da tabela** (os números não são reaproveitados): a **1** e a **2** pela DD2 (o documento assinado leva a arte aprovada de cada veículo; Modelo C com o selo próprio "Assinatura"); a **3** pela DD7 (cobrança **só depois de assinado**; legado `WAIVED` faturável); a **5** pela DD8 (editar o valor depois de aprovado fica **como hoje**; o "fixar" fica, sem revogação por hash); a **11** pela DD9 (não existe "Dispensar arte") e pela DD7 (não existe "Dispensar assinatura"; o ato manual equivalente virou a **25**; os aprovados sem coleta migram "Dispensada (legado)"); a **23** pela DD10 (a liberação manual respeita a arte — **confirmada** na Revisão 3.1); a **24** pela DD3 (a aprovação da arte fecha também a O.S. de ARTE em `WAITING_APPROVE`). Ficam as abertas, na ordem em que travam o trabalho.

**Revisão 3.1 — respondidas e retiradas da tabela:** a **25** pela **DD11** (existe o "Assinado fora do sistema": COMMERCIAL/ADMIN, nota e anexo obrigatórios, eixo `SIGNED_OFFLINE`, que libera a cobrança como `SIGNED` e é distinto dele na tela e na trilha; o nº 885 sai por aí; a conciliação continua gravando `WAIVED`) e a **26** pela **DD12** (vale a regra da `main`: quem **tem** Compras informa o nº do pedido de cada veículo na própria cerimônia, nas duas). A DD10 foi **confirmada**.

| # | Pergunta | Recomendação | Trava |
|---|---|---|---|
| 4 | A aprovação do **vendedor do cliente no portal** já é a aprovação do valor (sem a Ankaa confirmar)? | **Sim**; o estado "Pré-aprovado", que nunca foi a produção, deixa de existir | P14 |
| 6 | O **app antigo** aprova sem nota. Aceitar como "aprovado pelo app antigo" até a tela "Atualize o app"? | **Sim** | P14 |
| 7 | Coleta **recusada ou vencida** mantém o valor aprovado? | **Mantém**; rever o preço é ato do comercial ("Reprovar valor") | P14 |
| 8 | Arte nova aprovada **depois da emissão**: com a coleta em andamento, a coleta cai (o valor continua aprovado)? Depois do contrato **assinado**, só registra e oferece um **aditivo de arte** opcional? | **Sim** para as duas | P12/P14 |
| 9 | Na migração, a arte de orçamento com **coleta em andamento** entra como "Aprovada" (exceção à regra "pendente vira aguardando aprovação"), senão a coleta cai? Vai numa lista para você conferir. (Produção em 23/09: **nenhuma** coleta em andamento; a regra só vale se aparecer uma até a R-B) | **Sim** | P10 |
| 10 | Imagens aprovadas da galeria que **não** estavam no orçamento viram "Substituída" **só** nos orçamentos com coleta em andamento ou concluída (onde o contrato cairia)? Nos demais ficam aprovadas, para a produção continuar vendo (Produção: 179 dos 301 orçamentos com layout têm imagem aprovada fora dele; a regra só as troca nos que têm coleta — hoje os 30 assinados) | **Sim** | P10 |
| 12 | Rótulos do orçamento: "Pendente" (o de produção; a branch dizia "Aguardando Assinatura"), "Aguardando aprovação do cliente" (era "Em Negociação") e "Aprovado" | **Sim** | P14/P22 |
| 13 | Orçamento criado **por dentro** fica visível ao cliente só quando o comercial clica "Enviar para aprovação do cliente"? | **Sim** | P14 |
| 14 | Alerta de "valor aprovado parado" sem emissão depois de quantos dias? | **15 dias** | P14 |
| 15 | O responsável pode trocar a **série** pelo portal depois que o veículo entra em produção? | **Não** (a mesma trava da medida; a série sai na nota) | P13a |
| 16 | Na passagem, a tarefa fica com uma **cópia automática, só de leitura, da série** até o fim da janela do app antigo? | **Sim** (é o que protege a Agenda, a busca e a nota) | P10 |
| 17 | **Séries antigas que não são séries** (em produção: 199 placas, 44 chassis "CH-…", 28 marcadores e 61 outras, todas em tarefas concluídas antes de jan/2026) migram como estão? | **Sim**; limpar é outra rodada | P10 |
| 18 | Veículo criado pelo portal nasce **sem vaga** (hoje nasce "aguardando no pátio")? E o filtro "Com caminhão" vira **"Implemento identificado"** (tem série, placa ou chassi)? | **Sim** para os dois | P10/P21 |
| 19 | Validação da série: manter a de hoje (e só quando a série muda) nesta entrega, e unificar numa regra só depois? E aceitar série com letras na criação em lote do web (ex.: `37772-RETRAB`)? | **Sim** para as duas | P11/P21 |
| 20 | O campo "Número de Série" do **faturamento** (que hoje aceita digitação e não salva) vira só leitura? | **Sim** | P22 |
| 21 | Recusa do valor no portal devolve o orçamento a **"Pendente"** (com a Ankaa), e não a "Requisição"? | **Sim** (o orçamento já tem preço) | P14 |
| 22 | (continua aberta, D-18) Palavras da nota e do boleto: "Isotérmico" ou "Isoplastic"? "Prancha/Plataforma" ou "Carroceria"? "OS #78000"/"Ref. OS" ou "Série 78000"? | **Nada muda até você escolher**; cada documento continua com o texto de hoje | P05 (só se decidir) |

---

## 13. Auditoria de completude

> **Revisão 3:** as §13 e §14 são o **registro** das auditorias da v1 e da Revisão 2, com os números e as perguntas daquele momento. Onde elas citam "cobrança no valor aprovado", "Dispensar arte", "Dispensar assinatura", `reassessValueApproval`/hash do valor ou as perguntas 1, 2, 3, 5, 11, 23 e 24 como abertas, **vale a Revisão 3/3.1** (DD6..DD12, §2.2, §12).

> As subseções 13.1 a 13.5 são a auditoria **da v1** (mantidas como registro; as correções que ela gerou estão no lugar). Onde elas citam a antiga pergunta 22 ou decisões que a Revisão 2 mudou, vale o texto das seções 0 a 12. A revisão da Revisão 2 está na §13.6. A auditoria independente da Revisão 2 (varredura, conferência no código e no clone, correções no lugar) está na §14.

Feita em 23/09/2026, depois do plano, sobre os mesmos HEADs (api `ad3c65d4`, web `989c9f6e`, app `9335286`, todos conferidos). Foi só leitura: `rg`, `git log/show`, leitura de arquivo. Nenhum SELECT e nenhum comando que escreva. As correções que ela gerou já estão **no lugar** nas seções acima, marcadas com "auditoria §13". As lacunas estão na §6.12.

### 13.1 Varredura e números

Padrão varrido (sensível a caixa, substring): `Truck|truck|TRUCK|implementType|ImplementType|ImplementMeasure|implementMeasure|backSideMeasure|leftSideMeasure|rightSideMeasure|layouts|Layout\b|LayoutStatus|layoutFiles|layoutFileIds|quoteLayout|QUOTE_LAYOUT|TaskLayouts|projectFiles|TASK_PROJECT_FILES|Caminh|Projeto|Tipo de Implemento`, sem `node_modules`, `dist`, `build` nem `.dart_tool`. `TruckCategory` e `TRUCK_SPOT` já caem em `Truck|TRUCK`. Pastas: api `src prisma tests scripts`; web `src` (o web **não tem** `tests/` nem `e2e/`); app `lib test`. Não há `.g.dart` (o app não usa codegen, §6.7).

Um arquivo conta como "coberto" quando o plano o cita por caminho (sufixo com ao menos uma pasta) ou por nome **único** no repositório. Cada nome ambíguo foi resolvido lendo o trecho. "Grupo" = coberto por regra nomeada sem ambiguidade: migrações históricas (nunca se editam), `tests/e2e-ui/fase1..6` e `pages/tools/truck-studio/**` (fora do rework). "Sem mudança" = casou só por ruído: `Layout` de tela ou de e-mail (`MainLayout`, `DashboardLayout`), `IconTruck`/`TablerIcons.truck`, `TRUCK_MANUFACTURER`/`TruckManufacturer` (montadora da tinta), comentários sobre o Truck Studio, "Caminho" (endereço ou path), arte da aerografia (que fica) e `implementMeasureId` da análise de pintura (sem mudança).

| Repo | Arquivos varridos | Cobertos (caminho/nome) | Cobertos (grupo) | **Lacunas** (agora na §6.12) | Sem mudança | Fora da varredura, achados lendo o código |
|---|---:|---:|---:|---:|---:|---|
| api | 274 | 143 | 29 | **15** | 87 | `layout-dimensions/engine/faces.ts` (não cita nenhum identificador) |
| web | 476 | 180 | 66 | **23** | 207 | `task/detail/service-orders-section.tsx`, `utils/permissions/service-order-permissions.ts` |
| app | 123 | 68 | 0 | **4** | 51 | `lib/features/files/layout/layout_dimensions.dart` |
| **total** | **873** | **391** | **95** | **42** | **345** | **4** |

Além dos arquivos que faltavam, havia **trechos faltando em arquivos já citados** (o arquivo estava no plano, mas a linha que quebra não):

- `task.service.ts`: filtro por papel (`findById`/`findMany`), migração de pasta na troca de cliente e cerca de 40 trechos de `layouts`/`layoutIds` em `create`, `batchCreate`, `update`, `batchUpdate`, `rollbackFieldChange` e `copyFromTask`.
- `airbrushing.service.ts:1040`.
- `task-notification.service.ts:37,52,101`.
- `layout.listener.ts` (`relatedEntityType`).
- `portal-request.service.ts:126`.
- `schemas/file.ts:16`.
- `task_permissions.dart:255-280`.
- `notification_router.dart:357-366`.

Todos estão na §6.12.

### 13.2 O que faltava (resumo; o detalhe e o pacote estão na §6.12)

| # | Arquivo | Por que importava | Classe do defeito que evitaria |
|---|---|---|---|
| 1 | api `common/file/repositories/file-prisma.repository.ts:73-74,114-120` | include **padrão** `layouts` em toda leitura de File | 500 em toda leitura de arquivo (include desatualizado) |
| 2 | api `task.service.ts:10281-10300,10386-10400` | filtro por papel da arte | arte não aprovada vista pelo chão, sem erro |
| 3 | api `task.service.ts:10421-10640` | troca de cliente move arquivos | arte e projeto na pasta errada |
| 4 | api `task.service.ts` (~40 trechos de `layouts`) | includes/escritas da arte pela tarefa | 500 em runtime (o build emite com erro de tipo) |
| 5 | api `airbrushing.service.ts:1040` | `deleteMany` por `fileId` | apagar arte de outro dono |
| 6 | api `task-notification.service.ts:37,52,101` + spec | notificação de anexos por diff de `task.layouts` | notificação muda |
| 7 | api `layout.listener.ts:94-222` | `relatedEntityType` 'ARTWORK' sem tarefa | deep link quebrado no app |
| 8 | api `layout-dimensions/engine/{types,faces,doctrine}.ts` | o motor do cotador tem o próprio `PanelSide` | frente não reconhecida / regra de altura errada |
| 9 | api `task.events.ts:60-62` | resumo das faces na notificação | frente fora da mensagem |
| 10 | api `implement-measure.repository.ts`, `truck.module.ts`, `app.module.ts`, `schemas/index.ts`, `budget.repository.ts`, `dashboard.repository.ts` | interfaces, DI e barris | quebra de boot/tsc (mecânico) |
| 11 | api `portal-request.controller.ts:84` + `.service.ts:126` | recibo com `truckId` | contrato do portal fora de sincronia |
| 12 | api `constants/service-descriptions.ts` (+ web) | quais O.S. de ARTE existem | portão de D-15 no alvo errado |
| 13 | api `types/layout.ts` | tipo com 3 estados | tipo que mente |
| 14 | api `schemas/task-bulk.ts:79` + rota `bulk/upload-files` | caminho morto que criava arte `APPROVED` | aprovação sem aprovador (apagar) |
| 15 | web `task/layout/*` + `layout-file-upload-field.tsx` | seletor de status **compartilhado com a aerografia** | aerografia oferecendo estados do portal |
| 16 | web `common/file/{file-card-upload-field,file-upload-field,file-uploader}.tsx` | union de status à mão | tipo que mente |
| 17 | web `task/list/task-export.tsx` | exportação da lista por `task.layouts` | coluna vazia/500 |
| 18 | web `service-orders-section.tsx`, `service-selector-auto-grouped.tsx`, `designar-service-order-dialog.tsx`, `service-order-permissions.ts` | UI da O.S. de ARTE | botão que leva a 400 |
| 19 | web `pages/cliente/solicitar.tsx` | valor inicial da requisição | página do portal esquecida |
| 20 | web `pages/production/root.tsx`, `utils/file-relationship.ts`, `use-column-widths.ts`, `garage/index.ts`, `production-calendar.tsx` | contrato do dashboard, contextos, ids | dado que "não aparece" |
| 21 | web `BulkOperationsSimplified.tsx`, `SimpleBulkActionsTest.tsx` | código morto com "Layout Referência" | resíduo (apagar) |
| 22 | app `layout_dimensions.dart` | `PanelSide` com fallback para Motorista | **frente desenhada como Motorista no app instalado** |
| 23 | app `linked_task_card.dart`, `app_file.dart`, `presets.dart`, `list_scaffold.dart`, `task_permissions.dart:255-280` | identificador, status, presets do DESIGNER, O.S. | app atrás do web |

### 13.3 Afirmações carregadoras de peso conferidas no código

| # | Afirmação do plano | Veredito | Evidência / correção |
|---|---|---|---|
| A1 | Linhas do schema (V9): Layout 87, File 753 (`quoteLayoutId` 761, relação 774, índice 832), Budget 1886 (`layoutFiles` 1983), Task 2338 (`truck` 2397, `layouts` 2410, `projectFiles` 2411), Truck 2530-2562, ImplementMeasure 2564-2576, LayoutStatus 3991, TruckCategory/ImplementType 4297/4310 | **CONFIRMADA** | `grep -n` no HEAD `ad3c65d4` |
| A2 | `model Responsible` é a tabela física `"Representative"` (V6) | **CONFIRMADA** | `schema.prisma:3619,3672` |
| A3 | Nomes de constraint e índice do M1 | **CONFIRMADA** (no histórico de migrações; em produção, conferir no catálogo, como o próprio M1 manda) | `0_init/migration.sql:1234,2686-2704,3451`; `20260705130000…:34-39`; `20260727150000…:36,45`. Não há índice sobre `plateNormalized`/`chassisNumberNormalized` |
| A4 | M2M: `_TASK_PROJECT_FILES` A=File/B=Task; `_TaskLayouts` A=Layout/B=Task | **CONFIRMADA** | `20260225120000…:4-15` (FK A→File, B→Task); `20260705130000…:62-65` (`_TaskArtworks`→`_TaskLayouts`, ordem alfabética preservada) |
| A5 | `Layout_fileId_key` existe como **índice** único | **CONFIRMADA** | `20260705130000…:53` (`ALTER INDEX "Artwork_fileId_key" RENAME TO "Layout_fileId_key"`): o `DROP INDEX` do M3 é o que age; o `DROP CONSTRAINT IF EXISTS` é inócuo |
| A6 | Valores de enum usados no SQL (`BudgetStatus` APPROVED/SIGNED/EXPIRED/CANCELLED/REQUESTED/IN_NEGOTIATION/PRE_APPROVED/PENDING; `ServiceOrderType.ARTWORK`; `ServiceOrderStatus.WAITING_APPROVE`) e colunas (`Task.quoteId`, `File.mimetype/originalName/filename/size/path`, `ImplementMeasure(Section)`) | **CONFIRMADA** | `schema.prisma:4662-4705,3948-3963,2385,755-759,2564-2590`. Um valor errado faria a migração falhar inteira; não há |
| A7 | `file_blocking_references` cita `quoteLayoutId` em `:43-48`; o esqueleto de M4 bate com o corpo atual menos esse bloco | **CONFIRMADA** | `20260804180000_file_referenced_delete_guard/migration.sql:31-79` (filtro `thumbnail_jobs` presente nos dois) |
| A8 | `paint.service.ts:503-517` faz `LEFT JOIN "Truck"`, e o `catch` engole | **CONFIRMADA, com correção** | o `catch` **já** loga com `logger.error` (`:525`); o defeito é devolver `[]`. Corrigido na §6.1 |
| A9 | O include **padrão** da tarefa pede `quote.layoutFiles` | **CONFIRMADA** | `task-prisma.repository.ts:254` |
| A10 | Portões "Selecione um layout aprovado…" em `budget.service.ts:3640-3649` e `signature-envelope.service.ts:1077-1108` | **CONFIRMADA** | textos idênticos nas linhas citadas |
| A11 | Snapshot v4, material v7, `SUPPORTED_MATERIAL_VERSIONS = [7..1]` | **CONFIRMADA** | `quote-snapshot.service.ts:220,297,300` |
| A12 | `prismaRelationValue` deixa passar chave inventada | **CONFIRMADA** | `schemas/task.ts:1098-1120`: é `z.record(z.string(), …)` recursivo. Não é `.passthrough()` literal, mas o efeito é o mesmo: qualquer chave chega ao Prisma |
| A13 | O Flutter só LÊ `projectFiles`; a seção só aparece para ADMIN/COMERCIAL/LOGÍSTICA/DESIGNER (V3) | **CONFIRMADA** | `projectFile` só em `task.dart:266-486` e `task_detail_config.dart:199,279-284`; `task_permissions.dart:341-344` |
| A14 | O app não manda versão; não há versão mínima | **CONFIRMADA** | `dio_client.dart:158-172` (só `X-Request-ID` e `Authorization`); nenhum `X-App` em `lib/` |
| A15 | O RN antigo está morto: mesmo bundle id, último commit em 14/08 | **CONFIRMADA** | `mobile/app.json:21,46` = `build.gradle.kts:42` (`com.ankaadesign.management`); `16d5916d` 2026-08-14 |
| A16 | Branches: portal api +17/−11, web +19/−4; outra sessão api +11, web +4, últimos às 09:28 e 09:33 | **CONFIRMADA**; D-16 **incompleta** | 5 commits sem destino (`2d4e729b`, `7efe59db`, `550f9274`, `36a3f098`, `58a92ba8`); destino acrescentado em D-16 |
| A17 | A DESIGNER não tem `truck` nem `projectFiles` na escrita | **CONFIRMADA**; §5.3 item 5 **incompleto** | `task.permissions.ts:177-185`; acrescentado "DESIGNER ganha `projectFiles`" |
| A18 | Não há CI nem hooks; `noEmitOnError: false`; web `build` sem `tsc`; `tsconfig` inclui só `src` e `test` | **CONFIRMADA** | `api/tsconfig*.json`; `web/package.json:8-9`; nenhum `.github`/`.husky`/hook nos 3 repos |
| A19 | Base do G6a: api 2.324/122, web 2.976/205, app 1.030/72 | **ERRADA** (não reproduz) | ver a correção no G6a (§8): a base sai da 1ª execução do script, sem `-i` |
| A20 | Caminhos citados existem | **3 ERRADOS**, os demais existem | `airbrushing/detail/…` → `airbrushing/detail-page/…`; `painting-budget/faces-card.tsx` → `painting-budget/detail/faces-card.tsx`; `portal-vehicle-identity.ts:57,175` é `src/schemas/…` e `:111-158` é `src/modules/people/portal/…`. Também `components/widget-tile.tsx` → `dashboard/components/widget-tile.tsx`. Todos corrigidos no lugar |
| A21 | `bulkUploadFiles` "nasce DRAFT" | **ERRADA como destino** | a rota `POST /tasks/bulk/upload-files` não tem chamador no web nem no app: apagar (§6.2, §6.11, D-10) |

### 13.4 O plano contra R1..R8

| Req. | Pacote | Tela | Migração | Teste | Veredito |
|---|---|---|---|---|---|
| R1 orçamento sem layout | P12, P22, P24 | web §6.5; app `budget_form_screen`/`budget_sections` | M3 passo 5 + M4 | G11, `quote-diff`, e2e-portal 03/04, e2e-ui | **coberto** |
| R2 arte no implemento, aprovada pelo responsável | P12, P13b, P21, P23, P24 | `ImplementArtPanel`, `veiculo-arte-card`, app "Arte" | M3 passos 1b/4/5/6 | `implement-layout`, `test:portal-arte`, G17 | **coberto, com lacunas fechadas na §6.12**: filtro por papel, seletor compartilhado com a aerografia, notificação/deep link, D-15 ambíguo (resolvido pelo DD3 na Revisão 2) |
| R3 Truck→Implement | P10, P11, P20, P24 | todas as de §6.4/6.7 | M1 | G0, G1, G4, G6a, legado | **coberto**; lacunas mecânicas (DI, barris, interfaces) na §6.12 |
| R4 tipo e categoria diretos | P11, P20, P24 | selects "Tipo"/"Categoria" | M1 (`implementType`→`type`, enum renomeado) | legado (`implementType`→`type`) | **coberto** |
| R5 frente + porta traseira | P04, P11, P13a, P21, P23, P24 | editor de medidas, portal, app | M2 | G15, `portal-identificacao`, e2e 01 | **coberto, com lacunas**: motor do cotador na API, `layout_dimensions.dart` no app instalado (risco 27), `task.events.ts`, `solicitar.tsx` |
| R6 projeto da tarefa × do implemento | P10, P12, P13a, P21, P24 | "Projeto da tarefa"/"Projeto do implemento"; portal | M3 passos 2/3/5c | invariantes do §4.6; e2e upload do projeto | **coberto**; DESIGNER sem permissão de `projectFiles` corrigido (§5.3) |
| R7 separar tarefa × implemento no portal | P13a, P13b, P23 | §7.5 | — | `portal-recorte`, boot | **coberto** |
| R8 atualização limpa | P01 (G0–G14), P02, P31 | — | ensaio §4.6 | todo o §8 | **coberto**; a própria auditoria achou 3 classes que os guardas pegariam **só** depois de G0 ligado (include padrão de File, `layouts: true` na `task.service`, interfaces). Isso reforça que o P01 roda **antes** de tudo |

**Contradições internas encontradas e corrigidas no lugar:**
1. V3 mandava a DESIGNER ganhar `projectFiles` "no §5.3 item 5", e o item não dizia isso.
2. D-10 falava de um `bulkUploadFiles` que não tem chamador.
3. D-25 listava 6 defaults, e o P03 só 3 (sem `:593` nem o app).
4. D-16 deixava 5 commits da outra sessão sem destino.
5. G6a trazia uma base que não reproduz.
6. Havia 4 caminhos errados (A20).

Nenhuma contradição de ordem entre pacotes ou releases foi achada.

### 13.5 Veredito

**O plano está completo o bastante para executar**, depois das correções desta seção. O desenho (modelo, migração, janela bilíngue, guardas) está certo e o que ele afirma bate com o código: das 21 afirmações conferidas, 17 estão confirmadas (em 2 delas o texto do plano estava incompleto), 1 confirmada com correção e 3 erradas, e o SQL de M1 a M4 usa nomes de tabela, coluna, constraint, índice e valor de enum que existem. A cobertura por arquivo era de **~91% dos arquivos que precisam de atenção** (391 + 95 cobertos contra 42 lacunas + 4 fora da varredura).

As lacunas eram de classe conhecida, exatamente as que o R8 teme:
- **include padrão esquecido**: `file-prisma.repository.ts`, que levaria toda leitura de arquivo a 500;
- **regra de visibilidade que morre com a relação**: o filtro por papel, que deixaria arte não aprovada à vista do chão;
- **tela e app que ficam atrás**: o cotador do app instalado desenharia a frente como "Motorista"; a UI da O.S. de ARTE;
- **uma decisão mal especificada**: o D-15, com várias O.S. de ARTE por tarefa.

Todas agora têm linha, pacote e teste (§6.12) e risco (25 a 29); o D-15 foi decidido pelo dono (DD3).

**Três condições, sem as quais o veredito cai:**
1. O **P01 (G0 com `noEmitOnError: true`) vai antes de qualquer rename**. Três das lacunas só são pegas por tipo, e hoje o build emite com erro.
2. ~~A pergunta 22 é respondida antes do P12~~ — cumprida: DD3 (Revisão 2).
3. O **P11 decide como o cotador trata a FRENTE para o app instalado** antes de emiti-la.

### 13.6 Revisão 2 — o que o revisor conferiu, corrigiu e decidiu

Feita em 23/09/2026 sobre os mesmos HEADs (api `ad3c65d4`, web `989c9f6e`, app `9335286`), lendo o v1 inteiro e os relatórios `08`–`11` inteiros. Só leitura: `git show/ls-tree/ls-files`, `grep`/`sed` e SELECT no clone.

**Afirmações dos relatórios novos conferidas no código ou no dado**

| # | Afirmação | Veredito | Evidência |
|---|---|---|---|
| B1 | `REQUESTED`/`IN_NEGOTIATION`/`PRE_APPROVED` nunca foram a produção (`09`) | **CONFIRMADA** | `git show main:prisma/schema.prisma:4522-4540` (5 valores); `git cat-file -e main:src/modules/people/portal/portal-decision.service.ts` falha; `PRE_APPROVE` ausente de `main:portal-capabilities.ts` |
| B2 | Rótulo de `PENDING`: "Pendente" na `main`, "Aguardando Assinatura" na branch (`09`) | **CONFIRMADA** | web `main:src/constants/enum-labels.ts:2478` × `src/constants/enum-labels.ts:2481` |
| B3 | Migrações de estado só na branch, com data anterior a uma já aplicada na `main` (`09` F10) | **CONFIRMADA** | `git ls-tree main prisma/migrations/` tem `20260922130000_envelope_lembra_o_que_ja_avaliou`; a branch tem `20260920120000…` e `20260920190000…` e não tem a de 22/09 |
| B4 | Distribuição `Budget.status` × último envelope (`08` §1.9) | **CONFIRMADA** | SELECT no clone: APPROVED/– 427 (158 com cobrança aprovada), APPROVED/EXPIRED 1, APPROVED/INVALIDATED 1, CANCELLED/COMPLETED 1 (nº 594), EXPIRED/REFUSED 6, PENDING/– 155, PENDING/EXPIRED 1, PENDING/REFUSED 1, PENDING/RUNNING 7, REQUESTED/– 6, REQUESTED/RUNNING 9 |
| B5 | 2.253 tarefas, 1.678 sem `Truck`, 2.013 séries (`10`) | **CONFIRMADA** | SELECT no clone |
| B6 | A emissão força `PENDING` de qualquer estado ≠ PENDING/CANCELLED (`08` X1) | **CONFIRMADA** | `signature-envelope.service.ts:1531-1545` (lê `estadoAnterior` e grava `PENDING` sem olhar a cobrança) |
| B7 | Só se fatura orçamento `APPROVED` (`08`, `09`) | **CONFIRMADA** | `budget.service.ts:3889-3895` |
| B8 | `budgetApprove` exige `Budget.layoutFiles` (`08`, v1) | **CONFIRMADA** | `budget.service.ts:3640-3650` |
| B9 | Filtro negativo do financeiro (`08` X6) | **CONFIRMADA** | `src/schemas/task.ts:1775` |
| B10 | Portal: `PRE_APPROVE: IN_NEGOTIATION→PRE_APPROVED`, `REFUSE: →REQUESTED` (`08`) | **CONFIRMADA** | `portal-decision-transitions.ts:38-47` |
| B11 | `ROLE_DEFAULT_SECTIONS`: MARKETING só `LAYOUT`, FINANCIAL sem `LAYOUT`, PURCHASING tudo, FLEET/DRIVER nada | **CONFIRMADA** | `quote-sections.ts:128-141` |
| B12 | Capacidade `PRE_APPROVE` em COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR; MARKETING e PURCHASING sem | **CONFIRMADA** | `portal-capabilities.ts:134-180` |
| B13 | O app instalado lista só `[EXPIRED, SIGNED, PENDING, APPROVED]`, cria com `'status': 'PENDING'`, pina `status` em todo save e lê `blockers` só como string (`09`) | **CONFIRMADA** | `budget_list_config.dart:89-91`; `budget/budget_form_screen.dart:1969`; `budget.dart:1227-1231`; `envelope_models.dart:781-784` |
| B14 | A Agenda do app manda sempre `orderBy[2].serialNumber` (`11`) | **CONFIRMADA** | `task_schedule_view.dart:318-325` |
| B15 | O repositório só cria caminhão `if (truck)`, com `spot` nulo (`10`) | **CONFIRMADA** | `task-prisma.repository.ts:1060-1074` |
| B16 | `PUT /tasks` com `truck: null` apaga o caminhão (`10`) | **CONFIRMADA** | `task.service.ts:2562-2567` |
| B17 | `quote-snapshot.service.ts` lê a série da tarefa e a placa/tipo do caminhão (`10`) | **CONFIRMADA** | `:490-499` |
| B18 | `onQuoteContentChanged` é chamado em `budget.service.ts:2219,2596`, `service-order.service.ts:1897`, `task.service.ts:12206` (`08` §2.5) | **CONFIRMADA** (e é **pós-commit**, `service-order.service.ts:1881`, `task.service.ts:10809`) | `grep` |
| B19 | A O.S. "Aprovar com o Cliente" existe entre as 7 O.S. de ARTE | **CONFIRMADA** | `src/constants/service-descriptions.ts:183-191` |
| B20 | `BudgetRequest` tem `preApprovedAt`/`preApprovedByResponsibleId` (a M3o usa) | **CONFIRMADA** (o nome que o `08` sugeria, "preApprovedBy", é a relação; a coluna é `preApprovedByResponsibleId`) | `schema.prisma`, `model BudgetRequest` |
| B21 | `shorebird.yaml` não existe no checkout (`11` §3.3, pergunta 7) | **ERRADA** | `git ls-files shorebird.yaml` (versionado); corrigido em V16 |

**Divergências entre relatórios e como ficaram:** V11 (modelo da máquina: C), V12 (cobrança no valor aprovado, com pergunta 3), V13 (M-B só onde o hash obriga), V14 (arte de coleta em andamento entra aprovada), V15 (regra da série: a de hoje), V16 (Shorebird).

**Correções que o revisor fez no desenho herdado dos relatórios**

1. **M-B restrito** (V13): o `08` mandava para `SUPERSEDED` toda imagem aprovada da galeria fora do layout do orçamento nos 134 orçamentos com layout; isso esconderia arte do chão em tarefas em voo. Ficou só onde o hash obriga (coleta `RUNNING`/`COMPLETED`), com triagem nos demais.
2. **`WAIVED` para o legado**: sem ele, os 427 aprovados sem coleta cairiam em "Não emitida" e inundariam o filtro "Prontos para emitir". O `09` não previa esse valor.
3. **`SIGNED` fica no enum** (o `09` o deixava "legado", mas não dizia por quê): o app instalado filtra por ele; tirá-lo daria 400 na lista do celular.
4. **A M3o não reescreve migração** (o `09` sugeria reescrever `20260920120000`/`20260920190000`): arquivo aplicado no clone e nos bancos de QA não se edita; a M3o recria o tipo e o `queueRank` por cima.
5. **Elo `supersedesId` com unicidade dos dois lados** no SQL do M-B (a forma "um `DISTINCT ON`" poderia gravar o mesmo antigo em duas linhas e violar o `@unique` no meio da migração).
6. **CHECK da dispensa de arte sem exigir o autor**: a FK é `SET NULL`; um CHECK exigindo o autor faria a exclusão de usuário falhar.
7. **D-18 com perfis por documento**: "não mudar palavra" com uma fonte única que unificasse os mapas já mudaria dois documentos (eles divergem hoje).
8. **Recusa do valor volta a `PENDING`** (não a `REQUESTED`): o orçamento recusado tem preço; `REQUESTED` quer dizer "sem preço".
9. **`reassessValueApproval` e `onQuoteContentChanged` são pós-commit**: o texto não promete "mesma transação" para revogação e invalidação; promete ordem.
10. **R-0 e a branch**: os portões da Fase A vivem numa branch que ainda não foi a produção; o deploy deles antes da R-B exige cherry-pick para a `main` ou esperar.

**Veredito da Revisão 2.** O plano continua executável na ordem da §9, agora com dois pacotes a mais (P14 e P28) e duas migrações a mais em R-B (M1s, M3o) e uma em R-D (M5s). As três condições da §13.5 continuam (a 2ª cumprida pelo DD3), e somam-se três: **(4)** as perguntas 1, 2, 3, 9, 10, 11 e 16 respondidas antes do P10 (definem o SQL da M1s, da M3 passo 5 e da M3o); **(5)** G11 com o critério "quem casava antes casa depois" verde no ensaio de produção antes da R-B; **(6)** bancos de teste por migração (G25) antes de qualquer teste da série ou do implemento obrigatório ser considerado verde.

---

## 14. Auditoria da Revisão 2

Feita em 23/09/2026, depois da Revisão 2, sobre os mesmos HEADs (api `ad3c65d4`, web `989c9f6e`, app `9335286`). Li o plano inteiro. Só leitura nos repositórios: `rg`, `grep`, `sed`, leitura de arquivo e SELECT no clone local (PostgreSQL 17.10, dado real até ~30/06/2026 mais os testes locais de julho a setembro). O único arquivo alterado é este. Toda correção feita no corpo está marcada "auditoria §14", e as lacunas estão na §6.15.

### 14.1 Varredura independente e números

**Método.** Rodei `rg -l` nas pastas pedidas: api `src prisma tests scripts`, sem as migrações históricas (3 citam `serialNumber`; nunca se editam); web `src`; app `lib test`. Ficaram de fora `node_modules`, `dist`, `build` e `.dart_tool`. Não há `.g.dart` no app (`find lib -name '*.g.dart'` = 0). Um arquivo conta como coberto quando o plano o cita por um sufixo de caminho com ao menos uma pasta ("caminho") ou por um nome **único** no repositório ("nome"). Resolvi cada nome ambíguo lendo o trecho. Cada arquivo não citado foi lido.

- **Série:** padrão `serialNumber|serialNumberNormalized`.
- **Estados do orçamento:**
  - identificadores `BudgetStatus|BUDGET_STATUS|TASK_QUOTE_STATUS|TaskQuoteStatus|PRE_APPROVED|IN_NEGOTIATION|kBudgetStatus|quoteStatus|QUOTE_STATUS`;
  - mais os literais `'PENDING'|'APPROVED'|'SIGNED'|'EXPIRED'|'REQUESTED'|'CANCELLED'` que aparecem a até 80 caracteres de `quote|budget|orcamento`;
  - mais uma terceira passada por `PRE_APPROVE|preApproval|pre-aprovar|canPreApprove`.

| Varredura | Arquivos | Citados por caminho | Citados por nome único | Ambíguos (resolvidos lendo) | Não citados | → ruído (outro "serial"/"status") | → grupo já coberto | → sem mudança (conferido) | → **lacuna incorporada (§6.15)** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Série: api | 147 | 96 | 23 | 1 (ruído) | 27 | 12 | 3 (`probe-*`) | 1 | **11** |
| Série: web | 110 | 97 | 7 | 2 (1 ruído, 1 coberto pelo contexto) | 4 | 3 | 0 | 1 | 0 |
| Série: app | 31 | 25 | 6 | 0 | 0 | — | — | — | 0 |
| Estado: api | 62 | 37 | 12 | 0 | 13 | 2 | 2 (`tests/e2e-ui/fase4,5`) | 4 | **5** |
| Estado: web | 50 | 42 | 1 | 4 (barris `index.ts`, DTO) | 3 | 1 | 0 | 0 | **2** |
| Estado: app | 16 | 11 | 1 | 0 | 4 | 0 | 0 | 3 | **1** |
| `PRE_APPROVE` (3ª passada) | 42 | 38 citados | | | 4 | 3 (comentários) | | | **1** (`portal-cliente-boot.test.ts:123`) + 1 trecho em arquivo citado (`web lib/attention/rules.ts:93`) |
| **Total** | **416 + 42** | | | | **51 + 4** | | | | **19 arquivos distintos** (o `multitask-quote-e2e` conta na série e no estado) **+ trechos** |

- **Ruído da série:**
  - número de série de certificado A1/PAdES/TSA (`fiscal-certificate.*`, `pades-signer.service.ts`, `tsa-client.ts`, `ppe-*`, `warning-signature.service.ts`, `admission-signature.service.ts`, `scripts/test-ppe-pades-seal.ts`, web `a1-certificate-card.tsx`, `types/user.ts:152`);
  - disco do servidor (`server.service.ts`, `types/monitoring.ts` nos dois repositórios);
  - impressora (`use-printer-client.ts`);
  - item de operação externa (`external-operation-item.service.ts:367`);
  - um comentário (`schemas/paint.ts:1400`).
- **Lacunas da série:** `scripts/backfill-boleto-pdfs.ts`, `src/scripts/reconcile-missing-nfse.ts`, `test-nfse-cancel-roundtrip.ts`, `test-nfse-tomador-contact.ts`, os 6 arquivos de `tests/e2e-ui/` e `tests/multitask-quote-e2e.test.ts`. Os e2e-ui estavam no plano só como grupo, e pelo `truck`/layout, não pela série.
- **Lacunas dos estados:**
  - api: `billing.controller.ts`, `tests/portal-decisao.test.ts`, `tests/orcamento-sem-os-negociacao.test.ts`, `scripts/make-signature-demo.js` e o lado do estado de `multitask-quote-e2e`;
  - web: `api-client/billing.ts` e `utils/permissions/task-column-permissions.ts`;
  - app: `test/features/financial/budget_status_transitions_test.dart`.
- **Cobertura antes desta auditoria:**
  - série: **96%** dos arquivos que precisam de atenção (258 de 269: o total menos o ruído e o "sem mudança");
  - estados: **93%** (106 de 114).
- **Todas as lacunas são da mesma classe:** teste, script ou cliente HTTP que trava ou lê o comportamento antigo, fora do alcance do `tsc` (`tests/` e `scripts/` não estão no `tsconfig`, e o web builda sem `tsc`).

### 14.2 Coerência com DD1..DD6 (duas verdades) e o que foi corrigido no lugar

**O que está coerente** (conferido seção a seção):

| DD | Onde o plano confirma |
|---|---|
| DD1: série no implemento, 1:1, toda tarefa tem implemento | D-01, D-02, §3.1, M1s, §5.2 (`implement: null` → 400), §6.13 |
| DD2: arte na assinatura, MARKETING assina `LAYOUT`, emissão com estado próprio | §0 "O que muda para o usuário", D-14, §2A, §6.2 (quote-sections), §6.5 item 24, §6.8, §7.2 e §7.6 |
| DD4: porta traseira | D-06, §3.3 |
| DD5 | §2.2 |
| DD6: branches | §9 |

Não achei trecho que ponha a série na tarefa como fonte, que tire a arte do documento assinado, que tire o MARKETING da assinatura ou que trate o implemento como opcional. As exceções estão abaixo.

| # | Onde | Havia | Verdade corrigida | Origem |
|---|---|---|---|---|
| C-1 | §4.2 M0 | SQL criava `LayoutApprovalSource` com **4** valores; o texto (§3.2, §4.1, P06) dizia 5 | `'MIGRATED_ENVELOPE'` no `CREATE TYPE` (sem ele a M3 passo 5 falha inteira) | defeito de SQL |
| C-2 | D-14, §2A.9 item 1 | `quoteArtworkOf` sobre "tarefas não canceladas" | todas as tarefas (o mesmo conjunto de `vehicles[]`); o E2 é que ignora as canceladas | DD2 (hash) |
| C-3 | §2A.9 item 3 | uniformidade sem regra para cancelada | tarefa cancelada **sem** arte fica fora do teste de uniformidade | consequência de C-2 |
| C-4 | D-14, §0 item 4 | "sem tolerância nova" × D-31 `tolerateArtworkAfterSeal` | texto alinhado: sem tolerância **de migração**; a da D-31 vale só depois do selo | duas verdades |
| C-5 | §2A.3 fila | "o `EXPIRED` muda de grupo" | o `PENDING` também muda (164 no clone) | incompleto |
| C-6 | §3.1 | `Task.serialNumberNormalized` "fora do Prisma como hoje" | declarada no Prisma (`schema.prisma:2440`) | FATO errado |
| C-7 | §5.2, §6.1 | filtro novo `hasImplement` | `implementIdentified` (com a DD1, `hasImplement` é sempre verdadeiro) | resíduo do v1 × DD1 |
| C-8 | D-15 | "Disponibilizar para produção manual continua livre"; O.S. "Aprovar com o Cliente" por texto exato; nada sobre as O.S. em `WAITING_APPROVE` | [pergunta 23]; funções puras e 6 chamadores; descrição normalizada ("Aprovar com **O** Cliente" no dado); [pergunta 24] | DD3 × código |
| C-9 | §6.2 (O.S. e sincronia) | "COMPLETED exige arte APPROVED" em cada O.S. **e** "`task-service-order-sync` sem mudança de código" | portão só na liberação, com argumento `artworkGate` | resíduo do v1 × DD3 |
| C-10 | §6.12 (web e app), teste (f), §7.1 | "Concluir" desabilitado sem arte | "Concluir" livre, aviso da liberação travada; a aprovação recalcula o estado da tarefa | resíduo do v1 × DD3 |
| C-11 | §6.2 item 19, §6.5 itens 36–37 | página pública do orçamento: "bloco [Layout] sai" | o bloco fica, alimentado pela arte dos implementos; `artwork` no `select` do `findPublic` | resíduo do v1 × DD2 |
| C-12 | §4.3 M3o passos 2–3, §2A.10, G29 | eixo da assinatura pelo **último** envelope | envelope **vigente** (RUNNING/COMPLETED primeiro, a precedência do E3); PENDING com COMPLETED → APPROVED + triagem `LEGACY_COMPLETED_NOT_APPROVED`; predicado do grupo 0 igual ao do código (`<> 'SIGNED'`) | FATO × código |
| C-13 | §6.14 (Atenção) | janela passava a incluir `IN_NEGOTIATION`, e só na API | janela igual à de hoje; os **três espelhos** (api, web `rules.ts`, app `attention_rules.dart`) mudam juntos ou não mudam | espelho esquecido |
| C-14 | §4.6 | invariante `spot='YARD_WAIT' AND createdAt > now()-5min` (a M1s copia a data da tarefa: nunca acha nada) | conferência pelos arquivos mortos `_Mig0924_*ImplementCreated` | invariante inócua |

### 14.3 Afirmações carregadoras de peso conferidas no código e no clone

| # | Afirmação da Revisão 2 | Veredito | Evidência / correção |
|---|---|---|---|
| E1 | Grafo manual atual em `budget.service.ts:5915-5995` (`ALLOWED`) | **CONFIRMADA**, com detalhe | O `PENDING` é destino de **5** arestas manuais, não de 4: SIGNED, EXPIRED, APPROVED, REQUESTED e PRE_APPROVED. `EXPIRED → REQUESTED` existe hoje e some no grafo novo sem ser dito (é o certo: `REQUESTED` quer dizer "sem preço") |
| E2 | A emissão força `PENDING` de qualquer estado ≠ PENDING/CANCELLED (X1) | **CONFIRMADA** | `signature-envelope.service.ts:1531-1545`, na transação do envelope, com changelog `SYSTEM_GENERATED` |
| E3 | `markSigned` escreve `SIGNED` só a partir de `PENDING`, fire-and-forget | **CONFIRMADA** | `budget.service.ts:3367-3389`; `signature-envelope.service.ts:5852-5874` (`void … .catch`). Isso explica a nota "ninguém escreve SIGNED": o escritor existe, mas no clone ficou 0 |
| E4 | O Billing nasce na criação e a cobrança exige `APPROVED` (D-30) | **CONFIRMADA** | `budget.service.ts:636-660` (`tx.billing.create` no mesmo `create`) e `:3889-3895`. SELECT: REQUESTED 15/15 com Billing, PENDING 138/164, APPROVED 427/429. Os 28 sem Billing são orçamentos legados de jan–mar/2026, 22 deles sem tarefa |
| E5 | Só `Budget.status` usa o tipo `BudgetStatus` (M3o passo 5) | **CONFIRMADA** | `information_schema.columns WHERE udt_name='BudgetStatus'` → só `Budget.status`. Não há view, função, CHECK nem gatilho sobre `Budget`/`Task`/`Truck`. `Budget_status_idx` existe e é refeito sozinho no `ALTER … TYPE` |
| E6 | `queueRank` é coluna gerada que cita o enum, com índice `Budget_statusOrder_queueRank_idx`; `statusOrder` default 6 no banco × 1 no Prisma (X8) | **CONFIRMADA**; texto incompleto | `information_schema.columns.generation_expression` e `column_default = 6`. O `PENDING` também muda de grupo (C-5) |
| E7 | SQL da M3o contra o schema real: `SignatureEnvelope(quoteId, status, createdAt)`, `EnvelopeSigner(envelopeId, orderGroup, status)`, `BudgetRequest(budgetId @unique, preApprovedAt, preApprovedByResponsibleId)`, tabela física `"Representative"` | **CONFIRMADA**, com correção | `schema.prisma:8218-8230,8426-8470,2017-2045`; `pg_tables`. O predicado do grupo 0 no SQL (`NOT IN ('SIGNED','VOIDED')`) ≠ código (`!== SIGNED`), com 0 VOIDED em RUNNING no clone. "Último envelope" ≠ E3 "qualquer RUNNING/COMPLETED" nos nº 584/591 (C-12) |
| E8 | M0 cria `LayoutApprovalSource` com os 5 valores | **ERRADA** no SQL | Corrigida (C-1) |
| E9 | M1s: nomes `Task_serialNumber_key` e `Task_serialNumberNormalized_trgm_idx`, `immutable_unaccent`, coluna gerada da tarefa; 2.253 tarefas / 1.678 sem `Truck` / 2.013 séries; 575 `Truck`; 43 implementos do portal desde 19/09 nasceram `YARD_WAIT` | **CONFIRMADA**; o comentário do §3.1 estava errado (C-6) | `pg_indexes`, `pg_proc`, `information_schema`; SELECT: 0 tarefas **não concluídas** sem `Truck`; `spot` dos criados desde 19/09 = 43× `YARD_WAIT` |
| E10 | Caminhos de criação de tarefa: só o repositório (`task-prisma.repository.ts:1954`) e o portal (`portal-request.service.ts:874`) em `src/`, mais os scripts e testes listados | **CONFIRMADA** | `rg '\.task\.(create\|createMany\|upsert)\('`: nada fora da lista do §6.13 classe B. `painting-compute.service.ts:1200` é `PaintingProductionStep.tasks`, não é `Task`. Não há `createMany` de tarefa, e os gatilhos diferidos da M1s são os primeiros em `Task`/`Truck` |
| E11 | Snapshot: v4/v7/`[7..1]`; `layoutFileIds` de `quote.layoutFiles`; série lida da tarefa | **CONFIRMADA** | `quote-snapshot.service.ts:220,297,300,389,494,529`. Mas `vehicles[]` sai de **todas** as tarefas (`:426-438`, sem filtro de cancelada). Isso derruba a regra "não canceladas" do `quoteArtworkOf` (C-2): o nº 594 tem as 4 tarefas CANCELLED, envelope COMPLETED e 1 arquivo congelado |
| E12 | D-15: portão "na regra de liberação (`task-service-order-sync.ts:121-151,614-618`)" e, no §6.2, "sem mudança de código" | **ERRADA** (duas verdades) | As duas funções são puras e recebem só as O.S. (`:118`, `:365`); há 6 chamadores (C-8, C-9). O comentário `:614-618` confirma que a liberação manual fura o portão comercial de propósito (pergunta 23) |
| E13 | O.S. "Aprovar com o Cliente" existe entre as 7 O.S. de ARTE; 31 O.S. de ARTE em `WAITING_APPROVE` | **CONFIRMADA**, com achado | Constante `'Aprovar com o Cliente'` (`service-descriptions.ts:191`), mas o dado tem "Aprovar com **O** Cliente" (7 linhas, todas COMPLETED). As 31 `WAITING_APPROVE` são **todas "Elaborar Layout"**, 28 delas em tarefas PREPARATION sem outra O.S. de arte concluída (pergunta 24, risco 44) |
| E14 | `PUT /budgets/:id/status` com `@Roles(ADMIN, FINANCIAL, COMMERCIAL)` e sem `validateQuoteStatusChangeRole` (X7) | **CONFIRMADA** | `budget.controller.ts:185-203`. O guarda só é chamado em `budget.service.ts:1241` e `task.service.ts:806,839`. O `/budget-approve` é ADMIN/COMMERCIAL (`:233-234`) |
| E15 | `findPublic` e a página pública usam `layoutFiles` | **CONFIRMADA**; o destino "sai" estava errado sob a DD2 | `budget.service.ts:5511-5514` (`select` explícito); web `pages/public/budget/[id].tsx:111-131,391-420`; `service-report/[id].tsx:93-160` (C-11) |
| E16 | Distribuição `Budget.status` × último envelope (§2A.10) | **CONFIRMADA** (os mesmos 11 grupos) | Mas 3 orçamentos têm COMPLETED que **não** é o último: 584 (APPROVED, v2 INVALIDATED), 591 (PENDING, v7 REFUSED; é o "nº 591" do §6.2 item 17) e 594. As linhas do §2A.10 foram refeitas pela precedência (C-12) |

**Placar:** 16 afirmações. 12 confirmadas (4 delas com texto incompleto ou com um detalhe a corrigir) e 2 erradas (E8, E12). As 2 restantes (E11, E15) conferem no código, mas o destino que o plano dava a elas contrariava a DD2 e foi corrigido.

### 14.4 Lacunas incorporadas

As lacunas estão na **§6.15**, com o pacote de cada uma:
- **série:** 6 linhas, que cobrem 12 arquivos;
- **estados:** 12 linhas;
- **trechos que faltavam em arquivos já citados:** 7 linhas.

Os riscos novos são os **43 a 47** do §11, e as perguntas novas são a **23** e a **24** do §12, que entram no P00 antes do P12.

### 14.5 Perguntas ao dono (as novas; as demais seguem no §12)

| # | Pergunta | Recomendação |
|---|---|---|
| 23 | A liberação **manual** para produção também exige a arte aprovada? | **Respondida na Revisão 3 (DD10)**: sim, respeita a arte (**confirmada** pelo dono na Revisão 3.1); não há "Dispensar arte" (DD9) |
| 24 | A aprovação da arte fecha também a O.S. de ARTE que estiver "Aguardando Aprovação"? | **Respondida na Revisão 3 (DD3)**: sim. Em produção são 12 O.S. nesse estado (6 em tarefas vivas) |
| 12 (nota) | O rótulo "Em Negociação" foi escolha sua, e há um teste que o registra (`orcamento-sem-os-negociacao.test.ts:180-199`). Troca por "Aguardando aprovação do cliente"? | Trocar (a frase diz de quem é a vez), mas a decisão é sua |

### 14.6 Riscos (os novos; ranqueados no §11)

1. **⛔ Contrato selado deixa de casar.** Aconteceria se o `quoteArtworkOf` fosse implementado como estava escrito, só sobre as tarefas não canceladas (risco 43; o nº 594 é o caso nomeado no G11).
2. **Tarefas presas em Preparação** depois da migração (risco 44).
3. **Portão da DD3 no lugar errado, ou em lugar nenhum** (risco 45).
4. **Página pública sem a arte** que o documento assinado leva (risco 46).
5. **M0 com enum incompleto publicado na R-A** (risco 47). Custo alto e probabilidade certa, se ninguém rodar o ensaio antes da R-A.
6. **Classe comum das lacunas.** Teste, script e cliente HTTP ficam fora do `tsc`. O G0 com `tests/` e `scripts/` no `tsconfig` de checagem é o que as pegaria. Isso reforça a condição 1 da §13.5.

### 14.7 Veredito

**O plano da Revisão 2 é coerente com DD1..DD6 depois das 14 correções desta seção, e continua executável na ordem da §9.**

- **O que foi achado:** nenhuma das divergências inverte uma decisão do dono. São cinco resíduos do v1 que ainda contradiziam a DD2 e a DD3 (C-7, C-9, C-10, C-11 e a tolerância de C-4), dois defeitos de SQL que o ensaio pegaria, mas depois de a R-A publicar a M0 (C-1, C-12), e um erro de conjunto que o G11 pegaria só no ensaio de produção (C-2).
- **Cobertura por arquivo:** 96% na série e 93% nos estados antes desta auditoria. Agora está completa para os padrões varridos.
- **Condições:** somam-se às seis das §13.5/§13.6 mais duas:
  - **(7)** as perguntas 23 e 24 respondidas antes do P12 (Revisão 3: a 24 pela DD3; a 23 pela DD10, confirmada na Revisão 3.1);
  - **(8)** o G11 roda com o nº 594 (e os nº 584/591, se ainda existirem no dump de produção) como casos nomeados, e o ensaio de produção confere se há coleta COMPLETED que não é o último envelope do orçamento.
