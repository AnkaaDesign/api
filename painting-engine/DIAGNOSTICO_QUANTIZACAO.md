# Diagnóstico — quantização de cores (`quantize.py`)

Caso de entrada: `layout database/137 PESCADOS lateral.png` (dezenas de triângulos
low-poly em azuis próximos) sai com **3 cores** e **1 fronteira tinta-tinta**.
Caso de contraste: `layout database/BURES 2 8.40.png` sai com **3 azuis** que na
verdade são **um degradê único**.

Tudo abaixo é medido. Comandos e scripts de prova no fim do documento.

---

## 1. Causa raiz

**O número de cores da paleta é decidido inteiramente por `_histogram_seeds`
(quantize.py:255-272), e esse seeder tem um piso algébrico de ΔE 10,0 entre
sementes. O k-means nunca cria um cluster que a semeadura não propôs, e o
`merge_delta_e = 6.0` nunca dispara porque 6,0 < 10,0.**

O piso vem de duas linhas:

```python
bin_size = 5.0                                              # quantize.py:256
local_max = ndi.maximum_filter(grid, footprint=np.ones((3,3,3)))  # :264-265
peaks = np.argwhere((grid == local_max) & (grid >= threshold))    # :267
```

Um filtro de máximo 3×3×3 sobre um grid de passo 5,0 L\*a\*b\* só deixa sobreviver
dois picos se eles estiverem a **≥ 2 bins** de distância em algum eixo — ou seja,
**≥ 10,0 unidades CIE76**. Qualquer par de tintas mais próximo que isso é
fisicamente impossível de semear: o pico menor é suprimido pelo maior vizinho.

### Números que comprovam

Censo de RGB exato na imagem original do 137 (fills vetoriais chapados, 99,5% dos
pixels em 9 valores exatos):

| RGB exato | % da imagem | L\*    | a\*   | b\*    |
|-----------|-------------|--------|-------|--------|
| `#aaacae` | 81,717      |  70,3  | -0,3  |  -1,3  |
| `#132149` |  6,766      |  13,9  |  9,6  | -26,8  |
| `#2c5ea3` |  3,069      |  39,9  |  7,5  | -42,2  |
| `#235393` |  2,613      |  35,3  |  7,2  | -39,9  |
| `#233d7a` |  2,386      |  27,0  | 12,3  | -37,8  |
| `#2769b4` |  1,445      |  44,0  |  6,3  | -45,7  |
| `#1d4785` |  1,272      |  30,5  |  8,9  | -39,0  |

- **ΔE do vizinho mais próximo entre esses fills: mín 5,0 / mediana 5,5.**
  Todos abaixo do piso de 10,0 → **nenhum par pode ser semeado separadamente.**
- Instrumentando o estágio: bins LAB ocupados **80**; bins acima do limiar de
  massa (600 px) **8**; picos que sobreviveram ao 3×3×3: **3**.
  **A supressão de não-máximo descartou 5 dos 8 bins densos (62%).**
- `k-means centers ANTES do merge: 3` → `DEPOIS do merge: 3`.
  **Zero fusões executadas.** O colapso dos azuis aconteceu **na semeadura**,
  não na fusão.

### O parâmetro `merge_delta_e` é, na prática, código morto

Varredura em **24 artes** da `layout database` (script `bound.py`):

```
OVER 24 ARTS: min pairwise seed dE = 10.00 (piso algébrico 10.00)
              total merges fired at merge_delta_e=6.0: 0
```

O mínimo observado bate exatamente no piso teórico e o merge disparou **0 vezes
em 24 artes**. Mexer em `merge_delta_e` — para cima ou para baixo — não muda
nada no caminho principal. (Ele ainda é usado dentro de
`_rescue_vector_zones`, quantize.py:190, onde continua válido.)

`_modal_cleanup` e `_absorb_small_regions` estão inocentes: rodam depois, sobre
uma paleta que já perdeu os azuis, e não podem inventar rótulos que não existem.

---

## 2. Por que sobre-separa na BURES e sub-separa no 137 — o mesmo mecanismo

