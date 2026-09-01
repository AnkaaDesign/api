/**
 * Tipos do cotador de layout.
 *
 * Tudo em duas unidades e nunca em três: `pt` é ponto de PDF na página (origem
 * no canto superior esquerdo, y para baixo, como o visualizador desenha) e `cm`
 * é centímetro REAL do implemento. A conversão entre as duas mora em `Scale`.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Matrix = [number, number, number, number, number, number];

export type RGB = [number, number, number];

export type PaintOp = "fill" | "stroke" | "fillStroke" | "clip" | "image" | "text";

/** Um objeto desenhado na página, já com a matriz corrente aplicada. */
export interface VectorObject {
  index: number;
  op: PaintOp;
  bbox: Rect;
  /** Contorno achatado (curvas viram polilinhas). Vazio para imagem. */
  outline: Pt[][];
  fill: RGB | null;
  stroke: RGB | null;
  lineWidth: number;
  text?: string;
  fontSize?: number;
  /**
   * Object reconstructed from a shadingFill (gradient) — its outline is the
   * active clip path. Real art for grouping, but NOT a face-frame candidate:
   * a rectangular gradient clip is soft art, never the panel border.
   */
  fromShading?: boolean;
}

export interface PageGeometry {
  width: number;
  height: number;
  objects: VectorObject[];
}

/** Ponte entre o ponto do PDF e o centímetro real do implemento. */
export interface Scale {
  /** pontos de PDF por centímetro real. */
  ptPerCm: number;
  /** Retângulo da face dentro da página, em pt. */
  panelPt: Rect;
}

export type PanelSide = "MOTORISTA" | "SAPO" | "TRASEIRA";

export interface PanelSection {
  widthCm: number;
  isDoor: boolean;
  doorHeightCm?: number | null;
}

/** A face do implemento, como vem de `ImplementMeasure`. */
export interface Panel {
  side: PanelSide;
  heightCm: number;
  sections: PanelSection[];
}

export type DimensionKind =
  | "EDGE_LEFT"
  | "EDGE_RIGHT"
  | "EDGE_TOP"
  | "EDGE_BOTTOM"
  | "BLEED_TOP"
  | "BLEED_BOTTOM"
  | "BLEED_LEFT"
  | "BLEED_RIGHT"
  | "RELATIVE_V"
  | "RELATIVE_H"
  | "MANUAL";

/**
 * De que lado do item a linha de cota mora, no eixo PERPENDICULAR ao que ela
 * mede. `min` é acima (cota horizontal) ou à esquerda (cota vertical); `max` é
 * abaixo ou à direita. `inside` é a cota relativa, que fica entre duas peças.
 */
export type DimensionSide = "min" | "max" | "inside";

/** Uma cota em coordenadas da face (cm, origem no canto superior esquerdo). */
export interface Dimension {
  id: string;
  axis: "H" | "V";
  /** início e fim ao longo do eixo da cota, em cm da face. */
  aCm: number;
  bCm: number;
  /** posição da linha de cota no eixo perpendicular, em cm da face. */
  offsetCm: number;
  /**
   * Onde as linhas de extensão terminam, no eixo perpendicular.
   *
   * É o que amarra a cota ao adesivo: a extensão sai da linha de cota e vai
   * até ENCOSTAR no item medido. Sem isso o número fica solto na margem e o
   * aplicador não sabe a que peça ele se refere — foi medido em 2.780 de 3.348
   * linhas de extensão dos projetistas, com folga mediana de 0 cm até a peça.
   */
  tieCm: number;
  side: DimensionSide;
  valueCm: number;
  kind: DimensionKind;
  source: "auto" | "manual";
  /** Rótulo curto do que está sendo medido, para a lista lateral. */
  target?: string;
  /** Índice do adesivo medido, para filtrar as cotas de um item só. */
  targetIndex?: number;
  /**
   * Os outros itens que esta cota também mede.
   *
   * Duas peças que assentam na mesma altura geram a MESMA cota vertical, e o
   * desenho só pode trazer uma — desenhar as duas põe número em cima de número.
   * Mas o visualizador filtra as cotas pelo item escolhido, e a que sobrou
   * pertence à outra peça: clicar em "Saúde" mostrava só a distância lateral,
   * porque a altura ficou registrada em "Alimentando". Aqui a cota sobrevivente
   * carrega consigo quem mais ela explica.
   */
  alsoTargets?: number[];
  note?: string;
}

