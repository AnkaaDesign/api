"""Probe de GROUNDING via Qwen3-VL-4B (Ollama/Metal).

Ocupa o lugar que o plano reservava ao Moondream 3: dado um vocabulário de
elementos, devolver onde cada um está. Ver README §Moondream — o `detect` do
Moondream não está disponível neste Mac.

O Qwen3-VL emite coordenadas num espaço normalizado 0–1000, NÃO em pixels da
imagem enviada. Conversão verificada nesta máquina: recortando a caixa que ele
deu para "site" na arte 137 PESCADOS (11105x3109) e passando no PaddleOCR-VL,
saiu "www.137pescados.com.b*".

Uso:
    .venv/bin/python probe/detect_qwen.py "../../layout database/AAN lateral.png"
    .venv/bin/python probe/detect_qwen.py <img> --crops out/   # salva os recortes
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import GLOBAL_MAX_TOKENS, est_tokens, fit_tokens, load  # noqa: E402
from backends import ask  # noqa: E402

VOCAB = [
    "logomarca", "slogan", "site", "telefone", "rede social",
    "selo regulamentar", "bandeira", "QR code", "bloco fotográfico", "ornamento",
]

COORD_SPACE = 1000.0  # Qwen3-VL normaliza as caixas em 0–1000

# Ele ignora o vocabulário e devolve rótulos livres ("Logo AAN Transportes",
# "Website URL (AAN)"). Normalizar aqui evita 40 valores de `kind` distintos.
LABEL_MAP = [
    # Ordem importa: o primeiro que casar vence. Categorias específicas antes
    # das genéricas, senão a rota de produção se perde no balde.
    ("SITE", ("site", "website", "url", "www")),
    ("REDE_SOCIAL", ("instagram", "facebook", "whatsapp", "rede social", "social")),
    ("TELEFONE", ("telefone", "phone", "contato", "contact")),
    ("LOGOMARCA", ("logo", "logomarca", "marca")),
    ("TAGLINE", ("tagline", "slogan", "frase", "assinatura", "descritivo")),
    ("NOME", ("nome", "wordmark", "razão", "marca escrita", "nome da empresa")),
    ("SELO_REGULAMENTAR", ("selo", "sif", "sisbi", "antt", "seal")),
    ("BANDEIRA", ("bandeira", "flag")),
    ("QR_CODE", ("qr",)),
    ("FOTOGRAFICO", ("foto", "photo", "imagem", "fotográfico")),
    # FAIXA antes de ORNAMENTO: tem rota de produção própria (fita, §4),
    # e cair no balde genérico apagava justamente essa decisão.
    ("FAIXA", ("faixa", "listra", "onda", "swoosh", "stripe")),
    ("ORNAMENTO", ("ornamento", "gráfico", "grafismo")),
]


def normalize_label(raw: str) -> str:
    low = raw.lower()
    for kind, needles in LABEL_MAP:
        if any(n in low for n in needles):
            return kind
    return "OUTRO"


def prompt_for(vocab: list[str]) -> str:
    return (
        "Localize os elementos desta arte de baú de caminhão.\n"
        "Para cada elemento encontrado devolva um objeto com:\n"
        '  "bbox_2d": [x1,y1,x2,y2] e "label"\n'
        f"Rótulos possíveis: {', '.join(vocab)}.\n"
        "Não invente elementos que não estão na imagem. Responda SOMENTE com a "
        "lista JSON."
    )


OBJ_RX = re.compile(r"\{[^{}]*?\"bbox_2d\"\s*:\s*\[[^\]]*\][^{}]*?\}", re.S)


def parse_boxes(raw: str, size: tuple[int, int]) -> list[dict]:
    """Converte a saída do modelo em caixas de pixel da imagem ORIGINAL.

    Tolera truncamento: o raciocínio interno consome o orçamento de tokens e a
    lista JSON costuma cortar no meio de um objeto. Salvar os objetos completos
    é melhor que descartar a resposta inteira — perder o último elemento é
    aceitável, perder todos não é.
    """
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    try:
        items = json.loads(cleaned)
    except json.JSONDecodeError:
        items = [json.loads(m.group(0)) for m in OBJ_RX.finditer(cleaned)]
        if items:
            print(f"[JSON truncado: {len(items)} elementos recuperados]", file=sys.stderr)

    w, h = size
    out = []
    for it in items if isinstance(items, list) else []:
        box = it.get("bbox_2d") or it.get("bbox")
        if not box or len(box) != 4:
            continue
        x1, y1, x2, y2 = box
        label = str(it.get("label", ""))
        out.append({
            "kind": normalize_label(label),
            "label_raw": label,
            "bbox_px": [
                int(x1 * w / COORD_SPACE), int(y1 * h / COORD_SPACE),
                int(x2 * w / COORD_SPACE), int(y2 * h / COORD_SPACE),
            ],
            "bbox_norm": box,
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--max-tokens", type=int, default=GLOBAL_MAX_TOKENS,
                    help="orçamento de tokens de visão do passe global")
    ap.add_argument("--crops", help="diretório para salvar os recortes em resolução original")
    ap.add_argument("--backend", default="ollama", choices=["ollama", "openrouter"])
    ap.add_argument("--model", default=None)
    args = ap.parse_args()

    original = load(args.image)
    small = fit_tokens(original, args.max_tokens)
    print(
        f"[{original.size[0]}x{original.size[1]} -> {small.size[0]}x{small.size[1]}"
        f" | ~{est_tokens(small)} tokens]",
        file=sys.stderr,
    )

    raw, secs = ask(small, prompt_for(VOCAB), backend=args.backend, model=args.model)
    print(f"[{secs:.1f}s]", file=sys.stderr)

    boxes = parse_boxes(raw, original.size)
    if not boxes:
        print("!! não consegui parsear a saída:", file=sys.stderr)
        print(raw, file=sys.stderr)
        return 1

    # Recortar no ORIGINAL é o ponto todo: o OCR precisa dos pixels que o
    # downscale para 1568 px jogou fora.
    if args.crops:
        outdir = Path(args.crops)
        outdir.mkdir(parents=True, exist_ok=True)
        for i, b in enumerate(boxes):
            crop = original.crop(tuple(b["bbox_px"]))
            if crop.size[0] < 2 or crop.size[1] < 2:
                continue
            path = outdir / f"{i:02d}_{b['kind'].lower()}.png"
            crop.save(path)
            b["crop"] = str(path)

    print(json.dumps({"elements": boxes}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