O critério de identidade de cor do motor é **densidade num histograma LAB
global**. Isso é cego para a única coisa que distingue "duas tintas" de "um
degradê": a **distribuição espacial**. E, pior, a densidade LAB é o sinal
*invertido* para esse fim.

**137 (sub-separa)** — tinta chapada. Cada azul é um valor RGB exato, uma função
delta no espaço de cor. Seis deltas espaçadas de ~5 ΔE caem em bins **vizinhos**
do grid de passo 5,0. O filtro 3×3×3 vê uma vizinhança e elege **um** vencedor.
Massa alta, concentração perfeita, separação pequena → **suprimido**.
Resultado: 6 azuis reais → 2 sementes.

**BURES (sobre-separa)** — degradê. A rampa azul varre L\* de 8,2 a 31,8 (≈ 25 ΔE)
com densidade aproximadamente **uniforme** ao longo da linha. Uma linha uniforme
num grid de passo 5,0 com supressão 3×3×3 produz **um máximo local a cada ~2
bins** — isto é, o seeder *fabrica* sementes espaçadas de ~10 ΔE ao longo de
qualquer rampa longa o bastante. Foi exatamente o que saiu: `#014c89`, `#003064`,
`#001d49`, com ΔE 9,7 e 13,0 — **os espaçamentos são artefato do passo do grid,
não propriedade da arte.**

> Em uma frase: **o seeder não consegue resolver nada abaixo de 10 ΔE e inventa
> uma cor a cada 10 ΔE.** Arte chapada com tons próximos perde cores; degradê
> longo ganha cores falsas. Uma regra, dois erros opostos.

### O discriminante correto (medido, não palpite)

Se um cluster é **tinta chapada**, seus pixels na resolução ORIGINAL são
dominados por **um único RGB exato**. Se é **rampa**, não há valor dominante.
Chamo isso de **pureza modal** = `max(contagem de um RGB exato) / tamanho do cluster`.

Medido sobre 3.000.000 de pixels originais amostrados:

| Arte  | Cluster    | Pureza modal | Veredicto |
|-------|------------|--------------|-----------|
| 137   | `#aaacae`  | 0,997        | tinta     |
| 137   | `#132149`  | 0,967        | tinta     |
| 137   | `#2c5ea3`  | 0,981        | tinta     |
| 137   | `#235393`  | 0,951        | tinta     |
| 137   | `#233d7a`  | 0,990        | tinta     |
| 137   | `#2769b4`  | 0,992        | tinta     |
| 137   | `#1d4785`  | 0,977        | tinta     |
| BURES | `#ffffff`  | 0,997        | tinta     |
| BURES | `#ca7a00`  | 0,994        | tinta     |
| BURES | `#004c8a`  | 0,973        | tinta     |
| BURES | `#666666`  | 0,655        | tinta     |
| BURES | `#003063`  | **0,099**    | **rampa** |
| BURES | `#00295a`  | **0,120**    | **rampa** |
| BURES | `#003469`  | **0,110**    | **rampa** |
| BURES | `#001d49`  | **0,109**    | **rampa** |
| BURES | `#003f78`  | **0,105**    | **rampa** |
| BURES | `#001741`  | **0,100**    | **rampa** |

**Separação limpa: tintas 0,65–1,00; rampas 0,099–0,120.** Banda vazia entre
0,12 e 0,65 — quase uma ordem de grandeza. Nenhum ΔE consegue essa separação,
porque os dois casos se sobrepõem em ΔE (137 tem tintas reais a 5,0 ΔE; BURES tem
rampa falsa a 9,7 ΔE).

> Também testei **nitidez de interface** (ΔE/px na fronteira, normalizado por
> ΔE do par) como discriminante. **Falhou:** a BURES é uma rampa *ruidosa*, com
> gradiente local de 5–50 ΔE/px, indistinguível de uma borda vetorial. Registrado
> aqui para não ser retentado. A pureza modal é o sinal que funciona.

### Por que isso é dinheiro (doutrina §1, §7)

