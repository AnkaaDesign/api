import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import { normalizeSearchTerm } from '@schemas';
import type {
  PaintingAnalysisCreateFormData,
  PaintingAnalysisGetManyFormData,
  PaintingAnalysisUpdateFormData,
  PaintingBoundaryUpdateFormData,
  PaintingFaceCreateFormData,
  PaintingFaceUpdateFormData,
  PaintingProcessFormData,
  PaintingRegionUpdateFormData,
  PaintingStepUpdateFormData,
} from '../../../schemas/painting-analysis';
import { PaintingEngineRunnerService } from './engine-runner.service';
import { PaintingComputeService } from './painting-compute.service';

@Injectable()
export class PaintingAnalysisService {
  private readonly logger = new Logger(PaintingAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
    private readonly engineRunner: PaintingEngineRunnerService,
    private readonly computeService: PaintingComputeService,
  ) {}

  private readonly listInclude = {
    faces: { select: { id: true, view: true, processedAt: true, areaM2: true, backgroundMode: true } },
    plan: { select: { id: true, totalCost: true, suggestedPrice: true, totalDays: true } },
    task: { select: { id: true, name: true } },
  } as const;

  private readonly detailInclude = {
    faces: {
      include: {
        file: true,
        regions: { include: { paint: { include: { paintType: true } } }, orderBy: { areaM2: 'desc' as const } },
        boundaries: { orderBy: { lengthM: 'desc' as const } },
      },
    },
    plan: {
      include: {
        steps: {
          include: {
            materials: { include: { item: true, paint: true }, orderBy: { position: 'asc' as const } },
            tasks: { orderBy: { position: 'asc' as const } },
          },
          orderBy: { position: 'asc' as const },
        },
      },
    },
    alerts: { orderBy: { createdAt: 'asc' as const } },
    task: { select: { id: true, name: true } },
    implementMeasure: { include: { sections: true } },
  } as const;

  // =====================================================================
  // CRUD
  // =====================================================================

