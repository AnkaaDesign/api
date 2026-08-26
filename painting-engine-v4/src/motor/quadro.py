"""Geometria vetorial para o QUADRO (brief §5.2).

O quadro desenha o ESTADO REAL da peça em cada passo — a partir dos contornos
extraídos, nunca filtro sobre a imagem. Este módulo exporta, em milímetros:

- por classe: polígonos do contorno (com furos), simplificados;
- por par de fronteira real: polilinhas do trecho compartilhado;
- as ilhas de graça como polígonos.

A simplificação é deliberada (§4.4): o quadro precisa LER, não reproduzir
pixel a pixel — eps ~2 px segura o JSON em poucos MB por face.
"""
from __future__ import annotations

import cv2
import numpy as np


def _poligonos_da_classe(mask: np.ndarray, mm_px: float, eps_px: float = 2.0,
                         min_area_px: int = 30, max_pontos: int = 20000) -> list:
    """Contornos RETR_CCOMP (externo + furos) simplificados, em mm."""
    contornos, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP,
                                       cv2.CHAIN_APPROX_SIMPLE)
    if hier is None:
        return []
    out = []
    total_pts = 0
    for i, c in enumerate(contornos):
        if cv2.contourArea(c) < min_area_px:
            continue
        aprox = cv2.approxPolyDP(c, eps_px, True)
        if len(aprox) < 3:
            continue
        pts = (aprox.reshape(-1, 2) * mm_px).round(1)
        total_pts += len(pts)
        if total_pts > max_pontos:
            break
        furo = int(hier[0][i][3]) >= 0
        out.append({"furo": furo, "pontos": pts.tolist()})
    return out


def _polilinhas_do_par(labels: np.ndarray, a: int, b: int, mm_px: float,
                       eps_px: float = 3.0, max_pontos: int = 4000) -> list:
    """Trecho onde a classe `a` encosta na `b`, como polilinhas em mm."""
    ma = (labels == a).astype(np.uint8)
    mb = (labels == b).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    contato = cv2.dilate(mb, kernel) & ma
    del ma, mb
    if not contato.any():
        return []
    contornos, _ = cv2.findContours(contato, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    total = 0
    for c in sorted(contornos, key=cv2.contourArea, reverse=True):
        aprox = cv2.approxPolyDP(c, eps_px, False)
        if len(aprox) < 2:
            continue
        pts = (aprox.reshape(-1, 2) * mm_px).round(1)
        total += len(pts)
        if total > max_pontos:
            break
        out.append(pts.tolist())
    return out


def montar(part, campo_id: int, fron: dict, mm_px: float,
           max_classes: int = 40) -> dict:
    """Geometria completa do quadro para uma face."""
    h, w = part.labels.shape
    classes_geo = []
    ordenadas = sorted(part.classes, key=lambda c: -c.massa_px)[:max_classes]
    for cl in ordenadas:
        m = part.labels == cl.id
        poligonos = _poligonos_da_classe(m, mm_px)
        del m
        if not poligonos:
            continue
        classes_geo.append({
            "classe": cl.id,
            "hex": cl.hex_ancora,
            "tipo": cl.tipo,
            "campo": cl.id == campo_id,
            "poligonos": poligonos,
        })

    fronteiras_geo = []
    for pr in fron.get("pares", [])[:60]:
        a, b = pr["par"]
        linhas = _polilinhas_do_par(part.labels, a, b, mm_px)
        if linhas:
            fronteiras_geo.append({
                "par": [a, b], "m": pr["m"],
                "familias": pr.get("familias"),
                "polilinhas": linhas,
            })

    return {
        "painel_mm": {"w": round(w * mm_px), "h": round(h * mm_px)},
        "classes": classes_geo,
        "fronteiras": fronteiras_geo,
    }
