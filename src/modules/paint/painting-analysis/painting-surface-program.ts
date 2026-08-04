/**
 * Programa A — SUPERFÍCIE (pintura geral do implemento).
 *
 * Diferente do programa B (comunicação visual), a geometria daqui não vem da arte:
 * vem de COMPRIMENTO e ALTURA (as únicas medidas digitadas). Largura, teto, chassi,
 * frames, portas traseiras e Thermo King são INFERIDOS (regra IMPLEMENT_DEFAULTS +
 * substrato). Sequência ditada pelo dono (api/PAINTING_V3_WORKFLOW_SPEC.md §3):
 *
 *   desmontagem → preparação → mascaramento → pintura (esquema de demãos)
 *   → limpeza do teto → pintura do teto → remontagem
 *
 * Toda quantidade de material sai de um RENDIMENTO configurável (regra
 * MATERIAL_YIELD) e toda tinta passa pela catálise/diluição do sistema de pintura
 * (PaintingPaintSystem) — nada de constante mágica no meio do cálculo.
 */

import type { StepVisualization } from './painting-plan-builder';

// ---- contratos ------------------------------------------------------------

export interface RateInfo {
  value: number;
  mode: string;
  crewSize: number;
  medium?: number;
  high?: number;
}

export interface CostLineDraft {
  kind: 'MATERIAL' | 'MAO_DE_OBRA' | 'SERVICO' | 'EQUIPAMENTO';
  basis: 'AREA' | 'LINEAR' | 'VOLUME' | 'UNIT' | 'TIME';
  /** Quanto de superfície/comprimento esta linha cobre — junto com `quantity` vira o rendimento. */
  basisQuantity?: number | null;
  basisUnit?: string | null;
  label: string;
  itemId?: string | null;
  paintId?: string | null;
  sizeLabel?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface StepTaskDraft {
  label: string;
  rateKey?: string | null;
  basisQuantity: number;
  basisUnit?: string | null;
  minutes: number;
  crewSize: number;
}

export interface SurfaceStepDraft {
  kind: string;
  title: string;
  description?: string;
  quantity: number;
  quantityUnit: string;
  waitMinutes?: number;
  visualization?: StepVisualization;
  tasks: StepTaskDraft[];
  materials: CostLineDraft[];
}

export interface PaintSystemInfo {
  key: string;
  label: string;
  paintTypeId: string | null;
  coatsSchedule: Array<{ role: string; systemKey: string; coats: number }>;
  mixBase: number;
  mixCatalyst: number;
  mixThinner: number;
  catalystItemId: string | null;
  thinnerItemId: string | null;
  coverageM2PerL: number;
  sprayLossPct: number;
  prepLossPct: number;
  minBatchL: number;
  cureMinutes: number;
  needsConfirmation: boolean;
}

export interface SurfaceMeasures {
  sideAreaM2: number;
  rearAreaM2: number;
  frontAreaM2: number;
  roofAreaM2: number;
  /** laterais + traseira + frente (o teto é pintado à parte, com 1 demão de laca) */
  bodyAreaM2: number;
  chassisM: number;
  frameAreaM2: number;
  framePerimeterM: number;
  /** largura inferida (cm) — não é digitada */
  widthCm: number;
  /** true quando as medidas foram estimadas a partir das faces, não digitadas */
  estimated: boolean;
}

/** Tudo o que não é digitado: sai da regra IMPLEMENT_DEFAULTS + do substrato. */
export interface ImplementInference {
  widthCm: number;
  rearDoorCount: number;
  hasThermoKing: boolean;
  frameBandCm: number;
}

export function inferImplement(rules: Map<string, any>, substrate: string): ImplementInference {
  const defaults = rules.get('IMPLEMENT_DEFAULTS') ?? {};
  const thermoKingSubstrates: string[] = Array.isArray(defaults.thermoKingSubstrates)
    ? defaults.thermoKingSubstrates
    : ['OUTRO'];
  return {
    widthCm: Number(defaults.widthCm) > 0 ? Number(defaults.widthCm) : 260,
    rearDoorCount: Number.isFinite(defaults.rearDoorCount) ? Number(defaults.rearDoorCount) : 2,
    // "Refrigerado" é o substrato que carrega o aparelho — nada de toggle na tela.
    hasThermoKing: thermoKingSubstrates.includes(substrate),
    frameBandCm: Number(defaults.frameBandCm) > 0 ? Number(defaults.frameBandCm) : 20,
  };
}

export interface SurfaceContext {
  analysis: {
    substrate: string;
    paintSystemKey: string | null;
    /** ÚNICAS medidas digitadas. */
    lengthCm: number | null;
    heightCm: number | null;
  };
  rules: Map<string, any>;
  rates: Map<string, RateInfo>;
  systems: Map<string, PaintSystemInfo>;
  /** tinta alvo (cor final) já carregada com formulas */
  targetPaint: any | null;
  /** laca de tom mais próximo da cor alvo (resolvida por ΔE restrito ao tipo Laca) */
  groundPaint: any | null;
  /** m² das faces processadas, usado só como fallback quando faltam medidas */
  faceAreaFallbackM2: number;
  itemById: Map<string, any>;
  /** preço por litro de um item (preço atual ÷ medida VOLUME/LITER) */
  pricePerLiterOfItem: (itemId: string | null | undefined) => number;
  /** preço por litro de uma tinta (fórmula com pricePerLiter > 0) */
  pricePerLiterOfPaint: (paint: any | null) => number;
}

export interface SurfaceProgramResult {
  steps: SurfaceStepDraft[];
  alerts: Array<{ code: string; severity: string; message: string }>;
  measures: SurfaceMeasures;
}

// ---- utilidades -----------------------------------------------------------

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Minutos de relógio de uma tarefa a partir da taxa de produtividade. */
export function minutesFromRate(rate: RateInfo | undefined, quantity: number): number {
  if (!rate || rate.value <= 0) return 0;
  switch (rate.mode) {
    case 'MIN_FIXED':
      return rate.value;
    case 'MIN_PER_UNIT':
      return rate.value * quantity;
    case 'CM_PER_MIN':
      return (quantity * 100) / rate.value;
    default: // M2_PER_MIN | M_PER_MIN — a quantidade já está na unidade da taxa
      return quantity / rate.value;
  }
}

/**
 * Todas as áreas saem de COMPRIMENTO e ALTURA. A largura vem da regra
 * IMPLEMENT_DEFAULTS (implementos rodoviários são padronizados), o teto é
 * comprimento × largura, o chassi acompanha o comprimento e o perímetro dos
 * frames é o contorno das quatro faces.
 */
export function surfaceMeasures(context: SurfaceContext, inference: ImplementInference): SurfaceMeasures {
  const { analysis } = context;
  const cm2ToM2 = (a: number, b: number) => (a * b) / 10_000;
  const lengthCm = analysis.lengthCm ?? 0;
  const heightCm = analysis.heightCm ?? 0;
  const widthCm = inference.widthCm;

  if (!(lengthCm > 0 && heightCm > 0)) {
    // Sem comprimento/altura, divide a área das faces processadas em proporção
    // plausível só para o plano não ficar vazio — sinalizado como estimativa.
    const total = context.faceAreaFallbackM2;
    return {
      sideAreaM2: round(total * 0.7),
      rearAreaM2: round(total * 0.15),
      frontAreaM2: round(total * 0.15),
      roofAreaM2: round(total * 0.35),
      bodyAreaM2: round(total),
      chassisM: 0,
      frameAreaM2: 0,
      framePerimeterM: 0,
      widthCm,
      estimated: true,
    };
  }

  const sideAreaM2 = round(2 * cm2ToM2(lengthCm, heightCm));
  const rearAreaM2 = round(cm2ToM2(widthCm, heightCm));
  const frontAreaM2 = rearAreaM2;
  const roofAreaM2 = round(cm2ToM2(lengthCm, widthCm));
  // contorno das duas laterais + traseira + frente
  const framePerimeterM = round((2 * 2 * (lengthCm + heightCm) + 2 * 2 * (widthCm + heightCm)) / 100);

  return {
    sideAreaM2,
    rearAreaM2,
    frontAreaM2,
    roofAreaM2,
    bodyAreaM2: round(sideAreaM2 + rearAreaM2 + frontAreaM2),
    chassisM: round(lengthCm / 100),
    frameAreaM2: round(framePerimeterM * (inference.frameBandCm / 100)),
    framePerimeterM,
    widthCm,
    estimated: false,
  };
}

// ---- tinta: catálise e diluição -------------------------------------------

export interface CoatGroup {
  role: string;
  system: PaintSystemInfo;
  coats: number;
  readyLiters: number;
  baseLiters: number;
  catalystLiters: number;
  thinnerLiters: number;
}

/**
 * Volume de MISTURA PRONTA de um grupo de demãos, quebrado em tinta, catalisador
 * e diluente pela proporção do sistema. O volume pronto é arredondado para cima
 * no lote mínimo de preparo (não se prepara 200 ml de laca).
 */
export function coatGroupVolumes(system: PaintSystemInfo, areaM2: number, coats: number): CoatGroup {
  const coverage = system.coverageM2PerL > 0 ? system.coverageM2PerL : 6;
  const losses = 1 + (system.sprayLossPct ?? 0) + (system.prepLossPct ?? 0);
  const raw = ((areaM2 * coats) / coverage) * losses;
  const batch = system.minBatchL > 0 ? system.minBatchL : 0;
  const readyLiters = batch > 0 ? Math.ceil(raw / batch) * batch : raw;

  const parts = (system.mixBase || 0) + (system.mixCatalyst || 0) + (system.mixThinner || 0);
  const share = (part: number) => (parts > 0 ? (readyLiters * part) / parts : 0);

  return {
    role: '',
    system,
    coats,
    readyLiters: round(readyLiters, 3),
    baseLiters: round(share(system.mixBase || 0), 3),
    catalystLiters: round(share(system.mixCatalyst || 0), 3),
    thinnerLiters: round(share(system.mixThinner || 0), 3),
  };
}

/** Expande o esquema de demãos do sistema em grupos com volumes calculados. */
export function expandCoatSchedule(
  system: PaintSystemInfo,
  systems: Map<string, PaintSystemInfo>,
  areaM2: number,
): CoatGroup[] {
  const schedule = Array.isArray(system.coatsSchedule) && system.coatsSchedule.length > 0
    ? system.coatsSchedule
    : [{ role: 'COLOR', systemKey: system.key, coats: 2 }];

  return schedule.map((entry) => {
    const target = systems.get(entry.systemKey) ?? system;
    const group = coatGroupVolumes(target, areaM2, entry.coats || 1);
    return { ...group, role: entry.role || 'COLOR' };
  });
}

// ---- montagem do programa --------------------------------------------------

export function buildSurfaceProgram(context: SurfaceContext): SurfaceProgramResult {
  const { analysis, rules, rates, systems } = context;
  const inference = inferImplement(rules, analysis.substrate);
  const measures = surfaceMeasures(context, inference);
  const alerts: SurfaceProgramResult['alerts'] = [];
  const steps: SurfaceStepDraft[] = [];

  if (measures.estimated) {
    alerts.push({
      code: 'MISSING_IMPLEMENT_MEASURES',
      severity: 'WARNING',
      message:
        'Comprimento e altura do implemento não foram informados — as áreas foram estimadas a partir das artes. ' +
        'Preencha as duas medidas para o orçamento ficar confiável.',
    });
  }

  const yields: Record<string, { itemId: string | null; per: number; unit: string; basis: string }> =
    rules.get('MATERIAL_YIELD') ?? {};
  const disassembly = rules.get('DISASSEMBLY_DEFAULTS') ?? { reassemble: true };

  /** Linha de material a partir do rendimento configurado (nunca de constante inline). */
  const yieldLine = (key: string, coveredQuantity: number, labelFallback: string): CostLineDraft | null => {
    const entry = yields[key];
    if (!entry || coveredQuantity <= 0) return null;
    const item = entry.itemId ? context.itemById.get(entry.itemId) : null;
    const per = entry.per > 0 ? entry.per : 1;
    const isVolume = entry.unit === 'L';
    const rawQuantity = coveredQuantity / per;
    // consumíveis discretos (lixa, scotch brite, estopa) sobem para a unidade inteira
    const quantity = isVolume || entry.unit === 'm²' || entry.unit === 'm'
      ? round(rawQuantity, 2)
      : Math.max(1, Math.ceil(rawQuantity));
    const unitPrice = isVolume
      ? context.pricePerLiterOfItem(entry.itemId)
      : Number(item?.prices?.[0]?.value ?? 0);
    return {
      kind: 'MATERIAL',
      basis: entry.basis === 'LINEAR' ? 'LINEAR' : entry.unit === 'L' ? 'VOLUME' : entry.unit === 'un' ? 'UNIT' : 'AREA',
      basisQuantity: round(coveredQuantity, 2),
      basisUnit: entry.basis === 'LINEAR' ? 'm' : 'm²',
      label: item?.name ?? labelFallback,
      itemId: entry.itemId ?? null,
      quantity,
      unit: entry.unit,
      unitPrice,
    };
  };

  const task = (label: string, rateKey: string, quantity: number, unit: string | null): StepTaskDraft => {
    const rate = rates.get(rateKey);
    return {
      label,
      rateKey,
      basisQuantity: round(quantity, 2),
      basisUnit: unit,
      minutes: round(minutesFromRate(rate, quantity), 1),
      // Sempre individual: o custo é minutos × custo-hora, sem multiplicar por equipe.
      crewSize: 1,
    };
  };

  // ---- A1 desmontagem ----------------------------------------------------
  const doors = Math.max(0, inference.rearDoorCount);
  const hasThermoKing = inference.hasThermoKing;
  if (doors > 0 || hasThermoKing) {
    const tasks: StepTaskDraft[] = [];
    if (doors > 0) tasks.push(task(`Desmontar portas traseiras (${doors})`, 'DISASSEMBLY_DOOR_MIN', doors, 'porta'));
    if (hasThermoKing) {
      tasks.push(task('Desmontar o aparelho Thermo King', 'DISASSEMBLY_THERMOKING_MIN', 1, 'un'));
    }
    steps.push({
      kind: 'DESMONTAGEM',
      title: 'Desmontagem das portas traseiras',
      description: 'Primeiro passo da pintura geral — não consome material, só mão de obra.',
      quantity: doors,
      quantityUnit: 'porta(s)',
      tasks,
      materials: [],
    });
  }

  // ---- A2 preparação -----------------------------------------------------
  const sandArea = measures.rearAreaM2 + measures.frontAreaM2;
  const prepTasks: StepTaskDraft[] = [
    task('Lavagem das laterais', 'WASH_M2_PER_MIN', measures.sideAreaM2, 'm²'),
    task('Secagem', 'DRY_M2_PER_MIN', measures.sideAreaM2, 'm²'),
    task('Desengraxe das laterais', 'DEGREASE_M2_PER_MIN', measures.sideAreaM2, 'm²'),
    task('Lixamento da traseira e da frente', 'SAND_STEEL_M2_PER_MIN', sandArea, 'm²'),
  ];
  if (hasThermoKing) {
    prepTasks.push(task('Lixamento das peças do Thermo King', 'SAND_THERMOKING_MIN', 1, 'un'));
  }
  prepTasks.push(task('Desengraxe final', 'DEGREASE_M2_PER_MIN', measures.bodyAreaM2, 'm²'));

  steps.push({
    kind: 'PREPARACAO',
    title: 'Preparação da superfície',
    description: 'Lavagem, secagem e desengraxe das laterais; lixamento da traseira, da frente e das peças; desengraxe final.',
    quantity: measures.bodyAreaM2,
    quantityUnit: 'm²',
    tasks: prepTasks,
    materials: [
      yieldLine('intercap', measures.bodyAreaM2, 'Intercap'),
      yieldLine('scotchBrite', measures.sideAreaM2, 'Scotch Brite'),
      yieldLine('cottonRag', measures.bodyAreaM2, 'Estopa de Pano'),
      yieldLine('sandpaper220', sandArea, 'Lixa Hookit P220'),
      yieldLine('sandpaper320', sandArea, 'Lixa Hookit P320'),
      yieldLine('degreaser', measures.sideAreaM2 + measures.bodyAreaM2, 'Desengraxante'),
    ].filter((line): line is CostLineDraft => line !== null),
  });

  // ---- A3 mascaramento ---------------------------------------------------
  const maskTasks: StepTaskDraft[] = [];
  if (measures.chassisM > 0) {
    maskTasks.push(task('Líquido de mascaramento no chassi', 'LIQUID_MASK_M_PER_MIN', measures.chassisM, 'm'));
  }
  if (measures.frameAreaM2 > 0) {
    maskTasks.push(task('Papel e fita nos frames metálicos', 'FRAME_MASK_M2_PER_MIN', measures.frameAreaM2, 'm²'));
  }
  if (maskTasks.length > 0) {
    steps.push({
      kind: 'MASCARAMENTO',
      title: 'Mascaramento para pintura',
      description: 'Líquido de mascaramento protege o chassi; papel e fita cobrem os frames metálicos.',
      quantity: measures.frameAreaM2,
      quantityUnit: 'm²',
      tasks: maskTasks,
      materials: [
        yieldLine('liquidMask', measures.chassisM, 'Líq. de Mascaramento'),
        yieldLine('paper', measures.frameAreaM2, 'Bobina Papel TKV'),
        yieldLine('crepeTape', measures.framePerimeterM, 'Fita Crepe Automotiva'),
      ].filter((line): line is CostLineDraft => line !== null),
    });
  }

  // ---- A4 pintura geral --------------------------------------------------
  // Sem escolha explícita o plano NÃO trava: cai no sistema padrão (regra
  // DEFAULT_PAINT_SYSTEM) e avisa qual foi usado.
  const chosen = analysis.paintSystemKey ? systems.get(analysis.paintSystemKey) : undefined;
  const defaultKey = rules.get('DEFAULT_PAINT_SYSTEM')?.key;
  const fallback = defaultKey ? systems.get(defaultKey) : undefined;
  const system = chosen ?? fallback ?? [...systems.values()][0];
  if (!chosen && system) {
    alerts.push({
      code: 'PAINT_SYSTEM_DEFAULTED',
      severity: 'INFO',
      message: `Nenhum sistema de pintura foi escolhido — o plano usou o padrão "${system.label}". Troque no cadastro se for outro.`,
    });
  }
  if (!system) {
    alerts.push({
      code: 'MISSING_PAINT_SYSTEM',
      severity: 'ERROR',
      message: 'Nenhum sistema de pintura cadastrado — rode o seed de configuração de pintura.',
    });
  } else {
    if (system.needsConfirmation) {
      alerts.push({
        code: 'PAINT_SYSTEM_ESTIMATED',
        severity: 'INFO',
        message: `Os parâmetros do sistema "${system.label}" (rendimento, lote mínimo, cura) ainda são estimativas — confirme nas configurações.`,
      });
    }
    const groups = expandCoatSchedule(system, systems, measures.bodyAreaM2);
    steps.push({
      kind: 'PINTURA',
      title: `Pintura geral — ${system.label}`,
      description: groups
        .map((group) => `${group.coats} demão(s) de ${group.system.label}${group.role === 'GROUND' ? ' (tom próximo)' : ''}`)
        .join(' + '),
      quantity: round(measures.bodyAreaM2 * groups.reduce((sum, group) => sum + group.coats, 0)),
      quantityUnit: 'm²·demão',
      waitMinutes: groups[groups.length - 1]?.system.cureMinutes ?? 0,
      tasks: groups.map((group) =>
        task(
          `${group.coats} demão(s) de ${group.system.label}${group.role === 'GROUND' ? ' — tom próximo' : ''}`,
          'PAINT_COAT_M2_PER_MIN',
          measures.bodyAreaM2 * group.coats,
          'm²',
        ),
      ),
      materials: groups.flatMap((group) => coatGroupLines(group, context, { areaM2: measures.bodyAreaM2 })),
    });
  }

  // ---- A5/A6 teto --------------------------------------------------------
  // O teto é SEMPRE pintado na pintura geral — não é opção de tela.
  if (measures.roofAreaM2 > 0) {
    steps.push({
      kind: 'LIMPEZA_TETO',
      title: 'Limpeza do teto para pintura',
      quantity: measures.roofAreaM2,
      quantityUnit: 'm²',
      tasks: [task('Limpeza do teto', 'ROOF_CLEAN_M2_PER_MIN', measures.roofAreaM2, 'm²')],
      materials: [
        yieldLine('degreaser', measures.roofAreaM2, 'Desengraxante'),
        yieldLine('cottonRag', measures.roofAreaM2, 'Estopa de Pano'),
      ].filter((line): line is CostLineDraft => line !== null),
    });

    const lacquer = systems.get('LACA');
    if (lacquer) {
      const roofGroup = { ...coatGroupVolumes(lacquer, measures.roofAreaM2, 1), role: 'COLOR' };
      steps.push({
        kind: 'PINTURA_TETO',
        title: 'Pintura do teto',
        description: 'Uma demão de laca no tom mais próximo da cor — o teto nunca recebe a cor final.',
        quantity: measures.roofAreaM2,
        quantityUnit: 'm²',
        waitMinutes: lacquer.cureMinutes,
        tasks: [task('1 demão de laca (tom próximo)', 'PAINT_COAT_M2_PER_MIN', measures.roofAreaM2, 'm²')],
        materials: coatGroupLines(roofGroup, context, { forceGround: true, areaM2: measures.roofAreaM2 }),
      });
    }
  }

  // ---- A7 remontagem -----------------------------------------------------
  if (disassembly.reassemble !== false && (doors > 0 || hasThermoKing)) {
    const tasks: StepTaskDraft[] = [];
    if (doors > 0) tasks.push(task(`Remontar portas traseiras (${doors})`, 'REASSEMBLY_DOOR_MIN', doors, 'porta'));
    if (hasThermoKing) {
      tasks.push(task('Remontar o aparelho Thermo King', 'REASSEMBLY_THERMOKING_MIN', 1, 'un'));
    }
    steps.push({
      kind: 'REMONTAGEM',
      title: 'Remontagem das portas traseiras',
      quantity: doors,
      quantityUnit: 'porta(s)',
      tasks,
      materials: [],
    });
  }

  return { steps, alerts, measures };
}

/** Linhas de custo de um grupo de demãos: tinta + catalisador + diluente. */
function coatGroupLines(
  group: CoatGroup,
  context: SurfaceContext,
  options: { forceGround?: boolean; areaM2?: number } = {},
): CostLineDraft[] {
  const lines: CostLineDraft[] = [];
  // Base da tinta = m² efetivamente cobertos (área × demãos) → rendimento real por litro.
  const coveredM2 = options.areaM2 != null ? round(options.areaM2 * group.coats, 2) : null;
  const isGround = options.forceGround || group.role === 'GROUND';
  const isClear = group.role === 'CLEAR';

  if (isClear) {
    const varnishItemId = (context.rules.get('MATERIAL_MAP') ?? {}).varnishItemId ?? null;
    const item = varnishItemId ? context.itemById.get(varnishItemId) : null;
    lines.push({
      kind: 'MATERIAL',
      basis: 'VOLUME',
      basisQuantity: coveredM2,
      basisUnit: coveredM2 != null ? 'm²' : null,
      label: item?.name ?? 'Verniz',
      itemId: varnishItemId,
      quantity: group.baseLiters,
      unit: 'L',
      unitPrice: context.pricePerLiterOfItem(varnishItemId),
    });
  } else {
    const paint = isGround ? context.groundPaint : context.targetPaint;
    lines.push({
      kind: 'MATERIAL',
      basis: 'VOLUME',
      basisQuantity: coveredM2,
      basisUnit: coveredM2 != null ? 'm²' : null,
      label: paint?.name
        ? `Tinta ${paint.name}${isGround ? ' (tom próximo)' : ''}`
        : isGround
          ? 'Laca de tom próximo'
          : 'Tinta da cor final',
      paintId: paint?.id ?? null,
      quantity: group.baseLiters,
      unit: 'L',
      unitPrice: context.pricePerLiterOfPaint(paint),
    });
  }

  if (group.catalystLiters > 0) {
    const item = group.system.catalystItemId ? context.itemById.get(group.system.catalystItemId) : null;
    lines.push({
      kind: 'MATERIAL',
      basis: 'VOLUME',
      basisQuantity: coveredM2,
      basisUnit: coveredM2 != null ? 'm²' : null,
      label: item?.name ? `Catalisador — ${item.name}` : 'Catalisador',
      itemId: group.system.catalystItemId,
      quantity: group.catalystLiters,
      unit: 'L',
      unitPrice: context.pricePerLiterOfItem(group.system.catalystItemId),
    });
  }
  if (group.thinnerLiters > 0) {
    const item = group.system.thinnerItemId ? context.itemById.get(group.system.thinnerItemId) : null;
    lines.push({
      kind: 'MATERIAL',
      basis: 'VOLUME',
      basisQuantity: coveredM2,
      basisUnit: coveredM2 != null ? 'm²' : null,
      label: item?.name ? `Diluente — ${item.name}` : 'Diluente',
      itemId: group.system.thinnerItemId,
      quantity: group.thinnerLiters,
      unit: 'L',
      unitPrice: context.pricePerLiterOfItem(group.system.thinnerItemId),
    });
  }
  return lines;
}
