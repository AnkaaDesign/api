"""Estação de marcação — servidor local, sem auth, sem deploy, offline.

    ./run.sh            # http://localhost:8790

Serve o SPA de `static/`, os planos de `runs/<versão>/` e grava as marcações em
`marks/lote-01/<slug>.json` — arquivos no repo, versionados junto com a mudança
do motor que os consumiu (`PAINTING_TEACHING_LOOP_SPEC.md` §4.3). Nenhuma
lógica de análise vive aqui.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

RAIZ = Path(__file__).resolve().parent
STATIC = RAIZ / "static"
MARKS = RAIZ / "marks" / "lote-01"
ACERVO = RAIZ.parent / "layout database"


def run_atual() -> Path:
    """A rodada mais recente com `index.json`."""
    candidatos = sorted((RAIZ / "runs").glob("*/index.json"),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidatos:
        raise SystemExit("nenhuma rodada em runs/ — rode `batch.py` antes")
    return candidatos[0].parent


class Handler(BaseHTTPRequestHandler):
    run: Path

    def log_message(self, *_args):        # silencia o log linha a linha
        pass

    # ------------------------------------------------------------ helpers --
    def _envia(self, corpo: bytes, tipo: str = "application/json", codigo: int = 200):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def _json(self, dado, codigo: int = 200):
        self._envia(json.dumps(dado, ensure_ascii=False).encode(), codigo=codigo)

    def _arquivo(self, caminho: Path):
        if not caminho.is_file():
            return self._json({"erro": f"não encontrado: {caminho.name}"}, 404)
        tipo = mimetypes.guess_type(caminho.name)[0] or "application/octet-stream"
        self._envia(caminho.read_bytes(), tipo)

    def _marcas(self, slug: str) -> dict:
        f = MARKS / f"{slug}.json"
        if f.is_file():
            return json.loads(f.read_text(encoding="utf-8"))
        return {"slug": slug, "observacoes": {}, "status": "PENDENTE"}

    # ---------------------------------------------------------------- GET --
    def do_GET(self):                                   # noqa: N802
        rota = unquote(urlparse(self.path).path)

        if rota in ("/", "/index.html"):
            return self._arquivo(STATIC / "index.html")
        if rota.startswith("/static/"):
            alvo = (STATIC / rota[len("/static/"):]).resolve()
            if STATIC.resolve() in alvo.parents:
                return self._arquivo(alvo)
            return self._json({"erro": "fora de static/"}, 403)

        if rota == "/api/index":
            indice = json.loads((self.run / "index.json").read_text(encoding="utf-8"))
            marcadas = {}
            for arte in indice["artes"]:
                m = self._marcas(arte["slug"])
                arte["marcacoes"] = len([o for o in m["observacoes"].values()
                                         if (o.get("texto") or "").strip() or o.get("verbos")])
                arte["status_marcacao"] = m.get("status", "PENDENTE")
                marcadas[arte["slug"]] = arte["marcacoes"]
            indice["totalMarcacoes"] = sum(marcadas.values())
            return self._json(indice)

        if rota.startswith("/api/art/"):
            slug = rota[len("/api/art/"):]
            plano = self.run / slug / "plan.json"
            if not plano.is_file():
                return self._json({"erro": "sem plano para esta arte"}, 404)
            dado = json.loads(plano.read_text(encoding="utf-8"))
            dado["marcas"] = self._marcas(slug)
            return self._json(dado)

        if rota.startswith("/api/params"):
            import params as PR
            return self._json({"taxas": PR.TAXAS, "materiais": PR.MATERIAIS,
                               "sistemas": {k: {kk: vv for kk, vv in v.items()}
                                            for k, v in PR.SISTEMAS.items()},
                               "doutrina": PR.DOUTRINA,
                               "mao_de_obra": PR.LABOR_HOUR_BRL})

        if rota == "/api/export":
            corpo = {"geradoEm": time.strftime("%Y-%m-%dT%H:%M:%S"),
                     "run": self.run.name,
                     "marcacoes": [json.loads(f.read_text(encoding="utf-8"))
                                   for f in sorted(MARKS.glob("*.json"))]}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition",
                             'attachment; filename="marcacoes-lote-01.json"')
            corpo_b = json.dumps(corpo, ensure_ascii=False, indent=1).encode()
            self.send_header("Content-Length", str(len(corpo_b)))
            self.end_headers()
            return self.wfile.write(corpo_b)

        if rota.startswith("/img/"):
            return self._arquivo((self.run / rota[len("/img/"):]).resolve())
        if rota.startswith("/arte/"):
            return self._arquivo((ACERVO / rota[len("/arte/"):]).resolve())

        return self._json({"erro": "rota desconhecida"}, 404)

    # --------------------------------------------------------------- POST --
    def do_POST(self):                                  # noqa: N802
        rota = unquote(urlparse(self.path).path)
        tamanho = int(self.headers.get("Content-Length") or 0)
        corpo = json.loads(self.rfile.read(tamanho) or "{}")

        if rota.startswith("/api/marks/"):
            slug = rota[len("/api/marks/"):]
            MARKS.mkdir(parents=True, exist_ok=True)
            atual = self._marcas(slug)
            atual.update({k: v for k, v in corpo.items() if k != "observacoes"})
            atual["observacoes"] = {**atual.get("observacoes", {}),
                                    **corpo.get("observacoes", {})}
            # observação esvaziada some do arquivo — o corpus não guarda vazio
            atual["observacoes"] = {
                k: v for k, v in atual["observacoes"].items()
                if (v.get("texto") or "").strip() or v.get("verbos")}
            atual["slug"] = slug
            atual["atualizadoEm"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            (MARKS / f"{slug}.json").write_text(
                json.dumps(atual, ensure_ascii=False, indent=1), encoding="utf-8")
            return self._json({"ok": True, "observacoes": len(atual["observacoes"]),
                               "atualizadoEm": atual["atualizadoEm"]})

        return self._json({"erro": "rota desconhecida"}, 404)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--run", default=None, help="pasta da rodada (default: a mais recente)")
    args = ap.parse_args()

    Handler.run = Path(args.run) if args.run else run_atual()
    indice = json.loads((Handler.run / "index.json").read_text(encoding="utf-8"))
    print(f"rodada .... {Handler.run}")
    print(f"artes ..... {indice['completaram']}/{indice['total']} com plano")
    print(f"marcações . {MARKS}")
    print(f"\n  →  http://localhost:{args.port}\n")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
