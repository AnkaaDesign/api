"""S9 v2 — face layout stage.

Turns the paint-region geometry of a face into the physical production layout:
horizontal adhesive bands per content strip (P0-P4), kraft-paper protection
panels around the bands (P5), rectangular paint windows per session (P6) and
the ordered step skeleton (P7). Pricing happens in the API layer; here we only
emit geometry and totals.

Coordinates are cm from the TOP-LEFT of the face. Rects are axis-aligned,
"material" rects: a band may exceed the face (the UI clips; alert
BAND_EXCEEDS_FACE). rotationDeg is clockwise around the rect center.

The per-region adhesive geometry of v1 (compute_region_adhesive) is deprecated
and no longer part of the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import ndimage as ndi

from .params import EngineParams
from .quantize import QuantizeResult
from .regions import Region

_EPS = 1e-6


# --------------------------------------------------------------------------
# roll-width cover (shared by v1 and v2)
# --------------------------------------------------------------------------

def _cover_height(height_cm: float, widths: list[float], overlap_cm: float = 0.0) -> list[float]:
    """Pick roll width classes whose stack covers `height_cm`.

    Single band: the SMALLEST width >= height_cm (104+4=108 -> 110, never 100).
    Taller: DP minimizing (total width, band count) subject to
    sum(w) - (n-1)*overlap_cm >= height_cm. Ties resolve toward the widest
    rolls (fewer distinct widths on the wall), e.g. 280 -> [120, 120, 50].
    """
    if height_cm <= 0:
        return []
    widths_sorted = sorted(float(w) for w in widths)
    if height_cm <= widths_sorted[-1]:
        for width in widths_sorted:
            if width >= height_cm:
                return [width]

    resolution = 0.5
    steps = int(np.ceil(height_cm / resolution))
    inf = float("inf")
    # best[s] = (total_width, count, bands) covering at least s*resolution
    best: list[tuple[float, int, tuple[float, ...]]] = [(inf, 0, ())] * (steps + 1)
    best[0] = (0.0, 0, ())
    widths_desc = widths_sorted[::-1]
    for step in range(1, steps + 1):
        target = step * resolution
        for width in widths_desc:
            if width >= target:
                candidate = (width, 1, (width,))
            else:
                prev_target = target - width + overlap_cm
                prev = int(np.ceil(max(0.0, prev_target) / resolution))
                if prev >= step or best[prev][0] == inf:
                    continue
                candidate = (
                    best[prev][0] + width,
                    best[prev][1] + 1,
                    best[prev][2] + (width,),
                )
            if candidate[:2] < best[step][:2]:
                best[step] = candidate
    if best[steps][0] == inf:  # pragma: no cover - widths always reach any height
        count = int(np.ceil(height_cm / widths_sorted[-1]))
        return [widths_sorted[-1]] * count
    return sorted(best[steps][2], reverse=True)


# --------------------------------------------------------------------------
# layout dataclasses
# --------------------------------------------------------------------------

@dataclass
class LayoutRect:
    id: str
    kind: str                 # BAND | PAPER | WINDOW
    x_cm: float
    y_cm: float
    w_cm: float
    h_cm: float
    rotation_deg: float = 0.0
    width_class_cm: float | None = None  # BAND: roll width class (== h_cm when unrotated)
    level: int | None = None             # BAND: stack level, 0 = top
    splices: int = 0                     # BAND: roll joins along the segment


@dataclass
class StripInfo:
    id: str
    y0_cm: float
    y1_cm: float
    skew_deg: float = 0.0
    rotated: bool = False
    band_widths: list[float] = field(default_factory=list)  # stack top -> bottom
    bands: list[LayoutRect] = field(default_factory=list)
    merged_from: list[str] = field(default_factory=list)


@dataclass
class SessionInfo:
    id: str                    # s0 (GENERAL_PAINT background) or s1..sN
    kind: str                  # GENERAL | PAINT | AEROGRAFIA
    color_indexes: list[int] = field(default_factory=list)  # palette idx; -1 = photographic
    hexes: list[str] = field(default_factory=list)
    windows: list[LayoutRect] = field(default_factory=list)
    window_area_m2: float = 0.0


@dataclass
class LayoutStep:
    id: str
    kind: str                  # PAINT_GENERAL | APPLY_BANDS | PAPER | PAINT_SESSION
    session_id: str | None = None
    title: str = ""


@dataclass
class FaceLayout:
    mode: str                  # WHITE_PLATE | GENERAL_PAINT
    face_w_cm: float
    face_h_cm: float
    empty: bool = False
    strips: list[StripInfo] = field(default_factory=list)
    paper_panels: list[LayoutRect] = field(default_factory=list)
    tape_perimeter_m: float = 0.0
    tape_seams_m: float = 0.0
    sessions: list[SessionInfo] = field(default_factory=list)
    steps: list[LayoutStep] = field(default_factory=list)
    totals: dict[str, Any] = field(default_factory=dict)
    alerts: list[dict] = field(default_factory=list)


# --------------------------------------------------------------------------
# P0 — paint union
# --------------------------------------------------------------------------

def _paint_union_mask(
    regions: list[Region],
    kinds: dict[str, dict],
    comp_map: np.ndarray,
) -> np.ndarray:
    """Boolean union of every paintable region: non-background and kind !=
    RESERVA (FOTOGRAFICO included — its airbrush window still needs bands)."""
    ids: list[int] = []
    for idx, region in enumerate(regions, start=1):
        kind = kinds.get(region.id, {}).get(
            "kind", "RESERVA" if region.is_background else "CHAPADA"
        )
        if region.is_background or kind == "RESERVA":
            continue
        ids.append(idx)
    if not ids:
        return np.zeros(comp_map.shape, dtype=bool)
    return np.isin(comp_map, ids)


# --------------------------------------------------------------------------
# P1 — strips
# --------------------------------------------------------------------------

def _find_strips(mask: np.ndarray, px_per_cm: float, gap_cm: float) -> list[tuple[int, int]]:
    """Y-projection runs of content; vertical gaps smaller than `gap_cm`
    merge (gap >= gap_cm splits). Returns half-open (r0, r1) row ranges."""
    idx = np.flatnonzero(mask.any(axis=1))
    if idx.size == 0:
        return []
    gap_px = gap_cm * px_per_cm
    runs: list[tuple[int, int]] = []
    start = prev = int(idx[0])
    for row in idx[1:].tolist():
        if row - prev - 1 >= gap_px:
            runs.append((start, prev + 1))
            start = row
        prev = row
    runs.append((start, prev + 1))
    return runs


# --------------------------------------------------------------------------
# P2 — strip skew
# --------------------------------------------------------------------------

def _strip_skew_deg(strip_mask: np.ndarray) -> float:
    """Weighted least-squares slope of the per-column vertical centroid of the
    strip content, in degrees. Positive = content descends to the right
    (clockwise rotation would align it)."""
    counts = strip_mask.sum(axis=0).astype(np.float64)
    cols = np.flatnonzero(counts)
    if cols.size < 2:
        return 0.0
    rows = np.arange(strip_mask.shape[0], dtype=np.float64)
    centers = (strip_mask.astype(np.float64) * rows[:, None]).sum(axis=0)[cols] / counts[cols]
    w = counts[cols]
    x = cols.astype(np.float64)
    wsum = w.sum()
    xbar = (w * x).sum() / wsum
    ybar = (w * centers).sum() / wsum
    denom = (w * (x - xbar) ** 2).sum()
    if denom < _EPS:
        return 0.0
    slope = (w * (x - xbar) * (centers - ybar)).sum() / denom
    return float(np.degrees(np.arctan(slope)))


# --------------------------------------------------------------------------
# P3 — band stack per strip
# --------------------------------------------------------------------------

def _band_segments(
    mask: np.ndarray,
    r0: int,
    r1: int,
    params: EngineParams,
    px_per_cm: float,
) -> list[tuple[float, float, int]]:
    """Occupied-column segments for one band level over mask rows [r0, r1).
    Splits where the empty gap is STRICTLY wider than layout_segment_gap_cm.
    Returns (x0_cm, w_cm, splices) with margins and min-width applied."""
    r0 = max(0, r0)
    r1 = min(mask.shape[0], r1)
    if r1 <= r0:
        return []
    cols = np.flatnonzero(mask[r0:r1].any(axis=0))
    if cols.size == 0:
        return []
    margin = params.adhesive_margin_cm
    gap_px = params.layout_segment_gap_cm * px_per_cm
    breaks = np.flatnonzero((np.diff(cols) - 1) > gap_px)
    starts = np.concatenate([[0], breaks + 1])
    ends = np.concatenate([breaks, [cols.size - 1]])
    segments: list[tuple[float, float, int]] = []
    for s, e in zip(starts, ends):
        x0 = int(cols[s]) / px_per_cm - margin
        x1 = (int(cols[e]) + 1) / px_per_cm + margin
        width = x1 - x0
        if width < params.adhesive_min_segment_cm:
            x0 -= (params.adhesive_min_segment_cm - width) / 2.0
            width = params.adhesive_min_segment_cm
        splices = max(
            0, int(np.ceil(width / 100.0 / params.adhesive_max_panel_m - _EPS)) - 1
        )
        segments.append((x0, width, splices))
    return segments


def _layout_strip(
    mask: np.ndarray,
    r0: int,
    r1: int,
    strip_id: str,
    merged_from: list[str],
    params: EngineParams,
    px_per_cm: float,
) -> StripInfo:
    """Band stack for one strip: cover = strip height + 2*margin; stacked bands
    overlap adhesive_band_overlap_cm; symmetric slack; per-level segments from
    that level's own slice of the strip content (empty slab = valid hole)."""
    margin = params.adhesive_margin_cm
    overlap = params.adhesive_band_overlap_cm
    h_cm = (r1 - r0) / px_per_cm
    cover = h_cm + 2.0 * margin

    skew = _strip_skew_deg(mask[r0:r1])
    # TODO(v2.x): full ROTATED mode — rotate the strip content by -skew, band
    # the rotated bbox and emit rotationDeg rects when the adhesive saving is
    # >= rotated_band_min_saving_pct. For now every strip is axis-aligned;
    # compute_face_layout emits INCLINED_STRIP_FALLBACK when skew qualifies.

    widths = _cover_height(cover, list(params.adhesive_widths_cm), overlap)
    n = len(widths)
    effective = sum(widths) - max(0, n - 1) * overlap
    slack = max(0.0, effective - cover)
    top_cm = r0 / px_per_cm - margin - slack / 2.0

    bands: list[LayoutRect] = []
    y = top_cm
    for level, width_class in enumerate(widths):
        lo = int(np.floor(max(y, r0 / px_per_cm) * px_per_cm))
        hi = int(np.ceil(min(y + width_class, r1 / px_per_cm) * px_per_cm))
        lo = max(lo, r0)
        hi = min(hi, r1)
        for seg_index, (x0, w_cm, splices) in enumerate(
            _band_segments(mask, lo, hi, params, px_per_cm)
        ):
            bands.append(
                LayoutRect(
                    id=f"band-{strip_id}.{level}.{seg_index}",
                    kind="BAND",
                    x_cm=x0,
                    y_cm=y,
                    w_cm=w_cm,
                    h_cm=float(width_class),
                    width_class_cm=float(width_class),
                    level=level,
                    splices=splices,
                )
            )
        y += width_class - overlap

    return StripInfo(
        id=strip_id,
        y0_cm=r0 / px_per_cm,
        y1_cm=r1 / px_per_cm,
        skew_deg=round(skew, 2),
        rotated=False,
        band_widths=[float(w) for w in widths],
        bands=bands,
        merged_from=list(merged_from),
    )


