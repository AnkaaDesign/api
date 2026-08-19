"""CLI do gerador de risco.

  .venv/bin/python -m painting_engine.lineart.cli \
      --input arte.pdf --mural-width-cm 1200 \
      --svg risco.svg --preview risco.png
"""

from __future__ import annotations

import argparse
import json
import sys

from .params import LineArtParams
from .pipeline import build_lineart


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="painting_engine.lineart")
    parser.add_argument("--input", required=True, help="PNG/JPG/PDF da arte")
    parser.add_argument(
        "--mural-width-cm", type=float, required=True,
        help="largura REAL do mural/lateral em cm — define escala, traço e grade",
    )
    parser.add_argument("--svg", help="saída SVG (mestre, abre no Affinity)")
    parser.add_argument("--dxf", help="saída DXF (CAD/plotter)")
    parser.add_argument("--preview", help="saída PNG de conferência")
    parser.add_argument("--json", help="relatório JSON")
    parser.add_argument(
        "--debug-dir",
        help="pasta para os mapas intermediários (objetos, rótulos, textura)",
    )
    parser.add_argument(
        "--no-instances", action="store_true",
        help="desliga o MobileSAM e separa objetos só por cor (mais rápido, pior)",
    )
    parser.add_argument("--sam-checkpoint", help="caminho do mobile_sam.pt")
    parser.add_argument(
        "--params-json", help='overrides, ex: \'{"tone_levels": 4, "hatch": false}\''
    )
    args = parser.parse_args(argv)

    overrides = json.loads(args.params_json) if args.params_json else None
    params = LineArtParams.from_overrides(overrides)
    if args.no_instances:
        params.instances = False
    if args.sam_checkpoint:
        params.sam_checkpoint = args.sam_checkpoint

    report = build_lineart(
        args.input,
        mural_width_cm=args.mural_width_cm,
        params=params,
        svg_path=args.svg,
        dxf_path=args.dxf,
        preview_path=args.preview,
        debug_dir=args.debug_dir,
    )

    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            handle.write(payload)
    print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
