# Diagnóstico — rota de adesivo × técnica de pintura

Motivado por duas correções do dono (2026-08-05):

> "o polvo no mar e rio era uma aerografia, devia ter **o adesivo do formato em
> volta**, mas a pintura em si é aerografia"

> "a aerografia **só tem adesivo no shape exterior**, apenas"

Referência normativa: `api/PAINTING_PRODUCTION_DOCTRINE.md` §0 (parágrafo
"Aerografia ainda leva adesivo", linhas 44–63). Este documento é diagnóstico e
proposta — **nada foi alterado em `probe/production.py`**.

Números medidos em `probe/production.py` sobre `layout database/mar e rio.png`
(19,25 m², 785,6 × 245,1 cm, pintura geral `#2b5d8b`, 23 passos, 8 elementos) e
sobre `137 PESCADOS lateral.png` (21,44 m², 16 passos, 7 elementos).

---

## 1. O modelo atual, e por que ele está errado

### 1.1 Como está hoje

`route()` (production.py:203) é um `if/elif` que devolve **uma** etiqueta por
elemento, escolhida entre sete alternativas mutuamente exclusivas:

```
AEROGRAFIA │ FITA_AMARELA │ FITA_BRANCA │ ADESIVO_SOBRE_CHAPA
           │ ADESIVO_SOBRE_GERAL │ ADESIVO_SOBRE_VERNIZ │ CORTE_MANUAL
```

E `AEROGRAFIA` é o **primeiro** teste da cadeia:

```python
def route(el: dict, substrato: str) -> tuple[str, str]:
    if el.get("aerografia"):
        return "AEROGRAFIA", ("zona de tom contínuo — não se corta e não se "
                              "imprime: vai à mão livre pelo setor de Aerografia")
    ...
```

Estar em primeiro lugar num `if/elif` significa **curto-circuito**: um elemento
aerografado nunca chega às perguntas que definem como a máscara chega à peça
(`toca_tinta`, `campo`, `menor_traco_mm`, `substrato`). A rota do adesivo dele
não é decidida — ela deixa de existir.

### 1.2 Por que a irmandade é o erro de modelagem

As sete rotas não respondem à mesma pergunta:

| rota | pergunta que responde |
|---|---|
| FITA_AMARELA / FITA_BRANCA | **como a máscara chega** (fita, sem plotter) |
| ADESIVO_SOBRE_CHAPA / GERAL / VERNIZ | **como a máscara chega** (vinil, e sobre o quê) |
| CORTE_MANUAL | **como a máscara chega** (estilete in situ) |
| AEROGRAFIA | **como a tinta entra** (à mão livre, e não pela pistola) |

Seis respondem "de onde vem o contorno". A sétima responde "o que acontece
**dentro** do contorno". São dois eixos independentes empilhados num campo só.

A doutrina §0 diz exatamente isso: o adesivo *é* o contorno, e a aerografia
troca apenas o miolo. Um elemento aerografado sobre chapa nua tem adesivo sobre
chapa; sobre pintura geral curada tem adesivo sobre a geral; encostando em
tinta do desenho tem adesivo sobre verniz. **Só a etapa "pintar" muda.**

A própria doutrina §7.4 já escreve o contrato certo e o motor o ignora: lá,
`textura: CHAPADO | DEGRADE | AEROGRAFIA` é um campo **separado** de
`estrategia: CORTE_MANUAL | ADESIVO_SOBRE_* | FITA_*`. Aí `AEROGRAFIA` aparece
**duas vezes** — em `textura` e em `estrategia` — que é a assinatura do bug: o
mesmo conceito ocupando um eixo que não é o dele.

### 1.3 O defeito medido no polvo

Rodado com:

```bash
.venv/bin/python probe/production.py <eng_mar_e_rio.json> "../../layout database/mar e rio.png" \
  --out /tmp/mr --substrato CHAPA
```

O polvo sai como:

```
AEROGRAFIA  1.79 m²  1 cor(es)  vert 53.5°  toca_tinta=False  -> AEROGRAFIA
```

**Primeiro achado — a contagem ingênua de etapas de adesivo perdidas é ZERO, e
isso é pior do que parece.** O polvo *recebe* um passo `ADESIVO` (passo 2,
"Adesivo — aerografia"). Mas ele o recebe **por acidente**: `build_steps()`
emite adesivo com o teste `x["tipo"] != "FAIXA"` (production.py:690), não com a
rota. A rota `AEROGRAFIA` **não é lida por nenhuma linha de `build_steps()`** —
só por `report_html.py:116`, para pintar uma tag amarela. Ela é uma etiqueta
decorativa. Resultado: o plano se autocontradiz em duas linhas seguidas —

