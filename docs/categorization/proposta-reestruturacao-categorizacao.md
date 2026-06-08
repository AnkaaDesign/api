# Reestruturação da Categorização — Ankaa (Análise + Projeto)

> Síntese de 8 subagentes sobre código (api/web/mobile), banco `ankaa_dev`, o plano de contas
> (`CONTABILIDADE - Google Planilhas (1).pdf`) e a proposta de itens
> (`Working Files/proposta-categorizacao-itens.html` + `itens-classificados.csv`).

---

## 1. Estado atual (o problema)

**Hoje existem DOIS sistemas de categoria separados, planos (sem hierarquia) e ligados por um espelho congelado:**

- **`ItemCategory`** (estoque) — plano. Enum `ItemCategoryType {REGULAR, TOOL, PPE, ELECTRONIC_TOOL}` = *natureza física*. 17 categorias, 730 itens.
- **`TransactionCategory`** (conciliação) — plano. Enum `TransactionCategoryKind {ITEM_DERIVED, SERVICE, TRANSACTION_ONLY}` = *origem*. 32 categorias.
- **Ponte:** `TransactionCategory.itemCategoryId` espelha 1:1 cada ItemCategory — **mas é um backfill de migração congelado, SEM sincronização em runtime.** Categoria nova de item criada depois NÃO vira TransactionCategory. (defeito a corrigir)

**Dores medidas:**
- "Baldões": **Ferramenta 218**, **Pigmento 106**, Epi 90, Material 82, Peça 52 — concentram o estoque em categorias genéricas.
- **NF: 68% das linhas sem categoria** (210/663 categorizadas, 100% AUTO, mediana de confiança 50–74).
- **Transações: 54% sem categoria** (350/769 com tag).
- Erros de rótulo: DISCO→"Ferramenta" (devia ser Abrasivo), CLEAR→"Tinta" (devia ser Verniz), CATALISADOR→"Endurecedor".
- Nenhum dos enums atuais é o **plano de contas** — esse eixo não existe no sistema.

---

## 2. Os QUATRO eixos (a chave do projeto)

O erro a evitar é misturar eixos. São quatro, ortogonais:

| Eixo | O que é | Onde vive hoje | Proposta |
|---|---|---|---|
| **Tipo contábil** (plano de contas) | 13 grupos de custo (PDF) | **não existe** | **NOVO** — `AccountingType` (tabela gerenciável) |
| **Taxonomia operacional** (fluxo de produção) | Categoria → Subcategoria (13 → ~67) | `ItemCategory` plano | `ItemCategory` + `parentId` (3 níveis) |
| **Natureza física** | REGULAR/TOOL/PPE/ELÉTRICA | `ItemCategoryType` | manter (ortogonal) |
| **Origem da categoria** | item-derivado/serviço/só-transação | `TransactionCategoryKind` | manter (ortogonal) |

**Os 3 níveis que você pediu para materiais = `Tipo Contábil → Categoria → Subcategoria`.** O CSV já entrega exatamente isso (`grupoContabil › categoria › subcategoria`).

> **IMPORTANTE (refinamento confirmado):** o item é **navegado pela taxonomia OPERACIONAL**
> (Categoria → Subcategoria do HTML — "fica melhor" porque segue o fluxo de produção). O
> **Tipo Contábil NÃO é a raiz da árvore de itens** — é um campo de *rollup* (a ponte
> `grupoContabil`) que viaja junto para o rateio de custo. Ou seja: o PDF (Produtivo/Matéria-Prima)
> serve à **contabilidade/transações**; os itens têm o seu próprio workflow operacional, mais rico,
> que apenas *aponta para cima* para um tipo contábil. Uma categoria operacional → um tipo contábil
> (splits de Peças/Uniforme/Apoio resolvidos por item).

---

## 3. Nível 1 — Tipos Contábeis (do PDF)

13 tipos, cada um com suas sub-linhas contábeis (nível-2 contábil, usado nas **transações**):

