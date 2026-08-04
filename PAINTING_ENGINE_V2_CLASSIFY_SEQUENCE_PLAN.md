# Motor de Pintura v2 — Classificação fotográfica e Sequenciamento de emblemas (spec)

> **Especificação de implementação — nada aqui está implementado.**
> Complementa `api/PAINTING_COST_ENGINE_PLAN.md` (v1). Escopo v2:
> 1. corrigir FALSO FOTOGRÁFICO (bandeira do Brasil 60×40 → aerografia, ERRADO);
> 2. sequência de mascaramento para emblemas multi-cor (verde → amarelo → azul; branco = reserva);
> 3. consumo de tinta/tempo pela JANELA retangular da sessão, não pela área vetorial;
> 4. manter a ordem global (não-se-tocam = mesma sessão; cura entre sessões que se tocam; verniz coletivo final).

Arquivos-alvo:
- Engine: `api/painting-engine/src/painting_engine/{quantize.py, classify.py, params.py, regions.py, boundaries.py, pipeline.py}`
- API: `api/src/modules/paint/painting-analysis/{painting-compute.service.ts, painting-analysis.service.ts}` + novo `painting-emblem.util.ts`
- Dados: `api/prisma/schema.prisma` (models `Painting*`), seed `api/src/scripts/seed-painting.ts`

---

## 0. Diagnóstico do bug da bandeira (por que v1 erra)

Cadeia exata do falso positivo (cada elo citado no código v1):

1. `detect_photo_zones` (`quantize.py:56-81`) conta **códigos de cor grosseiros distintos** (4 bits/canal → 4096 códigos) por tile de `photo_tile_px=24`. O antialiasing entre 4-5 cores chapadas saturadas gera dezenas de códigos intermediários por aresta; qualquer tile que cruze 2+ fronteiras passa de `photo_color_count=17`.
2. Fechamento/abertura morfológica (`quantize.py:73-74`) funde os tiles de borda num blob único cobrindo o emblema inteiro.
3. Bandeira 60×40 cm = 2400 cm² > `photo_min_area_cm2=1500` → o blob sobrevive ao filtro de área.
4. `quantize()` estampa `labels = -1` na zona (`quantize.py:381`) e a exclui do k-means → vira `Region` com `color_index=-1`.
5. `classify_regions` (`classify.py:82-83`) mapeia `color_index == -1` → `FOTOGRAFICO` incondicionalmente → `runStrategy` (`painting-compute.service.ts:151-153`) → `AEROGRAFIA_ARTISTICA`.

**Tese do conserto:** contagem de códigos por tile é proxy de "conteúdo contínuo", mas confunde *muitos códigos de AA ao longo de arestas duras entre poucas cores chapadas* com *tom contínuo real*. O discriminador correto é a tríade: (a) nº de cores REAIS baixo após quantização local; (b) histograma de gradiente sem massa na banda "suave" (fotografia sombreia; vetor é platô + degrau); (c) arestas duras dominantes.

---

## 1. Detector fotográfico v2 (`quantize.py` + `classify.py`)

Duas fases: **A — gate por tile** (recall; barata; roda onde a v1 rodava) e **B — verificação por zona** (precision; re-quantização local; só nas zonas candidatas). Demote conservador: uma zona só deixa de ser fotográfica quando os TRÊS critérios vetoriais valem simultaneamente.

### 1.1 Sinais novos (work res)

Sobre `L*` (CIELAB) da imagem de trabalho:

```
gy, gx = np.gradient(lab_l)            # diferenças centrais, unidade = L*/px
grad   = np.hypot(gx, gy)
FLAT = grad <  photo_grad_soft_min_l   # interior chapado
SOFT = soft_min_l <= grad < hard_min_l # rampa suave = assinatura de tom contínuo
HARD = grad >= photo_grad_hard_min_l   # degrau (aresta vetorial pós-AA)
```

Racional das magnitudes: interior chapado ≈ 0–0,5 L*/px; sombreamento fotográfico ≈ 0,8–6 L*/px em área extensa; aresta dura com AA de 1-2 px cruza ΔL* 30-60 em 2 px → ≥ 12 L*/px. JPEG ringing cai na banda SOFT mas colado nas arestas — por isso a Fase B não depende só de SOFT.

Por tile (mesma grade da v1): `distinct` (códigos grosseiros, inalterado), `soft_pct` (fração de px SOFT — vetorizável por reshape, igual ao truque atual dos tiles), e por zona: `hard_share = HARD/(HARD+SOFT)`.

### 1.2 Fase A — gate por tile (muda `quantize.py:68`)

```python
photo_tiles = (distinct >= params.photo_color_count) \
            & (soft_pct  >= params.photo_smooth_grad_pct)
```

É o requisito literal do dono: *tile-entropy só conta quando cores>limiar **E** gradientes suaves>limiar*. Bandeira em PNG limpo: `soft_pct` ≈ 3-8% → nem vira candidata. Fotografia: 30-70% → candidata como antes.

