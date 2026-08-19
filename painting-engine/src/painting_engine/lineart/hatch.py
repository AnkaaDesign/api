"""Hachura de textura — nervura de folha, veio de madeira, pelo.

Traçar pixel a pixel uma folha de bananeira dá 3 mil fragmentos inúteis. O que o
artista faz é outra coisa: lê a DIREÇÃO dominante da textura e desenha traços
paralelos regularmente espaçados seguindo essa direção, mais longos onde é mais
escuro. É o algoritmo de streamlines uniformemente espaçadas (Jobard & Lefebvre)
sobre o campo de orientação do tensor de estrutura.

O mesmo diagnóstico serve para uma segunda decisão: região texturada NÃO ganha
contorno de banda de tom — só silhueta e hachura. Sem isso o desenho vira
espaguete de curvas de nível dentro da folha.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage as ndi
from skimage.feature import structure_tensor

from .geometry import bezier_length, polyline_to_beziers
from .params import LineArtParams
from .posterize import Posterized
from .strokes import LAYER_TEXTURE, Stroke


@dataclass
class TextureField:
    dr: np.ndarray            # direção ao longo da textura (componente linha)
    dc: np.ndarray            # componente coluna
    coherence: np.ndarray     # 0..1, anisotropia
    score: np.ndarray         # 0..1, anisotropia PONDERADA por energia de detalhe
    allowed: np.ndarray       # máscara das regiões texturadas
    labels: frozenset[int]    # rótulos considerados texturados


def orientation_field(
    detail: np.ndarray, sigma_px: float, smooth_px: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(dr, dc) ao longo da textura, coerência e energia.

    A média é feita sobre as COMPONENTES DO TENSOR, nunca sobre o ângulo: o campo
    tem ambiguidade de 180° e a média de ângulos daria direções sem sentido.
    """
    arr, arc, acc = structure_tensor(
        detail.astype(np.float64), sigma=max(sigma_px, 0.8), order="rc"
    )
    if smooth_px > 0.5:
        arr = ndi.gaussian_filter(arr, smooth_px)
        arc = ndi.gaussian_filter(arc, smooth_px)
        acc = ndi.gaussian_filter(acc, smooth_px)

    tmp = np.sqrt((arr - acc) ** 2 + 4.0 * arc ** 2)
    l_major = 0.5 * (arr + acc + tmp)
    l_minor = 0.5 * (arr + acc - tmp)

    # autovetor de l_minor = direção de menor variação = ao longo da linha
    v1r, v1c = arc, l_minor - arr
    v2r, v2c = l_minor - acc, arc
    use_first = (v1r ** 2 + v1c ** 2) >= (v2r ** 2 + v2c ** 2)
    dr = np.where(use_first, v1r, v2r)
    dc = np.where(use_first, v1c, v2c)
    norm = np.maximum(np.hypot(dr, dc), 1e-9)
    dr, dc = dr / norm, dc / norm

    coherence = (l_major - l_minor) / np.maximum(l_major + l_minor, 1e-9)
    return dr, dc, coherence, l_major


def analyse_texture(
    post: Posterized, params: LineArtParams, px_per_cm: float
) -> TextureField:
    pitch_px = max(params.hatch_pitch_cm * px_per_cm, 3.0)
    lightness = post.lab[..., 0]

    # Passa-banda ANTES do tensor. Um degradê liso de aerógrafo também é
    # anisotrópico — sem detrend a coerência confunde sombra com nervura, e a
    # banana inteira sai hachurada.
    detail = lightness - ndi.gaussian_filter(lightness, pitch_px)

    dr, dc, coherence, energy = orientation_field(
        detail, sigma_px=pitch_px / 2.5, smooth_px=pitch_px * 1.2
    )
    coherence = ndi.gaussian_filter(coherence, pitch_px / 2.0)

    subject = (~post.background) & (post.labels > 0)
    reference = float(np.percentile(energy[subject], 92)) if subject.any() else 1.0
    strength = np.clip(energy / max(reference, 1e-9), 0.0, 1.0)
    score = coherence * strength

    min_region_px = (pitch_px ** 2) * 25
    allowed = np.zeros(subject.shape, dtype=bool)
    textured: set[int] = set()
    for label in sorted(set(int(v) for v in np.unique(post.labels)) - {0}):
        mask = post.labels == label
        if mask.sum() < min_region_px:
            continue
        if float(score[mask].mean()) >= params.hatch_region_coherence:
            allowed |= mask
            textured.add(label)
    allowed &= subject
    return TextureField(dr, dc, coherence, score, allowed, frozenset(textured))


class _Occupancy:
    """Grade de ocupação — mantém o espaçamento uniforme entre traços."""

    def __init__(self, d_sep: float) -> None:
        self.d = max(d_sep, 1.0)
        self.cells: dict[tuple[int, int], list[tuple[float, float]]] = {}

    def _key(self, r: float, c: float) -> tuple[int, int]:
        return (int(r / self.d), int(c / self.d))

    def add(self, r: float, c: float) -> None:
        self.cells.setdefault(self._key(r, c), []).append((r, c))

    def too_close(self, r: float, c: float, limit: float) -> bool:
        kr, kc = self._key(r, c)
        limit_sq = limit * limit
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                for pr, pc in self.cells.get((kr + dr, kc + dc), ()):
                    if (pr - r) ** 2 + (pc - c) ** 2 < limit_sq:
                        return True
        return False


