"""Limiares do gerador de risco. Tudo em unidades REAIS (cm no mural) sempre que
faz sentido — o mesmo parâmetro vale para um mural de 3 m e para um de 30 m."""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any


@dataclass
class LineArtParams:
    # ---- resolução de trabalho -------------------------------------------
    work_width_px: int = 1500        # largura interna do processamento
    pdf_dpi: int = 150               # rasterização de PDF de entrada

    # ---- achatamento (cartoonização antes de posterizar) -----------------
    tv_weight: float = 0.09          # peso do TV denoise; ↑ = mais chapado
    presmooth_cm: float = 0.25       # blur gaussiano em cm reais

    # ---- separação de objetos --------------------------------------------
    instances: bool = True           # MobileSAM; False = só k-means de cor
    sam_checkpoint: str | None = None
    sam_device: str | None = None    # None = mps > cuda > cpu
    sam_points_per_side: int = 32
    sam_pred_iou: float = 0.86
    sam_stability: float = 0.92
    sam_max_coverage: float = 0.80   # máscara acima disso é "a cena", não objeto
    sam_work_px: int = 1024          # o SAM já reamostra p/ 1024 internamente;
                                     # o custo extra seria só pós-processar
                                     # máscara em resolução cheia
    sam_cache: bool = True           # mapa de instâncias em disco: ajustar traço
                                     # não deve pagar a inferência de novo

    # ---- posterização ----------------------------------------------------
    color_levels: int = 7            # k-means CIELAB (fallback sem instâncias)
    tone_levels: int = 3             # bandas de L* DENTRO de cada objeto
    tone_smooth_frac: float = 0.10   # sigma do borrão de tom = fração de √área do
                                     # objeto. É o que troca ilha de curva de
                                     # nível por varredura longa de sombra
    background_is_white: bool = True # fundo claro conectado à borda vira RESERVA

    label_smooth_cm: float = 3.0     # raio do voto modal que alisa as fronteiras
    label_smooth_iters: int = 2

    # ---- relevância (o que o pintor consegue de fato marcar) --------------
    min_area_cm2: float = 400.0      # região menor que isso é absorvida
    min_length_cm: float = 25.0      # traço menor que isso é descartado

    # ---- duro x suave ----------------------------------------------------
    hard_percentile: float = 55.0    # percentil do gradiente que separa
                                     # CONTORNO (sólido) de SOMBRA (tracejado)
    hardness_sample_cm: float = 0.6  # raio de amostragem do gradiente
    texture_edge_percentile: float = 55.0  # dureza mínima para uma fronteira
                                           # DENTRO de área texturada sobreviver
    shade_relax: float = 2.5               # o quanto a linha de sombra pode ser
                                           # mais lisa que um contorno

    # ---- contorno vindo de aresta (complementa a fronteira de região) -----
    edges: bool = True
    edge_sigma_cm: float = 1.2
    edge_chroma_weight: float = 0.35       # peso do croma no canal de aresta
    edge_high_percentile: float = 96.0     # histerese do Canny, em percentil do
    edge_low_percentile: float = 88.0      # gradiente dentro do desenho
    edge_min_length_cm: float = 45.0       # aresta curta não é traço, é ruído
    edge_texture_margin_cm: float = 4.0    # erosão da máscara texturada: mantém
                                           # a BORDA da folha, corta as nervuras
    edge_link_gap_cm: float = 8.0          # vão máximo para emendar duas
    edge_link_angle_deg: float = 45.0      # cadeias em uma só
    edge_dedupe_cm: float = 4.0            # raio de "já existe traço aqui"
    edge_dedupe_fraction: float = 0.6
    merge_radius_cm: float = 6.0              # raio da fusão final: duas
                                               # curvas mais perto que isso
                                               # são a MESMA feição
    merge_max_overlap: float = 0.45
    shade_under_contour_fraction: float = 0.35  # tracejado coberto por
                                               # contorno nessa fração some
    valley_sigmas_cm: tuple[float, ...] = (1.0, 2.5)
                                           # sigma ~ metade da largura do
                                           # vinco que se quer pegar
    valley_percentile: float = 98.0        # quão seletivo é o detector de vinco
    valley_suppress_cm: float = 3.0        # raio em que a linha de vale apaga os
                                           # degraus laterais (evita traço duplo)

    # ---- simplificação / Bézier ------------------------------------------
    resample_cm: float = 0.5
    simplify_cm: float = 0.6         # Douglas-Peucker
    bezier_error_cm: float = 1.2     # tolerância do ajuste de Bézier
    corner_angle_deg: float = 55.0   # acima disso vira canto (quebra a curva)

    # ---- hachura de textura (nervuras de folha, madeira, pelo) ------------
    hatch: bool = True
    hatch_pitch_cm: float = 6.0      # espaçamento entre traços
    hatch_coherence_min: float = 0.15     # coerência mínima p/ continuar o traço
    hatch_seed_score: float = 0.12        # score (coerência x energia) p/ semear
    hatch_region_coherence: float = 0.10  # score médio da região p/ ser "texturada"
    hatch_min_length_cm: float = 10.0
    hatch_max_length_cm: float = 600.0
    hatch_turn_cos: float = 0.6       # curva máxima por passo; apertado
                                     # demais pica a nervura em pedaços
    hatch_tone_gate: float = 0.85    # só hachura onde é mais escuro que isso
                                     # (fração do L* da região, 1.0 = tudo)

    # ---- grade de marcação -----------------------------------------------
    grid_cm: float = 100.0           # 0 desliga
    grid_labels: bool = True

    # ---- traço (aparência no SVG, em mm no mural) -------------------------
    stroke_mm: float = 6.0
    grid_stroke_mm: float = 2.0
    dash_on_mm: float = 45.0
    dash_off_mm: float = 30.0

    # ---- referência ------------------------------------------------------
    embed_reference: bool = True
    reference_opacity: float = 0.35
    reference_max_px: int = 1400
    preview_over_art: bool = True    # PNG de conferência sobre a arte esmaecida

    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_overrides(cls, overrides: dict[str, Any] | None) -> "LineArtParams":
        params = cls()
        if not overrides:
            return params
        known = {f.name for f in fields(cls)} - {"extra"}
        for key, value in overrides.items():
            if key in known:
                setattr(params, key, value)
            else:
                params.extra[key] = value
        return params
