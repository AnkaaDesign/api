"""Polilinha -> Bézier cúbica. É esta etapa que decide se o arquivo é editável
à mão depois: poucos nós, bem colocados, tangentes contínuas."""

from __future__ import annotations

import numpy as np

# --------------------------------------------------------------------------
# reamostragem / simplificação
# --------------------------------------------------------------------------


def resample(points: np.ndarray, step: float) -> np.ndarray:
    """Reamostra por comprimento de arco. Remove o serrilhado de 1 px."""
    if points.shape[0] < 2:
        return points
    seg = np.diff(points, axis=0)
    dist = np.hypot(seg[:, 0], seg[:, 1])
    keep = dist > 1e-9
    if not keep.any():
        return points[:1]
    points = np.vstack([points[0], points[1:][keep]])
    seg = np.diff(points, axis=0)
    dist = np.hypot(seg[:, 0], seg[:, 1])
    cumulative = np.concatenate([[0.0], np.cumsum(dist)])
    total = cumulative[-1]
    if total < step:
        return points[[0, -1]]
    targets = np.arange(0.0, total, step)
    targets = np.append(targets, total)
    x = np.interp(targets, cumulative, points[:, 0])
    y = np.interp(targets, cumulative, points[:, 1])
    return np.stack([x, y], axis=1)


def smooth_polyline(points: np.ndarray, iterations: int = 2, closed: bool = False) -> np.ndarray:
    """Média móvel de 3 pontos — tira o degrau de pixel antes do ajuste."""
    if points.shape[0] < 3 or iterations <= 0:
        return points
    out = points.astype(np.float64).copy()
    for _ in range(iterations):
        if closed:
            prev = np.roll(out, 1, axis=0)
            nxt = np.roll(out, -1, axis=0)
            out = 0.25 * prev + 0.5 * out + 0.25 * nxt
        else:
            inner = 0.25 * out[:-2] + 0.5 * out[1:-1] + 0.25 * out[2:]
            out = np.vstack([out[:1], inner, out[-1:]])
    return out


def douglas_peucker(points: np.ndarray, tolerance: float) -> np.ndarray:
    if points.shape[0] < 3:
        return points
    keep = np.zeros(points.shape[0], dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, points.shape[0] - 1)]
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        a = points[start]
        b = points[end]
        ab = b - a
        norm = float(np.hypot(*ab))
        chunk = points[start + 1 : end]
        if norm < 1e-9:
            dist = np.hypot(chunk[:, 0] - a[0], chunk[:, 1] - a[1])
        else:
            rel = chunk - a
            dist = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / norm
        idx = int(np.argmax(dist))
        if dist[idx] > tolerance:
            pivot = start + 1 + idx
            keep[pivot] = True
            stack.append((start, pivot))
            stack.append((pivot, end))
    return points[keep]


def split_at_corners(points: np.ndarray, angle_deg: float, closed: bool) -> list[np.ndarray]:
    """Quebra a polilinha em cantos duros — ajustar Bézier por cima de um canto
    arredonda o canto, que é justamente o que não pode acontecer no bico da folha."""
    n = points.shape[0]
    if n < 5:
        return [points]
    v1 = points[1:-1] - points[:-2]
    v2 = points[2:] - points[1:-1]
    n1 = np.linalg.norm(v1, axis=1)
    n2 = np.linalg.norm(v2, axis=1)
    denom = np.maximum(n1 * n2, 1e-9)
    cos = np.clip(np.sum(v1 * v2, axis=1) / denom, -1.0, 1.0)
    turn = np.degrees(np.arccos(cos))
    corners = np.nonzero(turn >= angle_deg)[0] + 1
    if corners.size == 0:
        return [points]
    cuts = [0, *corners.tolist(), n - 1]
    pieces = []
    for start, end in zip(cuts[:-1], cuts[1:]):
        if end - start >= 2:
            pieces.append(points[start : end + 1])
    if closed and len(pieces) > 1:
        # costura o último com o primeiro se não houve canto na emenda
        pass
    return pieces or [points]


