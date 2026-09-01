/**
 * A doutrina de cotagem, medida e não inventada.
 *
 * Base: 1.697 cotas com âncora e linha de extensão exatas, extraídas de 201
 * layouts reais de `Clientes/*​/Layouts/PDFs` (347 dos 357 arquivos baixados).
 * Os números entre parênteses são a contagem que sustenta cada regra.
 *
 *  1. VERTICAL — a borda de referência sai da altura do elemento: centro dentro
 *     dos 3/4 de cima → cota a partir do TOPO (186 casos, 0 no último quarto);
 *     centro no último 1/4 → cota a partir da BASE (33 casos, 0 no primeiro).
 *  2. VERTICAL — mede-se até o TOPO do elemento, não até a base dele (129 × 15).
 *  3. HORIZONTAL — sempre da borda lateral MAIS PRÓXIMA (109 × 5 / 110 × 8).
 *  4. A LINHA DE EXTENSÃO VAI ATÉ O ITEM. Não é enfeite: é o que diz a que peça
 *     o número se refere. Em 2.780 de 3.348 extensões a ponta cai DENTRO da
 *     peça medida (folga mediana 0 cm), e as duas extensões de uma mesma cota
 *     terminam no mesmo lugar (diferença mediana 2 cm). A sobra além da linha
 *     de cota é fixa: 2,5 cm.
 *  5. A LINHA DE COTA FICA PERTO DO ITEM: distância mediana de 35 cm, p75 69 cm.
 *     Item encostado numa borda → linha FORA da face, a ~18 cm dela (773 × 213);
 *     item no meio da face → linha DENTRO, ao lado dele (91 × 48).
 *  6. Empilhamento raro: 451 lados com uma faixa só, 170 com duas, 20 com três.
 *  7. VALOR — inteiro em cm, sempre, e nunca abaixo de 3 cm.
 *  8. ENVELOPAMENTO — não recebe cota de bloco, recebe a travessia da aresta.
 *  9. Não se cota o TAMANHO do adesivo (10 casos em 1.697). Cota-se onde ele vai.
 * 10. Por face: mediana de 6 cotas cobrindo 2 itens (p75: 9 cotas, 4 itens).
 */

import { panelWidthCm } from "./panel";
import { DEFAULT_ROUTING, routeDimensions, type RoutableDimension, type RoutingParams } from "./routing";
import type {
  AlignedEdge,
  BorderCrossing,
  Dimension,
  Panel,
  Rect,
  Sticker,
} from "./types";

export interface DoctrineParams {
  /** centro abaixo desta fração da altura → cota pela BASE */
  bottomBandFrac: number;
  /**
   * Peça mais baixa que isto é medida até a BASE dela, não até o topo.
   *
   * São duas decisões diferentes e é fácil confundi-las. A primeira é de qual
   * borda da FACE a cota parte, e essa segue os 3/4 (§1). A segunda é a que
   * LADO DA PEÇA a cota chega, e aí o tamanho manda: um bloco alto se
   * posiciona pelo topo, mas uma tira de texto de 24 cm assenta numa linha, e
   * é a linha de baixo dela que o aplicador alinha com o que já está colado.
   *
   * "um genio em transportes" tem 24 cm e vive nos 3/4 de cima: mede-se do
   * TETO até a BASE dele. É o que explica os 15 casos em que o projetista mede
   * até a base contra os 129 em que mede até o topo (§2).
   */
  bottomAnchorMaxHeightCm: number;
  /** centro à esquerda desta fração da largura → cota pela borda ESQUERDA */
  lateralMidFrac: number;
  /** cota menor que isto não é desenhada */
  minValueCm: number;
  /** cotas internas entre peças empilhadas do mesmo conjunto */
  relativeDims: boolean;
  /** cotas internas entre peças lado a lado — raras no material medido */
  relativeHorizontalDims: boolean;
  /** teto por face */
  maxDims: number;
  /** quantos adesivos recebem cota, do maior para o menor */
  maxStickers: number;
  /** quantas cotas de travessia de envelopamento por face */
  maxCrossings: number;
  /** afastamento da linha de cota fora da face */
  laneOffsetCm: number;
  /** distância entre faixas paralelas do mesmo lado */
  laneStepCm: number;
  /** afastamento da linha de cota quando ela fica DENTRO da face */
  insideGapCm: number;
  /**
   * Adesivo com centro a menos disto do meio da face recebe as DUAS laterais.
   *
   * DESLIGADO (0). A doutrina escrita mandava dar as duas ao centralizado, com
   * um exemplo (Ki Distribuidora, 725 à esquerda e 612 à direita). Recontado no
   * acervo inteiro: **0 de 519** adesivos recebem as duas. O exemplo era uma
   * exceção lida como regra, e custava uma cota falsa em todo logotipo
   * centralizado — que é o caso mais comum, e o do TRANSGENIO.
   */
  centeredBandFrac: number;
  /** item a menos disto de uma borda perpendicular → linha de cota FORA */
  edgeHugCm: number;
  /** item a MAIS disto de toda borda é central: a linha vem para dentro */
  centralItemCm: number;
  /** teto da distância entre a linha de cota e o item; acima disto ela vem para dentro */
  maxLineDistanceCm: number;
  /** onde cada cota mora, decidido para o conjunto (ver `routing.ts`) */
  routing: RoutingParams;
}