### 1.3 Fase B — verificação por zona (novo bloco após o filtro de área, `quantize.py:75-80`)

Para cada componente candidato remanescente (área ≥ `photo_min_area_cm2`):

1. Amostrar ≤ `photo_verify_sample_px` pixels LAB da zona.
2. **Quantização local**: seeds por `_histogram_seeds` + `_assign_chunked` (reuso; extrair a fusão de centros do `_kmeans` para helper `_merge_centers(centers, threshold)`), ≤ 8 iterações, teto de `photo_zone_max_colors + 4` centros, fusão ΔE < `merge_delta_e` (6).
3. Métricas da zona:
   - `real_colors` = nº de centros com participação ≥ `photo_zone_color_min_pct`;
   - `residual_pct` = fração de amostras com ΔE(centro próprio) > `aa_uncertain_delta_e` (14) — tom contínuo **não é explicável** por poucos centros chapados; num emblema vetorial o resíduo é só o AA (≈ perímetro × 2 px / área, tipicamente < 10%);
   - `hard_share` (§1.1) nos px da zona.
4. **DEMOTE (vira vetor)** ⇔
   `real_colors <= photo_zone_max_colors` **e** `residual_pct <= photo_zone_max_residual_pct` **e** `hard_share >= photo_zone_hard_edge_min`.
   Caso contrário a zona permanece fotográfica.
5. Auditoria: cada zona (mantida ou demovida) entra em `QuantizeResult.photo_zone_audit: list[dict]` → `artifact["photoZones"]` (`pipeline.py`, junto de `photoZoneAreaPct`): `{bboxCm, areaCm2, distinctMed, softPct, hardShare, realColors, residualPct, kept}`. Zona demovida emite alerta `VECTOR_EMBLEM_RESCUED` (INFO): "Zona X×Y cm com N cores chapadas e bordas duras — tratada como emblema vetorial (máscaras), não aerografia."

Pixels de zona demovida **voltam ao fluxo normal**: participam da amostragem do k-means global (`quantize.py:373-378`) e recebem label de paleta (não ficam −1). As 4-5 cores do emblema viram regiões `CHAPADA` comuns e seguem para S6 (fronteiras) e para o cluster de emblema (§2).

### 1.4 Pseudo-código consolidado

```python
def detect_photo_zones(rgb_work, lab_l, params, px_per_cm):        # assinatura muda: + lab_l
    distinct = per_tile_distinct_codes(rgb_work, params.photo_tile_px)   # v1, inalterado
    grad = np.hypot(*np.gradient(lab_l)[::-1])
    soft = (grad >= params.photo_grad_soft_min_l) & (grad < params.photo_grad_hard_min_l)
    hard = grad >= params.photo_grad_hard_min_l
    soft_pct = per_tile_mean(soft, params.photo_tile_px)                 # reshape, sem loop

    photo_tiles = (distinct >= params.photo_color_count) & (soft_pct >= params.photo_smooth_grad_pct)
    mask = expand_close_open_minarea(photo_tiles)                        # v1, inalterado

    audit = []
    labeled, n = ndi.label(mask)
    for comp in range(1, n + 1):
        zone = labeled == comp
        sample = sample_lab(lab_l_full=lab, zone=zone, cap=params.photo_verify_sample_px)
        centers = _merge_centers(_mini_kmeans(sample, k_cap=params.photo_zone_max_colors + 4),
                                 params.merge_delta_e)
        share = cluster_shares(sample, centers)
        real_colors = int((share >= params.photo_zone_color_min_pct).sum())
        residual_pct = float((delta_e76(sample, centers[assign]) > params.aa_uncertain_delta_e).mean())
        hard_share = ratio(hard[zone], soft[zone])
        vector_like = (real_colors <= params.photo_zone_max_colors
                       and residual_pct <= params.photo_zone_max_residual_pct
                       and hard_share  >= params.photo_zone_hard_edge_min)
        if vector_like:
            mask[zone] = False                                           # DEMOTE
        audit.append({... , "kept": not vector_like})
    return mask, audit
```

Em `quantize()` (`quantize.py:358+`): calcular `lab_work` ANTES da detecção (hoje vem depois, linha 371) e propagar `photo_zone_audit` no `QuantizeResult`.

### 1.5 Parâmetros novos (`params.py`, seção `--- photographic zones ---`)

