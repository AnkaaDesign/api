"""Renderiza os estágios visuais da análise — as imagens que o app mostra.

O pintor não lê JSON. Ele precisa VER: onde é a máscara, qual cor entra em cada
sessão, quais fronteiras são tinta-tinta (dão trabalho) e quais são tinta-fundo
(não dão). Cada estágio aqui vira uma imagem de um passo do wizard.

Estágios:
  01_original      referência
  02_quantizado    cores chapadas (o que o motor realmente enxerga)
  03_linhas        contornos em P&B grosso — a vista de MÁSCARA
  04_elementos     linhas + caixas dos elementos reconhecidos pela IA
  05_fronteiras    T-T (vermelho, dá trabalho) x T-F (verde, não dá)
  06_sessao_N      por sessão: o que já está pintado, o que está mascarado,
                   e qual cor entra agora

Uso:
    .venv/bin/python probe/render.py <imagem> --out passos/
    .venv/bin/python probe/render.py <imagem> --elements elements.json --out passos/
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage import color as skcolor
from skimage import morphology, segmentation
from skimage.filters import rank

sys.path.insert(0, str(Path(__file__).parent))
from common import load  # noqa: E402

# Trabalhar em resolução plena não muda a decisão e multiplica o tempo por 30.
WORK_MAX = 2200
LINE_WIDTH = 3


def quantize(img: Image.Image, n_colors: int = 8) -> tuple[np.ndarray, np.ndarray]:
    """Reduz a arte a cores chapadas. Devolve (rótulos, paleta RGB).

    Em CIELAB, não em RGB: distância em RGB não corresponde ao que o olho (e o
    pintor) chama de "duas cores diferentes", e é isso que decide se há uma
    fronteira para mascarar.
    """
    arr = np.asarray(img, dtype=np.float64) / 255.0
    lab = skcolor.rgb2lab(arr)
    h, w, _ = lab.shape
    flat = lab.reshape(-1, 3)

    # k-means simples com init determinístico (sem sklearn, sem semente aleatória:
    # a mesma arte tem que dar o mesmo resultado em toda execução).
    idx = np.linspace(0, len(flat) - 1, n_colors).astype(int)
    centers = flat[np.argsort(flat[:, 0])][idx].copy()
    for _ in range(25):
        d = ((flat[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels = d.argmin(axis=1)
        for k in range(n_colors):
            sel = labels == k
            if sel.any():
                centers[k] = flat[sel].mean(axis=0)

    palette = (skcolor.lab2rgb(centers.reshape(1, -1, 3)).reshape(-1, 3) * 255).astype(np.uint8)
    return declutter(labels.reshape(h, w)), palette


def declutter(labels: np.ndarray, radius: int = 3) -> np.ndarray:
    """Voto modal para matar as faixas de antialias.

    Sem isto, entre uma letra preta e a chapa branca sobra uma faixa
    intermediária de 1-3 px que o k-means promove a cor própria. A letra deixa
    de encostar no fundo e TODA fronteira vira tinta-tinta — foi exatamente o
    que apareceu no primeiro render da AAN: quase tudo vermelho, inclusive
    letras isoladas sobre chapa branca.

    Classificar T-T errado inverte a estratégia de produção inteira: o motor
    orçaria mascaramento onde bastava pintar contra a chapa.
    """
    footprint = morphology.disk(radius)
    return rank.modal(labels.astype(np.uint8), footprint).astype(labels.dtype)


def is_background(palette: np.ndarray, labels: np.ndarray) -> int:
    """Índice da cor de fundo: a mais clara entre as que dominam a área.

    Branco nunca é tinta — é chapa preservada. Acertar isso é o que separa
    "reserva" de "mais uma cor para orçar".
    """
    counts = np.bincount(labels.ravel(), minlength=len(palette))
    common = np.argsort(counts)[::-1][:3]
    lightness = palette[common].astype(int).sum(axis=1)
    return int(common[lightness.argmax()])


def background_labels(palette: np.ndarray, labels: np.ndarray) -> set[int]:
    """TODOS os rótulos que são chapa, não só o dominante.

    Um único índice não basta: o quantizador rotineiramente parte o branco em
    dois tons quase idênticos, e o segundo passava a contar como tinta. Efeito
    medido: elementos cercados de branco saíam como `sobre: TINTA`, exatamente
    o que a doutrina proíbe ("branco nunca é tinta").

    São chapa: o fundo dominante, tudo tão claro quanto ele, e tudo a um ΔE
    curto dele.
    A chapa NUNCA é #FFFFFF de verdade — mockups usam cinzas de apresentação
    (#ECECEC, #F0F0F0) e brancos levemente quentes. Por isso o teste é
    RELATIVO ao fundo daquela arte, nunca um valor absoluto: é chapa o que for
    tão claro quanto o fundo (ou mais) e continuar neutro.
    """
    bg = is_background(palette, labels)
    lab = skcolor.rgb2lab(palette.reshape(1, -1, 3).astype(np.float64) / 255.0)[0]
    L_bg = lab[bg][0]
    out = {bg}
    for k in range(len(palette)):
        L, a, b = lab[k]
        chroma = math.hypot(a, b)
        if L >= L_bg - 8 and chroma < 12:             # tão claro quanto o fundo, e neutro
            out.add(k)
        elif np.linalg.norm(lab[k] - lab[bg]) < 12:   # mesmo material, tom de apresentação
            out.add(k)
    return out


def line_art(labels: np.ndarray) -> Image.Image:
    """Contornos pretos e grossos sobre branco — a vista de máscara."""
    edges = segmentation.find_boundaries(labels, mode="outer")
    edges = morphology.dilation(edges, morphology.footprint_rectangle((LINE_WIDTH, LINE_WIDTH)))
    out = np.where(edges, 0, 255).astype(np.uint8)
    return Image.fromarray(out, mode="L").convert("RGB")


def boundary_map(labels: np.ndarray, bg: int) -> Image.Image:
    """Pinta cada fronteira pelo tipo. Vermelho = T-T, verde = T-F.

    Só o vermelho gera mascaramento: são duas cores que precisam ser separadas
    no tempo (pinta uma, cura, mascara, pinta a outra). O verde encosta na chapa
    e não precisa de nada.
    """
    h, w = labels.shape
    canvas = np.full((h, w, 3), 255, dtype=np.uint8)

    # Um pixel de fronteira é T-T se NENHUM dos lados é o fundo.
    edges = segmentation.find_boundaries(labels, mode="thick")
    ys, xs = np.nonzero(edges)
    tt = np.zeros((h, w), dtype=bool)
    tf = np.zeros((h, w), dtype=bool)
    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
        ny, nx = np.clip(ys + dy, 0, h - 1), np.clip(xs + dx, 0, w - 1)
        diff = labels[ys, xs] != labels[ny, nx]
        touches_bg = (labels[ys, xs] == bg) | (labels[ny, nx] == bg)
        tt[ys[diff & ~touches_bg], xs[diff & ~touches_bg]] = True
        tf[ys[diff & touches_bg], xs[diff & touches_bg]] = True

    # A borda da imagem não é uma fronteira de tinta — é o fim do arquivo.
    for m in (tt, tf):
        m[:2, :] = m[-2:, :] = m[:, :2] = m[:, -2:] = False

    tt = morphology.dilation(tt, morphology.footprint_rectangle((LINE_WIDTH, LINE_WIDTH)))
    tf = morphology.dilation(tf, morphology.footprint_rectangle((LINE_WIDTH, LINE_WIDTH)))
    canvas[tf] = (40, 160, 60)
    canvas[tt] = (220, 30, 30)   # T-T por cima: é o que importa ver
    return Image.fromarray(canvas)


def coverage_order(labels: np.ndarray, palette: np.ndarray, bg: int) -> list[int]:
    """Ordem de pintura: MENOR cobertura primeiro (doutrina §2).

    Pinta-se a cor de menor área, mascara-se ela, e a de maior área vem por
    cima — mascarar a área menor gasta menos máscara e menos corte.
    """
    counts = np.bincount(labels.ravel(), minlength=len(palette))
    order = [k for k in np.argsort(counts) if k != bg and counts[k] > labels.size * 0.001]
    return [int(k) for k in order]


def session_view(labels: np.ndarray, palette: np.ndarray, bg: int,
                 order: list[int], step: int) -> Image.Image:
    """Estado do implemento na sessão `step`.

    cinza  = mascarado (já pintado, protegido)
    cor    = entrando agora
    branco = chapa ainda exposta
    """
    h, w = labels.shape
    canvas = np.full((h, w, 3), 245, dtype=np.uint8)
    for k in order[:step]:
        canvas[labels == k] = (170, 170, 170)
    if step < len(order):
        canvas[labels == order[step]] = palette[order[step]]
    return Image.fromarray(canvas)


def draw_elements(base: Image.Image, elements: list[dict], scale: float) -> Image.Image:
    """Sobrepõe as caixas que a IA devolveu, com rótulo legível."""
    out = base.copy()
    d = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
    except OSError:
        font = ImageFont.load_default()

    for el in elements:
        box = el.get("bbox_px")
        if not box or len(box) != 4:
            continue
        x1, y1, x2, y2 = [int(v * scale) for v in box]
        d.rectangle([x1, y1, x2, y2], outline=(220, 30, 30), width=3)
        label = el.get("kind", "?")
        tw = d.textlength(label, font=font)
        d.rectangle([x1, max(0, y1 - 28), x1 + tw + 10, y1], fill=(220, 30, 30))
        d.text((x1 + 5, max(0, y1 - 26)), label, fill=(255, 255, 255), font=font)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", default="passos")
    ap.add_argument("--elements", help="JSON do detect_qwen.py")
    ap.add_argument("--colors", type=int, default=8)
    ap.add_argument("--sessions", type=int, default=4, help="máximo de sessões a renderizar")
    args = ap.parse_args()

    original = load(args.image)
    work = original.copy()
    work.thumbnail((WORK_MAX, WORK_MAX), Image.LANCZOS)
    scale = work.size[0] / original.size[0]

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"[{original.size[0]}x{original.size[1]} -> trabalho {work.size[0]}x{work.size[1]}]",
          file=sys.stderr)

    work.save(outdir / "01_original.jpg", quality=90)

    labels, palette = quantize(work, args.colors)
    bg = is_background(palette, labels)
    Image.fromarray(palette[labels]).save(outdir / "02_quantizado.png")

    lines = line_art(labels)
    lines.save(outdir / "03_linhas.png")

    if args.elements:
        els = json.loads(Path(args.elements).read_text()).get("elements", [])
        draw_elements(lines, els, scale).save(outdir / "04_elementos.png")
        print(f"  04_elementos: {len(els)} caixas", file=sys.stderr)

    boundary_map(labels, bg).save(outdir / "05_fronteiras.png")

    order = coverage_order(labels, palette, bg)
    for step in range(min(args.sessions, len(order))):
        session_view(labels, palette, bg, order, step).save(outdir / f"06_sessao_{step + 1}.png")

    counts = np.bincount(labels.ravel(), minlength=len(palette))
    print(f"  fundo: cor #{bg} ({counts[bg] / labels.size:.0%} da área)", file=sys.stderr)
    print(f"  ordem de pintura (menor cobertura primeiro): "
          f"{[f'#{k} {counts[k]/labels.size:.1%}' for k in order]}", file=sys.stderr)
    print(f"\n{len(list(outdir.iterdir()))} imagens em {outdir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
