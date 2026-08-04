"""v2 layout stage: band cover rules, strip/segment thresholds, paper tiling,
paint windows, empty faces, pipeline integration and the photographic-zone
vector rescue (phases A/B)."""

from __future__ import annotations

import json

import numpy as np
import pytest
from PIL import Image
from scipy import ndimage as ndi

from painting_engine.colors import srgb_to_lab
from painting_engine.masks import (
    _band_segments,
    _cover_height,
    _find_strips,
    compute_face_layout,
    layout_to_json,
)
from painting_engine.params import EngineParams
from painting_engine.pipeline import run_pipeline
from painting_engine.quantize import _per_tile_distinct, _rescue_vector_zones

from conftest import make_layout_case

WIDTHS = [50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 110.0, 120.0]


# --------------------------------------------------------------------------
# _cover_height
# --------------------------------------------------------------------------

def test_cover_height_margin_rule():
    margin = 2.0
    cases = [(104, [110.0]), (96, [100.0]), (46, [50.0]), (107, [120.0])]
    for strip_height, expected in cases:
        cover = strip_height + 2 * margin
        assert _cover_height(cover, WIDTHS, overlap_cm=1.0) == expected, strip_height


def test_cover_height_stacks_above_120():
    cover = 276 + 4.0  # strip height + 2x margin
    bands = _cover_height(cover, WIDTHS, overlap_cm=1.0)
    assert bands == [120.0, 120.0, 50.0]
    assert sum(bands) - (len(bands) - 1) * 1.0 >= cover


# --------------------------------------------------------------------------
# strip / segment thresholds
# --------------------------------------------------------------------------

def test_strip_split_threshold():
    def strips_for(gap_cm: float) -> int:
        px_per_cm = 10.0
        gap_px = int(round(gap_cm * px_per_cm))
        mask = np.zeros((600, 200), dtype=bool)
        a0, block = 10, 200
        mask[a0 : a0 + block, 50:150] = True
        b0 = a0 + block + gap_px
        mask[b0 : b0 + block, 50:150] = True
        return len(_find_strips(mask, px_per_cm, gap_cm=10.0))

    assert strips_for(9.9) == 1   # gap < 10 cm merges
    assert strips_for(10.1) == 2  # gap >= 10 cm splits


def test_segment_split_threshold():
    params = EngineParams()

    def segments_for(gap_cm: int) -> int:
        mask = np.zeros((30, 300), dtype=bool)
        mask[5:25, 10:60] = True
        mask[5:25, 60 + gap_cm : 60 + gap_cm + 50] = True
        return len(_band_segments(mask, 0, 30, params, px_per_cm=1.0))

    assert segments_for(39) == 1  # gap <= 40 cm stays one segment
    assert segments_for(41) == 2  # gap > 40 cm splits


# --------------------------------------------------------------------------
# 100 FRONTEIRAS canonical scenario
# --------------------------------------------------------------------------

def test_fronteiras_scenario():
    regions, kinds, quant, comp_map = make_layout_case(
        600,
        250,
        [
            {"rect": (100, 20, 350, 104), "rgb": (30, 120, 40)},   # logo, h=104
            {"rect": (150, 154, 250, 20), "rgb": (20, 20, 20)},    # text, gap 30
        ],
    )
    layout = compute_face_layout(regions, kinds, quant, comp_map, EngineParams(), 1.0)

    assert [s.band_widths for s in layout.strips] == [[110.0], [50.0]]
    assert [s.merged_from for s in layout.strips] == [[], []]
    # WHITE_PLATE step order
    assert [s.kind for s in layout.steps] == [
        "APPLY_BANDS",
        "PAPER",
        "PAINT_SESSION",
        "PAINT_SESSION",
    ]
    data = layout_to_json(layout)
    json.dumps(data)
    assert data["totals"]["adhesiveAreaM2"] > 0
    for strip in data["strips"]:
        for band in strip["bands"]:
            assert band["hCm"] == band["widthClassCm"]  # unrotated band invariant


# --------------------------------------------------------------------------
# paper
# --------------------------------------------------------------------------

def test_paper_halo_exact_tiling():
    params = EngineParams()
    regions, kinds, quant, comp_map = make_layout_case(
        600, 200, [{"rect": (270, 80, 60, 40), "rgb": (200, 30, 30)}]
    )
    layout = compute_face_layout(regions, kinds, quant, comp_map, params, 1.0)

    assert len(layout.strips) == 1 and len(layout.strips[0].bands) == 1
    band = layout.strips[0].bands[0]
    radius = params.paper_protect_radius_cm
    zx0, zx1 = max(0.0, band.x_cm - radius), min(600.0, band.x_cm + band.w_cm + radius)
    zy0, zy1 = max(0.0, band.y_cm - radius), min(200.0, band.y_cm + band.h_cm + radius)
    expected_cm2 = (zx1 - zx0) * (zy1 - zy0) - band.w_cm * band.h_cm

    panels = layout.paper_panels
    assert panels
    got_cm2 = sum(p.w_cm * p.h_cm for p in panels)
    assert got_cm2 == pytest.approx(expected_cm2, abs=1e-6)          # exact tiling
    assert layout.totals["paperAreaM2"] == pytest.approx(expected_cm2 / 1e4, abs=1e-3)
    for panel in panels:
        assert min(panel.w_cm, panel.h_cm) <= params.paper_roll_width_cm + 1e-6
    for i in range(len(panels)):                                     # no overlap
        for j in range(i + 1, len(panels)):
            a, b = panels[i], panels[j]
            ox = min(a.x_cm + a.w_cm, b.x_cm + b.w_cm) - max(a.x_cm, b.x_cm)
            oy = min(a.y_cm + a.h_cm, b.y_cm + b.h_cm) - max(a.y_cm, b.y_cm)
            assert not (ox > 1e-6 and oy > 1e-6)
    assert layout.tape_perimeter_m > 0


