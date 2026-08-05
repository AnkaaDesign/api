# painting-vision

Passe semântico do motor de pintura: o `painting-engine` **mede** (regiões,
fronteiras, adesivo); este módulo **nomeia** (o que é cada elemento, onde está,
e o que há de errado com a arte). Plano em `../PAINTING_SEMANTIC_VISION_PLAN.md`.

Estado: **banco de provas**, não módulo de produção. Os probes existem para
decidir modelo e hardware com número medido em vez de palpite.

## Setup

Dois ambientes por necessidade — a pilha do `paddlepaddle` conflita com a do MLX:

```bash
uv venv --python 3.12 .venv         && uv pip install --python .venv/bin/python mlx mlx-vlm pillow huggingface_hub
uv venv --python 3.12 .venv-paddle  && uv pip install --python .venv-paddle/bin/python \
    paddlepaddle==3.2.1 --index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ --index-strategy unsafe-best-match
uv pip install --python .venv-paddle/bin/python "paddleocr[doc-parser]"
brew install ollama && brew services start ollama && ollama pull qwen3-vl:4b
```

Para o backend de nuvem: `export OPENROUTER_API_KEY=...` (nunca commitar).

## Uso

```bash
./run.sh judge  "../../layout database/AAN lateral.png"     # inventário + alertas
./run.sh detect "../../layout database/AAN lateral.png"     # caixas por elemento
./run.sh ocr    "../../layout database/AAN lateral.png"     # texto + posição
./run.sh chain  "../../layout database/AAN lateral.png"     # detect -> crop -> OCR

# na nuvem (30-50x mais rápido, ver §Medições)
probe/judge_qwen.py <img> --backend openrouter --model qwen/qwen3-vl-32b-instruct
probe/bench.py <img1> <img2> --only or-8b or-32b            # comparar modelos
```

## A arquitetura que sobreviveu aos testes

Não é um modelo fazendo tudo. São três passes com exigências diferentes:

```
arte 28 MP
   │
   ├─ reduzida a 1568 px ──► GROUNDING + JULGAMENTO (Qwen3-VL)
   │                          caixas normalizadas 0–1000 + alertas
   │                                    │
   └─ recorte na resolução ORIGINAL ◄───┘
              │
              └──► OCR (PaddleOCR-VL) ──► texto exato ──► regex classifica
```

**Por que o recorte é o ponto todo**: a arte reduzida a 1568 px cabe no modelo,
mas nessa escala um telefone de rodapé é borrão. O grounding acha *onde*, o
recorte volta ao original, e o OCR lê os pixels que o downscale tinha jogado
fora. Provado: numa arte de 11105 px, a caixa que o Qwen deu para "site" virou
um recorte que o PaddleOCR leu como `www.137pescados.com.b*`.

**O que regex resolve não vai para modelo nenhum.** Do texto do OCR:
`www.|\.com|\.br` → SITE; `\(?\d{2}\)?\s?9?\d{4}-?\d{4}` → TELEFONE; `@\w+` →
REDE_SOCIAL; `SIF|SISBI|ANTT` → SELO. Sobra o slogan, que é o caso difícil.

## Estágios visuais (`probe/render.py`)

O pintor não lê JSON. Cada estágio da análise vira uma imagem de um passo do
wizard:

```bash
.venv/bin/python probe/render.py <arte> --out passos/ [--elements elements.json]
```

| arquivo | o que mostra | onde entra no app |
|---|---|---|
| `01_original` | referência | abertura |
| `02_quantizado` | cores chapadas — o que o motor enxerga | revisão da paleta |
| `03_linhas` | contornos pretos grossos sobre branco | **vista de máscara/corte** |
| `04_elementos` | linhas + caixas da IA com rótulo | conferência do inventário |
| `05_fronteiras` | **vermelho = T-T**, verde = T-F | decide o mascaramento |
| `06_sessao_N` | cinza=mascarado, cor=entrando agora, branco=chapa | cronograma de pintura |

`05_fronteiras` é o estágio novo e o mais importante: só o vermelho gera
trabalho. Ver `../PAINTING_PRODUCTION_DOCTRINE.md` §1.

**Antialias inverte essa classificação** — sem o voto modal do `declutter()`,
a faixa intermediária de 1–3 px entre uma letra e a chapa vira cor própria, a
letra deixa de encostar no fundo e *toda* fronteira sai como T-T. Medido na AAN
lateral: 7 "cores" viraram 4 reais depois da limpeza, e o mapa saiu de
quase-tudo-vermelho para o correto.

## Medições (Mac mini M2, 8 GB unificados)

| passe | modelo | tempo | pico de memória |
|---|---|---|---|
| julgamento / grounding | qwen3-vl:4b (Ollama/Metal) | **110–175 s** | ~3,3 GB |
| julgamento | qwen3-vl-32b (OpenRouter) | **3–6 s** | — |
| OCR de recorte | PaddleOCR-VL-1.5 (MLX) | 7 s | 2,6 GB |
| OCR com detector | PaddleOCR-VL-1.6 (paddle CPU) | ~25 s/tile | — |

