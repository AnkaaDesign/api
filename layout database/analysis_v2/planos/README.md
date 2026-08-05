# Planos de produção gerados

Saída ponta-a-ponta do pipeline, arquivada para referência ao melhorar o motor.
Cada plano é um HTML **autocontido** (imagens embutidas como data URI) — abre no
navegador sem servidor e sem os arquivos de imagem ao lado.

| arte | fundo | o que exercita | plano | dados |
|---|---|---|---|---|
| BURES 2 · 8,40 × 2,45 m | chapa branca 68% | fita amarela, degradê, adesivo sobre chapa | [html](plano_BURES_2_8.40.html) | [json](plano_BURES_2_8.40.json) |
| 137 PESCADOS lateral · 8,75 × 2,45 m | **pintura geral** cinza 82% | corte manual (único T-T real), adesivo sobre geral curada | [html](plano_137_PESCADOS_lateral.html) | [json](plano_137_PESCADOS_lateral.json) |
| mar e rio · 7,86 × 2,45 m | **pintura geral** azul 45% | aerografia (polvo), fita, T-T dentro de logomarca | [html](plano_mar_e_rio.html) | [json](plano_mar_e_rio.json) |

### Demonstrativo reconstruído da BURES

[`orcamento_perfeito_BURES_2_8.40.html`](orcamento_perfeito_BURES_2_8.40.html)
é uma referência posterior, criada após a auditoria de 2026-08-05. Não é saída
do probe antigo: reconstrói o orçamento esperado com elementos físicos,
quantidades auditáveis, preços fictícios e cálculo comercial completo.

Principais diferenças do plano histórico:

- usa o comprimento explícito de **8,40 m**, e não 8,567 m inferidos da altura;
- recalcula a altura pelo aspecto original como **2,403 m**;
- separa área da forma, janela pulverizada, janela do adesivo e corte;
- aplica a folga confirmada de **8 cm** nas quatro folhas de vinil;
- mede **59,71 m** de corte de plotter e zero corte manual;
- trata a faixa com **17,64 m de fita amarela**, sem adesivo;
- conta o verniz pela união dos territórios (**15,465 m²**), sem sobreposição;
- representa os dois tons adicionais da rampa e uma operação final de esfumado;
- calcula tintas, mix 4:1:1, materiais, horas-pessoa, indiretos e margem;
- declara claramente quais preços e parâmetros comerciais são fictícios.

O HTML referencia o PNG original ao lado da base de layouts. As caixas visuais
usam um canvas travado na proporção original `9924:2838`. Isso é obrigatório:
quando a coluna do passo era esticada pela altura do texto, a imagem permanecia
centralizada e as caixas percentuais usavam a altura errada, criando uma falsa
folga vertical. A folga física de 8 cm é um conceito separado e continua nos
cálculos de material.

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
Os planos históricos usaram Qwen3-VL como ponte experimental. A análise
posterior em `PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` conclui que essa
ponte não precisa ser semântica: elementos físicos anônimos podem ser agrupados
por componentes conectados, adjacência, contenção, alinhamento, espaçamento e
estrutura compartilhada. IA deve ser opcional e não controlar geometria ou
custo.

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
