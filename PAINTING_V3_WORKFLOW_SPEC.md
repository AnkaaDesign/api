# Orçamento de Pintura — V3: workflow, engine e UI

> Status: **ESPECIFICAÇÃO** (2026-08-04). Substitui o comportamento de plano/UI descrito em
> `PAINTING_COST_ENGINE_PLAN.md` §"V2". O que está implementado hoje está diagnosticado em §1.
> Nada aqui foi implementado ainda — este documento é o acordo antes da próxima etapa.

---

## 1. Diagnóstico do que existe hoje

### 1.1 O workflow está invertido: tudo nasce da imagem

Hoje **todo** passo de produção é derivado do artefato do engine por face
(`painting-compute.service.ts:590` — `for (const face of analysis.faces)`). A consequência:

- Se o engine não devolveu `layout` para a face, o plano inteiro degenera para
  três passos inúteis — "Reprocessar a imagem", "Limpeza final", "Inspeção final"
  (`painting-compute.service.ts:603-617`). É exatamente o que aparece no print: um wizard
  com 6 bolinhas onde 3 são lixo.
- A pintura geral (lavar, empapelar, fundo, cor) é emitida **por face**
  (`painting-compute.service.ts:449-530`). Numa carreta com 4 vistas, o líquido de
  mascaramento do chassi é cobrado 4×, o "fundo" 4×.
- Não existe nenhum passo que não venha da arte: **desmontagem de portas, Thermo King,
  secagem, lixamento da traseira/frente, limpeza do teto e pintura do teto simplesmente
  não existem** — nem no enum `PaintingStepKind`, nem no builder.

**Causa raiz:** o modelo assume "1 arte → 1 face → passos da face". A pintura geral não é
um atributo da arte, é um atributo **do implemento**. São dois programas de produção
diferentes, com fontes de dados diferentes (§2).

### 1.2 Números inventados no meio do cálculo

| Local | O que faz | Problema |
|---|---|---|
| `painting-compute.service.ts:457` | `stripArea = perimetro × 0,3` | faixa de 30 cm de empapelamento tirada do nada |
| `painting-compute.service.ts:526` | `unitPrice: pricePerLiter * 0.7` | "fundo custa 70% da cor" — invenção |
| `:482` e `:784` | `unitPrice: 0` para Papel TKV | papel **nunca** é cobrado (vira badge "sem preço") |
| `:278` | `LIQUID_MASK_DEFAULT_M2 = 8` | 8 m² fixos, independente do tamanho do implemento |
| `:904` | `varnishLiters = área / 8` | rendimento 8 m²/L hardcoded, ignora `PaintingProcessParameter` |
| `:901-903` | área do verniz = soma das janelas | janelas de elementos sobrepõem a janela geral → verniz contado 2× |
| `seed:38` | `APPLY_ADHESIVE (2 pessoas)` | a nota diz 2 pessoas, o custo multiplica por **1** hora-homem → mão de obra pela metade |

### 1.3 A tinta é calculada sem catálise e sem diluição

`paintLiters()` (`:1075`) faz `área × demãos / rendimento × (1 + perdas)` e cobra esse volume
inteiro ao `pricePerLiter` da fórmula. Isso está errado por três motivos:

1. o volume pulverizado é **mistura pronta**, não tinta pura;
2. catalisador (Endurecedor PU / Clear) e diluente (Thinner/Diluente) têm preço próprio e
   **existem no estoque** — hoje não entram em nenhum passo;
3. não existe modelagem de **esquema de demãos**: hoje é um número (`coatsDefault`), quando
   a regra real é uma sequência heterogênea (2 demãos de laca + 2 de acrílico; ou 2 de laca
   + 3 de poliéster + 1 de verniz).

Também não existe o conceito de **laca de tom próximo** como produto separado da cor final —
o passo `FUNDO` usa a própria tinta com desconto de 30%.

### 1.4 A "simulação" não simula nada