| Param | Default | Papel / racional |
|---|---|---|
| `photo_grad_soft_min_l` | `0.8` | L*/px; abaixo = interior chapado (ruído de compressão fica fora da banda suave) |
| `photo_grad_hard_min_l` | `12.0` | L*/px; acima = degrau de aresta (AA de 1-2 px sobre ΔL* ≥ 25) |
| `photo_smooth_grad_pct` | `0.20` | gate da Fase A: fração mínima de px na banda suave para o tile contar como fotográfico |
| `photo_zone_max_colors` | `8` | ≤ isto de cores reais → suspeita vetorial (dono pediu 6-8; 8 cobre emblemas com contorno + sombra chapada) |
| `photo_zone_color_min_pct` | `0.03` | participação mínima para um centro contar como "cor real" (mata micro-clusters de AA) |
| `photo_zone_max_residual_pct` | `0.15` | resíduo máx. explicável por AA num vetor (bandeira ≈ 8%; foto com 8 centros ≥ 30%) |
| `photo_zone_hard_edge_min` | `0.5` | HARD/(HARD+SOFT) mínimo para "bordas duras dominantes" |
| `photo_verify_sample_px` | `20000` | teto de amostra da quantização local (Fase B custa ~ms por zona) |

Inalterados: `photo_tile_px=24`, `photo_color_count=17`, `photo_min_area_cm2=1500`, `aa_uncertain_delta_e=14`, `merge_delta_e=6`.

### 1.6 `classify.py`

Sem mudança de lógica: `FOTOGRAFICO` continua sendo `color_index == -1` (`classify.py:82`), que agora só existe em zonas **verificadas**. Duas adições pequenas:
- anexar ao dict de saída da região fotográfica as métricas da zona (`photoStats: {realColors, residualPct, hardShare}`) para a UI justificar "por que aerografia";
- `collect_edge_alerts` inalterado.

### 1.7 Calibração / validação

Rodar o corpus das 66 artes com `photoZones` ligado e revisar o audit em duas listas: **devem continuar FOTO** (morangos 2 Amigos, papaia Bahia Sul, emblema metálico Bismark — resíduo alto segura todos) e **devem demover** (bandeiras, emblemas vetoriais de frota). Caso-limite documentado: low-poly multicolor (arte 137) — `real_colors` ~10-14 mantém FOTO; se o dono quiser low-poly como recorte, o dial é `photo_zone_max_colors`.

---

## 2. Emblemas multi-cor: cluster + sequência de mascaramento

### 2.1 Insumos novos do engine (geometria; mudanças mínimas)

O algoritmo de negócio fica no compute (pedido do dono), mas precisa de 3 fatos geométricos que hoje se perdem:

1. **Origem do bbox em cm** — `Region` (`regions.py:18-35`) ganha `bbox_cm_origin: tuple[float, float] = (0.0, 0.0)` (x_cm, y_cm do canto sup-esq = `bbox[1]/px_per_cm`, `bbox[0]/px_per_cm`). Persistido em `PaintingRegion.bboxXCm/bboxYCm` (mapper `painting-analysis.service.ts:384-385`, ao lado de `bbox_cm`).
2. **Contenção** — `Boundary` (`boundaries.py:25-35`) ganha `containment: str = "NONE"` (`A_IN_B | B_IN_A`), calculado para `PAINT_PAINT` em `extract_boundaries` via shapely sobre os contornos já simplificados: `Polygon(region_a.contour).contains(Polygon(region_b.contour))` (exterior ring apenas — é exatamente a semântica "A envolve B"; `buffer(0)` como guarda de validade, skip se < 3 pts). Persistido em `PaintingBoundary.containment`.
3. **Identidade da reserva** — hoje a fronteira `WITH_BACKGROUND` descarta o id da região de fundo (`boundaries.py:191-204`, `b=None`). `Boundary` ganha `bg_region: str | None` = id da região RESERVA/fundo do outro lado. Persistido em `PaintingBoundary.bgRegionId` (engine id, como `regionAId`). É o que liga a **estrela branca** ao círculo azul.

Fallback para artefatos v1 (sem esses campos): derivar origem do bbox de `face.engineArtifact.regions[].bbox ÷ image.pxPerCmWork`, contenção por teste de bbox (`bboxB ⊂ bboxA` com folga 1 cm), reserva por `bbox ⊂ bbox` do membro. O util (§2.3) recebe os dois caminhos.

### 2.2 Tipos (novo `api/src/modules/paint/painting-analysis/painting-emblem.util.ts`)

