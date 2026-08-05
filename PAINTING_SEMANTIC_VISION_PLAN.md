# Passe semântico de visão — escolha de modelo e integração

Complementa `PAINTING_COST_ENGINE_PLAN.md` §"QA semântico" e §120 ("detectores
especiais"). O engine determinístico **mede** (regiões, fronteiras, curvatura,
adesivo); este passe **nomeia**: o que é cada elemento e onde ele está.

Restrição de projeto: rodar local, numa **GPU de 8 GB**, sem depender de API paga
por arte.

---

## 1. Por que não é um modelo só

O que você pediu ("o que é e onde está a logomarca, o slogan, o site, os números")
são três problemas com estados-da-arte diferentes. Um VLM generalista faz os três
mal; três especialistas pequenos fazem cada um muito bem e, somados, **cabem em
8 GB**.

| Sub-problema | Exemplos nas suas artes | Ferramenta certa |
|---|---|---|
| **Texto: onde + o que diz** | `www.137pescados.com.br`, telefones do rodapé do 2 Amigos, "TRANSPORTADORA", micro-texto da bandeira | OCR-VLM com bbox |
| **Objeto sem texto: onde** | logomarca, bandeira do Brasil, selo SIF/SISBI, QR, bloco fotográfico (morangos), swoosh | detecção open-vocabulary |
| **Julgamento sobre a arte** | texto espelhado, marca d'água Shutterstock, logo de terceiro (frota agregada AAN), arte cortada na borda, substrato provável | VLM de raciocínio |

---

## 2. A pilha recomendada (cabe em ~5,5 GB, sobra folga p/ tokens de imagem)

### 2.1 Texto → **PaddleOCR-VL-1.6** (`PaddlePaddle/PaddleOCR-VL-1.6`)

- 0.9 B params (encoder nativo-resolução + ERNIE-4.5-0.3B), **~2 GB em FP16**, ~1 GB em INT8.
- **Apache-2.0** — sem pegadinha comercial.
- 96,33 % no OmniDocBench v1.6 (líder do grupo pequeno); 100+ idiomas, PT-BR nativo.
- A v1.5 adicionou **text spotting com bbox de forma irregular** — importante aqui:
  seu texto é curvo/inclinado (script manuscrito do 137 PESCADOS, "Frutícula 2 Amigos"),
  não linha de documento.

Cobre sozinho: site, telefone, @instagram, razão social, slogan, micro-texto de selo.

### 2.2 Objeto → **Moondream 3 (preview)** (`moondream/moondream3-preview`)

- MoE 9 B total / **2 B ativos** — roda rápido; quantizações GGUF disponíveis (llama.cpp, Ollama, LM Studio).
- Foi **feito** para isso: skills `detect` (bbox normalizada 0–1), `point`, `query`,
  saída estruturada. `moondream.detect(img, "company logo")` devolve caixas direto,
  sem parsing de texto livre.
- ⚠️ **Licença: BSL 1.1 + Additional Use Grant (No Third-Party Service)**. Uso interno
  no seu orçamento é permitido (uso comercial próprio é liberado). O que exige acordo
  com a M87 Labs é *vender acesso ao modelo* (API de visão, SDK pago embarcando os pesos).
  Seu caso está do lado permitido, mas registre a decisão.
- Alternativa 100 % Apache se você não quiser BSL: usar o Qwen3-VL (2.3) também para
  detecção — ele tem grounding 2D — trocando um pouco de precisão de caixa por licença limpa.

Cobre: logomarca, bandeira, selo, QR, bloco fotográfico, faixa refletiva.

### 2.3 Julgamento → **Qwen3-VL-4B-Instruct** (ou 8B, ver §4)

- **Apache-2.0**. 4B ≈ **3,5 GB em Q4**; 8B ≈ 6 GB em Q4 (DocVQA 96,1 / MMMU 69,6).
- Grounding 2D nativo, OCR em 32 idiomas, contexto 256 K.
- É quem responde a rubrica A–F: "esse texto está espelhado?", "isso é marca d'água?",
  "esse é um segundo logo de frota agregada?", "a arte está cortada na borda?".

**Total residente**: PaddleOCR-VL (2 GB) + Qwen3-VL-4B Q4 (3,5 GB) = **5,5 GB**, com
Moondream carregado sob demanda (ou servido em processo separado que sobe/desce).
Em 8 GB não tente manter os três em VRAM ao mesmo tempo com imagens grandes.

---

## 3. Os dois truques que mudam a viabilidade em 8 GB

### 3.1 Não peça detecção na arte inteira — **a geometria já propõe, o VLM só rotula**

Seu `regions.py` já entrega componentes conexos com contorno e bbox. Em vez de jogar
uma lateral de 15 m inteira no modelo e torcer, faça:

```
regions[] (engine)  →  agrupar regiões vizinhas em "candidatos a elemento"
                    →  crop de cada candidato (+10 % de margem)
                    →  VLM classifica o CROP: {kind, text?, confidence}
```

Um crop de 400×300 px é ~150 tokens de visão. A arte inteira em resolução nativa
pode passar de 10 000. Isso é a diferença entre 1 s e OOM. E a precisão sobe: o
modelo vê o elemento grande e isolado, não perdido num panorama 7:1.

