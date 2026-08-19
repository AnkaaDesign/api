# painting-engine

Motor Python de análise de artes de pintura de implementos rodoviários — a metade
"geometria/visão" do plano `api/PAINTING_COST_ENGINE_PLAN.md`. Sem banco, sem
regra de negócio: mede e descreve; o NestJS decide e precifica.

## Setup

```bash
cd api/painting-engine
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest tests/ -q     # 11 testes (sintéticos + artes reais)
```

O NestJS invoca a CLI por job (`engine-runner.service.ts`). Overrides por env:
`PAINTING_ENGINE_PYTHON` (binário) e `PAINTING_ENGINE_DIR` (raiz do engine).

## Estágios (independentes, plano §3)

| Estágio | O que faz |
|---|---|
| `quantize` | zonas fotográficas (entropia) → k-means CIELAB com seeds por histograma → limpeza de antialias (voto modal) → **keylines em resolução ORIGINAL** → absorção de micro-regiões → classificação do fundo (chapa branca × pintura geral × ambíguo) |
| `regions` | componentes conexos por cor, topologia (ilhas = custo de depilação), contornos vetorizados (marching squares + Douglas-Peucker em cm reais), traço mínimo (medial axis) |
| `classify` | CHAPADA / DEGRADE (fit linear/radial de L*) / FOTOGRAFICO / MICRO / TEXTURA / RESERVA + alertas (arte cortada na borda, sombra de mockup, fundo ambíguo, ΔE baixo entre cores) |
| `boundaries` | grafo de adjacência; por fronteira: comprimento, histograma de curvatura (RETA/SUAVE/MEDIA/FECHADA/EXTREMA por raio em cm), cantos, tipo PAINT_PAINT × WITH_BACKGROUND × KEYLINE |
| `adhesive` | bandas horizontais de adesivo por região nas larguras úteis {50..120} cm, com quebra em gaps >40 cm, desperdício e metros de máscara de transferência (60 cm) |

## CLI

```bash
# análise completa
.venv/bin/python -m painting_engine.cli \
  --input "../layout database/AVGLOG lateral.png" \
  --reference-kind TOTAL_LENGTH --reference-cm 1470 \
  --out /tmp/analysis.json --overlay /tmp/overlay.png

# só a parte do adesivo (estágios independentes p/ refino)
... --stages adhesive --out /tmp/adhesive.json

# thresholds ajustáveis sem deploy
... --params-json '{"general_paint_pct": 0.75, "photo_color_count": 20}'
```

Também há um serviço FastAPI opcional: `.venv/bin/uvicorn painting_engine.service:app --port 8781`.

## `lineart` — gerador de risco (guia de marcação)

Módulo separado (`painting_engine.lineart`), mesma casa e mesmas dependências.
Enquanto o engine principal MEDE a arte para precificar, o `lineart` DESENHA o
guia que hoje é traçado à mão no Affinity do iPad.

```bash
.venv/bin/python -m painting_engine.lineart.cli \
  --input "arte.pdf" --mural-width-cm 1200 \
  --svg risco.svg --dxf risco.dxf --preview conferencia.png
```

`--mural-width-cm` é obrigatório e não é decoração: todo limiar do módulo está em
cm REAIS. "Não desenhe traço com menos de 25 cm" quer dizer a mesma coisa num
mural de 3 m e num de 30 m; em px não queria.

O estágio de instâncias precisa dos extras opcionais:

```bash
.venv/bin/pip install -r requirements-sam.txt   # torch + MobileSAM (Apache-2.0)
```

Sem eles o módulo **não quebra**: cai para separação por cor e diz isso em
`warnings[]` do relatório. `--no-instances` força esse modo de propósito.

### Estágios

