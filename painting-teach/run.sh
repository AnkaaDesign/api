#!/usr/bin/env bash
# Estação de marcação — sobe o servidor local.
#
#   ./run.sh            # http://localhost:8790
#   ./run.sh --port 9000
#
# Usa o venv do painting-engine: o app importa o motor e o `production.py`
# direto, então não existe um segundo ambiente para divergir do primeiro.
set -euo pipefail
cd "$(dirname "$0")"
PY=../painting-engine/.venv/bin/python
[ -x "$PY" ] || { echo "falta o venv: cd ../painting-engine && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2; exit 1; }
exec "$PY" server.py "$@"
