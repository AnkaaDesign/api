"""Sonda: por que um elemento largo (≥5 m) não virou FITA?

Roda a análise até resolver_tecnicas e imprime, para cada elemento
ORNAMENTO/LOGOMARCA com w ≥ 5 m, a espessura perpendicular e o número de
componentes — os dois portões da regra do filete.

Uso: PYTHONPATH=src .venv/bin/python tools/sonda_filete.py "BALALAC 2024 lateral.png"
"""
import sys

import cv2
import numpy as np

from motor import antialias, campo, elementos, escala, familias, io_arte, paleta
from motor.analise import _reclassificar_rampas
from motor.traco import espessura_perpendicular_mm
from motor.util import carregar_params, p


def main(caminho: str) -> None:
    params = carregar_params()
    arte = io_arte.carregar(caminho, p(params, "moldura", "max_px"))
    h, w = arte.packed.shape
    esc = escala.resolver(w, h, arte.declarado_m, params)
    mm_px = esc["mm_px"]
    part = paleta.particionar(arte.rgb, arte.packed, params, mm_px=mm_px)
    del arte.packed
    antialias.resolver_residuo(part, params, mm_px=mm_px)
    _reclassificar_rampas(part, [])
    degraus_c = familias.degraus_por_par(part.labels, arte.rgb, None, min_amostras=12)
    campo_info = campo.decidir(part, params, degraus=degraus_c)
    campo_id = campo_info["classe_id"]
    antialias.fusao_fina(part, mm_px, params, campo_id=campo_id)
    mapa, els = elementos.agrupar(part.labels, campo_id, mm_px, params)
    els = elementos.separar_espalhados(mapa, els, part.labels, campo_id, params)
    els = elementos.destacar_faixas(mapa, els, part.labels, campo_id, mm_px, params)
    els = elementos.fundir_linhas(els, mm_px)
    classes_por_id = {c.id: c for c in part.classes}
    elementos.classificar(els, part.labels, mapa, classes_por_id, w, mm_px, params,
                          campo_id=campo_id)
    for el in els:
        x, y, ww, hh = el.bbox
        if ww * mm_px < 5000 or el.tipo not in ("ORNAMENTO", "LOGOMARCA", "FAIXA_ORGANICA"):
            continue
        sub = np.isin(mapa[y:y + hh, x:x + ww], list(el.membros)).astype(bool)
        esp = espessura_perpendicular_mm(sub, mm_px)
        n_comp = cv2.connectedComponents(sub.astype(np.uint8))[0] - 1
        preench = float(sub.mean())
        print(f"el {el.id} {el.tipo:14s} w={ww*mm_px/1000:.1f}m h={hh*mm_px/1000:.2f}m "
              f"esp={esp:.0f}mm n_comp={n_comp} preench={preench:.2f} tecnica={el.tecnica}")


if __name__ == "__main__":
    main(sys.argv[1])
