"""Passada final sobre a lista de traços, já em espaço vetorial.

As três fontes de contorno (fronteira de região, aresta de degrau, linha de
vinco) enxergam a mesma feição de ângulos diferentes e às vezes devolvem duas
curvas paralelas a 10-15 px. No papel isso lê como traço trêmulo, não como
desenho. Aqui a mesma feição vira uma linha só — a mais longa vence, porque é a
que descreve a forma inteira.

Também é aqui que se aplica um orçamento de tinta: se o desenho ficou mais denso
do que o pintor consegue usar, sai primeiro o traço mais curto e menos saliente.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi

from .geometry import rasterize_points
from .params import LineArtParams
from .strokes import LAYER_CONTOUR, LAYER_SHADE, LAYER_TEXTURE, Stroke


def _stamp(shape: tuple[int, int], pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    h, w = shape
    rows = np.clip(np.round(pts[:, 1]).astype(int), 0, h - 1)
    cols = np.clip(np.round(pts[:, 0]).astype(int), 0, w - 1)
    return rows, cols


def _dedupe_layer(
    strokes: list[Stroke],
    layer: str,
    shape: tuple[int, int],
    radius_px: int,
    max_overlap: float,
    seed: np.ndarray | None = None,
) -> tuple[list[Stroke], np.ndarray]:
    occupied = np.zeros(shape, dtype=bool) if seed is None else seed.copy()
    candidates = sorted(
        (s for s in strokes if s.layer == layer), key=lambda s: -s.length_px
    )
    kept: list[Stroke] = []
    for stroke in candidates:
        pts = rasterize_points(stroke.curves)
        rows, cols = _stamp(shape, pts)
        if occupied[rows, cols].mean() > max_overlap:
            continue
        kept.append(stroke)
        mark = np.zeros(shape, dtype=bool)
        mark[rows, cols] = True
        occupied |= ndi.binary_dilation(mark, iterations=radius_px)
    return kept, occupied


def consolidate(
    strokes: list[Stroke],
    params: LineArtParams,
    px_per_cm: float,
    shape: tuple[int, int],
) -> tuple[list[Stroke], dict[str, int]]:
    before = {
        layer: sum(1 for s in strokes if s.layer == layer)
        for layer in (LAYER_CONTOUR, LAYER_SHADE, LAYER_TEXTURE)
    }

    radius = int(max(params.merge_radius_cm * px_per_cm, 1))
    contours, occupied = _dedupe_layer(
        strokes, LAYER_CONTOUR, shape, radius, params.merge_max_overlap
    )
    # tracejado perde para contorno: aresta dura manda em limite de degradê
    shade, _ = _dedupe_layer(
        strokes, LAYER_SHADE, shape, radius, params.shade_under_contour_fraction,
        seed=occupied,
    )
    texture = [s for s in strokes if s.layer == LAYER_TEXTURE]

    kept = contours + shade + texture
    removed = {
        layer: before[layer] - sum(1 for s in kept if s.layer == layer)
        for layer in before
    }
    return kept, removed
