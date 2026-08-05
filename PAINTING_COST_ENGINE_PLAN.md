# Motor de Planejamento e Custo de Produção de Pintura

> ⚠️ **DOUTRINA (2026-08-05): `PAINTING_PRODUCTION_DOCTRINE.md` tem precedência
> sobre este documento e sobre `layout database/analysis/analysis_A..F.md`.**
> Ela é a correção do dono sobre o processo real. O que este plano já acertava e
> as análises A–F violavam: **adesivo é sempre só máscara; nada é impresso**
> (§35, §140 aqui). O que este plano ainda não tem:
> - ordem de pintura pela **menor cobertura primeiro** (doutrina §2)
> - escolha de fita pelo **substrato**, não pela curvatura (§4) — fita amarela só
>   em isoplastic/lona; em chapa branca é fita branca, que não curva e exige corte
> - `ADESIVO_SOBRE_CHAPA` × `SOBRE_VERNIZ` (§3.2-a/b): sem tinta embaixo
>   não há ciclo de verniz — 4 reanálises independentes apontaram esta lacuna
> - `sobre: CHAPA | TINTA` como sinal de cortabilidade à mão (§7.1)
> - `internal_split`: parte chapada + parte em degradê no mesmo elemento (§7.3)
>
> As reanálises corrigidas vivem em `layout database/analysis_v2/`.

> **STATUS (2026-08-04): implementado de ponta a ponta (v1).**
> - Engine Python (visão/geometria): `api/painting-engine/` — S0–S6 + bandas de adesivo; CLI/FastAPI com estágios independentes; 11 testes (sintéticos + artes reais). **Mudança vs. plano original: o pipeline de imagem foi para Python (numpy/scipy/scikit-image/shapely), não sharp+TS** — decisão autorizada pelo dono para robustez dos algoritmos.
> - API NestJS: módulo `api/src/modules/paint/painting-analysis/` — CRUD, runner do engine, MATCH (ΔE), STRATEGY (rules-as-data), PLAN (sessões→passos→materiais→custos com snapshot); rotas `/painting-analyses` (+`/config`). Migração `20260804140000_painting_cost_engine` (12 tabelas). Seed: `npm run seed:painting` (27 taxas, 6 indiretos, 17 regras, custo-hora da média CLT viva).
> - Web: `/pintura/analise-de-arte` (lista, criação com calibração, revisão com overlay SVG, plano passo-a-passo, orçamento, configurações).
> - Smoke E2E: `npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/smoke-painting-analysis.ts "<arte>" <comprimento-cm>`.
> - v1 assume as simplificações listadas em §9 e placeholders de §6; refino contínuo via UI de configurações + revisão humana.

> Plano de arquitetura para a feature de análise de artes + planejamento de produção + orçamento de custo de pintura em implementos rodoviários.
> Base empírica: análise das 66 artes de `layout database/` (relatórios detalhados em `layout database/analysis/analysis_A..F.md`), catálogo real de itens/tintas do banco `ankaa_dev` e mapeamento do código existente (api/web).

---

## 1. Tese central

A feature **não é um "calculador de orçamento" — é um motor de planejamento de produção**. Ele deve interpretar o layout como um pintor experiente: decidir a estratégia de cada elemento, montar a sequência de sessões de pintura, e só então derivar materiais, tempos e custos. O custo é uma *consequência* do plano, nunca o contrário.

A análise das 66 artes confirmou que o custo real é dominado por **decisões discretas** (pintura geral ou não; fita ou cura; pintar ou imprimir), não por variáveis contínuas. Errar uma decisão discreta muda o orçamento em dias inteiros; errar uma área em 10% muda centavos de tinta. Por isso o motor prioriza acertar as decisões e manter **tudo editável e rastreável**.

### O que a análise das 66 artes provou

1. **A decisão nº 1 é o fundo.** O lote se divide em 3 arquétipos limpos:
   - **Chapa branca original** (~60% das artes): todo elemento vira fronteira tinta-fundo (T-F) — só adesivo, sem corte, sem fita. 1–2 dias.
   - **Pintura geral** (cor ≥ ~80% da superfície ≠ branco): +2 dias (lavar, empapelar, fundo, cor, verniz). As fronteiras entre **duas tintas** re-ancoram para tinta-tinta (T-T) sobre fundo curado — resolvidas por cura 3h + adesivo, quase nunca por fita. **Elementos em RESERVA (chapa preservada por máscara antes da pintura geral) continuam T-F** e não geram sessão: não há segunda tinta para proteger.
   - **Sider de lona**: rota própria — não é chapa; pintura sobre lona usa a linha vinílica (11 cores em estoque) com processo/rendimento distintos.
   - Zona ambígua (off-white/cinza-gelo, ex.: BALALAC, AAN): errar muda o plano de 1 para 3 dias → **flag obrigatória de confirmação humana**.

2. **Branco nunca é tinta.** Em praticamente todas as artes, textos/filetes/ondas brancas são **chapa preservada por máscara** (knockout). O motor deve tratar branco (e a cor do fundo em pintura geral, ex.: estrada do logo CIPRIANO) como *reserva*, jamais orçar "tinta branca".

3. **Keylines/respiros são a maior otimização de custo.** Designers separam cores com filetes de fundo de 1–4 px (Trans Salto, BOX DA TERRA, BURES, SGT, AVGLOG). Cada keyline detectada converte uma fronteira T-T cara em 2×T-F baratas. Antialiasing fecha keylines no downscale → **detectar em resolução plena, antes de reduzir**.

