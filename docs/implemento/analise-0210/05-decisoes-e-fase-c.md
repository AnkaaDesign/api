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
