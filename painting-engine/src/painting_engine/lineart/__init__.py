"""lineart — gera o "risco" (guia de marcação) vetorial a partir de uma arte raster.

Substitui o traçado manual feito no Affinity: entra uma foto/PDF da arte, sai um
SVG em escala real com camadas separadas (CONTORNO / SOMBRA / TEXTURA / GRADE),
curvas Bézier abertas prontas para receber pincel vetorial do Affinity.
"""

from .params import LineArtParams
from .pipeline import build_lineart

__all__ = ["LineArtParams", "build_lineart"]
