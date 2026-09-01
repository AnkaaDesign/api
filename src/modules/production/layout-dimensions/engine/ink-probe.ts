/**
 * Recorte da tinta dentro de uma moldura.
 *
 * Nem todo adesivo é vetor. Boa parte dos logotipos entra no layout como
 * IMAGEM, e aí a caixa que o PDF declara é a moldura do arquivo de imagem —
 * com toda a folga transparente que o designer deixou em volta da arte. Cotar
 * por essa moldura põe a seta no vazio: era o "espaço em branco" entre a cota e
 * o desenho.
 *
 * A saída é medir o pixel: rasteriza-se a página uma vez, e cada moldura é
 * encolhida até encostar na primeira linha e coluna que diferem do fundo local.
 * O fundo é lido na própria borda da moldura, então funciona igual com folga
 * branca sobre chapa branca e com folga verde sobre envelopamento verde.
 */

import type { Rect } from "./types";

export interface PixelSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** pixels por ponto de PDF na rasterização */
  pxPerPt: number;
  /** canto superior esquerdo da rasterização, em pt da página */
  originPt?: { x: number; y: number };
}

export interface TrimOptions {
  /** distância de cor que já conta como tinta (0–255, euclidiana) */
  tolerance?: number;
  /** fração mínima de pixels de tinta numa linha para ela contar */
  minCoverage?: number;
  /** não encolhe além disto: moldura toda vazia devolve a original */
  minSizePt?: number;
}

const DEFAULTS: Required<TrimOptions> = {
  tolerance: 26,
  minCoverage: 0.004,
  minSizePt: 2,
};

function sample(src: PixelSource, x: number, y: number): [number, number, number] {
  const i = (y * src.width + x) * 4;
  return [src.data[i], src.data[i + 1], src.data[i + 2]];
}

/** Cor do fundo local: a mediana do anel de 1 px na borda da moldura. */
function borderColor(
  src: PixelSource,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number] {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return;
    const [pr, pg, pb] = sample(src, x, y);
    r.push(pr);
    g.push(pg);
    b.push(pb);
  };
  const stepX = Math.max(1, Math.floor((x1 - x0) / 64));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 64));
  for (let x = x0; x <= x1; x += stepX) {
    push(x, y0);
    push(x, y1);
  }
  for (let y = y0; y <= y1; y += stepY) {
    push(x0, y);
    push(x1, y);
  }
  if (!r.length) return [255, 255, 255];
  const mid = (arr: number[]) => arr.sort((p, q) => p - q)[arr.length >> 1];
  return [mid(r), mid(g), mid(b)];
}

/**
 * Encolhe `rect` (em pt da página) até a tinta real. Devolve `null` quando a
 * moldura cai fora da rasterização ou está inteiramente vazia.
 */
export function trimRectToInk(
  src: PixelSource,
  rect: Rect,
  options: TrimOptions = {},
): Rect | null {
  const o = { ...DEFAULTS, ...options };
  const ox = src.originPt?.x ?? 0;
  const oy = src.originPt?.y ?? 0;
  const x0 = Math.max(0, Math.floor((rect.x0 - ox) * src.pxPerPt));
  const y0 = Math.max(0, Math.floor((rect.y0 - oy) * src.pxPerPt));
  const x1 = Math.min(src.width - 1, Math.ceil((rect.x1 - ox) * src.pxPerPt));
  const y1 = Math.min(src.height - 1, Math.ceil((rect.y1 - oy) * src.pxPerPt));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;

  const [br, bg, bb] = borderColor(src, x0, y0, x1, y1);
  const isInk = (x: number, y: number) => {
    const i = (y * src.width + x) * 4;
    const dr = src.data[i] - br;
    const dg = src.data[i + 1] - bg;
    const db = src.data[i + 2] - bb;
    return dr * dr + dg * dg + db * db > o.tolerance * o.tolerance;
  };

  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  const colHits = new Uint32Array(cols);
  const rowHits = new Uint32Array(rows);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!isInk(x, y)) continue;
      colHits[x - x0] += 1;
      rowHits[y - y0] += 1;
    }
  }

  const colFloor = Math.max(1, Math.floor(rows * o.minCoverage));
  const rowFloor = Math.max(1, Math.floor(cols * o.minCoverage));
  let left = 0;
  while (left < cols && colHits[left] < colFloor) left += 1;
  let right = cols - 1;
  while (right > left && colHits[right] < colFloor) right -= 1;
  let top = 0;
  while (top < rows && rowHits[top] < rowFloor) top += 1;
  let bottom = rows - 1;
  while (bottom > top && rowHits[bottom] < rowFloor) bottom -= 1;
  if (left >= right || top >= bottom) return null;

  const out: Rect = {
    x0: ox + (x0 + left) / src.pxPerPt,
    y0: oy + (y0 + top) / src.pxPerPt,
    x1: ox + (x0 + right + 1) / src.pxPerPt,
    y1: oy + (y0 + bottom + 1) / src.pxPerPt,
  };
  if (out.x1 - out.x0 < o.minSizePt || out.y1 - out.y0 < o.minSizePt) return null;
  return out;
}

