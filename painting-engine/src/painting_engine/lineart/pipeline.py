"""Orquestração: arte raster/PDF -> risco vetorial em escala real."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .consolidate import consolidate
from .edges import edge_strokes
from .export import dxf_document, preview_png, svg_document
from .hatch import analyse_texture, build_hatch
from .params import LineArtParams
from .posterize import posterize
from .strokes import LAYER_CONTOUR, LAYER_SHADE, LAYER_TEXTURE, extract_strokes

Image.MAX_IMAGE_PIXELS = None


def _load_rgb(path: str, params: LineArtParams) -> np.ndarray:
    source = Path(path)
    if source.suffix.lower() == ".pdf":
        binary = shutil.which("pdftoppm") or shutil.which("pdftocairo")
        if binary is None:
            raise RuntimeError(
                "PDF de entrada exige poppler (pdftoppm). Converta para PNG antes."
            )
        with tempfile.TemporaryDirectory() as tmp:
            prefix = str(Path(tmp) / "page")
            subprocess.run(
                [binary, "-png", "-r", str(params.pdf_dpi), "-f", "1", "-l", "1",
                 str(source), prefix],
                check=True, capture_output=True,
            )
            rendered = sorted(Path(tmp).glob("page*.png"))
            if not rendered:
                raise RuntimeError("Não consegui rasterizar a primeira página do PDF.")
            image = Image.open(rendered[0]).convert("RGBA")
            flat = Image.new("RGBA", image.size, (255, 255, 255, 255))
            flat.alpha_composite(image)
            return np.asarray(flat.convert("RGB"))

    image = Image.open(source)
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        flat = Image.new("RGBA", image.size, (255, 255, 255, 255))
        flat.alpha_composite(image)
        image = flat
    return np.asarray(image.convert("RGB"))


def _to_work(rgb: np.ndarray, width_px: int) -> np.ndarray:
    if rgb.shape[1] <= width_px:
        return rgb
    ratio = width_px / rgb.shape[1]
    size = (width_px, max(1, int(round(rgb.shape[0] * ratio))))
    return np.asarray(Image.fromarray(rgb).resize(size, Image.LANCZOS))


def _debug_dump(folder: str, post, field, work: np.ndarray) -> None:
    """Mapas intermediários coloridos. Sem isto o ajuste vira adivinhação:
    contorno que não aparece pode ser instância fundida, rótulo absorvido ou
    região classificada como textura — e os três se parecem no resultado."""
    out = Path(folder)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(11)

    def colorize(labels: np.ndarray) -> np.ndarray:
        ids = np.unique(labels)
        palette = rng.integers(60, 240, size=(int(ids.max()) + 2, 3), dtype=np.uint8)
        palette[0] = (255, 255, 255)
        return palette[np.clip(labels, 0, palette.shape[0] - 1)]

    Image.fromarray(colorize(post.objects)).save(out / "1-objetos.png")
    Image.fromarray(colorize(post.labels)).save(out / "2-rotulos.png")
    Image.fromarray((np.clip(field.score, 0, 1) * 255).astype(np.uint8)).save(
        out / "3-score-textura.png"
    )
    textured = np.isin(post.labels, list(field.labels))
    blend = work.astype(np.float64)
    blend[textured] = blend[textured] * 0.45 + np.array([255, 0, 0]) * 0.55
    Image.fromarray(blend.astype(np.uint8)).save(out / "4-regioes-hachuradas.png")


def build_lineart(
    input_path: str,
    *,
    mural_width_cm: float,
    params: LineArtParams | None = None,
    svg_path: str | None = None,
    dxf_path: str | None = None,
    preview_path: str | None = None,
    debug_dir: str | None = None,
) -> dict[str, Any]:
    params = params or LineArtParams()
    timings: dict[str, float] = {}

    mark = time.perf_counter()
    original = _load_rgb(input_path, params)
    work = _to_work(original, params.work_width_px)
    px_per_cm = work.shape[1] / mural_width_cm
    mm_per_px = 10.0 / px_per_cm
    timings["ingest"] = round(time.perf_counter() - mark, 2)

    object_map = None
    warnings: list[str] = []
    if params.instances:
        mark = time.perf_counter()
        try:
            from .instances import segment_instances
            from .posterize import background_mask

            object_map = segment_instances(
                work, params, px_per_cm,
                background=background_mask(work, params.background_is_white),
            )
        except ImportError as exc:
            warnings.append(
                f"instâncias desligadas (dependência ausente: {exc.name}); "
                "instale requirements-sam.txt ou rode com --no-instances"
            )
        except Exception as exc:  # noqa: BLE001 - degradar é melhor que abortar
            warnings.append(f"instâncias falharam ({exc}); seguindo só com cor")
        timings["instances"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    post = posterize(work, params, px_per_cm, object_map=object_map)
    timings["posterize"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    field = analyse_texture(post, params, px_per_cm)
    timings["texture"] = round(time.perf_counter() - mark, 2)

    if debug_dir:
        _debug_dump(debug_dir, post, field, work)

    mark = time.perf_counter()
    strokes = extract_strokes(post, params, px_per_cm, textured=field.labels)
    timings["strokes"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    strokes += edge_strokes(post, params, px_per_cm, field.labels, strokes)
    timings["edges"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    strokes += build_hatch(post, field, params, px_per_cm)
    timings["hatch"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    strokes, merged = consolidate(strokes, params, px_per_cm, work.shape[:2])
    timings["consolidate"] = round(time.perf_counter() - mark, 2)

    counts = {layer: 0 for layer in (LAYER_CONTOUR, LAYER_SHADE, LAYER_TEXTURE)}
    metres = {layer: 0.0 for layer in counts}
    for stroke in strokes:
        counts[stroke.layer] += 1
        metres[stroke.layer] += stroke.length_px / px_per_cm / 100.0
    nodes = sum(len(stroke.curves) + 1 for stroke in strokes)

    mark = time.perf_counter()
    if svg_path:
        svg = svg_document(
            strokes,
            work_shape=work.shape[:2],
            mm_per_px=mm_per_px,
            stroke_mm=params.stroke_mm,
            grid_mm=params.grid_cm * 10.0,
            grid_stroke_mm=params.grid_stroke_mm,
            grid_labels=params.grid_labels,
            dash=(params.dash_on_mm, params.dash_off_mm),
            reference_rgb=work if params.embed_reference else None,
            reference_opacity=params.reference_opacity,
            reference_max_px=params.reference_max_px,
        )
        Path(svg_path).write_text(svg, encoding="utf-8")
    if dxf_path:
        Path(dxf_path).write_text(
            dxf_document(strokes, work_shape=work.shape[:2], mm_per_px=mm_per_px),
            encoding="utf-8",
        )
    if preview_path:
        preview_png(
            strokes,
            work.shape[:2],
            preview_path,
            background=work if params.preview_over_art else None,
        )
    timings["export"] = round(time.perf_counter() - mark, 2)

    return {
        "input": input_path,
        "objectSource": post.object_source,
        "objectCount": int(len(set(post.label_object.values()))),
        "warnings": warnings,
        "mergedAway": merged,
        "workPx": [int(work.shape[1]), int(work.shape[0])],
        "muralCm": [
            round(mural_width_cm, 1),
            round(work.shape[0] / px_per_cm, 1),
        ],
        "pxPerCm": round(px_per_cm, 4),
        "strokes": {
            layer: {"count": counts[layer], "lengthM": round(metres[layer], 2)}
            for layer in counts
        },
        "totalStrokes": len(strokes),
        "bezierNodes": nodes,
        "timingsSec": timings,
    }
