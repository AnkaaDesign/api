# Planos de produção gerados

Saída ponta-a-ponta do pipeline, arquivada para referência ao melhorar o motor.
Cada plano é um HTML **autocontido** (imagens embutidas como data URI) — abre no
navegador sem servidor e sem os arquivos de imagem ao lado.

| arte | fundo | o que exercita | plano | dados |
|---|---|---|---|---|
| BURES 2 · 8,40 × 2,45 m | chapa branca 68% | fita amarela, degradê, adesivo sobre chapa | [html](plano_BURES_2_8.40.html) | [json](plano_BURES_2_8.40.json) |
| 137 PESCADOS lateral · 8,75 × 2,45 m | **pintura geral** cinza 82% | corte manual (único T-T real), adesivo sobre geral curada | [html](plano_137_PESCADOS_lateral.html) | [json](plano_137_PESCADOS_lateral.json) |
| mar e rio · 7,86 × 2,45 m | **pintura geral** azul 45% | aerografia (polvo), fita, T-T dentro de logomarca | [html](plano_mar_e_rio.html) | [json](plano_mar_e_rio.json) |

**Altura 2,45 m é padrão** — o motor aceita `--reference-kind HEIGHT`, o que
resolve a escala das artes cujo nome não traz o comprimento (56 das 66).

## Como foram gerados

```bash
# 1. medição geométrica — o motor de produção
cd api/painting-engine
PYTHONPATH=src .venv/bin/python -m painting_engine.cli \
  --input "../../layout database/BURES 2 8.40.png" \
  --reference-kind TOTAL_LENGTH --reference-cm 840 \
  --out /tmp/bures_engine.json

# 2. semântica + rotas + passos (consome a saída acima, não reanalisa a imagem)
cd ../painting-vision
export OPENROUTER_API_KEY=...
.venv/bin/python probe/production.py /tmp/bures_engine.json \
  "../../layout database/BURES 2 8.40.png" --out /tmp/bures

# 3. página
.venv/bin/python probe/report_html.py --report /tmp/bures --out plano.html
```

## O que estes planos existem para provar

O `painting-engine` decompõe por **cor**; a produção decompõe por **elemento**.
A ponte é o Qwen3-VL: sem ele a faixa da BURES virava quatro etapas de
mascaramento por tom, em vez de uma passada de fita amarela.

O plano é derivado mecanicamente de `PAINTING_PRODUCTION_DOCTRINE.md`. Se um
passo sair errado, o erro está na regra ou na medição — nunca em julgamento
solto no meio do caminho. É por isso que valem como referência.

## O que ainda não é medido

Números escolhidos por mim, não calibrados com o dono. São os primeiros
suspeitos quando um plano sair estranho:

| valor | onde | o que decide |
|---|---|---|
| **55°** | `VERTICAL_DEG` | fita amarela × fita branca |
| **ΔE 16** | `GRADIENT_DELTA_E` | dois tons são a mesma tinta ou não |
| **1,6×** | filtro de região espalhada | descarta região mal atribuída a um elemento |
| **0,10 m²** | `AVULSO_MIN_M2` | piso abaixo do qual é sujeira de quantização |

Calibrados de verdade: **8 cm** de folga entre o corte do plotter e a borda do
adesivo, e **14 mm** de traço mínimo cortável à mão (9 marcações do dono, todas
"corto" — ainda sem nenhum "não corto", então o piso segue desconhecido).
