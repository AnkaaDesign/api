import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { findSimilarColors } from '../../../utils/paint';
import type { PaintingComputeFormData } from '../../../schemas/painting-analysis';
import {
  type FaceLayoutJson,
  type StepVisualization,
  SceneBuilder,
  normalizeLayout,
  adhesiveMaterialsByWidth,
  bandRects,
  generalPaintStep,
  orderSessions,
  paperRects,
  windowAreaOfSession,
} from './painting-plan-builder';
import {
  type CostLineDraft,
  type PaintSystemInfo,
  type StepTaskDraft,
  type SurfaceContext,
  buildSurfaceProgram,
} from './painting-surface-program';

/**
 * Business half of the pipeline (the Python engine is the geometry half).
 * Stages are independently invocable (POST /:id/compute { stages: [...] }):
 *  - MATCH    ΔE paint matching (region.colorHex -> Paint via banco de tintas)
 *  - STRATEGY rules-as-data decisions (region strategy + boundary resolution)
 *  - PLAN     sessions/ordering + quantities + costing + step-by-step plan
 */
@Injectable()
export class PaintingComputeService {
  private readonly logger = new Logger(PaintingComputeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async compute(analysisId: string, options: PaintingComputeFormData) {
    const stages = options.stages?.length ? options.stages : (['MATCH', 'STRATEGY', 'PLAN'] as const);
    const ran: string[] = [];
    if (stages.includes('MATCH')) {
      await this.runMatch(analysisId);
      ran.push('MATCH');
    }
    if (stages.includes('STRATEGY')) {
      await this.runStrategy(analysisId);
      ran.push('STRATEGY');
    }
    if (stages.includes('PLAN')) {
      await this.runPlan(analysisId);
      ran.push('PLAN');
    }
    const analysis = await this.prisma.paintingAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        faces: { include: { regions: { include: { paint: true } }, boundaries: true } },
        plan: {
          include: {
            steps: {
              include: { materials: { orderBy: { position: 'asc' } }, tasks: { orderBy: { position: 'asc' } } },
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });
    return {
      success: true,
      message: `Etapas recalculadas: ${ran.join(', ')}.`,
      data: analysis,
    };
  }

  // =====================================================================
  // helpers
  // =====================================================================

  private async loadRules(): Promise<Map<string, any>> {
    const rules = await this.prisma.paintingStrategyRule.findMany({ where: { active: true } });
    return new Map(rules.map((rule) => [rule.key, rule.params as any]));
  }

  private async loadRates(): Promise<
    Map<string, { value: number; medium: number; high: number; mode: string; crewSize: number }>
  > {
    const rates = await this.prisma.paintingProductivityRate.findMany();
    return new Map(
      rates.map((rate) => [
        rate.key,
        {
          value: rate.value,
          medium: rate.complexityFactorMedium,
          high: rate.complexityFactorHigh,
          mode: rate.mode,
          crewSize: rate.crewSize ?? 1,
        },
      ]),
    );
  }

  /** Sistemas de pintura ativos (esquema de demãos + catálise/diluição). */
  private async loadPaintSystems(): Promise<Map<string, PaintSystemInfo>> {
    const systems = await this.prisma.paintingPaintSystem.findMany({
      where: { active: true },
      orderBy: { position: 'asc' },
    });
    return new Map(
      systems.map((system) => [
        system.key,
        {
          key: system.key,
          label: system.label,
          paintTypeId: system.paintTypeId,
          coatsSchedule: (system.coatsSchedule as any) ?? [],
          mixBase: system.mixBase,
          mixCatalyst: system.mixCatalyst,
          mixThinner: system.mixThinner,
          catalystItemId: system.catalystItemId,
          thinnerItemId: system.thinnerItemId,
          coverageM2PerL: system.coverageM2PerL,
          sprayLossPct: system.sprayLossPct,
          prepLossPct: system.prepLossPct,
          minBatchL: system.minBatchL,
          cureMinutes: system.cureMinutes,
          needsConfirmation: system.needsConfirmation,
        },
      ]),
    );
  }

  /**
   * Laca de tom mais próximo da cor alvo — ΔE restrito ao PaintType do sistema
   * LACA (o match genérico devolvia qualquer tipo de tinta).
   */
  private async findGroundPaint(targetHex: string | null, systems: Map<string, PaintSystemInfo>) {
    const lacquerTypeId = systems.get('LACA')?.paintTypeId;
    if (!targetHex || !lacquerTypeId || !/^#[0-9a-fA-F]{6}$/.test(targetHex)) return null;
    const candidates = await this.prisma.paint.findMany({
      where: { paintTypeId: lacquerTypeId },
      select: { id: true, hex: true, name: true },
    });
    if (candidates.length === 0) return null;
    // ATENÇÃO: o 3º argumento é um LIMIAR de ΔE, não uma contagem. O tom próximo
    // é sempre o melhor disponível, então o limiar é largo e pegamos o 1º (já ordenado).
    const { data } = findSimilarColors(candidates as any, targetHex, 100);
    const best = data[0] as any;
    if (!best) return null;
    return this.prisma.paint.findUnique({
      where: { id: best.id },
      include: { paintType: true, formulas: true },
    });
  }

  private async getAnalysisOrThrow(analysisId: string) {
    const analysis = await this.prisma.paintingAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        faces: {
          include: {
            regions: { include: { paint: { include: { paintType: true, formulas: true } } } },
            boundaries: true,
          },
        },
      },
    });
    if (!analysis) throw new NotFoundException('Análise não encontrada.');
    return analysis;
  }

  // =====================================================================
  // MATCH — ΔE against the paint bank
  // =====================================================================

