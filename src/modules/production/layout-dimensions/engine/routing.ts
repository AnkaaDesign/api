/**
 * Onde cada cota mora — decidido para o CONJUNTO, não uma de cada vez.
 *
 * O defeito que este arquivo existe para corrigir tem um exemplo exato. No
 * TRANSGENIO 840×264 o logotipo é centralizado e recebe três cotas: 95 do teto,
 * 196 da esquerda e 134 da direita. A cota vertical procura um corredor livre e
 * assenta a 35 cm à direita do logotipo, em x = 741 — que é DENTRO do trecho
 * [706, 840] que a cota de 134 mede. A cota de 134 procura o dela e assenta a
 * 35 cm acima do logotipo, em y = 50 — que é DENTRO do trecho [0, 95] que a
 * cota de 95 mede. As duas linhas se cortam em (741, 50), formando um X no meio
 * do desenho. Nenhuma das duas escolhas está errada sozinha; erradas são as
 * duas juntas, e nenhuma das duas tinha como saber da outra.
 *
 * A saída não é uma regra a mais em `place`: é trocar a decisão local por uma
 * escolha com custo, em que cada cota enxerga onde as outras já estão. O que se
 * paga: cruzar linha com linha, cruzar arte com a linha (a extensão pode, é fio
 * de cabelo e o projetista faz o tempo todo), esticar a extensão, e desobedecer
 * ao lado que a doutrina mediu. O que se ganha é o desenho legível.
 *
 * Custo de tempo: 40 cotas × 12 candidatas × 3 passagens, cada avaliação contra
 * as outras 39 — algo como 500 mil testes de segmento, uns 10 ms. Isso roda
 * quando o arquivo abre, uma vez por face.
 */

import type { Dimension, DimensionSide, Rect } from "./types";

