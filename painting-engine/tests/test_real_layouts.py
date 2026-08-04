"""Integration smoke tests against the real layout database (skipped when the
folder is not present on the machine). Assertions encode the ground truth
established in layout database/analysis/*.md."""

from __future__ import annotations

from painting_engine.pipeline import run_pipeline

from conftest import require_layout


def _run(path, length_cm):
    return run_pipeline(
        image_path=str(path),
        reference_kind="TOTAL_LENGTH",
        reference_value_cm=length_cm,
        params=None,
    )


def test_avglog_white_plate():
    """AVGLOG: chapa branca, 3 cores chapadas, zero degradê."""
    path = require_layout("AVGLOG lateral.png")
    artifact = _run(path, 1470)
    assert artifact["background"]["mode"] == "WHITE_PLATE"
    kinds = {r["kind"] for r in artifact["regions"]}
    assert "FOTOGRAFICO" not in kinds or artifact["photoZoneAreaPct"] < 0.05


def test_biava_general_paint():
    """BIAVA: preto ~92% -> pintura geral."""
    path = require_layout("BIAVA.png")
    artifact = _run(path, 1500)
    assert artifact["background"]["mode"] == "GENERAL_PAINT"
    assert artifact["background"]["coveragePct"] > 0.6


def test_two_amigos_has_photo_zone():
    """2 amigos: bloco fotográfico dos morangos deve virar zona FOTOGRAFICO."""
    path = require_layout("2 amigos.png")
    artifact = _run(path, 1500)
    assert artifact["photoZoneAreaPct"] > 0.005
    photo_regions = [r for r in artifact["regions"] if r["kind"] == "FOTOGRAFICO"]
    assert photo_regions
