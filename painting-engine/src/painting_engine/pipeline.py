"""Pipeline orchestrator: runs selected stages and emits a single versioned
JSON artifact. Stage names are stable identifiers used by the API layer to run
partial analyses (independent testability requirement)."""

from __future__ import annotations

import time
from dataclasses import asdict
from typing import Any

import numpy as np

from .boundaries import extract_boundaries
from .classify import classify_regions, collect_edge_alerts
from .ingest import IngestResult, load_image
from .masks import compute_face_layout, layout_to_json
from .params import EngineParams
from .quantize import QuantizeResult, quantize
from .regions import Region, extract_regions
from .version import ENGINE_VERSION

ALL_STAGES = ("quantize", "regions", "classify", "boundaries", "layout")

# v1 name kept as an alias: "adhesive" now runs the layout stage
STAGE_ALIASES = {"adhesive": "layout"}

# real dependency DAG: requesting a stage pulls only its ancestors
# (layout <- classify <- regions <- quantize; boundaries <- regions)
_DEPS: dict[str, tuple[str, ...]] = {
    "quantize": (),
    "regions": ("quantize",),
    "classify": ("regions",),
    "boundaries": ("regions",),
    "layout": ("classify",),
}


def _expand_stages(stages: list[str] | None) -> list[str]:
    if not stages:
        return list(ALL_STAGES)
    requested = [
        STAGE_ALIASES.get(s.strip().lower(), s.strip().lower()) for s in stages if s.strip()
    ]
    unknown = [s for s in requested if s not in ALL_STAGES]
    if unknown:
        raise ValueError(f"unknown stages: {unknown}; valid: {ALL_STAGES}")
    needed: set[str] = set()

    def _add(stage: str) -> None:
        if stage in needed:
            return
        for dep in _DEPS[stage]:
            _add(dep)
        needed.add(stage)

    for stage in requested:
        _add(stage)
    return [s for s in ALL_STAGES if s in needed]


def parse_sessions(value: Any) -> list[list[int]] | None:
    """Accepts None, a list of lists of palette indexes, or the CLI string
    format "4;2,7;-1" (";" separates sessions, "," separates colors,
    -1 = photographic)."""
    if value is None:
        return None
    if isinstance(value, str):
        return [
            [int(token) for token in group.split(",") if token.strip()]
            for group in value.split(";")
            if group.strip()
        ] or None
    return [[int(c) for c in group] for group in value]