export interface RoutingParams {
  /**
   * Distância entre faixas paralelas do mesmo lado.
   *
   * O projetista usa 35 cm (p50 de 468 faces, moda em 45). Os 18 cm que o motor
   * usava vinham de uma medição antiga e não cabem um rótulo de 36 pt com a
   * folga dele: as faixas vizinhas saíam com número em cima de linha.
   */
  laneStepCm: number;
  /**
   * Afastamento da linha quando ela fica FORA da face.
   *
   * É o quadro de cotas que o projetista desenha em volta do desenho — no MAR E
   * RIO 768×242 as oito cotas da face estão todas nesse anel, rentes à borda,
   * com a extensão entrando para alcançar a peça. Dez centímetros a 1:10 é 1 mm
   * no papel: perto o bastante para o número pertencer ao desenho, longe o
   * bastante para não encostar no contorno do implemento.
   */
  outsideOffsetCm: number;
  /** afastamento da linha quando ela fica DENTRO da face (p50 real: 35 cm) */
  insideGapCm: number;
  /** faixas paralelas FORA da face por lado */
  maxOutsideLanes: number;
  /** faixas paralelas DENTRO da face por lado (o acervo chega a três) */
  maxInsideLanes: number;
  /** meio comprimento do rótulo ao longo do eixo da cota, em cm da face */
  labelHalfLengthCm: number;
  /** meia altura do rótulo no eixo perpendicular */
  labelHalfHeightCm: number;
  /** preço de um cruzamento entre duas linhas de cota */
  lineCrossCost: number;
  /**
   * Preço de um cruzamento entre linha de cota e extensão alheia.
   *
   * Alto, e mais alto que o preço de empurrar a cota para a faixa seguinte —
   * é isso que faz o roteador ESPALHAR em vez de cruzar. Com o quadro externo
   * todas as cotas de um lado disputam o mesmo anel, e cobrar pouco por este
   * cruzamento amontoava tudo na primeira faixa: 2,32 cruzamentos graves por
   * face. Encarecendo-o e barateando a faixa, cai para 0,015 — cinco em 325.
   */
  lineExtensionCrossCost: number;
  /** preço de um cruzamento entre duas extensões */
  extensionCrossCost: number;
  /** preço de um rótulo em cima de outro */
  labelCrossCost: number;
  /** preço por centímetro de LINHA de cota sobre arte */
  artCostPerCm: number;
  /**
   * Preço por centímetro de extensão.
   *
   * Quase nada, e de propósito. A extensão é fio de cabelo, e no acervo ela tem
   * mediana de 63 cm e p90 de 171 — o projetista não hesita em puxá-la meio
   * caminhão para levar o número à margem limpa. Cobrando caro por ela, o
   * roteador fazia a conta errada: no TRANSGENIO o quadro externo saía a 83 e a
   * posição interna a 81, e a cota vertical ficava plantada no meio do desenho
   * por dois pontos de diferença.
   */
  reachCostPerCm: number;
  /** preço de trocar o lado que a doutrina escolheu */
  sideCost: number;
  /**
   * Preço de trazer a linha para DENTRO da face.
   *
   * Alto: o quadro por fora é o padrão da casa, e a posição interna existe só
   * para o caso em que o quadro custaria um cruzamento de verdade. O preço fica
   * abaixo do cruzamento de linha com extensão (90) justamente para isso.
   */
  placementCost: number;
  /**
   * Preço da posição RENTE — a linha assentada na própria aresta do item.
   *
   * Caro. O quadro externo é o padrão da casa e o dono pediu por ele quatro
    * vezes; a posição rente sobrevive só como último recurso, quando o anel de
    * fora já está cheio e a alternativa seria cruzar. O motivo de existir é de
    * leitura. Uma cota "95 do teto" e
   * uma cota "134 da direita" do mesmo logotipo falam da MESMA quina: o 95
   * termina onde o logotipo começa, e é dali que o 134 sai. Deixando cada uma
   * escolher o próprio afastamento, uma assenta 55 cm à direita do "O" e a
   * outra 40 cm abaixo do topo — não se cruzam, mas ficam soltas, e o desenho
   * vira três traços sem parentesco. Rente, as duas se encontram no canto e a
   * ligação fica visível sem legenda.
   *
   * A extensão nasce com comprimento zero, e isso aqui é correto, não defeito:
   * a aresta do próprio item faz o papel dela. Só vale para cota que mede da
   * borda da face ATÉ o item — nessas, a linha nunca passa por cima da peça,
   * ela para na quina. Não confundir com a linha caindo no MEIO do item, que é
   * o defeito que a doutrina descreve (o "25" que foi parar na cauda do "Q").
   */
  flushCost: number;
  /** piso de preço das posições afastadas, para a rente ganhar os empates */
  standoffCost: number;
  /** preço de cada faixa a mais de afastamento */
  laneCost: number;
  /**
   * Peso do cruzamento entre cotas de ITENS DIFERENTES.
   *
   * ZERO, e a razão é o que se vê na tela: clicando num adesivo aparecem só as
   * cotas DELE. Fazer essas cotas desviarem de linhas invisíveis é pagar sem
   * receber — e o preço aparecia no desenho, com o anel de cotas afastando-se
   * até 88 cm da borda para dar passagem a uma cota de outro item que ninguém
   * está olhando. Com zero, cada item usa a primeira faixa e o quadro fica
   * rente aos 10 cm pedidos.
   *
   * Quem desenhar a face INTEIRA de uma vez (o PDF cotado, quando existir)
   * deve subir isto para 1 e roteirizar tudo junto.
   */
  crossItemFactor: number;
  /** quantas passagens de melhoria depois da primeira escolha */
  passes: number;
}

export const DEFAULT_ROUTING: RoutingParams = {
  laneStepCm: 35,
  outsideOffsetCm: 10,
  insideGapCm: 40,
  maxOutsideLanes: 8,
  maxInsideLanes: 3,
  labelHalfLengthCm: 14,
  labelHalfHeightCm: 9,
  // Um cruzamento de LINHA com LINHA é o defeito que se vê de longe: são os
  // dois traços grossos, com seta e número, formando um X. Custa mais que
  // qualquer outra coisa que o roteador saiba fazer.
  lineCrossCost: 260,
  lineExtensionCrossCost: 200,
  // Cruzar extensão com extensão é NORMAL: nas 187 faces medidas o projetista
  // faz 0,81 por cota e não parece incomodado. O que ele não faz é cruzar uma
  // LINHA de cota — 2 casos em 1.210. Cobrar caro por isto empurraria o motor
  // para longe do desenho que a casa já entende.
  extensionCrossCost: 10,
  labelCrossCost: 150,
  artCostPerCm: 2.2,
  reachCostPerCm: 0.08,
  sideCost: 60,
  placementCost: 85,
  flushCost: 150,
  standoffCost: 18,
  laneCost: 10,
  crossItemFactor: 0,
  passes: 3,
};

/** Um segmento em cm da face, já orientado para o teste de interseção. */
interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** O desenho de uma cota numa posição candidata. */
interface Shape {
  line: Seg;
  extensions: Seg[];
  label: Rect;
}

