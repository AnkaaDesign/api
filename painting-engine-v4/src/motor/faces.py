"""Comparação lateral × traseira — a traseira é RECOMPOSIÇÃO, nunca escala.

Discriminante barato (ACM): contar hexes chapados idênticos entre as faces
ANTES de assumir mapa afim. Se batem, o hex é transferível e cor divergente é
DEFEITO DE ARTE. Se não batem (137), cada face tem exposição própria e o PNG
não carrega a cor real da tinta em face nenhuma.

Conteúdo: sem leitura de texto (CV puro), a comparação é ESTRUTURAL — um
elemento de texto sem contraparte de proporção parecida na outra face vira
suspeita de truncamento/divergência para revisão humana (o caso "us seja
sempre louvado").
"""
from __future__ import annotations

import numpy as np

from .cor import delta_e, srgb_para_lab


def comparar(analise_lat: dict, analise_tra: dict) -> dict:
    out = {"defeitos": [], "divergencias": [], "hexes_transferiveis": None}

    hex_lat = {
        c["hex_ancora"] for c in analise_lat["paleta"]["classes"] if c["tipo"] == "chapada"
    }
    hex_tra = {
        c["hex_ancora"] for c in analise_tra["paleta"]["classes"] if c["tipo"] == "chapada"
    }
    menor = min(len(hex_lat), len(hex_tra)) or 1
    inter = hex_lat & hex_tra
    transfer = len(inter) >= 0.7 * menor
    out["hexes_transferiveis"] = transfer
    out["hexes_comuns"] = sorted(inter)

    if transfer:
        # cor da traseira sem par exato na lateral: defeito se houver vizinho a ΔE 5–16
        so_tra = hex_tra - hex_lat
        for hx in sorted(so_tra):
            rgb = np.array([int(hx[1:3], 16), int(hx[3:5], 16), int(hx[5:7], 16)])
            lab = srgb_para_lab(rgb)
            melhor = None
            for hy in sorted(hex_lat):
                rgb2 = np.array([int(hy[1:3], 16), int(hy[3:5], 16), int(hy[5:7], 16)])
                d = float(delta_e(lab, srgb_para_lab(rgb2)))
                if melhor is None or d < melhor[1]:
                    melhor = (hy, d)
            if melhor and 3.0 < melhor[1] < 16.0:
                out["defeitos"].append({
                    "tipo": "cor-diverge-entre-faces",
                    "detalhe": (
                        f"traseira usa {hx} onde a lateral usa {melhor[0]} (ΔE {melhor[1]:.1f}) "
                        f"— o render é comum às faces (hexes batem), logo isto é DEFEITO DE "
                        f"ARTE, não exposição"
                    ),
                })
    else:
        out["divergencias"].append({
            "tipo": "exposicao-por-face",
            "detalhe": (
                "as cores chapadas NÃO batem hex a hex entre as faces — cada face tem "
                "exposição própria; o PNG não carrega a cor real da tinta. Cor real: "
                "catálogo/cliente"
            ),
        })

    # comparação de CONTEÚDO dos textos entre faces, por FORMA (sem OCR):
    # rasteriza os dois na mesma altura, desliza e mede a tinta do maior que
    # o menor não cobre. Recomposição normal cobre ~100%; truncamento deixa
    # a cabeça órfã (o "us seja sempre louvado" do 137 perde o "De" = ~13%).
    def _textos(a):
        return [
            e for e in a["elementos"]
            if e["tipo"] == "TEXTO" and e["dim_mm"]["w"] > 300
        ]

    lats = _textos(analise_lat)
    tras = _textos(analise_tra)
    # casa pelo PRÓPRIO conteúdo (menor tinta órfã), não pela proporção — a
    # proporção confunde textos diferentes de aspecto parecido
    pares = []
    for li, el in enumerate(lats):
        asp = el["dim_mm"]["w"] / max(1, el["dim_mm"]["h"])
        for ti, t in enumerate(tras):
            asp_t = t["dim_mm"]["w"] / max(1, t["dim_mm"]["h"])
            if abs(asp - asp_t) / asp > 0.5:
                continue
            orfa = _tinta_orfa(analise_lat, el, analise_tra, t)
            if orfa is not None:
                pares.append((orfa, li, ti))
    pares.sort()
    li_usados, ti_usados = set(), set()
    conferencia = []
    for orfa, li, ti in pares:
        if li in li_usados or ti in ti_usados:
            continue
        li_usados.add(li)
        ti_usados.add(ti)
        el, t = lats[li], tras[ti]
        conferencia.append({
            "lateral": {"id": el["id"], "dim_mm": el["dim_mm"]},
            "traseira": {"id": t["id"], "dim_mm": t["dim_mm"]},
            "orfa_pct": round(orfa * 100),
        })
        # o ruído de render entre faces chega a ~30% mesmo em pares idênticos
        # (medido no 137) — só divergência GRITANTE vira alerta automático;
        # o resto é conferência HUMANA no painel de textos (é assim que se
        # pega 'us seja sempre louvado' e PRODUTROS)
        if orfa > 0.45:
            out["divergencias"].append({
                "tipo": "conteudo-texto-divergente",
                "detalhe": (
                    f"o texto de {el['dim_mm']['w']}×{el['dim_mm']['h']} mm da lateral e o "
                    f"par de {t['dim_mm']['w']}×{t['dim_mm']['h']} mm da traseira divergem "
                    f"muito ({orfa*100:.0f}% sem par) — conferir o conteúdo antes de plotar"
                ),
                "confianca": "baixa",
            })
    for li, el in enumerate(lats):
        if li not in li_usados and tras:
            conferencia.append({
                "lateral": {"id": el["id"], "dim_mm": el["dim_mm"]},
                "traseira": None, "orfa_pct": None,
            })
            out["divergencias"].append({
                "tipo": "texto-sem-contraparte",
                "detalhe": (
                    f"texto da lateral ({el['dim_mm']['w']}×{el['dim_mm']['h']} mm) sem "
                    "contraparte na traseira — conferir se falta conteúdo"
                ),
                "confianca": "baixa",
            })
    out["conferencia_textos"] = conferencia
    return out


