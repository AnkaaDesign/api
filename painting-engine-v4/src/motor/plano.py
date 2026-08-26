"""Plano de produção: passos reais de oficina, por condição — nunca template.

CALENDÁRIO POR REGRA (R2-4, dono 21/08), nunca por horas:
  · sem pintura geral → 1 dia (a logomarca inteira)
  · com pintura geral → 2 dias (dia 1 = lavagem→…→demão de fundo, cura)
  · aerografia significativa → dia PRÓPRIO (não se faz nada junto)
  · verniz intermediário (base em rampa/aerografia) → quebra dia
  · rota R2 (pinta → seca → reaplica adesivo) fica no MESMO dia

Cada passo carrega o ESTADO cumulativo (famílias pintadas, famílias já
cobertas, papel aplicado) e a ATUAÇÃO — é o que o quadro desenha (R2-2/R2-3:
o papel e as coberturas ficam visíveis até a remoção; o passo de cobrir
mostra o que cobre e o corte quando há fronteira).

Papel TK por orientação (R2-1): peças verticais na bobina de 100 cm, peças
horizontais na de 50 cm — itens de material separados.

Degradê pinta a JANELA inteira do adesivo (R2-9): um passo por elemento,
custo de tinta pela área da janela; o vinil mascara o interno.
"""
from __future__ import annotations

from .util import p


def _passo(o_que, escopo, estado, frase, trilha="", materiais=None, tempo=None,
           dependencias=None, confianca="media", geometria=None,
           estado_familias=None, cobertas=None, papel_aplicado=False,
           adesivos_aplicados=None, atuacao=None):
    return {
        "o_que": o_que,
        "escopo": escopo,
        "estado_da_peca": estado,
        "estado_familias": list(estado_familias or []),
        "cobertas": list(cobertas or []),
        "papel_aplicado": papel_aplicado,
        # LISTA cumulativa dos adesivos já na peça no início do passo (R5:
        # a aplicação é um passo POR adesivo, como no plano de referência)
        "adesivos_aplicados": list(adesivos_aplicados or []),
        "atuacao": atuacao or {"tipo": "sem_geometria"},
        "geometria": geometria or {},
        "materiais": materiais or [],
        "tempo": tempo,
        "dependencias": dependencias or [],
        "justificativa": {"frase": frase, "trilha": trilha},
        "confianca": confianca,
    }


def _mat(item, base, base_un, consumo, consumo_un, qtd, qtd_un, fonte,
         preco=None):
    total = round(qtd * preco, 2) if preco else None
    return {
        "item": item,
        "medida_base": round(base, 2), "unidade_base": base_un,
        "consumo_por_unidade": consumo, "unidade_consumo": consumo_un,
        "quantidade": round(qtd, 2), "unidade": qtd_un,
        "preco_unitario": preco, "total": total,
        "fonte": fonte,
    }


def _tempo(base, base_un, taxa, taxa_un, fonte="chute"):
    horas = base / taxa if taxa else None
    return {"medida_base": round(base, 2), "unidade_base": base_un,
            "taxa": taxa, "unidade_taxa": taxa_un,
            "horas": round(horas, 2) if horas else None, "fonte": fonte}


