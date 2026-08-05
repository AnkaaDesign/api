# Diagnóstico — camada semântica (`probe/production.py`) na arte `mar e rio.png`

Arte: 9097×2837 px · 785,6 × 245,1 cm · **19,25 m²** · 11,58 px/cm
Fundo: `#2b5d8b`, modo `GENERAL_PAINT`, 44,95 % de cobertura
Motor: `eng_mar_e_rio.json` — 477 regiões, 10,60 m² fora do fundo
Modelo: `qwen/qwen3-vl-32b-instruct` via OpenRouter (~US$ 0,0002/chamada)

Nada foi alterado em produção. Todas as medições saíram de um harness paralelo
(`scratchpad/hx.py`, `run_variants.py`, `patch_test.py`, `robust2.py`) que
reimplementa `assign()` / agrupamento de `build_elements()` sem tocar no código.

---

## 1. Inventário: o que existe × o que foi detectado

### O que existe de fato (posições normalizadas, medidas nas regiões do motor)

| # | Elemento | x | y | Evidência no motor |
|---|---|---|---|---|
| 1 | Texto **"DESDE 2003"** (branco, bold) | 0,078–0,265 | 0,296–0,373 | 9 regiões `#fdfdfd`, 0,159 m² |
| 2 | Texto **"AINDA MAIS"** (branco) | 0,076–0,265 | 0,423–0,501 | 9 regiões `#fdfdfd`, 0,094 m² |
| 3 | Texto **"PERTO DE VOCÊ."** (branco) | 0,079–0,332 | 0,551–0,630 | 13 regiões `#fdfdfd`, 0,118 m² |
| 4 | **Logomarca Mar & Rio** — blob branco + miolo turquesa + peixe + placa branca `PESCADOS®`, tudo travado num contorno só | 0,372–0,656 | 0,063–0,743 | **`r193` = UMA região branca conectada de 1,299 m²** atravessa o conjunto inteiro; miolo turquesa `r32` 0,63 m²; letras `PESCADOS` em `#2b9cbc` |
| 5 | Site **`www.marleriopescados.com.br`** | ~0,37–0,66 | ~0,765–0,830 | regiões brancas finas |
| 6 | **Polvo mascote** (ilustração de tom contínuo) | 0,613–0,913 | 0,085–0,983 | `r477`, `kind=FOTOGRAFICO`, `#multi`, 1,791 m² → Aerografia |
| 7 | **Faixa/onda turquesa** + banda branca inferior direita | atravessa a peça | — | `r181` 1,62 · `r35` 1,39 · `r280` 0,76 · `r251` 0,74 m² |
| 8 | Campo azul-marinho (pintura geral) | — | — | `#2b5d8b`, `is_background` |

Os três textos da esquerda são **um bloco só**: mesma família, mesmo
alinhamento à esquerda, linhas consecutivas — na prática *um* adesivo de frase.

### O que a rodada do dono devolveu (`marerio/report.json`, 9 elementos)

| id | tipo | m² | bbox_norm | leitura |
|---|---|---|---|---|
| e6 | FAIXA | 3,46 | 0,000 0,270 0,999 0,975 | **caixa-aspirador**: metade inferior inteira da arte |
| e7 | ORNAMENTO | 2,72 | 0,552 0,041 0,915 0,997 | polvo + faixa |
| aero | AEROGRAFIA | 1,79 | — | `r477`, correto |
| **avulso** | **AVULSO** | **1,30** | 0,372 0,063 0,656 0,743 | **1 região só: `r193`, o branco da logomarca** |
| e3 | LOGOMARCA | 0,99 | 0,379 0,072 0,660 0,450 | metade de cima da logomarca |
| e0 | NOME | 0,16 | 0,075 0,296 0,268 0,375 | "DESDE 2003" |
| e4 | NOME | 0,11 | 0,379 0,450 0,660 0,572 | placa `PESCADOS` — metade de baixo da logomarca |
| e5 | SITE | 0,04 | 0,379 0,572 0,660 0,637 | fatia inferior da logomarca (nem é o site) |
| e2 | TAGLINE | 0,03 | 0,075 0,464 0,330 0,539 | 4 letras soltas de "AINDA MAIS" |

Há um buraco na numeração: **`e1` não aparece** — o Qwen devolveu uma caixa que
não capturou região nenhuma e sumiu sem aviso.