4. **Fronteiras T-T reais são raras** e caem em 3 casos: **reta** (fita de corte — AKTL, Bergamini, diagonal Folly), **suave e longa** (fita amarela flexível — mar e rio, faixas S da AAN, ondas BURES/Auriz), **média/fechada/curta** (cura 3h + adesivo — talos ADRI, estrela BURES, scripts). Corte manual nunca compensa em ponta aguda ou letra.

5. **Classificação da região decide a tecnologia**: chapada → laca em máscara; degradê linear/radial simples → aerografia dentro da máscara (barato quando a silhueta é T-F: SGT); fotográfico/metálico/multidirecional → **aerografia artística** (setor de Aerografia da casa — morangos 2 Amigos, papaia Bahia Sul, emblema Bismark, embalagens COMFRO). **Importante: a empresa NUNCA usa vinil impresso/desenho pronto — vinil serve apenas como máscara recortada na plotter; tudo é sempre pintura.** Micro-texto/selos → máscara de recorte fina + pintura, com multiplicador alto de complexidade (depilação/aplicação), ou aerografia à mão livre quando abaixo do limite físico do recorte.

6. **A física ausente do mockup é previsível**: traseira → junta central entre portas + dobradiças/fechos + selos (SIF/SISBI) + para-choque; frigorífico/pescados/açaí → isoplastic → lixamento das janelas do adesivo; lateral longa → frisos a empapelar + faixa refletiva; "sider" no nome → lona (processo completamente diferente). O nome do arquivo é a etapa 0 (comprimento "8,40"/"11,50"/"640", vista, "sider", "PRETO").

7. **Validações que evitam prejuízo real**: texto espelhado no arquivo (2 Amigos, CARLOTTI — comprovado 2×), arte cortada na borda (137 traseira), marca d'água sem licença (Shutterstock em Agrícola Premium), elemento em cima da junta das portas, 2 tons com ΔE baixo demais (BURES).

---

## 2. Arquitetura geral

```
┌────────────────────────── WEB (React) ──────────────────────────┐
│  /pintura/analise-de-arte                                        │
│  1. Upload/seleção da arte + calibração de escala                │
│  2. Revisão da análise (overlay de regiões/fronteiras, editar)   │
│  3. Plano passo-a-passo (timeline com preview progressivo)       │
│  4. Orçamento (composição de custo abrível por passo)            │
└────────────────┬────────────────────────────────────────────────┘
                 │ REST (padrão axios-client/schemas Zod)
┌────────────────▼──────────── API (NestJS) ──────────────────────┐
│  módulo painting-analysis                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ANALYSIS PIPELINE (worker assíncrono, fila estilo         │   │
│  │ thumbnail-queue; sharp para raster, TS puro p/ geometria) │   │
│  │ S0 ingest → S1 limpeza → S2 quantização → S3 regiões →    │   │
│  │ S4 classificação → S5 matching tintas → S6 fronteiras →   │   │
│  │ S7 estratégias → S8 sessões/ordem → S9 quantidades →      │   │
│  │ S10 custeio → S11 plano/relatório                         │   │
│  │ Cada estágio: função pura, artefato JSON versionado       │   │
│  └──────────────────────────────────────────────────────────┘   │
│  + QA semântico opcional (LLM de visão) → flags                  │
│  Reusa: Paint/PaintFormula (custo/L), findSimilarColors (ΔE),    │
│  ImplementMeasure (geometria real), Item+MonetaryValue (preços), │
│  TaskQuote (linha de orçamento final)                            │
└─────────────────────────────────────────────────────────────────┘
```

### Decisões de tecnologia

| Decisão | Escolha | Por quê |
|---|---|---|
| Onde roda a análise | **API, worker assíncrono** (clone do padrão `thumbnail-queue.service.ts`) | Imagens de 11k px / 8 MB não cabem no browser com folga; resultado precisa persistir e ser reprocessável; `sharp` já instalado |
| Biblioteca raster | **sharp** (`raw().toBuffer()` → `Uint8Array`) + algoritmos próprios em TS | Zero dependência nativa nova; quantização/CCL/contornos/curvatura são ~1,5k linhas de TS testável; OpenCV(-wasm) fica como plano B se performance exigir |
| Espaço de cor | **CIELAB** (conversões já existem em `web/src/utils/color.ts` — portar para `api/src/utils`) | ΔE2000/76 já é o padrão da casa (`findSimilarColors` em `api/src/utils/paint.ts:88`) |
| Estratégias | **Rules-as-data** (tabela `StrategyRule` com condições/limiares) | Requisito "fácil de ajustar qualquer parte": limiar de curvatura, % de pintura geral, altura mínima de letra etc. viram registros editáveis, não código |
| Rastreabilidade | **Artefato JSON por estágio, versionado** (`engineVersion` + `stageOutputs`) | Cada número do orçamento aponta para o estágio que o produziu; regressões auditáveis; UI "por que esse valor?" |
| Editabilidade | Todo nó tem `source: AUTO \| MANUAL` + `autoValue` preservado | Alterações manuais sobrevivem a reprocessamento (merge por id de região); mostrar o que foi calculado vs informado |
| QA semântico | **Passe opcional com LLM de visão** (Claude) com a rubrica validada neste estudo | O pipeline determinístico mede; o LLM detecta o que geometria não vê: espelhamento, marca d'água, logo de terceiro, substrato provável, arte cortada. As 6 análises A–F provam a eficácia da rubrica |
| UI de revisão | Canvas 2D + overlay SVG de polígonos (contornos vindos do pipeline) | Padrão já dominado no web (`use-color-grid-canvas`, truck-studio); SVG dá hit-testing e edição por região |