# --------------------------------------------------------------------------
# ajuste de Bézier (Philip J. Schneider, Graphics Gems)
# --------------------------------------------------------------------------


def _bezier_point(bez: np.ndarray, t: float) -> np.ndarray:
    mt = 1.0 - t
    return (
        mt * mt * mt * bez[0]
        + 3 * mt * mt * t * bez[1]
        + 3 * mt * t * t * bez[2]
        + t * t * t * bez[3]
    )


def _normalize(v: np.ndarray) -> np.ndarray:
    norm = float(np.hypot(*v))
    return v / norm if norm > 1e-12 else np.zeros(2)


def _chord_parameterize(points: np.ndarray) -> np.ndarray:
    d = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(points, axis=0).T))])
    total = d[-1]
    return d / total if total > 1e-12 else np.linspace(0.0, 1.0, points.shape[0])


def _generate_bezier(
    points: np.ndarray, u: np.ndarray, left_t: np.ndarray, right_t: np.ndarray
) -> np.ndarray:
    first, last = points[0], points[-1]
    mt = 1.0 - u
    b0 = mt ** 3
    b1 = 3 * u * mt ** 2
    b2 = 3 * u ** 2 * mt
    b3 = u ** 3

    a0 = left_t[None, :] * b1[:, None]
    a1 = right_t[None, :] * b2[:, None]

    c00 = float(np.sum(a0 * a0))
    c01 = float(np.sum(a0 * a1))
    c11 = float(np.sum(a1 * a1))

    tmp = points - (first[None, :] * (b0 + b1)[:, None] + last[None, :] * (b2 + b3)[:, None])
    x0 = float(np.sum(a0 * tmp))
    x1 = float(np.sum(a1 * tmp))

    det = c00 * c11 - c01 * c01
    seg_len = float(np.hypot(*(last - first)))
    if abs(det) < 1e-12:
        alpha_l = alpha_r = seg_len / 3.0
    else:
        alpha_l = (x0 * c11 - x1 * c01) / det
        alpha_r = (c00 * x1 - c01 * x0) / det

    epsilon = 1e-6 * seg_len
    if alpha_l < epsilon or alpha_r < epsilon:
        alpha_l = alpha_r = seg_len / 3.0
    # trava o comprimento das alças: sem isso o sistema normal explode em trechos
    # quase retos e sai uma reta atravessando o desenho
    limit = seg_len * 1.5
    alpha_l = min(alpha_l, limit)
    alpha_r = min(alpha_r, limit)

    return np.stack([first, first + left_t * alpha_l, last + right_t * alpha_r, last])


def _max_error(points: np.ndarray, bez: np.ndarray, u: np.ndarray) -> tuple[float, int]:
    fitted = np.stack([_bezier_point(bez, float(t)) for t in u])
    dist = np.sum((fitted - points) ** 2, axis=1)
    idx = int(np.argmax(dist))
    return float(dist[idx]), idx


def _reparameterize(points: np.ndarray, bez: np.ndarray, u: np.ndarray) -> np.ndarray:
    q1 = 3.0 * (bez[1:] - bez[:-1])
    q2 = 2.0 * (q1[1:] - q1[:-1])
    out = u.copy()
    for i, t in enumerate(u):
        mt = 1.0 - t
        d = _bezier_point(bez, float(t)) - points[i]
        d1 = mt * mt * q1[0] + 2 * mt * t * q1[1] + t * t * q1[2]
        d2 = mt * q2[0] + t * q2[1]
        num = float(d @ d1)
        den = float(d1 @ d1 + d @ d2)
        if abs(den) > 1e-12:
            out[i] = t - num / den
    return np.clip(out, 0.0, 1.0)


