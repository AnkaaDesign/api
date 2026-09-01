/**
 * As FACES de um layout, num arquivo só.
 *
 * O projetista entrega o caminhão inteiro numa página: 86% do acervo é assim, e
 * em 99% dos casos as duas laterais estão empilhadas uma sobre a outra, do
 * mesmo tamanho. Cotar só a primeira — que era o que o motor fazia — deixa
 * metade do trabalho de fora.
 *
 * Aqui cada retângulo que reproduz a proporção de uma medida do implemento vira
 * uma face, e cada face é cotada por conta própria. A identidade do lado
 * (motorista ou sapo) não sai da geometria — as duas são iguais —, então vale a
 * ordem em que aparecem na página, de cima para baixo, e quem confirma é o
 * operador.
 */

import { DEFAULT_DOCTRINE, planDimensions, type DoctrineParams } from "./doctrine";
import { readPageGeometry, rectArea, rectHeight, rectWidth } from "./geometry";
import {
  DEFAULT_GROUPING,
  borderCrossings,
  buildItems,
  classify,
  type GroupingOptions,
  type GroupingParams,
} from "./grouping";
import { panelWidthCm } from "./panel";
import { detectScaleFrom, type ScaleDetection } from "./scale-detect";
import type {
  BorderCrossing,
  Dimension,
  PageGeometry,
  Panel,
  PanelSide,
  Rect,
  Scale,
  Sticker,
} from "./types";

/** Um item clicável do desenho: adesivo posicionável ou envelopamento. */
export interface LayoutItem {
  /** índice global, único entre todas as faces */
  index: number;
  faceIndex: number;
  kind: "sticker" | "wrap";
  side: PanelSide;
  /** em pt da página, para o CLIQUE: a pegada real da tinta */
  bbox: Rect;
  /**
   * A caixa que as COTAS DESTE ITEM referenciam, em pt da página.
   *
   * Cada lado recua para a linha de alinhamento só quando existe uma cota
   * medindo até ele; os outros ficam no extremo da tinta. Em
   * "www.transgenio.com.br", cotado a partir do piso, a base assenta na linha
   * do "w" e deixa a perna do "g" de fora, enquanto o topo continua abraçando o
   * "t" e o "b". Desenhar a `bbox` crua fazia a caixa e a cota discordarem;
   * aparar os quatro lados fazia a caixa cortar letra sem motivo.
   */
  alignedBoxPt: Rect;
  /** contorno real, quando é envelopamento (a caixa mente numa forma côncava) */
  outlinePt?: { x: number; y: number }[][];
  widthCm: number;
  heightCm: number;
}

export interface LayoutFaceResult {
  index: number;
  side: PanelSide;
  panel: Panel;
  scale: Scale;
  /** como a face foi achada, e o quanto a proporção divergiu da medida */
  from: "rectangle" | "ink-bounds";
  aspectErrorPct: number;
  stickers: Sticker[];
  wraps: Sticker[];
  crossings: BorderCrossing[];
  /**
   * Por que esta face não entrega peça para clicar — quando não entrega.
   *
   * O cotador não acerta tudo, e há desenho que ele não sabe ler: fundo que
   * sangra encostando em cada elemento, contorno de dezenas de milhares de
   * pontos, arte que chega como uma imagem só. Nesses casos o certo não é
   * devolver uma seleção que engole a face inteira e cobrar do operador o
   * tempo de descobrir isso — é dizer que ali não dá, e deixar a régua manual
   * livre, que é a ferramenta que resolve. A face segue desenhada e medível;
   * só não tem peça a escolher.
   */
  unusable?: string;
}