Faltam: "AINDA MAIS" (0,094 m²) e "PERTO DE VOCÊ." (0,118 m²) como elementos; e
a logomarca aparece **fatiada em 3 caixas + 1 órfão de 1,3 m²** — quatro peças
onde a produção recorta **uma**.

---

## 2. Causa de cada sintoma

Classificação pedida: (a) modelo não viu · (b) prompt não pediu direito ·
(c) normalização de rótulos · (d) atribuição região→elemento.

### Sintoma 1 — logomarca virou dois adesivos → **(b) prompt, com (d) como cúmplice**

**Não é (c).** Os `label_raw` da rodada crua são `"logomarca"`, `"logomarca"`,
`"nome da empresa"`, `"site"` — todos normalizam certo. `normalize_label` não
descartou nem fundiu nada.

**Não é (a).** O modelo enxergou; o que ele fez foi *cortar*.

**É (b).** O prompt de `semantic()` manda cortar, com todas as letras:

```
"Separe CADA bloco como um elemento próprio — o símbolo, o nome escrito
 e a linha descritiva abaixo dele são TRÊS elementos, não um."
```

O modelo obedeceu ao pé da letra. As três caixas que ele devolveu
(`e3` y 0,072–0,458 · `e4` y 0,458–0,576 · `e5` y 0,576–0,650) compartilham
**exatamente o mesmo x (0,379–0,660)** e são contíguas em y: não são três
elementos, são **três fatias horizontais de um retângulo só**. Essa assinatura
geométrica é a digital da instrução.

Prova cruzada: `probe/detect_qwen.py`, cujo prompt **não** tem essa frase,
devolveu na mesma arte duas caixas `logomarca` (blob e placa) e nunca a fatiou
em três. E as variantes B/C/D, que trocam a frase por uma regra de *lockup*,
caem para 2 caixas em 3/3 execuções.

**(d) é cúmplice.** Nem `assign()` nem `build_elements()` têm qualquer noção de
que **uma região de cor conectada não pode ser partida**. `r193` — 1,299 m² de
branco, uma peça só — atravessa as três caixas, e nada no código percebe. A
doutrina §3.0 é explícita: *"A máscara é aplicada inteira, não por cor. Uma
folha cobre o elemento todo"*. Cortar `r193` ao meio é cortar a própria chapa
de cor no meio — o plotter não tem como fazer isso.

O desempate registrado ("vence a MENOR caixa") **não** está envolvido aqui: as
três caixas não se sobrepõem, são disjuntas em y.

### Sintoma 2 — "ainda mais" e "perto de você" não detectados → **(b) prompt, executado por (d)**

**Não é (c).** `label_raw = "tagline"` → `TAGLINE`. Correto.

**Não é (a), e isto é o mais importante:** o modelo *devolveu* caixas para essas
linhas — ele só as colocou no lugar errado. Rodada baseline crua:

```
e1 tagline  [0,075 0,381 0,270 0,460]   ← cai no VÃO entre "DESDE 2003" e "AINDA MAIS"
e2 tagline  [0,075 0,466 0,330 0,545]   ← cai no VÃO entre "AINDA MAIS" e "PERTO DE VOCÊ."
```

As linhas reais estão em y 0,423–0,501 e 0,551–0,630. As caixas estão
deslocadas ~4 a 6 pontos para cima. O grounding vertical do Qwen se degrada
nesta arte porque ela é 3,2:1 e o `thumbnail((1400,1400))` de `semantic()` a
reduz a 1400×437 — cada linha de texto sobra com ~35 px de altura.

**A instrução de fatiar é a causa raiz também aqui.** Ela empurra o modelo a
emitir *uma caixa por linha* em vez de uma caixa pelo bloco. Caixa por linha é
a hipótese frágil: 35 px de altura, e errar por 20 px já esvazia a caixa. Uma
caixa pelo bloco inteiro tem 200 px de altura e tolera o mesmo erro sem perder
nada. O `detect_qwen.py` (sem a instrução, com `slogan` no vocabulário)
devolveu **uma única caixa** `[0,074 0,281 0,336 0,650]` cobrindo as três
linhas — certa.

**(d) transforma o desalinhamento em perda total.** Sem caixa de texto contendo
seus centroides, as letras caem no único candidato que sobra: a caixa `FAIXA`
`[0,000 0,270 0,999 0,975]`, que cobre a metade inferior da arte inteira. E
como a `FAIXA` é a única candidata, o desempate "menor caixa" nem chega a
rodar. Destinos medidos no baseline:

