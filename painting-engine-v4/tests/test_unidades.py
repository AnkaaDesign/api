"""Testes de unidade dos invariantes que já derrubaram versões do motor."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from motor import escala, fronteira, io_arte, paleta  # noqa: E402
from motor.cor import delta_e, srgb_para_lab  # noqa: E402
from motor.util import carregar_params  # noqa: E402

PARAMS = carregar_params()


def test_delta_e_pretos_aan_fundem_e_azuis_137_nao():
    # os dois pretos do AAN (ΔE 3,06) são a mesma tinta; o par mais próximo
    # dos 5 azuis do 137 (ΔE ~5) são tintas diferentes — limiar 4
    preto1 = srgb_para_lab(np.array([0x20, 0x1F, 0x1F]))
    preto2 = srgb_para_lab(np.array([0x1B, 0x19, 0x18]))
    azul1 = srgb_para_lab(np.array([0x23, 0x53, 0x93]))
    azul2 = srgb_para_lab(np.array([0x1D, 0x47, 0x85]))
    assert float(delta_e(preto1, preto2)) < 4.0
    assert float(delta_e(azul1, azul2)) > 4.0


def test_fusao_de_sementes_nao_encadeia():
    # A~B e B~C não pode juntar A e C (armadilha 3.6): cadeia de tons a ΔE ~3
    # entre vizinhos, extremos distantes → mais de um grupo
    tons = [(40, 40, 40), (46, 46, 46), (52, 52, 52), (58, 58, 58),
            (64, 64, 64), (70, 70, 70)]
    cores = np.array([r << 16 | g << 8 | b for r, g, b in tons], dtype=np.uint32)
    massas = np.array([100] * len(tons))
    grupos = paleta._fundir_sementes(cores, massas, 4.0)
    assert len(grupos) >= 2, "cadeia transitiva juntou extremos a ΔE alto"


def test_fronteira_crofton_e_filete():
    # duas tintas separadas por filete do CAMPO não se tocam
    labels = np.zeros((10, 30), dtype=np.int16)
    labels[:, 0:10] = 1
    labels[:, 10:11] = 0   # filete de campo de 1 px
    labels[:, 11:30] = 2
    fron = fronteira.medir(labels, campo_id=0, mm_px=1.0, params=PARAMS)
    assert fron["total_tt_m"] == 0.0, "detector saltou o filete"
    # sem filete, o contato existe e leva correção π/4
    labels[:, 10:11] = 2
    fron = fronteira.medir(labels, campo_id=0, mm_px=1.0, params=PARAMS)
    assert 0 < fron["total_tt_m"] <= 0.01  # 10 px × π/4 mm


def test_escala_declarada_rejeitada_no_portao():
    # traseira quadrada com "8,30m" no nome: cai para altura-datum + diverge
    r = escala.resolver(2838, 2838, 8.30, PARAMS)
    assert "rejeitada" in r["fonte"]
    assert abs(r["painel_mm"]["h"] - 2450) < 5
    assert any(d["tipo"] == "escala-declarada-rejeitada" for d in r["divergencias"])


def test_medida_declarada_do_nome():
    assert io_arte.medida_declarada("ACM 8,30m lateral.png") == 8.30
    assert io_arte.medida_declarada("100FRONTEIRAS 15,00 lateral.png") == 15.0
    assert io_arte.medida_declarada("BURES 2 8.40.png") == 8.40
    assert io_arte.medida_declarada("BOI MIX-1470 lateral.png") == 14.70
    assert io_arte.medida_declarada("AKTL.png") is None


def test_moldura_uniforme_e_antialias():
    # moldura vermelha de 3 px + 1 px de antialias não pode sobrar
    rgb = np.full((100, 200, 3), 255, dtype=np.uint8)
    rgb[:3, :] = [200, 0, 0]
    rgb[-3:, :] = [200, 0, 0]
    rgb[:, :3] = [200, 0, 0]
    rgb[:, -3:] = [200, 0, 0]
    rgb[3, :] = [230, 128, 128]   # antialias
    saida, lados = io_arte.remover_moldura(rgb)
    assert lados["topo"] >= 4 and lados["base"] >= 3
    # campo branco intacto (não comeu colunas de campo)
    assert saida.shape[0] > 90 and (saida == 255).all()


def test_fita_por_trecho_e_substrato():
    # R5 (dono): banda vertical de curva leve — amarela na LISA (vertical
    # leve), branca cortada na CORRUGADA (vertical cruza os frisos)
    import cv2
    from motor import fita
    m = np.zeros((3000, 400), dtype=bool)
    xs = (150 + 80 * np.sin(np.arange(3000) / 3000 * 3.14)).astype(int)
    for y in range(3000):
        m[y, xs[y]:xs[y] + 120] = True
    r = fita.analisar_tracado(m, mm_px=1.0, params=PARAMS)
    assert r is not None
    assert r["por_substrato"]["lisa"]["tecnica"] == "FITA_AMARELA"
    assert r["por_substrato"]["corrugada"]["tecnica"] == "FITA_BRANCA_CORTADA"
    # banda HORIZONTAL de curva leve: amarela nos DOIS substratos
    r2 = fita.analisar_tracado(m.T.copy(), mm_px=1.0, params=PARAMS)
    assert r2["por_substrato"]["lisa"]["tecnica"] == "FITA_AMARELA"
    assert r2["por_substrato"]["corrugada"]["tecnica"] == "FITA_AMARELA"


def test_folha_divide_pelo_rabo_do_g():
    # R2-7 refinada: texto com banda de altura dominante e UM descensor
    # pequeno — a folha divide (corpo + saliência) e economiza filme
    from motor import adesivos
    mapa = np.zeros((760, 4200), dtype=np.int32)
    mapa[100:400, 100:4100] = 7          # corpo do texto (banda de 300 mm)
    mapa[400:700, 2000:2160] = 7         # rabo do g: 160 mm de largura descendo 300
    grupo = [{"elemento": 7, "tipo": "TEXTO", "x": 100.0, "y": 100.0,
              "w": 4000.0, "h": 600.0, "area_m2": 1.25, "membros": {7}}]
    folhas, eco = adesivos._folhas_por_conteudo(grupo, mapa, 1.0, PARAMS, 80.0)
    assert folhas, "não dividiu a folha do descensor"
    partes = {f["parte"].split(" ")[0] for f in folhas}
    assert "corpo" in partes and any("saliência" in f["parte"] for f in folhas)
    assert eco > 0.4, f"economia esperada >0,4 m², veio {eco}"
    # SEM parte saliente (banda uniforme): não divide
    mapa2 = np.zeros((760, 4200), dtype=np.int32)
    mapa2[100:700, 100:4100] = 7
    grupo2 = [{"elemento": 7, "tipo": "TEXTO", "x": 100.0, "y": 100.0,
               "w": 4000.0, "h": 600.0, "area_m2": 2.4, "membros": {7}}]
    folhas2, eco2 = adesivos._folhas_por_conteudo(grupo2, mapa2, 1.0, PARAMS, 80.0)
    assert not folhas2, "dividiu folha sem saliência"


def test_folha_nao_divide_parte_grande():
    # "isso não será sempre — só quando partes PEQUENAS saem da média":
    # metade da largura descendo não é saliência, é o formato do conteúdo
    from motor import adesivos
    mapa = np.zeros((760, 4200), dtype=np.int32)
    mapa[100:400, 100:4100] = 7
    mapa[400:700, 100:2200] = 7          # metade esquerda inteira desce
    grupo = [{"elemento": 7, "tipo": "TEXTO", "x": 100.0, "y": 100.0,
              "w": 4000.0, "h": 600.0, "area_m2": 1.9, "membros": {7}}]
    folhas, eco = adesivos._folhas_por_conteudo(grupo, mapa, 1.0, PARAMS, 80.0)
    assert not folhas, "parte de 52%% da largura virou 'saliência'"
