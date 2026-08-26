"""Zonas contínuas: DEGRADÊ × AEROGRAFIA — e o motor SEMPRE reporta degradê.

Achatar é edição humana negociada com o cliente; nunca decisão do motor (G5).

- DEGRADÊ = rampa: L* bem explicado por plano (R² alto) e poucos matizes.
  Executa-se pintando 2–3 tons CHAPADOS e esfumando a separação.
  2 tons: mesma cor clareando/escurecendo · 3 tons: atravessa para outra cor.
  (Sem limiar calibrado — não existe caso de 3 tons no acervo: vira pergunta.)
- AEROGRAFIA = tom contínuo/fotográfico: R² baixo + entropia de matiz alta.
  Leva adesivo SÓ do contorno externo. REGRA 21/08: é o PRIMEIRO trabalho de
  arte e depois é coberta com fita nas bordas + papel no centro.
- Split interno (D3): parte chapada + parte em rampa = máscara dentro da
  máscara (caso "Frutícula 2 Amigos").
"""
from __future__ import annotations

import cv2
import numpy as np

from .cor import croma, matiz_graus, srgb_para_lab
from .util import hex_de, p


def _amostrar(mask: np.ndarray, rgb: np.ndarray, max_px: int = 200_000):
    ys, xs = np.nonzero(mask)
    if ys.size > max_px:
        sel = np.random.default_rng(7).choice(ys.size, max_px, replace=False)
        ys, xs = ys[sel], xs[sel]
    lab = srgb_para_lab(rgb[ys, xs])
    return ys.astype(np.float32), xs.astype(np.float32), lab, rgb[ys, xs]