`StepCanvas` (`web/.../simulation/step-canvas.tsx`) desenha só retângulos cinza tracejados
(banda), padrão kraft (papel) e retângulo colorido (janela de pintura), por cima da arte com
um filtro CSS P&B. Consequências visíveis no print:

- passos sem geometria (`rects: []`) mostram **a arte crua sem nada** — é o print da
  "Inspeção final e retoques";
- `MASCARAMENTO_LIQUIDO` não tem sequer a chave `visualization` → `showCanvas === false` →
  a página não mostra imagem nenhuma;
- não existe separação de elementos: as bandas são fatias horizontais da face inteira
  (`masks.py:_find_strips` + `_layout_strip`), então nunca aparece "o adesivo da
  TRANSPORTADORA separado do adesivo do 100 FRONTEIRAS" como nos mockups;
- o "P&B de plotter" é um `filter` de CSS sobre o JPG, não o contorno de corte real — o
  engine **já tem** os contornos vetoriais (`Region.contour` + `holes`, `regions.py:19`) e
  eles não são usados na simulação.

### 1.5 A separação por elementos falta — e isso também quebra o custo da tinta

`_session_windows` (`masks.py:488`) calcula **uma bbox por (cor × faixa)**: a caixa de todos
os pixels daquela cor dentro da faixa. Numa lateral de 14 m com a mesma cor nas duas pontas,
a "janela de pintura" vira a lateral inteira. Como o consumo de tinta é calculado **pela área
da janela** (decisão v2, correta em princípio), o orçamento infla proporcionalmente.

A separação por elementos (§5) resolve os dois problemas de uma vez: dá a imagem que os
mockups pedem **e** dá janelas de pintura com o tamanho certo.

### 1.6 A tabela do passo mistura conceitos

Colunas atuais: `Material | Quantidade | Preço | Total`
(`web/.../simulation/step-cost-table.tsx:69-74`), com a linha "Mão de obra" dentro da tabela
de materiais. Problemas: mão de obra não é material; "Preço" é ambíguo (é preço unitário por
m², por metro, por litro ou por hora); não há como distinguir material consumido, serviço de
terceiro (aerografia) e locação/equipamento; e não há subtotal por tipo.

---

## 2. Modelo novo: dois programas compostos

```
PaintingProductionPlan
├── Programa A — SUPERFÍCIE  (do implemento; medidas + opções, NÃO depende da arte)
│     desmontagem → preparação → mascaramento → pintura (esquema de demãos)
│     → limpeza do teto → pintura do teto → remontagem
└── Programa B — COMUNICAÇÃO VISUAL  (da arte; por face, por elemento)
      plotagem/recorte → depilação → aplicação → empapelamento → sessões de pintura
      → remoção de máscara → verniz coletivo
```

Regras de composição:

1. **B só existe se houver arte com elementos**. Sem logomarca, o plano é só A (é o caso que
   o dono descreveu: "em caso de ser uma pintura geral, se não tiver logo").
2. **A só existe se houver pintura geral / reforma / preparação**. Chapa branca original com
   logo = só B (o arquétipo de ~60% das artes).
3. Quando os dois existem, **A vem inteiro antes de B**, com uma cura entre eles (o adesivo
   só cola sobre tinta curada — doutrina já registrada).
4. O verniz coletivo é o último passo do plano composto, nunca de um programa isolado.

### 2.1 Entradas do formulário — **o mínimo possível** (decisão do dono, 2026-08-04)

O orçamento tem que ficar mais fácil, não mais configurável. O formulário inteiro é:

| Campo | Por quê não dá para inferir |
|---|---|
| `name` | identificação |
| `serviceContext` (Novo/Reforma) | é o serviço vendido |
| `substrate` (Carga Seca / Isoplastic / Lona / Refrigerado) | é o implemento do cliente |
| `paintSystemKey` (Laca/Acrílico/Poliéster/PU) | é o que o cliente compra |
| `lengthCm`, `heightCm` | as **únicas** medidas |

