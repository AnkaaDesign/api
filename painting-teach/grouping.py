"""Agrupamento determinístico de regiões em elementos de produção — **v0**.

Existe porque o passe semântico (`painting-vision/probe/production.py:semantic`)
depende do Qwen, e nesta máquina não há `OPENROUTER_API_KEY` nem Ollama. Sem
elementos não há plano: o motor decompõe por COR e a produção decompõe por
ELEMENTO.

Segue `PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` §5 e §8 — contenção,
contato, proximidade **relativa** (nunca um limiar fixo em cm), alinhamento e
barreiras de escala. Não usa rótulo nenhum: o elemento é anônimo, e a produção
não precisa saber que um bloco é "telefone".

**Este arquivo é v0 de propósito.** O `PAINTING_TEACHING_LOOP_SPEC.md` §11 diz
que o agrupador definitivo nasce DEPOIS da marcação, porque as decisões de
fundir/separar do dono é que são a especificação dele. O que está aqui existe
para haver algo em cima de que marcar — e por isso cada fusão guarda a
**evidência** que a causou, que é o que a estação de marcação mostra.

Nada aqui toca no `painting-engine`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union
from skimage import color as skcolor

# Tons a menos disto do fundo são o próprio campo partido pelo quantizador, não
# elemento. Mesmo valor que `production.py:GRADIENT_DELTA_E`.
CAMPO_DELTA_E = 16.0

# Barreiras e folgas do agrupamento, todas RELATIVAS à altura dos átomos.
GAP_MESMA_LINHA = 0.80      # × altura de referência
# Mesma linha de base + mesma altura + mesma cor é a assinatura de uma linha de
# texto (§5.3 alinhamento, §5.4 estilo). Aí o espaçamento pode ser largo sem
# deixar de ser um bloco só: "TRANSPORTE & LOGÍSTICA" da BURES tem 50 cm entre
# as palavras, 3,1× a altura da letra.
GAP_MESMA_LINHA_ALINHADO = 3.50
BASELINE_TOL = 0.20         # × altura: tolerância de topo e base
GAP_EMPILHADO = 0.50        # × altura de referência
OVERLAP_LINHA_MIN = 0.35    # sobreposição vertical mínima p/ "mesma linha"
OVERLAP_PILHA_MIN = 0.30    # sobreposição horizontal mínima p/ "empilhado"
ESCALA_MAX = 4.0            # razão de alturas acima disto: escalas incompatíveis

# Faixa: estrutura longa que atravessa a peça. Não absorve vizinho por
# proximidade — foi assim que a faixa da "mar e rio" levou o texto junto.
FAIXA_LARGURA_FACE_MIN = 0.35   # × largura da face
FAIXA_ALONGAMENTO_MIN = 5.0     # largura / altura
FAIXA_CONTINUIDADE_MIN = 0.85   # fração de colunas com tinta — furo = texto

# Abaixo disto, e sozinho, é sujeira do quantizador — não vira elemento.
# Mesmo valor de `production.py:AVULSO_MIN_M2`.
RUIDO_MAX_M2 = 0.10

# FILAMENTO: região que ocupa quase nada da própria caixa e é fina.
# Medido na BURES: `r105`, cinza #6b7075, 0,029 m² de tinta numa caixa de 21 m²
# (0,14%) — é o antialias entre as duas ondas, quantizado na MESMA cor do texto
# "TRANSPORTE & LOGÍSTICA". Como é um fio conexo que atravessa a face inteira,
# ele encosta em todo mundo e funde a arte inteira num elemento só.
# Filamento não agrupa e não estende caixa de ninguém: vira item próprio.
FILAMENTO_DENSIDADE_MAX = 0.06     # área pintada ÷ área da caixa
FILAMENTO_TRACO_MAX_MM = 8.0       # `micro_stroke_mm` do motor
FILAMENTO_CAIXA_MIN_M2 = 0.5       # abaixo disto não há o que fundir errado

# Átomo mais baixo que isto não faz ponte por proximidade — só por contato ou
# contenção. Sem isto, um fragmento de antialias entre dois blocos distantes
# vira o degrau que une os dois.
PONTE_ALTURA_MIN_CM = 2.0


def _lab(hexv: str) -> np.ndarray:
    """CIELAB da cor. `#multi` (zona fotográfica) nunca é cor: devolve um ponto
    absurdamente distante para que jamais funda com tinta nenhuma."""
    if not (hexv.startswith("#") and len(hexv) == 7):
        return np.array([1e6, 1e6, 1e6])
    rgb = np.array([[[int(hexv[i:i + 2], 16) / 255 for i in (1, 3, 5)]]])
    return skcolor.rgb2lab(rgb)[0, 0]


@dataclass
class Atom:
    """Uma região do motor, com a geometria já em cm."""
    id: str
    hex: str
    kind: str
    area_m2: float
    perimeter_m: float
    min_stroke_mm: float
    islands: int
    contained_by: str | None
    x0: float
    y0: float
    x1: float
    y1: float
    geom: Polygon | None = None      # contorno em cm, para distância entre FORMAS

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    @property
    def densidade(self) -> float:
        caixa = (self.w / 100.0) * (self.h / 100.0)
        return self.area_m2 / caixa if caixa > 0 else 1.0

    @property
    def filamento(self) -> bool:
        return (self.densidade < FILAMENTO_DENSIDADE_MAX
                and self.min_stroke_mm < FILAMENTO_TRACO_MAX_MM
                and (self.w / 100.0) * (self.h / 100.0) >= FILAMENTO_CAIXA_MIN_M2)


@dataclass
class Grupo:
    key: str
    atoms: list[Atom]
    evidencias: list[dict] = field(default_factory=list)
    _geom: object = None

    @property
    def x0(self) -> float:
        return min(a.x0 for a in self.atoms)

    @property
    def y0(self) -> float:
        return min(a.y0 for a in self.atoms)

    @property
    def x1(self) -> float:
        return max(a.x1 for a in self.atoms)

    @property
    def y1(self) -> float:
        return max(a.y1 for a in self.atoms)

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    @property
    def h_ref(self) -> float:
        """Altura de referência = MEDIANA dos átomos, não a caixa do grupo.

        Usar a caixa faria o limiar crescer a cada fusão e o grupo engoliria a
        face inteira em três rodadas. A mediana é a "altura de caractere" do
        §5.2 e fica estável enquanto o grupo cresce.
        """
        return float(np.median([a.h for a in self.atoms])) or 0.1

    @property
    def area_m2(self) -> float:
        return sum(a.area_m2 for a in self.atoms)

    @property
    def geom(self):
        if self._geom is None:
            partes = [a.geom for a in self.atoms if a.geom is not None]
            self._geom = unary_union(partes) if partes else None
        return self._geom

    def distancia_cm(self, outro: "Grupo") -> float:
        """Distância entre as FORMAS, em cm — não entre as caixas.

        A caixa da onda laranja da BURES sobrepõe a das letras "RES" e as duas
        seriam agrupadas; as formas estão a mais de meio metro uma da outra.
        """
        if self.geom is None or outro.geom is None:
            return float("inf")
        return float(self.geom.distance(outro.geom))


def _campo_hexes(analysis: dict) -> set[str]:
    """O campo é um CONJUNTO de tons, não um índice.

    O motor elege UM índice como fundo; o quantizador rotineiramente parte o
    campo em tons próximos e todos menos um passariam a contar como tinta.
    (Mesmo raciocínio de `production.py:build_elements`.)
    """
    campo_lab = _lab(analysis["background"]["hex"])
    out = {analysis["background"]["hex"]}
    for r in analysis["regions"]:
        if np.linalg.norm(_lab(r["hex"]) - campo_lab) < CAMPO_DELTA_E:
            out.add(r["hex"])
    return out


def build_atoms(analysis: dict, px_per_cm: float) -> tuple[list[Atom], list[dict]]:
    """Regiões pintáveis viram átomos. Devolve (átomos, ignoradas)."""
    campo = _campo_hexes(analysis)
    atoms: list[Atom] = []
    ignoradas: list[dict] = []
    for r in analysis["regions"]:
        motivo = None
        if r["is_background"]:
            motivo = "RESERVA — branco preservado, nunca é tinta"
        elif r["hex"] in campo and r["kind"] != "FOTOGRAFICO":
            motivo = (f"tom do campo (ΔE < {CAMPO_DELTA_E:.0f} do fundo "
                      f"{analysis['background']['hex']}) — é fundo partido pelo "
                      f"quantizador, não desenho")
        if motivo:
            ignoradas.append({"regiao": r["id"], "hex": r["hex"],
                              "area_m2": r["area_m2"], "motivo": motivo})
            continue
        # bbox do motor é (min_row, min_col, max_row, max_col) em px de trabalho
        y0, x0, y1, x1 = r["bbox"]
        atoms.append(_com_geom(r, px_per_cm, Atom(
            id=r["id"], hex=r["hex"], kind=r["kind"],
            area_m2=r["area_m2"], perimeter_m=r["perimeter_m"],
            min_stroke_mm=r["min_stroke_mm"], islands=r["islands"],
            contained_by=r.get("contained_by"),
            x0=x0 / px_per_cm, y0=y0 / px_per_cm,
            x1=x1 / px_per_cm, y1=y1 / px_per_cm,
        )))
    return atoms, ignoradas


def _com_geom(r: dict, px_per_cm: float, atom: Atom) -> Atom:
    """Anexa o contorno do motor como polígono em cm (buracos ignorados: para
    distância entre peças vizinhas o que importa é o anel externo)."""
    ring = r.get("contour") or []
    if len(ring) >= 3:
        poly = Polygon([(x / px_per_cm, y / px_per_cm) for x, y in ring])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if not poly.is_empty:
            if isinstance(poly, MultiPolygon):
                poly = max(poly.geoms, key=lambda g: g.area)
            atom.geom = poly
    return atom


def _gap(a0: float, a1: float, b0: float, b1: float) -> float:
    """Distância entre dois intervalos; 0 quando se sobrepõem."""
    return max(0.0, max(a0, b0) - min(a1, b1))


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _continuidade(g: Grupo, amostras: int = 40) -> float:
    """Fração das colunas do grupo que encostam na forma.

    É o que separa uma FAIXA de uma linha de texto longa: a onda é contínua de
    ponta a ponta (~1,0); "TRANSPORTE & LOGÍSTICA" tem o mesmo alongamento e a
    mesma largura, mas é furada pelos espaços entre as letras.
    """
    geom = g.geom
    if geom is None or g.w <= 0:
        return 0.0
    from shapely.geometry import LineString
    passos = [g.x0 + (i + 0.5) * g.w / amostras for i in range(amostras)]
    toca = sum(1 for x in passos
               if geom.intersects(LineString([(x, g.y0 - 1), (x, g.y1 + 1)])))
    return toca / amostras


def _e_faixa(g: Grupo, face_w_cm: float) -> bool:
    return (g.w >= FAIXA_LARGURA_FACE_MIN * face_w_cm
            and g.h > 0 and g.w / g.h >= FAIXA_ALONGAMENTO_MIN
            and _continuidade(g) >= FAIXA_CONTINUIDADE_MIN)


def _e_aero(g: Grupo) -> bool:
    return any(a.kind == "FOTOGRAFICO" or a.hex == "#multi" for a in g.atoms)


def group_atoms(atoms: list[Atom], analysis: dict, face_w_cm: float,
                max_rondas: int = 8) -> list[Grupo]:
    """Une átomos em elementos. Cada fusão registra a evidência que a causou."""
    if not atoms:
        return []

    # Fios de antialias ficam de fora de TODA união — inclusive contato, que é
    # justamente como eles colam a face inteira.
    fios = [a for a in atoms if a.filamento]
    atoms = [a for a in atoms if not a.filamento]
    if not atoms:
        return [Grupo(key=f.id, atoms=[f]) for f in fios]

    parent = {a.id: a.id for a in atoms}
    by_id = {a.id: a for a in atoms}
    evid: dict[str, list[dict]] = {a.id: [] for a in atoms}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def une(a: str, b: str, ev: dict) -> bool:
        ra, rb = find(a), find(b)
        if ra == rb:
            return False
        parent[ra] = rb
        evid[rb] = evid[rb] + evid[ra] + [ev]
        evid[ra] = []
        return True

    # --- E1 contenção: o motor já resolveu quem envolve quem ----------------
    for a in atoms:
        if a.contained_by and a.contained_by in by_id:
            une(a.id, a.contained_by, {
                "regra": "CONTENCAO",
                "texto": f"{a.id} está inteiramente dentro do contorno de {a.contained_by}",
                "medida": None,
            })

    # --- E2 contato direto: duas cores do desenho que se encostam ----------
    # São necessariamente o mesmo item físico — o adesivo é um só e o que muda
    # entre as cores é a depilação (doutrina §3.0).
    for b in analysis["boundaries"]:
        if b["kind"] != "PAINT_PAINT":
            continue
        ra, rb = b.get("a"), b.get("b")
        if ra in by_id and rb in by_id:
            une(ra, rb, {
                "regra": "CONTATO",
                "texto": f"{ra} e {rb} se tocam ({b['length_m']:.2f} m de fronteira tinta-tinta)",
                "medida": {"fronteira_m": b["length_m"]},
            })

    # --- E3/E4 proximidade relativa + alinhamento --------------------------
    for _ in range(max_rondas):
        grupos = _montar(atoms, find, evid)
        faixas = {g.key for g in grupos if _e_faixa(g, face_w_cm)}
        mudou = False
        candidatos: list[tuple[float, str, str, dict]] = []

        for i, ga in enumerate(grupos):
            for gb in grupos[i + 1:]:
                if ga.key in faixas or gb.key in faixas:
                    continue          # faixa não absorve vizinho por proximidade
                if _e_aero(ga) or _e_aero(gb):
                    continue          # aerografia é item de produção próprio
                if (max(a.h for a in ga.atoms) < PONTE_ALTURA_MIN_CM
                        or max(a.h for a in gb.atoms) < PONTE_ALTURA_MIN_CM):
                    continue          # fragmento não faz ponte entre blocos
                ha, hb = ga.h_ref, gb.h_ref
                if max(ha, hb) / max(0.1, min(ha, hb)) > ESCALA_MAX:
                    continue          # escalas incompatíveis (§5.6)
                h_ref = min(ha, hb)
                gx = _gap(ga.x0, ga.x1, gb.x0, gb.x1)
                gy = _gap(ga.y0, ga.y1, gb.y0, gb.y1)
                ov_y = _overlap(ga.y0, ga.y1, gb.y0, gb.y1)
                ov_x = _overlap(ga.x0, ga.x1, gb.x0, gb.x1)
                # pré-filtro barato pela caixa; a distância real só é medida em
                # quem já passou (shapely é caro para todos os pares).
                mesma_linha = gy == 0 and ov_y >= OVERLAP_LINHA_MIN * h_ref
                empilhado = gx == 0 and ov_x >= OVERLAP_PILHA_MIN * min(ga.w, gb.w)
                if not (mesma_linha or empilhado):
                    continue
                alinhado = (mesma_linha
                            and abs(ga.y0 - gb.y0) <= BASELINE_TOL * h_ref
                            and abs(ga.y1 - gb.y1) <= BASELINE_TOL * h_ref
                            and {a.hex for a in ga.atoms} == {a.hex for a in gb.atoms})
                fator = (GAP_MESMA_LINHA_ALINHADO if alinhado
                         else GAP_MESMA_LINHA if mesma_linha else GAP_EMPILHADO)
                limite = fator * h_ref
                if min(gx, gy) > limite:
                    continue
                d = ga.distancia_cm(gb)
                if d > limite:
                    continue

                regra = ("MESMA_LINHA_ALINHADA" if alinhado
                         else "MESMA_LINHA" if mesma_linha else "EMPILHADO")
                arranjo = ("mesma linha de base, mesma altura e mesma cor" if alinhado
                           else "lado a lado" if mesma_linha
                           else "uma linha sobre a outra")
                candidatos.append((d / h_ref, ga.key, gb.key, {
                    "regra": regra,
                    "texto": (f"{arranjo}: {d:.1f} cm entre as formas, "
                              f"{d / h_ref:.2f}× a altura ({h_ref:.1f} cm); "
                              f"limite {limite:.1f} cm"),
                    "medida": {"dist_cm": round(d, 1), "dist_rel": round(d / h_ref, 2),
                               "altura_cm": round(h_ref, 1), "limite_cm": round(limite, 1)},
                }))

        # do par mais apertado para o mais folgado: fusão gulosa pela evidência
        # mais forte primeiro, e o resto é reavaliado na rodada seguinte.
        for _score, ka, kb, ev in sorted(candidatos, key=lambda c: c[0]):
            mudou = une(ka, kb, ev) or mudou
        if not mudou:
            break

    return _montar(atoms, find, evid) + [Grupo(key=f.id, atoms=[f]) for f in fios]


def _montar(atoms: list[Atom], find, evid) -> list[Grupo]:
    buckets: dict[str, list[Atom]] = {}
    for a in atoms:
        buckets.setdefault(find(a.id), []).append(a)
    return [Grupo(key=k, atoms=v, evidencias=evid.get(k, []))
            for k, v in buckets.items()]


def elements(analysis: dict, px_per_cm: float) -> tuple[list[dict], list[dict], list[dict]]:
    """Elementos anônimos de produção. Devolve (elementos, ruído, ignoradas)."""
    face_w_cm = analysis["image"]["widthCm"]
    atoms, ignoradas = build_atoms(analysis, px_per_cm)
    grupos = group_atoms(atoms, analysis, face_w_cm)

    # Aerografia: zonas fotográficas viram UM item por zona conexa; o resto do
    # grupo que porventura encostou nelas continua junto (o adesivo é o shape
    # externo, doutrina §0).
    saida, ruido = [], []
    grupos.sort(key=lambda g: -g.area_m2)
    n = 0
    for g in grupos:
        aero = _e_aero(g)
        fio = len(g.atoms) == 1 and g.atoms[0].filamento
        faixa = (not fio) and _e_faixa(g, face_w_cm)
        tipo = ("AEROGRAFIA" if aero else "FILAMENTO" if fio
                else "FAIXA" if faixa else "BLOCO")
        item = {
            "id": g.key,
            "tipo": tipo,
            "regioes": [a.id for a in g.atoms],
            "area_m2": round(g.area_m2, 4),
            "bbox_cm": [round(g.x0, 1), round(g.y0, 1), round(g.x1, 1), round(g.y1, 1)],
            "largura_cm": round(g.w, 1),
            "altura_cm": round(g.h, 1),
            "altura_ref_cm": round(g.h_ref, 1),
            "perimetro_m": round(sum(a.perimeter_m for a in g.atoms), 3),
            "menor_traco_mm": round(min(a.min_stroke_mm for a in g.atoms), 1),
            "ilhas": sum(a.islands for a in g.atoms),
            "tons": sorted({a.hex for a in g.atoms}),
            "evidencias": g.evidencias,
        }
        if fio:
            a = g.atoms[0]
            item["motivo_descarte"] = (
                f"fio de {a.area_m2:.3f} m² numa caixa de "
                f"{(a.w / 100) * (a.h / 100):.1f} m² ({a.densidade * 100:.1f}% de "
                f"ocupação, traço de {a.min_stroke_mm:.1f} mm) — antialias entre "
                f"duas cores, quantizado como cor própria. Não agrupa com "
                f"ninguém: como é conexo e atravessa a face, colaria a arte "
                f"inteira num elemento só.")
            ruido.append(item)
            continue
        if (item["area_m2"] < RUIDO_MAX_M2 and len(g.atoms) == 1
                and tipo == "BLOCO"):
            item["motivo_descarte"] = (
                f"{item['area_m2']:.3f} m² sozinho, abaixo de {RUIDO_MAX_M2} m² — "
                f"sujeira do quantizador. Vira um adesivo que não é nada e ainda "
                f"puxa um ciclo de verniz inteiro.")
            ruido.append(item)
            continue
        n += 1
        item["nome"] = (f"Aerografia {n}" if aero else
                        f"Faixa {n}" if faixa else f"Elemento {n}")
        saida.append(item)
    return saida, ruido, ignoradas