def analisar_zona(mask: np.ndarray, rgb: np.ndarray, mm_px: float, params: dict) -> dict:
    ys, xs, lab, rgbs = _amostrar(mask, rgb)
    L = lab[:, 0]
    area_mm2 = float(mask.sum()) * mm_px * mm_px

    # sombra/halo suave: zona FINA que abraça formas — a separação é esfumada,
    # nunca cortada (B5). Espessura pela corrida perpendicular.
    m8 = mask.astype(np.uint8)
    dt = cv2.distanceTransform(m8, cv2.DIST_L2, 3)
    esp_mm = float(np.median(dt[dt > 0.5])) * 2.0 * mm_px if (dt > 0.5).any() else 0.0
    del dt
    perim_px = float(cv2.countNonZero(cv2.morphologyEx(
        m8, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))))
    finura = perim_px * mm_px / max(1.0, area_mm2 ** 0.5)  # quão "casca" a zona é
    # teto de ÁREA da sombra: "sombra" de 2,9 m² não é halo — é um campo de
    # brilho/rampa (o glow do lockup do argus) e cai nos testes de baixo
    if (esp_mm < p(params, "degrade", "sombra_espessura_max_mm")
            and finura > p(params, "degrade", "sombra_finura_min")
            and area_mm2 <= p(params, "degrade", "sombra_area_max_m2") * 1e6):
        rgb_medio = rgbs.mean(axis=0).astype(int)
        return {
            "tipo": "SOMBRA_SUAVE",
            "area_m2": round(area_mm2 / 1e6, 3),
            "espessura_mm": round(esp_mm, 1),
            "r2_rampa": None,
            "entropia_matiz_bits": None,
            "lab_media": lab.mean(axis=0).tolist(),
            "hex_medio": hex_de(int(rgb_medio[0]) << 16 | int(rgb_medio[1]) << 8 | int(rgb_medio[2])),
            "nota": (
                "banda contínua fina abraçando formas — sombra/halo esfumado; "
                "não gera corte à mão; executar (esfumar) ou achatar é pergunta"
            ),
        }

    # ajuste planar L* = a·x + b·y + c
    A = np.stack([xs, ys, np.ones_like(xs)], axis=1)
    sol, *_ = np.linalg.lstsq(A, L, rcond=None)
    pred = A @ sol
    ss_res = float(np.sum((L - pred) ** 2))
    ss_tot = float(np.sum((L - L.mean()) ** 2)) or 1e-9
    r2 = 1.0 - ss_res / ss_tot

    # entropia de matiz: 36 caixas de matiz (onde há croma) + 1 caixa
    # acromática. Fotográfico espalha matiz; rampa é mono-matiz (e rampa de
    # CINZA é acromática pura — o matiz de cinza é ruído e não conta)
    cr = croma(lab)
    com_croma = cr > 8.0
    hist = np.zeros(37)
    hist[36] = float((~com_croma).sum())
    if com_croma.any():
        hu = matiz_graus(lab[com_croma])
        h36, _ = np.histogram(hu, bins=36, range=(0, 360))
        hist[:36] = h36
    pph = hist / max(1.0, hist.sum())
    pph = pph[pph > 0]
    entropia = float(-(pph * np.log2(pph)).sum())

    r2_min = p(params, "aerografia", "r2_rampa_min")
    ent_max = p(params, "aerografia", "hue_entropia_min_bits")
    # AEROGRAFIA: matiz espalhado (fotográfico colorido) OU tom contínuo
    # GRANDE que nenhum plano explica (o polvo é quase mono-matiz — salmão —
    # com R² 0,06 em 2,9 m²). Rampa multi-letra pequena (AAN) continua
    # DEGRADÊ: R² baixo mas área pequena.
    # Antes de declarar aerografia por "plano não explica": uma rampa CURVA
    # (a estrada do SGT, um glow radial) não é plana mas é SUAVE — a
    # quadrática explica. Textura fotográfica (polvo, carne) não é explicada
    # nem pela quadrática → aí sim é arte à mão livre.
    tipo = "DEGRADE"
    if entropia >= ent_max and r2 < r2_min:
        tipo = "AEROGRAFIA"
    elif r2 < 0.35 and area_mm2 >= 0.5e6:
        def _r2_quad(xs_, ys_, L_):
            Aq = np.stack([xs_, ys_, xs_ * xs_, xs_ * ys_, ys_ * ys_,
                           np.ones_like(xs_)], axis=1)
            solq, *_ = np.linalg.lstsq(Aq, L_, rcond=None)
            ss_res_q = float(np.sum((L_ - Aq @ solq) ** 2))
            ss_tot_q = float(np.sum((L_ - L_.mean()) ** 2)) or 1e-9
            return 1.0 - ss_res_q / ss_tot_q
        r2_quad = _r2_quad(xs, ys, L)
        if r2_quad < p(params, "aerografia", "r2_quad_min"):
            # R5 — VETO DE TEXTURA: arte à mão livre é o que tem TEXTURA
            # FOTOGRÁFICA no miolo (sementes do morango, carne, polvo). Arte
            # vetorial lisa com várias rampas (a fita dourada do 2 amigos,
            # a pincelada rasgada do 3 IRMÃOS — o grunge é borda, corte de
            # máquina) tem miolo liso: é DEGRADÊ de janela, não aerografia.
            # Métrica: fração do miolo erodido com |∇L*| > 3 por pixel.
            if _fracao_textura(mask, rgb, mm_px) >= 0.10:
                tipo = "AEROGRAFIA"

    rgb_medio = rgbs.mean(axis=0).astype(int)
    out = {
        "tipo": tipo,
        "area_m2": round(area_mm2 / 1e6, 3),
        "r2_rampa": round(r2, 2),
        "entropia_matiz_bits": round(entropia, 2),
        "lab_media": lab.mean(axis=0).tolist(),
        "hex_medio": hex_de(int(rgb_medio[0]) << 16 | int(rgb_medio[1]) << 8 | int(rgb_medio[2])),
    }

    if tipo == "DEGRADE":
        # extremos ao longo da direção da rampa
        direcao = pred
        o = np.argsort(direcao)
        n = o.size
        i_lo, i_hi = o[: max(1, n // 20)], o[-max(1, n // 20):]
        rgb_lo = rgbs[i_lo].mean(axis=0).astype(int)
        rgb_hi = rgbs[i_hi].mean(axis=0).astype(int)
        lab_lo = srgb_para_lab(rgb_lo)
        lab_hi = srgb_para_lab(rgb_hi)
        cr_lo, cr_hi = float(croma(lab_lo)), float(croma(lab_hi))
        neutro = cr_lo < 8.0 or cr_hi < 8.0
        if neutro:
            troca_cor = False
        else:
            dh = abs(float(matiz_graus(lab_lo)) - float(matiz_graus(lab_hi)))
            dh = min(dh, 360 - dh)
            troca_cor = dh > 30.0
        tons = p(params, "degrade", "tons_troca_cor" if troca_cor else "tons_mesma_cor")
        import math as _math
        # direção em que o L* CRESCE (graus, y para baixo como na imagem):
        # é o vetor do gradiente do plano ajustado — a UI pinta a janela
        # inteira do adesivo com a rampa neste ângulo (R2-9)
        dir_graus = _math.degrees(_math.atan2(float(sol[1]), float(sol[0])))
        out.update({
            "direcao_graus": round(dir_graus, 0),
            "de_hex": hex_de(int(rgb_lo[0]) << 16 | int(rgb_lo[1]) << 8 | int(rgb_lo[2])),
            "para_hex": hex_de(int(rgb_hi[0]) << 16 | int(rgb_hi[1]) << 8 | int(rgb_hi[2])),
            "tons_sugeridos": int(tons),
            "tons_nota": "limiar 2×3 tons NÃO calibrado (nenhum caso de 3 tons no acervo) — confirmar",
            "split_interno": _split_interno(direcao, L),
        })
    return out


def _fracao_textura(mask: np.ndarray, rgb: np.ndarray, mm_px: float) -> float:
    """Fração do MIOLO (erosão 6 mm) com gradiente local forte (|∇L*| > 3).

    Foto tem detalhe de alta frequência por toda parte; vetor liso só nas
    transições entre faces. É o discriminante 'fotográfico' de verdade.
    """
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return 1.0
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    crop = mask[y0:y1, x0:x1]
    r_er = max(1, int(round(6.0 / mm_px)))
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_er + 1, 2 * r_er + 1))
    nucleo = cv2.erode(crop.astype(np.uint8), kern).astype(bool)
    n_nuc = int(nucleo.sum())
    if n_nuc < 400:
        return 1.0
    lab = srgb_para_lab(rgb[y0:y1, x0:x1])
    gy, gx = np.gradient(lab[..., 0])
    mag = np.sqrt(gy * gy + gx * gx)
    del lab, gy, gx
    frac = float((mag[nucleo] > 3.0).sum()) / n_nuc
    del mag, nucleo
    return frac


