"""Transforma a saída do painting-engine num relatório visual de produção.

Não reanalisa a imagem: consome o JSON que o motor produziu e rasteriza os
contornos que ELE devolveu. Se o plano sair errado, o erro está no motor ou na
regra — que é exatamente o que se quer expor à revisão.

Uso:
    .venv/bin/python probe/engine_report.py <analysis.json> <arte.png> --out <dir>
"""

from __future__ import annotations

import argparse
import base64
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

from common import load

# Confirmado pelo dono em 2026-08-05: ≥14 mm ele corta à mão (9 marcações,
# incluindo 3 triângulos do ACM). Abaixo disso não há evidência — o relatório
# marca "sem calibração" em vez de afirmar.
CUT_MM_CONFIRMED = 14.0


def rasterize(regions, w, h):
    """Pinta cada região do motor numa camada própria, respeitando os furos."""
    layers = {}
    for r in regions:
        img = Image.new("L", (w, h), 0)
        d = ImageDraw.Draw(img)
        if len(r["contour"]) >= 3:
            d.polygon([tuple(p) for p in r["contour"]], fill=255)
        for hole in r.get("holes", []):
            if len(hole) >= 3:
                d.polygon([tuple(p) for p in hole], fill=0)
        layers[r["id"]] = img
    return layers


def state(base_size, layers, regions, painted, now, masked):
    w, h = base_size
    canvas = Image.new("RGB", (w, h), (248, 249, 250))
    by_id = {r["id"]: r for r in regions}
    for rid in painted:
        canvas.paste(by_id[rid]["hex"], (0, 0), layers[rid])
    for rid in masked:
        canvas.paste("#A5A8AC", (0, 0), layers[rid])
    for rid in now:
        canvas.paste(by_id[rid]["hex"], (0, 0), layers[rid])
    return canvas


