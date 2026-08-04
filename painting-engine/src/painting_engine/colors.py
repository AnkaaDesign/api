"""Vectorized sRGB <-> CIELAB conversion and ΔE metrics (D65, 2° observer)."""

from __future__ import annotations

import numpy as np

_M_RGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])
_EPS = 216.0 / 24389.0
_KAPPA = 24389.0 / 27.0


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """rgb: float array (..., 3) in [0, 1] or uint8 (..., 3). Returns (..., 3) LAB."""
    arr = np.asarray(rgb, dtype=np.float64)
    if arr.dtype != np.float64 or arr.max() > 1.5:
        arr = arr.astype(np.float64) / 255.0
    linear = np.where(arr <= 0.04045, arr / 12.92, ((arr + 0.055) / 1.055) ** 2.4)
    xyz = linear @ _M_RGB_TO_XYZ.T
    xyz = xyz / _WHITE_D65
    f = np.where(xyz > _EPS, np.cbrt(xyz), (_KAPPA * xyz + 16.0) / 116.0)
    lab = np.empty_like(xyz)
    lab[..., 0] = 116.0 * f[..., 1] - 16.0
    lab[..., 1] = 500.0 * (f[..., 0] - f[..., 1])
    lab[..., 2] = 200.0 * (f[..., 1] - f[..., 2])
    return lab


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    """lab: (..., 3) -> uint8 sRGB (..., 3), clipped."""
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16.0) / 116.0
    fx = fy + lab[..., 1] / 500.0
    fz = fy - lab[..., 2] / 200.0

    def _finv(f: np.ndarray) -> np.ndarray:
        f3 = f**3
        return np.where(f3 > _EPS, f3, (116.0 * f - 16.0) / _KAPPA)

    xyz = np.stack([_finv(fx), _finv(fy), _finv(fz)], axis=-1) * _WHITE_D65
    linear = xyz @ np.linalg.inv(_M_RGB_TO_XYZ).T
    srgb = np.where(
        linear <= 0.0031308, linear * 12.92, 1.055 * np.clip(linear, 0, None) ** (1 / 2.4) - 0.055
    )
    return (np.clip(srgb, 0.0, 1.0) * 255.0).round().astype(np.uint8)


def delta_e76(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """Euclidean ΔE (CIE76). Broadcasts."""
    diff = np.asarray(lab1, dtype=np.float64) - np.asarray(lab2, dtype=np.float64)
    return np.sqrt(np.sum(diff * diff, axis=-1))


def chroma(lab: np.ndarray) -> np.ndarray:
    lab = np.asarray(lab, dtype=np.float64)
    return np.sqrt(lab[..., 1] ** 2 + lab[..., 2] ** 2)


def rgb_to_hex(rgb: np.ndarray) -> str:
    r, g, b = (int(round(float(v))) for v in np.asarray(rgb).reshape(3))
    return f"#{r:02x}{g:02x}{b:02x}"


def lab_to_hex(lab: np.ndarray) -> str:
    return rgb_to_hex(lab_to_srgb(np.asarray(lab).reshape(1, 3))[0])