```ts
export interface RectCm { xCm: number; yCm: number; widthCm: number; heightCm: number }
export type ReservedStatus = 'PAINTED_PREVIOUS' | 'PENDING_LATER' | 'RESERVA';

export interface EmblemRegionRef {
  regionId: string;            // id do banco (PaintingRegion.id)
  engineId: string;
  groupKey: string;            // paintId ?? `hex:${colorHex}` — MESMA chave do runPlan
  hex: string;
  areaM2: number;
  bbox: RectCm;
}

export interface EmblemSessionSpec {
  sequence: number;                       // 1-based dentro do cluster; sessões com janelas
                                          // disjuntas e sem precedência compartilham sequence
  groupKey: string;
  regionIds: string[];
  window: RectCm;                         // hull dos elementos da cor + EMBLEM_CLUSTER.marginCm
  windowAreaM2: number;                   // área do retângulo (base de consumo §3.4)
  elementAreaM2: number;                  // soma vetorial dos elementos da cor
  reserved: { regionId: string; status: ReservedStatus }[];  // o que fica sob adesivo na janela
}

export interface EmblemCluster {
  id: string;                             // `E${n}` (único por face)
  faceId: string;
  bbox: RectCm;
  memberRegionIds: string[];
  reservaRegionIds: string[];             // knockouts (estrela, filetes de fundo…)
  sessions: EmblemSessionSpec[];          // já ordenadas
  precedence: Array<[string, string]>;    // pares (groupKey antes, groupKey depois) p/ ordem global
  alerts: { code: string; message: string }[];
}

export interface EmblemRules {           // StrategyRule EMBLEM_CLUSTER
  minColors: number;                     // default 3
  maxBboxWidthCm: number;                // default 160
  maxBboxHeightCm: number;               // default 120
  marginCm: number;                      // default 5 (folga de janela p/ overspray)
}

export function detectEmblemClusters(input: {
  faceId: string;
  regions: EmblemRegionRef[];                        // só pintáveis (ver §2.3)
  reservas: EmblemRegionRef[];                       // kind RESERVA da face
  boundaries: Array<{ engineAId: string; engineBId: string | null; kind: string;
                      containment?: string | null; bgRegionId?: string | null; lengthM: number }>;
  rules: EmblemRules;
}): EmblemCluster[];
```

### 2.3 Detecção do cluster (pseudo-código)

```
nós      := regiões da face com kind ∈ {CHAPADA, TEXTURA, MICRO, DEGRADE}
            e strategy ∉ {NENHUMA, AEROGRAFIA_ARTISTICA}          // FOTOGRAFICO/RESERVA fora
arestas  := boundaries PAINT_PAINT entre nós                      // KEYLINE NÃO é aresta:
                                                                  // keyline = 2×T-F, cores não se tocam
comps    := componentes conexos(nós, arestas)
clusters := []
para cada comp:
    grupos := set(groupKey dos membros)
    se |grupos| < rules.minColors: continue
    bbox := união dos bboxes dos membros
    se bbox.widthCm  > rules.maxBboxWidthCm
    ou bbox.heightCm > rules.maxBboxHeightCm: continue            // composição grande segue a
                                                                  // economia normal (fita/cura por fronteira)
    reservas_do_cluster := reservas com bbox ⊂ bbox do cluster
                           e ligadas a um membro por boundary WITH_BACKGROUND(bgRegionId)
                           (fallback: só o teste de bbox)
    clusters.push(montar_cluster(comp, grupos, bbox, reservas_do_cluster))   // §2.4
```

Notas:
- "mutuamente adjacentes" do requisito = componente conexo do grafo de adjacência T-T; o teto de bbox é o que caracteriza *emblema* (a bandeira 60×40 passa folgado; uma lateral inteira com campos que se tocam não passa).
- Membros com strategy `AEROGRAFIA` (MICRO abaixo do recorte, DEGRADE) permanecem no cluster para fins de **ordem e reserva**, mas o passo de tinta deles continua AEROGRAFIA (§3.3).
- Cluster por face; não há emblema multi-face.

### 2.4 Ordenação das sessões (pseudo-código)

```
// 1. agrupar membros por groupKey
porGrupo := groupKey -> { regions[], areaM2 = Σ, hull = união dos bboxes }

// 2. DAG de contenção: quem contém pinta primeiro
para cada boundary PAINT_PAINT interna com containment != NONE:
    outer := lado continente; inner := lado contido
    dag.addEdge(groupKey(outer) -> groupKey(inner))               // dedup; cadeias transitivas
                                                                  // (verde→amarelo→azul) emergem
                                                                  // das arestas par-a-par
se dag tem ciclo: remover a aresta de menor lengthM somado + alert EMBLEM_ORDER_CONFLICT

// 3. ordem: topológica (Kahn); empate entre disponíveis = maior areaM2 primeiro
ordem := kahn(dag, tieBreak = areaM2 desc)                        // ex.: [verde, amarelo, azul]

// 4. janelas e fusão de sessões (não-se-tocam = mesma sessão, versão intra-emblema)
seq := 0
para cada grupo em ordem:
    window := expand(porGrupo[grupo].hull, marginCm)
    // funde com a última sessão emitida sse: sem caminho no DAG entre os grupos
    // e janelas retângulo-disjuntas (janela contida em janela = conflito de máscara,
    // mesmo sem adjacência vetorial!)
    se pode_fundir(última_sessão, grupo): sequence := seq
    senão: seq += 1; sequence := seq
    emitir EmblemSessionSpec {
        sequence, groupKey: grupo,
        window, windowAreaM2: área(window),
        elementAreaM2: porGrupo[grupo].areaM2,
        reserved: reservas_na_janela(grupo, window)                // §2.5
    }

// 5. precedência exportada p/ ordem global (§3.2): cadeia entre sequences consecutivas
para i em 1..seq-1:
    para (a em grupos[sequence=i], b em grupos[sequence=i+1]): precedence.push([a, b])
```

