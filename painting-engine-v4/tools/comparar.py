#!/usr/bin/env python3
"""Compara as fixtures (esperado) com a saída do motor (obtido).

Uso: .venv/bin/python tools/comparar.py --saida DIR [--fixtures DIR]

Cada asserção sai como PASS/FAIL/INFO numa tabela por layout — é o corpus de
regressão do §8.5 do brief: nenhuma correção entra se quebrar caso verde.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import numpy as np
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))
from motor.cor import delta_e, srgb_para_lab  # noqa: E402


def _lab(hexstr):
    h = hexstr.lstrip("#")
    return srgb_para_lab(np.array([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]))


def _num(x):
    if isinstance(x, dict):
        return x.get("valor")
    return x


def _tol(x, padrao_pct=15):
    if isinstance(x, dict):
        if "tol_abs" in x:
            return ("abs", x["tol_abs"])
        return ("pct", x.get("tol_pct", padrao_pct))
    return ("pct", padrao_pct)


def checar(nome, esperado, obtido, linhas):
    """Compara um valor com tolerância."""
    val = _num(esperado)
    if val is None or obtido is None:
        return
    modo, tol = _tol(esperado)
    if isinstance(val, bool):
        ok = val == bool(obtido)
        det = f"esp {val} × obt {obtido}"
    elif modo == "abs":
        ok = abs(obtido - val) <= tol
        det = f"esp {val}±{tol} × obt {obtido}"
    else:
        if isinstance(esperado, dict) and "tol" in esperado:
            ok = abs(obtido - val) <= esperado["tol"]
            det = f"esp {val}±{esperado['tol']} × obt {obtido}"
        else:
            ok = abs(obtido - val) <= abs(val) * tol / 100.0 + 1e-9
            det = f"esp {val}±{tol}% × obt {obtido}"
    linhas.append(("PASS" if ok else "FAIL", nome, det))


def checar_face(fx: dict, an: dict, comp: dict | None, linhas: list,
                fonte: str = "ficha"):
    # hex de fixture 'assistente' é estimado de preview — limiar frouxo
    tol_tinta = 20.0 if fonte == "assistente" else 5.0
    campo_fx = fx.get("campo", {})
    if campo_fx.get("classe"):
        ok = campo_fx["classe"] == an["campo"]["classe"]
        linhas.append(("PASS" if ok else "FAIL", "campo.classe",
                       f"esp {campo_fx['classe']} × obt {an['campo']['classe']} ({an['campo']['hex']})"))
    if "pintura_geral" in fx:
        checar("pintura_geral", fx["pintura_geral"], an["pintura_geral"], linhas)
    if "escala_mm_px" in fx:
        checar("escala_mm_px", fx["escala_mm_px"], an["escala"]["mm_px"], linhas)
    if "painel_mm" in fx:
        esp = fx["painel_mm"]
        checar("painel.w", {"valor": esp["w"], "tol_pct": esp.get("tol_pct", 3)},
               an["escala"]["painel_mm"]["w"], linhas)
        checar("painel.h", {"valor": esp["h"], "tol_pct": esp.get("tol_pct", 3)},
               an["escala"]["painel_mm"]["h"], linhas)
    if "render" in fx:
        ok = fx["render"] == an["render"]
        linhas.append(("PASS" if ok else "FAIL", "render", f"esp {fx['render']} × obt {an['render']}"))
    if "n_tintas" in fx:
        checar("n_tintas", fx["n_tintas"], an["paleta"]["n_tintas"], linhas)
    if "demao_fundo_m2" in fx:
        checar("demao_fundo_m2", fx["demao_fundo_m2"], an["demao_fundo_m2"], linhas)
    if "tinta_m2_total" in fx:
        checar("tinta_m2_total", fx["tinta_m2_total"], an["tinta_m2_total"], linhas)
    if "fronteira_tt_m" in fx:
        checar("fronteira_tt_m", fx["fronteira_tt_m"], an["fronteira"]["total_tt_m"], linhas)
    if "ilhas_de_graca_n" in fx:
        esp = fx["ilhas_de_graca_n"]
        if isinstance(esp, dict) and "min" in esp:
            obt = an["ilhas_de_graca"]["n"]
            ok = obt >= esp["min"] and obt <= esp.get("max", 10 * esp["min"])
            linhas.append(("PASS" if ok else "FAIL", "ilhas_de_graca_n",
                           f"esp ≥{esp['min']} (≤{esp.get('max', '-')}) × obt {obt}"))
        else:
            checar("ilhas_de_graca_n", esp, an["ilhas_de_graca"]["n"], linhas)
    if "zero_tt" in fx:
        ok = (an["fronteira"]["total_tt_m"] < 0.4) == bool(fx["zero_tt"])
        linhas.append(("PASS" if ok else "FAIL", "zero_tt",
                       f"esp {fx['zero_tt']} × obt tt={an['fronteira']['total_tt_m']} m"))
    if "degrades_n" in fx:
        fams = an["paleta"].get("familias", [])
        zona_area = {z["classe_id"]: z["area_m2"] for z in an["zonas_continuas"]}
        zona_tipo = {z["classe_id"]: z["tipo"] for z in an["zonas_continuas"]}
        n = 0
        for f in fams:
            if f.get("campo"):
                continue
            sombra_grande = any(
                zona_tipo.get(z) == "SOMBRA_SUAVE" and zona_area.get(z, 0) >= 0.05
                for z in f.get("zonas", [])
            )
            if f.get("rampa") or sombra_grande:
                n += 1
        checar("degrades_n", fx["degrades_n"], n, linhas)
    if "aerografias_n" in fx:
        n = sum(1 for z in an["zonas_continuas"]
                if z["tipo"] == "AEROGRAFIA" and z["area_m2"] >= 0.05)
        checar("aerografias_n", fx["aerografias_n"], n, linhas)
    if "adesivos_n" in fx:
        checar("adesivos_n", fx["adesivos_n"], len(an["adesivos"]), linhas)
    if "fita_dominante" in fx:
        # R5 (dono): técnica de fita esperada por substrato, no MAIOR
        # elemento de fita da face (caso-régua: a onda do A&P)
        fitas = [e for e in an["elementos"] if e.get("fita")]
        if not fitas:
            linhas.append(("FAIL", "fita_dominante",
                           "nenhum elemento com análise de fita na face"))
        else:
            e_f = max(fitas, key=lambda e: e["fita"]["tracado_m"])
            for subs, esp_t in (fx["fita_dominante"] or {}).items():
                obt = (e_f["fita"]["por_substrato"].get(subs) or {}).get("tecnica")
                ok = obt == esp_t
                linhas.append(("PASS" if ok else "FAIL", f"fita_dominante.{subs}",
                               f"esp {esp_t} × obt {obt} "
                               f"({e_f['fita']['tracado_m']} m de traçado)"))
    if "adesivo_folhas_min" in fx:
        mx = max((len(ad.get("folhas") or []) for ad in an["adesivos"]), default=0)
        ok = mx >= fx["adesivo_folhas_min"]
        linhas.append(("PASS" if ok else "FAIL", "adesivo_folhas_min",
                       f"esp ≥{fx['adesivo_folhas_min']} folhas num adesivo × obt {mx}"))
    if "n_dias" in fx:
        checar("n_dias", fx["n_dias"], an.get("_plano_resumo", {}).get("n_dias"), linhas)
    if "hexes_transferiveis" in fx and comp is not None:
        ok = bool(fx["hexes_transferiveis"]) == bool(comp.get("hexes_transferiveis"))
        linhas.append(("PASS" if ok else "FAIL", "hexes_transferiveis",
                       f"esp {fx['hexes_transferiveis']} × obt {comp.get('hexes_transferiveis')}"))
    # tintas por hex: cada tinta esperada deve ter FAMÍLIA cujo representante
    # ou membro esteja perto; m² no nível da família (a tinta real). O CAMPO
    # entra na busca quando é TINTA (a demão de fundo é uma tinta do layout).
    import re as _re
    _hex_ok = _re.compile(r"^#[0-9A-Fa-f]{6}$")
    fams = [
        f for f in an["paleta"].get("familias", [])
        if not f.get("campo") or an["campo"]["classe"] == "TINTA"
    ]
    for t in fx.get("tintas", []) or []:
        hx = t.get("hex")
        if not hx or not _hex_ok.match(hx):
            continue
        dmins = []
        for f in fams:
            candidatos = [f["hex"]] + list(f.get("membros", []))
            ds = [float(delta_e(_lab(hx), _lab(c))) for c in candidatos
                  if _hex_ok.match(str(c))]
            dmins.append(min(ds) if ds else 99.0)
        dmin = min(dmins) if dmins else 99.0
        ok = dmin < tol_tinta
        linhas.append(("PASS" if ok else "FAIL", f"tinta {t.get('nome', hx)}",
                       f"{hx}: família mais próxima a ΔE {dmin:.1f}"))
        if ok and "m2" in t:
            fam = fams[int(np.argmin(dmins))]
            checar(f"tinta {t.get('nome', hx)}.m2", {"valor": t["m2"], "tol_pct": 20},
                   fam["m2"], linhas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True)
    ap.add_argument("--fixtures", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "fixtures"))
    ap.add_argument("--md", default=None, help="grava relatório markdown")
    args = ap.parse_args()

    # indexa saídas por arquivo de face
    por_arquivo: dict[str, tuple[dict, dict | None]] = {}
    for j in glob.glob(os.path.join(args.saida, "*.json")):
        d = json.load(open(j, encoding="utf-8"))
        for face, dados in d.get("faces", {}).items():
            an = dict(dados["analise"])
            an["_plano_resumo"] = (dados.get("plano") or {}).get("resumo", {})
            por_arquivo[an["arquivo"]] = (an, d.get("comparacao"))

    total = {"PASS": 0, "FAIL": 0}
    rel = ["# Regressão — esperado × obtido", ""]
    for fxpath in sorted(glob.glob(os.path.join(args.fixtures, "*.yaml"))):
        fx = yaml.safe_load(open(fxpath, encoding="utf-8"))
        rel.append(f"## {fx['layout']}  `[{fx['fonte']}]`")
        for face_nome, face_fx in (fx.get("faces") or {}).items():
            arq = face_fx.get("arquivo")
            if arq not in por_arquivo:
                rel.append(f"- {face_nome}: **SEM SAÍDA** para `{arq}`")
                continue
            an, comp = por_arquivo[arq]
            linhas: list = []
            try:
                checar_face(face_fx, an, comp, linhas, fonte=fx.get("fonte", "ficha"))
            except Exception as e:  # noqa
                linhas.append(("FAIL", "comparador", f"erro: {e}"))
            for status, nome, det in linhas:
                total[status] = total.get(status, 0) + 1
                icone = "✅" if status == "PASS" else "❌"
                rel.append(f"- {icone} `{face_nome}.{nome}` — {det}")
        rel.append("")
    rel.append(f"**TOTAL: {total['PASS']} PASS · {total['FAIL']} FAIL**")
    texto = "\n".join(rel)
    print(texto)
    if args.md:
        open(args.md, "w", encoding="utf-8").write(texto)
    return 0 if total["FAIL"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
