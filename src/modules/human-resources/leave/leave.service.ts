// leave.service.ts
// Afastamentos (Medicina do Trabalho).
// Máquina de status: SCHEDULED → ACTIVE → COMPLETED; qualquer → CANCELLED.
// Regra: ILLNESS_INSS/WORK_ACCIDENT com duração ≥ 30 dias ⇒ returnExamRequired = true.

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
  LEAVE_TYPE,
  LEAVE_STATUS,
  LEAVE_STATUS_ORDER,
  MEDICAL_EXAM_STATUS,
  MEDICAL_EXAM_STATUS_ORDER,
  MEDICAL_EXAM_TYPE,
} from '../../../constants';
import type {
  Leave,
  LeaveGetManyResponse,
  LeaveGetUniqueResponse,
  LeaveCreateResponse,
  LeaveUpdateResponse,
  LeaveDeleteResponse,
  LeaveBatchCreateResponse,
  LeaveBatchUpdateResponse,
  LeaveBatchDeleteResponse,
} from '../../../types';
import type {
  LeaveGetManyFormData,
  LeaveCreateFormData,
  LeaveUpdateFormData,
  LeaveBatchCreateFormData,
  LeaveBatchUpdateFormData,
  LeaveBatchDeleteFormData,
  LeaveInclude,
} from '../../../schemas';

const LEAVE_TRACKED_FIELDS = [
  'userId',
  'type',
  'status',
  'startDate',
  'expectedEndDate',
  'actualEndDate',
  'cid',
  'inssBenefitNumber',
  'returnExamRequired',
  'notes',
];

