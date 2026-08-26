"""Fronteira compartilhada — a métrica que paga hora.

Só entre TINTAS (campo não conta), na PARTIÇÃO final (o filete do campo
separa sozinho — jamais dilatar). Transições h+v cruas superestimam ~27%:
correção de Crofton (π/4). G3b: UM número por par — nunca ponderar por ΔE.
"""
from __future__ import annotations

import numpy as np

from .util import p


def medir(labels: np.ndarray, campo_id: int, mm_px: float, params: dict) -> dict:
    """Matriz de fronteira por par de classes, em metros."""
    fator = p(params, "fronteira", "correcao_crofton")
    K = int(labels.max()) + 2
    contas: dict[tuple[int, int], int] = {}

    h = labels.shape[0]
    bloco = max(1, 4_000_000 // max(1, labels.shape[1]))
    for eixo in (0, 1):
        for y0 in range(0, h, bloco):
            y1 = min(h, y0 + bloco + (1 if eixo == 0 else 0))
            sub = labels[y0:y1]
            if eixo == 0:
                a, b = sub[:-1, :], sub[1:, :]
            else:
                a, b = sub[:, :-1], sub[:, 1:]
            m = a != b
            if not m.any():
                continue
            av, bv = a[m], b[m]
            lo = np.minimum(av, bv).astype(np.int64)
            hi = np.maximum(av, bv).astype(np.int64)
            chave = lo * K + hi
            u, c = np.unique(chave, return_counts=True)
            for k, n in zip(u.tolist(), c.tolist()):
                contas[(k // K, k % K)] = contas.get((k // K, k % K), 0) + n

    pares = []
    total_tt = 0.0
    total_campo = 0.0
    for (a, b), n in sorted(contas.items(), key=lambda kv: -kv[1]):
        metros = n * mm_px * fator / 1000.0
        envolve_campo = campo_id in (a, b)
        if envolve_campo:
            total_campo += metros
        else:
            total_tt += metros
            pares.append({"par": [int(a), int(b)], "m": round(metros, 2)})
    return {
        "total_tt_m": round(total_tt, 2),
        "total_contra_campo_m": round(total_campo, 2),  # informativo: ali a aresta do vinil é a máscara
        "pares": pares,
    }
