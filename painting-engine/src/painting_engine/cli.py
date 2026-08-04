"""CLI entry point.

Examples:
  python -m painting_engine.cli \
    --input "/path/arte lateral.png" \
    --reference-kind TOTAL_LENGTH --reference-cm 1500 \
    --stages quantize,regions,classify,boundaries,layout \
    --sessions "4;2,7;-1" \
    --out /tmp/analysis.json --overlay /tmp/overlay.png

  # only the layout geometry (independent-stage requirement; "adhesive" is an alias):
  python -m painting_engine.cli --input arte.png --reference-kind TOTAL_LENGTH \
    --reference-cm 1500 --stages layout --out /tmp/layout.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .params import EngineParams
from .pipeline import ALL_STAGES, parse_sessions, render_overlay, run_pipeline


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="painting-engine")
    parser.add_argument("--input", required=True, help="path to the artwork image")
    parser.add_argument(
        "--reference-kind",
        required=True,
        choices=["TOTAL_LENGTH", "WIDTH", "SIDE_HEIGHT", "HEIGHT"],
    )
    parser.add_argument("--reference-cm", required=True, type=float)
    parser.add_argument(
        "--stages",
        default=",".join(ALL_STAGES),
        help=f"comma-separated subset of {ALL_STAGES}",
    )
    parser.add_argument("--params-json", default=None, help="JSON file or inline JSON with overrides")
    parser.add_argument(
        "--sessions",
        default=None,
        help=(
            'optional paint sessions as palette indexes, e.g. "4;2,7;-1" '
            '(";" separates sessions, "," colors in one session, -1 = photographic)'
        ),
    )
    parser.add_argument("--out", default="-", help="output JSON path ('-' = stdout)")
    parser.add_argument("--overlay", default=None, help="optional overlay PNG path")
    args = parser.parse_args(argv)

    overrides = None
    if args.params_json:
        raw = args.params_json
        path = Path(raw)
        text = path.read_text() if path.exists() else raw
        overrides = json.loads(text)
    params = EngineParams.from_dict(overrides)

    artifact = run_pipeline(
        image_path=args.input,
        reference_kind=args.reference_kind,
        reference_value_cm=args.reference_cm,
        params=params,
        stages=[s for s in args.stages.split(",") if s],
        sessions=parse_sessions(args.sessions),
    )

    payload = json.dumps(artifact, ensure_ascii=False)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(payload)

    if args.overlay:
        render_overlay(args.input, artifact, args.overlay)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
