/**
 * A face e a escala.
 *
 * Quem manda na geometria são as medidas do caminhão (`ImplementMeasure`): a
 * altura e a soma das seções. O PDF só diz onde, dentro da página, essa face
 * está desenhada — e daí sai a única constante que interessa, `ptPerCm`.
 */

import { isRectValid, rectArea, rectHeight, rectWidth } from "./geometry";
import type { PageGeometry, Panel, Rect, Scale, VectorObject } from "./types";

export function panelWidthCm(panel: Panel): number {
  return panel.sections.reduce((sum, s) => sum + s.widthCm, 0);
}

/** Divisas entre seções, em cm da face (sem as bordas externas). */
export function sectionEdgesCm(panel: Panel): number[] {
  const out: number[] = [];
  let x = 0;
  for (const s of panel.sections.slice(0, -1)) {
    x += s.widthCm;
    out.push(x);
  }
  return out;
}

export function doorsCm(panel: Panel): { x0: number; x1: number; heightCm: number }[] {
  const out: { x0: number; x1: number; heightCm: number }[] = [];
  let x = 0;
  for (const s of panel.sections) {
    if (s.isDoor) out.push({ x0: x, x1: x + s.widthCm, heightCm: s.doorHeightCm || panel.heightCm });
    x += s.widthCm;
  }
  return out;
}

/** Um caminho é retângulo quando o contorno tem 4 cantos e lados ortogonais. */
function isAxisRectangle(obj: VectorObject, tolerance = 1.5): boolean {
  if (obj.outline.length !== 1) return false;
  const poly = obj.outline[0];
  const pts = poly.length >= 2 &&
    Math.abs(poly[0].x - poly[poly.length - 1].x) < tolerance &&
    Math.abs(poly[0].y - poly[poly.length - 1].y) < tolerance
    ? poly.slice(0, -1)
    : poly;
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > tolerance && Math.abs(a.y - b.y) > tolerance) return false;
  }
  return true;
}

function inkBounds(geometry: PageGeometry): Rect {
  const r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const pageArea = geometry.width * geometry.height;
  for (const o of geometry.objects) {
    if (o.op === "clip") continue;
    if (rectArea(o.bbox) > pageArea * 0.97) continue; // fundo branco da página
    if (o.bbox.x0 < r.x0) r.x0 = o.bbox.x0;
    if (o.bbox.y0 < r.y0) r.y0 = o.bbox.y0;
    if (o.bbox.x1 > r.x1) r.x1 = o.bbox.x1;
    if (o.bbox.y1 > r.y1) r.y1 = o.bbox.y1;
  }
  return isRectValid(r) ? r : { x0: 0, y0: 0, x1: geometry.width, y1: geometry.height };
}

export interface PanelMatch extends Scale {
  /** Como a face foi encontrada — vai para o relatório, o operador precisa saber. */
  from: "rectangle" | "ink-bounds";
  /** Divergência entre a escala medida na largura e na altura. */
  aspectErrorPct: number;
}

/**
 * Acha a face na página. A busca é guiada pela medida real: entre todos os
 * retângulos desenhados, vale o que reproduz a proporção largura/altura do
 * implemento — é ele o contorno da face, e não a moldura da página nem a porta.
 */
export function findPanel(
  geometry: PageGeometry,
  panel: Panel,
  options: { aspectTolerance?: number; minWidthFrac?: number } = {},
): PanelMatch {
  const widthCm = panelWidthCm(panel);
  const targetAspect = widthCm / panel.heightCm;
  const aspectTolerance = options.aspectTolerance ?? 0.06;
  const minWidth = (options.minWidthFrac ?? 0.25) * geometry.width;

  let best: { rect: Rect; err: number } | null = null;
  for (const obj of geometry.objects) {
    if (!isAxisRectangle(obj)) continue;
    const w = rectWidth(obj.bbox);
    const h = rectHeight(obj.bbox);
    if (w < minWidth || h < 8) continue;
    if (w > geometry.width * 0.995 && h > geometry.height * 0.995) continue;
    const err = Math.abs(w / h - targetAspect) / targetAspect;
    if (err > aspectTolerance) continue;
    if (!best || err < best.err - 1e-6 || (Math.abs(err - best.err) < 1e-6 && w > rectWidth(best.rect))) {
      best = { rect: obj.bbox, err };
    }
  }

  const rect = best ? best.rect : inkBounds(geometry);
  const byWidth = rectWidth(rect) / widthCm;
  const byHeight = rectHeight(rect) / panel.heightCm;
  return {
    ptPerCm: byWidth,
    panelPt: rect,
    from: best ? "rectangle" : "ink-bounds",
    aspectErrorPct: Math.abs(byWidth - byHeight) / byWidth * 100,
  };
}

export function toCmX(scale: Scale, xPt: number): number {
  return (xPt - scale.panelPt.x0) / scale.ptPerCm;
}

export function toCmY(scale: Scale, yPt: number): number {
  return (yPt - scale.panelPt.y0) / scale.ptPerCm;
}

export function toPtX(scale: Scale, xCm: number): number {
  return scale.panelPt.x0 + xCm * scale.ptPerCm;
}

export function toPtY(scale: Scale, yCm: number): number {
  return scale.panelPt.y0 + yCm * scale.ptPerCm;
}

export function rectToCm(scale: Scale, r: Rect): Rect {
  return {
    x0: toCmX(scale, r.x0),
    y0: toCmY(scale, r.y0),
    x1: toCmX(scale, r.x1),
    y1: toCmY(scale, r.y1),
  };
}
