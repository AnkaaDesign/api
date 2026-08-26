"""Perfil de traço — risco de depilação/aplicação, NUNCA "não corta" (G0).

- Fração da forma abaixo de X mm por ABERTURA morfológica (o mínimo de
  varredura pega antialias em tangente de curva — 137 saiu "0,8 mm").
- Espessura de faixa pela corrida PERPENDICULAR (transformada de distância na
  crista), nunca por varredura (a onda do AAN media 12/17 e tem 80 mm).
- Retilineidade: vértices/m após simplificar a 5 mm (triângulo ≈1/m;
  filigrana dezenas) — com a espessura, decide a dificuldade do corte À MÃO.
"""
from __future__ import annotations

import cv2
import numpy as np

from .util import p


def _kernel(r: int):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def perfil_abertura(mask: np.ndarray, mm_px: float, params: dict) -> dict:
    """Fração da área removida por abertura de diâmetro X mm, para o grid."""
    grade = p(params, "traco", "grade_mm")
    area = int(mask.sum())
    out = {}
    if area == 0:
        return out
    m8 = mask.astype(np.uint8)
    for mm in grade:
        r = max(1, int(round(mm / 2.0 / mm_px)))
        aberto = cv2.morphologyEx(m8, cv2.MORPH_OPEN, _kernel(r))
        removido = area - int(aberto.sum())
        out[f"abaixo_{mm}mm_pct"] = round(100.0 * removido / area, 1)
    return out


def espessura_perpendicular_mm(mask: np.ndarray, mm_px: float) -> float:
    """2× a mediana da TD na crista (máximos locais) — corrida perpendicular."""
    m8 = mask.astype(np.uint8)
    dt = cv2.distanceTransform(m8, cv2.DIST_L2, 3)
    crista = (cv2.dilate(dt, _kernel(1)) <= dt) & mask.astype(bool) & (dt > 0.5)
    if not crista.any():
        return 0.0
    return float(np.median(dt[crista])) * 2.0 * mm_px


def retilineidade(mask: np.ndarray, mm_px: float, params: dict) -> dict:
    """Vértices por metro de contorno (simplificado a 5 mm) + compacidade."""
    eps_px = p(params, "traco", "simplificacao_vertices_mm") / mm_px
    m8 = mask.astype(np.uint8)
    contornos, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    per_m = 0.0
    vertices = 0
    for c in contornos:
        per_m += cv2.arcLength(c, True) * mm_px / 1000.0
        aprox = cv2.approxPolyDP(c, eps_px, True)
        vertices += len(aprox)
    area_mm2 = float(mask.sum()) * mm_px * mm_px
    compacidade = (per_m * 1000.0) ** 2 / (4.0 * np.pi * area_mm2) if area_mm2 else 0.0
    return {
        "perimetro_m": round(per_m, 2),
        "vertices_por_m": round(vertices / per_m, 1) if per_m else 0.0,
        "compacidade": round(compacidade, 1),
    }


def dificuldade_corte_mao(espessura_mm: float, vertices_por_m: float, params: dict) -> dict:
    """Espessura × retilineidade — nenhuma decide sozinha (C6: reto fino corta)."""
    piso = p(params, "corte_mao", "traco_viavel_min_mm")
    vmax = p(params, "corte_mao", "vertices_m_max")
    if vertices_por_m <= vmax and espessura_mm >= piso:
        nivel = "viavel"
    elif vertices_por_m <= 3.0:
        nivel = "viavel"     # forma reta corta mesmo fina (triângulos do ACM, 9,2 mm)
    elif espessura_mm < piso and vertices_por_m > vmax:
        nivel = "inviavel"   # fino E rendilhado — rota de reaplicação/verniz
    else:
        nivel = "incerto"    # C5: sem evidência abaixo de 14 mm — não afirmar
    return {
        "nivel": nivel,
        "espessura_mm": round(espessura_mm, 1),
        "vertices_por_m": round(vertices_por_m, 1),
        "nota": "piso real de corte à mão não calibrado (P2) — 'incerto' é honesto",
    }
