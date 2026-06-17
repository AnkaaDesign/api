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
  VACATION_STATUS_ORDER,
} from '../../../constants';
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
        status: {
          in: [
            VACATION_STATUS.OPEN,
            VACATION_STATUS.SCHEDULED,
            VACATION_STATUS.IN_PROGRESS,
          ],
        },
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
        status: VACATION_STATUS.OPEN,
        statusOrder: VACATION_STATUS_ORDER[VACATION_STATUS.OPEN],
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

        const updated = await tx.vacation.update({
          where: { id },
          data: updateData,
          include: (include as any) ?? { user: true },
        });

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
        const dependentsCount = ((existing as any).user?.dependents ?? []).length;

        // Recibo POR TOMADA (single-period). O abono só entra na primeira
        // tomada do período; create/update já garantem que apenas ela carrega
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
            paymentDueDate: existing.startDate
              ? this.calc.addDays(new Date(existing.startDate), -2)
              : this.calc.addDays(new Date(), 10),
          },
          include: { user: true },
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
        const existing = await tx.vacation.findUnique({ where: { id } });
        if (!existing || existing.deletedAt) {
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

        // Guard: → SCHEDULED requires the gozo a ter início (startDate) definido.
        if (targetStatus === VACATION_STATUS.SCHEDULED && existing.startDate == null) {
          throw new BadRequestException(
            'Não é possível agendar férias sem a data de início do gozo definida.',
          );
        }
        // Guard: → PAID requires the recibo to be calculated.
        if (targetStatus === VACATION_STATUS.PAID && existing.baseRemuneration == null) {
          throw new BadRequestException(
            'Não é possível concluir o pagamento: o recibo de férias ainda não foi calculado.',
          );
        }
        // Guard: → PAID com gozo após o concessivo deve ser pago em DOBRO
        // (art. 137). Bloqueia o pagamento simples e sinaliza para recálculo.
        let mustDouble = false;
        if (
          targetStatus === VACATION_STATUS.PAID &&
          existing.concessiveEnd &&
          existing.startDate
        ) {
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
        // pagamento duplicado por avanços concorrentes). updateMany permite o
        // guard de status no WHERE; count===0 ⇒ alguém já mudou o status.
        const guarded = await tx.vacation.updateMany({
          where: { id, status: currentStatus as any },
          data: {
            status: targetStatus as any,
            statusOrder: VACATION_STATUS_ORDER[targetStatus],
            ...(mustDouble ? { isDouble: true } : {}),
            ...(targetStatus === VACATION_STATUS.PAID && !existing.paymentDate
              ? { paymentDate: new Date() }
              : {}),
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
