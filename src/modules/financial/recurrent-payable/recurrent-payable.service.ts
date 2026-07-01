import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReconciliationSource,
  RecurrentPayable,
  RecurrentPayableOccurrence,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CreateRecurrentPayableDto, UpdateRecurrentPayableDto } from './dto/recurrent-payable.dto';

/** São Paulo is UTC-3 year-round (no DST since 2019). Because the offset is
 *  constant, adding whole DAY_MS/WEEK_MS to an SP-midnight instant keeps it at
 *  SP-midnight — no DST arithmetic needed. */
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Weekly-family frequencies advance by weeks (and use daysOfWeek); everything
 *  else advances by whole months (and uses dueDayOfMonth). */
const WEEKLY_FREQUENCIES = new Set(['WEEKLY', 'BIWEEKLY']);
function isWeeklyFrequency(frequency: string): boolean {
  return WEEKLY_FREQUENCIES.has(frequency);
}

function startOfDaySaoPaulo(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  sp.setUTCHours(0, 0, 0, 0);
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** SP-midnight of the Sunday opening the week containing `d` (weekday 0=Sun). */
function startOfWeekSaoPaulo(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  sp.setUTCHours(0, 0, 0, 0);
  sp.setUTCDate(sp.getUTCDate() - sp.getUTCDay());
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

/** SP-midnight instant for an explicit Y/M(0-based)/D. */
function spMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0) - SP_OFFSET_MS);
}

/** First and last SP-midnight days of a competence month (inclusive). */
function competenceRange(competence: string): { from: Date; to: Date } {
  const [year, month] = competence.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: spMidnight(year, month - 1, 1), to: spMidnight(year, month - 1, lastDay) };
}

/** Weeks advanced per cycle: BIWEEKLY implies 2; frequencyCount multiplies. */
function weeksPerCycle(frequency: string, count: number): number {
  const base = frequency === 'BIWEEKLY' ? 2 : 1;
  return base * Math.max(1, count);
}

/** All SP-midnight due dates in [from,to] for a weekly cadence: each selected
 *  weekday, in the weeks that fall on-cycle relative to `anchor` (so BIWEEKLY /
 *  every-N-weeks land on a stable phase). Empty when no weekdays are configured. */