> passo 2: *"zona de tom contínuo — **não se corta** e não se imprime: vai à mão
> livre"*. **Traço de corte do plotter**; a folha vai inteira (1.79 m²) e a
> **depilação libera cada cor** na sua vez."

— num elemento cuja única "cor" é o marcador `#multi`.

**Segundo achado — o que de fato se perdeu.** O curto-circuito escondeu a
classificação, e com ela o ciclo caro:

| medida | valor medido | consequência |
|---|---|---|
| fronteira T-T do polvo com cores do desenho | **28,59 m** em 48 fronteiras (`#ea5a53` 14,78 m · `#ef9483` 6,99 m · `#2b9cbc` 3,59 m · `#fdfdfd` 3,23 m) | invisível: o elemento carrega `toca_tinta=False` |
| rota de adesivo correta | **ADESIVO_SOBRE_VERNIZ** (toca tinta do desenho; contorno de aerografia nunca é corte manual) | a rota **mais cara** das sete — nunca escolhida |
| perímetro de corte cobrado | 3421 cm (1 contorno + **16 holes**) | doutrina manda 2657 cm (só o anel externo) |
| excesso de corte | **763 cm — 22% a mais** | plotter e depilação superfaturados |

Etapas do ciclo de adesivo que o polvo **deixou de gerar: 3**

1. **verniz localizado + cura** antes da máscara (exigido por `ADESIVO_SOBRE_VERNIZ`);
2. **depilação da silhueta** como operação própria — uma só, e não "por cor";
3. **remoção do adesivo do polvo** (hoje diluída no "Remover o empapelamento" global).

E mais 1 etapa **tipada errado**: a pintura sai como `PINTURA — "Pintura #multi"`
(passo 16), ordenada por área **no meio das cores de pistola** (3ª menor), com
um `PREPARO — "Cobrir #multi"` (passo 17) atrás. `#multi` não é cor, é uma zona
de trabalho de um **setor diferente**.

O `toca_tinta=False` não é um acaso do desenho, é bug estrutural
(production.py:311): `touches[]` é indexado por `owner.get(id)`, mas as regiões
`FOTOGRAFICO` são desviadas para o grupo `"aero"` na linha 286 **antes** e nunca
recebem essa chave. `touches["aero"]` nunca é escrito → `defaultdict(bool)` →
sempre `False`. No mar e rio os 28,59 m do polvo foram creditados à **FAIXA**
(cuja caixa contém o centroide do polvo), que por ser rota de fita ignora o
campo. Aerografia é hoje **estruturalmente incapaz** de tocar tinta.

### 1.4 Defeito adjacente que a remodelagem expõe (não corrigir agora)

No plano atual **todos os adesivos são aplicados nos passos 2–8**, antes do
empapelamento (10) e antes da pintura geral (11) — inclusive os quatro elementos
com rota `ADESIVO_SOBRE_VERNIZ`, que por definição só podem ser colados depois
de pintar, envernizar e curar. É a mesma causa-raiz: **a rota não governa a
sequência**. A remodelagem abaixo é pré-requisito para consertar isso, mas o
conserto da ordem é trabalho separado.

---

## 2. O modelo proposto

Dois campos ortogonais, mais um derivado:

```
rota_adesivo     ∈ FITA_AMARELA | FITA_BRANCA | ADESIVO_SOBRE_CHAPA
                 | ADESIVO_SOBRE_GERAL | ADESIVO_SOBRE_VERNIZ | CORTE_MANUAL
tecnica_pintura  ∈ CHAPADO | DEGRADE | AEROGRAFIA
perimetro_corte_cm  — derivado de tecnica_pintura (aerografia = só o anel externo)
```

- **`rota_adesivo` responde "como a máscara chega"** e não sabe nada sobre a
  técnica — exceto por duas restrições, ambas mecânicas:
  - aerografia **nunca** é `CORTE_MANUAL`: o contorno de uma silhueta orgânica é
    sempre traço de plotter (doutrina §0, "só uma etapa é feita por máquina");
  - `FAIXA` só cai em rota de fita quando **não** é aerografada; uma faixa
    aerografada tem contorno de fita para as bordas retas, mas a doutrina não
    cobre esse caso — ver Riscos.
- **`tecnica_pintura` responde "o que acontece dentro da máscara"** e é o único
  campo que muda a etapa de pintura, o setor responsável e o comprimento de corte.
- `rota` continua existindo como **alias de `rota_adesivo`** (o
  `report_html.py:116/153/159` lê `e["rota"]`).

### 2.1 Tabela completa de combinações

Legenda de "corte": **todos os anéis** = contorno + `holes[]` de cada região;
**só o externo** = perímetro da silhueta preenchida, ignorando `holes[]` e
sub-regiões (doutrina §0, `perimetro_corte_cm`).