def gerar(analise: dict, params: dict) -> dict:
    mm_px = analise["_interno"]["mm_px"]
    campo_id = analise["_interno"]["campo_id"]
    campo_fid = analise["_interno"]["campo_fid"]
    fams = analise["_interno"]["familias"]
    familia_de = analise["_interno"]["familia_de"]
    els = analise["_interno"]["elementos_obj"]
    fams_por_id = {f.id: f for f in fams}
    classes_por_id = {c.id: c for c in analise["_interno"]["classes"]}
    ed_tintas = analise.get("edicao_tintas") or {}

    def hex_classe(cid):
        c = classes_por_id.get(cid)
        return c.hex_ancora if c is not None else f"classe {cid}"

    def nome_tinta(fid):
        e = ed_tintas.get(str(fid)) or ed_tintas.get(fid) or {}
        base = fams_por_id[fid].hex_representante if fid in fams_por_id else "?"
        return e.get("nome") or e.get("hex") or base

    def preco_tinta(fid):
        e = ed_tintas.get(str(fid)) or ed_tintas.get(fid) or {}
        return e.get("preco_litro")

    painel_m2 = analise["escala"]["painel_mm"]["w"] * analise["escala"]["painel_mm"]["h"] / 1e6
    substrato = ((analise.get("premissas") or {}).get("substrato") or {}).get("valor", "lisa")
    outro_substrato = "corrugada" if substrato == "lisa" else "lisa"
    dias: list[dict] = []
    dia_atual: list[dict] = []
    pintadas: set[int] = set()
    cobertas: set[int] = set()
    aplicados: list[str] = []   # ids de adesivo já na peça
    tem_papel = False

    def add(*args, **kw):
        kw.setdefault("estado_familias", sorted(pintadas))
        kw.setdefault("cobertas", sorted(cobertas))
        kw.setdefault("papel_aplicado", tem_papel)
        kw.setdefault("adesivos_aplicados", list(aplicados))
        dia_atual.append(_passo(*args, **kw))

    def fecha_dia(motivo=""):
        nonlocal dia_atual
        if dia_atual:
            dias.append({"dia": len(dias) + 1, "passos": dia_atual, "quebra": motivo})
            dia_atual = []

    rend = p(params, "consumo", "rendimento_tinta_m2_por_l")

    # ============ DIA DE PREPARO + PINTURA GERAL (regra: um dia só) ============
    if analise["pintura_geral"]:
        area = painel_m2
        add("Lavagem da superfície", "face",
            "a peça como chegou — painel em branco, sem arte nenhuma",
            "A face leva pintura geral (o campo do desenho é tinta): lava-se a superfície inteira antes de tudo.",
            f"campo {analise['campo']['hex']} classificado TINTA: {analise['campo']['justificativa']}",
            materiais=[_mat("produto de lavagem", area, "m²", 1, "un/m²", area, "m²", "parametro")],
            tempo=_tempo(area, "m²", p(params, "produtividade", "lavagem_m2_h"), "m²/h"),
            atuacao={"tipo": "preparo", "area_m2": round(area, 1)})
        add("Secagem", "face", "face lavada",
            "A superfície precisa secar antes do desengraxe.", "",
            atuacao={"tipo": "espera"})
        add("Desengraxe", "face", "face seca",
            "Desengraxe da superfície inteira que recebe a demão de fundo.", "",
            materiais=[_mat("desengraxante", area, "m²", 1, "un/m²", area, "m²", "parametro")],
            tempo=_tempo(area, "m²", p(params, "produtividade", "desengraxe_m2_h"), "m²/h"),
            atuacao={"tipo": "preparo", "area_m2": round(area, 1)})
        perim = 2 * (analise["escala"]["painel_mm"]["w"] + analise["escala"]["painel_mm"]["h"]) / 1000.0
        add("Empapelamento e mascaramento das partes que não recebem tinta", "implemento",
            "face desengraxada",
            "Perfis, borrachas, faixa refletiva e chassi são protegidos antes da pintura geral.",
            "a extensão real vem das MEDIDAS DO IMPLEMENTO (tabela por tipo), não da arte — estimada pelo perímetro do painel",
            materiais=[
                _mat("fita branca 45 mm", perim, "m", 1.1, "m/m", perim * 1.1, "m", "estimativa"),
                _mat("papel TK 100 (vertical)", 2 * analise["escala"]["painel_mm"]["h"] / 1000.0,
                     "m", 1.1, "m/m", 2.2 * analise["escala"]["painel_mm"]["h"] / 1000.0,
                     "m corrido", "estimativa"),
                _mat("papel TK 50 (horizontal)", 2 * analise["escala"]["painel_mm"]["w"] / 1000.0,
                     "m", 1.1, "m/m", 2.2 * analise["escala"]["painel_mm"]["w"] / 1000.0,
                     "m corrido", "estimativa"),
            ],
            tempo=_tempo(perim, "m", p(params, "produtividade", "empapelamento_estrutural_m_h"), "m/h"),
            confianca="baixa",
            atuacao={"tipo": "papel_estrutural", "perimetro_m": round(perim, 1)})
        demaos = p(params, "sistema_pintura", "demaos_fundo")
        litros = area * demaos / rend
        preco_f = preco_tinta(campo_fid)
        add(f"Demão de fundo — {nome_tinta(campo_fid)} no painel inteiro ({demaos} demãos)", "face",
            "face protegida, pronta para tinta",
            f"A cor de campo do desenho ({analise['campo']['hex']}) vai no painel inteiro, primeiro, "
            "venha a carreta da cor que vier. Se ela já chegar exatamente nessa cor, este passo sai de graça (pergunta).",
            f"{area:.1f} m² × {demaos} demãos / {rend} m²/L = {litros:.1f} L de mistura pronta",
            materiais=[_mat(f"tinta {nome_tinta(campo_fid)} (mistura pronta)", area * demaos,
                            "m²", 1.0 / rend, "L/m²", litros, "L",
                            "editada" if preco_f else "parametro", preco=preco_f)],
            tempo=_tempo(area * demaos, "m²", p(params, "produtividade", "pintura_pistola_m2_h"), "m²/h"),
            atuacao={"tipo": "pintura", "familias": [campo_fid]})
        pintadas.add(campo_fid)
        fecha_dia("cura da pintura geral — o adesivo só cola sobre tinta curada (dia inteiro)")

    estado_base = (
        f"painel na cor de fundo {analise['campo']['hex']}, curado"
        if analise["pintura_geral"]
        else "chapa como chegou (campo do desenho = chapa branca)"
    )

    # ============ DIA PRÓPRIO DA AEROGRAFIA (não se faz nada junto) ============
    zonas_aero = [z for z in analise["zonas_continuas"] if z["tipo"] == "AEROGRAFIA"]
    aero_m2 = sum(z["area_m2"] for z in zonas_aero)
    dia_proprio_aero = aero_m2 >= p(params, "calendario", "aerografia_dia_proprio_min_m2")
    # ciclos verniz+readesivo cuja BASE é uma aerografia com dia próprio: o
    # verniz entra no FIM do dia da aerografia e cura durante a noite — não
    # se gasta um dia só para a cura (mar e rio ia a 4 dias por isso)
    ciclos_todos = [a for a in analise["aninhamento"] if a["rota"] == "ciclo_verniz_readesivo"]
    ciclos_por_container: dict[int, int] = {}
    for c in ciclos_todos:
        ciclos_por_container[c["container"]] = ciclos_por_container.get(c["container"], 0) + 1
    cobrir_depois: list[tuple] = []
    for z in zonas_aero:
        a = z["area_m2"]
        zid = z["classe_id"]
        fid_zona = familia_de.get(zid)
        perim_est = 4.0 * (a ** 0.5)
        add("Aplicar adesivo do contorno EXTERNO da aerografia", "elemento", estado_base,
            "Aerografia leva adesivo só da silhueta externa — nada de miolo, nenhuma depilação interna.",
            f"zona contínua de {a} m² (R² rampa {z['r2_rampa']}, entropia de matiz {z['entropia_matiz_bits']} bits)",
            materiais=[_mat("vinil (contorno externo)", a, "m²", 1, "m²/m²", a, "m²", "medido")],
            tempo=_tempo(a, "m²", p(params, "produtividade", "aplicacao_adesivo_m2_h"), "m²/h"),
            atuacao={"tipo": "adesivo_aerografia", "zonas": [zid]})
        add("Aerografia (tom contínuo, à mão livre)", "elemento", "silhueta externa mascarada",
            "Tom contínuo/fotográfico não sai de recorte: é aerografia — e aerografia tem dia próprio, "
            "não se faz nada junto dela.",
            "regra do dono (21/08): aerografias primeiro; depois cobre-se e começa o resto da logomarca",
            tempo=_tempo(a, "m²", p(params, "produtividade", "aerografia_m2_h"), "m²/h"),
            atuacao={"tipo": "aerografia", "zonas": [zid],
                     "familias": [fid_zona] if fid_zona is not None else []})
        if fid_zona is not None:
            pintadas.add(fid_zona)
        n_el_sobre = ciclos_por_container.get(zid, 0) if dia_proprio_aero else 0
        if n_el_sobre:
            add(f"Verniz sobre a aerografia — vai receber adesivo por cima ({n_el_sobre} elementos)",
                "elemento", "aerografia seca ao toque",
                "Elementos serão aplicados SOBRE esta aerografia: o verniz entra hoje, no fim do dia da "
                "aerografia, e cura durante a noite — amanhã o adesivo cola sobre verniz curado, sem "
                "gastar um dia só de cura (caso 2 amigos: texto sobre o banner envernizado).",
                "doutrina 2.6 + regra do dono (21/08): a rota sem verniz não protege a rampa do estilete",
                materiais=[_mat("verniz", a, "m²",
                                1.0 / p(params, "consumo", "rendimento_verniz_m2_por_l"), "L/m²",
                                a / p(params, "consumo", "rendimento_verniz_m2_por_l"), "L", "parametro")],
                tempo=_tempo(a, "m²", p(params, "produtividade", "verniz_m2_h"), "m²/h"),
                atuacao={"tipo": "verniz_intermediario", "zonas": [zid]})
            # a cobertura passa para a manhã seguinte: papel sobre verniz fresco colaria
            cobrir_depois.append((zid, fid_zona, a, perim_est))
            continue
        add("Cobrir a aerografia — fita nas bordas + papel no centro", "elemento",
            "aerografia pronta",
            "Fita em toda a parte que será necessário cortar depois; papel no centro — "
            "cobrir só com máscara sairia muito caro.",
            "regra do dono (21/08)",
            materiais=[
                _mat("fita branca 45 mm (bordas da aerografia)", perim_est, "m", 1.1, "m/m", perim_est * 1.1, "m", "estimativa"),
                _mat("papel TK (centro)", a, "m²", 1.1, "m corrido/m²", a * 1.1, "m corrido", "estimativa"),
            ],
            tempo=_tempo(perim_est, "m", p(params, "produtividade", "fita_curva_m_h"), "m/h"),
            atuacao={"tipo": "cobertura_aerografia", "zonas": [zid]})
        if fid_zona is not None:
            cobertas.add(fid_zona)
    if zonas_aero and dia_proprio_aero:
        fecha_dia("aerografia tem dia próprio — secagem antes da logomarca"
                  + (" (o verniz cura durante a noite)" if cobrir_depois else ""))
    for zid, fid_zona, a, perim_est in cobrir_depois:
        add("Cobrir a aerografia — fita nas bordas + papel no centro", "elemento",
            "verniz da aerografia curado desde o dia anterior",
            "Fita em toda a parte que será necessário cortar depois; papel no centro — "
            "cobrir só com máscara sairia muito caro. A cobertura entra agora porque papel "
            "sobre verniz fresco colaria.",
            "regra do dono (21/08)",
            materiais=[
                _mat("fita branca 45 mm (bordas da aerografia)", perim_est, "m", 1.1, "m/m", perim_est * 1.1, "m", "estimativa"),
                _mat("papel TK (centro)", a, "m²", 1.1, "m corrido/m²", a * 1.1, "m corrido", "estimativa"),
            ],
            tempo=_tempo(perim_est, "m", p(params, "produtividade", "fita_curva_m_h"), "m/h"),
            atuacao={"tipo": "cobertura_aerografia", "zonas": [zid]})
        if fid_zona is not None:
            cobertas.add(fid_zona)

    # ============ DIA DA LOGOMARCA (a arte inteira) ============
    ids_adesivos = [ad["id"] for ad in analise["adesivos"]]
    vinil_total = sum(ad["vinil_m2"] for ad in analise["adesivos"])
    els_tecnica = [e for e in els
                   if getattr(e, "tecnica", "ADESIVO") in ("FITA", "STENCIL_FITA",
                                                           "STENCIL_CORTE")]
    if analise["adesivos"] or els_tecnica:
        # C12 do brief: preparação LOCALIZADA da superfície — só as áreas que
        # recebem adesivo/trabalho, com geometria simplificada (§4.4)
        area_loc = (sum(ad["envelope_mm"]["w"] * ad["envelope_mm"]["h"]
                        for ad in analise["adesivos"])
                    + sum(e.bbox[2] * e.bbox[3] * mm_px * mm_px for e in els_tecnica)) / 1e6
        frase_loc = (
            "Limpeza leve (tack) sobre a demão curada, só nas áreas que recebem adesivo e trabalho de arte."
            if analise["pintura_geral"] else
            "Desengraxe localizado APENAS nas áreas que vão receber adesivo e trabalho de arte — "
            "sem pintura geral não se lava a face inteira.")
        add("Limpeza e desengraxe das áreas de trabalho", "face", estado_base,
            frase_loc,
            "geometria simplificada (§4.4): as caixas dos adesivos e dos elementos, não o contorno das letras",
            materiais=[_mat("desengraxante", area_loc, "m²", 1, "un/m²", area_loc, "m²", "parametro")],
            tempo=_tempo(area_loc, "m²", p(params, "produtividade", "desengraxe_m2_h"), "m²/h"),
            atuacao={"tipo": "limpeza_localizada", "adesivos": ids_adesivos,
                     "elementos": [e.id for e in els_tecnica]})
    if analise["adesivos"]:
        n_folhas = sum(len(ad.get("folhas") or []) or 1 for ad in analise["adesivos"])
        add("Plotagem dos adesivos", "face", estado_base,
            f"{len(analise['adesivos'])} adesivos ({n_folhas} folhas) plotados e preparados na bancada — "
            "só o traço de corte do plotter: a folha vai INTEIRA para a peça e a depilação "
            "libera cada cor na sua vez, no lugar (não na bancada). "
            "A máquina de corte nunca é gargalo; isto é tempo de manuseio.",
            "; ".join(f"{ad['id']}: {ad['envelope_mm']['w']}×{ad['envelope_mm']['h']} mm, bobina {ad['bobina_mm']}"
                      + (f" [{len(ad['folhas'])} folhas — economia de {ad.get('economia_folha_m2', 0)} m² (R2-7)]"
                         if ad.get("folhas") else
                         (f", {ad['pecas_emenda']} peças (emenda)" if ad["pecas_emenda"] > 1 else ""))
                      for ad in analise["adesivos"]),
            materiais=[_mat("vinil", vinil_total, "m²", 1, "m²/m²", vinil_total, "m²", "medido")],
            tempo=_tempo(vinil_total, "m²", p(params, "produtividade", "depilacao_m2_h"), "m²/h"),
            atuacao={"tipo": "bancada", "adesivos": ids_adesivos})
        # um passo POR adesivo (R5, plano de referência): dá para ver cada
        # folha assentando, na ordem do maior para o menor
        for ad in analise["adesivos"]:
            ev = ad["envelope_mm"]
            desc_folhas = (f", em {len(ad['folhas'])} folhas registradas"
                           if ad.get("folhas") else "")
            add(f"Aplicar {ad['id']} — {ev['w']}×{ev['h']} mm (bobina {ad['bobina_mm']}{desc_folhas})",
                "elemento", estado_base if not aplicados else
                f"adesivos {', '.join(aplicados)} já na peça",
                f"O adesivo é aplicado INTEIRO{desc_folhas}; o que muda entre as sessões é a depilação. "
                f"Aproveitamento do filme: {ad.get('aproveitamento_pct', 0):.0f}%.",
                ad.get("nota_emenda", ""),
                materiais=[_mat("vinil", ad["vinil_m2"], "m²", 1, "m²/m²",
                                ad["vinil_m2"], "m²", "medido")],
                tempo=_tempo(ad["vinil_m2"], "m²",
                             p(params, "produtividade", "aplicacao_adesivo_m2_h"), "m²/h"),
                atuacao={"tipo": "adesivo_um", "adesivos": [ad["id"]]})
            aplicados.append(ad["id"])
        # papel/fita pelos LADOS reais, POR TRECHO (R3-2 + R6): um vizinho
        # que encosta só em parte do lado cobre só aquele trecho — o resto
        # leva papel (V=bobina 100, H=bobina 50) + fita na junta; vão ≤2
        # passadas de fita branca leva só fita
        v_m = h_m = fita_junta_m = fita_vao_m = 0.0
        for ad in analise["adesivos"]:
            for lado, info in (ad.get("lados") or {}).items():
                trechos = info.get("trechos") or [
                    {"tipo": info["tipo"], "de_mm": 0,
                     "ate_mm": info["trecho_mm"]}]
                for t in trechos:
                    comp = (t["ate_mm"] - t["de_mm"]) / 1000.0
                    if t["tipo"] == "papel":
                        if lado in ("esq", "dir"):
                            v_m += comp
                        else:
                            h_m += comp
                        fita_junta_m += comp
                    elif t["tipo"] == "fita":
                        fita_vao_m += 2 * comp  # 2 passadas escondem o vão
        add("Empapelamento ao redor dos adesivos", "face", "adesivos aplicados",
            "Papel só onde há chapa exposta: lado que ENCOSTA em outra caixa não leva nada; vão pequeno "
            "entre caixas fecha com 2 passadas de fita branca; no resto, papel — peças LATERAIS da bobina "
            "de 100 cm e TOPO/BASE da de 50 cm, presas por fita branca de 45 mm na junta."
            + ("" if analise["pintura_geral"] else " Sem pintura geral, o empapelamento é só esta cinta contra overspray."),
            "lados por adesivo em analise.adesivos[].lados (R3-2); fita de vão = 2 passadas × trecho",
            materiais=[
                _mat("papel TK 100 (peças verticais)", v_m, "m", 1.1, "m/m", v_m * 1.1, "m corrido", "medido"),
                _mat("papel TK 50 (peças horizontais)", h_m, "m", 1.1, "m/m", h_m * 1.1, "m corrido", "medido"),
                _mat("fita branca 45 mm (juntas)", fita_junta_m, "m", 1.1, "m/m", fita_junta_m * 1.1, "m", "medido"),
            ] + ([_mat("fita branca 45 mm (vãos entre adesivos)", fita_vao_m, "m", 1, "m/m",
                       fita_vao_m, "m", "medido")] if fita_vao_m else []),
            tempo=_tempo(v_m + h_m + fita_vao_m, "m",
                         p(params, "produtividade", "empapelamento_localizado_m_h"), "m/h"),
            atuacao={"tipo": "papel", "adesivos": ids_adesivos})
        tem_papel = True

    # UMA cor por rodada, da MENOR área para a MAIOR (plano de referência,
    # 22/08): FRONTEIRAS e TRANSPORTADORA não entram na mesma rodada mesmo
    # sem se encostarem — a produção pinta cor a cor, e a depilação libera
    # cada cor na sua vez, no lugar
    pares_fam = [
        {"par": pr["familias"], "m": pr["m"]}
        for pr in analise["fronteira"]["pares"]
        if pr.get("familias") and None not in pr["familias"]
    ]
    area_de = {f.id: f.m2 for f in fams}

    import math as _math
    fam_bbox = {f["id"]: f.get("bbox_mm") for f in analise["paleta"]["familias"]}

    # caixas POR PARTE da cor (plano de referência, 22/08): cobre-se a caixa
    # de cada PARTE (elemento) que contém a cor — nunca a caixa da FAMÍLIA:
    # o branco do 137 espalha-se pela face inteira e a caixa da família
    # mascarava TUDO (48 m de máscara para 0,3 m² de tinta)
    fam_partes = {f["id"]: f.get("caixas_partes_mm") or []
                  for f in analise["paleta"]["familias"]}

    # a parte da cor executada por FITA/STENCIL pinta NO passo da técnica —
    # a sessão de depilação não pode roubar a faixa (dono, 22/08: o amarelo
    # do A&P pintava inteiro na sessão e o passo FITA ficava sem sentido).
    # Fração por interseção das caixas-parte com os elementos de técnica.
    els_tec = [e for e in els if getattr(e, "tecnica", "ADESIVO") in
               ("FITA", "STENCIL_FITA", "STENCIL_CORTE")]

    def _frac_tecnica(fid):
        cxs = fam_partes.get(fid) or []
        if not cxs or not els_tec:
            return 0.0
        tot = sum(b[2] * b[3] for b in cxs) or 1.0
        dentro = 0.0
        for b in cxs:
            for e in els_tec:
                ex, ey = e.bbox[0] * mm_px, e.bbox[1] * mm_px
                ew, eh = e.bbox[2] * mm_px, e.bbox[3] * mm_px
                ix = max(0.0, min(b[0] + b[2], ex + ew) - max(b[0], ex))
                iy = max(0.0, min(b[1] + b[3], ey + eh) - max(b[1], ey))
                dentro += ix * iy
        return min(1.0, dentro / tot)

    area_sessao_fam = {f.id: round(area_de.get(f.id, 0)
                                   * (1.0 - _frac_tecnica(f.id)), 3)
                       for f in fams}
    # tinta que sobra para o passo da técnica, por família (consumida lá)
    tinta_tecnica_fam = {f.id: round(area_de.get(f.id, 0)
                                     - area_sessao_fam[f.id], 3)
                         for f in fams}
    pintaveis = [f.id for f in fams if f.id != campo_fid and f.membros
                 and f.id not in pintadas
                 and area_sessao_fam.get(f.id, 0) > 0.01]
    sessoes = [[c] for c in sorted(pintaveis,
                                   key=lambda c: area_sessao_fam.get(c, 0))]

    def caixas_da_familia(fid):
        # 1º as caixas por PARTE medidas na análise (componentes aglutinados)
        caixas = [list(b) for b in fam_partes.get(fid, [])]
        if caixas:
            return caixas
        # fallback: elementos que contêm a cor, SEMPRE recortados pelo bbox
        # da família (nunca o envelope cru de elemento multi-família — o
        # mega-grupo da banana dava o painel inteiro); por último, o bbox
        bb = fam_bbox.get(fid)
        f = fams_por_id.get(fid)
        membros = (set(f.membros) | set(f.zonas)) if f is not None else set()
        for e in els:
            if not (membros & set(e.classes)):
                continue
            x0, y0 = e.bbox[0] * mm_px, e.bbox[1] * mm_px
            x1, y1 = x0 + e.bbox[2] * mm_px, y0 + e.bbox[3] * mm_px
            if bb:
                x0, y0 = max(x0, bb[0]), max(y0, bb[1])
                x1, y1 = min(x1, bb[2]), min(y1, bb[3])
                if x1 <= x0 or y1 <= y0:
                    continue
            caixas.append([round(x0), round(y0), round(x1 - x0), round(y1 - y0)])
        if not caixas and bb:
            caixas.append([bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]])
        return caixas

    # depois da última cor ainda vem trabalho de tinta? (se não vem, a última
    # cor não é coberta — ninguém vai sujá-la; plano de referência)
    ha_trabalho_depois = (
        any(z["tipo"] == "DEGRADE" for z in analise["zonas_continuas"])
        or any(z["tipo"] == "SOMBRA_SUAVE" and z["area_m2"] >= 0.02
               for z in analise["zonas_continuas"])
        or any(getattr(e, "tecnica", "ADESIVO") in ("FITA", "STENCIL_FITA",
                                                    "STENCIL_CORTE") for e in els)
        or bool(ciclos_todos)
    )

    fron_por_par = {tuple(sorted(pr["par"])): pr["m"] for pr in pares_fam}
    demaos_cor = p(params, "sistema_pintura", "demaos_cor")
    if analise["pintura_geral"] and analise["campo"]["L"] < 50:
        demaos_cor = p(params, "sistema_pintura", "demaos_cor_clara_sobre_escura")

    for si, sessao in enumerate(sessoes, 1):
        cores_txt = ", ".join(nome_tinta(c) for c in sessao)
        estado = (
            f"{estado_base}; adesivos aplicados e empapelados; já pintadas e cobertas: "
            + (", ".join(nome_tinta(c) for c in sorted(cobertas)) if cobertas else "nenhuma")
        )
        area_sessao = sum(area_sessao_fam.get(c, 0) for c in sessao)
        mats = []
        for c in sessao:
            a_c = area_sessao_fam.get(c, 0)
            pr_c = preco_tinta(c)
            mats.append(_mat(f"tinta {nome_tinta(c)} (mistura pronta)", a_c * demaos_cor,
                             "m²", 1.0 / rend, "L/m²", a_c * demaos_cor / rend, "L",
                             "editada" if pr_c else "parametro", preco=pr_c))
        ord_txt = "a menor área" if si == 1 else f"a {si}ª menor área"
        add(f"Pintura {cores_txt} — depilar e pintar", "cor", estado,
            f"UMA cor por rodada, da menor para a maior — {ord_txt} ({area_sessao:.2f} m²). "
            "A depilação libera no adesivo, agora, só o que é desta cor; o resto continua protegido pelo vinil.",
            f"plano de referência (22/08): pintura por COR ({si} de {len(sessoes)}); a depilação é no lugar, cor a cor — a bancada só plota",
            materiais=mats,
            tempo=_tempo(area_sessao * demaos_cor, "m²",
                         p(params, "produtividade", "pintura_pistola_m2_h"), "m²/h"),
            atuacao={"tipo": "pintura", "familias": sorted(sessao)})
        pintadas.update(sessao)
        # cobertura entre sessões (R6, dono 22/08): o corte à mão pertence à
        # cobertura da cor que encosta em cor AINDA POR PINTAR — é contra
        # essa aresta cortada rente que a PRÓXIMA tinta entra. Fronteira com
        # cor JÁ pintada não corta nada aqui: foi cortada quando a vizinha
        # foi coberta. Sem corte, a cobertura é PAPEL em faixas sobre a
        # caixa de cada PARTE da cor, preso com fita branca.
        pend = [c2 for c2 in pintaveis if c2 not in pintadas]
        corte_m = sum(
            fron_por_par.get(tuple(sorted((c, q))), 0.0)
            for c in sessao for q in pend
        )
        if not pend and not ha_trabalho_depois:
            # última cor e nada vem depois: não se cobre o que ninguém vai
            # sujar (plano de referência — a última pintura fica exposta)
            continue
        # gate de sanidade (R6-5): Σ caixas > 20× a tinta da família ⇒ a
        # medição está doente — recorta para o bbox e carimba ESTIMADA
        caixas_cob = []
        cob_estimada = False
        for c in sessao:
            cxs = caixas_da_familia(c)
            soma_m2 = sum(bx[2] * bx[3] for bx in cxs) / 1e6
            if soma_m2 > 20 * max(0.01, area_de.get(c, 0)):
                bb = fam_bbox.get(c)
                if bb:
                    cxs = [[bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]]]
                cob_estimada = True
            caixas_cob += cxs
        fonte_cob = "estimativa" if cob_estimada else "medido"
        # o CORPO da cobertura é sempre PAPEL (R6, dono 22/08: "não será o
        # item inteiro mascarado, não tem necessidade")
        larg_pap = p(params, "bobinas", "papel_tk_horizontal_mm") / 1000.0
        pap_m = fita_pap_m = 0.0
        for bx in caixas_cob:
            w_c = bx[2] / 1000.0
            h_c = bx[3] / 1000.0
            n_fx = _math.ceil(max(0.001, h_c) / larg_pap)
            pap_m += n_fx * w_c
            fita_pap_m += n_fx * w_c  # junta/fixação por faixa
        mats_cob = ([
            _mat("papel TK 50 (faixas sobre a caixa)", pap_m, "m",
                 1.1, "m/m", pap_m * 1.1, "m corrido", fonte_cob),
            _mat("fita branca 45 mm (prende o papel)", fita_pap_m, "m",
                 1.1, "m/m", fita_pap_m * 1.1, "m", fonte_cob),
        ] if pap_m else [])
        if corte_m > 0.05:
            # na FRONTEIRA com cor pendente entra uma BANDA cortada rente,
            # decidida POR POLILINHA da fronteira real: traçado quase reto
            # (flecha cabe na fita de 45 com folga) = FITA BRANCA aplicada e
            # cortada; traçado que serpenteia = MÁSCARA de 60 cm
            pares_set = {tuple(sorted((c, q))) for c in sessao for q in pend}
            flecha_max = p(params, "mascara", "fronteira_fita_flecha_max_mm")
            fita_corte_m = masc_banda_m = 0.0
            bandas_corte = []
            for fr in (analise.get("quadro") or {}).get("fronteiras", []):
                fams_fr = fr.get("familias") or []
                if len(fams_fr) != 2 or None in fams_fr:
                    continue
                if tuple(sorted(fams_fr)) not in pares_set:
                    continue
                medidas = []
                for pl_ in fr["polilinhas"]:
                    if len(pl_) < 2:
                        medidas.append((0.0, 0.0))
                        continue
                    comp_pl = sum(((pl_[i][0] - pl_[i - 1][0]) ** 2
                                   + (pl_[i][1] - pl_[i - 1][1]) ** 2) ** 0.5
                                  for i in range(1, len(pl_)))
                    # flecha: desvio máximo dos pontos à corda 1º→último
                    (x0, y0), (x1, y1) = pl_[0], pl_[-1]
                    dx, dy = x1 - x0, y1 - y0
                    norma = (dx * dx + dy * dy) ** 0.5 or 1.0
                    flecha = max(abs((q0[0] - x0) * dy - (q0[1] - y0) * dx) / norma
                                 for q0 in pl_)
                    medidas.append((comp_pl, flecha))
                tot = sum(c0 for c0, _ in medidas) or 1.0
                tecs = []
                for comp_pl, flecha in medidas:
                    comp = fr["m"] * comp_pl / tot
                    if flecha <= flecha_max:
                        fita_corte_m += comp
                        tecs.append("fita")
                    else:
                        masc_banda_m += comp * max(1, _math.ceil(flecha / 600.0))
                        tecs.append("mascara")
                bandas_corte.append({"par": sorted(fams_fr), "tecnicas": tecs})
            if fita_corte_m > 0.05:
                mats_cob.append(_mat("fita branca 45 mm (aplicada e cortada na fronteira)",
                                     fita_corte_m, "m", 1.1, "m/m",
                                     fita_corte_m * 1.1, "m", "medido"))
            if masc_banda_m > 0.05:
                mats_cob.append(_mat("máscara 60 cm (banda da fronteira)",
                                     masc_banda_m, "m", 1.1, "m/m",
                                     masc_banda_m * 1.1, "m corrido", "medido"))
            pares_corte = [
                sorted((c, q)) for c in sessao for q in pend
                if tuple(sorted((c, q))) in fron_por_par
            ]
            add(f"Cobrir {cores_txt} com papel + banda na fronteira e cortar à mão ({corte_m:.1f} m)", "cor",
                f"{cores_txt} pintada, molhada",
                f"Papel na caixa de cada PARTE ({len(caixas_cob)} parte(s)) — nunca o item "
                "inteiro mascarado. Na fronteira com cor AINDA POR PINTAR entra a banda que "
                "será cortada rente: quase reta = FITA BRANCA de 45 mm aplicada e cortada; "
                "serpenteando = MÁSCARA de 60 cm. A próxima tinta entra contra essa aresta.",
                f"R6 (22/08): banda por polilinha da fronteira — flecha ≤ {flecha_max:.0f} mm ⇒ fita, senão máscara; corte = fronteira (Crofton π/4)",
                materiais=mats_cob,
                tempo=_tempo(corte_m, "m", p(params, "produtividade", "corte_mao_m_h"), "m/h"),
                atuacao={"tipo": "cobrir_cortar", "familias": sorted(sessao),
                         "caixas_mm": caixas_cob,
                         "bandas_corte": bandas_corte,
                         "pares_familias": pares_corte, "metros": round(corte_m, 1)})
        else:
            add(f"Cobrir {cores_txt} com papel", "cor", f"{cores_txt} pintada",
                f"Papel na caixa de cada PARTE desta cor ({len(caixas_cob)} parte(s)), recortado "
                f"onde encostaria na caixa de uma cor ainda por pintar — {len(pend)} cor(es) "
                "pendente(s). Sem corte de precisão não entra máscara: máscara é só para "
                "quando é preciso cortar.",
                "R6 (dono, 22/08): máscara somente quando há corte; cobertura sem corte é papel; caixa POR PARTE",
                materiais=mats_cob,
                tempo=_tempo(area_sessao, "m²", p(params, "produtividade", "empapelamento_localizado_m_h"), "m²/h... aprox"),
                atuacao={"tipo": "cobrir_papel", "familias": sorted(sessao),
                         "caixas_mm": caixas_cob,
                         "pares_familias": [], "metros": 0})
        cobertas.update(sessao)

    # degradês: UM passo por ELEMENTO, pintando a JANELA inteira (R2-9)
    zonas_deg = {z["classe_id"]: z for z in analise["zonas_continuas"] if z["tipo"] == "DEGRADE"}
    if zonas_deg:
        por_elemento: dict[int, list] = {}
        soltas = []
        for zid, z in zonas_deg.items():
            dono = next((e for e in els if zid in e.classes), None)
            if dono is not None:
                por_elemento.setdefault(dono.id, []).append(z)
            else:
                soltas.append(z)
        for el_id, zs in por_elemento.items():
            el = next(e for e in els if e.id == el_id)
            janela_m2 = el.bbox[2] * el.bbox[3] * mm_px * mm_px / 1e6
            forma_m2 = sum(z["area_m2"] for z in zs)
            if janela_m2 > 4 * max(0.05, forma_m2):
                # o "elemento dono" é um grupo grande demais — a janela real é
                # a do adesivo da rampa, não a do grupo inteiro
                janela_m2 = round(forma_m2 * 2, 2)
            tons = max(z.get("tons_sugeridos", 2) for z in zs)
            de_h = zs[0].get("de_hex"); para_h = zs[0].get("para_hex")
            fids = [familia_de[z["classe_id"]] for z in zs if z["classe_id"] in familia_de]
            janela_mm = [round(el.bbox[0] * mm_px), round(el.bbox[1] * mm_px),
                         round(el.bbox[2] * mm_px), round(el.bbox[3] * mm_px)]
            add(f"Degradê {de_h} → {para_h}: {tons} tons na JANELA do adesivo ({janela_m2:.2f} m²) e esfumar",
                "elemento", "adesivo do elemento depilado",
                f"A rampa é passada na janela INTEIRA do adesivo — o vinil mascara o que não é forma; "
                f"num texto, o degradê é UM só no retângulo do adesivo, nunca letra a letra. "
                f"{tons} tons chapados e esfuma-se a separação, numa passada só para o elemento todo. "
                "Achatar em cor sólida é decisão comercial (pergunta).",
                "R2-9 (dono, 21/08): nunca esfumar componente a componente; custo de tinta pela janela (G7)",
                materiais=[_mat("tinta (tons do degradê, mistura pronta)", janela_m2 * tons, "m²",
                                1.0 / rend, "L/m²", janela_m2 * tons / rend, "L", "parametro")],
                tempo=_tempo(janela_m2, "m²", p(params, "produtividade", "aerografia_m2_h"), "m²/h"),
                atuacao={"tipo": "degrade", "zonas": [z["classe_id"] for z in zs],
                         "elementos": [el_id], "familias": fids,
                         "janela_mm": janela_mm,
                         "de_hex": de_h, "para_hex": para_h,
                         "direcao_graus": zs[0].get("direcao_graus")})
            pintadas.update(f for f in fids if f is not None)
            cobertas.update(f for f in fids if f is not None)
        for z in soltas:
            fid = familia_de.get(z["classe_id"])
            add(f"Degradê {z.get('de_hex')} → {z.get('para_hex')}: {z.get('tons_sugeridos',2)} tons e esfumar",
                "elemento", "demais cores pintadas",
                "Rampa fora de elemento identificado — tons chapados + esfumar.",
                "",
                materiais=[_mat("tinta (mistura pronta)", z["area_m2"] * 2, "m²", 1.0 / rend,
                                "L/m²", z["area_m2"] * 2 / rend, "L", "parametro")],
                tempo=_tempo(z["area_m2"], "m²", p(params, "produtividade", "aerografia_m2_h"), "m²/h"),
                atuacao={"tipo": "degrade", "zonas": [z["classe_id"]],
                         "familias": [fid] if fid is not None else []})
            if fid is not None:
                pintadas.add(fid); cobertas.add(fid)

    # (degradês movidos para ANTES dos ciclos — a base em rampa tem de
    # estar PINTADA antes do verniz intermediário; caso 2 amigos)
    # ciclos de aninhamento: R2 (sem verniz, MESMO dia) quando a base é
    # chapada; verniz + cura (+1 dia) quando a base é rampa/aerografia
    ciclos = ciclos_todos
    if ciclos:
        zona_ids = {z["classe_id"] for z in analise["zonas_continuas"]}
        aero_envernizada = {zid for zid, _fid, _a, _p in cobrir_depois}
        base_aero_previa = [c for c in ciclos if c["container"] in aero_envernizada]
        base_rampa = [c for c in ciclos if c not in base_aero_previa
                      and (c["container"] in zona_ids
                           or fams_por_id.get(familia_de.get(c["container"], -1),
                                              None) and fams_por_id[familia_de[c["container"]]].rampa_significativa)]
        base_chapada = [c for c in ciclos if c not in base_rampa and c not in base_aero_previa]
        if base_aero_previa:
            area_ap = sum(c["area_mm2"] for c in base_aero_previa) / 1e6
            add(f"Reaplicar adesivo e pintar os elementos sobre a aerografia envernizada ({len(base_aero_previa)} elementos)",
                "elemento", "verniz da aerografia curado desde o dia da aerografia",
                "O verniz entrou no fim do dia da aerografia e curou durante a noite — o adesivo destes "
                "elementos cola agora sobre verniz curado, no mesmo dia da logomarca.",
                "doutrina 2.6; verniz aplicado no dia da aerografia (sem dia extra de cura)",
                tempo=_tempo(max(0.2, area_ap), "m²", p(params, "produtividade", "pintura_pistola_m2_h"), "m²/h"),
                atuacao={"tipo": "readesivo",
                         "elementos_bbox": [c["bbox_px"] for c in base_aero_previa[:20]]})
        if base_chapada:
            area_c = sum(c["area_mm2"] for c in base_chapada) / 1e6
            resumo_c = {}
            for c in base_chapada:
                k = (hex_classe(c["classe"]), hex_classe(c["container"]))
                resumo_c[k] = resumo_c.get(k, 0) + 1
            descr = "; ".join(f"{n}× {a} dentro de {b}" for (a, b), n in resumo_c.items())
            add(f"Reaplicar adesivo sobre a base seca e pintar os aninhados ({descr} — rota R2)",
                "elemento", "base chapada pintada e seca",
                f"Elementos que ficam POR CIMA de outra tinta ({descr} — no 137 são as estrelas e a faixa "
                "da bandeira sobre o azul): pinta-se a base → espera secar → REAPLICA-SE o adesivo → "
                "pinta-se por cima, no mesmo dia, sem verniz (rota R2). A alternativa com verniz + cura (+1 dia) é editável.",
                "; ".join(f"classe {c['classe']} dentro de {c['container']} ({c['area_mm2']:.0f} mm²)" for c in base_chapada[:8]),
                tempo=_tempo(max(0.2, area_c), "m²", p(params, "produtividade", "pintura_pistola_m2_h"), "m²/h"),
                atuacao={"tipo": "readesivo",
                         "elementos_bbox": [c["bbox_px"] for c in base_chapada[:20]]})
        if base_rampa:
            area_v = sum(c["area_mm2"] for c in base_rampa) / 1e6
            add(f"Verniz intermediário sobre a base em degradê/aerografia ({len(base_rampa)} elementos)",
                "elemento", "base em rampa pintada",
                "Sobre rampa/aerografia o adesivo novo só entra com verniz curado por baixo (caso 2 amigos: "
                "texto sobre o banner envernizado).",
                "doutrina 2.6; a rota sem verniz não protege a rampa do estilete",
                materiais=[_mat("verniz", area_v, "m²",
                                1.0 / p(params, "consumo", "rendimento_verniz_m2_por_l"), "L/m²",
                                area_v / p(params, "consumo", "rendimento_verniz_m2_por_l"), "L", "parametro")],
                tempo=_tempo(area_v, "m²", p(params, "produtividade", "verniz_m2_h"), "m²/h"),
                atuacao={"tipo": "verniz_intermediario",
                         "elementos_bbox": [c["bbox_px"] for c in base_rampa[:20]]})
            fecha_dia("cura do verniz intermediário")
            add("Reaplicar adesivo e pintar os elementos sobre o verniz curado", "elemento",
                "verniz intermediário curado",
                f"{len(base_rampa)} elementos entram agora.",
                "",
                tempo=_tempo(max(0.2, area_v), "m²", p(params, "produtividade", "pintura_pistola_m2_h"), "m²/h"),
                atuacao={"tipo": "readesivo",
                         "elementos_bbox": [c["bbox_px"] for c in base_rampa[:20]]})

    # sombras/halos esfumados — agrupados por ELEMENTO dono (um passo por
    # elemento, não um por banda: o lockup do argus tinha 8 passos soltos).
    # Sombra dentro de elemento de AEROGRAFIA já foi executada no dia da aero.
    # Sombra dentro de elemento de FITA/STENCIL é a borda anti-serrilhada do
    # render no traçado — a FITA segura essa fronteira; NÃO existe passo de
    # esfumar (dono, 22/08: a faixa do A&P ganhava um "esfumar" fantasma)
    sombras_pl = [z for z in analise["zonas_continuas"] if z["tipo"] == "SOMBRA_SUAVE"
                  and z["area_m2"] >= 0.02]
    if sombras_pl:
        aero_els = [e for e in els if getattr(e, "tecnica", "") == "AEROGRAFIA"]
        tec_els = [e for e in els if getattr(e, "tecnica", "ADESIVO") in
                   ("FITA", "STENCIL_FITA", "STENCIL_CORTE")]

        def _dentro_de_aero(zid):
            for e in aero_els:
                if zid in e.classes:
                    return True
            return False

        def _dentro_de_tecnica(zid):
            for e in tec_els:
                if zid in e.classes:
                    return True
            return False
        grupos_somb: dict = {}
        soltas_somb = []
        for z in sombras_pl:
            if _dentro_de_aero(z["classe_id"]):
                continue  # esfumada junto da aerografia, no dia da aero
            if _dentro_de_tecnica(z["classe_id"]):
                continue  # borda do traçado da fita — não é esfumado
            dono = next((e for e in els if z["classe_id"] in e.classes), None)
            if dono is not None:
                grupos_somb.setdefault(dono.id, []).append(z)
            else:
                soltas_somb.append(z)
        for el_id, zs in grupos_somb.items():
            a_tot = round(sum(z["area_m2"] for z in zs), 2)
            add(f"Esfumar sombras/brilhos do elemento ({len(zs)} banda(s), {a_tot} m²)",
                "elemento", "formas principais pintadas",
                "Bandas contínuas finas abraçando as formas do elemento — esfumadas na "
                "aerografia numa passada, nunca cortadas. Omitir/achatar é decisão comercial (pergunta).",
                "fronteira esfumada, fora do corte à mão; um passo por elemento",
                tempo=_tempo(max(a_tot, 0.1), "m²",
                             p(params, "produtividade", "aerografia_m2_h"), "m²/h"),
                confianca="media",
                atuacao={"tipo": "sombra", "zonas": [z["classe_id"] for z in zs],
                         "elementos": [el_id]})
        for z in soltas_somb:
            add(f"Esfumar sombra/halo ({z['area_m2']} m², espessura ~{z.get('espessura_mm')} mm)",
                "elemento", "formas principais pintadas",
                "Banda contínua fina abraçando as formas — esfumada na aerografia, nunca cortada. "
                "Omitir/achatar é decisão comercial (pergunta).",
                "fronteira desta zona é esfumada, fora do corte à mão",
                tempo=_tempo(max(z["area_m2"], 0.1), "m²",
                             p(params, "produtividade", "aerografia_m2_h"), "m²/h"),
                confianca="media",
                atuacao={"tipo": "sombra", "zonas": [z["classe_id"]]})

    # fitas e stencils (técnica por elemento — R2-8/R2-10, tudo editável).
    # R5: a fita é decidida POR TRECHO do traçado e POR SUBSTRATO — amarela
    # 20 mm (curvas leves/horizontais; verticais leves só em chapa lisa) ×
    # branca 45 mm cortada (verticais na chapa frisada, curvas fortes).
    taxa_fita = p(params, "produtividade", "fita_curva_m_h")
    taxa_corte = p(params, "produtividade", "corte_mao_m_h")

    def _mats_fita(cen, fonte="medido"):
        mats = []
        if cen["amarela_m"] > 0.05:
            mats.append(_mat("fita amarela 20 mm (traçado)", cen["amarela_m"], "m",
                             1.1, "m/m", cen["amarela_m"] * 1.1, "m", fonte))
        if cen["branca_m"] > 0.05:
            mats.append(_mat("fita branca 45 mm (aplicada e cortada no traçado)",
                             cen["branca_m"], "m", 1.1, "m/m",
                             cen["branca_m"] * 1.1, "m", fonte))
        return mats

    def _tempo_fita(cen):
        horas = (cen["amarela_m"] + cen["branca_m"]) / taxa_fita \
            + cen["branca_m"] / taxa_corte
        return {"medida_base": round(cen["amarela_m"] + cen["branca_m"], 1),
                "unidade_base": "m", "taxa": taxa_fita, "unidade_taxa": "m/h",
                "horas": round(horas, 2), "fonte": "chute",
                "nota": "inclui o corte da fita branca no traçado"}

    for fx in els:
        tec = getattr(fx, "tecnica", "ADESIVO")
        if tec not in ("FITA", "STENCIL_FITA", "STENCIL_CORTE"):
            continue
        info = getattr(fx, "fita_info", None)
        comp_m = fx.bbox[2] * mm_px / 1000.0
        # a tinta da parte executada aqui entra NESTE passo (consumida 1×)
        fids_fx = sorted({familia_de[c] for c in fx.classes if c in familia_de})
        tinta_fx = sum(tinta_tecnica_fam.pop(fid, 0.0) for fid in fids_fx)
        mats_tinta_fx = ([_mat("tinta do traçado (mistura pronta)",
                               tinta_fx * demaos_cor, "m²", 1.0 / rend, "L/m²",
                               tinta_fx * demaos_cor / rend, "L", "parametro")]
                         if tinta_fx > 0.01 else [])
        if info is not None:
            cen = info["por_substrato"][substrato]
            alt = info["por_substrato"][outro_substrato]
            resumo_cen = (f"{cen['tecnica']} — {cen['amarela_m']} m de amarela"
                          + (f" + {cen['branca_m']} m de branca cortada"
                             if cen["branca_m"] > 0.05 else ""))
            resumo_alt = (f"{alt['tecnica']} ({alt['amarela_m']} m amarela / "
                          f"{alt['branca_m']} m branca)")
        else:
            cen = alt = None
            resumo_cen = resumo_alt = ""
        if tec == "FITA":
            if cen is not None:
                add(f"FITA — bater o esboço da faixa e aplicar ({info['tracado_m']} m de traçado)",
                    "elemento", "painel com as cores de base",
                    f"Curva grande e orgânica não é vinil, é FITA. Na chapa {substrato.upper()} (premissa): "
                    f"{resumo_cen}. Se a chapa for {outro_substrato}: {resumo_alt}. "
                    "O substrato não está na arte — pergunta ao cliente; técnica editável.",
                    f"traçado: {info['frac_vertical']*100:.0f}% vertical, "
                    f"{info['frac_curva']*100:.0f}% curva forte, giro médio "
                    f"{info['giro_medio_graus_m']:.0f}°/m — amarela = curva leve "
                    f"(horizontal em qualquer chapa; vertical leve só na lisa)",
                    materiais=_mats_fita(cen) + mats_tinta_fx,
                    tempo=_tempo_fita(cen),
                    confianca="baixa",
                    atuacao={"tipo": "fita", "elementos": [fx.id],
                             "substrato": substrato, "tecnica": cen["tecnica"],
                             "familias": [familia_de[c] for c in fx.classes if c in familia_de]})
            else:
                add(f"FITA — bater o esboço da faixa e aplicar fita ({comp_m:.1f} m)", "elemento",
                    "painel com as cores de base",
                    "Curva grande e orgânica não é vinil, é FITA: amarela flexível se a chapa for lisa; "
                    "branca cortada se corrugada/rebitada ou traçado muito vertical. Técnica editável.",
                    "o substrato não está na arte — pergunta ao cliente",
                    materiais=[_mat("fita de traçado", comp_m * 2.2, "m", 1, "m/m", comp_m * 2.2, "m", "estimativa")] + mats_tinta_fx,
                    tempo=_tempo(comp_m * 2.2, "m", taxa_fita, "m/h"),
                    confianca="baixa",
                    atuacao={"tipo": "fita", "elementos": [fx.id],
                             "familias": [familia_de[c] for c in fx.classes if c in familia_de]})
            for c in fx.classes:
                if c in familia_de:
                    pintadas.add(familia_de[c])
        else:
            area_m2 = fx.area_px * mm_px * mm_px / 1e6
            if cen is not None:
                add(f"STENCIL — espovo do elemento gigante e marcação com fita ({info['tracado_m']} m)",
                    "elemento", "painel com as cores de base",
                    f"Elemento muito grande e simples de cortar: kraft furado + carvão marca o desenho; "
                    f"na chapa {substrato.upper()}: {resumo_cen}. Se {outro_substrato}: {resumo_alt}. "
                    "Vinil aqui desperdiçaria filme. Técnica editável (adesivo ↔ stencil ↔ fita).",
                    f"R2-8 (dono, 21/08): o script do 2 amigos é o caso-escola. Traçado "
                    f"{info['frac_vertical']*100:.0f}% vertical, giro médio {info['giro_medio_graus_m']:.0f}°/m",
                    materiais=[_mat("papel kraft (espovo)", area_m2, "m²", 1.2, "m²/m²",
                                    area_m2 * 1.2, "m²", "estimativa")] + _mats_fita(cen) + mats_tinta_fx,
                    tempo=_tempo_fita(cen),
                    confianca="baixa",
                    atuacao={"tipo": "stencil", "elementos": [fx.id],
                             "substrato": substrato, "tecnica": cen["tecnica"],
                             "familias": [familia_de[c] for c in fx.classes if c in familia_de]})
            else:
                via = ("traçado tranquilo em FITA AMARELA; trechos muito verticais em FITA BRANCA cortada"
                       if tec == "STENCIL_FITA" else "contorno em FITA BRANCA cortada")
                add(f"STENCIL — espovo do elemento gigante ({comp_m:.1f} m) e pintura", "elemento",
                    "painel com as cores de base",
                    f"Elemento muito grande e simples de cortar: kraft furado + carvão marca o desenho; {via}. "
                    "Vinil aqui desperdiçaria filme. Técnica editável (adesivo ↔ stencil ↔ fita).",
                    "R2-8 (dono, 21/08): o script gigante do 2 amigos é o caso-escola",
                    materiais=[
                        _mat("papel kraft (espovo)", area_m2, "m²", 1.2, "m²/m²", area_m2 * 1.2, "m²", "estimativa"),
                        _mat("fita amarela/branca", comp_m * 2.5, "m", 1, "m/m", comp_m * 2.5, "m", "estimativa"),
                    ] + mats_tinta_fx,
                    tempo=_tempo(area_m2, "m²", p(params, "produtividade", "aerografia_m2_h"), "m²/h... aprox espovo"),
                    confianca="baixa",
                    atuacao={"tipo": "stencil", "elementos": [fx.id],
                             "familias": [familia_de[c] for c in fx.classes if c in familia_de]})
            for c in fx.classes:
                if c in familia_de:
                    pintadas.add(familia_de[c])

    # fechamento (estrutura do plano de referência, 22/08): primeiro sai SÓ
    # o papel que protegia as cores entre si; o verniz entra com o
    # empapelamento da face AINDA na peça (não se enverniza chapa vazia);
    # por último sai todo o kraft e o vinil restante — a arte aparece inteira
    if cobertas:
        area_cob = sum(area_de.get(f, 0) for f in cobertas)
        add("Remover o papel das cores", "face",
            "todas as cores pintadas, coberturas entre cores ainda na peça",
            "Sai só o papel que protegia as cores entre si. O empapelamento da face continua.",
            "",
            tempo=_tempo(max(0.5, area_cob), "m²",
                         p(params, "produtividade", "remocao_m2_h"), "m²/h"),
            atuacao={"tipo": "remocao_coberturas"})
        cobertas = set()
    if p(params, "sistema_pintura", "verniz_final"):
        area_verniz = (sum(ad["vinil_m2"] for ad in analise["adesivos"])
                       + sum(e.bbox[2] * e.bbox[3] * mm_px * mm_px / 1e6
                             for e in els
                             if getattr(e, "tecnica", "ADESIVO") in
                             ("FITA", "STENCIL_FITA", "STENCIL_CORTE", "AEROGRAFIA"))
                       ) or analise["tinta_m2_total"]
        add("Verniz sobre o que foi pintado", "face",
            "cores pintadas e descobertas; empapelamento da face ainda na peça",
            "Verniz na área de cada adesivo e na banda de cada trabalho de arte — não há como "
            "envernizar só o desenho, mas também não se enverniza chapa vazia: o empapelamento "
            "ainda protege o resto da peça. Removível pelo revisor.",
            "",
            materiais=[_mat("verniz", area_verniz, "m²",
                            1.0 / p(params, "consumo", "rendimento_verniz_m2_por_l"), "L/m²",
                            area_verniz / p(params, "consumo", "rendimento_verniz_m2_por_l"), "L", "parametro")],
            tempo=_tempo(area_verniz, "m²", p(params, "produtividade", "verniz_m2_h"), "m²/h"),
            atuacao={"tipo": "verniz_final", "adesivos": ids_adesivos})
    add("Desempapelamento — remoção de todo papel, fita e vinil restante", "face",
        "arte envernizada sob o vinil; papel da face ainda na peça",
        "Sai todo o kraft, a fita e o vinil restante; as ilhas com a cor do campo saem junto, "
        "expondo o fundo de graça. A arte aparece inteira pela primeira vez.",
        f"{analise['ilhas_de_graca']['n']} ilhas de graça ({analise['ilhas_de_graca']['area_m2']} m²)",
        tempo=_tempo(painel_m2, "m²", p(params, "produtividade", "remocao_m2_h"), "m²/h"),
        atuacao={"tipo": "remocao"})
    # depois da remoção a peça está limpa: a inspeção vê a arte nua
    tem_papel = False
    aplicados = []
    add("Inspeção e retoque + limpeza final", "face", "arte exposta",
        "Inspeção contra a arte, retoques e limpeza.", "",
        atuacao={"tipo": "inspecao"})
    fecha_dia("fim")

    total_h = 0.0
    for d in dias:
        for s in d["passos"]:
            if s["tempo"] and s["tempo"].get("horas"):
                total_h += s["tempo"]["horas"]
    return {
        "dias": dias,
        "resumo": {
            "n_dias": len(dias),
            "n_passos": sum(len(d["passos"]) for d in dias),
            "n_sessoes_pintura": len(sessoes),
            "horas_estimadas": round(total_h, 1),
            "nota_horas": "taxas de produção são CHUTE sinalizado; o calendário é por REGRA (R2-4), não por horas",
        },
    }