export const DEFAULT_DOCTRINE: DoctrineParams = {
  bottomBandFrac: 0.75,
  bottomAnchorMaxHeightCm: 30,
  lateralMidFrac: 0.5,
  minValueCm: 3,
  relativeDims: true,
  relativeHorizontalDims: false,
  // na tela a cota aparece por item, então o teto pode ser generoso; quem
  // imprime tudo de uma vez é que precisa apertar
  maxDims: 40,
  maxStickers: 12,
  centeredBandFrac: 0,
  maxCrossings: 2,
  laneOffsetCm: 18,
  laneStepCm: 35,
  insideGapCm: 40,
  edgeHugCm: 60,
  centralItemCm: 200,
  maxLineDistanceCm: 150,
  routing: DEFAULT_ROUTING,
};

const centerX = (r: Rect) => (r.x0 + r.x1) / 2;
const centerY = (r: Rect) => (r.y0 + r.y1) / 2;

let counter = 0;
function makeId(kind: string): string {
  counter += 1;
  return `${kind.toLowerCase()}-${counter}`;
}

/**
 * O que a cota mede, no eixo perpendicular.
 *
 * `lo`/`hi` são a extensão da peça (decidem se a linha cabe fora ou tem de vir
 * para dentro) e `at` é o PONTO exato em que a tinta atinge a medida — é dele
 * que a linha de extensão sai.
 */
interface Perp {
  /** trecho em que a reta de alinhamento tem material: a extensão sai daqui */
  lo: number;
  hi: number;
  /** pegada do item inteiro: a linha de cota tem de nascer FORA dela */
  boxLo: number;
  boxHi: number;
  at: number;
  span: number;
}

/**
 * Uma cota e o que o roteador precisa saber para movê-la.
 *
 * A posição que sai daqui é PROVISÓRIA: é a que a doutrina prefere olhando só
 * para esta cota. Quem decide de verdade é `routeDimensions`, que olha para
 * todas de uma vez — porque o defeito que interessa não existe numa cota
 * sozinha, só no par (ver o cabeçalho de `routing.ts`).
 */
type Routed = RoutableDimension;

