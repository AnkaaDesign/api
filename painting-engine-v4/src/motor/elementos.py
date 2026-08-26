"""Elementos de produção: agrupamento por distância de FORMA, nunca por caixa.

Elemento de produção não é região de cor: um lock-up (símbolo + nome + linha
descritiva) é UM elemento, resolvido por UMA técnica, mesmo atravessando
várias cores. Sem VLM, o rótulo é heurística geométrica com confiança — e
incerteza vira pergunta, não palpite.

Armadilha 3.5 do legado: caixa pela união das regiões → um componente
espalhado faz a caixa virar a face inteira. Componente que estoura a caixa
semântica em >1,6× é destacado para elemento próprio.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .util import p


@dataclass
class Elemento:
    id: int
    bbox: tuple                 # (x, y, w, h) px
    area_px: int
    classes: list = field(default_factory=list)   # ids de classe presentes
    tipo: str = "ORNAMENTO"
    confianca: str = "media"    # alta | media | baixa
    tecnica: str = "ADESIVO"    # ADESIVO | FITA | AEROGRAFIA | STENCIL_FITA | STENCIL_CORTE
    tecnica_fonte: str = "motor"
    notas: list = field(default_factory=list)
    membros: set = field(default_factory=set)     # ids no mapa (após fusões)

    def __post_init__(self):
        if not self.membros:
            self.membros = {self.id}


def _bbox_union(bs):
    x0 = min(b[0] for b in bs)
    y0 = min(b[1] for b in bs)
    x1 = max(b[0] + b[2] for b in bs)
    y1 = max(b[1] + b[3] for b in bs)
    return (x0, y0, x1 - x0, y1 - y0)


def agrupar(labels: np.ndarray, campo_id: int, mm_px: float, params: dict) -> tuple[np.ndarray, list]:
    """Devolve (mapa_elemento int32 0=nada, lista de Elemento)."""
    raio_px = max(1, int(round(p(params, "agrupamento", "raio_uniao_elemento_mm") / mm_px)))
    tinta = (labels != campo_id).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * raio_px + 1, 2 * raio_px + 1))
    dilatado = cv2.dilate(tinta, kernel)
    n, grupos = cv2.connectedComponents(dilatado, connectivity=8)
    del dilatado
    mapa = grupos * tinta.astype(np.int32)
    del grupos, tinta

    elementos: list[Elemento] = []
    ids, cnts = np.unique(mapa, return_counts=True)
    for gid, npx in zip(ids.tolist(), cnts.tolist()):
        if gid == 0:
            continue
        m = mapa == gid
        ys, xs = np.nonzero(m)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
        cls = np.unique(labels[m]).tolist()
        elementos.append(Elemento(id=int(gid), bbox=bbox, area_px=int(npx),
                                  classes=[c for c in cls if c != campo_id]))
    return mapa, elementos


def separar_espalhados(mapa: np.ndarray, elementos: list, labels: np.ndarray,
                       campo_id: int, params: dict) -> list:
    """Destaca componente que estoura a caixa semântica (>1,6×)."""
    fator = p(params, "agrupamento", "caixa_espalhada_max_x")
    novos = []
    prox_id = max((e.id for e in elementos), default=0) + 1
    for el in elementos:
        x, y, w, h = el.bbox
        sub = mapa[y:y + h, x:x + w] == el.id
        n, comp, stats, _ = cv2.connectedComponentsWithStats(sub.astype(np.uint8), connectivity=8)
        if n <= 2:
            continue
        boxes = [
            (int(stats[i, 0]), int(stats[i, 1]), int(stats[i, 2]), int(stats[i, 3]),
             int(stats[i, 4]), i)
            for i in range(1, n)
        ]
        boxes.sort(key=lambda b: -b[4])
        aceitos = [boxes[0]]
        destacados = []
        for b in boxes[1:]:
            u_atual = _bbox_union([bb[:4] for bb in aceitos])
            u_com = _bbox_union([bb[:4] for bb in aceitos] + [b[:4]])
            if (u_com[2] * u_com[3]) > fator * (u_atual[2] * u_atual[3]):
                destacados.append(b)
            else:
                aceitos.append(b)
        for b in destacados:
            bx, by, bw, bh, _, cid = b
            regm = comp == cid
            mapa_sub = mapa[y:y + h, x:x + w]
            mapa_sub[regm] = prox_id
            cls = np.unique(labels[y:y + h, x:x + w][regm]).tolist()
            novos.append(Elemento(
                id=prox_id,
                bbox=(x + bx, y + by, bw, bh),
                area_px=int(regm.sum()),
                classes=[c for c in cls if c != campo_id],
                notas=["destacado: estourava a caixa semântica do elemento vizinho"],
            ))
            prox_id += 1
        if destacados:
            ys, xs = np.nonzero(mapa[y:y + h, x:x + w] == el.id)
            if ys.size:
                el.bbox = (x + int(xs.min()), y + int(ys.min()),
                           int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
                el.area_px = int(ys.size)
    elementos.extend(novos)
    return elementos


def destacar_faixas(mapa: np.ndarray, elementos: list, labels: np.ndarray,
                    campo_id: int, mm_px: float, params: dict,
                    zona_ids: set | None = None) -> list:
    """Descola ondas/faixas de elementos mistos ANTES da fusão de linhas.

    A onda que atravessa o painel passa por baixo/por cima de logomarcas e a
    dilatação cola tudo num mega-elemento (AAN: onda+logo). Componentes com a
    assinatura de faixa (atravessa + curva lisa + alongado) viram elemento
    FAIXA próprio; o resto é reagrupado.
    """
    from .traco import retilineidade
    h_face, w_face = labels.shape
    margem = 50.0 / mm_px
    novos = []
    prox = max((e.id for e in elementos), default=0) + 1
    for el in list(elementos):
        x, y, w, h = el.bbox
        if el.area_px * mm_px * mm_px < 0.5e6 or w * mm_px < 2000:
            continue
        sub = np.isin(mapa[y:y + h, x:x + w], list(el.membros)).astype(np.uint8)
        n, comp, stats, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
        if n - 1 < 2:
            continue
        descolou = False
        for i in range(1, n):
            area_mm2 = stats[i, cv2.CC_STAT_AREA] * mm_px * mm_px
            if area_mm2 < 0.15e6:
                continue
            bx, by = x + stats[i, 0], y + stats[i, 1]
            bw, bh = stats[i, 2], stats[i, 3]
            atravessa = (bx <= margem and bx + bw >= w_face - margem) or \
                        (by <= margem and by + bh >= h_face - margem)
            if not atravessa:
                continue
            m_comp = comp == i
            cls = [c for c in np.unique(labels[y:y + h, x:x + w][m_comp]).tolist()
                   if c != campo_id]
            if len(cls) > 2:   # onda tem 1–2 cores; mosaico tem muitas
                continue
            ret = retilineidade(m_comp, mm_px, params)
            if ret["vertices_por_m"] <= 8.0 and ret["compacidade"] >= 2.5:
                mapa_sub = mapa[y:y + h, x:x + w]
                mapa_sub[m_comp] = prox
                novos.append(Elemento(
                    id=prox,
                    bbox=(int(bx), int(by), int(bw), int(bh)),
                    area_px=int(stats[i, cv2.CC_STAT_AREA]),
                    classes=cls,
                    tipo="FAIXA_ORGANICA",
                    confianca="media",
                    notas=[
                        f"onda destacada do grupo ({ret['vertices_por_m']}/m, "
                        f"compacidade {ret['compacidade']}) — candidata a fita"
                    ],
                ))
                prox += 1
                descolou = True
        if descolou:
            prox = _reagrupar_resto(el, elementos, novos, mapa, labels,
                                    campo_id, mm_px, x, y, w, h, prox)

    # 2º passe — POR CLASSE (R5): o filete de UMA cor que atravessa o painel
    # funde a arte inteira por conectividade (armadilha §8.2 — o fio de 15 m
    # do BAHIA SUL e o filete amarelo do SGT sumiam dentro de um
    # mega-elemento, e o 1º passe pula componentes com >2 classes). A classe
    # FINA e ATRAVESSADORA é depenada do mega-elemento e vira FAIXA própria;
    # o resto reagrupa (o filete era a ponte).
    from .traco import espessura_perpendicular_mm, retilineidade
    zona_ids = zona_ids or set()
    for el in list(elementos):
        if el not in elementos or el.tipo == "FAIXA_ORGANICA":
            continue
        x, y, w, h = el.bbox
        if el.area_px * mm_px * mm_px < 1.0e6 or w * mm_px < 5000:
            continue
        sub_ids = np.isin(mapa[y:y + h, x:x + w], list(el.membros))
        descolou = False
        for c in list(el.classes):
            if c in zona_ids:
                continue   # zona contínua tem rota própria (degradê/aero)
            m_c = sub_ids & (labels[y:y + h, x:x + w] == c)
            area_mm2 = float(m_c.sum()) * mm_px * mm_px
            if area_mm2 < 0.10e6:
                continue
            ys2, xs2 = np.nonzero(m_c)
            bx, by = x + int(xs2.min()), y + int(ys2.min())
            bw2 = int(xs2.max() - xs2.min() + 1)
            bh2 = int(ys2.max() - ys2.min() + 1)
            # a banda não precisa tocar as DUAS bordas: o filete do BAHIA SUL
            # começa ~1 m para dentro e segue 13 m — comprimento ≥ 60% do
            # painel numa direção decide
            comprida = bw2 >= 0.6 * w_face or bh2 >= 0.6 * h_face
            if not comprida:
                continue
            esp = espessura_perpendicular_mm(m_c, mm_px)
            if not (0 < esp <= 250):
                continue
            # faixa é UM traçado contínuo (1–4 pedaços no máximo, pelo
            # z-order); LETRAS são dezenas de componentes — o script preto do
            # CAVALCANTE (5,4 m², esp 110 mm) passava nos gates de traço e
            # virava "62 m de fita"
            n_cp, _, st_cp, _ = cv2.connectedComponentsWithStats(
                m_c.astype(np.uint8), connectivity=8)
            n_gr = sum(1 for i in range(1, n_cp) if st_cp[i, cv2.CC_STAT_AREA] > 200)
            if n_gr > 4:
                continue
            ret = retilineidade(m_c, mm_px, params)
            if ret["compacidade"] < 2.5 or ret["vertices_por_m"] > 12:
                continue
            # CONTORNO de outra arte não é faixa: o contorno vermelho das
            # letras do CAVALCANTE é vinil da própria letra. Faixa de verdade
            # FLUTUA no campo (BAHIA) ou acompanha uma ZONA (o filete da
            # estrada do SGT); quem abraça arte CHAPADA é contorno — fica.
            kern3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            anel = cv2.dilate(m_c.astype(np.uint8), kern3).astype(bool) & ~m_c
            viz = labels[y:y + h, x:x + w][anel]
            del anel
            viz_art = viz[(viz != campo_id) & (viz >= 0)]
            if viz.size and viz_art.size / viz.size > 0.45:
                vals_v, cnts_v = np.unique(viz_art, return_counts=True)
                dom_viz = int(vals_v[np.argmax(cnts_v)])
                if dom_viz not in zona_ids:
                    continue
            mapa_sub = mapa[y:y + h, x:x + w]
            mapa_sub[m_c] = prox
            novos.append(Elemento(
                id=prox, bbox=(bx, by, bw2, bh2), area_px=int(m_c.sum()),
                classes=[c], tipo="FAIXA_ORGANICA", confianca="media",
                notas=[f"classe fina que atravessa o painel (~{esp:.0f} mm, "
                       f"compacidade {ret['compacidade']}) depenada do "
                       "mega-elemento — candidata a fita"],
            ))
            prox += 1
            descolou = True
        if descolou:
            prox = _reagrupar_resto(el, elementos, novos, mapa, labels,
                                    campo_id, mm_px, x, y, w, h, prox)
    elementos.extend(novos)
    return elementos


def _reagrupar_resto(el, elementos, novos, mapa, labels, campo_id, mm_px,
                     x, y, w, h, prox):
    """O RESTO do elemento depenado reagrupa localmente (senão o sliver que
    sobrou mantém a caixa da face inteira e engole a logomarca)."""
    elementos.remove(el)
    resto = np.isin(mapa[y:y + h, x:x + w], list(el.membros)).astype(np.uint8)
    raio = max(1, int(round(25.0 / mm_px)))
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * raio + 1, 2 * raio + 1))
    nr, subg = cv2.connectedComponents(cv2.dilate(resto, kern), connectivity=8)
    subg = subg * resto.astype(np.int32)
    for gi in range(1, nr):
        mg = subg == gi
        npx = int(mg.sum())
        if npx < 16:
            continue
        ys, xs = np.nonzero(mg)
        cls = [c for c in np.unique(labels[y:y + h, x:x + w][mg]).tolist()
               if c != campo_id]
        mapa[y:y + h, x:x + w][mg] = prox
        novos.append(Elemento(
            id=prox,
            bbox=(x + int(xs.min()), y + int(ys.min()),
                  int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)),
            area_px=npx,
            classes=cls,
        ))
        prox += 1
    return prox


def _mescla(a: "Elemento", b: "Elemento") -> None:
    a.bbox = _bbox_union([a.bbox, b.bbox])
    a.area_px += b.area_px
    a.classes = sorted(set(a.classes) | set(b.classes))
    a.membros |= b.membros
    a.notas.extend(b.notas)


def fundir_linhas(elementos: list, mm_px: float) -> list:
    """Funde letras/palavras em linhas (vão horizontal ≤0,8× a altura) e
    linhas empilhadas de um lock-up (vão vertical ≤0,5× a altura menor).

    A distância é entre CAIXAS VIZINHAS de altura comparável — não entre
    caixas quaisquer (fundir por proximidade de caixa junta o que não tem
    relação; aqui a razão altura≤1,8 e o vão relativo seguram isso).
    """
    els = list(elementos)
    mudou = True
    while mudou:
        mudou = False
        for i in range(len(els)):
            if els[i] is None or els[i].tipo == "FAIXA_ORGANICA":
                continue
            for j in range(i + 1, len(els)):
                if els[j] is None or els[j].tipo == "FAIXA_ORGANICA":
                    continue
                a, b = els[i], els[j]
                ax, ay, aw, ah = a.bbox
                bx, by, bw, bh = b.bbox
                hmin = min(ah, bh)
                if max(ah, bh) / max(1, hmin) > 1.8:
                    continue
                sobre_v = min(ay + ah, by + bh) - max(ay, by)
                sobre_h = min(ax + aw, bx + bw) - max(ax, bx)
                vao_h = max(ax, bx) - min(ax + aw, bx + bw)
                vao_v = max(ay, by) - min(ay + ah, by + bh)
                # texto pequeno (letras < ~150 mm) espaçado agrupa com folga maior:
                # a linha é UM elemento (registro), mesmo com tracking largo.
                # Cap ABSOLUTO de 500 mm: lock-up é escala de texto — sem o cap,
                # elementos de 2 m de altura engoliam a face inteira (ACM)
                cap = 500.0 / mm_px
                folga = min(3.0 * hmin if hmin * mm_px < 150 else 1.5 * hmin, cap)
                mesma_linha = sobre_v >= 0.6 * hmin and vao_h <= folga
                empilhado = (sobre_h >= 0.5 * min(aw, bw)
                             and 0 <= vao_v <= min(0.5 * hmin, cap))
                if mesma_linha or (empilhado and max(aw, bw) / max(1, min(aw, bw)) <= 3.0):
                    _mescla(a, b)
                    els[j] = None
                    mudou = True
    return [e for e in els if e is not None]


def _mesmo_matiz(classe_ids: list, classes_por_id: dict, span_max: float = 60.0) -> bool:
    """Mosaico é escada de UM matiz (5 azuis, 11 verdes); logomarca densa é
    multi-matiz (vinho+oliva+cinzas do AAN)."""
    from .cor import croma, matiz_graus
    matizes = []
    for cid in classe_ids:
        cl = classes_por_id.get(cid)
        if cl is None or cl.tipo != "chapada":
            continue
        if float(croma(cl.lab)) > 8.0:
            matizes.append(float(matiz_graus(cl.lab)))
    if len(matizes) < 2:
        return False
    matizes.sort()
    # maior espaçamento circular entre matizes consecutivos
    voltas = [matizes[i + 1] - matizes[i] for i in range(len(matizes) - 1)]
    voltas.append(360.0 - matizes[-1] + matizes[0])
    return (360.0 - max(voltas)) <= span_max


def resolver_tecnicas(elementos: list, zonas: list, mapa: np.ndarray,
                      mm_px: float, params: dict,
                      pintura_geral: bool = False) -> None:
    """Técnica de execução por elemento (R2-10: sempre editável na tela).

    - FAIXA_ORGANICA → FITA (G4)
    - elemento dominado por zona de AEROGRAFIA → AEROGRAFIA
    - GIGANTE e simples (R2-8: script do 2 amigos) → STENCIL_FITA (proposto:
      traçado tranquilo em fita amarela, trechos verticais em fita branca)
    - resto → ADESIVO (vinil como máscara)
    """
    from .traco import espessura_perpendicular_mm
    zonas_aero = {z["classe_id"] for z in zonas if z["tipo"] == "AEROGRAFIA"}
    st_len = p(params, "stencil", "comprimento_min_mm")
    st_perg = p(params, "stencil", "pergunta_min_mm")
    st_alt = p(params, "stencil", "altura_min_mm")
    st_esp = p(params, "stencil", "espessura_min_mm")
    for el in elementos:
        x, y, w, h = el.bbox
        if el.tipo == "FAIXA_ORGANICA":
            el.tecnica = "FITA"
            continue
        if any(c in zonas_aero for c in el.classes):
            el.tecnica = "AEROGRAFIA"
            continue
        # filete/banda FINA e comprida (os 3 filetes prata do 2 amigos têm 140 mm; a onda do A&P ~200):
        # é FITA mesmo sem atravessar o painel de ponta a ponta
        if w * mm_px >= 5000 and el.tipo in ("ORNAMENTO", "LOGOMARCA"):
            sub_f = np.isin(mapa[y:y + h, x:x + w], list(el.membros)).astype(bool)
            esp_f = espessura_perpendicular_mm(sub_f, mm_px)
            n_comp_f = cv2.connectedComponents(sub_f.astype(np.uint8))[0] - 1
            preench_f = float(sub_f.mean())
            # n_comp ≤ 4 = poucas varreduras; OU feixe de FIOS (preenchimento
            # baixíssimo + traço fino): as elipses do BALALAC chegam em 13
            # fragmentos porque o script as corta no z-order — mas a fita é
            # batida CONTÍNUA por trás do que a interrompe
            if 0 < esp_f <= 250 and (n_comp_f <= 4
                                     or (preench_f <= 0.2 and esp_f <= 150)):
                el.tecnica = "FITA"
                el.tipo = "FAIXA_ORGANICA"
                el.notas.append(
                    f"filetes finos e compridos ({w*mm_px/1000:.1f} m, ~{esp_f:.0f} mm) "
                    "⇒ FITA (editável)")
                continue
            del sub_f
        # campo SECUNDÁRIO maciço (R5, G4): painel grande de cor chapada com
        # borda LISA não é vinil — é FITA no contorno + papel generoso
        # ("mascaramento de precisão só na fronteira"). O painel verde do
        # AURIZ virava um vinil de ~15 m². Contraexemplos protegidos: mosaico
        # (folha própria), texto (nunca maciço), legumes do BOX DA TERRA
        # (≤2 m²), script+cubos do CAVALCANTE (preenchimento baixo).
        area_m2_el = el.area_px * mm_px * mm_px / 1e6
        preench_el = el.area_px / max(1, w * h)
        # ≤2 classes: o painel SÓLIDO (AURIZ, canto do SGT) leva fita; um
        # lockup detalhado multi-tinta precisa do vinil de qualquer forma —
        # "sobre chapa, gigante segue de vinil: o 100 FRONTEIRAS é adesivo"
        # (dono, R2-8)
        if (area_m2_el >= 2.0 and preench_el >= 0.40 and w * mm_px >= 3000
                and len(el.classes) <= 2
                and el.tipo not in ("MOSAICO", "TEXTO")):
            sub_m = np.isin(mapa[y:y + h, x:x + w], list(el.membros))
            from .traco import retilineidade as _ret
            ret_m = _ret(sub_m, mm_px, params)
            del sub_m
            if ret_m["vertices_por_m"] <= 8.0:
                el.tecnica = "FITA"
                el.notas.append(
                    f"campo secundário maciço ({area_m2_el:.1f} m², borda lisa a "
                    f"{ret_m['vertices_por_m']:.0f} vért/m) — fita no contorno + "
                    "papel generoso, não vinil (G4; editável)")
                continue
        # stencil automático SÓ ≥5 m sobre pintura geral (R3-8: o script do
        # 2 amigos, ~8,5 m; o lockup do A&P a 3,4 m é ADESIVO pela ficha).
        # FOTO_OU_DEGRADE entra quando o contínuo é degradê (o script tem
        # degradê parcial), nunca quando é aerografia — e exige LETRA alta
        # (mediana de altura de componente), não só caixa alta
        if (pintura_geral and w * mm_px >= st_perg and h * mm_px >= st_alt
                and el.tipo in ("TEXTO", "ORNAMENTO", "LOGOMARCA", "FOTO_OU_DEGRADE")):
            sub = np.isin(mapa[y:y + h, x:x + w], list(el.membros)).astype(np.uint8)
            n_c, _, stats_c, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
            alts = sorted(int(stats_c[i, cv2.CC_STAT_HEIGHT]) for i in range(1, n_c)
                          if stats_c[i, cv2.CC_STAT_AREA] > 200)
            alt_mediana = (alts[len(alts) // 2] * mm_px) if alts else 0
            esp = espessura_perpendicular_mm(sub.astype(bool), mm_px)
            # R5 — o stencil é para um DESENHO grande e simples, não para um
            # conjunto fragmentado: o script do 2 amigos tem 3 componentes e
            # 5,9 m de risco por metro de comprimento; o script+cubos do
            # CAVALCANTE tem 45 componentes e 11,3 m/m — marcar aquilo com
            # fita seria um quebra-cabeça. Gates: ≤20 componentes E ≤8 m/m.
            n_grandes = len(alts)
            cont_e, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            risco_m = sum(cv2.arcLength(c_, True) for c_ in cont_e) * mm_px / 1000.0
            risco_por_m = risco_m / max(0.5, w * mm_px / 1000.0)
            simples = n_grandes <= 20 and risco_por_m <= 8.0
            if esp >= st_esp and w * mm_px >= st_len and alt_mediana >= 400 and simples:
                el.tecnica = "STENCIL_FITA"
                el.confianca = "baixa"
                el.notas.append(
                    f"gigante ({w*mm_px/1000:.1f} m, traço ~{esp:.0f} mm) sobre pintura "
                    "geral ⇒ STENCIL/espovo — traçado tranquilo em fita amarela, trechos "
                    "verticais em fita branca cortada (editável)"
                )
                continue
            if esp >= st_esp and not simples and w * mm_px >= st_len:
                el.notas.append(
                    f"gigante sobre pintura geral, mas FRAGMENTADO ({n_grandes} partes, "
                    f"{risco_por_m:.0f} m de risco/m) — stencil descartado; vinil (editável)"
                )
            elif esp >= st_esp:
                el.notas.append(
                    f"grande ({w*mm_px/1000:.1f} m) sobre pintura geral — stencil seria "
                    "opção (pergunta); mantido como ADESIVO"
                )
        el.tecnica = "ADESIVO"


def destacar_aerografias(mapa: np.ndarray, elementos: list, labels: np.ndarray,
                         zonas: list, campo_id: int, mm_px: float) -> list:
    """S4: região fotográfica é elemento PRÓPRIO, nunca absorvida pelo
    vizinho. Zonas de AEROGRAFIA grandes saem do elemento misto (o banner do
    2 amigos não pode herdar a técnica dos morangos)."""
    grandes = [z for z in zonas if z["tipo"] == "AEROGRAFIA" and z["area_m2"] >= 0.3]
    if not grandes:
        return elementos
    prox = max((e.id for e in elementos), default=0) + 1
    for z in grandes:
        zid = z["classe_id"]
        dono = next((e for e in elementos if zid in e.classes and len(e.classes) > 1), None)
        m = labels == zid
        ys, xs = np.nonzero(m)
        if ys.size == 0:
            continue
        bbox = (int(xs.min()), int(ys.min()),
                int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
        novo = Elemento(id=prox, bbox=bbox, area_px=int(ys.size), classes=[zid],
                        tipo="FOTO_OU_DEGRADE", confianca="media",
                        tecnica="AEROGRAFIA",
                        notas=["aerografia destacada como elemento próprio (S4)"])
        mapa[m] = prox
        prox += 1
        if dono is not None:
            dono.classes = [c for c in dono.classes if c != zid]
            dono.area_px = max(0, dono.area_px - int(ys.size))
            resto = np.isin(mapa[dono.bbox[1]:dono.bbox[1] + dono.bbox[3],
                                 dono.bbox[0]:dono.bbox[0] + dono.bbox[2]],
                            list(dono.membros))
            ys2, xs2 = np.nonzero(resto)
            if ys2.size:
                dono.bbox = (dono.bbox[0] + int(xs2.min()), dono.bbox[1] + int(ys2.min()),
                             int(xs2.max() - xs2.min() + 1), int(ys2.max() - ys2.min() + 1))
        elementos.append(novo)
        del m
    return elementos


def _densidade_tt(crop_labels: np.ndarray, sub: np.ndarray, campo_id: int,
                  mm_px: float, area_m2: float) -> float:
    """Metros de fronteira tinta-tinta DENTRO do elemento, por m² de tinta."""
    import math
    total = 0
    for eixo in (0, 1):
        if eixo == 0:
            a, b = crop_labels[:-1, :], crop_labels[1:, :]
            ma, mb = sub[:-1, :], sub[1:, :]
        else:
            a, b = crop_labels[:, :-1], crop_labels[:, 1:]
            ma, mb = sub[:, :-1], sub[:, 1:]
        m = (a != b) & (a != campo_id) & (b != campo_id) & (ma > 0) & (mb > 0)
        total += int(np.count_nonzero(m))
    metros = total * mm_px * (math.pi / 4.0) / 1000.0
    return metros / max(0.01, area_m2)


def classificar(elementos: list, labels: np.ndarray, mapa: np.ndarray,
                classes_por_id: dict, face_w: int, mm_px: float, params: dict,
                campo_id: int = -99) -> None:
    """Rótulo heurístico + confiança (sem VLM: incerteza é informação)."""
    aspecto_min = p(params, "faixa", "aspecto_min")
    frac_w = p(params, "faixa", "fracao_largura_min")
    for el in elementos:
        if el.tipo == "FAIXA_ORGANICA":   # já tipada pelo destacador
            continue
        x, y, w, h = el.bbox
        aspecto = w / max(1, h)
        zona_px = sum(
            classes_por_id[c].massa_px for c in el.classes
            if c in classes_por_id and classes_por_id[c].tipo == "zona_continua"
        )
        fracao_zona = zona_px / max(1, el.area_px)
        sub = np.isin(mapa[y:y + h, x:x + w], list(el.membros)).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
        n_comp = n - 1
        alturas = stats[1:, cv2.CC_STAT_HEIGHT]
        preenchimento = el.area_px / max(1, w * h)

        texto_como = (
            n_comp >= 4 and alturas.size
            and np.std(alturas) / max(1.0, np.mean(alturas)) < 0.45
            and aspecto > 2.5 and len(el.classes) <= 2
        )
        if fracao_zona > 0.3 and el.area_px * mm_px * mm_px > 0.2e6:
            el.tipo = "FOTO_OU_DEGRADE"
            el.confianca = "media"
        elif texto_como:
            # muitos componentes de altura regular = linha de texto, MESMO
            # atravessando o painel (texto vence faixa)
            el.tipo = "TEXTO"
            el.confianca = "media"
        elif len(el.classes) >= 4 and _mesmo_matiz(el.classes, classes_por_id) and _densidade_tt(
                labels[y:y + h, x:x + w], sub, campo_id, mm_px,
                el.area_px * mm_px * mm_px / 1e6) >= 5.0:
            # mosaico: muitas cores que se ENCOSTAM — a densidade de
            # fronteira interna tinta-tinta (m/m²) separa mosaico (≥6) de
            # logomarca multicor (~1-2); triângulos se tocam e viram um
            # componente só, então n_comp não serve
            el.tipo = "MOSAICO"
            el.confianca = "media"
        elif len(el.classes) >= 2 and preenchimento > 0.25:
            el.tipo = "LOGOMARCA"
            el.confianca = "baixa"
        else:
            el.tipo = "ORNAMENTO"
            el.confianca = "baixa"

        # FAIXA/ONDA (G4 — curva grande e orgânica é FITA, não vinil):
        # poucos componentes · curva lisa (vértices/m baixo) · forma alongada
        # (compacidade alta) · e ATRAVESSA o painel (toca bordas opostas) —
        # logomarca orgânica que flutua no meio (elipse+sombra do ACM) NÃO é
        # faixa
        if (el.tipo in ("ORNAMENTO", "LOGOMARCA") and n_comp <= 3
                and len(el.classes) <= 2
                and el.area_px * mm_px * mm_px >= 0.15e6):
            margem = 50.0 / mm_px
            face_h = labels.shape[0]
            atravessa_h = x <= margem and (x + w) >= face_w - margem
            atravessa_v = y <= margem and (y + h) >= face_h - margem
            if atravessa_h or atravessa_v:
                from .traco import retilineidade
                ret = retilineidade(sub.astype(bool), mm_px, params)
                if ret["vertices_por_m"] <= 8.0 and ret["compacidade"] >= 2.5:
                    el.tipo = "FAIXA_ORGANICA"
                    el.confianca = "media"
                    el.notas.append(
                        f"onda que atravessa o painel ({ret['vertices_por_m']}/m, "
                        f"compacidade {ret['compacidade']}) — candidata a fita "
                        "(substrato = pergunta)"
                    )