| Estágio | O que faz |
|---|---|
| `instances` | MobileSAM (geração automática de máscaras) → mapa de OBJETOS. Máscara menor pintada por último, para objeto contido dentro de outro ter id próprio. Cacheado em disco |
| `posterize` | TV denoise (achata a foto) → objetos (instância, ou k-means CIELAB no fallback) → bandas de L* sobre um campo de tom **borrado por objeto** → absorção de micro-regiões → voto modal em disco que alisa as fronteiras |
| `texture` | tensor de estrutura sobre o sinal **passa-banda** → direção + coerência × energia. Região com score alto é "texturada" (nervura de folha, veio, pelo) |
| `strokes` | fronteira entre rótulos → dureza (percentil do gradiente da imagem ORIGINAL) → camada → reamostra/DP/Bézier |
| `edges` | Canny (degrau) + linha de centro de vinco (Hessiana multi-escala) → emenda de cadeias → contorno onde a segmentação não separa |
| `hatch` | streamlines uniformemente espaçadas (Jobard & Lefebvre) sobre o campo de orientação, cortadas por tom |
| `consolidate` | fusão final: mesma feição vista por duas fontes vira uma curva só; tracejado sob contorno sai |
| `export` | SVG (mestre), DXF R12 (CAD/plotter), PNG (conferência) |

### Três fontes de contorno, e por que precisa das três

Nenhuma sozinha dá conta:

- **Fronteira de região** dá a silhueta externa e o recorte entre cores.
- **Instância (SAM)** separa objetos de cores parecidas… até onde consegue. Nesta
  arte a maior máscara devolvida é 48% da imagem — o cacho inteiro. `crop_n_layers=1`
  custa 9× o tempo e não divide. Densidade de pontos também não resolve.
- **Aresta** é quem acha o vinco entre duas bananas do mesmo amarelo. Detector de
  degrau responde nos DOIS lados de uma faixa escura e sai linha dupla; a resposta
  de vale (Hessiana, γ-normalizada por σ²) marca o miolo. Sem a normalização por
  σ², escala grande perde a comparação e o vinco largo volta a sair duplo.

E o `consolidate` no fim porque as três enxergam a mesma feição de ângulos
diferentes e entregam curvas paralelas a 10-15 px.

### Medir antes de ajustar

`tools/bench_lineart.py` põe o risco gerado e um risco feito à mão no mesmo
canvas e devolve recall / precision / F1 mais um mapa de diferença (vermelho =
falta, azul = sobra):

```bash
.venv/bin/python tools/bench_lineart.py \
  --art "arte.pdf" --ref risco-a-mao.png --mural-width-cm 1200 --out /tmp/bench
```

Foi ele que mostrou onde estava o problema em cada rodada: as bandas de tom
saindo como ilha de curva de nível, o Canny picado em junções, a ocupação
amostrada esparsa demais para a deduplicação enxergar traço duplo.

Cuidado com o alvo: tinta da referência que cai fora do assunto da arte é
descontada. O `Banana Perboni.dwg` foi traçado de uma versão MAIOR da imagem —
tem folhas onde o PDF é branco — e pontuar contra elas mede recorte, não
algoritmo.

### As três camadas e a regra que as separa

É a leitura do risco feito à mão que dita a regra, não o contrário:

- **CONTORNO** (sólido) — fronteira com o fundo (silhueta do recorte) ou entre
  OBJETOS diferentes. É onde o pintor troca de tinta.
- **SOMBRA** (tracejado) — fronteira entre bandas de tom do MESMO objeto. É
  limite de degradê, não aresta; o tracejado avisa o pintor que ali é aerógrafo.
  Promovida a CONTORNO quando o gradiente é duro.
- **TEXTURA** (hachura) — dentro de região texturada a banda de tom NÃO vira
  traço. Curva de nível dentro de uma folha vira espaguete; quem descreve o
  interior é a hachura.

### Por que o SVG é do jeito que é

O destino é o Affinity no iPad, e isso restringe a saída:

- documento em **mm reais** (`width="12000.0mm"`), então medir dentro do Affinity
  dá a medida do mural;
- **curvas abertas com traço** (`fill="none"` + `stroke`), nunca formas
  preenchidas — pincel vetorial só se comporta em cima de curva com traço;
