"""Componentes conexos por classe e ilhas de graça.

Ilha de graça: componente da COR DO CAMPO cercado por tinta — o plotter corta,
ninguém depila, e no fim ela sai expondo o fundo. O mesmo elemento é gratuito
num layout e é o passo mais caro noutro, só porque o campo mudou.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Comp:
    classe_id: int
    idx: int
    area_px: int
    bbox: tuple          # (x, y, w, h) — convenção ÚNICA: x,y = coluna,linha
    centroid: tuple      # (x, y) — mesma convenção (armadilha 3.4 do legado)


def por_classe(labels: np.ndarray, classe_id: int, min_px: int = 16):
    """Componentes 8-conexos de uma classe. Devolve (mascara, lista de Comp)."""
    m = (labels == classe_id).astype(np.uint8)
    n, comp, stats, cents = cv2.connectedComponentsWithStats(m, connectivity=8)
    out = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_px:
            continue
        out.append(
            Comp(
                classe_id=classe_id,
                idx=i,
                area_px=area,
                bbox=(
                    int(stats[i, cv2.CC_STAT_LEFT]),
                    int(stats[i, cv2.CC_STAT_TOP]),
                    int(stats[i, cv2.CC_STAT_WIDTH]),
                    int(stats[i, cv2.CC_STAT_HEIGHT]),
                ),
                centroid=(float(cents[i][0]), float(cents[i][1])),
            )
        )
    return comp, out


def ilhas_de_graca(labels: np.ndarray, campo_id: int, mm_px: float,
                   min_mm2: float = 4.0) -> list[dict]:
    """Componentes do campo que NÃO tocam a borda da face (cercados por tinta)."""
    m = (labels == campo_id).astype(np.uint8)
    n, comp, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    h, w = labels.shape
    borda = set(np.unique(comp[0, :])) | set(np.unique(comp[-1, :]))
    borda |= set(np.unique(comp[:, 0])) | set(np.unique(comp[:, -1]))
    ilhas = []
    for i in range(1, n):
        if i in borda:
            continue
        area_mm2 = stats[i, cv2.CC_STAT_AREA] * mm_px * mm_px
        if area_mm2 < min_mm2:
            continue
        ilhas.append({
            "bbox_mm": [
                round(stats[i, cv2.CC_STAT_LEFT] * mm_px),
                round(stats[i, cv2.CC_STAT_TOP] * mm_px),
                round(stats[i, cv2.CC_STAT_WIDTH] * mm_px),
                round(stats[i, cv2.CC_STAT_HEIGHT] * mm_px),
            ],
            "area_mm2": round(area_mm2, 1),
        })
    return ilhas
