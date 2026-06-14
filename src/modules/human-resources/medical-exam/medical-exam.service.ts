// medical-exam.service.ts
// ASO / Exames ocupacionais (Medicina do Trabalho).
// Máquina de status: SCHEDULED → COMPLETED | CANCELLED; COMPLETED → EXPIRED (derivado/settable).

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  MEDICAL_EXAM_STATUS,
  MEDICAL_EXAM_STATUS_ORDER,
  MEDICAL_EXAM_TYPE,
  MEDICAL_EXAM_RESULT,
  TERMINATION_DOCUMENT_STATUS,
  TERMINATION_DOCUMENT_TYPE,
  TERMINATION_STATUS,
} from '../../../constants';
import type {
  MedicalExam,
  MedicalExamGetManyResponse,
  MedicalExamGetUniqueResponse,
  MedicalExamCreateResponse,
  MedicalExamUpdateResponse,
  MedicalExamDeleteResponse,
  MedicalExamBatchCreateResponse,
  MedicalExamBatchUpdateResponse,
  MedicalExamBatchDeleteResponse,
} from '../../../types';
import type {
  MedicalExamGetManyFormData,
  MedicalExamCreateFormData,
  MedicalExamUpdateFormData,
  MedicalExamCompleteFormData,
  MedicalExamBatchCreateFormData,
  MedicalExamBatchUpdateFormData,
  MedicalExamBatchDeleteFormData,
  MedicalExamInclude,
} from '../../../schemas';

const MEDICAL_EXAM_TRACKED_FIELDS = [
  'userId',
  'type',
  'status',
  'result',
  'restrictions',
  'periodicityMonths',
  'scheduledAt',
  'examDate',
  'expiresAt',
  'physicianName',
  'crm',
  'clinic',
  'notes',
  'fileId',
];

// Default occupational-exam periodicity (months) when neither the exam nor the
// position specifies one. NR-7 baseline for periodic exams is 12 months.
const DEFAULT_PERIODIC_MONTHS = 12;

/**
 * An exam result is "apto" (apt) for admission/return gating unless it is UNFIT.
 * FIT_WITH_RESTRICTIONS counts as conditionally apt (apto com restrições).
 */
export function isExamResultApt(result: string | null | undefined): boolean {
  return result !== MEDICAL_EXAM_RESULT.UNFIT;
}

// SCHEDULED → COMPLETED | CANCELLED; COMPLETED → EXPIRED (derived once the
// validity lapses — settable via update); EXPIRED/CANCELLED are terminal.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  [MEDICAL_EXAM_STATUS.SCHEDULED]: [MEDICAL_EXAM_STATUS.COMPLETED, MEDICAL_EXAM_STATUS.CANCELLED],
  [MEDICAL_EXAM_STATUS.COMPLETED]: [MEDICAL_EXAM_STATUS.EXPIRED],
  [MEDICAL_EXAM_STATUS.EXPIRED]: [],
  [MEDICAL_EXAM_STATUS.CANCELLED]: [],
};

@Injectable()
export class MedicalExamService {
  private readonly logger = new Logger(MedicalExamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  private getStatusOrder(status: string): number {
    return MEDICAL_EXAM_STATUS_ORDER[status] ?? 1;
  }

  private validateStatusTransition(fromStatus: string, toStatus: string): void {
    if (fromStatus === toStatus) return;
    const allowed = STATUS_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(`Transição de status inválida: ${fromStatus} → ${toStatus}.`);
    }
  }

