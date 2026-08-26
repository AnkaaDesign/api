"""Pipeline de análise por face — junta todos os estágios.

Saída: dicionário JSON-ável com TUDO que o plano e o orçamento consomem,
cada número com fonte, mais perguntas e divergências como saída de primeira
classe (§8.3 do brief).
"""
from __future__ import annotations

import cv2
import numpy as np

from . import (adesivos, antialias, campo, componentes, degrade, elementos,
               escala, familias, fita, fronteira, io_arte, paleta, quadro,
               topologia, traco)
from .cor import delta_e, srgb_para_lab
from .util import p

PUREZA_RAMPA = 0.30  # abaixo disso a "chapada" é fatia de rampa (banda vazia 0,12–0,65)


def _reclassificar_rampas(part, divergencias: list) -> None:
    """Classe chapada com pureza modal de rampa vira zona contínua (P1).

    É o conserto estrutural do bug histórico do seeder: a rampa dourada do
    BURES virava N 'tintas' com pureza 0,07–0,17. Chapada de verdade fica
    entre 0,65 e 1,00; a banda 0,12–0,65 é vazia no acervo.

    O CAMPO (classe dominante) nunca reclassifica: em render suave de baixa
    resolução (3 IRMÃOS) até o branco tem pureza ~0,3 — e campo-vira-zona
    quebraria a face inteira.
    """
    dominante = max((c for c in part.classes if c.tipo == "chapada"),
                    key=lambda c: c.massa_px, default=None)
    for cl in part.classes:
        if dominante is not None and cl.id == dominante.id:
            continue
        if cl.tipo == "chapada" and cl.pureza < PUREZA_RAMPA and cl.massa_px > 0:
            cl.tipo = "zona_continua"
            divergencias.append({
                "tipo": "chapada-virou-rampa",
                "detalhe": (
                    f"{cl.hex_ancora} tem pureza modal {cl.pureza:.2f} (< {PUREZA_RAMPA}) — "
                    "é fatia de rampa contínua, não tinta chapada; tratada como zona"
                ),
            })


def _classificar_contatos_de_zona(fron: dict, zonas: list, degraus: dict) -> dict:
    """Separa pares zona×tinta em suaves (esfumados) × contornos duros.

    O discriminante é o DEGRAU pixel-a-pixel na fronteira (o mesmo das
    famílias): rampa que encosta na sua própria tinta-base tem degrau ~0
    (esfuma, não corta); contorno duro (caso ACM sombra×elipse) tem degrau
    cheio (corta à mão). Devolve contatos_zona:
    {zona_id: {outro_id: (metros, 'soft'|'hard'|'zona')}}.
    """
    por_id = {z["classe_id"]: z for z in zonas}
    contatos: dict[int, dict] = {}
    pares_novos, esfumada = [], 0.0

    def registrar(zid, outro, m, modo):
        contatos.setdefault(zid, {})[outro] = (m, modo)

    for pr in fron["pares"]:
        a, b = pr["par"]
        za, zb = por_id.get(a), por_id.get(b)
        if za is None and zb is None:
            pares_novos.append(pr)
            continue
        if za is not None and zb is not None:
            esfumada += pr["m"]
            registrar(a, b, pr["m"], "zona")
            registrar(b, a, pr["m"], "zona")
            continue
        z = za or zb
        zid = z["classe_id"]
        outro = b if za is not None else a
        if z["tipo"] == "SOMBRA_SUAVE":
            esfumada += pr["m"]
            registrar(zid, outro, pr["m"], "soft")
            continue
        degrau = degraus.get((min(a, b), max(a, b)))
        if degrau is not None and degrau < 3.0:
            esfumada += pr["m"]
            registrar(zid, outro, pr["m"], "soft")
        else:
            pr["nota"] = (
                f"contorno duro contra zona contínua (degrau {degrau:.1f})"
                if degrau is not None else "contorno contra zona (contato pequeno)"
            )
            registrar(zid, outro, pr["m"], "hard")
            pares_novos.append(pr)
    fron["pares"] = pares_novos
    fron["esfumada_m"] = round(esfumada, 2)
    return contatos