---

## 3. O pipeline de análise (estágio por estágio)

Cada estágio lê o artefato do anterior e grava o seu. Reprocessar do estágio N pra frente é barato (ajuste fino sem repetir tudo).

### S0 — Ingestão e calibração de escala
- Entradas: arquivo(s) da arte (uma por face: lateral esq/dir, traseira, frente), metadados do nome (regex: comprimento `\d+[,.]\d+`, "lateral|traseira", "sider").
- **Contexto do serviço**: `IMPLEMENTO_NOVO | REFORMA`. Em **reforma**, o plano é prefixado com: (1) **remoção** dos adesivos/plotagens antigos e das faixas refletivas originais (taxa própria m²/min e m/min + removedor), (2) **nova limpeza** completa, (3) pintura geral, incluindo (4) **vedação com PU/adesivo selante** nas juntas/perfis (item de estoque "Selantes e Vedantes") antes da pintura. Faixas refletivas novas entram como material de reposição ao final.
- **Escala**: a imagem raramente vem no tamanho real. O usuário informa **uma medida de referência** (comprimento total, altura da lateral, largura de porta...) OU seleciona o `ImplementMeasure` do Truck da tarefa (altura + larguras de seção + portas já cadastradas — integração direta). Deriva-se `pxPerCm` e propaga-se para tudo: m², m lineares, cm de corte.
- Validação: se a proporção da imagem divergir >10% da proporção do implemento informado → alerta de distorção.

### S1 — Limpeza de mockup
- Detectar e remover moldura/borda do arquivo, vinhetas e sombras de apresentação (gradiente global de baixa frequência → achatar), marcações de arquivo ("17", cotas).
- Degradês de fundo de mockup ≠ degradês de arte: fundo com gradiente suave global → achatar para 1 cor (confirmação humana quando ambíguo).

### S2 — Quantização de cores (o coração anti-ruído)
Pré-processamentos na ordem (todos parametrizáveis):
1. Detecção de keylines em resolução plena (filetes de cor-de-fundo 1–4 px entre regiões: morfologia direcional) e **proteção** delas contra o passo seguinte.
2. Remoção de antialiasing: erosão 1–2 px por cluster + reatribuição de pixels de borda ao vizinho dominante.
3. Clusterização em LAB (k-means com seeds por histograma 3D; k estimado por picos), fusão de clusters com ΔE < limiar (default 6).
4. Fechamento de lacunas pequenas, remoção de pixels isolados, fusão de regiões < área mínima (default 0,5 cm² em escala real).
- Saída: mapa de labels + paleta (n cores chapadas) + máscara de "zona não-quantizável" (alta entropia → S4 decide).

### S3 — Extração de regiões
- Componentes conexos com topologia (buracos/ilhas — contam para depilação do adesivo!), contornos vetorizados (marching squares + simplificação Douglas-Peucker com tolerância em cm reais), hierarquia (região dentro de região).
- Métricas por região: área (m²), perímetro (m), bounding box, nº de ilhas, altura mínima de traço (distance transform — decide "pintável vs vinil").

### S4 — Classificação de regiões
Para cada região/zona, classificar em:
- `CHAPADA` — variância LAB interna baixa.
- `DEGRADE_SIMPLES` — campo de gradiente coerente (1 direção ou radial) → candidata a aerografia. Sub-flags: encontra outra cor? encontra fundo/branco? (o caso SGT: degradê→branco quebra threshold; tratar borda por gradiente, não por cor).
- `FOTOGRAFICO_METALICO` — entropia local alta, gradientes multidirecionais, densidade de micro-clusters → **aerografia artística** (rota da casa; "imagem impressa" existe como opção de config, desligada — a empresa não usa). Detector complementar: (nº cores × densidade de arestas)/área.
- `MICRO` — altura de traço < limiar (default 8 mm) ou altura de letra < limiar (default 6 cm) → máscara de recorte fina + pintura com complexidade alta; abaixo do limite físico da plotter/depilação → aerografia à mão livre (alerta ao usuário sobre o custo).
- `TEXTURA_VETORIAL` — muitos micro-componentes da MESMA cor (maçã Bellaver, low-poly 137) → é recortável (weeding pesado), NÃO é aerografia. Diferencial: nº de cores baixo com fragmentação alta.
- Detectores especiais: QR code (padrões finder), selos regulamentares (SIF/SISBI circular pequeno), logos de terceiros (região multicolor compacta pequena), bandeiras.

### S5 — Matching com o banco de tintas
- Só após S2 (requisito explícito: nunca rodar ΔE sobre subpixels).
- Para cada cor chapada: `findSimilarColors` (métrica híbrida ΔE2000 + ΔE76/2 já em produção) contra as 516 tintas → tinta, tipo (Laca/Poliéster/Acrílico), acabamento, fórmula → `pricePerLiter` + densidade (489 fórmulas já têm custo real).
- Se tipo = Poliéster → verniz obrigatório no plano. Laca multi-cor → verniz único coletivo ao final (processo da casa). `PaintGround` (54 registros) → fundo requerido entra como sub-etapa.
- Sem match aceitável (ΔE > limiar) → marcar "tinta a formular" (custo estimado pela média do tipo + flag).
- Alerta "2 tons próximos demais" (ΔE entre cores da arte < 8): confirmar se são 2 tintas mesmo (caso BURES).

