"""Utilidades compartilhadas pelos probes de visão.

As artes de `layout database/` têm mediana de 28 MP e máximo de 58 MP
(18085x3246). Nenhum VLM engole isso: o encoder do Qwen3-VL gera ~1 token a
cada 784 px, então uma arte crua daria ~36 mil tokens de visão — OOM garantido
num M2 de 8 GB. Todo probe passa por aqui antes de tocar num modelo.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # artes de 58 MP disparam o guard de decompression bomb

# Orçamentos calibrados no Mac mini M2/8 GB (ver README §Limites medidos).
GLOBAL_MAX_PX = 1568          # passe global (composição, espelhamento, corte na borda)
CROP_MAX_PX = 1024            # crop de elemento (OCR e detecção)
TOKENS_PER_PX = 1 / 784.0     # aproximação Qwen3-VL: patch 14, merge 2x2

# Teto de tokens do passe global. 1400 cabe com folga no contexto de 4096 do
# Ollama junto com o prompt e o raciocínio interno (que NÃO dá para desligar,
# ver backends.py). Na nuvem o contexto é grande e isso pode subir.
GLOBAL_MAX_TOKENS = 1400


def load(path: str | Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def fit(img: Image.Image, max_px: int) -> Image.Image:
    """Reduz mantendo proporção. Nunca amplia — ampliar não cria detalhe."""
    out = img.copy()
    out.thumbnail((max_px, max_px), Image.LANCZOS)
    return out


def fit_tokens(img: Image.Image, max_tokens: int = GLOBAL_MAX_TOKENS) -> Image.Image:
    """Reduz por ORÇAMENTO DE TOKENS, não pelo lado maior.

    Limitar o lado maior trata mal as traseiras: a 1568 px, uma lateral 7:1 dá
    1568x439 (~880 tokens) e uma traseira quase-quadrada dá 1568x1442 (~2883).
    A traseira estourava o contexto e o modelo devolvia resposta vazia, enquanto
    a lateral passava — mesmo código, resultado diferente pela proporção.

    Escalar pela área iguala o custo das duas formas.
    """
    w, h = img.size
    budget_px = max_tokens / TOKENS_PER_PX
    if w * h <= budget_px:
        return img.copy()
    scale = math.sqrt(budget_px / (w * h))
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def est_tokens(img: Image.Image) -> int:
    return int(img.size[0] * img.size[1] * TOKENS_PER_PX)


def tile(img: Image.Image, cols: int, rows: int, overlap: float = 0.08):
    """Fatia a arte em grade com sobreposição.

    Sobreposição existe porque texto de rodapé cai justamente na costura: sem
    ela, um telefone parte no meio e nenhum tile lê o número inteiro. Devolve
    (tile, offset_x, offset_y) para remapear as caixas ao original.
    """
    w, h = img.size
    tw, th = w / cols, h / rows
    ox, oy = tw * overlap, th * overlap
    for r in range(rows):
        for c in range(cols):
            left = max(0, int(c * tw - ox))
            top = max(0, int(r * th - oy))
            right = min(w, int((c + 1) * tw + ox))
            bottom = min(h, int((r + 1) * th + oy))
            yield img.crop((left, top, right, bottom)), left, top


def auto_grid(img: Image.Image, target_px: int = CROP_MAX_PX) -> tuple[int, int]:
    """Grade mínima para que cada tile caiba em `target_px` no lado maior.

    Uma lateral 7:1 vira ~8x1 tiles, não uma grade quadrada — fatiar a altura
    de uma faixa de 3000x400 não ajudaria ninguém.
    """
    w, h = img.size
    cols = max(1, math.ceil(w / target_px))
    rows = max(1, math.ceil(h / target_px))
    return cols, rows


def to_cm(bbox_px, px_per_cm: float | None):
    """Converte bbox em px para cm usando o px_per_cm do painting-engine."""
    if not px_per_cm:
        return None
    return [round(v / px_per_cm, 1) for v in bbox_px]
