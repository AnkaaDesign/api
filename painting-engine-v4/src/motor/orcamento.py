"""Orçamento: área paga tinta, fronteira paga hora — estrutural, não coeficiente.

Material sem preço = quantidade sinalizada, nunca zero (§7.3). Toda linha
carrega a fonte.
"""
from __future__ import annotations

from .util import p


def consolidar(analise: dict, plano: dict, params: dict) -> dict:
    materiais: dict[str, dict] = {}
    horas = 0.0
    for d in plano["dias"]:
        for passo in d["passos"]:
            for m in passo["materiais"]:
                key = (m["item"], m["unidade"])
                if key not in materiais:
                    materiais[key] = {"item": m["item"], "quantidade": 0.0,
                                      "unidade": m["unidade"], "fontes": set(),
                                      "preco_unitario": m.get("preco_unitario"),
                                      "total": 0.0 if m.get("preco_unitario") else None}
                materiais[key]["quantidade"] += m["quantidade"]
                materiais[key]["fontes"].add(m["fonte"])
                if m.get("total"):
                    materiais[key]["total"] = (materiais[key]["total"] or 0.0) + m["total"]
            if passo["tempo"] and passo["tempo"].get("horas"):
                horas += passo["tempo"]["horas"]

    hora_homem = p(params, "custo", "hora_homem")
    linhas = [
        {
            "item": v["item"],
            "quantidade": round(v["quantidade"], 2),
            "unidade": v["unidade"],
            "preco_unitario": v.get("preco_unitario"),
            "total": round(v["total"], 2) if v.get("total") else None,
            "status": None if v.get("preco_unitario")
                      else "SEM PREÇO — vincular ao catálogo do ERP",
            "fontes": sorted(v["fontes"]),
        }
        for v in materiais.values()
    ]
    return {
        "eixos": {
            "area_tinta_m2": analise["tinta_m2_total"],
            "demao_fundo_m2": analise["demao_fundo_m2"],
            "fronteira_compartilhada_m": analise["fronteira"]["total_tt_m"],
            "nota": "material escala com ÁREA; mão de obra escala com COMPRIMENTO e nº de ciclos",
        },
        "materiais": linhas,
        "mao_de_obra": {
            "horas": round(horas, 1),
            "custo_hora": hora_homem,
            "total": round(horas * hora_homem, 2) if hora_homem else None,
            "status": None if hora_homem else "SEM CUSTO-HORA configurado",
            "fonte_taxas": "chute — calibrar com o histórico do ERP",
        },
    }