/**
 * pdf.js desenha com as classes gráficas do DOM, e aqui não há DOM.
 *
 * `@napi-rs/canvas` traz as dela (Skia, o mesmo motor do Chrome), mas pdf.js as
 * procura no escopo global. Instalar uma vez é o que faz `page.render` existir
 * fora do navegador — sem isso a rasterização morre com um `ReferenceError` que
 * o `catch` de baixo engoliria, o recorte de tinta voltaria `undefined`, e o
 * agrupamento passaria a decidir pela moldura declarada da imagem. Ou seja: o
 * defeito não apareceria como erro, apareceria como cota ancorada no vazio.
 */
let canvasGlobalsReady = false;

async function installCanvasGlobals(): Promise<typeof import("@napi-rs/canvas")> {
  const canvasLib = await import("@napi-rs/canvas");
  if (!canvasGlobalsReady) {
    const g = globalThis as Record<string, unknown>;
    g.DOMMatrix ??= canvasLib.DOMMatrix;
    g.Path2D ??= canvasLib.Path2D;
    g.ImageData ??= canvasLib.ImageData;
    canvasGlobalsReady = true;
  }
  return canvasLib;
}

/**
 * Rasteriza a página uma vez e devolve o recortador pronto.
 *
 * A 1:10 cada pixel vale ~7 mm reais — folga de sobra para achar onde a arte
 * começa dentro da moldura de uma imagem, e uma carreta de 15 m ainda cabe em
 * dois megapixels.
 *
 * ⚠️ Este recortador é a diferença entre dois motores. Enquanto ele era do DOM,
 * o cotador rodava com ele no navegador e SEM ele nas bancadas — e o defeito da
 * onda do DiCasa, que engolia o logotipo, existia só de um lado. Rodando tudo
 * no servidor há uma rasterização só, a mesma para a web e para o celular, e a
 * pergunta "o motor medido é o motor entregue?" deixa de existir.
 */
export async function createPageInkTrimmer(
  page: {
    getViewport: (o: { scale: number; rotation?: number }) => { width: number; height: number };
    render: (o: never) => { promise: Promise<void> };
  },
  pxPerPt = 0.5,
  rotation?: number,
): Promise<((rect: Rect) => Rect | null) | undefined> {
  try {
    const { createCanvas } = await installCanvasGlobals();
    // A rotação tem de ser a MESMA da leitura vetorial. Com o PDF girado, um
    // recorte feito na página em pé cai noutro lugar da tinta e a cota ancora
    // torto — sem erro nenhum na tela, que é o pior tipo de defeito.
    const viewport = page.getViewport({ scale: pxPerPt, rotation });
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return makeInkTrimmer({
      data: image.data as unknown as Uint8ClampedArray,
      width: image.width,
      height: image.height,
      pxPerPt,
    });
  } catch {
    return undefined;
  }
}

/** Fábrica pronta para passar ao agrupamento. */
export function makeInkTrimmer(src: PixelSource, options?: TrimOptions) {
  return (rect: Rect): Rect | null => {
    try {
      return trimRectToInk(src, rect, options);
    } catch {
      return null;
    }
  };
}