O ponto sutil do passo 4: dentro de um emblema o conflito é por **sobreposição de janelas**, não por adjacência vetorial. Verde e azul da bandeira não se tocam, mas a janela do azul está DENTRO da área que a máscara do verde cobre — uma única camada de adesivo não pode ao mesmo tempo tapar o losango (sessão do verde) e abrir o círculo (sessão do azul). O teste retângulo-disjunto captura isso sem geometria cara.

### 2.5 Lista de reserva por sessão

Para a sessão de cor C (sequence i):

```
reserved(C) :=
    membros de grupos com sequence > i  cuja bbox ∩ window        -> PENDING_LATER
  ∪ membros de grupos com sequence < i  cuja bbox ∩ window        -> PAINTED_PREVIOUS
  ∪ reservaRegionIds do cluster         cuja bbox ∩ window        -> RESERVA
```

Exemplo bandeira — sessão do amarelo: verde `PAINTED_PREVIOUS` (cantos do campo dentro da janela do losango), azul `PENDING_LATER`, estrela `RESERVA`. É exatamente "a lista do que fica reservado em adesivo" pedida, com o status certo para descrição do passo e overlay.

### 2.6 Passos gerados por sessão de emblema (consumidos no §3.3)

Por `EmblemSessionSpec` (na sessão global onde o grupo caiu):

| # | kind | quantidade | materiais / observação |
|---|---|---|---|
| 1 | `ADESIVO_PLOTAGEM` | m lineares das bandas da janela | adesivo = `windowAreaM2` (o blank da máscara é o retângulo); máscara transferência = `windowAreaM2 / 0.6` m |
| 2 | `ADESIVO_DEPILACAO` | `windowAreaM2` | `extraMinutes += (ilhas dos membros + |reserved|) × WEED_MIN_PER_ISLAND` — cada reserva é uma ilha de depilação |
| 3 | `ADESIVO_APLICACAO` | `windowAreaM2` | (+ `LIXAMENTO` das janelas se isoplastic, como hoje) |
| 4 | `PINTURA` (ou `AEROGRAFIA` p/ membros com essa strategy) | `windowAreaM2 × demãos` | litros por `windowAreaM2` (§3.4); título "Pintar {cor} — emblema E1 (2/3)" |
| 5 | `CURA` | — | `waitMinutes = CURE_WAIT_MIN` (180); emitido pelo mecanismo de cura entre sessões globais já existente — sessões de emblema SEMPRE caem em sessões globais distintas e consecutivas-ordenadas (§3.2), então a cura sai de graça |
| 6 | `REMOCAO_MASCARA` | `windowAreaM2` | antes do `ADESIVO_APLICACAO` da sessão seguinte do MESMO cluster; a da última sessão fica para a remoção global final |

Bandas da janela: reimplementação TS trivial de `_cover_height` (`masks.py:36-68`) — `coverHeightCm(heightCm, ADHESIVE_WIDTHS_CM)`; m lineares por banda = `window.widthCm/100 + 2×marginAdesivoM`.

### 2.7 Exemplo numérico (bandeira 60×40, proporções oficiais; ilustrativo)

| Sessão | Cor | Elemento (vetorial) | Janela (hull+5 cm) | Reservado em adesivo |
|---|---|---|---|---|
| 1 | verde | 0,166 m² (campo − losango) | 70×50 = **0,350 m²** | losango inteiro (amarelo `PENDING_LATER`) |
| 2 | amarelo | 0,040 m² (losango − círculo) | 59,8×39,8 ≈ **0,238 m²** | verde `PAINTED_PREVIOUS`, azul `PENDING_LATER`, estrela `RESERVA` |
| 3 | azul | 0,034 m² (círculo − estrela) | 31×31 ≈ **0,096 m²** | amarelo `PAINTED_PREVIOUS`, estrela `RESERVA` |

Litros do verde: janela 0,350×2demãos/6×1,2 ≈ **0,14 L** vs vetorial 0,166→0,066 L — a janela reflete o overspray real dentro do retângulo mascarado. Verniz: 1 passo coletivo final (§3.5).

---

## 3. Mudanças em `painting-compute.service.ts`

### 3.1 `runStrategy` (linhas 132-229) — detectar, persistir e forçar resoluções

Após o loop de boundaries (linha ~227), por face:

```
clusters := detectEmblemClusters({regions, reservas, boundaries, rules: EMBLEM_CLUSTER})
para cada cluster:
  - PaintingRegion dos membros:            emblemClusterId = cluster.id
  - PaintingBoundary internas ao cluster:  emblemClusterId = cluster.id;
      se resolutionSource != MANUAL: resolution = CURA_ADESIVO, cutLengthM = 0, tapeLengthM = 0
        (a divisa vira sequência de máscaras; nunca fita/corte dentro de emblema)
limpar emblemClusterId de regiões/boundaries que saíram de cluster (recomputação idempotente)
```

`groupKey` usa `paintId ?? hex` — disponível pós-MATCH; STRATEGY já roda depois de MATCH no fluxo default (`compute()` linhas 20-33).

### 3.2 `runPlan` — precedência na atribuição de sessões (substitui linhas 373-393)

Novos insumos antes do greedy: `clusters` re-derivados pelo util (determinístico) a partir das tags persistidas + `precedencePairs` (§2.4 passo 5). Duas mudanças no grafo:

1. **Conflitos extras por janela**: além dos `conflictPairs` atuais (T-T entre grupos, linhas 347-371), adicionar conflito entre `groupKey` de uma sessão de emblema e qualquer OUTRO grupo com membro standalone cuja bbox intersecta a janela — um elemento alheio dentro do retângulo mascarado não pode ser trabalhado na mesma sessão.
2. **Greedy topológico** (extraído para `assignSessions(groups, conflictPairs, precedencePairs)` no util, para teste puro):

```
topoDepth := longest-path no DAG de precedência (0 p/ grupos livres)
ordem     := artistic por último; depois topoDepth asc; depois areaM2 desc   // mantém "fundo antes do detalhe"
para grupo em ordem:
    base := 1 + max(session[p] para p em predecessores(grupo); default -1)
    s := primeiro índice >= base sem conflictPair com os grupos já na sessão
    (criar sessões novas se preciso); session[grupo] = s
```

Propriedades preservadas (requisito 4): cores que não se tocam continuam colapsando na mesma sessão (conflitos inalterados fora de emblema); o passo `CURA` entre sessões (linhas 799-813) permanece como está — e cobre a cura entre sessões de emblema, que por precedência estrita nunca compartilham sessão.

### 3.3 `runPlan` — montagem de passos (linhas 588-814)

Por grupo na sessão: particionar `group.regions` em `standaloneRegions` (sem `emblemClusterId`) e `emblemSessions` (specs §2.2 do grupo). Os blocos existentes (ADESIVO_* 616-667, STENCIL 669-685, FITA/CORTE 687-731, PINTURA 763-780, AEROGRAFIA 781-795) passam a operar **só sobre standaloneRegions**; em seguida, para cada `EmblemSessionSpec` do grupo, emitir o bloco §2.6 com `session = sessionIndex` e `emblemMeta` preenchido. FITA/CORTE nunca aparece para boundaries com `emblemClusterId` (resolução já forçada em §3.1; o filtro atual por `FITA_*` já os ignora).

### 3.4 Consumo por JANELA (requisito 3)

Regra nova `PAINT_CONSUMPTION_BASIS { basis: 'WINDOW' | 'ELEMENT', capRatio: 3 }` (default `WINDOW`).

- **PINTURA (mascarada, standalone)**: `windowAreaM2 := Σ adhesive_area_m2` dos `paintRegions` (o engine JÁ calcula o retângulo em bandas com split de vãos > 40 cm — `masks.py:71-127`, lido em `adhesiveByEngineId`, linhas 598-614); fallbacks por região: STENCIL `area×1.2`, sem artefato `area×1.4`. Clamp: `windowAreaM2 = min(windowAreaM2, capRatio × elementAreaM2)`.
  Mudanças pontuais: no draft PINTURA (linhas 763-780) `quantity = windowAreaM2 × coats` (era `paintArea × coats` → **minutes** muda junto, mesma taxa `PAINT_COAT_M2_PER_MIN`) e `liters = this.paintLiters(windowAreaM2, coats, process)` (era `paintArea` → **paintLiters** muda pelo argumento; assinatura intacta, `painting-compute.service.ts:990-998`).
- **PINTURA (sessão de emblema)**: `windowAreaM2` = retângulo da sessão (§2.2), mesmas fórmulas.
- **AEROGRAFIA em máscara** (linhas 781-795): litros pela janela (overspray idem); `quantity`/minutos permanecem pela área do elemento (tempo de aerografia é limitado pelo desenho, não pelo retângulo).
- **AEROGRAFIA_ARTISTICA, pintura geral, FUNDO, VERNIZ**: sem mudança de base.
- **Persistência no step (ambos os valores, requisito explícito)**: todo step de PINTURA/AEROGRAFIA/ADESIVO_*/REMOCAO_MASCARA ligado a máscara grava `windowAreaM2` e `elementAreaM2`; steps de emblema gravam também `emblemMeta`. No mapeamento `stepsData` (linhas 892-937) os drafts ganham os campos e os repassam.