function dim(
  axis: "H" | "V",
  aCm: number,
  bCm: number,
  kind: Dimension["kind"],
  perp: Perp,
  p: DoctrineParams,
  target?: string,
  targetIndex?: number,
  note?: string,
  /**
   * De que lado do quadro esta cota mora, quando o ITEM já decidiu.
   *
   * As duas cotas de um adesivo falam do mesmo canto: se a vertical mede do
   * TETO, a horizontal também pertence ao alto do quadro, e as duas se
   * encontram lá em cima. Deixando cada uma escolher pela própria distância, o
   * "157 do teto" subia e o "139 da direita" descia para o rodapé — dois
   * números do mesmo texto em pontas opostas do desenho, e nada dizendo que
   * são do mesmo item.
   */
  preferSide?: "min" | "max",
): Routed {
  const distMin = perp.boxLo;
  const distMax = perp.span - perp.boxHi;
  const preferredSide = preferSide ?? (distMin <= distMax ? "min" : "max");
  const towardMin = preferredSide === "min";
  // A cota mora FORA do painel, rente a ele — é o QUADRO que o projetista
  // desenha em volta do desenho, e é assim em 79% das 468 faces medidas.
  //
  // O acervo abre uma exceção para o item genuinamente central, a mais de 2 m
  // de qualquer borda: ali a linha vem para dentro em 57% dos casos (145 × 111).
  // É maioria fina demais para valer regra, e o preço dela aparecia na tela —
  // de três cotas de um mesmo item, duas iam para o quadro e uma ficava
  // sozinha no meio do desenho. O quadro vale para todas; a posição interna
  // segue existindo como candidata e o roteador a usa quando o quadro custaria
  // um cruzamento.
  const preferOutside = true;
  const provisional = preferOutside
    ? towardMin
      ? -p.laneOffsetCm
      : perp.span + p.laneOffsetCm
    : towardMin
      ? perp.boxLo - p.insideGapCm
      : perp.boxHi + p.insideGapCm;
  const dimension: Dimension = {
    id: makeId(kind),
    axis,
    aCm,
    bCm,
    offsetCm: provisional,
    tieCm: Math.min(Math.max(provisional, perp.lo), perp.hi),
    side: preferredSide,
    valueCm: Math.round(bCm - aCm),
    kind,
    source: "auto",
    target,
    targetIndex,
    note,
  };
  return {
    dimension,
    tieLo: perp.lo,
    tieHi: perp.hi,
    boxLo: perp.boxLo,
    boxHi: perp.boxHi,
    span: perp.span,
    preferredSide,
    preferOutside,
  };
}

/**
 * A peça que de fato define a medida.
 *
 * O conjunto "maçã + folha + HORTIFRUTI" começa a 8 cm do teto — mas quem
 * encosta nesses 8 cm é a FOLHA, lá no meio do conjunto, não a maçã na ponta
 * esquerda. Amarrar a extensão na caixa do conjunto faz a linha apontar para o
 * vazio: o número fica certo e ilegível. A extensão tem de sair da peça que
 * produziu o extremo.
 */
/**
 * A peça que manda naquele lado do conjunto, com a LINHA DE ALINHAMENTO dela.
 *
 * O conjunto "maçã + folha + HORTIFRUTI" começa a 8 cm do teto — mas quem
 * encosta nesses 8 cm é a FOLHA, no meio do desenho, enquanto a caixa começa
 * 180 cm à esquerda, na maçã. E dentro da peça escolhida vale a linha em que a
 * forma se apoia, não o descendente solto.
 */
function owningEdge(
  s: Sticker,
  side: "top" | "bottom" | "left" | "right",
): AlignedEdge {
  const edges = s.partEdgesCm ?? [];
  const fallback = (): AlignedEdge => {
    const b = s.boxCm;
    const map = {
      top: { at: b.y0, from: b.x0, to: b.x1 },
      bottom: { at: b.y1, from: b.x0, to: b.x1 },
      left: { at: b.x0, from: b.y0, to: b.y1 },
      right: { at: b.x1, from: b.y0, to: b.y1 },
    }[side];
    return { ...map, support: 1, extreme: map.at };
  };
  if (!edges.length) return fallback();
  const toward = side === "top" || side === "left" ? -1 : 1;
  let best = edges[0][side];
  for (const e of edges) {
    if (e[side].at * toward > best.at * toward) best = e[side];
  }
  return best;
}

