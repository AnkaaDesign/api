from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

LAYOUT_DIR = Path(__file__).resolve().parents[3] / "layout database"


@pytest.fixture()
def synthetic_flag(tmp_path: Path) -> Path:
    """A 'truck side' 2000x500: white plate, red rectangle touching a blue
    rectangle (straight paint-paint frontier), a green circle isolated on white,
    and a thin white keyline splitting a purple block in two."""
    width, height = 2000, 500
    img = np.full((height, width, 3), 255, dtype=np.uint8)

    img[100:400, 200:600] = (200, 30, 30)      # red
    img[100:400, 600:1000] = (30, 60, 200)     # blue — shares straight edge with red

    yy, xx = np.mgrid[0:height, 0:width]
    circle = (yy - 250) ** 2 + (xx - 1300) ** 2 <= 120**2
    img[circle] = (20, 160, 60)                # green circle on white

    img[80:420, 1600:1900] = (120, 40, 160)    # purple block
    img[80:420, 1748:1752] = (255, 255, 255)   # 4px keyline splits it

    path = tmp_path / "synthetic_flag.png"
    Image.fromarray(img).save(path)
    return path


@pytest.fixture()
def synthetic_general_paint(tmp_path: Path) -> Path:
    """85% dark background with white lettering-like knockouts."""
    width, height = 1200, 400
    img = np.full((height, width, 3), (30, 34, 40), dtype=np.uint8)
    img[150:250, 100:300] = (255, 255, 255)
    img[150:250, 400:600] = (230, 190, 40)
    path = tmp_path / "synthetic_general.png"
    Image.fromarray(img).save(path)
    return path


@pytest.fixture()
def synthetic_flag_on_plate(tmp_path: Path) -> Path:
    """The v1 false-photographic scenario: a 600x200 white plate (1 px/cm via
    TOTAL_LENGTH=600) carrying a small vector 'flag' emblem — green 60x40
    field, yellow lozenge, blue circle; 4 flat colors with light gaussian
    antialiasing (sigma 0.6) so the v1 tile-entropy gate (distinct codes
    alone) captures the emblem as a photographic zone while the edges stay
    hard-dominant — the exact case phase B must demote back to vector."""
    from scipy.ndimage import gaussian_filter

    width, height = 600, 200
    img = np.full((height, width, 3), 255.0, dtype=np.float64)
    x0, y0 = 270, 80
    img[y0 : y0 + 40, x0 : x0 + 60] = (0, 120, 45)          # green field
    yy, xx = np.mgrid[0:height, 0:width]
    cx, cy = x0 + 30, y0 + 20
    lozenge = (np.abs(xx - cx) / 28.0 + np.abs(yy - cy) / 18.0) <= 1.0
    img[lozenge] = (254, 223, 0)                             # yellow lozenge
    circle = (xx - cx) ** 2 + (yy - cy) ** 2 <= 12**2
    img[circle] = (0, 39, 118)                               # blue circle
    for channel in range(3):
        img[..., channel] = gaussian_filter(img[..., channel], sigma=0.6)
    path = tmp_path / "synthetic_flag_on_plate.png"
    Image.fromarray(np.clip(img, 0, 255).round().astype(np.uint8)).save(path)
    return path


def make_layout_case(
    face_w_cm: float,
    face_h_cm: float,
    elements: list[dict],
    mode: str = "WHITE_PLATE",
    px_per_cm: float = 1.0,
    bg_rgb: tuple[int, int, int] = (255, 255, 255),
):
    """Build (regions, kinds, quant, comp_map) for compute_face_layout tests
    without running the image pipeline. Each element dict:
      {"rect": (x_cm, y_cm, w_cm, h_cm)}  OR  {"mask": fn(bool_2d) painter}
      optional "rgb" (palette color) and "kind" (default CHAPADA).
    Palette index 0 is the background."""
    from painting_engine.colors import srgb_to_lab, lab_to_hex
    from painting_engine.quantize import QuantizeResult
    from painting_engine.regions import Region

    height = int(round(face_h_cm * px_per_cm))
    width = int(round(face_w_cm * px_per_cm))
    labels = np.zeros((height, width), dtype=np.int16)
    comp_map = np.zeros((height, width), dtype=np.int32)

    default_colors = [(200, 30, 30), (30, 60, 200), (20, 160, 60), (230, 190, 40)]
    palette_rgb = [bg_rgb]
    regions: list[Region] = []
    kinds: dict[str, dict] = {}
    px_area_m2 = 1.0 / (px_per_cm * 100.0) ** 2

    for index, element in enumerate(elements):
        color_index = index + 1
        palette_rgb.append(
            tuple(element.get("rgb", default_colors[index % len(default_colors)]))
        )
        mask = np.zeros((height, width), dtype=bool)
        if "rect" in element:
            x, y, w, h = element["rect"]
            r0, r1 = int(round(y * px_per_cm)), int(round((y + h) * px_per_cm))
            c0, c1 = int(round(x * px_per_cm)), int(round((x + w) * px_per_cm))
            mask[r0:r1, c0:c1] = True
        else:
            element["mask"](mask)
        labels[mask] = color_index
        comp_map[mask] = color_index
        rows = np.flatnonzero(mask.any(axis=1))
        cols = np.flatnonzero(mask.any(axis=0))
        bbox = (int(rows[0]), int(cols[0]), int(rows[-1]) + 1, int(cols[-1]) + 1)
        area_px = int(mask.sum())
        region = Region(
            id=f"r{color_index}",
            color_index=color_index,
            hex="#000000",
            area_px=area_px,
            area_m2=round(area_px * px_area_m2, 6),
            perimeter_m=0.0,
            bbox=bbox,
            bbox_cm=(
                round((bbox[3] - bbox[1]) / px_per_cm, 1),
                round((bbox[2] - bbox[0]) / px_per_cm, 1),
            ),
            islands=0,
            min_stroke_mm=0.0,
            centroid=(0.0, 0.0),
            contour=[],
        )
        regions.append(region)
        kinds[region.id] = {"kind": element.get("kind", "CHAPADA"), "gradient": None}

    palette_lab = srgb_to_lab(np.array(palette_rgb, dtype=np.uint8))
    palette_hex = [lab_to_hex(c) for c in palette_lab]
    total_px = float(labels.size)
    palette_pct = [
        round(float((labels == i).sum()) / total_px, 5) for i in range(len(palette_rgb))
    ]
    quant = QuantizeResult(
        labels=labels,
        palette_lab=palette_lab,
        palette_hex=palette_hex,
        palette_pct=palette_pct,
        photo_mask=np.zeros((height, width), dtype=bool),
        keyline_mask=np.zeros((height, width), dtype=bool),
        keylines=[],
        background_index=0,
        background_mode=mode,
        background_coverage=palette_pct[0],
        alerts=[],
    )
    return regions, kinds, quant, comp_map


def require_layout(name: str) -> Path:
    path = LAYOUT_DIR / name
    if not path.exists():
        pytest.skip(f"layout database image not available: {name}")
    return path
