"""Regressão do catálogo de casos (`api/PAINTING_CASE_CATALOG.md`).

Cada teste referencia o ID do caso. A regra é simples: **nenhuma correção pode
deixar um caso verde vermelho.** Foi exatamente assim que os defeitos se
acumularam — a frase de prompt que separou o "BURES" da tagline fatiou a
logomarca da "mar e rio"; a fusão de tons que juntou os 3 azuis da BURES
encadeou 6 azuis do 137 até ΔE 39,6.

Roda sem rede: consome os JSON já gerados pelo motor em `fixtures/`. Só os
testes marcados `@pytest.mark.vlm` chamam o Qwen.

    .venv/bin/python -m pytest tests/ -q
    .venv/bin/python -m pytest tests/ -q -m "not vlm"
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "probe"))
FIXTURES = ROOT / "tests" / "fixtures"

from production import (_lab, GRADIENT_DELTA_E, MULTI, merge_gradient,  # noqa: E402
                        route, verticality_deg)


def engine(nome: str) -> dict:
    p = FIXTURES / f"{nome}.json"
    if not p.exists():
        pytest.skip(f"fixture ausente: {p.name} — gere com painting_engine.cli")
    return json.loads(p.read_text())


# ---------------------------------------------------------------- F: fundo --

def test_F1_bures_e_chapa_branca():
    """F1 — chapa branca domina: sem lavagem, empapelamento localizado."""
    d = engine("bures")
    assert d["background"]["mode"] == "WHITE_PLATE"
    assert d["background"]["coveragePct"] > 0.5


def test_F2_pintura_geral_reconhecida():
    """F2 — 137 PESCADOS e mar e rio têm pintura geral."""
    for nome in ("p137", "marerio"):
        assert engine(nome)["background"]["mode"] == "GENERAL_PAINT"


def test_F3_branco_nunca_e_elemento_de_tinta():
    """F3 — regiões de fundo não entram como tinta a orçar."""
    for nome in ("bures", "p137", "marerio"):
        for r in engine(nome)["regions"]:
            if r["is_background"]:
                assert r["kind"] in ("RESERVA", "CHAPADA", "MICRO", "FOTOGRAFICO")


# ------------------------------------------------------------ B: fronteiras --

def test_B2_137_tem_tt_entre_azuis_do_desenho():
    """B2 — os triângulos low-poly se tocam: T-T real, não artefato."""
    d = engine("p137")
    pp = [b for b in d["boundaries"] if b["kind"] == "PAINT_PAINT"]
    assert pp, "nenhuma fronteira tinta-tinta no mosaico do 137"


def test_B3_pintura_geral_nao_conta_como_tt():
    """B3 — encostar na geral (curada do dia anterior) não é T-T.

    Sem isto o 137 jogava os 7 elementos na rota de verniz + espera.
    """
    d = engine("p137")
    reg = {r["id"]: r for r in d["regions"]}
    bg = d["background"]["hex"]
    for b in d["boundaries"]:
        if b["kind"] != "PAINT_PAINT":
            continue
        assert bg not in (reg[b["a"]]["hex"], reg[b["b"]]["hex"]), (
            "fronteira com o campo classificada como tinta-tinta")


# --------------------------------------------------------- D: degradê -------

def test_D4_fusao_nao_encadeia_transitivamente():
    """D4 — A~B e B~C não pode juntar A e C se A e C estão longe.

    Regressão do bug real: 6 azuis do 137 a ΔE 7,5-8,9 consecutivos foram
    encadeados num tom só, com extremos a ΔE 39,6, e o plano os descreveu como
    "bandas do mockup, não máscaras" — o oposto do que são.
    """
    d = engine("p137")
    canon = merge_gradient(d["regions"], d["boundaries"])
    grupos: dict[str, list[str]] = {}
    for tom, c in canon.items():
        grupos.setdefault(c, []).append(tom)
    for c, tons in grupos.items():
        reais = [t for t in tons if t != MULTI]
        for i in range(len(reais)):
            for j in range(i + 1, len(reais)):
                de = float(np.linalg.norm(_lab(reais[i]) - _lab(reais[j])))
                assert de <= GRADIENT_DELTA_E * 1.5, (
                    f"{reais[i]} e {reais[j]} fundidos com ΔE {de:.1f}")


# -------------------------------------------------------------- T: fita -----

@pytest.mark.parametrize("substrato,vert,esperado", [
    ("ISOPLASTIC", 89.0, "FITA_AMARELA"),   # T1: curva não importa
    ("LONA", 89.0, "FITA_AMARELA"),         # T1
    ("CHAPA", 10.0, "FITA_AMARELA"),        # T2: traçado tranquilo
    ("CHAPA", 80.0, "FITA_BRANCA"),         # T3: muito vertical
])
def test_T1_T3_regra_da_fita(substrato, vert, esperado):
    """T1-T3 — substrato E verticalidade, não só substrato.

    A doutrina já disse "amarela só em isoplastic/lona"; era generalização
    errada. Em chapa com curva tranquila a amarela passa — caso da BURES.
    """
    el = {"tipo": "FAIXA", "verticalidade_deg": vert, "toca_tinta": True,
          "menor_traco_mm": 50.0}
    assert route(el, substrato)[0] == esperado


# --------------------------------------------------- A: aerografia ----------

def test_A1_zona_fotografica_vira_aerografia_nunca_impresso():
    """A1 — o polvo da mar e rio é aerografia."""
    d = engine("marerio")
    foto = [r for r in d["regions"] if r["kind"] == "FOTOGRAFICO"]
    assert foto, "nenhuma zona fotográfica detectada na mar e rio"
    assert any(r["hex"] == MULTI for r in foto)


def test_A4_aerografia_nao_e_rota_de_adesivo():
    """A4 — aerografia é técnica de pintura; a rota do adesivo segue as regras.

    Enquanto era rota irmã, o polvo ficava incapaz de tocar tinta e perdia
    28,59 m de fronteira T-T com 4 cores do desenho.
    """
    el = {"tipo": "AEROGRAFIA", "aerografia": True, "toca_tinta": True,
          "menor_traco_mm": 40.0, "verticalidade_deg": 20.0, "campo": "CHAPA"}
    rota = route(el, "CHAPA")[0]
    assert rota != "CORTE_MANUAL", "A5 — contorno de aerografia sai no plotter"


# ------------------------------------------------------- C: cortabilidade ---

def test_C1_sem_tt_nunca_corta_a_mao():
    """C1 — sem duas cores do desenho se tocando, não há corte manual."""
    for campo, esperado in (("CHAPA", "ADESIVO_SOBRE_CHAPA"),
                            ("PINTURA_GERAL", "ADESIVO_SOBRE_GERAL")):
        el = {"tipo": "NOME", "toca_tinta": False, "menor_traco_mm": 40.0,
              "verticalidade_deg": 20.0, "campo": campo}
        assert route(el, "CHAPA")[0] == esperado


def test_C4_C5_limiar_de_14mm():
    """C4/C5 — ≥14 mm corta; abaixo não há evidência, cai na rota conservadora."""
    base = {"tipo": "NOME", "toca_tinta": True, "verticalidade_deg": 20.0,
            "campo": "CHAPA"}
    assert route({**base, "menor_traco_mm": 20.0}, "CHAPA")[0] == "CORTE_MANUAL"
    assert route({**base, "menor_traco_mm": 6.0}, "CHAPA")[0] == "ADESIVO_SOBRE_VERNIZ"


# ------------------------------------------------------- G: geometria -------

def test_G5_altura_padrao_245():
    """G5 — 2,45 m de altura é o padrão e serve de referência de escala."""
    for nome in ("p137", "marerio"):
        assert abs(engine(nome)["image"]["heightCm"] - 245.0) < 1.0


def test_verticalidade_deitada_e_zero():
    """Regressão: a primeira versão dava 88-90° em ondas horizontais."""
    m = np.zeros((200, 800), dtype=bool)
    m[95:105, 50:750] = True
    assert verticality_deg(m) < 15.0

    v = np.zeros((800, 200), dtype=bool)
    v[50:750, 95:105] = True
    assert verticality_deg(v) > 75.0