def separar_por_matiz(mask: np.ndarray, rgb: np.ndarray, mm_px: float) -> np.ndarray | None:
    """Zona com DOIS grupos de matiz espacialmente coerentes = dois trabalhos
    colados (a fita dourada na frente dos morangos do 2 amigos). Separa o
    grupo de matiz mais distante do dominante quando ele forma um bloco
    espacial grande. Foto de assunto único (carne, frango) tem matiz
    dominante >70% e não separa."""
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return None
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    crop = mask[y0:y1, x0:x1]
    lab = srgb_para_lab(rgb[y0:y1, x0:x1])
    cr = croma(lab)
    com_croma = crop & (cr > 12.0)
    if float(com_croma.sum()) < 0.4 * float(crop.sum()):
        return None
    hu = matiz_graus(lab)
    del lab, cr
    hist = np.zeros(36)
    h36, _ = np.histogram(hu[com_croma], bins=36, range=(0, 360))
    hist[:36] = h36
    total = hist.sum() or 1.0
    # janelas circulares de ±2 caixas (±20°) centradas em cada caixa
    massas = np.array([
        hist[[(i + k) % 36 for k in (-2, -1, 0, 1, 2)]].sum() for i in range(36)
    ]) / total
    dom = int(np.argmax(massas))
    # candidato: janela com 15–70% da massa, afastada ≥ 30° da dominante
    # (o dourado da fita do 2 amigos fica a ~35° do vermelho dos morangos)
    melhor = None
    for i in range(36):
        d_circ = min(abs(i - dom), 36 - abs(i - dom)) * 10
        if d_circ < 30 or not (0.15 <= massas[i] <= 0.70):
            continue
        if melhor is None or massas[i] > massas[melhor]:
            melhor = i
    if melhor is None:
        return None
    centro = melhor * 10 + 5
    dist = np.minimum(np.abs(hu - centro), 360 - np.abs(hu - centro))
    m_w = com_croma & (dist <= 25)
    del hu, dist, com_croma
    r = max(1, int(round(8.0 / mm_px)))
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    m8 = cv2.morphologyEx(m_w.astype(np.uint8), cv2.MORPH_OPEN, kern)
    n, comp, stats, _ = cv2.connectedComponentsWithStats(m8, connectivity=8)
    del m_w, m8
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    area_c = float(stats[i, cv2.CC_STAT_AREA]) * mm_px * mm_px
    area_tot = float(crop.sum()) * mm_px * mm_px
    if area_c < 0.3e6 or area_c > 0.7 * area_tot or area_tot - area_c < 0.5e6:
        return None
    m_l = cv2.dilate((comp == i).astype(np.uint8), kern).astype(bool) & crop
    out = np.zeros_like(mask)
    out[y0:y1, x0:x1] = m_l
    return out