| # | Tipo | Chave | Sub-linhas | Aplica a |
|---|---|---|---|---|
| 1 | Salários | `SALARIOS` | Aerografias, Bonificação, Pró-labore, Salários/Afins, Comissão | transações |
| 2 | Despesas Fixas | `DESPESAS_FIXAS` | Combustível, Água, Energia, Telefonia, Internet, Aluguel | transações |
| 3 | Produtivo | `PRODUTIVO` | Adesivos, Fita Crepe, Máscara, Papel, Impressão, Peças, Massas | itens + transações |
| 4 | Imposto / Tarifas | `IMPOSTO_TARIFAS` | Impostos, Tar. Bancárias, Taxa | transações |
| 5 | Matéria-Prima | `MATERIA_PRIMA` | Tintas, Removedor, Thinner | itens + transações |
| 6 | Investimento | `INVESTIMENTO` | Internos, Externos | itens + transações |
| 7 | Manutenção | `MANUTENCAO` | — | itens + transações |
| 8 | Coz./Alim. | `COZINHA_ALIMENTACAO` | — | itens + transações |
| 9 | EPI | `EPI` | — | itens + transações |
| 10 | Escritório | `ESCRITORIO` | — | itens + transações |
| 11 | Aplicação Fin. | `APLICACAO_FINANCEIRA` | — | transações |
| 12 | Estorno | `ESTORNO` | — | transações |
| 13 | Lucro Distribuído | `LUCRO_DISTRIBUIDO` | LD/S, LD/G | transações |

---

## 4. Níveis 2–3 — Taxonomia operacional de itens (do HTML/CSV)

13 categorias → ~67 subcategorias, cada categoria mapeada para 1 tipo contábil (a "ponte"):

| Categoria (nível 2) | → Tipo contábil | Itens |
|---|---|---|
| Matéria-Prima — Tintas e Toners (Cor) | MATERIA_PRIMA | 124 |
| Matéria-Prima — Fundos, Vernizes e Auxiliares Químicos | MATERIA_PRIMA | 56 |
| Funilaria e Reparo de Carroceria | PRODUTIVO (Massas) | 16 |
| Abrasivos e Polimento | PRODUTIVO | 38 |
| Mascaramento e Cobertura | PRODUTIVO (Fita/Papel/Máscara) | 15 |
| Plotagem e Adesivação | PRODUTIVO (Adesivos) | 24 |
| Aplicadores e Auxiliares de Mistura | PRODUTIVO | 28 |
| Peças, Fixação e Conexões | PRODUTIVO **+ MANUTENÇÃO** (split por item) | 78 |
| Ferramentas Manuais e Medição | INVESTIMENTO | 155 |
| Ferramentas Elétricas/Pneumáticas e Equipamentos | INVESTIMENTO | 78 |
| EPI | EPI | 52 |
| Uniforme / Fardamento | EPI (sub sem CA) | 39 |
| Apoio — Escritório/Cozinha/Limpeza/Cortesia | ESCRITÓRIO / COZINHA / DESP. FIXAS (split) | 26 |

As ~67 subcategorias estão no HTML/CSV (ex.: "Toners de cor", "Toners de efeito", "Lixas em folha", "Discos Hookit", "Fixadores — rebites"…).

**Splits (mapear por item, não por categoria):** *Peças* → PRODUTIVO (produtiva) vs MANUTENÇÃO (peça de equipamento); *Uniforme* → EPI subconta sem CA; *Apoio* → Escritório/Cozinha/Desp.Fixas/Cortesia.

---

## 5. Modelo de dados proposto

**Manter as duas tabelas; adicionar o eixo contábil compartilhado + a hierarquia. NÃO fundir.**
(ItemCategory é quente no estoque/PPE; TransactionCategory carrega slug/aliases/classificador. Fundir reescreveria o conciliador inteiro.)

```
AccountingType (NOVO, tabela semente 13 linhas)         // nível 1 — plano de contas
  id, key, name, parentId? (sub-linhas), appliesToItems, appliesToTransactions,
  isResolving?, color, sortOrder, isActive

ItemCategory (alterar)                                   // níveis 2–3 operacionais
  + parentId            -> self-relation "CATEGORY_TREE" (Categoria→Subcategoria)
  + accountingTypeId    -> AccountingType  (a "ponte" / grupoContabil; herdável p/ baixo)
  (manter) type ItemCategoryType            // natureza física — ortogonal
  Item.categoryId aponta para a FOLHA (subcategoria)

TransactionCategory (alterar)
  + accountingTypeId    -> AccountingType   // substitui o uso do mirror congelado
  (manter) kind, slug, isResolving, aliases…
  + sincronização runtime: criar/alterar ItemCategory propaga p/ TransactionCategory

Atributos de item (promover — "atributo ≠ subcategoria")
  - Marca: já é relação (ItemBrand) ✔
  - Granulometria (P40–P2000), Bitola: novos MeasureType (GRANULOMETRY, GAUGE) — Measure rows
  - Cor (vinil): nova tabela-lookup ItemColor {id,name,hex} + Item.colorId
  - Tamanho (uniforme): já é Measure(SIZE) ✔
  (sem JSON/EAV — segue o padrão atual de relações + Measure + zod por campo)
```

