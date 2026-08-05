"""Deriva o plano de produção a partir das medições — mecanicamente.

Nada aqui é julgamento: cada passo sai da doutrina aplicada aos números que os
detectores produziram. Se o plano sair errado, o erro está na regra ou na
medição, e é isso que se quer expor à revisão do dono.

Ordem (doutrina §6):
  1. lavagem
  2. empapelamento de perfis, borrachas e ferragens
  3. pintura geral, se o fundo for tinta (não chapa)
  4. uma sessão por cor, na ordem que o §2 determina pela CORTABILIDADE
  5. verniz final

Uso:
    .venv/bin/python probe/plan.py "<arte>" --length-m 8.40 --out passos/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage import measure

sys.path.insert(0, str(Path(__file__).parent))
from common import load  # noqa: E402
from difficulty import (MIN_AREA_FRAC, min_stroke_mm, photo_zones,  # noqa: E402
                        vertices_per_m)
from render import background_labels, boundary_map, line_art, quantize  # noqa: E402

WORK_MAX = 1800

# PROVISÓRIO — a calibração §7.5 ainda não fechou. O dono marcou 9 elementos,
# todos "corto", o mais fino em 14 mm, e nenhum "não corto". Então há evidência
# de que ≥14 mm se corta e NENHUMA evidência de onde está o piso. Abaixo disso
# o plano marca `incerto` em vez de afirmar.
CUT_MM_CONFIRMED = 14.0
CUT_VERT_PROVISIONAL = 18.0     # vértices/m acima disto = filigrana (não calibrado)


def cuttable(el: dict) -> tuple[bool, bool]:
    """(cortável_a_mao, é_palpite). O segundo campo existe para não fingir
    certeza onde a calibração ainda não chegou."""
    if el["menor_traco_mm"] >= CUT_MM_CONFIRMED and el["vertices_por_m"] <= CUT_VERT_PROVISIONAL:
        return True, False
    if el["vertices_por_m"] > CUT_VERT_PROVISIONAL:
        return False, True
    return False, True          # abaixo de 14 mm: sem evidência, palpite


def analyse(path: str, length_m: float, n_colors: int = 8):
    img = load(path)
    work = img.copy()
    work.thumbnail((WORK_MAX, WORK_MAX), Image.LANCZOS)
    px_per_cm = work.size[0] / (length_m * 100)

    labels, palette = quantize(work, n_colors)
    bgset = background_labels(palette, labels)
    photo = photo_zones(work)
    counts = np.bincount(labels.ravel(), minlength=len(palette))
    total = labels.size

    bg_frac = sum(counts[k] for k in bgset) / total
    # Fundo é CHAPA se a área de chapa domina; senão a cor dominante é pintura geral.
    field = None
    if bg_frac < 0.5:
        paint = [k for k in range(len(palette)) if k not in bgset]
        field = int(max(paint, key=lambda k: counts[k])) if paint else None

    cores = []
    for k in range(len(palette)):
        if k in bgset or k == field:
            continue
        frac = counts[k] / total
        if frac < MIN_AREA_FRAC * 4:
            continue
        mask = labels == k
        aero = (mask & photo).sum() > mask.sum() * 0.5
        comps = measure.label(mask)
        regions = [r for r in measure.regionprops(comps)
                   if r.area >= total * MIN_AREA_FRAC]
        traco = min(min_stroke_mm(comps == r.label, px_per_cm) for r in regions) if regions else 0
        vert = max(vertices_per_m(comps == r.label, px_per_cm) for r in regions) if regions else 0
        cores.append({
            "label": k,
            "hex": "#%02X%02X%02X" % tuple(palette[k]),
            "area_m2": round(counts[k] / (px_per_cm ** 2) / 10000, 2),
            "cobertura_pct": round(frac * 100, 1),
            "pecas": len(regions),
            "menor_traco_mm": round(traco, 1),
            "vertices_por_m": round(vert, 1),
            "aerografia": bool(aero),
        })

    for c in cores:
        ok, guess = cuttable(c)
        c["cortavel_a_mao"] = ok
        c["cortabilidade_incerta"] = guess

    # §2: as cortáveis vêm primeiro (menor cobertura antes), as não-cortáveis
    # depois do campo, porque dependem de adesivo sobre verniz.
    cortaveis = sorted([c for c in cores if c["cortavel_a_mao"] and not c["aerografia"]],
                       key=lambda c: c["cobertura_pct"])
    tardias = sorted([c for c in cores if not c["cortavel_a_mao"] and not c["aerografia"]],
                     key=lambda c: c["cobertura_pct"])
    aero = [c for c in cores if c["aerografia"]]

    return {
        "work": work, "labels": labels, "palette": palette, "bgset": bgset,
        "px_per_cm": px_per_cm, "field": field, "bg_frac": bg_frac,
        "cores": cores, "cortaveis": cortaveis, "tardias": tardias, "aero": aero,
        "substrato_chapa": bg_frac >= 0.5,
    }


def state_image(a, painted: list[int], now: int | None, masked: list[int]) -> Image.Image:
    """Estado do implemento: cinza = mascarado, cor = entrando agora,
    tom real = já pintado e curado, branco = chapa exposta."""
    labels, palette = a["labels"], a["palette"]
    h, w = labels.shape
    canvas = np.full((h, w, 3), 248, dtype=np.uint8)
    for k in painted:
        canvas[labels == k] = palette[k]
    for k in masked:
        canvas[labels == k] = (165, 168, 172)
    if now is not None:
        canvas[labels == now] = palette[now]
    return Image.fromarray(canvas)


def build_steps(a) -> list[dict]:
    steps: list[dict] = []
    painted: list[int] = []

    def add(kind, titulo, detalhe, img, **extra):
        steps.append({"n": len(steps) + 1, "tipo": kind, "titulo": titulo,
                      "detalhe": detalhe, "img": img, **extra})

    base = state_image(a, [], None, [])
    add("PREPARO", "Lavagem",
        "Lavar a superfície inteira e desengraxar. Sem isto a laca não ancora.",
        base)
    add("PREPARO", "Empapelamento",
        "Cobrir perfis de borda, borrachas, ferragens e faixa refletiva. "
        "Nada disto recebe tinta.", base)

    if a["field"] is not None:
        f = a["field"]
        add("PINTURA", "Pintura geral",
            f"Fundo de laca e cor geral em toda a superfície "
            f"({a['palette'][f].tolist()}). Curar antes de qualquer máscara.",
            state_image(a, [], f, []), cor="#%02X%02X%02X" % tuple(a["palette"][f]))
        painted.append(f)

    for c in a["cortaveis"]:
        add("MASCARA", f"Máscara — {c['hex']}",
            f"Aplicar máscara e cortar à mão no implemento. "
            f"{c['pecas']} peça(s), traço mínimo {c['menor_traco_mm']} mm, "
            f"{c['vertices_por_m']} vértices/m.",
            state_image(a, painted, None, [c["label"]]), cor=c["hex"],
            incerto=c["cortabilidade_incerta"])
        add("PINTURA", f"Pintura — {c['hex']}",
            f"{c['area_m2']} m², {c['cobertura_pct']}% da face. Curar ~3 h.",
            state_image(a, painted, c["label"], []), cor=c["hex"])
        painted.append(c["label"])

    if a["tardias"]:
        add("VERNIZ", "Verniz intermediário",
            "Envernizar e curar. Obrigatório antes de adesivo sobre "
            "tinta — o adesivo gruda na laca e a arrancaria.",
            state_image(a, painted, None, []))
        for c in a["tardias"]:
            add("MASCARA", f"Adesivo — {c['hex']}",
                f"Recorte em plotter, aplicado sobre o verniz curado. "
                f"Traço mínimo {c['menor_traco_mm']} mm, "
                f"{c['vertices_por_m']} vértices/m — fino ou retorcido demais "
                f"para corte manual.",
                state_image(a, painted, None, [c["label"]]), cor=c["hex"],
                incerto=c["cortabilidade_incerta"])
            add("PINTURA", f"Pintura — {c['hex']}",
                f"{c['area_m2']} m², {c['cobertura_pct']}% da face.",
                state_image(a, painted, c["label"], []), cor=c["hex"])
            painted.append(c["label"])

    for c in a["aero"]:
        add("AEROGRAFIA", f"Aerografia — {c['hex']}",
            f"Zona de tom contínuo, {c['area_m2']} m². Não se corta e não se "
            f"imprime: vai à mão livre pelo setor de Aerografia.",
            state_image(a, painted, c["label"], []), cor=c["hex"])
        painted.append(c["label"])

    add("VERNIZ", "Verniz final",
        "Verniz sobre toda a face. Depois: faixa refletiva e remoção do "
        "empapelamento.", state_image(a, painted, None, []))
    return steps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--length-m", type=float, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--colors", type=int, default=8)
    args = ap.parse_args()

    outdir = Path(args.out)
    (outdir / "img").mkdir(parents=True, exist_ok=True)

    a = analyse(args.image, args.length_m, args.colors)
    a["work"].save(outdir / "img/original.jpg", quality=90)
    line_art(a["labels"]).save(outdir / "img/linhas.png")
    bg_main = next(iter(a["bgset"]))
    boundary_map(a["labels"], bg_main).save(outdir / "img/fronteiras.png")
    Image.fromarray(a["palette"][a["labels"]]).save(outdir / "img/quantizado.png")

    steps = build_steps(a)
    for s in steps:
        name = f"img/passo_{s['n']:02d}.png"
        s.pop("img").save(outdir / name)
        s["img"] = name

    manifest = {
        "arte": Path(args.image).name,
        "comprimento_m": args.length_m,
        "px_por_cm": round(a["px_per_cm"], 2),
        "substrato": "CHAPA" if a["substrato_chapa"] else "PINTURA_GERAL",
        "chapa_pct": round(a["bg_frac"] * 100, 1),
        "cores": a["cores"],
        "passos": steps,
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

    print(f"substrato: {manifest['substrato']} ({manifest['chapa_pct']}% chapa)")
    print(f"cores de tinta: {len(a['cores'])} | cortáveis {len(a['cortaveis'])} "
          f"| tardias {len(a['tardias'])} | aerografia {len(a['aero'])}")
    print(f"passos: {len(steps)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
