import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecurrentPayable, RecurrentPayableOccurrence } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CreateRecurrentPayableDto, UpdateRecurrentPayableDto } from './dto/recurrent-payable.dto';

/** São Paulo is UTC-3 year-round (no DST since 2019). */
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

function startOfDaySaoPaulo(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  sp.setUTCHours(0, 0, 0, 0);
  return new Date(sp.getTime() - SP_OFFSET_MS);
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
        occurrences: { orderBy: { competence: 'desc' }, take: 12 },
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
        categoryId: dto.categoryId,
        amountKind: dto.amountKind,
        fixedAmount: dto.fixedAmount ?? null,
        estimatedAmount: dto.estimatedAmount ?? null,
        frequency: dto.frequency,
        frequencyCount: dto.frequencyCount,
        dueDayOfMonth: dto.dueDayOfMonth,
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

    const data: Prisma.RecurrentPayableUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.supplierId !== undefined)
      data.supplier = dto.supplierId
        ? { connect: { id: dto.supplierId } }
        : { disconnect: true };
    if (dto.payeeName !== undefined) data.payeeName = dto.payeeName;
    if (dto.categoryId !== undefined) data.category = { connect: { id: dto.categoryId } };
    if (dto.amountKind !== undefined) data.amountKind = dto.amountKind;
    if (dto.fixedAmount !== undefined) data.fixedAmount = dto.fixedAmount;
    if (dto.estimatedAmount !== undefined) data.estimatedAmount = dto.estimatedAmount;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.frequencyCount !== undefined) data.frequencyCount = dto.frequencyCount;
    if (dto.dueDayOfMonth !== undefined) data.dueDayOfMonth = dto.dueDayOfMonth;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.expectsNf !== undefined) data.expectsNf = dto.expectsNf;
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
      // Re-activating with no pending nextRun resumes materialization.
      if (dto.isActive && !existing.nextRun) data.nextRun = startOfDaySaoPaulo(new Date());
      if (!dto.isActive) data.nextRun = null;
    }

    const updated = await this.prisma.recurrentPayable.update({ where: { id }, data });
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

  /** Competence (YYYY-MM, SP time) a date falls in. */
  competenceOf(d: Date): string {
    return competenceOf(d);
  }

  /** Advances a payable's nextRun to the start of the next cycle's month. */
  computeNextRun(payable: Pick<RecurrentPayable, 'frequency' | 'frequencyCount'>, from: Date): Date {
    const months = monthsForFrequency(payable.frequency, payable.frequencyCount);
    const monthStart = startOfMonthSaoPaulo(from);
    const sp = new Date(monthStart.getTime() + SP_OFFSET_MS);
    sp.setUTCMonth(sp.getUTCMonth() + months);
    return new Date(sp.getTime() - SP_OFFSET_MS);
  }

  /** Idempotently materialize the occurrence for a competence. Safe to call from
   *  both the cron and the reconciliation bridge (unique [payableId, competence]). */
  async materializeOccurrence(
    payable: RecurrentPayable,
    competence: string,
  ): Promise<RecurrentPayableOccurrence> {
    const existing = await this.prisma.recurrentPayableOccurrence.findUnique({
      where: { recurrentPayableId_competence: { recurrentPayableId: payable.id, competence } },
    });
    if (existing) return existing;

    const estimatedAmount = await this.computeEstimate(payable);
    const dueDate = dueDateForCompetence(competence, payable.dueDayOfMonth);
    try {
      return await this.prisma.recurrentPayableOccurrence.create({
        data: {
          recurrentPayableId: payable.id,
          competence,
          dueDate,
          estimatedAmount,
          status: 'PENDING',
          expectsNf: payable.expectsNf,
          paymentMethod: payable.paymentMethod,
        },
      });
    } catch (err) {
      // Lost a race with the cron/bridge — return the now-existing row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.recurrentPayableOccurrence.findUniqueOrThrow({
          where: { recurrentPayableId_competence: { recurrentPayableId: payable.id, competence } },
        });
      }
      throw err;
    }
  }

  /** FIXED → known amount; VARIABLE → seed estimate or 3-month bank average. */
  private async computeEstimate(payable: RecurrentPayable): Promise<number> {
    if (payable.amountKind === 'FIXED') {
      return Number(payable.fixedAmount ?? payable.estimatedAmount ?? 0);
    }
    if (payable.estimatedAmount != null) return Number(payable.estimatedAmount);
    return this.threeMonthAverage(payable.categoryId);
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
  // Read for PayablesService
  // ---------------------------------------------------------------------------

  /** Ensures every active payable has a materialized occurrence for the
   *  competence (lazy materialization so the Contas a Pagar row is always
   *  actionable even before the cron runs), and returns the occurrence + parent
   *  for the unified feed. */
  async ensureCurrentOccurrenceRows(competence: string): Promise<
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
      const occurrence = await this.materializeOccurrence(payable, competence);
      rows.push({ occurrence, payable });
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Reconciliation bridges (daily sweep — catches BOTH manual category
  // assignment on the extrato AND auto-classified OFX imports, idempotently.
  // The instant manual path is markOccurrencePaid; this closes the loop
  // automatically without invasive wiring into the reconciliation hot path.)
  // ---------------------------------------------------------------------------

  /** Sweep: settle PENDING occurrences whose linked category received a tagged
   *  bank DEBIT in the competence. Returns how many occurrences were settled. */
  async reconcilePendingFromBank(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    const payables = await this.prisma.recurrentPayable.findMany({ where: { isActive: true } });
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
        if (await this.applyBankSettlement(payable, tx)) settled++;
      }
    }
    if (settled) this.logger.log(`Recurrent-payable bank sweep: ${settled} occurrence(s) settled`);
    return settled;
  }

  /** Sweep: link inbound (ENTRADA) NFs to occurrences of expectsNf payables by
   *  supplier CNPJ + competence. Returns how many NFs were linked. */
  async linkPendingNfs(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    const payables = await this.prisma.recurrentPayable.findMany({
      where: { isActive: true, expectsNf: true, supplier: { cnpj: { not: null } } },
      include: { supplier: { select: { cnpj: true } } },
    });
    let linked = 0;
    for (const payable of payables) {
      const cnpj = payable.supplier?.cnpj;
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
  ): Promise<boolean> {
    const competence = competenceOf(tx.postedAt);
    const occ = await this.materializeOccurrence(payable, competence);
    const amount = Math.abs(Number(tx.amount));

    if (occ.status === 'PENDING') {
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
        `RecurrentPayable ${payable.name} ${competence} auto-settled from tx ${tx.id} (R$${amount})`,
      );
      return true;
    }
    // Already PAID (manual baixa): confirm/link without touching the amount, and
    // record the bank line as the clearance.
    if (!occ.bankTransactionId) {
      await this.prisma.recurrentPayableOccurrence.update({
        where: { id: occ.id },
        data: { bankTransactionId: tx.id, reconciledAt: new Date() },
      });
    }
    await this.writeOccurrenceMatch(tx, occ.id, amount, Number(occ.paidAmount ?? amount));
    return false;
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
    const competence = competenceOf(issueDate);
    const occ = await this.materializeOccurrence(payable, competence);
    if (occ.fiscalDocumentId) return false; // already linked
    await this.prisma.recurrentPayableOccurrence.update({
      where: { id: occ.id },
      data: { fiscalDocumentId, nfLinkedAt: new Date() },
    });
    this.logger.log(`RecurrentPayable ${payable.name} ${competence} linked NF ${fiscalDocumentId}`);
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
