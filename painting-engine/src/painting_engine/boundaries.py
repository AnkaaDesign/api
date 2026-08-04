"""S6 — boundary graph: adjacency between regions, shared-edge polylines,
curvature classification and keyline registration.

Curvature classes (radius thresholds in cm, configurable):
RETA (turn < straight_max_deg_per_step), SUAVE (r >= r_suave), MEDIA, FECHADA,
EXTREMA (r < r_fechada).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

from .params import EngineParams
from .quantize import QuantizeResult
from .regions import Region

CURVE_CLASSES = ("RETA", "SUAVE", "MEDIA", "FECHADA", "EXTREMA")


@dataclass
class Boundary:
    id: str
    a: str                       # region id
    b: str | None                # None => image background side handled elsewhere
    kind: str                    # PAINT_PAINT | WITH_BACKGROUND | KEYLINE
    length_m: float
    curve_hist_m: dict[str, float] = field(default_factory=dict)
    dominant_curve: str | None = None
    corners: int = 0
    sample_path: list[list[float]] = field(default_factory=list)  # [[x, y], ...] work px
    bg_region: str | None = None  # WITH_BACKGROUND: id of the reserve/background
                                  # Region on the other side (was discarded in v1;
                                  # links knockouts like the white star to their host)


# --------------------------------------------------------------------------
# pixel-chain helpers
# --------------------------------------------------------------------------

_OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _chain_pixels(pixels: set[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    """Order a thin pixel set into one or more polyline chains."""
    remaining = set(pixels)
    neighbor_cache: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def neighbors(p: tuple[int, int]) -> list[tuple[int, int]]:
        if p not in neighbor_cache:
            r, c = p
            neighbor_cache[p] = [
                (r + dr, c + dc) for dr, dc in _OFFSETS if (r + dr, c + dc) in pixels
            ]
        return neighbor_cache[p]

    chains: list[list[tuple[int, int]]] = []
    while remaining:
        start = None
        for p in remaining:
            live = [n for n in neighbors(p) if n in remaining]
            if len(live) <= 1:
                start = p
                break
        if start is None:  # pure loop
            start = next(iter(remaining))
        chain = [start]
        remaining.discard(start)
        current = start
        while True:
            nxt = None
            for n in neighbors(current):
                if n in remaining:
                    nxt = n
                    break
            if nxt is None:
                break
            chain.append(nxt)
            remaining.discard(nxt)
            current = nxt
        if len(chain) >= 2:
            chains.append(chain)
    return chains


def _resample(chain: list[tuple[int, int]], step_px: float) -> np.ndarray:
    pts = np.array([[c, r] for r, c in chain], dtype=np.float64)  # (x, y)
    seg = np.diff(pts, axis=0)
    dist = np.hypot(seg[:, 0], seg[:, 1])
    cumulative = np.concatenate([[0.0], np.cumsum(dist)])
    total = cumulative[-1]
    if total < step_px:
        return pts[[0, -1]]
    targets = np.arange(0.0, total + step_px / 2, step_px)
    x = np.interp(targets, cumulative, pts[:, 0])
    y = np.interp(targets, cumulative, pts[:, 1])
    return np.stack([x, y], axis=1)


def _classify_curvature(
    resampled: np.ndarray,
    step_px: float,
    px_per_cm: float,
    params: EngineParams,
) -> tuple[dict[str, float], str | None, int]:
    hist_m = {c: 0.0 for c in CURVE_CLASSES}
    corners = 0
    n = resampled.shape[0]
    step_m = step_px / px_per_cm / 100.0
    if n < 3:
        hist_m["RETA"] = round(max(n - 1, 0) * step_m, 3)
        return hist_m, ("RETA" if n >= 2 else None), 0

    v1 = resampled[1:-1] - resampled[:-2]
    v2 = resampled[2:] - resampled[1:-1]
    dot = np.sum(v1 * v2, axis=1)
    norms = np.linalg.norm(v1, axis=1) * np.linalg.norm(v2, axis=1)
    cos = np.clip(dot / np.maximum(norms, 1e-9), -1.0, 1.0)
    turn_deg = np.degrees(np.arccos(cos))

    for turn in turn_deg:
        if turn >= params.corner_min_deg:
            corners += 1
        if turn < params.straight_max_deg_per_step:
            hist_m["RETA"] += step_m
            continue
        theta = np.radians(turn)
        radius_cm = (step_px / px_per_cm) / (2.0 * np.sin(theta / 2.0))
        if radius_cm >= params.curve_r_suave_cm:
            hist_m["SUAVE"] += step_m
        elif radius_cm >= params.curve_r_media_cm:
            hist_m["MEDIA"] += step_m
        elif radius_cm >= params.curve_r_fechada_cm:
            hist_m["FECHADA"] += step_m
        else:
            hist_m["EXTREMA"] += step_m

    hist_m = {k: round(v, 3) for k, v in hist_m.items()}
    dominant = max(hist_m, key=lambda k: hist_m[k]) if any(hist_m.values()) else None
    return hist_m, dominant, corners


# --------------------------------------------------------------------------
# main extraction
# --------------------------------------------------------------------------

def extract_boundaries(
    quant: QuantizeResult,
    regions: list[Region],
    comp_map: np.ndarray,
    params: EngineParams,
    px_per_cm: float,
) -> list[Boundary]:
    by_index: dict[int, Region] = {}
    for idx, region in enumerate(regions, start=1):
        by_index[idx] = region

    h, w = comp_map.shape
    step_px = max(2.0, params.curve_resample_cm * px_per_cm)

    # ---- collect adjacent component pairs with their A-side pixels ----------
    pair_pixels: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)

    def register(a_ids: np.ndarray, b_ids: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> None:
        for a, b, r, c in zip(a_ids.tolist(), b_ids.tolist(), rows.tolist(), cols.tolist()):
            if a == 0 or b == 0 or a == b:
                continue
            key = (min(a, b), max(a, b))
            pair_pixels[key].add((r, c))

    horizontal = (comp_map[:, :-1] != comp_map[:, 1:])
    rows, cols = np.nonzero(horizontal)
    register(comp_map[rows, cols], comp_map[rows, cols + 1], rows, cols)

    vertical = (comp_map[:-1, :] != comp_map[1:, :])
    rows, cols = np.nonzero(vertical)
    register(comp_map[rows, cols], comp_map[rows + 1, cols], rows, cols)

    boundaries: list[Boundary] = []
    counter = 0
    for (a_idx, b_idx), pixels in sorted(pair_pixels.items()):
        region_a = by_index.get(a_idx)
        region_b = by_index.get(b_idx)
        if region_a is None or region_b is None:
            continue
        length_m = len(pixels) / px_per_cm / 100.0
        if length_m * 100.0 < params.keyline_min_len_cm:
            continue

        if region_a.is_background or region_b.is_background:
            kind = "WITH_BACKGROUND"
            paint_side = region_b if region_a.is_background else region_a
            bg_side = region_a if region_a.is_background else region_b
            counter += 1
            boundaries.append(
                Boundary(
                    id=f"b{counter}",
                    a=paint_side.id,
                    b=None,
                    kind=kind,
                    length_m=round(length_m, 3),
                    bg_region=bg_side.id,
                )
            )
            continue

        chains = _chain_pixels(pixels)
        hist_total = {c: 0.0 for c in CURVE_CLASSES}
        corners = 0
        dominant = None
        sample: list[list[float]] = []
        for chain in chains:
            resampled = _resample(chain, step_px)
            hist, dom, corner_count = _classify_curvature(resampled, step_px, px_per_cm, params)
            for key, value in hist.items():
                hist_total[key] += value
            corners += corner_count
            if not sample and resampled.shape[0] >= 2:
                sample = [[round(float(x), 1), round(float(y), 1)] for x, y in resampled[:: max(1, resampled.shape[0] // 60)]]
        if any(hist_total.values()):
            dominant = max(hist_total, key=lambda k: hist_total[k])

        counter += 1
        boundaries.append(
            Boundary(
                id=f"b{counter}",
                a=region_a.id,
                b=region_b.id,
                kind="PAINT_PAINT",
                length_m=round(length_m, 3),
                curve_hist_m={k: round(v, 3) for k, v in hist_total.items()},
                dominant_curve=dominant,
                corners=corners,
                sample_path=sample,
            )
        )

    # ---- keylines: background slivers separating two paint components -------
    labeled, n = ndi.label(quant.keyline_mask, structure=np.ones((3, 3)))
    for comp in range(1, n + 1):
        comp_mask = labeled == comp
        ring = ndi.binary_dilation(comp_mask, iterations=2) & ~comp_mask
        neighbor_comps = np.unique(comp_map[ring])
        neighbor_comps = neighbor_comps[neighbor_comps > 0]
        paint_neighbors = [
            idx for idx in neighbor_comps.tolist() if not by_index[idx].is_background
        ]
        if len(paint_neighbors) < 2:
            continue
        skeleton_px = int(skeletonize(comp_mask).sum())
        length_m = skeleton_px / px_per_cm / 100.0
        for pos, a_idx in enumerate(paint_neighbors):
            for b_idx in paint_neighbors[pos + 1 :]:
                counter += 1
                boundaries.append(
                    Boundary(
                        id=f"b{counter}",
                        a=by_index[a_idx].id,
                        b=by_index[b_idx].id,
                        kind="KEYLINE",
                        length_m=round(length_m, 3),
                    )
                )

    return boundaries
