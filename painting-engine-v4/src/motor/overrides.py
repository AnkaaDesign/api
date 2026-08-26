"""Edição manual em modo headless — §6 do brief.

Um dicionário (ou arquivo JSON) de overrides sobrepõe decisões da análise
ANTES do plano:

    {"campo.classe": "CHAPA", "pintura_geral": false}

Edição é sobreposição, nunca destruição: o valor proposto pelo motor fica
registrado em `edicoes[]` ao lado do editado, e o plano é recalculado em
cascata. Depois de aplicar, as CONSISTÊNCIAS rodam: mudar campo.classe
recalcula pintura_geral e a demão de fundo — trocar uma premissa muda o que
vem depois (§6.2).
"""
from __future__ import annotations

import json


def aplicar_dict(analise: dict, ov: dict, params: dict | None = None) -> None:
    edicoes = analise.setdefault("edicoes", [])
    for rota, novo in ov.items():
        partes = rota.split(".")
        alvo = analise
        for p_ in partes[:-1]:
            alvo = alvo.setdefault(p_, {})
        antigo = alvo.get(partes[-1])
        alvo[partes[-1]] = novo
        edicoes.append({
            "rota": rota,
            "proposto_pelo_motor": antigo,
            "editado": novo,
            "nota": "edição manual — recalculada em cascata",
        })
    _consistencias(analise, ov, params)


def aplicar(analise: dict, caminho_overrides: str, params: dict | None = None) -> None:
    with open(caminho_overrides, encoding="utf-8") as fh:
        aplicar_dict(analise, json.load(fh), params)


def _consistencias(analise: dict, ov: dict, params: dict | None = None) -> None:
    """Recalcula o que decorre da premissa editada (§6.2)."""
    # técnica por elemento editada → propaga para os objetos e refaz os
    # adesivos (elemento que virou stencil/fita sai do vinil)
    if any(r.startswith("edicao_tecnicas") for r in ov) and params is not None:
        from . import adesivos as _ad
        interno = analise.get("_interno") or {}
        els = interno.get("elementos_obj") or []
        ed = analise.get("edicao_tecnicas") or {}
        for el in els:
            chave = str(el.id) if str(el.id) in ed else el.id
            if chave in ed:
                el.tecnica = ed[chave]
                el.tecnica_fonte = "editada"
        for e_dict in analise.get("elementos", []):
            chave = str(e_dict["id"]) if str(e_dict["id"]) in ed else e_dict["id"]
            if chave in ed:
                e_dict["tecnica"] = ed[chave]
                e_dict["tecnica_fonte"] = "editada"
        if els and "mm_px" in interno:
            ads, _ = _ad.agrupar_adesivos(els, interno["mm_px"], params,
                                          mapa=interno.get("mapa"))
            analise["adesivos"] = ads
    if "campo.classe" in ov:
        e_tinta = analise["campo"]["classe"] == "TINTA"
        analise["pintura_geral"] = e_tinta
        if e_tinta:
            fam_campo = next(
                (f for f in analise["paleta"]["familias"] if f.get("campo")), None
            )
            analise["demao_fundo_m2"] = fam_campo["m2"] if fam_campo else 0.0
        else:
            analise["demao_fundo_m2"] = 0.0
        analise["campo"]["justificativa"] = (
            f"campo {analise['campo']['hex']} definido como "
            f"{analise['campo']['classe']} PELO REVISOR (edição §6) — "
            + ("demão de fundo no painel inteiro" if e_tinta else "sem demão geral")
        )
    if "pintura_geral" in ov and "campo.classe" not in ov:
        analise["campo"]["classe"] = "TINTA" if ov["pintura_geral"] else "CHAPA"
        _consistencias(analise, {"campo.classe": analise["campo"]["classe"]})
