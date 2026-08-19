from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from scipy import ndimage as ndi

from painting_engine.lineart import LineArtParams, build_lineart
from painting_engine.lineart.geometry import (
    douglas_peucker,
    fit_bezier,
    flatten_beziers,
    polyline_to_beziers,
)

SVG_NS = "{http://www.w3.org/2000/svg}"


@pytest.fixture()
def synthetic_art(tmp_path: Path) -> Path:
    """1200x800: fundo branco, um disco amarelo com degradê suave (fronteira de
    SOMBRA), um retângulo azul encostado nele (fronteira dura = CONTORNO) e uma
    faixa listrada na diagonal (TEXTURA)."""
    h, w = 800, 1200
    rgb = np.full((h, w, 3), 255, dtype=np.uint8)
    yy, xx = np.mgrid[0:h, 0:w]

    disc = (xx - 380) ** 2 + (yy - 400) ** 2 < 260 ** 2
    ramp = np.clip((xx - 140) / 480.0, 0.0, 1.0)
    rgb[disc] = np.stack(
        [
            np.full(h * w, 250)[disc.ravel()],
            (120 + 130 * ramp).astype(np.uint8).ravel()[disc.ravel()],
            np.full(h * w, 40)[disc.ravel()],
        ],
        axis=1,
    )

    rect = (xx > 620) & (xx < 900) & (yy > 220) & (yy < 580)
    rgb[rect] = (30, 70, 200)

    stripes = (xx > 930) & (xx < 1160) & (yy > 180) & (yy < 640)
    phase = ((xx + yy) % 14) < 6
    rgb[stripes & phase] = (20, 90, 40)
    rgb[stripes & ~phase] = (120, 200, 130)

    path = tmp_path / "arte.png"
    Image.fromarray(rgb).save(path)
    return path


def test_douglas_peucker_keeps_ends_and_cuts_middle():
    pts = np.array([[0.0, 0.0], [1.0, 0.01], [2.0, 0.0], [3.0, 0.0]])
    simplified = douglas_peucker(pts, 0.1)
    assert simplified.shape[0] == 2
    assert np.allclose(simplified[0], pts[0])
    assert np.allclose(simplified[-1], pts[-1])


def test_bezier_fit_reproduces_a_circle_within_tolerance():
    angles = np.linspace(0, 2 * np.pi, 200)
    circle = np.stack([np.cos(angles) * 100, np.sin(angles) * 100], axis=1)
    curves = fit_bezier(circle, 1.0)
    assert 0 < len(curves) <= 12  # poucos nós: precisa ser editável à mão
    flat = flatten_beziers(curves, steps=16)
    radius = np.hypot(flat[:, 0], flat[:, 1])
    assert np.abs(radius - 100).max() < 2.0


def test_bezier_handles_never_explode_on_near_straight_input():
    pts = np.stack([np.linspace(0, 500, 60), np.zeros(60)], axis=1)
    pts[:, 1] += np.random.default_rng(3).normal(0, 0.02, 60)
    for curves in polyline_to_beziers(
        pts, resample_step=2.0, simplify_tol=1.0, bezier_error=2.0, corner_deg=60.0
    ):
        for bez in curves:
            chord = float(np.hypot(*(bez[3] - bez[0])))
            for handle in (bez[1], bez[2]):
                assert np.hypot(*(handle - bez[0])) < chord * 3 + 1.0


def test_build_lineart_separates_layers_and_writes_scaled_svg(
    synthetic_art: Path, tmp_path: Path
):
    svg_path = tmp_path / "risco.svg"
    dxf_path = tmp_path / "risco.dxf"
    params = LineArtParams()
    params.embed_reference = False
    params.instances = False  # caminho clássico: rápido e sem torch

    report = build_lineart(
        str(synthetic_art),
        mural_width_cm=600.0,
        params=params,
        svg_path=str(svg_path),
        dxf_path=str(dxf_path),
    )

    assert report["strokes"]["CONTORNO"]["count"] > 0
    assert report["strokes"]["TEXTURA"]["count"] > 0, "a faixa listrada tem de virar hachura"
    assert report["muralCm"][0] == 600.0

    root = ET.parse(svg_path).getroot()
    assert root.get("width") == "6000.0mm"

    groups = {g.get("id"): g for g in root.findall(f"{SVG_NS}g")}
    assert "CONTORNO" in groups and "TEXTURA" in groups and "GRADE" in groups
    assert groups["SOMBRA"].get("stroke-dasharray") if "SOMBRA" in groups else True

    for name in ("CONTORNO", "SOMBRA", "TEXTURA"):
        group = groups.get(name)
        if group is None:
            continue
        # curva aberta com traço: é o que o Affinity aceita pincel vetorial em cima
        assert group.get("fill") == "none"
        assert group.get("stroke")
        for path in group.findall(f"{SVG_NS}path"):
            assert path.get("d", "").startswith("M")

    dxf = dxf_path.read_text()
    assert "AC1009" in dxf and "POLYLINE" in dxf and "CONTORNO" in dxf


def test_hatch_can_be_disabled(synthetic_art: Path, tmp_path: Path):
    params = LineArtParams()
    params.hatch = False
    params.embed_reference = False
    params.instances = False
    report = build_lineart(
        str(synthetic_art), mural_width_cm=600.0, params=params,
        svg_path=str(tmp_path / "sem-hachura.svg"),
    )
    assert report["strokes"]["TEXTURA"]["count"] == 0


