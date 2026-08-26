"""Resíduo da partição: zonas contínuas × bandas de antialias.

- Resíduo que SOBREVIVE à erosão de 2px = zona contínua de verdade (degradê /
  aerografia) — vira classe própria com tipo zona_continua.
- Resíduo fino = antialias: propagado ESPACIALMENTE a partir dos núcleos
  atribuídos (nunca por proximidade de cor — a mistura de A+B cai em cima de C).
- Fusão fina: classe pequena, de traço fino, a ΔE<6 de classe grande = a mesma
  tinta com o antialias comendo a letra (A&P #F0F0F0). Fica registrada como
  divergência editável.
"""
from __future__ import annotations

import cv2
import numpy as np

from .cor import delta_e
from .paleta import Classe, Particao
from .util import p


def _propagar_bandas(labels: np.ndarray) -> None:
    """Atribui pixels -1 ao rótulo do pixel atribuído mais próximo (in place)."""
    residuo = labels == -1
    if not residuo.any():
        return
    # distanceTransformWithLabels: rótulo do zero-pixel mais próximo
    src = residuo.astype(np.uint8)
    _, lbl = cv2.distanceTransformWithLabels(
        src, cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL
    )
    # lbl indexa componentes de zeros; mapeia índice→rótulo de classe
    zeros = ~residuo
    idx_zeros = lbl[zeros]
    val_zeros = labels[zeros]
    mapa = np.zeros(int(lbl.max()) + 1, dtype=np.int16)
    mapa[idx_zeros] = val_zeros
    labels[residuo] = mapa[lbl[residuo]]


def resolver_residuo(part: Particao, params: dict, mm_px: float = 0.85) -> None:
    """Separa zonas contínuas do antialias e propaga o antialias (in place)."""
    er = max(1, int(round(p(params, "paleta", "erosao_nucleo_mm") / mm_px)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * er + 1, 2 * er + 1))

    residuo = (part.labels == -1).astype(np.uint8)
    if residuo.any():
        nucleo = cv2.erode(residuo, kernel)
        if nucleo.any():
            # componentes do resíduo que têm núcleo = zonas contínuas
            n, comp = cv2.connectedComponents(residuo, connectivity=8)
            com_nucleo = np.unique(comp[nucleo.astype(bool)])
            com_nucleo = com_nucleo[com_nucleo != 0]
            if com_nucleo.size:
                # teto de sanidade: só componentes relevantes viram zona
                # (micro-manchas contínuas voltam ao antialias e se propagam);
                # os 400 maiores bastam para qualquer arte real
                areas = np.bincount(comp.ravel())
                com_nucleo = com_nucleo[areas[com_nucleo] >= 256]
                if com_nucleo.size > 400:
                    com_nucleo = com_nucleo[np.argsort(areas[com_nucleo])[::-1][:400]]
                zona_mask = np.isin(comp, com_nucleo) & (part.labels == -1)
                zid = max((c.id for c in part.classes), default=-1) + 1
                # cada componente de zona vira uma classe zona_continua
                for cid in com_nucleo.tolist():
                    m = (comp == cid) & zona_mask
                    npix = int(m.sum())
                    if npix == 0:
                        continue
                    part.labels[m] = zid
                    part.classes.append(
                        Classe(
                            id=zid,
                            hex_ancora="#zona",
                            rgb_ancora=(0, 0, 0),
                            lab=np.zeros(3, dtype=np.float32),
                            massa_px=npix,
                            tipo="zona_continua",
                        )
                    )
                    zid += 1
                del zona_mask
            del comp
        del nucleo
    del residuo

    _propagar_bandas(part.labels)

    # recontagem de massas após a propagação
    ids, cnts = np.unique(part.labels, return_counts=True)
    massa = dict(zip(ids.tolist(), cnts.tolist()))
    for cl in part.classes:
        cl.massa_px = massa.get(cl.id, 0)
    part.classes = [c for c in part.classes if c.massa_px > 0]
    part.residuo_pct = 0.0


def fusao_fina(part: Particao, mm_px: float, params: dict, campo_id: int = -1) -> None:
    """Classe pequena e fina a ΔE<6 de grande = mesma tinta (divergência).

    O campo fica FORA das duas listas: comparar uma letra clara com o campo
    escuro nunca faz sentido, e o campo dominava a lista de 'grandes'
    (o #F0F0F0 do A&P só funde no branco com o campo roxo excluído).
    """
    limiar = p(params, "paleta", "fusao_fina_delta_e")
    max_pct = p(params, "paleta", "fusao_fina_max_pct_tinta") / 100.0
    traco_max_px = p(params, "paleta", "fusao_fina_traco_max_mm") / mm_px

    chapadas = [c for c in part.classes if c.tipo == "chapada" and c.id != campo_id]
    if len(chapadas) < 2:
        return
    total_tinta = sum(c.massa_px for c in chapadas)
    grandes = [c for c in chapadas if c.massa_px > max_pct * total_tinta]
    pequenas = [c for c in chapadas if c.massa_px <= max_pct * total_tinta]
    for peq in pequenas:
        if not grandes:
            break
        labs = np.stack([g.lab for g in grandes])
        d = delta_e(labs, peq.lab)
        j = int(np.argmin(d))
        if d[j] >= limiar:
            continue
        # espessura mediana via transformada de distância
        m = (part.labels == peq.id).astype(np.uint8)
        dt = cv2.distanceTransform(m, cv2.DIST_L2, 3)
        esp = float(np.median(dt[m.astype(bool)])) * 2.0
        del dt
        if esp <= traco_max_px:
            alvo = grandes[j]
            part.labels[m.astype(bool)] = alvo.id
            alvo.massa_px += peq.massa_px
            alvo.membros_hex.extend(peq.membros_hex)
            peq.massa_px = 0
            part.divergencias.append({
                "tipo": "fusao-fina",
                "detalhe": (
                    f"{peq.hex_ancora} lido ΔE {d[j]:.1f} de {alvo.hex_ancora} em formas de "
                    f"{esp * mm_px:.1f} mm — a arte só declara cor onde a forma tem núcleo; "
                    f"tratado como a MESMA tinta (editável)"
                ),
            })
        del m
    part.classes = [c for c in part.classes if c.massa_px > 0]
