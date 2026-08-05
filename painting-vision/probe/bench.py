"""Compara modelos na MESMA arte, com custo e tempo reais.

Existe para responder uma pergunta de hardware, não de curiosidade: o
Qwen3-VL-32B em Q4 ocupa ~18-19 GB e NÃO cabe numa placa de 16 GB. Se o 8B
chegar perto do 32B na rubrica das análises A–F, uma RTX 5060 Ti resolve; se
não chegar, o caminho é 24 GB. Descobrir isso custa centavos.

Uso:
    source <scratchpad>/or.env
    .venv/bin/python probe/bench.py "../../layout database/AAN lateral.png"
    .venv/bin/python probe/bench.py <img1> <img2> --out resultados/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from backends import ask  # noqa: E402
from common import GLOBAL_MAX_PX, est_tokens, fit, load  # noqa: E402
from judge_qwen import PROMPT, SCHEMA_HINT  # noqa: E402

# (rótulo, backend, model, US$/M entrada, US$/M saída) — preços de ago/2026
CANDIDATES = [
    ("local-4b", "ollama", "qwen3-vl:4b", 0.0, 0.0),
    ("or-8b", "openrouter", "qwen/qwen3-vl-8b-instruct", 0.12, 0.45),
    ("or-32b", "openrouter", "qwen/qwen3-vl-32b-instruct", 0.10, 0.42),
    ("or-235b", "openrouter", "qwen/qwen3-vl-235b-a22b-instruct", 0.21, 1.90),
]


def parse(raw: str) -> dict | None:
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", help="diretório para gravar as respostas completas")
    ap.add_argument("--only", nargs="*", help="rodar só estes rótulos (ex.: or-8b or-32b)")
    args = ap.parse_args()

    cands = [c for c in CANDIDATES if not args.only or c[0] in args.only]
    outdir = Path(args.out) if args.out else None
    if outdir:
        outdir.mkdir(parents=True, exist_ok=True)

    prompt = PROMPT + SCHEMA_HINT
    total_cost = 0.0

    for path in args.images:
        img = fit(load(path), GLOBAL_MAX_PX)
        tok_in = est_tokens(img) + 200  # imagem + prompt
        print(f"\n=== {Path(path).name}  ({img.size[0]}x{img.size[1]}, ~{tok_in} tok) ===")

        for label, backend, model, p_in, p_out in cands:
            try:
                raw, secs = ask(img, prompt, backend=backend, model=model)
            except Exception as exc:  # rede, OOM, cota — segue para o próximo
                print(f"  {label:<10} FALHOU: {str(exc)[:110]}")
                continue

            data = parse(raw)
            tok_out = len(raw) // 4  # estimativa; o custo aqui é dominado pela entrada
            cost = (tok_in * p_in + tok_out * p_out) / 1e6
            total_cost += cost

            if data is None:
                print(f"  {label:<10} {secs:6.1f}s  JSON inválido")
            else:
                els = data.get("elements", [])
                alerts = [a.get("code") for a in data.get("alerts", []) if a.get("code") != "NONE"]
                kinds = ", ".join(sorted({e.get("kind", "?") for e in els}))
                print(f"  {label:<10} {secs:6.1f}s  US${cost:.5f}  "
                      f"{len(els):2d} elementos  alertas={alerts or '—'}")
                print(f"             tipos: {kinds}")

            if outdir:
                stem = Path(path).stem.replace(" ", "_")
                (outdir / f"{stem}__{label}.json").write_text(raw)

    print(f"\ncusto total desta rodada: US$ {total_cost:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
