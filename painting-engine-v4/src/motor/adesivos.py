"""Agrupamento em adesivos — mandam as BOBINAS (120 e 50 cm).

- Envelope do elemento + folga de 8 cm por lado.
- Emenda não é driver de custo, MAS agrupar só vale se o envelope combinado
  couber numa bobina única: "100 FRONTEIRAS" + "TRANSPORTADORA" dariam
  1 594 mm e por isso são DOIS adesivos (dono).
- Agrupa vão pequeno (≤0,6× a altura menor); vão ≥2× separa; entre os dois é
  PERGUNTA (precedentes conflitam: 137 × A&P).
- REGISTRO vence aproveitamento: elementos de texto na MESMA LINHA (bases
  alinhadas, alturas parecidas) saem numa tira só mesmo com vão grande
  (site+instagram do 137, vão de 1 940 mm).
- Elemento minúsculo (<0,04 m²) anexa ao adesivo vizinho.
- Faixa orgânica não entra: é fita. Aerografia entra só com contorno externo.
- R2-7 refinada (R5, dono): a folha divide por CONTEÚDO DE PIXEL — parte
  PEQUENA que sai da banda de altura (o rabo do "g", o "F" alto) vira folha
  própria quando a economia de filme compensa. Mede-se no perfil de linhas,
  não só na caixa dos itens.
"""
from __future__ import annotations

import numpy as np

from .util import p


def _bobina_unica(altura_mm: float, params: dict) -> int | None:
    """Largura da bobina que comporta a altura SEM emenda, ou None."""
    folga = p(params, "bobinas", "folga_adesivo_mm")
    for b in sorted(p(params, "bobinas", "larguras_mm")):
        if altura_mm + 2 * folga <= b - 40:
            return b
    return None


