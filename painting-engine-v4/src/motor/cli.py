"""CLI do Motor V4.

Uso:
  python -m motor.cli arte "<caminho.png>" [--out DIR]
  python -m motor.cli layout "<prefixo>" [--db DIR] [--out DIR]   # lateral+traseira
  python -m motor.cli acervo [--db DIR] [--out DIR]               # tudo, sequencial
"""
from __future__ import annotations

import argparse
import gc
import os
import sys
import traceback

from . import analise, faces, orcamento, overrides, plano, relatorio
from .util import carregar_params

DB_PADRAO = "/home/kennedy/Documents/repositories/api/layout database"


def _processar_arte(caminho: str, params: dict, arq_overrides: str | None = None) -> dict:
    a = analise.analisar_face(caminho, params)
    if arq_overrides:
        overrides.aplicar(a, arq_overrides)
    pl = plano.gerar(a, params)
    orc = orcamento.consolidar(a, pl, params)
    a_limpo = analise.limpar_interno(a)
    gc.collect()
    return {"analise": a_limpo, "plano": pl, "orcamento": orc}


def _chave_layout(nome: str) -> str:
    """Nome do grupo sem a face e sem a medida declarada.

    '100FRONTEIRAS 15,00 lateral' e '100FRONTEIRAS traseira' têm de cair no
    MESMO layout (a medida só aparece no nome da lateral).
    """
    import re
    base = os.path.splitext(nome)[0]
    for suf in (" lateral", " traseira"):
        if base.lower().endswith(suf):
            base = base[: -len(suf)]
            break
    base = re.sub(r"\s*\d{1,2}[.,]\d{2}\s*m?\s*$", "", base)
    base = re.sub(r"[-\s]\d{3,4}$", "", base)
    return base.strip()


def _grupos(db: str) -> dict[str, list[str]]:
    grupos: dict[str, list[str]] = {}
    for f in sorted(os.listdir(db)):
        if not f.lower().endswith(".png"):
            continue
        grupos.setdefault(_chave_layout(f), []).append(f)
    return grupos


def _face_de(nome: str) -> str:
    n = nome.lower()
    if "traseira" in n:
        return "traseira"
    return "lateral"


def processar_layout(nome: str, arquivos: list[str], db: str, out: str, params: dict) -> dict:
    os.makedirs(out, exist_ok=True)
    resultados: dict[str, dict] = {}
    for f in arquivos:
        print(f"  [{_face_de(f)}] {f}", flush=True)
        resultados[_face_de(f)] = _processar_arte(os.path.join(db, f), params)
    comp = None
    if "lateral" in resultados and "traseira" in resultados:
        comp = faces.comparar(resultados["lateral"]["analise"], resultados["traseira"]["analise"])
    slug = nome.replace(" ", "-").replace(",", "").lower()
    relatorio.salvar_json(
        {"layout": nome, "faces": resultados, "comparacao": comp},
        os.path.join(out, f"{slug}.json"),
    )
    with open(os.path.join(out, f"{slug}.ficha.md"), "w", encoding="utf-8") as fh:
        fh.write(relatorio.ficha_md(nome, resultados, comp))
    return {"layout": nome, "faces": resultados, "comparacao": comp}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["arte", "layout", "acervo"])
    ap.add_argument("alvo", nargs="?", default=None)
    ap.add_argument("--db", default=DB_PADRAO)
    ap.add_argument("--out", default="saida")
    ap.add_argument("--overrides", default=None,
                    help="JSON de edições manuais (rota.pontilhada: valor)")
    args = ap.parse_args(argv)
    params = carregar_params()

    if args.modo == "arte":
        r = _processar_arte(args.alvo, params, args.overrides)
        os.makedirs(args.out, exist_ok=True)
        slug = os.path.splitext(os.path.basename(args.alvo))[0].replace(" ", "-").lower()
        relatorio.salvar_json(r, os.path.join(args.out, f"{slug}.json"))
        print("ok:", os.path.join(args.out, f"{slug}.json"))
        return 0

    grupos = _grupos(args.db)
    if args.modo == "layout":
        alvo = args.alvo.lower()
        sel = {k: v for k, v in grupos.items() if alvo in k.lower()}
        if not sel:
            print("nenhum layout casa com", args.alvo)
            return 1
    else:
        sel = grupos

    falhas = []
    for nome, arquivos in sel.items():
        print(f"[{nome}]", flush=True)
        try:
            processar_layout(nome, arquivos, args.db, args.out, params)
        except Exception:
            falhas.append(nome)
            traceback.print_exc()
        gc.collect()
    if falhas:
        print("FALHAS:", falhas)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