---

## 6. Redesenho do classificador (auto-categorização)

Hoje só usa fuzzy de descrição → 31,7% das linhas. Os dados mostram sinais muito mais fortes:

1. **NCM → subcategoria** (determinístico p/ NFe): 38140090=100% Diluente, 32081020=100% Verniz, 32089021=100% Tinta, 40151900=100% Luva/EPI, 68xx=Abrasivo, 64039990=Botina. **Construir tabela NCM→subcategoria.**
2. **Prior por fornecedor (raiz CNPJ):** BR EPIS→EPI, FARBEN→Matéria-Prima, VMD→Investimento, NUTRICARD→Cozinha. Restringe categorias candidatas.
3. **Keyword/alias de descrição** (resíduo + NFSe sem NCM) — reaproveita o `ItemCategoryAlias` (aprendizado) como está.
4. **Corrigir rótulos:** DISCO→Abrasivos, CLEAR→Verniz, CATALISADOR→Endurecedor, FRESA/FITA/ENDURECEDOR (lacunas atuais).

Estimativa: **~75% das linhas** classificáveis com confiança (vs 31,7%). O classificador passa a mirar a **subcategoria (folha)**; Categoria e Tipo Contábil derivam da ancestralidade.

## 7. Redesenho da categorização de transações

- Detecção é **CNPJ/CPF + prefixo de memo**, não keyword livre (memo é OFX estruturado; keyword falha em 534/769). **CPF→pessoa física** = sinal de SALÁRIOS/pró-labore/comissão/LUCRO; **CNPJ→empresa** = Matéria-Prima/Produtivo (espera NF).
- **Faltam categorias "resolving" (TRANSACTION_ONLY) para tipos sem NF:** EPI (só existe como item-derived), **APLICAÇÃO FIN.** e **LUCRO DISTRIBUÍDO** (não existem). Já cobertos: Folha→SALÁRIOS, Tributo→IMPOSTO, Tarifa→TARIFAS, Aluguel/Convênio→DESP. FIXAS, Pró-labore, Estorno.
- Estatísticas/rateio passam a **rolar por Tipo Contábil** (o eixo natural de custo).

---

## 8. Plano de migração

1. **Seed**: criar `AccountingType` (13 + sub-linhas) e a árvore operacional (13 categorias + ~67 subcategorias) a partir do CSV.
2. **Atributos**: novos MeasureType (GRANULOMETRY, GAUGE) + tabela `ItemColor`.
3. **Migrar itens por nome** (join com `itens-classificados.csv`): 624 batem exato, 627 normalizado. Cada item → subcategoria (folha) + herda accountingType.
4. **Pendências**: **103 itens no DB sem linha no CSV** (classificar) + **98 de baixa/média confiança** (revisão humana) + 123 linhas do CSV sem item no DB (renomeados/removidos).
5. **Backfill** `accountingTypeId` em TransactionCategory; **ligar a sincronização runtime** ItemCategory→TransactionCategory.
6. **Classificador**: tabela NCM→subcategoria + priors de fornecedor; reprocessar as 663 linhas de NF.

---

## 9. Superfície de implementação (lockstep) e riscos

- **Migrations**: SQL escrito à mão (`YYYYMMDDHHMMSS`), enum via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, seed via `INSERT ... gen_random_uuid()`. `parentId` self-relation é **inédito** no schema — exige guard de ciclo.
- **Sync entre pacotes** (footgun): zod select/include/where/create/update em `api|web|mobile/src/schemas/item.ts`; constantes (ITEM_CATEGORY_TYPE etc.) ×3; tipos ×3. Zod **descarta silenciosamente** campos fora do select schema; drift do mobile.
- **UI**: `category-selector` (web+mobile) vira 3 combobox em cascata; `category-form` ganha seletor de pai + tipo contábil; `CategoryEditor` (transações) vira hierárquico; páginas de lista viram árvore.
- **CRUD de ItemCategory** vive dentro de `item.controller.ts` (sem controller próprio); usa `createEntityHooks`.