def fit_bezier(points: np.ndarray, error: float) -> list[np.ndarray]:
    """Retorna uma lista de Béziers cúbicas (4 pontos cada) encadeadas."""
    if points.shape[0] < 2:
        return []
    left_t = _normalize(points[1] - points[0])
    right_t = _normalize(points[-2] - points[-1])
    return _fit_cubic(points, left_t, right_t, error * error, depth=0)


def _fit_cubic(
    points: np.ndarray, left_t: np.ndarray, right_t: np.ndarray, error_sq: float, depth: int
) -> list[np.ndarray]:
    n = points.shape[0]
    if n == 2:
        dist = float(np.hypot(*(points[1] - points[0]))) / 3.0
        return [np.stack([points[0], points[0] + left_t * dist, points[1] + right_t * dist, points[1]])]

    u = _chord_parameterize(points)
    bez = _generate_bezier(points, u, left_t, right_t)
    max_err, split = _max_error(points, bez, u)
    if max_err < error_sq:
        return [bez]

    if depth < 24 and max_err < error_sq * 16.0:
        for _ in range(12):
            u = _reparameterize(points, bez, u)
            bez = _generate_bezier(points, u, left_t, right_t)
            max_err, split = _max_error(points, bez, u)
            if max_err < error_sq:
                return [bez]

    if depth >= 24 or split <= 0 or split >= n - 1:
        return [bez]

    center_t = _normalize(points[split - 1] - points[split + 1])
    left = _fit_cubic(points[: split + 1], left_t, center_t, error_sq, depth + 1)
    right = _fit_cubic(points[split:], -center_t, right_t, error_sq, depth + 1)
    return left + right


def polyline_to_beziers(
    points: np.ndarray,
    *,
    resample_step: float,
    simplify_tol: float,
    bezier_error: float,
    corner_deg: float,
    closed: bool = False,
) -> list[list[np.ndarray]]:
    """Pipeline completo: reamostra -> suaviza -> DP -> quebra em cantos -> Bézier.
    Retorna uma lista de sub-caminhos, cada um uma lista de Béziers."""
    pts = resample(np.asarray(points, dtype=np.float64), resample_step)
    if pts.shape[0] < 2:
        return []
    pts = smooth_polyline(pts, iterations=2, closed=closed)
    pts = douglas_peucker(pts, simplify_tol)
    if pts.shape[0] < 2:
        return []
    out = []
    for piece in split_at_corners(pts, corner_deg, closed):
        curves = fit_bezier(piece, bezier_error)
        if curves:
            out.append(curves)
    return out


def bezier_length(curves: list[np.ndarray]) -> float:
    total = 0.0
    for bez in curves:
        samples = np.stack([_bezier_point(bez, t) for t in np.linspace(0.0, 1.0, 12)])
        total += float(np.sum(np.hypot(*np.diff(samples, axis=0).T)))
    return total


def rasterize_points(curves: list[np.ndarray], spacing: float = 1.0) -> np.ndarray:
    """Pontos ao longo da curva com passo em PIXELS, não em frações de Bézier.

    `flatten_beziers` devolve N amostras por segmento: uma curva longa feita de
    uma Bézier só vira ~12 pontos espalhados por centenas de px. Usar isso para
    marcar ocupação deixa buracos e a deduplicação não vê que duas linhas são a
    mesma — o desenho sai com traço duplo.
    """
    flat = flatten_beziers(curves, steps=12)
    if flat.shape[0] < 2:
        return flat
    return resample(flat, max(spacing, 0.5))


def flatten_beziers(curves: list[np.ndarray], steps: int = 12) -> np.ndarray:
    """Para exportar DXF/DWG, que não recebem Bézier de forma portátil."""
    pts: list[np.ndarray] = []
    for i, bez in enumerate(curves):
        ts = np.linspace(0.0, 1.0, steps + 1)
        if i > 0:
            ts = ts[1:]
        pts.extend(_bezier_point(bez, float(t)) for t in ts)
    return np.stack(pts) if pts else np.zeros((0, 2))
