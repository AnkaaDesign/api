"""Plano de produção a partir da saída do painting-engine + reconhecimento semântico.

Existe porque o motor decompõe por COR e a produção decompõe por ELEMENTO.
Uma faixa é UM item resolvido por UMA técnica (fita), mesmo tendo degradê e
atravessando quatro regiões de cor. Sem essa camada, o plano vira uma etapa de
mascaramento por tom — que é o que estava acontecendo na BURES 2.

Mecanismos, na ordem em que rodam:

  1. merge_gradient()   tons vizinhos e adjacentes = UMA tinta com degradê.
                        O motor separou 3 azuis (ΔE 9,7 e 13,0) na BURES e
                        inventou 2,79 m de fronteira azul×azul.
  2. semantic()         Qwen nomeia os elementos — em especial FAIXA, que
                        geometria nenhuma reconhece.
  3. route()            técnica por ELEMENTO (doutrina §3.0/§4).
  4. steps()            preparo CONDICIONAL + uma etapa por elemento.

Uso:
    .venv/bin/python probe/production.py <analysis.json> <arte.png> --out <dir>
    ... --backend openrouter --model qwen/qwen3-vl-32b-instruct
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw, ImageFont
from skimage import color as skcolor
from skimage import measure, morphology

sys.path.insert(0, str(Path(__file__).parent))
from backends import ask  # noqa: E402
from common import load  # noqa: E402
from detect_qwen import COORD_SPACE, parse_boxes  # noqa: E402

# Confirmado pelo dono (9 marcações, ≥14 mm ele corta). Abaixo: sem evidência.
CUT_MM_CONFIRMED = 14.0
# Tons a menos disto, se encostados, são a MESMA tinta com sombreado/degradê.
GRADIENT_DELTA_E = 16.0
# Acima disto o traçado é "muito vertical" e a fita amarela não serve (§4).
VERTICAL_DEG = 55.0
# Abaixo disto, um grupo sem dono é ruído do quantizador, não elemento.
AVULSO_MIN_M2 = 0.10

VOCAB = ["logomarca", "nome da empresa", "tagline", "telefone", "site",
         "faixa", "selo", "ornamento"]


# ---------------------------------------------------------------- cor -------

MULTI = "#multi"   # marcador do motor para região fotográfica (kind FOTOGRAFICO)


def _lab(hexv: str) -> np.ndarray:
    """CIELAB da cor. `#multi` não é cor — é uma zona de tom contínuo.

    Devolver um ponto absurdamente distante garante que ela nunca funda com
    tinta nenhuma: aerografia não entra em fusão de tons.
    """
    if not (hexv.startswith("#") and len(hexv) == 7):
        return np.array([1e6, 1e6, 1e6])
    rgb = np.array([[[int(hexv[i:i + 2], 16) / 255 for i in (1, 3, 5)]]])
    return skcolor.rgb2lab(rgb)[0, 0]


def merge_gradient(regions: list[dict], boundaries: list[dict]) -> dict[str, str]:
    """Mapeia hex → hex canônico, fundindo tons que são a mesma tinta.

    Dois tons são a mesma tinta quando estão perto em CIELAB **e** encostam um
    no outro: sombreado de mockup e degradê real produzem exatamente isso. Só a
    proximidade não bastaria — duas tintas distintas podem ser próximas (o
    próprio plano cita a BURES como esse risco); exigir adjacência separa
    "gradiente de uma tinta" de "duas tintas parecidas em cantos diferentes".
    """
    # DESATIVADA. O quantizador (seleção gulosa + pureza modal) passou a
    # separar tinta de rampa na origem, e esta fusão só reintroduzia o
    # encadeamento transitivo: A~B, B~C juntava A e C mesmo a ΔE 39,6.
    return {r["hex"]: r["hex"] for r in regions}

    by_id = {r["id"]: r for r in regions}
    adj: set[tuple[str, str]] = set()
    for b in boundaries:
        if b["kind"] != "PAINT_PAINT":
            continue
        a, c = by_id.get(b["a"]), by_id.get(b["b"])
        if a and c:
            adj.add(tuple(sorted((a["hex"], c["hex"]))))

    hexes = sorted({r["hex"] for r in regions if not r["is_background"]})
    parent = {h: h for h in hexes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, c in adj:
        if np.linalg.norm(_lab(a) - _lab(c)) < GRADIENT_DELTA_E:
            ra, rc = find(a), find(c)
            if ra != rc:
                parent[ra] = rc

    # canônico = o tom de maior área dentro do grupo
    area: dict[str, float] = defaultdict(float)
    for r in regions:
        if not r["is_background"]:
            area[r["hex"]] += r["area_m2"]
    groups: dict[str, list[str]] = defaultdict(list)
    for h in hexes:
        groups[find(h)].append(h)
    out = {}
    for members in groups.values():
        canon = max(members, key=lambda h: area[h])
        for h in members:
            out[h] = canon
    return out


# ----------------------------------------------------------- semântica ------

def semantic(art_path: str, backend: str, model: str | None) -> list[dict]:
    """Qwen nomeia os elementos. É a única peça que sabe o que é uma FAIXA."""
    img = load(art_path)
    img.thumbnail((1400, 1400), Image.LANCZOS)
    prompt = (
        "Localize os elementos desta arte de baú de caminhão.\n"
        'Para cada um devolva {"bbox_2d":[x1,y1,x2,y2],"label":...}.\n'
        f"Rótulos possíveis: {', '.join(VOCAB)}.\n"
        "Separe CADA bloco como um elemento próprio — o símbolo, o nome escrito "
        "e a linha descritiva abaixo dele são TRÊS elementos, não um.\n"
        "FAIXA = listra ou onda longa que atravessa a peça, mesmo com degradê "
        "ou mais de um tom.\n"
        "Não invente elementos. Responda SOMENTE a lista JSON."
    )
    raw, secs = ask(img, prompt, backend=backend, model=model)
    els = parse_boxes(raw, img.size)
    print(f"  qwen: {len(els)} elementos em {secs:.1f}s "
          f"({', '.join(sorted({e['kind'] for e in els}))})", file=sys.stderr)
    # normaliza para 0-1 para casar com qualquer resolução de trabalho
    for e in els:
        e["bbox_norm"] = [v / COORD_SPACE for v in e["bbox_norm"]]
    return els


def assign(regions: list[dict], els: list[dict], w: int, h: int) -> dict[str, str]:
    """Região → elemento semântico, pelo CENTROIDE da região.

    A primeira versão exigia 50% de sobreposição da caixa da região com a do
    elemento e perdia peças: o telefone da BURES ficou reduzido a "-0087",
    porque cada dígito é uma região pequena que mal encostava na caixa. O
    centroide não tem esse problema — a região pertence a quem a contém.

    Empate (caixas sobrepostas, comum entre nome e tagline) vai para a MENOR
    caixa: a mais específica é a que realmente descreve aquela peça.
    """
    boxes = []
    for e in els:
        x0, y0, x1, y1 = [v * s for v, s in zip(e["bbox_norm"], (w, h, w, h))]
        boxes.append((x0, y0, x1, y1, (x1 - x0) * (y1 - y0)))

    out = {}
    for r in regions:
        if r["is_background"]:
            continue
        # ATENÇÃO: o motor mistura convenções no mesmo struct — `bbox` é
        # (linha, coluna) do skimage e `centroid` é (x, y) (regions.py:30).
        # Desempacotar como (y, x) colapsou 6 elementos em 3.
        cx, cy = r["centroid"]
        cand = [(area, i) for i, (x0, y0, x1, y1, area) in enumerate(boxes)
                if x0 <= cx <= x1 and y0 <= cy <= y1]
        if cand:
            out[r["id"]] = f"e{min(cand)[1]}"
    return out


# ------------------------------------------------------------ traçado -------

def verticality_deg(mask: np.ndarray) -> float:
    """Ângulo do traçado em relação à horizontal, 0° = deitado, 90° = em pé.

    Por PCA do eixo maior de cada componente, ponderado por área. A primeira
    versão diferenciava o esqueleto ordenado por x e dava 88-90° em ondas
    claramente horizontais: o esqueleto de uma máscara com várias peças salta
    entre componentes desconexos, e o salto vira um dy enorme para um dx nulo.
    """
    lab = measure.label(mask)
    props = [r for r in measure.regionprops(lab) if r.area > 50]
    if not props:
        return 0.0
    total = sum(r.area for r in props)
    # skimage: orientation é o ângulo entre o eixo das LINHAS e o eixo maior,
    # então 0 rad = eixo maior vertical. O que queremos é o complemento.
    return float(sum(
        (90.0 - abs(math.degrees(r.orientation))) * r.area for r in props
    ) / total)


# ------------------------------------------------------------- rota ---------

def route(el: dict, substrato: str) -> tuple[str, str]:
    """Técnica do elemento (doutrina §3.0 e §4). Devolve (rota, motivo)."""
    if el.get("aerografia"):
        return "AEROGRAFIA", ("zona de tom contínuo — não se corta e não se "
                              "imprime: vai à mão livre pelo setor de Aerografia")
    if el["tipo"] == "FAIXA":
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

    if el["menor_traco_mm"] >= CUT_MM_CONFIRMED:
        return "CORTE_MANUAL", (f"encosta em tinta e o traço de {el['menor_traco_mm']:.0f} mm "
                                f"é cortável — evita o ciclo de verniz")
    return "ADESIVO_SOBRE_VERNIZ", (f"encosta em tinta e o traço de {el['menor_traco_mm']:.0f} mm "
                                    f"está abaixo dos 14 mm confirmados")


# ------------------------------------------------------------ montagem ------

def rasterize(regions, w, h):
    layers = {}
    for r in regions:
        img = Image.new("L", (w, h), 0)
        d = ImageDraw.Draw(img)
        if len(r["contour"]) >= 3:
            d.polygon([tuple(p) for p in r["contour"]], fill=255)
        for hole in r.get("holes", []):
            if len(hole) >= 3:
                d.polygon([tuple(p) for p in hole], fill=0)
        layers[r["id"]] = img
    return layers


def build_elements(analysis, sem, canon, layers, w, h, px_per_cm):
    # A pintura geral é feita no dia anterior e chega curada: o adesivo assenta
    # direto sobre ela, sem verniz e sem espera. Por isso ela NÃO conta como
    # "tinta que se toca" — só duas cores do próprio desenho contam.
    campo = ("PINTURA_GERAL"
             if analysis["background"]["mode"] == "GENERAL_PAINT" else "CHAPA")

    # O motor elege UM índice como fundo (regions.py:247). O quantizador
    # rotineiramente parte o campo em tons próximos, e todos menos um passam a
    # contar como tinta — aí cada texto "encosta em tinta" e a arte inteira cai
    # na rota cara. Aqui o campo é um CONJUNTO: tudo a menos de ΔE do fundo.
    campo_lab = _lab(analysis["background"]["hex"])
    campo_hexes = {analysis["background"]["hex"]}
    for r in analysis["regions"]:
        if np.linalg.norm(_lab(r["hex"]) - campo_lab) < GRADIENT_DELTA_E:
            campo_hexes.add(r["hex"])
    # Com PINTURA GERAL o fundo É tinta: encostar nele é fronteira tinta-tinta,
    # não tinta-chapa. Sem isto, o texto do 137 PESCADOS — azul-marinho sobre
    # cinza pintado — saía como se estivesse sobre chapa nua e ia para a rota
    # barata. Reservas (branco preservado) não entram aqui: o motor já as marca
    # is_background e elas nunca viram elemento de tinta.

    regions = analysis["regions"]
    paint = [r for r in regions if not r["is_background"]]
    owner = assign(regions, sem, w, h)

    # Uma região cujo alcance extrapola muito a caixa do elemento não é dele:
    # o centroide caiu dentro por acaso. Sem este filtro, uma única região
    # espalhada leva a caixa do elemento para a face inteira.
    boxes = {f"e{i}": [v * sc for v, sc in zip(e["bbox_norm"], (w, h, w, h))]
             for i, e in enumerate(sem)}
    groups: dict[str, list] = defaultdict(list)
    for r in paint:
        # Zona fotográfica é item de produção próprio: vai à mão livre pelo
        # setor de Aerografia. Deixá-la ser absorvida pela caixa vizinha levou
        # a faixa inteira da "mar e rio" (7,3 m²) para a rota de aerografia só
        # porque o polvo caiu dentro dela.
        if r["kind"] == "FOTOGRAFICO":
            groups["aero"].append(r)
            continue
        gid = owner.get(r["id"], "avulso")
        if gid in boxes:
            bx0, by0, bx1, by1 = boxes[gid]
            ry0, rx0, ry1, rx1 = r["bbox"]
            cabe = ((rx1 - rx0) <= (bx1 - bx0) * 1.6 and
                    (ry1 - ry0) <= (by1 - by0) * 1.6)
            if not cabe:
                gid = "avulso"
        groups[gid].append(r)

    # T-T entre elementos DIFERENTES. Dentro do mesmo elemento não conta: o
    # degradê de uma faixa não é duas tintas se encontrando.
    by_id = by_id_all = {r["id"]: r for r in regions}
    touches: dict[str, bool] = defaultdict(bool)
    for b in analysis["boundaries"]:
        if b["kind"] != "PAINT_PAINT":
            continue
        ra, rb = by_id.get(b["a"]), by_id.get(b["b"])
        if not ra or not rb:
            continue
        # Encostar no campo não é duas cores do desenho se tocando.
        if ra["hex"] in campo_hexes or rb["hex"] in campo_hexes:
            continue
        ga, gb = owner.get(ra["id"], "avulso"), owner.get(rb["id"], "avulso")
        if ga == gb and canon.get(ra["hex"]) == canon.get(rb["hex"]):
            continue
        touches[ga] = touches[gb] = True

    els = []
    for gid, rs in groups.items():
        tipo = ("AEROGRAFIA" if gid == "aero"
                else "AVULSO" if gid == "avulso" else sem[int(gid[1:])]["kind"])
        if gid in ("avulso", "aero"):
            ys = [r["bbox"] for r in rs]
            bn = [min(b[1] for b in ys) / w, min(b[0] for b in ys) / h,
                  max(b[3] for b in ys) / w, max(b[2] for b in ys) / h]
        else:
            bn = sem[int(gid[1:])]["bbox_norm"]
        mask = np.zeros((h, w), dtype=bool)
        for r in rs:
            mask |= np.asarray(layers[r["id"]]) > 127
        tons = sorted({r["hex"] for r in rs})
        cores = sorted({canon.get(t, t) for t in tons})
        els.append({
            "id": gid, "tipo": tipo,
            "regioes": [r["id"] for r in rs],
            "area_m2": round(sum(r["area_m2"] for r in rs), 2),   # corte
            "area_tinta_m2": None,   # preenchido abaixo: consumo é por bounding
            "menor_traco_mm": round(min(r["min_stroke_mm"] for r in rs), 1),
            "cores": cores, "tons_originais": tons,
            "degrade": len(tons) > len(cores),
            "aerografia": any(by_id_all[r]["kind"] == "FOTOGRAFICO"
                              for r in [x["id"] for x in rs]),
            # Só duas cores DO DESENHO se tocando. A pintura geral não entra:
            # é feita no dia anterior e chega curada, então o adesivo assenta
            # direto sobre ela. Contá-la aqui jogava todos os 7 elementos do
            # 137 PESCADOS na rota de verniz + espera de uma vez.
            "toca_tinta": touches[gid],
            "campo": campo,
            "verticalidade_deg": round(verticality_deg(mask), 1),
            "bbox_norm": bn,
        })
    # Regiões que não caem em caixa nenhuma e somam quase nada são sujeira de
    # quantização. Viravam um "Adesivo — avulso" que não é nada e ainda puxava
    # um ciclo de verniz inteiro.
    els = [e for e in els
           if not (e["tipo"] == "AVULSO" and e["area_m2"] < AVULSO_MIN_M2)]
    for e in els:
        e["aerografia"] = e["tipo"] == "AEROGRAFIA"
        # G7: não se pinta um texto de 5 cm de altura exatamente — pinta-se a
        # janela inteira e a máscara bloqueia o resto. Consumo é pelo bounding.
        x0, y0, x1, y1 = el_bbox(e, layers, w, h, px_per_cm)
        e["area_tinta_m2"] = round((x1 - x0) * (y1 - y0)
                                   / (px_per_cm ** 2) / 10000, 2)
    return sorted(els, key=lambda e: -e["area_m2"])


MARGEM_CORTE_CM = 8.0   # folga entre o corte do plotter e a borda do adesivo


def el_bbox(el, layers, w, h, px_per_cm=None):
    """Caixa do adesivo: extensão real da forma + 8 cm de folga.

    Os 8 cm são o espaço entre o corte do plotter e a extremidade da folha —
    é a caixa física do vinil, não um enquadramento visual. Usar a caixa do
    Qwen cortava pedaços do desenho; usar a união crua das regiões, sem folga,
    encostava no traço.
    """
    pad = int((px_per_cm or 4.0) * MARGEM_CORTE_CM)
    x0, y0, x1, y1 = w, h, 0, 0
    for rid in el["regioes"]:
        ys, xs = np.nonzero(np.asarray(layers[rid]) > 127)
        if not len(xs):
            continue
        x0, y0 = min(x0, xs.min()), min(y0, ys.min())
        x1, y1 = max(x1, xs.max()), max(y1, ys.max())
    if x1 <= x0:
        return (0, 0, 1, 1)
    return (max(0, x0 - pad), max(0, y0 - pad),
            min(w - 1, x1 + pad), min(h - 1, y1 + pad))


def _label(d, box, texto, fill=(200, 30, 40)):
    x0, y0 = box[0], box[1]
    try:
        f = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 26)
    except OSError:
        f = ImageFont.load_default()
    tw = d.textlength(texto, font=f)
    d.rectangle([x0, max(0, y0 - 32), x0 + tw + 14, y0], fill=fill)
    d.text((x0 + 7, max(0, y0 - 30)), texto, fill=(255, 255, 255), font=f)


def boxes_image(orig, els, layers, w, h, px_per_cm):
    """Arte com a caixa de cada elemento — o mapa da peça antes de começar."""
    img = orig.copy().convert("RGB")
    d = ImageDraw.Draw(img)
    for e in els:
        box = el_bbox(e, layers, w, h, px_per_cm)
        d.rectangle(box, outline=(200, 30, 40), width=4)
        _label(d, box, e["tipo"].lower())
    return img


def silhouette_image(el, regions_by_id, layers, w, h, px_per_cm):
    """O desenho do adesivo: apenas o TRAÇO, sobre branco, com a caixa.

    Preenchido de preto lia como "área pintada"; o que sai do plotter é a linha
    de corte. Usa os contornos que o próprio motor devolveu.
    """
    img = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for rid in el["regioes"]:
        r = regions_by_id[rid]
        for ring in [r["contour"]] + r.get("holes", []):
            if len(ring) >= 2:
                d.line([tuple(pt) for pt in ring] + [tuple(ring[0])],
                       fill=(16, 18, 20), width=3, joint="curve")
    box = el_bbox(el, layers, w, h, px_per_cm)
    d.rectangle(box, outline=(200, 30, 40), width=4)
    _label(d, box, el["tipo"].lower())
    return img


def kraft_texture(w, h, seed=7):
    """Papel kraft procedural: base quente + fibra. Sem asset externo."""
    rng = np.random.default_rng(seed)
    base = np.zeros((h, w, 3), dtype=np.float64)
    base[..., 0], base[..., 1], base[..., 2] = 197, 163, 109
    grain = rng.normal(0, 7, (h, w, 1))
    fibra = rng.normal(0, 4, (h, 1, 1)) + rng.normal(0, 3, (1, w, 1))
    manchas = ndimage.gaussian_filter(rng.normal(0, 26, (h, w, 1)), 22)
    out = np.clip(base + grain + fibra + manchas, 90, 245)
    return Image.fromarray(out.astype(np.uint8))


def janelas(els, layers, w, h, px_per_cm, folga=22):
    """Onde o papel NÃO vai.

    Adesivo é uma folha de vinil retangular: a janela é a caixa, e empapela-se
    em volta dela. Fita não — ela acompanha a curva, então ali a janela segue a
    forma com folga. Tratar a faixa como retângulo fazia a janela dela tomar a
    face inteira e não sobrava papel nenhum para mostrar.
    """
    mask = np.zeros((h, w), dtype=bool)
    for e in els:
        if e["rota"].startswith("FITA"):
            forma = np.zeros((h, w), dtype=bool)
            for rid in e["regioes"]:
                forma |= np.asarray(layers[rid]) > 127
            mask |= morphology.dilation(forma, morphology.disk(folga))
        else:
            x0, y0, x1, y1 = el_bbox(e, layers, w, h, px_per_cm)
            mask[int(y0):int(y1) + 1, int(x0):int(x1) + 1] = True
    return mask


def kraft_image(under, els, layers, w, h, px_per_cm, folha_cm=100.0):
    """Empapelamento em folhas de kraft de 100 cm, com as janelas abertas."""
    img = kraft_texture(w, h)
    d = ImageDraw.Draw(img)
    passo = max(40, int(folha_cm * px_per_cm))
    for x in range(passo, w, passo):                      # emendas do rolo
        d.line([(x, 0), (x, h)], fill=(150, 118, 74), width=3)
        d.line([(x + 3, 0), (x + 3, h)], fill=(214, 182, 130), width=2)

    j = janelas(els, layers, w, h, px_per_cm)
    img.paste(under.convert("RGB"), (0, 0),
              Image.fromarray((j * 255).astype(np.uint8), mode="L"))
    borda = j & ~morphology.erosion(j, morphology.disk(3))
    img.paste((120, 92, 52), (0, 0),
              Image.fromarray((borda * 255).astype(np.uint8), mode="L"))
    return img


def state_sob_papel(kraft, els, layers, regions, painted, now, w, h, px_per_cm):
    """Estado da pintura visto pelas janelas — o kraft continua na peça.

    O papel só sai no fim; mostrar a face limpa entre demãos daria a impressão
    de que ele é removido e recolocado a cada cor.
    """
    face = Image.new("RGB", (w, h), (250, 250, 250))
    by_id = {r["id"]: r for r in regions}
    for rid in painted:
        face.paste(by_id[rid]["hex"], (0, 0), layers[rid])
    for rid in now:
        face.paste(by_id[rid]["hex"], (0, 0), layers[rid])
    out = kraft.copy()
    j = janelas(els, layers, w, h, px_per_cm)
    out.paste(face, (0, 0), Image.fromarray((j * 255).astype(np.uint8), mode="L"))
    return out


def state(size, layers, regions, painted, now, masked):
    w, h = size
    canvas = Image.new("RGB", (w, h), (248, 249, 250))
    by_id = {r["id"]: r for r in regions}
    for rid in painted:
        if by_id[rid]["hex"] != MULTI:
            canvas.paste(by_id[rid]["hex"], (0, 0), layers[rid])
    for rid in masked:
        canvas.paste("#A5A8AC", (0, 0), layers[rid])
    for rid in now:
        canvas.paste(by_id[rid]["hex"], (0, 0), layers[rid])
    return canvas


def chapa_nua(els, regions_by_id, layers, w, h, px_per_cm):
    """A face antes de qualquer tinta: chapa branca e o traço dos adesivos."""
    img = Image.new("RGB", (w, h), (250, 250, 250))
    d = ImageDraw.Draw(img)
    for e in els:
        for rid in e["regioes"]:
            r = regions_by_id[rid]
            for ring in [r["contour"]] + r.get("holes", []):
                if len(ring) >= 2:
                    d.line([tuple(pt) for pt in ring] + [tuple(ring[0])],
                           fill=(120, 124, 128), width=2, joint="curve")
    return img


def partes_de(els, layers, canon, by_id, w, h, px_per_cm):
    """Uma PARTE por (elemento, cor) — cada uma com sua própria caixa.

    O adesivo é um só, mas o papel que cobre uma cor já pintada acompanha a
    caixa daquela parte, não a do elemento inteiro: no BURES o "RES" laranja e
    o "BU" azul vivem no mesmo adesivo e são cobertos em momentos diferentes.
    """
    out = []
    for e in els:
        por_cor: dict[str, list[str]] = defaultdict(list)
        for rid in e["regioes"]:
            por_cor[canon.get(by_id[rid]["hex"], by_id[rid]["hex"])].append(rid)
        for cor, ids in por_cor.items():
            out.append({
                "elemento": e["tipo"], "cor": cor, "regioes": ids,
                "bbox": el_bbox({"regioes": ids}, layers, w, h, px_per_cm),
            })
    return out


def territorios(partes, layers, w, h):
    """Reparte a superfície: cada pixel pertence à peça cuja FORMA está mais perto.

    Caixas de peças vizinhas se sobrepõem — a do "nome" cobre boa parte da do
    "tagline", logo abaixo. Subtrair caixa de caixa fazia uma apagar a outra
    (o papel do tagline sumia e voltava a seguir as letras); não subtrair fazia
    o papel invadir a caixa do telefone.

    Repartir por proximidade resolve as duas: os papéis se encostam sem se
    sobrepor, cada um mandando no seu pedaço.
    """
    marca = np.zeros((h, w), dtype=np.int32)
    for i, pt in enumerate(partes, start=1):
        for rid in pt["regioes"]:
            marca[np.asarray(layers[rid]) > 127] = i
    _, (iy, ix) = ndimage.distance_transform_edt(marca == 0, return_indices=True)
    return marca[iy, ix]


def cobertura_mask(partes_cor, pendentes, layers, w, h, px_per_cm, dono,
                   indices_cor, folga_cm=1.5):
    """Papel sobre a cor recém-pintada: a CAIXA da peça, dentro do território dela.

    A caixa é o que o pintor consegue cobrir — não dá para recortar papel rente
    a uma letra. O território impede que essa caixa invada a peça vizinha. E as
    formas ainda por pintar ficam expostas, com folga.
    """
    mask = np.zeros((h, w), dtype=bool)
    meu = np.isin(dono, indices_cor)
    for pt in partes_cor:
        x0, y0, x1, y1 = [int(v) for v in pt["bbox"]]
        bloco = np.zeros((h, w), dtype=bool)
        bloco[y0:y1 + 1, x0:x1 + 1] = True
        mask |= bloco & meu

    if pendentes:
        buraco = np.zeros((h, w), dtype=bool)
        for pt in pendentes:
            for rid in pt["regioes"]:
                buraco |= np.asarray(layers[rid]) > 127
        raio = max(2, int(px_per_cm * folga_cm))
        mask &= ~morphology.dilation(buraco, morphology.disk(raio))
    return mask


def merge_boxes(boxes, gap=0):
    """Une caixas que se tocam, para reduzir a quantidade delas.

    O verniz cobre tudo o que foi pintado, então duas caixas encostadas viram
    uma passada só — não faz sentido tratá-las como duas.
    """
    out = [list(b) for b in boxes]
    mudou = True
    while mudou:
        mudou = False
        for i in range(len(out)):
            for j in range(i + 1, len(out)):
                a, b = out[i], out[j]
                if (a[0] - gap <= b[2] and b[0] - gap <= a[2] and
                        a[1] - gap <= b[3] and b[1] - gap <= a[3]):
                    out[i] = [min(a[0], b[0]), min(a[1], b[1]),
                              max(a[2], b[2]), max(a[3], b[3])]
                    out.pop(j)
                    mudou = True
                    break
            if mudou:
                break
    return [tuple(b) for b in out]


def face_pintada(layers, regions, painted, orig, degrade_ids, els=None):
    """Face com o que já foi pintado.

    Regiões de elemento em degradê saem com os PIXELS DO ORIGINAL, não com a
    cor canônica chapada: o motor separa o degradê em bandas, e pintar as
    bandas mostrava três divisões nítidas onde a peça real é suavizada.
    """
    w, h = orig.size
    face = Image.new("RGB", (w, h), (250, 250, 250))
    by_id = {r["id"]: r for r in regions}
    # O traço do adesivo continua visível onde ainda não entrou tinta — some
    # sozinho conforme cada cor é pintada por cima.
    if els:
        d = ImageDraw.Draw(face)
        for e in els:
            for rid in e["regioes"]:
                if rid in painted:
                    continue
                r = by_id[rid]
                for ring in [r["contour"]] + r.get("holes", []):
                    if len(ring) >= 2:
                        d.line([tuple(pt) for pt in ring] + [tuple(ring[0])],
                               fill=(120, 124, 128), width=2, joint="curve")
    for rid in painted:
        # `#multi` não é cor chapada: é aerografia. Como o degradê, sai dos
        # pixels do original — é a única representação honesta de tom contínuo.
        if rid in degrade_ids or by_id[rid]["hex"] == MULTI:
            face.paste(orig, (0, 0), layers[rid])
        else:
            face.paste(by_id[rid]["hex"], (0, 0), layers[rid])
    return face


def compor(kraft, els, layers, w, h, px_per_cm, face, papel=None):
    """Kraft + face vista pelas janelas + o papel de cobertura por cima."""
    out = kraft.copy()
    j = janelas(els, layers, w, h, px_per_cm)
    out.paste(face, (0, 0), Image.fromarray((j * 255).astype(np.uint8), mode="L"))
    if papel is not None and papel.any():
        out.paste((198, 164, 110), (0, 0),
                  Image.fromarray((papel * 255).astype(np.uint8), mode="L"))
        borda = papel & ~morphology.erosion(papel, morphology.disk(2))
        out.paste((150, 118, 74), (0, 0),
                  Image.fromarray((borda * 255).astype(np.uint8), mode="L"))
    return out


def sessoes_por_cor(por_cor, analysis, by_id, canon):
    """Agrupa cores que NÃO se tocam — cada grupo é uma sessão.

    Regra do dono: pinta de uma vez todas as cores que não se encontram,
    mascara todas, corta, e só então entra o próximo grupo. O número de
    sessões é o **número cromático** do grafo "cores que se tocam", não o
    número de cores.

    Sem isto o 137 PESCADOS viraria 26 passos por ter 7 cores, quando o
    pintor resolve com uma folha e algumas depilações.

    Coloração gulosa por grau decrescente — o grafo é planar, então ela fica
    em 3-4 grupos na prática.
    """
    adj: dict[str, set[str]] = {c: set() for c in por_cor}
    for b in analysis["boundaries"]:
        if b["kind"] != "PAINT_PAINT":
            continue
        ra, rb = by_id.get(b["a"]), by_id.get(b["b"])
        if not ra or not rb:
            continue
        ca = canon.get(ra["hex"], ra["hex"])
        cb = canon.get(rb["hex"], rb["hex"])
        if ca != cb and ca in adj and cb in adj:
            adj[ca].add(cb)
            adj[cb].add(ca)

    grupo: dict[str, int] = {}
    for c in sorted(por_cor, key=lambda c: -len(adj[c])):
        usados = {grupo[v] for v in adj[c] if v in grupo}
        g = 0
        while g in usados:
            g += 1
        grupo[c] = g
    return grupo, adj


def build_steps(analysis, els, layers, size, outdir, canon, orig, px_per_cm):
    """Sequência do chão de fábrica.

    A ordem das cores é a do dono: sempre a de MENOR área primeiro, porque é
    mais fácil de cobrir depois. Cada cor pintada é coberta antes da seguinte.
    """
    w, h = size
    regions = analysis["regions"]
    by_id = {r["id"]: r for r in regions}
    geral = analysis["background"]["mode"] == "GENERAL_PAINT"
    steps, painted, cobertos = [], [], []

    def add(tipo, titulo, detalhe, img, **extra):
        # JPEG a 1800 px: a textura do kraft é ruído e em PNG a página passava
        # de 19 MB, acima do teto de 16 MB do artefato.
        n = len(steps) + 1
        path = f"img/passo_{n:02d}.jpg"
        out = img.copy()
        out.thumbnail((1800, 1800), Image.LANCZOS)
        out.convert("RGB").save(outdir / path, "JPEG", quality=84, optimize=True)
        steps.append({"n": n, "tipo": tipo, "titulo": titulo,
                      "detalhe": detalhe, "img": path, **extra})

    if geral:
        # A geral ocupa o primeiro dia inteiro: lavar, empapelar o implemento,
        # pintar e curar. Os adesivos só entram no dia seguinte — é por isso
        # que encostar nela depois não custa verniz nem espera.
        add("PREPARO", "Lavagem",
            "Lavar e desengraxar a face inteira. Existe porque há pintura geral.",
            orig.copy())
        add("PREPARO", "Empapelamento do implemento",
            "Cobrir perfis de borda, borrachas, ferragens e a faixa refletiva — "
            "nada disso recebe tinta.", orig.copy())
        add("PINTURA", "Pintura geral",
            f"Fundo e cor geral ({analysis['background']['hex']}) em toda a face. "
            f"Cura até o dia seguinte; só então entram os adesivos.",
            Image.new("RGB", (w, h), analysis["background"]["hex"]))

    add("PREPARO", "Conferência da face curada" if geral else "Limpeza",
        (("A geral está curada — daqui em diante o adesivo assenta direto "
          "sobre ela.") if geral else
         ("Limpar a face. Sem pintura geral não há lavagem completa nem "
          "empapelamento do implemento."))
        + f" As {len(els)} caixas marcam onde cada elemento entra, com 8 cm de "
          f"folga entre o desenho e a borda do adesivo.",
        boxes_image(orig, els, layers, w, h, px_per_cm))

    for e in [x for x in els if x["tipo"] != "FAIXA"]:
        add("ADESIVO", f"Adesivo — {e['tipo'].lower()}",
            f"{e['motivo']}. Traço de corte do plotter; a folha vai inteira "
            f"({e['area_m2']} m²) e a depilação libera cada cor na sua vez.",
            silhouette_image(e, by_id, layers, w, h, px_per_cm),
            rota=e["rota"], elemento=e["tipo"])

    for e in [x for x in els if x["tipo"] == "FAIXA"]:
        add("FITA", f"{e['rota'].replace('_',' ').title()} — faixa",
            f"{e['motivo']}. {e['area_m2']} m². A fita delimita e a tinta entra: "
            f"sem adesivo e sem corte.",
            silhouette_image(e, by_id, layers, w, h, px_per_cm),
            rota=e["rota"], elemento=e["tipo"])

    nua = chapa_nua(els, by_id, layers, w, h, px_per_cm)
    kraft = kraft_image(nua, els, layers, w, h, px_per_cm)
    folhas = math.ceil(w / max(1, int(100 * px_per_cm)))
    add("PREPARO", "Empapelamento",
        f"Kraft em folhas de 100 cm ({folhas} nesta face) em volta das janelas. "
        f"Ainda não há tinta nenhuma na peça — só a chapa e o traço dos adesivos.",
        kraft)

    # Menor área primeiro: é mais fácil de cobrir depois.
    por_cor: dict[str, list[str]] = defaultdict(list)
    degrade_de: dict[str, list[str]] = {}
    degrade_ids: set[str] = set()
    area_cor: dict[str, float] = defaultdict(float)
    for e in els:
        for rid in e["regioes"]:
            c = canon.get(by_id[rid]["hex"], by_id[rid]["hex"])
            por_cor[c].append(rid)
            area_cor[c] += by_id[rid]["area_m2"]
        if e["degrade"] and len(e["tons_originais"]) > 1:
            degrade_de[e["cores"][0]] = e["tons_originais"]
            degrade_ids.update(e["regioes"])

    grupo, adj = sessoes_por_cor(por_cor, analysis, by_id, canon)
    sessoes: dict[int, list[str]] = defaultdict(list)
    for cor, g in grupo.items():
        sessoes[g].append(cor)
    # menor área primeiro, também entre sessões
    ordem_s = sorted(sessoes, key=lambda g: sum(area_cor[c] for c in sessoes[g]))

    partes = partes_de(els, layers, canon, by_id, w, h, px_per_cm)
    dono = territorios(partes, layers, w, h)
    pintadas: set[str] = set()
    papel = np.zeros((h, w), dtype=bool)

    for i, g in enumerate(ordem_s):
        cores_g = sorted(sessoes[g], key=lambda c: area_cor[c])
        ids = [r for c in cores_g for r in por_cor[c]]
        area_g = sum(area_cor[c] for c in cores_g)
        swatches = ", ".join(cores_g)
        tons = [t for c in cores_g for t in (degrade_de.get(c) or [])]

        face = face_pintada(layers, regions, painted + ids, orig, degrade_ids, els)
        add("PINTURA", f"Sessão {i + 1} — {len(cores_g)} cor(es)",
            f"{swatches}. {area_g:.2f} m². "
            + ("Nenhuma destas cores encosta em outra da mesma sessão, então "
               "todas entram na mesma demão."
               if len(cores_g) > 1 else "Cor isolada nesta sessão.")
            + (f" Degradê suavizado: {', '.join(tons)}." if tons else ""),
            compor(kraft, els, layers, w, h, px_per_cm, face, papel),
            cor=cores_g[0], cores=cores_g)
        painted.extend(ids)
        pintadas.update(cores_g)

        if i < len(ordem_s) - 1:
            desta = [pt for pt in partes if pt["cor"] in cores_g]
            pendentes = [pt for pt in partes if pt["cor"] not in pintadas]
            idx = [k for k, pt in enumerate(partes, start=1) if pt["cor"] in cores_g]
            papel = papel | cobertura_mask(desta, pendentes, layers, w, h,
                                           px_per_cm, dono, idx)
            add("PREPARO", f"Cobrir sessão {i + 1}",
                f"Papel sobre {swatches}, na caixa de cada parte e dentro do "
                f"território dela. {len(pendentes)} parte(s) ainda por pintar.",
                compor(kraft, els, layers, w, h, px_per_cm, face, papel))

    face_final = face_pintada(layers, regions, painted, orig, degrade_ids, els)
    add("PREPARO", "Remover o papel das cores",
        "Sai só o papel que protegia as cores entre si. O empapelamento da face "
        "continua.",
        compor(kraft, els, layers, w, h, px_per_cm, face_final))

    # O verniz vai exatamente onde o adesivo está — retângulo nos adesivos,
    # banda acompanhando a fita. Fundir com folga juntava tudo numa caixa que
    # atravessava a face (a faixa vai de ponta a ponta e puxava o resto),
    # envernizando kraft vazio dos dois lados da logo.
    verniz_mask = janelas(els, layers, w, h, px_per_cm)
    adesivos = [el_bbox(e, layers, w, h, px_per_cm)
                for e in els if not e["rota"].startswith("FITA")]
    caixas = merge_boxes(adesivos, gap=0)

    verniz = compor(kraft, els, layers, w, h, px_per_cm, face_final)
    azul = Image.new("RGB", (w, h), (150, 190, 230))
    verniz = Image.composite(
        Image.blend(verniz, azul, 0.22), verniz,
        Image.fromarray((verniz_mask * 255).astype(np.uint8), mode="L"))
    borda = verniz_mask & ~morphology.erosion(verniz_mask, morphology.disk(3))
    verniz.paste((60, 120, 190), (0, 0),
                 Image.fromarray((borda * 255).astype(np.uint8), mode="L"))
    add("VERNIZ", "Verniz sobre o que foi pintado",
        f"Verniz na área de cada adesivo e na banda da fita — não há como "
        f"envernizar só o desenho, mas também não se enverniza chapa vazia. "
        f"{len(adesivos)} adesivos viram {len(caixas)} passada(s) por se "
        f"sobreporem; a faixa entra como banda própria.", verniz)

    add("PREPARO", "Remover o empapelamento",
        "Sai todo o kraft e o que restou de adesivo. Depois: faixa refletiva.",
        face_pintada(layers, regions, painted, orig, degrade_ids))
    return steps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("analysis"); ap.add_argument("art")
    ap.add_argument("--out", required=True)
    ap.add_argument("--substrato", default="CHAPA")
    ap.add_argument("--backend", default="openrouter")
    ap.add_argument("--model", default="qwen/qwen3-vl-32b-instruct")
    args = ap.parse_args()

    analysis = json.loads(Path(args.analysis).read_text())
    img = analysis["image"]; w, h = img["workWidthPx"], img["workHeightPx"]
    outdir = Path(args.out); (outdir / "img").mkdir(parents=True, exist_ok=True)

    orig = load(args.art); orig.thumbnail((w, h), Image.LANCZOS)
    orig.save(outdir / "img/original.jpg", quality=88)

    px_per_cm = img['workWidthPx'] / img['widthCm']
    canon = merge_gradient(analysis["regions"], analysis["boundaries"])
    fundidos = {k: v for k, v in canon.items() if k != v}
    print(f"  fusão de tons: {len(fundidos)} tom(ns) absorvido(s) {fundidos}",
          file=sys.stderr)

    sem = semantic(args.art, args.backend, args.model)
    layers = rasterize(analysis["regions"], w, h)
    els = build_elements(analysis, sem, canon, layers, w, h, px_per_cm)
    for e in els:
        e["rota"], e["motivo"] = route(e, args.substrato)

    steps = build_steps(analysis, els, layers, (w, h), outdir, canon, orig, px_per_cm)

    rep = {
        "arte": Path(args.art).name,
        "comprimento_cm": img["widthCm"], "altura_cm": img["heightCm"],
        "area_m2": img["areaM2"], "px_por_cm": round(img["pxPerCmOriginal"], 2),
        "fundo": analysis["background"], "substrato": args.substrato,
        "tons_fundidos": fundidos,
        "elementos": els, "passos": steps,
        "alertas": analysis.get("alerts", []),
    }
    (outdir / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2))

    print(f"\nelementos: {len(els)}")
    for e in els:
        print(f"  {e['tipo']:<10} {e['area_m2']:>5} m²  {len(e['cores'])} cor(es)  "
              f"vert {e['verticalidade_deg']:>4}°  toca_tinta={e['toca_tinta']}  "
              f"-> {e['rota']}")
    print(f"passos: {len(steps)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
