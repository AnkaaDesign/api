"""Escala: largura declarada > altura-datum; portão de sanidade; divergência.

O motor nunca afirma milímetro sem escala com fonte declarada. Sem medida no
nome, vale a altura-padrão de 2 450 mm (dono, confirmada por censo). O prior
de 0,85 mm/px serve só de alerta de "arte fora do padrão".
"""
from __future__ import annotations

from .util import p


def resolver(w_px: int, h_px: int, declarado_m: float | None, params: dict) -> dict:
    altura_mm = p(params, "escala", "altura_painel_mm")
    portao = p(params, "escala", "portao_altura_mm")
    prior = p(params, "escala", "prior_mm_px")
    alerta_pct = p(params, "escala", "alerta_divergencia_pct")

    divergencias: list[dict] = []
    mm_px_altura = altura_mm / h_px

    if declarado_m is not None:
        mm_px = declarado_m * 1000.0 / w_px
        fonte = "declarada"
        altura_implicada = h_px * mm_px
        if not (portao[0] <= altura_implicada <= portao[1]):
            # a medida no nome vale para a LATERAL; numa traseira quadrada ela
            # implica altura absurda — cai para a altura-datum e acusa
            divergencias.append({
                "tipo": "escala-declarada-rejeitada",
                "detalhe": (
                    f"largura declarada {declarado_m} m implica altura "
                    f"{altura_implicada:.0f} mm, fora de {portao[0]}–{portao[1]} mm — "
                    "medida ignorada nesta face (provável medida da lateral no nome); "
                    "usando altura-padrão 2 450 mm"
                ),
            })
            mm_px = mm_px_altura
            fonte = "altura-datum (declarada rejeitada)"
        desvio = abs(declarado_m * 1000.0 / w_px - mm_px_altura) / mm_px_altura * 100.0
        if desvio > alerta_pct:
            divergencias.append({
                "tipo": "escala-metodos-discordam",
                "detalhe": (
                    f"declarada {mm_px:.4f} mm/px × altura-datum {mm_px_altura:.4f} "
                    f"mm/px divergem {desvio:.1f}% — medir no pátio"
                ),
            })
    else:
        mm_px = mm_px_altura
        fonte = "altura-datum"

    desvio_prior = abs(mm_px - prior) / prior * 100.0
    alerta_prior = None
    if desvio_prior > 25.0:
        alerta_prior = (
            f"escala {mm_px:.3f} mm/px foge do prior 0,85 (desvio {desvio_prior:.0f}%) "
            "— arte fora do padrão de render, conferir"
        )

    return {
        "mm_px": mm_px,
        "fonte": fonte,
        "painel_mm": {"w": round(w_px * mm_px), "h": round(h_px * mm_px)},
        "alerta_prior": alerta_prior,
        "divergencias": divergencias,
        "metrico": declarado_m is not None or True,  # altura-datum é métrica com fonte "dono"
    }
