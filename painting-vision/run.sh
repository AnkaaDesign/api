#!/usr/bin/env bash
# Wrapper dos probes de visão — escolhe o venv certo para cada modelo.
#
#   ./run.sh judge  "../../layout database/AAN lateral.png"
#   ./run.sh detect "../../layout database/AAN lateral.png" --crops /tmp/crops
#   ./run.sh ocr    "../../layout database/AAN lateral.png"
#   ./run.sh chain  "../../layout database/AAN lateral.png"   # detect -> crop -> ocr
#
# São DOIS ambientes por necessidade: o pipeline do PaddleOCR exige
# paddlepaddle, cuja pilha de dependências conflita com a do MLX.
set -euo pipefail
cd "$(dirname "$0")"

MLX=.venv/bin/python
PADDLE=.venv-paddle/bin/python
if [ $# -lt 1 ]; then
  echo "uso: run.sh {judge|detect|ocr|chain} <imagem> [args...]" >&2
  exit 2
fi
CMD=$1
shift

# Metal e Ollama disputam os mesmos 8 GB: descarrega o Qwen antes de qualquer
# passo MLX, senão dá "Insufficient Memory" no meio da geração.
unload_ollama() { ollama stop qwen3-vl:4b >/dev/null 2>&1 || true; }

case "$CMD" in
  judge)  exec $MLX probe/judge_qwen.py "$@" ;;
  detect) exec $MLX probe/detect_qwen.py "$@" ;;
  ocr)    unload_ollama; exec $PADDLE probe/ocr_paddle.py "$@" ;;
  chain)
    IMG=$1; shift
    OUT=$(mktemp -d)
    echo "== 1/2 grounding (Qwen3-VL) ==" >&2
    $MLX probe/detect_qwen.py "$IMG" --crops "$OUT" > "$OUT/elements.json"
    unload_ollama
    echo "== 2/2 OCR dos recortes (PaddleOCR-VL) ==" >&2
    $PADDLE probe/ocr_crops.py "$OUT/elements.json"
    ;;
  *) echo "comando desconhecido: $CMD" >&2; exit 2 ;;
esac