- tracejado é **estilo de traço** (`stroke-dasharray`), não geometria explodida:
  1 curva editável em vez de 40 riscos soltos (o DWG exportado do Corel tem
  1360 fragmentos que são só o dash de umas 30 curvas);
- um `<g id="...">` por camada, para chegar nomeado do outro lado;
- a arte entra embutida em `REFERENCIA` a 35% — é a camada que o pintor apaga
  depois de conferir.

### Desempenho e cache

MobileSAM roda em **CPU de propósito**: o gerador automático monta a grade de
pontos em float64 e o MPS não converte float64 — em Apple Silicon o caminho
`mps` quebra dentro da lib. `--sam-device mps` existe para reteste; qualquer
falha de device cai para CPU sozinha.

O mapa de instâncias é cacheado em `~/.cache/painting-engine/instances/`,
chaveado pelos pixels + parâmetros do SAM. Primeira passada ~60 s numa arte de
1500 px; ajustar traço, hachura ou grade depois disso custa ~10 s, porque só a
inferência é cara e ela não repete.

### Onde está hoje, medido

Contra o `Banana Perboni.dwg` (risco feito à mão no Affinity), tolerância 6 px em
canvas de 1500 px:

| | recall | precision | F1 |
|---|---|---|---|
| primeira versão | 0,764 | 0,734 | 0,749 |
| atual | 0,906 | 0,755 | **0,824** |

Por camada, quanto da tinta gerada não tem correspondente na mão: TEXTURA 17,6%,
CONTORNO 36%, SOMBRA 74%.

### Limites conhecidos

- **A linha de sombra continua no lugar errado.** A mão desenha o limite do
  degradê onde a FORMA vira; eu desenho onde a banda de tom troca. A forma da
  curva sai parecida, a posição erra ~2% da largura da arte. É a maior sobra que
  resta e não é ajuste de limiar — precisaria de leitura de forma, não de tom.
- **Fronteira suave entre objetos da mesma cor** (duas bananas claras encostadas,
  transição de dezenas de px) não acende no detector de aresta com limiar que não
  inunde o resto de ruído. Baixar `edge_high_percentile` foi testado: piora.
- O desenho sai ~35% mais denso que o da mão. `hatch_pitch_cm` é o botão: 7,5 cm
  traz para ~1,17× ao custo de 1,5 ponto de F1.
- `sam_work_px` (1024) faz a silhueta chegar com ~1 px de folga na resolução de
  trabalho. Para arte com detalhe fino, subir junto com `work_width_px`.

## Decisões de projeto

- **Escala**: a imagem nunca chega no tamanho real → uma medida de referência
  (comprimento total, altura...) vira `px_per_cm` e propaga para m², m lineares e cm de corte.
- **Moldura de mockup**: margens uniformes NÃO-brancas são aparadas no ingest
  (brancas nunca — podem ser a própria chapa e a escala mapeia o desenho do implemento).
- **Keylines** são detectadas em resolução plena ANTES do downscale (antialias fecha
  filetes de 1–5 px) e protegidas da absorção de micro-regiões.
- **Branco nunca é tinta**: o fundo (e reservas da cor do fundo) sai como `RESERVA`.
- Todos os limiares vivem em `params.py` e aceitam override por chamada — espelhados
  na tabela `PaintingStrategyRule` do banco para ajuste via UI.

## Saída (artifact JSON)

`engineVersion, image{px, cm, m²}, palette[{hex,lab,pixelPct}], background{mode,hex,coveragePct},
regions[{id,hex,kind,area_m2,perimeter_m,islands,min_stroke_mm,contour,holes,gradient,...}],
boundaries[{a,b,kind,length_m,curve_hist_m,dominant_curve,corners}],
adhesive[{region_id,bands[{width_cm,linear_m}],adhesive_area_m2,waste_m2,transfer_linear_m}],
alerts[{code,severity,message}], timingsSec`
