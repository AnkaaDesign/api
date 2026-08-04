"""S0 — image loading, alpha flattening, scale calibration and work-resolution policy."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from .params import EngineParams

Image.MAX_IMAGE_PIXELS = 400_000_000  # layouts are legitimately huge


@dataclass
class IngestResult:
    rgb_original: np.ndarray      # (H, W, 3) uint8, full resolution
    rgb_work: np.ndarray          # (h, w, 3) uint8, capped at max_work_px
    work_scale: float             # work_px / original_px
    px_per_cm_original: float     # calibration at original resolution
    px_per_cm_work: float


def compute_px_per_cm(
    width_px: int,
    height_px: int,
    reference_kind: str,
    reference_value_cm: float,
) -> float:
    """Derive pixels-per-cm from a single user-provided real measure."""
    if reference_value_cm <= 0:
        raise ValueError("reference_value_cm must be positive")
    kind = reference_kind.upper()
    if kind in ("TOTAL_LENGTH", "WIDTH"):
        return width_px / reference_value_cm
    if kind in ("SIDE_HEIGHT", "HEIGHT"):
        return height_px / reference_value_cm
    raise ValueError(f"unknown reference_kind: {reference_kind}")


def trim_uniform_frame(rgb: np.ndarray, max_fraction: float = 0.18) -> np.ndarray:
    """Mockup files often carry a uniform page frame/border around the artwork.
    Strip near-uniform margins (matching the corner color) from each edge, up to
    `max_fraction` of that dimension, so the frame never becomes a giant fake
    paint region and the scale reference maps to the real implement extent."""
    height, width = rgb.shape[:2]
    work = rgb.astype(np.int16)

    def uniform_run(lines: np.ndarray, limit: int) -> int:
        reference = lines[0].reshape(-1, 3).mean(axis=0)
        count = 0
        for index in range(min(limit, lines.shape[0])):
            line = lines[index].reshape(-1, 3)
            if np.abs(line - reference).mean() > 6.0 and index > 0:
                break
            if np.abs(line - line.mean(axis=0)).mean() > 6.0:
                break
            count = index + 1
        return count

    top = uniform_run(work, int(height * max_fraction))
    bottom = uniform_run(work[::-1], int(height * max_fraction))
    left = uniform_run(work.transpose(1, 0, 2), int(width * max_fraction))
    right = uniform_run(work.transpose(1, 0, 2)[::-1], int(width * max_fraction))

    # only trim when the frame color differs from the interior average
    interior = work[height // 3 : 2 * height // 3, width // 3 : 2 * width // 3]
    interior_mean = interior.reshape(-1, 3).mean(axis=0)

    def keep(count: int, edge_line: np.ndarray) -> int:
        if count <= 2:
            return 0
        edge_mean = edge_line.reshape(-1, 3).mean(axis=0)
        # never trim white-ish margins: white may BE the plate, and the scale
        # reference must keep mapping to the drawn implement extent
        if edge_mean.mean() > 235.0:
            return 0
        return count if np.abs(edge_mean - interior_mean).mean() > 10.0 else 0

    top = keep(top, work[0])
    bottom = keep(bottom, work[-1])
    left = keep(left, work[:, 0])
    right = keep(right, work[:, -1])
    if top + bottom >= height or left + right >= width:
        return rgb
    return rgb[top : height - bottom if bottom else height, left : width - right if right else width]


def load_image(
    path: str,
    params: EngineParams,
    reference_kind: str,
    reference_value_cm: float,
) -> IngestResult:
    img = Image.open(path)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(background, img)
    rgb = np.asarray(img.convert("RGB"), dtype=np.uint8)
    rgb = trim_uniform_frame(rgb)

    height, width = rgb.shape[:2]
    px_per_cm = compute_px_per_cm(width, height, reference_kind, reference_value_cm)

    longest = max(width, height)
    if longest > params.max_work_px:
        scale = params.max_work_px / longest
        work = np.asarray(
            Image.fromarray(rgb).resize(
                (max(1, round(width * scale)), max(1, round(height * scale))),
                Image.Resampling.LANCZOS,
            ),
            dtype=np.uint8,
        )
    else:
        scale = 1.0
        work = rgb

    return IngestResult(
        rgb_original=rgb,
        rgb_work=work,
        work_scale=scale,
        px_per_cm_original=px_per_cm,
        px_per_cm_work=px_per_cm * scale,
    )