function stickerDims(
  s: Sticker,
  widthCm: number,
  heightCm: number,
  p: DoctrineParams,
  label: string,
  index: number,
): Routed[] {
  const b = s.boxCm;
  const out: Routed[] = [];
  // Doutrina §1: centro dentro dos 3/4 de cima cota-se pelo TOPO (186 casos,
  // zero no último quarto); centro no último 1/4 cota-se pela BASE (33 casos,
  // zero no primeiro quarto). O tamanho da peça não entra na conta — o que
  // decide é ONDE ela está na face.
  // De qual borda da FACE a cota parte (§1: 186 × 0 fora do último quarto).
  const inTopBand = centerY(b) <= p.bottomBandFrac * heightCm;
  // A que lado da PEÇA ela chega. Peça baixa é posicionada pela linha em que
  // assenta, então a cota vai até a base dela mesmo vindo do teto.
  const shortPiece = b.y1 - b.y0 < p.bottomAnchorMaxHeightCm;
  const onLeft = centerX(b) <= p.lateralMidFrac * widthCm;

  // Cota-se o eixo que SOBRA.
  //
  // Uma faixa colada na quina esquerda varre a altura inteira: não há posição
  // vertical a cotar, e insistir nela produz um número que não posiciona nada.
  // Mas a posição horizontal existe, e é a que o aplicador usa. O motor antigo
  // jogava as duas fora junto — e eram 88,3% dos envelopamentos do acervo.
  const axes = s.bleedAxes;

  /**
   * QUANDO A BORDA MAIS PRÓXIMA NÃO DÁ NÚMERO, QUEM POSICIONA É A OUTRA.
   *
   * A doutrina escolhe a borda pela posição da peça na face (§1 e §3), e é ela
   * que vale em quase todo caso. Mas há a peça que está COLADA na borda
   * escolhida — o QR a 1 cm da lateral, o letreiro que encosta no teto —, e aí
   * a borda preferida devolve 1, 0, ou um número negativo quando a arte
   * transborda o quadro. Isso não é uma medida: é o aviso de que ali não há
   * distância a marcar, e a distância que existe é a do outro lado.
   *
   * Medido no acervo em modo navegador: 159 de 2.710 itens (5,9%) perdiam uma
   * das duas cotas exatamente assim — 131 a horizontal e 28 a vertical, todas
   * com a borda escolhida a 0 ou 1 cm. O aplicador clicava e via meia posição.
   *
   * A âncora é presa dentro da face antes da conta, senão a arte que sangra
   * para fora do quadro produz cota negativa.
   */
  const clamp = (at: number, span: number) => Math.min(Math.max(at, 0), span);
  const valueFrom = (at: number, span: number, fromStart: boolean) =>
    Math.round(fromStart ? clamp(at, span) : span - clamp(at, span));

  const vFrom = (fromTop: boolean) => {
    const e = owningEdge(s, fromTop && !shortPiece ? "top" : "bottom");
    return { edge: e, value: valueFrom(e.at, heightCm, fromTop) };
  };
  const hFrom = (fromLeft: boolean) => {
    const e = owningEdge(s, fromLeft ? "left" : "right");
    return { edge: e, value: valueFrom(e.at, widthCm, fromLeft) };
  };
  /** A borda preferida, ou a oposta quando a preferida não tem o que dizer. */
  const settle = <T extends { value: number }>(prefer: boolean, of: (v: boolean) => T) => {
    const first = of(prefer);
    if (first.value >= p.minValueCm) return { use: prefer, pick: first };
    const second = of(!prefer);
    return second.value >= p.minValueCm
      ? { use: !prefer, pick: second }
      : { use: prefer, pick: first };
  };

  const vChoice = settle(inTopBand, vFrom);
  const hChoice = settle(onLeft, hFrom);
  const useTop = vChoice.use;
  const useLeft = hChoice.use;

  // O canto de referência do item: a vertical mede do teto ou do piso, a
  // horizontal mede da esquerda ou da direita. As duas linhas moram nesse canto.
  const vSide: "min" | "max" = useLeft ? "min" : "max";
  const hSide: "min" | "max" = useTop ? "min" : "max";

  // vertical: mede até a linha em que a forma se apoia, não até o descendente
  if (!axes.vertical) {
    const v = vChoice.pick.edge;
    const at = clamp(v.at, heightCm);
    const perpV: Perp = {
      lo: v.from, hi: v.to, boxLo: b.x0, boxHi: b.x1,
      at: (v.from + v.to) / 2, span: widthCm,
    };
    out.push(
      useTop
        ? dim("V", 0, at, "EDGE_TOP", perpV, p, label, index, undefined, vSide)
        : dim("V", at, heightCm, "EDGE_BOTTOM", perpV, p, label, index, undefined, vSide),
    );
  }

  // horizontal: idem, pelo lado da peça que manda
  const pushH = (edge: "left" | "right") => {
    const h = owningEdge(s, edge);
    const at = clamp(h.at, widthCm);
    const perpH: Perp = {
      lo: h.from, hi: h.to, boxLo: b.y0, boxHi: b.y1,
      at: (h.from + h.to) / 2, span: heightCm,
    };
    out.push(
      edge === "left"
        ? dim("H", 0, at, "EDGE_LEFT", perpH, p, label, index, undefined, hSide)
        : dim("H", at, widthCm, "EDGE_RIGHT", perpH, p, label, index, undefined, hSide),
    );
  };
  // SEMPRE uma só, pela borda mais próxima.
  //
  // A doutrina escrita mandava dar as duas ao adesivo centralizado, com um
  // exemplo (Ki Distribuidora, 725 à esquerda e 612 à direita). Recontado no
  // acervo inteiro: **0 de 519** adesivos recebem as duas. O exemplo era uma
  // exceção lida como regra, e ela custava uma cota falsa em todo logotipo
  // centralizado — que é o caso mais comum de todos, e o do TRANSGENIO.
  if (!axes.horizontal) {
    const centered =
      p.centeredBandFrac > 0 &&
      Math.abs(centerX(b) - widthCm / 2) <= p.centeredBandFrac * widthCm;
    if (centered) {
      pushH("left");
      pushH("right");
    } else {
      pushH(useLeft ? "left" : "right");
    }
  }
  return out;
}

