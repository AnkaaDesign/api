"""Achatamento + posterização: transforma a foto em um mapa de rótulos onde cada
rótulo é uma "chapa" que o pintor consegue enxergar. As fronteiras entre rótulos
são o risco; o gradiente original decide se cada fronteira é dura ou suave."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import ndimage as ndi
from scipy.cluster.vq import kmeans2
from skimage.restoration import denoise_tv_bregman

from ..colors import srgb_to_lab
from .params import LineArtParams


@dataclass
class Posterized:
    labels: np.ndarray          # (h, w) int, 0 = fundo/reserva
    lab: np.ndarray             # (h, w, 3) CIELAB da imagem ORIGINAL (não achatada)
    lab_flat: np.ndarray        # (h, w, 3) CIELAB achatado (TV)
    gradient: np.ndarray        # (h, w) magnitude do gradiente de L* original
    background: np.ndarray      # (h, w) bool
    tone: np.ndarray            # (h, w) float, L* normalizado 0..1
    objects: np.ndarray         # (h, w) int, objeto por pixel (instância ou cor)
    label_object: dict[int, int]  # rótulo -> objeto; objetos diferentes = CONTORNO
    label_tone: dict[int, int]    # rótulo -> banda de luminância dentro do objeto
    object_source: str = "color"  # "instances" | "color"


def background_mask(rgb: np.ndarray, enabled: bool) -> np.ndarray:
    """Fundo claro conectado à borda. Exposto porque o estágio de instâncias
    precisa dele antes do posterize rodar."""
    return _background_mask(srgb_to_lab(rgb.astype(np.float64) / 255.0), enabled)


def _background_mask(lab: np.ndarray, enabled: bool) -> np.ndarray:
    h, w = lab.shape[:2]
    if not enabled:
        return np.zeros((h, w), dtype=bool)
    lightness = lab[..., 0]
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    candidate = (lightness > 88.0) & (chroma < 12.0)
    labeled, n = ndi.label(candidate)
    if n == 0:
        return np.zeros((h, w), dtype=bool)
    border = np.concatenate(
        [labeled[0, :], labeled[-1, :], labeled[:, 0], labeled[:, -1]]
    )
    touching = set(int(v) for v in np.unique(border) if v > 0)
    if not touching:
        return np.zeros((h, w), dtype=bool)
    mask = np.isin(labeled, list(touching))
    return ndi.binary_closing(mask, structure=np.ones((3, 3)), iterations=2)


def _kmeans_lab(lab: np.ndarray, mask: np.ndarray, k: int, seed: int = 7) -> np.ndarray:
    """Rótulo de cor por pixel (1..k), 0 fora da máscara."""
    h, w = lab.shape[:2]
    out = np.zeros((h, w), dtype=np.int32)
    samples = lab[mask]
    if samples.shape[0] < k * 4:
        out[mask] = 1
        return out
    rng = np.random.default_rng(seed)
    step = max(1, samples.shape[0] // 120_000)
    train = samples[::step]
    centroids, _ = kmeans2(train, k, minit="++", seed=int(rng.integers(1 << 30)))
    # remove centróides vazios
    d = np.linalg.norm(samples[:, None, :] - centroids[None, :, :], axis=2)
    out[mask] = np.argmin(d, axis=1) + 1
    return out


def _tone_bands(lightness: np.ndarray, mask: np.ndarray, levels: int) -> np.ndarray:
    """Bandas de luminância por quantil DENTRO da máscara (0..levels-1)."""
    out = np.zeros(lightness.shape, dtype=np.int32)
    values = lightness[mask]
    if values.size == 0 or levels <= 1:
        return out
    qs = np.quantile(values, np.linspace(0.0, 1.0, levels + 1)[1:-1])
    qs = np.unique(qs)
    if qs.size == 0:
        return out
    out[mask] = np.digitize(values, qs)
    return out


def _object_tone_field(
    lightness: np.ndarray, mask: np.ndarray, fraction: float
) -> np.ndarray:
    """Luminância MUITO suavizada dentro do objeto, com sigma proporcional ao
    tamanho dele.

    É o que separa "linha de sombra" de "curva de nível". A forma de uma banana
    é um degradê liso; o ruído da foto por cima dele vira ilha fechada quando se
    fatia direto. Suavizando a ~6% do tamanho do objeto sobram 2-3 faixas
    grandes e a fronteira delas é uma varredura longa — o traço que o pintor faz.

    Convolução normalizada (num/den) para o borrão não vazar pela borda do
    objeto e puxar o tom do vizinho.
    """
    area = float(mask.sum())
    if area < 16.0:
        return lightness
    sigma = max(fraction * math.sqrt(area), 1.0)

    rows = np.nonzero(mask.any(axis=1))[0]
    cols = np.nonzero(mask.any(axis=0))[0]
    pad = int(sigma * 3) + 2
    r0 = max(int(rows[0]) - pad, 0)
    r1 = min(int(rows[-1]) + pad + 1, mask.shape[0])
    c0 = max(int(cols[0]) - pad, 0)
    c1 = min(int(cols[-1]) + pad + 1, mask.shape[1])

    sub_mask = mask[r0:r1, c0:c1].astype(np.float64)
    sub_light = lightness[r0:r1, c0:c1]
    num = ndi.gaussian_filter(sub_light * sub_mask, sigma, mode="constant")
    den = ndi.gaussian_filter(sub_mask, sigma, mode="constant")
    smooth = np.divide(num, den, out=np.zeros_like(num), where=den > 1e-6)

    out = lightness.copy()
    out[r0:r1, c0:c1] = np.where(sub_mask > 0, smooth, sub_light)
    return out


def _absorb_small(labels: np.ndarray, min_area_px: float) -> np.ndarray:
    """Componentes menores que o mínimo são engolidos pelo vizinho de maior contato.
    É o que evita 5 mil ilhinhas de ruído fotográfico virarem traço."""
    out = labels.copy()
    for _ in range(4):
        comp, n = ndi.label(out, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))
        if n == 0:
            break
        sizes = np.bincount(comp.ravel())
        small_ids = np.nonzero(sizes < min_area_px)[0]
        small_ids = small_ids[small_ids > 0]
        if small_ids.size == 0:
            break
        small = np.isin(comp, small_ids)
        if not small.any():
            break
        # substitui pelo rótulo do vizinho mais próximo já consolidado
        keep = out.copy()
        keep[small] = 0
        idx = ndi.distance_transform_edt(keep == 0, return_distances=False, return_indices=True)
        out[small] = keep[tuple(i[small] for i in idx)]
        if not (out == 0).any():
            pass
    return out


def _smooth_labels(labels: np.ndarray, radius_px: float, iterations: int = 2) -> np.ndarray:
    """Voto modal em disco: alisa a fronteira entre rótulos. É o que separa um
    contorno que o pintor consegue riscar de uma borda rendilhada de ruído."""
    size = int(max(3, round(radius_px * 2 + 1)))
    ids = [int(v) for v in np.unique(labels) if v > 0]
    if len(ids) < 2:
        return labels
    out = labels
    for _ in range(max(1, iterations)):
        best_score = np.zeros(out.shape, dtype=np.float32)
        best_id = np.zeros(out.shape, dtype=np.int32)
        for lid in ids:
            score = ndi.uniform_filter(
                (out == lid).astype(np.float32), size=size, mode="nearest"
            )
            better = score > best_score
            best_score[better] = score[better]
            best_id[better] = lid
        out = np.where(out > 0, best_id, 0).astype(np.int32)
    return out


def posterize(
    rgb: np.ndarray,
    params: LineArtParams,
    px_per_cm: float,
    object_map: np.ndarray | None = None,
) -> Posterized:
    rgb01 = rgb.astype(np.float64) / 255.0
    lab_orig = srgb_to_lab(rgb01)

    flat01 = denoise_tv_bregman(rgb01, weight=1.0 / max(params.tv_weight, 1e-3), channel_axis=-1)
    sigma_px = max(params.presmooth_cm * px_per_cm, 0.0)
    if sigma_px > 0.3:
        flat01 = ndi.gaussian_filter(flat01, sigma=(sigma_px, sigma_px, 0))
    lab_flat = srgb_to_lab(np.clip(flat01, 0.0, 1.0))

    background = _background_mask(lab_orig, params.background_is_white)
    subject = ~background

    if object_map is not None and (object_map > 0).any():
        objects = object_map.astype(np.int32)
        source = "instances"
    else:
        objects = _kmeans_lab(lab_flat, subject, params.color_levels)
        source = "color"

    lightness = lab_flat[..., 0]
    combined = np.zeros(objects.shape, dtype=np.int32)
    label_object: dict[int, int] = {}
    label_tone: dict[int, int] = {}
    next_id = 1
    for obj in sorted(set(int(v) for v in np.unique(objects)) - {0}):
        obj_mask = (objects == obj) & subject
        if not obj_mask.any():
            continue
        field = _object_tone_field(lightness, obj_mask, params.tone_smooth_frac)
        bands = _tone_bands(field, obj_mask, params.tone_levels)
        for band in range(params.tone_levels):
            sel = obj_mask & (bands == band)
            if sel.any():
                combined[sel] = next_id
                label_object[next_id] = obj
                label_tone[next_id] = band
                next_id += 1

    min_area_px = params.min_area_cm2 * (px_per_cm ** 2)
    combined = _absorb_small(combined, min_area_px)
    combined = _smooth_labels(
        combined, params.label_smooth_cm * px_per_cm, params.label_smooth_iters
    )
    combined = _absorb_small(combined, min_area_px)
    combined[background] = 0

    gy, gx = np.gradient(ndi.gaussian_filter(lab_orig[..., 0], 1.0))
    gradient = np.hypot(gx, gy)

    lo, hi = np.percentile(lab_orig[..., 0], [2, 98])
    tone = np.clip((lab_orig[..., 0] - lo) / max(hi - lo, 1e-6), 0.0, 1.0)

    return Posterized(
        labels=combined,
        lab=lab_orig,
        lab_flat=lab_flat,
        gradient=gradient,
        background=background,
        tone=tone,
        objects=objects,
        label_object=label_object,
        label_tone=label_tone,
        object_source=source,
    )