def build(analysis: dict, art_path: str, outdir: Path) -> dict:
    img = analysis["image"]
    w, h = img["workWidthPx"], img["workHeightPx"]
    regions = analysis["regions"]
    paint = [r for r in regions if not r["is_background"]]
    layers = rasterize(regions, w, h)

    original = load(art_path)
    original.thumbnail((w, h), Image.LANCZOS)
    (outdir / "img").mkdir(parents=True, exist_ok=True)
    original.save(outdir / "img/original.jpg", quality=88)

    # Agrupa por COR, não por região: o pintor bate uma tinta e pinta todas as
    # peças daquela cor na mesma sessão.
    by_hex: dict[str, list] = defaultdict(list)
    for r in paint:
        by_hex[r["hex"]].append(r)

    cores = []
    for hexv, rs in by_hex.items():
        traco = min(r["min_stroke_mm"] for r in rs)
        cores.append({
            "hex": hexv,
            "area_m2": round(sum(r["area_m2"] for r in rs), 2),
            "pecas": len(rs),
            "menor_traco_mm": round(traco, 1),
            "ids": [r["id"] for r in rs],
            "kinds": sorted({r["kind"] for r in rs}),
            "micro": any(r["kind"] == "MICRO" for r in rs),
            "cortavel": traco >= CUT_MM_CONFIRMED and not any(r["kind"] == "MICRO" for r in rs),
            "sem_calibracao": traco < CUT_MM_CONFIRMED,
        })

    geral = analysis["background"]["mode"] == "GENERAL_PAINT"
    cortaveis = sorted([c for c in cores if c["cortavel"]], key=lambda c: c["area_m2"])
    tardias = sorted([c for c in cores if not c["cortavel"]], key=lambda c: c["area_m2"])

    steps, painted = [], []

    def add(tipo, titulo, detalhe, now=(), masked=(), **extra):
        n = len(steps) + 1
        p = f"img/passo_{n:02d}.png"
        state((w, h), layers, regions, painted, list(now), list(masked)).save(outdir / p)
        steps.append({"n": n, "tipo": tipo, "titulo": titulo, "detalhe": detalhe,
                      "img": p, **extra})

    add("PREPARO", "Lavagem",
        "Lavar e desengraxar a face inteira. Sem isto a laca não ancora.")
    add("PREPARO", "Empapelamento",
        "Cobrir perfis de borda, borrachas, ferragens e a faixa refletiva.")

    if geral:
        add("PINTURA", "Pintura geral",
            f"Fundo e cor geral em toda a face ({analysis['background']['hex']}). "
            "Curar antes de qualquer máscara.")

    for c in cortaveis:
        add("MASCARA", f"Máscara e corte manual — {c['hex']}",
            f"{c['pecas']} peça(s), traço mínimo {c['menor_traco_mm']} mm. "
            f"Corte à mão no implemento — sem plotter, sem verniz, sem espera.",
            masked=c["ids"], cor=c["hex"])
        add("PINTURA", f"Pintura — {c['hex']}",
            f"{c['area_m2']} m². Curar ~3 h antes da próxima máscara.",
            now=c["ids"], cor=c["hex"])
        painted.extend(c["ids"])

    if tardias:
        add("VERNIZ", "Verniz intermediário",
            "Envernizar e curar. Obrigatório antes de adesivo sobre "
            "tinta — o vinil gruda na laca e a arrancaria.")
        for c in tardias:
            motivo = ("detalhe MICRO" if c["micro"]
                      else f"traço de {c['menor_traco_mm']} mm")
            add("MASCARA", f"Adesivo — {c['hex']}",
                f"Recorte em plotter sobre o verniz curado. {c['pecas']} peça(s), "
                f"{motivo}.", masked=c["ids"], cor=c["hex"],
                sem_calibracao=c["sem_calibracao"])
            add("PINTURA", f"Pintura — {c['hex']}",
                f"{c['area_m2']} m².", now=c["ids"], cor=c["hex"])
            painted.extend(c["ids"])

    add("VERNIZ", "Verniz final",
        "Verniz sobre a face inteira. Depois: faixa refletiva e remoção do "
        "empapelamento.")

    # Pares T-T por COR (o motor conta por par de região, que infla a leitura)
    by_id = {r["id"]: r for r in regions}
    pares: dict[tuple, float] = defaultdict(float)
    for b in analysis["boundaries"]:
        if b["kind"] != "PAINT_PAINT":
            continue
        a_hex = by_id.get(b["a"], {}).get("hex", "?")
        b_hex = by_id.get(b["b"], {}).get("hex", "?")
        pares[tuple(sorted((a_hex, b_hex)))] += b.get("length_m", 0)

    return {
        "arte": Path(art_path).name,
        "comprimento_cm": img["widthCm"],
        "altura_cm": img["heightCm"],
        "area_m2": img["areaM2"],
        "px_por_cm": round(img["pxPerCmOriginal"], 2),
        "fundo": analysis["background"],
        "n_regioes": len(regions),
        "n_reserva": sum(1 for r in regions if r["is_background"]),
        "cores": sorted(cores, key=lambda c: -c["area_m2"]),
        "pares_tt": [{"a": k[0], "b": k[1], "metros": round(v, 2)}
                     for k, v in sorted(pares.items(), key=lambda x: -x[1])],
        "fronteiras": {
            "PAINT_PAINT": sum(1 for b in analysis["boundaries"] if b["kind"] == "PAINT_PAINT"),
            "WITH_BACKGROUND": sum(1 for b in analysis["boundaries"] if b["kind"] == "WITH_BACKGROUND"),
            "KEYLINE": sum(1 for b in analysis["boundaries"] if b["kind"] == "KEYLINE"),
        },
        "alertas": [a for a in analysis.get("alerts", [])],
        "passos": steps,
        "tempos": analysis.get("timingsSec", {}),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("analysis")
    ap.add_argument("art")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    rep = build(json.loads(Path(args.analysis).read_text()), args.art, outdir)
    (outdir / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2))

    print(f"{rep['arte']}  {rep['comprimento_cm']}x{rep['altura_cm']} cm  "
          f"{rep['area_m2']} m²")
    print(f"fundo: {rep['fundo']['mode']} {rep['fundo']['hex']} "
          f"({rep['fundo']['coveragePct']*100:.1f}%)")
    print(f"cores: {len(rep['cores'])} | pares T-T: {len(rep['pares_tt'])} | "
          f"passos: {len(rep['passos'])}")
    for c in rep["cores"]:
        print(f"  {c['hex']}  {c['area_m2']:>5} m²  traço {c['menor_traco_mm']:>6} mm  "
              f"{'CORTA À MÃO' if c['cortavel'] else 'MÁQUINA'}"
              f"{'  (sem calibração)' if c['sem_calibracao'] else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
