"""Probe do PaddleOCR-VL — o papel de TEXTO (onde + o que diz).

Roda no venv `.venv-paddle` (paddlepaddle CPU), não no `.venv` do MLX: o
pipeline completo é detector (PP-DocLayout) + reconhecedor (PaddleOCR-VL).
A porta MLX pura só reconhece — sem detector ela lê o texto dominante e
ignora o resto (medido: leu "PESCA / www.137pescado" e parou).

Inclui o teste de espelhamento, que é determinístico e não precisa de LLM:
texto invertido destrói a confiança do OCR e o flip horizontal a restaura.

Uso:
    .venv-paddle/bin/python probe/ocr_paddle.py "../../layout database/AAN lateral.png"
    .venv-paddle/bin/python probe/ocr_paddle.py <img> --no-mirror-check
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from PIL import Image

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from common import CROP_MAX_PX, auto_grid, load, tile  # noqa: E402

# Classificação por padrão: o que regex resolve não vai para modelo nenhum.
PATTERNS = [
    ("SITE", re.compile(r"(www\.|https?://|\.com|\.br\b)", re.I)),
    ("REDE_SOCIAL", re.compile(r"^@[\w.]+$|instagram|facebook", re.I)),
    ("TELEFONE", re.compile(r"\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}")),
    ("SELO_REGULAMENTAR", re.compile(r"\b(SIF|SISBI|CRT|ANTT|RNTRC)\b\s*\d*", re.I)),
    ("RAZAO_SOCIAL", re.compile(
        r"\b(LTDA|ME|EIRELI|S/?A|TRANSPORTES?|TRANSPORTADORA|LOG[ÍI]STICA|"
        r"FRIGOR[ÍI]FICO|ALIMENTOS|DISTRIBUIDORA|COM[ÉE]RCIO)\b", re.I)),
]


def classify(text: str) -> str:
    for kind, rx in PATTERNS:
        if rx.search(text.strip()):
            return kind
    return "TEXTO"


def build_pipeline():
    # O paddle despeja centenas de linhas de log no stdout ao carregar; sem isso
    # a saída JSON do probe fica impossível de pipar para jq.
    import logging
    import os
    import warnings

    warnings.filterwarnings("ignore")
    os.environ.setdefault("GLOG_minloglevel", "3")
    logging.disable(logging.INFO)

    from paddleocr import PaddleOCRVL

    return PaddleOCRVL()


def run_ocr(pipeline, img: Image.Image, offset=(0, 0)) -> list[dict]:
    """Roda o pipeline num tile e remapeia as caixas para o original.

    Formato de saída do PaddleOCR-VL 1.6 (verificado nesta máquina):
    res.json["res"]["parsing_res_list"] = [{block_content, block_bbox, block_label}]
    """
    import numpy as np

    out = []
    for res in pipeline.predict(np.array(img)):
        data = res.json.get("res", res.json)
        for block in data.get("parsing_res_list", []):
            text = (block.get("block_content") or "").strip()
            if not text:
                continue
            box = block.get("block_bbox") or []
            if len(box) == 4:
                box = [box[0] + offset[0], box[1] + offset[1],
                       box[2] + offset[0], box[3] + offset[1]]
            # O detector funde linhas vizinhas num bloco só (medido: "@frigorifico3irmaos
            # \n(48) 3658-2724" veio junto). Para o orçamento são DOIS elementos com
            # estratégias diferentes, então separa quando as linhas divergem de tipo.
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            kinds = {classify(ln) for ln in lines}
            parts = lines if len(lines) > 1 and len(kinds) > 1 else [text]

            for part in parts:
                out.append({
                    "text": part,
                    "bbox_px": [round(v) for v in box],
                    "bbox_shared": len(parts) > 1,  # caixa é do bloco pai, não da linha
                    "kind": classify(part),
                    "layout_label": block.get("block_label"),
                })
    return out


def mirror_score(pipeline, img: Image.Image) -> tuple[float, float]:
    """Soma de caracteres reconhecidos na imagem normal vs. espelhada."""
    normal = sum(len(b["text"]) for b in run_ocr(pipeline, img))
    flipped = sum(len(b["text"]) for b in run_ocr(pipeline, img.transpose(Image.FLIP_LEFT_RIGHT)))
    return normal, flipped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--max-px", type=int, default=CROP_MAX_PX)
    ap.add_argument("--no-mirror-check", action="store_true")
    args = ap.parse_args()

    original = load(args.image)
    cols, rows = auto_grid(original, args.max_px)
    print(f"[{original.size[0]}x{original.size[1]} -> grade {cols}x{rows}]", file=sys.stderr)

    pipeline = build_pipeline()
    blocks: list[dict] = []
    for t, ox, oy in tile(original, cols, rows):
        blocks.extend(run_ocr(pipeline, t, (ox, oy)))

    result: dict = {"blocks": blocks, "alerts": []}

    if not args.no_mirror_check:
        # Amostra reduzida basta: o sinal é a razão, não o valor absoluto.
        sample = original.copy()
        sample.thumbnail((1568, 1568), Image.LANCZOS)
        normal, flipped = mirror_score(pipeline, sample)
        print(f"[mirror: normal={normal} flipped={flipped}]", file=sys.stderr)
        if flipped > normal * 1.3:
            result["alerts"].append({
                "code": "TEXT_MIRRORED",
                "severity": "HIGH",
                "evidence": f"chars_flipped/{normal or 1}={flipped / (normal or 1):.2f}x",
            })

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