### S6 — Grafo de fronteiras
- Para cada par de regiões adjacentes: comprimento da fronteira (m lineares, em escala real), classificação geométrica por janela deslizante — histograma de curvatura (raio médio, ângulo acumulado, nº de cantos/cruzamentos) → `RETA | SUAVE | MEDIA | FECHADA | EXTREMA`.
- Tipo de fronteira:
  - `T-F` — tinta × fundo original (branco da chapa ou cor preservada da pintura geral): **não gera corte, nem fita, nem sessão**; só existe no adesivo.
  - `T-T` — tinta × tinta: gera decisão de processo (S7).
  - `KEYLINE` — filete de fundo entre 2 tintas: converte para 2×T-F (registrar a economia p/ exibir "por que ficou barato").
- Em pintura geral, re-ancorar **apenas as fronteiras entre duas tintas**: viram T-T-sobre-curado (resolvida por cura+adesivo, sem corte manual). Fronteira de tinta com **reserva** (branco/chapa preservada) permanece T-F — coerente com a definição de `T-F` acima.
  > Esta linha dizia "toda fronteira com o fundo vira T-T". Estava errada e contradizia a própria definição de `T-F` três linhas acima. As reanálises v2 mediram o custo: ~45 fronteiras T-T falsas só na "mar e rio" e ~14 m na A&P — transformando o elemento **mais barato** de cada arte (texto branco negativo, custo de tinta zero) no mais caro. Branco contado como tinta apareceu em 8/8 artes de uma das fatias.

### S7 — Atribuição de estratégias (rules-as-data)
Árvore de decisão avaliada por elemento (ordem de precedência; todos os limiares em `StrategyRule`):

1. `FOTOGRAFICO_METALICO` → **AEROGRAFIA_ARTISTICA** (bloco inteiro tratado pelo setor de Aerografia; remove as fronteiras internas do grafo — viram trabalho à mão livre do aerografista, custeado por m² com taxa própria + honorário do pintor, integrável ao modelo `Airbrushing` existente). Impressão digital NÃO existe no fluxo da casa (config `ALLOW_PRINTED_MEDIA` desligada).
2. `MICRO` → **ADESIVO_RECORTE fino** + pintura, com multiplicadores altos de plotagem/depilação/aplicação; abaixo do limite físico do recorte (config `MIN_CUTTABLE_STROKE_MM`) → aerografia à mão livre. Vinil colorido de recorte não entra no fluxo de implementos (só cabine, fora do escopo).
3. `DEGRADE_SIMPLES` → **AEROGRAFIA** dentro de máscara (a silhueta segue as regras abaixo).
4. Elemento gigante + pouquíssimos detalhes + corte facílimo (perímetro/área baixo, curvas só suaves, sem ilhas pequenas) → **STENCIL** (kraft furado + carvão sobre máscara de transferência aplicada direto na chapa; corte in-situ). Economiza adesivo largo.
5. Fronteira T-T reta → **FITA_DE_CORTE** (fita larga + corte manual; custo por m de corte × dificuldade).
6. Fronteira T-T suave/longa quase-faixa → **FITA_AMARELA_FLEXIVEL** (só aplicação, ZERO corte; caso mar e rio).
7. Fronteira T-T média/fechada/curta, ou letra sobre campo pintado → **CURA_E_ADESIVO** (pintar → envernizar se necessário → curar ~3h → adesivo por cima → próxima cor). Regra econômica explícita: `tempoDeCorte(perímetro, curvatura) > tempoDeEspera(3h absorvível na sessão?) → esperar cura`.
8. Default (forma fechada sobre fundo) → **ADESIVO_RECORTE** (plotter) + laca.

Modificadores de substrato:
- `ISOPLASTIC` → inserir sub-etapa **lixamento** das janelas após aplicação/depilação do adesivo; bonus: dificuldade de corte reduzida (liso, sem frisos).
- `CHAPA_COM_FRISOS` → dificuldade de corte aumentada ao cruzar frisos; empapelamento de molduras/frisos na pintura geral.
- `SIDER_LONA` → rota totalmente diferente: pintura com a linha vinílica (11 tintas em estoque), rendimentos e solvente próprios; laca/poliéster bloqueados.

### S8 — Sessões e ordem de pintura
- Montar grafo: nós = camadas de cor; arestas = restrições (A deve estar curada antes de B por cura+adesivo; A é fundo de B; clara antes de escura configurável).
- **Cores que não se tocam = mesma sessão** (achado recorrente: "amarelo e branco não se tocam → 1 sessão só"). Colorir o grafo minimizando nº de sessões; cada sessão adicional = troca de cor + limpeza de pistola + possível espera de cura.
- Custo-alvo da otimização (pesos configuráveis): nº de mascaramentos, nº de adesivos, m de corte, m de fita, trocas/limpezas, tempo parado de cura, reaproveitamento de superfícies já envernizadas, agrupamento das faces (2 laterais + traseira no mesmo ciclo de cura ≈ 40% de economia de espera).
- Saída: sessões → dias (jornada configurável, curas de 3h absorvidas dentro do dia quando possível, cura overnight quando não).
- A ordem é **editável**; reordenar dispara recálculo dos mascaramentos (requisito explícito).