**Inferido da arte** (nunca perguntado):
- `generalPaint` — a face com fundo `GENERAL_PAINT` liga o Programa A;
- **cor final** — `face.backgroundPaintId`, já resolvido por ΔE no estágio MATCH.
  `targetPaintId` sobrevive só como override manual.

**Inferido da regra `IMPLEMENT_DEFAULTS` + substrato** (nunca perguntado):

| Derivado | Como |
|---|---|
| largura | `widthCm` da regra (260 cm) — implemento rodoviário é padronizado |
| laterais | 2 × comprimento × altura |
| traseira + frente | 2 × largura × altura |
| teto | comprimento × largura (**sempre** pintado, 1 demão de laca) |
| chassi | = comprimento |
| perímetro dos frames | contorno das 4 faces: 2×2×(C+A) + 2×2×(L+A) |
| área de papel nos frames | perímetro × `frameBandCm` (20 cm) |
| portas traseiras | `rearDoorCount` da regra (2) |
| Thermo King | substrato **Refrigerado** |
| preparação | sempre feita — não existe "implemento já preparado" |

---

## 3. Catálogo de passos — Programa A (pintura geral)

Ordem exata ditada pelo dono. Cada passo é **uma página** na UI (§6) com **uma tabela** (§7).

### A1 — `DESMONTAGEM` · Desmontagem das portas traseiras
- Sub-tarefas: desmontar portas traseiras (× `rearDoorCount`); desmontar o aparelho Thermo
  King (só quando `hasThermoKing`).
- Materiais: **nenhum**. Só mão de obra.
- Base de cálculo: `MIN_PER_UNIT` por porta + `MIN_FIXED` para o Thermo King.
- Visual: esquemático da traseira com as portas destacadas (§6.3).

### A2 — `PREPARACAO` · Preparação da superfície
Um único passo com sub-tarefas (o dono disse "nesse passo os materiais são…", no singular):

| Sub-tarefa | Base de medida |
|---|---|
| Lavagem das laterais | m² das laterais |
| Secagem | m² das laterais |
| Desengraxe das laterais | m² das laterais |
| Lixamento da traseira e da frente | m² traseira + frente |
| Lixamento das peças do Thermo King | unidade (fixo) |
| Desengraxe final | m² total |

- Materiais: **Intercap**, **Scotch Brite**, **Estopa de Pano**, **Lixa Hookit P220**,
  **Lixa Hookit P320**, **Desengraxante** (todos existem no estoque com esses nomes exatos).
- Consumo: cada material tem um **rendimento** próprio (m²/unidade) configurável — nada de
  `Math.ceil(area/30)` espalhado pelo código (§8.3).

### A3 — `MASCARAMENTO` · Mascaramento para pintura
- Sub-tarefas: líquido de mascaramento no **chassi**; papel + fita nos **frames metálicos**.
- Materiais: **Líq. de Mascaramento** (L, por metro linear de chassi), **Bobina Papel TKV**
  (m², pela área de frames), **Fita Crepe Automotiva** (m, pelo perímetro dos frames).
- Base: `chassisLengthCm` e `frameCount`/`framePerimeterCm` digitados no orçamento (§2.1).

### A4 — `PINTURA` · Pintura geral (esquema de demãos)
Depende de `paintSystem`. O passo carrega um **esquema**, não um número de demãos:

| Sistema | Esquema |
|---|---|
| Acrílico | 2 demãos **Laca** (tom mais próximo da cor) + 2 demãos **Acrílico** (a cor) |
| Poliéster | 2 demãos **Laca** (tom próximo) + 3 demãos **Poliéster** (a cor) + 1 demão **Verniz** |
| Laca | 2 demãos Laca (tom próximo) + 2 demãos Laca (a cor) *(a confirmar)* |

