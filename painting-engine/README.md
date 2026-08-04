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