def test_missing_sam_degrades_to_color_instead_of_crashing(
    synthetic_art: Path, tmp_path: Path, monkeypatch
):
    """Sem torch/mobile_sam o gerador tem de continuar entregando risco."""

    def missing(*args, **kwargs):
        raise ImportError(name="mobile_sam")

    monkeypatch.setattr(
        "painting_engine.lineart.instances.segment_instances", missing
    )

    params = LineArtParams()
    params.embed_reference = False
    params.instances = True
    report = build_lineart(
        str(synthetic_art), mural_width_cm=600.0, params=params,
        svg_path=str(tmp_path / "degradado.svg"),
    )
    assert report["objectSource"] == "color"
    assert report["warnings"] and "mobile_sam" in report["warnings"][0]
    assert report["totalStrokes"] > 0


@pytest.mark.skipif(
    __import__("importlib.util", fromlist=["util"]).find_spec("mobile_sam") is None,
    reason="requirements-sam.txt não instalado",
)
def test_instances_separate_touching_objects_of_the_same_colour(tmp_path: Path):
    """Dois retângulos AMARELOS encostados: cor não separa, instância separa."""
    h, w = 600, 1000
    rgb = np.full((h, w, 3), 255, dtype=np.uint8)
    rgb[150:450, 120:500] = (245, 200, 40)
    rgb[150:450, 500:880] = (245, 200, 40)
    rgb[150:450, 496:504] = (215, 172, 30)  # vinco suave entre os dois
    art = tmp_path / "duplo.png"
    Image.fromarray(rgb).save(art)

    params = LineArtParams()
    params.embed_reference = False
    params.instances = True
    report = build_lineart(str(art), mural_width_cm=500.0, params=params)

    assert report["warnings"] == []
    assert report["objectSource"] == "instances"
    assert report["objectCount"] >= 2


# --------------------------------------------------------------------------
# contorno vindo de aresta + consolidação
# --------------------------------------------------------------------------


def test_link_chains_rejoins_a_line_broken_by_a_junction():
    """Uma silhueta cortada em duas pela cruz com outra aresta tem de voltar a
    ser uma curva só — senão os pedaços morrem no comprimento mínimo."""
    from painting_engine.lineart.edges import _link_chains

    left = [(50, x) for x in range(10, 60)]
    right = [(50, x) for x in range(64, 120)]
    merged = _link_chains([left, right], gap_px=10.0, angle_deg=45.0)
    assert len(merged) == 1
    assert len(merged[0]) == len(left) + len(right)


def test_link_chains_refuses_a_perpendicular_neighbour():
    from painting_engine.lineart.edges import _link_chains

    horizontal = [(50, x) for x in range(10, 60)]
    vertical = [(y, 64) for y in range(50, 110)]
    merged = _link_chains([horizontal, vertical], gap_px=10.0, angle_deg=45.0)
    assert len(merged) == 2


def test_valley_detector_returns_one_centreline_for_a_dark_stripe():
    """Detector de degrau responderia nos DOIS lados da faixa escura; o de vale
    tem de devolver uma linha só, no meio."""
    from painting_engine.lineart.edges import _valley_lines

    height, width = 120, 400
    lightness = np.full((height, width), 80.0)
    lightness[:, 190:210] = 35.0
    lightness = ndi.gaussian_filter(lightness, 2.0)
    subject = np.ones((height, width), dtype=bool)

    params = LineArtParams()
    params.valley_sigmas_cm = (2.0, 5.0, 10.0)
    params.valley_percentile = 97.0
    lines = _valley_lines(lightness, subject, params, px_per_cm=1.0)

    row = height // 2
    hits = np.nonzero(lines[row])[0]
    assert hits.size >= 1
    assert 185 <= hits.mean() <= 215, f"linha fora do centro da faixa: {hits}"
    assert hits.max() - hits.min() <= 4, "saiu linha dupla em vez de linha de centro"


def test_consolidate_drops_a_parallel_duplicate_contour():
    from painting_engine.lineart.consolidate import consolidate
    from painting_engine.lineart.strokes import LAYER_CONTOUR, Stroke

    def horizontal(y: float, length: float) -> Stroke:
        bez = np.array([[10.0, y], [10 + length / 3, y], [10 + 2 * length / 3, y],
                        [10 + length, y]])
        return Stroke(layer=LAYER_CONTOUR, curves=[bez], length_px=length)

    params = LineArtParams()
    params.merge_radius_cm = 6.0
    strokes = [horizontal(100.0, 300.0), horizontal(104.0, 260.0)]
    kept, removed = consolidate(strokes, params, px_per_cm=1.0, shape=(200, 400))

    assert len(kept) == 1
    assert kept[0].length_px == 300.0, "tem de sobrar a curva MAIS LONGA"
    assert removed[LAYER_CONTOUR] == 1


def test_consolidate_keeps_two_genuinely_separate_contours():
    from painting_engine.lineart.consolidate import consolidate
    from painting_engine.lineart.strokes import LAYER_CONTOUR, Stroke

    def horizontal(y: float) -> Stroke:
        bez = np.array([[10.0, y], [110.0, y], [210.0, y], [310.0, y]])
        return Stroke(layer=LAYER_CONTOUR, curves=[bez], length_px=300.0)

    params = LineArtParams()
    params.merge_radius_cm = 6.0
    kept, _ = consolidate(
        [horizontal(40.0), horizontal(160.0)], params, px_per_cm=1.0, shape=(200, 400)
    )
    assert len(kept) == 2