Artes: mediana 9924×2838 (28 MP), máxima 18085×3246 (58 MP). Downscale e
tiling não são otimização, são requisito — 58 MP dariam ~74 mil tokens de visão.

## Qualidade: 8B não basta para julgar

Contra a verdade conhecida das análises A–F (`layout database/analysis/`):

| arte | verdade | qwen3-vl-8b | qwen3-vl-32b |
|---|---|---|---|
| 2 amigos (lat. esq.) | espelhada | MIRRORED ✓ | MIRRORED ✓ |
| 2 amigos 15 (lat. dir.) | **não** espelhada | MIRRORED ✗ | limpo ✓ |
| Agrícola Premium | marca d'água | WATERMARK ✓ | WATERMARK ✓ |
| 137 PESCADOS traseira | cortada na borda | os 4 códigos ✗ | CROPPED ✓ |

O 8B não separa a lateral espelhada da correta **na mesma arte** e dispara todos
os códigos que o prompt lista — repetir, não julgar. O 32B acertou 4/4 e deixou
limpa a arte que estava certa. Também encontra mais elementos (7 vs 4).

Consequência de hardware: o 32B em Q4 ocupa ~18–19 GB e **não cabe em 16 GB**.
Uma placa de 16 GB roda bem o grounding e o OCR; o julgamento deveria ir para a
nuvem (uma chamada por arte, ~US$ 0,0002) ou exigir 24 GB.

Ressalva: o 32B também marcou `ART_CROPPED_AT_EDGE` em 2 artes onde a verdade
não foi verificada. Pode ser acerto (mockups cortam mesmo) — falta conferir.

## Custo na nuvem

As 66 artes, passe global completo: **US$ 0,036** no 32B (mais barato que o 8B,
que cobra mais pela entrada). O free tier do OpenRouter não tem Qwen3-VL e não
vale a pena perseguir por 3 centavos.

## Moondream 3: não roda aqui

Escolhido no plano pelas skills `detect`/`point`. Dois bloqueios independentes:

1. **O `mlx-vlm` descarta a cabeça `region.`** (`models/moondream3/moondream3.py:131`),
   que é justamente a que produz as caixas. Sob esse runtime ele vira só chat —
   sem o motivo de tê-lo escolhido.
2. A conversão `beshkenadze/moondream3-preview-mlx-4bit` é incompatível com o
   mlx-vlm 0.6.10: usa prefixos `vision.encoder.`/`text.model.` que o `sanitize`
   duplica. Com um shim que os desfaz ela carrega, mas gera `NaN`
   (`<|md_reserved_4|>`, logprobs nan). Sem contar os 5,42 GB contra um teto de
   5,46 GB no Metal desta máquina.

O papel dele foi absorvido pelo grounding do Qwen3-VL, que devolve caixas em
espaço 0–1000. Numa placa CUDA vale reavaliar: lá os pesos oficiais rodam em
torch com bitsandbytes e o `detect` funciona de verdade.

Para liberar os 5,4 GB: `rm -rf ~/.cache/huggingface/hub/models--beshkenadze--moondream3-preview-mlx-4bit`

## Armadilhas medidas (todas custaram tempo)

- **VLM sem imagem alucina com confiança.** Uma chamada onde eu esqueci de
  anexar a arte devolveu logomarca, slogan, site e telefone inventados, em
  formato perfeito. Qualquer wrapper precisa falhar se a imagem não subiu.
- **`think: False` não desliga o raciocínio** do qwen3-vl no Ollama 0.32.5. O
  texto vai para o campo `thinking` e consome o mesmo orçamento de tokens.
- **O contexto padrão do Ollama é 4096** e uma arte reduzida já ocupa ~2900.
  Sem `num_ctx` folgado a resposta sai vazia ou truncada no meio do JSON.
- **Metal e Ollama disputam os mesmos 8 GB.** Rodar MLX com o Qwen carregado dá
  `Insufficient Memory`. O `run.sh` descarrega antes de cada passo MLX.
- **O detector do PaddleOCR funde linhas vizinhas** — `@frigorifico3irmaos` veio
  colado a `(48) 3658-2724`. São dois elementos com estratégias de produção
  diferentes; `ocr_paddle.py` separa quando as linhas divergem de tipo.
- **O Qwen ignora o vocabulário** e devolve rótulos livres ("Website URL (AAN)").
  `LABEL_MAP` em `detect_qwen.py` normaliza.

## Validação pendente

As 66 artes com `analysis_A..F.md` são um conjunto anotado por especialista.
Meta antes de ligar em produção: recall ≥ 0,9 em LOGOMARCA/SITE/TELEFONE e zero
falso-negativo em `TEXT_MIRRORED` — é o alerta que evita replotar uma lateral.
Até agora foram testadas 6 artes, não as 66.
