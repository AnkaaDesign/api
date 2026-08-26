#!/usr/bin/env bash
# Interface do Motor V4 — http://localhost:8765
cd "$(dirname "$0")/.."
exec .venv/bin/python ui/server.py "$@"