def separar_parte_lisa(mask: np.ndarray, rgb: np.ndarray, mm_px: float,
                       params: dict) -> np.ndarray | None:
    """Parte LISA grande dentro de uma zona contínua GRANDE = rampa encostada
    na foto (o banner dourado do 2 amigos era engolido pelos morangos e o
    texto sobre ele perdia o ciclo de verniz do dia seguinte).

    Critério geométrico, sem tipo: o maior componente de |∇Lab| < 1 dentro
    da zona, se tiver ≥ 0,3 m², ≤ 70% da zona e deixar ≥ 0,5 m² de resto,
    vira zona própria. Foto de verdade não tem componente liso grande;
    rampa pura é >70% lisa e não separa (já é DEGRADE inteira).
    """
    from .paleta import _mascara_chapada
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return None
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    crop = mask[y0:y1, x0:x1]
    lisa = _mascara_chapada(rgb[y0:y1, x0:x1], 1.0) & crop
    r = max(1, int(round(8.0 / mm_px)))
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    lisa8 = cv2.morphologyEx(lisa.astype(np.uint8), cv2.MORPH_OPEN, kern)
    n, comp, stats, _ = cv2.connectedComponentsWithStats(lisa8, connectivity=8)
    del lisa, lisa8
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    area_lisa = float(stats[i, cv2.CC_STAT_AREA]) * mm_px * mm_px
    area_tot = float(crop.sum()) * mm_px * mm_px
    if (area_lisa < 0.3e6 or area_lisa > 0.7 * area_tot
            or area_tot - area_lisa < 0.5e6):
        return None
    m_l = (comp == i).astype(np.uint8)
    m_l = cv2.dilate(m_l, kern).astype(bool) & crop
    out = np.zeros_like(mask)
    out[y0:y1, x0:x1] = m_l
    return out


def _split_interno(proj: np.ndarray, L: np.ndarray) -> dict | None:
    """Chapado-então-rampa (máscara dentro da máscara). Compara RMSE."""
    o = np.argsort(proj)
    Ls = L[o]
    n = Ls.size
    if n < 400:
        return None
    # perfil 1D em 60 caixas
    caixas = np.array_split(Ls, 60)
    perfil = np.array([c.mean() for c in caixas])
    x = np.arange(60, dtype=np.float32)
    # modelo 1: rampa única
    A1 = np.stack([x, np.ones_like(x)], axis=1)
    s1, *_ = np.linalg.lstsq(A1, perfil, rcond=None)
    rmse1 = float(np.sqrt(np.mean((perfil - A1 @ s1) ** 2)))
    # modelo 2: constante até s, rampa depois
    melhor = None
    for s in range(10, 50):
        c = perfil[:s].mean()
        A2 = np.stack([x[s:] - s, np.ones_like(x[s:])], axis=1)
        s2, *_ = np.linalg.lstsq(A2, perfil[s:], rcond=None)
        res = np.concatenate([perfil[:s] - c, perfil[s:] - A2 @ s2])
        rmse2 = float(np.sqrt(np.mean(res ** 2)))
        if melhor is None or rmse2 < melhor[1]:
            melhor = (s, rmse2)
    if melhor and melhor[1] < 0.7 * rmse1 and rmse1 > 1.0:
        return {
            "split_pos_pct": round(100.0 * melhor[0] / 60.0),
            "nota": "parte chapada + parte em rampa: pinta a base → fita+papel na parte chapada → esfuma o resto",
        }
    return None
