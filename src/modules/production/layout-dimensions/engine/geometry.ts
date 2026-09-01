/**
 * Leitura da geometria vetorial de uma página de PDF.
 *
 * O layout que o projetista entrega é vetorial: cada adesivo é um caminho, e o
 * contorno da face é um retângulo. Ler os caminhos dá o extremo EXATO de cada
 * peça — nada de rasterizar e caçar pixel, que erra na borda e engasga em
 * arquivo de 15 metros.
 *
 * Coordenadas: tudo sai em pt da página com origem no canto superior esquerdo e
 * y para baixo, que é como o visualizador desenha. A composição é
 * `viewport.transform ∘ pilha de CTM`.
 */

import type { Matrix, PageGeometry, Pt, Rect, RGB, VectorObject } from "./types";

/** Códigos de operador do pdf.js que interessam (estáveis desde a v3). */
const OP = {
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeColorN: 54,
  setFillColorN: 55,
  shadingFill: 62,
  setLineWidth: 2,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
  constructPath: 91,
} as const;

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Escala média da matriz — serve para converter espessura de traço. */
function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

export function emptyRect(): Rect {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function growRect(r: Rect, p: Pt): void {
  if (p.x < r.x0) r.x0 = p.x;
  if (p.y < r.y0) r.y0 = p.y;
  if (p.x > r.x1) r.x1 = p.x;
  if (p.y > r.y1) r.y1 = p.y;
}

export function isRectValid(r: Rect): boolean {
  return r.x1 >= r.x0 && r.y1 >= r.y0;
}

export function rectWidth(r: Rect): number {
  return r.x1 - r.x0;
}

export function rectHeight(r: Rect): number {
  return r.y1 - r.y0;
}

export function rectArea(r: Rect): number {
  return Math.max(0, rectWidth(r)) * Math.max(0, rectHeight(r));
}

/**
 * Achata um cúbico em segmentos de reta. O passo é escolhido pelo tamanho da
 * corda: curva pequena vira 4 pedaços, curva de metros vira 24 — o suficiente
 * para o extremo não escorregar mais que décimo de milímetro.
 */
function flattenCubic(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt): void {
  const chord =
    Math.hypot(p3.x - p0.x, p3.y - p0.y) +
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const steps = Math.min(24, Math.max(4, Math.ceil(chord / 6)));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

/** Decodifica os segmentos empacotados que o pdf.js entrega em `constructPath`. */
function decodePath(segments: ArrayLike<number>[], ctm: Matrix): Pt[][] {
  const polys: Pt[][] = [];
  let current: Pt[] = [];
  let cursor: Pt = { x: 0, y: 0 };
  const push = (p: Pt) => {
    current.push(p);
    cursor = p;
  };
  const close = () => {
    if (current.length > 1) polys.push(current);
    current = [];
  };
  for (const seg of segments) {
    let i = 0;
    while (i < seg.length) {
      const cmd = seg[i];
      if (cmd === 0) {
        close();
        push(apply(ctm, seg[i + 1], seg[i + 2]));
        i += 3;
      } else if (cmd === 1) {
        push(apply(ctm, seg[i + 1], seg[i + 2]));
        i += 3;
      } else if (cmd === 2) {
        const p1 = apply(ctm, seg[i + 1], seg[i + 2]);
        const p2 = apply(ctm, seg[i + 3], seg[i + 4]);
        const p3 = apply(ctm, seg[i + 5], seg[i + 6]);
        flattenCubic(current, cursor, p1, p2, p3);
        cursor = p3;
        i += 7;
      } else if (cmd === 3) {
        if (current.length > 1) {
          current.push({ ...current[0] });
          polys.push(current);
          current = [];
        } else {
          current = [];
        }
        i += 1;
      } else {
        i += 1; // operador desconhecido: pula sem quebrar o resto
      }
    }
  }
  close();
  return polys;
}

/**
 * O pdf.js normaliza a cor para string CSS (`"#rrggbb"`) na lista de
 * operadores; versões mais antigas entregavam a tripla ou o inteiro empacotado.
 * Aceitar as três formas evita depender da versão exata do pacote.
 */
function toRGB(args: unknown): RGB | null {
  if (typeof args === "string") {
    const hex = args.trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
    }
    const m = hex.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(",").map((v) => Number(v.trim()));
      if (parts.length >= 3 && parts.every((v) => Number.isFinite(v))) {
        return [Math.round(parts[0]), Math.round(parts[1]), Math.round(parts[2])];
      }
    }
    return null;
  }
  if (typeof args === "number") {
    return [(args >> 16) & 0xff, (args >> 8) & 0xff, args & 0xff];
  }
  if (Array.isArray(args) && args.length >= 3) {
    const [r, g, b] = args as number[];
    const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1;
    return [Math.round(r * scale), Math.round(g * scale), Math.round(b * scale)];
  }
  return null;
}

interface PageLike {
  getViewport(params: { scale: number; rotation?: number }): {
    width: number;
    height: number;
    transform: number[];
  };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  /** pdf.js object stores — where shading pattern IRs live after getOperatorList. */
  objs?: { get(id: string): unknown };
  commonObjs?: { get(id: string): unknown };
}