```
L1_DESDE_2003    9/9 regiões  →  {'NOME': 9}
L2_AINDA_MAIS    0/9 regiões  →  {'FAIXA': 9}        ← engolidas pela faixa
L3_PERTO_VOCE    1/13 regiões →  {'FAIXA': 12, 'TAGLINE': 1}
```

Não é que os textos "sumiram": eles foram **orçados como fita amarela**. Pior
que perder — vira rota errada.

"Desde 2003" sobreviveu porque é a primeira linha e ganhou caixa própria
(`e0 "nome da empresa"`) que por acaso pousou certo.

**Falha intermitente, não determinística.** Em 5 execuções do baseline medidas,
o texto foi recuperado em 2 e perdido em 3 (a rodada do dono entre elas). É por
isso que o defeito não aparece sempre.

### Sintoma 3 — AVULSO de 1,3 m² → **(d) atribuição, consequência direta do sintoma 1**

Medição direta: o grupo `avulso` tem **`nreg = 1`**, área 1,30 m², cor
`#fdfdfd`, bbox `[0,372 0,063 0,656 0,743]`. É `r193` — o branco da logomarca,
uma peça só. Não é ruído de quantização; é o **substrato do adesivo principal**.

O caminho até o lixo, passo a passo:

1. Centroide de `r193` = (0,516 · 0,490). Cai dentro da caixa `e4 NOME`
   (y 0,458–0,576) — a fatia do meio.
2. `build_elements()` aplica o guarda `cabe` (production.py:292):
   ```python
   cabe = ((rx1-rx0) <= (bx1-bx0)*1.6 and (ry1-ry0) <= (by1-by0)*1.6)
   ```
   Extensão vertical de `r193` = 0,680 da altura da arte. Caixa `e4` = 0,118.
   0,680 > 0,118 × 1,6 = 0,189 → **não cabe** → `gid = "avulso"`.
3. 1,30 m² > `AVULSO_MIN_M2` (0,10), então não é filtrado, e sai como
   "Adesivo — avulso" de 1,3 m², cor branca, sem dono.

O guarda `cabe` está **certo** e fez o que devia: ele existe justamente para
impedir que uma região espalhada estique a caixa do elemento. O que está errado
é o que ele recebeu — uma caixa que é 1/6 do elemento real. Com a logomarca
numa caixa só (y 0,070–0,733, altura 0,663), 0,680 ≤ 0,663 × 1,6 = 1,061 →
cabe, e o avulso desaparece. **Medido: 1,30 m² → 0,00 m².**

### Resumo

| Sintoma | Causa | Secundária |
|---|---|---|
| 1 · logomarca em dois adesivos | **(b)** instrução "são TRÊS elementos, não um" | **(d)** nada impede partir uma região conectada |
| 2 · "ainda mais" / "perto de você" perdidos | **(b)** mesma instrução força caixa-por-linha, frágil em 35 px | **(d)** caixa `FAIXA` gigante aspira os órfãos |
| 3 · AVULSO 1,3 m² | **(d)** `cabe` rejeita `r193` | consequência mecânica do sintoma 1 |

Nenhum dos três é **(a)** e nenhum é **(c)** *nesta arte* — mas a §4 registra
dois defeitos reais de `LABEL_MAP` que ainda não estouraram aqui.

---

## 3. Testes de prompt — 4 variantes, mesma arte, mesmo modelo

Métrica de texto = fração das regiões de cada linha que caem num elemento de
texto (`NOME`/`TAGLINE`/`SITE`/`TELEFONE`/`LOGOMARCA`/`OUTRO`), não em
`FAIXA`/`AVULSO`. Métrica de logo = nº de caixas fatiando o conjunto.

| variante | caixas no logo | DESDE 2003 | AINDA MAIS | PERTO DE VOCÊ | `r193` foi para | AVULSO |
|---|---|---|---|---|---|---|
| **A — produção hoje** | **3** (+FAIXA) | 9/9 | **0/9** | **1/13** | **AVULSO** | **1,77 m²** |
| B — regra de lockup | 2 | 9/9 | 9/9 | 12/13 | LOGOMARCA | 0,00 m² |
| **C — lockup + varredura de texto** | 2 | 9/9 | **9/9** | **13/13** | LOGOMARCA | **0,00 m²** |
| D — C + linguagem de adesivo | 2 | 9/9 | 9/9 | 13/13 | LOGOMARCA | 0,41 m² |

