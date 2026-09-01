/**
 * O contrato do cotador — o que a web e o celular recebem.
 *
 * A regra que dá sentido a este arquivo: **o servidor decide, o cliente
 * desenha.** Tudo que é DOUTRINA (o que é um adesivo, de que borda se mede, se
 * a seta vira, onde a linha de cota mora) roda aqui e existe numa cópia só; o
 * cliente recebe números prontos e não tem opinião sobre eles. Foi assim que a
 * pergunta "por que o celular mostrou 147 e a web 149?" deixou de poder existir.
 *
 * As coordenadas vêm em PONTO DE PDF da página, com a origem no canto superior
 * esquerdo — as mesmas em que o visualizador desenha. O cliente aplica o zoom
 * dele por cima e nada mais.
 */

import type { Dimension, PanelSide, Rect } from './engine/types';

/** Um item clicável: adesivo posicionável ou envelopamento. */
export interface LayoutItemDto {
  index: number;
  faceIndex: number;
  kind: 'sticker' | 'wrap';
  side: PanelSide;
  /** pegada real da tinta, em pt da página — é o que o clique testa */
  bbox: Rect;
  /** a caixa que as COTAS deste item referenciam, em pt da página */
  alignedBoxPt: Rect;
  /**
   * Contorno real do envelopamento, já DIZIMADO para desenho.
   *
   * O caminho cru chega com 25 mil pontos (MAR & RIO: 299 polígonos) e nenhum
   * cliente precisa disso para desenhar uma silhueta na tela — a web já
   * dizimava na hora de pintar. Dizimar aqui tira o mesmo peso do fio: são
   * centenas de KB por arquivo que não atravessam a rede.
   */
  outlinePt?: { x: number; y: number }[][];
  widthCm: number;
  heightCm: number;
}

export interface LayoutFaceDto {
  index: number;
  side: PanelSide;
  /** largura total (soma das seções) e altura da face, em cm reais */
  widthCm: number;
  heightCm: number;
  /** ponte pt ↔ cm: pontos de PDF por centímetro real */
  ptPerCm: number;
  /** retângulo da face na página, em pt */
  panelPt: Rect;
  /** o quanto a proporção do desenho divergiu da medida informada */
  aspectErrorPct: number;
  /** por que esta face não entrega peça para clicar — quando não entrega */
  unusable?: string;
}

export interface LayoutDimensionsDto {
  /** tamanho da página em pt, para o cliente casar o desenho com o render */
  pageWidthPt: number;
  pageHeightPt: number;
  /** página lida (1-based) e rotação aplicada */
  pageNumber: number;
  rotation: number;
  /** escala descoberta no arquivo (ou o padrão da casa) */
  detectedScale: {
    ptPerCm: number;
    denominator: number;
    agree: number;
    labels: number;
    source: 'cotas-do-arquivo' | 'padrao-da-casa';
  };
  faces: LayoutFaceDto[];
  items: LayoutItemDto[];
  dimensions: Dimension[];
  warnings: string[];
}

/**
 * As retas do desenho para o ÍMÃ da medição manual.
 *
 * Vai num pedido à parte porque é grande e quase nunca se usa: o operador abre
 * o arquivo para VER as cotas, e só às vezes pega a régua. Medido no acervo,
 * são 19 mil segmentos na mediana e 248 mil no pior arquivo — obrigar todo
 * mundo a baixar isso para abrir um layout seria pagar 300 KB (p50) a 3,9 MB
 * (máx) por um recurso que a maioria não vai tocar.
 *
 * O formato é achatado de propósito: `[x1,y1,x2,y2, x1,y1,x2,y2, …]`. Um array
 * de objetos com quatro chaves custa cinco vezes mais bytes para dizer o mesmo.
 */
export interface LayoutSnapDto {
  pageWidthPt: number;
  pageHeightPt: number;
  /** segmentos achatados, 4 números por segmento */
  segments: number[];
  /** quantos segmentos a página tinha antes de qualquer corte */
  totalSegments: number;
}