/**
 * O que o roteador precisa saber de uma cota para poder movê-la.
 *
 * `tieLo`/`tieHi` são o trecho em que a extensão pode encostar no item — é o
 * que amarra o número à peça. `boxLo`/`boxHi` é a pegada do item no eixo
 * perpendicular: a linha tem de nascer FORA dela, senão a extensão fica com
 * comprimento zero e a cota flutua sem dono.
 */
export interface RoutableDimension {
  dimension: Dimension;
  tieLo: number;
  tieHi: number;
  boxLo: number;
  boxHi: number;
  /** tamanho da face no eixo perpendicular ao da cota */
  span: number;
  /** o lado que a doutrina mediu para esta cota */
  preferredSide: "min" | "max";
  /** a doutrina manda esta cota para fora da face? */
  preferOutside: boolean;
}

interface Candidate {
  offsetCm: number;
  side: DimensionSide;
  /** custo que não depende das outras cotas */
  baseCost: number;
}

const EXTENSION_OVERSHOOT_CM = 2.5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * As três peças de uma cota, em cm da face.
 *
 * A extensão passa 2,5 cm além da linha — medida fixa em 1.697 cotas reais, com
 * p10 a p75 todos em 2,5.
 */
function shapeOf(item: RoutableDimension, offsetCm: number, p: RoutingParams): Shape {
  const d = item.dimension;
  const tie = clamp(offsetCm, item.tieLo, item.tieHi);
  const over = offsetCm >= tie ? EXTENSION_OVERSHOOT_CM : -EXTENSION_OVERSHOOT_CM;
  const end = offsetCm + over;
  const mid = (d.aCm + d.bCm) / 2;
  if (d.axis === "H") {
    return {
      line: { x0: d.aCm, y0: offsetCm, x1: d.bCm, y1: offsetCm },
      extensions: [
        { x0: d.aCm, y0: tie, x1: d.aCm, y1: end },
        { x0: d.bCm, y0: tie, x1: d.bCm, y1: end },
      ],
      label: {
        x0: mid - p.labelHalfLengthCm,
        x1: mid + p.labelHalfLengthCm,
        y0: offsetCm - p.labelHalfHeightCm,
        y1: offsetCm + p.labelHalfHeightCm,
      },
    };
  }
  return {
    line: { x0: offsetCm, y0: d.aCm, x1: offsetCm, y1: d.bCm },
    extensions: [
      { x0: tie, y0: d.aCm, x1: end, y1: d.aCm },
      { x0: tie, y0: d.bCm, x1: end, y1: d.bCm },
    ],
    label: {
      x0: offsetCm - p.labelHalfHeightCm,
      x1: offsetCm + p.labelHalfHeightCm,
      y0: mid - p.labelHalfLengthCm,
      y1: mid + p.labelHalfLengthCm,
    },
  };
}

/**
 * Os dois segmentos se cruzam?
 *
 * Só interessa o cruzamento em X — dois traços que se tocam pela ponta (o canto
 * de duas cotas que partem da mesma quina) são normais no desenho técnico e não
 * atrapalham a leitura. Por isso a comparação é estrita.
 */
