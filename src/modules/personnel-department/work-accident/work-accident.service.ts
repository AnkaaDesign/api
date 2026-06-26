// work-accident.service.ts
// CAT — Comunicação de Acidente de Trabalho (Medicina do Trabalho, Part E).
//
// CRUD da CAT + vínculo opcional ao afastamento WORK_ACCIDENT. Quando a CAT é
// confirmada (confirmStability) e existe um afastamento de acidente de trabalho
// associado já encerrado, aplica a estabilidade acidentária (12 meses a partir do
// retorno — art. 118 Lei 8.213/91) ao vínculo atual do colaborador. O guard de
// rescisão (Part G) lê isUnderStability(contract) para bloquear o desligamento.

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
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
} from '../../../constants';
import { computeAccidentStabilityWindow } from '../../../utils';
import type {
  WorkAccidentReport,
  WorkAccidentReportGetManyResponse,
  WorkAccidentReportGetUniqueResponse,
  WorkAccidentReportCreateResponse,
  WorkAccidentReportUpdateResponse,
  WorkAccidentReportDeleteResponse,
  WorkAccidentReportBatchCreateResponse,
  WorkAccidentReportBatchUpdateResponse,
  WorkAccidentReportBatchDeleteResponse,
} from '../../../types';
import type {
  WorkAccidentReportGetManyFormData,
  WorkAccidentReportCreateFormData,
  WorkAccidentReportUpdateFormData,
  WorkAccidentReportBatchCreateFormData,
  WorkAccidentReportBatchUpdateFormData,
  WorkAccidentReportBatchDeleteFormData,
  WorkAccidentReportInclude,
} from '../../../schemas';

const WORK_ACCIDENT_TRACKED_FIELDS = [
  'leaveId',
  'type',
  'catNumber',
  'emissionDate',
  'accidentDate',
  'description',
  'fileId',
];

