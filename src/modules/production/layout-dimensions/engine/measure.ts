/**
 * Medição manual no visualizador: clica numa linha, clica na outra, sai a cota.
 *
 * É a rede de segurança do cotador automático — quando faltar uma cota ou o
 * agrupamento errar, o operador tira a medida na mão sem sair do arquivo. O
 * ímã trabalha sobre a MESMA geometria vetorial que o automático usa, então a
 * medida cai exatamente na quina do adesivo, não onde o dedo acertou.
 */

import type { PageGeometry, Pt, Rect, Scale, VectorObject } from "./types";

export type SnapKind = "edge" | "corner" | "bbox" | "panel";

export interface SnapTarget {
  kind: SnapKind;
  /** ponto exato sobre a geometria */
  point: Pt;
  /** segmento que originou o ímã, em pt da página */
  a: Pt;
  b: Pt;
  /** "V" quando a reta é vertical, "H" quando horizontal, null quando oblíqua */
  orientation: "H" | "V" | null;
  /** índice do objeto de origem, quando houver */
  objectIndex: number | null;
  distance: number;
}

interface Segment {
  a: Pt;
  b: Pt;
  objectIndex: number | null;
  kind: SnapKind;
}

const CELL = 48;

export class SnapIndex {
  private readonly cells = new Map<string, Segment[]>();

  private readonly all: Segment[] = [];

  constructor(geometry: PageGeometry, scale?: Scale, options: { maxSegments?: number } = {}) {
    const max = options.maxSegments ?? 200000;
    for (const obj of geometry.objects) {
      if (obj.op === "clip") continue;
      if (this.all.length > max) break;
      this.addObject(obj);
    }
    if (scale) this.addRect(scale.panelPt, "panel", null);
  }

  private addObject(obj: VectorObject): void {
    if (obj.op === "image") {
      this.addRect(obj.bbox, "bbox", obj.index);
      return;
    }
    for (const poly of obj.outline) {
      for (let i = 0; i + 1 < poly.length; i += 1) {
        this.push({ a: poly[i], b: poly[i + 1], objectIndex: obj.index, kind: "edge" });
      }
    }
    this.addRect(obj.bbox, "bbox", obj.index);
  }

  private addRect(r: Rect, kind: SnapKind, objectIndex: number | null): void {
    const corners: Pt[] = [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
    ];
    for (let i = 0; i < 4; i += 1) {
      this.push({ a: corners[i], b: corners[(i + 1) % 4], objectIndex, kind });
    }
  }

  private push(seg: Segment): void {
    this.all.push(seg);
    const x0 = Math.floor(Math.min(seg.a.x, seg.b.x) / CELL);
    const x1 = Math.floor(Math.max(seg.a.x, seg.b.x) / CELL);
    const y0 = Math.floor(Math.min(seg.a.y, seg.b.y) / CELL);
    const y1 = Math.floor(Math.max(seg.a.y, seg.b.y) / CELL);
    // segmento muito longo entra só na lista geral: encher 3.000 células é pior
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = `${x}:${y}`;
        const list = this.cells.get(key);
        if (list) list.push(seg);
        else this.cells.set(key, [seg]);
      }
    }
  }

  /**
   * Ímã: o ponto da geometria mais perto de `p`, dentro de `radius` pt.
   *
   * `prefer` é a orientação do primeiro clique: no segundo, a aresta paralela
   * ganha desempate. É o que o operador quer — ele está medindo a distância
   * ENTRE duas retas paralelas, e a perpendicular que passa perto não serve.
   */
  snap(p: Pt, radius: number, prefer?: "H" | "V" | null): SnapTarget | null {
    const candidates = new Set<Segment>();
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    const reach = Math.ceil(radius / CELL);
    for (let x = cx - reach; x <= cx + reach; x += 1) {
      for (let y = cy - reach; y <= cy + reach; y += 1) {
        for (const s of this.cells.get(`${x}:${y}`) ?? []) candidates.add(s);
      }
    }
    for (const s of this.all) {
      const long = Math.abs(s.a.x - s.b.x) > CELL * 20 || Math.abs(s.a.y - s.b.y) > CELL * 20;
      if (long) candidates.add(s);
    }

    let best: SnapTarget | null = null;
    let bestScore = Infinity;
    for (const s of candidates) {
      const hit = closestOnSegment(p, s.a, s.b);
      if (hit.distance > radius) continue;
      // canto ganha da aresta quando os dois estão ao alcance
      const corner = Math.min(dist(p, s.a), dist(p, s.b));
      const isCorner = corner <= Math.min(radius * 0.5, hit.distance + 2);
      const point = isCorner ? (dist(p, s.a) <= dist(p, s.b) ? s.a : s.b) : hit.point;
      const distance = isCorner ? corner : hit.distance;
      const orientation = orientationOf(s.a, s.b);
      const bonus = (isCorner ? 3 : 0) + (prefer && orientation === prefer ? radius * 0.5 : 0);
      const score = distance - bonus;
      if (!best || score < bestScore) {
        bestScore = score;
        best = {
          kind: isCorner ? "corner" : s.kind,
          point,
          a: s.a,
          b: s.b,
          orientation,
          objectIndex: s.objectIndex,
          distance,
        };
      }
    }
    return best;
  }
}

