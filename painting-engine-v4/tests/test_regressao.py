"""Regressão: roda o comparador sobre a saída mais recente.

Requer uma pasta de saída gerada antes:
  PYTHONPATH=src .venv/bin/python -m motor.cli acervo --out saida
  .venv/bin/pytest tests/ -q               # usa SAIDA=saida por padrão
"""
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_regressao():
    saida = os.environ.get("SAIDA", os.path.join(RAIZ, "saida"))
    if not os.path.isdir(saida):
        import pytest
        pytest.skip("sem pasta de saída — rode o motor antes")
    r = subprocess.run(
        [sys.executable, os.path.join(RAIZ, "tools", "comparar.py"), "--saida", saida],
        capture_output=True, text=True,
    )
    print(r.stdout[-4000:])
    assert r.returncode == 0, "há FAIL na regressão — ver relatório acima"
