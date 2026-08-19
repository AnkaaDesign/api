#!/usr/bin/env python3
"""Banco de comparação do gerador de risco contra um risco feito à mão.

Sem medida, ajustar limiar vira gosto. Este script põe os dois desenhos no mesmo
canvas e responde três perguntas:

  recall     — quanto do traço da mão o gerador reproduziu
  precision  — quanto do traço gerado a mão também tem
  %sobra     — por camada, quanto foi desenhado a mais

Uso:

    .venv/bin/python tools/bench_lineart.py \\
        --art "arte.pdf" --ref risco-a-mao.png --mural-width-cm 1200 \\
        --params '{"hatch_pitch_cm": 7}' --out /tmp/bench

`--ref` é um PNG do risco de referência (fundo branco, traço preto) no mesmo
enquadramento da arte; o script reescala para o canvas de trabalho.

Cuidado com o alvo: tinta de referência que cai fora do assunto da arte é
descontada. Um risco traçado de uma versão maior da imagem tem linhas sem fonte
no insumo, e pontuar contra elas mede diferença de recorte, não algoritmo.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

SVG_NS = "{http://www.w3.org/2000/svg}"
LAYER_DASH = {"SOMBRA": (9, 6)}


def flatten_path(data: str, scale: float, steps: int = 10) -> np.ndarray:
    tokens = re.findall(r"[MC]|-?\d+\.?\d*(?:e-?\d+)?", data)
    pts: list[tuple[float, float]] = []
    index = 0
    current = (0.0, 0.0)
    while index < len(tokens):
        head = tokens[index]
        if head == "M":
            current = (float(tokens[index + 1]) * scale, float(tokens[index + 2]) * scale)
            pts.append(current)
            index += 3
        elif head == "C":
            c1 = (float(tokens[index + 1]) * scale, float(tokens[index + 2]) * scale)
            c2 = (float(tokens[index + 3]) * scale, float(tokens[index + 4]) * scale)
            end = (float(tokens[index + 5]) * scale, float(tokens[index + 6]) * scale)
            for step in range(1, steps + 1):
                t = step / steps
                mt = 1 - t
                pts.append((
                    mt**3 * current[0] + 3 * mt * mt * t * c1[0]
                    + 3 * mt * t * t * c2[0] + t**3 * end[0],
                    mt**3 * current[1] + 3 * mt * mt * t * c1[1]
                    + 3 * mt * t * t * c2[1] + t**3 * end[1],
                ))
            current = end
            index += 7
        else:
            index += 1
    return np.asarray(pts, dtype=np.float64)


def rasterize(polylines, shape, weight=2, dash=None) -> np.ndarray:
    height, width = shape
    canvas = np.zeros(shape, dtype=bool)
    for pts in polylines:
        travelled = 0.0
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            seg = float(np.hypot(x1 - x0, y1 - y0))
            steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
            for s in range(steps + 1):
                t = s / steps
                if dash is not None and (travelled + seg * t) % (dash[0] + dash[1]) > dash[0]:
                    continue
                x = int(round(x0 + (x1 - x0) * t))
                y = int(round(y0 + (y1 - y0) * t))
                if 0 <= y < height - weight and 0 <= x < width - weight:
                    canvas[y : y + weight, x : x + weight] = True
            travelled += seg
    return canvas


def svg_layers(path: Path, shape: tuple[int, int]) -> dict[str, list[np.ndarray]]:
    root = ET.parse(path).getroot()
    viewbox = [float(v) for v in root.get("viewBox").split()]
    scale = shape[1] / viewbox[2]
    out: dict[str, list[np.ndarray]] = {}
    for group in root.findall(f"{SVG_NS}g"):
        name = group.get("id")
        if name in ("REFERENCIA", "GRADE"):
            continue
        polys = [flatten_path(p.get("d"), scale) for p in group.findall(f"{SVG_NS}path")]
        if polys:
            out[name] = polys
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bench_lineart")
    parser.add_argument("--art", required=True)
    parser.add_argument("--ref", required=True, help="PNG do risco feito à mão")
    parser.add_argument("--mural-width-cm", type=float, required=True)
    parser.add_argument("--params", help="overrides JSON para o gerador")
    parser.add_argument("--out", default="/tmp/bench-lineart")
    parser.add_argument("--tolerance-px", type=int, default=6)
    args = parser.parse_args(argv)

    from painting_engine.lineart.params import LineArtParams
    from painting_engine.lineart.pipeline import _load_rgb, _to_work

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    params = LineArtParams.from_overrides(json.loads(args.params) if args.params else None)

    work = _to_work(_load_rgb(args.art, params), params.work_width_px)
    shape = work.shape[:2]

    svg_path = out / "risco.svg"
    command = [
        sys.executable, "-W", "ignore", "-m", "painting_engine.lineart.cli",
        "--input", args.art, "--mural-width-cm", str(args.mural_width_cm),
        "--svg", str(svg_path),
    ]
    if args.params:
        command += ["--params-json", args.params]
    proc = subprocess.run(
        command, capture_output=True, text=True, cwd=ROOT,
        env={"PYTHONPATH": str(ROOT / "src"), "PATH": "/usr/bin:/bin:/opt/homebrew/bin",
             "HOME": str(Path.home())},
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout[-4000:] + proc.stderr[-4000:])
        return 1
    report = json.loads(proc.stdout)

    reference = np.asarray(
        Image.open(args.ref).convert("L").resize((shape[1], shape[0]), Image.LANCZOS)
    ) < 128
    # tinta de referência sem fonte na arte não conta
    subject = ndi.binary_dilation(~((work > 235).all(axis=2)), iterations=6)
    reference &= subject

    layers = svg_layers(svg_path, shape)
    generated = np.zeros(shape, dtype=bool)
    per_layer = {}
    d_ref = ndi.distance_transform_edt(~reference)
    for name, polys in layers.items():
        ink = rasterize(polys, shape, dash=LAYER_DASH.get(name))
        generated |= ink
        extra = ink & (d_ref > args.tolerance_px)
        per_layer[name] = {
            "strokes": len(polys),
            "ink": int(ink.sum()),
            "excessPct": round(float(extra.sum()) / max(int(ink.sum()), 1) * 100, 1),
        }

    d_gen = ndi.distance_transform_edt(~generated)
    recall = float((d_gen[reference] <= args.tolerance_px).mean())
    precision = float((d_ref[generated] <= args.tolerance_px).mean())
    f1 = 2 * recall * precision / max(recall + precision, 1e-9)

    canvas = np.full((*shape, 3), 255, dtype=np.uint8)
    miss = reference & (d_gen > args.tolerance_px)
    extra = generated & (d_ref > args.tolerance_px)
    canvas[(reference & ~miss) | (generated & ~extra)] = (205, 205, 205)
    canvas[extra] = (40, 90, 230)
    canvas[miss] = (225, 30, 30)
    Image.fromarray(canvas).save(out / "diferenca.png")

    summary = {
        "recall": round(recall, 4),
        "precision": round(precision, 4),
        "f1": round(f1, 4),
        "inkRatio": round(int(generated.sum()) / max(int(reference.sum()), 1), 3),
        "perLayer": per_layer,
        "strokes": report["totalStrokes"],
        "bezierNodes": report["bezierNodes"],
        "objectSource": report["objectSource"],
        "warnings": report["warnings"],
    }
    (out / "bench.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nmapa: {out / 'diferenca.png'}  (vermelho=falta, azul=sobra, cinza=coincide)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
