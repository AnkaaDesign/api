"""F1 — roda o motor + o plano nas 66 artes do acervo.

    .venv/bin/python batch.py                 # tudo
    .venv/bin/python batch.py --only BURES    # filtra pelo nome
    .venv/bin/python batch.py --workers 3

Saída em `runs/<engineVersion>/`: uma pasta por arte com `analysis.json`,
`plan.json` e as imagens dos passos, mais `index.json` (o snapshot de corpus do
`PAINTING_TEACHING_LOOP_SPEC.md` §8.1) — que é o que responde **B3**: em
quantas das 66 o pipeline completa.

O diretório `runs/` é gerado e não vai para o git; `marks/` é que é versionado.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import traceback
import unicodedata
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ACERVO = RAIZ.parent / "layout database"
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ.parent / "painting-engine" / "src"))

# A altura de 2,45 m é o padrão do baú e serve de referência de escala — é o que
# resolve as 56 artes cujo nome não traz o comprimento (README do acervo).
REF_KIND = "HEIGHT"
REF_CM = 245.0


def slug(nome: str) -> str:
    base = unicodedata.normalize("NFKD", Path(nome).stem)
    base = base.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()


def uma(arte: Path, destino: Path) -> dict:
    """Roda motor + plano numa arte. Nunca levanta: devolve o erro no dict."""
    t0 = time.time()
    sys.path.insert(0, str(RAIZ))
    sys.path.insert(0, str(RAIZ.parent / "painting-engine" / "src"))
    registro = {"arte": arte.name, "slug": slug(arte.name), "ok": False}
    try:
        from painting_engine.params import EngineParams
        from painting_engine.pipeline import run_pipeline
        import plan

        pasta = destino / registro["slug"]
        pasta.mkdir(parents=True, exist_ok=True)
        analysis = run_pipeline(image_path=str(arte), reference_kind=REF_KIND,
                                reference_value_cm=REF_CM, params=EngineParams.from_dict(None),
                                stages=None, sessions=None)
        (pasta / "analysis.json").write_text(
            json.dumps(analysis, ensure_ascii=False), encoding="utf-8")

        rep = plan.build(analysis, str(arte), pasta)
        rep["slug"] = registro["slug"]
        (pasta / "plan.json").write_text(
            json.dumps(rep, ensure_ascii=False, indent=1, default=float), encoding="utf-8")

        registro.update({
            "ok": True,
            "segundos": round(time.time() - t0, 1),
            "engineVersion": analysis.get("engineVersion"),
            "comprimento_cm": analysis["image"]["widthCm"],
            "altura_cm": analysis["image"]["heightCm"],
            "area_m2": analysis["image"]["areaM2"],
            "fundo": analysis["background"]["mode"],
            "cobertura_fundo": analysis["background"]["coveragePct"],
            "cores": len(analysis["palette"]),
            "regioes": len(analysis["regions"]),
            "fronteiras_tt": sum(1 for b in analysis["boundaries"]
                                 if b["kind"] == "PAINT_PAINT"),
            "elementos": len(rep["elementos"]),
            "descartados": len(rep["descartados"]),
            "faixas": sum(1 for e in rep["elementos"] if e["tipo"] == "FAIXA"),
            "aerografias": sum(1 for e in rep["elementos"] if e["tipo"] == "AEROGRAFIA"),
            "sessoes": len(rep["sessoes"]),
            "passos": len(rep["passos"]),
            "minutos": rep["totais"]["minutos"],
            "rotas": sorted({e["rota"] for e in rep["elementos"]}),
            "alertas": [a["code"] for a in rep["alertas"]],
        })
    except Exception as erro:                     # noqa: BLE001 — o lote não pode parar
        registro.update({"erro": f"{type(erro).__name__}: {erro}",
                         "traceback": traceback.format_exc()[-1800:],
                         "segundos": round(time.time() - t0, 1)})
    return registro


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="filtra artes pelo nome")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default=None, help="pasta de saída (default runs/<versão>)")
    args = ap.parse_args()

    artes = sorted(p for p in ACERVO.glob("*.png")
                   if not args.only or args.only.lower() in p.name.lower())
    if not artes:
        print("nenhuma arte encontrada", file=sys.stderr)
        return 1

    from painting_engine import ENGINE_VERSION as versao
    destino = Path(args.out) if args.out else RAIZ / "runs" / versao
    destino.mkdir(parents=True, exist_ok=True)
    print(f"{len(artes)} arte(s) → {destino}  ({args.workers} processos)", file=sys.stderr)

    registros, t0 = [], time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futuros = {pool.submit(uma, a, destino): a for a in artes}
        for i, f in enumerate(as_completed(futuros), start=1):
            r = f.result()
            registros.append(r)
            marca = "ok " if r["ok"] else "ERRO"
            extra = (f"{r['elementos']:>3} el · {r['passos']:>2} passos · "
                     f"{r['minutos'] / 60:>5.1f} h" if r["ok"] else r.get("erro", "")[:70])
            print(f"[{i:>2}/{len(artes)}] {marca} {r['arte'][:44]:<44} {extra}",
                  file=sys.stderr, flush=True)

    registros.sort(key=lambda r: r["arte"])
    ok = [r for r in registros if r["ok"]]
    indice = {
        "engineVersion": versao,
        "referencia": f"{REF_KIND} {REF_CM:.0f} cm",
        "geradoEm": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "segundos": round(time.time() - t0, 1),
        "total": len(registros),
        "completaram": len(ok),
        "falharam": len(registros) - len(ok),
        "artes": registros,
    }
    (destino / "index.json").write_text(
        json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nB3: {len(ok)}/{len(registros)} completaram o pipeline "
          f"em {indice['segundos'] / 60:.1f} min", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