/** pdf.js shading IR: ["RadialAxial", "axial"|"radial", bbox, colorStops, p0, p1, r0, r1]. */
type ShadingIR = [string, string, unknown, [number, string][], [number, number], [number, number], number | null, number | null];

/** Average of the shading's color stops — one representative flat color. */
function averageStopColor(stops: [number, string][]): RGB | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const stop of stops ?? []) {
    const rgb = toRGB(stop?.[1]);
    if (rgb) {
      r += rgb[0];
      g += rgb[1];
      b += rgb[2];
      n += 1;
    }
  }
  return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}

/**
 * Keep the part of a polygon where `f(p) >= 0` (Sutherland–Hodgman against one
 * half-plane). The polygon is treated as closed.
 */
function clipPolyHalfPlane(poly: Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}

/**
 * Percorre a lista de operadores mantendo a pilha gráfica e devolve um objeto
 * por caminho pintado.
 */
export async function readPageGeometry(
  page: PageLike,
  options: { rotation?: number; maxObjects?: number } = {},
): Promise<PageGeometry> {
  const maxObjects = options.maxObjects ?? 40000;
  const viewport = page.getViewport({ scale: 1, rotation: options.rotation });
  const base = viewport.transform as Matrix;
  const list = await page.getOperatorList();

  const objects: VectorObject[] = [];
  const stack: {
    ctm: Matrix;
    fill: RGB | null;
    stroke: RGB | null;
    lineWidth: number;
    activeClip: Pt[][] | null;
  }[] = [];
  let ctm: Matrix = base;
  let fill: RGB | null = null;
  let stroke: RGB | null = null;
  let lineWidth = 1;
  let pending: { polys: Pt[][]; paint: number } | null = null;
  /** Last clip path installed at this graphics-state level, in page pt. */
  let activeClip: Pt[][] | null = null;
  /**
   * A standalone clip/eoClip op in a pdf.js operator list applies to the path
   * of the FOLLOWING constructPath (the evaluator emits `W`/`W*` before the
   * merged path+`n` op, and canvas.js consumes the pending clip when that path
   * ends). Binding the PREVIOUS path instead leaks a path across q/Q — on the
   * fountain-fill corpus that bound backdrop-sized paths and minted giant
   * shading objects.
   */
  let pendingClip = false;

  const emit = (paint: number) => {
    if (!pending) return;
    const isClip = paint === OP.clip || paint === OP.eoClip || paint === OP.endPath;
    const isStroke =
      paint === OP.stroke ||
      paint === OP.closeStroke ||
      paint === OP.fillStroke ||
      paint === OP.eoFillStroke ||
      paint === OP.closeFillStroke ||
      paint === OP.closeEOFillStroke;
    const isFill =
      paint === OP.fill ||
      paint === OP.eoFill ||
      paint === OP.fillStroke ||
      paint === OP.eoFillStroke ||
      paint === OP.closeFillStroke ||
      paint === OP.closeEOFillStroke;
    const bbox = emptyRect();
    for (const poly of pending.polys) for (const p of poly) growRect(bbox, p);
    if (isRectValid(bbox) && objects.length < maxObjects) {
      objects.push({
        index: objects.length,
        op: isClip ? "clip" : isFill && isStroke ? "fillStroke" : isFill ? "fill" : "stroke",
        bbox,
        outline: pending.polys,
        fill: isFill ? fill : null,
        stroke: isStroke ? stroke : null,
        lineWidth: lineWidth * matrixScale(ctm),
      });
    }
    pending = null;
  };

  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    switch (fn) {
      case OP.save:
        stack.push({ ctm, fill, stroke, lineWidth, activeClip });
        break;
      case OP.restore: {
        const prev = stack.pop();
        if (prev) ({ ctm, fill, stroke, lineWidth, activeClip } = prev);
        break;
      }
      case OP.transform:
        ctm = multiply(ctm, args as unknown as Matrix);
        break;
      case OP.setFillRGBColor:
        fill = toRGB(args.length === 1 ? args[0] : args);
        break;
      case OP.setStrokeRGBColor:
        stroke = toRGB(args.length === 1 ? args[0] : args);
        break;
      case OP.setFillColorN:
        // Pattern fill (gradient/tiling): the flat color is now stale — a path
        // painted after this must not inherit the previous solid color.
        fill = null;
        break;
      case OP.setStrokeColorN:
        stroke = null;
        break;
      case OP.setLineWidth:
        lineWidth = Number(args[0]) || 0;
        break;
      case OP.clip:
      case OP.eoClip:
        pendingClip = true;
        break;
      case OP.constructPath: {
        const paint = Number(args[0]);
        const segments = (args[1] as ArrayLike<number>[]) ?? [];
        const polys = decodePath(segments, ctm);
        if (pendingClip || paint === OP.clip || paint === OP.eoClip) {
          if (polys.length > 0) activeClip = polys;
          pendingClip = false;
        }
        pending = { polys, paint };
        emit(paint);
        break;
      }
      case OP.shadingFill: {
        // CorelDRAW fountain fill: 'save > constructPath > eoClip > shadingFill
        // > restore'. The painted shape is the active clip; the color comes from
        // the shading's stops. Without this case the mark vanishes entirely.
        if (!activeClip || objects.length >= maxObjects) break;
        let ir: unknown = args[0];
        if (typeof ir === "string") {
          const name = ir;
          ir = undefined;
          try {
            ir = page.objs?.get(name);
          } catch {
            /* not in page.objs */
          }
          if (ir === undefined) {
            try {
              ir = page.commonObjs?.get(name);
            } catch {
              /* not resolvable */
            }
          }
        }
        if (!Array.isArray(ir) || ir[0] !== "RadialAxial") break;
        const shading = ir as ShadingIR;
        const stops = shading[3];
        const p0 = apply(ctm, shading[4][0], shading[4][1]);
        const p1 = apply(ctm, shading[5][0], shading[5][1]);
        const scale = matrixScale(ctm);
        // Extent guard: intersect the clip with the shading's own reach so a
        // page-wide clip doesn't mint a giant object. Axial: a slab between the
        // two endpoint lines (extend bakes into the stops, so allow a margin).
        // Radial: the bbox around both circles.
        let clipped: Pt[][];
        if (shading[1] === "axial") {
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) {
            clipped = activeClip;
          } else {
            const ux = dx / len;
            const uy = dy / len;
            // 25% extent margin: PDF `Extend` paints past the endpoints, and
            // the stops already bake that in — a quarter of the axis length
            // keeps that painted overrun without readmitting the whole clip.
            const margin = 0.25 * len;
            clipped = activeClip
              .map((poly) =>
                clipPolyHalfPlane(
                  clipPolyHalfPlane(poly, (p) => (p.x - p0.x) * ux + (p.y - p0.y) * uy + margin),
                  (p) => len + margin - ((p.x - p0.x) * ux + (p.y - p0.y) * uy),
                ),
              )
              .filter((poly) => poly.length > 2);
          }
        } else {
          const r0 = (Number(shading[6]) || 0) * scale;
          const r1 = (Number(shading[7]) || 0) * scale;
          const x0 = Math.min(p0.x - r0, p1.x - r1);
          const x1 = Math.max(p0.x + r0, p1.x + r1);
          const y0 = Math.min(p0.y - r0, p1.y - r1);
          const y1 = Math.max(p0.y + r0, p1.y + r1);
          // Same 25% extent margin as the axial case, sized on the circles' bbox.
          const margin = 0.25 * Math.max(x1 - x0, y1 - y0);
          clipped = activeClip
            .map((poly) =>
              [
                (p: Pt) => p.x - (x0 - margin),
                (p: Pt) => x1 + margin - p.x,
                (p: Pt) => p.y - (y0 - margin),
                (p: Pt) => y1 + margin - p.y,
              ].reduce((acc, f) => clipPolyHalfPlane(acc, f), poly),
            )
            .filter((poly) => poly.length > 2);
        }
        if (clipped.length === 0) break;
        const bbox = emptyRect();
        for (const poly of clipped) for (const p of poly) growRect(bbox, p);
        if (!isRectValid(bbox)) break;
        // A backdrop-sized rectangular gradient is background art, not a
        // sticker: downstream it is indistinguishable from the panel frame
        // (face detection keys on big lone rectangles) and swallows faces.
        // At 1:10 a rectangle-like clip beyond 250x100 real cm is a backdrop.
        if (clipped.length === 1) {
          const poly = clipped[0];
          let cross = 0;
          for (let k = 0; k < poly.length; k += 1) {
            const p = poly[k];
            const q = poly[(k + 1) % poly.length];
            cross += p.x * q.y - q.x * p.y;
          }
          const polyArea = Math.abs(cross) / 2;
          const ptPerCm = 72 / 2.54 / 10;
          const rectLike = polyArea >= 0.9 * rectArea(bbox);
          if (rectLike && rectWidth(bbox) >= 250 * ptPerCm && rectHeight(bbox) >= 100 * ptPerCm) break;
        }
        objects.push({
          index: objects.length,
          op: "fill",
          bbox,
          outline: clipped,
          // A representative flat color for detectors and neighbours; welding
          // treats it as a guess — see the fromShading gates in grouping.ts.
          fill: averageStopColor(stops),
          stroke: null,
          lineWidth: 0,
          fromShading: true,
        });
        break;
      }
      case OP.paintImageXObject:
      case OP.paintInlineImageXObject:
      case OP.paintImageMaskXObject: {
        // A imagem ocupa o quadrado unitário do espaço corrente.
        const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)];
        const bbox = emptyRect();
        for (const c of corners) growRect(bbox, c);
        if (objects.length < maxObjects) {
          objects.push({
            index: objects.length,
            op: "image",
            bbox,
            outline: [[...corners, corners[0]]],
            fill: null,
            stroke: null,
            lineWidth: 0,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return { width: viewport.width, height: viewport.height, objects };
}
