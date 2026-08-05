"""Estágio 2 da cadeia: lê o texto dos recortes que o grounding produziu.

Por que em dois passos: o Qwen precisa da arte reduzida a 1568 px para caber
na memória, e nessa escala um telefone de rodapé vira borrão. O recorte é
feito na resolução ORIGINAL, então o OCR recebe os pixels que o downscale
tinha descartado.

Uso:
    .venv-paddle/bin/python probe/ocr_crops.py <elements.json>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import CROP_MAX_PX, fit, load  # noqa: E402
from ocr_paddle import build_pipeline, classify, run_ocr  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("elements_json")
    args = ap.parse_args()

    data = json.loads(Path(args.elements_json).read_text())
    elements = data.get("elements", [])
    todo = [e for e in elements if e.get("crop")]
    if not todo:
        print("nenhum recorte em " + args.elements_json, file=sys.stderr)
        return 1

    pipeline = build_pipeline()
    for el in todo:
        crop = fit(load(el["crop"]), CROP_MAX_PX)
        blocks = run_ocr(pipeline, crop)
        el["text"] = " ".join(b["text"] for b in blocks).strip() or None
        # O rótulo do Qwen é um palpite visual; o texto lido é evidência mais
        # forte. "logomarca" cujo texto é uma URL era SITE.
        if el["text"]:
            refined = classify(el["text"])
            if refined != "TEXTO":
                el["kind_refined"] = refined
        print(f"  {el['kind']:<20} {el['text'] or '(sem texto)'}", file=sys.stderr)

    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
