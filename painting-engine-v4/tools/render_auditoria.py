#!/usr/bin/env python3
"""Overlay de auditoria por face — a arte com as DECISÕES desenhadas.

Uso: .venv/bin/python tools/render_auditoria.py --saida saida [--dir saida/auditoria] [--so slug]

Por face: a arte reduzida + caixas de elemento coloridas pela TÉCNICA,
envelopes de adesivo (tracejado) com folhas divididas (verde), traçado de
fita por classe de trecho, zonas contínuas rotuladas. É o instrumento da
validação manual: uma imagem por face, para o olho julgar a decisão.
"""
from __future__ import annotations

import argparse
import glob
import json
import os

from PIL import Image, ImageDraw

DB = "/home/kennedy/Documents/repositories/api/layout database"

COR_TEC = {
    "ADESIVO": (36, 78, 156), "FITA": (222, 168, 22), "STENCIL_FITA": (222, 120, 22),
    "STENCIL_CORTE": (190, 90, 20), "AEROGRAFIA": (186, 42, 160),
}
COR_TRECHO = {"H_leve": (222, 168, 22), "V_leve": (240, 120, 30), "curva": (200, 30, 40)}


def render_face(an: dict, caminho_png: str, destino: str, larg: int = 1500):
    im = Image.open(caminho_png).convert("RGB")
    off = an.get("moldura_px") or {}
    esc_art = 1.0 / an["escala"]["mm_px"]      # mm -> px da arte original
    fator = larg / im.width
    im = im.resize((larg, max(1, int(im.height * fator))))
    dr = ImageDraw.Draw(im, "RGBA")

    def mm2px(x_mm, y_mm):
        return ((x_mm * esc_art + off.get("esq", 0)) * fator,
                (y_mm * esc_art + off.get("topo", 0)) * fator)

    # adesivos: envelope tracejado vermelho + folhas verdes
    for ad in an["adesivos"]:
        ev = ad["envelope_mm"]
        x0, y0 = mm2px(ev["x"], ev["y"])
        x1, y1 = mm2px(ev["x"] + ev["w"], ev["y"] + ev["h"])
        dr.rectangle([x0, y0, x1, y1], outline=(200, 30, 40, 255), width=2)
        dr.text((x0 + 3, y0 + 2), f"{ad['id']} {ad.get('aproveitamento_pct', 0):.0f}%",
                fill=(200, 30, 40))
        for f in ad.get("folhas") or []:
            fx0, fy0 = mm2px(f["x"], f["y"])
            fx1, fy1 = mm2px(f["x"] + f["w"], f["y"] + f["h"])
            dr.rectangle([fx0, fy0, fx1, fy1], outline=(20, 140, 60, 255), width=3)
            dr.text((fx0 + 3, fy1 - 14), f["parte"][:14], fill=(20, 140, 60))

    # elementos por técnica (só não-ADESIVO recebem caixa cheia; adesivo fino)
    for e in an["elementos"]:
        t = e.get("tecnica", "ADESIVO")
        cor = COR_TEC.get(t, (120, 120, 120))
        d = e["dim_mm"]
        x0, y0 = mm2px(d["x"], d["y"])
        x1, y1 = mm2px(d["x"] + d["w"], d["y"] + d["h"])
        dr.rectangle([x0, y0, x1, y1], outline=cor + (255,),
                     width=3 if t != "ADESIVO" else 1)
        if t != "ADESIVO":
            dr.text((x0 + 3, max(0, y0 - 12)), f"el{e['id']} {t}", fill=cor)
        f = e.get("fita")
        if f:
            for pol in f.get("tracado") or []:
                pts = pol["pontos"]
                cls = pol.get("classes") or []
                for i in range(len(pts)):
                    p1 = mm2px(*pts[i])
                    p2 = mm2px(*pts[(i + 1) % len(pts)])
                    c = COR_TRECHO.get(cls[i] if i < len(cls) else "H_leve", (222, 168, 22))
                    dr.line([p1, p2], fill=c + (230,), width=3)

    # zonas contínuas: rótulo no centro aproximado (bbox não vem na zona;
    # usa-se o elemento dono quando houver)
    for z in an["zonas_continuas"]:
        if z["area_m2"] < 0.05:
            continue
        dono = next((e for e in an["elementos"] if z["classe_id"] in (e.get("classes") or [])), None)
        if dono is None:
            continue
        d = dono["dim_mm"]
        x0, y0 = mm2px(d["x"] + d["w"] / 2, d["y"] + d["h"] / 2)
        rot = f"{z['tipo'][:4]} {z['area_m2']}m²"
        dr.text((x0, y0), rot, fill=(186, 42, 160))

    im.save(destino)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", default="saida")
    ap.add_argument("--dir", default=None)
    ap.add_argument("--so", default=None, help="só layouts contendo este trecho no slug")
    args = ap.parse_args()
    destino = args.dir or os.path.join(args.saida, "auditoria")
    os.makedirs(destino, exist_ok=True)
    n = 0
    for j in sorted(glob.glob(os.path.join(args.saida, "*.json"))):
        slug = os.path.splitext(os.path.basename(j))[0]
        if args.so and args.so.lower() not in slug.lower():
            continue
        d = json.load(open(j, encoding="utf-8"))
        if "faces" not in d:
            continue
        for face, dados in d["faces"].items():
            an = dados["analise"]
            png = os.path.join(DB, an["arquivo"])
            if not os.path.exists(png):
                continue
            out = os.path.join(destino, f"{slug}--{face}.png")
            try:
                render_face(an, png, out)
                n += 1
            except Exception as e:  # noqa
                print("falha", slug, face, e)
    print(f"{n} overlays em {destino}")


if __name__ == "__main__":
    main()