// Leave types whose duration ≥ 30 days legally requires a return-to-work exam.
const RETURN_EXAM_TYPES: string[] = [LEAVE_TYPE.ILLNESS_INSS, LEAVE_TYPE.WORK_ACCIDENT];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// SCHEDULED → ACTIVE (start reached — settable manually) → COMPLETED; any → CANCELLED.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  [LEAVE_STATUS.SCHEDULED]: [LEAVE_STATUS.ACTIVE, LEAVE_STATUS.COMPLETED, LEAVE_STATUS.CANCELLED],
  [LEAVE_STATUS.ACTIVE]: [LEAVE_STATUS.COMPLETED, LEAVE_STATUS.CANCELLED],
  [LEAVE_STATUS.COMPLETED]: [LEAVE_STATUS.CANCELLED],
  [LEAVE_STATUS.CANCELLED]: [],
};

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  private getStatusOrder(status: string): number {
    return LEAVE_STATUS_ORDER[status] ?? 1;
  }

  private validateStatusTransition(fromStatus: string, toStatus: string): void {
    if (fromStatus === toStatus) return;
    const allowed = STATUS_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(`Transição de status inválida: ${fromStatus} → ${toStatus}.`);
    }
  }

  /**
   * ILLNESS_INSS/WORK_ACCIDENT com duração (fim efetivo ou previsto − início)
   * ≥ 30 dias exige exame de retorno ao trabalho.
   */
  private computeReturnExamRequired(
    type: string,
    startDate: Date | null | undefined,
    expectedEndDate: Date | null | undefined,
    actualEndDate: Date | null | undefined,
    provided?: boolean,
  ): boolean {
    const endDate = actualEndDate ?? expectedEndDate;
    if (
      RETURN_EXAM_TYPES.includes(type) &&
      startDate &&
      endDate &&
      endDate.getTime() - startDate.getTime() >= THIRTY_DAYS_MS
    ) {
      return true;
    }
    return provided ?? false;
  }

  /**
   * Quando o afastamento exige exame de retorno (returnExamRequired) e não
   * existe exame RETURN_TO_WORK não-cancelado posterior ao início do
   * afastamento, cria um automaticamente (SCHEDULED) na mesma transação.
   * Retorna true quando um exame foi criado.
   */
  private async ensureReturnToWorkExam(
    tx: PrismaTransaction,
    leave: { id: string; userId: string; startDate: Date; actualEndDate?: Date | null },
    userId?: string,
  ): Promise<boolean> {
    const existingExam = await tx.medicalExam.findFirst({
      where: {
        userId: leave.userId,
        type: MEDICAL_EXAM_TYPE.RETURN_TO_WORK as any,
        status: { not: MEDICAL_EXAM_STATUS.CANCELLED as any },
        OR: [
          { createdAt: { gte: leave.startDate } },
          { scheduledAt: { gte: leave.startDate } },
        ],
      },
      select: { id: true },
    });
    if (existingExam) return false;

    const createdExam = await tx.medicalExam.create({
      data: {
        userId: leave.userId,
        type: MEDICAL_EXAM_TYPE.RETURN_TO_WORK as any,
        status: MEDICAL_EXAM_STATUS.SCHEDULED as any,
        statusOrder: MEDICAL_EXAM_STATUS_ORDER[MEDICAL_EXAM_STATUS.SCHEDULED],
        scheduledAt: leave.actualEndDate ?? null,
      },
    });

    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.MEDICAL_EXAM,
      entityId: createdExam.id,
      action: CHANGE_ACTION.CREATE,
      entity: createdExam,
      reason: 'Exame de retorno ao trabalho (ASO) criado automaticamente pelo afastamento',
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
      userId: userId || null,
      transaction: tx,
    });

    return true;
  }

  private async leaveValidation(
    data: Partial<LeaveCreateFormData | LeaveUpdateFormData>,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.userId) {
      const user = await transaction.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        throw new NotFoundException('Colaborador não encontrado.');
      }
    }
  }

  async findMany(query: LeaveGetManyFormData): Promise<LeaveGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || { startDate: 'desc' };

      const [totalRecords, leaves] = await Promise.all([
        this.prisma.leave.count({ where }),
        this.prisma.leave.findMany({
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
        message: 'Afastamentos carregados com sucesso.',
        data: leaves as unknown as Leave[],
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
      this.logger.error('Erro ao buscar afastamentos:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar afastamentos. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: LeaveInclude): Promise<LeaveGetUniqueResponse> {
    try {
      const leave = await this.prisma.leave.findUnique({ where: { id }, include });

      if (!leave) {
        throw new NotFoundException('Afastamento não encontrado.');
      }

      return {
        success: true,
        message: 'Afastamento carregado com sucesso.',
        data: leave as unknown as Leave,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar afastamento por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar afastamento. Por favor, tente novamente.',
      );
    }
  }

  async create(
    data: LeaveCreateFormData,
    include?: LeaveInclude,
    userId?: string,
  ): Promise<LeaveCreateResponse> {
    try {
      const leave = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.leaveValidation(data, tx);

        const status = data.status || LEAVE_STATUS.SCHEDULED;
        const { fileIds, ...createData } = data;

        const returnExamRequired = this.computeReturnExamRequired(
          data.type,
          data.startDate,
          data.expectedEndDate,
          data.actualEndDate,
          data.returnExamRequired,
        );

        const newLeave = await tx.leave.create({
          data: {
            ...(createData as any),
            status,
            statusOrder: this.getStatusOrder(status),
            returnExamRequired,
            ...(fileIds && fileIds.length > 0
              ? { files: { connect: fileIds.map(fileId => ({ id: fileId })) } }
              : {}),
          },
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.LEAVE,
          entityId: newLeave.id,
          action: CHANGE_ACTION.CREATE,
          entity: newLeave,
          reason: 'Afastamento criado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newLeave;
      });

      return {
        success: true,
        message: 'Afastamento criado com sucesso.',
        data: leave as unknown as Leave,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar afastamento:', error);
      throw new InternalServerErrorException(
        'Erro ao criar afastamento. Por favor, tente novamente.',
      );
    }
  }

  async update(
    id: string,
    data: LeaveUpdateFormData,
    include?: LeaveInclude,
    userId?: string,
  ): Promise<LeaveUpdateResponse> {
    try {
      const leave = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.leave.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Afastamento não encontrado.');
        }

        if (data.status && data.status !== existing.status) {
          this.validateStatusTransition(existing.status, data.status);
        }

        await this.leaveValidation(data, tx);

        const { fileIds, ...rest } = data;
        const updateData: any = { ...rest };
        if (data.status) {
          updateData.statusOrder = this.getStatusOrder(data.status);
        }

        // Recompute return-exam rule with merged values
        const mergedType = data.type ?? existing.type;
        const mergedStart = data.startDate ?? existing.startDate;
        const mergedExpectedEnd =
          data.expectedEndDate !== undefined ? data.expectedEndDate : existing.expectedEndDate;
        const mergedActualEnd =
          data.actualEndDate !== undefined ? data.actualEndDate : existing.actualEndDate;
        updateData.returnExamRequired = this.computeReturnExamRequired(
          mergedType,
          mergedStart,
          mergedExpectedEnd,
          mergedActualEnd,
          data.returnExamRequired ?? existing.returnExamRequired,
        );

        if (fileIds) {
          updateData.files = { set: fileIds.map(fileId => ({ id: fileId })) };
        }

        const updated = await tx.leave.update({ where: { id }, data: updateData, include });

        // Atualização que conclui o afastamento (status COMPLETED, possivelmente
        // com actualEndDate definido) com exame de retorno obrigatório ⇒
        // garante a criação automática do ASO RETURN_TO_WORK (espelha finish()).
        const becameCompleted =
          updated.status === LEAVE_STATUS.COMPLETED &&
          (existing.status !== LEAVE_STATUS.COMPLETED ||
            (data.actualEndDate !== undefined && !existing.actualEndDate));
        if (becameCompleted && updated.returnExamRequired) {
          await this.ensureReturnToWorkExam(
            tx,
            {
              id,
              userId: existing.userId,
              startDate: mergedStart,
              actualEndDate: mergedActualEnd,
            },
            userId,
          );
        }

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.LEAVE,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: LEAVE_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Afastamento atualizado com sucesso.',
        data: leave as unknown as Leave,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar afastamento:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar afastamento. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Encerramento do afastamento (→ COMPLETED) com data de retorno efetiva.
   */
  async finish(
    id: string,
    actualEndDate: Date,
    include?: LeaveInclude,
    userId?: string,
  ): Promise<LeaveUpdateResponse> {
    try {
      const leave = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.leave.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Afastamento não encontrado.');
        }

        if (
          existing.status !== LEAVE_STATUS.SCHEDULED &&
          existing.status !== LEAVE_STATUS.ACTIVE
        ) {
          throw new BadRequestException(
            'Apenas afastamentos agendados ou em andamento podem ser finalizados.',
          );
        }

        const returnExamRequired = this.computeReturnExamRequired(
          existing.type,
          existing.startDate,
          existing.expectedEndDate,
          actualEndDate,
          existing.returnExamRequired,
        );

        const updated = await tx.leave.update({
          where: { id },
          data: {
            status: LEAVE_STATUS.COMPLETED as any,
            statusOrder: this.getStatusOrder(LEAVE_STATUS.COMPLETED),
            actualEndDate,
            returnExamRequired,
          },
          include,
        });

        // Exame de retorno obrigatório ⇒ garante a criação automática do ASO
        // RETURN_TO_WORK na mesma transação.
        let examCreated = false;
        if (returnExamRequired) {
          examCreated = await this.ensureReturnToWorkExam(
            tx,
            { id, userId: existing.userId, startDate: existing.startDate, actualEndDate },
            userId,
          );
        }

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.LEAVE,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: existing.status,
          newValue: LEAVE_STATUS.COMPLETED,
          reason: `Afastamento finalizado${examCreated ? ' — exame de retorno ao trabalho (ASO) agendado automaticamente' : ''}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return { updated, examCreated };
      });

      return {
        success: true,
        message: `Afastamento finalizado com sucesso.${leave.examCreated ? ' Exame de retorno ao trabalho agendado automaticamente.' : ''}`,
        data: leave.updated as unknown as Leave,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao finalizar afastamento:', error);
      throw new InternalServerErrorException(
        'Erro ao finalizar afastamento. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Upload de documentos (atestados, comunicações INSS etc.) — m:n "FileToLeave".
   */
  async uploadFiles(
    id: string,
    files: Express.Multer.File[],
    include?: LeaveInclude,
    userId?: string,
  ): Promise<LeaveUpdateResponse> {
    try {
      if (!files || files.length === 0) {
        throw new BadRequestException('Nenhum arquivo enviado.');
      }

      const leave = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.leave.findUnique({
          where: { id },
          include: { user: { select: { name: true } } },
        });

        if (!existing) {
          throw new NotFoundException('Afastamento não encontrado.');
        }

        const newFileIds: string[] = [];
        for (const file of files) {
          const newFile = await this.fileService.createFromUploadWithTransaction(
            tx,
            file,
            'documents',
            userId,
            {
              entityId: id,
              entityType: 'LEAVE',
              userName: existing.user?.name || undefined,
            },
          );
          newFileIds.push(newFile.id);
        }

        const updated = await tx.leave.update({
          where: { id },
          data: {
            files: { connect: newFileIds.map(fileId => ({ id: fileId })) },
          },
          include,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.LEAVE,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'files',
          oldValue: null,
          newValue: newFileIds,
          reason: `${newFileIds.length} arquivo(s) anexado(s) ao afastamento`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Arquivos anexados com sucesso.',
        data: leave as unknown as Leave,
      };
    } catch (error: any) {
      // Clean up temp uploads on error
      if (files && files.length > 0) {
        files.forEach(file => {
          if (existsSync(file.path)) {
            try {
              unlinkSync(file.path);
            } catch {
              this.logger.warn(`Falha ao limpar arquivo temporário: ${file.path}`);
            }
          }
        });
      }

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao anexar arquivos ao afastamento:', error);
      throw new InternalServerErrorException(
        'Erro ao anexar arquivos. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<LeaveDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const leave = await tx.leave.findUnique({ where: { id } });

        if (!leave) {
          throw new NotFoundException('Afastamento não encontrado.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.LEAVE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: leave,
          reason: 'Afastamento excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.leave.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Afastamento excluído com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir afastamento:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir afastamento. Por favor, tente novamente.',
      );
    }
  }

  async batchCreate(
    data: LeaveBatchCreateFormData,
    include?: LeaveInclude,
    userId?: string,
  ): Promise<LeaveBatchCreateResponse<LeaveCreateFormData>> {
    try {
      const success: Leave[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: LeaveCreateFormData;
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, itemData] of data.leaves.entries()) {
          try {
            await this.leaveValidation(itemData, tx);

            const status = itemData.status || LEAVE_STATUS.SCHEDULED;
            const { fileIds, ...createData } = itemData;

            const returnExamRequired = this.computeReturnExamRequired(
              itemData.type,
              itemData.startDate,
              itemData.expectedEndDate,
              itemData.actualEndDate,
              itemData.returnExamRequired,
            );

            const created = await tx.leave.create({
              data: {
                ...(createData as any),
                status,
                statusOrder: this.getStatusOrder(status),
                returnExamRequired,
                ...(fileIds && fileIds.length > 0
                  ? { files: { connect: fileIds.map(fileId => ({ id: fileId })) } }
                  : {}),
              },
              include,
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.LEAVE,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: 'Afastamento criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            success.push(created as unknown as Leave);
          } catch (error: any) {
            failed.push({
              index,
              error: error?.message || 'Erro ao criar afastamento.',
              data: itemData,
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 afastamento criado com sucesso'
          : `${success.length} afastamentos criados com sucesso`;
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
      this.logger.error('Erro na criação de afastamentos em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar afastamentos em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: LeaveBatchUpdateFormData,
    include?: LeaveInclude,
    userId?: string,
  ): Promise<LeaveBatchUpdateResponse<LeaveUpdateFormData>> {
    try {
      const success: Leave[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: LeaveUpdateFormData & { id: string };
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, update] of data.leaves.entries()) {
          try {
            const existing = await tx.leave.findUnique({ where: { id: update.id } });
            if (!existing) {
              throw new NotFoundException('Afastamento não encontrado.');
            }

            if (update.data.status && update.data.status !== existing.status) {
              this.validateStatusTransition(existing.status, update.data.status);
            }

            await this.leaveValidation(update.data, tx);

            const { fileIds, ...rest } = update.data;
            const updateData: any = { ...rest };
            if (update.data.status) {
              updateData.statusOrder = this.getStatusOrder(update.data.status);
            }

            const mergedType = update.data.type ?? existing.type;
            const mergedStart = update.data.startDate ?? existing.startDate;
            const mergedExpectedEnd =
              update.data.expectedEndDate !== undefined
                ? update.data.expectedEndDate
                : existing.expectedEndDate;
            const mergedActualEnd =
              update.data.actualEndDate !== undefined
                ? update.data.actualEndDate
                : existing.actualEndDate;
            updateData.returnExamRequired = this.computeReturnExamRequired(
              mergedType,
              mergedStart,
              mergedExpectedEnd,
              mergedActualEnd,
              update.data.returnExamRequired ?? existing.returnExamRequired,
            );

            if (fileIds) {
              updateData.files = { set: fileIds.map(fileId => ({ id: fileId })) };
            }

            const updated = await tx.leave.update({
              where: { id: update.id },
              data: updateData,
              include,
            });

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.LEAVE,
              entityId: update.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: LEAVE_TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            success.push(updated as unknown as Leave);
          } catch (error: any) {
            failed.push({
              index,
              id: update.id,
              error: error?.message || 'Erro ao atualizar afastamento.',
              data: { ...update.data, id: update.id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 afastamento atualizado com sucesso'
          : `${success.length} afastamentos atualizados com sucesso`;
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
      this.logger.error('Erro na atualização de afastamentos em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar afastamentos em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: LeaveBatchDeleteFormData,
    userId?: string,
  ): Promise<LeaveBatchDeleteResponse> {
    try {
      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.leaveIds.entries()) {
          try {
            const leave = await tx.leave.findUnique({ where: { id } });

            if (!leave) {
              throw new NotFoundException('Afastamento não encontrado.');
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.LEAVE,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: leave,
              reason: 'Afastamento excluído em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });

            await tx.leave.delete({ where: { id } });
            success.push({ id, deleted: true });
          } catch (error: any) {
            failed.push({
              index,
              id,
              error: error?.message || 'Erro ao excluir afastamento.',
              data: { id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 afastamento excluído com sucesso'
          : `${success.length} afastamentos excluídos com sucesso`;
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
      this.logger.error('Erro na exclusão de afastamentos em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir afastamentos em lote. Por favor, tente novamente.',
      );
    }
  }
}