- Cada grupo de demãos gera **suas próprias linhas de material**: tinta + catalisador +
  diluente, calculados em §4.
- A "laca de tom próximo" é resolvida por ΔE contra o banco de tintas **restrito ao
  `PaintType` = Laca** — hoje o MATCH não filtra por tipo (`painting-compute.service.ts:115`).
- Cura entre grupos conforme `PaintingProcessParameter.cureMinutes` do tipo.

### A5 — `LIMPEZA_TETO` · Limpeza do teto para pintura
- Materiais: desengraxante + estopa (rendimento próprio).
- Base: m² do teto.

### A6 — `PINTURA_TETO` · Pintura do teto
- **1 demão** da **laca de tom mais próximo da cor** (nunca a cor final).
- Mesma matemática de §4, com `coats = 1`.

### A7 — `REMONTAGEM` · Remontagem das portas e do Thermo King
> **Suposição** (não citada pelo dono): se desmontou, remonta. Emitido espelhando A1.
> Se não for cobrado, basta desativar a regra `DISASSEMBLY_REASSEMBLY` na config.

Depois de A7, se houver logomarca, entra o Programa B.

---

## 4. Matemática da tinta com catálise e diluição

### 4.1 Modelo

Cada **grupo de demãos** (laca, cor, verniz) tem um *produto* com proporção de mistura por
volume `base : catalisador : diluente` e um rendimento **da mistura pronta**:

```
V_pronta   = (área × demãos / rendimento_pronta) × (1 + perda_pistola + perda_preparo)
soma       = base + catalisador + diluente
V_base     = V_pronta × base        / soma
V_catal    = V_pronta × catalisador / soma
V_diluente = V_pronta × diluente    / soma

custo = V_base     × preçoPorLitro(fórmula da tinta)
      + V_catal    × preçoPorLitro(item catalisador)
      + V_diluente × preçoPorLitro(item diluente)
```

- `preçoPorLitro(item)` sai do preço atual do item ÷ medida `VOLUME/LITER` (já existe em
  `varnishPricePerLiter`, precisa virar helper geral).
- **Lote mínimo de mistura**: preparar meio litro de laca não é possível na prática. Regra
  `PAINT_MIN_BATCH_L` (default 0,5 L) arredonda `V_pronta` para cima — hoje inexistente.
- A tabela do passo mostra **3 linhas por grupo de demãos**, não uma: "Laca X (2 demãos)",
  "Endurecedor", "Diluente" — que é o que o dono quer ver como "contar com a catálise".

### 4.2 Onde ficam as proporções — **por sistema de pintura** (decisão do dono)

A lógica é implementada por sistema (Laca, Acrílico, Poliéster, PU…), não por fórmula.
Nova tabela `PaintingPaintSystem` (rules-as-data, editável na página de configurações):

```
key             LACA | ACRILICO | POLIESTER | PU        (extensível)
label           "Poliéster"
paintTypeId     → PaintType (para o ΔE do match ficar restrito ao tipo certo)
coatsSchedule   Json [{ role, systemKey, coats }]
                  ex. POLIESTER: [{GROUND, LACA, 2}, {COLOR, POLIESTER, 3}, {CLEAR, VERNIZ, 1}]
                  ex. ACRILICO : [{GROUND, LACA, 2}, {COLOR, ACRILICO, 2}]
mixBase / mixCatalyst / mixThinner   Float — partes por volume
catalystItemId / thinnerItemId       → Item (Endurecedor PU…, Thinner/Diluente)
coverageM2PerL  Float — rendimento da MISTURA PRONTA
minBatchL       Float — lote mínimo de preparo
cureMinutes     Float — cura entre grupos de demãos
needsConfirmation Boolean — enquanto true, alerta amarelo no plano
```

Cada grupo do `coatsSchedule` referencia outro sistema (`GROUND → LACA`), então a laca de
tom próximo herda a proporção e o rendimento *da laca*, não da cor final — que é o
comportamento correto e o que hoje é substituído pelo hack `pricePerLiter × 0,7`.