def _rects_collide(a: LayoutRect, b: LayoutRect) -> bool:
    return (
        min(a.x_cm + a.w_cm, b.x_cm + b.w_cm) - max(a.x_cm, b.x_cm) > _EPS
        and min(a.y_cm + a.h_cm, b.y_cm + b.h_cm) - max(a.y_cm, b.y_cm) > _EPS
    )


# --------------------------------------------------------------------------
# P5 — kraft paper
# --------------------------------------------------------------------------

def _mask_to_rects(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Exact rectangle decomposition by row-slab sweep: consecutive rows with
    an identical run signature form a slab; each run becomes one rect.
    Returns (r0, r1, c0, c1) half-open, non-overlapping, area-exact."""
    height = mask.shape[0]
    rects: list[tuple[int, int, int, int]] = []
    prev: tuple[tuple[int, int], ...] | None = None
    slab_start = 0
    for row in range(height + 1):
        runs: tuple[tuple[int, int], ...] | None
        if row < height:
            idx = np.flatnonzero(mask[row])
            if idx.size:
                brk = np.flatnonzero(np.diff(idx) > 1)
                starts = np.concatenate([[0], brk + 1])
                ends = np.concatenate([brk, [idx.size - 1]])
                runs = tuple(
                    (int(idx[s]), int(idx[e]) + 1) for s, e in zip(starts, ends)
                )
            else:
                runs = ()
        else:
            runs = None
        if runs != prev:
            if prev:
                for c0, c1 in prev:
                    rects.append((slab_start, row, c0, c1))
            slab_start = row
            prev = runs
    return rects


def _roll_split(
    x: float, y: float, w: float, h: float, roll_cm: float, min_panel_cm: float
) -> list[tuple[float, float, float, float]]:
    """Split a rect so every panel satisfies min(w, h) <= roll width. Splits
    the smaller dimension; a remainder below `min_panel_cm` equalizes parts."""
    if min(w, h) <= roll_cm + _EPS:
        return [(x, y, w, h)]
    split_height = h <= w  # split the smaller dimension
    dim = h if split_height else w
    n = int(np.ceil(dim / roll_cm - _EPS))
    rest = dim - (n - 1) * roll_cm
    if rest < min_panel_cm:
        parts = [dim / n] * n
    else:
        parts = [roll_cm] * (n - 1) + [rest]
    out: list[tuple[float, float, float, float]] = []
    cursor = y if split_height else x
    for part in parts:
        if split_height:
            out.append((x, cursor, w, part))
        else:
            out.append((cursor, y, part, h))
        cursor += part
    return out


def _paper_panels(
    band_rects: list[LayoutRect],
    mode: str,
    face_w_cm: float,
    face_h_cm: float,
    params: EngineParams,
    px_per_cm: float,
) -> tuple[list[LayoutRect], float, float, float]:
    """P = protect zone minus bands, tiled into roll-compatible panels.
    Zone: full face for GENERAL_PAINT; else chessboard dilation of the band
    union by paper_protect_radius_cm, clipped to the face.
    Returns (panels, area_m2, tape_perimeter_m, tape_seams_m)."""
    height = max(1, int(round(face_h_cm * px_per_cm)))
    width = max(1, int(round(face_w_cm * px_per_cm)))
    band_mask = np.zeros((height, width), dtype=bool)
    for rect in band_rects:
        r0 = max(0, int(np.floor(rect.y_cm * px_per_cm)))
        r1 = min(height, int(np.ceil((rect.y_cm + rect.h_cm) * px_per_cm)))
        c0 = max(0, int(np.floor(rect.x_cm * px_per_cm)))
        c1 = min(width, int(np.ceil((rect.x_cm + rect.w_cm) * px_per_cm)))
        if r1 > r0 and c1 > c0:
            band_mask[r0:r1, c0:c1] = True

    if mode == "GENERAL_PAINT":
        zone = np.ones((height, width), dtype=bool)
    elif band_mask.any():
        radius_px = max(0, int(round(params.paper_protect_radius_cm * px_per_cm)))
        distance = ndi.distance_transform_cdt(~band_mask, metric="chessboard")
        zone = distance <= radius_px
    else:
        zone = np.zeros((height, width), dtype=bool)

    paper_mask = zone & ~band_mask
    panels_cm: list[tuple[float, float, float, float]] = []
    for r0, r1, c0, c1 in _mask_to_rects(paper_mask):
        panels_cm.extend(
            _roll_split(
                c0 / px_per_cm,
                r0 / px_per_cm,
                (c1 - c0) / px_per_cm,
                (r1 - r0) / px_per_cm,
                params.paper_roll_width_cm,
                params.paper_min_panel_cm,
            )
        )

    panels = [
        LayoutRect(id=f"paper-{i + 1}", kind="PAPER", x_cm=x, y_cm=y, w_cm=w, h_cm=h)
        for i, (x, y, w, h) in enumerate(panels_cm)
    ]
    area_m2 = sum(w * h for _, _, w, h in panels_cm) / 10_000.0

    total_perimeter_cm = sum(2.0 * (w + h) for _, _, w, h in panels_cm)
    seams_cm = 0.0
    for i, (ax, ay, aw, ah) in enumerate(panels_cm):
        for bx, by, bw, bh in panels_cm[i + 1 :]:
            if abs((ay + ah) - by) < _EPS or abs((by + bh) - ay) < _EPS:
                seams_cm += max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
            if abs((ax + aw) - bx) < _EPS or abs((bx + bw) - ax) < _EPS:
                seams_cm += max(0.0, min(ay + ah, by + bh) - max(ay, by))
    perimeter_cm = max(0.0, total_perimeter_cm - 2.0 * seams_cm)
    return panels, area_m2, perimeter_cm / 100.0, seams_cm / 100.0


# --------------------------------------------------------------------------
# P6 — sessions and paint windows
# --------------------------------------------------------------------------

def _default_sessions(
    regions: list[Region],
    kinds: dict[str, dict],
    quant: QuantizeResult,
) -> list[list[int]]:
    """One session per paint color, lightest first (L* desc); photographic
    (-1) last as its own AEROGRAFIA session."""
    colors: set[int] = set()
    has_photo = False
    for region in regions:
        kind = kinds.get(region.id, {}).get(
            "kind", "RESERVA" if region.is_background else "CHAPADA"
        )
        if region.is_background or kind == "RESERVA":
            continue
        if region.color_index == -1:
            has_photo = True
        elif region.color_index != quant.background_index:
            colors.add(region.color_index)
    ordered = sorted(colors, key=lambda c: -float(quant.palette_lab[c][0]))
    sessions = [[c] for c in ordered]
    if has_photo:
        sessions.append([-1])
    return sessions


def _session_windows(
    session_id: str,
    color_indexes: list[int],
    quant: QuantizeResult,
    strips: list[StripInfo],
    px_per_cm: float,
) -> list[LayoutRect]:
    """Per session x color x strip: bbox of the color's pixels inside the strip
    rows, clipped to the strip's band-union bbox (NO margin). The WINDOW area
    (not the vector area) is the paint consumption basis."""
    windows: list[LayoutRect] = []
    for color in color_indexes:
        if color == -1:
            color_mask = quant.photo_mask
        else:
            color_mask = quant.labels == color
        for strip in strips:
            r0 = int(round(strip.y0_cm * px_per_cm))
            r1 = int(round(strip.y1_cm * px_per_cm))
            sub = color_mask[r0:r1]
            if not sub.any():
                continue
            rows = np.flatnonzero(sub.any(axis=1))
            cols = np.flatnonzero(sub.any(axis=0))
            x0 = int(cols[0]) / px_per_cm
            x1 = (int(cols[-1]) + 1) / px_per_cm
            y0 = strip.y0_cm + int(rows[0]) / px_per_cm
            y1 = strip.y0_cm + (int(rows[-1]) + 1) / px_per_cm
            if strip.bands:
                bx0 = min(b.x_cm for b in strip.bands)
                bx1 = max(b.x_cm + b.w_cm for b in strip.bands)
                by0 = min(b.y_cm for b in strip.bands)
                by1 = max(b.y_cm + b.h_cm for b in strip.bands)
                x0, x1 = max(x0, bx0), min(x1, bx1)
                y0, y1 = max(y0, by0), min(y1, by1)
            if x1 - x0 <= _EPS or y1 - y0 <= _EPS:
                continue
            windows.append(
                LayoutRect(
                    id=f"win-{session_id}.c{color}.{strip.id}",
                    kind="WINDOW",
                    x_cm=x0,
                    y_cm=y0,
                    w_cm=x1 - x0,
                    h_cm=y1 - y0,
                )
            )
    return windows


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def compute_face_layout(
    regions: list[Region],
    kinds: dict[str, dict],
    quant: QuantizeResult,
    comp_map: np.ndarray,
    params: EngineParams,
    px_per_cm: float,
    sessions: list[list[int]] | None = None,
) -> FaceLayout:
    mode = quant.background_mode
    height, width = comp_map.shape
    face_w_cm = width / px_per_cm
    face_h_cm = height / px_per_cm
    alerts: list[dict] = []

    layout = FaceLayout(mode=mode, face_w_cm=face_w_cm, face_h_cm=face_h_cm)

    # ---- P0: paint union ---------------------------------------------------
    union = _paint_union_mask(regions, kinds, comp_map)
    if not union.any():
        layout.empty = True
        alerts.append(
            {
                "code": "LAYOUT_EMPTY",
                "severity": "INFO",
                "message": "Nenhum elemento pintável na face — layout vazio.",
            }
        )

    # ---- sessions resolution ----------------------------------------------
    bg = quant.background_index
    if sessions is not None:
        groups: list[list[int]] = []
        bg_dropped = False
        for group in sessions:
            cleaned = [int(c) for c in group if int(c) != bg]
            if len(cleaned) != len(group):
                bg_dropped = True
            if cleaned:
                groups.append(cleaned)
        if bg_dropped:
            alerts.append(
                {
                    "code": "SESSION_BG_IGNORED",
                    "severity": "INFO",
                    "message": (
                        "Sessão com a cor de fundo ignorada — o fundo é a chapa/pintura "
                        "geral, nunca uma sessão de janela."
                    ),
                }
            )
    else:
        groups = _default_sessions(regions, kinds, quant)

    # ---- P1-P4: strips with fixpoint merge --------------------------------
    working: list[dict] = [
        {"r0": r0, "r1": r1, "id": f"st{i + 1}", "merged_from": []}
        for i, (r0, r1) in enumerate(_find_strips(union, px_per_cm, params.layout_strip_gap_cm))
    ]
    strips: list[StripInfo] = []
    for _ in range(max(1, len(working))):
        strips = [
            _layout_strip(
                union, w["r0"], w["r1"], w["id"], w["merged_from"], params, px_per_cm
            )
            for w in working
        ]
        collision: tuple[int, int] | None = None
        for i in range(len(strips)):
            for j in range(i + 1, len(strips)):
                if any(
                    _rects_collide(a, b) for a in strips[i].bands for b in strips[j].bands
                ):
                    collision = (i, j)
                    break
            if collision:
                break
        if not collision:
            break
        i, j = collision
        a, b = working[i], working[j]
        merged = {
            "r0": min(a["r0"], b["r0"]),
            "r1": max(a["r1"], b["r1"]),
            "id": a["id"],
            "merged_from": (a["merged_from"] or [a["id"]]) + (b["merged_from"] or [b["id"]]),
        }
        working = [w for k, w in enumerate(working) if k not in (i, j)]
        working.append(merged)
        working.sort(key=lambda w: w["r0"])

    # ---- strip alerts ------------------------------------------------------
    detail_boxes: list[tuple[str, float, float, float, float]] = []
    for region in regions:
        kind = kinds.get(region.id, {}).get("kind")
        if kind in ("MICRO", "TEXTURA"):
            detail_boxes.append(
                (
                    region.id,
                    region.bbox[1] / px_per_cm,
                    region.bbox[0] / px_per_cm,
                    region.bbox[3] / px_per_cm,
                    region.bbox[2] / px_per_cm,
                )
            )

    for strip in strips:
        if abs(strip.skew_deg) >= params.layout_skew_min_deg:
            alerts.append(
                {
                    "code": "INCLINED_STRIP_FALLBACK",
                    "severity": "WARNING",
                    "message": (
                        "Faixa {} inclinada ({:.1f}°) — bandas aplicadas na horizontal "
                        "(modo rotacionado indisponível); considerar rotação manual."
                    ).format(strip.id, strip.skew_deg),
                }
            )
        if len(strip.band_widths) > 1:
            alerts.append(
                {
                    "code": "BAND_STACKED",
                    "severity": "INFO",
                    "message": (
                        "Faixa {}: altura {:.0f} cm exige {} bandas empilhadas ({})."
                    ).format(
                        strip.id,
                        strip.y1_cm - strip.y0_cm,
                        len(strip.band_widths),
                        "+".join(f"{w:.0f}" for w in strip.band_widths),
                    ),
                }
            )
            levels_with_splices = {
                b.level for b in strip.bands if b.splices and b.level is not None
            }
            if len(levels_with_splices) >= 2:
                alerts.append(
                    {
                        "code": "SPLICE_ALIGNMENT_RISK",
                        "severity": "WARNING",
                        "message": (
                            "Faixa {}: emendas de bobina em múltiplos níveis empilhados — "
                            "desalinhar as emendas para não coincidirem."
                        ).format(strip.id),
                    }
                )
            # seam lines between stacked levels vs fine-detail bboxes
            overlap = params.adhesive_band_overlap_cm
            seam_regions: set[str] = set()
            y = min((b.y_cm for b in strip.bands), default=strip.y0_cm)
            for level in range(len(strip.band_widths) - 1):
                seam_y0 = y + strip.band_widths[level] - overlap
                seam_y1 = seam_y0 + overlap
                for rid, bx0, by0, bx1, by1 in detail_boxes:
                    if by0 < seam_y1 and by1 > seam_y0:
                        seam_regions.add(rid)
                y = seam_y0
            if seam_regions:
                alerts.append(
                    {
                        "code": "SEAM_CROSSES_DETAIL",
                        "severity": "WARNING",
                        "message": (
                            "Faixa {}: emenda de bandas cruza detalhe fino ({}) — "
                            "deslocar a emenda em até ±10 cm."
                        ).format(strip.id, ", ".join(sorted(seam_regions))),
                    }
                )
        # A banda SEMPRE extrapola a face pela margem de segurança (cover = altura
        # + 2*margem) — alertar por isso é ruído em toda arte de sangria. Só avisa
        # quando o excesso passa da margem prevista.
        slack = params.adhesive_margin_cm + _EPS
        if any(
            b.x_cm < -slack
            or b.y_cm < -slack
            or b.x_cm + b.w_cm > face_w_cm + slack
            or b.y_cm + b.h_cm > face_h_cm + slack
            for b in strip.bands
        ):
            alerts.append(
                {
                    "code": "BAND_EXCEEDS_FACE",
                    "severity": "INFO",
                    "message": (
                        "Faixa {}: banda ultrapassa o limite da face — o material excede; "
                        "recortar na aplicação."
                    ).format(strip.id),
                }
            )
    layout.strips = strips

    # ---- P5: paper ---------------------------------------------------------
    all_bands = [b for strip in strips for b in strip.bands]
    panels, paper_area_m2, tape_perimeter_m, tape_seams_m = _paper_panels(
        all_bands, mode, face_w_cm, face_h_cm, params, px_per_cm
    )
    layout.paper_panels = panels
    layout.tape_perimeter_m = tape_perimeter_m
    layout.tape_seams_m = tape_seams_m

    # ---- P6: sessions + windows -------------------------------------------
    session_infos: list[SessionInfo] = []
    if mode == "GENERAL_PAINT":
        session_infos.append(
            SessionInfo(
                id="s0",
                kind="GENERAL",
                color_indexes=[bg],
                hexes=[quant.palette_hex[bg]],
                windows=[
                    LayoutRect(
                        id="win-s0.face",
                        kind="WINDOW",
                        x_cm=0.0,
                        y_cm=0.0,
                        w_cm=face_w_cm,
                        h_cm=face_h_cm,
                    )
                ],
                window_area_m2=face_w_cm * face_h_cm / 10_000.0,
            )
        )
    for offset, group in enumerate(groups, start=1):
        session_id = f"s{offset}"
        windows = _session_windows(session_id, group, quant, strips, px_per_cm)
        hexes = [
            quant.palette_hex[c] if c >= 0 else "#multi" for c in group
        ]
        session_infos.append(
            SessionInfo(
                id=session_id,
                kind="AEROGRAFIA" if -1 in group else "PAINT",
                color_indexes=list(group),
                hexes=hexes,
                windows=windows,
                window_area_m2=sum(w.w_cm * w.h_cm for w in windows) / 10_000.0,
            )
        )
    layout.sessions = session_infos

    # ---- P7: steps ---------------------------------------------------------
    steps: list[LayoutStep] = []

    def _push(kind: str, session_id: str | None, title: str) -> None:
        steps.append(
            LayoutStep(id=f"step-{len(steps) + 1}", kind=kind, session_id=session_id, title=title)
        )

    if mode == "GENERAL_PAINT":
        _push("PAINT_GENERAL", "s0", "Pintura geral (fundo da face)")
    if all_bands:
        _push("APPLY_BANDS", None, "Aplicar bandas de adesivo")
    if panels:
        _push("PAPER", None, "Empapelamento (papel kraft + fita crepe)")
    for session in session_infos:
        if session.id == "s0":
            continue
        label = "Aerografia" if session.kind == "AEROGRAFIA" else "Pintar"
        _push(
            "PAINT_SESSION",
            session.id,
            f"{label} sessão {session.id} ({', '.join(session.hexes)})",
        )
    layout.steps = steps

    # ---- totals ------------------------------------------------------------
    px_area_m2 = 1.0 / (px_per_cm * 100.0) ** 2
    linear_by_width: dict[str, float] = {}
    adhesive_area_m2 = 0.0
    splice_count = 0
    for band in all_bands:
        key = f"{band.width_class_cm:.0f}"
        linear_by_width[key] = linear_by_width.get(key, 0.0) + band.w_cm / 100.0
        adhesive_area_m2 += band.w_cm * band.h_cm / 10_000.0
        splice_count += band.splices

    band_seam_m = 0.0
    for strip in strips:
        by_level: dict[int, list[LayoutRect]] = {}
        for band in strip.bands:
            by_level.setdefault(band.level or 0, []).append(band)
        for level in range(len(strip.band_widths) - 1):
            for upper in by_level.get(level, []):
                for lower in by_level.get(level + 1, []):
                    band_seam_m += (
                        max(
                            0.0,
                            min(upper.x_cm + upper.w_cm, lower.x_cm + lower.w_cm)
                            - max(upper.x_cm, lower.x_cm),
                        )
                        / 100.0
                    )

    element_area_m2 = float(union.sum()) * px_area_m2
    by_session = {s.id: s.window_area_m2 for s in session_infos}
    by_color: dict[str, float] = {}
    for session in session_infos:
        if session.id == "s0":
            by_color[str(bg)] = by_color.get(str(bg), 0.0) + session.window_area_m2
            continue
        for color in session.color_indexes:
            area = sum(
                w.w_cm * w.h_cm for w in session.windows if f".c{color}." in w.id
            ) / 10_000.0
            if area:
                by_color[str(color)] = by_color.get(str(color), 0.0) + area

    layout.totals = {
        "adhesiveLinearMByWidth": {k: round(v, 3) for k, v in sorted(linear_by_width.items())},
        "adhesiveAreaM2": round(adhesive_area_m2, 4),
        "elementAreaM2": round(element_area_m2, 4),
        "adhesiveWasteM2": round(max(0.0, adhesive_area_m2 - element_area_m2), 4),
        "transferLinearM": round(
            adhesive_area_m2 / (params.transfer_mask_width_cm / 100.0), 3
        ),
        "bandSeamLinearM": round(band_seam_m, 3),
        "spliceCount": int(splice_count),
        "paperAreaM2": round(paper_area_m2, 4),
        "paperPanelCount": len(panels),
        "tapeCrepeM": {
            "perimeterM": round(tape_perimeter_m, 3),
            "seamsM": round(tape_seams_m, 3),
        },
        "paintWindowAreaM2": round(sum(by_session.values()), 4),
        "paintWindowAreaM2BySession": {k: round(v, 4) for k, v in by_session.items()},
        "paintWindowAreaM2ByColor": {k: round(v, 4) for k, v in sorted(by_color.items())},
    }
    layout.alerts = alerts
    return layout


# --------------------------------------------------------------------------
# JSON serialization (camelCase artifact block)
# --------------------------------------------------------------------------

def _rect_json(rect: LayoutRect) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": rect.id,
        "xCm": round(rect.x_cm, 1),
        "yCm": round(rect.y_cm, 1),
        "wCm": round(rect.w_cm, 1),
        "hCm": round(rect.h_cm, 1),
    }
    if rect.rotation_deg:
        data["rotationDeg"] = round(rect.rotation_deg, 1)
    if rect.width_class_cm is not None:
        data["widthClassCm"] = round(rect.width_class_cm, 1)
    if rect.level is not None:
        data["level"] = rect.level
    if rect.splices:
        data["splices"] = rect.splices
    return data


def layout_to_json(layout: FaceLayout) -> dict[str, Any]:
    """FaceLayout -> camelCase JSON block (cm 1dp / m 3dp / m2 4dp; fields
    that do not apply are omitted)."""
    out: dict[str, Any] = {
        "mode": layout.mode,
        "faceWidthCm": round(layout.face_w_cm, 1),
        "faceHeightCm": round(layout.face_h_cm, 1),
    }
    if layout.empty:
        out["empty"] = True
    strips_json = []
    for strip in layout.strips:
        strip_data: dict[str, Any] = {
            "id": strip.id,
            "y0Cm": round(strip.y0_cm, 1),
            "y1Cm": round(strip.y1_cm, 1),
            "bandWidthsCm": [round(w, 1) for w in strip.band_widths],
            "bands": [_rect_json(b) for b in strip.bands],
        }
        if strip.skew_deg:
            strip_data["skewDeg"] = round(strip.skew_deg, 2)
        if strip.rotated:
            strip_data["rotated"] = True
        if strip.merged_from:
            strip_data["mergedFrom"] = list(strip.merged_from)
        strips_json.append(strip_data)
    out["strips"] = strips_json
    out["paper"] = {
        "panels": [_rect_json(p) for p in layout.paper_panels],
        "tapeCrepeM": {
            "perimeterM": round(layout.tape_perimeter_m, 3),
            "seamsM": round(layout.tape_seams_m, 3),
        },
    }
    sessions_json = []
    for session in layout.sessions:
        sessions_json.append(
            {
                "id": session.id,
                "kind": session.kind,
                "colorIndexes": list(session.color_indexes),
                "hexes": list(session.hexes),
                "windowAreaM2": round(session.window_area_m2, 4),
                "windows": [_rect_json(w) for w in session.windows],
            }
        )
    out["sessions"] = sessions_json
    steps_json = []
    for step in layout.steps:
        step_data: dict[str, Any] = {"id": step.id, "kind": step.kind, "title": step.title}
        if step.session_id is not None:
            step_data["sessionId"] = step.session_id
        steps_json.append(step_data)
    out["steps"] = steps_json
    out["totals"] = layout.totals
    out["alerts"] = list(layout.alerts)
    return out


# --------------------------------------------------------------------------
# DEPRECATED v1 per-region adhesive geometry
# --------------------------------------------------------------------------

@dataclass
class AdhesiveBand:
    """DEPRECATED (v1): use the layout stage (StripInfo/LayoutRect) instead.
    Kept only for callers of compute_region_adhesive."""

    width_cm: float
    linear_m: float
    y_start_cm: float


@dataclass
class RegionAdhesive:
    """DEPRECATED (v1): use FaceLayout/compute_face_layout instead. No longer
    produced by the pipeline (artifact["adhesive"] was replaced by
    artifact["layout"])."""

    region_id: str
    bands: list[AdhesiveBand] = field(default_factory=list)
    adhesive_area_m2: float = 0.0
    element_area_m2: float = 0.0
    waste_m2: float = 0.0
    transfer_linear_m: float = 0.0


def compute_region_adhesive(
    region: Region,
    labels_mask: np.ndarray,
    params: EngineParams,
    px_per_cm: float,
) -> RegionAdhesive:
    """DEPRECATED (v1): per-region banding ignored strip fusion, stacking
    overlap, paper and paint windows. Superseded by compute_face_layout; kept
    temporarily for external callers, out of the pipeline."""
    margin = params.adhesive_margin_cm
    rows = np.flatnonzero(labels_mask.any(axis=1))
    if rows.size == 0:
        return RegionAdhesive(region_id=region.id)
    r0, r1 = int(rows[0]), int(rows[-1]) + 1
    height_cm = (r1 - r0) / px_per_cm + 2 * margin

    band_widths = _cover_height(height_cm, list(params.adhesive_widths_cm))

    bands: list[AdhesiveBand] = []
    total_adhesive_m2 = 0.0
    gap_px = max(4, int(params.layout_segment_gap_cm * px_per_cm))
    y_cursor_px = r0 - margin * px_per_cm
    for width in band_widths:
        band_h_px = width * px_per_cm
        band_r0 = max(0, int(np.floor(y_cursor_px)))
        band_r1 = min(labels_mask.shape[0], int(np.ceil(y_cursor_px + band_h_px)))
        band_slice = labels_mask[band_r0:band_r1]
        cols = np.flatnonzero(band_slice.any(axis=0))
        if cols.size == 0:
            y_cursor_px += band_h_px
            continue
        breaks = np.flatnonzero(np.diff(cols) > gap_px)
        starts = np.concatenate([[0], breaks + 1])
        ends = np.concatenate([breaks, [cols.size - 1]])
        band_linear_m = 0.0
        for s, e in zip(starts, ends):
            span_cm = (int(cols[e]) - int(cols[s]) + 1) / px_per_cm + 2 * margin
            band_linear_m += span_cm / 100.0
        bands.append(
            AdhesiveBand(
                width_cm=float(width),
                linear_m=round(band_linear_m, 3),
                y_start_cm=round((band_r0 - r0) / px_per_cm, 1),
            )
        )
        total_adhesive_m2 += band_linear_m * (width / 100.0)
        y_cursor_px += band_h_px

    transfer_linear_m = total_adhesive_m2 / (params.transfer_mask_width_cm / 100.0)
    return RegionAdhesive(
        region_id=region.id,
        bands=bands,
        adhesive_area_m2=round(total_adhesive_m2, 4),
        element_area_m2=region.area_m2,
        waste_m2=round(max(0.0, total_adhesive_m2 - region.area_m2), 4),
        transfer_linear_m=round(transfer_linear_m, 3),
    )