function weeklyDueDates(
  daysOfWeek: number[],
  perCycle: number,
  anchor: Date,
  from: Date,
  to: Date,
): Date[] {
  const days = [...new Set(daysOfWeek)].filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  if (days.length === 0) return [];
  const cycle = Math.max(1, perCycle);
  const anchorWeek = startOfWeekSaoPaulo(anchor).getTime();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const out: Date[] = [];
  let weekStart = startOfWeekSaoPaulo(from).getTime();
  let guard = 0;
  while (weekStart <= toMs && guard++ < 600) {
    const weeksSince = Math.round((weekStart - anchorWeek) / WEEK_MS);
    if ((((weeksSince % cycle) + cycle) % cycle) === 0) {
      for (const dow of days) {
        const ms = weekStart + dow * DAY_MS;
        if (ms >= fromMs && ms <= toMs) out.push(new Date(ms));
      }
    }
    weekStart += WEEK_MS;
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/** Order-insensitive equality of two weekday sets. */
function sameDaySet(a: number[], b: number[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

/** The element of `occs` whose dueDate is closest to `ref`. */
function nearestByDate<T extends { dueDate: Date }>(occs: T[], ref: Date): T {
  return occs.reduce((best, o) =>
    Math.abs(o.dueDate.getTime() - ref.getTime()) < Math.abs(best.dueDate.getTime() - ref.getTime())
      ? o
      : best,
  );
}

/** First instant of the SP calendar month containing `d`. */
function startOfMonthSaoPaulo(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  sp.setUTCDate(1);
  sp.setUTCHours(0, 0, 0, 0);
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

/** Competence (YYYY-MM) of a date in SP time. */
function competenceOf(d: Date): string {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  return `${sp.getUTCFullYear()}-${String(sp.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The SP due date for `dueDayOfMonth` within a competence, clamped to the
 *  month's last day (e.g. day 31 in February → 28/29). */
function dueDateForCompetence(competence: string, dueDayOfMonth: number): Date {
  const [year, month] = competence.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based here
  const day = Math.min(Math.max(1, dueDayOfMonth), lastDay);
  // Build the SP-midnight of that day, then convert back to UTC instant.
  const sp = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

/** Number of months a frequency advances per cycle. Monthly-family only — the
 *  meaningful kinds for a recurring bill. Unknown → 1 month. */
function monthsForFrequency(frequency: string, count: number): number {
  const base: Record<string, number> = {
    MONTHLY: 1,
    BIMONTHLY: 2,
    QUARTERLY: 3,
    TRIANNUAL: 4,
    QUADRIMESTRAL: 4,
    SEMI_ANNUAL: 6,
    ANNUAL: 12,
  };
  return (base[frequency] ?? 1) * Math.max(1, count);
}

@Injectable()
export class RecurrentPayableService {
  private readonly logger = new Logger(RecurrentPayableService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async list(params: { isActive?: boolean } = {}) {
    const where: Prisma.RecurrentPayableWhereInput = {};
    if (params.isActive !== undefined) where.isActive = params.isActive;
    const data = await this.prisma.recurrentPayable.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { supplier: { select: { id: true, fantasyName: true, cnpj: true } }, category: true },
    });
    return { success: true, message: 'Contas recorrentes carregadas.', data };
  }

  async findById(id: string) {
    const data = await this.prisma.recurrentPayable.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, fantasyName: true, cnpj: true } },
        category: true,
        occurrences: { orderBy: { dueDate: 'desc' }, take: 12 },
      },
    });
    if (!data) throw new NotFoundException('Conta recorrente não encontrada.');
    return { success: true, message: 'Conta recorrente carregada.', data };
  }

  async create(dto: CreateRecurrentPayableDto, userId?: string) {
    await this.assertCategory(dto.categoryId);
    const now = new Date();
    const created = await this.prisma.recurrentPayable.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        supplierId: dto.supplierId ?? null,
        payeeName: dto.payeeName ?? null,
        payeeCnpj: dto.payeeCnpj ?? null,
        categoryId: dto.categoryId,
        amountKind: dto.amountKind,
        fixedAmount: dto.fixedAmount ?? null,
        estimatedAmount: dto.estimatedAmount ?? null,
        frequency: dto.frequency,
        frequencyCount: dto.frequencyCount,
        dueDayOfMonth: dto.dueDayOfMonth ?? null,
        daysOfWeek: dto.daysOfWeek ?? [],
        paymentMethod: dto.paymentMethod ?? null,
        expectsNf: dto.expectsNf,
        isActive: dto.isActive,
        // Materialize the current competence on the next cron tick.
        nextRun: dto.isActive ? startOfDaySaoPaulo(now) : null,
        createdById: userId ?? null,
      },
    });
    return { success: true, message: 'Conta recorrente criada.', data: created };
  }

  async update(id: string, dto: UpdateRecurrentPayableDto) {
    const existing = await this.prisma.recurrentPayable.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Conta recorrente não encontrada.');
    if (dto.categoryId) await this.assertCategory(dto.categoryId);

    // A cadence change must re-plan the future: existing future occurrences were
    // generated by the OLD schedule, so they're deleted and re-materialized.
    const daysChanged =
      dto.daysOfWeek !== undefined &&
      !sameDaySet(dto.daysOfWeek, existing.daysOfWeek);
    const cadenceChanged =
      (dto.frequency !== undefined && dto.frequency !== existing.frequency) ||
      (dto.frequencyCount !== undefined && dto.frequencyCount !== existing.frequencyCount) ||
      (dto.dueDayOfMonth !== undefined && dto.dueDayOfMonth !== existing.dueDayOfMonth) ||
      daysChanged;
    const willBeActive = dto.isActive ?? existing.isActive;

    const data: Prisma.RecurrentPayableUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.supplierId !== undefined)
      data.supplier = dto.supplierId
        ? { connect: { id: dto.supplierId } }
        : { disconnect: true };
    if (dto.payeeName !== undefined) data.payeeName = dto.payeeName;
    if (dto.payeeCnpj !== undefined) data.payeeCnpj = dto.payeeCnpj;
    if (dto.categoryId !== undefined) data.category = { connect: { id: dto.categoryId } };
    if (dto.amountKind !== undefined) data.amountKind = dto.amountKind;
    if (dto.fixedAmount !== undefined) data.fixedAmount = dto.fixedAmount;
    if (dto.estimatedAmount !== undefined) data.estimatedAmount = dto.estimatedAmount;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.frequencyCount !== undefined) data.frequencyCount = dto.frequencyCount;
    if (dto.dueDayOfMonth !== undefined) data.dueDayOfMonth = dto.dueDayOfMonth ?? null;
    if (dto.daysOfWeek !== undefined) data.daysOfWeek = dto.daysOfWeek;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.expectsNf !== undefined) data.expectsNf = dto.expectsNf;
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
      // Re-activating with no pending nextRun resumes materialization.
      if (dto.isActive && !existing.nextRun) data.nextRun = startOfDaySaoPaulo(new Date());
      if (!dto.isActive) data.nextRun = null;
    }
    // A cadence change re-arms the cron from today so the new schedule fills in.
    if (cadenceChanged && willBeActive) data.nextRun = startOfDaySaoPaulo(new Date());

    const updated = await this.prisma.recurrentPayable.update({ where: { id }, data });

    if (cadenceChanged && willBeActive) {
      // Drop only future, untouched occurrences (no payment, no bank/NF link, no
      // reconciliation match) — paid/linked history is preserved. The cron then
      // re-materializes them under the new cadence.
      const today = startOfDaySaoPaulo(new Date());
      await this.prisma.recurrentPayableOccurrence.deleteMany({
        where: {
          recurrentPayableId: id,
          dueDate: { gte: today },
          status: { in: ['PENDING', 'OVERDUE'] },
          bankTransactionId: null,
          fiscalDocumentId: null,
        },
      });
    }

    return { success: true, message: 'Conta recorrente atualizada.', data: updated };
  }

  async remove(id: string) {
    const existing = await this.prisma.recurrentPayable.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Conta recorrente não encontrada.');
    // Occurrences cascade-delete with the parent.
    await this.prisma.recurrentPayable.delete({ where: { id } });
    return { success: true, message: 'Conta recorrente removida.' };
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const cat = await this.prisma.transactionCategory.findUnique({ where: { id: categoryId } });
    if (!cat) throw new BadRequestException('Categoria de transação inválida.');
  }

  // ---------------------------------------------------------------------------
  // Materialization (called by the scheduler, idempotent per competence)
  // ---------------------------------------------------------------------------

  /** Advances a payable's nextRun. Weekly bills re-extend their horizon roughly
   *  weekly (the dueDate unique makes re-runs cheap); monthly-family bills jump to
   *  the start of the next cycle's month. */
  computeNextRun(payable: Pick<RecurrentPayable, 'frequency' | 'frequencyCount'>, from: Date): Date {
    if (isWeeklyFrequency(payable.frequency)) {
      return addDays(startOfDaySaoPaulo(from), 7);
    }
    const months = monthsForFrequency(payable.frequency, payable.frequencyCount);
    const monthStart = startOfMonthSaoPaulo(from);
    const sp = new Date(monthStart.getTime() + SP_OFFSET_MS);
    sp.setUTCMonth(sp.getUTCMonth() + months);
    return new Date(sp.getTime() - SP_OFFSET_MS);
  }

  /** Horizon (days ahead) weekly bills materialize on each run. ~6 weeks of
   *  buffer so a weekly re-run always has runway even if a tick is missed. */
  private static readonly HORIZON_DAYS = 45;
  /** Date window (± days) within which a bank debit / NF is matched to an
   *  occurrence by due date. Wide enough for a monthly bill, tight enough that a
   *  weekly debit binds to the right visit. */
  private static readonly MATCH_WINDOW_DAYS = 35;

  /** Idempotently create (or return) the occurrence for an exact due date. The
   *  (payableId, dueDate) unique is the idempotency backstop for races. */
  private async materializeForDueDate(
    payable: RecurrentPayable,
    dueDate: Date,
  ): Promise<RecurrentPayableOccurrence> {
    const existing = await this.prisma.recurrentPayableOccurrence.findUnique({
      where: { recurrentPayableId_dueDate: { recurrentPayableId: payable.id, dueDate } },
    });
    if (existing) return existing;

    const estimatedAmount = await this.computeEstimate(payable);
    try {
      return await this.prisma.recurrentPayableOccurrence.create({
        data: {
          recurrentPayableId: payable.id,
          competence: competenceOf(dueDate),
          dueDate,
          estimatedAmount,
          status: 'PENDING',
          expectsNf: payable.expectsNf,
          paymentMethod: payable.paymentMethod,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.recurrentPayableOccurrence.findUniqueOrThrow({
          where: { recurrentPayableId_dueDate: { recurrentPayableId: payable.id, dueDate } },
        });
      }
      throw err;
    }
  }

  /** Monthly-family: ensure the single occurrence for a competence exists.
   *  Dedups by competence (invariant: one per month), so it is tolerant of a
   *  changed dueDayOfMonth without creating a second row for the month. */
  private async ensureMonthlyOccurrence(
    payable: RecurrentPayable,
    competence: string,
  ): Promise<RecurrentPayableOccurrence> {
    const existing = await this.prisma.recurrentPayableOccurrence.findFirst({
      where: { recurrentPayableId: payable.id, competence },
      orderBy: { dueDate: 'asc' },
    });
    if (existing) return existing;
    const dueDate = dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1);
    return this.materializeForDueDate(payable, dueDate);
  }

  /** Weekly: materialize every due occurrence in [from,to]. Returns them. */
  private async materializeWeeklyHorizon(
    payable: RecurrentPayable,
    from: Date,
    to: Date,
  ): Promise<RecurrentPayableOccurrence[]> {
    const dates = weeklyDueDates(
      payable.daysOfWeek,
      weeksPerCycle(payable.frequency, payable.frequencyCount),
      payable.createdAt,
      from,
      to,
    );
    const out: RecurrentPayableOccurrence[] = [];
    for (const d of dates) out.push(await this.materializeForDueDate(payable, d));
    return out;
  }

  /** Scheduler entry: materialize whatever is due for a payable. Weekly bills
   *  fill a rolling horizon from today; monthly bills ensure the anchor month.
   *  Returns the count materialized/ensured. */
  async materializeDue(payable: RecurrentPayable, anchor: Date, now: Date): Promise<number> {
    if (isWeeklyFrequency(payable.frequency)) {
      const start = startOfDaySaoPaulo(now);
      const occ = await this.materializeWeeklyHorizon(
        payable,
        start,
        addDays(start, RecurrentPayableService.HORIZON_DAYS),
      );
      return occ.length;
    }
    await this.ensureMonthlyOccurrence(payable, competenceOf(anchor));
    return 1;
  }

  /** Flip past-due PENDING occurrences to OVERDUE (a real persisted state, not
   *  just a display computation). Due-today is not overdue. */
  async markOverdueOccurrences(): Promise<number> {
    const cutoff = startOfDaySaoPaulo(new Date());
    const res = await this.prisma.recurrentPayableOccurrence.updateMany({
      where: { status: 'PENDING', dueDate: { lt: cutoff } },
      data: { status: 'OVERDUE' },
    });
    return res.count;
  }

  /** All occurrences of a payable that fall in a competence month. For weekly
   *  bills this is several rows; for monthly, one. Materializes when allowed (the
   *  current month / the unified feed) so rows are actionable before the cron. */
  async ensureOccurrencesForCompetence(
    payable: RecurrentPayable,
    competence: string,
    allowMaterialize: boolean,
  ): Promise<RecurrentPayableOccurrence[]> {
    if (allowMaterialize) {
      if (isWeeklyFrequency(payable.frequency)) {
        const { from, to } = competenceRange(competence);
        await this.materializeWeeklyHorizon(payable, from, to);
      } else {
        await this.ensureMonthlyOccurrence(payable, competence);
      }
    }
    return this.prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: payable.id, competence },
      orderBy: { dueDate: 'asc' },
    });
  }

  /** Ensure occurrences exist around a date (for the reconciliation/NF sweeps to
   *  have something to match) without advancing the live horizon/nextRun. */
  private async ensureOccurrencesAround(payable: RecurrentPayable, date: Date): Promise<void> {
    const w = RecurrentPayableService.MATCH_WINDOW_DAYS;
    if (isWeeklyFrequency(payable.frequency)) {
      await this.materializeWeeklyHorizon(payable, addDays(date, -w), addDays(date, w));
    } else {
      await this.ensureMonthlyOccurrence(payable, competenceOf(date));
    }
  }

  /** Per-OCCURRENCE estimate. FIXED → the known amount (a per-visit fee for
   *  weekly bills, a monthly amount otherwise). VARIABLE → the seed estimate, or
   *  a bank-history average: per-month for monthly bills, per-debit for weekly
   *  bills (so a single visit isn't estimated at the whole month's spend). */
  private async computeEstimate(payable: RecurrentPayable): Promise<number> {
    if (payable.amountKind === 'FIXED') {
      return Number(payable.fixedAmount ?? payable.estimatedAmount ?? 0);
    }
    if (payable.estimatedAmount != null) return Number(payable.estimatedAmount);
    return isWeeklyFrequency(payable.frequency)
      ? this.perDebitAverage(payable.categoryId)
      : this.threeMonthAverage(payable.categoryId);
  }

  /** Average of individual DEBIT amounts tagged to the category over the last 3
   *  months — the per-occurrence estimate for weekly bills. */
  private async perDebitAverage(categoryId: string): Promise<number> {
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - 3);
    const txs = await this.prisma.bankTransaction.findMany({
      where: { postedAt: { gte: from, lte: to }, type: 'DEBIT', categories: { some: { categoryId } } },
      select: { amount: true, categories: { where: { categoryId }, select: { allocatedAmount: true } } },
    });
    if (txs.length === 0) return 0;
    const total = txs.reduce((sum, tx) => {
      const allocated = tx.categories[0]?.allocatedAmount;
      const amount =
        allocated != null && Number(allocated) !== 0 ? Math.abs(Number(allocated)) : Math.abs(Number(tx.amount));
      return sum + amount;
    }, 0);
    return Math.round((total / txs.length) * 100) / 100;
  }

  /** Average per-month total of debits tagged to the category over the last 3
   *  whole months (mirrors TransactionCategoryService.forecast). */
  private async threeMonthAverage(categoryId: string): Promise<number> {
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - 3);
    const txs = await this.prisma.bankTransaction.findMany({
      where: {
        postedAt: { gte: from, lte: to },
        type: 'DEBIT',
        categories: { some: { categoryId } },
      },
      select: {
        postedAt: true,
        amount: true,
        categories: { where: { categoryId }, select: { allocatedAmount: true } },
      },
    });
    const monthly = new Map<string, number>();
    for (const tx of txs) {
      const txAmount = Math.abs(Number(tx.amount));
      const allocated = tx.categories[0]?.allocatedAmount;
      const amount = allocated != null && Number(allocated) !== 0 ? Math.abs(Number(allocated)) : txAmount;
      const key = competenceOf(tx.postedAt);
      monthly.set(key, (monthly.get(key) ?? 0) + amount);
    }
    if (monthly.size === 0) return 0;
    const total = [...monthly.values()].reduce((a, b) => a + b, 0);
    return Math.round((total / monthly.size) * 100) / 100;
  }

  // ---------------------------------------------------------------------------
  // Settle
  // ---------------------------------------------------------------------------

  /** Mark an occurrence paid. VARIABLE bills REQUIRE the real paid amount;
   *  FIXED bills settle with the known amount. */
  async markOccurrencePaid(
    occurrenceId: string,
    opts: { paidAmount?: number | null; paymentMethod?: string | null; userId?: string },
  ): Promise<{ success: boolean; message: string; data: RecurrentPayableOccurrence }> {
    const occ = await this.prisma.recurrentPayableOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { recurrentPayable: true },
    });
    if (!occ) throw new NotFoundException('Ocorrência não encontrada.');
    if (occ.status === 'PAID') {
      throw new BadRequestException('Esta conta já está marcada como paga.');
    }

    const isFixed = occ.recurrentPayable.amountKind === 'FIXED';
    let amount: number;
    if (isFixed) {
      amount = Number(occ.recurrentPayable.fixedAmount ?? occ.estimatedAmount);
    } else {
      if (opts.paidAmount == null) {
        throw new BadRequestException(
          'Informe o valor real pago para esta conta variável (energia/água).',
        );
      }
      amount = opts.paidAmount;
    }

    const data = await this.prisma.recurrentPayableOccurrence.update({
      where: { id: occurrenceId },
      data: {
        status: 'PAID',
        paidAmount: amount,
        paidAt: new Date(),
        paidById: opts.userId ?? null,
        paymentMethod: (opts.paymentMethod as never) ?? occ.paymentMethod,
      },
    });
    return { success: true, message: 'Conta recorrente marcada como paga.', data };
  }

  // ---------------------------------------------------------------------------
  // Monthly dashboard (the unified "Recorrentes" page)
  // ---------------------------------------------------------------------------

  /** Current competence (YYYY-MM, SP time) — the monthly view's default. */
  currentCompetence(): string {
    return competenceOf(new Date());
  }

  /** Per-bill monthly view for the unified Recorrentes page. Each bill is
   *  summarized over ALL its occurrences in the competence month — one for a
   *  monthly bill, several for a weekly one — with a per-occurrence breakdown for
   *  individual settlement. The current month materializes lazily (so rows are
   *  actionable before the cron); other months are read-only (real occurrences if
   *  the cron made them, else a transient forecast from the schedule). KPI totals
   *  count occurrences, so a weekly bill contributes each visit. */
  async monthlyView(competence: string) {
    const payables = await this.prisma.recurrentPayable.findMany({
      where: { isActive: true },
      include: {
        supplier: { select: { id: true, fantasyName: true, cnpj: true } },
        category: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ name: 'asc' }],
    });

    const isCurrent = competence === this.currentCompetence();
    const { from, to } = competenceRange(competence);

    type OccView = {
      occurrenceId: string | null;
      dueDate: string;
      status: string;
      forecastAmount: number;
      paidAmount: number | null;
      paidAt: string | null;
      transactionCount: number;
      nfLinked: boolean;
    };

    const items: Array<Record<string, unknown>> = [];
    let totalPaid = 0;
    let totalForecast = 0;
    let paidCount = 0;
    let pendingCount = 0;

    for (const payable of payables) {
      const occs = await this.ensureOccurrencesForCompetence(payable, competence, isCurrent);

      // Bulk match counts for the month's occurrences (avoids N count queries).
      const occIds = occs.map(o => o.id);
      const countRows = occIds.length
        ? await this.prisma.reconciliationMatch.groupBy({
            by: ['recurrentOccurrenceId'],
            where: { recurrentOccurrenceId: { in: occIds } },
            _count: { _all: true },
          })
        : [];
      const countMap = new Map(countRows.map(r => [r.recurrentOccurrenceId, r._count._all]));

      let occViews: OccView[];
      if (occs.length > 0) {
        occViews = occs.map(o => ({
          occurrenceId: o.id,
          dueDate: o.dueDate.toISOString(),
          status: o.status,
          forecastAmount: Number(o.estimatedAmount ?? 0),
          paidAmount: o.paidAmount == null ? null : Number(o.paidAmount),
          paidAt: o.paidAt ? o.paidAt.toISOString() : null,
          transactionCount: countMap.get(o.id) ?? 0,
          nfLinked: o.fiscalDocumentId != null,
        }));
      } else {
        // No materialized rows (a non-current month) — synthesize the schedule as
        // transient forecast entries so the user sees what is coming/expected.
        const estimate = await this.computeEstimate(payable);
        const dates = isWeeklyFrequency(payable.frequency)
          ? weeklyDueDates(
              payable.daysOfWeek,
              weeksPerCycle(payable.frequency, payable.frequencyCount),
              payable.createdAt,
              from,
              to,
            )
          : [dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1)];
        occViews = dates.map(d => ({
          occurrenceId: null,
          dueDate: d.toISOString(),
          status: 'PENDING',
          forecastAmount: estimate,
          paidAmount: null,
          paidAt: null,
          transactionCount: 0,
          nfLinked: false,
        }));
      }

      let pTotalForecast = 0;
      let pTotalPaid = 0;
      let pPaid = 0;
      let pPending = 0;
      let pOverdue = 0;
      let txCount = 0;
      let anyNf = false;
      let nextDue: string | null = null;
      for (const ov of occViews) {
        pTotalForecast += ov.forecastAmount;
        txCount += ov.transactionCount;
        anyNf = anyNf || ov.nfLinked;
        if (ov.status === 'PAID') {
          pPaid += 1;
          pTotalPaid += ov.paidAmount ?? 0;
        } else {
          if (ov.status === 'OVERDUE') pOverdue += 1;
          else pPending += 1;
          if (nextDue == null || ov.dueDate < nextDue) nextDue = ov.dueDate;
        }
      }

      const summaryStatus =
        occViews.length > 0 && pPaid === occViews.length
          ? 'PAID'
          : pOverdue > 0
            ? 'OVERDUE'
            : 'PENDING';

      totalForecast += pTotalForecast;
      totalPaid += pTotalPaid;
      paidCount += pPaid;
      pendingCount += pPending + pOverdue;

      const firstDue = occViews[0]?.dueDate ?? dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1).toISOString();

      items.push({
        id: payable.id,
        // Single-occurrence (monthly) convenience: the lone occurrence id, else null.
        occurrenceId: occViews.length === 1 ? occViews[0].occurrenceId : null,
        name: payable.name,
        category: payable.category,
        payeeName: payable.supplier?.fantasyName ?? payable.payeeName ?? null,
        amountKind: payable.amountKind,
        isVariable: payable.amountKind === 'VARIABLE',
        frequency: payable.frequency,
        daysOfWeek: payable.daysOfWeek,
        dueDayOfMonth: payable.dueDayOfMonth,
        paymentMethod: payable.paymentMethod ?? null,
        dueDate: nextDue ?? firstDue,
        status: summaryStatus,
        occurrenceCount: occViews.length,
        paidCount: pPaid,
        pendingCount: pPending + pOverdue,
        overdueCount: pOverdue,
        // Month aggregates (kept under the legacy field names so the table binds).
        paidAmount: pPaid > 0 ? Math.round(pTotalPaid * 100) / 100 : null,
        paidAt: null,
        forecastAmount: Math.round(pTotalForecast * 100) / 100,
        nfLinked: anyNf,
        transactionCount: txCount,
        occurrences: occViews,
      });
    }

    return {
      success: true,
      message: 'Recorrentes do mês carregadas.',
      data: {
        competence,
        items,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalForecast: Math.round(totalForecast * 100) / 100,
        paidCount,
        pendingCount,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Read for PayablesService
  // ---------------------------------------------------------------------------

  /** Ensures every active payable has its competence-month occurrences
   *  materialized (one for monthly bills, several for weekly) so each is a
   *  separate actionable Contas a Pagar row, and returns occurrence + parent for
   *  the unified feed. Pass `allowMaterialize=false` (a PAST competence) to read
   *  the EXISTING occurrences only — never back-materialize phantom historical
   *  rows. */
  async ensureCurrentOccurrenceRows(
    competence: string,
    allowMaterialize = true,
  ): Promise<
    Array<{
      occurrence: RecurrentPayableOccurrence;
      payable: RecurrentPayable & { supplier: { id: string; fantasyName: string } | null };
    }>
  > {
    const payables = await this.prisma.recurrentPayable.findMany({
      where: { isActive: true },
      include: { supplier: { select: { id: true, fantasyName: true } } },
    });
    const rows: Array<{ occurrence: RecurrentPayableOccurrence; payable: (typeof payables)[number] }> = [];
    for (const payable of payables) {
      const occurrences = await this.ensureOccurrencesForCompetence(payable, competence, allowMaterialize);
      for (const occurrence of occurrences) rows.push({ occurrence, payable });
    }
    return rows;
  }

  /** Per-payable forecast rollup for a competence month — the SAME occurrence
   *  source Contas a Pagar reads, so the Previsão de Saídas enumerates exactly the
   *  obligations Contas a Pagar does. For each active payable it returns:
   *    - openForecast  Σ estimate of the still-open (PENDING/OVERDUE) occurrences.
   *      A bank-settled OR manually-paid occurrence is PAID and drops out (its cash
   *      already left / is represented by the reconciled debit) → no double count.
   *    - paidAmount    Σ real paidAmount of the PAID occurrences (context).
   *  The current month materializes lazily (rows are actionable now); other months
   *  synthesize the schedule as a transient forecast (mirrors monthlyView). */
  async forecastForCompetence(competence: string): Promise<
    Array<{
      category: { id: string; name: string; slug: string; color: string | null; accountingType: string | null };
      openForecast: number;
      paidAmount: number;
      occurrenceCount: number;
      paidCount: number;
      status: 'PAID' | 'PENDING' | 'OVERDUE';
      paymentDate: Date | null;
    }>
  > {
    const payables = await this.prisma.recurrentPayable.findMany({
      where: { isActive: true },
      include: {
        category: { select: { id: true, name: true, slug: true, color: true, accountingType: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
    const isCurrent = competence === this.currentCompetence();
    const { from, to } = competenceRange(competence);

    const out: Array<{
      category: { id: string; name: string; slug: string; color: string | null; accountingType: string | null };
      openForecast: number;
      paidAmount: number;
      occurrenceCount: number;
      paidCount: number;
      status: 'PAID' | 'PENDING' | 'OVERDUE';
      paymentDate: Date | null;
    }> = [];

    for (const payable of payables) {
      const occs = await this.ensureOccurrencesForCompetence(payable, competence, isCurrent);
      let openForecast = 0;
      let paidAmount = 0;
      let paidCount = 0;
      let occurrenceCount = 0;
      let anyOverdue = false;
      let nextDue: Date | null = null;

      if (occs.length > 0) {
        for (const o of occs) {
          occurrenceCount++;
          if (o.status === 'PAID') {
            paidCount++;
            paidAmount += Number(o.paidAmount ?? 0);
          } else {
            openForecast += Number(o.estimatedAmount ?? 0);
            if (o.status === 'OVERDUE') anyOverdue = true;
            if (!nextDue || o.dueDate < nextDue) nextDue = o.dueDate;
          }
        }
      } else {
        // No materialized rows (a non-current month) — synthesize the schedule as
        // a transient forecast so the obligation isn't silently dropped.
        const estimate = await this.computeEstimate(payable);
        const dates = isWeeklyFrequency(payable.frequency)
          ? weeklyDueDates(
              payable.daysOfWeek,
              weeksPerCycle(payable.frequency, payable.frequencyCount),
              payable.createdAt,
              from,
              to,
            )
          : [dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1)];
        for (const d of dates) {
          occurrenceCount++;
          openForecast += estimate;
          if (!nextDue || d < nextDue) nextDue = d;
        }
      }

      const status: 'PAID' | 'PENDING' | 'OVERDUE' =
        occurrenceCount > 0 && paidCount === occurrenceCount ? 'PAID' : anyOverdue ? 'OVERDUE' : 'PENDING';

      out.push({
        category: payable.category,
        openForecast: Math.round(openForecast * 100) / 100,
        paidAmount: Math.round(paidAmount * 100) / 100,
        occurrenceCount,
        paidCount,
        status,
        paymentDate: nextDue,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Reconciliation bridges (daily sweep — catches BOTH manual category
  // assignment on the extrato AND auto-classified OFX imports, idempotently.
  // The instant manual path is markOccurrencePaid; this closes the loop
  // automatically without invasive wiring into the reconciliation hot path.)
  // ---------------------------------------------------------------------------

  /** Sweep: settle open occurrences whose linked category received a tagged bank
   *  DEBIT. Each debit settles the NEAREST open occurrence by due date (so a
   *  weekly bill's individual visits bind to their own debit instead of all
   *  collapsing onto one), and each debit is consumed at most once across all
   *  payables (so a category shared by two bills can't double-count one payment).
   *  Returns how many occurrences were settled. */
  /**
   * Category SOURCE for no-NF recurring bills (rent, housemaid): tag uncategorized
   * bank DEBITs with the category of the recurring payee they were paid to, matched
   * by counterparty CNPJ. Without this the transaction classifier often can't guess
   * the category from an opaque PIX memo, so the debit stays uncategorized AND the
   * category-gated reconcilePendingFromBank sweep never finds it (chicken-and-egg).
   *
   * Categorization ONLY — it never settles an occurrence and only fills EMPTY
   * transactions (the classifier's and any MANUAL tags are never overridden). Run
   * BEFORE reconcilePendingFromBank so the now-tagged debits flow into the existing
   * settle path. A CNPJ shared by two payables → first payable wins (same payee
   * almost always means the same category). Returns how many debits were tagged.
   */
  async categorizeFromPayeeCnpj(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    const payables = await this.prisma.recurrentPayable.findMany({
      where: {
        isActive: true,
        OR: [{ payeeCnpj: { not: null } }, { supplier: { cnpj: { not: null } } }],
      },
      include: { supplier: { select: { cnpj: true } } },
    });
    let tagged = 0;
    const seenTx = new Set<string>();
    for (const payable of payables) {
      const cnpj = payable.payeeCnpj ?? payable.supplier?.cnpj;
      if (!cnpj) continue;
      const txs = await this.prisma.bankTransaction.findMany({
        where: {
          type: 'DEBIT',
          postedAt: { gte: from },
          counterpartyCnpjCpf: cnpj,
          categories: { none: {} }, // only fill empty — never override classifier/manual
        },
        select: { id: true, amount: true },
      });
      for (const tx of txs) {
        if (seenTx.has(tx.id)) continue;
        seenTx.add(tx.id);
        try {
          await this.prisma.bankTransactionCategory.create({
            data: {
              transactionId: tx.id,
              categoryId: payable.categoryId,
              source: ReconciliationSource.AUTO,
              confidence: 80,
              allocatedAmount: new Prisma.Decimal(Math.abs(Number(tx.amount))),
            },
          });
          tagged++;
        } catch {
          // Unique (transactionId, categoryId) race / already tagged — ignore.
        }
      }
    }
    if (tagged) this.logger.log(`Recurrent-payable CNPJ categorization: ${tagged} debit(s) tagged`);
    return tagged;
  }

  async reconcilePendingFromBank(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    const payables = await this.prisma.recurrentPayable.findMany({ where: { isActive: true } });
    const consumedTxIds = new Set<string>();
    let settled = 0;
    for (const payable of payables) {
      const txs = await this.prisma.bankTransaction.findMany({
        where: {
          type: 'DEBIT',
          postedAt: { gte: from },
          categories: { some: { categoryId: payable.categoryId } },
        },
        select: { id: true, postedAt: true, amount: true },
        orderBy: { postedAt: 'asc' },
      });
      for (const tx of txs) {
        if (consumedTxIds.has(tx.id)) continue;
        const result = await this.applyBankSettlement(payable, tx);
        if (result === 'settled') {
          settled++;
          consumedTxIds.add(tx.id);
        } else if (result === 'confirmed') {
          // Linked to an already-paid occurrence (manual baixa); still consumed.
          consumedTxIds.add(tx.id);
        }
        // 'none' → no matching occurrence in window; leave the debit available for
        // another payable that shares this category.
      }
    }
    if (settled) this.logger.log(`Recurrent-payable bank sweep: ${settled} occurrence(s) settled`);
    return settled;
  }

  /** Sweep: link inbound (ENTRADA) NFs to occurrences of expectsNf payables by
   *  supplier CNPJ + competence. Returns how many NFs were linked. */
  async linkPendingNfs(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    // Match NFs by the payable's own CNPJ (preferred) or the legacy supplier
    // CNPJ for rows created before payeeCnpj existed.
    const payables = await this.prisma.recurrentPayable.findMany({
      where: {
        isActive: true,
        expectsNf: true,
        OR: [{ payeeCnpj: { not: null } }, { supplier: { cnpj: { not: null } } }],
      },
      include: { supplier: { select: { cnpj: true } } },
    });
    let linked = 0;
    for (const payable of payables) {
      const cnpj = payable.payeeCnpj ?? payable.supplier?.cnpj;
      if (!cnpj) continue;
      const docs = await this.prisma.fiscalDocument.findMany({
        where: { operationType: 'ENTRADA', emitCnpj: cnpj, issueDate: { gte: from } },
        select: { id: true, issueDate: true },
        orderBy: { issueDate: 'asc' },
      });
      for (const doc of docs) {
        if (await this.linkNf(payable, doc.id, doc.issueDate)) linked++;
      }
    }
    if (linked) this.logger.log(`Recurrent-payable NF sweep: ${linked} NF(s) linked`);
    return linked;
  }

  /** Settle/link a single occurrence from a categorized DEBIT:
   *   - PENDING → auto-mark PAID with the debited amount (full automation)
   *   - already PAID (manual) → confirm (clear) it without changing the amount
   *
   * Both paths now write a ReconciliationMatch keyed on recurrentOccurrenceId so
   * clearance is a first-class fact (derived clearanceState), idempotent via the
   * (transactionId, recurrentOccurrenceId) unique constraint. When the occurrence
   * was already PAID with a different amount, the debit/asserted-amount drift is
   * recorded on the match (notes + low confidence → DISPUTED) instead of being
   * silently absorbed. */
  private async applyBankSettlement(
    payable: RecurrentPayable,
    tx: { id: string; postedAt: Date; amount: number | Prisma.Decimal },
  ): Promise<'settled' | 'confirmed' | 'none'> {
    const amount = Math.abs(Number(tx.amount));
    // Make sure the occurrences around this debit exist so we have something to
    // bind to (e.g. a weekly bill's visits in the debit's week, or the debit
    // month's occurrence for a monthly bill).
    await this.ensureOccurrencesAround(payable, tx.postedAt);

    const w = RecurrentPayableService.MATCH_WINDOW_DAYS;
    const lo = addDays(tx.postedAt, -w);
    const hi = addDays(tx.postedAt, w);

    // 1) Settle the NEAREST still-open occurrence by due date.
    const open = await this.prisma.recurrentPayableOccurrence.findMany({
      where: {
        recurrentPayableId: payable.id,
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { gte: lo, lte: hi },
      },
    });
    if (open.length > 0) {
      const occ = nearestByDate(open, tx.postedAt);
      const updated = await this.prisma.recurrentPayableOccurrence.update({
        where: { id: occ.id },
        data: {
          status: 'PAID',
          paidAmount: amount,
          paidAt: tx.postedAt,
          paymentMethod: payable.paymentMethod,
          bankTransactionId: tx.id,
          reconciledAt: new Date(),
        },
      });
      await this.writeOccurrenceMatch(tx, occ.id, amount, Number(updated.paidAmount));
      this.logger.log(
        `RecurrentPayable ${payable.name} ${occ.competence} auto-settled from tx ${tx.id} (R$${amount})`,
      );
      return 'settled';
    }

    // 2) No open occurrence — confirm the nearest already-PAID, not-yet-cleared
    // occurrence (manual baixa) without changing its amount.
    const paid = await this.prisma.recurrentPayableOccurrence.findMany({
      where: {
        recurrentPayableId: payable.id,
        status: 'PAID',
        bankTransactionId: null,
        dueDate: { gte: lo, lte: hi },
      },
    });
    if (paid.length > 0) {
      const occ = nearestByDate(paid, tx.postedAt);
      await this.prisma.recurrentPayableOccurrence.update({
        where: { id: occ.id },
        data: { bankTransactionId: tx.id, reconciledAt: new Date() },
      });
      await this.writeOccurrenceMatch(tx, occ.id, amount, Number(occ.paidAmount ?? amount));
      return 'confirmed';
    }

    return 'none';
  }

  /** Idempotently record the bank line that cleared this occurrence as a
   *  ReconciliationMatch on the recurrentOccurrence anchor. A value drift beyond
   *  tolerance (±R$2 / ±0.5%) is flagged (note + low confidence) so it surfaces
   *  as DISPUTED — the recurrent sweep no longer silently absorbs the diff. */
  private async writeOccurrenceMatch(
    tx: { id: string; amount: number | Prisma.Decimal },
    occurrenceId: string,
    debitAbs: number,
    assertedAmount: number,
  ): Promise<void> {
    const diff = Math.abs(debitAbs - assertedAmount);
    const tolerance = Math.max(2, assertedAmount * 0.005);
    const disputed = diff > tolerance;
    await this.prisma.reconciliationMatch
      .createMany({
        data: [
          {
            transactionId: tx.id,
            recurrentOccurrenceId: occurrenceId,
            allocatedAmount: new Prisma.Decimal(debitAbs),
            matchType: 'VALUE_DATE',
            confidenceScore: disputed ? 50 : 95,
            notes: disputed
              ? `Conciliação automática com divergência de valor: débito R$${debitAbs.toFixed(2)} vs. baixa R$${assertedAmount.toFixed(2)}.`
              : null,
          },
        ],
        skipDuplicates: true,
      })
      .catch(err => this.logger.warn(`Occurrence match write failed for tx ${tx.id}: ${err}`));
  }

  private async linkNf(
    payable: RecurrentPayable,
    fiscalDocumentId: string,
    issueDate: Date,
  ): Promise<boolean> {
    // Don't re-link an NF already attached to one of this payable's occurrences.
    const already = await this.prisma.recurrentPayableOccurrence.findFirst({
      where: { recurrentPayableId: payable.id, fiscalDocumentId },
      select: { id: true },
    });
    if (already) return false;

    await this.ensureOccurrencesAround(payable, issueDate);
    const w = RecurrentPayableService.MATCH_WINDOW_DAYS;
    const candidates = await this.prisma.recurrentPayableOccurrence.findMany({
      where: {
        recurrentPayableId: payable.id,
        fiscalDocumentId: null,
        dueDate: { gte: addDays(issueDate, -w), lte: addDays(issueDate, w) },
      },
    });
    if (candidates.length === 0) return false;
    const occ = nearestByDate(candidates, issueDate);
    await this.prisma.recurrentPayableOccurrence.update({
      where: { id: occ.id },
      data: { fiscalDocumentId, nfLinkedAt: new Date() },
    });
    this.logger.log(`RecurrentPayable ${payable.name} ${occ.competence} linked NF ${fiscalDocumentId}`);
    return true;
  }

  /** Start (SP) of the month `monthsBack-1` months before the current month. */
  private monthsAgoStart(monthsBack: number): Date {
    const monthStart = startOfMonthSaoPaulo(new Date());
    const sp = new Date(monthStart.getTime() + SP_OFFSET_MS);
    sp.setUTCMonth(sp.getUTCMonth() - Math.max(0, monthsBack - 1));
    return new Date(sp.getTime() - SP_OFFSET_MS);
  }
}
