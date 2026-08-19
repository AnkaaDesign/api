"""Segmentação de instância (MobileSAM) — o que fecha a silhueta.

Separação por cor não separa OBJETO: três bananas do mesmo amarelo com vinco
suave entre elas são uma mancha só para o k-means. O risco feito à mão contorna
cada uma. Quem resolve isso é segmentação de instância.

Dependências opcionais (`requirements-sam.txt`): torch, torchvision, timm,
mobile_sam. O módulo importa preguiçosamente — sem elas o resto do `lineart`
continua funcionando no modo clássico.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from .params import LineArtParams

CHECKPOINT_URL = "https://huggingface.co/dhkim2810/MobileSAM/resolve/main/mobile_sam.pt"
CHECKPOINT_NAME = "mobile_sam.pt"


def cache_dir() -> Path:
    raw = os.environ.get("PAINTING_ENGINE_CACHE", "~/.cache/painting-engine")
    path = Path(raw).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_checkpoint(explicit: str | None = None) -> Path:
    if explicit:
        path = Path(explicit).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"checkpoint não encontrado: {path}")
        return path
    env = os.environ.get("PAINTING_ENGINE_SAM_CHECKPOINT")
    if env:
        return ensure_checkpoint(env)
    path = cache_dir() / CHECKPOINT_NAME
    if not path.exists():
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(CHECKPOINT_URL, tmp)  # noqa: S310 - URL fixa
        tmp.rename(path)
    return path


def _pick_device():
    """CPU por padrão de propósito: o gerador automático de máscaras monta a
    grade de pontos em float64 e o MPS não converte float64 — em Apple Silicon
    o caminho 'mps' quebra dentro da lib. O TinyViT do MobileSAM roda em CPU em
    tempo aceitável. `--sam-device mps` continua disponível para testar."""
    import torch

    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _generate_masks(rgb: np.ndarray, params: LineArtParams, min_area_px: int) -> list[dict]:
    import torch
    from mobile_sam import SamAutomaticMaskGenerator, sam_model_registry

    checkpoint = ensure_checkpoint(params.sam_checkpoint)
    sam = sam_model_registry["vit_t"](checkpoint=str(checkpoint))
    sam.eval()

    for device in (params.sam_device or _pick_device(), "cpu"):
        try:
            sam.to(device=device)
            generator = SamAutomaticMaskGenerator(
                sam,
                points_per_side=params.sam_points_per_side,
                pred_iou_thresh=params.sam_pred_iou,
                stability_score_thresh=params.sam_stability,
                crop_n_layers=0,
                min_mask_region_area=int(min_area_px),
            )
            with torch.inference_mode():
                return generator.generate(rgb)
        except Exception:  # noqa: BLE001 - qualquer falha de device cai para CPU
            if device == "cpu":
                raise
            continue
    return []


def _cache_key(rgb: np.ndarray, params: LineArtParams) -> str:
    digest = hashlib.sha1(np.ascontiguousarray(rgb).tobytes())  # noqa: S324 - cache
    signature = (
        params.sam_points_per_side,
        params.sam_pred_iou,
        params.sam_stability,
        params.sam_max_coverage,
        params.sam_work_px,
        round(params.min_area_cm2, 3),
    )
    digest.update(repr(signature).encode())
    return digest.hexdigest()[:20]


def segment_instances(
    rgb: np.ndarray,
    params: LineArtParams,
    px_per_cm: float,
    background: np.ndarray | None = None,
) -> np.ndarray:
    """Mapa de instâncias (0 = não atribuído). Máscara menor pintada por último,
    para que um objeto contido dentro de outro fique com id próprio."""
    height, width = rgb.shape[:2]
    min_area_px = max(int(params.min_area_cm2 * (px_per_cm ** 2)), 64)

    cache_path = None
    if params.sam_cache:
        folder = cache_dir() / "instances"
        folder.mkdir(parents=True, exist_ok=True)
        cache_path = folder / f"{_cache_key(rgb, params)}.npy"
        if cache_path.exists():
            cached = np.load(cache_path)
            if cached.shape == (height, width):
                if background is not None:
                    cached = cached.copy()
                    cached[background] = 0
                return cached

    # o SAM reamostra para 1024 de qualquer jeito; segurar a máscara em
    # resolução cheia só encarece o pós-processamento
    scale = min(1.0, params.sam_work_px / max(width, height))
    if scale < 1.0:
        small = np.asarray(
            Image.fromarray(rgb).resize(
                (max(1, int(width * scale)), max(1, int(height * scale))),
                Image.LANCZOS,
            )
        )
        small_min_area = max(int(min_area_px * scale * scale), 32)
    else:
        small, small_min_area = rgb, min_area_px

    masks = _generate_masks(small, params, small_min_area)
    if not masks:
        return np.zeros((height, width), dtype=np.int32)

    small_h, small_w = small.shape[:2]
    total = float(small_h * small_w)
    small_background = None
    if background is not None and scale < 1.0:
        small_background = np.asarray(
            Image.fromarray(background.astype(np.uint8) * 255).resize(
                (small_w, small_h), Image.NEAREST
            )
        ) > 127
    elif background is not None:
        small_background = background
    usable: list[np.ndarray] = []
    for item in masks:
        seg = np.asarray(item["segmentation"], dtype=bool)
        area = float(seg.sum())
        if area < small_min_area:
            continue
        if area / total > params.sam_max_coverage:
            continue  # máscara da cena inteira não é objeto
        if small_background is not None:
            outside = float((seg & small_background).sum()) / max(area, 1.0)
            if outside > 0.75:
                continue  # é o fundo branco
        usable.append(seg)

    if not usable:
        return np.zeros((height, width), dtype=np.int32)

    usable.sort(key=lambda m: -m.sum())
    small_map = np.zeros((small_h, small_w), dtype=np.int32)
    for index, seg in enumerate(usable, start=1):
        small_map[seg] = index

    # sobras (o SAM raramente cobre 100%) herdam a instância mais próxima
    holes = small_map == 0
    if small_background is not None:
        holes &= ~small_background
    if holes.any() and (small_map > 0).any():
        idx = ndi.distance_transform_edt(
            small_map == 0, return_distances=False, return_indices=True
        )
        small_map[holes] = small_map[tuple(i[holes] for i in idx)]

    if small_map.shape != (height, width):
        instance_map = np.asarray(
            Image.fromarray(small_map.astype(np.int32), mode="I").resize(
                (width, height), Image.NEAREST
            ),
            dtype=np.int32,
        )
    else:
        instance_map = small_map

    if cache_path is not None:
        np.save(cache_path, instance_map)

    if background is not None:
        instance_map = instance_map.copy()
        instance_map[background] = 0
    return instance_map