**Proporções informadas pelo dono (2026-08-04), já no seed:**

| Sistema | tinta : catalisador : diluente | Diluente | Esquema |
|---|---|---|---|
| Laca | 2 : 0 : 1 | Thinner 7000 | 2 demãos fundo + 2 demãos cor |
| Poliéster | 2 : 0 : 1 | Diluente | 2 laca + 3 poliéster + 1 verniz |
| Acrílico | 3 : 1 : 1 | Diluente | 2 laca + 2 acrílico |
| PU | 3 : 1 : 1 | Diluente | 2 laca + 2 PU + 1 verniz |
| Verniz | 3 : 1 : 1 | Diluente | 1 demão |

> Rendimento (m²/L), lote mínimo e cura entraram como **estimativas** com
> `needsConfirmation: true` — o plano emite o alerta `PAINT_SYSTEM_ESTIMATED` e tudo é
> editável em `/config/paint-systems/:id`.

---

## 5. Engine — separação de elementos (novo estágio `elements`)

Entre `regions` e `layout`, um estágio novo:

1. **Agrupamento**: fechamento morfológico da união pintável com raio `element_gap_cm`
   (default 4 cm) → componentes conexos = **elementos**. Regiões contidas
   (`Region.contained_by`) herdam o elemento do pai.
2. Cada elemento recebe: `id`, `bboxCm`, `areaM2`, `colorIndexes`, `regionIds`,
   `minStrokeMm`, `islands`, `label` (auto: "Elemento 1", editável pelo usuário —
   "Transportadora", "100 Fronteiras").
3. **Banda de adesivo por elemento** (não mais faixa da face inteira): a decomposição em
   larguras 50–120 roda dentro da bbox do elemento. Elementos que se sobrepõem na mesma
   faixa horizontal e distam menos que `element_merge_cm` podem fundir — com alerta.
4. **Papel por elemento**: anel de proteção ao redor da peça de adesivo do elemento
   (é literalmente o mockup do empapelamento).
5. **Janela de pintura por elemento × cor** — substitui a bbox por faixa. Corrige §1.5.
6. Contornos: o estágio exporta `contourCm` (contorno + furos convertidos de px de trabalho
   para cm) por região, para o cliente desenhar o traço de corte real (§6.2).

Saída no artefato:

```jsonc
"elements": [
  { "id": "el-1", "label": null, "xCm": .., "yCm": .., "wCm": .., "hCm": ..,
    "areaM2": .., "regionIds": ["r3","r4"], "colorIndexes": [1,2],
    "adhesive": { "pieces": [ {"xCm":..,"wCm":..,"widthClassCm":100, "splices":0} ],
                  "areaM2": .., "transferLinearM": .. },
    "paper":    { "panels": [...], "areaM2": .., "tapeM": .. },
    "windows":  [ {"colorIndex":1, "xCm":.., ...} ] }
]
```

---

## 6. Contrato de visualização por passo

### 6.1 Princípio

O engine **não gera PNG**. Ele gera **camadas vetoriais em centímetros**; o cliente
compõe SVG sobre a arte. Motivos: nítido em qualquer zoom, respeita tema claro/escuro,
não polui a tabela `File`, e a mesma estrutura serve para exportar o PDF do orçamento
(rasterizado no servidor a partir do mesmo SVG). A única coisa que o engine precisa
publicar a mais é o **contorno em cm** de cada região (§5.6) — que ele já calcula.

### 6.2 Camadas

