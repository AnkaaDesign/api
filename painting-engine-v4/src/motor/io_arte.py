"""Carga da arte: leitura, remoção de moldura, parse do nome do arquivo.

Armadilha carregada: cortar por "linha uniforme" come colunas de campo e
destrói a escala (100F perdeu 4 308 colunas). Só se tira MOLDURA: anel fino
na borda cuja cor difere da dominante do interior.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from .util import empacotar

Image.MAX_IMAGE_PIXELS = None


@dataclass
class Arte:
    caminho: str
    nome: str
    rgb: np.ndarray            # (H,W,3) uint8, já sem moldura
    packed: np.ndarray         # (H,W) uint32
    moldura_px: dict = field(default_factory=dict)  # {topo,base,esq,dir}
    declarado_m: float | None = None


def medida_declarada(nome: str) -> float | None:
    """Metros no nome do arquivo: '15,00', '8,30m', '8.40', '-1470', '640'."""
    base = os.path.splitext(os.path.basename(nome))[0]
    for m in re.finditer(r"(\d{1,2})[.,](\d{2})\s*m?\b", base):
        v = float(f"{m.group(1)}.{m.group(2)}")
        if 4.0 <= v <= 20.0:
            return v
    for m in re.finditer(r"[-\s](\d{3,4})\b", base):
        v = int(m.group(1))
        if 400 <= v <= 2000:
            return v / 100.0
    for m in re.finditer(r"\s(\d{1,2})\b", base):
        v = int(m.group(1))
        if 5 <= v <= 18:
            return float(v)
    return None


def _dominante(packed: np.ndarray) -> int:
    cores, contas = np.unique(packed.ravel(), return_counts=True)
    return int(cores[np.argmax(contas)])


def _anel_uniforme(linha: np.ndarray, dominante: int, tol_pct: float = 85.0) -> int | None:
    """Se a linha/coluna é ≥tol% de UMA cor ≠ dominante, devolve essa cor."""
    cores, contas = np.unique(linha, return_counts=True)
    i = int(np.argmax(contas))
    pct = 100.0 * contas[i] / linha.size
    c = int(cores[i])
    if pct >= tol_pct and c != dominante:
        return c
    return None


def _fracao_dominante(linha: np.ndarray, dominante: int) -> float:
    return float(np.count_nonzero(linha == dominante)) / linha.size


def remover_moldura(rgb: np.ndarray, max_px: int = 24) -> tuple[np.ndarray, dict]:
    """Remove só o anel de moldura (cor ≠ dominante), até max_px por lado.

    Dois passes por lado: (1) anéis UNIFORMES de cor ≠ dominante (a moldura);
    (2) depois de tirar moldura, até 4 anéis MISTOS (antialias da moldura —
    no ACM a linha suja restante virou um aro de 'tinta' no perímetro inteiro
    e fundia a face num elemento só).
    """
    packed = empacotar(rgb)
    h, w = packed.shape
    miolo = packed[max_px:h - max_px:4, max_px:w - max_px:4]
    cores, contas = np.unique(miolo.ravel(), return_counts=True)
    dominante = int(cores[np.argmax(contas)])

    lados = {"topo": 0, "base": 0, "esq": 0, "dir": 0}
    topo, base, esq, dire = 0, h, 0, w

    def _tirar(lado: str, pega_linha):
        nonlocal topo, base, esq, dire
        tirou_uniforme = 0
        for _ in range(max_px):
            if _anel_uniforme(pega_linha(), dominante) is not None:
                _avanca(lado)
                tirou_uniforme += 1
                continue
            break
        if tirou_uniforme:
            for _ in range(4):  # antialias da moldura
                if _fracao_dominante(pega_linha(), dominante) < 0.5:
                    _avanca(lado)
                    continue
                break
        lados[lado] += 0  # contagem feita em _avanca

    def _avanca(lado: str):
        nonlocal topo, base, esq, dire
        if lado == "topo":
            topo += 1
        elif lado == "base":
            base -= 1
        elif lado == "esq":
            esq += 1
        else:
            dire -= 1
        lados[lado] += 1

    _tirar("topo", lambda: packed[topo, esq:dire])
    _tirar("base", lambda: packed[base - 1, esq:dire])
    _tirar("esq", lambda: packed[topo:base, esq])
    _tirar("dir", lambda: packed[topo:base, dire - 1])
    if any(lados.values()):
        rgb = rgb[topo:base, esq:dire]
    return rgb, lados


def carregar(caminho: str, max_moldura_px: int = 24) -> Arte:
    im = Image.open(caminho).convert("RGB")
    rgb = np.asarray(im, dtype=np.uint8)
    im.close()
    rgb, moldura = remover_moldura(rgb, max_moldura_px)
    return Arte(
        caminho=caminho,
        nome=os.path.basename(caminho),
        rgb=rgb,
        packed=empacotar(rgb),
        moldura_px=moldura,
        declarado_m=medida_declarada(caminho),
    )