def _bobina_para(altura_mm: float, params: dict) -> tuple[int, int]:
    b = _bobina_unica(altura_mm, params)
    if b is not None:
        return b, 1
    maior = sorted(p(params, "bobinas", "larguras_mm"))[-1]
    folga = p(params, "bobinas", "folga_adesivo_mm")
    pecas = int((altura_mm + 2 * folga) // (maior - 40)) + 1
    return maior, pecas


def _env(grupo):
    x0 = min(g["x"] for g in grupo)
    y0 = min(g["y"] for g in grupo)
    x1 = max(g["x"] + g["w"] for g in grupo)
    y1 = max(g["y"] + g["h"] for g in grupo)
    return x0, y0, x1 - x0, y1 - y0


def agrupar_adesivos(elementos: list, mm_px: float, params: dict,
                     mapa: np.ndarray | None = None) -> tuple[list[dict], list[dict]]:
    folga = p(params, "bobinas", "folga_adesivo_mm")
    vao_ok = p(params, "agrupamento", "vao_agrupa_max_x_altura")
    vao_nao = p(params, "agrupamento", "vao_separa_min_x_altura")

    itens = []
    for el in elementos:
        # só entra no vinil quem é executado por ADESIVO — fita, stencil e
        # AEROGRAFIA têm rota própria (R3-7: o vinil da aerografia é só o
        # contorno externo e é contado no passo dela; a folha inteira aqui
        # dobrava o filme do 2 amigos em 33 m²)
        if getattr(el, "tecnica", "ADESIVO") != "ADESIVO":
            continue
        x, y, w, h = el.bbox
        itens.append({
            "elemento": el.id, "tipo": el.tipo,
            "x": x * mm_px, "y": y * mm_px, "w": w * mm_px, "h": h * mm_px,
            "area_m2": el.area_px * mm_px * mm_px / 1e6,
            "membros": set(getattr(el, "membros", {el.id})),
        })
    if not itens:
        return [], []

    grandes = [i for i in itens if i["area_m2"] >= 0.04]
    minusculos = [i for i in itens if i["area_m2"] < 0.04]
    if not grandes:
        grandes, minusculos = minusculos, []

    grupos: list[list[dict]] = [[i] for i in grandes]
    perguntas: list[dict] = []

    def tentar_fusao():
        for gi in range(len(grupos)):
            for gj in range(gi + 1, len(grupos)):
                a_env = _env(grupos[gi])
                b_env = _env(grupos[gj])
                ax, ay, aw, ah = a_env
                bx, by, bw, bh = b_env
                sobre_h = min(ax + aw, bx + bw) - max(ax, bx)
                sobre_v = min(ay + ah, by + bh) - max(ay, by)
                juntos_h = max(ay + ah, by + bh) - min(ay, by)
                cabe = _bobina_unica(juntos_h, params) is not None

                # mosaico é folha própria com depilação progressiva — NUNCA
                # agrupa com elemento de outro tipo (137: mosaico ≠ "Deus seja")
                ta = {g["tipo"] for g in grupos[gi]}
                tb = {g["tipo"] for g in grupos[gj]}
                if ("MOSAICO" in ta) != ("MOSAICO" in tb):
                    continue
                # registro de mesma linha: textos com base alinhada e altura
                # parecida — o vão pesa pouco, mas tem TETO (R6, dono 22/08:
                # site+instagram do 137, com o vão enorme entre eles, são
                # DOIS adesivos; não se carrega uma folha de vinil vazio)
                tipos = {g["tipo"] for g in grupos[gi] + grupos[gj]}
                vao_h = max(0.0, max(ax, bx) - min(ax + aw, bx + bw))
                teto_reg = p(params, "agrupamento", "registro_linha_vao_max_x_altura")
                mesma_linha_texto = (
                    tipos <= {"TEXTO", "ORNAMENTO", "SELO"}
                    and abs((ay + ah) - (by + bh)) <= 15
                    and max(ah, bh) / max(1.0, min(ah, bh)) <= 1.4
                    and vao_h <= teto_reg * max(ah, bh)
                    and cabe
                )
                if mesma_linha_texto:
                    grupos[gi].extend(grupos[gj])
                    del grupos[gj]
                    return True

                if sobre_h > 0.5 * min(aw, bw):
                    vao = max(ay, by) - min(ay + ah, by + bh)
                    ref = min(ah, bh)
                elif sobre_v > 0.5 * min(ah, bh):
                    vao = max(ax, bx) - min(ax + aw, bx + bw)
                    ref = min(ah, bh)
                else:
                    continue
                vao = max(0.0, vao)
                razao = vao / max(1.0, ref)
                if razao <= vao_ok and cabe:
                    grupos[gi].extend(grupos[gj])
                    del grupos[gj]
                    return True
                if vao_ok < razao < vao_nao and cabe:
                    perguntas.append({
                        "pergunta": (
                            f"agrupar os elementos {[g['elemento'] for g in grupos[gi]]} e "
                            f"{[g['elemento'] for g in grupos[gj]]} num adesivo? vão = "
                            f"{razao:.1f}× a altura — entre os precedentes (0,24× agrupou; "
                            f"2,1× separou; registro vence aproveitamento)"
                        ),
                        "default": "separar",
                    })
        return False

    while tentar_fusao():
        pass

    # ENVELOPES SOBREPOSTOS fundem SEMPRE (R5): dois adesivos um em cima do
    # outro não existem na oficina — se o conjunto não cabe na bobina, é UM
    # adesivo com EMENDA (emenda não é driver de custo). Caso: o lockup do
    # Agricola Premium saía em 3 folhas sobrepostas (A2 ⊃ A3/A4).
    def _sobrepoe():
        for gi in range(len(grupos)):
            for gj in range(gi + 1, len(grupos)):
                # mosaico é folha própria — nunca funde com outro tipo
                mi = any(g["tipo"] == "MOSAICO" for g in grupos[gi])
                mj = any(g["tipo"] == "MOSAICO" for g in grupos[gj])
                if mi != mj:
                    continue
                ax, ay, aw, ah = _env(grupos[gi])
                bx, by, bw, bh = _env(grupos[gj])
                ix = min(ax + aw, bx + bw) - max(ax, bx)
                iy = min(ay + ah, by + bh) - max(ay, by)
                if ix <= 0 or iy <= 0:
                    continue
                menor = min(aw * ah, bw * bh)
                # ≥35% do menor: sobreposição REAL (um contém boa parte do
                # outro). Com 10% a fusão encadeava e o AURIZ virou um
                # adesivo único da face inteira.
                if ix * iy > 0.35 * menor:
                    grupos[gi].extend(grupos[gj])
                    del grupos[gj]
                    return True
        return False

    while _sobrepoe():
        pass

    # grupo unitário pequeno ENCOSTADO noutro grupo anexa a ele (as
    # bandeirinhas no topo do mosaico do 137 saem na mesma folha)
    mudou = True
    while mudou:
        mudou = False
        for gi in range(len(grupos)):
            g = grupos[gi]
            if len(g) != 1 or g[0]["area_m2"] >= 0.12:
                continue
            ex, ey, ew, eh = _env(g)
            for gj in range(len(grupos)):
                if gj == gi:
                    continue
                ox, oy, ow, oh = _env(grupos[gj])
                dx = max(ox - (ex + ew), ex - (ox + ow), 0)
                dy = max(oy - (ey + eh), ey - (oy + oh), 0)
                if max(dx, dy) <= 100:
                    grupos[gj].extend(g)
                    del grupos[gi]
                    mudou = True
                    break
            if mudou:
                break

    # minúsculos anexam ao grupo mais próximo — mas NUNCA a um mosaico
    # (mosaico é folha própria; "Deus seja…" é adesivo próprio no 137)
    for m in minusculos:
        cx, cy = m["x"] + m["w"] / 2, m["y"] + m["h"] / 2
        melhor, melhor_d = None, None
        for g in grupos:
            if any(gg["tipo"] == "MOSAICO" for gg in g):
                continue
            ex, ey, ew, eh = _env(g)
            dx = max(ex - cx, 0, cx - (ex + ew))
            dy = max(ey - cy, 0, cy - (ey + eh))
            d = (dx * dx + dy * dy) ** 0.5
            if melhor is None or d < melhor_d:
                melhor, melhor_d = g, d
        if melhor is not None and melhor_d <= 4 * max(m["h"], 100.0):
            melhor.append(m)
        else:
            grupos.append([m])

    adesivos = []
    dedup = []
    for grupo in grupos:
        x0, y0, w_g, h_g = _env(grupo)
        w_env, h_env = w_g + 2 * folga, h_g + 2 * folga
        bobina, pecas = _bobina_para(h_g, params)
        # R2-7 refinada (R5): a folha divide por CONTEÚDO — perfil de linhas
        # de pixel acha a parte pequena que sai da banda (o rabo do "g");
        # sem mapa, cai no critério legado por alturas de item
        e_mosaico = any(g["tipo"] == "MOSAICO" for g in grupo)
        folhas = []
        economia_m2 = 0.0
        if not e_mosaico:
            if mapa is not None:
                folhas, economia_m2 = _folhas_por_conteudo(
                    grupo, mapa, mm_px, params, folga)
            if not folhas:
                folhas = _folhas_por_itens(grupo, params, folga)
        dedup.append({
            "elementos": sorted({g["elemento"] for g in grupo}),
            "envelope_mm": {"x": round(x0 - folga), "y": round(y0 - folga),
                            "w": round(w_env), "h": round(h_env)},
            "bobina_mm": bobina,
            "pecas_emenda": pecas,
            "folhas": folhas,
            "vinil_m2": round(
                sum(f["w"] * f["h"] for f in folhas) / 1e6 if folhas
                else w_env * h_env / 1e6, 2),
            "economia_folha_m2": round(economia_m2, 2),
            "aproveitamento_pct": round(
                100.0 * sum(g["area_m2"] for g in grupo)
                / max(1e-9, (sum(f["w"] * f["h"] for f in folhas) / 1e6 if folhas
                             else w_env * h_env / 1e6)), 0),
            "nota_emenda": (
                f"folha dividida por conteúdo — economia de {economia_m2:.2f} m² de filme (R2-7)"
                if folhas and economia_m2 > 0 else
                ("parte saliente em folha própria — economia de filme (R2-7)"
                 if folhas else ("emenda não é driver de custo" if pecas > 1 else ""))),
        })
    dedup.sort(key=lambda a: -a["vinil_m2"])
    for k, ad in enumerate(dedup, 1):
        ad["id"] = f"A{k}"
        adesivos.append(ad)
    _classificar_lados(adesivos, params)
    return adesivos, perguntas


def _folhas_por_itens(grupo: list[dict], params: dict, folga: float) -> list[dict]:
    """Critério legado (R2-7 original): item inteiro mais alto que a banda."""
    if len(grupo) < 2:
        return []
    x0, y0, w_g, h_g = _env(grupo)
    alturas = sorted(g["h"] for g in grupo)
    corpo_h = alturas[-2]
    saliente = [g for g in grupo if g["h"] > 1.35 * corpo_h]
    if not (saliente and _bobina_unica(corpo_h, params) is not None
            and _bobina_unica(h_g, params) is None):
        return []
    folhas = []
    resto = [g for g in grupo if g not in saliente]
    if resto:
        rx, ry, rw, rh = _env(resto)
        folhas.append({"parte": "corpo",
                       "x": round(rx - folga), "y": round(ry - folga),
                       "w": round(rw + 2 * folga), "h": round(rh + 2 * folga),
                       "bobina_mm": _bobina_unica(rh, params)})
    for s in saliente:
        folhas.append({"parte": "saliência",
                       "x": round(s["x"] - folga), "y": round(s["y"] - folga),
                       "w": round(s["w"] + 2 * folga), "h": round(s["h"] + 2 * folga),
                       "bobina_mm": _bobina_unica(s["h"], params) or
                       sorted(p(params, "bobinas", "larguras_mm"))[-1]})
    return folhas


def _folhas_por_conteudo(grupo: list[dict], mapa: np.ndarray, mm_px: float,
                         params: dict, folga: float) -> tuple[list[dict], float]:
    """Divide a folha pelo PERFIL DE LINHAS do conteúdo (R2-7 refinada, R5).

    A banda do corpo é onde a cobertura de tinta por linha é normal; linhas
    com cobertura < linha_vazia_frac × P95, nas EXTREMIDADES, contêm só as
    partes salientes (rabo do g, haste do F). Cada saliência vira folha
    própria — apenas quando é PEQUENA (largura somada ≤ 35% da folha) e a
    economia de filme passa dos pisos. Devolve ([], 0) quando não compensa.
    """
    alt_min = p(params, "folha", "saliencia_altura_min_mm")
    larg_max_frac = p(params, "folha", "saliencia_largura_max_frac")
    eco_min_m2 = p(params, "folha", "economia_min_m2")
    eco_min_pct = p(params, "folha", "economia_min_pct")
    overlap = p(params, "folha", "sobreposicao_registro_mm")
    frac_vazia = p(params, "folha", "linha_vazia_frac")

    ids = sorted(set().union(*[g.get("membros") or {g["elemento"]} for g in grupo]))
    x0_mm, y0_mm, w_mm, h_mm = _env(grupo)
    if h_mm < 2.5 * alt_min:      # folha baixa demais para valer divisão
        return [], 0.0
    H, W = mapa.shape
    px0 = max(0, int(x0_mm / mm_px)); px1 = min(W, int((x0_mm + w_mm) / mm_px) + 1)
    py0 = max(0, int(y0_mm / mm_px)); py1 = min(H, int((y0_mm + h_mm) / mm_px) + 1)
    if px1 - px0 < 4 or py1 - py0 < 4:
        return [], 0.0
    sub = np.isin(mapa[py0:py1, px0:px1], np.array(ids))
    linhas = sub.sum(axis=1)
    nz = linhas[linhas > 0]
    if nz.size < 8:
        return [], 0.0
    ref = float(np.percentile(nz, 95))
    vazia = linhas < frac_vazia * ref

    n = linhas.size
    topo = 0
    while topo < n and (vazia[topo] or linhas[topo] == 0):
        topo += 1
    base = 0
    while base < n and (vazia[n - 1 - base] or linhas[n - 1 - base] == 0):
        base += 1
    if topo + base >= n:
        return [], 0.0

    salientes = []
    total_larg = 0.0
    for run_ini, run_fim, lado in ((0, topo, "topo"), (n - base, n, "base")):
        run_h_mm = (run_fim - run_ini) * mm_px
        if run_h_mm < alt_min:
            continue
        band = sub[run_ini:run_fim, :]
        cols = band.any(axis=0)
        if not cols.any():
            continue
        # intervalos de colunas com tinta, fundindo vãos ≤ 50 mm
        gap_px = int(50.0 / mm_px)
        idx = np.flatnonzero(cols)
        cortes = np.flatnonzero(np.diff(idx) > gap_px)
        inicio = np.concatenate(([0], cortes + 1))
        fim = np.concatenate((cortes, [idx.size - 1]))
        # "partes PEQUENAS saem da média" (dono): saliência é COISA RARA —
        # 1 ou 2 partes (o rabo do g, o F alto). Mais que 2 intervalos =
        # conteúdo espalhado na banda, não saliência; dividir viraria um
        # quebra-cabeça de registro (AGI SOLAR chegou a 13 folhas). Pula o lado.
        if len(inicio) > 2:
            continue
        for i0, i1 in zip(inicio, fim):
            c0, c1 = int(idx[i0]), int(idx[i1])
            larg_mm = (c1 - c0 + 1) * mm_px
            if larg_mm < 10:
                continue
            # extensão vertical real da saliência (a parte pode não ocupar o
            # run inteiro) + sobreposição de registro para dentro do corpo
            colsub = sub[run_ini:run_fim, c0:c1 + 1]
            ys = np.flatnonzero(colsub.any(axis=1))
            if ys.size == 0:
                continue
            if lado == "topo":
                y_ini = run_ini + int(ys[0])
                y_fim = run_fim   # até a borda do corpo (+ overlap para dentro)
                h_sal = (y_fim - y_ini) * mm_px + overlap
                y_abs = y0_mm + y_ini * mm_px
            else:
                y_ini = run_ini
                y_fim = run_ini + int(ys[-1]) + 1
                h_sal = (y_fim - y_ini) * mm_px + overlap
                y_abs = y0_mm + y_ini * mm_px - overlap
            salientes.append({
                "lado": lado,
                "x": x0_mm + c0 * mm_px,
                "y": y_abs,
                "w": larg_mm,
                "h": h_sal,
            })
            total_larg += larg_mm

    if not salientes or total_larg > larg_max_frac * w_mm:
        return [], 0.0

    corpo_y = y0_mm + topo * mm_px
    corpo_h = h_mm - (topo + base) * mm_px
    if corpo_h <= 0:
        return [], 0.0

    filme_cheio = (w_mm + 2 * folga) * (h_mm + 2 * folga) / 1e6
    filme_corpo = (w_mm + 2 * folga) * (corpo_h + 2 * folga) / 1e6
    filme_sal = sum((s["w"] + 2 * folga) * (s["h"] + 2 * folga) for s in salientes) / 1e6
    economia = filme_cheio - (filme_corpo + filme_sal)
    if economia < eco_min_m2 or economia < (eco_min_pct / 100.0) * filme_cheio:
        return [], 0.0

    maior = sorted(p(params, "bobinas", "larguras_mm"))[-1]
    folhas = [{
        "parte": "corpo",
        "x": round(x0_mm - folga), "y": round(corpo_y - folga),
        "w": round(w_mm + 2 * folga), "h": round(corpo_h + 2 * folga),
        "bobina_mm": _bobina_unica(corpo_h, params) or maior,
    }]
    for s in salientes:
        folhas.append({
            "parte": f"saliência ({s['lado']})",
            "x": round(s["x"] - folga), "y": round(s["y"] - folga),
            "w": round(s["w"] + 2 * folga), "h": round(s["h"] + 2 * folga),
            "bobina_mm": _bobina_unica(s["h"], params) or maior,
        })
    return folhas, economia


def _classificar_lados(adesivos: list[dict], params: dict) -> None:
    """R3-2 + R6 (dono, 22/08): o que vai em cada LADO da caixa, por TRECHO.

    Um vizinho que encosta só em PARTE do lado cobre só aquele trecho — o
    resto do lado continua chapa exposta e leva papel (a parte de baixo do
    "100" do 100FRONTEIRAS, à esquerda do TRANSPORTADORA). Cada trecho é
    nada (encosta), fita branca (vão ≤ 2 passadas) ou papel (V=100, H=50).
    """
    enc = p(params, "fita_branca", "vao_encosta_mm")
    vf = p(params, "fita_branca", "vao_fita_mm")
    MIN_TRECHO = 30  # mm — sobra menor que isto é ruído de caixa
    caixas = [(ad["id"], ad["envelope_mm"]) for ad in adesivos]
    for ad in adesivos:
        e = ad["envelope_mm"]
        lados = {}
        for lado in ("esq", "dir", "topo", "base"):
            if lado in ("esq", "dir"):
                a0, a1 = e["y"], e["y"] + e["h"]
            else:
                a0, a1 = e["x"], e["x"] + e["w"]
            # intervalos cobertos por vizinhos DAQUELE lado, com o gap
            cobre = []  # (de, ate, gap, vizinho)
            for oid, o in caixas:
                if oid == ad["id"]:
                    continue
                if lado in ("esq", "dir"):
                    de, ate = max(a0, o["y"]), min(a1, o["y"] + o["h"])
                    # o vizinho tem de estar DAQUELE lado (centro além do centro)
                    if lado == "esq":
                        if o["x"] + o["w"] / 2 > e["x"] + e["w"] / 2:
                            continue
                        gap = e["x"] - (o["x"] + o["w"])
                    else:
                        if o["x"] + o["w"] / 2 < e["x"] + e["w"] / 2:
                            continue
                        gap = o["x"] - (e["x"] + e["w"])
                else:
                    de, ate = max(a0, o["x"]), min(a1, o["x"] + o["w"])
                    if lado == "topo":
                        if o["y"] + o["h"] / 2 > e["y"] + e["h"] / 2:
                            continue
                        gap = e["y"] - (o["y"] + o["h"])
                    else:
                        if o["y"] + o["h"] / 2 < e["y"] + e["h"] / 2:
                            continue
                        gap = o["y"] - (e["y"] + e["h"])
                # gap negativo = caixas sobrepostas = encostam
                if ate - de < MIN_TRECHO or gap > vf:
                    continue
                cobre.append((de, ate, gap, oid))
            # varredura do lado nos pontos de corte: encosta vence fita
            pontos = sorted({a0, a1, *(x for de, ate, _, _ in cobre
                                       for x in (de, ate) if a0 < x < a1)})
            trechos = []
            for i in range(len(pontos) - 1):
                de, ate = pontos[i], pontos[i + 1]
                meio = (de + ate) / 2
                ativos = [c for c in cobre if c[0] <= meio <= c[1]]
                if ativos:
                    g, viz = min((c[2], c[3]) for c in ativos)
                    if g <= enc:
                        t = {"tipo": "encosta", "vizinho": viz}
                    else:
                        t = {"tipo": "fita", "vizinho": viz, "vao_mm": round(g)}
                else:
                    t = {"tipo": "papel", "vizinho": None}
                t["de_mm"], t["ate_mm"] = round(de), round(ate)
                if trechos and trechos[-1]["tipo"] == t["tipo"] \
                        and trechos[-1].get("vizinho") == t.get("vizinho"):
                    trechos[-1]["ate_mm"] = t["ate_mm"]
                else:
                    trechos.append(t)
            trechos = [t for t in trechos if t["ate_mm"] - t["de_mm"] >= MIN_TRECHO]
            por_tipo = {}
            for t in trechos:
                por_tipo[t["tipo"]] = por_tipo.get(t["tipo"], 0) \
                    + (t["ate_mm"] - t["de_mm"])
            dominante = max(por_tipo, key=por_tipo.get) if por_tipo else "papel"
            viz_dom = next((t["vizinho"] for t in trechos
                            if t["tipo"] == dominante and t["vizinho"]), None)
            lados[lado] = {"tipo": dominante, "vizinho": viz_dom,
                           "trecho_mm": por_tipo.get(dominante,
                                                     round(a1 - a0)),
                           "trechos": trechos}
            vaos = [t["vao_mm"] for t in trechos if t["tipo"] == "fita"]
            if vaos:
                lados[lado]["vao_mm"] = vaos[0]
        ad["lados"] = lados
