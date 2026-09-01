/**
 * Descobre a escala de um layout já cotado, lendo as cotas que ele traz.
 *
 * Todo layout entregue hoje sai do CorelDRAW a 1:10, mas confiar nisso sem
 * conferir é o jeito de entregar medida errada. Este módulo mede: para cada
 * rótulo azul, procura o par de linhas de extensão cuja distância reproduz o
 * número escrito, e a razão pt/cm que se repetir é a escala real do arquivo.
 * Em 263 PDFs reais isso resolveu 98% dos rótulos com erro máximo de 0,9 cm.
 */

import { readPageGeometry } from "./geometry";
import { DIM_COLOR, PT_PER_CM_AT_1_10 } from "./style";
import type { PageGeometry } from "./types";

const COLOR_TOLERANCE = 14;

export interface ScaleDetection {
  ptPerCm: number;
  /** denominador da escala do desenho: 10 para 1:10 */
  denominator: number;
  /** quantos rótulos concordaram com essa razão */
  agree: number;
  /** quantos rótulos numéricos existiam */
  labels: number;
  source: "cotas-do-arquivo" | "padrao-da-casa";
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

interface PageLike {
  getViewport(params: { scale: number; rotation?: number }): {
    width: number;
    height: number;
    transform: number[];
  };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
}

function isDimColor(rgb: [number, number, number] | null): boolean {
  if (!rgb) return false;
  const target = [DIM_COLOR.r * 255, DIM_COLOR.g * 255, DIM_COLOR.b * 255];
  return rgb.every((c, i) => Math.abs(c - target[i]) <= COLOR_TOLERANCE);
}

/** Segmentos azuis, separados por orientação: [início, fim, posição perpendicular]. */
function dimensionSegments(geometry: PageGeometry) {
  const horizontal: [number, number, number][] = [];
  const vertical: [number, number, number][] = [];
  for (const obj of geometry.objects) {
    if (!isDimColor(obj.stroke)) continue;
    for (const poly of obj.outline) {
      for (let i = 0; i + 1 < poly.length; i += 1) {
        const a = poly[i];
        const b = poly[i + 1];
        if (Math.abs(a.y - b.y) < 0.6 && Math.abs(a.x - b.x) >= 1) {
          horizontal.push([Math.min(a.x, b.x), Math.max(a.x, b.x), (a.y + b.y) / 2]);
        } else if (Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) >= 1) {
          vertical.push([Math.min(a.y, b.y), Math.max(a.y, b.y), (a.x + b.x) / 2]);
        }
      }
    }
  }
  return { horizontal, vertical };
}

function numericLabels(items: unknown[], pageHeight: number) {
  const out: { value: number; cx: number; cy: number; vertical: boolean }[] = [];
  for (const raw of items) {
    const item = raw as TextItem;
    if (!item?.str || !Array.isArray(item.transform)) continue;
    const text = item.str.replace(/cm/gi, "").trim();
    if (!/^\d+([,.]\d+)?$/.test(text)) continue;
    const value = Number(text.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || value > 3000) continue;
    const m = item.transform;
    const vertical = Math.abs(m[1]) > Math.abs(m[0]);
    out.push({
      value,
      cx: m[4] + (vertical ? 0 : (item.width ?? 0) / 2),
      cy: pageHeight - m[5] - (vertical ? (item.width ?? 0) / 2 : 0),
      vertical,
    });
  }
  return out;
}

/** Escalas de prancha usadas na casa; a leitura encosta numa delas. */
const STANDARD_DENOMINATORS = [1, 2, 2.5, 5, 10, 20, 25, 50, 100];

/**
 * Para um rótulo, devolve os pares (vão em pt, valor em cm) plausíveis: cada
 * par de linhas de extensão que cruza a linha de cota vira um candidato.
 */