export interface LayoutDimensionsResult {
  geometry: PageGeometry;
  detectedScale: ScaleDetection;
  faces: LayoutFaceResult[];
  items: LayoutItem[];
  /**
   * Todas as cotas, com `targetIndex` apontando para `items`.
   *
   * Há UM plano, e é o da doutrina. Existiu por um tempo um segundo, espelhado,
   * que o clique repetido alternava — e a alternância era o próprio defeito:
   * duas respostas para a mesma pergunta, e o operador sem saber qual colar.
   * A borda de referência é a que a doutrina escolhe; quando ela não tem
   * número a dar, `stickerDims` já vai buscar o da borda oposta.
   */
  dimensions: Dimension[];
  warnings: string[];
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

/** Um caminho é retângulo quando o contorno tem 4 cantos e lados ortogonais. */
function isAxisRectangle(outline: { x: number; y: number }[][], tolerance = 1.5): boolean {
  if (outline.length !== 1) return false;
  const poly = outline[0];
  const pts =
    poly.length >= 2 &&
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

/** A caneta que desenhou o retângulo: mesma cor, mesmo traço, mesmo molde. */
function penOf(obj: PageGeometry["objects"][number]): string {
  const rgb = (c: number[] | null) => (c ? c.join(",") : "-");
  return `${obj.op}|${rgb(obj.stroke)}|${rgb(obj.fill)}|${obj.lineWidth.toFixed(2)}`;
}

/**
 * A FACE DESENHADA EM SEÇÕES volta a ser uma face.
 *
 * Nem todo molde desenha a lateral como um retângulo só. O do MACHADÃO desenha
 * as SEÇÕES do baú encostadas uma na outra — 192 + 107 + 492 cm no lado do
 * motorista, 253 + 106 + 325 + 106 no do sapo —, todas com a mesma caneta e a
 * mesma altura, dividindo as arestas verticais. Cada uma virava uma "face"
 * candidata, e nenhuma casava com a proporção de 790 × 252 que o caminhão tem:
 * o arquivo abria com a TRASEIRA reconhecida e as duas laterais fora, que é
 * justamente onde está a arte.
 *
 * Colam-se apenas retângulos que dividem o topo E a base, foram desenhados com
 * a MESMA caneta e se encostam pela lateral. Duas faces diferentes na página
 * não passam por esse crivo: a traseira tem outra altura, e o que está dentro
 * de outra face é aninhado, não vizinho.
 */
function glueSectionRow(pieces: { rect: Rect; pen: string }[], tolerance = 2): Rect[] {
  const rows = new Map<string, { rect: Rect; pen: string }[]>();
  for (const p of pieces) {
    const key = `${p.pen}|${Math.round(p.rect.y0 / tolerance)}|${Math.round(p.rect.y1 / tolerance)}`;
    const list = rows.get(key);
    if (list) list.push(p);
    else rows.set(key, [p]);
  }
  const out: Rect[] = [];
  for (const list of rows.values()) {
    list.sort((a, b) => a.rect.x0 - b.rect.x0);
    let run = list[0].rect;
    for (let i = 1; i < list.length; i += 1) {
      const next = list[i].rect;
      // encostam (ou se sobrepõem um fio): a seção seguinte continua a mesma face
      if (next.x0 - run.x1 <= tolerance && next.x1 > run.x1) {
        run = { x0: run.x0, y0: Math.min(run.y0, next.y0), x1: next.x1, y1: Math.max(run.y1, next.y1) };
        continue;
      }
      if (next.x0 - run.x1 <= tolerance) continue; // seção contida na anterior
      out.push(run);
      run = next;
    }
    out.push(run);
  }
  return out;
}

/**
 * Todos os retângulos da página que podem ser uma face, em ordem de leitura.
 *
 * Descarta o que está contido noutro maior — as portas de um baú são
 * retângulos legítimos dentro da lateral, e não são faces.
 *
 * NÃO descarta o retângulo que cai dentro de uma foto. A tentação é grande — a
 * traseira costuma vir fotografada — mas a moldura ali é a face de verdade: o
 * projetista desenha a arte da porta EM VETOR por cima do retrato, e no
 * TRANSGENIO há doze objetos vetoriais dentro dela, que são o logotipo, o
 * rastro e a assinatura. Descartá-la apaga a traseira inteira.
 *
 * O piso de largura vale sobre a face JÁ COLADA (ver `glueSectionRow`): uma
 * seção de 107 cm é estreita demais para ser face sozinha, mas é parte de uma.
 */
export function findPanelRects(geometry: PageGeometry, minWidthFrac = 0.15): Rect[] {
  const pieces: { rect: Rect; pen: string }[] = [];
  for (const obj of geometry.objects) {
    if (obj.op === "clip" || obj.op === "image" || obj.fromShading) continue;
    if (!isAxisRectangle(obj.outline)) continue;
    const w = rectWidth(obj.bbox);
    const h = rectHeight(obj.bbox);
    if (h < 8) continue;
    if (w > geometry.width * 0.995 && h > geometry.height * 0.995) continue;
    pieces.push({ rect: obj.bbox, pen: penOf(obj) });
  }
  const candidates = glueSectionRow(pieces).filter(
    (r) => rectWidth(r) >= minWidthFrac * geometry.width,
  );
  candidates.sort((a, b) => rectArea(b) - rectArea(a));
  const keep: Rect[] = [];
  for (const r of candidates) {
    const duplicate = keep.some(
      (k) =>
        Math.abs(k.x0 - r.x0) < 6 &&
        Math.abs(k.x1 - r.x1) < 6 &&
        Math.abs(k.y0 - r.y0) < 6 &&
        Math.abs(k.y1 - r.y1) < 6,
    );
    if (duplicate) continue;
    const nested = keep.some(
      (k) => k.x0 - 3 <= r.x0 && r.x1 <= k.x1 + 3 && k.y0 - 3 <= r.y0 && r.y1 <= k.y1 + 3,
    );
    if (nested) continue;
    keep.push(r);
  }
  // ordem de leitura: de cima para baixo, depois da esquerda para a direita
  keep.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return keep;
}

/**
 * Casa cada retângulo com a medida de um lado.
 *
 * A proporção decide QUAL medida (lateral ou traseira); a ordem na página
 * decide QUAL lado, porque motorista e sapo têm o mesmo tamanho em 92% dos
 * arquivos e a geometria não sabe distingui-los.
 */
export function matchFaces(
  rects: Rect[],
  panels: Panel[],
  aspectTolerance = 0.06,
): { rect: Rect; panel: Panel }[] {
  const remaining = [...panels];
  const out: { rect: Rect; panel: Panel }[] = [];
  for (const rect of rects) {
    const aspect = rectWidth(rect) / Math.max(1, rectHeight(rect));
    let bestIndex = -1;
    let bestError = Infinity;
    remaining.forEach((p, i) => {
      const target = panelWidthCm(p) / Math.max(1, p.heightCm);
      const error = Math.abs(aspect - target) / target;
      if (error < bestError) {
        bestError = error;
        bestIndex = i;
      }
    });
    if (bestIndex < 0 || bestError > aspectTolerance) continue;
    out.push({ rect, panel: remaining[bestIndex] });
    remaining.splice(bestIndex, 1);
    if (!remaining.length) break;
  }
  return out;
}

/**
 * Lê a página inteira e devolve as faces cotadas, os itens clicáveis e as cotas.
 *
 * `panels` são as medidas do caminhão, uma por lado. A ordem importa: é ela que
 * nomeia as faces quando duas têm o mesmo tamanho.
 */
export async function buildLayoutFaces(
  page: PageLike,
  panels: Panel[],
  options: {
    rotation?: number;
    grouping?: Partial<GroupingParams>;
    doctrine?: Partial<DoctrineParams>;
    trimToInk?: GroupingOptions["trimToInk"];
  } = {},
): Promise<LayoutDimensionsResult> {
  const grouping = { ...DEFAULT_GROUPING, ...options.grouping };
  const doctrine = { ...DEFAULT_DOCTRINE, ...options.doctrine };
  const geometry = await readPageGeometry(page, { rotation: options.rotation });
  const text = await page.getTextContent();
  const detectedScale = detectScaleFrom(geometry, text.items);

  const usable = panels.filter((p) => panelWidthCm(p) > 0 && p.heightCm > 0);
  const matches = matchFaces(findPanelRects(geometry), usable);

  const faces: LayoutFaceResult[] = [];
  const items: LayoutItem[] = [];
  const dimensions: Dimension[] = [];
  const warnings: string[] = [];

  matches.forEach(({ rect, panel }, faceIndex) => {
    const widthCm = panelWidthCm(panel);
    const scale: Scale = { ptPerCm: rectWidth(rect) / widthCm, panelPt: rect };
    const byHeight = rectHeight(rect) / panel.heightCm;
    const aspectErrorPct = (Math.abs(scale.ptPerCm - byHeight) / scale.ptPerCm) * 100;

    const { pieces } = classify(geometry, scale, grouping);
    const built = buildItems(pieces, scale, grouping, { trimToInk: options.trimToInk });
    const crossings = built.truncated ? [] : borderCrossings(built.objects, panel, scale, grouping);
    const faceDims = built.truncated ? [] : planDimensions(panel, built.items, crossings, doctrine);
    const { stickers, wraps } = built;

    const base = items.length;
    const found = built.truncated ? [] : built.items.slice(0, doctrine.maxStickers);

    /**
     * A face dá ou não dá para escolher peça — e quando não dá, quem avisa é o
     * motor, não o operador depois de tentar.
     *
     * Três formas de não dar, e nenhuma delas é culpa de quem está usando:
     * o orçamento de contorno estourou (o desenho é pesado demais, e os itens
     * de meio caminho não valem nada); não sobrou item nenhum; ou sobrou UM
     * que cobre a face inteira, que é o caso do fundo que sangra e encosta em
     * tudo — clicar em qualquer lugar devolve o caminhão todo. Nos três a
     * resposta útil é a mesma: diga, não ofereça a seleção, e deixe a régua
     * livre. Medir à mão sempre foi possível; o que não podia era o cotador
     * tomar a thread e impedir isso também.
     */
    const unusable = built.truncated
      ? "o desenho é pesado demais para reconhecer as peças"
      : !found.length
        ? "nenhuma peça foi reconhecida no desenho"
        : found.length === 1 && rectArea(found[0].bbox) / rectArea(rect) >= 0.9
          ? "o fundo cobre a face inteira e engole as peças"
          : undefined;
    if (unusable) {
      warnings.push(`Face ${panel.side.toLowerCase()}: ${unusable}. Use a régua para medir à mão.`);
    }
    const clickable = unusable ? [] : found;
    clickable.forEach((item, i) => {
      /**
       * O quadro do item encosta EXATAMENTE onde as cotas dele encostam.
       *
       * Cada lado é puxado para a ponta da cota que chega nele; os lados que
       * cota nenhuma referencia ficam no extremo da tinta. Se a medida é "22 do
       * piso", a base do quadro sobe para a linha do "w" e a perna do "g" fica
       * de fora — que é o que explica o número. Já o topo, que ninguém mede,
       * continua abraçando o "t" e o "b": aparar os quatro lados de uma vez era
       * mutilar a caixa para nada, e desenhar a tinta crua fazia a caixa
       * discordar do número.
       */
      const own = faceDims.filter(
        (d) =>
          (d.targetIndex === i || d.alsoTargets?.includes(i)) && d.kind.startsWith("EDGE_"),
      );
      const ink = item.boxCm;
      const drawCm: Rect = { ...ink };
      for (const d of own) {
        // a ponta que não é a borda da face é a que encosta na peça
        const along = d.axis === "V" ? [0, panel.heightCm] : [0, widthCm];
        const anchor = Math.abs(d.aCm - along[0]) < 0.5 ? d.bCm : d.aCm;
        if (d.axis === "V") {
          if (Math.abs(anchor - ink.y0) <= Math.abs(anchor - ink.y1)) drawCm.y0 = anchor;
          else drawCm.y1 = anchor;
        } else if (Math.abs(anchor - ink.x0) <= Math.abs(anchor - ink.x1)) {
          drawCm.x0 = anchor;
        } else {
          drawCm.x1 = anchor;
        }
      }
      items.push({
        index: base + i,
        faceIndex,
        kind: item.bleeds ? "wrap" : "sticker",
        side: panel.side,
        bbox: item.bbox,
        alignedBoxPt: {
          x0: scale.panelPt.x0 + drawCm.x0 * scale.ptPerCm,
          y0: scale.panelPt.y0 + drawCm.y0 * scale.ptPerCm,
          x1: scale.panelPt.x0 + drawCm.x1 * scale.ptPerCm,
          y1: scale.panelPt.y0 + drawCm.y1 * scale.ptPerCm,
        },
        outlinePt: item.outlinePt,
        widthCm: item.boxCm.x1 - item.boxCm.x0,
        heightCm: item.boxCm.y1 - item.boxCm.y0,
      });
    });
    const toGlobal = (d: Dimension): Dimension => ({
      ...d,
      id: `f${faceIndex}-${d.id}`,
      targetIndex: d.targetIndex === undefined ? undefined : base + d.targetIndex,
      alsoTargets: d.alsoTargets?.map((t) => base + t),
    });
    if (!unusable) {
      for (const d of faceDims) dimensions.push(toGlobal(d));
    }

    if (aspectErrorPct > 4) {
      warnings.push(
        `A face ${panel.side.toLowerCase()} diverge ${aspectErrorPct.toFixed(1)}% da medida informada.`,
      );
    }
    faces.push({
      index: faceIndex,
      side: panel.side,
      panel,
      scale,
      from: "rectangle",
      aspectErrorPct,
      stickers,
      wraps,
      crossings,
      unusable,
    });
  });

  if (!faces.length) {
    warnings.push(
      "Nenhuma face foi reconhecida: o arquivo não traz o contorno do implemento, ou as medidas do caminhão não batem com o desenho.",
    );
  } else if (faces.length < usable.length) {
    warnings.push(
      `${faces.length} de ${usable.length} faces reconhecidas no arquivo.`,
    );
  }

  return { geometry, detectedScale, faces, items, dimensions, warnings };
}
