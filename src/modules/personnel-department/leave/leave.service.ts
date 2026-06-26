// leave.service.ts
// Afastamentos (Medicina do Trabalho).
// Máquina de status: SCHEDULED → ACTIVE → COMPLETED; qualquer → CANCELLED.
// Regra (NR-7): ILLNESS_INSS/WORK_ACCIDENT com duração > 30 dias ⇒ returnExamRequired = true.

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
import { SecullumLeaveSyncService } from '@modules/integrations/secullum/secullum-leave-sync.service';
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
import { computeAccidentStabilityWindow } from '../../../utils';
import { nextBrazilianBusinessDay } from '../../../utils/brazilian-holidays.util';
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
  'inssBenefitSpecies',
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
    // Mirrors the afastamento's date range into Secullum (ponto). Every method on
    // it is self-contained and never throws, so the leave write is never affected
    // by a Secullum outage. See secullum-leave-sync.service.ts.
    private readonly secullumLeaveSync: SecullumLeaveSyncService,
  ) {}

  // Fire-and-forget Secullum ponto sync. Awaited so logs/order are deterministic
  // within the request, but its result NEVER changes the leave outcome.
  private async syncLeaveToSecullum(leaveId: string): Promise<void> {
    try {
      await this.secullumLeaveSync.syncLeave(leaveId);
    } catch (err: any) {
      // syncLeave already swallows its own errors; this is belt-and-braces.
      this.logger.warn(
        `Secullum leave sync raised unexpectedly for ${leaveId}: ${err?.message ?? err}`,
      );
    }
  }

  // Fire-and-forget Secullum ponto un-push (delete). Never affects the leave write.
  private async removeLeaveFromSecullum(
    leaveId: string,
    secullumEmployeeId?: number | null,
  ): Promise<void> {
    try {
      await this.secullumLeaveSync.removeLeave(leaveId, secullumEmployeeId);
    } catch (err: any) {
      this.logger.warn(
        `Secullum leave removal raised unexpectedly for ${leaveId}: ${err?.message ?? err}`,
      );
    }
  }

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
   * Whether the legal rule (NR-7) mandates a return-to-work exam:
   * ILLNESS_INSS/WORK_ACCIDENT with a duration (effective or expected end − start)
   * STRICTLY GREATER THAN 30 days. (Was `>= 30`; the legal threshold is "more than
   * 30 days" — a leave of exactly 30 days does not trigger it.)
   */
  private ruleRequiresReturnExam(
    type: string,
    startDate: Date | null | undefined,
    expectedEndDate: Date | null | undefined,
    actualEndDate: Date | null | undefined,
  ): boolean {
    const endDate = actualEndDate ?? expectedEndDate;
    return (
      RETURN_EXAM_TYPES.includes(type) &&
      !!startDate &&
      !!endDate &&
      endDate.getTime() - startDate.getTime() > THIRTY_DAYS_MS
    );
  }

  /**
   * Resolve the effective returnExamRequired without silently overwriting a manual
   * value. The legal rule is a compliance FLOOR: it can only RAISE the flag to true,
   * never lower a manually-set true to false. So the result is:
   *   ruleRequires OR (the existing/provided manual value).
   */
  private computeReturnExamRequired(
    type: string,
    startDate: Date | null | undefined,
    expectedEndDate: Date | null | undefined,
    actualEndDate: Date | null | undefined,
    provided?: boolean,
  ): boolean {
    const ruleRequires = this.ruleRequiresReturnExam(
      type,
      startDate,
      expectedEndDate,
      actualEndDate,
    );
    return ruleRequires || (provided ?? false);
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
    // First working day AFTER the return. actualEndDate is the leave's last covered
    // day; the employee resumes work the next business day, which is when the ASO de
    // retorno must occur (NR-7). Falls back to startDate when no end is known.
    const dayAfterReturn = new Date(leave.actualEndDate ?? leave.startDate);
    dayAfterReturn.setDate(dayAfterReturn.getDate() + 1);
    const scheduledAt = nextBrazilianBusinessDay(dayAfterReturn);

    // Tightened dedup: only suppress when a non-cancelled RETURN_TO_WORK exam is
    // already SCHEDULED for (or after) this leave's start. Keying on scheduledAt
    // (not createdAt) avoids matching unrelated historical exams; a COMPLETED ASO de
    // retorno for the *same* return is also treated as already-handled.
    const existingExam = await tx.medicalExam.findFirst({
      where: {
        userId: leave.userId,
        type: MEDICAL_EXAM_TYPE.RETURN_TO_WORK as any,
        status: {
          in: [MEDICAL_EXAM_STATUS.SCHEDULED, MEDICAL_EXAM_STATUS.COMPLETED] as any[],
        },
        scheduledAt: { gte: leave.startDate },
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
        scheduledAt,
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

  // NOTE: The afastamento lifecycle no longer mirrors onto the contract status.
  // ContractStatus is binary (ACTIVE | TERMINATED); "afastado" is owned entirely by
  // the Leave feature (the Leave table is the source of truth). The previous
  // syncContractLeaveStatus writer (ACTIVE ↔ ON_LEAVE) was removed.

  /**
   * Set the acidentária estabilidade window (art. 118 Lei 8.213/91 — 12 months from
   * return) on the worker's current vínculo. Used when a WORK_ACCIDENT leave is
   * finished and when a CAT is confirmed (see WorkAccidentService). Idempotent and
   * "extend-only": never shortens an already-set ACCIDENT window.
   */
  async applyAccidentStability(
    tx: PrismaTransaction,
    leaveUserId: string,
    returnDate: Date,
    actorUserId?: string,
  ): Promise<boolean> {
    const user = await tx.user.findUnique({
      where: { id: leaveUserId },
      select: { currentContractId: true },
    });
    if (!user?.currentContractId) return false;

    const contract = await tx.employmentContract.findUnique({
      where: { id: user.currentContractId },
      select: { id: true, stabilityType: true, stabilityStart: true, stabilityEnd: true },
    });
    if (!contract) return false;

    const window = computeAccidentStabilityWindow(returnDate);

    // Extend-only: keep the later end date when a window already exists.
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
      entityId: leaveUserId,
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
        'Estabilidade acidentária (12 meses a partir do retorno — art. 118 Lei 8.213/91) registrada no vínculo',
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
      triggeredById: null,
      userId: actorUserId || null,
      transaction: tx,
    });

    return true;
  }

  /**
   * Compute the leave-derived payroll split for an afastamento (data only — Part B's
   * calculator consumes this; this service does NOT edit payroll files).
   *
   * Brazilian rule for ILLNESS_INSS / WORK_ACCIDENT: the first 15 days of absence are
   * paid by the EMPLOYER; from the 16th day the INSS pays the benefit. Other leave
   * types have no such split (employerPaidDays = total, inssDays = 0) unless they are
   * INSS-bearing.
   *
   * @returns total absence days, employer-paid days (≤15 for INSS-bearing), INSS days
   */
  computeLeavePayrollSplit(leave: {
    type: string;
    startDate: Date;
    expectedEndDate?: Date | null;
    actualEndDate?: Date | null;
  }): { totalDays: number; employerPaidDays: number; inssDays: number } {
    const end = leave.actualEndDate ?? leave.expectedEndDate ?? leave.startDate;
    // Inclusive day count (both endpoints counted).
    const totalDays =
      Math.max(0, Math.floor((end.getTime() - leave.startDate.getTime()) / (24 * 60 * 60 * 1000))) +
      1;

    const isInssBearing =
      leave.type === LEAVE_TYPE.ILLNESS_INSS || leave.type === LEAVE_TYPE.WORK_ACCIDENT;

    if (!isInssBearing) {
      return { totalDays, employerPaidDays: totalDays, inssDays: 0 };
    }

    const employerPaidDays = Math.min(15, totalDays);
    const inssDays = Math.max(0, totalDays - 15);
    return { totalDays, employerPaidDays, inssDays };
  }

  private async leaveValidation(
    data: Partial<LeaveCreateFormData | LeaveUpdateFormData>,
    tx?: PrismaTransaction,
    existing?: {
      startDate?: Date | null;
      expectedEndDate?: Date | null;
      actualEndDate?: Date | null;
      type?: string | null;
    } | null,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.userId) {
      const user = await transaction.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        throw new NotFoundException('Colaborador não encontrado.');
      }
    }

    // Date coherence (merged with the existing record on update):
    //   expectedEndDate >= startDate, and actualEndDate >= startDate on finish.
    const startDate =
      data.startDate !== undefined ? data.startDate : existing?.startDate ?? null;
    const expectedEndDate =
      data.expectedEndDate !== undefined ? data.expectedEndDate : existing?.expectedEndDate ?? null;
    const actualEndDate =
      data.actualEndDate !== undefined ? data.actualEndDate : existing?.actualEndDate ?? null;
    const type = (data as any).type ?? existing?.type ?? null;

    if (startDate && expectedEndDate && new Date(expectedEndDate) < new Date(startDate)) {
      throw new BadRequestException(
        'A data prevista de término do afastamento não pode ser anterior à data de início.',
      );
    }
    if (startDate && actualEndDate && new Date(actualEndDate) < new Date(startDate)) {
      throw new BadRequestException(
        'A data efetiva de término do afastamento não pode ser anterior à data de início.',
      );
    }

    // Open-ended INSS/illness/accident leave (no end date): Secullum ponto
    // coverage is deferred (we can only push a closed afastamento range). Log a
    // warning so an operator knows to close/extend the range later.
    const openEndedTypes: string[] = [
      LEAVE_TYPE.ILLNESS_INSS,
      LEAVE_TYPE.WORK_ACCIDENT,
      LEAVE_TYPE.ILLNESS_UP_TO_15,
    ];
    if (type && openEndedTypes.includes(type) && startDate && !expectedEndDate && !actualEndDate) {
      this.logger.warn(
        `Afastamento ${type} sem data de término (colaborador ${data.userId ?? 'desconhecido'}): ` +
          'cobertura no ponto (Secullum) adiada até que um término seja definido.',
      );
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

  /**
   * Expose the leave-derived payroll split (15-day employer / 16th-day INSS) for an
   * afastamento. Read-only data for Part B's payroll calculator (this service does
   * not edit payroll). Returns the day breakdown + the structured INSS species.
   */
  async getPayrollSplit(id: string): Promise<{
    success: boolean;
    message: string;
    data: {
      leaveId: string;
      type: string;
      startDate: Date;
      endDate: Date;
      totalDays: number;
      employerPaidDays: number;
      inssDays: number;
      inssBenefitSpecies: string | null;
    };
  }> {
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave) {
      throw new NotFoundException('Afastamento não encontrado.');
    }

    const split = this.computeLeavePayrollSplit({
      type: leave.type,
      startDate: leave.startDate,
      expectedEndDate: leave.expectedEndDate,
      actualEndDate: leave.actualEndDate,
    });

    return {
      success: true,
      message: 'Divisão de folha do afastamento calculada com sucesso.',
      data: {
        leaveId: leave.id,
        type: leave.type,
        startDate: leave.startDate,
        endDate: leave.actualEndDate ?? leave.expectedEndDate ?? leave.startDate,
        ...split,
        inssBenefitSpecies: (leave as any).inssBenefitSpecies ?? null,
      },
    };
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

        // (Afastamento no longer mirrors onto contract status; the Leave table is the
        // source of truth for "afastado". Contract status stays ACTIVE.)

        return newLeave;
      });

      // Mirror into Secullum (ponto) so the absence isn't flagged as falta
      // injustificada. Best-effort, after the DB write — never blocks the leave.
      await this.syncLeaveToSecullum(leave.id);

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

        await this.leaveValidation(data, tx, existing as any);

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

        // (Afastamento no longer mirrors onto contract status; the Leave table is the
        // source of truth for "afastado". Contract status stays ACTIVE throughout.)

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

      // Re-sync the ponto record: syncLeave is idempotent and handles period
      // changes (re-push), CANCELLED (remove), and missing end dates (defer).
      await this.syncLeaveToSecullum(id);

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

        // (Afastamento no longer mirrors onto contract status; contract status stays
        // ACTIVE throughout. The Leave table is the source of truth for "afastado".)

        // Work-accident return ⇒ estabilidade acidentária de 12 meses a partir do retorno.
        if (existing.type === LEAVE_TYPE.WORK_ACCIDENT) {
          await this.applyAccidentStability(tx, existing.userId, actualEndDate, userId);
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

      // Finishing sets actualEndDate ⇒ the ponto record is now fully bounded;
      // (re-)push it. Idempotent.
      await this.syncLeaveToSecullum(id);

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
      // Capture the Secullum link BEFORE the row is gone so we can un-push the
      // ponto record afterwards (the Leave no longer exists post-transaction).
      let secullumEmployeeId: number | null = null;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const leave = await tx.leave.findUnique({
          where: { id },
          include: { user: { select: { secullumEmployeeId: true } } },
        });

        if (!leave) {
          throw new NotFoundException('Afastamento não encontrado.');
        }

        secullumEmployeeId = leave.user?.secullumEmployeeId ?? null;

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

      // Remove the ponto record (best-effort, never blocks the delete).
      await this.removeLeaveFromSecullum(id, secullumEmployeeId);

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

      // Mirror each created leave into Secullum (ponto) AFTER the transaction commits,
      // mirroring the single-record create path (~595). Best-effort; never blocks the
      // batch outcome (syncLeaveToSecullum swallows+logs its own errors).
      for (const created of success) {
        await this.syncLeaveToSecullum(created.id);
      }

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

      // Re-sync each updated leave's ponto record AFTER the transaction commits,
      // mirroring the single-record update/cancel path (~719). syncLeave is idempotent
      // and handles period changes (re-push) and CANCELLED (remove). Best-effort.
      for (const updated of success) {
        await this.syncLeaveToSecullum(updated.id);
      }

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

      // Capture each Secullum link BEFORE the rows are deleted so we can un-push the
      // ponto records afterwards (the Leaves no longer exist post-transaction).
      // Mirrors the single-record delete path (~941/971).
      const secullumLinks: Array<{ id: string; secullumEmployeeId: number | null }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.leaveIds.entries()) {
          try {
            const leave = await tx.leave.findUnique({
              where: { id },
              include: { user: { select: { secullumEmployeeId: true } } },
            });

            if (!leave) {
              throw new NotFoundException('Afastamento não encontrado.');
            }

            const secullumEmployeeId = leave.user?.secullumEmployeeId ?? null;

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
            secullumLinks.push({ id, secullumEmployeeId });
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

      // Remove each ponto record AFTER the transaction commits (best-effort, never
      // blocks the delete). Mirrors the single-record delete path (~971).
      for (const link of secullumLinks) {
        await this.removeLeaveFromSecullum(link.id, link.secullumEmployeeId);
      }

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