/**
 * O envelopamento é cotado pelas suas FRONTEIRAS na aresta.
 *
 * Cada trecho que ele ocupa numa aresta tem duas fronteiras, e cada uma vale
 * uma cota medida da quina mais próxima. Medir só o início rejeitava o caso
 * mais comum — o envelopamento que entra pela quina, onde o início é zero e o
 * que interessa é onde ele TERMINA (o "252" do Ki, o "391" do Tati).
 * Fronteira que cai na própria quina não vira cota.
 *
 * Vale para as quatro arestas: na horizontal a cota é horizontal e mede da
 * lateral; na vertical é vertical e mede do teto ou do piso.
 */
function crossingDims(
  c: BorderCrossing,
  widthCm: number,
  heightCm: number,
  p: DoctrineParams,
  targetIndex: number,
  label: string,
): { routed: Routed; boundary: "start" | "end" }[] {
  const vertical = c.edge === "left" || c.edge === "right";
  const lengthCm = vertical ? heightCm : widthCm;
  const kind = (
    { top: "BLEED_TOP", bottom: "BLEED_BOTTOM", left: "BLEED_LEFT", right: "BLEED_RIGHT" } as const
  )[c.edge];
  const note = `${
    { top: "aresta superior", bottom: "aresta inferior", left: "quina esquerda", right: "quina direita" }[
      c.edge
    ]
  }: onde o envelopamento muda`;
  // a linha de cota mora rente à aresta lida, no eixo perpendicular a ela
  const along = c.edge === "top" || c.edge === "left" ? 0 : vertical ? widthCm : heightCm;
  const perp: Perp = {
    lo: along,
    hi: along,
    boxLo: along,
    boxHi: along,
    at: along,
    span: vertical ? widthCm : heightCm,
  };
  const axis = vertical ? "V" : "H";
  const out: { routed: Routed; boundary: "start" | "end" }[] = [];
  for (const side of ["start", "end"] as const) {
    const boundary = side === "start" ? c.startCm : c.endCm;
    const fromStart = boundary;
    const fromEnd = lengthCm - boundary;
    if (Math.min(fromStart, fromEnd) < p.minValueCm) continue; // fronteira na quina
    out.push({
      boundary: side,
      routed:
        fromStart <= fromEnd
          ? dim(axis, 0, boundary, kind, perp, p, label, targetIndex, note)
          : dim(axis, boundary, lengthCm, kind, perp, p, label, targetIndex, note),
    });
  }
  return out;
}

