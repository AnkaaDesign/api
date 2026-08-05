"""S2 — color quantization.

Order of operations (mirrors the plan):
1. photographic-zone detection (high local color entropy) — excluded from clustering;
2. k-means in CIELAB seeded by 3D-histogram peaks, deterministic;
3. center merge below ΔE threshold;
4. anti-aliasing cleanup by modal vote restricted to uncertain pixels;
5. keyline detection at ORIGINAL resolution (thin slivers of background between
   two paint regions) with protection against absorption;
6. small-region absorption;
7. background classification (white plate / general paint / ambiguous).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import disk, opening, skeletonize

from .colors import chroma, delta_e76, lab_to_hex, srgb_to_lab
from .params import EngineParams

_MAX_KMEANS_SAMPLES = 300_000
_KMEANS_ITERS = 20


@dataclass
class Keyline:
    a_index: int
    b_index: int
    length_cm: float
    component_id: int


@dataclass
class QuantizeResult:
    labels: np.ndarray                 # (h, w) int16 palette index; -1 inside photo zones
    palette_lab: np.ndarray            # (k, 3)
    palette_hex: list[str]
    palette_pct: list[float]
    photo_mask: np.ndarray             # (h, w) bool
    keyline_mask: np.ndarray           # (h, w) bool (work res)
    keylines: list[Keyline]
    background_index: int
    background_mode: str               # WHITE_PLATE | GENERAL_PAINT
    background_coverage: float
    # tom de rampa: é tinta própria (tem demão), mas o acabamento esfuma a
    # separação. Default vazio para não quebrar construção em teste.
    palette_gradient: list[bool] = field(default_factory=list)
    alerts: list[dict] = field(default_factory=list)
    photo_zone_audit: list[dict] = field(default_factory=list)


# --------------------------------------------------------------------------
# photographic zones
# --------------------------------------------------------------------------

def _per_tile_distinct(rgb_work: np.ndarray, tile: int) -> np.ndarray:
    """Distinct coarse color codes (4 bits/channel) per tile. Shape (th, tw)."""
    h, w = rgb_work.shape[:2]
    th, tw = h // tile, w // tile
    if th == 0 or tw == 0:
        return np.zeros((0, 0), dtype=np.int32)
    coarse = (rgb_work >> 4).astype(np.uint16)  # 16 levels per channel
    codes = (coarse[..., 0] << 8) | (coarse[..., 1] << 4) | coarse[..., 2]
    trimmed = codes[: th * tile, : tw * tile].reshape(th, tile, tw, tile)
    tiles = trimmed.transpose(0, 2, 1, 3).reshape(th, tw, tile * tile)
    return np.array(
        [[len(np.unique(tiles[i, j])) for j in range(tw)] for i in range(th)], dtype=np.int32
    )


def _per_tile_mean(values: np.ndarray, tile: int) -> np.ndarray:
    """Mean of a (h, w) float/bool array per tile. Shape (th, tw)."""
    h, w = values.shape
    th, tw = h // tile, w // tile
    if th == 0 or tw == 0:
        return np.zeros((0, 0), dtype=np.float64)
    trimmed = values[: th * tile, : tw * tile].astype(np.float64)
    return trimmed.reshape(th, tile, tw, tile).mean(axis=(1, 3))


def _grad_bands(lab_l: np.ndarray, params: EngineParams) -> tuple[np.ndarray, np.ndarray]:
    """(soft, hard) boolean masks over the L* gradient magnitude (L*/px).

    FLAT (< soft_min) is a solid interior; SOFT [soft_min, hard_min) is the
    continuous-tone signature; HARD (>= hard_min) is a vector edge step."""
    gy, gx = np.gradient(lab_l)
    grad = np.hypot(gx, gy)
    soft = (grad >= params.photo_grad_soft_min_l) & (grad < params.photo_grad_hard_min_l)
    hard = grad >= params.photo_grad_hard_min_l
    return soft, hard


def detect_photo_zones(
    rgb_work: np.ndarray,
    lab_work: np.ndarray,
    params: EngineParams,
    px_per_cm: float,
) -> np.ndarray:
    """Phase A tile gate: a tile is a photographic candidate only when it has
    BOTH many distinct coarse colors AND a minimum share of soft L* gradients.
    Anti-aliased edges between few flat colors produce many codes but almost no
    soft-band pixels, so vector emblems no longer qualify."""
    h, w = rgb_work.shape[:2]
    tile = params.photo_tile_px
    distinct = _per_tile_distinct(rgb_work, tile)
    if distinct.size == 0:
        return np.zeros((h, w), dtype=bool)
    th, tw = distinct.shape

    soft, _hard = _grad_bands(lab_work[..., 0], params)
    soft_pct = _per_tile_mean(soft, tile)
    photo_tiles = (distinct >= params.photo_color_count) & (soft_pct >= params.photo_soft_pct_min)

    mask = np.zeros((h, w), dtype=bool)
    mask[: th * tile, : tw * tile] = np.repeat(np.repeat(photo_tiles, tile, axis=0), tile, axis=1)
    # consolidate: close small gaps, drop small blobs
    mask = ndi.binary_closing(mask, structure=np.ones((3, 3)), iterations=2)
    mask = ndi.binary_opening(mask, structure=np.ones((3, 3)), iterations=1)
    labeled, n = ndi.label(mask)
    if n:
        min_px = params.photo_min_area_cm2 * (px_per_cm**2)
        sizes = ndi.sum_labels(np.ones_like(labeled), labeled, index=np.arange(1, n + 1))
        keep = np.flatnonzero(sizes >= min_px) + 1
        mask = np.isin(labeled, keep)
    return mask


def _rescue_vector_zones(
    photo_mask: np.ndarray,
    rgb_work: np.ndarray,
    lab_work: np.ndarray,
    params: EngineParams,
    px_per_cm: float,
) -> tuple[np.ndarray, list[dict], list[dict]]:
    """Phase B zone verification. For every candidate zone, re-quantize locally
    and DEMOTE it back to the normal vector flow when all three vector criteria
    hold: few real colors, low residual, hard edges dominant.

    Returns (photo_mask, audit, alerts); demoted pixels are cleared from the
    mask so they rejoin the global k-means normally."""
    audit: list[dict] = []
    alerts: list[dict] = []
    if not np.any(photo_mask):
        return photo_mask, audit, alerts

    mask = photo_mask.copy()
    lab_flat = lab_work.reshape(-1, 3)
    soft, hard = _grad_bands(lab_work[..., 0], params)
    distinct = _per_tile_distinct(rgb_work, params.photo_tile_px)
    tile = params.photo_tile_px

    labeled, n = ndi.label(mask)
    objects = ndi.find_objects(labeled)
    for comp in range(1, n + 1):
        sl = objects[comp - 1]
        if sl is None:
            continue
        zone_local = labeled[sl] == comp
        zone_px = int(zone_local.sum())
        if zone_px == 0:
            continue

        rows, cols = np.nonzero(zone_local)
        rows = rows + sl[0].start
        cols = cols + sl[1].start
        flat_idx = rows * mask.shape[1] + cols
        if flat_idx.size > params.photo_verify_sample_px:
            stride = int(np.ceil(flat_idx.size / params.photo_verify_sample_px))
            flat_idx = flat_idx[::stride]
        sample = lab_flat[flat_idx]

        # local quantization: histogram seeds capped, few iterations, merge
        seeds = _histogram_seeds(sample, params)[: params.photo_rescue_max_colors + 4]
        centers = seeds
        for _ in range(8):
            assign = _assign_chunked(sample, centers)
            new_centers = np.empty_like(centers)
            moved = 0.0
            for i in range(centers.shape[0]):
                members = sample[assign == i]
                if members.shape[0] == 0:
                    new_centers[i] = centers[i]
                    continue
                new_centers[i] = members.mean(axis=0)
                moved = max(moved, float(delta_e76(new_centers[i], centers[i])))
            centers = new_centers
            if moved < 0.25:
                break
        centers = _merge_centers(centers, params.merge_delta_e)
        assign = _assign_chunked(sample, centers)

        share = np.bincount(assign, minlength=centers.shape[0]) / max(1, assign.size)
        real_colors = int((share >= params.photo_zone_color_min_pct).sum())
        residual_pct = float(
            (delta_e76(sample, centers[assign]) > params.aa_uncertain_delta_e).mean()
        )
        zone_hard = int(hard[rows, cols].sum())
        zone_soft = int(soft[rows, cols].sum())
        hard_share = zone_hard / max(1, zone_hard + zone_soft)

        vector_like = (
            real_colors <= params.photo_rescue_max_colors
            and residual_pct <= params.photo_rescue_max_residual_pct
            and hard_share >= params.photo_rescue_min_hard_edge
        )

        bbox_w_cm = (sl[1].stop - sl[1].start) / px_per_cm
        bbox_h_cm = (sl[0].stop - sl[0].start) / px_per_cm
        distinct_med = 0.0
        if distinct.size:
            tr0, tr1 = sl[0].start // tile, max(sl[0].start // tile + 1, -(-sl[0].stop // tile))
            tc0, tc1 = sl[1].start // tile, max(sl[1].start // tile + 1, -(-sl[1].stop // tile))
            block = distinct[tr0 : min(tr1, distinct.shape[0]), tc0 : min(tc1, distinct.shape[1])]
            if block.size:
                distinct_med = float(np.median(block))
        soft_pct_zone = zone_soft / max(1, zone_px)

        if vector_like:
            mask[rows, cols] = False
            alerts.append(
                {
                    "code": "VECTOR_EMBLEM_RESCUED",
                    "severity": "INFO",
                    "message": (
                        "Zona {:.0f}×{:.0f} cm com {} cores chapadas e bordas duras — tratada "
                        "como emblema vetorial (máscaras), não aerografia."
                    ).format(bbox_w_cm, bbox_h_cm, real_colors),
                }
            )
        audit.append(
            {
                "bboxCm": [
                    round(sl[1].start / px_per_cm, 1),
                    round(sl[0].start / px_per_cm, 1),
                    round(bbox_w_cm, 1),
                    round(bbox_h_cm, 1),
                ],
                "areaCm2": round(zone_px / px_per_cm**2, 1),
                "distinctMed": distinct_med,
                "softPct": round(soft_pct_zone, 4),
                "hardShare": round(hard_share, 4),
                "realColors": real_colors,
                "residualPct": round(residual_pct, 4),
                "kept": not vector_like,
            }
        )
    return mask, audit, alerts


# --------------------------------------------------------------------------
# k-means in LAB
# --------------------------------------------------------------------------

def _flat_interior(lab_work: np.ndarray) -> np.ndarray:
    """|∇LAB| em ΔE/px. Alto na borda (antialias) e no ruído; baixo no miolo
    de um fill chapado. Serve para que só o interior das cores vote."""
    g = [np.gradient(lab_work[:, :, c]) for c in range(3)]
    return np.sqrt(sum(gy ** 2 + gx ** 2 for gy, gx in g))


def _histogram_seeds(lab: np.ndarray, params: EngineParams) -> np.ndarray:
    """Sementes do k-means, por seleção gulosa com raio de exclusão.

    A versão anterior usava bins de 5,0 com supressão de não-máximo 3x3x3, o
    que impunha um **piso algébrico de ΔE 10,0 entre sementes** — e o k-means
    nunca cria um cluster que a semeadura não propôs. Medido em 24 artes: o ΔE
    mínimo entre sementes era exatamente 10,00 em todas, e `merge_delta_e=6.0`
    jamais disparou.

    O piso errava nos dois sentidos: fundia dezenas de triângulos do 137
    PESCADOS (6 azuis reais, ΔE mediano 5,5 entre vizinhos) e fabricava três
    azuis na BURES ao varrer uma rampa contínua a cada ~10 ΔE.
    """
    bin_size = params.seed_bin_lab
    mins = lab.min(axis=0)
    idx = np.floor((lab - mins) / bin_size).astype(np.int32)
    dims = idx.max(axis=0) + 1
    flat = np.ravel_multi_index((idx[:, 0], idx[:, 1], idx[:, 2]), dims)
    counts = np.bincount(flat, minlength=int(np.prod(dims)))

    threshold = max(int(params.seed_min_peak_pct * lab.shape[0]), 8)
    dense = np.flatnonzero(counts >= threshold)
    if dense.size == 0:
        return lab.mean(axis=0, keepdims=True)

    order = dense[np.argsort(counts[dense])[::-1]]
    seeds: list[np.ndarray] = []
    for b in order:
        c = (np.array(np.unravel_index(b, dims), dtype=float) + 0.5) * bin_size + mins
        if seeds and float(delta_e76(np.array(seeds), c).min()) < params.seed_min_delta_e:
            continue
        seeds.append(c)
        if len(seeds) >= params.max_colors:
            break
    return np.array(seeds)


def _modal_purity(rgb_original, centers, params, rng) -> np.ndarray:
    """Fração do RGB exato dominante dentro de cada cluster.

    É o que separa tinta chapada de rampa de degradê, e a separação é limpa:
    medido em 3M px, tinta fica entre 0,95 e 1,00 e rampa entre 0,10 e 0,12,
    com banda vazia entre 0,12 e 0,65.

    Tem de ser medida na resolução ORIGINAL — o downscale LANCZOS destrói os
    valores exatos de que a pureza depende.
    """
    orig = rgb_original.reshape(-1, 3)
    n = min(params.flat_modal_sample_px, orig.shape[0])
    sel = rng.choice(orig.shape[0], n, replace=False) if n < orig.shape[0] else slice(None)
    sample = orig[sel]
    assign = _assign_chunked(srgb_to_lab(sample), centers)
    code = ((sample[:, 0].astype(np.int64) << 16)
            | (sample[:, 1].astype(np.int64) << 8) | sample[:, 2])
    purity = np.ones(centers.shape[0])
    for i in range(centers.shape[0]):
        m = assign == i
        size = int(m.sum())
        if size < 200:
            continue   # amostra insuficiente -> MANTÉM; área é policiada por
                       # min_region_cm2, nunca por um piso de amostra de cor
        purity[i] = np.unique(code[m], return_counts=True)[1].max() / size
    return purity


def _assign_chunked(lab_flat: np.ndarray, centers: np.ndarray, chunk: int = 500_000) -> np.ndarray:
    out = np.empty(lab_flat.shape[0], dtype=np.int16)
    for start in range(0, lab_flat.shape[0], chunk):
        block = lab_flat[start : start + chunk]
        dists = delta_e76(block[:, None, :], centers[None, :, :])
        out[start : start + chunk] = np.argmin(dists, axis=1).astype(np.int16)
    return out


def _merge_centers(centers: np.ndarray, threshold: float) -> np.ndarray:
    """Merge centers closer than `threshold` ΔE (single-linkage, repeated
    pairwise merges until stable)."""
    while True:
        k = centers.shape[0]
        if k <= 1:
            break
        dist = delta_e76(centers[:, None, :], centers[None, :, :])
        np.fill_diagonal(dist, np.inf)
        i, j = np.unravel_index(np.argmin(dist), dist.shape)
        if dist[i, j] >= threshold:
            break
        merged = (centers[i] + centers[j]) / 2.0
        centers = np.delete(centers, max(i, j), axis=0)
        centers[min(i, j)] = merged
    return centers


def _kmeans(lab_samples: np.ndarray, params: EngineParams,
            seeds: np.ndarray | None = None) -> np.ndarray:
    centers = _histogram_seeds(lab_samples, params) if seeds is None else seeds
    for _ in range(_KMEANS_ITERS):
        labels = _assign_chunked(lab_samples, centers)
        new_centers = np.empty_like(centers)
        moved = 0.0
        for i in range(centers.shape[0]):
            members = lab_samples[labels == i]
            if members.shape[0] == 0:
                new_centers[i] = centers[i]
                continue
            new_centers[i] = members.mean(axis=0)
            moved = max(moved, float(delta_e76(new_centers[i], centers[i])))
        centers = new_centers
        if moved < 0.25:
            break
    return _merge_centers(centers, params.merge_delta_e)


# --------------------------------------------------------------------------
# anti-aliasing modal cleanup
# --------------------------------------------------------------------------

def _modal_cleanup(
    labels: np.ndarray,
    lab_work: np.ndarray,
    centers: np.ndarray,
    protected: np.ndarray,
    params: EngineParams,
) -> np.ndarray:
    own = centers[np.clip(labels, 0, None)]
    own_delta = delta_e76(lab_work, own)
    uncertain = (own_delta > params.aa_uncertain_delta_e) & (labels >= 0) & ~protected
    if not np.any(uncertain):
        return labels

    best_count = np.zeros(labels.shape, dtype=np.float32)
    best_label = labels.copy()
    kernel = np.ones((3, 3), dtype=np.float32)
    for i in range(centers.shape[0]):
        count = ndi.convolve((labels == i).astype(np.float32), kernel, mode="constant")
        better = count > best_count
        best_count = np.where(better, count, best_count)
        best_label = np.where(better, np.int16(i), best_label)

    result = labels.copy()
    result[uncertain] = best_label[uncertain]
    return result


# --------------------------------------------------------------------------
# keylines (original resolution)
# --------------------------------------------------------------------------

def _detect_keylines_original(
    rgb_original: np.ndarray,
    bg_lab: np.ndarray,
    work_shape: tuple[int, int],
    params: EngineParams,
    px_per_cm_original: float,
) -> np.ndarray:
    """Thin slivers of background color, found at full resolution (they vanish
    when downscaled). Returns a boolean mask projected onto the work grid."""
    h, w = rgb_original.shape[:2]
    bg_mask = np.zeros((h, w), dtype=bool)
    chunk_rows = max(1, int(4_000_000 / max(w, 1)))
    for r0 in range(0, h, chunk_rows):
        block = rgb_original[r0 : r0 + chunk_rows]
        lab = srgb_to_lab(block.reshape(-1, 3))
        bg_mask[r0 : r0 + chunk_rows] = (
            delta_e76(lab, bg_lab) < params.merge_delta_e * 2
        ).reshape(block.shape[:2])

    radius = max(1, params.keyline_max_px_original)
    opened = opening(bg_mask, disk(radius))
    thin = bg_mask & ~opened
    thin = ndi.binary_opening(thin, structure=np.ones((2, 2)))  # drop AA specks

    labeled, n = ndi.label(thin)
    if n:
        min_px = params.keyline_min_len_cm * px_per_cm_original
        sizes = ndi.sum_labels(np.ones_like(labeled), labeled, index=np.arange(1, n + 1))
        keep = np.flatnonzero(sizes >= min_px) + 1
        thin = np.isin(labeled, keep)

    # project onto work grid with "any" pooling
    wh, ww = work_shape
    row_idx = np.minimum((np.arange(h) * wh // h), wh - 1)
    col_idx = np.minimum((np.arange(w) * ww // w), ww - 1)
    work_mask = np.zeros((wh, ww), dtype=bool)
    rows, cols = np.nonzero(thin)
    work_mask[row_idx[rows], col_idx[cols]] = True
    return work_mask


def _register_keylines(
    keyline_mask: np.ndarray,
    labels: np.ndarray,
    background_index: int,
    px_per_cm_work: float,
) -> list[Keyline]:
    keylines: list[Keyline] = []
    labeled, n = ndi.label(keyline_mask, structure=np.ones((3, 3)))
    for comp in range(1, n + 1):
        comp_mask = labeled == comp
        ring = ndi.binary_dilation(comp_mask, iterations=2) & ~comp_mask
        neighbors = np.unique(labels[ring])
        neighbors = neighbors[(neighbors >= 0) & (neighbors != background_index)]
        if neighbors.size < 2:
            continue
        skeleton_px = int(skeletonize(comp_mask).sum())
        length_cm = skeleton_px / px_per_cm_work
        pairs = [(int(a), int(b)) for ai, a in enumerate(neighbors) for b in neighbors[ai + 1 :]]
        for a, b in pairs:
            keylines.append(Keyline(a, b, round(length_cm, 1), comp))
    return keylines


# --------------------------------------------------------------------------
# small-region absorption
# --------------------------------------------------------------------------

def _absorb_small_regions(
    labels: np.ndarray,
    protected: np.ndarray,
    params: EngineParams,
    px_per_cm: float,
    n_colors: int,
) -> np.ndarray:
    min_px = max(4, int(params.min_region_cm2 * px_per_cm**2))
    result = labels.copy()
    for color in range(n_colors):
        mask = result == color
        labeled, n = ndi.label(mask)
        if n == 0:
            continue
        sizes = ndi.sum_labels(np.ones_like(labeled), labeled, index=np.arange(1, n + 1))
        small = np.flatnonzero(sizes < min_px) + 1
        if small.size == 0:
            continue
        objects = ndi.find_objects(labeled)
        for comp in small:
            sl = objects[comp - 1]
            if sl is None:
                continue
            grown = tuple(
                slice(max(0, s.start - 1), min(dim, s.stop + 1))
                for s, dim in zip(sl, labels.shape)
            )
            local = labeled[grown] == comp
            if np.any(protected[grown] & local):
                continue  # keylines survive
            ring = ndi.binary_dilation(local) & ~local
            neighbor_labels = result[grown][ring]
            neighbor_labels = neighbor_labels[neighbor_labels != color]
            if neighbor_labels.size == 0:
                continue
            counts = np.bincount(neighbor_labels[neighbor_labels >= 0], minlength=n_colors)
            if counts.sum() == 0:
                continue
            result[grown][local] = np.int16(np.argmax(counts))
    return result


# --------------------------------------------------------------------------
# background
# --------------------------------------------------------------------------

def _classify_background(
    palette_lab: np.ndarray,
    palette_pct: np.ndarray,
    params: EngineParams,
) -> tuple[int, str, list[dict]]:
    alerts: list[dict] = []
    whiteish = (palette_lab[:, 0] >= params.white_l_min) & (chroma(palette_lab) <= params.white_chroma_max)
    white_total = float(palette_pct[whiteish].sum()) if np.any(whiteish) else 0.0
    dominant = int(np.argmax(palette_pct))

    if white_total >= 0.25:
        candidates = np.flatnonzero(whiteish)
        bg = int(candidates[np.argmax(palette_pct[candidates])])
        mode = "WHITE_PLATE"
    else:
        bg = dominant
        mode = "GENERAL_PAINT"

    pure_white = np.array([100.0, 0.0, 0.0])
    d_white = float(delta_e76(palette_lab[bg], pure_white))
    if mode == "WHITE_PLATE" and 2.0 < d_white < params.ambiguous_delta_e:
        alerts.append(
            {
                "code": "AMBIGUOUS_BACKGROUND",
                "severity": "WARNING",
                "message": (
                    "Fundo quase-branco (ΔE {:.1f} do branco puro). Confirmar se é a chapa "
                    "original ou uma pintura geral em tom claro — a decisão muda o plano em dias."
                ).format(d_white),
            }
        )
    if mode == "GENERAL_PAINT" and palette_pct[bg] < params.general_paint_pct:
        alerts.append(
            {
                "code": "BACKGROUND_COVERAGE_LOW",
                "severity": "INFO",
                "message": (
                    "Cor dominante cobre {:.0f}% (< {:.0f}%). Tratada como pintura geral; revisar."
                ).format(palette_pct[bg] * 100, params.general_paint_pct * 100),
            }
        )
    if mode == "GENERAL_PAINT" and chroma(palette_lab[bg]) <= params.white_chroma_max and palette_lab[bg][0] >= 55.0:
        alerts.append(
            {
                "code": "AMBIGUOUS_BACKGROUND",
                "severity": "WARNING",
                "message": (
                    "Fundo cinza-neutro (L* {:.0f}) — pode ser o cinza de apresentação do mockup, não uma "
                    "pintura geral real. Se a chapa é branca de fábrica, troque o 'Fundo da face' para "
                    "'Chapa branca' e recalcule."
                ).format(palette_lab[bg][0]),
            }
        )
    return bg, mode, alerts


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def quantize(
    rgb_original: np.ndarray,
    rgb_work: np.ndarray,
    params: EngineParams,
    px_per_cm_original: float,
    px_per_cm_work: float,
    rng: np.random.Generator | None = None,
) -> QuantizeResult:
    rng = rng or np.random.default_rng(params.seed)
    h, w = rgb_work.shape[:2]

    # LAB before detection: phase A needs L* gradients, phase B re-quantizes
    lab_work = srgb_to_lab(rgb_work)
    photo_mask = detect_photo_zones(rgb_work, lab_work, params, px_per_cm_work)
    photo_mask, photo_zone_audit, rescue_alerts = _rescue_vector_zones(
        photo_mask, rgb_work, lab_work, params, px_per_cm_work
    )

    flat = lab_work.reshape(-1, 3)

    # Sementes vêm SÓ do interior de fills chapados, fora de zonas
    # fotográficas: assim antialias e rampa não viram cor própria.
    gmag = _flat_interior(lab_work)
    seed_pool = np.flatnonzero(
        (~photo_mask & (gmag < params.seed_flat_grad_max)).reshape(-1))
    if seed_pool.size == 0:
        seed_pool = np.flatnonzero(~photo_mask.reshape(-1))
    if seed_pool.size > _MAX_KMEANS_SAMPLES:
        seed_pool = rng.choice(seed_pool, _MAX_KMEANS_SAMPLES, replace=False)

    candidates = np.flatnonzero(~photo_mask.reshape(-1))
    if candidates.size == 0:
        candidates = np.arange(flat.shape[0])
    if candidates.size > _MAX_KMEANS_SAMPLES:
        candidates = rng.choice(candidates, _MAX_KMEANS_SAMPLES, replace=False)
    centers = _kmeans(flat[candidates], params,
                      seeds=_histogram_seeds(flat[seed_pool], params))

    # Portão de pureza modal: MARCA a rampa, não a absorve.
    #
    # Absorver estava errado. Um degradê é pintado como 3-4 cores distintas e
    # só depois as separações são cortadas para esfumar — então os tons SÃO
    # tintas, cada uma com sua demão. O que muda é o acabamento, não a
    # contagem. Fundi-los apagava demãos reais do orçamento.
    purity = _modal_purity(rgb_original, centers, params, rng)
    pure = purity >= params.flat_modal_min
    # Rampa não precisa da mesma resolução que tinta chapada: o pintor bate
    # 3 tons para um degradê, não 6. Consolida os impuros entre si com um
    # limiar mais largo, mantendo-os como tintas próprias.
    if (~pure).sum() > 1:
        ramp_idx = np.flatnonzero(~pure)
        keep = []
        for i in ramp_idx:
            if not keep or float(delta_e76(centers[keep], centers[i]).min()) >= params.gradient_step_delta_e:
                keep.append(int(i))
        drop = sorted(set(ramp_idx.tolist()) - set(keep))
        if drop:
            mask = np.ones(centers.shape[0], dtype=bool)
            mask[drop] = False
            centers = centers[mask]
            purity = purity[mask]
            pure = purity >= params.flat_modal_min

    purity_alerts: list[dict] = []
    if not pure.all():
        purity_alerts.append({
            "code": "GRADIENT_COLORS_PRESENT", "severity": "INFO",
            "message": (f"{int((~pure).sum())} cor(es) de rampa de degradê. "
                        "São tintas próprias: pinta-se todas e só depois se "
                        "corta a separação para esfumar."),
        })
    if not pure.any():
        purity_alerts.append({
            "code": "NO_FLAT_FILL_DETECTED", "severity": "WARNING",
            "message": ("Nenhuma cor chapada detectada (arte rasterizada/JPEG?). "
                        "Paleta pode estar fragmentada — revisar manualmente."),
        })

    labels = _assign_chunked(flat, centers).reshape(h, w)
    labels[photo_mask] = -1

    palette_pct_arr = np.array(
        [float((labels == i).sum()) / labels.size for i in range(centers.shape[0])]
    )
    background_index, background_mode, bg_alerts = _classify_background(
        centers, palette_pct_arr, params
    )

    keyline_mask = _detect_keylines_original(
        rgb_original, centers[background_index], (h, w), params, px_per_cm_original
    )
    keyline_mask &= labels == background_index

    labels = _modal_cleanup(labels, lab_work, centers, keyline_mask | photo_mask, params)
    labels[photo_mask] = -1
    labels = _absorb_small_regions(labels, keyline_mask, params, px_per_cm_work, centers.shape[0])

    palette_pct_arr = np.array(
        [float((labels == i).sum()) / labels.size for i in range(centers.shape[0])]
    )
    keylines = _register_keylines(keyline_mask, labels, background_index, px_per_cm_work)

    alerts = list(rescue_alerts) + list(purity_alerts) + list(bg_alerts)
    non_bg = [i for i in range(centers.shape[0]) if i != background_index and palette_pct_arr[i] > 0.001]
    for ai_pos, a in enumerate(non_bg):
        for b in non_bg[ai_pos + 1 :]:
            d = float(delta_e76(centers[a], centers[b]))
            if d < params.low_delta_e_pair:
                alerts.append(
                    {
                        "code": "LOW_DELTA_E_PAIR",
                        "severity": "WARNING",
                        "message": (
                            "Cores {} e {} muito próximas (ΔE {:.1f}) — confirmar se são "
                            "duas tintas distintas."
                        ).format(lab_to_hex(centers[a]), lab_to_hex(centers[b]), d),
                    }
                )

    return QuantizeResult(
        palette_gradient=[bool(v) for v in ~pure],
        labels=labels,
        palette_lab=centers,
        palette_hex=[lab_to_hex(c) for c in centers],
        palette_pct=[round(float(p), 5) for p in palette_pct_arr],
        photo_mask=photo_mask,
        keyline_mask=keyline_mask,
        keylines=keylines,
        background_index=background_index,
        background_mode=background_mode,
        background_coverage=round(float(palette_pct_arr[background_index]), 4),
        alerts=alerts,
        photo_zone_audit=photo_zone_audit,
    )
