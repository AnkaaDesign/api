"""Backends de inferência: Ollama local (Metal) ou OpenRouter (nuvem).

Mesma assinatura para os dois, então os probes não sabem onde o modelo roda.

Por que existe o backend de nuvem: neste Mac mini o Qwen3-VL-4B leva 110–175 s
por arte e o contexto padrão do Ollama não comporta artes quase-quadradas. Na
nuvem dá para rodar o 32B em segundos — e as 66 artes de validação custam
menos de US$ 0,05.
"""

from __future__ import annotations

import base64
import io
import json
import os
import time
import urllib.request

OLLAMA_URL = "http://localhost:11434/api/generate"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

DEFAULT_LOCAL = "qwen3-vl:4b"
DEFAULT_REMOTE = "qwen/qwen3-vl-32b-instruct"


def _png_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def ask_ollama(img, prompt: str, model: str = DEFAULT_LOCAL, *,
               timeout: int = 1800, num_predict: int = 4096,
               num_ctx: int = 16384) -> str:
    """Uma pergunta ao modelo local.

    Dois detalhes medidos nesta máquina, ambos causam resposta VAZIA se ignorados:
    - `think: False` NÃO desliga o raciocínio do qwen3-vl (ollama 0.32.5); ele
      continua indo para o campo `thinking` e consumindo o mesmo orçamento.
    - o contexto padrão é 4096 tokens e uma arte reduzida já ocupa ~2900,
      então sem `num_ctx` folgado não sobra espaço para gerar.
    """
    body = {
        "model": model,
        "prompt": prompt,
        "images": [base64.b64encode(_png_bytes(img)).decode()],
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": num_predict, "num_ctx": num_ctx},
    }
    req = urllib.request.Request(
        OLLAMA_URL, json.dumps(body).encode(), {"Content-Type": "application/json"}
    )
    resp = json.load(urllib.request.urlopen(req, timeout=timeout))
    text = resp["response"]
    if not text.strip():
        raise RuntimeError(
            f"resposta vazia (done_reason={resp.get('done_reason')}, "
            f"tokens={resp.get('eval_count')}, "
            f"thinking={len(resp.get('thinking') or '')} chars) — "
            f"aumente num_predict/num_ctx"
        )
    return text


def ask_openrouter(img, prompt: str, model: str = DEFAULT_REMOTE, *,
                   timeout: int = 600, max_tokens: int = 4096) -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("defina OPENROUTER_API_KEY no ambiente")

    uri = "data:image/png;base64," + base64.b64encode(_png_bytes(img)).decode()
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": uri}},
        ]}],
        "max_tokens": max_tokens,
        "temperature": 0,
    }
    req = urllib.request.Request(
        OPENROUTER_URL, json.dumps(body).encode(),
        {"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    resp = json.load(urllib.request.urlopen(req, timeout=timeout))
    if "choices" not in resp:
        raise RuntimeError(f"resposta inesperada do OpenRouter: {resp}")
    return resp["choices"][0]["message"]["content"]


def ask(img, prompt: str, *, backend: str = "ollama", model: str | None = None,
        **kw) -> tuple[str, float]:
    """Devolve (texto, segundos). `backend` ∈ {ollama, openrouter}."""
    t0 = time.time()
    if backend == "openrouter":
        text = ask_openrouter(img, prompt, model or DEFAULT_REMOTE, **kw)
    elif backend == "ollama":
        text = ask_ollama(img, prompt, model or DEFAULT_LOCAL, **kw)
    else:
        raise ValueError(f"backend desconhecido: {backend}")
    return text, time.time() - t0
