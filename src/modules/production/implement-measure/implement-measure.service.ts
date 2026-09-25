// apps/api/src/modules/production/implement-measure/implement-measure.service.ts

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ImplementMeasure } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants/enums';
import type { ImplementMeasureCreateFormData, ImplementMeasureUpdateFormData } from '../../../schemas';
import { ImplementMeasurePrismaRepository } from './repositories/implement-measure-prisma.repository';
import {
  replicateImplementMeasuresToQuoteSiblings,
  type ReplicationLogEntry,
} from '../../../utils/implement-measure-replication';
import { FACE_REL, attachMeasure, setFace, type ImplementFace } from './implement-measure-writer';

/** O formato que as rotas do módulo sempre devolveram: foto e seções em ordem. */
const RESPONSE_INCLUDE = {
  photo: true,
  sections: { orderBy: { position: 'asc' as const } },
};

/** Quem usa uma medida. */
interface ImplementMeasureUser {
  implementId: string;
  taskId: string;
  plate: string | null;
}

function implementMeasureUser(i: { id: string; taskId: string; plate: string | null }): ImplementMeasureUser {
  return { implementId: i.id, taskId: i.taskId, plate: i.plate };
}

@Injectable()
export class ImplementMeasureService {
  private readonly logger = new Logger(ImplementMeasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly implementMeasureRepository: ImplementMeasurePrismaRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  async findById(id: string, include?: any): Promise<ImplementMeasure | null> {
    return this.implementMeasureRepository.findById(id, include);
  }

  async findByImplementId(
    implementId: string,
    options?: { includePhoto?: boolean },
  ): Promise<{
    leftSideMeasure: ImplementMeasure | null;
    rightSideMeasure: ImplementMeasure | null;
    backSideMeasure: ImplementMeasure | null;
  }> {
    return this.implementMeasureRepository.findByImplementId(implementId, options);
  }

  /**
   * Find all implementMeasures (for implementMeasure library/selection)
   * Returns implementMeasures with usage count and which implements use them
   */
  async findAll(options?: {
    includeUsage?: boolean;
    includeSections?: boolean;
  }): Promise<Array<ImplementMeasure & { usageCount?: number }>> {
    const implementMeasures = await this.prisma.implementMeasure.findMany({
      include: {
        photo: true,
        sections: options?.includeSections
          ? {
              orderBy: { position: 'asc' },
            }
          : false,
        ...(options?.includeUsage && {
          implementsBackSide: { select: { id: true } },
          implementsLeftSide: { select: { id: true } },
          implementsRightSide: { select: { id: true } },
        }),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (options?.includeUsage) {
      return implementMeasures.map(implementMeasure => ({
        ...implementMeasure,
        usageCount:
          ((implementMeasure as any).implementsBackSide?.length || 0) +
          ((implementMeasure as any).implementsLeftSide?.length || 0) +
          ((implementMeasure as any).implementsRightSide?.length || 0),
      }));
    }

    return implementMeasures;
  }

  /**
   * Assign an existing implementMeasure to a implement side
   * This is a simpler alternative to createOrUpdateImplementMeasure when you just want to assign existing
   */
  async assignImplementMeasureToImplement(
    implementId: string,
    side: 'left' | 'right' | 'back',
    implementMeasureId: string,
    userId?: string,
  ): Promise<void> {
    // Verify implementMeasure exists
    const implementMeasure = await this.findById(implementMeasureId);
    if (!implementMeasure) {
      throw new NotFoundException(`ImplementMeasure ${implementMeasureId} não encontrado`);
    }

    // Verify implement exists
    const implement = await this.prisma.implement.findUnique({ where: { id: implementId } });
    if (!implement) {
      throw new NotFoundException(`Implemento ${implementId} não encontrado`);
    }

    // Numa transação agora: a medida atribuída vale para os demais veículos do
    // mesmo orçamento (por CÓPIA — ver `utils/implement-measure-replication.ts`),
    // e ou ela chega aos N implementos, ou a nenhum. Este caminho exige o implemento
    // e não o cria; o irmão sem implemento é pulado e o log diz qual.
    //
    // Atribuir não compartilha: se outra face já usa a linha, esta ganha uma
    // cópia (escritor único); a linha anterior da face só sai se ficou sem uso.
    await this.prisma.$transaction(async tx => {
      await attachMeasure(tx, implementId, side, implementMeasureId);
      await this.replicateToQuoteSiblings(tx, implement.taskId, [side], userId);
    });

    // Log the change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.IMPLEMENT,
      entityId: implementId,
      action: CHANGE_ACTION.UPDATE,
      reason: `ImplementMeasure ${implementMeasureId} atribuído ao lado ${side} do implemento`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });

    // Dispatch the consolidated task.field.implement.measures notification (reusing the
    // same helper the other implementMeasure paths use). Fired AFTER the update; failures are
    // swallowed inside the helper so they never break the assign flow.
    const sideLabels: Record<string, string> = {
      left: 'Motorista',
      right: 'Sapo',
      back: 'Traseira',
    };
    const sideLabel = sideLabels[side] || side;
    await this.dispatchConsolidatedImplementMeasureNotification(
      implementId,
      `${sideLabel}: implementMeasure atribuído`,
      userId,
    ).catch(err => {
      this.logger.error('Error sending implementMeasure assign notification:', err);
    });
  }

  /**
   * Replica os lados escritos para os demais veículos do orçamento da tarefa —
   * ver `utils/implement-measure-replication.ts`. A trilha vai para a TAREFA
   * irmã, no campo `implementMeasures`, dizendo de qual veículo a medida veio.
   */
  private async replicateToQuoteSiblings(
    tx: any,
    sourceTaskId: string,
    sides: ImplementFace[],
    userId?: string | null,
  ): Promise<void> {
    if (!sourceTaskId || sides.length === 0) return;
    await replicateImplementMeasuresToQuoteSiblings(tx, {
      sourceTaskId,
      sides,
      logChange: (entry: ReplicationLogEntry) =>
        this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: entry.taskId,
          action: CHANGE_ACTION.UPDATE,
          field: entry.field,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          reason: entry.reason,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: sourceTaskId,
          userId: userId || null,
          transaction: tx,
          metadata: { replicatedFromTaskId: sourceTaskId },
        }),
    });
  }

