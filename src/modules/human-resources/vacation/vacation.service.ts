// vacation.service.ts
// Férias (Departamento Pessoal) — Part C.
//
// CRUD + list/filter + batch + status machine + fracionamento + recibo de
// férias (documento próprio, NÃO embutido na folha mensal). Espelha as
// convenções do TerminationService (transação + changelog + respostas pt-BR).

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  logEntityChange,
  trackAndLogFieldChanges,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  VACATION_STATUS,
  VACATION_STATUS_ORDER,
} from '../../../constants';
import { VacationCalculationService, VariablePayrollSample } from './vacation-calculation.service';
import { SecullumVacationSyncService } from '@modules/integrations/secullum/secullum-vacation-sync.service';
import type {
  VacationAdvanceFormData,
  VacationBatchCreateFormData,
  VacationBatchDeleteFormData,
  VacationBatchUpdateFormData,
  VacationCreateFormData,
  VacationGetManyFormData,
  VacationInclude,
  VacationSetPeriodsFormData,
  VacationUpdateFormData,
} from './dto/vacation.schema';
import type {
  VacationBatchCreateResponse,
  VacationBatchDeleteResponse,
  VacationBatchUpdateResponse,
  VacationCalculateResponse,
  VacationCreateResponse,
  VacationDeleteResponse,
  VacationGetManyResponse,
  VacationGetUniqueResponse,
  VacationUpdateResponse,
} from './types/vacation.types';

const STATUS_LABELS_PT: Record<string, string> = {
  [VACATION_STATUS.OPEN]: 'Aberto',
  [VACATION_STATUS.SCHEDULED]: 'Agendado',
  [VACATION_STATUS.IN_PROGRESS]: 'Em gozo',
  [VACATION_STATUS.PAID]: 'Pago',
  [VACATION_STATUS.EXPIRED]: 'Expirado',
};

// Forward chain of the férias status machine. EXPIRED is reached by the
// concessivo-expiry cron (art. 137), not by manual advance.
const STATUS_CHAIN: VACATION_STATUS[] = [
  VACATION_STATUS.OPEN,
  VACATION_STATUS.SCHEDULED,
  VACATION_STATUS.IN_PROGRESS,
  VACATION_STATUS.PAID,
];

@Injectable()
export class VacationService {
  private readonly logger = new Logger(VacationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly calc: VacationCalculationService,
    // Mirrors gozo períodos into Secullum (ponto). Every method on it is
    // self-contained and never throws, so the vacation write is never affected
    // by a Secullum outage. See secullum-vacation-sync.service.ts.
    private readonly secullumVacationSync: SecullumVacationSyncService,
  ) {}

  // Fire-and-forget Secullum ponto sync. Awaited so logs/order are deterministic
  // within the request, but its result NEVER changes the vacation outcome.
  private async syncToSecullum(vacationId: string): Promise<void> {
    try {
      await this.secullumVacationSync.syncVacation(vacationId);
    } catch (err: any) {
      // syncVacation already swallows its own errors; this is belt-and-braces.
      this.logger.warn(
        `Secullum vacation sync raised unexpectedly for ${vacationId}: ${err?.message ?? err}`,
      );
    }
  }

  // =====================
  // Média de variáveis: lê a folha do período aquisitivo (read-only)
  // =====================

