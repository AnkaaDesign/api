/**
 * A conta que transforma VOLUME DE TINTA em peso e em unidades de estoque.
 *
 * É a mesma pergunta em dois lugares muito diferentes da tela: "quanto de cada
 * componente esta fórmula pede?" (o quadro de disponibilidade) e "quantas latas
 * disso eu tenho de comprar?" (o pedido). Enquanto as duas contas eram cópias,
 * o número do modal e o número do pedido podiam divergir por um arredondamento
 * — e divergiriam em silêncio, porque nada compara os dois.
 *
 * As medidas do item são as duas faces da mesma embalagem: PESO ("quanto pesa
 * uma lata") e VOLUME ("quanto cabe nela"). A densidade que vale é a do ITEM,
 * não a da fórmula: a fórmula diz quanto VOLUME de cada componente entra, e
 * cada componente tem peso próprio. A densidade da fórmula só entra quando o
 * item não tem medida de volume — aí é o melhor palpite que existe.
 */

export type MeasureLike = {
  measureType: string | null;
  unit: string | null;
  value: number | null;
};

export interface ComponentDemand {
  /** gramas que a fórmula pede deste componente para o volume pedido */
  requiredGrams: number;
  /** o mesmo em unidades de estoque (latas/galões) — null sem medida de peso */
  requiredUnits: number | null;
  /** peso de UMA unidade do item, em gramas — null quando não há medida */
  weightPerUnitGrams: number | null;
  /** volume de UMA unidade do item, em ml — null quando não há medida */
  volumePerUnitMl: number | null;
  /**
   * O item tem medida de PESO. Sem ela não há conversão para unidade, e sem
   * unidade não há o que pedir: o componente aparece na lista como aviso.
   */
  measured: boolean;
}

/** Gramas de uma unidade do item, já convertendo kg → g. */
export function weightPerUnitGramsOf(measures: MeasureLike[] | null | undefined): number {
  const weight = measures?.find(m => m.measureType === 'WEIGHT');
  let grams = weight?.value ?? 0;
  if (weight?.unit === 'KILOGRAM') grams *= 1000;
  return grams > 0 ? grams : 0;
}

/** Mililitros de uma unidade do item, já convertendo L → ml. */
export function volumePerUnitMlOf(measures: MeasureLike[] | null | undefined): number {
  const volume = measures?.find(m => m.measureType === 'VOLUME');
  let ml = volume?.value ?? 0;
  if (volume?.unit === 'LITER') ml *= 1000;
  return ml > 0 ? ml : 0;
}

/**
 * Demanda de UM componente para um volume de tinta.
 *
 * @param ratio proporção do componente na fórmula, em porcento
 * @param paintVolumeMl volume de tinta a produzir, em ml
 * @param formulaDensity densidade da fórmula (g/ml), usada só como recurso
 */
export function componentDemand(
  ratio: number,
  paintVolumeMl: number,
  formulaDensity: number,
  measures: MeasureLike[] | null | undefined,
): ComponentDemand {
  const componentVolumeMl = paintVolumeMl * (ratio / 100);
  const weightPerUnitGrams = weightPerUnitGramsOf(measures);
  const volumePerUnitMl = volumePerUnitMlOf(measures);

  const requiredGrams =
    weightPerUnitGrams > 0 && volumePerUnitMl > 0
      ? componentVolumeMl * (weightPerUnitGrams / volumePerUnitMl)
      : componentVolumeMl * formulaDensity;

  const measured = weightPerUnitGrams > 0;

  return {
    requiredGrams,
    requiredUnits: measured ? requiredGrams / weightPerUnitGrams : null,
    weightPerUnitGrams: measured ? weightPerUnitGrams : null,
    volumePerUnitMl: volumePerUnitMl > 0 ? volumePerUnitMl : null,
    measured,
  };
}

const UNIT_SUFFIX: Record<string, string> = {
  KILOGRAM: 'kg',
  GRAM: 'g',
  LITER: 'L',
  MILLILITER: 'ml',
};

/**
 * Como se chama UMA unidade deste item, para quem vai conferir o pedido.
 * "3,6 L · 4,2 kg" diz mais do que "1 un" na hora de comprar.
 */
export function packageLabelOf(measures: MeasureLike[] | null | undefined): string | null {
  const parts: string[] = [];
  for (const type of ['VOLUME', 'WEIGHT'] as const) {
    const m = measures?.find(x => x.measureType === type);
    if (!m?.value || !m.unit) continue;
    const suffix = UNIT_SUFFIX[m.unit];
    if (!suffix) continue;
    parts.push(`${m.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${suffix}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