D perde para C porque a REGRA 4 ("caixa encosta nos limites reais, sem folga")
faz o modelo apertar as caixas de `FAIXA`/`ORNAMENTO` e sobra topo da onda
turquesa sem dono (0,41 m²).

### Vencedor — variante **C**

```python
prompt = (
    "Localize os elementos desta arte de baú de caminhão.\n"
    'Para cada um devolva {"bbox_2d":[x1,y1,x2,y2],"label":...}.\n'
    f"Rótulos possíveis: {', '.join(VOCAB)}.\n"
    "REGRA 1 — LOGOMARCA é o conjunto travado da marca. Se o símbolo, o nome "
    "e a assinatura dividem um mesmo contorno, placa ou fundo comum, é UMA "
    "logomarca só: UMA caixa envolvendo tudo, nunca uma caixa por parte.\n"
    "REGRA 2 — TEXTO: antes de responder, leia TODAS as palavras visíveis na "
    "arte. Nenhuma palavra pode ficar fora de alguma caixa. Linhas de texto "
    "vizinhas, com o mesmo estilo e alinhamento, formam UM bloco: uma única "
    "caixa cobrindo da primeira à última linha.\n"
    "REGRA 3 — FAIXA é listra ou onda longa que atravessa a peça, mesmo com "
    "degradê ou mais de um tom. A caixa da faixa NÃO deve engolir textos: "
    "textos sobre a faixa são elementos próprios.\n"
    "Não invente elementos. Responda SOMENTE a lista JSON."
)
```

As três regras trocam a única instrução perigosa por três que atacam
exatamente as três falhas: R1 mata o fatiamento do logo, R2 troca
caixa-por-linha por caixa-por-bloco, R3 desarma a caixa-aspirador da faixa.

### Repetibilidade (o baseline falha de forma intermitente)

5 execuções do baseline × 4 da variante C, mesma arte:

| | texto completo recuperado | AVULSO |
|---|---|---|
| A baseline | **2 de 5** | 1,30 – 1,77 m² |
| C | **4 de 4** | 0,00 m² (3/4) · 0,43 m² (1/4) |

### Regressão cruzada — `137 PESCADOS lateral.png` (2 execuções cada)

```
137 A(baseline)  7cx -> 7el  avulso 0,01 m²  kinds=[TAGLINE,NOME,NOME,SITE,TELEFONE,ORNAMENTO,ORNAMENTO]
137 C(novo)      7cx -> 7el  avulso 0,00 m²  kinds=[TAGLINE,NOME,NOME,SITE,TELEFONE,ORNAMENTO,ORNAMENTO]
```

Saída idêntica, avulso 0,01 → 0,00 m². **Sem regressão.**

---

## 4. Patch proposto

### 4.1 `semantic()` — trocar o prompt pela variante C

`probe/production.py:128-137`. Substituir o bloco pelo prompt de §3.

### 4.2 Novo `merge_lockup()` — o prompt sozinho não fecha o sintoma 1

Mesmo com a variante C, o Qwen ainda devolve **2 caixas** no conjunto Mar & Rio
(`LOGOMARCA` no blob + `NOME` na placa `PESCADOS`) em 3/3 execuções. Isso não é
consertável por prompt de forma confiável, e não deveria ser: a evidência de
que é **um** adesivo não está na imagem, está no motor — `r193` é uma região
conectada só.