def _fronteira_por_familia(fron: dict, familia_de: dict, zona_ids: set,
                           campo_fid) -> None:
    """Reparte os pares: entre famílias de tinta chapada = corte à mão real;
    intra-família = artefato de rampa; par com ZONA = borda de aerografia
    (fita na cobertura, regra 21/08); par com a FAMÍLIA DO CAMPO = contra o
    fundo (B3: a pintura geral chega curada e o adesivo assenta direto —
    inclusive na VINHETA do próprio fundo, que é a mesma família)."""
    reais, intra, borda_aero, contra_fundo = [], 0.0, 0.0, 0.0
    for pr in fron["pares"]:
        a, b = pr["par"]
        fa, fb = familia_de.get(a), familia_de.get(b)
        if fa is not None and fa == fb:
            intra += pr["m"]
        elif campo_fid is not None and campo_fid in (fa, fb):
            contra_fundo += pr["m"]
        elif a in zona_ids or b in zona_ids:
            borda_aero += pr["m"]
        else:
            pr["familias"] = [fa, fb]
            reais.append(pr)
    fron["pares"] = reais
    fron["intra_familia_m"] = round(intra, 2)
    fron["borda_aerografia_m"] = round(borda_aero, 2)
    fron["total_contra_campo_m"] = round(
        fron.get("total_contra_campo_m", 0.0) + contra_fundo, 2)
    fron["total_tt_m"] = round(sum(pr["m"] for pr in reais), 2)


