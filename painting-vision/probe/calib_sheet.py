"""Monta a folha de calibração de cortabilidade (doutrina §7.5).

Não existe rótulo automático: medido nas 66 artes, `menor_traco_mm`,
`compacidade` e `area_cm2` têm distribuições indistinguíveis entre elementos
sobre chapa e sobre tinta. O limiar do "isso eu não corto" só sai de exemplos
marcados pelo dono.

RODADA 3 — só elementos em COR SOBRE COR.

A rodada 2 não serviu e o motivo é bom: quase tudo nela era cor sobre chapa, e
sobre chapa não se corta — o adesivo vai inteiro. A pergunta "corto ou não
corto" só existe onde duas cores do desenho se tocam. Filtrar por isso é o que
torna a marcação respondível.

Usa APENAS as artes cujo comprimento real aparece no nome do arquivo — nas
outras a escala é presumida e o valor em mm seria ficção, que é exatamente o
erro que as análises antigas cometeram.

Para cada elemento amostrado gera duas imagens:
  contexto   — o recorte na arte, com o elemento destacado (dá a escala visual)
  silhueta   — a forma isolada em P&B: é literalmente o que seria cortado

Uso:
    .venv/bin/python probe/calib_sheet.py --n 20 --out <dir>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from skimage import measure, morphology as morph

sys.path.insert(0, str(Path(__file__).parent))
from common import load  # noqa: E402
from difficulty import (MIN_AREA_FRAC, WORK_MAX, compactness,  # noqa: E402
                        length_from_name, min_stroke_mm, photo_zones,
                        substrate_of, vertices_per_m)
from render import background_labels, quantize  # noqa: E402

ARTS_DIR = Path("/Users/kennedycampos/Documents/repositories/layout database")
PAD = 0.18          # margem ao redor do recorte de contexto
CTX_MAX = 620
SIL_MAX = 420


def elements_of(path: Path):
    """Devolve (imagem de trabalho, rótulos, fundo, px_por_cm, regiões)."""
    work = load(path)
    work.thumbnail((WORK_MAX, WORK_MAX), Image.LANCZOS)
    length_m, from_name = length_from_name(str(path))
    if not from_name:
        return None
    px_per_cm = work.size[0] / (length_m * 100)
    labels, palette = quantize(work, 8)
    from skimage.segmentation import find_boundaries
    bgset = background_labels(palette, labels)
    photo = photo_zones(work)

    out = []
    for k in range(len(palette)):
        if k in bgset:                      # branco/chapa nunca é elemento de tinta
            continue
        comps = measure.label(labels == k)
        for region in measure.regionprops(comps):
            if region.area < labels.size * MIN_AREA_FRAC:
                continue
            mask = comps == region.label
            # Aerografia não se corta — perguntar sobre ela não tem resposta útil,
            # e as lascas de bloco fotográfico dominavam o topo do ranking.
            if (mask & photo).sum() > mask.sum() * 0.5:
                continue
            # Só interessa quem encosta em OUTRA TINTA. Vizinhança em anel:
            # rótulos presentes na borda que não sejam chapa nem a própria cor.
            anel = morph.dilation(mask, morph.disk(4)) & ~mask
            viz = set(np.unique(labels[anel]).tolist()) - {k} - bgset
            if not viz:
                continue
            out.append({
                "sobre_cor": "#%02X%02X%02X" % tuple(palette[sorted(viz)[0]]),
                "mask": mask,
                "bbox": region.bbox,
                "cor": "#%02X%02X%02X" % tuple(palette[k]),
                "area_cm2": round(region.area / (px_per_cm ** 2), 1),
                "menor_traco_mm": round(min_stroke_mm(mask, px_per_cm), 1),
                "compacidade": round(compactness(region), 1),
                "vertices_por_m": vertices_per_m(mask, px_per_cm),
                "sobre": substrate_of(mask, labels, bgset)[0],
                "arte": path.name,
                "comprimento_m": length_m,
            })
    return work, out


def crops_for(work: Image.Image, el: dict) -> tuple[Image.Image, Image.Image]:
    r0, c0, r1, c1 = el["bbox"]
    h, w = el["mask"].shape
    ph, pw = int((r1 - r0) * PAD) + 8, int((c1 - c0) * PAD) + 8
    box = (max(0, c0 - pw), max(0, r0 - ph), min(w, c1 + pw), min(h, r1 + ph))

    ctx = work.crop(box).convert("RGB")
    d = ImageDraw.Draw(ctx)
    d.rectangle([c0 - box[0], r0 - box[1], c1 - box[0], r1 - box[1]],
                outline=(220, 30, 30), width=2)
    ctx.thumbnail((CTX_MAX, CTX_MAX), Image.LANCZOS)

    sub = el["mask"][box[1]:box[3], box[0]:box[2]]
    sil = Image.fromarray(np.where(sub, 0, 255).astype(np.uint8), mode="L").convert("RGB")
    sil.thumbnail((SIL_MAX, SIL_MAX), Image.LANCZOS)
    return ctx, sil


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--max-mm", type=float, default=22.0,
                    help="teto de espessura: acima disto o dono já disse que corta")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    outdir = Path(args.out)
    (outdir / "img").mkdir(parents=True, exist_ok=True)

    pool = []
    for p in sorted(ARTS_DIR.glob("*.png")):
        got = elements_of(p)
        if not got:
            continue
        work, els = got
        for e in els:
            e["_work"] = work
        pool.extend(els)
        print(f"  {p.name}: {len(els)} elementos", file=sys.stderr)

    if not pool:
        print("nenhuma arte com comprimento no nome", file=sys.stderr)
        return 1

    # Amostra cruzando os DOIS eixos da cortabilidade (doutrina §7.1).
    #
    # A rodada 1 ordenou só por espessura e não achou limiar nenhum: o dono
    # marcou "corto" em tudo, até 14 mm. E o ACM provou por quê — triângulos
    # finos, cor sobre cor, cortados à mão porque são RETOS. Espessura sozinha
    # não decide; retilineidade é o outro eixo.
    #
    # Então: recorta a faixa fina (onde o limiar tem de estar) e varre uma
    # grade espessura × vértices-por-metro, para as marcas poderem separar as
    # duas causas.
    fine = [e for e in pool if e["menor_traco_mm"] <= args.max_mm] or pool
    fine.sort(key=lambda e: e["menor_traco_mm"])

    def cell(e, bins, key):
        vals = sorted(x[key] for x in fine)
        for b in range(bins - 1):
            if e[key] <= vals[int(len(vals) * (b + 1) / bins) - 1]:
                return b
        return bins - 1

    grid: dict[tuple[int, int], list] = {}
    for e in fine:
        grid.setdefault((cell(e, 4, "menor_traco_mm"),
                         cell(e, 3, "vertices_por_m")), []).append(e)

    chosen, per_cell = [], max(1, args.n // max(1, len(grid)))
    for key in sorted(grid):
        chosen.extend(grid[key][:per_cell + 1])
    chosen.sort(key=lambda e: e["menor_traco_mm"])
    chosen = chosen[:args.n]
    print(f"  grade: {len(grid)} células ocupadas, {len(chosen)} escolhidos",
          file=sys.stderr)

    manifest = []
    for n, el in enumerate(chosen, 1):
        ctx, sil = crops_for(el["_work"], el)
        cn, sn = f"img/{n:02d}_ctx.jpg", f"img/{n:02d}_sil.png"
        ctx.save(outdir / cn, quality=86)
        sil.save(outdir / sn, optimize=True)
        manifest.append({
            "n": n, "contexto": cn, "silhueta": sn,
            **{k: el[k] for k in ("arte", "comprimento_m", "cor", "area_cm2",
                                  "menor_traco_mm", "compacidade", "vertices_por_m", "sobre",
                                  "sobre_cor")},
        })

    (outdir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"\n{len(manifest)} elementos de {len(set(e['arte'] for e in pool))} artes "
          f"| traço {manifest[0]['menor_traco_mm']}–{manifest[-1]['menor_traco_mm']} mm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