Cada par de cores **ambas não-brancas que se tocam** é uma fronteira T-T e vira
trabalho de mascaramento. Medido: o 137 sai hoje com **1 par T-T** e deveria sair
com **12**. É uma subestimativa de ordem de grandeza no item que a doutrina
identifica como "a medida que faltava". A BURES, no sentido oposto, cobra
mascaramento por 4 pares T-T entre tons de um degradê que na produção é **uma
única aplicação** (doutrina §7.2: degradê é resíduo de ajuste, não fronteira).

---

## 3. Patch proposto

Duas mudanças cirúrgicas. Nenhuma delas é "aumentar `merge_delta_e`" — provado
acima que esse parâmetro não participa da decisão.

### 3.1 `params.py`

```diff
     # --- quantization -------------------------------------------------------
     max_colors: int = 24              # cap for k-means centers
     min_peak_pct: float = 0.002       # histogram peak must hold >=0.2% of pixels
-    merge_delta_e: float = 6.0        # merge centers closer than this (CIE76)
+    merge_delta_e: float = 3.0        # merge centers closer than this (CIE76)
     min_region_cm2: float = 0.5       # regions smaller than this are absorbed
     aa_uncertain_delta_e: float = 14.0  # px farther than this from own center -> modal vote
+
+    # --- seeding (v3: resolve tons próximos, não fabricar tons em rampas) ----
+    seed_bin_lab: float = 2.0         # LAB histogram step (era 5.0 hardcoded)
+    seed_min_delta_e: float = 3.0     # raio de exclusão entre sementes
+                                      # (substitui a supressão 3x3x3)
+    seed_flat_grad_max: float = 1.0   # ΔE/px; só interiores chapados votam
+    seed_min_peak_pct: float = 0.0008 # massa mínima de um bin para virar semente
+
+    # --- pureza modal (tinta chapada x rampa) -------------------------------
+    flat_modal_min: float = 0.35      # abaixo disto o cluster é rampa, não tinta
+    flat_modal_sample_px: int = 3_000_000  # amostra na resolução ORIGINAL
```

Justificativa de cada número:

| Parâmetro | Valor | Por quê |
|---|---|---|
| `seed_bin_lab` | 2,0 | A menor separação real medida entre tintas é **5,0 ΔE** (137). O bin precisa ser ≤ metade disso para que duas tintas caiam em bins distintos. 2,0 dá margem. |
| `seed_min_delta_e` | 3,0 | É o novo piso de resolução, substituindo os 10,0. Fica **abaixo de 5,0** (as tintas reais sobrevivem) e **acima de 2,0·√3 ≈ 3,46… — na verdade logo abaixo**, o suficiente para que jitter de quantização de bin não parta um fill em dois. |
| `seed_flat_grad_max` | 1,0 ΔE/px | Medido: **94,2%** (137) e **95,3%** (BURES) dos pixels de trabalho ficam abaixo desse gradiente. Exclui bordas AA e ruído íngreme da votação, para que cores intermediárias de antialias nunca virem semente. |
| `seed_min_peak_pct` | 0,0008 | Com bins 4× menores e máscara de chapado, a massa por bin cai ~10×; 0,002 passaria a matar tintas legítimas. Só é seguro baixar porque **a pureza modal agora remove as sementes falsas** — o limiar deixa de ser o filtro de qualidade. A menor cor genuína recuperada no conjunto de teste (`#fbca30`) tem 0,04% da imagem. |
| `flat_modal_min` | 0,35 | Escolhido **dentro da banda vazia medida** (rampas ≤ 0,12; tintas ≥ 0,65): ~3× acima da maior rampa e ~2× abaixo da menor tinta. |
| `merge_delta_e` | 6,0 → 3,0 | Com o seeder novo o merge **passa a poder disparar**; em 3,0 ele só colapsa centros que o k-means fez convergir um sobre o outro. Precisa ser ≤ `seed_min_delta_e`, senão desfaz a semeadura. |

### 3.2 `quantize.py`

**(a) máscara de interior chapado** (nova, junto de `_grad_bands`):

```python
def _flat_interior(lab_work: np.ndarray) -> np.ndarray:
    """|∇LAB| em ΔE/px. Interiores de fills chapados; exclui AA e ruído."""
    g = [np.gradient(lab_work[:, :, c]) for c in range(3)]
    return np.sqrt(sum(gy**2 + gx**2 for gy, gx in g))
```

