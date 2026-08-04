"""S4 — per-region kind classification.

Kinds (business meaning decided later by the API layer):
- CHAPADA            solid color -> lacquer inside a mask
- DEGRADE            coherent linear/radial gradient -> airbrush inside a mask
- FOTOGRAFICO        photographic/metallic zone -> artistic airbrush block
- MICRO              stroke/letter too small to cut+paint comfortably
- TEXTURA            many small same-color islands (heavy weeding, still cuttable)
- RESERVA            background-colored region (plate or preserved base — never painted)
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi

from .colors import srgb_to_lab
from .params import EngineParams
from .quantize import QuantizeResult
from .regions import Region


def _gradient_info(
    lab_l: np.ndarray, mask: np.ndarray
) -> tuple[float, str | None, float | None]:
    """Fit L* as a linear function of (x, y) and as a function of radius.
    Returns (best_r2, type, angle_deg)."""
    rows, cols = np.nonzero(mask)
    if rows.size < 64:
        return 0.0, None, None
    sample = slice(None) if rows.size <= 20_000 else slice(0, None, rows.size // 20_000)
    r, c = rows[sample], cols[sample]
    values = lab_l[r, c]
    var = float(np.var(values))
    if var < 1e-6:
        return 0.0, None, None

    design = np.stack([c, r, np.ones_like(c)], axis=1).astype(np.float64)
    coef, *_ = np.linalg.lstsq(design, values, rcond=None)
    residual = values - design @ coef
    r2_linear = 1.0 - float(np.var(residual)) / var

    cy, cx = float(r.mean()), float(c.mean())
    radius = np.hypot(r - cy, c - cx)
    design_r = np.stack([radius, np.ones_like(radius)], axis=1)
    coef_r, *_ = np.linalg.lstsq(design_r, values, rcond=None)
    residual_r = values - design_r @ coef_r
    r2_radial = 1.0 - float(np.var(residual_r)) / var

    if r2_linear >= r2_radial:
        angle = float(np.degrees(np.arctan2(coef[1], coef[0]))) % 360.0
        return r2_linear, "LINEAR", round(angle, 1)
    return r2_radial, "RADIAL", None


def classify_regions(
    regions: list[Region],
    quant: QuantizeResult,
    rgb_work: np.ndarray,
    params: EngineParams,
    px_per_cm: float,
) -> dict[str, dict]:
    """Returns {region_id: {kind, gradient?}} — kept separate from Region so the
    stage can be re-run with new params without re-extracting geometry."""
    lab_l = srgb_to_lab(rgb_work)[..., 0]
    labels = quant.labels

    # texture detection is a property of a color, not of a single component
    texture_colors: set[int] = set()
    for color_index in range(quant.palette_lab.shape[0]):
        if color_index == quant.background_index:
            continue
        members = [r for r in regions if r.color_index == color_index]
        if len(members) >= params.texture_component_count:
            areas_cm2 = np.array([r.area_m2 * 10_000 for r in members])
            if float(np.median(areas_cm2)) <= params.texture_median_cm2:
                texture_colors.add(color_index)

    kept_zones = [z for z in getattr(quant, "photo_zone_audit", []) if z.get("kept")]

    def _photo_stats(region: Region) -> dict | None:
        """Zone-verification metrics for the audit zone overlapping this region
        (why-airbrush justification for the UI)."""
        rx0, ry0 = region.bbox[1] / px_per_cm, region.bbox[0] / px_per_cm
        rx1, ry1 = region.bbox[3] / px_per_cm, region.bbox[2] / px_per_cm
        best, best_overlap = None, 0.0
        for zone in kept_zones:
            zx, zy, zw, zh = zone["bboxCm"]
            ox = max(0.0, min(rx1, zx + zw) - max(rx0, zx))
            oy = max(0.0, min(ry1, zy + zh) - max(ry0, zy))
            if ox * oy > best_overlap:
                best_overlap = ox * oy
                best = zone
        if best is None:
            return None
        return {
            "realColors": best["realColors"],
            "residualPct": best["residualPct"],
            "hardShare": best["hardShare"],
        }

    out: dict[str, dict] = {}
    for region in regions:
        if region.color_index == -1:
            out[region.id] = {
                "kind": "FOTOGRAFICO",
                "gradient": None,
                "photoStats": _photo_stats(region),
            }
            continue
        if region.is_background:
            out[region.id] = {"kind": "RESERVA", "gradient": None}
            continue
        if region.color_index in texture_colors:
            out[region.id] = {"kind": "TEXTURA", "gradient": None}
            continue

        height_cm = region.bbox_cm[1]
        if (
            0 < region.min_stroke_mm < params.micro_stroke_mm
            or 0 < height_cm < params.micro_letter_cm
        ):
            out[region.id] = {"kind": "MICRO", "gradient": None}
            continue

        sl = (
            slice(region.bbox[0], region.bbox[2]),
            slice(region.bbox[1], region.bbox[3]),
        )
        mask = labels[sl] == region.color_index
        values = lab_l[sl][mask]
        std = float(values.std()) if values.size else 0.0
        if std <= params.flat_std_delta_e:
            out[region.id] = {"kind": "CHAPADA", "gradient": None}
            continue

        r2, gtype, angle = _gradient_info(lab_l[sl], mask)
        if r2 >= params.gradient_fit_r2 and gtype:
            out[region.id] = {
                "kind": "DEGRADE",
                "gradient": {"type": gtype, "angleDeg": angle, "fitR2": round(r2, 3)},
            }
        else:
            out[region.id] = {"kind": "CHAPADA", "gradient": None}
    return out


def collect_edge_alerts(
    regions: list[Region],
    params: EngineParams,
    px_per_cm: float,
    image_height_px: int | None = None,
    palette_lab: np.ndarray | None = None,
) -> list[dict]:
    alerts: list[dict] = []

    # mockup ground-shadow suspects: gray, low-chroma, elongated, hugging the
    # bottom of the file — flagged for human confirmation, never auto-dropped
    if image_height_px and palette_lab is not None:
        suspects = []
        for region in regions:
            if region.is_background or region.color_index < 0:
                continue
            lab = palette_lab[region.color_index]
            region_chroma = float(np.hypot(lab[1], lab[2]))
            elongated = region.bbox_cm[1] > 0 and region.bbox_cm[0] / region.bbox_cm[1] > 5.0
            near_bottom = region.bbox[2] >= image_height_px * 0.88
            grayish = region_chroma < 10.0 and 35.0 <= float(lab[0]) <= 88.0
            if grayish and elongated and near_bottom and region.area_m2 > 0.5:
                suspects.append(region.id)
        if suspects:
            alerts.append(
                {
                    "code": "MOCKUP_SHADOW_SUSPECT",
                    "severity": "WARNING",
                    "message": (
                        f"Região(ões) {', '.join(suspects[:5])} parecem sombra/efeito do mockup "
                        "(cinza alongado no rodapé) — confirme se realmente serão pintadas ou "
                        "marque como 'sem intervenção'."
                    ),
                }
            )
    cropped = [
        r
        for r in regions
        if r.touches_border and not r.is_background and r.bbox_cm[0] * r.bbox_cm[1] > 0
        and max(r.bbox_cm) >= params.edge_crop_min_cm
    ]
    if cropped:
        ids = ", ".join(r.id for r in cropped[:6])
        alerts.append(
            {
                "code": "EDGE_CROPPED_CONTENT",
                "severity": "WARNING",
                "message": (
                    f"{len(cropped)} elemento(s) tocam a borda do arquivo ({ids}) — "
                    "verificar se a arte está cortada/incompleta."
                ),
            }
        )
    micro = [r for r in regions if 0 < r.min_stroke_mm < params.micro_stroke_mm]
    if micro:
        alerts.append(
            {
                "code": "MICRO_DETAIL_PRESENT",
                "severity": "INFO",
                "message": (
                    f"{len(micro)} região(ões) com traço abaixo de "
                    f"{params.micro_stroke_mm:.0f} mm — recorte fino de alta complexidade "
                    "ou aerografia à mão livre."
                ),
            }
        )
    return alerts
