"""Campo do desenho: a decisão mais cara do layout.

Campo NEUTRO no grupo L* 91–100 = CHAPA (sem demão geral). Abaixo do vazio
do acervo (não há campo entre L* 70 e 91) = TINTA: demão de fundo no painel
inteiro, primeiro, venha a carreta da cor que vier. Campo com croma (roxo,
azul, vermelho...) = TINTA em qualquer L*.

O que sai DE GRAÇA é o que tem a cor do CAMPO DO DESENHO — não a da chapa.
"""
from __future__ import annotations

import numpy as np

from .cor import croma, delta_e
from .util import p


def decidir(part, params: dict, degraus: dict | None = None) -> dict:
    """Elege o campo (classe dominante) e o classifica CHAPA × TINTA.

    A dominância é por AGREGADO de rampa, não por classe isolada: um campo
    em degradê/vinheta (o verde do ATACADÃO FOLLY) chega fatiado em várias
    classes e cada fatia perde para a chapa — agregando as fatias ligadas
    por transição SUAVE (degrau ~0, ΔE ≤ 20) o campo verdadeiro vence.
    """
    chapadas = [c for c in part.classes if c.tipo == "chapada"]
    dominante = max(chapadas, key=lambda c: c.massa_px)
    if degraus:
        lab_de = {c.id: c.lab for c in part.classes}
        massa = {c.id: c.massa_px for c in part.classes}
        pai = {c.id: c.id for c in part.classes}

        def achar(x):
            while pai[x] != x:
                pai[x] = pai[pai[x]]
                x = pai[x]
            return x

        for (a, b), degrau in degraus.items():
            if a not in pai or b not in pai:
                continue
            if degrau < 2.5 and float(delta_e(lab_de[a], lab_de[b])) <= 20.0:
                ra, rb = achar(a), achar(b)
                if ra != rb:
                    pai[ra] = rb
        massa_grupo: dict[int, int] = {}
        for cid in pai:
            r = achar(cid)
            massa_grupo[r] = massa_grupo.get(r, 0) + massa.get(cid, 0)
        raiz_venc = max(massa_grupo, key=massa_grupo.get)
        cand = [c for c in chapadas if achar(c.id) == raiz_venc]
        if cand:
            dominante = max(cand, key=lambda c: c.massa_px)
    L = float(dominante.lab[0])
    C = float(croma(dominante.lab))
    neutro = C <= p(params, "campo", "chapa_croma_max")
    chapa = neutro and L >= p(params, "campo", "chapa_L_min")
    total = int(part.labels.size)
    return {
        "classe_id": dominante.id,
        "hex": dominante.hex_ancora,
        "L": round(L, 1),
        "croma": round(C, 1),
        "classe": "CHAPA" if chapa else "TINTA",
        "pct_painel": round(100.0 * dominante.massa_px / total, 1),
        "justificativa": (
            f"campo {dominante.hex_ancora} (L* {L:.0f}, croma {C:.0f}) "
            + (
                "está no grupo da chapa branca (L* 91–100 do acervo) — sem demão geral"
                if chapa
                else "está abaixo do vazio L* 70–91 do acervo ou tem croma — é TINTA: "
                     "demão de fundo no painel inteiro, primeiro"
            )
        ),
    }