| # | rota_adesivo | tecnica | máscara / corte | pintura | verniz+cura antes? | ocorre? |
|---|---|---|---|---|---|---|
| 1 | ADESIVO_SOBRE_CHAPA | CHAPADO | plotter, todos os anéis; depilação por cor | pistola, 1 demão por cor | não | comum |
| 2 | ADESIVO_SOBRE_CHAPA | DEGRADE | plotter, todos os anéis; depilação por cor | pistola, rampa na mesma demão | não | comum |
| 3 | ADESIVO_SOBRE_CHAPA | **AEROGRAFIA** | plotter, **só o externo**; **1 depilação**, sem miolo | **setor Aerografia**, à mão livre | não | comum |
| 4 | ADESIVO_SOBRE_GERAL | CHAPADO | plotter, todos os anéis; depilação por cor | pistola | não (geral curada de véspera) | comum |
| 5 | ADESIVO_SOBRE_GERAL | DEGRADE | idem | pistola, rampa | não | comum |
| 6 | ADESIVO_SOBRE_GERAL | **AEROGRAFIA** | plotter, **só o externo**; **1 depilação** | **setor Aerografia** | não | comum |
| 7 | ADESIVO_SOBRE_VERNIZ | CHAPADO | plotter, todos os anéis | pistola | **sim** | caso do texto do 2 Amigos |
| 8 | ADESIVO_SOBRE_VERNIZ | DEGRADE | plotter, todos os anéis | pistola, rampa | **sim** | banner do 2 Amigos |
| 9 | ADESIVO_SOBRE_VERNIZ | **AEROGRAFIA** | plotter, **só o externo**; **1 depilação** | **setor Aerografia** | **sim** | **o polvo do mar e rio** |
| 10 | CORTE_MANUAL | CHAPADO | estilete in situ; sem plotter | pistola | não (a cor menor vai primeiro) | raro (§3.1) |
| 11 | CORTE_MANUAL | DEGRADE | estilete in situ | pistola, rampa | não | raro |
| 12 | CORTE_MANUAL | AEROGRAFIA | — | — | — | **impossível**: rebaixar para #3/#6/#9 |
| 13 | FITA_AMARELA | CHAPADO | fita, **zero corte** | pistola | não | comum |
| 14 | FITA_AMARELA | DEGRADE | fita, zero corte | pistola, rampa | não | comum (ondas BURES 2) |
| 15 | FITA_AMARELA | AEROGRAFIA | fita nas bordas, zero corte | setor Aerografia | não | **não confirmado** — ver Riscos |
| 16 | FITA_BRANCA | CHAPADO | fita, **corte na fita** (não curva) | pistola | não | comum |
| 17 | FITA_BRANCA | DEGRADE | idem | pistola, rampa | não | comum |
| 18 | FITA_BRANCA | AEROGRAFIA | idem | setor Aerografia | não | **não confirmado** |

Os três estados de `tecnica_pintura` também definem **quem executa**: CHAPADO e
DEGRADE são pistola (setor de Pintura); AEROGRAFIA é o **setor de Aerografia**,
com sua própria fila e seu próprio custo/hora. Hoje o plano não distingue.

### 2.2 Como isso muda os passos gerados

Para o polvo (linha 9 da tabela), o plano correto emite:

| # | tipo | conteúdo | hoje |
|---|---|---|---|
| a | VERNIZ | verniz localizado sobre a área do polvo + **cura** | **ausente** |
| b | ADESIVO | recorte do **contorno externo** — 2657 cm, 1 anel | existe com 3421 cm e 17 anéis |
| c | PREPARO | **depilar a silhueta** (uma vez; não há miolo) | ausente (texto falso dentro de "b") |
| d | **AEROGRAFIA** | 1,79 m² à mão livre, **setor de Aerografia** | sai como `PINTURA "#multi"` |
| e | PREPARO | remover o adesivo do polvo | diluído no global |

---

## 3. Patch proposto

Código preciso, ainda **não aplicado**.

### 3.1 `route()` → `rota_adesivo()` + `tecnica_pintura()` + perímetro de corte

Substitui o bloco `# --- rota ---` (production.py:201–230):

