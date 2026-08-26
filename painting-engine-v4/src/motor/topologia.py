"""Topologia: aninhado × adjacente × isolado — e os ciclos de adesivo.

- Aninhado dentro do CAMPO (ilha preservada): o adesivo original ainda está
  lá — depilação progressiva de dentro para fora, sem ciclo extra (100F).
- Aninhado dentro de OUTRA TINTA: o discriminante é a VIABILIDADE de cobrir o
  interno cortando à mão. Coberturável → depilação progressiva; não →
  ciclo caro: pintar → envernizar → curar → adesivo novo → pintar (137,
  estrelas de 2 mm) — com a rota R2 (sem verniz) como opção editável.
- Adjacência (mosaico) não tem dentro/fora: ordem por sessões (nº cromático).
"""
from __future__ import annotations

import cv2
import numpy as np

from .traco import dificuldade_corte_mao, espessura_perpendicular_mm, retilineidade


def container_de(mask_comp: np.ndarray, labels: np.ndarray) -> int:
    """Classe majoritária do anel externo de 1px do componente."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    anel = cv2.dilate(mask_comp.astype(np.uint8), kernel).astype(bool) & ~mask_comp
    if not anel.any():
        return -1
    vals, cnts = np.unique(labels[anel], return_counts=True)
    return int(vals[np.argmax(cnts)])


def container_efetivo_de_zonas(labels: np.ndarray, zona_ids: set, campo_id: int) -> dict:
    """Para cada zona: a classe majoritária ao redor DELA (para atravessar
    sombras suaves — quem está 'dentro' de uma sombra que abraça está, na
    prática, sobre o que a sombra pousa)."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    out = {}
    for z in zona_ids:
        m = (labels == z).astype(np.uint8)
        anel = cv2.dilate(m, kernel).astype(bool) & (labels != z)
        if not anel.any():
            out[z] = campo_id
            continue
        vals, cnts = np.unique(labels[anel], return_counts=True)
        # o vizinho majoritário que não seja outra zona
        ordem = np.argsort(cnts)[::-1]
        out[z] = campo_id
        for i in ordem:
            v = int(vals[i])
            if v not in zona_ids:
                out[z] = v
                break
    return out


def _transicoes_por_vizinho(sub: np.ndarray, labcrop: np.ndarray) -> dict[int, int]:
    """Transições h+v do componente contra cada classe vizinha (para
    descontar a borda ANINHADA da fronteira à mão — plotter corta, não faca)."""
    conta: dict[int, int] = {}
    for eixo in (0, 1):
        if eixo == 0:
            a, b = sub[:-1, :], sub[1:, :]
            la, lb = labcrop[:-1, :], labcrop[1:, :]
        else:
            a, b = sub[:, :-1], sub[:, 1:]
            la, lb = labcrop[:, :-1], labcrop[:, 1:]
        for m, viz in ((a & ~b, lb), (b & ~a, la)):
            if m.any():
                vals, cnts = np.unique(viz[m], return_counts=True)
                for v, c in zip(vals.tolist(), cnts.tolist()):
                    conta[int(v)] = conta.get(int(v), 0) + int(c)
    return conta


def analisar_aninhamento(labels: np.ndarray, campo_id: int, classes: list,
                         mm_px: float, params: dict, min_area_px: int = 64,
                         zona_container: dict | None = None,
                         familia_de: dict | None = None,
                         chapa_fids: set | None = None) -> list[dict]:
    """Para cada componente de tinta: quem o contém; ciclo se container é
    OUTRA tinta-família. Componente dentro da PRÓPRIA família (fatia de
    rampa, detalhe do mesmo elemento) não é ciclo — sem este filtro o polvo
    do mar e rio virava 205 'ciclos'."""
    achados = []
    zona_container = zona_container or {}
    familia_de = familia_de or {}
    chapa_fids = chapa_fids or set()
    zona_ids = set(zona_container.keys())
    h, w = labels.shape
    for cl in classes:
        if cl.id == campo_id:
            continue
        m = (labels == cl.id).astype(np.uint8)
        n, comp, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < min_area_px:
                continue
            x, y, cw, ch = (int(stats[i, cv2.CC_STAT_LEFT]), int(stats[i, cv2.CC_STAT_TOP]),
                            int(stats[i, cv2.CC_STAT_WIDTH]), int(stats[i, cv2.CC_STAT_HEIGHT]))
            # margem de 2px para o anel
            x0, y0 = max(0, x - 2), max(0, y - 2)
            x1, y1 = min(w, x + cw + 2), min(h, y + ch + 2)
            sub = comp[y0:y1, x0:x1] == i
            cont = container_de(sub, labels[y0:y1, x0:x1])
            # atravessa sombra/halo: quem está dentro de uma zona-casca pousa
            # sobre o que a zona pousa
            if cont in zona_container:
                cont = zona_container[cont]
            if cont == campo_id or cont < 0:
                continue
            # mesma família = fatia/detalhe do próprio elemento, não ciclo.
            # Container ZONA de OUTRA família fica: é o texto sobre o banner
            # em degradê do 2 amigos (ciclo com verniz). O miolo de
            # AEROGRAFIA é filtrado depois, por elemento (A2).
            if familia_de and familia_de.get(cl.id) is not None \
                    and familia_de.get(cl.id) == familia_de.get(cont):
                continue
            # componente da FAMÍLIA DO CAMPO aninhado noutra cor: pintar essa
            # área é a própria demão (o miolo azul da moldura do Aquarela) —
            # não é ciclo nem readesivo
            if familia_de and familia_de.get(cl.id) is not None \
                    and familia_de.get(cl.id) == familia_de.get(campo_id):
                continue
            # aninhado em tinta: avaliar cobertura à mão
            esp = espessura_perpendicular_mm(sub, mm_px)
            ret = retilineidade(sub, mm_px, params)
            dif = dificuldade_corte_mao(esp, ret["vertices_por_m"], params)
            achados.append({
                "classe": cl.id,
                "container": cont,
                "bbox_px": [x, y, cw, ch],
                "area_mm2": round(area * mm_px * mm_px, 0),
                "borda_px_por_vizinho": _transicoes_por_vizinho(
                    sub, labels[y0:y1, x0:x1]),
                "cobertura_a_mao": dif,
                "rota": (
                    "depilacao_progressiva" if dif["nivel"] == "viavel"
                    else "ciclo_verniz_readesivo"
                ),
                "rota_alternativa": (
                    None if dif["nivel"] == "viavel"
                    else "R2: pintar → secar → reaplicar adesivo (sem verniz) — editável"
                ),
            })
        del m, comp
    return achados


def grafo_contato(pares_tt: list[dict]) -> dict[int, set]:
    g: dict[int, set] = {}
    for par in pares_tt:
        a, b = par["par"]
        g.setdefault(a, set()).add(b)
        g.setdefault(b, set()).add(a)
    return g


def sessoes_por_coloracao(classes_pintaveis: list[int], g: dict[int, set]) -> list[list[int]]:
    """Coloração gulosa por grau decrescente — nº de sessões = nº cromático."""
    ordem = sorted(classes_pintaveis, key=lambda c: -len(g.get(c, ())))
    cor_de: dict[int, int] = {}
    for c in ordem:
        usadas = {cor_de[v] for v in g.get(c, ()) if v in cor_de}
        k = 0
        while k in usadas:
            k += 1
        cor_de[c] = k
    n_sessoes = max(cor_de.values(), default=-1) + 1
    sessoes = [[] for _ in range(n_sessoes)]
    for c, k in cor_de.items():
        sessoes[k].append(c)
    return sessoes