**(b) `_histogram_seeds` — remover a supressão 3×3×3** (quantize.py:255-272):

```diff
-def _histogram_seeds(lab: np.ndarray, params: EngineParams) -> np.ndarray:
-    bin_size = 5.0
+def _histogram_seeds(lab: np.ndarray, params: EngineParams) -> np.ndarray:
+    bin_size = params.seed_bin_lab
     mins = lab.min(axis=0)
     idx = np.floor((lab - mins) / bin_size).astype(np.int32)
     dims = idx.max(axis=0) + 1
     flat = np.ravel_multi_index((idx[:, 0], idx[:, 1], idx[:, 2]), dims)
     counts = np.bincount(flat, minlength=int(np.prod(dims)))
-    grid = counts.reshape(dims)
-
-    footprint = np.ones((3, 3, 3), dtype=bool)
-    local_max = ndi.maximum_filter(grid, footprint=footprint, mode="constant")
-    threshold = max(int(params.min_peak_pct * lab.shape[0]), 8)
-    peaks = np.argwhere((grid == local_max) & (grid >= threshold))
-    if peaks.size == 0:
+    threshold = max(int(params.seed_min_peak_pct * lab.shape[0]), 8)
+    dense = np.flatnonzero(counts >= threshold)
+    if dense.size == 0:
         return lab.mean(axis=0, keepdims=True)
-    order = np.argsort(grid[tuple(peaks.T)])[::-1]
-    peaks = peaks[order[: params.max_colors]]
-    return (peaks + 0.5) * bin_size + mins
+    # seleção gulosa por massa com raio de exclusão: dois fills a 5 ΔE
+    # sobrevivem; um bin a 1 ΔE do anterior (mesma tinta) não duplica.
+    order = dense[np.argsort(counts[dense])[::-1]]
+    seeds: list[np.ndarray] = []
+    for b in order:
+        c = (np.array(np.unravel_index(b, dims), dtype=float) + 0.5) * bin_size + mins
+        if seeds and float(delta_e76(np.array(seeds), c).min()) < params.seed_min_delta_e:
+            continue
+        seeds.append(c)
+        if len(seeds) >= params.max_colors:
+            break
+    return np.array(seeds)
```

**(c) portão de pureza modal** (novo, chamado depois do k-means):

```python
def _modal_purity(
    rgb_original: np.ndarray,
    centers: np.ndarray,
    params: EngineParams,
    rng: np.random.Generator,
) -> np.ndarray:
    """Fração do RGB exato dominante dentro de cada cluster, medida na
    resolução ORIGINAL (o downscale LANCZOS destrói os fills exatos).
    Tinta chapada ≈ 1.0; rampa ≈ 0.1."""
    orig = rgb_original.reshape(-1, 3)
    n = min(params.flat_modal_sample_px, orig.shape[0])
    sel = rng.choice(orig.shape[0], n, replace=False) if n < orig.shape[0] else slice(None)
    sample = orig[sel]
    assign = _assign_chunked(srgb_to_lab(sample), centers)
    code = (sample[:, 0].astype(np.int64) << 16) | (sample[:, 1].astype(np.int64) << 8) | sample[:, 2]
    purity = np.ones(centers.shape[0])
    for i in range(centers.shape[0]):
        m = assign == i
        size = int(m.sum())
        if size < 200:
            continue  # amostra insuficiente -> MANTÉM. Área é policiada por
                      # min_region_cm2, nunca por um piso de amostra de cor.
        purity[i] = np.unique(code[m], return_counts=True)[1].max() / size
    return purity
```

**(d) fio condutor em `quantize()`** (quantize.py:548-556):

