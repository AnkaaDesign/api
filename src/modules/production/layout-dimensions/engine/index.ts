/**
 * Cotador de layout: da arte vetorial + medidas do implemento para a face
 * cotada que o aplicador usa para colar o adesivo.
 *
 * Duas entradas:
 *  - `buildLayoutDimensions` monta o conjunto de cotas automaticamente;
 *  - `SnapIndex` + `measureBetween` atendem a medição manual no visualizador.
 */

export * from "./types";
export { readPageGeometry } from "./geometry";
export { findPanel, panelWidthCm, sectionEdgesCm, doorsCm, rectToCm } from "./panel";
export type { PanelMatch } from "./panel";
export { classify, buildItems, buildStickers, buildWraps, borderCrossings, DEFAULT_GROUPING } from "./grouping";
export type { ClassifiedPiece } from "./grouping";
export type { GroupingParams, GroupingOptions } from "./grouping";
export { trimRectToInk, makeInkTrimmer, createPageInkTrimmer } from "./ink-probe";
export type { PixelSource, TrimOptions } from "./ink-probe";
export { planDimensions, DEFAULT_DOCTRINE } from "./doctrine";
export { routeDimensions, DEFAULT_ROUTING } from "./routing";
export type { RoutableDimension, RoutingParams } from "./routing";
export type { DoctrineParams } from "./doctrine";
export { annotatePdf } from "./annotate";
export type { AnnotateEntry } from "./annotate";
export { SnapIndex, measureBetween, measurementToDimension, orientationOf } from "./measure";
export type { Measurement, SnapTarget } from "./measure";
export { DIM_COLOR, STYLE_CM, PT_PER_CM_AT_1_10 } from "./style";
export { detectScale, detectScaleFrom } from "./scale-detect";
export type { ScaleDetection } from "./scale-detect";
export { buildLayoutFaces, findPanelRects, matchFaces } from "./faces";
export type { LayoutDimensionsResult, LayoutFaceResult, LayoutItem } from "./faces";
