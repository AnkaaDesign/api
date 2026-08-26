#!/usr/bin/env python3
"""Auditoria analítica da rodada — um bloco compacto por face + FLAGS.

Uso: .venv/bin/python tools/auditoria.py --saida saida [--md saida/auditoria.md]

Não é regressão (isso é o comparar.py): é o instrumento de LEITURA da rodada
de validação manual — os números que decidem o custo, as decisões de técnica
e uma lista de flags heurísticos do que merece olho humano nesta rodada.
"""
from __future__ import annotations

import argparse
import glob
import json
import os


def flags_da_face(slug: str, face: str, an: dict, pl: dict) -> list[str]:
    out = []
    fron = an["fronteira"]
    if fron["total_tt_m"] > 40:
        out.append(f"corte à mão altíssimo ({fron['total_tt_m']} m) — conferir se é mosaico real")
    if (fron.get("aninhada_m") or 0) > 15:
        out.append(f"desconto aninhado grande ({fron['aninhada_m']} m) — conferir rotas")
    for e in an["elementos"]:
        f = e.get("fita")
        if f and e.get("tecnica") == "FITA":
            # MISTA num STENCIL é o comportamento ditado (R2-8); numa FAIXA é indecisão
            pl_, pc = f["por_substrato"]["lisa"], f["por_substrato"]["corrugada"]
            if pl_["tecnica"] == "FITA_MISTA" and pc["tecnica"] == "FITA_MISTA":
                out.append(f"fita MISTA nos dois substratos (el {e['id']}, {f['tracado_m']} m) — indecisão")
        if (e.get("tecnica") == "ADESIVO" and an["pintura_geral"]
                and e["dim_mm"]["w"] >= 8000):
            out.append(f"ADESIVO de {e['dim_mm']['w']/1000:.1f} m sobre pintura geral (el {e['id']}) — stencil?")
    for z in an["zonas_continuas"]:
        if z["tipo"] == "AEROGRAFIA" and z["area_m2"] > 5:
            out.append(f"aerografia de {z['area_m2']} m² — conferir se não é campo/vinheta")
    mos_els = {e["id"] for e in an["elementos"] if e["tipo"] == "MOSAICO"}
    for ad in an["adesivos"]:
        if set(ad["elementos"]) & mos_els:
            continue   # mosaico nunca divide folha (depilação progressiva)
        if (not ad.get("folhas") and ad.get("aproveitamento_pct", 100) < 18
                and ad["envelope_mm"]["h"] > 700 and ad["vinil_m2"] > 1.5):
            out.append(f"adesivo {ad['id']} com {ad['aproveitamento_pct']:.0f}% de aproveitamento sem divisão de folha")
    nd = (pl.get("resumo") or {}).get("n_dias")
    if nd and nd > 4:
        out.append(f"{nd} dias — acima do retrato do acervo (1–3)")
    return out


def bloco(slug: str, face: str, dados: dict) -> tuple[list[str], list[str]]:
    an = dados["analise"]
    pl = dados.get("plano") or {}
    fron = an["fronteira"]
    linhas = []
    r = pl.get("resumo") or {}
    linhas.append(
        f"- **{face}** · campo {an['campo']['hex']} {an['campo']['classe']}"
        f" · {an['paleta']['n_tintas']} tintas · tinta {an['tinta_m2_total']} m²"
        f" · corte {fron['total_tt_m']} m (esfum {fron.get('esfumada_m', 0)}"
        f" · aninh {fron.get('aninhada_m', 0)} · aero {fron.get('borda_aerografia_m', 0)})"
        f" · {r.get('n_dias', '?')} dias/{r.get('n_passos', '?')} passos")
    ads = an["adesivos"]
    if ads:
        vin = sum(a["vinil_m2"] for a in ads)
        eco = sum(a.get("economia_folha_m2") or 0 for a in ads)
        det = "; ".join(
            f"{a['id']} {a['envelope_mm']['w']}×{a['envelope_mm']['h']}"
            + (f" [{len(a['folhas'])}f −{a['economia_folha_m2']}m²]" if a.get("folhas") else "")
            + f" {a.get('aproveitamento_pct', 0):.0f}%"
            for a in ads)
        linhas.append(f"  - adesivos ({len(ads)}, {vin:.1f} m²"
                      + (f", economia {eco:.2f} m²" if eco else "") + f"): {det}")
    tecs = {}
    for e in an["elementos"]:
        t = e.get("tecnica", "ADESIVO")
        if t != "ADESIVO":
            tecs.setdefault(t, []).append(e)
    for t, els in tecs.items():
        det = []
        for e in els:
            f = e.get("fita")
            if f:
                det.append(f"el{e['id']} {f['tracado_m']}m"
                           f" lisa={f['por_substrato']['lisa']['tecnica'].replace('FITA_', '')}"
                           f"/corr={f['por_substrato']['corrugada']['tecnica'].replace('FITA_', '')}")
            else:
                det.append(f"el{e['id']} {e['area_m2']}m²")
        linhas.append(f"  - {t}: {', '.join(det)}")
    zonas = [z for z in an["zonas_continuas"] if z["area_m2"] >= 0.05]
    if zonas:
        det = "; ".join(
            f"{z['tipo'][:4]} {z['area_m2']}m²"
            + (f" {z.get('de_hex')}→{z.get('para_hex')} @{z.get('direcao_graus')}°"
               if z["tipo"] == "DEGRADE" else "")
            for z in zonas[:8])
        linhas.append(f"  - zonas: {det}")
    fl = flags_da_face(slug, face, an, pl)
    return linhas, fl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", default="saida")
    ap.add_argument("--md", default=None)
    args = ap.parse_args()
    corpo = ["# Auditoria da rodada — leitura por face", ""]
    todas_flags = []
    for j in sorted(glob.glob(os.path.join(args.saida, "*.json"))):
        d = json.load(open(j, encoding="utf-8"))
        if "faces" not in d:
            continue
        slug = os.path.splitext(os.path.basename(j))[0]
        corpo.append(f"## {d.get('layout', slug)}")
        for face, dados in d["faces"].items():
            linhas, fl = bloco(slug, face, dados)
            corpo.extend(linhas)
            for f in fl:
                todas_flags.append(f"- `{slug}/{face}`: {f}")
        corpo.append("")
    cab = ["# FLAGS da rodada — o que merece olho humano", ""]
    cab.extend(todas_flags or ["- (nenhum flag heurístico)"])
    cab.append("")
    texto = "\n".join(cab + corpo)
    print(f"{len(todas_flags)} flags")
    if args.md:
        open(args.md, "w", encoding="utf-8").write(texto)
        print("gravado em", args.md)
    else:
        print(texto)


if __name__ == "__main__":
    main()