---

## STATUS DE IMPLEMENTAÇÃO (2026-06-02)

Decisões tomadas: **tudo numa passada** · **AccountingType = enum fixo (13)** · itens incertos **auto + "a revisar"**.

**FEITO (fundação de dados, verificado no `ankaa_dev`):**
- Schema: enum `AccountingType` (13); `ItemCategory` + `parentId`/`categoryLevel`/`accountingType`; `TransactionCategory.accountingType`; `Item.categoryReviewNeeded`. Migration `20260602140000_category_taxonomy_3level` aplicada.
- Seed/migração (`api/src/scripts/backfill-category-taxonomy.ts`, idempotente): árvore 13 categorias › 67 subcategorias (todas com accountingType); 606 itens repontados para folhas (553 com tipo contábil); 258 itens marcados `categoryReviewNeeded`; categorias resolving `Aplicação Financeira` + `Lucro Distribuído` criadas; accountingType retro-preenchido em 23 TransactionCategory.

**FEITO — FASE 2 (implementação completa api+web+mobile, 8 subagentes, typecheck 0/0/0):**
- **Classificador NCM-first** (`ncm-category-map.ts`, 45 chaves; `item-category-classifier` reordenado; keywords corrigidas DISCO→Abrasivo/CLEAR→Verniz/CATALISADOR→Endurecedor). **Reprocessado: cobertura de NF 31,7% → 75,1%** (498/663 linhas, 458 recategorizadas).
- **Ponte/espelho**: árvore operacional espelhada em `TransactionCategory` ITEM_DERIVED com `accountingType` + **sync em runtime** via evento `item-category.changed` (`item-category-mirror.listener`). Sync executado: **80 espelhos criados**.
- **Detecção de transações por accountingType** (CPF→SALÁRIOS, CNPJ→MATÉRIA-PRIMA, DARF→IMPOSTO, etc.) + **estatísticas com rollup por grupo contábil**.
- **CRUD de categoria 3 níveis** (parentId/cycle-guard/descendant-ids, rotas tree/descendants) + zod/selects atualizados.
- **Web**: foundation (types/constants `ACCOUNTING_TYPE`/zod/hooks `useItemCategoryTree`), inventory (seletor em cascata, admin em árvore, colunas Tipo Contábil + "A Revisar", filtros por accountingType/subárvore/revisar), reconciliação (CategoryEditor agrupado por grupo contábil, categories-list, chips de grupo contábil).
- **Mobile**: schemas/constants/types + seletor em cascata + form com pai/accountingType.

**FALTA (opcional / próxima):**
1. **Limpeza das 15 categorias legadas** — script `cleanup-legacy-item-categories.ts` pronto (DRY_RUN ok: moveria 153 itens p/ "A Revisar", nula 15 espelhos). **Adiado de propósito**: os 153 itens não têm fonte de auto-classificação (NCM é só p/ NF), então manter o rótulo legado + flag "a revisar" é mais informativo que jogar tudo num balde. Rodar após reclassificar.
2. **Auto-classificar os ~153 itens de inventário sem match** por keyword de nome (heurística separada do classificador de NF).
3. **Atributos** (adiado): MeasureType GRANULOMETRY/GAUGE, lookup `ItemColor`.

**FALTA (próximas fases — versão antiga, agora resolvidas acima):**

## 10. Decisões em aberto (precisam de você)

1. **Escopo/fases:** (a) só itens (3 níveis + atributos) agora, transações depois; (b) tudo junto; (c) revisar este projeto antes de codar.
2. **Tipo Contábil:** tabela gerenciável (cria/edita tipos pela UI) vs enum fixo (13 travados).
3. **Confirmar os 13 tipos** e os splits (Peças→Produtivo/Manutenção; Uniforme→EPI sem CA; Apoio→4 destinos).
4. **103 itens sem CSV + 98 de baixa confiança:** classificar por heurística (auto) ou deixar "a revisar" para a oficina.
