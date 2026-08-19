"""Fronteiras entre rótulos -> traços classificados.

A regra que reproduz o risco feito à mão:
  * fronteira com o fundo (silhueta do recorte)      -> CONTORNO (sólido)
  * fronteira entre OBJETOS diferentes               -> CONTORNO (sólido)
  * fronteira entre bandas de tom do MESMO objeto    -> SOMBRA (tracejado),
    salvo quando o gradiente ali é duro — aí promove para CONTORNO.

"Objeto" é instância do MobileSAM quando disponível; sem ele é classe de cor do
k-means, e aí duas regiões da mesma folha viram "objetos" distintos sem ser —
por isso o rebaixamento `texture_edge` só existe nesse modo.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np
from skimage.measure import find_contours

from .geometry import bezier_length, polyline_to_beziers
from .params import LineArtParams
from .posterize import Posterized

LAYER_CONTOUR = "CONTORNO"
LAYER_SHADE = "SOMBRA"
LAYER_TEXTURE = "TEXTURA"


@dataclass
class Stroke:
    layer: str
    curves: list[np.ndarray]   # lista de Béziers cúbicas (4x2) em px de trabalho
    length_px: float
    hardness: float = 0.0
    label_a: int = 0
    label_b: int = 0


def _neighbor_labels(labels: np.ndarray, contour: np.ndarray, own: int) -> np.ndarray:
    """Para cada ponto do contorno, qual rótulo está do outro lado."""
    h, w = labels.shape
    rows = np.clip(np.round(contour[:, 0]).astype(int), 0, h - 1)
    cols = np.clip(np.round(contour[:, 1]).astype(int), 0, w - 1)
    out = np.full(contour.shape[0], -1, dtype=np.int32)
    offsets = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    for i, (r, c) in enumerate(zip(rows, cols)):
        counts: Counter[int] = Counter()
        for dr, dc in offsets:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w:
                val = int(labels[rr, cc])
                if val != own:
                    counts[val] += 1
        if counts:
            out[i] = counts.most_common(1)[0][0]
    # preenche buracos (-1) com o vizinho válido anterior
    last = -1
    for i in range(out.shape[0]):
        if out[i] == -1:
            out[i] = last
        else:
            last = out[i]
    if out[0] == -1 and last != -1:
        out[out == -1] = last
    return out


def _runs(values: np.ndarray) -> list[tuple[int, int, int]]:
    """[(inicio, fim_exclusivo, valor)] de trechos com o mesmo vizinho."""
    if values.size == 0:
        return []
    change = np.nonzero(np.diff(values))[0] + 1
    bounds = [0, *change.tolist(), values.size]
    return [(a, b, int(values[a])) for a, b in zip(bounds[:-1], bounds[1:])]


def _hardness(gradient: np.ndarray, points: np.ndarray, radius_px: int) -> float:
    """Percentil alto da magnitude do gradiente ao longo do traço.
    Aresta real transita em poucos px (gradiente alto); degradê de aerógrafo
    transita em dezenas de px (gradiente baixo)."""
    h, w = gradient.shape
    rows = np.clip(np.round(points[:, 0]).astype(int), 0, h - 1)
    cols = np.clip(np.round(points[:, 1]).astype(int), 0, w - 1)
    r = max(1, radius_px)
    samples = []
    for dr in range(-r, r + 1):
        for dc in range(-r, r + 1):
            rr = np.clip(rows + dr, 0, h - 1)
            cc = np.clip(cols + dc, 0, w - 1)
            samples.append(gradient[rr, cc])
    stacked = np.max(np.stack(samples), axis=0)
    return float(np.percentile(stacked, 70))


def _on_border(points: np.ndarray, shape: tuple[int, int], margin: float = 2.0) -> bool:
    h, w = shape
    near = (
        (points[:, 0] <= margin)
        | (points[:, 0] >= h - 1 - margin)
        | (points[:, 1] <= margin)
        | (points[:, 1] >= w - 1 - margin)
    )
    return bool(near.mean() > 0.8)


def extract_strokes(
    post: Posterized,
    params: LineArtParams,
    px_per_cm: float,
    textured: frozenset[int] = frozenset(),
) -> list[Stroke]:
    labels = post.labels
    shape = labels.shape
    min_len_px = params.min_length_cm * px_per_cm
    radius_px = int(round(max(1.0, params.hardness_sample_cm * px_per_cm)))

    raw: list[tuple[str, np.ndarray, float, int, int]] = []  # (kind, pts(row,col), hard, a, b)

    for label in sorted(set(int(v) for v in np.unique(labels)) - {0}):
        mask = (labels == label).astype(np.float64)
        for contour in find_contours(mask, 0.5):
            if contour.shape[0] < 4:
                continue
            neighbors = _neighbor_labels(labels, contour, label)
            for start, end, other in _runs(neighbors):
                if end - start < 4:
                    continue
                if other > 0 and other < label:
                    continue  # já emitido pelo lado do vizinho de id menor
                segment = contour[start:end]
                if _on_border(segment, shape):
                    continue
                seg_len = float(np.sum(np.hypot(*np.diff(segment, axis=0).T)))
                if seg_len < min_len_px:
                    continue
                if other == 0:
                    kind = "silhouette"
                elif post.label_object.get(other) != post.label_object.get(label):
                    kind = "object"
                else:
                    kind = "tone"
                # dentro de área texturada a banda de tom não vira traço: quem
                # descreve o interior da folha é a hachura, não a curva de nível
                if label in textured and other in textured:
                    if kind == "tone":
                        continue
                    # sem instâncias, "objeto" é só classe de cor: verde claro x
                    # verde escuro da MESMA folha viraria contorno falso
                    if post.object_source == "color":
                        kind = "texture_edge"
                hard = _hardness(post.gradient, segment, radius_px)
                raw.append((kind, segment, hard, label, max(other, 0)))

    if not raw:
        return []

    tone_hardness = [h for kind, _, h, _, _ in raw if kind == "tone"]
    threshold = (
        float(np.percentile(tone_hardness, params.hard_percentile))
        if tone_hardness
        else float("inf")
    )
    all_hardness = [h for _, _, h, _, _ in raw]
    texture_threshold = (
        float(np.percentile(all_hardness, params.texture_edge_percentile))
        if all_hardness
        else float("inf")
    )

    strokes: list[Stroke] = []
    for kind, segment, hard, a, b in raw:
        if kind == "texture_edge":
            if hard < texture_threshold:
                continue
            layer = LAYER_CONTOUR
        elif kind == "tone":
            layer = LAYER_CONTOUR if hard >= threshold else LAYER_SHADE
        else:
            layer = LAYER_CONTOUR
        # find_contours devolve (row, col); o resto do mundo usa (x, y)
        pts = segment[:, ::-1]
        # a linha de sombra é fronteira de degradê, não aresta: pode (e deve)
        # ser mais lisa que um contorno — o pintor risca um traço calmo, não a
        # curva de nível exata do ruído da foto
        relax = params.shade_relax if layer == LAYER_SHADE else 1.0
        for curves in polyline_to_beziers(
            pts,
            resample_step=params.resample_cm * px_per_cm,
            simplify_tol=params.simplify_cm * px_per_cm * relax,
            bezier_error=params.bezier_error_cm * px_per_cm * relax,
            corner_deg=params.corner_angle_deg if relax == 1.0 else 110.0,
        ):
            length = bezier_length(curves)
            if length < min_len_px:
                continue
            strokes.append(
                Stroke(
                    layer=layer,
                    curves=curves,
                    length_px=length,
                    hardness=hard,
                    label_a=a,
                    label_b=b,
                )
            )
    return strokes