```python
# ------------------------------------------------------------- rota ---------
#
# DOIS EIXOS ORTOGONAIS, não sete rotas irmãs (doutrina §0 e §7.4):
#
#   rota_adesivo     COMO a máscara chega à peça
#   tecnica_pintura  O QUE acontece DENTRO dela
#
# Aerografia era a primeira condição de um if/elif e curto-circuitava as
# perguntas de máscara — o polvo da "mar e rio" ficava sem rota de adesivo,
# com 28,59 m de fronteira tinta-tinta invisíveis e 763 cm de corte a mais.

def tecnica_pintura(el: dict) -> tuple[str, str]:
    """Como a tinta entra dentro da máscara. Só isto muda a etapa de pintura."""
    if el.get("aerografia"):
        return "AEROGRAFIA", (
            "tom contínuo: o adesivo dá o contorno e o interior vai à mão livre, "
            "pelo setor de Aerografia — sem recorte interno e sem depilação de miolo")
    if el.get("degrade"):
        return "DEGRADE", ("rampa entre dois tons — sai suavizada na mesma demão, "
                           "sem máscara interna")
    return "CHAPADO", "cor plana — uma demão por cor liberada na depilação"


def rota_adesivo(el: dict, substrato: str) -> tuple[str, str]:
    """Como a máscara chega. NÃO sabe nada sobre a técnica de pintura.

    Duas únicas interferências, ambas mecânicas:
      - faixa aerografada não é resolvida por fita (a fita não faz silhueta);
      - contorno de aerografia é SEMPRE traço de plotter, nunca estilete in situ.
    """
    aero = el.get("aerografia", False)

    if el["tipo"] == "FAIXA" and not aero:
        if substrato in ("ISOPLASTIC", "LONA"):
            return "FITA_AMARELA", f"faixa em {substrato.lower()} — amarela faz qualquer curva"
        if el["verticalidade_deg"] <= VERTICAL_DEG:
            return "FITA_AMARELA", (f"traçado a {el['verticalidade_deg']:.0f}° da horizontal "
                                    f"— curva tranquila, a amarela passa")
        return "FITA_BRANCA", (f"traçado a {el['verticalidade_deg']:.0f}° — vertical demais "
                               f"para a amarela; a branca não curva e exige corte")

    if not el["toca_tinta"]:
        if el.get("campo") == "PINTURA_GERAL":
            return "ADESIVO_SOBRE_GERAL", (
                "nenhuma cor do desenho se toca aqui; o adesivo assenta sobre a "
                "pintura geral já curada do dia anterior — sem verniz, sem espera")
        return "ADESIVO_SOBRE_CHAPA", ("só encosta em chapa — adesivo aplicado inteiro, "
                                       "depilado por cor. Sem corte manual, sem verniz")

    if el["menor_traco_mm"] >= CUT_MM_CONFIRMED and not aero:
        return "CORTE_MANUAL", (f"encosta em tinta e o traço de {el['menor_traco_mm']:.0f} mm "
                                f"é cortável — evita o ciclo de verniz")
    return "ADESIVO_SOBRE_VERNIZ", (
        (f"encosta em tinta e o contorno da silhueta sai no plotter, não no estilete"
         if aero else
         f"encosta em tinta e o traço de {el['menor_traco_mm']:.0f} mm "
         f"está abaixo dos 14 mm confirmados")
        + " — o adesivo só entra depois de envernizar e curar")


def perimetro_corte_cm(mask: np.ndarray, tecnica: str, px_per_cm: float) -> float:
    """Comprimento que o plotter realmente corta.

    Em AEROGRAFIA o adesivo é só o shape exterior — "a aerografia só tem adesivo
    no shape exterior, apenas" (dono, 2026-08-05; doutrina §0). Preencher os
    buracos antes de medir ignora holes[] e sub-regiões de uma vez, e funciona
    também quando o elemento tem várias regiões.

    No polvo da "mar e rio": 2657 cm em vez de 3421 cm (17 anéis) — 22% a menos.
    """
    alvo = ndimage.binary_fill_holes(mask) if tecnica == "AEROGRAFIA" else mask
    total = sum(float(np.sum(np.hypot(*np.diff(c, axis=0).T)))
                for c in measure.find_contours(alvo.astype(float), 0.5))
    return round(total / px_per_cm, 1)


def route(el: dict, substrato: str, mask: np.ndarray, px_per_cm: float) -> dict:
    """Preenche os dois eixos + o derivado. `rota` fica como alias de
    compatibilidade — report_html.py lê e["rota"]."""
    ra, mr = rota_adesivo(el, substrato)
    tp, mt = tecnica_pintura(el)
    el["rota_adesivo"], el["motivo_adesivo"] = ra, mr
    el["tecnica_pintura"], el["motivo_tecnica"] = tp, mt
    el["rota"], el["motivo"] = ra, f"{mr}; {mt}"
    el["perimetro_corte_cm"] = perimetro_corte_cm(mask, tp, px_per_cm)
    return el
```

`build_elements()` precisa guardar a máscara do elemento (ela já é montada na
linha 326-328 e descartada) e `main()` precisa calcular `px_per_cm` **antes** do
laço de rota:

```python
    px_per_cm = img['workWidthPx'] / img['widthCm']          # sobe para cá
    els = build_elements(analysis, sem, canon, layers, w, h)  # passa a devolver e["_mask"]
    for e in els:
        route(e, args.substrato, e.pop("_mask"), px_per_cm)
```

### 3.2 `build_steps()` — a técnica passa a governar