/**
 * Cotas internas do conjunto: o vão vertical entre peças empilhadas. É a cota
 * que diz ao aplicador como montar o conjunto antes de colar — o "36" entre o
 * logotipo GRESPAN e a assinatura "Pães congelados". A linha fica no meio da
 * sobreposição das duas peças, encostada nas duas, e dispensa extensão.
 */
function relativeDims(s: Sticker, p: DoctrineParams, label: string, index: number): Routed[] {
  const out: Routed[] = [];
  const order = s.partsCm.map((_, i) => i).sort((i, j) => s.partsCm[i].y0 - s.partsCm[j].y0);
  const parts = order.map((i) => s.partsCm[i]);
  const edges = order.map((i) => s.partEdgesCm?.[i]);
  // A cota relativa não anda: ela vive entre duas peças do conjunto e é dali
  // que tira o sentido. Entra no roteador só como obstáculo, com `tie` colado
  // na própria linha para que a extensão saia com comprimento zero.
  const fix = (d: Dimension): Routed => ({
    dimension: d,
    tieLo: d.offsetCm,
    tieHi: d.offsetCm,
    boxLo: d.offsetCm,
    boxHi: d.offsetCm,
    span: 0,
    preferredSide: "min",
    preferOutside: false,
  });
  let stacked: Dimension | null = null;
  for (let i = 0; i + 1 < parts.length; i += 1) {
    const a = parts[i];
    const b = parts[i + 1];
    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    if (overlap <= 0.25 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) continue;
    const aBottom = edges[i]?.bottom.at ?? a.y1;
    const bTop = edges[i + 1]?.top.at ?? b.y0;
    const gap = bTop - aBottom;
    if (gap < p.minValueCm) continue;
    const axis = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2;
    const d: Dimension = {
      id: makeId("RELATIVE_V"),
      axis: "V",
      aCm: aBottom,
      bCm: bTop,
      offsetCm: axis,
      tieCm: axis,
      side: "inside",
      valueCm: Math.round(gap),
      kind: "RELATIVE_V",
      source: "auto",
      target: label,
      targetIndex: index,
    };
    if (!stacked || d.valueCm > stacked.valueCm) stacked = d;
  }
  if (stacked) out.push(fix(stacked));

  if (!p.relativeHorizontalDims) return out;
  const byX = [...s.partsCm].sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i + 1 < byX.length; i += 1) {
    const a = byX[i];
    const b = byX[i + 1];
    const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (overlap <= 0.25 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) continue;
    const gap = b.x0 - a.x1;
    if (gap < p.minValueCm) continue;
    const axis = (Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1)) / 2;
    out.push(
      fix({
        id: makeId("RELATIVE_H"),
        axis: "H",
        aCm: a.x1,
        bCm: b.x0,
        offsetCm: axis,
        tieCm: axis,
        side: "inside",
        valueCm: Math.round(gap),
        kind: "RELATIVE_H",
        source: "auto",
        target: label,
        targetIndex: index,
      }),
    );
  }
  return out;
}

/**
 * A travessia do envelopamento é cota rara — 1,3% das âncoras medidas. Vale a
 * mais próxima de cada aresta e nada além disso: cotar toda ondulação do fundo
 * enche o desenho de número que ninguém usa.
 */
/**
 * A travessia da aresta é cota rara — 1,3% das âncoras medidas. Vale a mais
 * próxima de cada quina e nada além disso: cotar toda ondulação do fundo enche
 * o desenho de número que ninguém usa.
 */
