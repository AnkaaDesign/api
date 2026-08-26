#!/usr/bin/env python3
"""Interface do Motor V4 — servidor local (stdlib, sem dependências).

Serve a tela do plano e a tela do passo (brief §5) sobre a saída do motor,
e recalcula um layout com edições de premissa (§6, via overrides).

Uso:
  .venv/bin/python ui/server.py [--saida saida] [--porta 8765]
  → http://localhost:8765
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "src"))

from motor import analise, faces, orcamento, overrides, plano, relatorio  # noqa: E402
from motor.cli import DB_PADRAO, _chave_layout, _face_de, _grupos  # noqa: E402
from motor.util import carregar_params  # noqa: E402

TRAVA_RECALC = threading.Lock()   # um recálculo por vez (RAM)


def _slug(nome: str) -> str:
    return nome.replace(" ", "-").replace(",", "").lower()


class App:
    def __init__(self, saida: str, db: str):
        self.saida = saida
        self.db = db
        self.params = carregar_params()
        self.grupos = _grupos(db)          # nome → [arquivos]
        self.por_slug = {_slug(n): n for n in self.grupos}

    def listar(self):
        out = []
        for nome, arquivos in sorted(self.grupos.items(), key=lambda kv: kv[0].lower()):
            slug = _slug(nome)
            caminho = os.path.join(self.saida, f"{slug}.json")
            resumo = None
            if os.path.exists(caminho):
                try:
                    d = json.load(open(caminho, encoding="utf-8"))
                    lat = d["faces"].get("lateral") or next(iter(d["faces"].values()))
                    a = lat["analise"]
                    resumo = {
                        "campo": a["campo"]["classe"],
                        "tinta_m2": a["tinta_m2_total"],
                        "fronteira_m": a["fronteira"]["total_tt_m"],
                        "n_tintas": a["paleta"]["n_tintas"],
                        "faces": sorted(d["faces"].keys()),
                        "tem_quadro": "quadro" in a,
                    }
                except Exception:
                    resumo = None
            out.append({"slug": slug, "layout": nome, "arquivos": arquivos,
                        "analisado": resumo is not None, "resumo": resumo})
        return out

    def carregar(self, slug: str):
        caminho = os.path.join(self.saida, f"{slug}.json")
        if not os.path.exists(caminho):
            return None
        return json.load(open(caminho, encoding="utf-8"))

    def recalcular(self, slug: str, ovr: dict, declarado_m: float | None):
        nome = self.por_slug.get(slug)
        if nome is None:
            raise ValueError(f"layout desconhecido: {slug}")
        arquivos = self.grupos[nome]
        with TRAVA_RECALC:
            resultados = {}
            for f in arquivos:
                a = analise.analisar_face(os.path.join(self.db, f), self.params,
                                          declarado_m=declarado_m)
                if ovr:
                    overrides.aplicar_dict(a, ovr, self.params)
                pl = plano.gerar(a, self.params)
                orc = orcamento.consolidar(a, pl, self.params)
                resultados[_face_de(f)] = {
                    "analise": analise.limpar_interno(a), "plano": pl, "orcamento": orc,
                }
            comp = None
            if "lateral" in resultados and "traseira" in resultados:
                comp = faces.comparar(resultados["lateral"]["analise"],
                                      resultados["traseira"]["analise"])
            d = {"layout": nome, "faces": resultados, "comparacao": comp,
                 "edicao": {"overrides": ovr, "declarado_m": declarado_m}}
            relatorio.salvar_json(d, os.path.join(self.saida, f"{slug}.json"))
            with open(os.path.join(self.saida, f"{slug}.ficha.md"), "w", encoding="utf-8") as fh:
                fh.write(relatorio.ficha_md(nome, resultados, comp))
            return json.load(open(os.path.join(self.saida, f"{slug}.json"), encoding="utf-8"))


APP: App = None


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _arquivo(self, caminho, ctype):
        with open(caminho, "rb") as fh:
            corpo = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        try:
            if self.path in ("/", "/index.html"):
                return self._arquivo(os.path.join(RAIZ, "ui", "index.html"),
                                     "text/html; charset=utf-8")
            if self.path == "/api/layouts":
                return self._json(APP.listar())
            if self.path.startswith("/api/layout/"):
                slug = self.path.split("/api/layout/", 1)[1]
                d = APP.carregar(slug)
                if d is None:
                    return self._json({"erro": "sem análise para este layout — rode o acervo"}, 404)
                return self._json(d)
            if self.path.startswith("/api/imagem/"):
                # miniatura da arte original (referência visual, nunca o quadro)
                nome = self.path.split("/api/imagem/", 1)[1]
                import urllib.parse
                nome = urllib.parse.unquote(nome)
                caminho = os.path.join(APP.db, nome)
                if os.path.exists(caminho) and nome.lower().endswith(".png"):
                    return self._arquivo(caminho, "image/png")
                return self._json({"erro": "imagem não encontrada"}, 404)
            return self._json({"erro": "rota desconhecida"}, 404)
        except BrokenPipeError:
            pass
        except Exception as e:
            traceback.print_exc()
            self._json({"erro": str(e)}, 500)

    def do_POST(self):
        try:
            if self.path == "/api/recalcular":
                tam = int(self.headers.get("Content-Length", 0))
                corpo = json.loads(self.rfile.read(tam) or b"{}")
                d = APP.recalcular(corpo["slug"], corpo.get("overrides") or {},
                                   corpo.get("declarado_m"))
                return self._json(d)
            return self._json({"erro": "rota desconhecida"}, 404)
        except Exception as e:
            traceback.print_exc()
            self._json({"erro": str(e)}, 500)

    def log_message(self, fmt, *args):
        sys.stderr.write("[ui] " + fmt % args + "\n")


def main():
    global APP
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", default=os.path.join(RAIZ, "saida"))
    ap.add_argument("--db", default=DB_PADRAO)
    ap.add_argument("--porta", type=int, default=8765)
    args = ap.parse_args()
    APP = App(os.path.abspath(args.saida), args.db)
    srv = ThreadingHTTPServer(("127.0.0.1", args.porta), Handler)
    print(f"Motor V4 — interface em http://localhost:{args.porta}  "
          f"(saída: {APP.saida})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