function segmentsCross(a: Seg, b: Seg): boolean {
  const d1x = a.x1 - a.x0;
  const d1y = a.y1 - a.y0;
  const d2x = b.x1 - b.x0;
  const d2y = b.y1 - b.y0;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false; // paralelos: nunca fazem X
  const t = ((b.x0 - a.x0) * d2y - (b.y0 - a.y0) * d2x) / denom;
  const u = ((b.x0 - a.x0) * d1y - (b.y0 - a.y0) * d1x) / denom;
  const EPS = 1e-3;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Quantos centímetros da LINHA passam por cima de arte. */
function artOverlapCm(line: Seg, obstacles: Rect[]): number {
  const horizontal = Math.abs(line.y1 - line.y0) < 1e-6;
  const lo = horizontal ? Math.min(line.x0, line.x1) : Math.min(line.y0, line.y1);
  const hi = horizontal ? Math.max(line.x0, line.x1) : Math.max(line.y0, line.y1);
  const at = horizontal ? line.y0 : line.x0;
  const covered: [number, number][] = [];
  for (const o of obstacles) {
    const [across0, across1] = horizontal ? [o.y0, o.y1] : [o.x0, o.x1];
    if (at <= across0 || at >= across1) continue;
    const [along0, along1] = horizontal ? [o.x0, o.x1] : [o.y0, o.y1];
    const a = Math.max(lo, along0);
    const b = Math.min(hi, along1);
    if (b > a) covered.push([a, b]);
  }
  if (!covered.length) return 0;
  covered.sort((m, n) => m[0] - n[0]);
  let total = 0;
  let [start, end] = covered[0];
  for (const [a, b] of covered.slice(1)) {
    if (a > end) {
      total += end - start;
      [start, end] = [a, b];
    } else if (b > end) {
      end = b;
    }
  }
  return total + (end - start);
}

/**
 * As posições que uma cota admite, da mais doutrinária para a menos.
 *
 * Dois lugares por lado: FORA da face, a 18 cm dela — que é onde 773 das 986
 * cotas de item encostado na borda moram — e DENTRO, ao lado do item, a 35 cm
 * da pegada dele. O afastamento conta da BORDA do item, nunca do meio: caindo
 * dentro de [boxLo, boxHi] a extensão fica com comprimento zero e o número
 * flutua sem nada que o ligue à peça.
 */
function candidatesFor(item: RoutableDimension, p: RoutingParams): Candidate[] {
  const out: Candidate[] = [];
  const push = (
    offsetCm: number,
    side: "min" | "max",
    kind: "flush" | "inside" | "outside",
    lane: number,
  ) => {
    // a linha nunca nasce em cima do trecho que mede — rente é a aresta, e a
    // aresta não está "em cima"
    if (kind === "inside" && offsetCm > item.boxLo - 1 && offsetCm < item.boxHi + 1) return;
    if (out.some((c) => Math.abs(c.offsetCm - offsetCm) < 0.5)) return;
    const placement =
      kind === "flush"
        ? p.flushCost
        : p.standoffCost + ((kind === "outside") === item.preferOutside ? 0 : p.placementCost);
    out.push({
      offsetCm,
      side,
      baseCost: (side === item.preferredSide ? 0 : p.sideCost) + placement + lane * p.laneCost,
    });
  };

  // Rente: a linha na aresta do item, do lado que a doutrina escolheu. Fica de
  // fora quando a aresta coincide com a borda da face, senão a linha de cota
  // seria desenhada por cima do contorno do implemento e some nele.
  const flush = item.preferredSide === "min" ? item.boxLo : item.boxHi;
  if (flush > 3 && flush < item.span - 3) push(flush, item.preferredSide, "flush", 0);
  for (const side of [item.preferredSide, item.preferredSide === "min" ? "max" : "min"] as const) {
    for (let lane = 0; lane < p.maxOutsideLanes; lane += 1) {
      const step = lane * p.laneStepCm;
      push(
        side === "min" ? -p.outsideOffsetCm - step : item.span + p.outsideOffsetCm + step,
        side,
        "outside",
        lane,
      );
    }
    for (let lane = 0; lane < p.maxInsideLanes; lane += 1) {
      const step = lane * p.laneStepCm;
      const inside =
        side === "min" ? item.boxLo - p.insideGapCm - step : item.boxHi + p.insideGapCm + step;
      if (inside > 0 && inside < item.span) push(inside, side, "inside", lane);
    }
  }
  return out;
}

/** O que esta forma custa contra uma outra já posicionada. */
function pairCost(a: Shape, b: Shape, p: RoutingParams, sameItem: boolean): number {
  let cost = 0;
  if (segmentsCross(a.line, b.line)) cost += p.lineCrossCost;
  for (const e of b.extensions) if (segmentsCross(a.line, e)) cost += p.lineExtensionCrossCost;
  for (const e of a.extensions) if (segmentsCross(e, b.line)) cost += p.lineExtensionCrossCost;
  for (const e of a.extensions) {
    for (const f of b.extensions) if (segmentsCross(e, f)) cost += p.extensionCrossCost;
  }
  if (rectsOverlap(a.label, b.label)) cost += p.labelCrossCost;
  return sameItem ? cost : cost * p.crossItemFactor;
}

/**
 * Distribui as cotas pela face, com cada uma enxergando onde as outras estão.
 *
 * Primeiro cada cota escolhe o melhor lugar contra as que já foram colocadas
 * (as mais compridas primeiro, porque são as que têm menos onde se esconder);
 * depois vêm passagens de melhoria, em que a cota mais cara da vez tenta se
 * mudar sabendo de TODAS as outras. Sem essa segunda etapa a primeira cota da
 * fila escolhe às cegas e as últimas pagam a conta dela.
 *
 * Muta `offsetCm`, `tieCm` e `side` das cotas recebidas.
 */
export function routeDimensions(
  items: RoutableDimension[],
  obstacles: Rect[],
  params: RoutingParams = DEFAULT_ROUTING,
): void {
  const movable = items.filter((i) => i.dimension.side !== "inside");
  if (!movable.length) return;

  // A cota relativa não se move — ela vive entre duas peças do conjunto, e é
  // dali que tira o sentido —, mas continua sendo obstáculo para as outras.
  const fixed = items
    .filter((i) => i.dimension.side === "inside")
    .map((i) => ({ shape: shapeOf(i, i.dimension.offsetCm, params), target: i.dimension.targetIndex }));

  const options = movable.map((i) => candidatesFor(i, params));
  const artOf = options.map((cands, i) =>
    cands.map((c) => artOverlapCm(shapeOf(movable[i], c.offsetCm, params).line, obstacles)),
  );
  // O piso de arte é por COTA, não absoluto: uma cota que mede da borda
  // esquerda até um item atrás de uma faixa que ocupa a altura inteira cruza
  // arte em qualquer posição. Cobrar dela um preço que não tem como evitar
  // fazia o laço esgotar e jogar a cota na margem, com a extensão atravessando
  // o caminhão — foi assim que o "196" do TRANSGENIO foi parar lá em cima.
  const artFloor = artOf.map((list) => (list.length ? Math.min(...list) : 0));

  const chosen = movable.map(() => 0);
  const shapes: Shape[] = movable.map((i) => shapeOf(i, options[0][0]?.offsetCm ?? 0, params));
  const placed: boolean[] = movable.map(() => false);

  const costOf = (i: number, candidateIndex: number, ignoreSelf: boolean): number => {
    const cand = options[i][candidateIndex];
    const shape = shapeOf(movable[i], cand.offsetCm, params);
    const tie = clamp(cand.offsetCm, movable[i].tieLo, movable[i].tieHi);
    let cost =
      cand.baseCost +
      (artOf[i][candidateIndex] - artFloor[i]) * params.artCostPerCm +
      Math.abs(cand.offsetCm - tie) * params.reachCostPerCm;
    for (const f of fixed) cost += pairCost(shape, f.shape, params, f.target === movable[i].dimension.targetIndex);
    for (let j = 0; j < movable.length; j += 1) {
      if (j === i || (!ignoreSelf && !placed[j])) continue;
      if (ignoreSelf && j === i) continue;
      if (!ignoreSelf && !placed[j]) continue;
      cost += pairCost(shape, shapes[j], params, movable[j].dimension.targetIndex === movable[i].dimension.targetIndex);
    }
    return cost;
  };

  // A MENOR primeiro, e este é o parafuso principal: sozinha, a ordem vale 12×
  // (0,24 contra 2,89 cruzamento grave por face, medido no acervo). A razão é
  // de desenho técnico e vale há um século: duas cotas da mesma borda têm
  // intervalos ANINHADOS — [0,196] dentro de [0,300] —, e se a maior pegar a
  // faixa mais perto da peça, a extensão da menor tem de atravessar a linha da
  // maior para chegar lá. Colocando a menor perto, cada extensão sai por fora
  // da anterior e ninguém cruza ninguém.
  const order = movable
    .map((_, i) => i)
    .sort((a, b) => movable[a].dimension.valueCm - movable[b].dimension.valueCm);

  for (const i of order) {
    let bestIndex = 0;
    let bestCost = Infinity;
    for (let c = 0; c < options[i].length; c += 1) {
      const cost = costOf(i, c, false);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = c;
      }
    }
    chosen[i] = bestIndex;
    shapes[i] = shapeOf(movable[i], options[i][bestIndex].offsetCm, params);
    placed[i] = true;
  }

  for (let pass = 0; pass < params.passes; pass += 1) {
    let improved = false;
    for (let i = 0; i < movable.length; i += 1) {
      let bestIndex = chosen[i];
      let bestCost = Infinity;
      for (let c = 0; c < options[i].length; c += 1) {
        const cost = costOf(i, c, true);
        if (cost < bestCost - 1e-6) {
          bestCost = cost;
          bestIndex = c;
        }
      }
      if (bestIndex !== chosen[i]) {
        chosen[i] = bestIndex;
        shapes[i] = shapeOf(movable[i], options[i][bestIndex].offsetCm, params);
        improved = true;
      }
    }
    if (!improved) break;
  }

  movable.forEach((item, i) => {
    const cand = options[i][chosen[i]];
    item.dimension.offsetCm = cand.offsetCm;
    item.dimension.tieCm = clamp(cand.offsetCm, item.tieLo, item.tieHi);
    item.dimension.side = cand.side;
  });
}
