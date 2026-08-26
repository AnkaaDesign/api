"""Paleta como PARTIÇÃO — cada pixel pertence a uma classe e só uma.

Dois caminhos de semeadura (armadilha §8.1 do brief: um parâmetro só erra nos
dois sentidos):

- VETORIAL_CHAPADO — as N cores exatas mais frequentes cobrem ≥98%: semear
  pelas CORES EXATAS com massa ≥0,05% (o histograma de 6 bits quebra em
  paleta de escada — ACM).
- CONTINUO — semear só por INTERIORES CHAPADOS (|∇Lab| < 1 ΔE/px), para a
  rampa não virar N tintas falsas (BURES) nem o mosaico virar 2 (137).

Fusão de sementes a ΔE<4 SEM cadeia transitiva: o candidato compara com a
ÂNCORA do grupo (6 azuis a ΔE 7,5–8,9 consecutivos têm extremos a ΔE 39,6).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .cor import delta_e, srgb_para_lab
from .util import hex_de, p


@dataclass
class Classe:
    id: int
    hex_ancora: str
    rgb_ancora: tuple
    lab: np.ndarray
    massa_px: int = 0
    tipo: str = "chapada"          # chapada | zona_continua
    membros_hex: list = field(default_factory=list)
    pureza: float = 1.0
    notas: list = field(default_factory=list)


@dataclass
class Particao:
    labels: np.ndarray             # (H,W) int16: >=0 classe; -1 resíduo
    classes: list                  # list[Classe]
    render: str                    # VETORIAL_CHAPADO | CONTINUO
    residuo_pct: float = 0.0
    divergencias: list = field(default_factory=list)


def _fundir_sementes(cores: np.ndarray, massas: np.ndarray, limiar: float) -> list[list[int]]:
    """Agrupa sementes por ΔE<limiar contra a ÂNCORA (sem cadeia).

    Devolve grupos de índices; o primeiro de cada grupo (maior massa) é âncora.
    """
    ordem = np.argsort(massas)[::-1]
    rgbs = np.stack([(cores >> 16) & 255, (cores >> 8) & 255, cores & 255], axis=-1)
    labs = srgb_para_lab(rgbs)
    grupos: list[list[int]] = []
    ancoras_lab: list[np.ndarray] = []
    for i in ordem:
        lab_i = labs[i]
        alvo = None
        if ancoras_lab:
            d = delta_e(np.stack(ancoras_lab), lab_i)
            j = int(np.argmin(d))
            if d[j] < limiar:
                alvo = j
        if alvo is None:
            grupos.append([int(i)])
            ancoras_lab.append(lab_i)
        else:
            grupos[alvo].append(int(i))
    return grupos


def _mascara_chapada(rgb: np.ndarray, grad_max: float) -> np.ndarray:
    """|∇Lab| < grad_max por pixel, em tiles (RAM)."""
    h, w = rgb.shape[:2]
    flat = np.zeros((h, w), dtype=bool)
    passo = max(1, int(4e6 // max(w, 1)))
    for y0 in range(0, h, passo):
        y1 = min(h, y0 + passo)
        a, b = max(0, y0 - 1), min(h, y1 + 1)
        lab = srgb_para_lab(rgb[a:b])
        gy, gx = np.gradient(lab[..., 0])
        for k in (1, 2):
            gyk, gxk = np.gradient(lab[..., k])
            gy += 0  # magnitude combinada abaixo
            gx += 0
            gyk2 = gyk * gyk
            gxk2 = gxk * gxk
            if k == 1:
                acc = gyk2 + gxk2
            else:
                acc += gyk2 + gxk2
        mag = np.sqrt(gy * gy + gx * gx + acc)
        flat[y0:y1] = (mag < grad_max)[y0 - a : y0 - a + (y1 - y0)]
        del lab, mag
    return flat


def particionar(rgb: np.ndarray, packed: np.ndarray, params: dict,
                mm_px: float = 0.85) -> Particao:
    h, w = packed.shape
    total = packed.size
    unicos, contas = np.unique(packed.ravel(), return_counts=True)
    ordem = np.argsort(contas)[::-1]

    massa_min = p(params, "paleta", "massa_minima_semente_pct") / 100.0 * total
    cobertura_alvo = p(params, "paleta", "cobertura_vetorial_pct") / 100.0
    max_sementes = p(params, "paleta", "max_sementes_vetorial")
    fusao = p(params, "paleta", "fusao_delta_e")
    atrib = p(params, "paleta", "atribuicao_delta_e")

    cum = np.cumsum(contas[ordem]) / total
    n_cobre = int(np.searchsorted(cum, cobertura_alvo) + 1)
    render = "VETORIAL_CHAPADO" if n_cobre <= max_sementes else "CONTINUO"

    if render == "VETORIAL_CHAPADO":
        sel = ordem[contas[ordem] >= max(1, massa_min)][:max_sementes]
    else:
        # semear só por interiores chapados
        flat = _mascara_chapada(rgb, p(params, "paleta", "gradiente_chapado_max"))
        vals = packed[flat]
        if vals.size == 0:
            vals = packed.ravel()[:: max(1, total // 4_000_000)]
        u2, c2 = np.unique(vals, return_counts=True)
        o2 = np.argsort(c2)[::-1]
        piso = p(params, "paleta", "massa_minima_semente_pct") / 100.0 * vals.size
        sel_cores = u2[o2[c2[o2] >= max(1, piso)]][:max_sementes]
        # mapeia para os índices em `unicos`
        sel = np.searchsorted(unicos, sel_cores)
        del flat, vals

    cores_sel = unicos[sel]
    massas_sel = contas[sel]
    grupos = _fundir_sementes(cores_sel, massas_sel, fusao)

    classes: list[Classe] = []
    for gid, grupo in enumerate(grupos):
        anc = int(cores_sel[grupo[0]])
        rgb_anc = ((anc >> 16) & 255, (anc >> 8) & 255, anc & 255)
        classes.append(
            Classe(
                id=gid,
                hex_ancora=hex_de(anc),
                rgb_ancora=rgb_anc,
                lab=srgb_para_lab(np.array(rgb_anc)),
                membros_hex=[hex_de(int(cores_sel[i])) for i in grupo],
            )
        )

    # LUT cor exata -> classe
    lut = np.full(unicos.size, -1, dtype=np.int16)
    for cl, grupo in zip(classes, grupos):
        idx = np.searchsorted(unicos, cores_sel[grupo])
        lut[idx] = cl.id

    # cores não-semente: atribui à classe mais próxima se ΔE ≤ atrib
    livres = np.flatnonzero(lut == -1)
    if livres.size:
        rgbs_l = np.stack(
            [(unicos[livres] >> 16) & 255, (unicos[livres] >> 8) & 255, unicos[livres] & 255],
            axis=-1,
        )
        labs_l = srgb_para_lab(rgbs_l)
        labs_c = np.stack([c.lab for c in classes])
        # em blocos para não estourar RAM
        for i0 in range(0, livres.size, 200_000):
            i1 = min(livres.size, i0 + 200_000)
            d = delta_e(labs_l[i0:i1, None, :], labs_c[None, :, :])
            jmin = np.argmin(d, axis=1)
            dmin = d[np.arange(i1 - i0), jmin]
            ok = dmin <= atrib
            lut[livres[i0:i1][ok]] = jmin[ok].astype(np.int16)

    # aplica LUT em blocos
    labels = np.empty(packed.shape, dtype=np.int16)
    flat_packed = packed.ravel()
    flat_labels = labels.ravel()
    for i0 in range(0, total, 8_000_000):
        i1 = min(total, i0 + 8_000_000)
        idx = np.searchsorted(unicos, flat_packed[i0:i1])
        flat_labels[i0:i1] = lut[idx]

    # massas e pureza
    ids, cnts = np.unique(labels, return_counts=True)
    massa = dict(zip(ids.tolist(), cnts.tolist()))
    conta_exata = dict(zip(unicos.tolist(), contas.tolist()))
    for cl in classes:
        cl.massa_px = massa.get(cl.id, 0)
        anc = int(cl.hex_ancora.lstrip("#"), 16)
        cl.pureza = conta_exata.get(anc, 0) / cl.massa_px if cl.massa_px else 0.0

    # núcleo: classe que some numa erosão de ~1,7mm é banda de antialias
    er = max(1, int(round(p(params, "paleta", "erosao_nucleo_mm") / mm_px)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * er + 1, 2 * er + 1))
    divergencias = []
    for cl in classes:
        if cl.massa_px == 0:
            continue
        m = (labels == cl.id).astype(np.uint8)
        nucleo = cv2.erode(m, kernel)
        if int(nucleo.sum()) == 0:
            labels[labels == cl.id] = -1
            divergencias.append({
                "tipo": "classe-sem-nucleo",
                "detalhe": f"{cl.hex_ancora} não sobrevive à erosão de {er}px — banda de antialias, dissolvida",
            })
            cl.massa_px = 0
        del m, nucleo

    residuo_pct = 100.0 * float(np.count_nonzero(labels == -1)) / total
    return Particao(
        labels=labels,
        classes=[c for c in classes if c.massa_px > 0],
        render=render,
        residuo_pct=residuo_pct,
        divergencias=divergencias,
    )
