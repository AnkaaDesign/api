"""Contorno vindo das ARESTAS da imagem, não das fronteiras de região.

Por que existe: duas bananas encostadas têm a mesma cor e o SAM costuma
devolver o cacho inteiro como uma instância só. O vinco entre elas, porém, está
lá na foto — é uma sombra estreita, um vale de L*. Segmentação nenhuma acha
isso; detector de aresta acha.

As duas fontes se somam: fronteira de região dá a silhueta externa e o recorte
entre cores; aresta dá a separação interna entre objetos iguais. O que chega
duplicado é descartado contra o que já foi traçado.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import ndimage as ndi
from skimage.feature import canny, hessian_matrix, hessian_matrix_eigvals
from skimage.morphology import skeletonize

from .geometry import bezier_length, polyline_to_beziers, rasterize_points
from .params import LineArtParams
from .posterize import Posterized
from .strokes import LAYER_CONTOUR, Stroke

_OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _chains(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    """Quebra o mapa de arestas em caminhos simples: junções viram corte, para
    um 'Y' não sair como uma curva só passando de um ramo para o outro."""
    pixels = {(int(r), int(c)) for r, c in zip(*np.nonzero(mask))}
    degree = {
        p: sum(1 for dr, dc in _OFFSETS if (p[0] + dr, p[1] + dc) in pixels)
        for p in pixels
    }
    junctions = {p for p, d in degree.items() if d >= 3}
    remaining = pixels - junctions

    def neighbours(p):
        return [
            (p[0] + dr, p[1] + dc)
            for dr, dc in _OFFSETS
            if (p[0] + dr, p[1] + dc) in remaining
        ]

    out: list[list[tuple[int, int]]] = []
    while remaining:
        seed = None
        for p in remaining:
            if len([n for n in neighbours(p) if n in remaining]) <= 1:
                seed = p
                break
        if seed is None:
            seed = next(iter(remaining))
        chain = [seed]
        remaining.discard(seed)
        current = seed
        while True:
            nxt = next((n for n in neighbours(current) if n in remaining), None)
            if nxt is None:
                break
            chain.append(nxt)
            remaining.discard(nxt)
            current = nxt
        if len(chain) >= 3:
            out.append(chain)
    return out


def _tangent(chain: list[tuple[int, int]], at_start: bool, span: int = 6) -> np.ndarray:
    """Direção APONTANDO PARA FORA da ponta escolhida."""
    arr = np.asarray(chain, dtype=np.float64)
    if at_start:
        seg = arr[0] - arr[min(span, len(arr) - 1)]
    else:
        seg = arr[-1] - arr[max(-span - 1, -len(arr))]
    norm = float(np.hypot(*seg))
    return seg / norm if norm > 1e-9 else np.zeros(2)


def _link_chains(
    chains: list[list[tuple[int, int]]], gap_px: float, angle_deg: float
) -> list[list[tuple[int, int]]]:
    """Emenda cadeias que a quebra por junção separou.

    Sem isto a silhueta de uma banana chega picada em 8 pedaços — cada cruzamento
    com outra aresta é um corte — e todos morrem no teste de comprimento mínimo.
    Junta ponta com ponta quando estão perto E seguem na mesma direção.
    """
    if len(chains) < 2:
        return chains
    cos_min = math.cos(math.radians(angle_deg))

    ends = []  # (chain, is_start, point, outward tangent)
    for index, chain in enumerate(chains):
        ends.append((index, True, np.asarray(chain[0], float), _tangent(chain, True)))
        ends.append((index, False, np.asarray(chain[-1], float), _tangent(chain, False)))

    points = np.stack([e[2] for e in ends])
    candidates = []
    for i in range(len(ends)):
        delta = points - points[i]
        dist = np.hypot(delta[:, 0], delta[:, 1])
        near = np.nonzero((dist > 0) & (dist <= gap_px))[0]
        for j in near:
            if j <= i or ends[j][0] == ends[i][0]:
                continue
            # continuar reto = a tangente de saída de um aponta para o oposto da outra
            if float(ends[i][3] @ -ends[j][3]) < cos_min:
                continue
            candidates.append((float(dist[j]), i, int(j)))

    candidates.sort()
    used: set[tuple[int, bool]] = set()
    joins: list[tuple[int, int]] = []
    for _, i, j in candidates:
        ci, si = ends[i][0], ends[i][1]
        cj, sj = ends[j][0], ends[j][1]
        if (ci, si) in used or (cj, sj) in used:
            continue
        used.add((ci, si))
        used.add((cj, sj))
        joins.append((i, j))

    # monta as cadeias resultantes seguindo as emendas
    adjacency: dict[tuple[int, bool], tuple[int, bool]] = {}
    for i, j in joins:
        a = (ends[i][0], ends[i][1])
        b = (ends[j][0], ends[j][1])
        adjacency[a] = b
        adjacency[b] = a

    visited: set[int] = set()
    out: list[list[tuple[int, int]]] = []
    for index in range(len(chains)):
        if index in visited:
            continue
        # anda até uma extremidade livre para começar de fora
        start, at_start = index, True
        seen = {index}
        while (start, at_start) in adjacency:
            nxt_chain, nxt_start = adjacency[(start, at_start)]
            if nxt_chain in seen:
                break
            seen.add(nxt_chain)
            start, at_start = nxt_chain, not nxt_start

        merged: list[tuple[int, int]] = []
        current, from_start = start, at_start
        while True:
            if current in visited:
                break
            visited.add(current)
            piece = chains[current]
            merged.extend(piece if from_start else piece[::-1])
            tail = (current, not from_start)
            if tail not in adjacency:
                break
            nxt_chain, nxt_is_start = adjacency[tail]
            if nxt_chain in visited:
                break
            current, from_start = nxt_chain, nxt_is_start
        if len(merged) >= 3:
            out.append(merged)
    return out


def _valley_lines(
    lightness: np.ndarray,
    subject: np.ndarray,
    params: LineArtParams,
    px_per_cm: float,
) -> np.ndarray:
    """Linha de CENTRO de vinco escuro (multi-escala, via Hessiana).

    O vinco entre duas bananas é uma faixa escura estreita. Detector de degrau
    responde nas DUAS bordas dela e sai linha dupla — o artista desenha uma. A
    resposta de vale marca o miolo da faixa, que é onde a linha tem de ficar.
    """
    response = np.zeros(lightness.shape, dtype=np.float64)
    for sigma_cm in params.valley_sigmas_cm:
        sigma = max(sigma_cm * px_per_cm, 1.0)
        matrix = hessian_matrix(
            lightness, sigma=sigma, order="rc", use_gaussian_derivatives=True
        )
        big, small = hessian_matrix_eigvals(matrix)
        # vale = curvatura positiva forte atravessando, quase nula ao longo
        ridge = np.clip(big, 0.0, None) * (
            1.0 - np.abs(small) / np.maximum(np.abs(big), 1e-9)
        )
        # normalização gama: a segunda derivada cai com sigma^2, então sem
        # este fator as escalas grandes perdem a comparação e vinco largo
        # sai como DUAS linhas (os ombros) em vez de uma linha de centro
        response = np.maximum(response, ridge * sigma * sigma)

    if not subject.any():
        return np.zeros_like(subject)
    threshold = float(np.percentile(response[subject], params.valley_percentile))
    mask = (response >= max(threshold, 1e-9)) & subject
    mask = ndi.binary_closing(mask, structure=np.ones((3, 3)))
    return skeletonize(mask)


def _edge_mask(post: Posterized, params: LineArtParams, px_per_cm: float) -> np.ndarray:
    lightness = post.lab_flat[..., 0]
    chroma = np.hypot(post.lab_flat[..., 1], post.lab_flat[..., 2])
    subject = ~post.background
    if not subject.any():
        return np.zeros_like(subject)

    sigma = max(params.edge_sigma_cm * px_per_cm, 1.0)
    # o canal é L* mais um empurrão do croma: aresta isoluminante (amarelo x
    # verde de mesmo brilho) some se olhar só a luminância
    channel = lightness + params.edge_chroma_weight * chroma
    channel = (channel - channel.min()) / max(float(np.ptp(channel)), 1e-6)

    grad = ndi.gaussian_gradient_magnitude(channel, sigma)
    high = float(np.percentile(grad[subject], params.edge_high_percentile))
    low = float(np.percentile(grad[subject], params.edge_low_percentile))
    steps = canny(
        channel, sigma=sigma, low_threshold=low, high_threshold=high,
        use_quantiles=False,
    ) & subject
    steps = skeletonize(steps)

    valleys = _valley_lines(lightness, subject, params, px_per_cm)

    # onde há linha de vale, os dois flancos de degrau são a MESMA feição:
    # ficam suprimidos para não sair traço duplo
    if valleys.any():
        reach = int(max(params.valley_suppress_cm * px_per_cm, 1))
        shadow = ndi.binary_dilation(valleys, iterations=reach)
        steps &= ~shadow

    return valleys | steps


def edge_strokes(
    post: Posterized,
    params: LineArtParams,
    px_per_cm: float,
    textured: frozenset[int],
    existing: list[Stroke],
) -> list[Stroke]:
    if not params.edges:
        return []

    edges = _edge_mask(post, params, px_per_cm)

    # dentro de folha o Canny acende cada nervura; ali quem manda é a hachura.
    # A dilatação preserva a BORDA da região texturada, que é contorno legítimo.
    if textured:
        inside = np.isin(post.labels, list(textured))
        margin = int(max(params.edge_texture_margin_cm * px_per_cm, 1))
        inside = ndi.binary_erosion(inside, iterations=margin)
        edges &= ~inside

    min_len_px = params.edge_min_length_cm * px_per_cm

    # Só CONTORNO conta como "já traçado". Incluir SOMBRA aqui invertia a
    # prioridade: onde havia aresta dura de verdade, o tracejado da banda de tom
    # suprimia a aresta e a fronteira entre duas bananas ficava pontilhada.
    occupied = np.zeros(edges.shape, dtype=bool)
    h, w = edges.shape
    for stroke in existing:
        if stroke.layer != LAYER_CONTOUR:
            continue
        pts = rasterize_points(stroke.curves)
        rows = np.clip(np.round(pts[:, 1]).astype(int), 0, h - 1)
        cols = np.clip(np.round(pts[:, 0]).astype(int), 0, w - 1)
        occupied[rows, cols] = True
    if occupied.any():
        reach = int(max(params.edge_dedupe_cm * px_per_cm, 1))
        occupied = ndi.binary_dilation(occupied, iterations=reach)

    chains = _link_chains(
        _chains(edges),
        gap_px=max(params.edge_link_gap_cm * px_per_cm, 2.0),
        angle_deg=params.edge_link_angle_deg,
    )

    # Da mais longa para a mais curta, marcando o que já foi aceito: assim uma
    # feição que acendeu nos DOIS flancos entra uma vez só, com o traço melhor.
    # Sem isto o desenho sai com linha dupla em todo vinco.
    measured = []
    for chain in chains:
        arr = np.array([[c, r] for r, c in chain], dtype=np.float64)
        length = float(np.sum(np.hypot(*np.diff(arr, axis=0).T)))
        if length >= min_len_px:
            measured.append((length, arr))
    measured.sort(key=lambda item: -item[0])
    reach = int(max(params.edge_dedupe_cm * px_per_cm, 1))

    strokes: list[Stroke] = []
    for length, arr in measured:
        rows = np.clip(arr[:, 1].astype(int), 0, h - 1)
        cols = np.clip(arr[:, 0].astype(int), 0, w - 1)
        if occupied[rows, cols].mean() > params.edge_dedupe_fraction:
            continue
        stamp = np.zeros_like(occupied)
        stamp[rows, cols] = True
        occupied |= ndi.binary_dilation(stamp, iterations=reach)
        for curves in polyline_to_beziers(
            arr,
            resample_step=params.resample_cm * px_per_cm,
            simplify_tol=params.simplify_cm * px_per_cm,
            bezier_error=params.bezier_error_cm * px_per_cm,
            corner_deg=params.corner_angle_deg,
        ):
            curve_len = bezier_length(curves)
            if curve_len < min_len_px:
                continue
            strokes.append(
                Stroke(layer=LAYER_CONTOUR, curves=curves, length_px=curve_len)
            )
    return strokes