```diff
     flat = lab_work.reshape(-1, 3)
-    candidates = np.flatnonzero(~photo_mask.reshape(-1))
+    # sementes vêm SÓ de interiores chapados fora de zonas fotográficas
+    gmag = _flat_interior(lab_work)
+    seed_pool = np.flatnonzero((~photo_mask & (gmag < params.seed_flat_grad_max)).reshape(-1))
+    if seed_pool.size == 0:
+        seed_pool = np.flatnonzero(~photo_mask.reshape(-1))
+    if seed_pool.size > _MAX_KMEANS_SAMPLES:
+        seed_pool = rng.choice(seed_pool, _MAX_KMEANS_SAMPLES, replace=False)
+
+    candidates = np.flatnonzero(~photo_mask.reshape(-1))
     if candidates.size == 0:
         candidates = np.arange(flat.shape[0])
     if candidates.size > _MAX_KMEANS_SAMPLES:
         candidates = rng.choice(candidates, _MAX_KMEANS_SAMPLES, replace=False)
-    centers = _kmeans(flat[candidates], params)
+    centers = _kmeans(flat[candidates], params, seeds=_histogram_seeds(flat[seed_pool], params))
+
+    # portão de pureza modal: clusters de rampa não são tintas.
+    purity = _modal_purity(rgb_original, centers, params, rng)
+    pure = purity >= params.flat_modal_min
+    if pure.any() and not pure.all():
+        # rampas são reabsorvidas: o k-means reconverge só sobre os centros puros
+        centers = _kmeans(flat[candidates], params, seeds=centers[pure])
+    elif not pure.any():
+        alerts.append({"code": "NO_FLAT_FILL_DETECTED", "severity": "WARNING",
+                       "message": "Nenhuma cor chapada detectada (arte rasterizada/JPEG?). "
+                                  "Paleta pode estar fragmentada — revisar manualmente."})
```

(`_kmeans` ganha um parâmetro opcional `seeds`; sem ele, comportamento atual.)

---

## 4. Evidência — protótipo rodado nas duas artes

Protótipo completo em `proto2.py` (fora do motor, **nenhum arquivo do engine
alterado**), aplicando exatamente os parâmetros da tabela acima.

### 137 PESCADOS lateral

```
ANTES  3 cores: #aaacae(82,2%) #14224a(6,9%) #275395(11,0%)          | pares T-T: 1
DEPOIS 7 cores: #aaacae(82,1%) #142149(6,8%) #2d5ea3(3,1%)
                #295491(2,9%) #233d7a(2,3%) #2769b4(1,4%) #1e4785(1,4%) | pares T-T: 12
       sementes 7 -> kmeans 7 -> rampas dobradas 0 -> FINAL 7
```

As 7 cores batem **uma a uma** com o censo de RGB exato da §1 (`#2d5ea3`↔`#2c5ea3`,
`#295491`↔`#235393`, `#1e4785`↔`#1d4785`, …). Nenhuma cor inventada, nenhuma
perdida. **T-T de 1 para 12.**

### BURES 2 8.40

```
ANTES  6 cores: #ffffff(68,3%) #ca7a02(13,4%) #014c89(13,0%)
                #003064(2,6%) #001d49(1,9%) #6c7075(0,8%)             | pares T-T: 4
DEPOIS 4 cores: #ffffff(68,1%) #01427c(17,5%) #ca7a02(13,4%) #6b7076(1,0%) | pares T-T: 2
       sementes 10 -> kmeans 10 -> rampas dobradas 6 -> FINAL 4
       dobradas: #002f61(0,10) #002656(0,12) #001e4a(0,11)
                 #00437f(0,10) #02396f(0,11) #00153f(0,10)
```

**Os três azuis viraram um só** (`#01427c`), como manda a doutrina: o degradê é
uma aplicação, não três tintas com fronteira entre si. Note que o protótipo
semeou *mais* centros que o motor atual (10 vs 6) e ainda assim entregou *menos*
cores — porque quem decide agora é a pureza modal, não o passo do grid.

### Regressão nas outras artes (mesma execução)

| Arte | Antes | Depois | T-T antes → depois | Leitura |
|---|---|---|---|---|
| 100FRONTEIRAS 15 lateral | 7 | 6 | 3 → 5 | dobrou `#9b9d9d` (cinza de sombra); demais idênticas |
| Aquarela lateral | 3 | 2 | 0 → 0 | dobrou 4 rampas azuis; arte é degradê de fundo |
| astutilog-sider PRETO | 7 | 9 | 13 → 21 | ver risco 1 |
| AGI SOLAR lateral | 8 | 5 | 6 → 1 | ver risco 2 |

