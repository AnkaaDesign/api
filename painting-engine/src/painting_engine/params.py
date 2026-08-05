"""Engine parameters.

Every threshold that shapes a production decision lives here so the API layer
can override any of them per run (rules-as-data). Defaults mirror
api/PAINTING_COST_ENGINE_PLAN.md §3/§6.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class EngineParams:
    # --- working resolution -------------------------------------------------
    max_work_px: int = 3600           # longest side used for segmentation
    cluster_sample_px: int = 1200     # longest side used for k-means fitting

    # --- quantization -------------------------------------------------------
    max_colors: int = 24              # cap for k-means centers
    min_peak_pct: float = 0.002       # histogram peak must hold >=0.2% of pixels
    merge_delta_e: float = 3.0        # merge centers closer than this (CIE76)
                                      # 6.0 nunca disparava: a semeadura antiga
                                      # impunha piso de 10.0 entre centros.
    min_region_cm2: float = 0.5       # regions smaller than this are absorbed

    # --- semeadura: resolver tons próximos sem fabricar tons em rampas ------
    seed_bin_lab: float = 2.0         # passo do histograma LAB (era 5.0 fixo)
    seed_min_delta_e: float = 3.0     # raio de exclusão entre sementes
    seed_flat_grad_max: float = 1.0   # ΔE/px: só interiores chapados semeiam
    seed_min_peak_pct: float = 0.0008 # massa mínima de um bin para virar semente

    # --- pureza modal: separa tinta chapada de rampa de degradê -------------
    gradient_step_delta_e: float = 12.0  # passo entre tons de uma rampa:
                                      # o pintor bate ~3 tons, não 6
    flat_modal_min: float = 0.35      # abaixo disto o cluster é rampa
    flat_modal_sample_px: int = 3_000_000  # amostra na resolução ORIGINAL
    aa_uncertain_delta_e: float = 14.0  # px farther than this from own center -> modal vote

    # --- background ---------------------------------------------------------
    white_l_min: float = 85.0         # LAB L* at/above which a color can be "white plate"
                                      # (mockups never ship pure white — off-whites count)
    white_chroma_max: float = 10.0    # sqrt(a^2+b^2) below which color is neutral
    general_paint_pct: float = 0.80   # dominant color coverage that triggers general paint
    ambiguous_delta_e: float = 10.0   # bg within this ΔE of pure white -> human flag

    # --- keylines -----------------------------------------------------------
    keyline_max_px_original: int = 5  # thin background slivers up to this many px (original res)
    keyline_min_len_cm: float = 4.0   # shorter slivers are noise

    # --- photographic zones -------------------------------------------------
    photo_tile_px: int = 24           # entropy evaluated on tiles of this size (work res)
    photo_color_count: int = 17       # distinct quantized colors in a tile to call it photographic
    photo_min_area_cm2: float = 1500.0  # zones below this are treated as normal regions
    # v2 phase A (tile gate): tile entropy only counts when the tile also holds
    # a minimum share of *soft* L* gradients (continuous tone signature). Hard
    # AA steps between few flat colors no longer qualify.
    photo_grad_soft_min_l: float = 0.8   # L*/px; below = flat interior
    photo_grad_hard_min_l: float = 12.0  # L*/px; at/above = vector edge step (1-2 px AA)
    photo_soft_pct_min: float = 0.20     # min fraction of SOFT px for a tile to count
    # v2 phase B (zone verification / vector rescue): a candidate zone is
    # demoted to normal vector flow when ALL three hold.
    photo_rescue_max_colors: int = 8         # <= real colors after local quantization
    photo_rescue_max_residual_pct: float = 0.15  # <= unexplained (ΔE>aa_uncertain) sample share
    photo_rescue_min_hard_edge: float = 0.5      # >= HARD/(HARD+SOFT) inside the zone
    photo_zone_color_min_pct: float = 0.03   # center share to count as a "real color"
    photo_verify_sample_px: int = 20_000     # sample cap for the local quantization

    # --- region classification ---------------------------------------------
    flat_std_delta_e: float = 5.0     # LAB std below this -> CHAPADA
    gradient_fit_r2: float = 0.75     # linear/radial L* fit above this -> DEGRADE
    micro_stroke_mm: float = 8.0      # min stroke below this -> MICRO
    micro_letter_cm: float = 6.0      # bbox height below this for text-like -> MICRO
    texture_component_count: int = 30 # many same-color islands -> TEXTURA
    texture_median_cm2: float = 25.0  # ...each individually small

    # --- boundary curvature (radius thresholds in cm) -----------------------
    curve_resample_cm: float = 2.0
    curve_r_suave_cm: float = 60.0
    curve_r_media_cm: float = 25.0
    curve_r_fechada_cm: float = 8.0
    straight_max_deg_per_step: float = 2.0
    corner_min_deg: float = 45.0

    # --- adhesive banding ---------------------------------------------------
    adhesive_widths_cm: list[float] = field(
        default_factory=lambda: [50, 60, 70, 80, 90, 100, 110, 120]
    )
    adhesive_margin_cm: float = 2.0   # bleed margin around elements
    transfer_mask_width_cm: float = 60.0
    adhesive_band_overlap_cm: float = 1.0   # stacked bands overlap at the seam

    # --- layout stage (v2: bands per strip + paper + windows) ---------------
    layout_strip_gap_cm: float = 10.0     # vertical gaps below this merge strips
    layout_segment_gap_cm: float = 40.0   # horizontal gaps above this split band segments
    adhesive_min_segment_cm: float = 20.0  # narrower segments are widened to this
    adhesive_max_panel_m: float = 1.5     # longer segments need roll splices
    paper_roll_width_cm: float = 90.0     # kraft roll width; panels obey min(w,h) <= this
    paper_protect_radius_cm: float = 50.0  # overspray halo protected around the bands
    paper_min_panel_cm: float = 10.0      # roll-split remainders below this equalize
    layout_rotated_bands: bool = False    # ROTATED strip mode (stub; TODO full support)
    layout_skew_min_deg: float = 5.0      # skew below this is treated as axis-aligned
    rotated_band_min_saving_pct: float = 0.25  # rotation must save at least this to engage

    # --- alerts -------------------------------------------------------------
    edge_crop_min_cm: float = 10.0    # non-bg content touching image border
    low_delta_e_pair: float = 8.0     # two palette colors too close -> alert

    seed: int = 1337

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "EngineParams":
        params = cls()
        if not data:
            return params
        for key, value in data.items():
            if hasattr(params, key) and value is not None:
                setattr(params, key, value)
        return params

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