  async findMany(query: PaintingAnalysisGetManyFormData) {
    const { page = 1, limit = 20, searchingFor, status, taskId, orderBy } = query;
    const take = limit;
    const skip = (page - 1) * take;

    const where: any = {};
    if (status) where.status = status;
    if (taskId) where.taskId = taskId;
    if (searchingFor && searchingFor.trim().length > 0) {
      where.name = { contains: normalizeSearchTerm(searchingFor), mode: 'insensitive' };
    }

    const [data, totalRecords] = await this.prisma.$transaction([
      this.prisma.paintingAnalysis.findMany({
        where,
        include: this.listInclude,
        orderBy: orderBy && Object.keys(orderBy).length > 0 ? orderBy : { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.paintingAnalysis.count({ where }),
    ]);

    return {
      success: true,
      message: 'Análises carregadas com sucesso.',
      data,
      meta: {
        totalRecords,
        page,
        take,
        totalPages: Math.ceil(totalRecords / take),
        hasNextPage: skip + take < totalRecords,
      },
    };
  }

  async findById(id: string) {
    const analysis = await this.prisma.paintingAnalysis.findUnique({
      where: { id },
      include: this.detailInclude,
    });
    if (!analysis) {
      throw new NotFoundException('Análise não encontrada.');
    }
    return { success: true, message: 'Análise carregada com sucesso.', data: analysis };
  }

  async create(data: PaintingAnalysisCreateFormData) {
    const analysis = await this.prisma.paintingAnalysis.create({
      data: {
        name: data.name,
        serviceContext: data.serviceContext,
        substrate: data.substrate,
        substrateSource: 'MANUAL',
        alreadyPrepared: data.alreadyPrepared ?? false,
        taskId: data.taskId ?? null,
        implementMeasureId: data.implementMeasureId ?? null,
        // Programa de superfície: sistema + as duas medidas que o formulário coleta.
        paintSystemKey: data.paintSystemKey ?? null,
        targetPaintId: data.targetPaintId ?? null,
        lengthCm: data.lengthCm ?? null,
        heightCm: data.heightCm ?? null,
      },
      include: this.listInclude,
    });
    return { success: true, message: 'Análise criada com sucesso.', data: analysis };
  }

  async update(id: string, data: PaintingAnalysisUpdateFormData) {
    await this.ensureExists(id);
    const analysis = await this.prisma.paintingAnalysis.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.serviceContext !== undefined ? { serviceContext: data.serviceContext } : {}),
        ...(data.substrate !== undefined
          ? { substrate: data.substrate, substrateSource: 'MANUAL' as const }
          : {}),
        ...(data.alreadyPrepared !== undefined ? { alreadyPrepared: data.alreadyPrepared } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.taskId !== undefined ? { taskId: data.taskId } : {}),
        ...(data.implementMeasureId !== undefined
          ? { implementMeasureId: data.implementMeasureId }
          : {}),
        ...(data.paintSystemKey !== undefined ? { paintSystemKey: data.paintSystemKey } : {}),
        ...(data.targetPaintId !== undefined ? { targetPaintId: data.targetPaintId } : {}),
        ...(data.lengthCm !== undefined ? { lengthCm: data.lengthCm } : {}),
        ...(data.heightCm !== undefined ? { heightCm: data.heightCm } : {}),
      },
      include: this.detailInclude,
    });
    return { success: true, message: 'Análise atualizada com sucesso.', data: analysis };
  }

  async delete(id: string) {
    await this.ensureExists(id);
    await this.prisma.paintingAnalysis.delete({ where: { id } });
    return { success: true, message: 'Análise removida com sucesso.', data: null };
  }

  // =====================================================================
  // Faces
  // =====================================================================

  async addFace(
    analysisId: string,
    data: PaintingFaceCreateFormData,
    file?: Express.Multer.File,
    userId?: string,
  ) {
    await this.ensureExists(analysisId);

    let fileId = data.fileId ?? null;
    if (!fileId) {
      if (!file) {
        throw new BadRequestException('Envie a imagem da arte ou informe um fileId existente.');
      }
      const uploaded = await this.fileService.createFromUpload(file, undefined, userId, {
        entityType: 'paintingAnalysis',
        entityId: analysisId,
      });
      fileId = uploaded?.data?.id ?? null;
      if (!fileId) {
        throw new BadRequestException('Falha ao armazenar a imagem da arte.');
      }
    }

    const face = await this.prisma.paintingAnalysisFace.upsert({
      where: { analysisId_view: { analysisId, view: data.view } },
      create: {
        analysisId,
        view: data.view,
        fileId,
        referenceKind: data.referenceKind,
        referenceValueCm: data.referenceValueCm,
      },
      update: {
        fileId,
        referenceKind: data.referenceKind,
        referenceValueCm: data.referenceValueCm,
        processedAt: null,
        engineArtifact: undefined,
      },
      include: { file: true },
    });
    return { success: true, message: 'Face adicionada com sucesso.', data: face };
  }

  async updateFace(faceId: string, data: PaintingFaceUpdateFormData) {
    const face = await this.prisma.paintingAnalysisFace.findUnique({ where: { id: faceId } });
    if (!face) throw new NotFoundException('Face não encontrada.');
    const updated = await this.prisma.paintingAnalysisFace.update({
      where: { id: faceId },
      data: {
        ...(data.referenceKind !== undefined ? { referenceKind: data.referenceKind } : {}),
        ...(data.referenceValueCm !== undefined ? { referenceValueCm: data.referenceValueCm } : {}),
        ...(data.backgroundMode !== undefined
          ? { backgroundMode: data.backgroundMode, backgroundModeSource: 'MANUAL' as const }
          : {}),
        ...(data.backgroundPaintId !== undefined ? { backgroundPaintId: data.backgroundPaintId } : {}),
      },
    });
    return { success: true, message: 'Face atualizada com sucesso.', data: updated };
  }

  async deleteFace(faceId: string) {
    const face = await this.prisma.paintingAnalysisFace.findUnique({ where: { id: faceId } });
    if (!face) throw new NotFoundException('Face não encontrada.');
    await this.prisma.paintingAnalysisFace.delete({ where: { id: faceId } });
    return { success: true, message: 'Face removida com sucesso.', data: null };
  }

  // =====================================================================
  // Processing (engine)
  // =====================================================================

  async process(analysisId: string, options: PaintingProcessFormData) {
    const analysis = await this.prisma.paintingAnalysis.findUnique({
      where: { id: analysisId },
      include: { faces: { include: { file: true } } },
    });
    if (!analysis) throw new NotFoundException('Análise não encontrada.');
    const faces = analysis.faces.filter(
      (face) => !options.faceIds || options.faceIds.includes(face.id),
    );
    if (faces.length === 0) {
      throw new BadRequestException('Nenhuma face para processar — adicione as artes primeiro.');
    }

    await this.prisma.paintingAnalysis.update({
      where: { id: analysisId },
      data: { status: 'PROCESSING', processingError: null },
    });

    // fire-and-forget: status polled by the client
    void this.runProcessing(analysisId, faces, options).catch(async (error) => {
      this.logger.error(`processing failed for ${analysisId}: ${error?.message}`, error?.stack);
      await this.prisma.paintingAnalysis
        .update({
          where: { id: analysisId },
          data: { status: 'FAILED', processingError: String(error?.message ?? error).slice(0, 1900) },
        })
        .catch(() => undefined);
    });

    return {
      success: true,
      message: `Processamento iniciado para ${faces.length} face(s).`,
      data: { analysisId, faceCount: faces.length },
    };
  }

  private resolveFilePath(filePath: string): string {
    const candidates = [
      isAbsolute(filePath) ? filePath : resolve(filePath),
      join(process.env.UPLOAD_DIR || './uploads', filePath),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    throw new BadRequestException(`Arquivo da arte não encontrado no disco: ${filePath}`);
  }

  private async runProcessing(
    analysisId: string,
    faces: Array<{ id: string; referenceKind: string; referenceValueCm: number; file: { path: string } }>,
    options: PaintingProcessFormData,
  ) {
    let engineVersion: string | null = null;
    for (const face of faces) {
      const imagePath = this.resolveFilePath(face.file.path);
      const artifact = await this.engineRunner.run({
        imagePath,
        referenceKind: face.referenceKind,
        referenceValueCm: face.referenceValueCm,
        stages: options.stages,
        paramsOverride: options.paramsOverride,
      });
      engineVersion = artifact.engineVersion ?? engineVersion;
      await this.materializeFace(analysisId, face.id, artifact);
    }
    // Business stages run automatically so the user lands on a complete result.
    // O status só vira REVIEW DEPOIS do compute — quem faz polling nunca vê
    // "pronto" com o plano ainda pela metade (evita compute concorrente).
    try {
      await this.computeService.compute(analysisId, { stages: ['MATCH', 'STRATEGY', 'PLAN'] });
    } catch (error: any) {
      this.logger.error(`auto-compute failed for ${analysisId}: ${error?.message}`, error?.stack);
    }

    await this.prisma.paintingAnalysis.update({
      where: { id: analysisId },
      data: { status: 'REVIEW', engineVersion },
    });
  }

  /**
   * Persists an engine artifact into relational rows. MANUAL overrides survive
   * reprocessing: rows are matched by engineId and manual fields are re-applied.
   */
  private async materializeFace(analysisId: string, faceId: string, artifact: any) {
    const existingRegions = await this.prisma.paintingRegion.findMany({
      where: { faceId },
      select: {
        engineId: true,
        paintId: true,
        paintSource: true,
        kind: true,
        kindSource: true,
        strategy: true,
        strategySource: true,
      },
    });
    const manualByEngineId = new Map(existingRegions.map((r) => [r.engineId, r]));
    const existingBoundaries = await this.prisma.paintingBoundary.findMany({
      where: { faceId },
      select: { engineId: true, resolution: true, resolutionSource: true },
    });
    const manualBoundaryByEngineId = new Map(existingBoundaries.map((b) => [b.engineId, b]));

    const image = artifact.image ?? {};
    const background = artifact.background ?? {};

    await this.prisma.$transaction(async (tx) => {
      await tx.paintingRegion.deleteMany({ where: { faceId } });
      await tx.paintingBoundary.deleteMany({ where: { faceId } });

      await tx.paintingAnalysisFace.update({
        where: { id: faceId },
        data: {
          pxPerCm: image.pxPerCmWork ?? null,
          widthCm: image.widthCm ?? null,
          heightCm: image.heightCm ?? null,
          areaM2: image.areaM2 ?? null,
          backgroundMode: background.mode ?? null,
          backgroundHex: background.hex ?? null,
          backgroundModeSource: 'AUTO',
          engineArtifact: {
            engineVersion: artifact.engineVersion,
            image,
            background,
            palette: artifact.palette ?? [],
            stagesRun: artifact.stagesRun ?? [],
            timingsSec: artifact.timingsSec ?? {},
            // v1 (por componente) e v2 (por faixa — estágio `layout`); o compute
            // prefere `layout` e cai para `adhesive` em artefatos antigos.
            adhesive: artifact.adhesive ?? [],
            layout: artifact.layout ?? null,
            photoZoneAreaPct: artifact.photoZoneAreaPct ?? 0,
          },
          processedAt: new Date(),
        },
      });

      for (const region of artifact.regions ?? []) {
        const manual = manualByEngineId.get(region.id);
        await tx.paintingRegion.create({
          data: {
            faceId,
            engineId: region.id,
            colorHex: region.hex,
            kind: manual?.kindSource === 'MANUAL' ? manual.kind : region.kind,
            kindSource: manual?.kindSource === 'MANUAL' ? 'MANUAL' : 'AUTO',
            paintId: manual?.paintSource === 'MANUAL' ? manual.paintId : null,
            paintSource: manual?.paintSource === 'MANUAL' ? 'MANUAL' : 'AUTO',
            strategy: manual?.strategySource === 'MANUAL' ? manual.strategy : null,
            strategySource: manual?.strategySource === 'MANUAL' ? 'MANUAL' : 'AUTO',
            areaM2: region.area_m2,
            perimeterM: region.perimeter_m,
            islands: region.islands ?? 0,
            minStrokeMm: region.min_stroke_mm ?? 0,
            bboxWidthCm: region.bbox_cm?.[0] ?? 0,
            bboxHeightCm: region.bbox_cm?.[1] ?? 0,
            geometry: {
              contour: region.contour ?? [],
              holes: region.holes ?? [],
              centroid: region.centroid ?? null,
              isBackground: region.is_background ?? false,
            },
            gradient: region.gradient ?? undefined,
            autoSnapshot: {
              kind: region.kind,
              areaM2: region.area_m2,
            },
          },
        });
      }

      for (const boundary of artifact.boundaries ?? []) {
        const manual = manualBoundaryByEngineId.get(boundary.id);
        await tx.paintingBoundary.create({
          data: {
            faceId,
            engineId: boundary.id,
            regionAId: boundary.a,
            regionBId: boundary.b ?? null,
            kind: boundary.kind,
            lengthM: boundary.length_m,
            dominantCurve: boundary.dominant_curve ?? null,
            curveHist: boundary.curve_hist_m ?? undefined,
            corners: boundary.corners ?? 0,
            resolution: manual?.resolutionSource === 'MANUAL' ? manual.resolution : null,
            resolutionSource: manual?.resolutionSource === 'MANUAL' ? 'MANUAL' : 'AUTO',
            samplePath: boundary.sample_path ?? undefined,
          },
        });
      }

      await tx.paintingAnalysisAlert.deleteMany({ where: { analysisId, resolvedAt: null } });
      for (const alert of artifact.alerts ?? []) {
        await tx.paintingAnalysisAlert.create({
          data: {
            analysisId,
            code: alert.code,
            severity: alert.severity ?? 'INFO',
            message: alert.message,
          },
        });
      }
    });
  }

  // =====================================================================
  // Manual overrides
  // =====================================================================

  async updateRegion(regionId: string, data: PaintingRegionUpdateFormData) {
    const region = await this.prisma.paintingRegion.findUnique({ where: { id: regionId } });
    if (!region) throw new NotFoundException('Região não encontrada.');
    const updated = await this.prisma.paintingRegion.update({
      where: { id: regionId },
      data: {
        ...(data.paintId !== undefined
          ? { paintId: data.paintId, paintSource: 'MANUAL' as const }
          : {}),
        ...(data.kind !== undefined ? { kind: data.kind, kindSource: 'MANUAL' as const } : {}),
        ...(data.strategy !== undefined
          ? { strategy: data.strategy, strategySource: 'MANUAL' as const }
          : {}),
      },
      include: { paint: true },
    });
    return { success: true, message: 'Região atualizada com sucesso.', data: updated };
  }

  async updateBoundary(boundaryId: string, data: PaintingBoundaryUpdateFormData) {
    const boundary = await this.prisma.paintingBoundary.findUnique({ where: { id: boundaryId } });
    if (!boundary) throw new NotFoundException('Fronteira não encontrada.');
    const updated = await this.prisma.paintingBoundary.update({
      where: { id: boundaryId },
      data: {
        ...(data.resolution !== undefined
          ? { resolution: data.resolution, resolutionSource: 'MANUAL' as const }
          : {}),
      },
    });
    return { success: true, message: 'Fronteira atualizada com sucesso.', data: updated };
  }

  async updateStep(stepId: string, data: PaintingStepUpdateFormData) {
    const step = await this.prisma.paintingProductionStep.findUnique({
      where: { id: stepId },
      include: { plan: true },
    });
    if (!step) throw new NotFoundException('Passo não encontrado.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.paintingProductionStep.update({
        where: { id: stepId },
        data: {
          ...(data.minutes !== undefined
            ? { minutes: data.minutes, minutesSource: 'MANUAL' as const }
            : {}),
          ...(data.actualMinutes !== undefined ? { actualMinutes: data.actualMinutes } : {}),
          ...(data.actualNotes !== undefined ? { actualNotes: data.actualNotes } : {}),
        },
      });
      if (data.minutes !== undefined) {
        await this.recalcPlanTotals(tx, step.planId);
      }
      return next;
    });
    return { success: true, message: 'Passo atualizado com sucesso.', data: updated };
  }

  /** Minutos de UMA sub-tarefa; o passo passa a valer a soma das suas tarefas. */
  async updateStepTask(taskId: string, data: { minutes?: number }) {
    const task = await this.prisma.paintingStepTask.findUnique({
      where: { id: taskId },
      include: { step: { select: { id: true, planId: true } } },
    });
    if (!task) throw new NotFoundException('Sub-tarefa não encontrada.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.paintingStepTask.update({
        where: { id: taskId },
        data: data.minutes !== undefined ? { minutes: data.minutes, minutesSource: 'MANUAL' as const } : {},
      });
      if (data.minutes !== undefined) {
        const siblings = await tx.paintingStepTask.findMany({ where: { stepId: task.stepId } });
        const total = siblings.reduce((sum, item) => sum + item.minutes, 0);
        await tx.paintingProductionStep.update({
          where: { id: task.stepId },
          data: { minutes: Number(total.toFixed(1)), minutesSource: 'MANUAL' as const },
        });
        await this.recalcPlanTotals(tx, task.step.planId);
      }
      return next;
    });
    return { success: true, message: 'Sub-tarefa atualizada com sucesso.', data: updated };
  }

  /**
   * Quantidade/valor de UMA linha de material. Recalcula o total da linha, o
   * material do passo e os totais do plano — a linha vira MANUAL e sobrevive ao
   * próximo recálculo apenas até um reprocessamento completo do plano.
   */
  async updateStepMaterial(materialId: string, data: { quantity?: number; unitPrice?: number }) {
    const material = await this.prisma.paintingStepMaterial.findUnique({
      where: { id: materialId },
      include: { step: { select: { id: true, planId: true } } },
    });
    if (!material) throw new NotFoundException('Linha de material não encontrada.');

    const quantity = data.quantity ?? material.quantity;
    const unitPrice = data.unitPrice ?? Number(material.unitPriceSnapshot);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.paintingStepMaterial.update({
        where: { id: materialId },
        data: {
          quantity,
          unitPriceSnapshot: unitPrice.toFixed(4),
          totalCost: (quantity * unitPrice).toFixed(2),
          source: 'MANUAL',
        },
      });
      const siblings = await tx.paintingStepMaterial.findMany({ where: { stepId: material.stepId } });
      const materialCost = siblings.reduce((sum, line) => sum + Number(line.totalCost), 0);
      await tx.paintingProductionStep.update({
        where: { id: material.stepId },
        data: { materialCost: materialCost.toFixed(2) },
      });
      await this.recalcPlanTotals(tx, material.step.planId);
      return next;
    });
    return { success: true, message: 'Linha atualizada com sucesso.', data: updated };
  }

  async resolveAlert(alertId: string) {
    const alert = await this.prisma.paintingAnalysisAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Alerta não encontrado.');
    const updated = await this.prisma.paintingAnalysisAlert.update({
      where: { id: alertId },
      data: { resolvedAt: new Date() },
    });
    return { success: true, message: 'Alerta resolvido.', data: updated };
  }

  /** Recompute labor/total roll-ups after a manual minutes edit (prices untouched). */
  async recalcPlanTotals(tx: any, planId: string) {
    const plan = await tx.paintingProductionPlan.findUnique({
      where: { id: planId },
      include: { steps: { include: { tasks: true } } },
    });
    if (!plan) return;
    const hourly = Number(plan.laborRatePerHour);
    let totalMinutes = 0;
    let totalWait = 0;
    let laborCost = 0;
    let materialCost = 0;
    for (const step of plan.steps) {
      totalMinutes += step.minutes;
      totalWait += step.waitMinutes;
      // Mão de obra é sempre individual: minutos × custo-hora.
      const stepLabor = (step.minutes / 60) * hourly;
      await tx.paintingProductionStep.update({
        where: { id: step.id },
        data: { laborCost: stepLabor.toFixed(2) },
      });
      laborCost += stepLabor;
      materialCost += Number(step.materialCost);
    }
    const indirect = Number(plan.indirectCost);
    const totalCost = laborCost + materialCost + indirect;
    await tx.paintingProductionPlan.update({
      where: { id: planId },
      data: {
        totalMinutes,
        totalWaitMinutes: totalWait,
        laborCost: laborCost.toFixed(2),
        materialCost: materialCost.toFixed(2),
        totalCost: totalCost.toFixed(2),
        suggestedPrice: (totalCost * (1 + plan.profitMarginPct)).toFixed(2),
      },
    });
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.paintingAnalysis.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Análise não encontrada.');
  }
}
