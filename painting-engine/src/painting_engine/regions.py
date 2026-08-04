"""S3 — region extraction: connected components per palette color, topology,
vectorized contours and physical metrics."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi
from shapely.geometry import Polygon
from skimage import measure
from skimage.morphology import medial_axis

from .params import EngineParams
from .quantize import QuantizeResult


@dataclass
class Region:
    id: str
    color_index: int            # -1 for photographic zones
    hex: str
    area_px: int
    area_m2: float
    perimeter_m: float
    bbox: tuple[int, int, int, int]      # (min_row, min_col, max_row, max_col) work px
    bbox_cm: tuple[float, float]         # (width_cm, height_cm)
    islands: int                          # holes inside the region (weeding cost)
    min_stroke_mm: float
    centroid: tuple[float, float]        # (x, y) work px
    contour: list[list[float]]           # exterior ring [[x, y], ...] work px
    holes: list[list[list[float]]] = field(default_factory=list)
    is_background: bool = False
    touches_border: bool = False
    contained_by: str | None = None      # id of the non-bg region whose exterior
                                         # ring fully contains this one (emblem
                                         # sequencing input); None otherwise


def _simplify_ring(points: np.ndarray, tolerance_px: float) -> list[list[float]]:
    if points.shape[0] < 4:
        return [[float(x), float(y)] for y, x in points]
    poly = Polygon([(float(c), float(r)) for r, c in points])
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.is_empty:
            return [[float(x), float(y)] for y, x in points[:: max(1, points.shape[0] // 64)]]
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
    simplified = poly.simplify(tolerance_px, preserve_topology=True)
    if simplified.is_empty or simplified.geom_type != "Polygon":
        return [[float(x), float(y)] for y, x in points[:: max(1, points.shape[0] // 64)]]
    return [[round(float(x), 1), round(float(y), 1)] for x, y in simplified.exterior.coords]


def _component_geometry(
    mask: np.ndarray,
    offset: tuple[int, int],
    tolerance_px: float,
) -> tuple[list[list[float]], list[list[list[float]]], float]:
    """Returns (exterior, holes, perimeter_px) for a component mask (local crop)."""
    padded = np.pad(mask, 1, mode="constant")
    contours = measure.find_contours(padded.astype(np.float32), 0.5)
    if not contours:
        return [], [], 0.0

    rings: list[tuple[np.ndarray, float, float]] = []
    for contour in contours:
        pts = contour - 1.0  # unpad
        pts[:, 0] += offset[0]
        pts[:, 1] += offset[1]
        length = float(np.sum(np.hypot(*(np.diff(pts, axis=0).T))))
        area = 0.0
        if pts.shape[0] >= 3:
            y, x = pts[:, 0], pts[:, 1]
            area = 0.5 * float(np.abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1))))
        rings.append((pts, length, area))

    rings.sort(key=lambda r: r[2], reverse=True)
    exterior_pts, exterior_len, _ = rings[0]
    holes = [_simplify_ring(pts, tolerance_px) for pts, _, area in rings[1:] if area > 4.0]
    perimeter_px = exterior_len + sum(length for _, length, area in rings[1:] if area > 4.0)
    return _simplify_ring(exterior_pts, tolerance_px), holes, perimeter_px


def _min_stroke_mm(mask: np.ndarray, px_per_cm: float) -> float:
    if mask.sum() < 4:
        return 0.0
    skeleton, distance = medial_axis(mask, return_distance=True)
    widths = distance[skeleton] * 2.0
    if widths.size == 0:
        return 0.0
    return round(float(np.percentile(widths, 10)) / px_per_cm * 10.0, 1)


_CONTAIN_MAX_W_CM = 200.0
_CONTAIN_MAX_H_CM = 150.0


def _region_polygon(region: Region) -> Polygon | None:
    """Exterior-ring polygon of the simplified contour ('A envolve B'
    semantics: holes deliberately ignored). None when degenerate."""
    if len(region.contour) < 3:
        return None
    poly = Polygon([(x, y) for x, y in region.contour])
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.is_empty:
            return None
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
        if poly.geom_type != "Polygon":
            return None
    return poly


def _fill_containment(regions: list[Region]) -> None:
    """Populate Region.contained_by: for every region whose bbox fits inside
    200x150 cm, find the smallest non-background region (same size cap, to keep
    this out of O(n^2) over full panels) whose exterior ring fully contains its
    contour."""
    small = [
        r
        for r in regions
        if r.bbox_cm[0] <= _CONTAIN_MAX_W_CM and r.bbox_cm[1] <= _CONTAIN_MAX_H_CM
    ]
    containers = [r for r in small if not r.is_background]
    if not containers or len(small) < 2:
        return
    poly_cache: dict[str, Polygon | None] = {}

    def poly_of(region: Region) -> Polygon | None:
        if region.id not in poly_cache:
            poly_cache[region.id] = _region_polygon(region)
        return poly_cache[region.id]

    for inner in small:
        best: Region | None = None
        for outer in containers:
            if outer.id == inner.id or outer.area_px <= inner.area_px:
                continue
            # cheap pre-filter: outer's px bbox must contain inner's px bbox
            if not (
                outer.bbox[0] <= inner.bbox[0]
                and outer.bbox[1] <= inner.bbox[1]
                and outer.bbox[2] >= inner.bbox[2]
                and outer.bbox[3] >= inner.bbox[3]
            ):
                continue
            if best is not None and outer.area_px >= best.area_px:
                continue  # keep the immediate (smallest) parent
            outer_poly = poly_of(outer)
            inner_poly = poly_of(inner)
            if outer_poly is None or inner_poly is None:
                continue
            try:
                if outer_poly.contains(inner_poly):
                    best = outer
            except Exception:  # pragma: no cover - shapely edge geometry
                continue
        if best is not None:
            inner.contained_by = best.id


def extract_regions(
    quant: QuantizeResult,
    params: EngineParams,
    px_per_cm: float,
) -> tuple[list[Region], np.ndarray]:
    """Returns (regions, comp_map) where comp_map holds 1-based region indexes
    (0 = absorbed/none) aligned with the returned list order."""
    labels = quant.labels
    h, w = labels.shape
    px_area_m2 = 1.0 / (px_per_cm * 100.0) ** 2
    tolerance_px = max(1.0, 0.5 * px_per_cm)  # simplify at 0.5 cm
    min_px = max(4, int(params.min_region_cm2 * px_per_cm**2))

    regions: list[Region] = []
    comp_map = np.zeros((h, w), dtype=np.int32)
    counter = 0

    sources: list[tuple[int, np.ndarray]] = [
        (i, labels == i) for i in range(quant.palette_lab.shape[0])
    ]
    if np.any(quant.photo_mask):
        sources.append((-1, quant.photo_mask))

    for color_index, color_mask in sources:
        if not np.any(color_mask):
            continue
        labeled, n = ndi.label(color_mask)
        objects = ndi.find_objects(labeled)
        for comp in range(1, n + 1):
            sl = objects[comp - 1]
            if sl is None:
                continue
            local = labeled[sl] == comp
            area_px = int(local.sum())
            if area_px < min_px and color_index != -1:
                continue
            filled = ndi.binary_fill_holes(local)
            hole_labeled, islands = ndi.label(filled & ~local)
            del hole_labeled

            exterior, holes, perimeter_px = _component_geometry(
                local, (sl[0].start, sl[1].start), tolerance_px
            )
            if not exterior:
                continue

            rows, cols = np.nonzero(local)
            centroid = (
                round(float(cols.mean() + sl[1].start), 1),
                round(float(rows.mean() + sl[0].start), 1),
            )
            bbox = (
                sl[0].start,
                sl[1].start,
                sl[0].stop,
                sl[1].stop,
            )
            touches_border = (
                bbox[0] == 0 or bbox[1] == 0 or bbox[2] >= h or bbox[3] >= w
            )

            counter += 1
            comp_map[sl][local] = counter
            hex_color = quant.palette_hex[color_index] if color_index >= 0 else "#multi"
            regions.append(
                Region(
                    id=f"r{counter}",
                    color_index=color_index,
                    hex=hex_color,
                    area_px=area_px,
                    area_m2=round(area_px * px_area_m2, 4),
                    perimeter_m=round(perimeter_px / px_per_cm / 100.0, 3),
                    bbox=bbox,
                    bbox_cm=(
                        round((bbox[3] - bbox[1]) / px_per_cm, 1),
                        round((bbox[2] - bbox[0]) / px_per_cm, 1),
                    ),
                    islands=int(islands),
                    min_stroke_mm=_min_stroke_mm(local, px_per_cm),
                    centroid=centroid,
                    contour=exterior,
                    holes=holes,
                    is_background=(color_index == quant.background_index),
                )
            )
            regions[-1].touches_border = touches_border

    _fill_containment(regions)
    return regions, comp_map