def _bilinear(field: np.ndarray, r: float, c: float) -> float:
    h, w = field.shape
    r = min(max(r, 0.0), h - 1.001)
    c = min(max(c, 0.0), w - 1.001)
    r0, c0 = int(r), int(c)
    fr, fc = r - r0, c - c0
    return float(
        field[r0, c0] * (1 - fr) * (1 - fc)
        + field[r0 + 1, c0] * fr * (1 - fc)
        + field[r0, c0 + 1] * (1 - fr) * fc
        + field[r0 + 1, c0 + 1] * fr * fc
    )


def _integrate(
    seed: tuple[float, float],
    field: TextureField,
    tone_ok: np.ndarray,
    occupancy: _Occupancy,
    step: float,
    d_sep: float,
    max_steps: int,
    coherence_min: float,
    params: LineArtParams,
) -> list[tuple[float, float]]:
    h, w = field.coherence.shape
    halves: list[list[tuple[float, float]]] = []

    # direção de referência do próprio seed, para as duas metades saírem colineares
    base_r = _bilinear(field.dr, *seed)
    base_c = _bilinear(field.dc, *seed)
    base_norm = np.hypot(base_r, base_c)
    if base_norm < 1e-6:
        return []
    base_r, base_c = base_r / base_norm, base_c / base_norm

    for sign in (1.0, -1.0):
        r, c = seed
        prev = (base_r * sign, base_c * sign)
        out: list[tuple[float, float]] = []
        for _ in range(max_steps):
            if not (0 <= r < h - 1 and 0 <= c < w - 1):
                break
            ri, ci = int(r), int(c)
            if not field.allowed[ri, ci] or not tone_ok[ri, ci]:
                break
            if _bilinear(field.coherence, r, c) < coherence_min:
                break
            vr = _bilinear(field.dr, r, c)
            vc = _bilinear(field.dc, r, c)
            norm = np.hypot(vr, vc)
            if norm < 1e-6:
                break
            vr, vc = vr / norm, vc / norm
            if vr * prev[0] + vc * prev[1] < 0:
                vr, vc = -vr, -vc
            # curva demais em um passo => a orientação virou, para aqui
            if vr * prev[0] + vc * prev[1] < params.hatch_turn_cos:
                break
            mr, mc = r + vr * step * 0.5, c + vc * step * 0.5
            wr = _bilinear(field.dr, mr, mc)
            wc = _bilinear(field.dc, mr, mc)
            if wr * vr + wc * vc < 0:
                wr, wc = -wr, -wc
            nrm = np.hypot(wr, wc)
            if nrm > 1e-6:
                vr, vc = wr / nrm, wc / nrm
            r, c = r + vr * step, c + vc * step
            prev = (vr, vc)
            if occupancy.too_close(r, c, d_sep * 0.85):
                break
            out.append((r, c))
        halves.append(out)

    return list(reversed(halves[1])) + [seed] + halves[0]


def build_hatch(
    post: Posterized,
    field: TextureField,
    params: LineArtParams,
    px_per_cm: float,
) -> list[Stroke]:
    if not params.hatch or not field.allowed.any():
        return []

    pitch_px = max(params.hatch_pitch_cm * px_per_cm, 3.0)
    tone_ok = ndi.gaussian_filter(post.tone, pitch_px / 2.0) <= params.hatch_tone_gate

    occupancy = _Occupancy(pitch_px)
    step = max(pitch_px / 3.0, 1.0)
    max_steps = int(params.hatch_max_length_cm * px_per_cm / step)
    min_len_px = params.hatch_min_length_cm * px_per_cm

    seed_mask = field.allowed & tone_ok & (field.score >= params.hatch_seed_score)
    rows, cols = np.nonzero(seed_mask)
    if rows.size == 0:
        return []
    order = np.argsort(-field.score[rows, cols])
    stride = max(1, int(rows.size / 30_000))
    order = order[::stride]

    strokes: list[Stroke] = []
    for idx in order:
        r0, c0 = float(rows[idx]), float(cols[idx])
        if occupancy.too_close(r0, c0, pitch_px):
            continue
        points = _integrate(
            (r0, c0), field, tone_ok, occupancy,
            step, pitch_px, max_steps, params.hatch_coherence_min, params,
        )
        if len(points) < 4:
            continue
        arr = np.asarray(points, dtype=np.float64)
        length = float(np.sum(np.hypot(*np.diff(arr, axis=0).T)))
        if length < min_len_px:
            continue
        for r, c in points:
            occupancy.add(r, c)
        for curves in polyline_to_beziers(
            arr[:, ::-1],
            resample_step=params.resample_cm * px_per_cm,
            simplify_tol=params.simplify_cm * px_per_cm * 1.5,
            bezier_error=params.bezier_error_cm * px_per_cm * 1.5,
            corner_deg=120.0,
        ):
            curve_len = bezier_length(curves)
            if curve_len < min_len_px:
                continue
            strokes.append(Stroke(layer=LAYER_TEXTURE, curves=curves, length_px=curve_len))
    return strokes