Campos novos em `StepDraft`: `windowAreaM2?`, `elementAreaM2?`, `emblemMeta?: { clusterId; sequence; sequenceCount; window: RectCm; reserved: {regionId; status}[] }`.

### 3.5 O que NÃO muda (requisito 4)

- Grupos = 1 cor de tinta (linhas 302-344); cores que não se tocam colapsam na mesma sessão.
- `CURA` entre sessões consecutivas (799-813).
- `REMOCAO_MASCARA` global (817-829) — apenas soma as janelas finais de emblema.
- **Verniz coletivo final** (831-849) para laca/poliéster, base vetorial (o verniz cobre a arte, não a janela); emblemas demovidos são laca ⇒ entram no mesmo verniz.

---

## 4. Migração de dados / params

### 4.1 Prisma (`schema.prisma`; migração `20260805000000_painting_engine_v2_emblem_sequencing`)

```prisma
model PaintingRegion {            // +3 (linha 7429)
  bboxXCm         Float   @default(0)
  bboxYCm         Float   @default(0)
  emblemClusterId String?
}
model PaintingBoundary {          // +3 (linha 7458)
  containment     String?         // A_IN_B | B_IN_A (padrão String? como dominantCurve)
  bgRegionId      String?         // engine id da região de fundo/reserva do outro lado
  emblemClusterId String?
}
model PaintingProductionStep {    // +3 (linha 7515)
  windowAreaM2  Float?
  elementAreaM2 Float?
  emblemMeta    Json?             // { clusterId, sequence, sequenceCount, window, reserved[] }
}
```

Sem backfill obrigatório: colunas novas nulas/zero são supridas pelo fallback do util via `face.engineArtifact` (§2.1). Opcional: script `src/scripts/backfill-painting-bbox.ts` lendo `engineArtifact.regions[].bbox`.

### 4.2 Engine

- `params.py`: 8 campos de §1.5 (o `from_dict` genérico já aceita override).
- `version.py`: `ENGINE_VERSION 0.1.0 → 0.2.0` (artefato ganha `photoZones`; campos novos em regions/boundaries são aditivos — artefatos velhos seguem legíveis).
- `pipeline.py`: propagar `photoZones`, `bbox_cm_origin`, `containment`, `bg_region` (asdict cobre os dataclasses).

### 4.3 Ingestão e schemas (API)

- `painting-analysis.service.ts:367-399` (region create): mapear `bbox_cm_origin` → `bboxXCm/bboxYCm`; `:401-420` (boundary create): `containment`, `bg_region` → `bgRegionId`; incluir `photoZones` no `engineArtifact` salvo (linhas 353-361).
- Zod (`api/src/schemas/painting-analysis.ts`) + espelho web: adicionar os campos novos com os NOMES EXATOS do Prisma (lição registrada: mismatch → strip silencioso). UI web (overlay da janela/sequência) é escopo seguinte; o contrato já sai daqui.

### 4.4 Seed (`api/src/scripts/seed-painting.ts`, bloco de rules ~linhas 137-155)

```ts
{ key: 'EMBLEM_CLUSTER',          label: 'Detecção de emblema multi-cor',
  params: { minColors: 3, maxBboxWidthCm: 160, maxBboxHeightCm: 120, marginCm: 5 } },
{ key: 'PAINT_CONSUMPTION_BASIS', label: 'Base de consumo da pintura mascarada',
  params: { basis: 'WINDOW', capRatio: 3 } },
{ key: 'ENGINE_PARAMS_OVERRIDE',  label: 'Overrides de parâmetros do engine (Fase A/B do detector etc.)',
  params: {} },
```

`ENGINE_PARAMS_OVERRIDE` fecha o ciclo rules-as-data para o detector: `painting-analysis.service.ts` faz merge desse Json no `paramsOverride` que já viaja ao engine via `--params-json` (`engine-runner.service.ts:66-67`) — calibração do detector sem redeploy. Seed é upsert por key: rodar `npm run seed:painting` após a migração.

---

## 5. Testes

### 5.1 Python (`api/painting-engine/tests`)

Fixtures novas no `conftest.py` (padrão das existentes; desenhar supersampled 4× com PIL e `resize(LANCZOS)` para gerar AA realista):

- `synthetic_vector_emblem`: bandeira fake 900×600 px = 60×40 cm (15 px/cm, referência `TOTAL_LENGTH`, 60.0): campo verde `#009C3B`, losango amarelo `#FFDF00`, círculo azul `#002776`, estrela branca 5 pontas (reserva) no círculo.
- `synthetic_emblem_on_plate`: chapa branca 600×200 cm com a mesma bandeira ao centro (o cenário exato do bug: emblema pequeno em face grande).
- `synthetic_photo_patch`: chapa branca + mancha 130×130 cm de tom contínuo (soma de 6 gradientes radiais aleatórios por canal + ruído suave) — controle anti-regressão.