### S9 — Quantidades
- **Tinta por cor**: `litros = (área × demãos / rendimento) × (1 + perdaPulverização + perdaPreparo)`; demãos default por tipo/cor (cores claras sobre escuro → +1 demão de base clara — caso BIAVA); rendimento por tipo de tinta (config). Catalisador/diluente pela proporção da fórmula/tipo.
- **Adesivo**: larguras úteis disponíveis = `{50, 60, 70, 80, 90, 100, 110, 120}` cm (bobinas 106/127/152 fatiadas — cadastro `AdhesiveWidth` editável). Para cada máscara: escolher a largura que minimiza `desperdício = área_da_banda − área_do_elemento`, com emendas a cada comprimento máximo prático (config, default 1,5 m com alerta de alinhamento em faixas retas longas). Saída: m lineares por largura + % desperdício.
- **Máscara de transferência**: bobina 120 dividida em 2 → largura útil 60 cm; m lineares = perímetro de aplicação/área conforme estratégia.
- **Fitas**: m de fronteira × (1 + sobreposição + reaplicações em curvas/cantos + desperdício). Fita amarela 18mm para curvas; crepe automotiva 45mm para retas/empapelamento.
- **Papel TKV** (bobina 90 cm): área a proteger = área não-pintada exposta na sessão (calculada por sessão, não uma vez) + plástico/lona para grandes vãos.
- **Líquido de mascaramento**: material do passo de **pintura geral** — aplicado em chassis, rodas, para-choques e componentes que não podem receber pulverização; quantidade ∝ área/perímetro desses componentes (estimativa por tipo de implemento, editável).
- **Reforma**: removedor (por m² de adesivo antigo), PU/adesivo selante (por m linear de junta/perfil), faixas refletivas novas (itens 3M do estoque, por m ou por jogo).
- **Depilação (weeding)**: tempo ∝ nº de ilhas + perímetro (a maçã Bellaver com centenas de ilhas custa caro aqui, não no corte).
- **Lixas/estopa/desengraxante/carvão/kraft**: por m² das etapas correspondentes.

### S10 — Custeio
- **Materiais**: quantidade × preço unitário vindo de `MonetaryValue.current` do `Item` (ou `PaintFormula.pricePerLiter` para tinta) — **snapshotado no orçamento** (requisito: orçamentos antigos imutáveis quando preço muda; recotação explícita recalcula).
- **Mão de obra**: `tempo_da_etapa = quantidade ÷ taxa` com taxas m²/min ou m/min (placeholders na §6) × custo-hora. Custo-hora placeholder = média salarial CLT ativa (hoje **R$ 2.839,47/mês** ÷ jornada 220h × fator de encargos configurável, default 1,65 → ~R$ 21,30/h). Depois evolui para custo por setor/função.
- **Complexidade** (baixa/média/alta por elemento, dos critérios da spec): multiplica taxas de corte/depilação/mascaramento e % de margem de segurança.
- **Custos indiretos**: cadastro com 5 modos (fixo, /hora, /m², % sobre custo, % sobre venda): cabine, energia, plotter, compressor, descarte, administração, reserva de retrabalho, margem de erro, margem de lucro → **preço de venda sugerido**.

### S11 — Plano passo-a-passo e relatório
- Gera a sequência final de etapas concretas (ver UX §7), cada uma com: descrição, materiais (item + qtd + custo), tempo (taxa × quantidade, editável), custo MO, custo total, e **máscara raster acumulada** para o preview progressivo.
- Relatório-resumo com todos os campos pedidos na spec (dimensões, áreas por cor, m de fita, m de corte, materiais, tempos, custos, preço sugerido).

### Passe de QA semântico (paralelo, opcional por config)
LLM de visão com a rubrica validada → flags estruturadas: espelhamento de texto, arte cortada na borda, marca d'água/licença, logo de terceiro, QR, substrato provável, elemento sobre junta de porta, inconsistência lateral×traseira. Nunca altera números; só cria alertas que o usuário confirma/dispensa.

---

## 4. Modelo de dados (Prisma — novas tabelas)