def _mascara_texto(analise: dict, elem: dict, altura_px: int = 120):
    """Rasteriza o elemento de texto a partir dos polígonos do quadro."""
    from PIL import Image, ImageDraw
    q = analise.get("quadro")
    if not q:
        return None
    d = elem["dim_mm"]
    x0, y0, x1, y1 = d["x"], d["y"], d["x"] + d["w"], d["y"] + d["h"]
    esc = altura_px / max(1.0, d["h"])
    w_px = max(2, int(round(d["w"] * esc)))
    im = Image.new("1", (w_px, altura_px), 0)
    dr = ImageDraw.Draw(im)
    classes_el = set(elem.get("classes") or [])
    for cg in q["classes"]:
        if cg["campo"] or (classes_el and cg["classe"] not in classes_el):
            continue
        for p_ in cg["poligonos"]:
            pts = p_["pontos"]
            cx = sum(pt[0] for pt in pts) / len(pts)
            cy = sum(pt[1] for pt in pts) / len(pts)
            if not (x0 - 5 <= cx <= x1 + 5 and y0 - 5 <= cy <= y1 + 5):
                continue
            poly = [((pt[0] - x0) * esc, (pt[1] - y0) * esc) for pt in pts]
            dr.polygon(poly, fill=0 if p_["furo"] else 1)
    return np.array(im, dtype=np.uint8)


def _tinta_orfa(a_lat: dict, el_lat: dict, a_tra: dict, el_tra: dict):
    """Fração da tinta do texto MAIOR sem par no melhor alinhamento x.

    Usa o PERFIL DE TINTA exportado pela análise (fiel aos labels; os bins já
    normalizam a altura — mesmo conteúdo em escalas diferentes dá perfis do
    mesmo comprimento)."""
    p1, p2 = el_lat.get("perfil"), el_tra.get("perfil")
    if not p1 or not p2:
        return None
    col1 = np.array(p1, dtype=np.float32)
    col2 = np.array(p2, dtype=np.float32)
    if col2.size > col1.size:
        col1, col2 = col2, col1
    if col1.sum() < 1 or col2.sum() < 1:
        return None
    # normaliza intensidade (exposição difere entre faces)
    col1 = col1 / col1.mean()
    col2 = col2 / col2.mean()
    folga = col1.size - col2.size
    melhor = 0.0
    for dx in range(0, folga + 1):
        cobre = np.minimum(col1[dx:dx + col2.size], col2).sum()
        if cobre > melhor:
            melhor = cobre
    total = col1.sum()
    return float(1.0 - melhor / total) if total else None
