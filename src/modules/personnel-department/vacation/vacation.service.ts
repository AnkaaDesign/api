// vacation.service.ts
// Férias (Departamento Pessoal) — Part C.
//
// Modelo FLAT: cada Vacation é UMA tomada single-period (startDate + days).
// Várias Vacations podem compartilhar o mesmo período aquisitivo (irmãs); o
// saldo de gozo restante é derivado agrupando-as por (userId, acquisitiveStart,
// acquisitiveEnd). CRUD + list/filter + batch + status machine + saldo de
// período + recibo de férias (documento próprio, NÃO embutido na folha mensal).
// Espelha as convenções do TerminationService (transação + changelog + pt-BR).

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
  VACATION_STATUS_LABELS,
} from '../../../constants';
import { isPayrollEmployeeType } from '../../../utils/contract';
import { VacationCalculationService, VariablePayrollSample } from './vacation-calculation.service';
import {
  SecullumVacationSyncService,
  type VacationSyncResult,
  type VacationSecullumStatus,
} from '@modules/integrations/secullum/secullum-vacation-sync.service';
import type {
  VacationAdvanceFormData,
  VacationBatchCreateFormData,
  VacationBatchDeleteFormData,
  VacationBatchUpdateFormData,
  VacationCreateFormData,
  VacationGetManyFormData,
  VacationInclude,
  VacationPeriodBalanceFormData,
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
  VacationPeriodBalance,
  VacationPeriodBalanceResponse,
  VacationPeriodTaking,
  VacationUpdateResponse,
} from './types/vacation.types';

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

  /**
   * Manually (re)push this vacation's gozo períodos to the ponto (Secullum).
   * Exposed so HR can re-trigger after an outage / unlinked-then-linked user.
   */
  async syncSecullum(id: string): Promise<{ success: boolean; message: string; data: VacationSyncResult }> {
    const result = await this.secullumVacationSync.syncVacation(id);
    return { success: result.success, message: result.message, data: result };
  }

  /** Read-derived Secullum sync status for this vacation ("verificar no ponto"). */
  async getSecullumStatus(id: string): Promise<{ success: boolean; message: string; data: VacationSecullumStatus }> {
    const status = await this.secullumVacationSync.getVacationSecullumStatus(id);
    return { success: status.state !== 'UNKNOWN', message: status.message, data: status };
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

  // Garante que a tomada candidata (startDate+days) não se sobreponha às de
  // OUTRAS férias ativas do mesmo colaborador (não se pode estar em duas férias
  // ao mesmo tempo). Exclui a própria férias e as do mesmo grupo coletivo de
  // origem. Tomadas ainda não agendadas (startDate=null) não conflitam.
  private async assertNoOverlap(
    tx: PrismaTransaction,
    userId: string,
    candidate: { startDate: Date | null; days: number },
    opts: { excludeVacationId?: string; excludeGroupId?: string | null } = {},
  ): Promise<void> {
    if (!candidate || candidate.startDate == null) return;
    const others = await tx.vacation.findMany({
      where: {
        userId,
        deletedAt: null,
        startDate: { not: null },
        status: VACATION_STATUS.SCHEDULED,
        ...(opts.excludeVacationId ? { id: { not: opts.excludeVacationId } } : {}),
        ...(opts.excludeGroupId ? { groupId: { not: opts.excludeGroupId } } : {}),
      },
      select: { startDate: true, days: true },
    });
    const existing = others
      .filter(v => v.startDate != null)
      .map(v => ({ startDate: v.startDate as Date, days: v.days }));
    const conflict = this.calc.detectPeriodOverlap(
      [{ startDate: candidate.startDate, days: candidate.days }],
      existing,
    );
    if (conflict.overlaps && conflict.candidate && conflict.existing) {
      const fmt = (d: Date) => new Date(d).toISOString().slice(0, 10);
      throw new BadRequestException(
        `A tomada iniciando em ${fmt(conflict.candidate.startDate)} (${conflict.candidate.days} dia(s)) ` +
          `sobrepõe outra tomada de férias do colaborador (${fmt(conflict.existing.startDate)}, ${conflict.existing.days} dia(s)).`,
      );
    }
  }

  // Soma os dias de gozo das tomadas-irmãs ativas (mesmo período aquisitivo),
  // identifica a PRIMEIRA tomada (earliest startDate ?? createdAt) e calcula o
  // saldo de gozo restante. Usado pelo guard de over-allocation e pelo endpoint
  // de saldo de período. `excludeVacationId` exclui a própria tomada em updates.
  private async loadPeriodGroup(
    tx: PrismaTransaction,
    userId: string,
    acquisitiveStart: Date,
    acquisitiveEnd: Date,
    opts: { excludeVacationId?: string } = {},
  ): Promise<{
    siblings: Array<{
      id: string;
      startDate: Date | null;
      days: number;
      createdAt: Date;
      status: string;
      abonoPecuniarioDays: number;
      entitledDays: number;
    }>;
    firstTakingId: string | null;
    entitledDays: number;
    abonoDays: number;
    gozoEntitled: number;
    scheduledDays: number;
    remainingDays: number;
  }> {
    const siblings = await tx.vacation.findMany({
      where: {
        userId,
        acquisitiveStart,
        acquisitiveEnd,
        deletedAt: null,
        status: { not: VACATION_STATUS.EXPIRED },
      },
      select: {
        id: true,
        startDate: true,
        days: true,
        createdAt: true,
        status: true,
        abonoPecuniarioDays: true,
        entitledDays: true,
      },
    });

    // PRIMEIRA tomada do período = a mais antiga por (startDate ?? createdAt, createdAt).
    const key = (v: { startDate: Date | null; createdAt: Date }): number =>
      (v.startDate ? new Date(v.startDate).getTime() : new Date(v.createdAt).getTime());
    const sorted = [...siblings].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb) return ka - kb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const first = sorted[0] ?? null;

    const entitledDays = first?.entitledDays ?? 0;
    const abonoDays = first?.abonoPecuniarioDays ?? 0;
    const gozoEntitled = Math.max(0, entitledDays - abonoDays);
    const scheduledDays = siblings
      .filter(v => !opts.excludeVacationId || v.id !== opts.excludeVacationId)
      .reduce((sum, v) => sum + (v.days ?? 0), 0);
    const remainingDays = Math.max(0, gozoEntitled - scheduledDays);

    return {
      siblings: sorted,
      firstTakingId: first?.id ?? null,
      entitledDays,
      abonoDays,
      gozoEntitled,
      scheduledDays,
      remainingDays,
    };
  }

  // isDouble por tomada (art. 137): quando agendada, dobro se o gozo terminar
  // após o concessivo; quando não agendada (startDate=null), dobro se hoje já
  // passou do concessivo.
  private computeTakingIsDouble(
    startDate: Date | null,
    days: number,
    concessiveEnd: Date | null,
  ): boolean {
    if (!concessiveEnd) return false;
    const cEnd = new Date(concessiveEnd).getTime();
    if (startDate) {
      return this.calc.periodEndDate(new Date(startDate), days).getTime() > cEnd;
    }
    return Date.now() > cEnd;
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

      // Soft-delete: registros excluídos nunca aparecem nas listagens.
      const where = { ...(q.where ?? {}), deletedAt: null };

      const [total, vacations] = await Promise.all([
        this.prisma.vacation.count({ where }),
        this.prisma.vacation.findMany({
          where,
          orderBy: q.orderBy || { acquisitiveEnd: 'desc' },
          include: q.include ?? { user: true },
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
        include: (include as any) ?? { user: true },
      });
      if (!vacation || (vacation as any).deletedAt) {
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
        currentEmployeeType: true,
        currentContract: { select: { id: true, admissionDate: true } },
        dependents: { where: { irrfDeduction: true }, select: { id: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('Colaborador não encontrado.');
    }

    // CLT gate: férias (folha) só se aplicam a vínculos CLT/folha. Terceirizado/
    // PJ/autônomo/estagiário não geram férias neste módulo.
    if (!isPayrollEmployeeType((user as any).currentEmployeeType)) {
      throw new BadRequestException(
        `Não é possível registrar férias para ${user.name}: o vínculo atual não é CLT/folha. ` +
          'Apenas colaboradores CLT possuem férias na folha.',
      );
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

    const absences = data.unjustifiedAbsencesInPeriod ?? 0;
    const entitledDays = this.calc.entitledDaysForAbsences(absences);
    const groupId = (data as any).groupId ?? null;
    const startDate = data.startDate ?? null;
    const days = data.days;

    // Modelo FLAT: várias tomadas por período aquisitivo são permitidas. Carrega
    // o grupo de tomadas-irmãs ativas para aplicar os guards de saldo/abono.
    const group = await this.loadPeriodGroup(tx, data.userId, acquisitiveStart, acquisitiveEnd);

    // Abono só na PRIMEIRA tomada do período: nas demais é zerado pelo service.
    const isFirstTaking = group.firstTakingId == null;
    let abonoPecuniarioDays = data.abonoPecuniarioDays ?? 0;
    if (!isFirstTaking && abonoPecuniarioDays > 0) {
      this.logger.warn(
        `Abono pecuniário ignorado: não é a primeira tomada do período aquisitivo de ${user.name}.`,
      );
      abonoPecuniarioDays = 0;
    }

    // gozoEntitled = entitledDays - abono(primeira tomada). Para a PRIMEIRA
    // tomada o abono é o desta criação; para as demais, o já gravado no grupo.
    const gozoEntitled = isFirstTaking
      ? Math.max(0, entitledDays - abonoPecuniarioDays)
      : group.gozoEntitled;

    // Over-allocation guard: Σdias (irmãs + esta) ≤ gozoEntitled.
    if (group.scheduledDays + days > gozoEntitled) {
      throw new BadRequestException(
        `A soma das tomadas de gozo (${group.scheduledDays + days} dia(s)) excede o saldo do período ` +
          `aquisitivo (${gozoEntitled} dia(s) de gozo). Restam ${Math.max(0, gozoEntitled - group.scheduledDays)} dia(s).`,
      );
    }

    // isDouble desta tomada: gozo após o concessivo (art. 137).
    const isDouble = this.computeTakingIsDouble(startDate, days, concessiveEnd);

    // Sem sobreposição com outras tomadas ativas do mesmo colaborador.
    await this.assertNoOverlap(tx, data.userId, { startDate, days }, { excludeGroupId: groupId });

    const vacation = await tx.vacation.create({
      data: {
        userId: data.userId,
        contractId,
        groupId,
        startDate,
        days,
        acquisitiveStart,
        acquisitiveEnd,
        concessiveEnd,
        unjustifiedAbsencesInPeriod: absences,
        entitledDays,
        status: VACATION_STATUS.SCHEDULED,
        abonoPecuniarioDays,
        soldThird: data.soldThird ?? false,
        isDouble,
        notes: data.notes ?? null,
      },
      include: (include as any) ?? { user: true },
    });

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

    // Auto-calcula o recibo inline (base/terço/abono/INSS/IRRF + paymentDueDate).
    // O cálculo usa os dependentes IRRF já carregados acima.
    await this.computeAndPersistRecibo(
      tx,
      {
        id: vacation.id,
        userId: data.userId,
        days,
        isDouble,
        abonoPecuniarioDays,
        soldThird: data.soldThird ?? false,
        startDate,
        acquisitiveStart,
        acquisitiveEnd,
        concessiveEnd,
        user: { dependents: (user as any).dependents ?? [] },
      },
      userId,
    );

    // Re-read so the returned entity reflects the persisted recibo.
    return tx.vacation.findUnique({
      where: { id: vacation.id },
      include: (include as any) ?? { user: true },
    });
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
      // Mirror the gozo período into Secullum (ponto) AFTER the DB commit.
      // Non-fatal: a Secullum outage never undoes the vacation write.
      await this.syncToSecullum(vacation.id);
      return { success: true, message: 'Férias criadas com sucesso.', data: vacation };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      // Índice único parcial (userId, acquisitiveStart, acquisitiveEnd) — corrida.
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          'Já existe um registro de férias para este período aquisitivo deste colaborador.',
        );
      }
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
        if (!existing || existing.deletedAt) {
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

        // Período aquisitivo efetivo após o update (para guards de saldo/dobro).
        const effAcqStart = data.acquisitiveStart ?? existing.acquisitiveStart;
        const effAcqEnd = data.acquisitiveEnd ?? existing.acquisitiveEnd;
        const effEntitled =
          data.unjustifiedAbsencesInPeriod !== undefined
            ? this.calc.entitledDaysForAbsences(data.unjustifiedAbsencesInPeriod)
            : existing.entitledDays;
        const effStartDate =
          data.startDate !== undefined ? data.startDate : existing.startDate;
        const effDays = data.days !== undefined ? data.days : existing.days;

        // Recompute entitledDays when faltas change (escala art. 130).
        if (data.unjustifiedAbsencesInPeriod !== undefined) {
          updateData.unjustifiedAbsencesInPeriod = data.unjustifiedAbsencesInPeriod;
          updateData.entitledDays = effEntitled;
        }

        // Abono só na PRIMEIRA tomada do período: zera nas demais.
        if (data.abonoPecuniarioDays !== undefined) {
          let abono = data.abonoPecuniarioDays;
          if (abono > 0 && existing.userId) {
            const grp = await this.loadPeriodGroup(
              tx,
              existing.userId,
              effAcqStart,
              effAcqEnd,
              { excludeVacationId: id },
            );
            const isFirst = grp.firstTakingId == null
              ? true
              : (() => {
                  // Esta tomada é a primeira se seu (startDate??createdAt) for ≤
                  // ao da primeira irmã restante.
                  const selfKey = effStartDate
                    ? new Date(effStartDate).getTime()
                    : new Date(existing.createdAt).getTime();
                  const firstSib = grp.siblings[0];
                  const sibKey = firstSib
                    ? (firstSib.startDate
                        ? new Date(firstSib.startDate).getTime()
                        : new Date(firstSib.createdAt).getTime())
                    : Infinity;
                  return selfKey <= sibKey;
                })();
            if (!isFirst) {
              this.logger.warn(
                `Abono pecuniário ignorado no update ${id}: não é a primeira tomada do período.`,
              );
              abono = 0;
            }
          }
          updateData.abonoPecuniarioDays = abono;
        }

        // startDate / days da tomada (modelo FLAT).
        if (data.startDate !== undefined) updateData.startDate = data.startDate;
        if (data.days !== undefined) updateData.days = data.days;

        // Over-allocation guard quando days/aquisitivo/abono mudam: Σdias ≤ gozoEntitled.
        if (
          (data.days !== undefined ||
            data.acquisitiveStart !== undefined ||
            data.acquisitiveEnd !== undefined ||
            data.unjustifiedAbsencesInPeriod !== undefined ||
            data.abonoPecuniarioDays !== undefined) &&
          existing.userId
        ) {
          const grp = await this.loadPeriodGroup(tx, existing.userId, effAcqStart, effAcqEnd, {
            excludeVacationId: id,
          });
          const effAbono =
            updateData.abonoPecuniarioDays !== undefined
              ? updateData.abonoPecuniarioDays
              : existing.abonoPecuniarioDays;
          // Saldo de gozo do período: usa o abono da primeira tomada (do grupo)
          // salvo se esta própria for a primeira/única.
          const baseEntitled = grp.firstTakingId == null ? effEntitled : grp.entitledDays;
          const baseAbono = grp.firstTakingId == null ? effAbono : grp.abonoDays;
          const gozoEntitled = Math.max(0, baseEntitled - baseAbono);
          if (grp.scheduledDays + effDays > gozoEntitled) {
            throw new BadRequestException(
              `A soma das tomadas de gozo (${grp.scheduledDays + effDays} dia(s)) excede o saldo do ` +
                `período aquisitivo (${gozoEntitled} dia(s) de gozo). ` +
                `Restam ${Math.max(0, gozoEntitled - grp.scheduledDays)} dia(s).`,
            );
          }
        }

        // Recompute concessivo when acquisitiveEnd changes.
        let effConcessive = existing.concessiveEnd;
        if (data.acquisitiveEnd !== undefined) {
          effConcessive = this.calc.addYears(data.acquisitiveEnd, 1);
          updateData.concessiveEnd = effConcessive;
        }
        // Recompute isDouble desta tomada quando startDate/days/concessivo mudam.
        if (
          data.startDate !== undefined ||
          data.days !== undefined ||
          data.acquisitiveEnd !== undefined
        ) {
          updateData.isDouble = this.computeTakingIsDouble(effStartDate, effDays, effConcessive);
        }

        // Sem sobreposição com outras tomadas ativas quando startDate/days mudam.
        if ((data.startDate !== undefined || data.days !== undefined) && existing.userId) {
          await this.assertNoOverlap(
            tx,
            existing.userId,
            { startDate: effStartDate, days: effDays },
            { excludeVacationId: id, excludeGroupId: existing.groupId },
          );
        }

        let updated = await tx.vacation.update({
          where: { id },
          data: updateData,
          include: (include as any) ?? { user: true },
        });

        // Recompute the recibo + paymentDueDate whenever a field that feeds the
        // calc changes: startDate / days / abono / faltas / período aquisitivo.
        const reciboInputsChanged =
          data.startDate !== undefined ||
          data.days !== undefined ||
          data.abonoPecuniarioDays !== undefined ||
          data.unjustifiedAbsencesInPeriod !== undefined ||
          data.acquisitiveStart !== undefined ||
          data.acquisitiveEnd !== undefined;
        if (reciboInputsChanged && existing.userId) {
          const withUser = await tx.vacation.findUnique({
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
          if (withUser) {
            await this.computeAndPersistRecibo(tx, withUser as any, userId);
            updated = (await tx.vacation.findUnique({
              where: { id },
              include: (include as any) ?? { user: true },
            }))!;
          }
        }

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: [
            'startDate',
            'days',
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

      // SEV-1 fix: re-sync Secullum AFTER the commit so an edited gozo período
      // doesn't orphan the old afastamento (syncVacation deletes-then-recreates
      // the tagged record idempotently). Non-fatal; mirrors leave.update().
      await this.syncToSecullum(id);

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
        if (!vacation || (vacation as any).deletedAt) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }
        if (vacation.status === VACATION_STATUS.PAID) {
          throw new BadRequestException('Não é possível excluir férias já pagas.');
        }

        secullumEmployeeId = (vacation as any).user?.secullumEmployeeId ?? null;
        // Vacations are created SCHEDULED (and pushed to the ponto) — that's the
        // only status that ever has an afastamento to reverse.
        wasPushed = vacation.status === VACATION_STATUS.SCHEDULED;

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

        // Soft-delete: marca deletedAt preservando o passivo/histórico.
        await tx.vacation.update({ where: { id }, data: { deletedAt: new Date() } });
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
  // Saldo de gozo do período — GET /vacations/period-balance
  // =====================

  /**
   * Saldo de gozo de um período aquisitivo: agrupa as tomadas-irmãs (mesmo
   * userId + acquisitiveStart/End) e devolve entitled/abono/gozoEntitled/
   * scheduled/remaining + o histórico das tomadas. Read-only.
   */
  async getPeriodBalance(vacationId: string): Promise<VacationPeriodBalanceResponse> {
    try {
      const balance = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Load the acquisitive dates straight from the row — exact Date objects,
        // so the sibling grouping match can't be broken by client date drift.
        const vac = await tx.vacation.findUnique({
          where: { id: vacationId },
          select: { userId: true, acquisitiveStart: true, acquisitiveEnd: true },
        });
        if (!vac || !vac.userId) return null;
        return this.loadPeriodGroup(tx, vac.userId, vac.acquisitiveStart, vac.acquisitiveEnd);
      });
      if (!balance) {
        throw new NotFoundException('Férias não encontradas para calcular o saldo do período.');
      }
      const takings: VacationPeriodTaking[] = balance.siblings.map(s => ({
        id: s.id,
        startDate: s.startDate,
        days: s.days,
        status: s.status as VacationPeriodTaking['status'],
      }));
      const data: VacationPeriodBalance = {
        entitledDays: balance.entitledDays,
        abonoDays: balance.abonoDays,
        gozoEntitled: balance.gozoEntitled,
        scheduledDays: balance.scheduledDays,
        remainingDays: balance.remainingDays,
        takings,
      };
      return { success: true, message: 'Saldo do período aquisitivo carregado com sucesso.', data };
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error('Erro ao carregar saldo do período de férias:', error);
      throw new InternalServerErrorException(
        'Erro ao carregar saldo do período de férias. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Cálculo do recibo — POST /vacations/:id/calculate
  // =====================

  // Núcleo compartilhado do recibo: lê a média de variáveis do período
  // aquisitivo, monta o recibo da tomada (single-period) e PERSISTE base/terço/
  // abono/INSS/IRRF + paymentDueDate (= início do gozo − 2 dias). Usado por
  // create (auto-cálculo inline), update (recálculo) e calculate (endpoint).
  // Recebe a vacation já carregada (com user.dependents). Loga a alteração.
  private async computeAndPersistRecibo(
    tx: PrismaTransaction,
    existing: {
      id: string;
      userId: string | null;
      days: number;
      isDouble: boolean;
      abonoPecuniarioDays: number;
      soldThird: boolean;
      startDate: Date | null;
      acquisitiveStart: Date;
      acquisitiveEnd: Date;
      concessiveEnd: Date | null;
      user?: { dependents?: Array<{ id: string }> } | null;
    },
    userId?: string,
  ): Promise<{ vacation: any; recibo: any }> {
    if (!existing.userId) {
      throw new BadRequestException(
        'Não é possível calcular o recibo: as férias não estão vinculadas a um colaborador (vínculo desfeito).',
      );
    }

    const { samples, baseSalary } = await this.loadVariableSamples(
      tx,
      existing.userId,
      existing.acquisitiveStart,
      existing.acquisitiveEnd,
    );
    const variableAverage = this.calc.computeVariableAverage(samples);

    const year = (existing.concessiveEnd ?? existing.acquisitiveEnd).getFullYear();
    const dependentsCount = (existing.user?.dependents ?? []).length;

    // Recibo POR TOMADA (single-period). O abono só entra na primeira tomada do
    // período; create/update já garantem que apenas ela carrega
    // abonoPecuniarioDays > 0, então includeAbono = (abono > 0).
    const includeAbono = existing.abonoPecuniarioDays > 0;
    const recibo = this.calc.buildReciboForTaking(
      {
        baseSalary,
        variableAverage,
        days: existing.days,
        isDouble: existing.isDouble,
        includeAbono,
        abonoDays: existing.abonoPecuniarioDays,
        soldThird: existing.soldThird,
        dependentsCount,
        allowSimplifiedDeduction: true,
        year,
      },
      { vacationId: existing.id, userId: existing.userId },
    );

    // Persiste a base/terço/abono/INSS/IRRF calculados (recibo permanece um
    // documento próprio, não embutido na folha). paymentDueDate = início do
    // gozo − 2 dias (art. 145 CLT — pagamento até 2 dias antes do gozo).
    const updated = await tx.vacation.update({
      where: { id: existing.id },
      data: {
        baseRemuneration: recibo.baseRemuneration,
        oneThird: recibo.oneThird,
        abonoAmount: recibo.abonoAmount,
        inss: recibo.inss,
        irrf: recibo.irrf,
        paymentDueDate: existing.startDate
          ? this.calc.addDays(new Date(existing.startDate), -2)
          : null,
      },
      include: { user: true },
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.VACATION,
      entityId: existing.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'recibo',
      oldValue: null,
      newValue: { net: recibo.net, inss: recibo.inss, irrf: recibo.irrf, isDouble: recibo.isDouble },
      reason: 'Recibo de férias calculado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: existing.id,
      userId: userId || null,
      transaction: tx,
    });

    return { vacation: updated, recibo };
  }

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
        if (!existing || existing.deletedAt) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }
        if (existing.status === VACATION_STATUS.PAID) {
          throw new BadRequestException('Não é possível recalcular férias já pagas.');
        }

        return this.computeAndPersistRecibo(tx, existing as any, userId);
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

  // markPaid: única transição manual no modelo colapsado. SCHEDULED ou EXPIRED
  // → PAID (EXPIRED-exit corrige o beco-sem-saída). Mantém o nome `advance` e a
  // rota PUT /vacations/:id/advance que web/mobile já chamam.
  async advance(
    id: string,
    data: VacationAdvanceFormData,
    include?: VacationInclude,
    userId?: string,
  ): Promise<VacationUpdateResponse> {
    try {
      const vacation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacation.findUnique({ where: { id } });
        if (!existing || existing.deletedAt) {
          throw new NotFoundException('Registro de férias não encontrado.');
        }

        const currentStatus = existing.status as VACATION_STATUS;
        if (currentStatus === VACATION_STATUS.PAID) {
          throw new BadRequestException('As férias já estão pagas.');
        }

        // O único alvo válido é PAID. Aceita SCHEDULED ou EXPIRED como origem.
        const targetStatus = (data.status as VACATION_STATUS) ?? VACATION_STATUS.PAID;
        if (targetStatus !== VACATION_STATUS.PAID) {
          throw new BadRequestException(
            `Transição inválida: ${VACATION_STATUS_LABELS[currentStatus]} → ${
              VACATION_STATUS_LABELS[targetStatus] ?? '—'
            }. A única transição manual é para "${VACATION_STATUS_LABELS[VACATION_STATUS.PAID]}".`,
          );
        }

        // Guard: → PAID requires the recibo to be calculated (auto agora; mantemos
        // honesto).
        if (existing.baseRemuneration == null) {
          throw new BadRequestException(
            'Não é possível concluir o pagamento: o recibo de férias ainda não foi calculado.',
          );
        }

        // Guard: → PAID com gozo após o concessivo deve ser pago em DOBRO
        // (art. 137). Marca isDouble (já está EXPIRED com isDouble, mas SCHEDULED
        // pode ultrapassar também).
        let mustDouble = false;
        if (existing.concessiveEnd && existing.startDate) {
          const concessiveEnd = new Date(existing.concessiveEnd);
          const periodEnd = this.calc.periodEndDate(new Date(existing.startDate), existing.days);
          if (periodEnd.getTime() > concessiveEnd.getTime()) {
            mustDouble = true;
          }
          if (mustDouble && !existing.isDouble) {
            throw new BadRequestException(
              'O gozo agendado ultrapassa o período concessivo (art. 137): as férias devem ser ' +
                'pagas em dobro. Recalcule o recibo (será marcado em dobro) antes de concluir o pagamento.',
            );
          }
        }

        // Transição ATÔMICA: só atualiza se o status ainda for o lido (evita
        // pagamento duplicado por chamadas concorrentes). count===0 ⇒ alguém já
        // mudou o status.
        const guarded = await tx.vacation.updateMany({
          where: { id, status: currentStatus as any },
          data: {
            status: VACATION_STATUS.PAID as any,
            ...(mustDouble ? { isDouble: true } : {}),
            ...(!existing.paymentDate ? { paymentDate: new Date() } : {}),
          },
        });
        if (guarded.count === 0) {
          throw new BadRequestException(
            'O status das férias foi alterado por outra operação. Atualize a página e tente novamente.',
          );
        }

        const updated = await tx.vacation.findUnique({
          where: { id },
          include: (include as any) ?? { user: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.VACATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: currentStatus,
          newValue: VACATION_STATUS.PAID,
          reason: `Status das férias alterado: ${VACATION_STATUS_LABELS[currentStatus]} → ${VACATION_STATUS_LABELS[VACATION_STATUS.PAID]}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return { success: true, message: 'Férias marcadas como pagas com sucesso.', data: vacation as any };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao marcar férias como pagas:', error);
      throw new InternalServerErrorException(
        'Erro ao marcar férias como pagas. Por favor, tente novamente.',
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
        deletedAt: null,
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
        // Mirror into Secullum after the commit; never fails the batch item.
        await this.syncToSecullum(vacation.id);
        success.push(vacation);
      } catch (error: any) {
        const message =
          error?.code === 'P2002'
            ? 'Já existe um registro de férias para este período aquisitivo deste colaborador.'
            : error.message || 'Erro ao criar férias';
        failed.push({ index, error: message, data: item });
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