def run_pipeline(
    image_path: str,
    reference_kind: str,
    reference_value_cm: float,
    params: EngineParams | None = None,
    stages: list[str] | None = None,
    sessions: list[list[int]] | None = None,
) -> dict[str, Any]:
    params = params or EngineParams()
    selected = _expand_stages(stages)
    timings: dict[str, float] = {}

    t0 = time.perf_counter()
    ingest: IngestResult = load_image(image_path, params, reference_kind, reference_value_cm)
    timings["ingest"] = round(time.perf_counter() - t0, 2)

    h, w = ingest.rgb_work.shape[:2]
    artifact: dict[str, Any] = {
        "engineVersion": ENGINE_VERSION,
        "params": params.to_dict(),
        "stagesRun": selected,
        "image": {
            "originalWidthPx": int(ingest.rgb_original.shape[1]),
            "originalHeightPx": int(ingest.rgb_original.shape[0]),
            "workWidthPx": int(w),
            "workHeightPx": int(h),
            "workScale": round(ingest.work_scale, 5),
            "pxPerCmOriginal": round(ingest.px_per_cm_original, 4),
            "pxPerCmWork": round(ingest.px_per_cm_work, 4),
            "widthCm": round(w / ingest.px_per_cm_work, 1),
            "heightCm": round(h / ingest.px_per_cm_work, 1),
            "areaM2": round((w / ingest.px_per_cm_work) * (h / ingest.px_per_cm_work) / 10_000.0, 3),
        },
        "alerts": [],
    }

    quant: QuantizeResult | None = None
    regions: list[Region] = []
    comp_map: np.ndarray | None = None
    kinds: dict[str, dict] = {}

    if "quantize" in selected:
        t0 = time.perf_counter()
        quant = quantize(
            ingest.rgb_original,
            ingest.rgb_work,
            params,
            ingest.px_per_cm_original,
            ingest.px_per_cm_work,
        )
        timings["quantize"] = round(time.perf_counter() - t0, 2)
        artifact["palette"] = [
            {
                "index": i,
                "hex": quant.palette_hex[i],
                "lab": [round(float(v), 2) for v in quant.palette_lab[i]],
                "pixelPct": quant.palette_pct[i],
                "gradient": (quant.palette_gradient[i]
                             if i < len(quant.palette_gradient) else False),
            }
            for i in range(quant.palette_lab.shape[0])
        ]
        artifact["background"] = {
            "index": quant.background_index,
            "hex": quant.palette_hex[quant.background_index],
            "mode": quant.background_mode,
            "coveragePct": quant.background_coverage,
        }
        artifact["photoZoneAreaPct"] = round(float(quant.photo_mask.mean()), 4)
        artifact["photoZones"] = quant.photo_zone_audit
        artifact["alerts"].extend(quant.alerts)

    if quant is not None and "regions" in selected:
        t0 = time.perf_counter()
        regions, comp_map = extract_regions(quant, params, ingest.px_per_cm_work)
        timings["regions"] = round(time.perf_counter() - t0, 2)

    if quant is not None and regions and "classify" in selected:
        t0 = time.perf_counter()
        kinds = classify_regions(regions, quant, ingest.rgb_work, params, ingest.px_per_cm_work)
        timings["classify"] = round(time.perf_counter() - t0, 2)
        artifact["alerts"].extend(
            collect_edge_alerts(
                regions,
                params,
                ingest.px_per_cm_work,
                image_height_px=h,
                palette_lab=quant.palette_lab,
            )
        )

    if regions:
        artifact["regions"] = []
        for region in regions:
            data = asdict(region)
            info = kinds.get(region.id, {})
            data["kind"] = info.get("kind", "RESERVA" if region.is_background else "CHAPADA")
            data["gradient"] = info.get("gradient")
            if info.get("photoStats"):
                data["photoStats"] = info["photoStats"]
            artifact["regions"].append(data)

    if quant is not None and regions and comp_map is not None and "boundaries" in selected:
        t0 = time.perf_counter()
        boundary_list = extract_boundaries(quant, regions, comp_map, params, ingest.px_per_cm_work)
        timings["boundaries"] = round(time.perf_counter() - t0, 2)
        artifact["boundaries"] = [asdict(b) for b in boundary_list]

    if quant is not None and comp_map is not None and "layout" in selected:
        t0 = time.perf_counter()
        layout = compute_face_layout(
            regions,
            kinds,
            quant,
            comp_map,
            params,
            ingest.px_per_cm_work,
            sessions=sessions,
        )
        timings["layout"] = round(time.perf_counter() - t0, 2)
        artifact["layout"] = layout_to_json(layout)
        artifact["alerts"].extend(layout.alerts)

    artifact["timingsSec"] = timings
    return artifact


def render_overlay(image_path: str, artifact: dict[str, Any], out_path: str) -> None:
    """Debug/UI helper: quantized colors + boundary paths burned in."""
    from PIL import Image, ImageDraw

    width = artifact["image"]["workWidthPx"]
    height = artifact["image"]["workHeightPx"]
    img = Image.open(image_path).convert("RGB").resize((width, height))
    draw = ImageDraw.Draw(img, "RGBA")
    for region in artifact.get("regions", []):
        pts = [(x, y) for x, y in region["contour"]]
        if len(pts) >= 3:
            color = (255, 0, 90, 90) if region["kind"] == "MICRO" else (0, 120, 255, 70)
            draw.polygon(pts, outline=(20, 20, 20, 255), fill=None)
            if region["kind"] in ("MICRO", "FOTOGRAFICO", "DEGRADE"):
                draw.polygon(pts, fill=color)
    for boundary in artifact.get("boundaries", []):
        if boundary["kind"] == "PAINT_PAINT" and boundary.get("sample_path"):
            pts = [(x, y) for x, y in boundary["sample_path"]]
            if len(pts) >= 2:
                draw.line(pts, fill=(255, 40, 40, 255), width=3)
    img.save(out_path)