def analisar_face(caminho: str, params: dict, declarado_m: float | None = None) -> dict:
    arte = io_arte.carregar(caminho, p(params, "moldura", "max_px"))
    if declarado_m is not None:
        # premissa editada (§6): a medida declarada vem do revisor
        arte.declarado_m = declarado_m
    h, w = arte.packed.shape

    esc = escala.resolver(w, h, arte.declarado_m, params)
    mm_px = esc["mm_px"]
    m2px = (mm_px * mm_px) / 1e6

    part = paleta.particionar(arte.rgb, arte.packed, params, mm_px=mm_px)
    del arte.packed
    antialias.resolver_residuo(part, params, mm_px=mm_px)

    divergencias = list(part.divergencias) + list(esc["divergencias"])
    _reclassificar_rampas(part, divergencias)

    # degraus ANTES do campo: a dominância é por agregado de rampa (o campo
    # em vinheta chega fatiado — FOLLY perdia para a chapa cinza)
    degraus_campo = familias.degraus_por_par(part.labels, arte.rgb, None,
                                             min_amostras=12)
    campo_info = campo.decidir(part, params, degraus=degraus_campo)
    if ("sider" in arte.nome.lower() and campo_info["classe"] == "TINTA"
            and campo_info["croma"] <= 12.0):
        # o nome do layout declara SIDER e o fundo é NEUTRO (a lona preta):
        # material de fábrica — não existe demão geral sobre sider. Um campo
        # COM croma (a traseira vermelha do astutilog: portas metálicas)
        # continua TINTA — lá a divergência entre faces já alerta o revisor
        campo_info["classe"] = "CHAPA"
        campo_info["justificativa"] += (
            " — SOBRESCRITO: o nome do layout declara SIDER (lona de "
            "fábrica); o fundo não se pinta")
        divergencias.append({
            "tipo": "material-sider",
            "detalhe": (
                f"'{arte.nome}' declara sider: o fundo {campo_info['hex']} é "
                "material de fábrica (sem demão geral) — toda a arte sai em "
                "recorte/aplicação sobre a lona; confirmar execução"),
        })
    campo_id = campo_info["classe_id"]

    # ---- vinheta/sombreado de RENDER sobre campo CHAPA (R5) ----
    # A vinheta clara do 3 IRMÃOS (5,8 m² de "aerografia" #F0F0F0 na chapa
    # branca) e o sombreado da lona preta do astutilog viravam trabalho
    # fantasma. Zona/classe ACROMÁTICA (croma ≤ 8) a ΔE ≤ 20 do campo-CHAPA
    # neutro, com transição SUAVE, é sombreado do render — funde no campo.
    # Trava do contraexemplo: a rampa dourada do BURES tem croma alto e o
    # campo TINTA (Aquarela) continua no caminho antigo (fusão por família).
    if campo_info["classe"] == "CHAPA" and campo_info["croma"] <= 12.0:
        from .cor import croma as _croma_f
        lab_campo = next(c.lab for c in part.classes if c.id == campo_id)
        fundidas = []

        def _larga_o_bastante(m_c):
            # vinheta do fundo é LARGA; sombra projetada é banda FINA que
            # abraça formas (argus, AKTL) e tem de continuar SOMBRA_SUAVE —
            # espessura mediana ≥ 60 mm e massa ≥ 0,3 m² para fundir
            if int(m_c.sum()) * mm_px * mm_px < 0.3e6:
                return False
            dt = cv2.distanceTransform(m_c.astype(np.uint8), cv2.DIST_L2, 3)
            ok = (dt > 0.5).any() and float(np.median(dt[dt > 0.5])) * 2.0 * mm_px >= 60.0
            del dt
            return ok

        for cl in part.classes:
            if cl.id == campo_id or cl.massa_px == 0:
                continue
            if cl.tipo == "zona_continua":
                m_z = part.labels == cl.id
                ys_z, xs_z = np.nonzero(m_z)
                if ys_z.size == 0:
                    continue
                sel = slice(None, None, max(1, ys_z.size // 20000))
                from .cor import srgb_para_lab as _s2l
                lab_z = _s2l(arte.rgb[ys_z[sel], xs_z[sel]]).mean(axis=0)
                if (float(_croma_f(lab_z)) <= 8.0
                        and float(delta_e(lab_z, lab_campo)) <= 20.0
                        and _larga_o_bastante(m_z)):
                    part.labels[m_z] = campo_id
                    fundidas.append((cl, "zona"))
                del m_z
            elif cl.tipo == "chapada":
                degrau = degraus_campo.get((min(cl.id, campo_id), max(cl.id, campo_id)))
                if (degrau is not None and degrau < 2.5
                        and float(_croma_f(cl.lab)) <= 8.0
                        and float(delta_e(cl.lab, lab_campo)) <= 20.0):
                    m_c = part.labels == cl.id
                    if _larga_o_bastante(m_c):
                        part.labels[m_c] = campo_id
                        fundidas.append((cl, "chapada"))
                    del m_c
        for cl, tp in fundidas:
            campo_cl = next(c for c in part.classes if c.id == campo_id)
            campo_cl.massa_px += cl.massa_px
            cl.massa_px = 0
            divergencias.append({
                "tipo": "vinheta-de-render-na-chapa",
                "detalhe": (
                    f"{cl.hex_ancora if cl.hex_ancora.startswith('#') else tp} "
                    f"acromático a ΔE ≤ 20 do campo {campo_info['hex']} (CHAPA) com "
                    "transição suave — sombreado do render, fundido no campo "
                    "(não é trabalho); editável"),
            })
        part.classes = [c for c in part.classes if c.massa_px > 0]
    del degraus_campo

    antialias.fusao_fina(part, mm_px, params, campo_id=campo_id)

    # zona GRANDE que engoliu OUTRO trabalho encostado (2 amigos: a fita
    # dourada na frente dos morangos): separa ANTES de fronteira/elementos —
    # primeiro por MATIZ (bloco de matiz distinto e coerente), depois a parte
    # LISA (rampa encostada em foto). O texto que pousa na parte separada
    # volta ao ciclo verniz+dia (R2-6).
    m2px_z = mm_px * mm_px / 1e6
    proximo_id = max((c.id for c in part.classes), default=0) + 1
    for cl in list(part.classes):
        if cl.tipo != "zona_continua" or cl.massa_px * m2px_z < 1.5:
            continue
        for metodo, fn in (("matiz", lambda m: degrade.separar_por_matiz(m, arte.rgb, mm_px)),
                           ("lisa", lambda m: degrade.separar_parte_lisa(m, arte.rgb, mm_px, params))):
            m = part.labels == cl.id
            m_sep = fn(m)
            del m
            if m_sep is None:
                continue
            n_sep = int(m_sep.sum())
            part.labels[m_sep] = proximo_id
            part.classes.append(paleta.Classe(
                id=proximo_id, hex_ancora="#rampa", rgb_ancora=(0, 0, 0),
                lab=np.zeros(3, dtype=np.float32), massa_px=n_sep,
                tipo="zona_continua"))
            cl.massa_px -= n_sep
            divergencias.append({
                "tipo": "trabalho-separado-na-zona",
                "detalhe": (
                    f"zona contínua de {(cl.massa_px + n_sep) * m2px_z:.1f} m² tinha um "
                    f"bloco de {n_sep * m2px_z:.1f} m² separável por {metodo} "
                    "(dois trabalhos colados — p.ex. a fita dourada na frente dos "
                    "morangos): separados; cada um recebe a própria técnica"),
            })
            proximo_id += 1
            del m_sep
            if cl.massa_px * m2px_z < 1.0:
                break

    fron = fronteira.medir(part.labels, campo_id, mm_px, params)
    ilhas = componentes.ilhas_de_graca(part.labels, campo_id, mm_px)

    mapa, els = elementos.agrupar(part.labels, campo_id, mm_px, params)
    els = elementos.separar_espalhados(mapa, els, part.labels, campo_id, params)
    els = elementos.destacar_faixas(
        mapa, els, part.labels, campo_id, mm_px, params,
        zona_ids={c.id for c in part.classes if c.tipo == "zona_continua"})
    els = elementos.fundir_linhas(els, mm_px)
    classes_por_id = {c.id: c for c in part.classes}
    elementos.classificar(els, part.labels, mapa, classes_por_id, w, mm_px, params,
                          campo_id=campo_id)

    # zonas contínuas: degradê × aerografia × sombra suave
    zonas = []
    for cl in part.classes:
        if cl.tipo != "zona_continua":
            continue
        m = part.labels == cl.id
        z = degrade.analisar_zona(m, arte.rgb, mm_px, params)
        z["classe_id"] = cl.id
        zonas.append(z)
        del m

    degraus = familias.degraus_por_par(part.labels, arte.rgb, None, min_amostras=12)
    contatos_zona = _classificar_contatos_de_zona(fron, zonas, degraus)
    familia_de, fams = familias.construir(
        part.labels, arte.rgb, part.classes, campo_id, zonas, contatos_zona,
        mm_px, params, degraus=degraus,
        campo_e_tinta=(campo_info["classe"] == "TINTA")
    )
    campo_fid = familia_de.get(campo_id)
    _fronteira_por_familia(fron, familia_de, {z["classe_id"] for z in zonas},
                           campo_fid)

    els = elementos.destacar_aerografias(mapa, els, part.labels, zonas,
                                         campo_id, mm_px)
    elementos.resolver_tecnicas(els, zonas, mapa, mm_px, params,
                                pintura_geral=campo_info["classe"] == "TINTA")

    # o remap "atravessa a zona-casca" vale SÓ para sombras/halos finos —
    # numa zona GRANDE (o banner do 2 amigos) quem pousa nela pousa NELA,
    # e isso é o ciclo verniz→adesivo do texto sobre o banner
    zona_ids = {z["classe_id"] for z in zonas}
    sombras_ids = {z["classe_id"] for z in zonas if z["tipo"] == "SOMBRA_SUAVE"}
    zona_cont = topologia.container_efetivo_de_zonas(part.labels, sombras_ids, campo_id)
    aninh = topologia.analisar_aninhamento(
        part.labels, campo_id, part.classes, mm_px, params,
        zona_container=zona_cont, familia_de=familia_de
    )
    # o MIOLO de uma aerografia nunca é ciclo (A2: adesivo só do contorno
    # externo; tudo dentro da silhueta é à mão livre) — MAS um elemento de
    # ADESIVO que POUSA sobre a aerografia é ciclo legítimo (o texto sobre o
    # banner do 2 amigos: verniz → adesivo → pintar)
    aero_boxes = [e.bbox for e in els if getattr(e, "tecnica", "") == "AEROGRAFIA"]
    adesivo_boxes = [e.bbox for e in els
                     if getattr(e, "tecnica", "ADESIVO") in ("ADESIVO", "STENCIL_FITA",
                                                             "STENCIL_CORTE")]
    aninh_completo = aninh
    if aero_boxes:
        def _em(bb, caixas):
            cx, cy = bb[0] + bb[2] / 2, bb[1] + bb[3] / 2
            return any(x <= cx <= x + w_ and y <= cy <= y + h_
                       for x, y, w_, h_ in caixas)
        aninh = [a for a in aninh
                 if not _em(a["bbox_px"], aero_boxes)
                 or _em(a["bbox_px"], adesivo_boxes)]

    # componente dentro de MOSAICO nunca é ciclo (R2-5: mosaico reto corta
    # fácil à mão — mascara só o contato, cobre e pinta a próxima; replotar
    # um triângulo do meio do mosaico não existe na oficina). A borda dele
    # PAGA corte à mão — e fica FORA do desconto de borda aninhada.
    # Caso: os 2 triângulos do 137 e os verdes da traseira do ACM caíam em
    # "ciclo" e sumiam da fronteira (32,1 m contra os 38,3 da ficha).
    mos_els = [e for e in els if e.tipo == "MOSAICO"]
    if mos_els:
        mos_boxes = [e.bbox for e in mos_els]
        mos_classes = {c for e in mos_els for c in e.classes}

        def _em_mosaico(a_):
            bb = a_["bbox_px"]
            cx, cy = bb[0] + bb[2] / 2, bb[1] + bb[3] / 2
            dentro = any(x <= cx <= x + w_ and y <= cy <= y + h_
                         for x, y, w_, h_ in mos_boxes)
            return (dentro and a_["classe"] in mos_classes
                    and a_["container"] in mos_classes)
        for a_ in aninh_completo:
            if a_["rota"] == "ciclo_verniz_readesivo" and _em_mosaico(a_):
                a_["rota"] = "depilacao_progressiva"
                a_["rota_alternativa"] = None
                a_["nota"] = ("dentro de MOSAICO — depilação progressiva por "
                              "definição (R2-5); a borda paga corte à mão")

    # borda ANINHADA que sai da fronteira à mão: na rota R2/ciclo o adesivo é
    # REPLOTADO (corte de máquina) — não paga faca. Na DEPILAÇÃO PROGRESSIVA
    # a borda FICA: cobrir a tinta fresca ao redor do buraco é papel cortado
    # à mão rente (o 4,0 m do 100F). O miolo de aerografia também sai
    # (pintado à mão livre, sem faca).
    crofton = p(params, "fronteira", "correcao_crofton")
    aninh_ids = {id(a_) for a_ in aninh}
    subtraiveis = [a_ for a_ in aninh if a_["rota"] == "ciclo_verniz_readesivo"]
    subtraiveis += [a_ for a_ in aninh_completo if id(a_) not in aninh_ids]
    borda_aninhada: dict[tuple, float] = {}
    for a_ in subtraiveis:
        for viz, npx in a_.get("borda_px_por_vizinho", {}).items():
            k = tuple(sorted((a_["classe"], int(viz))))
            borda_aninhada[k] = borda_aninhada.get(k, 0.0) + npx * mm_px * crofton / 1000.0
    aninhada_m = 0.0
    for pr in fron["pares"]:
        k = tuple(sorted(pr["par"]))
        if k in borda_aninhada and pr["m"] > 0:
            desconto = min(pr["m"], borda_aninhada[k])
            pr["m"] = round(pr["m"] - desconto, 2)
            aninhada_m += desconto
    fron["pares"] = [pr for pr in fron["pares"] if pr["m"] >= 0.05]
    fron["aninhada_m"] = round(aninhada_m, 2)
    fron["total_tt_m"] = round(sum(pr["m"] for pr in fron["pares"]), 2)
    for a_ in aninh_completo:
        a_.pop("borda_px_por_vizinho", None)

    perfil_traco = {}
    for cl in part.classes:
        if cl.tipo != "chapada" or cl.id == campo_id:
            continue
        m = part.labels == cl.id
        perfil = traco.perfil_abertura(m, mm_px, params)
        perfil["espessura_mediana_mm"] = round(traco.espessura_perpendicular_mm(m, mm_px), 1)
        perfil_traco[cl.id] = perfil
        del m

    # técnica de fita por trecho (R5): o traçado decide amarela × branca nos
    # DOIS substratos — o substrato não está na arte e vira pergunta; a
    # análise carrega os dois cenários para a premissa trocar sem reanálise
    for e_ in els:
        tec_e = getattr(e_, "tecnica", "ADESIVO")
        if tec_e not in ("FITA", "STENCIL_FITA", "STENCIL_CORTE"):
            continue
        ex, ey, ew, eh = e_.bbox
        sub_e = np.isin(mapa[ey:ey + eh, ex:ex + ew], list(e_.membros))
        info_f = fita.analisar_tracado(sub_e, mm_px, params, origem_px=(ex, ey),
                                       so_externo=(tec_e == "FITA"))
        del sub_e
        if info_f is not None:
            e_.fita_info = info_f

    ads, pergs_adesivo = adesivos.agrupar_adesivos(els, mm_px, params, mapa=mapa)

    fams_tinta = [f for f in fams if f.id != campo_fid]

    # ---- perguntas ----
    perguntas = [
        {"pergunta": "substrato do implemento (lisa/corrugada/rebitada/isoplastic/lona)? decide a técnica de fita", "default": "chapa lisa"},
        {"pergunta": "cor com que o implemento chega? decide se a demão de fundo é de graça", "default": "branca"},
    ]
    if campo_info["classe"] == "TINTA" and campo_info["L"] <= 20:
        perguntas.append({
            "pergunta": (
                f"campo praticamente preto ({campo_info['hex']}, L* {campo_info['L']:.0f}): "
                "o baú pode já chegar preto de fábrica — a demão geral é mesmo necessária?"),
            "default": "pintar (como na arte)",
        })
    if campo_info["classe"] == "TINTA":
        for fa in fams_tinta:
            if not fa.membros or fa.m2 < 1.5:
                continue
            lab_f = classes_por_id[fa.membros[0]].lab if fa.membros[0] in classes_por_id else None
            if lab_f is None:
                continue
            Lf = float(lab_f[0])
            Cf = float((float(lab_f[1]) ** 2 + float(lab_f[2]) ** 2) ** 0.5)
            if Lf >= 91.0 and Cf <= 8.0:
                perguntas.append({
                    "pergunta": (
                        f"área BRANCA grande ({fa.m2:.1f} m², {fa.hex_representante}) em campo "
                        "pintado: pintar de branco (padrão — o passo zero cobre o painel todo) "
                        "ou preservar a chapa com máscara no empapelamento (só se o implemento "
                        "chega branco e novo)?"),
                    "default": "pintar de branco (como no A&P da ficha)",
                })
    perguntas.extend(pergs_adesivo)
    tt_fams = {tuple(sorted(pr.get("familias", []))) for pr in fron["pares"] if pr.get("familias")}
    reps = {f.id: f for f in fams_tinta if f.membros}
    for i, fa in enumerate(fams_tinta):
        if not fa.membros:
            continue
        lab_a = classes_por_id[fa.membros[0]].lab if fa.membros[0] in classes_por_id else None
        for fb in fams_tinta[i + 1:]:
            if not fb.membros or tuple(sorted((fa.id, fb.id))) in tt_fams:
                continue
            lab_b = classes_por_id[fb.membros[0]].lab if fb.membros[0] in classes_por_id else None
            if lab_a is None or lab_b is None:
                continue
            d = float(delta_e(lab_a, lab_b))
            if 4.0 <= d <= 14.0:
                perguntas.append({
                    "pergunta": (
                        f"{fa.hex_representante} e {fb.hex_representante} (ΔE {d:.1f}) nunca "
                        "aparecem lado a lado — uma tinta ou duas? Não é decidível pela imagem"
                    ),
                    "default": "duas tintas (como na arte)",
                })
    # par ESCALONADO: dois tons chapados do MESMO matiz se encostando por
    # metros (render posterizado de um degradê — ATACADÃO): esfumar ou cortar?
    from .cor import croma as _croma, matiz_graus as _matiz
    mosaico_classes = {c for e in els if e.tipo == "MOSAICO" for c in e.classes}
    for pr in fron["pares"]:
        a, b = pr["par"]
        ca, cb = classes_por_id.get(a), classes_por_id.get(b)
        if ca is None or cb is None or pr["m"] < 1.5:
            continue
        if a in mosaico_classes or b in mosaico_classes:
            continue
        d = float(delta_e(ca.lab, cb.lab))
        if d > 14.0:
            continue
        cra, crb = float(_croma(ca.lab)), float(_croma(cb.lab))
        if cra > 8 and crb > 8:
            dh = abs(float(_matiz(ca.lab)) - float(_matiz(cb.lab)))
            mesmo_matiz = min(dh, 360 - dh) <= 30
        else:
            mesmo_matiz = cra <= 8 and crb <= 8
        if mesmo_matiz:
            perguntas.append({
                "pergunta": (
                    f"{ca.hex_ancora} e {cb.hex_ancora} (ΔE {d:.1f}, mesmo matiz) se encostam "
                    f"por {pr['m']} m — é um degradê ESCALONADO em 2 tons (pintar os 2 e "
                    "esfumar a separação) ou duas tintas com corte à mão?"
                ),
                "default": "degradê escalonado (2 tons + esfumar)",
            })
    for z in zonas:
        if z["tipo"] == "SOMBRA_SUAVE" and z["area_m2"] >= 0.05:
            perguntas.append({
                "pergunta": (
                    f"sombra/halo esfumado de {z['area_m2']} m² (espessura ~{z.get('espessura_mm')} mm): "
                    "executar na aerografia ou omitir/achatar (decisão comercial)?"
                ),
                "default": "executar (esfumar)",
            })
        elif z["tipo"] == "DEGRADE" and z["area_m2"] >= 0.05:
            perguntas.append({
                "pergunta": (
                    f"degradê de {z.get('de_hex')} a {z.get('para_hex')} ({z['area_m2']} m²): "
                    f"executar com {z.get('tons_sugeridos', 2)} tons chapados + esfumar, "
                    "ou achatar em cor sólida (decisão comercial)?"
                ),
                "default": f"executar ({z.get('tons_sugeridos', 2)} tons + esfumar)",
            })
    if esc["alerta_prior"]:
        divergencias.append({"tipo": "escala-prior", "detalhe": esc["alerta_prior"]})

    total_px = int(part.labels.size)
    tinta_m2 = round(sum(f.m2 for f in fams_tinta), 2)

    # geometria vetorial do QUADRO (brief §5.2) — contornos, nunca filtro
    geo = quadro.montar(part, campo_id, fron, mm_px)
    hex_zona = {z["classe_id"]: z.get("hex_medio") for z in zonas}
    cls_bbox: dict[int, list] = {}
    for cg in geo["classes"]:
        if cg["tipo"] == "zona_continua" and hex_zona.get(cg["classe"]):
            cg["hex"] = hex_zona[cg["classe"]]
        cg["familia"] = familia_de.get(cg["classe"])
        pts = [q_ for pl_ in cg["poligonos"] for q_ in pl_["pontos"]]
        if pts:
            xs_ = [q_[0] for q_ in pts]; ys_ = [q_[1] for q_ in pts]
            cls_bbox[cg["classe"]] = [min(xs_), min(ys_), max(xs_), max(ys_)]
    # bbox por FAMÍLIA (o "papel quadrado" da cobertura usa isto — O3/R3-4)
    fam_bbox: dict[int, list] = {}
    for cid, bb in cls_bbox.items():
        fid = familia_de.get(cid)
        if fid is None:
            continue
        cur = fam_bbox.get(fid)
        fam_bbox[fid] = bb[:] if cur is None else [
            min(cur[0], bb[0]), min(cur[1], bb[1]),
            max(cur[2], bb[2]), max(cur[3], bb[3])]

    # caixas POR PARTE da família (R6, dono 22/08): componentes conexos da
    # máscara da família, com fechamento de ~150 mm para juntar as letras de
    # uma palavra numa parte — a cobertura entre sessões usa ESTAS caixas,
    # nunca o bbox global da família nem o do elemento (o verde das folhas
    # da banana ganhava o painel inteiro pelo mega-elemento; o branco do 137
    # mascarava a face toda pelo bbox da família)
    fam_caixas: dict[int, list] = {}
    _s = 8  # subamostragem: precisão de ~6 mm basta para papel de cobertura
    _k = max(1, int(round(150.0 / (mm_px * _s))))
    _kern = cv2.getStructuringElement(cv2.MORPH_RECT, (_k, _k))
    for f in fams:
        ids_f = list(f.membros) + list(f.zonas)
        if not ids_f:
            continue
        m_f = np.isin(part.labels[::_s, ::_s], ids_f).astype(np.uint8)
        m_f = cv2.morphologyEx(m_f, cv2.MORPH_CLOSE, _kern)
        n_c, _comp, stats_c, _ = cv2.connectedComponentsWithStats(m_f, connectivity=8)
        caixas_f = []
        for i in range(1, n_c):
            a_mm2 = stats_c[i, cv2.CC_STAT_AREA] * (mm_px * _s) ** 2
            if a_mm2 < 2000:   # < 20 cm² não paga faixa própria
                continue
            caixas_f.append([
                round(stats_c[i, cv2.CC_STAT_LEFT] * mm_px * _s),
                round(stats_c[i, cv2.CC_STAT_TOP] * mm_px * _s),
                round(stats_c[i, cv2.CC_STAT_WIDTH] * mm_px * _s),
                round(stats_c[i, cv2.CC_STAT_HEIGHT] * mm_px * _s)])
        caixas_f.sort(key=lambda b: -(b[2] * b[3]))
        # teto: caixa recortada pelo bbox da família +100 mm (fora dele é
        # bug, não medida); mínimo de manuseio de papel: 200×200 mm
        bbf = fam_bbox.get(f.id)
        painel_w = part.labels.shape[1] * mm_px
        painel_h = part.labels.shape[0] * mm_px
        ajustadas = []
        for x0, y0, w0, h0 in caixas_f[:12]:
            if bbf:
                x1i, y1i = x0 + w0, y0 + h0
                x0 = max(x0, bbf[0] - 100); y0 = max(y0, bbf[1] - 100)
                x1i = min(x1i, bbf[2] + 100); y1i = min(y1i, bbf[3] + 100)
                if x1i <= x0 or y1i <= y0:
                    continue
                w0, h0 = x1i - x0, y1i - y0
            if w0 < 200:
                x0 = max(0.0, min(painel_w - 200, x0 - (200 - w0) / 2)); w0 = 200
            if h0 < 200:
                y0 = max(0.0, min(painel_h - 200, y0 - (200 - h0) / 2)); h0 = 200
            ajustadas.append([round(x0), round(y0), round(w0), round(h0)])
        fam_caixas[f.id] = ajustadas
        del m_f

    # perfil de tinta por coluna dos elementos de TEXTO — é o que permite a
    # comparação de conteúdo entre faces sem OCR (o caso "us seja sempre
    # louvado"): fiel aos labels, não aos polígonos simplificados
    perfis: dict[int, list] = {}
    for e_ in els:
        if e_.tipo != "TEXTO" or e_.bbox[2] * mm_px < 300:
            continue
        x, y, w_, h_ = e_.bbox
        sub = np.isin(mapa[y:y + h_, x:x + w_], list(e_.membros))
        col = sub.sum(axis=0).astype(np.float32) / max(1, h_)
        n_bins = max(24, min(512, int(round(w_ / h_ * 64))))
        idx = (np.linspace(0, len(col) - 1e-6, n_bins + 1)).astype(int)
        reamostrado = [float(col[idx[i]:max(idx[i] + 1, idx[i + 1])].mean())
                       for i in range(n_bins)]
        perfis[e_.id] = [round(v * 255) for v in reamostrado]
        del sub

    resultado = {
        "arquivo": arte.nome,
        "moldura_px": arte.moldura_px,
        "escala": {k: v for k, v in esc.items() if k != "divergencias"},
        "render": part.render,
        # premissas do implemento que NÃO estão na arte (§3.2) — sempre
        # visíveis, com fonte, editáveis; o plano lê daqui
        "premissas": {
            "substrato": {
                "valor": p(params, "substrato", "default"),
                "fonte": "pergunta",
                "nota": ("não está na arte — decide fita amarela 20 mm × "
                         "branca 45 mm cortada; os dois cenários estão na análise"),
            },
        },
        "campo": campo_info,
        "pintura_geral": campo_info["classe"] == "TINTA",
        # a demão de fundo é a FAMÍLIA do campo — inclui a vinheta do próprio
        # fundo quando o campo é um degradê (Aquarela)
        "demao_fundo_m2": (
            round(next((f.m2 for f in fams if f.id == campo_fid),
                       classes_por_id[campo_id].massa_px * m2px), 2)
            if campo_info["classe"] == "TINTA" else 0.0
        ),
        "paleta": {
            "n_tintas": len(fams_tinta),
            "familias": [
                {
                    "id": f.id,
                    "hex": f.hex_representante,
                    "m2": f.m2,
                    # membros incluem os EXTREMOS das rampas anexadas — é o
                    # que permite casar "verde-claro/verde-escuro" com uma
                    # família cujo miolo é zona de degradê
                    "membros": (
                        [classes_por_id[m].hex_ancora for m in f.membros if m in classes_por_id]
                        + [h for z in zonas if z["classe_id"] in f.zonas
                           for h in (z.get("de_hex"), z.get("para_hex"), z.get("hex_medio"))
                           if h]
                    ),
                    "zonas": f.zonas,
                    "rampa": f.rampa_significativa,
                    "campo": f.id == campo_fid,
                    "bbox_mm": fam_bbox.get(f.id),
                    # caixas por PARTE (componentes aglutinados) — a
                    # cobertura entre sessões cobre estas, não o bbox
                    "caixas_partes_mm": fam_caixas.get(f.id) or [],
                }
                for f in sorted(fams, key=lambda f: -f.m2)
            ],
            "classes": [
                {
                    "id": c.id, "hex_ancora": c.hex_ancora, "tipo": c.tipo,
                    "m2": round(c.massa_px * m2px, 3),
                    "pureza": round(c.pureza, 2),
                    "familia": familia_de.get(c.id),
                    "membros_hex": c.membros_hex[:8],
                }
                for c in sorted(part.classes, key=lambda c: -c.massa_px)
            ],
        },
        "tinta_m2_total": tinta_m2,
        "fronteira": fron,
        "ilhas_de_graca": {"n": len(ilhas), "area_m2": round(sum(i["area_mm2"] for i in ilhas) / 1e6, 3)},
        "edicao_tecnicas": {},   # {elemento_id: tecnica} — preenchido pelo revisor (§6)
        "edicao_tintas": {},     # {familia_id: {nome, hex, preco_litro}} — idem
        "elementos": [
            {
                "id": e.id, "tipo": e.tipo, "confianca": e.confianca,
                "tecnica": e.tecnica, "tecnica_fonte": e.tecnica_fonte,
                "classes": e.classes,
                "dim_mm": {
                    "x": round(e.bbox[0] * mm_px), "y": round(e.bbox[1] * mm_px),
                    "w": round(e.bbox[2] * mm_px), "h": round(e.bbox[3] * mm_px),
                },
                "area_m2": round(e.area_px * m2px, 3),
                "notas": sorted(set(e.notas)),
                **({"perfil": perfis[e.id]} if e.id in perfis else {}),
                **({"fita": e.fita_info} if getattr(e, "fita_info", None) else {}),
            }
            for e in sorted(els, key=lambda e: -e.area_px)
        ],
        "zonas_continuas": zonas,
        "quadro": geo,
        "aninhamento": aninh,
        "traco_por_classe": perfil_traco,
        "adesivos": ads,
        "perguntas": perguntas,
        "divergencias": divergencias,
    }
    resultado["_interno"] = {
        "labels": part.labels,
        "classes": part.classes,
        "campo_id": campo_id,
        "campo_fid": campo_fid,
        "familia_de": familia_de,
        "familias": fams,
        "mm_px": mm_px,
        "elementos_obj": els,
        "mapa": mapa,
    }
    return resultado


def limpar_interno(analise: dict) -> dict:
    return {k: v for k, v in analise.items() if not k.startswith("_")}