O VLM sobre a imagem inteira fica só para as perguntas **globais** (espelhamento,
corte na borda, composição), em versão reduzida (~1 200 px de largura).

### 3.2 Espelhamento não precisa de IA

Sua validação mais cara (2 Amigos, CARLOTTI — 2× comprovado) sai de graça do OCR:

```python
score_normal   = ocr(img).mean_confidence_on_words
score_flipped  = ocr(img.transpose(FLIP_LEFT_RIGHT)).mean_confidence_on_words
if score_flipped > score_normal * 1.3: alert("TEXT_MIRRORED")
```

Texto espelhado destrói a confiança do OCR e o flip a restaura. Determinístico,
auditável, ~0 custo. O VLM só confirma o alerta.

Regra geral: **tudo que regex resolve, não mande pro modelo.** Do texto extraído
pelo OCR, classifique por padrão antes de perguntar qualquer coisa:
`www.|\.com|\.br` → SITE; `\(?\d{2}\)?\s?9?\d{4}-?\d{4}` → TELEFONE;
`@\w+` → INSTAGRAM; `SIF|SISBI|CRT|ANTT\s*\d+` → SELO_REGULAMENTAR.
Sobra pouco para o modelo decidir — e o que sobra é justamente o slogan
("Cultivando o melhor para você!"), que é o caso difícil.

---

## 4. Se você puder mexer no hardware

8 GB é o teto que aperta o **julgamento**, não a detecção. Com **12 GB** (RTX 3060 12G
é barata) você troca Qwen3-VL-4B por **8B em Q4** e ganha os ~2 pontos de MMMU e
1 de DocVQA que mais pesam justamente no raciocínio de rubrica. Se a GPU de 8 GB é
fixa, a pilha do §2 é a resposta e funciona.

---

## 5. Contrato de saída (pluga no artifact JSON existente)

Novo estágio `semantics`, no mesmo padrão dos outros (independente, ativável por
`--stages semantics`). Coordenadas em px **e** em cm via o `px_per_cm` já calculado —
assim o elemento semântico casa com a `region.id` que o engine mediu.

```json
"elements": [
  {
    "kind": "LOGOMARCA | SLOGAN | SITE | TELEFONE | REDE_SOCIAL | RAZAO_SOCIAL |
             SELO_REGULAMENTAR | BANDEIRA | QR_CODE | FOTOGRAFICO | ORNAMENTO |
             FAIXA_REFLETIVA | TERCEIRO",
    "text": "www.137pescados.com.br",
    "bbox_px": [x, y, w, h],
    "bbox_cm": [x, y, w, h],
    "region_ids": ["r12", "r13"],
    "confidence": 0.91,
    "source": "paddleocr | moondream | qwen3vl | regex",
    "notes": "fonte manuscrita — plotter, nunca fita"
  }
],
"semantic_alerts": [
  { "code": "TEXT_MIRRORED", "severity": "HIGH", "evidence": "ocr_flip_gain=2.4x" },
  { "code": "THIRD_PARTY_LOGO", "severity": "MEDIUM", "bbox_px": [...] },
  { "code": "WATERMARK", "severity": "HIGH", "notes": "padrão Shutterstock" },
  { "code": "ART_CROPPED_AT_EDGE", "severity": "HIGH" }
]
```

Mantém a doutrina do plano: **o passe semântico nunca altera números** — só cria
elementos rotulados e alertas que o usuário confirma ou dispensa.

Onde isso muda dinheiro (é o ponto todo): `kind` decide estratégia sem depender de
heurística de área. `SELO_REGULAMENTAR` e `QR_CODE` → adesivo impresso obrigatório.
`FOTOGRAFICO` → impressão digital. `TELEFONE`/`SITE` (texto fino <10 mm) → vinil
recortado, jamais fita. `TERCEIRO` → alerta de licença antes de plotar.

---

## 6. Como servir

Serviço FastAPI separado do `painting-engine` (o engine é NumPy puro e deve continuar
sem torch), exposto na mesma forma que o `service.py` atual e chamado pelo
`engine-runner.service.ts`:

```
api/painting-vision/          # novo, com torch/vllm
  ├─ ocr.py                   # PaddleOCR-VL
  ├─ detect.py                # Moondream 3 (lazy load)
  ├─ judge.py                 # Qwen3-VL-4B
  └─ service.py               # POST /semantics  → elements[] + semantic_alerts[]
```

Servir com **vLLM** (`--gpu-memory-utilization 0.45` por modelo) ou llama.cpp/Ollama
para os GGUF. Modelo carregado uma vez, não por job.

## 7. Validação — você já tem o gabarito

As 66 artes de `layout database/` com os relatórios `analysis_A..F.md` são um
conjunto de teste anotado por especialista. Antes de acoplar, rode os três modelos
sobre as 66 e compare com o inventário do item 3 de cada análise ("Inventário:
'1' verde + '00' em cápsulas... 'FRONTEIRAS' laranja..."). Meta mínima antes de
ligar em produção: recall ≥ 0,9 em LOGOMARCA/SITE/TELEFONE e zero falso-negativo
em `TEXT_MIRRORED` (é o alerta que evita reimprimir uma lateral inteira).