function pickCrossings(
  crossings: BorderCrossing[],
  widthCm: number,
  heightCm: number,
  p: DoctrineParams,
  label: (itemIndex: number) => string,
): Routed[] {
  const best = new Map<string, { gap: number; edge: BorderCrossing["edge"]; routed: Routed }>();
  for (const c of crossings) {
    for (const e of crossingDims(c, widthCm, heightCm, p, c.wrapIndex, label(c.wrapIndex))) {
      // A chave é a FRONTEIRA de onde a travessia veio, não a quina de onde ela
      // foi medida. Chaveando pela quina, duas fronteiras distintas que por
      // acaso ficam ambas mais perto da esquerda colidem e uma some — 322 de
      // 1.002 travessias do acervo colidiam assim, e em 12 delas o número que
      // o projetista escreveu era justamente o descartado. Na FRICARNE 840 o
      // motor achava a fronteira certa (183) e guardava a outra (154).
      const key = `${c.wrapIndex}:${c.edge}:${e.boundary}`;
      const current = best.get(key);
      if (!current || e.routed.dimension.valueCm < current.gap) {
        best.set(key, { gap: e.routed.dimension.valueCm, edge: c.edge, routed: e.routed });
      }
    }
  }
  // A aresta de cima vale mais que a de baixo: é por ela que o aplicador começa
  // a puxar o adesivo (13 × 5 nas cotas medidas). A preferência estava escrita e
  // nunca rodava — o teste era `chave.startsWith("top")`, e a chave começa pelo
  // índice do item, então dava falso em 100% dos casos. Agora a aresta vem do
  // próprio registro, não de adivinhar pelo texto da chave.
  const byItem = new Map<number, { gap: number; edge: BorderCrossing["edge"]; routed: Routed }[]>();
  for (const [key, entry] of best) {
    const item = Number(key.split(":")[0]);
    const list = byItem.get(item);
    if (list) list.push(entry);
    else byItem.set(item, [entry]);
  }
  // O orçamento é por ARESTA, não por item: um adereço que cruza o topo e o
  // piso tem duas histórias a contar, e gastar as duas vagas numa aresta só
  // deixa a outra muda.
  const out: Routed[] = [];
  for (const list of byItem.values()) {
    const perEdge = new Map<BorderCrossing["edge"], typeof list>();
    for (const e of list) {
      const bucket = perEdge.get(e.edge);
      if (bucket) bucket.push(e);
      else perEdge.set(e.edge, [e]);
    }
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      const bucket = perEdge.get(edge);
      if (!bucket) continue;
      bucket.sort((a, b) => a.gap - b.gap);
      out.push(...bucket.slice(0, p.maxCrossings).map((e) => e.routed));
    }
  }
  return out;
}

const PRIORITY: Record<Dimension["kind"], number> = {
  EDGE_TOP: 0,
  EDGE_BOTTOM: 0,
  EDGE_LEFT: 1,
  EDGE_RIGHT: 1,
  BLEED_TOP: 2,
  BLEED_BOTTOM: 2,
  BLEED_LEFT: 2,
  BLEED_RIGHT: 2,
  RELATIVE_V: 3,
  RELATIVE_H: 3,
  MANUAL: 4,
};

/**
 * Duas cotas que dizem a mesma coisa viram uma — mas a que fica HERDA o dono da
 * que saiu.
 *
 * A comparação é por (eixo, natureza): sem isso uma cota de travessia de
 * envelopamento apagava a cota de borda de um adesivo que por acaso começava no
 * mesmo lugar — e são coisas diferentes, uma diz onde a faixa cruza a quina e a
 * outra onde o logotipo assenta.
 *
 * A herança é o que faltava. Duas peças na mesma altura pedem a mesma cota
 * vertical, e desenhar as duas põe número em cima de número; só que o
 * visualizador mostra as cotas DO ITEM CLICADO, e a sobrevivente pertence à
 * outra peça. O operador clicava em "Saúde" e via só a distância lateral — a
 * altura existia, medida, desenhada, e registrada no vizinho. Agora a cota que
 * fica sabe todos os itens que ela explica.
 *
 * E "a mesma coisa" inclui o NÚMERO. As pontas a menos de 2 cm uma da outra não
 * bastam: com essa folga sozinha, o "149" da assinatura do MACHADÃO era
 * absorvido pelo "147" da faixa que passa atrás, e quem clicava na assinatura
 * recebia a posição do vizinho. Medido no acervo, 289 das 543 cotas herdadas
 * traziam um valor diferente do que a peça herdeira mediria sozinha. Duas cotas
 * com números diferentes não dizem a mesma coisa — dizem duas, e as duas são
 * verdade sobre peças diferentes.
 */
