"""Probe de JULGAMENTO — inventário de elementos e alertas de produção.

Responde a rubrica das análises A–F: inventário, espelhamento, marca d'água,
logo de terceiro, arte cortada na borda. Nunca produz números de orçamento —
só rótulos e alertas que o usuário confirma ou dispensa.

Roda em qualquer backend (ver backends.py):
    .venv/bin/python probe/judge_qwen.py "../../layout database/AAN lateral.png"
    .venv/bin/python probe/judge_qwen.py <img> --backend openrouter
    .venv/bin/python probe/judge_qwen.py <img> --backend openrouter \\
        --model qwen/qwen3-vl-235b-a22b-instruct
    .venv/bin/python probe/judge_qwen.py <img> --raw   # texto livre, sem JSON
"""

from __future__ import annotations

import argparse
import json
import sys

from backends import ask
from common import GLOBAL_MAX_TOKENS, est_tokens, fit_tokens, load

SCHEMA_HINT = """Responda SOMENTE com JSON válido, sem markdown, neste formato:
{"elements":[{"kind":"...","text":"...","where":"..."}],"alerts":[{"code":"...","note":"..."}]}

kind ∈ LOGOMARCA, SLOGAN, SITE, TELEFONE, REDE_SOCIAL, RAZAO_SOCIAL,
SELO_REGULAMENTAR, BANDEIRA, QR_CODE, FOTOGRAFICO, ORNAMENTO, FAIXA_REFLETIVA
code ∈ TEXT_MIRRORED, WATERMARK, THIRD_PARTY_LOGO, ART_CROPPED_AT_EDGE, NONE
"where" = posição em palavras (ex.: "terço superior esquerdo")
text = transcrição exata, ou null se o elemento não tiver texto."""

PROMPT = """Esta é uma arte de pintura de um baú de caminhão (lateral ou traseira).
Faça o inventário dos elementos gráficos e sinalize problemas de produção.

Preste atenção especial a:
- texto espelhado (arquivo salvo invertido — erro grave, custa uma lateral inteira)
- marca d'água de banco de imagens (Shutterstock, Getty)
- logo de uma segunda empresa (frota agregada)
- arte cortada na borda do arquivo (elemento incompleto)

"""




def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--raw", action="store_true", help="texto livre em vez de JSON")
    ap.add_argument("--max-tokens", type=int, default=GLOBAL_MAX_TOKENS,
                    help="orçamento de tokens de visão do passe global")
    ap.add_argument("--backend", default="ollama", choices=["ollama", "openrouter"])
    ap.add_argument("--model", default=None)
    args = ap.parse_args()

    original = load(args.image)
    img = fit_tokens(original, args.max_tokens)
    print(
        f"[{original.size[0]}x{original.size[1]} -> {img.size[0]}x{img.size[1]}"
        f" | ~{est_tokens(img)} tokens de visão]",
        file=sys.stderr,
    )

    prompt = PROMPT + ("" if args.raw else SCHEMA_HINT)
    out, secs = ask(img, prompt, backend=args.backend, model=args.model)
    print(f"[{secs:.1f}s]", file=sys.stderr)

    if args.raw:
        print(out)
        return 0

    # O modelo às vezes embrulha em ```json — descasca antes de parsear.
    cleaned = out.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    try:
        print(json.dumps(json.loads(cleaned), ensure_ascii=False, indent=2))
    except json.JSONDecodeError:
        print("!! JSON inválido, saída crua abaixo", file=sys.stderr)
        print(out)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
