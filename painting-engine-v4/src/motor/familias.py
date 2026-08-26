"""Famílias de tinta: o que a partição separa e a oficina junta.

Discriminante (§8.1 — caminho de evidência independente do ΔE de âncora):
duas classes chapadas com fronteira comum fundem numa FAMÍLIA quando a
transição entre elas é SUAVE — o degrau pixel-a-pixel na fronteira é ~zero
(fatias de uma rampa contínua partida pela semeadura). Tintas distintas têm
degrau cheio (os 5 azuis do 137: degrau ΔE 5–8 ⇒ NÃO fundem; os tons de uma
rampa: degrau ~0 ⇒ fundem).

A transitividade aqui é CORRETA porque só encadeia elos suaves — extremos da
mesma rampa são a mesma tinta-família por construção (≠ armadilha 3.6, que
encadeava por ΔE de âncora).

Zonas contínuas: anexam à família com que fazem mais contato suave; zonas
soltas agrupam entre si (contato zona-zona) e viram famílias próprias (a
rampa dourada do BURES 1 é UMA tinta-família com rampa).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .cor import delta_e, srgb_para_lab


@dataclass
class Familia:
    id: int
    hex_representante: str
    membros: list = field(default_factory=list)      # ids de classe chapada
    zonas: list = field(default_factory=list)        # ids de zona anexadas
    m2: float = 0.0
    rampa_significativa: bool = False
    e_campo: bool = False
    # BRANCO no grupo da chapa (L* ≥ 91, croma ≤ 8): não é tinta — é CHAPA
    # EXPOSTA por máscara (vinil aplicado antes da demão) ou vinil branco
    # final. Não entra em sessão de pintura, não paga fronteira, não gera
    # ciclo de readesivo (o "pintar #FFFFFF" do Aquarela era este erro).
    chapa_exposta: bool = False


def degraus_por_par(labels: np.ndarray, rgb: np.ndarray, ids: set | None = None,
                    max_amostras_par: int = 1500, min_amostras: int = 30) -> dict:
    """Mediana do ΔE pixel-a-pixel nas transições verticais de cada par.

    ids=None mede TODOS os pares (inclusive zonas) numa passada só. É o
    caminho de evidência que separa fatia-de-rampa (degrau ~0) de tintas
    distintas (degrau cheio) — e vale igualmente para contato zona×tinta.
    """
    amostras: dict[tuple, list] = {}
    h, w = labels.shape
    ids_arr = np.array(sorted(ids)) if ids is not None else None
    for y0 in range(0, h - 1, 3):
        a = labels[y0, :]
        b = labels[y0 + 1, :]
        m = a != b
        if not m.any():
            continue
        xs = np.nonzero(m)[0]
        av, bv = a[xs], b[xs]
        if ids_arr is not None:
            ok = np.isin(av, ids_arr) & np.isin(bv, ids_arr)
            if not ok.any():
                continue
            xs, av, bv = xs[ok], av[ok], bv[ok]
        lab_a = srgb_para_lab(rgb[y0, xs])
        lab_b = srgb_para_lab(rgb[y0 + 1, xs])
        d = delta_e(lab_a, lab_b)
        for i in range(len(av)):
            k = (int(min(av[i], bv[i])), int(max(av[i], bv[i])))
            lst = amostras.setdefault(k, [])
            if len(lst) < max_amostras_par:
                lst.append(float(d[i]))
    return {k: float(np.median(v)) for k, v in amostras.items() if len(v) >= min_amostras}


def construir(labels: np.ndarray, rgb: np.ndarray, classes: list, campo_id: int,
              zonas: list, contatos_zona: dict, mm_px: float, params: dict,
              degraus: dict | None = None, campo_e_tinta: bool = False):
    """Devolve (familia_de: id→familia_id, familias: list[Familia])."""
    chapadas = [c for c in classes if c.tipo == "chapada"]
    ids = {c.id for c in chapadas}
    if degraus is None:
        degraus = degraus_por_par(labels, rgb, ids)

    pai = {c.id: c.id for c in chapadas}

    def achar(x):
        while pai[x] != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x

    LIMIAR_SUAVE = 2.5
    labs_de = {c.id: c.lab for c in chapadas}
    teto_de = 12.0  # nunca fundir tintas a ΔE>12 mesmo com transição suave:
    # uma sombra esfumada ENTRE duas tintas distintas (AKTL marinho×grafite)
    # amolece o degrau sem torná-las a mesma tinta
    for (a, b), degrau in degraus.items():
        if a not in labs_de or b not in labs_de:
            continue
        if campo_id in (a, b):
            # a VINHETA do próprio fundo (Aquarela: campo em degradê) funde no
            # campo — mas SÓ quando o campo é TINTA: num campo-chapa isso
            # declararia tinta pintada como "de graça" (rampa do BURES 1)
            if not campo_e_tinta:
                continue
            if degrau < LIMIAR_SUAVE and float(delta_e(labs_de[a], labs_de[b])) <= 20.0:
                ra, rb = achar(a), achar(b)
                if ra != rb:
                    pai[ra] = rb
            continue
        if degrau < LIMIAR_SUAVE and float(delta_e(labs_de[a], labs_de[b])) <= teto_de:
            ra, rb = achar(a), achar(b)
            if ra != rb:
                pai[ra] = rb

    # pontes por ZONA na MESMA união: zona—chapada suave e zona—zona.
    # É o que junta a ponta chapada de uma rampa com as fatias dela
    # (BURES 1: #CA7A00 + zonas da rampa dourada = UMA tinta-família).
    area_zona = {z["classe_id"]: z["area_m2"] for z in zonas}
    tipo_zona = {z["classe_id"]: z["tipo"] for z in zonas}
    lab_zona = {z["classe_id"]: np.array(z.get("lab_media", [50, 0, 0]), dtype=np.float32)
                for z in zonas}
    for z in zonas:
        pai.setdefault(z["classe_id"], z["classe_id"])
    for z in zonas:
        zid = z["classe_id"]
        if tipo_zona.get(zid) == "SOMBRA_SUAVE":
            continue  # sombra abraça, não faz ponte — só anexa (abaixo)
        # VINHETA-ZONA do próprio fundo (Aquarela): um DEGRADÊ grande cuja
        # transição para o campo é SUAVE, cor vizinha do campo e contato
        # majoritariamente com o campo é o sombreado da demão geral — funde
        # no campo em vez de virar "degradê na janela" com verniz e dia extra
        contato_campo = contatos_zona.get(zid, {}).get(campo_id)
        if (campo_e_tinta and contato_campo is not None
                and contato_campo[1] == "soft"
                and tipo_zona.get(zid) == "DEGRADE"
                and campo_id in labs_de
                and float(delta_e(lab_zona[zid], labs_de[campo_id])) <= 20.0):
            m_campo = contato_campo[0]
            m_outros = sum(m for o, (m, _md) in contatos_zona.get(zid, {}).items()
                           if o != campo_id)
            if m_campo >= m_outros:
                ra, rb = achar(zid), achar(campo_id)
                if ra != rb:
                    pai[ra] = rb
                continue
        melhor_chapada = None
        for outro, (metros, modo) in contatos_zona.get(zid, {}).items():
            if outro == campo_id:
                continue
            if modo == "zona" and outro in lab_zona:
                # zona-zona só encadeia dentro da MESMA rampa (cores próximas);
                # sem o teto, a rampa da onda azul fazia ponte com a laranja
                # e fundia duas tintas (BURES 2)
                if float(delta_e(lab_zona[zid], lab_zona[outro])) <= 16.0:
                    ra, rb = achar(zid), achar(outro)
                    if ra != rb:
                        pai[ra] = rb
            elif modo == "soft" and outro in labs_de:
                if melhor_chapada is None or metros > melhor_chapada[1]:
                    melhor_chapada = (outro, metros)
        # ponte com UMA chapada só (a de mais contato suave), e ainda assim
        # apenas se a cor média da zona for da família dela
        if melhor_chapada is not None:
            outro = melhor_chapada[0]
            if float(delta_e(lab_zona[zid], labs_de[outro])) <= 20.0:
                ra, rb = achar(zid), achar(outro)
                if ra != rb:
                    pai[ra] = rb

    grupos: dict[int, dict] = {}
    for c in chapadas:
        g = grupos.setdefault(achar(c.id), {"classes": [], "zonas": []})
        g["classes"].append(c)
    for z in zonas:
        zid = z["classe_id"]
        if tipo_zona[zid] == "SOMBRA_SUAVE":
            continue
        g = grupos.setdefault(achar(zid), {"classes": [], "zonas": []})
        g["zonas"].append(zid)

    m2px = mm_px * mm_px / 1e6
    familias: list[Familia] = []
    familia_de: dict[int, int] = {}
    for raiz, g in grupos.items():
        membros, zids = g["classes"], g["zonas"]
        fid = len(familias)
        if membros:
            rep = max(membros, key=lambda c: c.massa_px)
            hex_rep = rep.hex_ancora
            e_campo = rep.id == campo_id
            labs = np.stack([c.lab for c in membros])
            span = 0.0
            if len(membros) > 1:
                d = delta_e(labs[:, None, :], labs[None, :, :])
                span = float(d.max())
        else:
            # família só de zonas: o hex representante vem da classe
            # RECLASSIFICADA de maior massa; sem ela, do hex MÉDIO da maior
            # zona (a rampa verde do BRAVO é uma tinta-família verde)
            reclass = [c for c in classes
                       if c.tipo == "zona_continua" and c.id in zids
                       and c.hex_ancora not in ("#zona", "#rampa", "#sombra")]
            if reclass:
                hex_rep = max(reclass, key=lambda c: c.massa_px).hex_ancora
            else:
                zdicts = [z for z in zonas if z["classe_id"] in zids and z.get("hex_medio")]
                hex_rep = (max(zdicts, key=lambda z: z["area_m2"])["hex_medio"]
                           if zdicts else "#rampa")
            e_campo, span = False, 0.0
        area_z = sum(area_zona[z] for z in zids)
        rampa = span > 12.0 or (
            area_z >= 0.05 and any(tipo_zona[z] != "SOMBRA_SUAVE" for z in zids)
        )
        familias.append(Familia(
            id=fid,
            hex_representante=hex_rep,
            membros=[c.id for c in membros],
            zonas=list(zids),
            m2=round(sum(c.massa_px for c in membros) * m2px + area_z, 3),
            rampa_significativa=rampa,
            e_campo=e_campo,
        ))
        for c in membros:
            familia_de[c.id] = fid
        for z in zids:
            familia_de[z] = fid

    # SOMBRAs anexam (sem fazer ponte) à família de mais contato suave
    for z in zonas:
        zid = z["classe_id"]
        if tipo_zona[zid] != "SOMBRA_SUAVE" or zid in familia_de:
            continue
        melhor = None
        for outro, (metros, modo) in contatos_zona.get(zid, {}).items():
            if modo in ("soft", "zona") and outro in familia_de:
                if melhor is None or metros > melhor[1]:
                    melhor = (outro, metros)
        if melhor is not None:
            fid = familia_de[melhor[0]]
            familias[fid].zonas.append(zid)
            familias[fid].m2 = round(familias[fid].m2 + z["area_m2"], 3)
            familia_de[zid] = fid
        else:
            fid = len(familias)
            familias.append(Familia(
                id=fid, hex_representante="#sombra", membros=[], zonas=[zid],
                m2=z["area_m2"], rampa_significativa=False,
            ))
            familia_de[zid] = fid

    # NOTA (rodada 4): branco em campo TINTA é TINTA — a ficha do A&P conta
    # 3,2 m² incluindo o branco (o passo zero pinta o painel TODO; o branco
    # volta por sessão). O conceito "chapa exposta" foi testado e REVERTIDO;
    # brancos grandes viram PERGUNTA (pintar × preservar por máscara) no
    # analise.py, nunca decisão silenciosa.
    return familia_de, familias
