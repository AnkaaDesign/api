from __future__ import annotations

import json

from painting_engine.params import EngineParams
from painting_engine.pipeline import run_pipeline


def _run(path, **overrides):
    params = EngineParams.from_dict(overrides or None)
    return run_pipeline(
        image_path=str(path),
        reference_kind="TOTAL_LENGTH",
        reference_value_cm=1500.0,  # 15 m truck side
        params=params,
    )


def test_synthetic_flag_end_to_end(synthetic_flag):
    artifact = _run(synthetic_flag)

    assert artifact["background"]["mode"] == "WHITE_PLATE"
    assert artifact["background"]["coveragePct"] > 0.5

    regions = artifact["regions"]
    non_bg = [r for r in regions if not r["is_background"]]
    hexes = {r["hex"] for r in non_bg}
    # red, blue, green, and the two purple halves (same hex)
    assert len(non_bg) >= 5
    assert len(hexes) >= 4

    # straight paint-paint frontier between red and blue
    paint_paint = [b for b in artifact["boundaries"] if b["kind"] == "PAINT_PAINT"]
    assert paint_paint, "red|blue frontier must be detected"
    dominant = {b["dominant_curve"] for b in paint_paint}
    assert "RETA" in dominant

    # green circle only touches background -> WITH_BACKGROUND boundary
    with_bg = [b for b in artifact["boundaries"] if b["kind"] == "WITH_BACKGROUND"]
    assert len(with_bg) >= 3

    # keyline between the two purple halves
    keylines = [b for b in artifact["boundaries"] if b["kind"] == "KEYLINE"]
    assert keylines, "4px white sliver must be registered as keyline"

    # scale: red rectangle is 400px wide of 2000px = 300 cm of 1500 cm.
    widths = sorted(r["bbox_cm"][0] for r in non_bg)
    assert any(abs(w - 300.0) < 12.0 for w in widths), widths

    # v2: layout stage replaces the per-region adhesive block
    assert "adhesive" not in artifact
    layout = artifact["layout"]
    assert layout["strips"], "paint content must produce at least one strip"
    assert layout["totals"]["adhesiveAreaM2"] > 0
    assert layout["sessions"], "paint colors must map to sessions"

    # artifact must be JSON-serializable
    json.dumps(artifact)


def test_synthetic_general_paint_mode(synthetic_general_paint):
    artifact = _run(synthetic_general_paint)
    assert artifact["background"]["mode"] == "GENERAL_PAINT"
    # white knockout must exist as a region (reserve, not paint)
    whites = [r for r in artifact["regions"] if r["hex"] in ("#ffffff", "#fefefe")]
    assert whites


def test_stage_subset_adhesive_only(synthetic_flag):
    """v2: "adhesive" is an alias of the layout stage; the DAG pulls only the
    real ancestors (quantize -> regions -> classify), never boundaries."""
    artifact = _run(synthetic_flag)
    full_regions = len(artifact["regions"])

    partial = run_pipeline(
        image_path=str(synthetic_flag),
        reference_kind="TOTAL_LENGTH",
        reference_value_cm=1500.0,
        stages=["adhesive"],
    )
    assert "layout" in partial
    assert "adhesive" not in partial
    assert len(partial["regions"]) == full_regions
    assert "boundaries" not in partial  # layout <- classify <- regions <- quantize only
    assert partial["stagesRun"] == ["quantize", "regions", "classify", "layout"]


def test_layout_band_cover(synthetic_flag):
    artifact = _run(synthetic_flag)
    layout = artifact["layout"]
    margin = artifact["params"]["adhesive_margin_cm"]
    overlap = artifact["params"]["adhesive_band_overlap_cm"]
    assert layout["strips"]
    for strip in layout["strips"]:
        widths = strip["bandWidthsCm"]
        assert widths
        covered = sum(widths) - (len(widths) - 1) * overlap
        # the stack must cover the strip height plus both margins
        assert covered + 1e-6 >= (strip["y1Cm"] - strip["y0Cm"]) + 2 * margin
        for band in strip["bands"]:
            assert band["hCm"] == band["widthClassCm"]  # unrotated band invariant
    totals = layout["totals"]
    assert totals["adhesiveWasteM2"] >= 0
    assert totals["adhesiveAreaM2"] >= totals["elementAreaM2"] - 1e-3
