"""Os números que entram na conta — cada um com a FONTE declarada.

Tudo aqui é cópia fiel do que o ERP já usa (`api/src/scripts/seed-painting-config.ts`)
ou do que a doutrina fixou. O ponto de existir este arquivo separado é que a
estação de marcação **mostra a fonte de cada número na tela**: sem isso não dá
para o dono distinguir "o motor mediu errado" de "o parâmetro está errado" — e
essa distinção é o §6 do `PAINTING_TEACHING_LOOP_SPEC.md`.

Fontes:
  DONO      — dito pelo dono e registrado na doutrina
  MEDIDO    — medido nas 66 artes
  SEED      — está no seed do ERP hoje, sem confirmação
  ESTIMADO  — o próprio seed marca como estimativa
  INVENTADO — número sem origem conhecida (o `PAINTING_V3_WORKFLOW_SPEC` §1.2
              lista vários; ficam aqui explícitos para serem corrigidos)
"""

from __future__ import annotations

# --------------------------------------------------------- mão de obra ------
# key: (label, modo, valor, unidade, fonte, nota)
TAXAS: dict[str, dict] = {
    "WASH_M2_PER_MIN": dict(label="Lavagem/desengraxe", valor=1.5, un="m²/min", fonte="SEED"),
    "PAPER_MASK_M2_PER_MIN": dict(label="Empapelamento (papel + fita)", valor=0.8, un="m²/min", fonte="SEED"),
    "PLOT_M_PER_MIN": dict(label="Plotagem/recorte da máscara", valor=3.0, un="m/min", fonte="SEED"),
    "WEED_M2_PER_MIN": dict(label="Depilação do adesivo", valor=0.3, un="m²/min", fonte="SEED"),
    "WEED_MIN_PER_ISLAND": dict(label="Depilação — acréscimo por ilha", valor=0.5, un="min/ilha", fonte="SEED"),
    "APPLY_ADHESIVE_M2_PER_MIN": dict(label="Aplicação de adesivo", valor=0.4, un="m²/min", fonte="SEED",
                                      nota="o seed diz '2 pessoas' na nota mas multiplica por 1 — V3 §1.2"),
    "PAINT_COAT_M2_PER_MIN": dict(label="Pintura à pistola (por demão)", valor=2.0, un="m²/min", fonte="SEED"),
    "AIRBRUSH_ART_M2_PER_MIN": dict(label="Aerografia artística", valor=0.04, un="m²/min", fonte="SEED",
                                    nota="25 min por m² — o número mais pesado do plano inteiro"),
    "COLOR_SWAP_MIN": dict(label="Troca de cor + limpeza da pistola", valor=20.0, un="min", fonte="SEED"),
    "PAINT_PREP_MIN": dict(label="Preparo de tinta (por cor)", valor=10.0, un="min", fonte="SEED"),
    "MASK_REMOVE_M2_PER_MIN": dict(label="Remoção de máscara/empapelamento", valor=2.0, un="m²/min", fonte="SEED"),
    "VARNISH_M2_PER_MIN": dict(label="Aplicação de verniz", valor=2.0, un="m²/min", fonte="SEED"),
    "TAPE_FLEX_M_PER_MIN": dict(label="Fita amarela em curva", valor=1.5, un="m/min", fonte="SEED"),
    "TAPE_STRAIGHT_M_PER_MIN": dict(label="Fita reta", valor=4.0, un="m/min", fonte="SEED"),
    "CUT_STRAIGHT_CM_PER_MIN": dict(label="Corte manual reto", valor=60.0, un="cm/min", fonte="SEED"),
    "CUT_CURVE_MEDIUM_CM_PER_MIN": dict(label="Corte manual curva média", valor=25.0, un="cm/min", fonte="SEED"),
    "CUT_CURVE_TIGHT_CM_PER_MIN": dict(label="Corte manual curva fechada", valor=10.0, un="cm/min", fonte="SEED"),
    "FINAL_CLEAN_M2_PER_MIN": dict(label="Limpeza final", valor=3.0, un="m²/min", fonte="SEED"),
    "DEGREASE_M2_PER_MIN": dict(label="Desengraxe", valor=1.2, un="m²/min", fonte="ESTIMADO"),
}

LABOR_HOUR_BRL = dict(valor=21.30, un="R$/h", fonte="SEED",
                      label="Custo-hora de mão de obra",
                      nota="média CLT ÷ 220 × 1,65 de encargos — o seed recalcula do banco")

WORKDAY_MINUTES = dict(valor=480.0, un="min/dia", fonte="SEED", label="Jornada útil")