**(a) o laço de adesivo deixa de olhar `tipo` e passa a olhar a rota** — hoje
uma faixa aerografada não geraria adesivo nenhum (production.py:690/697):

```python
    for e in [x for x in els if not x["rota_adesivo"].startswith("FITA")]:
        if e["tecnica_pintura"] == "AEROGRAFIA":
            detalhe = (
                f"{e['motivo_adesivo']}. Vai ao plotter **só o contorno externo** "
                f"— {e['perimetro_corte_cm']:.0f} cm de corte, sem recorte interno. "
                f"O adesivo é o que impede a tinta de sair da silhueta; tudo "
                f"dentro dele é trabalho de Aerografia.")
        else:
            detalhe = (
                f"{e['motivo_adesivo']}. {e['perimetro_corte_cm']:.0f} cm de traço "
                f"de corte; a folha vai inteira ({e['area_m2']} m²) e a depilação "
                f"libera cada cor na sua vez.")
        add("ADESIVO", f"Adesivo — {e['tipo'].lower()}", detalhe,
            silhouette_image(e, by_id, layers, w, h, px_per_cm),
            rota=e["rota_adesivo"], tecnica=e["tecnica_pintura"], elemento=e["tipo"],
            perimetro_corte_cm=e["perimetro_corte_cm"])

    for e in [x for x in els if x["rota_adesivo"].startswith("FITA")]:
        ...  # inalterado
```

`janelas()` (production.py:448) tem o mesmo `e["rota"].startswith("FITA")` — vira
`e["rota_adesivo"]`. Como `rota` é alias, funciona nos dois casos; trocar por
clareza.

**(b) `silhouette_image()` não pode desenhar os `holes` de uma zona
aerografada** — hoje ela manda 16 anéis internos ao plotter que não existem:

```python
def silhouette_image(el, regions_by_id, layers, w, h, px_per_cm, tecnica="CHAPADO"):
    ...
    for rid in el["regioes"]:
        r = regions_by_id[rid]
        # Em aerografia só o anel externo é cortado (doutrina §0). Desenhar os
        # holes mostrava 16 recortes internos que ninguém corta no polvo.
        aneis = [r["contour"]] if tecnica == "AEROGRAFIA" else [r["contour"]] + r.get("holes", [])
        for ring in aneis:
            ...
```

**(c) `#multi` sai da fila de cores de pistola e vira etapa de setor.** Hoje ele
entra em `por_cor` e é ordenado por área entre as cores da pistola (passo 16 do
mar e rio), com um "Cobrir #multi" atrás:

```python
    aero_els = [e for e in els if e["tecnica_pintura"] == "AEROGRAFIA"]
    aero_ids = {rid for e in aero_els for rid in e["regioes"]}

    for e in els:
        for rid in e["regioes"]:
            if rid in aero_ids:      # #multi não é cor de pistola: é outro setor
                continue
            c = canon.get(by_id[rid]["hex"], by_id[rid]["hex"])
            por_cor[c].append(rid)
            area_cor[c] += by_id[rid]["area_m2"]
        ...
```

e, **depois** do laço de cores (a aerografia entra por último: é a camada que
mais sofre com overspray e a que o setor faz numa passada só):

```python
    for e in aero_els:
        face = face_pintada(layers, regions, painted + e["regioes"], orig, degrade_ids, els)
        add("AEROGRAFIA", f"Aerografia — {e['tipo'].lower()}",
            f"{e['area_m2']} m² à mão livre dentro da silhueta, pelo **setor de "
            f"Aerografia** — não é demão de pistola e não entra na fila de cores. "
            f"O adesivo do contorno ({e['perimetro_corte_cm']:.0f} cm) já está na "
            f"peça e é o que segura a tinta dentro da forma. Uma depilação só: "
            f"não há cor a liberar lá dentro.",
            compor(kraft, els, layers, w, h, px_per_cm, face, papel),
            elemento=e["tipo"], rota=e["rota_adesivo"], tecnica="AEROGRAFIA",
            setor="AEROGRAFIA")
        painted.extend(e["regioes"])
```

`report_html.py` ganha `"AEROGRAFIA"` no mapa de tipos de passo e uma coluna
`técnica` na tabela de elementos; `ROTA_TAG` **perde** a entrada `AEROGRAFIA`
(que agora nunca aparece como rota).

### 3.3 Correção necessária no cálculo de `toca_tinta`

Sem isto o eixo novo não muda nada para o polvo: ele continua `toca_tinta=False`
e cai em `ADESIVO_SOBRE_GERAL` em vez de `ADESIVO_SOBRE_VERNIZ`.
Em `build_elements()` (production.py:311), `touches[]` é indexado por
`owner.get(...)`, chave que as regiões `FOTOGRAFICO` nunca recebem:

