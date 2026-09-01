/**
 * Estilo gráfico das cotas, medido nos arquivos que já saem hoje do CorelDRAW.
 *
 * Tudo em centímetro REAL do implemento, não em ponto de papel: assim o desenho
 * sai igual em qualquer escala. Os valores vieram de 150 layouts:
 * traço 0,22 pt, seta cheia de 10,6 × 5,7 pt, rótulo em Arial 36 pt, tudo a
 * 1:10 (1 cm real = 2,8346 pt).
 */

export const DIM_COLOR = { r: 0x33 / 255, g: 0x74 / 255, b: 0xa9 / 255 };
export const PANEL_COLOR = { r: 0x37 / 255, g: 0x34 / 255, b: 0x35 / 255 };

/** 1 cm real em pontos quando o desenho está a 1:10. */
export const PT_PER_CM_AT_1_10 = 72 / 2.54 / 10;

export const STYLE_CM = {
  /** espessura do traço (0,22 pt) */
  stroke: 0.22 / PT_PER_CM_AT_1_10,
  /** altura da fonte do rótulo (36 pt) */
  fontSize: 36 / PT_PER_CM_AT_1_10,
  /** comprimento da seta (10,6 pt) */
  arrowLength: 10.6 / PT_PER_CM_AT_1_10,
  /** meia-largura da seta (2,85 pt) */
  arrowHalfWidth: 2.85 / PT_PER_CM_AT_1_10,
  /** sobra da linha de extensão além da linha de cota (p50 real = 2,5 cm) */
  extensionOvershoot: 2.5,
  /** folga entre o rótulo e a linha de cota */
  labelGap: 4.5,
  /**
   * Abaixo deste valor as setas vão para FORA do vão, apontando para dentro.
   *
   * O limiar é do VALOR, não do zoom: medido em 1.723 cotas reais, abaixo de
   * 25 cm as setas ficam fora em 92–98% dos casos e acima ficam dentro em
   * 78–99%. Decidir isso por pixel de tela faz a seta virar ao dar zoom, que
   * foi como o defeito apareceu.
   */
  arrowsOutsideBelowCm: 25,
} as const;