export function orientationOf(a: Pt, b: Pt, tol = 0.4): "H" | "V" | null {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (dx <= tol && dy > tol) return "V";
  if (dy <= tol && dx > tol) return "H";
  return null;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; distance: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return { point: a, distance: dist(p, a) };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * vx, y: a.y + t * vy };
  return { point, distance: dist(p, point) };
}

export interface Measurement {
  axis: "H" | "V" | "free";
  /** em pt da página */
  distancePt: number;
  /** em cm reais do implemento */
  valueCm: number;
  from: Pt;
  to: Pt;
}

/**
 * Distância entre dois alvos. Duas retas paralelas medem a distância
 * perpendicular — é essa a medida que o aplicador quer, e é ela que o clique
 * numa linha e depois na outra deve dar, não a distância entre os dois cliques.
 */
export function measureBetween(first: SnapTarget, second: SnapTarget, scale: Scale): Measurement {
  const sameAxis =
    first.orientation !== null && first.orientation === second.orientation
      ? first.orientation
      : null;
  if (sameAxis === "V") {
    const distancePt = Math.abs(second.point.x - first.point.x);
    const y = (first.point.y + second.point.y) / 2;
    return {
      axis: "H",
      distancePt,
      valueCm: distancePt / scale.ptPerCm,
      from: { x: first.point.x, y },
      to: { x: second.point.x, y },
    };
  }
  if (sameAxis === "H") {
    const distancePt = Math.abs(second.point.y - first.point.y);
    const x = (first.point.x + second.point.x) / 2;
    return {
      axis: "V",
      distancePt,
      valueCm: distancePt / scale.ptPerCm,
      from: { x, y: first.point.y },
      to: { x, y: second.point.y },
    };
  }
  const distancePt = dist(first.point, second.point);
  return {
    axis: "free",
    distancePt,
    valueCm: distancePt / scale.ptPerCm,
    from: first.point,
    to: second.point,
  };
}

/** Converte uma medida manual em cota, já em coordenadas da face. */
export function measurementToDimension(
  m: Measurement,
  scale: Scale,
  id: string,
): import("./types").Dimension {
  const toCmX = (x: number) => (x - scale.panelPt.x0) / scale.ptPerCm;
  const toCmY = (y: number) => (y - scale.panelPt.y0) / scale.ptPerCm;
  if (m.axis === "H") {
    const a = Math.min(toCmX(m.from.x), toCmX(m.to.x));
    const b = Math.max(toCmX(m.from.x), toCmX(m.to.x));
    const offset = toCmY(m.from.y);
    return {
      id, axis: "H", aCm: a, bCm: b, offsetCm: offset, tieCm: offset, side: "inside",
      valueCm: Math.round(m.valueCm), kind: "MANUAL", source: "manual",
    };
  }
  const a = Math.min(toCmY(m.from.y), toCmY(m.to.y));
  const b = Math.max(toCmY(m.from.y), toCmY(m.to.y));
  const offset = toCmX(m.from.x);
  return {
    id, axis: "V", aCm: a, bCm: b, offsetCm: offset, tieCm: offset, side: "inside",
    valueCm: Math.round(m.valueCm), kind: "MANUAL", source: "manual",
  };
}