@Injectable()
export class WorkAccidentService {
  private readonly logger = new Logger(WorkAccidentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  private async validate(
    data: Partial<WorkAccidentReportCreateFormData | WorkAccidentReportUpdateFormData>,
    tx: PrismaTransaction,
    userIdForLeaveCheck?: string,
  ): Promise<void> {
    if ('userId' in data && data.userId) {
      const user = await tx.user.findUnique({ where: { id: data.userId } });
      if (!user) throw new NotFoundException('Colaborador não encontrado.');
    }

    if (data.leaveId) {
      const leave = await tx.leave.findUnique({ where: { id: data.leaveId } });
      if (!leave) throw new NotFoundException('Afastamento vinculado não encontrado.');
      // A CAT só faz sentido vinculada a um afastamento de acidente de trabalho.
      if (leave.type !== LEAVE_TYPE.WORK_ACCIDENT) {
        throw new BadRequestException(
          'A CAT só pode ser vinculada a um afastamento do tipo Acidente de Trabalho.',
        );
      }
      const ownerId = userIdForLeaveCheck ?? (data as any).userId;
      if (ownerId && leave.userId !== ownerId) {
        throw new BadRequestException(
          'O afastamento vinculado pertence a outro colaborador.',
        );
      }
    }
  }

  /**
   * Aplica a estabilidade acidentária ao vínculo atual do colaborador.
   * Data de início = retorno do afastamento (actualEndDate) quando disponível,
   * senão a data do acidente, senão hoje. Extend-only (não encurta janela vigente).
   */
  private async applyStability(
    tx: PrismaTransaction,
    catUserId: string,
    leaveId: string | null | undefined,
    accidentDate: Date | null | undefined,
    actorUserId?: string,
  ): Promise<boolean> {
    let returnDate: Date | null = null;
    if (leaveId) {
      const leave = await tx.leave.findUnique({
        where: { id: leaveId },
        select: { actualEndDate: true, status: true },
      });
      if (leave?.actualEndDate && leave.status === LEAVE_STATUS.COMPLETED) {
        returnDate = leave.actualEndDate;
      }
    }
    // Sem retorno registrado ainda, ancora na data do acidente (ou hoje).
    const anchor = returnDate ?? accidentDate ?? new Date();

    const user = await tx.user.findUnique({
      where: { id: catUserId },
      select: { currentContractId: true },
    });
    if (!user?.currentContractId) return false;

    const contract = await tx.employmentContract.findUnique({
      where: { id: user.currentContractId },
      select: { id: true, stabilityType: true, stabilityStart: true, stabilityEnd: true },
    });
    if (!contract) return false;

    const window = computeAccidentStabilityWindow(anchor);
    const newEnd =
      contract.stabilityEnd && contract.stabilityEnd > window.stabilityEnd
        ? contract.stabilityEnd
        : window.stabilityEnd;
    const newStart =
      contract.stabilityStart && contract.stabilityStart < window.stabilityStart
        ? contract.stabilityStart
        : window.stabilityStart;

    await tx.employmentContract.update({
      where: { id: contract.id },
      data: {
        stabilityType: window.stabilityType as any,
        stabilityStart: newStart,
        stabilityEnd: newEnd,
      },
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: catUserId,
      action: CHANGE_ACTION.UPDATE,
      field: 'stability',
      oldValue: {
        stabilityType: contract.stabilityType,
        stabilityStart: contract.stabilityStart,
        stabilityEnd: contract.stabilityEnd,
      },
      newValue: {
        stabilityType: window.stabilityType,
        stabilityStart: newStart,
        stabilityEnd: newEnd,
      },
      reason:
        'Estabilidade acidentária registrada/confirmada via CAT (12 meses — art. 118 Lei 8.213/91)',
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
      triggeredById: null,
      userId: actorUserId || null,
      transaction: tx,
    });

    return true;
  }

  async findMany(
    query: WorkAccidentReportGetManyFormData,
  ): Promise<WorkAccidentReportGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || { createdAt: 'desc' };

      const [totalRecords, reports] = await Promise.all([
        this.prisma.workAccidentReport.count({ where }),
        this.prisma.workAccidentReport.findMany({
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
        message: 'CATs carregadas com sucesso.',
        data: reports as unknown as WorkAccidentReport[],
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
      this.logger.error('Erro ao buscar CATs:', error);
      throw new InternalServerErrorException('Erro ao buscar CATs. Por favor, tente novamente.');
    }
  }

  async findById(
    id: string,
    include?: WorkAccidentReportInclude,
  ): Promise<WorkAccidentReportGetUniqueResponse> {
    try {
      const report = await this.prisma.workAccidentReport.findUnique({ where: { id }, include });
      if (!report) {
        throw new NotFoundException('CAT não encontrada.');
      }
      return {
        success: true,
        message: 'CAT carregada com sucesso.',
        data: report as unknown as WorkAccidentReport,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar CAT por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar CAT. Por favor, tente novamente.');
    }
  }

  async create(
    data: WorkAccidentReportCreateFormData,
    include?: WorkAccidentReportInclude,
    userId?: string,
  ): Promise<WorkAccidentReportCreateResponse> {
    try {
      const report = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.validate(data, tx);

        const { confirmStability, ...createData } = data;

        const created = await tx.workAccidentReport.create({
          data: { ...(createData as any) },
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER,
          entityId: created.userId,
          action: CHANGE_ACTION.CREATE,
          entity: created,
          reason: 'CAT (Comunicação de Acidente de Trabalho) registrada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        if (confirmStability) {
          await this.applyStability(
            tx,
            created.userId,
            created.leaveId,
            created.accidentDate,
            userId,
          );
        }

        return created;
      });

      return {
        success: true,
        message: 'CAT registrada com sucesso.',
        data: report as unknown as WorkAccidentReport,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao registrar CAT:', error);
      throw new InternalServerErrorException('Erro ao registrar CAT. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: WorkAccidentReportUpdateFormData,
    include?: WorkAccidentReportInclude,
    userId?: string,
  ): Promise<WorkAccidentReportUpdateResponse> {
    try {
      const report = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.workAccidentReport.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException('CAT não encontrada.');
        }

        await this.validate(data, tx, existing.userId);

        const { confirmStability, ...rest } = data;

        const updated = await tx.workAccidentReport.update({
          where: { id },
          data: { ...(rest as any) },
          include,
        });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER,
          entityId: existing.userId,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: WORK_ACCIDENT_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        if (confirmStability) {
          await this.applyStability(
            tx,
            updated.userId,
            updated.leaveId,
            updated.accidentDate,
            userId,
          );
        }

        return updated;
      });

      return {
        success: true,
        message: 'CAT atualizada com sucesso.',
        data: report as unknown as WorkAccidentReport,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar CAT:', error);
      throw new InternalServerErrorException('Erro ao atualizar CAT. Por favor, tente novamente.');
    }
  }

  async delete(id: string, userId?: string): Promise<WorkAccidentReportDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const report = await tx.workAccidentReport.findUnique({ where: { id } });
        if (!report) {
          throw new NotFoundException('CAT não encontrada.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER,
          entityId: report.userId,
          action: CHANGE_ACTION.DELETE,
          oldEntity: report,
          reason: 'CAT excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.workAccidentReport.delete({ where: { id } });
      });

      return { success: true, message: 'CAT excluída com sucesso.' };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir CAT:', error);
      throw new InternalServerErrorException('Erro ao excluir CAT. Por favor, tente novamente.');
    }
  }

  async batchCreate(
    data: WorkAccidentReportBatchCreateFormData,
    include?: WorkAccidentReportInclude,
    userId?: string,
  ): Promise<WorkAccidentReportBatchCreateResponse<WorkAccidentReportCreateFormData>> {
    const success: WorkAccidentReport[] = [];
    const failed: Array<{
      index: number;
      id?: string;
      error: string;
      data: WorkAccidentReportCreateFormData;
    }> = [];

    for (const [index, itemData] of data.workAccidentReports.entries()) {
      try {
        const res = await this.create(itemData, include, userId);
        success.push(res.data as WorkAccidentReport);
      } catch (error: any) {
        failed.push({ index, error: error?.message || 'Erro ao registrar CAT.', data: itemData });
      }
    }

    return {
      success: true,
      message: `${success.length} CAT(s) registrada(s) com sucesso${failed.length ? `, ${failed.length} falharam` : ''}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }

  async batchUpdate(
    data: WorkAccidentReportBatchUpdateFormData,
    include?: WorkAccidentReportInclude,
    userId?: string,
  ): Promise<WorkAccidentReportBatchUpdateResponse<WorkAccidentReportUpdateFormData>> {
    const success: WorkAccidentReport[] = [];
    const failed: Array<{
      index: number;
      id?: string;
      error: string;
      data: WorkAccidentReportUpdateFormData & { id: string };
    }> = [];

    for (const [index, update] of data.workAccidentReports.entries()) {
      try {
        const res = await this.update(update.id, update.data, include, userId);
        success.push(res.data as WorkAccidentReport);
      } catch (error: any) {
        failed.push({
          index,
          id: update.id,
          error: error?.message || 'Erro ao atualizar CAT.',
          data: { ...update.data, id: update.id },
        });
      }
    }

    return {
      success: true,
      message: `${success.length} CAT(s) atualizada(s) com sucesso${failed.length ? `, ${failed.length} falharam` : ''}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }

  async batchDelete(
    data: WorkAccidentReportBatchDeleteFormData,
    userId?: string,
  ): Promise<WorkAccidentReportBatchDeleteResponse> {
    const success: Array<{ id: string; deleted: boolean }> = [];
    const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

    for (const [index, id] of data.workAccidentReportIds.entries()) {
      try {
        await this.delete(id, userId);
        success.push({ id, deleted: true });
      } catch (error: any) {
        failed.push({ index, id, error: error?.message || 'Erro ao excluir CAT.', data: { id } });
      }
    }

    return {
      success: true,
      message: `${success.length} CAT(s) excluída(s) com sucesso${failed.length ? `, ${failed.length} falharam` : ''}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }
}