```prisma
model PaintingAnalysis {
  id             String   @id @default(uuid())
  taskId         String?                    // opcional: análise avulsa ou ligada à tarefa
  status         PaintingAnalysisStatus     // DRAFT, PROCESSING, REVIEW, APPROVED, ARCHIVED
  engineVersion  String
  // calibração
  pxPerCm        Float?
  referenceKind  String?                    // TOTAL_LENGTH, SIDE_HEIGHT, DOOR_WIDTH, IMPLEMENT_MEASURE...
  referenceValue Float?
  implementMeasureId String?                // reuso da geometria real cadastrada
  substrate      SubstrateType              // CHAPA_FRISOS, ISOPLASTIC, SIDER_LONA, OUTRO (+source AUTO/MANUAL)
  stageOutputs   Json                       // artefatos por estágio (paths p/ File quando binário)
  faces          PaintingAnalysisFace[]
  plan           ProductionPlan?
  alerts         PaintingAnalysisAlert[]    // QA flags (type, severity, resolvedAt, resolution)
}

model PaintingAnalysisFace {           // lateral esq/dir, traseira, frente, teto
  id, analysisId, view (enum), fileId  // arte original
  widthCm, heightCm, paintedAreaM2, backgroundMode  // WHITE_PLATE, GENERAL_PAINT, SIDER_CANVAS (+source)
  backgroundPaintId?                   // se pintura geral
  regions    PaintingRegion[]
  boundaries PaintingBoundary[]
}

model PaintingRegion {
  id, faceId
  colorHex, paintId?                   // match ΔE (editável)
  kind        RegionKind               // CHAPADA, DEGRADE, FOTOGRAFICO, MICRO, TEXTURA, RESERVA
  strategy    StrategyKind             // ADESIVO_RECORTE, FITA_CORTE, FITA_FLEXIVEL, STENCIL,
                                       // CURA_ADESIVO, AEROGRAFIA, AEROGRAFIA_ARTISTICA, NENHUMA
  areaM2, perimeterM, islandCount, minStrokeMm
  complexity  ComplexityLevel          // LOW, MEDIUM, HIGH
  geometry    Json                     // contornos simplificados (px) p/ overlay SVG
  source      ValueSource              // AUTO | MANUAL  (padrão repetido em campos editáveis)
  autoSnapshot Json?                   // valores AUTO originais p/ diff/reset
}

model PaintingBoundary {
  id, faceId, regionAId, regionBId?    // B null = fronteira com fundo
  type        BoundaryType             // TT, TF, KEYLINE
  lengthM, curveClass                  // RETA, SUAVE, MEDIA, FECHADA, EXTREMA (histograma em Json)
  resolution  BoundaryResolution       // FITA_CORTE, FITA_FLEXIVEL, CURA_ADESIVO, NENHUMA
  cutLengthM, tapeLengthM              // derivados, editáveis
  source ValueSource
}

model ProductionPlan {
  id, analysisId, status
  totalDays, totalMinutes, totalMaterialCost, totalLaborCost,
  indirectCost, safetyReserve, profitMargin, suggestedPrice   // Decimal(10,2)
  priceSnapshotAt DateTime            // preços congelados aqui
  steps ProductionStep[]
}

model ProductionStep {
  id, planId, position, day, sessionIndex
  kind        StepKind    // REMOCAO_ADESIVO_ANTIGO, REMOCAO_REFLETIVA, LAVAGEM, VEDACAO_PU,
                          // EMPAPELAMENTO, MASCARAMENTO_LIQUIDO, LIXAMENTO, FUNDO, PINTURA, VERNIZ,
                          // ADESIVO_PLOTAGEM, ADESIVO_DEPILACAO, ADESIVO_APLICACAO, FITA, CORTE,
                          // STENCIL, CURA, REMOCAO_MASCARA, AEROGRAFIA,
                          // APLICACAO_REFLETIVA, LIMPEZA, INSPECAO
  title, description
  faceId?, regionIds Json?             // o que este passo cobre
  quantity, quantityUnit               // ex.: 42.5 M2, 18.3 M_LINEAR
  rateUsed Float                       // taxa aplicada (snapshot da config)
  minutes, laborCost                   // editáveis (source)
  waitMinutes                          // cura/secagem (não é MO)
  previewMaskFileId?                   // raster acumulado p/ preview progressivo
  materials StepMaterial[]
  actualMinutes?, actualNotes?         // comparação pós-obra
}

model StepMaterial {
  id, stepId, itemId?, paintFormulaId?
  quantity, unit
  unitPriceSnapshot Decimal            // congelado na criação
  totalCost Decimal
  source ValueSource                   // material substituível manualmente
}

// ---- Configuração (tudo editável na UI, é o "painel de calibração" do motor) ----
model ProductivityRate {  key @unique, label, value, unit, complexityFactorMedium, complexityFactorHigh }
  // ex.: WASH_M2_PER_MIN, PAPER_M2_PER_MIN, TAPE_M_PER_MIN, CUT_STRAIGHT_CM_PER_MIN,
  // CUT_CURVE_CM_PER_MIN, PAINT_M2_PER_MIN, WEED_M2_PER_MIN(+ilhas), PLOT_M_PER_MIN,
  // APPLY_ADHESIVE_M2_PER_MIN, AIRBRUSH_M2_PER_MIN, COLOR_SWAP_MIN, GUN_CLEAN_MIN...
model LaborRate        {  key @unique, mode (HOUR|MIN|M2|M_LINEAR|CM_CUT|ELEMENT|STEP), value, notes }
model IndirectCost     {  key @unique, label, mode (FIXED|PER_HOUR|PER_M2|PCT_COST|PCT_PRICE), value, active }
model StrategyRule     {  key @unique, label, params Json, active, position }
  // ex.: GENERAL_PAINT_THRESHOLD {pct:0.8}, MIN_PAINTABLE_LETTER_CM {v:6},
  // CURE_WAIT_MIN {v:180}, KEYLINE_MAX_PX {v:4}, ADHESIVE_WIDTHS_CM {v:[50..120]},
  // TAPE_OVERLAP_PCT, CUT_VS_CURE_BREAKEVEN...
model ProcessParameter {  paintTypeId, coatsDefault, coverageM2PerL, sprayLossPct, prepLossPct, cureMinutes }
```

Relação com o existente:
- `PaintingAnalysis.taskId` → `Task` (e via task ao `Truck`/`ImplementMeasure`); aprovar plano → gerar linha(s) `TaskQuoteService` (descrição + amount) chamando `recalcQuoteTotals` na mesma transação; a memória de cálculo fica na análise, o quote continua enxuto (compatível com snapshot de assinatura).
- Comparação estimado × real: `ProductionStep.actualMinutes` alimentado pós-obra (fase 5, via apontamento simples); histórico recalibra `ProductivityRate` (média móvel sugerida, aplicada manualmente).

---

## 5. Algoritmos-chave (referência de implementação)