```ts
type StepLayer =
  | { kind: 'ART';           mode: 'PHOTO'|'LINE_ART'|'FLAT'|'DIMMED'|'HIDDEN' }
  | { kind: 'CUT_PATH';      paths: string[] }            // contorno de corte (plotter)
  | { kind: 'ELEMENT_BOX';   boxes: {x,y,w,h,label}[] }   // "quadrados separando os itens"
  | { kind: 'ADHESIVE';      pieces: {x,y,w,h,widthClassCm,elementId}[] }
  | { kind: 'PAPER';         panels: {x,y,w,h}[] }        // empapelamento
  | { kind: 'PAINT_WINDOW';  windows: {x,y,w,h,color,phase}[] }
  | { kind: 'TAPE';          segments: {path,widthMm}[] }
  | { kind: 'LIQUID_MASK';   regions: {x,y,w,h}[] }
  | { kind: 'SCHEMATIC';     view: 'SIDE'|'REAR'|'ROOF'; highlight: string[] }
```

Cada passo declara `layers: StepLayer[]` + `caption`. O acumulado (`phase: PRIOR|CURRENT`)
continua como está — é a parte da v2 que funciona.

### 6.3 Tradução dos mockups

| Mockup | Passo | Camadas |
|---|---|---|
| #2 (adesivagem) | `ADESIVO_PLOTAGEM` | `ART:LINE_ART` + `CUT_PATH` + `ELEMENT_BOX` (uma caixa por elemento, rotulada) + `ADHESIVE` |
| #3/#4 (empapelamento) | `EMPAPELAMENTO` | `ART:LINE_ART` + `ADHESIVE` (peça, em branco) + `PAPER` (preenchimento escuro ao redor) |
| — | `PINTURA` de sessão | `ART:DIMMED` + `PAINT_WINDOW` na cor da sessão |
| — | A1/A2/A3/A5/A6 | `SCHEMATIC` (silhueta do implemento) com a superfície da vez destacada |

Para o `SCHEMATIC`, reaproveitar as silhuetas reais do **truck-studio** (`outlineSide` /
`outlineRear`) — já são o painel correto do implemento, não precisa desenhar nada novo.

**Regra dura:** nenhum passo pode cair na tela "arte crua sem nada". Passo sem geometria
mostra o esquemático + a checklist de sub-tarefas.

---

## 7. Tabela do passo — nomenclatura e estrutura

Colunas escolhidas pelo dono: **`Descrição | Qtd. | Un. | Valor unit. | Total`**, com as
linhas agrupadas por tipo e subtotal por grupo:

```
MATERIAIS
  Descrição                  Qtd.    Un.   Valor unit.   Total
  Adesivo Vinil (100 cm)     12,40   m     R$ 8,90       R$ 110,36
  Máscara de Transferência    3,20   m     R$ 2,10       R$   6,72
  ── subtotal materiais                                  R$ 117,08
MÃO DE OBRA
  Plotagem e recorte          0,75   h     R$ 21,30      R$  15,98
  ── subtotal mão de obra                                R$  15,98
TOTAL DO PASSO                                           R$ 133,06
```

- **Un.** é coluna própria: m², m (fita, stencil, refletiva), L (tinta/catalisador/diluente),
  un (lixa, tubo de selante), h (mão de obra). Nada presume m².
- Mão de obra é exibida em **horas** (2 casas) para casar com o `Valor unit.` R$/h; os
  minutos continuam sendo o dado editável (input em min ao lado do valor, como já é hoje).
- `PaintingStepMaterial` ganha `kind: MATERIAL | MAO_DE_OBRA | SERVICO | EQUIPAMENTO` e
  `crewSize` (a mão de obra vira linha real e editável, e o custo passa a multiplicar pelo
  número de pessoas — corrige §1.2 último item).
- Grupos vazios não aparecem. Passo sem material nenhum (ex.: desmontagem) mostra só o grupo
  MÃO DE OBRA — nunca um cabeçalho "Material" com corpo vazio, como no print atual.

---

## 8. Mudanças de schema

### 8.1 Enum `PaintingStepKind` — acrescentar
`DESMONTAGEM`, `REMONTAGEM`, `PREPARACAO`, `SECAGEM`, `MASCARAMENTO`, `LIMPEZA_TETO`,
`PINTURA_TETO`. (Manter os atuais; `MASCARAMENTO_LIQUIDO` vira sub-tarefa de `MASCARAMENTO`.)

