/**
 * Escreve as cotas dentro do próprio PDF do layout, sem tocar na arte.
 *
 * O arquivo continua sendo o que o projetista entregou; a cotagem entra como
 * desenho por cima, na mesma linguagem gráfica que o aplicador já lê. Quando as
 * linhas não cabem na página, a MediaBox cresce — a arte não se move.
 */

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { panelWidthCm, doorsCm } from "./panel";
import { DIM_COLOR, PANEL_COLOR, STYLE_CM } from "./style";
import type { Dimension, Panel, Scale } from "./types";

export interface AnnotateOptions {
  /** desenha o contorno da face e as divisas de porta */
  drawPanel?: boolean;
  /**
   * Cor da cota, em 0..1. O padrão é o azul da casa; passar outra serve para
   * conferência, quando o arquivo já traz cota do projetista e as duas
   * precisam se distinguir na mesma folha.
   */
  color?: { r: number; g: number; b: number };
}

interface Frame {
  /** cm da face → pt do PDF (origem embaixo à esquerda, como o pdf-lib quer) */
  x(cm: number): number;
  y(cm: number): number;
  d(cm: number): number;
}

function makeFrame(scale: Scale, pageHeight: number): Frame {
  return {
    x: (cm) => scale.panelPt.x0 + cm * scale.ptPerCm,
    y: (cm) => pageHeight - (scale.panelPt.y0 + cm * scale.ptPerCm),
    d: (cm) => cm * scale.ptPerCm,
  };
}

function drawArrow(
  page: PDFPage,
  tipX: number,
  tipY: number,
  angle: number,
  frame: Frame,
  color: { r: number; g: number; b: number },
): void {
  const len = frame.d(STYLE_CM.arrowLength);
  const half = frame.d(STYLE_CM.arrowHalfWidth);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const bx = tipX - ux * len;
  const by = tipY - uy * len;
  const px = -uy;
  const py = ux;
  page.drawSvgPath(
    `M ${tipX} ${-tipY} L ${bx + px * half} ${-(by + py * half)} L ${bx - px * half} ${-(by - py * half)} Z`,
    { color: rgb(color.r, color.g, color.b), borderWidth: 0, x: 0, y: 0 },
  );
}

function line(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  color: { r: number; g: number; b: number } = DIM_COLOR,
): void {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: w,
    color: rgb(color.r, color.g, color.b),
  });
}

/**
 * Desenha uma cota: extensão do item até a linha, linha, setas e rótulo.
 *
 * A extensão é o que amarra o número à peça — ela sai de `tieCm`, que está
 * encostado no item, e vai até 2,5 cm além da linha de cota (a sobra é a mesma
 * que os projetistas usam, medida em 3.394 extensões).
 */
function drawDimension(
  page: PDFPage,
  d: Dimension,
  frame: Frame,
  font: PDFFont,
  color: { r: number; g: number; b: number },
): void {
  const w = frame.d(STYLE_CM.stroke);
  const fontSize = frame.d(STYLE_CM.fontSize);
  const label = String(d.valueCm);
  const textWidth = font.widthOfTextAtSize(label, fontSize);
  const outward = d.offsetCm >= d.tieCm ? 1 : -1;
  // seta para dentro ou para fora é decisão do VALOR, não do tamanho na tela
  const arrowsInside = d.valueCm >= STYLE_CM.arrowsOutsideBelowCm;
  const overshoot = outward * STYLE_CM.extensionOvershoot;

  if (d.axis === "H") {
    const y = frame.y(d.offsetCm);
    const xa = frame.x(d.aCm);
    const xb = frame.x(d.bCm);
    if (d.side !== "inside") {
      const tie = frame.y(d.tieCm);
      const tip = frame.y(d.offsetCm + overshoot);
      line(page, xa, tie, xa, tip, w, color);
      line(page, xb, tie, xb, tip, w, color);
    }
    line(page, xa, y, xb, y, w, color);
    drawArrow(page, xa, y, arrowsInside ? Math.PI : 0, frame, color);
    drawArrow(page, xb, y, arrowsInside ? 0 : Math.PI, frame, color);
    // rótulo do lado de fora: por cima da linha quando ela está acima do item
    const gap = frame.d(STYLE_CM.labelGap);
    page.drawText(label, {
      x: (xa + xb) / 2 - textWidth / 2,
      y: outward < 0 ? y + gap : y - gap - fontSize,
      size: fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
    });
    return;
  }

  const x = frame.x(d.offsetCm);
  const ya = frame.y(d.aCm);
  const yb = frame.y(d.bCm);
  if (d.side !== "inside") {
    const tie = frame.x(d.tieCm);
    const tip = frame.x(d.offsetCm + overshoot);
    line(page, tie, ya, tip, ya, w, color);
    line(page, tie, yb, tip, yb, w, color);
  }
  line(page, x, ya, x, yb, w, color);
  drawArrow(page, x, ya, arrowsInside ? Math.PI / 2 : -Math.PI / 2, frame, color);
  drawArrow(page, x, yb, arrowsInside ? -Math.PI / 2 : Math.PI / 2, frame, color);
  const gap = frame.d(STYLE_CM.labelGap);
  page.drawText(label, {
    x: outward > 0 ? x + gap + fontSize * 0.34 : x - gap - fontSize * 0.34,
    y: (ya + yb) / 2 - textWidth / 2,
    size: fontSize,
    font,
    rotate: degrees(90),
    color: rgb(color.r, color.g, color.b),
  });
}

