"""Utilidades comuns: parâmetros, empacotamento de cor, fontes de número."""
from __future__ import annotations

import json
import os
from typing import Any

import numpy as np

_PARAMS_CACHE: dict[str, Any] = {}


def raiz_pacote() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def carregar_params(caminho: str | None = None) -> dict:
    """Carrega params/oficina.json. Cada folha é {valor, fonte, nota?}."""
    caminho = caminho or os.path.join(raiz_pacote(), "params", "oficina.json")
    if caminho not in _PARAMS_CACHE:
        with open(caminho, encoding="utf-8") as fh:
            _PARAMS_CACHE[caminho] = json.load(fh)
    return _PARAMS_CACHE[caminho]


def p(params: dict, familia: str, nome: str):
    """Valor de um parâmetro."""
    return params[familia][nome]["valor"]


def fonte_p(params: dict, familia: str, nome: str) -> str:
    return params[familia][nome].get("fonte", "chute")


def empacotar(rgb: np.ndarray) -> np.ndarray:
    """(H,W,3) uint8 -> (H,W) uint32."""
    return (
        rgb[..., 0].astype(np.uint32) << 16
        | rgb[..., 1].astype(np.uint32) << 8
        | rgb[..., 2].astype(np.uint32)
    )


def desempacotar(c: int) -> tuple[int, int, int]:
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def hex_de(c: int) -> str:
    return f"#{c:06X}"


def de_hex(h: str) -> int:
    return int(h.lstrip("#"), 16)


class Numero(dict):
    """Um número com fonte e nota — nada aparece sem origem (brief §7.4)."""

    def __init__(self, valor, fonte: str, nota: str = ""):
        super().__init__(valor=valor, fonte=fonte)
        if nota:
            self["nota"] = nota
