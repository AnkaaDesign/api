#!/usr/bin/env python3
"""Panorama do acervo: uma linha por layout com os números que pagam a conta.

Uso: .venv/bin/python tools/panorama.py --saida DIR [--md arquivo]
"""
from __future__ import annotations

import argparse
import glob
import json
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True)
    ap.add_argument("--md", default=None)
    args = ap.parse_args()

    linhas = [
        "| layout | face | painel (mm) | campo | tinta m² | fundo m² | corte à mão m | esfumada m | tintas | ciclos caros | adesivos | zonas | perguntas | defeitos entre faces |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    tot = {"tinta": 0.0, "fronteira": 0.0, "perguntas": 0, "defeitos": 0}
    for j in sorted(glob.glob(os.path.join(args.saida, "*.json"))):
        d = json.load(open(j, encoding="utf-8"))
        comp = d.get("comparacao") or {}
        defeitos = len(comp.get("defeitos", [])) + sum(
            1 for f in d.get("faces", {}).values()
            for x in f["analise"].get("divergencias", [])
            if "defeito" in str(x).lower()
        )
        for face, dados in d.get("faces", {}).items():
            a = dados["analise"]
            ciclos = sum(1 for x in a["aninhamento"] if x["rota"] == "ciclo_verniz_readesivo")
            linhas.append(
                f"| {d['layout']} | {face} | {a['escala']['painel_mm']['w']}×{a['escala']['painel_mm']['h']} "
                f"| {a['campo']['classe']} {a['campo']['hex']} | {a['tinta_m2_total']} "
                f"| {a['demao_fundo_m2']} | {a['fronteira']['total_tt_m']} "
                f"| {a['fronteira'].get('esfumada_m', 0)} | {a['paleta']['n_tintas']} "
                f"| {ciclos} | {len(a['adesivos'])} | {len(a['zonas_continuas'])} "
                f"| {len(a['perguntas'])} | {defeitos if face == 'lateral' else ''} |"
            )
            tot["tinta"] += a["tinta_m2_total"]
            tot["fronteira"] += a["fronteira"]["total_tt_m"]
            tot["perguntas"] += len(a["perguntas"])
        tot["defeitos"] += defeitos
    linhas.append("")
    linhas.append(
        f"**Acervo: {tot['tinta']:.1f} m² de tinta · {tot['fronteira']:.0f} m de corte à mão · "
        f"{tot['perguntas']} perguntas · {tot['defeitos']} suspeitas de defeito entre faces**"
    )
    texto = "\n".join(linhas)
    print(texto)
    if args.md:
        open(args.md, "w", encoding="utf-8").write(texto)


if __name__ == "__main__":
    main()