# ------------------------------------------------------------ materiais -----
MATERIAIS = {
    "MARGEM_CORTE_CM": dict(label="Folga entre o corte do plotter e a borda da folha",
                            valor=8.0, un="cm", fonte="DONO",
                            nota="é a caixa física do vinil, não enquadramento visual"),
    "TRANSFER_MASK_WIDTH_CM": dict(label="Largura útil da máscara de transferência",
                                   valor=60.0, un="cm", fonte="SEED"),
    "TRANSFER_REUSE_FACTOR": dict(label="Reuso da máscara de transferência entre peças",
                                  valor=1.2, un="×", fonte="SEED"),
    "TAPE_OVERLAP_PCT": dict(label="Sobreposição/reforço de fita", valor=0.15, un="fração", fonte="SEED"),
    "KRAFT_SHEET_CM": dict(label="Largura da folha de kraft", valor=100.0, un="cm", fonte="SEED",
                           nota="o seed diz 90 cm em `paper_roll_width_cm` e o render usa 100"),
    "CREPE_TAPE_PER_M_PAPER": dict(label="Fita crepe por metro de emenda/borda de papel",
                                   valor=1.0, un="m/m", fonte="SEED"),
}

# --------------------------------------------- sistemas de pintura ----------
# `api/src/scripts/seed-painting-config.ts` — proporções ditas pelo dono,
# rendimento/lote/cura marcados `needsConfirmation: true` no próprio seed.
SISTEMAS = {
    "LACA": dict(label="Laca", demaos=[("GROUND", "LACA", 2), ("COLOR", "LACA", 2)],
                 mix=(2, 0, 1), rendimento=8.0, lote_min=1.0, cura_min=60),
    "ACRILICO": dict(label="Acrílico", demaos=[("GROUND", "LACA", 2), ("COLOR", "ACRILICO", 2)],
                     mix=(3, 1, 1), rendimento=7.0, lote_min=1.0, cura_min=240),
    "POLIESTER": dict(label="Poliéster",
                      demaos=[("GROUND", "LACA", 2), ("COLOR", "POLIESTER", 3), ("CLEAR", "VERNIZ", 1)],
                      mix=(2, 0, 1), rendimento=6.0, lote_min=1.0, cura_min=240),
    "PU": dict(label="Poliuretano (PU)",
               demaos=[("GROUND", "LACA", 2), ("COLOR", "PU", 2), ("CLEAR", "VERNIZ", 1)],
               mix=(3, 1, 1), rendimento=7.0, lote_min=1.0, cura_min=240),
    "VERNIZ": dict(label="Verniz", demaos=[("CLEAR", "VERNIZ", 1)],
                   mix=(3, 1, 1), rendimento=10.0, lote_min=0.5, cura_min=720),
}
SPRAY_LOSS_PCT = dict(valor=0.15, fonte="SEED", label="Perda de pistola")
PREP_LOSS_PCT = dict(valor=0.05, fonte="SEED", label="Perda de preparo")

# ------------------------------------------------------------- doutrina -----
DOUTRINA = {
    "CUT_MM_CONFIRMED": dict(label="Traço acima do qual o dono corta à mão",
                             valor=14.0, un="mm", fonte="DONO",
                             nota="9 marcações, todas 'corto', de 14 a 61 mm. "
                                  "Não há nenhum 'não corto' — o piso está ABAIXO de 14 e sem cota superior"),
    "VERTICAL_DEG": dict(label="Acima disto o traçado é vertical demais para a fita amarela",
                         valor=55.0, un="°", fonte="INVENTADO",
                         nota="a doutrina §4 diz 'falta calibrar o que é muito vertical'; "
                              "55° foi escolhido por mim, sem medição"),
    "CAMPO_DELTA_E": dict(label="ΔE abaixo do qual um tom é o próprio campo", valor=16.0,
                          un="ΔE", fonte="SEED"),
    "CURE_WAIT_MIN": dict(label="Espera de cura para adesivo sobre tinta", valor=180.0,
                          un="min", fonte="SEED"),
}


def taxa(key: str) -> float:
    return float(TAXAS[key]["valor"])


def tinta_litros(area_m2: float, demaos: int, rendimento: float) -> float:
    """Volume de MISTURA PRONTA (V3 §4.1) — não é tinta pura."""
    bruto = area_m2 * demaos / rendimento
    return bruto * (1 + SPRAY_LOSS_PCT["valor"] + PREP_LOSS_PCT["valor"])


def mistura(volume_l: float, mix: tuple[int, int, int]) -> dict[str, float]:
    """Reparte a mistura pronta em base : catalisador : diluente."""
    base, cat, dil = mix
    soma = base + cat + dil
    return {
        "base_l": round(volume_l * base / soma, 3),
        "catalisador_l": round(volume_l * cat / soma, 3),
        "diluente_l": round(volume_l * dil / soma, 3),
    }
