"""Ficha legível por layout (markdown) + JSON de análise/plano."""
from __future__ import annotations

import json

import numpy as np


def _json_ok(o):
    if isinstance(o, dict):
        return {str(k): _json_ok(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, set)):
        return [_json_ok(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return o


def salvar_json(obj: dict, caminho: str) -> None:
    with open(caminho, "w", encoding="utf-8") as fh:
        json.dump(_json_ok(obj), fh, indent=1, ensure_ascii=False)


def ficha_md(layout: str, faces: dict, comparacao: dict | None) -> str:
    L = [f"# Ficha de Pintura — {layout}", ""]
    for nome, dados in faces.items():
        a, pl, orc = dados["analise"], dados["plano"], dados["orcamento"]
        e = a["escala"]
        L += [
            f"## {nome} — `{a['arquivo']}`",
            "",
            "### Premissas",
            f"- painel: **{e['painel_mm']['w']} × {e['painel_mm']['h']} mm** "
            f"(escala {e['mm_px']:.4f} mm/px, fonte: {e['fonte']})",
            f"- campo do desenho: **{a['campo']['hex']}** → **{a['campo']['classe']}** "
            f"(L* {a['campo']['L']}, {a['campo']['pct_painel']}% do painel)",
            f"- render: {a['render']}",
            f"- pintura geral: {'SIM — demão de fundo de ' + str(a['demao_fundo_m2']) + ' m²' if a['pintura_geral'] else 'não'}",
            "",
            "### Os dois eixos do custo",
            f"- **tinta (área): {a['tinta_m2_total']} m²**",
            f"- **fronteira compartilhada (corte à mão): {a['fronteira']['total_tt_m']} m**",
            f"- ilhas de graça: {a['ilhas_de_graca']['n']} ({a['ilhas_de_graca']['area_m2']} m²)",
            "",
            f"### Tintas — {a['paleta']['n_tintas']} famílias",
        ]
        micro = 0
        for f in a["paleta"].get("familias", []):
            if f["m2"] < 0.01 and not f.get("campo"):
                micro += 1
                continue
            marc = " **(campo)**" if f.get("campo") else (" **(com rampa)**" if f.get("rampa") else "")
            membros = ", ".join(f.get("membros", [])[:6])
            L.append(f"- `{f['hex']}` — {f['m2']} m²{marc}"
                     + (f" — classes: {membros}" if len(f.get('membros', [])) > 1 else ""))
        if micro:
            L.append(f"- *(+{micro} micro-famílias < 0,01 m² — detalhes na partição)*")
        L.append("")
        L.append("<details><summary>partição por classe de render</summary>")
        L.append("")
        for c in a["paleta"]["classes"]:
            L.append(
                f"- `{c['hex_ancora']}` — {c['m2']} m² ({c['tipo']}, pureza {c['pureza']}, família {c.get('familia')})"
            )
        L.append("")
        L.append("</details>")
        if a["zonas_continuas"]:
            L += ["", "### Zonas contínuas"]
            for z in a["zonas_continuas"]:
                extra = (
                    f" {z.get('de_hex')} → {z.get('para_hex')}, {z.get('tons_sugeridos')} tons"
                    if z["tipo"] == "DEGRADE" else ""
                )
                L.append(f"- **{z['tipo']}** {z['area_m2']} m² (R² {z['r2_rampa']}){extra}")
        L += ["", "### Elementos"]
        for el in a["elementos"][:20]:
            d = el["dim_mm"]
            fita_txt = ""
            if el.get("fita"):
                ps = el["fita"]["por_substrato"]
                fita_txt = (f" — fita ({el['fita']['tracado_m']} m de traçado): "
                            f"lisa = {ps['lisa']['tecnica']}"
                            f" · corrugada = {ps['corrugada']['tecnica']}")
            L.append(
                f"- #{el['id']} **{el['tipo']}** ({el['confianca']}) — "
                f"{d['w']}×{d['h']} mm, {el['area_m2']} m²" + fita_txt
                + (f" — {'; '.join(el['notas'])}" if el["notas"] else "")
            )
        L += ["", "### Adesivos"]
        for ad in a["adesivos"]:
            folhas_txt = ""
            if ad.get("folhas"):
                folhas_txt = (f" — **{len(ad['folhas'])} folhas** "
                              f"(economia de {ad.get('economia_folha_m2', 0)} m² de filme, R2-7)")
            L.append(
                f"- **{ad['id']}** {ad['envelope_mm']['w']}×{ad['envelope_mm']['h']} mm — "
                f"bobina {ad['bobina_mm']} mm"
                + (f", {ad['pecas_emenda']} peças (emenda)" if ad["pecas_emenda"] > 1 else "")
                + f" — {ad['vinil_m2']} m² de vinil"
                + f" ({ad.get('aproveitamento_pct', 0):.0f}% aproveitado)"
                + folhas_txt
            )
        L += ["", f"### Plano — {pl['resumo']['n_dias']} dia(s), {pl['resumo']['n_passos']} passos, "
                  f"{pl['resumo']['n_sessoes_pintura']} sessões, ~{pl['resumo']['horas_estimadas']} h*", ""]
        for dia in pl["dias"]:
            L.append(f"**Dia {dia['dia']}**" + (f" — *{dia['quebra']}*" if dia.get("quebra") else ""))
            for s_ in dia["passos"]:
                t = s_["tempo"]
                horas = f" ({t['horas']} h)" if t and t.get("horas") else ""
                L.append(f"1. {s_['o_que']}{horas}")
                L.append(f"   - {s_['justificativa']['frase']}")
            L.append("")
        L += ["\\* horas com taxas `chute` — calibrar com o ERP", ""]
        if a["perguntas"]:
            L += ["### Perguntas (o motor não decide sozinho)", ""]
            for q in a["perguntas"]:
                L.append(f"- {q['pergunta']} — *default: {q['default']}*")
            L.append("")
        if a["divergencias"]:
            L += ["### Divergências (duas leituras discordaram)", ""]
            for dv in a["divergencias"]:
                L.append(f"- **{dv['tipo']}**: {dv['detalhe']}")
            L.append("")
    if comparacao:
        L += ["## Lateral × Traseira", ""]
        tr = comparacao.get("hexes_transferiveis")
        L.append(f"- hexes transferíveis entre faces: **{tr}**")
        for d in comparacao.get("defeitos", []):
            L.append(f"- **DEFEITO — {d['tipo']}**: {d['detalhe']}")
        for d in comparacao.get("divergencias", []):
            L.append(f"- divergência — {d['tipo']}: {d['detalhe']}")
        L.append("")
    return "\n".join(L)
