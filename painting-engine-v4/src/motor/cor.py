"""Cor: sRGB -> Lab (D65), ΔE76, L*, croma — vetorizado.

ΔE CIE76 deliberadamente: todos os limiares da série (fusão <4, casca <6,
leitura ~6, fusão fina <6) foram calibrados nas fichas com essa métrica.
"""
from __future__ import annotations

import numpy as np

_WHITE = np.array([0.95047, 1.0, 1.08883])  # D65

_M = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)


def srgb_para_lab(rgb: np.ndarray) -> np.ndarray:
    """(...,3) uint8/float -> (...,3) float32 Lab."""
    c = np.asarray(rgb, dtype=np.float32) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    xyz = c @ _M.T.astype(np.float32)
    xyz = xyz / _WHITE.astype(np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    lab = np.empty_like(xyz)
    lab[..., 0] = 116.0 * f[..., 1] - 16.0
    lab[..., 1] = 500.0 * (f[..., 0] - f[..., 1])
    lab[..., 2] = 200.0 * (f[..., 1] - f[..., 2])
    return lab


def delta_e(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """ΔE76 entre (...,3) e (...,3) (broadcasting ok)."""
    d = np.asarray(lab1, dtype=np.float32) - np.asarray(lab2, dtype=np.float32)
    return np.sqrt(np.sum(d * d, axis=-1))


def croma(lab: np.ndarray) -> np.ndarray:
    lab = np.asarray(lab)
    return np.sqrt(lab[..., 1] ** 2 + lab[..., 2] ** 2)


def matiz_graus(lab: np.ndarray) -> np.ndarray:
    """Ângulo de matiz. Só significa algo onde há croma (cinza gira 360° à toa)."""
    lab = np.asarray(lab)
    return np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360.0


def lab_de_int(c: int) -> np.ndarray:
    return srgb_para_lab(np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255]))