```python
NAO_FUNDE = {"FAIXA", "FOTOGRAFICO"}  # rota de produção própria (fita / aerografia)
COBERTURA_LOCKUP = 0.50


def merge_lockup(sem, layers, paint, w, h, cob=COBERTURA_LOCKUP):
    """Duas caixas costuradas pela MESMA região conectada são UM adesivo.

    §3.0: a máscara é aplicada inteira. Se uma única região de cor (a placa
    branca da logomarca) preenche a caixa do vizinho, o plotter não tem como
    separar as duas: cortar ali parte a própria chapa de cor no meio — dois
    recortes, duas aplicações e duas depilações que não existem.
    """
    owner = assign(paint, sem, w, h)
    px = []
    for e in sem:
        x0, y0, x1, y1 = [v * s for v, s in zip(e["bbox_norm"], (w, h, w, h))]
        px.append((int(max(0, x0)), int(max(0, y0)),
                   int(min(w, x1)), int(min(h, y1))))
    parent = list(range(len(sem)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i

    for r in paint:
        if r["kind"] == "FOTOGRAFICO":
            continue
        gid = owner.get(r["id"])
        if gid is None:
            continue
        a = int(gid[1:])
        if sem[a]["kind"] in NAO_FUNDE:
            continue
        m = np.asarray(layers[r["id"]]) > 127
        for b, (x0, y0, x1, y1) in enumerate(px):
            if b == a or sem[b]["kind"] in NAO_FUNDE or x1 <= x0 or y1 <= y0:
                continue
            sub = m[y0:y1, x0:x1]
            if sub.size and sub.mean() >= cob:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[ra] = rb

    merged, remap = [], {}
    for i in range(len(sem)):
        root = find(i)
        if root not in remap:
            remap[root] = len(merged)
            merged.append(dict(sem[i]))
        else:
            t = merged[remap[root]]
            bb, o = t["bbox_norm"], sem[i]["bbox_norm"]
            t["bbox_norm"] = [min(bb[0], o[0]), min(bb[1], o[1]),
                              max(bb[2], o[2]), max(bb[3], o[3])]
            t["label_raw"] += " + " + sem[i]["label_raw"]
            if sem[i]["kind"] == "LOGOMARCA":   # LOGOMARCA manda no conjunto
                t["kind"] = "LOGOMARCA"
    return merged
```

O critério é **dono-consciente**, e isso é o que o torna seguro: só conta a
região que já *pertence* (por centroide) ao elemento A e que preenche ≥ 50 %
da caixa de B. Sem esse recorte, um teste ingênuo de sobreposição funde meia
arte — a caixa `ORNAMENTO` do polvo cruza quase todas as outras.

Ligar em `build_elements()` (production.py:272), antes do `assign` atual:

```python
     regions = analysis["regions"]
     paint = [r for r in regions if not r["is_background"]]
+    sem = merge_lockup(sem, layers, paint, w, h)
     owner = assign(regions, sem, w, h)
```

`assign()` roda de novo depois da fusão — a caixa unificada é maior, então o
desempate "menor caixa" precisa ser reavaliado.

**Medido, `mar e rio.png`:**

```
ponte r193 (1,30 m², dono e1 LOGOMARCA) preenche 70% da caixa e2 NOME -> mesmo adesivo
6 caixas -> 5 elementos
r193 -> e1 LOGOMARCA        (era: AVULSO)
AVULSO: 0 regiões, 0,00 m²  (era: 1,30 m²)
```

Disparou **exatamente uma vez** por execução, sempre na ponte certa (66–70 % de
cobertura, 4/4 execuções). Em `137 PESCADOS lateral` (4 execuções, prompt antigo
e novo) **não disparou nenhuma vez** — zero fusão falsa.

Aplicado sozinho sobre o prompt antigo, o patch reduz o dano mas não resolve:
funde `NOME+SITE` e deixa `LOGOMARCA` de fora, porque com 3 fatias `r193` cobre
só 25 % da caixa de cima. **Prompt e patch são os dois necessários.**

### 4.3 `LABEL_MAP` — duas agulhas defeituosas (`probe/detect_qwen.py:36-52`)

Não causaram nenhum dos três sintomas, mas são bugs reais, verificados:

```
'razão social'   -> REDE_SOCIAL     (deveria ser NOME)
'marca escrita'  -> LOGOMARCA       (declarada em NOME — agulha MORTA)
'nome da marca'  -> LOGOMARCA       (deveria ser NOME)
```

`("REDE_SOCIAL", (... "social"))` vem antes de `NOME`, e `"social"` é
substring de `"razão social"`. E `("LOGOMARCA", (... "marca"))` vem antes de
`NOME`, sombreando a agulha `"marca escrita"` que o próprio `LABEL_MAP`
declara — código morto por construção.

Além disso, hoje caem em `OUTRO`: `mascote`, `personagem`, `ilustração`,
`bloco de texto`, `texto`, `palavra`. Numa arte com mascote — como esta — se o
Qwen disser `"mascote"` em vez de `"ornamento"`, o polvo perde a rota.