---

## 5. Riscos

**1. Degradê "banded"/posterizado passa como tinta.** Em
`astutilog-sider PRETO lateral` o protótipo mantém uma escada neutra
(`#2c2c2b` L\*17 → `#464546` L\*29 → `#616163` L\*41 → `#7d7d7e` L\*53 →
`#87898b` L\*57 → `#a6a7a9` L\*69 → `#fafafa` L\*98). Cada degrau é um RGB exato,
então a pureza modal diz corretamente "chapado" — mas na produção pode ser um
degradê renderizado em bandas. **Sobe de 13 para 21 pares T-T (sobreprecificação).**
Atenuação: o motor atual erra na mesma direção (já mantinha 7 dessas), então o
patch **amplifica** um defeito existente, não cria um novo. Correção seguinte:
teste de **colinearidade em LAB + ordenação espacial** — degraus colineares e
espacialmente empilhados em ordem monotônica = banda de degradê.

**2. Halo aerografado vira cor única.** Em `AGI SOLAR lateral` os tons
`#5dafaf`/`#a5d4d9` (pureza 0,01) são dobrados no teal principal; T-T cai de 6
para 1. Se a oficina de fato aerografa esse halo, o patch **subprecifica**.
Atenuação obrigatória: ao dobrar uma rampa, **emitir a flag `DEGRADE`/`AEROGRAFIA`
na região hospedeira** (doutrina §7.2) em vez de descartá-la em silêncio — a
rampa deixa de ser fronteira T-T mas continua sendo trabalho.

**3. Arte rasterizada / JPEG.** Sem fills exatos, *todo* cluster lê como rampa e
a paleta colapsaria. O patch já traz o fallback (`if not pure.any(): manter tudo`)
mais o alerta `NO_FLAT_FILL_DETECTED`. Não há JPEG na `layout database` hoje —
risco latente, não observado.

**4. Custo.** O portão de pureza adiciona uma amostra de 3M pixels na resolução
ORIGINAL + conversão LAB por execução (a resolução de trabalho **não serve**: o
LANCZOS destrói os valores exatos). O seeder mais fino também eleva o k inicial
(137: 3→7; BURES: 6→10; astutilog: 7→19), encarecendo as iterações de k-means.

**5. Efeito a jusante nos preços.** Mais cores → mais regiões → mais fronteiras
em `regions`/`boundaries`/`classify`/`layout`. O 137 sai de 1 para 12 pares T-T:
o preço **vai mudar materialmente** e isso é o objetivo, mas exige revalidação
comercial antes de virar default. Os testes dourados em `tests/test_real_layouts.py`
afirmam `background.mode`, `coveragePct` e presença de zona fotográfica — **não**
o tamanho da paleta — então devem sobreviver sem re-baseline.

**6. `seed_min_peak_pct = 0.0008` sem o portão é perigoso.** Os dois itens do
patch são **acoplados**: baixar o limiar de massa sem a pureza modal enche a
paleta de cores de antialias. Não aplicar 3.2(b) sem 3.2(c).

---

## Reprodução

```bash
cd api/painting-engine
S=/private/tmp/claude-501/-Users-kennedycampos-Documents-repositories/705966f5-4319-4f15-9e78-6f214d949c61/scratchpad
D="../../layout database"

.venv/bin/python "$S/probe.py"    "$D/137 PESCADOS lateral.png" HEIGHT 245   # censo + estágios
.venv/bin/python "$S/purity.py"   "$D/BURES 2 8.40.png"         HEIGHT 245   # pureza modal
.venv/bin/python "$S/bound.py"    "$D"                                       # piso de 10 ΔE em 24 artes
.venv/bin/python "$S/baseline.py" "$D/137 PESCADOS lateral.png::HEIGHT::245" # motor atual
.venv/bin/python "$S/proto2.py"   "$D/137 PESCADOS lateral.png::HEIGHT::245" # patch prototipado
```