  async create(data: ImplementMeasureCreateFormData, userId?: string): Promise<ImplementMeasure> {
    const implementMeasure = await this.implementMeasureRepository.create(data, userId);

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
      entityId: implementMeasure.id,
      action: CHANGE_ACTION.CREATE,
      reason: 'Medida criada',
      oldValue: null,
      newValue: implementMeasure,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });

    return implementMeasure;
  }

  async update(id: string, data: ImplementMeasureUpdateFormData, userId?: string): Promise<ImplementMeasure> {
    const existingImplementMeasure = await this.implementMeasureRepository.findById(id, {
      sections: { orderBy: { position: 'asc' } },
    });
    if (!existingImplementMeasure) {
      throw new NotFoundException('Medida não encontrada');
    }

    // A edição pelo ID muda a medida de todo implemento ligado a esta linha (cada
    // um termina com a SUA linha — escritor único) — e o tamanho é do
    // orçamento: cada um desses implementos replica o lado editado para os irmãos
    // dele, na mesma transação da edição.
    const implementMeasure = await this.implementMeasureRepository.update(
      id,
      data,
      userId,
      async (tx, references) => {
        // As faces que usavam a linha ANTES da edição — cada uma já tem a sua
        // linha agora (o escritor desfaz o compartilhamento ao editar pelo ID).
        const facesByTask = new Map<string, ImplementFace[]>();
        for (const ref of references) {
          facesByTask.set(ref.taskId, [...(facesByTask.get(ref.taskId) ?? []), ref.face]);
        }
        for (const [taskId, lados] of facesByTask) {
          await this.replicateToQuoteSiblings(tx, taskId, lados, userId);
        }
      },
    );

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
      entityId: id,
      action: CHANGE_ACTION.UPDATE,
      reason: 'Medida atualizada',
      oldValue: existingImplementMeasure,
      newValue: implementMeasure,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });

    return implementMeasure;
  }

  async delete(id: string, userId?: string, force: boolean = false): Promise<void> {
    // Check if implementMeasure exists
    const existingImplementMeasure = await this.implementMeasureRepository.findById(id);
    if (!existingImplementMeasure) {
      throw new NotFoundException('Medida não encontrada');
    }

    // Check if implementMeasure is being used by any implements (SHARED RESOURCE PROTECTION)
    const usageCount = await this.getImplementMeasureUsageCount(id);
    if (usageCount > 0 && !force) {
      throw new Error(
        `Este implementMeasure está sendo usado por ${usageCount} implemento(ões). ` +
          `Não é possível deletar um implementMeasure compartilhado. ` +
          `Primeiro, remova o implementMeasure de todos os implementos ou use force=true para deletar mesmo assim.`,
      );
    }

    await this.implementMeasureRepository.delete(id, userId);

    // Log the change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
      entityId: id,
      action: CHANGE_ACTION.DELETE,
      reason: force ? 'Medida excluída (forçado)' : 'Medida excluída',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });
  }

  /**
   * Get count of implements using this implementMeasure
   * Returns total count across all three sides (back, left, right)
   */
  async getImplementMeasureUsageCount(implementMeasureId: string): Promise<number> {
    const [backCount, leftCount, rightCount] = await Promise.all([
      this.prisma.implement.count({ where: { backSideMeasureId: implementMeasureId } }),
      this.prisma.implement.count({ where: { leftSideMeasureId: implementMeasureId } }),
      this.prisma.implement.count({ where: { rightSideMeasureId: implementMeasureId } }),
    ]);
    return backCount + leftCount + rightCount;
  }

  /**
   * Get all implements using this implementMeasure (detailed)
   * Returns which implements use this implementMeasure and on which sides
   */
  async getImplementsUsingImplementMeasure(implementMeasureId: string): Promise<{
    backSide: ImplementMeasureUser[];
    leftSide: ImplementMeasureUser[];
    rightSide: ImplementMeasureUser[];
    totalCount: number;
  }> {
    const [backImplements, leftImplements, rightImplements] = await Promise.all([
      this.prisma.implement.findMany({
        where: { backSideMeasureId: implementMeasureId },
        select: { id: true, taskId: true, plate: true },
      }),
      this.prisma.implement.findMany({
        where: { leftSideMeasureId: implementMeasureId },
        select: { id: true, taskId: true, plate: true },
      }),
      this.prisma.implement.findMany({
        where: { rightSideMeasureId: implementMeasureId },
        select: { id: true, taskId: true, plate: true },
      }),
    ]);

    return {
      backSide: backImplements.map(implementMeasureUser),
      leftSide: leftImplements.map(implementMeasureUser),
      rightSide: rightImplements.map(implementMeasureUser),
      totalCount: backImplements.length + leftImplements.length + rightImplements.length,
    };
  }

  /**
   * Format a implementMeasure summary string: "{totalWidth} x {height} {doorDescription}"
   */
  private formatImplementMeasureSummary(implementMeasure: {
    height: number;
    sections?: Array<{ width: number; isDoor: boolean }>;
  }): string {
    const sections = implementMeasure.sections || [];
    const totalWidth = sections.reduce((sum, s) => sum + s.width, 0);
    const doorCount = sections.filter(s => s.isDoor).length;
    const doorText =
      doorCount === 0 ? 'nenhuma porta' : doorCount === 1 ? 'uma porta' : `${doorCount} portas`;
    return `${totalWidth} x ${implementMeasure.height} ${doorText}`;
  }

  /**
   * Build a human-readable PT-BR description comparing old vs new implementMeasure
   */
  private formatImplementMeasureChangeDescription(
    side: 'left' | 'right' | 'back',
    oldImplementMeasure: {
      height: number;
      sections?: Array<{ width: number; isDoor: boolean }>;
    } | null,
    newImplementMeasure: { height: number; sections?: Array<{ width: number; isDoor: boolean }> },
  ): string {
    const sideLabels: Record<string, string> = {
      left: 'Motorista',
      right: 'Sapo',
      back: 'Traseira',
    };
    const sideLabel = sideLabels[side] || side;

    if (!oldImplementMeasure || !oldImplementMeasure.sections?.length) {
      const newSummary = this.formatImplementMeasureSummary(newImplementMeasure);
      return `ImplementMeasure ${sideLabel} definido: ${newSummary}`;
    }

    const oldSections = oldImplementMeasure.sections || [];
    const newSections = newImplementMeasure.sections || [];

    const oldWidth = oldSections.reduce((sum, s) => sum + s.width, 0);
    const newWidth = newSections.reduce((sum, s) => sum + s.width, 0);
    const oldDoors = oldSections.filter(s => s.isDoor).length;
    const newDoors = newSections.filter(s => s.isDoor).length;

    const dimensionsChanged = oldWidth !== newWidth || oldImplementMeasure.height !== newImplementMeasure.height;
    const doorsChanged = oldDoors !== newDoors;

    const oldSummary = this.formatImplementMeasureSummary(oldImplementMeasure);
    const newSummary = this.formatImplementMeasureSummary(newImplementMeasure);

    if (dimensionsChanged && doorsChanged) {
      return `${oldSummary} para ${newSummary}`;
    }

    if (dimensionsChanged) {
      return `Medidas alteradas de ${oldWidth} x ${oldImplementMeasure.height} para ${newWidth} x ${newImplementMeasure.height}`;
    }

    if (doorsChanged) {
      const doorAction = newDoors > oldDoors ? 'Porta adicionada' : 'Porta removida';
      return `${doorAction} no ${sideLabel} (medidas mantidas: ${oldWidth} x ${oldImplementMeasure.height})`;
    }

    return `ImplementMeasure ${sideLabel} atualizado: ${newSummary}`;
  }

  async createOrUpdateImplementMeasure(
    implementId: string,
    side: 'left' | 'right' | 'back',
    data: ImplementMeasureCreateFormData,
    userId?: string,
    photoFile?: Express.Multer.File,
    existingImplementMeasureId?: string, // NEW: Assign existing implementMeasure instead of creating new
    suppressNotification?: boolean, // NEW: Skip per-side notification (used by batch consolidation)
  ): Promise<ImplementMeasure> {
    this.logger.log('');
    this.logger.log('═══════════════════════════════════════════════════════════════');
    this.logger.log('🚚 [BACKEND] createOrUpdateImplementMeasure - REQUEST RECEIVED');
    this.logger.log('═══════════════════════════════════════════════════════════════');
    this.logger.log(`[BACKEND] Input parameters:`, {
      implementId,
      side,
      userId,
      hasPhotoFile: !!photoFile,
      photoFileName: photoFile?.originalname,
      data: {
        height: data.height,
        sectionsCount: data.sections?.length,
        sections: data.sections?.map(s => ({
          width: s.width,
          isDoor: s.isDoor,
          doorHeight: s.doorHeight,
          position: s.position,
        })),
        totalWidth: data.sections?.reduce((sum, s) => sum + s.width, 0),
        photoId: data.photoId,
      },
    });

    let oldImplementMeasureSnapshot: {
      height: number;
      sections: Array<{ width: number; isDoor: boolean }>;
    } | null = null;

    const result = await this.prisma.$transaction(async tx => {
      this.logger.log('[BACKEND] Transaction started');

      // Get the implement
      this.logger.log(`[BACKEND] Fetching implement with ID: ${implementId}`);
      const implement = await tx.implement.findUnique({
        where: { id: implementId },
        include: {
          leftSideMeasure: {
            include: { sections: { orderBy: { position: 'asc' as const } } },
          },
          rightSideMeasure: {
            include: { sections: { orderBy: { position: 'asc' as const } } },
          },
          backSideMeasure: {
            include: { sections: { orderBy: { position: 'asc' as const } } },
          },
        },
      });

      if (!implement) {
        this.logger.error(`[BACKEND] ❌ Implement NOT FOUND: ${implementId}`);
        throw new NotFoundException(
          `Implemento não encontrado para ID ${implementId}. Certifique-se de que a tarefa foi criada corretamente antes de adicionar implementMeasures.`,
        );
      }

      this.logger.log(`[BACKEND] ✅ implement found:`, {
        id: implement.id,
        hasLeftImplementMeasure: !!implement.leftSideMeasure,
        hasRightImplementMeasure: !!implement.rightSideMeasure,
        hasBackImplementMeasure: !!implement.backSideMeasure,
      });

      // A medida atual desta face (para o log e a notificação; a escrita é do
      // escritor único, que relê a face dentro da transação)
      const existingImplementMeasure = implement[FACE_REL[side]];

      // Capture old implementMeasure snapshot for notification comparison (before any modifications)
      if (existingImplementMeasure && (existingImplementMeasure as any).sections) {
        oldImplementMeasureSnapshot = {
          height: existingImplementMeasure.height,
          sections: (
            (existingImplementMeasure as any).sections as Array<{ width: number; isDoor: boolean }>
          ).map(s => ({
            width: s.width,
            isDoor: s.isDoor,
          })),
        };
      }

      this.logger.log(`[BACKEND] Side '${side}' - Checking existing implementMeasure:`, {
        hasExistingImplementMeasure: !!existingImplementMeasure,
        existingImplementMeasureId: existingImplementMeasure?.id,
      });

      // Upload photo file if provided (only for backside)
      let photoId = data.photoId || null;
      if (photoFile && side === 'back') {
        this.logger.log(`[BACKEND] 📷 Uploading implementMeasure photo for ${side} side`);
        const uploadedPhoto = await this.fileService.createFromUploadWithTransaction(
          tx,
          photoFile,
          'implementMeasurePhotos',
          userId || '',
          {
            entityType: 'IMPLEMENT_MEASURE',
          },
        );
        photoId = uploadedPhoto.id;
        this.logger.log(`[BACKEND] ✅ Photo uploaded successfully:`, {
          photoId,
          filename: photoFile.originalname,
        });
      }

      let implementMeasure: ImplementMeasure;

      // Tudo pelo escritor único: atribuir uma linha existente (cópia se outra
      // face já a usa), ou gravar uma linha NOVA no lugar da anterior — que só
      // é apagada se ficou sem uso (nenhuma face, nenhuma análise de pintura).
      if (existingImplementMeasureId) {
        this.logger.log(
          `[BACKEND] 🔗 SHARED LAYOUT MODE - Assigning existing implementMeasure ${existingImplementMeasureId}`,
        );

        const attached = await attachMeasure(tx, implementId, side, existingImplementMeasureId);
        if (!attached) {
          throw new NotFoundException(`Medida compartilhada ${existingImplementMeasureId} não encontrada`);
        }
        this.logger.log(
          `[BACKEND] ✅ ImplementMeasure ${existingImplementMeasureId} attached (${attached.action}) as ${attached.measureId}`,
        );

        implementMeasure = await tx.implementMeasure.findUniqueOrThrow({
          where: { id: attached.measureId! },
          include: RESPONSE_INCLUDE,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.IMPLEMENT,
          entityId: implementId,
          action: CHANGE_ACTION.UPDATE,
          reason: `Medida compartilhada atribuída ao lado ${side} do implemento`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || null,
          userId: userId || null,
          transaction: tx,
        });
      } else {
        this.logger.log(
          existingImplementMeasure
            ? `[BACKEND] ⚙️  REPLACE MODE - Existing implementMeasure found for ${side} side`
            : `[BACKEND] ➕ CREATE MODE - No existing implementMeasure for ${side} side`,
        );

        const written = await setFace(
          tx,
          implementId,
          side,
          { height: data.height, sections: data.sections, photoId },
          { mode: 'replace' },
        );
        implementMeasure = await tx.implementMeasure.findUniqueOrThrow({
          where: { id: written.measureId! },
          include: RESPONSE_INCLUDE,
        });

        this.logger.log(`[BACKEND] ✅ New implementMeasure created successfully:`, {
          oldImplementMeasureId: written.previousId,
          oldImplementMeasure: written.previous,
          newImplementMeasureId: implementMeasure.id,
          height: implementMeasure.height,
          sectionsCount: (implementMeasure as any).sections?.length || 0,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
          entityId: implementMeasure.id,
          action: CHANGE_ACTION.CREATE,
          reason: written.previousId
            ? `Medidas do lado ${side} do implemento substituído (deletar e criar novo)`
            : `Medidas do lado ${side} do implemento criado`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || null,
          userId: userId || null,
          transaction: tx,
        });
      }

      // ── O TAMANHO É DO ORÇAMENTO ────────────────────────────────────────
      // A medida deste lado vale para os demais veículos do mesmo orçamento —
      // por cópia, nesta mesma transação. Este caminho exige o implemento e não o
      // cria; o irmão sem implemento é pulado e o log diz qual.
      await this.replicateToQuoteSiblings(tx, implement.taskId, [side], userId);

      this.logger.log(`[BACKEND] Transaction committed successfully`);
      this.logger.log(`[BACKEND] 🎉 FINAL RESULT:`, {
        implementMeasureId: implementMeasure.id,
        height: implementMeasure.height,
        sectionsCount: (implementMeasure as any).sections?.length || 0,
        side,
        implementId,
      });
      this.logger.log('═══════════════════════════════════════════════════════════════');
      this.logger.log('');

      return implementMeasure;
    });

    // Build new implementMeasure snapshot for notification comparison
    const newImplementMeasureSnapshot = {
      height: data.height,
      sections: (data.sections || []).map(s => ({
        width: s.width,
        isDoor: s.isDoor,
      })),
    };

    // Send notifications for implementMeasure change (outside transaction to not block it).
    // Skipped when suppressNotification is set (the batch path dispatches ONE
    // consolidated 'task.field.implement.measures' notification covering all sides).
    if (!suppressNotification) {
      this.sendImplementMeasureChangeNotifications(
        implementId,
        side,
        existingImplementMeasureId ? 'assign' : 'update',
        userId,
        oldImplementMeasureSnapshot,
        newImplementMeasureSnapshot,
      ).catch(err => {
        this.logger.error('Error sending implementMeasure change notifications:', err);
      });
    }

    return result;
  }

  async generateSVG(implementMeasureId: string): Promise<string> {
    const implementMeasure = await this.implementMeasureRepository.findById(implementMeasureId);
    if (!implementMeasure) {
      throw new NotFoundException('Medida não encontrada');
    }

    // Use sections from database
    const sections = (implementMeasure as any).sections || [];
    // Scale: 1cm = 1mm in SVG (so 840cm implementMeasure becomes 840mm SVG)
    const height = implementMeasure.height * 100; // Convert m to cm scale (as mm in SVG)
    const totalLength = sections.reduce((sum: number, s: any) => sum + s.width * 100, 0);

    const marginX = 50;
    const marginY = 50;
    const svgWidth = totalLength + marginX * 2 + 50;
    const svgHeight = height + marginY * 2 + 50;

    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}mm" height="${svgHeight}mm" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${marginX}" y="${marginY}" width="${totalLength}" height="${height}" fill="none" stroke="#000" stroke-width="1"/>`;

    // Draw vertical section lines and door lines
    let currentX = marginX;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const sectionWidth = section.width * 100; // cm scale

      // Draw vertical line between sections (except for the last one)
      if (i < sections.length - 1) {
        svgContent += `
    <line x1="${currentX + sectionWidth}" y1="${marginY}" x2="${currentX + sectionWidth}" y2="${marginY + height}" stroke="#000" stroke-width="1"/>`;
      }

      // Draw door top line if this section is a door
      // doorHeight is measured from bottom of implementMeasure to top of door opening
      // So the door top line Y position = marginY + (height - doorHeight)
      if (section.isDoor && section.doorHeight !== null && section.doorHeight !== undefined) {
        const doorHeightCm = section.doorHeight * 100; // cm scale
        const doorTopY = marginY + (height - doorHeightCm);
        svgContent += `
    <line x1="${currentX}" y1="${doorTopY}" x2="${currentX + sectionWidth}" y2="${doorTopY}" stroke="#000" stroke-width="1"/>`;
      }

      currentX += sectionWidth;
    }

    // Add dimension annotations (values in cm)
    svgContent += `
    <line x1="${marginX - 20}" y1="${marginY}" x2="${marginX - 20}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${marginX - 25}" y1="${marginY}" x2="${marginX - 15}" y2="${marginY}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${marginX - 25}" y1="${marginY + height}" x2="${marginX - 15}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${marginX - 20},${marginY + 5} ${marginX - 17},${marginY + 10} ${marginX - 23},${marginY + 10}" fill="#0066cc"/>
    <polygon points="${marginX - 20},${marginY + height - 5} ${marginX - 17},${marginY + height - 10} ${marginX - 23},${marginY + height - 10}" fill="#0066cc"/>
    <text x="${marginX - 30}" y="${marginY + height / 2}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc" transform="rotate(-90, ${marginX - 30}, ${marginY + height / 2})">${Math.round(height)} cm</text>`;

    // Add width dimensions for each section
    currentX = marginX;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const sectionWidth = section.width * 100; // cm scale

      svgContent += `
    <line x1="${currentX}" y1="${marginY + height + 20}" x2="${currentX + sectionWidth}" y2="${marginY + height + 20}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX}" y1="${marginY + height + 15}" x2="${currentX}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth}" y1="${marginY + height + 15}" x2="${currentX + sectionWidth}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + 5},${marginY + height + 20} ${currentX + 10},${marginY + height + 17} ${currentX + 10},${marginY + height + 23}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth - 5},${marginY + height + 20} ${currentX + sectionWidth - 10},${marginY + height + 17} ${currentX + sectionWidth - 10},${marginY + height + 23}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth / 2}" y="${marginY + height + 35}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc">${Math.round(sectionWidth)} cm</text>`;

      // Add door height dimension if this section is a door
      // doorHeight is measured from bottom of implementMeasure to top of door opening
      if (section.isDoor && section.doorHeight !== null && section.doorHeight !== undefined) {
        const doorHeightCm = section.doorHeight * 100; // cm scale
        const doorTopY = marginY + (height - doorHeightCm);
        svgContent += `
    <line x1="${currentX + sectionWidth + 20}" y1="${doorTopY}" x2="${currentX + sectionWidth + 20}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${doorTopY}" x2="${currentX + sectionWidth + 25}" y2="${doorTopY}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${marginY + height}" x2="${currentX + sectionWidth + 25}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + sectionWidth + 20},${doorTopY + 5} ${currentX + sectionWidth + 17},${doorTopY + 10} ${currentX + sectionWidth + 23},${doorTopY + 10}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth + 20},${marginY + height - 5} ${currentX + sectionWidth + 17},${marginY + height - 10} ${currentX + sectionWidth + 23},${marginY + height - 10}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth + 30}" y="${doorTopY + doorHeightCm / 2}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc" transform="rotate(90, ${currentX + sectionWidth + 30}, ${doorTopY + doorHeightCm / 2})">${Math.round(doorHeightCm)} cm</text>`;
      }

      currentX += sectionWidth;
    }

    svgContent += `
