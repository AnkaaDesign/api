"""Escrita dos arquivos. O SVG é o mestre — é ele que abre no Affinity com as
curvas editáveis; DXF é a perna CAD/plotter e o PNG é só pré-visualização."""

from __future__ import annotations

import base64
import io
from xml.sax.saxutils import escape

import numpy as np
from PIL import Image

from .geometry import flatten_beziers
from .strokes import LAYER_CONTOUR, LAYER_SHADE, LAYER_TEXTURE, Stroke

LAYER_GRID = "GRADE"
LAYER_REFERENCE = "REFERENCIA"

# ordem de empilhamento (o último fica por cima)
LAYER_ORDER = [LAYER_REFERENCE, LAYER_GRID, LAYER_TEXTURE, LAYER_SHADE, LAYER_CONTOUR]


def _path_data(curves: list[np.ndarray], scale: float) -> str:
    first = curves[0][0] * scale
    parts = [f"M{first[0]:.2f},{first[1]:.2f}"]
    for bez in curves:
        p1, p2, p3 = bez[1] * scale, bez[2] * scale, bez[3] * scale
        parts.append(
            f"C{p1[0]:.2f},{p1[1]:.2f} {p2[0]:.2f},{p2[1]:.2f} {p3[0]:.2f},{p3[1]:.2f}"
        )
    return " ".join(parts)