def test_paper_full_face_general_paint():
    regions, kinds, quant, comp_map = make_layout_case(
        600,
        200,
        [{"rect": (100, 60, 120, 80), "rgb": (240, 200, 40)}],
        mode="GENERAL_PAINT",
        bg_rgb=(30, 34, 40),
    )
    layout = compute_face_layout(regions, kinds, quant, comp_map, EngineParams(), 1.0)

    step_kinds = [s.kind for s in layout.steps]
    assert step_kinds[:3] == ["PAINT_GENERAL", "APPLY_BANDS", "PAPER"]
    assert step_kinds[3:] and all(k == "PAINT_SESSION" for k in step_kinds[3:])

    s0 = layout.sessions[0]
    assert s0.id == "s0" and s0.kind == "GENERAL"
    assert s0.windows[0].id == "win-s0.face"
    assert s0.window_area_m2 == pytest.approx(600 * 200 / 1e4)

    band_cm2 = sum(b.w_cm * b.h_cm for st in layout.strips for b in st.bands)
    paper_cm2 = sum(p.w_cm * p.h_cm for p in layout.paper_panels)
    assert paper_cm2 == pytest.approx(600 * 200 - band_cm2, abs=1e-6)  # full face - bands


# --------------------------------------------------------------------------
# paint windows
# --------------------------------------------------------------------------

def test_paint_window_hull_not_vector():
    def ring(mask: np.ndarray) -> None:
        yy, xx = np.mgrid[0 : mask.shape[0], 0 : mask.shape[1]]
        d2 = (yy - 100) ** 2 + (xx - 300) ** 2
        mask |= (d2 <= 60**2) & (d2 >= 40**2)

    regions, kinds, quant, comp_map = make_layout_case(
        600, 200, [{"mask": ring, "rgb": (200, 40, 40)}]
    )
    layout = compute_face_layout(regions, kinds, quant, comp_map, EngineParams(), 1.0)

    session = next(s for s in layout.sessions if s.color_indexes == [1])
    assert session.windows
    # the window is the rectangular hull: much larger than the ring itself
    assert session.window_area_m2 > regions[0].area_m2 * 1.5
    assert layout.totals["paintWindowAreaM2BySession"][session.id] == pytest.approx(
        session.window_area_m2, abs=1e-3
    )


def test_empty_face():
    regions, kinds, quant, comp_map = make_layout_case(600, 200, [])
    layout = compute_face_layout(regions, kinds, quant, comp_map, EngineParams(), 1.0)
    assert layout.empty is True
    assert [a["code"] for a in layout.alerts] == ["LAYOUT_EMPTY"]
    assert layout.strips == []
    assert layout.paper_panels == []
    assert layout.steps == []
    json.dumps(layout_to_json(layout))


# --------------------------------------------------------------------------
# pipeline integration: layout stage + adhesive alias + DAG
# --------------------------------------------------------------------------

def test_pipeline_layout_stage_and_alias(synthetic_flag):
    direct = run_pipeline(
        image_path=str(synthetic_flag),
        reference_kind="TOTAL_LENGTH",
        reference_value_cm=1500.0,
        stages=["layout"],
    )
    assert "layout" in direct
    assert "adhesive" not in direct
    assert "boundaries" not in direct  # DAG: layout must not drag boundaries in
    assert direct["stagesRun"] == ["quantize", "regions", "classify", "layout"]
    assert direct["layout"]["strips"]

    aliased = run_pipeline(
        image_path=str(synthetic_flag),
        reference_kind="TOTAL_LENGTH",
        reference_value_cm=1500.0,
        stages=["adhesive"],
    )
    assert "adhesive" not in aliased
    assert aliased["stagesRun"] == direct["stagesRun"]
    assert aliased["layout"]["totals"] == direct["layout"]["totals"]


# --------------------------------------------------------------------------
# photographic detector v2: flag rescue
# --------------------------------------------------------------------------