```diff
-    ("REDE_SOCIAL", ("instagram", "facebook", "whatsapp", "rede social", "social")),
+    ("REDE_SOCIAL", ("instagram", "facebook", "whatsapp", "rede social",
+                     "redes sociais", "mídia social")),
     ("TELEFONE", ("telefone", "phone", "contato", "contact")),
-    ("LOGOMARCA", ("logo", "logomarca", "marca")),
-    ("TAGLINE", ("tagline", "slogan", "frase", "assinatura", "descritivo")),
+    # NOME antes de LOGOMARCA: "marca" é substring de "logomarca" e roubava
+    # "nome da marca" / "marca escrita". "logomarca" não casa agulha de NOME.
     ("NOME", ("nome", "wordmark", "razão", "marca escrita", "nome da empresa")),
+    ("LOGOMARCA", ("logo", "logomarca", "marca")),
+    ("TAGLINE", ("tagline", "slogan", "frase", "assinatura", "descritivo")),
...
-    ("ORNAMENTO", ("ornamento", "gráfico", "grafismo")),
+    ("ORNAMENTO", ("ornamento", "gráfico", "grafismo", "mascote",
+                   "personagem", "ilustra", "desenho")),
```

Verificado após a mudança — 21 rótulos plausíveis, todos corretos:
`logomarca→LOGOMARCA`, `nome da marca→NOME`, `marca escrita→NOME`,
`razão social→NOME`, `rede social→REDE_SOCIAL`, `mascote→ORNAMENTO`,
`bloco fotográfico→FOTOGRAFICO`, `onda→FAIXA`.

### 4.4 Recomendado à parte: `AVULSO` deveria gritar

`AVULSO_MIN_M2 = 0.10` descarta ruído, mas um avulso **acima** do limiar sai
sem alarde no relatório. Um AVULSO de 1,3 m² é sempre um defeito de
reconhecimento, nunca uma decisão de produção — merece entrar em
`analysis["alerts"]`, para o dono não precisar reparar que "ficou estranho".

---

## 5. Riscos do patch

**`merge_lockup` pode fundir demais em arte de logo sobre placa.** Se o cliente
tem uma placa/faixa branca com a logomarca de um lado e o telefone do outro, a
mesma região branca preenche as duas caixas e o patch faz disso **um** adesivo.
Nesta arte é o comportamento certo (a placa é do logo); numa placa de fundo
compartilhada, seria errado. Mitigação: `COBERTURA_LOCKUP` a 0,50 já é
exigente, e `NAO_FUNDE` protege `FAIXA`/`FOTOGRAFICO`. Vale medir em artes com
banda branca corrida antes de generalizar.

**O limiar 0,50 é calibrado numa arte só.** As pontes verdadeiras medidas dão
66–70 % e a maior falsa candidata fica em 25 % — a margem é confortável, mas
são 4 execuções em 1 arte. Rodar sobre as 66 análises de
`layout database/analysis/` antes de fixar.

**A união de bbox pode inchar a caixa.** A fusão troca as caixas pela
envoltória. Se uma das caixas já estava estourada, a união herda o estouro e o
guarda `cabe` passa a aceitar regiões que deveria rejeitar — exatamente o
oposto do sintoma 3, e mais difícil de perceber, porque o resultado é um
elemento *grande demais* em vez de um órfão visível.

**`kind` do conjunto é decidido por regra fixa** (`LOGOMARCA` vence). Se o
futuro fundir `NOME + TAGLINE` sem `LOGOMARCA` no meio, o `kind` fica sendo o
da primeira caixa da lista — arbitrário. Hoje não acontece; é dívida.

**REGRA 2 do prompt convida à alucinação.** "Nenhuma palavra pode ficar fora de
alguma caixa" empurra o modelo a produzir caixas para achar texto onde não há.
O `"Não invente elementos"` final continua lá, e em 4 execuções não apareceu
elemento fantasma — mas é a pressão que essa regra cria, e é o que se deve
monitorar primeiro numa arte de pouco texto.

**REGRA 3 pode encolher demais a `FAIXA`.** Ao proibir a faixa de engolir
textos, a caixa da onda fica mais justa e sobra borda sem dono — foi o que
aconteceu com a variante D (0,41 m² de avulso) e uma vez com a C (0,43 m²). É
menos grave que o inverso (a faixa aspirando textos), mas troca um erro
barulhento por um silencioso.

**Nada disto foi validado nas outras 65 artes.** As medições cobrem
`mar e rio.png` (9 execuções) e `137 PESCADOS lateral.png` (4). Antes de subir,
rodar as duas métricas — nº de caixas por logotipo e m² de AVULSO — sobre o
lote inteiro de `layout database/analysis/`.