function dedupe(routed: Routed[], tol = 2): Routed[] {
  const out: Routed[] = [];
  for (const r of routed) {
    const d = r.dimension;
    const host = out.find((o) => {
      const e = o.dimension;
      return (
        e.axis === d.axis &&
        PRIORITY[e.kind] === PRIORITY[d.kind] &&
        e.valueCm === d.valueCm &&
        Math.abs(e.aCm - d.aCm) < tol &&
        Math.abs(e.bCm - d.bCm) < tol
      );
    });
    if (!host) {
      out.push(r);
      continue;
    }
    const owner = d.targetIndex;
    if (owner === undefined || owner === host.dimension.targetIndex) continue;
    const also = host.dimension.alsoTargets ?? [];
    if (!also.includes(owner)) host.dimension.alsoTargets = [...also, owner];
  }
  return out;
}

export function planDimensions(
  panel: Panel,
  items: Sticker[],
  crossings: BorderCrossing[],
  params: DoctrineParams = DEFAULT_DOCTRINE,
): Dimension[] {
  const widthCm = panelWidthCm(panel);
  const heightCm = panel.heightCm;
  const main = items.slice(0, params.maxStickers);
  const nameOf = (i: number) => (items[i]?.bleeds ? `envelopamento ${i + 1}` : `adesivo ${i + 1}`);
  /**
   * A cota de POSIÇÃO do adesivo é intocável; o resto é acessório.
   *
   * Cada peça sai daqui com uma altura e uma distância, e são elas que o
   * aplicador usa para colar. As outras — o vão interno do conjunto, a
   * travessia do envelopamento — explicam o desenho, mas não posicionam nada
   * sozinhas. Misturar as duas classes num filtro só fazia a peça perder
   * justamente a medida que importa: um logotipo a 2 cm da lateral saía sem
   * distância nenhuma porque 2 é menor que o piso de 3, e o piso existe para
   * não desenhar cota de vão, não para apagar a posição de um adesivo.
   */
  const essential: Routed[] = [];
  const extra: Routed[] = [];
  main.forEach((item, i) => {
    const label = nameOf(i);
    essential.push(...stickerDims(item, widthCm, heightCm, params, label, i));
    if (params.relativeDims && !item.bleeds) {
      extra.push(...relativeDims(item, params, label, i));
    }
  });
  extra.push(
    ...pickCrossings(
      crossings.filter((c) => c.wrapIndex < main.length),
      widthCm,
      heightCm,
      params,
      nameOf,
    ),
  );

  const keep = extra.filter((r) => r.dimension.valueCm >= params.minValueCm);
  keep.sort(
    (a, b) =>
      PRIORITY[a.dimension.kind] - PRIORITY[b.dimension.kind] ||
      b.dimension.valueCm - a.dimension.valueCm,
  );
  let routed = dedupe([...essential, ...keep]);
  // o teto corta o acessório, nunca a posição
  if (routed.length > params.maxDims) {
    const essentials = new Set(essential.map((r) => r.dimension));
    const kept = routed.filter((r) => essentials.has(r.dimension));
    for (const r of routed) {
      if (kept.length >= params.maxDims) break;
      if (!essentials.has(r.dimension)) kept.push(r);
    }
    routed = kept;
  }
  routed.sort(
    (a, b) =>
      PRIORITY[a.dimension.kind] - PRIORITY[b.dimension.kind] ||
      b.dimension.valueCm - a.dimension.valueCm,
  );

  // Só agora, com o conjunto fechado, cada cota descobre onde as outras estão.
  // O envelopamento é fundo e não estorva — obstáculo é adesivo.
  routeDimensions(
    routed,
    main.filter((item) => !item.bleeds).map((item) => item.boxCm),
    params.routing,
  );
  return routed.map((r) => r.dimension);
}