  private async loadVariableSamples(
    tx: PrismaTransaction,
    userId: string,
    acquisitiveStart: Date,
    acquisitiveEnd: Date,
  ): Promise<{ samples: VariablePayrollSample[]; baseSalary: number }> {
    // Folhas mensais dentro do período aquisitivo.
    const payrolls = await tx.payroll.findMany({
      where: {
        userId,
        OR: this.monthsBetween(acquisitiveStart, acquisitiveEnd).map(({ year, month }) => ({
          year,
          month,
        })),
      },
      include: { bonus: { select: { netBonus: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    const num = (v: any): number => (v == null ? 0 : Number(v));

    const samples: VariablePayrollSample[] = payrolls.map(p => ({
      overtimeAmount: num(p.overtime50Amount) + num(p.overtime100Amount),
      nightDifferentialAmount: num(p.nightDifferentialAmount),
      habitualAdditionalsAmount: 0,
      bonificationAmount: num((p as any).bonus?.netBonus),
    }));

    // Salário-base: a folha mais recente do período, caindo para a posição atual.
    let baseSalary = payrolls.length > 0 ? num(payrolls[0].baseRemuneration) : 0;
    if (baseSalary === 0) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          position: {
            select: {
              remunerations: {
                where: { current: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { value: true },
              },
            },
          },
        },
      });
      baseSalary = num((user as any)?.position?.remunerations?.[0]?.value);
    }

    return { samples, baseSalary };
  }

  private monthsBetween(start: Date, end: Date): Array<{ year: number; month: number }> {
    const result: Array<{ year: number; month: number }> = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor.getTime() <= last.getTime() && result.length < 18) {
      result.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return result;
  }

  // =====================
  // Queries
  // =====================

  async findMany(query: VacationGetManyFormData): Promise<VacationGetManyResponse> {
    try {
      const q = query as any;
      const page = q.page && q.page > 0 ? q.page : 1;
      const take = q.limit || 20;
      const skip = (page - 1) * take;

      const [total, vacations] = await Promise.all([
        this.prisma.vacation.count({ where: q.where }),
        this.prisma.vacation.findMany({
          where: q.where,
          orderBy: q.orderBy || { acquisitiveEnd: 'desc' },
          include: q.include ?? { user: true, periods: true },
          skip,
          take,
        }),
      ]);

      const totalPages = Math.ceil(total / take) || 0;
      return {
        success: true,
        message: 'Férias carregadas com sucesso.',
        data: vacations as any[],
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar férias:', error);
      throw new InternalServerErrorException('Erro ao buscar férias. Por favor, tente novamente.');
    }
  }

  async findById(id: string, include?: VacationInclude): Promise<VacationGetUniqueResponse> {
    try {
      const vacation = await this.prisma.vacation.findUnique({
        where: { id },
        include: (include as any) ?? { user: true, periods: true },
      });
      if (!vacation) {
        throw new NotFoundException('Registro de férias não encontrado.');
      }
      return { success: true, message: 'Férias carregadas com sucesso.', data: vacation as any };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar férias por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar férias. Por favor, tente novamente.');
    }
  }

  // =====================
  // Create
  // =====================

  private async createWithTransaction(
    tx: PrismaTransaction,
    data: VacationCreateFormData,
    userId?: string,
    include?: VacationInclude,
  ): Promise<any> {
    const user = await tx.user.findUnique({
      where: { id: data.userId },
      select: {
        id: true,
        name: true,
        currentContractId: true,
        currentContract: { select: { id: true, admissionDate: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('Colaborador não encontrado.');
    }

    const contractId = data.contractId ?? user.currentContractId ?? null;
    const admissionDate = (user as any).currentContract?.admissionDate ?? null;

    // Deriva o período aquisitivo da admissão do vínculo atual (não do legado).
    let acquisitiveStart = data.acquisitiveStart ?? null;
    let acquisitiveEnd = data.acquisitiveEnd ?? null;
    let concessiveEnd: Date | null = null;

    if (!acquisitiveStart || !acquisitiveEnd) {
      if (!admissionDate) {
        throw new BadRequestException(
          'Não foi possível derivar o período aquisitivo: o vínculo atual do colaborador não possui data de admissão. Informe o período manualmente.',
        );
      }
      const derived = this.calc.computeAcquisitivePeriod(new Date(admissionDate));
      acquisitiveStart = acquisitiveStart ?? derived.acquisitiveStart;
      acquisitiveEnd = acquisitiveEnd ?? derived.acquisitiveEnd;
      concessiveEnd = derived.concessiveEnd;
    } else {
      // concessivo = fim do aquisitivo + 12 meses.
      concessiveEnd = this.calc.addYears(acquisitiveEnd, 1);
    }

    // Impede aquisitivo duplicado para o mesmo vínculo/colaborador.
    const duplicate = await tx.vacation.findFirst({
      where: { userId: data.userId, acquisitiveStart, acquisitiveEnd },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        'Já existe um registro de férias para este período aquisitivo deste colaborador.',
      );
    }

    const absences = data.unjustifiedAbsencesInPeriod ?? 0;
    const entitledDays = this.calc.entitledDaysForAbsences(absences);
    const isDouble = this.calc.isDoubleOwed(concessiveEnd);

    const vacation = await tx.vacation.create({
      data: {
        userId: data.userId,
        contractId,
        acquisitiveStart,
        acquisitiveEnd,
        concessiveEnd,
        unjustifiedAbsencesInPeriod: absences,
        entitledDays,
        status: VACATION_STATUS.OPEN,
        statusOrder: VACATION_STATUS_ORDER[VACATION_STATUS.OPEN],
        abonoPecuniarioDays: data.abonoPecuniarioDays ?? 0,
        soldThird: data.soldThird ?? false,
        isDouble,
        notes: data.notes ?? null,
        ...(data.periods && data.periods.length > 0
          ? {
              periods: {
                create: data.periods.map(p => ({ startDate: p.startDate, days: p.days })),
              },
            }
          : {}),
      },
      include: (include as any) ?? { user: true, periods: true },
    });

    // Valida fracionamento na criação (se houver períodos).
    if (data.periods && data.periods.length > 0) {
      const validation = this.calc.validateFracionamento(data.periods, entitledDays);
      if (!validation.valid) {
        throw new BadRequestException(validation.errors.join(' '));
      }
    }

    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.VACATION,
      entityId: vacation.id,
      action: CHANGE_ACTION.CREATE,
      entity: vacation,
      reason: `Período aquisitivo de férias criado para ${user.name}`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      userId: userId || null,
      transaction: tx,
    });

    return vacation;
  }

  async create(
    data: VacationCreateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationCreateResponse> {
    try {
      const vacation = await this.prisma.$transaction((tx: PrismaTransaction) =>
        this.createWithTransaction(tx, data, userId, include),
      );
      return { success: true, message: 'Férias criadas com sucesso.', data: vacation };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao criar férias:', error);
      throw new InternalServerErrorException('Erro ao criar férias. Por favor, tente novamente.');
    }
  }

  // =====================
  // Update
  // =====================

  async update(
    id: string,
    data: VacationUpdateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationUpdateResponse> {
    try {
      const vacation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacation.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }
        if (existing.status === VACATION_STATUS.PAID) {
          throw new BadRequestException('Não é possível editar férias já pagas.');
        }

        const updateData: any = {};
        for (const field of [
          'soldThird',
          'acquisitiveStart',
          'acquisitiveEnd',
          'paymentDate',
          'notes',
        ] as const) {
          if (data[field] !== undefined) updateData[field] = data[field];
        }
        if (data.abonoPecuniarioDays !== undefined) {
          updateData.abonoPecuniarioDays = data.abonoPecuniarioDays;
        }
        // Recompute entitledDays when faltas change (escala art. 130).
        if (data.unjustifiedAbsencesInPeriod !== undefined) {
          updateData.unjustifiedAbsencesInPeriod = data.unjustifiedAbsencesInPeriod;
          updateData.entitledDays = this.calc.entitledDaysForAbsences(
            data.unjustifiedAbsencesInPeriod,
          );
        }
        // Recompute concessivo + dobro when acquisitiveEnd changes.
        if (data.acquisitiveEnd !== undefined) {
          const concessiveEnd = this.calc.addYears(data.acquisitiveEnd, 1);
          updateData.concessiveEnd = concessiveEnd;
          updateData.isDouble = this.calc.isDoubleOwed(concessiveEnd);
        }

        const updated = await tx.vacation.update({
          where: { id },
          data: updateData,
          include: (include as any) ?? { user: true, periods: true },
        });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: [
            'unjustifiedAbsencesInPeriod',
            'entitledDays',
            'abonoPecuniarioDays',
            'soldThird',
            'acquisitiveStart',
            'acquisitiveEnd',
            'concessiveEnd',
            'isDouble',
            'paymentDate',
            'notes',
          ],
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return { success: true, message: 'Férias atualizadas com sucesso.', data: vacation as any };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar férias:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar férias. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Delete
  // =====================

  async delete(id: string, userId?: string): Promise<VacationDeleteResponse> {
    try {
      // Captured inside the tx (the user link disappears with the row) so we can
      // un-push the Secullum afastamentos AFTER the DB delete commits.
      let secullumEmployeeId: number | null = null;
      let wasPushed = false;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const vacation = await tx.vacation.findUnique({
          where: { id },
          include: { user: { select: { secullumEmployeeId: true } } },
        });
        if (!vacation) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }
        if (vacation.status === VACATION_STATUS.PAID) {
          throw new BadRequestException('Não é possível excluir férias já pagas.');
        }

        secullumEmployeeId = (vacation as any).user?.secullumEmployeeId ?? null;
        // Only SCHEDULED / IN_PROGRESS férias were ever pushed to the ponto.
        wasPushed =
          vacation.status === VACATION_STATUS.SCHEDULED ||
          vacation.status === VACATION_STATUS.IN_PROGRESS;

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: vacation,
          reason: 'Registro de férias excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.vacation.delete({ where: { id } });
      });

      // Reverse the ponto entry on cancel/delete. Non-fatal on failure (the
      // vacation is already gone locally). removeVacation tolerates a missing
      // Vacation row by using the captured secullumEmployeeId.
      if (wasPushed) {
        try {
          await this.secullumVacationSync.removeVacation(id, secullumEmployeeId);
        } catch (err: any) {
          this.logger.warn(
            `Secullum vacation un-sync raised unexpectedly for ${id}: ${err?.message ?? err}`,
          );
        }
      }

      return { success: true, message: 'Férias excluídas com sucesso.' };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir férias:', error);
      throw new InternalServerErrorException('Erro ao excluir férias. Por favor, tente novamente.');
    }
  }

  // =====================
  // Fracionamento — PUT /vacations/:id/periods
  // =====================

  async setPeriods(
    id: string,
    data: VacationSetPeriodsFormData,
    userId?: string,
  ): Promise<VacationUpdateResponse> {
    try {
      const vacation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacation.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }
        if (existing.status === VACATION_STATUS.PAID) {
          throw new BadRequestException('Não é possível alterar períodos de férias já pagas.');
        }

        const validation = this.calc.validateFracionamento(data.periods, existing.entitledDays);
        if (!validation.valid) {
          throw new BadRequestException(validation.errors.join(' '));
        }

        await tx.vacationPeriod.deleteMany({ where: { vacationId: id } });
        await tx.vacationPeriod.createMany({
          data: data.periods.map(p => ({ vacationId: id, startDate: p.startDate, days: p.days })),
        });

        const updated = await tx.vacation.findUnique({
          where: { id },
          include: { user: true, periods: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'periods',
          oldValue: null,
          newValue: { periods: data.periods, totalDays: validation.totalDays },
          reason: `Fracionamento de férias definido (${validation.periodCount} período(s))`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      // If the vacation is already pushed to the ponto (SCHEDULED/IN_PROGRESS),
      // re-sync so Secullum reflects the edited períodos (delete-then-recreate
      // inside syncVacation keeps it idempotent). OPEN férias aren't pushed yet,
      // so nothing to do. Non-fatal on failure.
      const status = (vacation as any)?.status as VACATION_STATUS | undefined;
      if (status === VACATION_STATUS.SCHEDULED || status === VACATION_STATUS.IN_PROGRESS) {
        await this.syncToSecullum(id);
      }

      return { success: true, message: 'Períodos de férias atualizados com sucesso.', data: vacation as any };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao definir períodos de férias:', error);
      throw new InternalServerErrorException(
        'Erro ao definir períodos de férias. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Cálculo do recibo — POST /vacations/:id/calculate
  // =====================

  async calculate(id: string, userId?: string): Promise<VacationCalculateResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacation.findUnique({
          where: { id },
          include: {
            user: {
              select: {
                id: true,
                dependents: { where: { irrfDeduction: true }, select: { id: true } },
              },
            },
          },
        });
        if (!existing) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }
        if (existing.status === VACATION_STATUS.PAID) {
          throw new BadRequestException('Não é possível recalcular férias já pagas.');
        }

        const { samples, baseSalary } = await this.loadVariableSamples(
          tx,
          existing.userId,
          existing.acquisitiveStart,
          existing.acquisitiveEnd,
        );
        const variableAverage = this.calc.computeVariableAverage(samples);

        const year = (existing.concessiveEnd ?? existing.acquisitiveEnd).getFullYear();
        const dependentsCount = ((existing as any).user?.dependents ?? []).length;

        const recibo = this.calc.buildRecibo(
          {
            baseSalary,
            variableAverage,
            entitledDays: existing.entitledDays,
            abonoPecuniarioDays: existing.abonoPecuniarioDays,
            isDouble: existing.isDouble,
            dependentsCount,
            allowSimplifiedDeduction: true,
            year,
          },
          { vacationId: existing.id, userId: existing.userId },
        );

        // Persiste a base/terço/abono/INSS/IRRF calculados (recibo permanece um
        // documento próprio, não embutido na folha).
        const updated = await tx.vacation.update({
          where: { id },
          data: {
            baseRemuneration: recibo.baseRemuneration,
            oneThird: recibo.oneThird,
            abonoAmount: recibo.abonoAmount,
            inss: recibo.inss,
            irrf: recibo.irrf,
            // paymentDueDate = início do gozo − 2 dias quando agendado, senão hoje + 10.
            paymentDueDate: this.calc.addDays(new Date(), 10),
          },
          include: { user: true, periods: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'recibo',
          oldValue: null,
          newValue: { net: recibo.net, inss: recibo.inss, irrf: recibo.irrf, isDouble: recibo.isDouble },
          reason: 'Recibo de férias calculado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return { vacation: updated, recibo };
      });

      return {
        success: true,
        message: 'Recibo de férias calculado com sucesso.',
        data: result as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao calcular recibo de férias:', error);
      throw new InternalServerErrorException(
        'Erro ao calcular recibo de férias. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Status machine — PUT /vacations/:id/advance
  // =====================

  async advance(
    id: string,
    data: VacationAdvanceFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationUpdateResponse> {
    try {
      const vacation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacation.findUnique({
          where: { id },
          include: { periods: { select: { id: true } } },
        });
        if (!existing) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }

        const currentStatus = existing.status as VACATION_STATUS;
        if (currentStatus === VACATION_STATUS.PAID) {
          throw new BadRequestException('As férias já estão pagas; não há próximo status.');
        }
        if (currentStatus === VACATION_STATUS.EXPIRED) {
          throw new BadRequestException(
            'O período concessivo expirou (art. 137). As férias devem ser pagas em dobro; recalcule antes de prosseguir.',
          );
        }

        const currentIndex = STATUS_CHAIN.indexOf(currentStatus);
        const nextStatus = STATUS_CHAIN[currentIndex + 1];
        const targetStatus = (data.status as VACATION_STATUS) ?? nextStatus;

        if (!targetStatus || targetStatus !== nextStatus) {
          throw new BadRequestException(
            `Transição de status inválida: ${STATUS_LABELS_PT[currentStatus]} → ${
              targetStatus ? STATUS_LABELS_PT[targetStatus] : '—'
            }. O próximo status válido é ${nextStatus ? STATUS_LABELS_PT[nextStatus] : '—'}.`,
          );
        }

        // Guard: → SCHEDULED requires at least one period (fracionamento/gozo).
        if (targetStatus === VACATION_STATUS.SCHEDULED && (existing.periods || []).length === 0) {
          throw new BadRequestException(
            'Não é possível agendar férias sem ao menos um período de gozo definido.',
          );
        }
        // Guard: → PAID requires the recibo to be calculated.
        if (targetStatus === VACATION_STATUS.PAID && existing.baseRemuneration == null) {
          throw new BadRequestException(
            'Não é possível concluir o pagamento: o recibo de férias ainda não foi calculado.',
          );
        }

        const updated = await tx.vacation.update({
          where: { id },
          data: {
            status: targetStatus as any,
            statusOrder: VACATION_STATUS_ORDER[targetStatus],
            ...(targetStatus === VACATION_STATUS.PAID && !existing.paymentDate
              ? { paymentDate: new Date() }
              : {}),
          },
          include: (include as any) ?? { user: true, periods: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: currentStatus,
          newValue: targetStatus,
          reason: `Status das férias alterado: ${STATUS_LABELS_PT[currentStatus]} → ${STATUS_LABELS_PT[targetStatus]}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      // Ponto sync: when the vacation reaches SCHEDULED (períodos guaranteed by
      // the guard above), push the gozo date ranges into Secullum as
      // afastamentos so punches aren't expected during férias. Re-syncing on
      // IN_PROGRESS is a cheap self-heal (idempotent). Non-fatal on failure.
      const newStatus = (vacation as any)?.status as VACATION_STATUS | undefined;
      if (newStatus === VACATION_STATUS.SCHEDULED || newStatus === VACATION_STATUS.IN_PROGRESS) {
        await this.syncToSecullum(id);
      }

      return { success: true, message: 'Status das férias atualizado com sucesso.', data: vacation as any };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao avançar status das férias:', error);
      throw new InternalServerErrorException(
        'Erro ao avançar status das férias. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Projeção read-only para a Previsão de Saídas (financeiro)
  // =====================

  /**
   * Projeção AGREGADA (sem linhas por colaborador) dos recibos de férias com
   * vencimento dentro de uma janela [from, to] para a "Previsão de Saídas".
   * READ-ONLY: não altera nenhum registro nem o contrato deste módulo.
   *
   * Valor do recibo BRUTO (espelha a folha mensal, que reporta grossSalary):
   *   baseRemuneration (férias + média de variáveis) + oneThird (1/3) + abonoAmount.
   * Os descontos (INSS/IRRF) NÃO são subtraídos — é o desembolso de caixa bruto
   * do recibo, consistente com a seção da folha.
   *
   * Dedup por status: apenas registros NÃO pagos (status ≠ PAID) entram; recibos
   * já pagos saíram do caixa e não são previsão. Exige recibo já calculado
   * (baseRemuneration ≠ null) e um vencimento (`paymentDueDate`) dentro da janela.
   *
   * Mapeamento de mês: pelo `paymentDueDate` do recibo.
   */
  async getForecastProjection(
    from: Date,
    to: Date,
  ): Promise<{ total: number; recordCount: number }> {
    const vacations = await this.prisma.vacation.findMany({
      where: {
        status: { not: VACATION_STATUS.PAID },
        baseRemuneration: { not: null },
        paymentDueDate: { gte: from, lte: to },
      },
      select: {
        baseRemuneration: true,
        oneThird: true,
        abonoAmount: true,
      },
    });

    const num = (v: any): number => (v == null ? 0 : Number(v));
    let total = 0;
    for (const v of vacations) {
      total += num(v.baseRemuneration) + num(v.oneThird) + num(v.abonoAmount);
    }

    return { total, recordCount: vacations.length };
  }

  // =====================
  // Batch
  // =====================

  async batchCreate(
    data: VacationBatchCreateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationBatchCreateResponse<VacationCreateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];
    for (const [index, item] of data.vacations.entries()) {
      try {
        const vacation = await this.prisma.$transaction((tx: PrismaTransaction) =>
          this.createWithTransaction(tx, item, userId, include),
        );
        success.push(vacation);
      } catch (error: any) {
        failed.push({ index, error: error.message || 'Erro ao criar férias', data: item });
      }
    }
    return this.batchResult(success, failed, 'criada', 'criadas');
  }

  async batchUpdate(
    data: VacationBatchUpdateFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationBatchUpdateResponse<VacationUpdateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];
    for (const [index, upd] of data.vacations.entries()) {
      try {
        const result = await this.update(upd.id, upd.data, include, userId);
        if (result.data) success.push(result.data);
      } catch (error: any) {
        failed.push({
          index,
          id: upd.id,
          error: error.message || 'Erro ao atualizar férias',
          data: { ...upd.data, id: upd.id },
        });
      }
    }
    return this.batchResult(success, failed, 'atualizada', 'atualizadas');
  }

  async batchDelete(
    data: VacationBatchDeleteFormData,
    userId?: string,
  ): Promise<VacationBatchDeleteResponse> {
    const success: { id: string; deleted: boolean }[] = [];
    const failed: any[] = [];
    for (const [index, id] of data.vacationIds.entries()) {
      try {
        await this.delete(id, userId);
        success.push({ id, deleted: true });
      } catch (error: any) {
        failed.push({ index, id, error: error.message || 'Erro ao excluir férias', data: { id } });
      }
    }
    return this.batchResult(success, failed, 'excluída', 'excluídas') as any;
  }

  private batchResult(success: any[], failed: any[], singular: string, plural: string) {
    const successMessage =
      success.length === 1 ? `1 férias ${singular}` : `${success.length} férias ${plural}`;
    const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';
    return {
      success: true,
      message: `${successMessage} com sucesso${failureMessage}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    } as any;
  }
}