def _grid_elements(width_mm: float, height_mm: float, step_mm: float, labels: bool) -> list[str]:
    if step_mm <= 0:
        return []
    out: list[str] = []
    cols = int(width_mm // step_mm) + 1
    rows = int(height_mm // step_mm) + 1
    for i in range(cols + 1):
        x = min(i * step_mm, width_mm)
        out.append(f'<path d="M{x:.1f},0 L{x:.1f},{height_mm:.1f}"/>')
    for j in range(rows + 1):
        y = min(j * step_mm, height_mm)
        out.append(f'<path d="M0,{y:.1f} L{width_mm:.1f},{y:.1f}"/>')
    if labels:
        size = step_mm * 0.16
        for i in range(cols):
            letter = chr(ord("A") + i % 26) + ("" if i < 26 else str(i // 26))
            out.append(
                f'<text x="{i * step_mm + step_mm / 2:.1f}" y="{size * 1.2:.1f}" '
                f'font-size="{size:.1f}" text-anchor="middle" fill="#c00" '
                f'stroke="none">{escape(letter)}</text>'
            )
        for j in range(rows):
            out.append(
                f'<text x="{size * 0.4:.1f}" y="{j * step_mm + step_mm / 2:.1f}" '
                f'font-size="{size:.1f}" fill="#c00" stroke="none">{j + 1}</text>'
            )
    return out


def _reference_element(
    rgb: np.ndarray, width_mm: float, height_mm: float, max_px: int, opacity: float
) -> str:
    image = Image.fromarray(rgb)
    if image.width > max_px:
        ratio = max_px / image.width
        image = image.resize((max_px, int(image.height * ratio)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=72)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return (
        f'<image x="0" y="0" width="{width_mm:.1f}" height="{height_mm:.1f}" '
        f'opacity="{opacity}" xlink:href="data:image/jpeg;base64,{encoded}"/>'
    )


def svg_document(
    strokes: list[Stroke],
    *,
    work_shape: tuple[int, int],
    mm_per_px: float,
    stroke_mm: float,
    grid_mm: float,
    grid_stroke_mm: float,
    grid_labels: bool,
    dash: tuple[float, float],
    reference_rgb: np.ndarray | None = None,
    reference_opacity: float = 0.35,
    reference_max_px: int = 1400,
) -> str:
    height_px, width_px = work_shape
    width_mm = width_px * mm_per_px
    height_mm = height_px * mm_per_px

    by_layer: dict[str, list[Stroke]] = {}
    for stroke in strokes:
        by_layer.setdefault(stroke.layer, []).append(stroke)

    style = {
        LAYER_CONTOUR: f'fill="none" stroke="#000000" stroke-width="{stroke_mm:.2f}" '
                       'stroke-linecap="round" stroke-linejoin="round"',
        LAYER_SHADE: f'fill="none" stroke="#1a1a1a" stroke-width="{stroke_mm * 0.75:.2f}" '
                     f'stroke-linecap="round" stroke-dasharray="{dash[0]:.1f} {dash[1]:.1f}"',
        LAYER_TEXTURE: f'fill="none" stroke="#333333" stroke-width="{stroke_mm * 0.6:.2f}" '
                       'stroke-linecap="round"',
    }

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{width_mm:.1f}mm" height="{height_mm:.1f}mm" '
        f'viewBox="0 0 {width_mm:.1f} {height_mm:.1f}">',
        f'<title>Risco — {width_mm / 1000:.2f} x {height_mm / 1000:.2f} m</title>',
    ]

    for layer in LAYER_ORDER:
        if layer == LAYER_REFERENCE:
            if reference_rgb is None:
                continue
            parts.append(f'<g id="{LAYER_REFERENCE}">')
            parts.append(
                _reference_element(
                    reference_rgb, width_mm, height_mm, reference_max_px, reference_opacity
                )
            )
            parts.append("</g>")
            continue
        if layer == LAYER_GRID:
            elements = _grid_elements(width_mm, height_mm, grid_mm, grid_labels)
            if not elements:
                continue
            parts.append(
                f'<g id="{LAYER_GRID}" fill="none" stroke="#cc0000" '
                f'stroke-width="{grid_stroke_mm:.2f}" opacity="0.6">'
            )
            parts.extend(elements)
            parts.append("</g>")
            continue
        items = by_layer.get(layer, [])
        if not items:
            continue
        parts.append(f'<g id="{layer}" {style[layer]}>')
        for stroke in items:
            parts.append(f'<path d="{_path_data(stroke.curves, mm_per_px)}"/>')
        parts.append("</g>")

    parts.append("</svg>")
    return "\n".join(parts)


# --------------------------------------------------------------------------
# DXF R12 (polilinhas achatadas) — perna CAD/plotter
# --------------------------------------------------------------------------

_DXF_LAYER_COLOR = {LAYER_CONTOUR: 7, LAYER_SHADE: 3, LAYER_TEXTURE: 8, LAYER_GRID: 1}


def dxf_document(strokes: list[Stroke], *, work_shape: tuple[int, int], mm_per_px: float) -> str:
    height_px = work_shape[0]
    out: list[str] = []

    def tag(code: int, value) -> None:
        out.append(str(code))
        out.append(str(value))

    tag(0, "SECTION"); tag(2, "HEADER")
    tag(9, "$ACADVER"); tag(1, "AC1009")
    tag(9, "$INSUNITS"); tag(70, 4)  # milímetros
    tag(0, "ENDSEC")

    tag(0, "SECTION"); tag(2, "TABLES")
    tag(0, "TABLE"); tag(2, "LAYER"); tag(70, len(_DXF_LAYER_COLOR))
    for name, color in _DXF_LAYER_COLOR.items():
        tag(0, "LAYER"); tag(2, name); tag(70, 0); tag(62, color); tag(6, "CONTINUOUS")
    tag(0, "ENDTAB"); tag(0, "ENDSEC")

    tag(0, "SECTION"); tag(2, "ENTITIES")
    for stroke in strokes:
        points = flatten_beziers(stroke.curves) * mm_per_px
        if points.shape[0] < 2:
            continue
        tag(0, "POLYLINE"); tag(8, stroke.layer); tag(66, 1)
        tag(10, 0.0); tag(20, 0.0); tag(30, 0.0); tag(70, 0)
        for x, y in points:
            tag(0, "VERTEX"); tag(8, stroke.layer)
            tag(10, round(float(x), 3))
            tag(20, round(float(height_px * mm_per_px - y), 3))  # DXF cresce para cima
            tag(30, 0.0)
        tag(0, "SEQEND"); tag(8, stroke.layer)
    tag(0, "ENDSEC")
    tag(0, "EOF")
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------
# preview raster
# --------------------------------------------------------------------------

_PREVIEW_STYLE = {
    LAYER_CONTOUR: ((0, 0, 0), 2, None),
    LAYER_SHADE: ((70, 70, 70), 1, (9, 6)),
    LAYER_TEXTURE: ((110, 110, 110), 1, None),
}


def preview_png(
    strokes: list[Stroke],
    work_shape: tuple[int, int],
    path: str,
    *,
    background: np.ndarray | None = None,
    max_width: int = 1600,
) -> None:
    height_px, width_px = work_shape
    scale = min(1.0, max_width / width_px)
    w = max(1, int(width_px * scale))
    h = max(1, int(height_px * scale))

    if background is None:
        canvas = np.full((h, w, 3), 255, dtype=np.uint8)
    else:
        img = Image.fromarray(background).resize((w, h), Image.LANCZOS)
        canvas = (np.asarray(img.convert("RGB")).astype(np.float64) * 0.35 + 255 * 0.65).astype(np.uint8)

    for layer in (LAYER_TEXTURE, LAYER_SHADE, LAYER_CONTOUR):
        color, weight, dash = _PREVIEW_STYLE[layer]
        rgb = np.array(color, dtype=np.uint8)
        for stroke in strokes:
            if stroke.layer != layer:
                continue
            points = flatten_beziers(stroke.curves, steps=10) * scale
            _draw_polyline(canvas, points, rgb, weight, dash)

    Image.fromarray(canvas).save(path)


def _draw_polyline(
    canvas: np.ndarray, points: np.ndarray, color: np.ndarray, weight: int, dash
) -> None:
    h, w = canvas.shape[:2]
    travelled = 0.0
    for i in range(points.shape[0] - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        seg_len = float(np.hypot(x1 - x0, y1 - y0))
        for s in range(steps + 1):
            t = s / steps
            if dash is not None:
                pos = (travelled + seg_len * t) % (dash[0] + dash[1])
                if pos > dash[0]:
                    continue
            x = int(round(x0 + (x1 - x0) * t))
            y = int(round(y0 + (y1 - y0) * t))
            for dy in range(weight):
                for dx in range(weight):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w:
                        canvas[yy, xx] = color
        travelled += seg_len