  private async medicalExamValidation(
    data: Partial<MedicalExamCreateFormData | MedicalExamUpdateFormData>,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.userId) {
      const user = await transaction.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        throw new NotFoundException('Colaborador não encontrado.');
      }
    }

    // "Apto com restrições" exige a descrição das restrições laborais.
    if (
      data.result === MEDICAL_EXAM_RESULT.FIT_WITH_RESTRICTIONS &&
      data.restrictions !== undefined &&
      (data.restrictions === null || data.restrictions.trim() === '')
    ) {
      throw new BadRequestException(
        'Informe as restrições laborais quando o resultado for "Apto com restrições".',
      );
    }
  }

  /**
   * Resolve the periodicity (months) for the NEXT periodic exam of a user:
   * explicit exam value → user's current Position.examPeriodicityMonths → legal default.
   */
  private async resolvePeriodicityMonths(
    tx: PrismaTransaction,
    userId: string,
    examPeriodicityMonths: number | null | undefined,
  ): Promise<number> {
    if (examPeriodicityMonths && examPeriodicityMonths > 0) {
      return examPeriodicityMonths;
    }
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { position: { select: { examPeriodicityMonths: true } } },
    });
    const positionMonths = user?.position?.examPeriodicityMonths;
    if (positionMonths && positionMonths > 0) {
      return positionMonths;
    }
    return DEFAULT_PERIODIC_MONTHS;
  }

  /**
   * Completing a PERIODIC exam schedules the next one automatically using the
   * resolved periodicity (exam → Position → legal default). The new exam is
   * SCHEDULED for examDate + periodicityMonths. Idempotent: skips if a
   * non-cancelled future PERIODIC exam already exists for the user.
   */
  private async scheduleNextPeriodicExam(
    tx: PrismaTransaction,
    completed: { id: string; userId: string; examDate: Date | null; periodicityMonths: number | null },
    actorUserId?: string,
  ): Promise<boolean> {
    const base = completed.examDate ?? new Date();
    const months = await this.resolvePeriodicityMonths(
      tx,
      completed.userId,
      completed.periodicityMonths,
    );

    const nextScheduledAt = new Date(base);
    nextScheduledAt.setMonth(nextScheduledAt.getMonth() + months);

    // Dedup: do not schedule if a non-cancelled PERIODIC exam is already pending
    // in the future (avoids stacking on repeated completions/edits).
    const existing = await tx.medicalExam.findFirst({
      where: {
        userId: completed.userId,
        type: MEDICAL_EXAM_TYPE.PERIODIC as any,
        status: MEDICAL_EXAM_STATUS.SCHEDULED as any,
        scheduledAt: { gt: base },
        id: { not: completed.id },
      },
      select: { id: true },
    });
    if (existing) return false;

    const created = await tx.medicalExam.create({
      data: {
        userId: completed.userId,
        type: MEDICAL_EXAM_TYPE.PERIODIC as any,
        status: MEDICAL_EXAM_STATUS.SCHEDULED as any,
        statusOrder: this.getStatusOrder(MEDICAL_EXAM_STATUS.SCHEDULED),
        result: MEDICAL_EXAM_RESULT.PENDING as any,
        scheduledAt: nextScheduledAt,
        periodicityMonths: months,
      },
    });

    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.MEDICAL_EXAM,
      entityId: created.id,
      action: CHANGE_ACTION.CREATE,
      entity: created,
      reason: `Próximo exame periódico agendado automaticamente (${months} meses)`,
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
      userId: actorUserId || null,
      transaction: tx,
    });

    return true;
  }

  async findMany(query: MedicalExamGetManyFormData): Promise<MedicalExamGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || { createdAt: 'desc' };

      const [totalRecords, exams] = await Promise.all([
        this.prisma.medicalExam.count({ where }),
        this.prisma.medicalExam.findMany({
          where,
          orderBy,
          include: query.include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.max(Math.ceil(totalRecords / take), 1);

      return {
        success: true,
        message: 'Exames carregados com sucesso.',
        data: exams as unknown as MedicalExam[],
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar exames:', error);
      throw new InternalServerErrorException('Erro ao buscar exames. Por favor, tente novamente.');
    }
  }

  /**
   * Exames COMPLETED com validade vencendo nos próximos N dias — incluindo já
   * vencidos (overdue). Alimenta a página Exames Periódicos.
   */
  async findExpiring(days: number): Promise<MedicalExamGetManyResponse> {
    try {
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() + days);

      const exams = await this.prisma.medicalExam.findMany({
        where: {
          status: MEDICAL_EXAM_STATUS.COMPLETED as any,
          expiresAt: { not: null, lte: limitDate },
        },
        include: {
          user: { include: { position: true } },
        },
        orderBy: { expiresAt: 'asc' },
      });

      return {
        success: true,
        message: 'Exames a vencer carregados com sucesso.',
        data: exams as unknown as MedicalExam[],
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar exames a vencer:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar exames a vencer. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Flip COMPLETED exams whose validity has lapsed (expiresAt < now) to EXPIRED.
   * Idempotent — safe to run repeatedly (the cron calls it daily). Returns the
   * number of exams transitioned.
   */
  async autoExpireOverdue(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.medicalExam.findMany({
      where: {
        status: MEDICAL_EXAM_STATUS.COMPLETED as any,
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, status: true },
    });

    let transitioned = 0;
    for (const exam of overdue) {
      try {
        await this.prisma.$transaction(async (tx: PrismaTransaction) => {
          await tx.medicalExam.update({
            where: { id: exam.id },
            data: {
              status: MEDICAL_EXAM_STATUS.EXPIRED as any,
              statusOrder: this.getStatusOrder(MEDICAL_EXAM_STATUS.EXPIRED),
            },
          });
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.MEDICAL_EXAM,
            entityId: exam.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'status',
            oldValue: exam.status,
            newValue: MEDICAL_EXAM_STATUS.EXPIRED,
            reason: 'Exame vencido — validade expirada (transição automática)',
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: exam.id,
            userId: null,
            transaction: tx,
          });
        });
        transitioned++;
      } catch (error: any) {
        this.logger.error(`Erro ao expirar exame ${exam.id}:`, error);
      }
    }
    return transitioned;
  }

  async findById(id: string, include?: MedicalExamInclude): Promise<MedicalExamGetUniqueResponse> {
    try {
      const exam = await this.prisma.medicalExam.findUnique({ where: { id }, include });

      if (!exam) {
        throw new NotFoundException('Exame não encontrado.');
      }

      return {
        success: true,
        message: 'Exame carregado com sucesso.',
        data: exam as unknown as MedicalExam,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar exame por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar exame. Por favor, tente novamente.');
    }
  }

  async create(
    data: MedicalExamCreateFormData,
    include?: MedicalExamInclude,
    userId?: string,
  ): Promise<MedicalExamCreateResponse> {
    try {
      const exam = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.medicalExamValidation(data, tx);

        const status = data.status || MEDICAL_EXAM_STATUS.SCHEDULED;
        const newExam = await tx.medicalExam.create({
          data: {
            ...(data as any),
            status,
            statusOrder: this.getStatusOrder(status),
          },
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MEDICAL_EXAM,
          entityId: newExam.id,
          action: CHANGE_ACTION.CREATE,
          entity: newExam,
          reason: 'Exame ocupacional criado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newExam;
      });

      return {
        success: true,
        message: 'Exame criado com sucesso.',
        data: exam as unknown as MedicalExam,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar exame:', error);
      throw new InternalServerErrorException('Erro ao criar exame. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: MedicalExamUpdateFormData,
    include?: MedicalExamInclude,
    userId?: string,
  ): Promise<MedicalExamUpdateResponse> {
    try {
      const exam = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.medicalExam.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Exame não encontrado.');
        }

        if (data.status && data.status !== existing.status) {
          this.validateStatusTransition(existing.status, data.status);
        }

        await this.medicalExamValidation(data, tx);

        const updateData: any = { ...data };
        if (data.status) {
          updateData.statusOrder = this.getStatusOrder(data.status);
        }

        // Restrições só se aplicam a "apto com restrições". Se o resultado for
        // alterado para outro valor, limpa o campo para não deixar texto órfão.
        const mergedResult = data.result ?? existing.result;
        if (mergedResult !== MEDICAL_EXAM_RESULT.FIT_WITH_RESTRICTIONS) {
          updateData.restrictions = null;
        } else if (data.restrictions === undefined && !existing.restrictions) {
          throw new BadRequestException(
            'Informe as restrições laborais quando o resultado for "Apto com restrições".',
          );
        }

        const updated = await tx.medicalExam.update({ where: { id }, data: updateData, include });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MEDICAL_EXAM,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: MEDICAL_EXAM_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Exame atualizado com sucesso.',
        data: exam as unknown as MedicalExam,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar exame:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar exame. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Exame demissional com arquivo ASO ⇒ marca o documento DISMISSAL_EXAM da
   * rescisão em aberto do colaborador como GENERATED, vinculando o arquivo.
   */
  private async syncTerminationDismissalExamDocument(
    tx: PrismaTransaction,
    examId: string,
    examUserId: string,
    fileId: string,
    userId?: string,
  ): Promise<void> {
    const terminationDocument = await tx.terminationDocument.findFirst({
      where: {
        type: TERMINATION_DOCUMENT_TYPE.DISMISSAL_EXAM as any,
        status: TERMINATION_DOCUMENT_STATUS.PENDING as any,
        termination: {
          userId: examUserId,
          status: {
            notIn: [TERMINATION_STATUS.COMPLETED, TERMINATION_STATUS.CANCELLED] as any[],
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!terminationDocument) return;

    await tx.terminationDocument.update({
      where: { id: terminationDocument.id },
      data: {
        status: TERMINATION_DOCUMENT_STATUS.GENERATED as any,
        fileId,
      },
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TERMINATION,
      entityId: terminationDocument.terminationId,
      action: CHANGE_ACTION.UPDATE,
      field: `document_${TERMINATION_DOCUMENT_TYPE.DISMISSAL_EXAM}`,
      oldValue: {
        status: terminationDocument.status,
        fileId: terminationDocument.fileId,
      },
      newValue: {
        status: TERMINATION_DOCUMENT_STATUS.GENERATED,
        fileId,
      },
      reason:
        'Documento ASO demissional marcado como gerado automaticamente pela conclusão do exame demissional',
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
      triggeredById: examId,
      userId: userId || null,
      transaction: tx,
    });
  }

  /**
   * Conclusão do exame (SCHEDULED → COMPLETED) com data, resultado e validade.
   */
  async complete(
    id: string,
    data: MedicalExamCompleteFormData,
    include?: MedicalExamInclude,
    userId?: string,
  ): Promise<MedicalExamUpdateResponse> {
    try {
      const exam = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.medicalExam.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Exame não encontrado.');
        }

        if (existing.status !== MEDICAL_EXAM_STATUS.SCHEDULED) {
          throw new BadRequestException('Apenas exames agendados podem ser concluídos.');
        }

        // "Apto com restrições" exige a descrição das restrições laborais.
        if (data.result === MEDICAL_EXAM_RESULT.FIT_WITH_RESTRICTIONS) {
          const restrictions = data.restrictions ?? existing.restrictions;
          if (!restrictions || restrictions.trim() === '') {
            throw new BadRequestException(
              'Informe as restrições laborais quando o resultado for "Apto com restrições".',
            );
          }
        }

        const updated = await tx.medicalExam.update({
          where: { id },
          data: {
            status: MEDICAL_EXAM_STATUS.COMPLETED as any,
            statusOrder: this.getStatusOrder(MEDICAL_EXAM_STATUS.COMPLETED),
            examDate: data.examDate,
            result: data.result as any,
            // Restrições só fazem sentido em "apto com restrições"; limpa caso contrário.
            ...(data.result === MEDICAL_EXAM_RESULT.FIT_WITH_RESTRICTIONS
              ? data.restrictions !== undefined
                ? { restrictions: data.restrictions }
                : {}
              : { restrictions: null }),
            ...(data.periodicityMonths !== undefined
              ? { periodicityMonths: data.periodicityMonths }
              : {}),
            ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
            ...(data.physicianName !== undefined ? { physicianName: data.physicianName } : {}),
            ...(data.crm !== undefined ? { crm: data.crm } : {}),
            ...(data.clinic !== undefined ? { clinic: data.clinic } : {}),
            ...(data.fileId !== undefined ? { fileId: data.fileId } : {}),
          },
          include,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.MEDICAL_EXAM,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: existing.status,
          newValue: MEDICAL_EXAM_STATUS.COMPLETED,
          reason: 'Exame concluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        // DISMISSAL exam completed with an ASO file: mark the open
        // termination's DISMISSAL_EXAM document as GENERATED, linking the file
        // (auto-wiring between Medicina do Trabalho and the rescisão flow).
        if (updated.type === MEDICAL_EXAM_TYPE.DISMISSAL && updated.fileId) {
          await this.syncTerminationDismissalExamDocument(
            tx,
            id,
            existing.userId,
            updated.fileId,
            userId,
          );
        }

        // Periodic auto-followup: completing a PERIODIC exam schedules the next one.
        let nextScheduled = false;
        if (updated.type === MEDICAL_EXAM_TYPE.PERIODIC) {
          nextScheduled = await this.scheduleNextPeriodicExam(
            tx,
            {
              id: updated.id,
              userId: existing.userId,
              examDate: updated.examDate,
              periodicityMonths: updated.periodicityMonths,
            },
            userId,
          );
        }

        return { updated, nextScheduled };
      });

      return {
        success: true,
        message: `Exame concluído com sucesso.${exam.nextScheduled ? ' Próximo exame periódico agendado automaticamente.' : ''}`,
        data: exam.updated as unknown as MedicalExam,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao concluir exame:', error);
      throw new InternalServerErrorException('Erro ao concluir exame. Por favor, tente novamente.');
    }
  }

  /**
   * Upload do documento ASO — define fileId.
   */
  async uploadDocument(
    id: string,
    file: Express.Multer.File,
    include?: MedicalExamInclude,
    userId?: string,
  ): Promise<MedicalExamUpdateResponse> {
    try {
      const exam = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.medicalExam.findUnique({
          where: { id },
          include: { user: { select: { name: true } } },
        });

        if (!existing) {
          throw new NotFoundException('Exame não encontrado.');
        }

        const newFile = await this.fileService.createFromUploadWithTransaction(
          tx,
          file,
          'documents',
          userId,
          {
            entityId: id,
            entityType: 'MEDICAL_EXAM',
            userName: existing.user?.name || undefined,
          },
        );

        const updated = await tx.medicalExam.update({
          where: { id },
          data: { fileId: newFile.id },
          include,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.MEDICAL_EXAM,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'fileId',
          oldValue: existing.fileId,
          newValue: newFile.id,
          reason: 'Documento ASO anexado ao exame',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        // ASO file attached to an already-completed DISMISSAL exam: wire the
        // termination's DISMISSAL_EXAM document the same way complete() does.
        if (
          updated.type === MEDICAL_EXAM_TYPE.DISMISSAL &&
          updated.status === MEDICAL_EXAM_STATUS.COMPLETED
        ) {
          await this.syncTerminationDismissalExamDocument(
            tx,
            id,
            existing.userId,
            newFile.id,
            userId,
          );
        }

        return updated;
      });

      return {
        success: true,
        message: 'Documento anexado com sucesso.',
        data: exam as unknown as MedicalExam,
      };
    } catch (error: any) {
      // Clean up temp upload on error
      if (file && existsSync(file.path)) {
        try {
          unlinkSync(file.path);
        } catch {
          this.logger.warn(`Falha ao limpar arquivo temporário: ${file.path}`);
        }
      }

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao anexar documento ao exame:', error);
      throw new InternalServerErrorException(
        'Erro ao anexar documento. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<MedicalExamDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const exam = await tx.medicalExam.findUnique({ where: { id } });

        if (!exam) {
          throw new NotFoundException('Exame não encontrado.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.MEDICAL_EXAM,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: exam,
          reason: 'Exame excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.medicalExam.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Exame excluído com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir exame:', error);
      throw new InternalServerErrorException('Erro ao excluir exame. Por favor, tente novamente.');
    }
  }

  async batchCreate(
    data: MedicalExamBatchCreateFormData,
    include?: MedicalExamInclude,
    userId?: string,
  ): Promise<MedicalExamBatchCreateResponse<MedicalExamCreateFormData>> {
    try {
      const success: MedicalExam[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: MedicalExamCreateFormData;
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, itemData] of data.medicalExams.entries()) {
          try {
            await this.medicalExamValidation(itemData, tx);

            const status = itemData.status || MEDICAL_EXAM_STATUS.SCHEDULED;
            const created = await tx.medicalExam.create({
              data: {
                ...(itemData as any),
                status,
                statusOrder: this.getStatusOrder(status),
              },
              include,
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MEDICAL_EXAM,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: 'Exame criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            success.push(created as unknown as MedicalExam);
          } catch (error: any) {
            failed.push({
              index,
              error: error?.message || 'Erro ao criar exame.',
              data: itemData,
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 exame criado com sucesso'
          : `${success.length} exames criados com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na criação de exames em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar exames em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: MedicalExamBatchUpdateFormData,
    include?: MedicalExamInclude,
    userId?: string,
  ): Promise<MedicalExamBatchUpdateResponse<MedicalExamUpdateFormData>> {
    try {
      const success: MedicalExam[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: MedicalExamUpdateFormData & { id: string };
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, update] of data.medicalExams.entries()) {
          try {
            const existing = await tx.medicalExam.findUnique({ where: { id: update.id } });
            if (!existing) {
              throw new NotFoundException('Exame não encontrado.');
            }

            if (update.data.status && update.data.status !== existing.status) {
              this.validateStatusTransition(existing.status, update.data.status);
            }

            await this.medicalExamValidation(update.data, tx);

            const updateData: any = { ...update.data };
            if (update.data.status) {
              updateData.statusOrder = this.getStatusOrder(update.data.status);
            }

            const updated = await tx.medicalExam.update({
              where: { id: update.id },
              data: updateData,
              include,
            });

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MEDICAL_EXAM,
              entityId: update.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: MEDICAL_EXAM_TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            success.push(updated as unknown as MedicalExam);
          } catch (error: any) {
            failed.push({
              index,
              id: update.id,
              error: error?.message || 'Erro ao atualizar exame.',
              data: { ...update.data, id: update.id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 exame atualizado com sucesso'
          : `${success.length} exames atualizados com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na atualização de exames em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar exames em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: MedicalExamBatchDeleteFormData,
    userId?: string,
  ): Promise<MedicalExamBatchDeleteResponse> {
    try {
      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.medicalExamIds.entries()) {
          try {
            const exam = await tx.medicalExam.findUnique({ where: { id } });

            if (!exam) {
              throw new NotFoundException('Exame não encontrado.');
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MEDICAL_EXAM,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: exam,
              reason: 'Exame excluído em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });

            await tx.medicalExam.delete({ where: { id } });
            success.push({ id, deleted: true });
          } catch (error: any) {
            failed.push({
              index,
              id,
              error: error?.message || 'Erro ao excluir exame.',
              data: { id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 exame excluído com sucesso'
          : `${success.length} exames excluídos com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na exclusão de exames em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir exames em lote. Por favor, tente novamente.',
      );
    }
  }
}
