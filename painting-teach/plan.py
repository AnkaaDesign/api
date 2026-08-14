"""Plano de produção a partir da saída do motor — sem passe semântico.

Substitui `painting-vision/probe/production.py:main()` em dois pontos, e só
nesses dois:

  1. os elementos vêm do agrupador determinístico (`grouping.py`), não do Qwen;
  2. cada passo carrega os **cálculos** que o geram — fórmula, parâmetro e
     fonte — para a estação de marcação poder perguntar "este número está certo?"

Todo o resto (rotas da doutrina, sessões por número cromático, e principalmente
as imagens de cada passo) é reaproveitado do `production.py` por import direto:
duplicar aquilo seria criar um segundo motor para divergir do primeiro.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ.parent / "painting-vision" / "probe"))

import grouping                                    # noqa: E402
import params as PR                                # noqa: E402
import production as P                             # noqa: E402


# A fonte do `_label` do production.py é a Helvetica do macOS; no Linux ela cai
# no bitmap de 11 px e o rótulo some na imagem de 1400 px.
def _fonte(tam: int):
    for caminho in ("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
                    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    "/usr/share/fonts/noto/NotoSans-Bold.ttf"):
        if Path(caminho).exists():
            return ImageFont.truetype(caminho, tam)
    return ImageFont.load_default()


def _label(d, box, texto, fill=(200, 30, 40)):
    x0, y0 = box[0], box[1]
    f = _fonte(30)
    tw = d.textlength(texto, font=f)
    d.rectangle([x0, max(0, y0 - 38), x0 + tw + 16, y0], fill=fill)
    d.text((x0 + 8, max(0, y0 - 35)), texto, fill=(255, 255, 255), font=f)


P._label = _label


# ------------------------------------------------------------- rotas --------

def rota(el: dict, substrato: str) -> tuple[str, str, list[str]]:
    """Técnica do elemento. Devolve (rota, motivo, trilha da decisão).

    Mesma árvore de `production.py:route()` (doutrina §3.0 e §4); o que muda é
    devolver a **trilha** — cada pergunta feita e a resposta — porque é sobre
    a trilha que o dono marca "aqui a pergunta está errada".
    """
    trilha = []
    if el["tipo"] == "AEROGRAFIA":
        trilha.append("zona de tom contínuo → não se corta e não se imprime")
        return "AEROGRAFIA", ("tom contínuo: vai à mão livre pelo setor de "
                              "Aerografia, com adesivo só no contorno externo"), trilha

    if el["tipo"] == "FAIXA":
        trilha.append("é faixa → fita, não adesivo (doutrina §4)")
        if substrato in ("ISOPLASTIC", "LONA"):
            trilha.append(f"substrato {substrato.lower()} → amarela faz qualquer curva")
            return "FITA_AMARELA", f"faixa em {substrato.lower()} — a amarela faz qualquer curva", trilha
        v = el["verticalidade_deg"]
        lim = PR.DOUTRINA["VERTICAL_DEG"]["valor"]
        trilha.append(f"traçado a {v:.0f}° da horizontal (limite {lim:.0f}°)")
        if v <= lim:
            return "FITA_AMARELA", (f"traçado a {v:.0f}° — curva tranquila, a amarela passa"), trilha
        return "FITA_BRANCA", (f"traçado a {v:.0f}° — vertical demais para a amarela; "
                               f"a branca não curva e exige corte"), trilha

    trilha.append("duas cores DO DESENHO se tocam neste elemento? "
                  + ("sim" if el["toca_tinta"] else "não"))
    if not el["toca_tinta"]:
        if el.get("campo") == "PINTURA_GERAL":
            trilha.append("o campo é pintura geral, curada do dia anterior — não conta como tinta")
            return "ADESIVO_SOBRE_GERAL", ("nenhuma cor do desenho se toca aqui; o adesivo "
                                           "assenta sobre a pintura geral já curada — sem "
                                           "verniz, sem espera"), trilha
        return "ADESIVO_SOBRE_CHAPA", ("só encosta em chapa — adesivo aplicado inteiro e "
                                       "depilado por cor. Sem corte manual, sem verniz"), trilha

    corte = PR.DOUTRINA["CUT_MM_CONFIRMED"]["valor"]
    trilha.append(f"menor traço {el['menor_traco_mm']:.0f} mm × {corte:.0f} mm confirmados pelo dono")
    if el["menor_traco_mm"] >= corte:
        return "CORTE_MANUAL", (f"encosta em tinta e o traço de {el['menor_traco_mm']:.0f} mm "
                                f"é cortável — evita o ciclo de verniz"), trilha
    return "ADESIVO_SOBRE_VERNIZ", (f"encosta em tinta e o traço de {el['menor_traco_mm']:.0f} mm "
                                    f"está abaixo dos {corte:.0f} mm confirmados"), trilha


# --------------------------------------------------------- cálculos ---------

def _mo(taxa_key: str, quantidade: float, unidade: str, descricao: str,
        extra_min: float = 0.0, extra_txt: str = "") -> dict:
    """Uma linha de mão de obra: quantidade ÷ taxa = minutos."""
    t = PR.TAXAS[taxa_key]
    por_taxa = t["un"].endswith("/min")          # m²/min, m/min, cm/min → divide
    minutos = (quantidade / t["valor"] if por_taxa else t["valor"] * quantidade) + extra_min
    formula = (f"{quantidade:.2f} {unidade} ÷ {t['valor']:g} {t['un']}" if por_taxa
               else f"{t['valor']:g} {t['un']} × {quantidade:g} {unidade}")
    if extra_txt:
        formula += f" + {extra_txt}"
    return {"kind": "MAO_DE_OBRA", "descricao": descricao, "formula": formula,
            "valor": round(minutos, 1), "un": "min",
            "parametro": taxa_key, "parametro_label": t["label"],
            "parametro_valor": f"{t['valor']:g} {t['un']}",
            "fonte": t["fonte"], "nota": t.get("nota")}


def _mat(descricao: str, valor: float, un: str, formula: str,
         parametro: str | None = None, fonte: str = "SEED",
         nota: str | None = None) -> dict:
    p = (PR.MATERIAIS.get(parametro) or PR.SISTEMAS.get(parametro) or {}) if parametro else {}
    return {"kind": "MATERIAL", "descricao": descricao, "formula": formula,
            "valor": round(valor, 3), "un": un, "parametro": parametro,
            "parametro_label": p.get("label"),
            "parametro_valor": (f"{p['valor']:g} {p['un']}" if p.get("un") else None),
            "fonte": p.get("fonte", fonte), "nota": nota or p.get("nota")}


def _tinta(area_m2: float, sistema_key: str, papel: str, demaos: int) -> list[dict]:
    s = PR.SISTEMAS[sistema_key]
    v = PR.tinta_litros(area_m2, demaos, s["rendimento"])
    v = max(v, s["lote_min"])
    partes = PR.mistura(v, s["mix"])
    base, cat, dil = s["mix"]
    perdas = PR.SPRAY_LOSS_PCT["valor"] + PR.PREP_LOSS_PCT["valor"]
    linhas = [_mat(f"{papel} — {s['label']} ({demaos} demão{'s' if demaos > 1 else ''})",
                   partes["base_l"], "L",
                   f"{area_m2:.2f} m² × {demaos} ÷ {s['rendimento']:g} m²/L × "
                   f"(1 + {perdas:.2f}) = {v:.2f} L de mistura × {base}/{base + cat + dil}",
                   fonte="SEED",
                   nota="rendimento, lote mínimo e cura estão marcados "
                        "`needsConfirmation: true` no próprio seed")]
    if partes["catalisador_l"]:
        linhas.append(_mat("Catalisador", partes["catalisador_l"], "L",
                           f"{v:.2f} L × {cat}/{base + cat + dil}", fonte="DONO"))
    if partes["diluente_l"]:
        linhas.append(_mat("Diluente", partes["diluente_l"], "L",
                           f"{v:.2f} L × {dil}/{base + cat + dil}", fonte="DONO"))
    return linhas


# ------------------------------------------------------------ montagem ------

def _metricas(analysis, els_brutos, layers, w, h, px_per_cm):
    """Completa cada elemento com o que exige a máscara rasterizada."""
    by_id = {r["id"]: r for r in analysis["regions"]}
    campo = ("PINTURA_GERAL" if analysis["background"]["mode"] == "GENERAL_PAINT"
             else "CHAPA")
    campo_hexes = grouping._campo_hexes(analysis)

    # T-T: duas cores do DESENHO se tocando (o campo não conta — doutrina §3.0).
    dono = {rid: e["id"] for e in els_brutos for rid in e["regioes"]}
    toca = defaultdict(bool)
    fronteiras = defaultdict(list)
    for b in analysis["boundaries"]:
        if b["kind"] != "PAINT_PAINT":
            continue
        ra, rb = by_id.get(b["a"]), by_id.get(b["b"])
        if not ra or not rb:
            continue
        if ra["hex"] in campo_hexes or rb["hex"] in campo_hexes:
            continue
        if ra["hex"] == rb["hex"]:
            continue
        for rid in (ra["id"], rb["id"]):
            if rid in dono:
                toca[dono[rid]] = True
                fronteiras[dono[rid]].append(
                    {"a": ra["id"], "b": rb["id"], "hex_a": ra["hex"], "hex_b": rb["hex"],
                     "length_m": b["length_m"], "curva": b.get("dominant_curve")})

    els = []
    for e in els_brutos:
        mask = np.zeros((h, w), dtype=bool)
        for rid in e["regioes"]:
            mask |= np.asarray(layers[rid]) > 127
        x0, y0, x1, y1 = P.el_bbox(e, layers, w, h, px_per_cm)
        el = dict(e)
        el.update({
            "campo": campo,
            "toca_tinta": bool(toca[e["id"]]),
            "fronteiras_tt": fronteiras[e["id"]][:12],
            "fronteira_tt_m": round(sum(f["length_m"] for f in fronteiras[e["id"]]), 2),
            "verticalidade_deg": round(P.verticality_deg(mask), 1),
            "cores": sorted({by_id[r]["hex"] for r in e["regioes"]}),
            "tons_originais": sorted({by_id[r]["hex"] for r in e["regioes"]}),
            "degrade": any(by_id[r].get("gradient") for r in e["regioes"]),
            "aerografia": e["tipo"] == "AEROGRAFIA",
            "caixa_px": [int(x0), int(y0), int(x1), int(y1)],
            "caixa_cm": [round(v / px_per_cm, 1) for v in (x0, y0, x1, y1)],
            "area_adesivo_m2": round((x1 - x0) * (y1 - y0) / (px_per_cm ** 2) / 10000, 3),
        })
        el["rota"], el["motivo"], el["trilha"] = rota(el, SUBSTRATO_ATUAL)
        els.append(el)
    return els


SUBSTRATO_ATUAL = "CHAPA"


def build(analysis: dict, art_path: str, outdir: Path, substrato: str = "CHAPA",
          sistema: str = "POLIESTER") -> dict:
    global SUBSTRATO_ATUAL
    SUBSTRATO_ATUAL = substrato

    img = analysis["image"]
    w, h = img["workWidthPx"], img["workHeightPx"]
    px_per_cm = w / img["widthCm"]
    outdir = Path(outdir)
    (outdir / "img").mkdir(parents=True, exist_ok=True)

    orig = P.load(art_path)
    orig.thumbnail((w, h), Image.LANCZOS)
    if orig.size != (w, h):
        orig = orig.resize((w, h), Image.LANCZOS)
    salvar(orig, outdir / "img/original.jpg")

    brutos, ruido, ignoradas = grouping.elements(analysis, px_per_cm)
    layers = P.rasterize(analysis["regions"], w, h)
    els = _metricas(analysis, brutos, layers, w, h, px_per_cm)

    canon = {r["hex"]: r["hex"] for r in analysis["regions"]}
    passos, sessoes = build_steps(analysis, els, layers, (w, h), outdir, canon,
                                  orig, px_per_cm, sistema)

    minutos = sum(p["minutos"] for p in passos)
    return {
        "arte": Path(art_path).name,
        "substrato": substrato,
        "sistema": sistema,
        "escala": {"comprimento_cm": img["widthCm"], "altura_cm": img["heightCm"],
                   "area_m2": img["areaM2"], "px_por_cm_original": img["pxPerCmOriginal"],
                   "px_por_cm_trabalho": round(px_per_cm, 3),
                   "referencia": "HEIGHT 245 cm (altura padrão do baú — README do acervo)"},
        "fundo": analysis["background"],
        "paleta": analysis["palette"],
        "elementos": els,
        "descartados": ruido,
        "ignoradas": ignoradas,
        "sessoes": sessoes,
        "passos": passos,
        "totais": {
            "elementos": len(els),
            "passos": len(passos),
            "minutos": round(minutos, 1),
            "horas": round(minutos / 60, 2),
            "dias": round(minutos / PR.WORKDAY_MINUTES["valor"], 2),
            "mao_de_obra_brl": round(minutos / 60 * PR.LABOR_HOUR_BRL["valor"], 2),
            "area_adesivo_m2": round(sum(e["area_adesivo_m2"] for e in els
                                       if not e["rota"].startswith("FITA")), 2),
            "area_pintada_m2": round(sum(e["area_m2"] for e in els), 2),
        },
        "alertas": analysis.get("alerts", []),
        "engine": {"version": analysis.get("engineVersion"),
                   "timings": analysis.get("timingsSec"),
                   "regioes": len(analysis["regions"]),
                   "fronteiras": len(analysis["boundaries"])},
    }


def salvar(imagem: Image.Image, destino: Path, lado: int = 1500) -> None:
    out = imagem.copy()
    out.thumbnail((lado, lado), Image.LANCZOS)
    out.convert("RGB").save(destino, "JPEG", quality=82, optimize=True)


def build_steps(analysis, els, layers, size, outdir, canon, orig, px_per_cm, sistema):
    """A sequência do chão de fábrica, com a conta de cada passo."""
    w, h = size
    regions = analysis["regions"]
    by_id = {r["id"]: r for r in regions}
    geral = analysis["background"]["mode"] == "GENERAL_PAINT"
    area_face = analysis["image"]["areaM2"]
    passos, painted = [], []

    def add(tipo, titulo, detalhe, imagem, calculos, **extra):
        n = len(passos) + 1
        nome = f"img/passo_{n:02d}.jpg"
        salvar(imagem, outdir / nome)
        minutos = sum(c["valor"] for c in calculos if c["kind"] == "MAO_DE_OBRA")
        passos.append({"n": n, "tipo": tipo, "titulo": titulo, "detalhe": detalhe,
                       "img": nome, "calculos": calculos,
                       "minutos": round(minutos, 1), **extra})

    # ---------------------------------------------- Programa A (superfície)
    if geral:
        add("PREPARO", "Lavagem e desengraxe",
            "Existe porque há pintura geral: a face inteira é lavada e desengraxada "
            "antes de qualquer tinta.", orig.copy(),
            [_mo("WASH_M2_PER_MIN", area_face, "m²", "Lavagem/desengraxe da face")])
        add("PREPARO", "Empapelamento do implemento",
            "Cobrir perfis de borda, borrachas, ferragens e a faixa refletiva — nada "
            "disso recebe tinta.", orig.copy(),
            [_mo("PAPER_MASK_M2_PER_MIN", area_face * 0.25, "m²",
                 "Papel e fita nos perfis e ferragens"),
             _mat("Bobina Papel TKV", area_face * 0.25, "m²",
                  f"{area_face:.1f} m² × 25%",
                  nota="os 25% são invenção minha — o V3 §1.2 já aponta o "
                       "`perímetro × 0,3` do ERP como número sem origem")])
        s = PR.SISTEMAS[sistema]
        demaos_total = sum(c for _role, _sist, c in s["demaos"])
        calc = [_mo("PAINT_COAT_M2_PER_MIN", area_face * demaos_total, "m²",
                    f"Pintura geral — {demaos_total} demãos em {area_face:.1f} m² "
                    f"(inclui a demão de verniz do esquema)")]
        for papel, sist_key, demaos in s["demaos"]:
            rotulo = {"GROUND": "Fundo", "COLOR": "Cor", "CLEAR": "Verniz"}[papel]
            calc += _tinta(area_face, sist_key, rotulo, demaos)
        add("PINTURA", "Pintura geral",
            f"Fundo e cor ({analysis['background']['hex']}) em toda a face, no esquema "
            f"{s['label']}. Cura por {s['cura_min']} min; só então entram os adesivos — "
            f"é por isso que encostar nela depois não custa verniz nem espera.",
            Image.new("RGB", (w, h), analysis["background"]["hex"]), calc,
            sistema=sistema)

    # ---------------------------------------------- Programa B (comunicação)
    add("PREPARO", "Conferência da face curada" if geral else "Limpeza da face",
        (("A geral está curada — daqui em diante o adesivo assenta direto sobre ela. ")
         if geral else
         ("Sem pintura geral não há lavagem completa nem empapelamento do implemento: "
          "só limpar a face. ")) +
        f"As {len(els)} caixas marcam onde cada elemento entra, com "
        f"{PR.MATERIAIS['MARGEM_CORTE_CM']['valor']:.0f} cm de folga entre o desenho e "
        f"a borda do adesivo.",
        P.boxes_image(orig, [{**e, "tipo": e["nome"]} for e in els],
                      layers, w, h, px_per_cm),
        [_mo("FINAL_CLEAN_M2_PER_MIN", area_face, "m²", "Limpeza da face")])

    for e in [x for x in els if not x["rota"].startswith("FITA")]:
        area = e["area_adesivo_m2"]
        corte_m = e["perimetro_m"]
        if e["tipo"] == "AEROGRAFIA":
            corte_m = round(sum(by_id[r]["perimeter_m"] for r in e["regioes"]) * 0.6, 2)
        transfer = (area / (PR.MATERIAIS["TRANSFER_MASK_WIDTH_CM"]["valor"] / 100)
                    * PR.MATERIAIS["TRANSFER_REUSE_FACTOR"]["valor"])
        calc = [
            _mo("PLOT_M_PER_MIN", corte_m, "m", "Plotagem e recorte da máscara"),
            _mo("WEED_M2_PER_MIN", area, "m²", "Depilação",
                extra_min=PR.taxa("WEED_MIN_PER_ISLAND") * e["ilhas"],
                extra_txt=f"{e['ilhas']} ilha(s) × {PR.taxa('WEED_MIN_PER_ISLAND'):g} min"),
            _mo("APPLY_ADHESIVE_M2_PER_MIN", area, "m²", "Aplicação na face"),
            _mat("Adesivo Vinil", area, "m²",
                 f"caixa de {e['caixa_cm'][2] - e['caixa_cm'][0]:.0f} × "
                 f"{e['caixa_cm'][3] - e['caixa_cm'][1]:.0f} cm "
                 f"(forma + {PR.MATERIAIS['MARGEM_CORTE_CM']['valor']:.0f} cm de folga)",
                 parametro="MARGEM_CORTE_CM"),
            _mat("Máscara de Transferência", transfer, "m",
                 f"{area:.2f} m² ÷ {PR.MATERIAIS['TRANSFER_MASK_WIDTH_CM']['valor']:.0f} cm "
                 f"× {PR.MATERIAIS['TRANSFER_REUSE_FACTOR']['valor']:g} de reuso",
                 parametro="TRANSFER_MASK_WIDTH_CM"),
        ]
        if e["rota"] == "ADESIVO_SOBRE_VERNIZ":
            calc.append({"kind": "ESPERA", "descricao": "Cura do verniz antes de aplicar",
                         "formula": "regra CURE_WAIT_MIN",
                         "valor": PR.DOUTRINA["CURE_WAIT_MIN"]["valor"], "un": "min",
                         "parametro": "CURE_WAIT_MIN", "fonte": "SEED",
                         "parametro_label": PR.DOUTRINA["CURE_WAIT_MIN"]["label"],
                         "parametro_valor": "180 min", "nota":
                         "não é mão de obra: é o implemento parado. Entra no prazo, "
                         "não no custo-hora"})
        if e["rota"] == "CORTE_MANUAL":
            calc.append(_mo("CUT_CURVE_MEDIUM_CM_PER_MIN", e["fronteira_tt_m"] * 100, "cm",
                            "Corte manual sobre a laca curada"))
        if e["tipo"] == "AEROGRAFIA":
            calc.append(_mo("AIRBRUSH_ART_M2_PER_MIN", e["area_m2"], "m²",
                            "Aerografia à mão livre dentro da silhueta"))
        add("ADESIVO", f"Adesivo — {e['nome'].lower()}",
            f"{e['motivo']}. A folha vai inteira ({e['area_m2']:.2f} m² de desenho numa "
            f"caixa de {area:.2f} m²) e a depilação libera cada cor na sua vez.",
            P.silhouette_image({**e, "tipo": e["nome"]}, by_id, layers, w, h, px_per_cm),
            calc, elemento=e["id"], rota=e["rota"])

    for e in [x for x in els if x["rota"].startswith("FITA")]:
        fita_m = e["perimetro_m"] * (1 + PR.MATERIAIS["TAPE_OVERLAP_PCT"]["valor"])
        taxa_key = ("TAPE_FLEX_M_PER_MIN" if e["rota"] == "FITA_AMARELA"
                    else "TAPE_STRAIGHT_M_PER_MIN")
        calc = [_mo(taxa_key, fita_m, "m", "Aplicação da fita"),
                _mat("Fita", fita_m, "m",
                     f"{e['perimetro_m']:.2f} m de contorno × "
                     f"(1 + {PR.MATERIAIS['TAPE_OVERLAP_PCT']['valor']:.2f})",
                     parametro="TAPE_OVERLAP_PCT")]
        if e["rota"] == "FITA_BRANCA":
            calc.append(_mo("CUT_STRAIGHT_CM_PER_MIN", e["perimetro_m"] * 100, "cm",
                            "Corte da fita branca no traçado"))
        add("FITA", f"{e['rota'].replace('_', ' ').title()} — {e['nome'].lower()}",
            f"{e['motivo']}. {e['area_m2']:.2f} m². A fita delimita e a tinta entra: "
            f"sem adesivo e sem corte de vinil.",
            P.silhouette_image({**e, "tipo": e["nome"]}, by_id, layers, w, h, px_per_cm),
            calc, elemento=e["id"], rota=e["rota"])

    # -------------------------------------------------- empapelamento -------
    nua = P.chapa_nua(els, by_id, layers, w, h, px_per_cm)
    kraft = P.kraft_image(nua, els, layers, w, h, px_per_cm)
    janelas = P.janelas(els, layers, w, h, px_per_cm)
    area_janelas = float(janelas.sum()) / (px_per_cm ** 2) / 10000
    area_papel = max(0.0, area_face - area_janelas)
    folhas = math.ceil(w / max(1, int(PR.MATERIAIS["KRAFT_SHEET_CM"]["valor"] * px_per_cm)))
    add("PREPARO", "Empapelamento da face",
        f"Kraft em folhas de {PR.MATERIAIS['KRAFT_SHEET_CM']['valor']:.0f} cm "
        f"({folhas} nesta face) em volta das janelas. Ainda não há tinta nenhuma na "
        f"peça — só a chapa e o traço dos adesivos.", kraft,
        [_mo("PAPER_MASK_M2_PER_MIN", area_papel, "m²", "Empapelamento em volta das janelas"),
         _mat("Papel Kraft", area_papel, "m²",
              f"{area_face:.1f} m² da face − {area_janelas:.1f} m² de janelas",
              parametro="KRAFT_SHEET_CM"),
         _mat("Fita Crepe", folhas * (analysis["image"]["heightCm"] / 100), "m",
              f"{folhas} emenda(s) × {analysis['image']['heightCm'] / 100:.2f} m de altura",
              parametro="CREPE_TAPE_PER_M_PAPER")])

    # ----------------------------------------------------- sessões ----------
    por_cor: dict[str, list[str]] = defaultdict(list)
    area_cor: dict[str, float] = defaultdict(float)
    degrade_ids: set[str] = set()
    for e in els:
        for rid in e["regioes"]:
            c = by_id[rid]["hex"]
            por_cor[c].append(rid)
            area_cor[c] += by_id[rid]["area_m2"]
        if e["degrade"]:
            degrade_ids.update(e["regioes"])

    grupo, adj = P.sessoes_por_cor(por_cor, analysis, by_id, canon)
    grupos: dict[int, list[str]] = defaultdict(list)
    for cor, g in grupo.items():
        grupos[g].append(cor)
    ordem = sorted(grupos, key=lambda g: sum(area_cor[c] for c in grupos[g]))

    partes = P.partes_de(els, layers, canon, by_id, w, h, px_per_cm)
    dono = P.territorios(partes, layers, w, h)
    pintadas: set[str] = set()
    papel = np.zeros((h, w), dtype=bool)
    s = PR.SISTEMAS[sistema]
    demaos_cor = sum(c for r, _, c in s["demaos"] if r == "COLOR") or 2
    sessoes_out = []

    for i, g in enumerate(ordem):
        cores = sorted(grupos[g], key=lambda c: area_cor[c])
        ids = [r for c in cores for r in por_cor[c]]
        # Janela de pintura: a caixa de cada parte (elemento × cor), não a forma.
        # G7 — não se pinta um texto de 5 cm exatamente; pinta-se a janela e a
        # máscara bloqueia o resto.
        janela_m2 = sum(
            (pt["bbox"][2] - pt["bbox"][0]) * (pt["bbox"][3] - pt["bbox"][1])
            for pt in partes if pt["cor"] in cores) / (px_per_cm ** 2) / 10000
        area_g = sum(area_cor[c] for c in cores)
        calc = [_mo("PAINT_COAT_M2_PER_MIN", janela_m2 * demaos_cor, "m²",
                    f"{demaos_cor} demãos sobre {janela_m2:.2f} m² de janela"),
                _mo("PAINT_PREP_MIN", len(cores), "cor(es)", "Preparo da tinta"),
                _mo("COLOR_SWAP_MIN", 1, "troca", "Troca de cor e limpeza da pistola")]
        for c in cores:
            calc += _tinta(janela_m2 * area_cor[c] / max(area_g, 1e-6), sistema, f"Tinta {c}",
                           demaos_cor)
        face = P.face_pintada(layers, regions, painted + ids, orig, degrade_ids, els)
        add("PINTURA", f"Sessão {i + 1} — {len(cores)} cor(es)",
            f"{', '.join(cores)}. {area_g:.2f} m² de desenho em {janela_m2:.2f} m² de "
            f"janela. " + ("Nenhuma destas cores encosta em outra da mesma sessão, "
                           "então todas entram na mesma demão."
                           if len(cores) > 1 else "Cor isolada nesta sessão."),
            P.compor(kraft, els, layers, w, h, px_per_cm, face, papel), calc,
            cores=cores, sessao=i + 1)
        sessoes_out.append({"n": i + 1, "cores": cores, "area_m2": round(area_g, 3),
                            "janela_m2": round(janela_m2, 3),
                            "vizinhas": {c: sorted(adj[c]) for c in cores}})
        painted.extend(ids)
        pintadas.update(cores)

        if i < len(ordem) - 1:
            desta = [pt for pt in partes if pt["cor"] in cores]
            pendentes = [pt for pt in partes if pt["cor"] not in pintadas]
            idx = [k for k, pt in enumerate(partes, start=1) if pt["cor"] in cores]
            papel = papel | P.cobertura_mask(desta, pendentes, layers, w, h,
                                             px_per_cm, dono, idx)
            area_cob = float(papel.sum()) / (px_per_cm ** 2) / 10000
            add("PREPARO", f"Cobrir a sessão {i + 1}",
                f"Papel sobre {', '.join(cores)}, na caixa de cada parte e dentro do "
                f"território dela. {len(pendentes)} parte(s) ainda por pintar.",
                P.compor(kraft, els, layers, w, h, px_per_cm, face, papel),
                [_mo("PAPER_MASK_M2_PER_MIN", area_cob, "m²", "Cobrir a cor recém-pintada"),
                 _mat("Papel Kraft", area_cob, "m²", "área coberta medida na máscara")])

    face_final = P.face_pintada(layers, regions, painted, orig, degrade_ids, els)
    area_cob = float(papel.sum()) / (px_per_cm ** 2) / 10000
    add("PREPARO", "Remover o papel das cores",
        "Sai só o papel que protegia as cores entre si. O empapelamento da face continua.",
        P.compor(kraft, els, layers, w, h, px_per_cm, face_final),
        [_mo("MASK_REMOVE_M2_PER_MIN", area_cob, "m²", "Remoção do papel entre cores")])

    # ------------------------------------------------------- verniz ---------
    verniz = P.compor(kraft, els, layers, w, h, px_per_cm, face_final)
    azul = Image.new("RGB", (w, h), (150, 190, 230))
    from skimage import morphology
    verniz = Image.composite(Image.blend(verniz, azul, 0.22), verniz,
                             Image.fromarray((janelas * 255).astype(np.uint8), mode="L"))
    borda = janelas & ~morphology.erosion(janelas, morphology.disk(3))
    verniz.paste((60, 120, 190), (0, 0),
                 Image.fromarray((borda * 255).astype(np.uint8), mode="L"))
    caixas = P.merge_boxes([P.el_bbox(e, layers, w, h, px_per_cm) for e in els
                            if not e["rota"].startswith("FITA")], gap=0)
    add("VERNIZ", "Verniz sobre o que foi pintado",
        f"Verniz na área de cada adesivo e na banda da fita — não há como envernizar "
        f"só o desenho, mas também não se enverniza chapa vazia. {len(caixas)} passada(s).",
        verniz,
        [_mo("VARNISH_M2_PER_MIN", area_janelas, "m²", "Aplicação do verniz")]
        + _tinta(area_janelas, "VERNIZ", "Verniz", 1))

    add("PREPARO", "Remover o empapelamento",
        "Sai todo o kraft e o que restou de adesivo. Depois disto: faixa refletiva.",
        P.face_pintada(layers, regions, painted, orig, degrade_ids),
        [_mo("MASK_REMOVE_M2_PER_MIN", area_papel, "m²", "Remoção do empapelamento"),
         _mo("FINAL_CLEAN_M2_PER_MIN", area_face, "m²", "Limpeza final")])

    return passos, sessoes_out