</svg>`;

    return svgContent;
  }

  /**
   * Send notifications to relevant users when a implementMeasure is created/updated via the standalone endpoint.
   * Looks up the associated task from the implement to determine notification targets.
   */
  private async sendImplementMeasureChangeNotifications(
    implementId: string,
    side: 'left' | 'right' | 'back',
    action: 'update' | 'assign',
    userId?: string,
    oldImplementMeasure?: {
      height: number;
      sections: Array<{ width: number; isDoor: boolean }>;
    } | null,
    newImplementMeasure?: {
      height: number;
      sections: Array<{ width: number; isDoor: boolean }>;
    } | null,
  ): Promise<void> {
    const sideLabels: Record<string, string> = {
      left: 'Motorista',
      right: 'Sapo',
      back: 'Traseira',
    };
    const sideLabel = sideLabels[side] || side;

    // Build implementMeasure change description
    const implementMeasureChangeDescription = newImplementMeasure
      ? this.formatImplementMeasureChangeDescription(side, oldImplementMeasure || null, newImplementMeasure)
      : `ImplementMeasure ${sideLabel} alterado`;
    const oldImplementMeasureSummary = oldImplementMeasure ? this.formatImplementMeasureSummary(oldImplementMeasure) : '';
    const newImplementMeasureSummary = newImplementMeasure ? this.formatImplementMeasureSummary(newImplementMeasure) : '';

    // Find the task associated with this implement
    const implement = await this.prisma.implement.findUnique({
      where: { id: implementId },
      select: {
        taskId: true,
        task: {
          select: {
            id: true,
            name: true,
            sectorId: true,
            sector: {
              select: { leaderId: true },
            },
          },
        },
      },
    });

    if (!implement?.task) {
      this.logger.warn(`[sendImplementMeasureChangeNotifications] No task found for implement ${implementId}`);
      return;
    }

    const task = implement.task;

    const changedByUser = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        })
      : null;
    const changedByName = changedByUser?.name || 'Sistema';

    // Use the consolidated config key. The legacy per-side keys
    // (task.field.implement.*SideImplementMeasureId) are no longer dispatched so they go dormant.
    const configKey = 'task.field.implement.measures';
    const implementMeasureChangeSummary = `${sideLabel}: ${implementMeasureChangeDescription}`;

    try {
      await this.dispatchService.dispatchByConfiguration(configKey, userId || 'system', {
        entityType: 'Task',
        entityId: task.id,
        action,
        data: {
          taskName: task.name,
          sideLabel,
          implementId,
          side,
          actorId: userId,
          changedBy: changedByName,
          implementMeasureChangeDescription,
          implementMeasureChangeSummary,
          oldImplementMeasureSummary,
          newImplementMeasureSummary,
        },
        overrides: {
          title: 'Medidas do Implemento atualizado',
          body: `Medidas do implemento da tarefa "${task.name}" atualizado: ${implementMeasureChangeSummary}`,
          webUrl: `/producao/cronograma/detalhes/${task.id}`,
        },
      });

      this.logger.log(
        `[sendImplementMeasureChangeNotifications] Dispatched ${configKey} for implementMeasure ${action} on ${sideLabel}: ${implementMeasureChangeDescription}`,
      );
    } catch (err) {
      this.logger.error(`[sendImplementMeasureChangeNotifications] Failed to dispatch notification:`, err);
    }
  }

  /**
   * Batch-update multiple implement implementMeasure sides in a single operation and dispatch ONE
   * consolidated 'task.field.implement.measures' notification summarizing all changed sides.
   *
   * Each provided side is processed via createOrUpdateImplementMeasure with
   * suppressNotification=true so no per-side notifications fire; this method then sends
   * a single notification describing only the sides that actually changed.
   */
  async updateImplementMeasureBatch(
    implementId: string,
    sides: {
      left?: ImplementMeasureCreateFormData;
      right?: ImplementMeasureCreateFormData;
      back?: ImplementMeasureCreateFormData;
    },
    userId?: string,
  ): Promise<{
    left?: ImplementMeasure;
    right?: ImplementMeasure;
    back?: ImplementMeasure;
  }> {
    const sideLabels: Record<string, string> = {
      left: 'Motorista',
      right: 'Sapo',
      back: 'Traseira',
    };

    // Capture old implementMeasure snapshots BEFORE any update so we can describe the changes.
    const implementBefore = await this.prisma.implement.findUnique({
      where: { id: implementId },
      include: {
        leftSideMeasure: {
          include: { sections: { orderBy: { position: 'asc' as const } } },
        },
        rightSideMeasure: {
          include: { sections: { orderBy: { position: 'asc' as const } } },
        },
        backSideMeasure: {
          include: { sections: { orderBy: { position: 'asc' as const } } },
        },
      },
    });

    if (!implementBefore) {
      throw new NotFoundException(`Implemento não encontrado para ID ${implementId}.`);
    }

    const oldImplementMeasureBySide: Record<
      string,
      { height: number; sections: Array<{ width: number; isDoor: boolean }> } | null
    > = {
      left: implementBefore.leftSideMeasure
        ? {
            height: (implementBefore.leftSideMeasure as any).height,
            sections: ((implementBefore.leftSideMeasure as any).sections || []).map(
              (s: any) => ({ width: s.width, isDoor: s.isDoor }),
            ),
          }
        : null,
      right: implementBefore.rightSideMeasure
        ? {
            height: (implementBefore.rightSideMeasure as any).height,
            sections: ((implementBefore.rightSideMeasure as any).sections || []).map(
              (s: any) => ({ width: s.width, isDoor: s.isDoor }),
            ),
          }
        : null,
      back: implementBefore.backSideMeasure
        ? {
            height: (implementBefore.backSideMeasure as any).height,
            sections: ((implementBefore.backSideMeasure as any).sections || []).map(
              (s: any) => ({ width: s.width, isDoor: s.isDoor }),
            ),
          }
        : null,
    };

    const result: { left?: ImplementMeasure; right?: ImplementMeasure; back?: ImplementMeasure } = {};
    const changedSideDescriptions: string[] = [];

    for (const side of ['left', 'right', 'back'] as const) {
      const data = sides[side];
      if (!data) continue;

      // Process this side, suppressing its individual notification.
      result[side] = await this.createOrUpdateImplementMeasure(
        implementId,
        side,
        data,
        userId,
        undefined,
        undefined,
        true, // suppressNotification
      );

      const newImplementMeasureSnapshot = {
        height: data.height,
        sections: (data.sections || []).map(s => ({
          width: s.width,
          isDoor: s.isDoor,
        })),
      };

      const description = this.formatImplementMeasureChangeDescription(
        side,
        oldImplementMeasureBySide[side],
        newImplementMeasureSnapshot,
      );
      changedSideDescriptions.push(`${sideLabels[side]}: ${description}`);
    }

    // Dispatch ONE consolidated notification for all changed sides.
    if (changedSideDescriptions.length > 0) {
      await this.dispatchConsolidatedImplementMeasureNotification(
        implementId,
        changedSideDescriptions.join('; '),
        userId,
      ).catch(err => {
        this.logger.error('Error sending consolidated implementMeasure change notification:', err);
      });
    }

    return result;
  }

  /**
   * Dispatch a single consolidated 'task.field.implement.measures' notification for a implement.
   */
  private async dispatchConsolidatedImplementMeasureNotification(
    implementId: string,
    implementMeasureChangeSummary: string,
    userId?: string,
  ): Promise<void> {
    const implement = await this.prisma.implement.findUnique({
      where: { id: implementId },
      select: {
        task: {
          select: { id: true, name: true, sectorId: true },
        },
      },
    });

    if (!implement?.task) {
      this.logger.warn(
        `[dispatchConsolidatedImplementMeasureNotification] No task found for implement ${implementId}`,
      );
      return;
    }

    const task = implement.task;

    const changedByUser = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        })
      : null;
    const changedByName = changedByUser?.name || 'Sistema';

    try {
      await this.dispatchService.dispatchByConfiguration(
        'task.field.implement.measures',
        userId || 'system',
        {
          entityType: 'Task',
          entityId: task.id,
          action: 'field_changed',
          data: {
            taskId: task.id,
            taskName: task.name,
            taskSectorId: task.sectorId || null,
            fieldName: 'implement.measures',
            implementId,
            changedBy: changedByName,
            implementMeasureChangeSummary,
          },
          overrides: {
            title: 'Medidas do Implemento atualizado',
            body: `Medidas do implemento da tarefa "${task.name}" atualizado: ${implementMeasureChangeSummary}`,
            webUrl: `/producao/cronograma/detalhes/${task.id}`,
          },
        },
      );

      this.logger.log(
        `[dispatchConsolidatedImplementMeasureNotification] Dispatched task.field.implement.measures: ${implementMeasureChangeSummary}`,
      );
    } catch (err) {
      this.logger.error(
        `[dispatchConsolidatedImplementMeasureNotification] Failed to dispatch notification:`,
        err,
      );
    }
  }
}
