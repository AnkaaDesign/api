"""Detectores do §7 da doutrina — mede o que decide a estratégia de produção.

Por elemento, produz os sinais que a árvore de decisão consome:

  menor_traco_mm   eixo medial × px_per_cm   — o estilete rasga abaixo do limiar
  compacidade      P²/(4πA)                  — letra chapada ~1-3; filigrana explode
  sobre            CHAPA | TINTA             — ⭐ o sinal forte (doutrina §7.1)
  textura          CHAPADO|DEGRADE|AEROGRAFIA por resíduo do ajuste de L*
  internal_split   parte chapada + parte em degradê dentro do MESMO elemento

Uso:
    .venv/bin/python probe/difficulty.py "<arte>"
    .venv/bin/python probe/difficulty.py "<arte>" --json
    .venv/bin/python probe/difficulty.py "../../layout database/"*.png --rank menor_traco_mm
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage
from skimage import color as skcolor
from skimage import measure, morphology

sys.path.insert(0, str(Path(__file__).parent))
from common import load  # noqa: E402
from render import declutter, is_background, quantize  # noqa: E402

WORK_MAX = 1800
MIN_AREA_FRAC = 0.0005   # abaixo disto é ruído de quantização, não elemento

# Comprimentos reais aparecem no nome do arquivo em boa parte do acervo
# ("3 IRMÃOS 8,40 lateral", "argus 14,70", "ACM 8,30m"). Usar isso evita
# inventar escala — e escala errada JÁ inverteu decisões nas análises antigas
# (o contorno do "3" virou "<6 mm" quando tem 5 cm).
LEN_RX = re.compile(r"(\d{1,2})[,.](\d{2})\s*m?\b")
DEFAULT_LENGTH_M = 12.0


def length_from_name(path: str) -> tuple[float, bool]:
    m = LEN_RX.search(Path(path).stem)
    if m:
        return float(f"{m.group(1)}.{m.group(2)}"), True
    return DEFAULT_LENGTH_M, False


def photo_zones(img: Image.Image, thresh: float = 4.2) -> np.ndarray:
    """Máscara das zonas fotográficas / de aerografia, por entropia local.

    Existe para EXCLUIR essas áreas, não para orçá-las. Quantizar um bloco
    fotográfico o estilhaça em dezenas de lascas finas; como a calibração de
    cortabilidade ordena por traço mais fino, essas lascas dominavam o topo da
    lista e a folha inteira virou fragmento de foto. E aerografia não se corta:
    perguntar "você corta isto?" sobre ela não tem resposta útil.
    """
    from skimage.filters.rank import entropy

    gray = np.array(img.convert("L"))  # array de escrita: rank.entropy recusa read-only
    ent = entropy(gray, morphology.disk(9))
    zone = ent > thresh
    zone = morphology.remove_small_objects(zone, 400)
    return morphology.closing(zone, morphology.disk(7))


def min_stroke_mm(mask: np.ndarray, px_per_cm: float) -> float:
    """Largura do traço mais fino do elemento, em mm.

    Distância ao fundo medida sobre o esqueleto: cada ponto do eixo medial
    guarda o raio do maior círculo que cabe ali. O menor deles (percentil 5,
    para não capturar a ponta de uma serifa) dobrado é a espessura mínima.
    """
    if mask.sum() < 20:
        return 0.0
    dist = ndimage.distance_transform_edt(mask)
    skel = morphology.skeletonize(mask)
    radii = dist[skel]
    if radii.size == 0:
        return 0.0
    return float(np.percentile(radii, 5) * 2 / px_per_cm * 10)


def compactness(region) -> float:
    """P²/(4πA). Círculo = 1. Letra chapada 1–3. Script rendilhado dispara."""
    p = region.perimeter
    a = region.area
    return float(p * p / (4 * math.pi * a)) if a > 0 else 0.0


def vertices_per_m(mask: np.ndarray, px_per_cm: float) -> float:
    """Vértices por metro de contorno depois de simplificar a 0,5 cm.

    Mede RETILINEIDADE, que é o segundo eixo da cortabilidade — e o que a
    espessura sozinha não explicava. Os triângulos do ACM são cor-tocando-cor
    e mesmo assim são cortados à mão: retos, poucos vértices, estilete corre.
    Um script tem a mesma espessura e é incortável porque muda de direção o
    tempo todo.

    Triângulo: ~3 vértices em vários metros → perto de 1/m.
    Script/filigrana: dezenas por metro.
    """
    cs = measure.find_contours(mask.astype(float), 0.5)
    if not cs:
        return 0.0
    contour = max(cs, key=len)
    per_m = len(contour) / px_per_cm / 100
    if per_m <= 0:
        return 0.0
    simple = measure.approximate_polygon(contour, tolerance=px_per_cm * 0.5)
    return round(len(simple) / per_m, 1)


def substrate_of(mask: np.ndarray, labels: np.ndarray, bgset) -> tuple[str, int]:
    """O elemento pousa sobre chapa nua ou sobre tinta? (doutrina §7.1)

    Este é o sinal forte. O "Frutícula 2 Amigos" tem letra de ~1 m — tamanho
    nunca foi o problema. Ele é incortável à mão porque está SOBRE o banner
    pintado e envernizado, e ali o estilete rasgaria a camada de baixo.
    """
    ring = morphology.dilation(mask, morphology.disk(6)) & ~mask
    if not ring.any():
        return "INDEFINIDO", -1
    vals = labels[ring]
    dominant = int(np.bincount(vals).argmax())
    bgset = bgset if isinstance(bgset, (set, frozenset)) else {bgset}
    return ("CHAPA" if dominant in bgset else "TINTA"), dominant


def interior(mask: np.ndarray, erode: int = 3) -> np.ndarray:
    """Miolo do elemento, sem o anel de antialias.

    A máscara vem dos rótulos QUANTIZADOS, mas L* é lido da imagem ORIGINAL:
    os pixels de borda ainda carregam a mistura com a cor vizinha. Medir
    textura sem erodir fez a AAN inteira sair como AEROGRAFIA — letras
    perfeitamente chapadas, com o desvio de L* vindo só da borda.
    """
    inner = morphology.erosion(mask, morphology.disk(erode))
    return inner if inner.sum() >= 50 else mask


def texture_of(lab: np.ndarray, mask: np.ndarray) -> tuple[str, float]:
    """CHAPADO / DEGRADE / AEROGRAFIA pelo RESÍDUO do ajuste de L* (§7.2).

    Os três parecem "não-chapado" num histograma, mas custam coisas muito
    diferentes. O que os separa é quão bem L* é explicado por uma rampa:
    degradê é rampa (R² alto), aerografia não é (tom contínuo irregular).
    """
    m = interior(mask)
    L = lab[..., 0][m]
    if L.size < 50 or L.std() < 3.0:
        return "CHAPADO", 1.0

    ys, xs = np.nonzero(m)
    A = np.column_stack([xs, ys, np.ones_like(xs)]).astype(np.float64)
    coef, *_ = np.linalg.lstsq(A, L, rcond=None)
    resid = L - A @ coef
    r2 = 1.0 - float(resid.var() / L.var()) if L.var() > 0 else 1.0

    # Matiz só tem significado onde há croma. Em cinza e preto (a,b ≈ 0) o
    # ângulo é ruído puro e gira 360° — foi o que promoveu #323132 a
    # "aerografia". Pixels quase-neutros ficam fora da conta.
    ab = lab[..., 1:][m]
    chroma = np.hypot(ab[:, 0], ab[:, 1])
    colored = chroma > 8.0
    if colored.sum() >= 50:
        hues = np.arctan2(ab[colored, 1], ab[colored, 0])
        spread = float(np.percentile(hues, 90) - np.percentile(hues, 10))
    else:
        spread = 0.0

    if r2 >= 0.75 and spread < 1.2:
        return "DEGRADE", r2
    if r2 < 0.5 or spread >= 1.2:
        return "AEROGRAFIA", r2
    return "DEGRADE", r2


def internal_split(lab: np.ndarray, mask: np.ndarray) -> dict | None:
    """Parte chapada + parte em degradê dentro do MESMO elemento (§7.3).

    Caso do "Frutícula 2 Amigos" cinza: topo chapado, base em degradê, com uma
    marcação separando. Produção: pinta o cinza, cobre o topo com fita e papel,
    aerografa só a base. É uma segunda sessão de mascaramento DENTRO de um
    elemento — invisível para qualquer análise que o trate como uma cor só.

    Compara "rampa única" contra "constante até s, rampa depois" e devolve a
    divisão apenas se o segundo modelo reduzir o resíduo de forma relevante.
    """
    mask = interior(mask)
    ys, xs = np.nonzero(mask)
    if ys.size < 400:
        return None
    L = lab[..., 0][mask]
    if L.std() < 4.0:
        return None

    # eixo principal da variação: quase sempre vertical em texto, mas não sempre
    coords = np.column_stack([xs - xs.mean(), ys - ys.mean()]).astype(np.float64)
    _, _, vt = np.linalg.svd(coords, full_matrices=False)
    axis = vt[1]                       # eixo MENOR: onde o degradê costuma correr
    t = coords @ axis
    order = np.argsort(t)
    t, L = t[order], L[order]

    single = np.polyfit(t, L, 1)
    resid_single = float(np.var(L - np.polyval(single, t)))
    if resid_single < 1e-6:
        return None

    best = None
    for frac in np.linspace(0.25, 0.75, 11):
        s = int(len(t) * frac)
        if s < 50 or len(t) - s < 50:
            continue
        flat = float(np.var(L[:s] - L[:s].mean()))
        ramp = np.polyfit(t[s:], L[s:], 1)
        r = float(np.var(L[s:] - np.polyval(ramp, t[s:])))
        combined = (flat * s + r * (len(t) - s)) / len(t)
        if best is None or combined < best[0]:
            best = (combined, frac, L[:s].mean(), float(L[s:].min()), float(L[s:].max()))

    if best is None:
        return None
    combined, frac, flat_L, lo, hi = best
    gain = 1.0 - combined / resid_single
    if gain < 0.35:                    # limiar provisório — ver doutrina §7.5
        return None
    return {
        "split_pos_pct": round(frac * 100, 1),
        "ganho_residuo": round(gain, 2),
        "L_chapado": round(flat_L, 1),
        "degrade_L": [round(lo, 1), round(hi, 1)],
    }


def analyse(path: str) -> dict:
    img = load(path)
    orig_w = img.size[0]
    work = img.copy()
    work.thumbnail((WORK_MAX, WORK_MAX), 1)
    length_m, from_name = length_from_name(path)
    px_per_cm = work.size[0] / (length_m * 100)

    labels, palette = quantize(work, 8)
    bg = is_background(palette, labels)
    lab = skcolor.rgb2lab(np.asarray(work, dtype=np.float64) / 255.0)

    elements = []
    total_px = labels.size
    for k in range(len(palette)):
        if k == bg:
            continue
        comps = measure.label(labels == k)
        for region in measure.regionprops(comps):
            if region.area < total_px * MIN_AREA_FRAC:
                continue
            mask = comps == region.label
            sobre, _ = substrate_of(mask, labels, bg)
            textura, r2 = texture_of(lab, mask)
            elements.append({
                "cor": "#%02X%02X%02X" % tuple(palette[k]),
                "area_cm2": round(region.area / (px_per_cm ** 2), 1),
                "menor_traco_mm": round(min_stroke_mm(mask, px_per_cm), 1),
                "compacidade": round(compactness(region), 1),
                "ilhas": max(0, 1 - int(region.euler_number)),
                "sobre": sobre,
                "textura": textura,
                "r2_rampa": round(r2, 2),
                "internal_split": internal_split(lab, mask),
            })

    elements.sort(key=lambda e: -e["area_cm2"])
    return {
        "arte": Path(path).name,
        "comprimento_m": length_m,
        "comprimento_do_nome": from_name,
        "px_por_cm": round(px_per_cm, 2),
        "resolucao_original_px": orig_w,
        "elementos": elements,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--rank", help="ordena todos os elementos por este sinal")
    args = ap.parse_args()

    results = []
    for p in args.images:
        try:
            results.append(analyse(p))
        except Exception as exc:
            print(f"!! {Path(p).name}: {str(exc)[:100]}", file=sys.stderr)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0

    if args.rank:
        rows = [(r["arte"], e) for r in results for e in r["elementos"]
                if e.get(args.rank) is not None]
        rows.sort(key=lambda x: x[1][args.rank])
        print(f"{'arte':<34} {'cor':<9} {args.rank:>14}  area_cm2  sobre   textura")
        for art, e in rows:
            print(f"{art[:33]:<34} {e['cor']:<9} {e[args.rank]:>14}  "
                  f"{e['area_cm2']:>8}  {e['sobre']:<7} {e['textura']}")
        return 0

    for r in results:
        flag = "" if r["comprimento_do_nome"] else "  (comprimento PRESUMIDO)"
        print(f"\n=== {r['arte']}  {r['comprimento_m']} m{flag} "
              f"| {r['px_por_cm']} px/cm ===")
        print(f"{'cor':<9} {'area_cm2':>9} {'traco_mm':>9} {'compac':>7} "
              f"{'sobre':<7} {'textura':<11} split")
        for e in r["elementos"]:
            sp = e["internal_split"]
            sp_s = f"em {sp['split_pos_pct']}% (ganho {sp['ganho_residuo']})" if sp else "—"
            print(f"{e['cor']:<9} {e['area_cm2']:>9} {e['menor_traco_mm']:>9} "
                  f"{e['compacidade']:>7} {e['sobre']:<7} {e['textura']:<11} {sp_s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