def _old_phase_a_mask(rgb: np.ndarray, params: EngineParams, px_per_cm: float) -> np.ndarray:
    """The v1 gate: tile entropy alone (no soft-gradient requirement)."""
    tile = params.photo_tile_px
    distinct = _per_tile_distinct(rgb, tile)
    if distinct.size == 0:
        return np.zeros(rgb.shape[:2], dtype=bool)
    th, tw = distinct.shape
    mask = np.zeros(rgb.shape[:2], dtype=bool)
    photo_tiles = distinct >= params.photo_color_count
    mask[: th * tile, : tw * tile] = np.repeat(
        np.repeat(photo_tiles, tile, axis=0), tile, axis=1
    )
    mask = ndi.binary_closing(mask, structure=np.ones((3, 3)), iterations=2)
    mask = ndi.binary_opening(mask, structure=np.ones((3, 3)), iterations=1)
    labeled, n = ndi.label(mask)
    if n:
        min_px = params.photo_min_area_cm2 * px_per_cm**2
        sizes = ndi.sum_labels(np.ones_like(labeled), labeled, index=np.arange(1, n + 1))
        keep = np.flatnonzero(sizes >= min_px) + 1
        mask = np.isin(labeled, keep)
    return mask


def test_flag_rescue(synthetic_flag_on_plate):
    params = EngineParams()
    rgb = np.asarray(Image.open(synthetic_flag_on_plate).convert("RGB"), dtype=np.uint8)

    # fixture premise: the OLD phase A would have captured this emblem
    old_mask = _old_phase_a_mask(rgb, params, px_per_cm=1.0)
    assert old_mask.any(), "fixture must trigger the v1 tile-entropy gate"

    artifact = run_pipeline(
        image_path=str(synthetic_flag_on_plate),
        reference_kind="TOTAL_LENGTH",
        reference_value_cm=600.0,
    )

    flag = (255.0, 65.0, 345.0, 135.0)  # generous (x0, y0, x1, y1) cm around the emblem

    def overlaps_flag(region: dict) -> bool:
        r0, c0, r1, c1 = region["bbox"]
        px = artifact["image"]["pxPerCmWork"]
        x0, y0, x1, y1 = c0 / px, r0 / px, c1 / px, r1 / px
        return x0 < flag[2] and x1 > flag[0] and y0 < flag[3] and y1 > flag[1]

    # the final photo mask must NOT cover the flag
    photo_regions = [r for r in artifact["regions"] if r["kind"] == "FOTOGRAFICO"]
    assert not [r for r in photo_regions if overlaps_flag(r)]

    # the flag colors become plain CHAPADA regions
    chapadas = [
        r
        for r in artifact["regions"]
        if r["kind"] == "CHAPADA" and not r["is_background"] and overlaps_flag(r)
    ]
    assert len(chapadas) >= 3

    # either phase B demoted the zone (alert + audit) or phase A never fired
    codes = {a["code"] for a in artifact["alerts"]}
    demoted = [z for z in artifact.get("photoZones", []) if not z["kept"]]
    assert ("VECTOR_EMBLEM_RESCUED" in codes and demoted) or (
        artifact["photoZoneAreaPct"] < 0.01 and not demoted
    )
    if demoted:
        assert "VECTOR_EMBLEM_RESCUED" in codes

    # new geometric facts: containment chain inside the emblem and the
    # background side of WITH_BACKGROUND boundaries identified
    assert any(r.get("contained_by") for r in chapadas)
    with_bg = [b for b in artifact["boundaries"] if b["kind"] == "WITH_BACKGROUND"]
    assert with_bg and all(b["bg_region"] for b in with_bg)


# --------------------------------------------------------------------------
# phase B unit coverage (both directions)
# --------------------------------------------------------------------------

def test_rescue_vector_zones_unit_demotes_mosaic():
    params = EngineParams()
    rgb = np.zeros((120, 120, 3), dtype=np.uint8)
    rgb[:60, :60] = (0, 156, 59)
    rgb[:60, 60:] = (254, 223, 0)
    rgb[60:, :60] = (0, 39, 118)
    rgb[60:, 60:] = (200, 30, 30)
    lab = srgb_to_lab(rgb)
    mask = np.zeros((120, 120), dtype=bool)
    mask[10:110, 10:110] = True

    new_mask, audit, alerts = _rescue_vector_zones(mask, rgb, lab, params, px_per_cm=1.0)
    assert not new_mask.any()
    assert len(audit) == 1 and audit[0]["kept"] is False
    assert audit[0]["realColors"] <= params.photo_rescue_max_colors
    assert audit[0]["residualPct"] <= params.photo_rescue_max_residual_pct
    assert [a["code"] for a in alerts] == ["VECTOR_EMBLEM_RESCUED"]


def test_rescue_vector_zones_unit_keeps_continuous_tone():
    params = EngineParams()
    yy, xx = np.mgrid[0:130, 0:130].astype(np.float64)
    r = 120 + np.sin(xx / 9.0) * 80 + np.cos(yy / 13.0) * 60
    g = 110 + np.cos(xx / 7.0) * 70 + np.sin(yy / 11.0) * 70
    b = 100 + np.sin((xx + yy) / 10.0) * 90
    rgb = np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8)
    lab = srgb_to_lab(rgb)
    mask = np.ones((130, 130), dtype=bool)

    new_mask, audit, alerts = _rescue_vector_zones(mask, rgb, lab, params, px_per_cm=1.0)
    assert new_mask.any()
    assert len(audit) == 1 and audit[0]["kept"] is True
    assert alerts == []