/**
 * A LINHA DE ALINHAMENTO de um lado da peça.
 *
 * Não é a extremidade da caixa. Em "Supermercado" o "p" desce sozinho abaixo de
 * todas as outras letras: cotar até ele dá um número certo e inútil, porque não
 * existe nada para alinhar naquela altura. A linha que o aplicador usa é a que
 * reúne a maior parte da forma — a base onde S, u, e, r, m, c, a, d, o se
 * apoiam. O mesmo vale em cima, onde o acento e a haste alta são exceção.
 *
 * `at` é a coordenada dessa linha; `from`/`to` marcam onde, no eixo
 * perpendicular, ela tem material — é dali que a linha de extensão sai.
 */
export interface AlignedEdge {
  at: number;
  from: number;
  to: number;
  /** fração da forma que se apoia nesta linha, de 0 a 1 */
  support: number;
  /** extremo absoluto do lado, para quando o desenho precisar dele */
  extreme: number;
  /** por que a linha é essa. Diagnóstico, não decisão. */
  origin?: "extreme" | "aligned";
}

export interface PartEdges {
  top: AlignedEdge;
  bottom: AlignedEdge;
  left: AlignedEdge;
  right: AlignedEdge;
}

/**
 * Por quais EIXOS o item sangra — não por quantas arestas ele encosta.
 *
 * A diferença decide o que se pode cotar. Uma faixa colada na quina esquerda
 * encosta na esquerda, no teto e no piso: três arestas, e o motor antigo
 * concluía "envelopamento, não tem posição". Mas ela tem, sim, posição
 * horizontal — o que falta é a vertical, porque ela varre a altura inteira.
 * Contando PARES OPOSTOS, some a confusão: só perde a posição horizontal quem
 * encosta na esquerda E na direita.
 *
 * Medido nos 420 envelopamentos do acervo: apenas 11,7% sangram nos dois eixos.
 * Os outros 88,3% têm ao menos uma posição a cotar, e o motor a jogava fora.
 */
export interface BleedAxes {
  edges: PanelEdge[];
  /** encosta na esquerda E na direita: não há posição horizontal a cotar */
  horizontal: boolean;
  /** encosta em cima E embaixo: não há posição vertical a cotar */
  vertical: boolean;
}

/** Um adesivo: o conjunto que recebe uma cota, com as peças que o formam. */
export interface Sticker {
  bbox: Rect;
  /** em cm da face. */
  boxCm: Rect;
  parts: Rect[];
  partsCm: Rect[];
  /** linhas de alinhamento de cada peça, em cm da face (mesma ordem de `partsCm`) */
  partEdgesCm: PartEdges[];
  /**
   * A caixa que a cota realmente referencia, montada com as quatro linhas de
   * alinhamento. Não é a caixa da tinta: em "Do campo para o seu negócio!" ela
   * assenta na base dos "o" e deixa de fora a perna do "p", a do "g" e o topo
   * do "D". Mostrar esta é o que faz o desenho se explicar sozinho.
   */
  alignedBox: Rect;
  alignedBoxCm: Rect;
  areaCm2: number;
  /** true quando é envelopamento: sangra pelos DOIS eixos e não tem posição a cotar */
  bleeds: boolean;
  /** por quais eixos o item sangra — a posição do eixo livre ainda se cota */
  bleedAxes: BleedAxes;
  /**
   * Contorno real, em pt da página.
   *
   * Só o envelopamento traz: a forma dele é côncava e a caixa mente. Mostrar o
   * retângulo faz parecer que a cota não bate com o desenho, quando quem não
   * bate é a caixa.
   */
  outlinePt?: Pt[][];
}

export type PanelEdge = "top" | "bottom" | "left" | "right";

export interface BorderCrossing {
  edge: PanelEdge;
  startCm: number;
  endCm: number;
  /** índice do envelopamento que produziu a travessia */
  wrapIndex: number;
}
