"""Técnica de FITA por trecho — amarela 20 mm × branca 45 mm cortada.

Regra do dono (21/08, rodada 5 — caso-régua: a onda do A&P):
- fita AMARELA (20 mm) faz curvas LEVES e traçados mais HORIZONTAIS;
  em chapa LISA (sem frisos) também faz verticais leves;
- trecho muito VERTICAL em chapa corrugada — a fita cruzaria os frisos —
  ou curva apertada, vai de fita BRANCA (45 mm) aplicada e CORTADA.

O traçado é medido no CONTORNO da forma (a fita acompanha as duas bordas da
faixa; num stencil, o contorno é o próprio risco a marcar). Cada aresta do
contorno simplificado carrega ângulo contra a horizontal e giro local
(graus/m); o agregado por substrato devolve metros de amarela × branca e o
rótulo dominante. O discriminante é geométrico, nunca o veredito decorado
(§8.4): o MESMO traçado muda de fita quando o substrato muda.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from .util import p

MAX_PONTOS_TRACADO = 700   # teto de pontos exportados para a UI, por elemento


def _classifica_arestas(pts_mm: np.ndarray, fechado: bool, params: dict):
    """Para cada aresta do polígono: (comprimento_m, classe).

    classe ∈ {"H_leve", "V_leve", "curva"}:
      - curva  = giro local acima de curva_leve_max_graus_m
      - V_leve = trecho vertical (>vertical_min_graus) de curva leve
      - H_leve = trecho horizontal/diagonal de curva leve
    """
    v_min = p(params, "fita", "vertical_min_graus")
    giro_max = p(params, "fita", "curva_leve_max_graus_m")
    n = len(pts_mm)
    if n < 2:
        return []
    arestas = []
    angs = []
    comps = []
    for i in range(n if fechado else n - 1):
        a = pts_mm[i]
        b = pts_mm[(i + 1) % n]
        dx, dy = float(b[0] - a[0]), float(b[1] - a[1])
        comp_m = math.hypot(dx, dy) / 1000.0
        ang = abs(math.degrees(math.atan2(dy, dx)))
        if ang > 90.0:
            ang = 180.0 - ang     # dobrado em [0, 90] contra a horizontal
        angs.append(ang)
        comps.append(comp_m)
    m = len(comps)
    for i in range(m):
        # giro no vértice de entrada e no de saída, rateado pela aresta
        giro = 0.0
        viz = 0
        for j in (i - 1, i + 1):
            if 0 <= j < m or fechado:
                dj = abs(angs[i] - angs[j % m])
                giro += min(dj, 180.0 - dj)
                viz += 1
        giro = giro / max(1, viz)
        taxa = giro / max(0.02, comps[i])   # graus por metro
        if taxa > giro_max:
            classe = "curva"
        elif angs[i] > v_min:
            classe = "V_leve"
        else:
            classe = "H_leve"
        arestas.append((comps[i], classe, angs[i], taxa))
    return arestas


def _decidir(m_por_classe: dict, params: dict) -> dict:
    """Metros de amarela × branca por substrato + rótulo dominante."""
    total = sum(m_por_classe.values()) or 1e-9
    dom = p(params, "fita", "dominante_frac")

    def cenario(am):
        """Rótulo + snap: elemento dominante leva TODA a metragem num tipo só
        (a equipe não troca de fita por trechos curtos); MISTA mantém a
        divisão medida."""
        f = am / total
        if f >= dom:
            return {"tecnica": "FITA_AMARELA",
                    "amarela_m": round(total, 1), "branca_m": 0.0}
        if f <= 1.0 - dom:
            return {"tecnica": "FITA_BRANCA_CORTADA",
                    "amarela_m": 0.0, "branca_m": round(total, 1)}
        return {"tecnica": "FITA_MISTA",
                "amarela_m": round(am, 1), "branca_m": round(total - am, 1)}

    # LISA: curva leve (qualquer orientação) = amarela; curva forte = branca
    am_lisa = m_por_classe.get("H_leve", 0.0) + m_por_classe.get("V_leve", 0.0)
    # CORRUGADA: só horizontal leve segue os frisos = amarela; vertical ou
    # curva forte = branca cortada
    am_corr = m_por_classe.get("H_leve", 0.0)
    return {"lisa": cenario(am_lisa), "corrugada": cenario(am_corr)}


def analisar_tracado(mask: np.ndarray, mm_px: float, params: dict,
                     origem_px: tuple[int, int] = (0, 0),
                     so_externo: bool = False) -> dict | None:
    """Perfil de fita do traçado de uma forma (faixa, filete ou stencil).

    Devolve metros por tipo de fita nos DOIS substratos + o traçado
    simplificado (mm absolutos) com a classe de cada aresta, para o quadro.

    so_externo=True (técnica FITA): a fita segue só a SILHUETA da faixa —
    furos internos (texto branco dentro da faixa do CLEBIN) são vinil de
    plotter, não fita. Num STENCIL (False) o risco marca tudo, furos
    inclusive.
    """
    eps_px = max(1.0, p(params, "fita", "simplificacao_tracado_mm") / mm_px)
    m8 = mask.astype(np.uint8)
    modo = cv2.RETR_EXTERNAL if so_externo else cv2.RETR_CCOMP
    contornos, _ = cv2.findContours(m8, modo, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        return None
    ox, oy = origem_px
    m_por_classe: dict[str, float] = {}
    tracado = []
    pontos_usados = 0
    soma_giro = 0.0
    soma_comp = 0.0
    for c in sorted(contornos, key=cv2.contourArea, reverse=True):
        if cv2.arcLength(c, True) * mm_px < 200.0:   # risco < 20 cm não decide fita
            continue
        aprox = cv2.approxPolyDP(c, eps_px, True)
        if len(aprox) < 2:
            continue
        pts_mm = (aprox.reshape(-1, 2).astype(np.float64)
                  + np.array([ox, oy], dtype=np.float64)) * mm_px
        arestas = _classifica_arestas(pts_mm, fechado=True, params=params)
        if not arestas:
            continue
        for comp_m, classe, _ang, taxa in arestas:
            m_por_classe[classe] = m_por_classe.get(classe, 0.0) + comp_m
            soma_giro += taxa * comp_m
            soma_comp += comp_m
        if pontos_usados + len(pts_mm) <= MAX_PONTOS_TRACADO:
            tracado.append({
                "pontos": [[round(float(q[0]), 1), round(float(q[1]), 1)]
                           for q in pts_mm],
                "classes": [a[1] for a in arestas],
            })
            pontos_usados += len(pts_mm)
    total = sum(m_por_classe.values())
    if total <= 0:
        return None
    frac_v = m_por_classe.get("V_leve", 0.0) / total
    out = {
        "tracado_m": round(total, 1),
        "frac_vertical": round(frac_v, 2),
        "frac_curva": round(m_por_classe.get("curva", 0.0) / total, 2),
        "giro_medio_graus_m": round(soma_giro / max(1e-9, soma_comp), 0),
        "por_substrato": _decidir(m_por_classe, params),
        "tracado": tracado,
    }
    return out