### 8.2 Tabelas novas
- `PaintingStepTask` — sub-tarefas do passo (`label`, `minutes`, `minutesSource`, `rateKey`,
  `basisQuantity`, `basisUnit`, `position`).
- `PaintingPaintSystem` — §4.2.
- `PaintingElement` — elementos por face (`faceId`, `engineId`, `label`, bbox, área,
  `regionIds`, `labelSource`) para que o rótulo editado pelo usuário sobreviva ao
  reprocessamento (mesma doutrina do `engineId`).

### 8.3 Campos novos
- `PaintingAnalysis`: `implementKind`, `hasThermoKing`, `rearDoorCount`, `paintSystemKey`,
  `targetPaintId`, `paintsRoof` + as medidas digitadas de §2.1 (`lengthCm`, `heightCm`,
  `widthCm`, `roofLengthCm`, `roofWidthCm`, `chassisLengthCm`, `frameCount`,
  `framePerimeterCm`).
- `PaintingStepMaterial`: `kind`, `crewSize`, `basis` (`AREA|LINEAR|VOLUME|UNIT|TIME`).
- `PaintingProductivityRate`: `crewSize` (default 1).
- Nova regra `MATERIAL_YIELD` (rules-as-data): rendimento por item
  (`{ itemId: { perM2 | perM | perUnit } }`) — mata todos os `Math.ceil(area/30)` do código.

---

## 9. Plano de execução

| Fase | Entrega | Depende de |
|---|---|---|
| 1 ✅ | Schema + migração `20260804180000_painting_v3_surface_program` + seed (5 sistemas, rendimentos, 11 taxas novas) | — |
| 2 ✅ | Builder do **Programa A** (`painting-surface-program.ts`, A1–A7) com a matemática de §4 | — |
| 3 | UI: tabela nova (§7) + página de passo com checklist de sub-tarefas + esquemático | fase 2 |
| 4 | Engine: estágio `elements` + contornos em cm + janelas por elemento | — (paralelo) |
| 5 | Builder do **Programa B** reescrito sobre elementos + camadas de visualização §6 | fases 3 e 4 |
| 6 | Composição A+B, verniz coletivo, orçamento final e PDF | fase 5 |

Cada fase fecha com o smoke (`smoke-painting-analysis.ts`) e com os pytest do engine.

---

## 10. Decisões

### Já decididas (2026-08-04)
1. **Colunas da tabela**: `Descrição | Qtd. | Un. | Valor unit. | Total`, agrupadas por
   MATERIAIS / MÃO DE OBRA / SERVIÇOS com subtotal (§7).
2. **Medidas**: digitadas no próprio orçamento, não vindas de `ImplementMeasure` (§2.1).
3. **Preparação**: uma página com checklist de sub-tarefas e uma única tabela (§A2).
4. **Catálise/diluição**: lógica **por sistema de pintura** (Laca, Acrílico, Poliéster, PU…),
   com esquema de demãos referenciando outro sistema para o fundo (§4.2).

### Ainda faltam (dados, não decisões de arquitetura)
5. Por sistema: proporção `tinta : catalisador : diluente`, rendimento da mistura pronta
   (m²/L), lote mínimo de preparo e tempo de cura.
6. Rendimento dos consumíveis de preparação: Intercap, Scotch Brite, Estopa de Pano,
   Lixa Hookit P220/P320, Desengraxante — quantos m² por unidade/litro.
7. Tempo de desmontagem por porta traseira e do aparelho Thermo King; confirmar se a
   **remontagem** (§A7) é cobrada.
8. Esquema de demãos do sistema **Laca puro** (assumido 2 + 2 até confirmar).
9. Tamanho da equipe (`crewSize`) por passo: pintura, aplicação de adesivo, empapelamento.