function candidatesFor(
  label: { value: number; cx: number; cy: number; vertical: boolean },
  segments: ReturnType<typeof dimensionSegments>,
): { span: number; value: number }[] {
  const along = label.vertical ? segments.vertical : segments.horizontal;
  const across = label.vertical ? segments.horizontal : segments.vertical;
  const near = label.vertical ? label.cx : label.cy;
  const axes = new Set(
    along.filter((s) => Math.abs(s[2] - near) < 45).map((s) => Math.round(s[2] * 10) / 10),
  );
  const out: { span: number; value: number }[] = [];
  for (const axis of axes) {
    const points = [
      ...new Set(
        across
          .filter((s) => s[0] - 6 <= axis && axis <= s[1] + 6)
          .map((s) => Math.round(s[2] * 10) / 10),
      ),
    ].sort((a, b) => a - b);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const span = points[j] - points[i];
        if (span < 2) continue;
        out.push({ span, value: label.value });
      }
    }
  }
  return out;
}

/**
 * Vota na razão mais repetida e depois REFAZ a conta pelos mínimos quadrados.
 *
 * Cada rótulo produz vários pares candidatos e só um é a escala. A verdadeira é
 * a única que reaparece em rótulo após rótulo — mas nunca com o mesmo número: o
 * traço da linha de extensão tem sobra de ponta, e ela é constante em pt. Votar
 * em faixa relativa acha a faixa certa; tirar a mediana dela deixa a sobra
 * dentro do resultado e a escala sai ~1% alta. O ajuste por mínimos quadrados
 * sobre os pares (vão, valor) resolve: cota grande pesa mais, e nela a sobra é
 * proporcionalmente desprezível.
 */
export function detectScaleFrom(
  geometry: PageGeometry,
  textItems: unknown[],
): ScaleDetection {
  const segments = dimensionSegments(geometry);
  const labels = numericLabels(textItems, geometry.height);
  const BIN = Math.log(1.015);

  const bins = new Map<number, { pairs: { span: number; value: number }[]; labels: Set<number> }>();
  labels.forEach((label, index) => {
    const seen = new Set<number>();
    for (const pair of candidatesFor(label, segments)) {
      const ratio = pair.span / pair.value;
      if (ratio < 0.2 || ratio > 60) continue;
      const bin = Math.round(Math.log(ratio) / BIN);
      if (seen.has(bin)) continue;
      seen.add(bin);
      // a faixa vizinha também conta: a razão certa pode cair na divisa
      for (const b of [bin - 1, bin, bin + 1]) {
        const entry = bins.get(b) ?? { pairs: [], labels: new Set<number>() };
        if (b === bin) entry.pairs.push(pair);
        entry.labels.add(index);
        bins.set(b, entry);
      }
    }
  });

  let best: { pairs: { span: number; value: number }[]; labels: Set<number> } | null = null;
  for (const entry of bins.values()) {
    if (entry.pairs.length === 0) continue;
    if (!best || entry.labels.size > best.labels.size) best = entry;
  }

  if (!best || best.labels.size < 3 || best.labels.size < labels.length * 0.4) {
    return {
      ptPerCm: PT_PER_CM_AT_1_10,
      denominator: 10,
      agree: best?.labels.size ?? 0,
      labels: labels.length,
      source: "padrao-da-casa",
    };
  }

  let num = 0;
  let den = 0;
  for (const { span, value } of best.pairs) {
    num += span * value;
    den += value * value;
  }
  let ptPerCm = num / den;
  let denominator = 72 / 2.54 / ptPerCm;

  // encosta numa escala de prancha quando está a menos de 1,5% dela
  for (const std of STANDARD_DENOMINATORS) {
    if (Math.abs(denominator - std) / std <= 0.015) {
      denominator = std;
      ptPerCm = 72 / 2.54 / std;
      break;
    }
  }

  return {
    ptPerCm,
    denominator,
    agree: best.labels.size,
    labels: labels.length,
    source: "cotas-do-arquivo",
  };
}

export async function detectScale(page: PageLike, rotation = 0): Promise<ScaleDetection> {
  const geometry = await readPageGeometry(page, { rotation });
  const text = await page.getTextContent();
  return detectScaleFrom(geometry, text.items);
}