```python
    # As regiões FOTOGRAFICO foram desviadas para o grupo "aero" (linha 286) e
    # não passam por owner[] — touches["aero"] nunca era escrito e a aerografia
    # era ESTRUTURALMENTE incapaz de tocar tinta. No mar e rio os 28,59 m de
    # fronteira do polvo foram creditados à FAIXA, que por ser fita os ignora.
    grupo = {r["id"]: gid for gid, rs in groups.items() for r in rs}
    ...
        ga, gb = grupo.get(ra["id"], "avulso"), grupo.get(rb["id"], "avulso")
```

---

## 4. O mosaico de triângulos (137 PESCADOS)

Premissa dada: a quantização passa a separar dezenas de triângulos low-poly em
4–6 azuis. **A quantização em si é trabalho de outro agente e não é tratada
aqui.** A pergunta é se o modelo de elementos e passos aguenta o resultado.

Estado atual medido (`eng_137_PESCADOS_lateral.json`): 127 regiões, **3 cores**
(`#aaacae` fundo, `#14224a` 82 regiões, `#275395` 12 regiões), 4 fronteiras
PAINT_PAINT. O plano tem 16 passos e dois elementos `ORNAMENTO` de 1,18 m² com
7 regiões cada.

### 4.1 `build_elements()` aguenta — dezenas de triângulos viram 1–2 partes

O agrupamento é por **caixa semântica do Qwen**, e triângulos são pequenos: o
filtro `cabe` (bbox da região ≤ 1,6× a do elemento, linha 292) passa
folgadamente para todos, e `assign()` por centroide manda todos para o mesmo
`ORNAMENTO`. Dezenas de triângulos → **1 elemento por ornamento**, exatamente o
certo (uma máscara, um adesivo). Se o Qwen não nomear a região, todos caem em
`"avulso"` e viram **um** blob — cuja área somada passa de
`AVULSO_MIN_M2 = 0.10`, então sobrevive. **O eixo de elementos está correto.**

### 4.2 `merge_gradient()` desfaz a correção da quantização — e por encadeamento

`merge_gradient()` (production.py:73) funde dois tons quando eles **encostam** e
estão a **ΔE < 16**, via union-find. Num mosaico low-poly *todas* as peças se
tocam e os azuis são vizinhos por construção. Rampa plausível para o 137:

```
#14224a → #1b3163  ΔE 8,9      #275395 → #3266ab  ΔE 7,8
#1b3163 → #22417c  ΔE 8,5      #3266ab → #4079c0  ΔE 7,5
#22417c → #275395  ΔE 8,3      extremos #14224a vs #4079c0:  ΔE 39,6
```

Todo par consecutivo passa no teste; o union-find encadeia os seis num grupo só,
**apesar de os extremos estarem a ΔE 39,6** — mais que o dobro do limiar. O
elemento sai com `degrade=True` (`len(tons) > len(cores)`) e o plano imprime:

> "os 6 tons do arquivo são **bandas do mockup, não máscaras**"

que é o oposto do que um low-poly é: facetas **chapadas de borda dura**, seis
tintas distintas, cada uma com sua máscara. A quantização entregaria a distinção
e `merge_gradient()` a devolveria para o lixo — no mesmo arquivo, 20 linhas
depois.

Correção mínima (guarda de transitividade, sem depender de detectar mosaico):

```python
    # Fundir só quando o tom também está perto do REPRESENTANTE do grupo, não
    # apenas do vizinho imediato. Sem isto, seis azuis low-poly a ΔE 8 de
    # distância viram um degradê só, embora os extremos estejam a ΔE 39,6.
    for a, c in sorted(adj, key=lambda p: np.linalg.norm(_lab(p[0]) - _lab(p[1]))):
        ra, rc = find(a), find(c)
        if ra == rc:
            continue
        if (np.linalg.norm(_lab(a) - _lab(c)) < GRADIENT_DELTA_E and
                np.linalg.norm(_lab(ra) - _lab(rc)) < GRADIENT_DELTA_E):
            parent[ra] = rc
```

Isso limita o diâmetro do grupo, mas **não** distingue "rampa suave real" de
"mosaico de facetas". O discriminador certo é a **dureza da borda** — a doutrina
§7.2 já descreve a medida (resíduo do ajuste de rampa em L\*). Numa rampa o L\*
é explicado por `a·x + b·y + c` **atravessando** a fronteira; num mosaico há
degrau. Proposta: `merge_gradient()` passa a exigir, além de ΔE e adjacência,
que o perfil de L\* seja contínuo na fronteira. Enquanto isso não existe, a
guarda de diâmetro é o que impede o pior caso.

### 4.3 `build_steps()` NÃO aguenta — a explosão é linear em cores