Testes (`test_pipeline_synthetic.py` ou novo `test_photo_v2.py`):

1. `test_flag_alone_not_photographic` — `photoZoneAreaPct < 0.01`; nenhuma região `FOTOGRAFICO`; ≥ 3 regiões `CHAPADA` não-fundo; paleta contém verde/amarelo/azul (ΔE < 10 dos alvos).
2. `test_flag_on_plate_demoted_with_audit` — `artifact["photoZones"]` contém entrada `kept=False` com `realColors <= 8` e `residualPct <= 0.15`; alerta `VECTOR_EMBLEM_RESCUED` presente; regiões do emblema classificadas `CHAPADA`.
3. `test_photo_patch_still_photo` — zona `kept=True`; existe região `FOTOGRAFICO` com área ≈ mancha (±15%).
4. `test_containment_chain` — boundaries PAINT_PAINT verde↔amarelo e amarelo↔azul com `containment` apontando o lado contido; estrela: boundary `WITH_BACKGROUND` com `bg_region` = id da região da estrela.
5. `test_bbox_origin` — `bbox_cm_origin` coerente com `bbox ÷ px_per_cm_work` (tolerância 0,2 cm).
6. Unit da Fase A/B (`test_detect_photo_zones_unit`) — arrays construídos: mosaico 4 cores com AA sintético → máscara vazia; campo de ruído suave multicolor → máscara cheia.
7. Regressão: suíte atual (11 testes, incl. `test_real_layouts.py`) inalterada.

### 5.2 TypeScript (padrão tsx do repo — `api/tests/painting/emblem-sequencing.test.ts`, funções puras, sem DB)

Fixture tipada espelhando a bandeira (3 `EmblemRegionRef` + estrela reserva + 2 boundaries com containment + boundary de reserva com `bgRegionId`):

8. `detectEmblemClusters` — 1 cluster; membros corretos; estrela em `reservaRegionIds`; bbox 60×40.
9. Ordenação — sequences `[verde, amarelo, azul]`; janela do amarelo = bbox do losango + 5 cm; `windowAreaM2 > elementAreaM2` em todas; reservas da sessão do amarelo = verde `PAINTED_PREVIOUS`, azul `PENDING_LATER`, estrela `RESERVA`.
10. Fusão intra-emblema — variante com 2 cores de janelas disjuntas e sem DAG → mesmo `sequence`; variante janela-dentro-de-janela sem adjacência → sequences distintos (conflito de máscara).
11. Guarda de ciclo — 2 clusters com ordens conflitantes para o mesmo par de grupos → aresta de menor comprimento cai + `EMBLEM_ORDER_CONFLICT`.
12. `assignSessions` — precedência respeitada (verde < amarelo < azul), grupos livres que não se tocam colapsam, artistic por último; conflito por janela-sobreposta separa sessões.
13. Consumo — dado spec da sessão verde: PINTURA `quantity = 0.35 × coats`, litros de 0,35 m², step com `windowAreaM2 = 0.35` e `elementAreaM2 = 0.166`; clamp `capRatio` ativa com janela 4× elemento.

### 5.3 Smoke E2E

`npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/smoke-painting-analysis.ts "<bandeira.png>" 60` — verificar no plano: zero passos FITA/CORTE no cluster; ordem ADESIVO(E1 1/3)→PINTURA verde→CURA→REMOCAO_MASCARA→ADESIVO(2/3)→…→azul→VERNIZ único final; steps com `windowAreaM2`/`elementAreaM2`/`emblemMeta` preenchidos.

---

## 6. Riscos e decisões em aberto

1. **Low-poly/halftone multicolor** fica no fio da navalha `photo_zone_max_colors` — auditoria `photoZones` no corpus das 66 é o instrumento de calibração; decisão fica com o dono via `ENGINE_PARAMS_OVERRIDE`.
2. **`minColors: 3`** deixa pares de 2 cores no fluxo v1 (fita/cura por fronteira). Baixar para 2 estende janela+ordenação a qualquer par que se toca — mudança de comportamento ampla; decidir após rodar o corpus.
3. **Janela × elementos alheios**: o conflito por interseção de bbox (§3.2.1) é conservador (bbox ≠ forma); pode criar sessões a mais em layouts densos — aceitável (sessão extra é editável na UI; o inverso, máscara impossível, não é).
4. **JPEG pesado** pode inflar `soft_pct` de emblemas na Fase A; a Fase B é a rede (independe de SOFT). Se sobrar falso-foto, primeiro dial: `photo_zone_max_residual_pct` ↑ até 0,20.
5. **Reprocessamento** de análises em REVIEW preserva campos MANUAL (merge por engineId já existente em `painting-analysis.service.ts:317-334`); `emblemClusterId` é sempre AUTO/recomputado — override manual de cluster fica para v2.1 se houver demanda.