  private async runMatch(analysisId: string) {
    const analysis = await this.getAnalysisOrThrow(analysisId);
    const paints = await this.prisma.paint.findMany({
      select: { id: true, hex: true, name: true, finish: true },
    });
    if (paints.length === 0) return;

    // Uma cor chapada do mockup não pede tinta metálica/perolizada: o ΔE sozinho
    // devolvia "Laranja MBB Metálico" para um bege liso. Efeito só entra quando a
    // região foi classificada como metálica/degradê pelo motor.
    const solidPaints = paints.filter((paint: any) => paint.finish === 'SOLID' || paint.finish === 'MATTE');
    const paintsFor = (kind: string) =>
      kind === 'CHAPADA' || kind === 'MICRO' || kind === 'TEXTURA' ? (solidPaints.length > 0 ? solidPaints : paints) : paints;

    for (const face of analysis.faces) {
      for (const region of face.regions) {
        if (region.kind === 'RESERVA' || region.paintSource === 'MANUAL') continue;
        if (!/^#[0-9a-fA-F]{6}$/.test(region.colorHex)) continue;
        const { data } = findSimilarColors(paintsFor(region.kind) as any, region.colorHex, 30);
        const best = data[0] ?? null;
        await this.prisma.paintingRegion.update({
          where: { id: region.id },
          data: { paintId: best ? (best as any).id : null, paintSource: 'AUTO' },
        });
      }
      if (
        face.backgroundMode === 'GENERAL_PAINT' &&
        face.backgroundHex &&
        !face.backgroundPaintId &&
        /^#[0-9a-fA-F]{6}$/.test(face.backgroundHex)
      ) {
        const { data } = findSimilarColors(paints as any, face.backgroundHex, 30);
        const best = data[0] ?? null;
        if (best) {
          await this.prisma.paintingAnalysisFace.update({
            where: { id: face.id },
            data: { backgroundPaintId: (best as any).id },
          });
        }
      }
    }
  }

  // =====================================================================
  // STRATEGY — rules-as-data
  // =====================================================================

  private async runStrategy(analysisId: string) {
    const analysis = await this.getAnalysisOrThrow(analysisId);
    const rules = await this.loadRules();
    const rates = await this.loadRates();

    const minCuttableMm = rules.get('MIN_CUTTABLE_STROKE_MM')?.mm ?? 8;
    // Limite FÍSICO da plotter. Entre ele e MIN_CUTTABLE_STROKE_MM o traço ainda é
    // recortável — só que difícil (recorte fino de alta complexidade). Antes tudo
    // abaixo de 8 mm virava aerografia, o que enchia de aerografia arte que não tem.
    const minPlotterMm = rules.get('MIN_PLOTTER_STROKE_MM')?.mm ?? 2;
    // Lascas de antialiasing não merecem estratégia própria — herdam o recorte.
    const minStrategyAreaM2 = rules.get('MIN_STRATEGY_AREA_M2')?.m2 ?? 0.002;
    const stencilMinArea = rules.get('STENCIL_MIN_AREA_M2')?.m2 ?? 4;
    const stencilMaxRatio = rules.get('STENCIL_MAX_PERIMETER_RATIO')?.ratio ?? 2.5;
    const breakevenMin = rules.get('CURE_VS_CUT_BREAKEVEN_MIN')?.minutes ?? 60;
    const tapeOverlap = rules.get('TAPE_OVERLAP_PCT')?.pct ?? 0.15;

    for (const face of analysis.faces) {
      for (const region of face.regions) {
        if (region.strategySource === 'MANUAL') continue;
        let strategy: string;
        switch (region.kind) {
          case 'RESERVA':
            strategy = 'NENHUMA';
            break;
          case 'FOTOGRAFICO':
            strategy = 'AEROGRAFIA_ARTISTICA';
            break;
          case 'DEGRADE':
            // Degradê minúsculo é ruído de compressão do mockup, não trabalho de aerógrafo.
            strategy = region.areaM2 >= minStrategyAreaM2 ? 'AEROGRAFIA' : 'ADESIVO_RECORTE';
            break;
          case 'MICRO':
            // Doutrina da casa: micro-texto é recorte fino + pintura. Aerografia à
            // mão livre só abaixo do que a plotter consegue cortar, e nunca por
            // causa de uma lasca de poucos cm².
            strategy =
              region.minStrokeMm > 0 &&
              region.minStrokeMm < minPlotterMm &&
              region.areaM2 >= minStrategyAreaM2
                ? 'AEROGRAFIA'
                : 'ADESIVO_RECORTE';
            break;
          case 'TEXTURA':
            strategy = 'ADESIVO_RECORTE';
            break;
          default: {
            const ratio = region.areaM2 > 0 ? region.perimeterM / region.areaM2 : Infinity;
            const stencilOk =
              region.areaM2 >= stencilMinArea && ratio <= stencilMaxRatio && region.islands <= 2;
            strategy = stencilOk ? 'STENCIL' : 'ADESIVO_RECORTE';
          }
        }
        await this.prisma.paintingRegion.update({
          where: { id: region.id },
          data: { strategy: strategy as any, strategySource: 'AUTO' },
        });
      }

      const regionByEngineId = new Map(face.regions.map((region) => [region.engineId, region]));
      const minBoundaryM = rules.get('MIN_TT_BOUNDARY_M')?.m ?? 0.3;
      for (const boundary of face.boundaries) {
        if (boundary.resolutionSource === 'MANUAL') continue;
        let resolution = 'NENHUMA';
        let cutLengthM = 0;
        let tapeLengthM = 0;
        const sideA = regionByEngineId.get(boundary.regionAId);
        const sideB = boundary.regionBId ? regionByEngineId.get(boundary.regionBId) : undefined;
        const touchesArtistic =
          sideA?.kind === 'FOTOGRAFICO' ||
          sideB?.kind === 'FOTOGRAFICO' ||
          sideA?.strategy === 'AEROGRAFIA_ARTISTICA' ||
          sideB?.strategy === 'AEROGRAFIA_ARTISTICA';
        if (boundary.kind === 'PAINT_PAINT' && !touchesArtistic && boundary.lengthM >= minBoundaryM) {
          const hist = (boundary.curveHist as Record<string, number>) ?? {};
          const total = Object.values(hist).reduce((sum, value) => sum + (value || 0), 0);
          const straight = hist.RETA ?? 0;
          const gentle = hist.SUAVE ?? 0;
          const tight = (hist.FECHADA ?? 0) + (hist.EXTREMA ?? 0);
          const cutMinutes = this.estimateCutMinutes(hist, rates);

          if (total === 0) {
            resolution = 'CURA_ADESIVO';
          } else if (tight / total > 0.2 || boundary.dominantCurve === 'EXTREMA') {
            resolution = 'CURA_ADESIVO';
          } else if ((gentle + straight) / total > 0.7 && boundary.dominantCurve === 'SUAVE') {
            resolution = 'FITA_FLEXIVEL';
          } else if (cutMinutes > breakevenMin) {
            resolution = 'CURA_ADESIVO';
          } else {
            resolution = 'FITA_CORTE';
          }
          if (resolution === 'FITA_CORTE') {
            cutLengthM = boundary.lengthM;
            tapeLengthM = boundary.lengthM * (1 + tapeOverlap);
          } else if (resolution === 'FITA_FLEXIVEL') {
            tapeLengthM = boundary.lengthM * (1 + tapeOverlap);
          }
        }
        await this.prisma.paintingBoundary.update({
          where: { id: boundary.id },
          data: {
            resolution: resolution as any,
            resolutionSource: 'AUTO',
            cutLengthM: Number(cutLengthM.toFixed(3)),
            tapeLengthM: Number(tapeLengthM.toFixed(3)),
          },
        });
      }
    }
  }

  private estimateCutMinutes(hist: Record<string, number>, rates: Map<string, any>): number {
    const straightRate = rates.get('CUT_STRAIGHT_CM_PER_MIN')?.value ?? 60;
    const mediumRate = rates.get('CUT_CURVE_MEDIUM_CM_PER_MIN')?.value ?? 25;
    const tightRate = rates.get('CUT_CURVE_TIGHT_CM_PER_MIN')?.value ?? 10;
    const cm = (m?: number) => (m ?? 0) * 100;
    return (
      cm(hist.RETA) / straightRate +
      (cm(hist.SUAVE) + cm(hist.MEDIA)) / mediumRate +
      (cm(hist.FECHADA) + cm(hist.EXTREMA)) / tightRate
    );
  }

  // =====================================================================
  // PLAN — sessions, quantities, costing, step-by-step
  // =====================================================================

  private async runPlan(analysisId: string) {
    const analysis = await this.getAnalysisOrThrow(analysisId);
    const rules = await this.loadRules();
    const rates = await this.loadRates();
    const processParams = await this.prisma.paintingProcessParameter.findMany();
    const paramsByType = new Map(processParams.map((param) => [param.paintTypeId ?? '', param]));
    const defaultProcess = {
      coatsDefault: 2,
      coverageM2PerL: 6,
      sprayLossPct: 0.15,
      prepLossPct: 0.05,
      cureMinutes: 180,
      needsClearCoat: true,
    };

    const hourly = rules.get('LABOR_RATE')?.hourlyBRL ?? 21.3;
    const workdayMinutes = rules.get('WORKDAY_MINUTES')?.minutes ?? 480;
    const materialMap: Record<string, string | null> = rules.get('MATERIAL_MAP') ?? {};
    const reformDefaults = rules.get('REFORM_DEFAULTS') ?? { reflectiveLinearMPerSide: 15, sealLinearMPerSide: 20 };
    const liquidMaskM2 = rules.get('LIQUID_MASK_DEFAULT_M2')?.m2 ?? 8;

    const adhesivePricing = rules.get('ADHESIVE_PRICING') ?? {};
    const transferPricing = rules.get('TRANSFER_MASK_PRICING') ?? {};
    const pricingItemIds: string[] = [
      ...(Array.isArray(adhesivePricing.itemIds) ? adhesivePricing.itemIds : []),
      ...(Array.isArray(transferPricing.itemIds) ? transferPricing.itemIds : []),
    ];
    const systems = await this.loadPaintSystems();
    const materialYield: Record<string, { itemId?: string | null }> = rules.get('MATERIAL_YIELD') ?? {};
    const itemIds = [
      ...Object.values(materialMap).filter((value): value is string => Boolean(value)),
      ...pricingItemIds,
      ...Object.values(materialYield)
        .map((entry) => entry?.itemId)
        .filter((value): value is string => Boolean(value)),
      ...[...systems.values()].flatMap((system) =>
        [system.catalystItemId, system.thinnerItemId].filter((value): value is string => Boolean(value)),
      ),
    ];
    const items = itemIds.length
      ? await this.prisma.item.findMany({
          where: { id: { in: itemIds } },
          include: {
            // Fallback deliberado: no banco real a maioria dos itens não tem nenhuma
            // linha marcada `current` (440 de 541). Preço velho é infinitamente melhor
            // que R$ 0,00 silencioso no orçamento — prefere o atual, senão o mais novo.
            prices: { orderBy: [{ current: 'desc' }, { createdAt: 'desc' }], take: 1 },
            measures: true,
          } as any,
        })
      : [];
    const itemById = new Map(items.map((item: any) => [item.id, item]));

    const priceOf = (itemId: string | null | undefined): { unitPrice: number; label: string } => {
      if (!itemId) return { unitPrice: 0, label: '' };
      const item: any = itemById.get(itemId);
      if (!item) return { unitPrice: 0, label: '' };
      const price = Number(item.prices?.[0]?.value ?? 0);
      return { unitPrice: price, label: item.name };
    };

    /**
     * Preço por litro: preço da embalagem ÷ volume dela. Aceita LITER e MILLILITER —
     * metade do catálogo é em ml (Desengraxante 900 ml), e tratar isso como "1 litro"
     * subestimava o custo em ~10%.
     */
    const pricePerLiterOfItem = (itemId: string | null | undefined): number => {
      if (!itemId) return 0;
      const item: any = itemById.get(itemId);
      if (!item) return 0;
      const price = Number(item.prices?.[0]?.value ?? 0);
      if (price <= 0) return 0;
      const volume = (item.measures ?? []).find(
        (measure: any) =>
          measure.measureType === 'VOLUME' &&
          (measure.unit === 'LITER' || measure.unit === 'MILLILITER') &&
          measure.value > 0,
      );
      // Sem medida de volume NÃO dá para converter: o preço cadastrado é o da
      // embalagem (Thinner 7000 = R$ 2.216 o tambor). Tratar isso como R$/L
      // inflava a linha em milhares. Devolve 0 → a linha aparece "sem preço".
      if (!volume) return 0;
      const liters = volume.unit === 'MILLILITER' ? volume.value / 1000 : volume.value;
      return liters > 0 ? price / liters : 0;
    };

    /** best-effort per-linear-meter price using the item's LENGTH measure */
    const pricePerMeterOf = (itemId: string | null | undefined): { unitPrice: number; label: string } => {
      if (!itemId) return { unitPrice: 0, label: '' };
      const item: any = itemById.get(itemId);
      if (!item) return { unitPrice: 0, label: '' };
      const rollPrice = Number(item.prices?.[0]?.value ?? 0);
      const lengthMeasure = (item.measures ?? []).find(
        (measure: any) => measure.measureType === 'LENGTH' && measure.unit === 'METER' && measure.value > 3,
      );
      const unitPrice = lengthMeasure && rollPrice > 0 ? rollPrice / lengthMeasure.value : 0;
      return { unitPrice, label: item.name };
    };

    // ---- step assembly ----------------------------------------------------
    type MaterialDraft = {
      itemId?: string | null;
      paintId?: string | null;
      label: string;
      sizeLabel?: string | null;
      quantity: number;
      unit: string;
      unitPrice: number;
      kind?: CostLineDraft['kind'];
      basis?: CostLineDraft['basis'];
      basisQuantity?: number | null;
      basisUnit?: string | null;
    };
    type StepDraft = {
      kind: string;
      title: string;
      description?: string;
      faceId?: string | null;
      regionIds?: string[];
      quantity: number;
      quantityUnit: string;
      rateKey?: string;
      extraMinutes?: number;
      fixedMinutes?: number;
      waitMinutes?: number;
      session?: number;
      windowAreaM2?: number;
      visualization?: StepVisualization;
      materials: MaterialDraft[];
      /** Sub-tarefas (checklist do passo) — quando presentes, mandam nos minutos. */
      tasks?: StepTaskDraft[];
    };
    const drafts: StepDraft[] = [];

    const minutesFor = (draft: StepDraft): { minutes: number; rateUsed: number | null } => {
      if (draft.tasks?.length) {
        const minutes = draft.tasks.reduce((sum, item) => sum + (item.minutes ?? 0), 0);
        return { minutes: minutes + (draft.extraMinutes ?? 0), rateUsed: null };
      }
      if (draft.fixedMinutes !== undefined) {
        return { minutes: draft.fixedMinutes + (draft.extraMinutes ?? 0), rateUsed: null };
      }
      const rate = draft.rateKey ? rates.get(draft.rateKey) : undefined;
      if (!rate || rate.value <= 0) return { minutes: draft.extraMinutes ?? 0, rateUsed: null };
      let minutes: number;
      switch (rate.mode) {
        case 'MIN_FIXED':
          minutes = rate.value;
          break;
        case 'MIN_PER_UNIT':
          minutes = rate.value * draft.quantity;
          break;
        case 'CM_PER_MIN':
          minutes = (draft.quantity * 100) / rate.value;
          break;
        default: // M2_PER_MIN | M_PER_MIN — quantity already in that unit
          minutes = draft.quantity / rate.value;
      }
      return { minutes: minutes + (draft.extraMinutes ?? 0), rateUsed: rate.value };
    };

    const isReform = analysis.serviceContext === 'REFORM';
    const faceCount = Math.max(1, analysis.faces.length);
    const allFacesArea = analysis.faces.reduce((sum, face) => sum + (face.areaM2 ?? 0), 0);

    // Quem decide se há pintura geral é a ARTE (fundo GENERAL_PAINT detectado pelo
    // motor ou corrigido na revisão) — não existe toggle no formulário. O programa
    // de superfície é do IMPLEMENTO, então é emitido UMA vez, não por face.
    const generalPaint = analysis.faces.some(
      (face) =>
        face.backgroundMode === 'GENERAL_PAINT' ||
        normalizeLayout((face.engineArtifact as any)?.layout)?.face?.backgroundMode === 'GENERAL_PAINT',
    );

    if (isReform) {
      drafts.push({
        kind: 'REMOCAO_ADESIVO_ANTIGO',
        title: 'Remover adesivos e plotagens antigas',
        description: 'Remoção completa da comunicação visual anterior antes de qualquer preparação.',
        quantity: allFacesArea,
        quantityUnit: 'm²',
        rateKey: 'REMOVE_OLD_ADHESIVE_M2_PER_MIN',
        visualization: { baseMode: 'COLOR', rects: [] },
        materials: [
          {
            itemId: materialMap.removerItemId,
            label: 'Removedor',
            quantity: Math.ceil(allFacesArea / 20),
            unit: 'L',
            unitPrice: priceOf(materialMap.removerItemId).unitPrice,
          },
        ],
      });
      drafts.push({
        kind: 'REMOCAO_REFLETIVA',
        title: 'Remover faixas refletivas originais',
        quantity: (reformDefaults.reflectiveLinearMPerSide ?? 15) * faceCount,
        quantityUnit: 'm',
        rateKey: 'REMOVE_REFLECTIVE_M_PER_MIN',
        materials: [],
      });
    }

    // Na pintura geral a lavagem/desengraxe vive dentro do passo "Preparação"
    // (programa A) — este passo avulso só existe no fluxo sem pintura geral.
    if (!generalPaint && (!analysis.alreadyPrepared || isReform)) {
      drafts.push({
        kind: 'LAVAGEM',
        title: 'Lavar e desengraxar a superfície',
        quantity: allFacesArea,
        quantityUnit: 'm²',
        rateKey: 'WASH_M2_PER_MIN',
        visualization: { baseMode: 'COLOR', rects: [] },
        materials: [
          {
            itemId: materialMap.degreaserItemId,
            label: 'Desengraxante',
            quantity: Math.ceil(allFacesArea / 30),
            unit: 'L',
            unitPrice: priceOf(materialMap.degreaserItemId).unitPrice,
          },
        ],
      });
    }

    if (isReform) {
      drafts.push({
        kind: 'VEDACAO_PU',
        title: 'Vedação PU das juntas e perfis',
        description: 'Aplicação de PU/adesivo selante nas juntas antes da pintura geral.',
        quantity: (reformDefaults.sealLinearMPerSide ?? 20) * faceCount,
        quantityUnit: 'm',
        rateKey: 'PU_SEAL_M_PER_MIN',
        materials: [
          {
            itemId: materialMap.puSealantItemId,
            label: 'PU / adesivo selante',
            quantity: Math.ceil(((reformDefaults.sealLinearMPerSide ?? 20) * faceCount) / 6),
            unit: 'un',
            unitPrice: priceOf(materialMap.puSealantItemId).unitPrice,
          },
        ],
      });
    }

    // ---- PROGRAMA A — superfície (pintura geral) ---------------------------
    // Nasce das medidas digitadas e das opções do implemento, NUNCA da arte, e
    // é emitido UMA vez por análise (antes cada face repetia chassi/fundo).
    // A cor final vem da ARTE (fundo detectado + casamento ΔE); `targetPaintId`
    // é só o override manual de quem não concordar com a detecção.
    const detectedBackgroundPaintId =
      analysis.faces.find((face) => face.backgroundMode === 'GENERAL_PAINT' && face.backgroundPaintId)
        ?.backgroundPaintId ?? null;
    const effectiveTargetPaintId = analysis.targetPaintId ?? detectedBackgroundPaintId;
    const targetPaint: any = effectiveTargetPaintId
      ? await this.prisma.paint.findUnique({
          where: { id: effectiveTargetPaintId },
          include: { paintType: true, formulas: true },
        })
      : null;
    const groundPaint = generalPaint ? await this.findGroundPaint(targetPaint?.hex ?? null, systems) : null;

    // `generalPaint` é cache do que a arte disse — mantém a lista e a UI coerentes.
    if (analysis.generalPaint !== generalPaint) {
      await this.prisma.paintingAnalysis.update({
        where: { id: analysisId },
        data: { generalPaint },
      });
    }

    if (generalPaint) {
      const surfaceContext: SurfaceContext = {
        analysis: {
          substrate: analysis.substrate,
          paintSystemKey: analysis.paintSystemKey,
          lengthCm: analysis.lengthCm,
          heightCm: analysis.heightCm,
        },
        rules,
        rates,
        systems,
        targetPaint,
        groundPaint,
        faceAreaFallbackM2: allFacesArea,
        itemById,
        pricePerLiterOfItem,
        pricePerLiterOfPaint: (paint: any) => this.paintPricePerLiter(paint, rules),
      };
      const surface = buildSurfaceProgram(surfaceContext);
      for (const step of surface.steps) {
        drafts.push({
          kind: step.kind,
          title: step.title,
          description: step.description,
          quantity: step.quantity,
          quantityUnit: step.quantityUnit,
          waitMinutes: step.waitMinutes,
          visualization: step.visualization,
          tasks: step.tasks,
          materials: step.materials.map((line) => ({
            itemId: line.itemId ?? null,
            paintId: line.paintId ?? null,
            label: line.label,
            sizeLabel: line.sizeLabel ?? null,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            kind: line.kind,
            basis: line.basis,
            basisQuantity: line.basisQuantity ?? null,
            basisUnit: line.basisUnit ?? null,
          })),
        });
      }
      // recomputar não pode acumular o mesmo alerta várias vezes
      const surfaceCodes = [
        'MISSING_IMPLEMENT_MEASURES',
        'MISSING_PAINT_SYSTEM',
        'PAINT_SYSTEM_DEFAULTED',
        'PAINT_SYSTEM_ESTIMATED',
      ];
      await this.prisma.paintingAnalysisAlert.deleteMany({
        where: { analysisId, code: { in: surfaceCodes } },
      });
      if (surface.alerts.length > 0) {
        await this.prisma.paintingAnalysisAlert.createMany({
          data: surface.alerts.map((alert) => ({
            analysisId,
            code: alert.code,
            severity: alert.severity,
            message: alert.message,
          })),
        });
      }
    }

    /** largura útil (m) de um rolo de vinil a partir das medidas do item. */
    const rollWidthM = (item: any): number | null => {
      for (const measure of item?.measures ?? []) {
        if (measure.measureType === 'LENGTH' && measure.unit === 'CENTIMETER' && measure.value > 40) {
          return measure.value / 100;
        }
        if (measure.measureType === 'LENGTH' && measure.unit === 'METER' && measure.value > 0.4 && measure.value < 3) {
          return measure.value;
        }
        if (measure.measureType === 'WIDTH' && measure.unit === 'CENTIMETER' && measure.value > 40) {
          return measure.value / 100;
        }
      }
      const fromName = /1[,.](\d{2})/.exec(item?.name ?? '');
      return fromName ? Number(`1.${fromName[1]}`) : null;
    };

    /** média de preço por m² dos rolos de adesivo vinil (regra ADHESIVE_PRICING). */
    const avgAdhesivePricePerM2 = (): number => {
      const ids: string[] = Array.isArray(adhesivePricing.itemIds) ? adhesivePricing.itemIds : [];
      const rollLengthM = Number(adhesivePricing.rollLengthM) > 0 ? Number(adhesivePricing.rollLengthM) : 50;
      const perM2: number[] = [];
      for (const id of ids) {
        const item: any = itemById.get(id);
        const price = Number(item?.prices?.[0]?.value ?? 0);
        const width = rollWidthM(item);
        if (price > 0 && width) perM2.push(price / (rollLengthM * width));
      }
      if (perM2.length === 0) return 0;
      return perM2.reduce((sum, value) => sum + value, 0) / perM2.length;
    };

    /** média de preço por metro linear da máscara de transferência. */
    const avgTransferPricePerM = (): number => {
      const ids: string[] = Array.isArray(transferPricing.itemIds) ? transferPricing.itemIds : [];
      const rollLengthM = Number(transferPricing.rollLengthM) > 0 ? Number(transferPricing.rollLengthM) : 100;
      const perM: number[] = [];
      for (const id of ids) {
        const item: any = itemById.get(id);
        const price = Number(item?.prices?.[0]?.value ?? 0);
        if (price > 0) perM.push(price / rollLengthM);
      }
      if (perM.length === 0) return 0;
      return perM.reduce((sum, value) => sum + value, 0) / perM.length;
    };

    const adhesivePriceM2 = avgAdhesivePricePerM2();
    const transferPriceM = avgTransferPricePerM();
    const transferWidthCm = Number(transferPricing.widthCm) > 0 ? Number(transferPricing.widthCm) : 60;
    const transferReuseFactor = Number(transferPricing.reuseFactor) > 0 ? Number(transferPricing.reuseFactor) : 1.2;

    // ---- v2: passos por face a partir do artifact.layout -------------------
    const isoplastic = analysis.substrate === 'ISOPLASTIC';
    let anyNeedsClear = false;
    let totalFaceArea = 0;
    const paintPrepMinutes =
      (rates.get('PAINT_PREP_MIN')?.value ?? 10) + (rates.get('COLOR_SWAP_MIN')?.value ?? 20);

    for (const face of analysis.faces) {
      totalFaceArea += face.areaM2 ?? 0;
      const layout = normalizeLayout((face.engineArtifact as any)?.layout);
      const facePrefix = analysis.faces.length > 1 ? `${this.faceLabel(face.view)} — ` : '';
      const nonReserva = face.regions.filter((region) => region.kind !== 'RESERVA');
      const islandsTotal = nonReserva.reduce((sum, region) => sum + (region.islands ?? 0), 0);
      const paintByHex = new Map<string, any>();
      for (const region of face.regions) {
        if (region.paint && !paintByHex.has(region.colorHex.toLowerCase())) {
          paintByHex.set(region.colorHex.toLowerCase(), region.paint);
        }
      }

      if (!layout || !Array.isArray(layout.stepVisuals) || layout.stepVisuals.length === 0) {
        drafts.push({
          kind: 'INSPECAO',
          title: `${facePrefix}Reprocessar a imagem para gerar o plano v2`,
          description:
            'Esta face foi processada por uma versão antiga do motor (sem bandas/janelas). ' +
            'Use "Reprocessar análise" para obter a simulação passo a passo.',
          quantity: 0,
          quantityUnit: '',
          fixedMinutes: 0,
          faceId: face.id,
          materials: [],
        });
        continue;
      }

      const scene = new SceneBuilder();
      const bands = bandRects(layout);
      const papers = paperRects(layout);
      const totals = layout.totals ?? {};
      const isGeneral =
        layout.face?.backgroundMode === 'GENERAL_PAINT' || face.backgroundMode === 'GENERAL_PAINT';

      // A pintura geral virou o Programa A (uma vez por análise, das medidas do
      // implemento). Aqui só marcamos a face como já pintada para que a cena dos
      // passos seguintes mostre o fundo curado sob o adesivo.
      if (isGeneral) {
        const generalWindows = (generalPaintStep(layout)?.visuals ?? []).filter(
          (rect) => rect.kind === 'PAINT_WINDOW',
        );
        const bgColor = face.backgroundHex ?? targetPaint?.hex ?? null;
        scene.markPainted(generalWindows, bgColor);
      }

      // adesivagem (bandas por faixa)
      if (bands.length > 0) {
        const widthMaterials = adhesiveMaterialsByWidth(layout).map((entry) => ({
          itemId: materialMap.adhesiveItemId,
          label: 'Adesivo de recorte',
          sizeLabel: `${entry.widthCm} cm`,
          quantity: Number(entry.linearM.toFixed(2)),
          unit: 'm',
          // média dos rolos "Adesivo Vinil" (regra ADHESIVE_PRICING) na largura desta banda
          unitPrice: adhesivePriceM2 * (entry.widthCm / 100),
        }));
        const adhesiveArea = totals.adhesiveAreaM2 ?? 0;
        const linearTotal = widthMaterials.reduce((sum, material) => sum + material.quantity, 0);
        drafts.push({
          kind: 'ADESIVO_PLOTAGEM',
          title: `${facePrefix}Plotar e recortar o adesivo`,
          description: 'Bandas por faixa horizontal — a largura de cada banda aparece no canvas.',
          quantity: linearTotal,
          quantityUnit: 'm',
          rateKey: 'PLOT_M_PER_MIN',
          faceId: face.id,
          visualization: scene.scene({ baseMode: 'BW', currentBands: bands }),
          materials: [
            ...widthMaterials,
            (() => {
              // Reuso: a máscara transfere o vinil e é descolada — cobra-se o
              // suficiente para a MAIOR peça (com fator de desgaste), não a área total.
              const largestPieceM2 = bands.reduce(
                (max, rect) => Math.max(max, rect.areaM2 || (rect.w * rect.h) / 10_000),
                0,
              );
              const chargedM = (largestPieceM2 / (transferWidthCm / 100)) * transferReuseFactor;
              return {
                itemId: materialMap.transferMaskItemId,
                label: 'Máscara de transferência',
                sizeLabel: `${transferWidthCm} cm`,
                quantity: Number(chargedM.toFixed(2)),
                unit: 'm',
                unitPrice: transferPriceM,
              };
            })(),
          ],
        });
        drafts.push({
          kind: 'ADESIVO_DEPILACAO',
          title: `${facePrefix}Depilar o adesivo`,
          description: `Remoção das áreas que serão pintadas (${islandsTotal} ilha(s) internas).`,
          quantity: adhesiveArea,
          quantityUnit: 'm²',
          rateKey: 'WEED_M2_PER_MIN',
          extraMinutes: islandsTotal * (rates.get('WEED_MIN_PER_ISLAND')?.value ?? 0.5),
          faceId: face.id,
          visualization: scene.scene({ baseMode: 'BW', currentBands: bands }),
          materials: [],
        });
        scene.addBands(bands);
        drafts.push({
          kind: 'ADESIVO_APLICACAO',
          title: `${facePrefix}Aplicar o adesivo no implemento`,
          quantity: adhesiveArea,
          quantityUnit: 'm²',
          rateKey: 'APPLY_ADHESIVE_M2_PER_MIN',
          faceId: face.id,
          visualization: scene.scene({ baseMode: 'BW' }),
          materials: [],
        });
        if (isoplastic) {
          const openArea = totals.elementAreaM2 ?? 0;
          drafts.push({
            kind: 'LIXAMENTO',
            title: `${facePrefix}Lixar as janelas do adesivo (isoplastic)`,
            description: 'Isoplastic não adere bem a tinta: lixar a superfície exposta nas janelas.',
            quantity: openArea,
            quantityUnit: 'm²',
            rateKey: 'SAND_ISOPLASTIC_M2_PER_MIN',
            faceId: face.id,
            visualization: scene.scene({ baseMode: 'BW' }),
            materials: [
              {
                itemId: materialMap.sandpaperItemId,
                label: 'Lixa',
                quantity: Math.max(1, Math.ceil(openArea / 3)),
                unit: 'un',
                unitPrice: priceOf(materialMap.sandpaperItemId).unitPrice,
              },
            ],
          });
        }
      }

      // empapelamento ao redor das bandas
      if (papers.length > 0) {
        const paperArea = totals.paperAreaM2 ?? 0;
        const rollCm = Math.round(papers[0]?.rollWidthCm ?? 90);
        drafts.push({
          kind: 'EMPAPELAMENTO',
          title: `${facePrefix}Empapelar ao redor das bandas`,
          quantity: paperArea,
          quantityUnit: 'm²',
          rateKey: 'PAPER_MASK_M2_PER_MIN',
          faceId: face.id,
          visualization: scene.scene({ baseMode: 'BW', currentPapers: papers }),
          materials: [
            {
              itemId: materialMap.paperItemId,
              label: 'Papel TKV',
              sizeLabel: `${rollCm} cm`,
              quantity: Number(paperArea.toFixed(2)),
              unit: 'm²',
              unitPrice: 0,
            },
            {
              itemId: materialMap.crepeTapeItemId,
              label: 'Fita crepe',
              sizeLabel: '45 mm',
              quantity: Number((totals.tapeCrepeM ?? 0).toFixed(1)),
              unit: 'm',
              unitPrice: pricePerMeterOf(materialMap.crepeTapeItemId).unitPrice,
            },
          ],
        });
        scene.addPapers(papers);
      }

      // sessões de cor — ordenadas por contenção de janelas (caso bandeira)
      const ordered = orderSessions(layout);
      for (const { session, windows, needsCureBefore } of ordered) {
        if (needsCureBefore) {
          drafts.push({
            kind: 'CURA',
            title: `${facePrefix}Cura antes da próxima cor`,
            description: 'A próxima janela toca a tinta recém-aplicada — aguardar a cura.',
            quantity: 0,
            quantityUnit: '',
            fixedMinutes: 0,
            waitMinutes: rules.get('CURE_WAIT_MIN')?.minutes ?? 180,
            session: session.order,
            faceId: face.id,
            visualization: scene.scene({ baseMode: 'BW' }),
            materials: [],
          });
        }
        const hexKey = (session.hexes[0] ?? '').toLowerCase();
        const paint: any = hexKey ? (paintByHex.get(hexKey) ?? null) : null;
        const process = paramsByType.get(paint?.paintTypeId ?? '') ?? defaultProcess;
        const windowArea = windowAreaOfSession(layout, session.id);
        const elementArea = windows.reduce((sum, rect) => sum + (rect.areaM2 || 0), 0);
        const label = paint?.name ?? session.hexes[0] ?? 'cor';

        if (session.kind === 'AEROGRAFIA') {
          const artLiters = this.paintLiters(windowArea, 1, process);
          drafts.push({
            kind: 'AEROGRAFIA',
            title: `${facePrefix}Aerografia artística`,
            description:
              'Bloco fotográfico/degradê executado pelo setor de Aerografia — valor sugerido, ajuste conforme combinado com o aerografista.',
            quantity: windowArea,
            quantityUnit: 'm²',
            rateKey: 'AIRBRUSH_ART_M2_PER_MIN',
            session: session.order,
            faceId: face.id,
            windowAreaM2: windowArea,
            visualization: scene.scene({ baseMode: 'BW', currentWindows: windows }),
            materials: [
              {
                label: 'Tintas de aerografia (estimativa)',
                quantity: Number(artLiters.toFixed(2)),
                unit: 'L',
                unitPrice: this.defaultPaintPrice(rules),
              },
            ],
          });
          scene.markPainted(windows, session.hexes[0] ?? null);
          continue;
        }

        if (process.needsClearCoat) anyNeedsClear = true;
        const coats = process.coatsDefault ?? 2;
        const liters = this.paintLiters(windowArea, coats, process);
        drafts.push({
          kind: 'PINTURA',
          title: `${facePrefix}Pintar ${label}`,
          description: `Janela de ${windowArea.toFixed(2)} m² (${coats} demão(s)) — consumo pela área do retângulo; elementos somam ${elementArea.toFixed(2)} m².`,
          quantity: windowArea * coats,
          quantityUnit: 'm²·demão',
          rateKey: 'PAINT_COAT_M2_PER_MIN',
          extraMinutes: paintPrepMinutes,
          session: session.order,
          faceId: face.id,
          windowAreaM2: windowArea,
          visualization: scene.scene({
            baseMode: 'BW',
            currentWindows: windows,
            currentColor: session.hexes[0] ?? null,
          }),
          materials: [
            {
              paintId: paint?.id ?? null,
              label: `Tinta ${label}`,
              quantity: Number(liters.toFixed(2)),
              unit: 'L',
              unitPrice: this.paintPricePerLiter(paint, rules),
            },
          ],
        });
        scene.markPainted(windows, session.hexes[0] ?? null);
      }

      // remoção das máscaras desta face
      if (bands.length > 0 || papers.length > 0) {
        scene.removeMasking();
        drafts.push({
          kind: 'REMOCAO_MASCARA',
          title: `${facePrefix}Remover máscaras e papel`,
          quantity: (totals.adhesiveAreaM2 ?? 0) + (totals.paperAreaM2 ?? 0),
          quantityUnit: 'm²',
          rateKey: 'MASK_REMOVE_M2_PER_MIN',
          faceId: face.id,
          visualization: scene.scene({ baseMode: 'COLOR' }),
          materials: [],
        });
      }
    }

    // verniz coletivo / refletivas / finalização
    if (anyNeedsClear) {
      const paintedArea = drafts
        .filter((draft) => draft.kind === 'PINTURA' || draft.kind === 'AEROGRAFIA')
        .reduce((sum, draft) => sum + (draft.windowAreaM2 ?? 0), 0);
      const varnishLiters = paintedArea / 8;
      drafts.push({
        kind: 'VERNIZ',
        title: 'Verniz final sobre toda a pintura',
        description: 'Laca multi-cor recebe verniz coletivo ao final; poliéster exige verniz.',
        quantity: paintedArea,
        quantityUnit: 'm²',
        rateKey: 'VARNISH_M2_PER_MIN',
        waitMinutes: 720,
        visualization: { baseMode: 'COLOR', rects: [] },
        materials: [
          {
            itemId: materialMap.varnishItemId,
            label: 'Verniz PU',
            quantity: Number(varnishLiters.toFixed(2)),
            unit: 'L',
            unitPrice: this.varnishPricePerLiter(itemById, materialMap.varnishItemId),
          },
        ],
      });
    }

    if (isReform) {
      drafts.push({
        kind: 'APLICACAO_REFLETIVA',
        title: 'Aplicar faixas refletivas novas',
        quantity: (reformDefaults.reflectiveLinearMPerSide ?? 15) * faceCount,
        quantityUnit: 'm',
        rateKey: 'APPLY_REFLECTIVE_M_PER_MIN',
        materials: [
          {
            label: 'Faixa refletiva 3M',
            quantity: (reformDefaults.reflectiveLinearMPerSide ?? 15) * faceCount,
            unit: 'm',
            unitPrice: 0,
          },
        ],
      });
    }

    drafts.push({
      kind: 'LIMPEZA',
      title: 'Limpeza final',
      quantity: totalFaceArea,
      quantityUnit: 'm²',
      rateKey: 'FINAL_CLEAN_M2_PER_MIN',
      visualization: { baseMode: 'COLOR', rects: [] },
      materials: [],
    });
    drafts.push({
      kind: 'INSPECAO',
      title: 'Inspeção final e retoques',
      quantity: 1,
      quantityUnit: '',
      rateKey: 'INSPECT_MIN',
      visualization: { baseMode: 'COLOR', rects: [] },
      materials: [],
    });

    // ---- costing + persistence -------------------------------------------
    const indirects = await this.prisma.paintingIndirectCost.findMany({ where: { active: true } });
    const profitMarginPct = indirects.find((cost) => cost.key === 'PROFIT_MARGIN_PCT')?.value ?? 0;

    let totalMinutes = 0;
    let totalWait = 0;
    let laborTotal = 0;
    let materialTotal = 0;
    let day = 1;
    let dayMinutes = 0;

    const stepsData = drafts.map((draft, index) => {
      const { minutes, rateUsed } = minutesFor(draft);
      const wait = draft.waitMinutes ?? 0;
      dayMinutes += minutes + Math.min(wait, 180);
      if (dayMinutes > workdayMinutes && index < drafts.length - 1) {
        day += 1;
        dayMinutes = 0;
      }
      if (wait > 240) {
        day += 1;
        dayMinutes = 0;
      }
      // Mão de obra é SEMPRE individual: minutos de relógio × custo-hora.
      const laborCost = (minutes / 60) * hourly;
      const materials = draft.materials.map((material, materialIndex) => ({
        itemId: material.itemId ?? null,
        paintId: material.paintId ?? null,
        label: material.label,
        kind: (material.kind ?? 'MATERIAL') as any,
        basis: (material.basis ?? 'AREA') as any,
        basisQuantity: material.basisQuantity ?? null,
        basisUnit: material.basisUnit ?? null,
        position: materialIndex,
        sizeLabel: material.sizeLabel ?? null,
        quantity: Number(material.quantity.toFixed(3)),
        unit: material.unit,
        unitPriceSnapshot: material.unitPrice.toFixed(4),
        totalCost: (material.quantity * material.unitPrice).toFixed(2),
      }));
      const tasks = (draft.tasks ?? []).map((item, taskIndex) => ({
        position: taskIndex,
        label: item.label,
        rateKey: item.rateKey ?? null,
        basisQuantity: Number(item.basisQuantity.toFixed(3)),
        basisUnit: item.basisUnit ?? null,
        minutes: Number(item.minutes.toFixed(1)),
        crewSize: item.crewSize || 1,
      }));
      const materialCost = materials.reduce((sum, material) => sum + Number(material.totalCost), 0);
      totalMinutes += minutes;
      totalWait += wait;
      laborTotal += laborCost;
      materialTotal += materialCost;
      return {
        position: index + 1,
        day,
        session: draft.session ?? 0,
        kind: draft.kind as any,
        title: draft.title,
        description: draft.description ?? null,
        faceId: draft.faceId ?? null,
        regionIds: draft.regionIds ?? undefined,
        quantity: Number(draft.quantity.toFixed(3)),
        quantityUnit: draft.quantityUnit || null,
        windowAreaM2: draft.windowAreaM2 != null ? Number(draft.windowAreaM2.toFixed(4)) : null,
        visualization: (draft.visualization ?? undefined) as any,
        rateUsed,
        minutes: Number(minutes.toFixed(1)),
        waitMinutes: wait,
        laborCost: laborCost.toFixed(2),
        materialCost: materialCost.toFixed(2),
        materials,
        tasks,
      };
    });

    let indirectTotal = 0;
    for (const cost of indirects) {
      if (cost.key === 'PROFIT_MARGIN_PCT') continue;
      switch (cost.mode) {
        case 'FIXED':
          indirectTotal += cost.value;
          break;
        case 'PER_HOUR':
          indirectTotal += cost.value * (totalMinutes / 60);
          break;
        case 'PER_M2':
          indirectTotal += cost.value * totalFaceArea;
          break;
        default: // PCT_COST | PCT_PRICE (v1: sobre custo direto)
          indirectTotal += cost.value * (laborTotal + materialTotal);
      }
    }
    const totalCost = laborTotal + materialTotal + indirectTotal;
    const suggestedPrice = totalCost * (1 + profitMarginPct);

    await this.prisma.$transaction(async (tx) => {
      await tx.paintingProductionPlan.deleteMany({ where: { analysisId } });
      const plan = await tx.paintingProductionPlan.create({
        data: {
          analysisId,
          totalMinutes: Number(totalMinutes.toFixed(1)),
          totalWaitMinutes: totalWait,
          totalDays: day,
          materialCost: materialTotal.toFixed(2),
          laborCost: laborTotal.toFixed(2),
          indirectCost: indirectTotal.toFixed(2),
          totalCost: totalCost.toFixed(2),
          profitMarginPct,
          suggestedPrice: suggestedPrice.toFixed(2),
          laborRatePerHour: hourly.toFixed(2),
          priceSnapshotAt: new Date(),
        },
      });
      for (const step of stepsData) {
        const { materials, tasks, ...stepData } = step;
        await tx.paintingProductionStep.create({
          data: {
            ...stepData,
            planId: plan.id,
            materials: { create: materials },
            ...(tasks.length > 0 ? { tasks: { create: tasks } } : {}),
          },
        });
      }
    });
  }

  private paintLiters(
    areaM2: number,
    coats: number,
    process: { coverageM2PerL?: number; sprayLossPct?: number; prepLossPct?: number },
  ): number {
    const coverage = process.coverageM2PerL || 6;
    const base = (areaM2 * coats) / coverage;
    return base * (1 + (process.sprayLossPct ?? 0.15) + (process.prepLossPct ?? 0.05));
  }

  private paintPricePerLiter(paint: any | null, rules: Map<string, any>): number {
    const formulaPrice = paint?.formulas?.find((formula: any) => Number(formula.pricePerLiter) > 0);
    if (formulaPrice) return Number(formulaPrice.pricePerLiter);
    return this.defaultPaintPrice(rules);
  }

  private defaultPaintPrice(rules: Map<string, any>): number {
    return rules.get('DEFAULT_PAINT_PRICE_PER_L')?.value ?? 80;
  }

  /** Igual ao pricePerLiterOfItem do runPlan, para os callers fora dele. */
  private varnishPricePerLiter(itemById: Map<string, any>, itemId: string | null | undefined): number {
    if (!itemId) return 0;
    const item = itemById.get(itemId);
    if (!item) return 0;
    const price = Number(item.prices?.[0]?.value ?? 0);
    if (price <= 0) return 0;
    const volume = (item.measures ?? []).find(
      (measure: any) =>
        measure.measureType === 'VOLUME' && (measure.unit === 'LITER' || measure.unit === 'MILLILITER') && measure.value > 0,
    );
    if (!volume) return 0;
    const liters = volume.unit === 'MILLILITER' ? volume.value / 1000 : volume.value;
    return liters > 0 ? price / liters : 0;
  }

  private faceLabel(view: string): string {
    const labels: Record<string, string> = {
      LEFT_SIDE: 'lateral esquerda',
      RIGHT_SIDE: 'lateral direita',
      BACK: 'traseira',
      FRONT: 'frente',
      ROOF: 'teto',
    };
    return labels[view] ?? view;
  }
}