1. **Quantização**: k-means em LAB com inicialização por picos do histograma (bins 8×8×8); pós-fusão ΔE<6; artefatos de AA tratados por erosão + votação de vizinhança. ~O(n·k·iter); 11k×3k px → processar em tiles + downsample 2× para clusterizar, atribuição final em resolução plena (keylines protegidas).
2. **Componentes conexos**: union-find em varredura única; topologia de buracos por ray-casting da hierarquia de contornos.
3. **Contornos**: marching squares → polilinha → Douglas-Peucker com ε em cm reais (0,5 cm default) → armazenar simplificado p/ SVG overlay.
4. **Curvatura**: janela deslizante de 3 pontos sobre a polilinha reamostrada a passo fixo (2 cm); raio via circunferência circunscrita; classificar segmentos e agregar em histograma por fronteira; `ângulo acumulado / comprimento` distingue S-longa (flexível) de fechada.
5. **Keyline**: nas máscaras full-res, para cada par de regiões A,B: dilatar A∩dilatar B; nos pixels de contato, verificar presença de cor-de-fundo em espessura ≤ `KEYLINE_MAX_PX`.
6. **Sessões**: coloração gulosa do grafo de conflitos (arestas = pares T-T que exigem cura entre si) com heurística de ordenação (claras→escuras, fundo→detalhe); busca local (swap de sessões) minimizando função de custo ponderada. Não precisa de solver exato — o usuário edita o resultado.
7. **Largura de adesivo**: para cada máscara, testar as larguras disponíveis em orientação horizontal (bobina corre na horizontal do implemento): `custo = Σ(m lineares × preço/m da largura)`; permitir divisão da máscara em bandas horizontais; escolher mínimo.
8. **Corte vs cura (breakeven)**: `minutosCorte = Σ(comprimento_seg / taxa_da_classe)`; se `minutosCorte > CURE_BREAKEVEN_MIN` (default 60) ou existir letra/curva EXTREMA → rota cura+adesivo. Exibir a comparação na UI (explicabilidade).

---

## 6. Placeholders iniciais de calibração

Preencher `ProductivityRate` com estes chutes honestos (unidade m²/min ou m/min), todos ajustáveis e recalibráveis pela fase 5:

| Operação | Taxa placeholder |
|---|---|
| Remoção de adesivo antigo | 0,15 m²/min |
| Remoção de faixa refletiva | 0,5 m/min |
| Vedação PU (juntas/perfis) | 1 m/min |
| Aplicação líq. de mascaramento | 1 m²/min |
| Aplicação faixa refletiva nova | 1,5 m/min |
| Lavagem/desengraxe | 1,5 m²/min |
| Empapelamento (papel+fita) | 0,8 m²/min |
| Lixamento isoplastic | 0,5 m²/min |
| Aplicação de fita reta | 4 m/min |
| Aplicação fita amarela em curva | 1,5 m/min |
| Corte reto | 60 cm/min |
| Corte curva média | 25 cm/min |
| Corte curva fechada | 10 cm/min |
| Plotagem | 3 m/min |
| Depilação | 0,3 m²/min (+0,5 min/ilha) |
| Aplicação de adesivo na chapa | 0,4 m²/min (2 pessoas) |
| Pintura pistola (demão) | 2 m²/min |
| Aerografia | 0,15 m²/min |
| Troca de cor + limpeza | 20 min |
| Preparo de tinta | 10 min/cor |
| Cura laca p/ adesivo | 180 min (espera) |
| Verniz | 2 m²/min + 12h cura final |

Mão de obra placeholder: média CLT ativa (query no banco) **R$ 2.839,47/mês** → R$ 12,91/h base × encargos 1,65 = **R$ 21,30/h** (um único valor global; por-setor depois). Rendimento default: 6 m²/L por demão (ajustar por tipo).

---

## 7. UX

### Página principal: `/pintura/analise-de-arte` (pages/painting/art-analysis/)
Fluxo em 4 abas/etapas:

1. **Arte & Escala** — upload das faces (ou escolher Layout já anexado à Task); informar medida de referência ou vincular `ImplementMeasure`; escolher substrato (sugerido pelo QA, confirmável); escolher **novo × reforma** (reforma prefixa remoção de adesivos/refletivas → limpeza → vedação PU e adiciona refletivas novas ao final); informar "implemento já preparado?" (pula etapas de preparação).
2. **Revisão da análise** — imagem com overlay SVG: regiões coloridas por estratégia (legenda), fronteiras destacadas com comprimento por trecho e total, keylines celebradas em verde ("economia"), alertas do QA no painel lateral. Interações: clicar região → painel (cor detectada, tinta match + alternativas ΔE, estratégia com justificativa e alternativas, área, editar/mesclar/dividir/marcar "sem intervenção"); clicar fronteira → tipo, comprimento, resolução, breakeven corte×cura. Toda edição marca `MANUAL` e dispara recálculo incremental (S7+).
3. **Plano passo-a-passo** — o produto central: timeline vertical começando na **face em branco** e terminando na arte completa. Cada passo: preview do estado da superfície (composição progressiva das máscaras raster), título ("Passo 4 — Aplicar adesivo e lixar janelas"), descrição, chips de materiais com quantidades, tempo (taxa × qtd, editável inline), custo do passo (material + MO), esperas de cura como passos visuais "relógio". Agrupamento por dia. Drag para reordenar sessões (recalcula mascaramentos).
4. **Orçamento** — resumo da spec (áreas, cores, fitas, cortes, materiais, tempos) + tabela de custos com **cada linha abrível** até a composição (qtd × taxa × preço snapshot); custos indiretos e margens; preço sugerido; botão "Enviar para orçamento da tarefa" (cria `TaskQuoteService`).

### Configuração: `/pintura/analise-de-arte/configuracoes`
CRUD das 4 tabelas de calibração (taxas, mão de obra, indiretos, regras/limiares) no padrão de tabelas já usado no web. É aqui que "qualquer parte que não estiver funcionando bem" se ajusta sem deploy.

---

## 8. Fases de implementação

