#!/usr/bin/env python3
"""Regera as fichas .md a partir dos JSON já analisados (sem reprocessar)."""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))
from motor import relatorio  # noqa: E402

saida = sys.argv[1]
for j in glob.glob(os.path.join(saida, "*.json")):
    d = json.load(open(j, encoding="utf-8"))
    if "faces" not in d:
        continue
    md = relatorio.ficha_md(d["layout"], d["faces"], d.get("comparacao"))
    open(j.replace(".json", ".ficha.md"), "w", encoding="utf-8").write(md)
    print("ficha:", os.path.basename(j).replace(".json", ".ficha.md"))