`por_cor` (linha 717) é **global por cor canônica**, e cada cor gera
**2 passos**: uma `PINTURA` e um `PREPARO "Cobrir"`. A contagem do plano é

```
passos = 12 + 2·C          (C = cores canônicas)
```

conferido nos dois casos reais: 137 com C=2 → 16 passos ✓; mar e rio com C=5 →
22 + 1 (pintura geral) = 23 ✓. Projetando o mosaico separado:

| cores canônicas | passos hoje | o que o pintor faz de verdade |
|---|---|---|
| 2 (estado atual) | 16 | 1 adesivo, 2 depilações |
| 4 | 20 | 1 adesivo, 4 depilações |
| 5 | 22 | 1 adesivo, 5 depilações |
| 6 | 24 | 1 adesivo, 6 depilações |
| 7 | **26** | 1 adesivo, 7 depilações |

26 passos, 26 imagens renderizadas, para uma face que o chão de fábrica resolve
com **uma folha de vinil e sete depilações**. O plano deixa de ser um plano e
vira uma lista.

E há um erro pior que a contagem: **`cobertura_mask()` degenera quando as partes
se tocam**. `partes_de()` (linha 523) cria uma parte por (elemento, cor), cada
uma com sua bbox. Num mosaico, as peças de todos os tons estão entrelaçadas, e a
bbox de **cada** tom é praticamente **a mesma** — a do mosaico inteiro. Em
`cobertura_mask()` a camada `extensao` é a união das caixas desta cor **menos**
as caixas das cores pendentes (linhas 567–573): com caixas idênticas, subtrai-se
tudo, `extensao = ∅`. Sobra só `base &= ~buraco`, isto é, a peça pintada
**erodida** pela dilatação de 1,5 cm das peças vizinhas ainda por pintar — ou
seja, o papel deixa **descoberta exatamente a borda** que precisava proteger, em
todo o perímetro interno do mosaico.

### 4.4 O que a doutrina §6 realmente diz quando tudo se toca

> §6.4 — "Cores que **não se tocam** entram na **mesma sessão** (não há o que
> proteger)"

Lido ao pé da letra num mosaico: **nenhuma** faceta pode dividir sessão com sua
vizinha → K sessões estritamente serializadas, cada uma com o ciclo caro. Isso
está errado, e a doutrina §3.0 já contém a resposta:

> "A máscara é aplicada **inteira**, não por cor. Uma folha cobre o elemento
> todo; o que muda entre sessões é a **depilação**."

O que separa duas facetas vizinhas **não é a cura da tinta, é a teia de vinil da
máscara**. Duas cores que se tocam **debaixo de uma máscara comum** custam uma
depilação — não uma sessão com verniz e espera. O ciclo caro do §6.3 vale para
T-T **exposta**, fora de qualquer máscara.

Refinamento proposto para a doutrina §6.4:

> A sessão é decidida pela fronteira T-T **não coberta por uma máscara comum**.
> Duas cores que só se tocam dentro de um mesmo adesivo entram na mesma sessão:
> o que as separa é a depilação. Um mosaico de N peças em K tons sob um adesivo
> é **uma sessão com K passadas**, não K sessões.

Nota: a **ordem** dentro do mosaico continua governada pelo §2 (menor área
primeiro), mas de forma trivial — num low-poly bem colorido duas facetas do
**mesmo** tom nunca se tocam, então cada tom é uma passada limpa.

### 4.5 Representação proposta: um passo, K passadas tabeladas

Detectar o mosaico em `build_elements()`:

```python
MOSAICO_MIN_PECAS = 12    # abaixo disto é um desenho com poucas cores
MOSAICO_MIN_ADJ = 0.60    # fração das peças que encosta em outra peça do MESMO elemento

# Um mosaico não é degradê (bordas duras) nem aerografia (sem tom contínuo):
# são N peças chapadas, todas se tocando, sob um contorno só. Vale UM adesivo,
# com uma depilação por tom — e não N máscaras nem K sessões.
el["mosaico"] = {
    "pecas": n_pecas,
    "tons": tons_ordenados,        # [(hex, n_pecas, area_m2), ...] menor área primeiro
    "passadas": len(tons_ordenados),
} if (n_pecas >= MOSAICO_MIN_PECAS and frac_adj >= MOSAICO_MIN_ADJ) else None
```

Em `build_steps()`, as cores de um mosaico saem de `por_cor` (como `aero_ids`
saem, §3.2c) e viram **um** passo com a tabela dentro:

```python
    for e in [x for x in els if x.get("mosaico")]:
        m = e["mosaico"]
        add("MOSAICO", f"Mosaico — {e['tipo'].lower()}",
            f"{m['pecas']} peças em {m['passadas']} tons sob **um único adesivo** "
            f"({e['perimetro_corte_cm']:.0f} cm de corte). A folha vai inteira; cada "
            f"tom é liberado por uma depilação e pintado na sequência do quadro — "
            f"**uma sessão com {m['passadas']} passadas**, não {m['passadas']} "
            f"sessões: quem separa as peças é a própria máscara, não a cura. "
            f"Peças do mesmo tom não se tocam, então cada passada é limpa.",
            mosaico_image(e, ...), elemento=e["tipo"], rota=e["rota_adesivo"],
            passadas=[{"ordem": i + 1, "tom": t, "pecas": n, "area_m2": a}
                      for i, (t, n, a) in enumerate(m["tons"])])
```

Contagem resultante: um mosaico que contenha K das C cores passa de `2K` passos
para **1**. Para o 137 com C=7 (K=6 no mosaico, 1 fora): de **26** passos para
**15**, independente de o mosaico ter 30 ou 300 triângulos.

Consequências de borda:

- **Cor compartilhada com fora do mosaico.** Se um tom do mosaico é o mesmo do
  logotipo, a passada deve se **acoplar** à sessão global daquela cor (mesma
  pistola, mesma tinta) — a economia do §6.4 se preserva registrando
  `sessao_global: "#14224a"` na linha da passada, em vez de duplicar a demão.
- **`cobertura_mask()`** não é chamada dentro do mosaico: não há papel entre
  facetas, há teia de vinil. Isso elimina de vez a degeneração do §4.3.
- **Imagens**: uma por mosaico, com as facetas numeradas pela ordem da passada,
  em vez de 2K renders de face inteira.
- **Custo**: o motor de custo ganha o que precisa — `pecas` (depilações),
  `passadas` (trocas de tinta) e `perimetro_corte_cm` (plotter) — sem inflar a
  contagem de sessões, que é o que dita o **prazo**.

---

## 5. Riscos

1. **`FITA_*` × `AEROGRAFIA` não é confirmado pelo dono** (linhas 15 e 18 da
   tabela). Uma faixa aerografada existe na teoria do modelo novo, mas nenhuma
   arte analisada a mostra e o dono nunca falou disso. O patch a manda para rota
   de adesivo (`el["tipo"] == "FAIXA" and not aero`), que é a escolha
   conservadora — mas pode superfaturar uma faixa com fundo aerografado, onde a
   fita bastaria. **Perguntar antes de calibrar.**

2. **`ADESIVO_SOBRE_VERNIZ` fica muito mais frequente.** Com o
   `toca_tinta` do §3.3 corrigido, toda zona de aerografia que encosta no
   desenho cai na rota mais cara — o polvo é o primeiro. Isso está certo pela
   doutrina, mas **muda o orçamento para cima** em qualquer arte com aerografia
   sobre desenho. Vale revalidar o 2 Amigos e o mar e rio com o dono antes de
   soltar.

3. **A sequência dos passos continua errada** (§1.4): adesivos são emitidos
   antes da pintura mesmo em rotas `ADESIVO_SOBRE_VERNIZ`. O patch aqui torna a
   rota **legível** por `build_steps()`, mas não reordena nada. Aplicar só este
   patch deixa o plano mais correto na descrição e igualmente errado na ordem —
   o passo (a) da tabela §2.2 (verniz localizado + cura) **não** é criado por
   este patch.

4. **`perimetro_corte_cm` de aerografia com várias regiões desconexas.**
   `binary_fill_holes` + `find_contours` mede o anel externo de **cada
   componente**. Se o quantizador partir uma única silhueta aerografada em duas
   manchas separadas, o corte é contado duas vezes. Mitigação: fechar por
   `morphology.closing` antes de medir, com raio calibrado — não calibrado ainda.

5. **`MOSAICO_MIN_PECAS = 12` e `MOSAICO_MIN_ADJ = 0.60` são chutes.** Não há
   arte medida com mosaico separado corretamente (a quantização ainda não
   separa). Calibrar contra o 137 assim que o outro agente entregar, e contra
   pelo menos mais duas artes low-poly do banco de 66.

6. **A guarda de transitividade do §4.2 pode partir degradês reais.** Uma rampa
   longa e legítima (banner dourado do 2 Amigos) tem extremos distantes em
   CIELAB de propósito. A guarda a quebraria em dois ou três grupos, gerando
   máscaras que não existem. É o erro **oposto** ao do mosaico, e o discriminador
   definitivo é a continuidade de L\* na fronteira (§7.2), não o ΔE. **Não
   aplicar a guarda sozinha em artes com degradê grande.**

7. **`#multi` como marcador.** Ao tirar `#multi` de `por_cor`, qualquer consumidor
   que assuma que toda região pintada aparece em algum passo `PINTURA` quebra.
   `face_pintada()` já trata `#multi` à parte (linha 638); `report_html.py` e
   `plan.py` precisam de revisão antes de aplicar.