/** Limites em pt que o desenho cotado precisa ocupar, para crescer a MediaBox. */
function requiredBox(dims: Dimension[], panel: Panel, frame: Frame, pad: number) {
  const widthCm = panelWidthCm(panel);
  let minX = frame.x(0);
  let maxX = frame.x(widthCm);
  let minY = frame.y(panel.heightCm);
  let maxY = frame.y(0);
  for (const d of dims) {
    if (d.axis === "H") {
      const y = frame.y(d.offsetCm);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    } else {
      const x = frame.x(d.offsetCm);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

/** Uma cota com a face de onde veio: um arquivo traz mais de uma. */
export interface AnnotateEntry {
  dimension: Dimension;
  panel: Panel;
  scale: Scale;
}

export async function annotatePdf(
  source: ArrayBuffer | Uint8Array,
  entries: AnnotateEntry[],
  options: AnnotateOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source);
  const page = doc.getPage(0);
  const { height: pageHeight } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const color = options.color ?? DIM_COLOR;

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const drawnPanels = new Set<Scale>();
  for (const entry of entries) {
    const frame = makeFrame(entry.scale, pageHeight);
    if (options.drawPanel && !drawnPanels.has(entry.scale)) {
      drawnPanels.add(entry.scale);
      const widthCm = panelWidthCm(entry.panel);
      page.drawRectangle({
        x: frame.x(0),
        y: frame.y(entry.panel.heightCm),
        width: frame.d(widthCm),
        height: frame.d(entry.panel.heightCm),
        borderColor: rgb(PANEL_COLOR.r, PANEL_COLOR.g, PANEL_COLOR.b),
        borderWidth: frame.d(STYLE_CM.stroke),
      });
      for (const door of doorsCm(entry.panel)) {
        for (const x of [door.x0, door.x1]) {
          line(
            page, frame.x(x), frame.y(entry.panel.heightCm - door.heightCm),
            frame.x(x), frame.y(entry.panel.heightCm), frame.d(STYLE_CM.stroke), PANEL_COLOR,
          );
        }
      }
    }
    drawDimension(page, entry.dimension, frame, font, color);
    const box = requiredBox([entry.dimension], entry.panel, frame, frame.d(STYLE_CM.fontSize * 2));
    bounds.minX = Math.min(bounds.minX, box.minX);
    bounds.minY = Math.min(bounds.minY, box.minY);
    bounds.maxX = Math.max(bounds.maxX, box.maxX);
    bounds.maxY = Math.max(bounds.maxY, box.maxY);
  }

  if (Number.isFinite(bounds.minX)) {
    const media = page.getMediaBox();
    const x0 = Math.min(media.x, bounds.minX);
    const y0 = Math.min(media.y, bounds.minY);
    const x1 = Math.max(media.x + media.width, bounds.maxX);
    const y1 = Math.max(media.y + media.height, bounds.maxY);
    if (x0 < media.x || y0 < media.y || x1 > media.x + media.width || y1 > media.y + media.height) {
      page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
    }
  }

  return doc.save();
}