| Fase | Entrega | Valor |
|---|---|---|
| **F0** | Modelo de dados + módulo NestJS + telas de configuração (taxas/regras/indiretos) + custo-hora CLT | Fundação; empresa começa a cadastrar calibração |
| **F1 — "manual-first"** | Upload + escala + **marcação manual de regiões** (polígono/varinha mágica simples por flood-fill) + S5 (ΔE) + S9–S11 completos (quantidades, custeio, plano passo-a-passo, snapshot) | **Orçamento completo e explicável já nesta fase**, com humano fazendo a segmentação; valida todo o motor de custo antes de investir em CV |
| **F2** | Pipeline automático S1–S4, S6 (quantização, regiões, fronteiras, curvatura, keylines) + UI de revisão com overlay | O humano passa de "desenhar" para "revisar" |
| **F3** | S7–S8 (estratégias rules-as-data + sessões/ordem + breakeven corte×cura + larguras de adesivo) | O plano vira automático; usuário só confirma |
| **F4** | QA semântico (LLM visão) + alertas (espelhamento, marca d'água, junta, terceiros) + detectores especiais (QR/selos) | Blindagem contra os erros caros comprovados no acervo |
| **F5** | Apontamento real × estimado + recalibração assistida das taxas | O motor aprende com a produção |

A F1 primeiro é a decisão mais importante do plano: o motor de **custo** (metade do valor) não depende da visão computacional (metade do risco). Se a segmentação automática decepcionar em alguma classe de arte, a feature continua 100% utilizável em modo manual/assistido.

---

## 9. Riscos e decisões em aberto

1. **Custo/qualidade da segmentação automática em artes fotográficas** — mitigado: regiões de alta entropia são explicitamente *não-segmentadas* (viram bloco único de aerografia artística, custeado por m² + honorário); o pipeline não tenta decompor o indecomponível.
2. **Limiar branco-vs-cinza (pintura geral)** — decisão de dias de trabalho; sempre flag humana em zona ambígua (ΔE do fundo vs branco < 10).
3. **Preços faltantes** — vários itens sem `MonetaryValue` (máscaras de transferência, fitas). O plano deve exibir "sem preço cadastrado" com link para corrigir, nunca assumir zero.
4. **Duplicatas no cadastro de itens** (2× "Fita Crepe Uso Geral", 3× "Verniz", 2× "Bobina Papel TKV") — a UI de material do passo deve escolher item específico; vale higienizar o cadastro antes da F1.
5. **Custeio da aerografia artística** — blocos fotográficos/metálicos viram trabalho do setor de Aerografia; o modelo `Airbrushing` existente já tem `price` e `painterId`. Definir na F3 se o motor estima por m²×taxa ou apenas reserva a linha para preço combinado com o aerografista (provável híbrido: sugestão automática + override manual).
6. **Sider/lona** — rota separada (linha vinílica em estoque sugere pintura em lona também acontece); definir na F3 se entra no motor ou fica como orçamento manual.
7. **Faces múltiplas e reuso entre laterais** — espelhamento de máscara reaproveita arquivo de plotagem mas não o adesivo; modelar "produzir 2× máscara espelhada" como quantidade, não como nova análise.

---

## 10. Inventário de reuso (mapeado no código)

| Ativo existente | Onde | Uso na feature |
|---|---|---|
| ΔE híbrido em produção | `api/src/utils/paint.ts:88` (`findSimilarColors`) | S5 matching (com índice LAB pré-computado das 516 tintas) |
| Conversões LAB órfãs | `web/src/utils/color.ts` (`hexToLab`, `deltaE76`) | Portar para api; base das comparações |
| Cadeia área→volume→custo | `api/src/utils/paint.ts:605,644,662` (`calculateFormulaCost`, `calculatePaintVolumeNeeded`, `calculatePaintCoverage`) | S9/S10 — já escrita, faltava a origem da área |
| Fórmulas com preço/L + densidade | `PaintFormula` (489 registros) | Custo real de tinta por cor |
| Fundo por tinta | `PaintGround` (54) | Sub-etapa de fundo automática |
| Geometria real do implemento | `ImplementMeasure`(+Sections) + `web/src/utils/generate-implement-measure-svg.ts` | Calibração de escala + desconto de portas |
| Silhueta de painel + LiveryUV | `truck-studio` (`trailer_meta.json` outlineSide/outlineRear; porte web em `web/src/pages/tools/truck-studio/`) | (Fase futura) área efetiva ≠ retângulo; preview 3D do plano |
| Fila de processamento de imagem | `api/src/modules/common/file/thumbnail-queue.service.ts` (+sharp) | Molde do worker do pipeline |
| Orçamento/quote | `TaskQuote` + `recalcQuoteTotals` (`api/src/utils/task-quote-totals.ts`) | Saída comercial do plano |
| Padrão de página/rotas | `routes.ts` bloco painting (`/pintura/...`), `App.tsx` lazy routes | Encaixe da UI |

---

## 11. Base empírica

- `layout database/analysis/analysis_A.md` … `analysis_F.md` — análise produção-orientada das 66 artes, com decomposição por camadas/dias e seções "PADRÕES TRANSVERSAIS" (insumo direto para as `StrategyRule` e para a rubrica do QA semântico).
- Estatísticas do acervo: ~60% chapa branca pura, ~25% pintura geral, ~15% híbrido; fronteiras T-T reais raras (maioria das artes tem 0–2); fita amarela flexível aplicável em ~1/3; ~40% das artes têm pelo menos um bloco de alta complexidade (selos/fotos/metálicos) que na prática da casa é resolvido por **aerografia artística** ou por recorte fino de alta complexidade — nunca por mídia impressa.
- Nota de leitura: os relatórios A–F sugerem "impressão digital" em vários blocos — os agentes não sabiam que a casa **não usa vinil impresso**; ao ler as análises, traduzir mentalmente "impressão digital" → "aerografia artística / recorte fino + pintura".
