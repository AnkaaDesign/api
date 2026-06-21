import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReconciliationMatchType, ReconciliationSource, ReconciliationStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskQuoteStatusCascadeService } from '@modules/production/task-quote/task-quote-status-cascade.service';
import { nameSimilarity } from './text-normalization';

/** How far apart (days) a credit's postedAt and an installment's dueDate may be
 *  for an automatic receivable match. Wider than the boleto bridge — non-boleto
 *  receipts (PIX/TED) are paid early or late far more loosely than boletos. */
const RECEIVABLE_WINDOW_DAYS = 20;
const AMOUNT_TOLERANCE = 0.05;

/** Auto-match boundary (0-100 confidence), mirroring the saída NF matcher's
 *  threshold + runner-up gap discipline. A UNIQUE exact-value candidate always
 *  auto-matches (value+date is already strong); when several exact-value
 *  candidates compete, the winner must clear the bar AND beat the runner-up by
 *  the gap (disambiguated by counterparty CNPJ/name + date proximity). */
const AUTO_SCORE_THRESHOLD = 80;
const AUTO_RUNNER_UP_GAP = 15;

/** Open installment statuses an incoming receipt may settle. */
const OPEN_INSTALLMENT_STATUSES = ['PENDING', 'PROCESSING', 'OVERDUE'] as const;

/** Slug of the service-revenue category every reconciled receivable receipt is
 *  tagged with, so the entrada side carries an accounting classification (the
 *  inflow analog of the saída's NF-item-derived categories). Seeded by migration
 *  20260621100100_seed_service_revenue_category. */
const SERVICE_REVENUE_CATEGORY_SLUG = 'receita-servicos';

const onlyDigits = (v: string | null | undefined): string => (v || '').replace(/\D/g, '');

type RawCredit = {
  id: string;
  postedAt: Date;
  amount: Prisma.Decimal | number;
  type: string;
  counterpartyName: string | null;
  counterpartyCnpjCpf?: string | null;
};

/** A candidate installment enriched with its customer identity for scoring, plus
 *  the task/invoice context the manual UI renders (mirrors the NF candidate card). */
type ScoredCandidate = {
  id: string;
  amount: number;
  /** Already-received amount (partial allocations). */
  paidAmount: number;
  /** Outstanding balance = amount − paidAmount, what a new credit can settle. */
  remaining: number;
  invoiceId: string | null;
  dueDate: Date;
  number: number;
  /** Installment status (PENDING / OVERDUE / PARTIAL …) for the UI badge. */
  status: string;
  customerName: string | null;
  customerCnpjCpf: string | null;
  /** 0-100 fused confidence (value + date proximity + CNPJ + name). */
  confidence: number;
  /** Task-quote context (faturamento detail target) — null for non-task receivables. */
  taskId: string | null;
  taskName: string | null;
  taskSerialNumber: string | null;
  /** Total NF/invoice value + how many parcelas it has, for the card. */
  invoiceTotal: number | null;
  totalInstallments: number | null;
};

/**
 * ENTRADA conciliation — the inflow analog of the saída NF matcher.
 *
 * Our receivables live in Invoice → Installment (task quotes, external
 * operations, customer configs). Sicredi boletos WE issue already reconcile
 * through the BankSlip bridge (`onBankSlipPaid`). This service closes the
 * remaining gap: it matches incoming bank CREDITs (PIX/TED/cash) against open
 * NON-boleto installments, marks them paid, recalculates the invoice and
 * cascades the task-quote status — exactly what the Sicredi webhook does for
 * boletos. Conservative auto-match (unique value+date), with a manual path for
 * the Contas a Receber UI.
 */
@Injectable()
export class ReceivableMatchService {
  private readonly logger = new Logger(ReceivableMatchService.name);
  /** Memoized id of the service-revenue category (slug never changes). */
  private serviceRevenueCategoryId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
  ) {}

  /** Resolve (and cache) the seeded service-revenue category id. Returns null if
   *  the seed migration hasn't run, so tagging degrades gracefully. */
  private async resolveServiceRevenueCategoryId(
    db: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (this.serviceRevenueCategoryId) return this.serviceRevenueCategoryId;
    const cat = await db.transactionCategory.findUnique({
      where: { slug: SERVICE_REVENUE_CATEGORY_SLUG },
      select: { id: true },
    });
    this.serviceRevenueCategoryId = cat?.id ?? null;
    return this.serviceRevenueCategoryId;
  }

  /** Tag a reconciled CREDIT with the service-revenue category (idempotent), so
   *  the entrada carries an accounting classification just like a saída derives
   *  one from its NF items. `allocatedAmount` is the share settled by this credit.
   *  Always AUTO — the tag is derived from the match, not a hand-picked category,
   *  so every unmatch path that drops AUTO tags cleans it up automatically. */
  private async tagServiceRevenue(
    db: Prisma.TransactionClient,
    transactionId: string,
    allocatedAmount: Prisma.Decimal,
  ): Promise<void> {
    const categoryId = await this.resolveServiceRevenueCategoryId(db);
    if (!categoryId) return;
    await db.bankTransactionCategory.upsert({
      where: { transactionId_categoryId: { transactionId, categoryId } },
      create: {
        transactionId,
        categoryId,
        source: ReconciliationSource.AUTO,
        allocatedAmount,
      },
      update: { allocatedAmount, source: ReconciliationSource.AUTO },
    });
  }

  /** Drop the service-revenue tag when an inflow match is reversed. */
  private async untagServiceRevenue(
    db: Prisma.TransactionClient,
    transactionId: string,
  ): Promise<void> {
    const categoryId = await this.resolveServiceRevenueCategoryId(db);
    if (!categoryId) return;
    await db.bankTransactionCategory.deleteMany({ where: { transactionId, categoryId } });
  }

  // ---------------------------------------------------------------------------
  // Auto-match scan (driven by the reconciliation scheduler)
  // ---------------------------------------------------------------------------

  async matchInflowAll(): Promise<number> {
    return this.matchInflowWhere({});
  }

  async matchInflowDateRange(start: Date, end: Date): Promise<number> {
    return this.matchInflowWhere({ postedAt: { gte: start, lte: end } });
  }

  /** Match a specific set of credits — used on OFX import so incoming PIX/TED
   *  receipts auto-conciliate immediately (parity with the saída matcher), not
   *  only at the 04:00 daily cron. */
  async matchInflowByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.matchInflowWhere({ id: { in: ids } });
  }

  private async matchInflowWhere(extra: Prisma.BankTransactionWhereInput): Promise<number> {
    const credits = await this.prisma.bankTransaction.findMany({
      where: {
        type: 'CREDIT',
        reconciliationStatus: ReconciliationStatus.PENDING,
        bankSlipId: null, // boletos go through the Sicredi bridge
        ...extra,
      },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        type: true,
        counterpartyName: true,
        counterpartyCnpjCpf: true,
      },
    });
    let matched = 0;
    for (const credit of credits) {
      try {
        if (await this.tryReceivableInstallmentMatch(credit)) matched += 1;
      } catch (err) {
        this.logger.error(`Inflow match failed for tx ${credit.id}: ${err}`);
      }
    }
    return matched;
  }

  /**
   * Auto-match a CREDIT against an open installment. Conservative but smarter
   * than the old "exactly one value+date candidate": a unique exact-value
   * candidate still auto-matches, and when several exact-value installments
   * compete they're disambiguated by counterparty CNPJ/name + date proximity —
   * auto-applying only on a clear winner (score ≥ threshold, gap ≥ runner-up).
   * When no auto-match is made, the best candidate's confidence is stamped on
   * the transaction (topMatchScore) so the extrato shows "Pendente · N%".
   */
  private async tryReceivableInstallmentMatch(tx: RawCredit): Promise<boolean> {
    // Live status guard — a sibling pass may have reconciled it already.
    const live = await this.prisma.bankTransaction.findUnique({
      where: { id: tx.id },
      select: { reconciliationStatus: true },
    });
    if (!live || live.reconciliationStatus !== ReconciliationStatus.PENDING) return false;

    const candidates = await this.findScoredCandidates(tx, { exactValueOnly: true });

    if (candidates.length === 0) {
      await this.stampTopScore(tx.id, null);
      return false;
    }

    const [best, runnerUp] = candidates;
    const isUnique = candidates.length === 1;
    const clearWinner =
      best.confidence >= AUTO_SCORE_THRESHOLD &&
      (!runnerUp || best.confidence - runnerUp.confidence >= AUTO_RUNNER_UP_GAP);

    if (isUnique || clearWinner) {
      await this.settleInstallment(tx, best.id, ReconciliationSource.AUTO, undefined, best.confidence);
      this.logger.log(
        `Inflow tx ${tx.id} auto-matched to installment ${best.id} (conf ${best.confidence}${isUnique ? ', unique' : ''})`,
      );
      return true;
    }

    // Ambiguous → leave for manual, but surface how close the best one is.
    await this.stampTopScore(tx.id, best.confidence);
    return false;
  }

  private async stampTopScore(transactionId: string, score: number | null): Promise<void> {
    await this.prisma.bankTransaction
      .update({ where: { id: transactionId }, data: { topMatchScore: score } })
      .catch(() => undefined);
  }

  /**
   * Find open installments for a credit and score each 0-100 by value exactness,
   * due-date proximity, counterparty CNPJ and counterparty name similarity. The
   * single source of candidate confidence for BOTH the auto path and the manual
   * UI (so the panel never shows a score the auto path silently can't act on).
   */
  private async findScoredCandidates(
    tx: { postedAt: Date; amount: Prisma.Decimal | number; counterpartyName?: string | null; counterpartyCnpjCpf?: string | null },
    opts: { exactValueOnly: boolean; windowDays?: number },
  ): Promise<ScoredCandidate[]> {
    const abs = Math.abs(Number(tx.amount));
    const windowDays = opts.windowDays ?? RECEIVABLE_WINDOW_DAYS;
    const lower = new Date(tx.postedAt.getTime() - windowDays * 86_400_000);
    const upper = new Date(tx.postedAt.getTime() + windowDays * 86_400_000);

    const amountFilter: Prisma.DecimalFilter = opts.exactValueOnly
      ? { gte: abs - AMOUNT_TOLERANCE, lte: abs + AMOUNT_TOLERANCE }
      : { gt: 0 };

    const installments = await this.prisma.installment.findMany({
      where: {
        status: { in: OPEN_INSTALLMENT_STATUSES as unknown as Prisma.EnumInstallmentStatusFilter['in'] },
        bankSlip: null, // boleto installments settle via the Sicredi bridge
        amount: amountFilter,
        dueDate: { gte: lower, lte: upper },
        // Auto path: never touch an installment that already has a live match.
        // Manual path: open-but-partially-allocated installments (status still
        // PENDING/OVERDUE, balance remaining) stay eligible so the operator can
        // top them up via allocate — only fully-settled (PAID) ones drop out,
        // and those are already excluded by the open-status filter above.
        ...(opts.exactValueOnly ? { reconciliationMatches: { none: { reversedAt: null } } } : {}),
      },
      include: {
        invoice: {
          select: {
            customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
            taskId: true,
            totalAmount: true,
            task: { select: { id: true, name: true, serialNumber: true } },
            _count: { select: { installments: true } },
          },
        },
        customerConfig: {
          select: {
            customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
            quote: { select: { task: { select: { id: true, name: true, serialNumber: true } } } },
          },
        },
        externalOperation: { select: { customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } } } },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    const txCnpj = onlyDigits(tx.counterpartyCnpjCpf);
    return installments
      .map(inst => {
        const customer =
          inst.invoice?.customer ?? inst.customerConfig?.customer ?? inst.externalOperation?.customer ?? null;
        const amount = Number(inst.amount);
        const paidAmount = Number(inst.paidAmount ?? 0);
        const remaining = Math.max(0, amount - paidAmount);
        const customerCnpjCpf = onlyDigits(customer?.cnpj ?? customer?.cpf ?? null) || null;
        const customerName = customer?.fantasyName ?? customer?.corporateName ?? null;
        // Task-quote context: prefer the invoice's task, else the customerConfig's
        // quote task (TASK_QUOTE receivables without a materialized invoice).
        const task = inst.invoice?.task ?? inst.customerConfig?.quote?.task ?? null;
        // Score against the outstanding balance so a partially-paid installment
        // surfaced in the manual path scores on what the credit can still settle.
        const confidence = this.scoreCandidate({
          txAbs: abs,
          txPostedAt: tx.postedAt,
          txName: tx.counterpartyName ?? null,
          txCnpj,
          instAmount: remaining > 0 ? remaining : amount,
          instDueDate: inst.dueDate,
          custName: customerName,
          custCnpj: customerCnpjCpf,
        });
        return {
          id: inst.id,
          amount,
          paidAmount,
          remaining,
          invoiceId: inst.invoiceId,
          dueDate: inst.dueDate,
          number: inst.number,
          status: inst.status,
          customerName,
          customerCnpjCpf,
          confidence,
          taskId: task?.id ?? inst.invoice?.taskId ?? null,
          taskName: task?.name ?? null,
          taskSerialNumber: task?.serialNumber ?? null,
          invoiceTotal: inst.invoice?.totalAmount != null ? Number(inst.invoice.totalAmount) : null,
          totalInstallments: inst.invoice?._count?.installments ?? null,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Fuse value, date proximity, counterparty CNPJ and name into a 0-100 score. */
  private scoreCandidate(p: {
    txAbs: number;
    txPostedAt: Date;
    txName: string | null;
    txCnpj: string;
    instAmount: number;
    instDueDate: Date;
    custName: string | null;
    custCnpj: string | null;
  }): number {
    // Value (max 50): exact dominates; near-value degrades.
    const diff = Math.abs(p.instAmount - p.txAbs);
    let value: number;
    if (diff <= AMOUNT_TOLERANCE) value = 50;
    else {
      const ratio = p.txAbs > 0 ? diff / p.txAbs : 1;
      value = ratio <= 0.01 ? 38 : ratio <= 0.02 ? 28 : ratio <= 0.05 ? 16 : ratio <= 0.1 ? 8 : 0;
    }

    // Date proximity (max 20).
    const days = Math.abs(p.instDueDate.getTime() - p.txPostedAt.getTime()) / 86_400_000;
    const date = days <= 2 ? 20 : days <= 5 ? 16 : days <= 10 ? 12 : days <= 20 ? 8 : days <= 40 ? 4 : 1;

    // Counterparty CNPJ/CPF (max 25) — exact identity is the strongest signal.
    const cnpj = p.txCnpj && p.custCnpj && p.txCnpj === p.custCnpj ? 25 : 0;

    // Counterparty name similarity (max 15).
    const sim = nameSimilarity(p.txName, p.custName);
    const name = sim >= 0.8 ? 15 : sim >= 0.5 ? 10 : sim > 0 ? 5 : 0;

    return Math.min(100, Math.round(value + date + cnpj + name));
  }

  // ---------------------------------------------------------------------------
  // Manual match (Contas a Receber UI)
  // ---------------------------------------------------------------------------

  /** Open installments offered as candidates for a CREDIT in the manual UI.
   *  Uses the SAME scorer as the auto path (value + date + CNPJ + name) over a
   *  wide value/date window, so the confidence the operator sees is the one the
   *  auto path acts on — no more "90% shown but never auto-matched". */
  async getReceivableCandidates(transactionId: string) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true, counterpartyName: true, counterpartyCnpjCpf: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') throw new BadRequestException('Conciliação de entrada requer um crédito.');

    const candidates = await this.findScoredCandidates(tx, { exactValueOnly: false, windowDays: 60 });
    const installmentCandidates = candidates.map(c => ({
      installmentId: c.id,
      number: c.number,
      amount: c.amount,
      paidAmount: c.paidAmount,
      remaining: c.remaining,
      dueDate: c.dueDate,
      status: c.status,
      customerName: c.customerName,
      invoiceId: c.invoiceId,
      confidence: c.confidence,
      taskId: c.taskId,
      taskName: c.taskName,
      taskSerialNumber: c.taskSerialNumber,
      invoiceTotal: c.invoiceTotal,
      totalInstallments: c.totalInstallments,
      // Direct (PIX/TED) installment match — no boleto involved.
      bankSlipId: null as string | null,
      viaBankSlip: false,
    }));

    // Boleto receivables WE issued that are already PAID (Sicredi liquidation) but
    // whose bank-statement credit hasn't been linked yet. The auto bridge only acts
    // on a unique value+date hit; surfacing them here lets the operator confirm the
    // bank line manually — and is what makes a boleto reappear as a candidate after
    // its bridge is undone (the installment stays PAID, so it is invisible to the
    // open-installment finder above).
    const boletoCandidates = await this.findBoletoCandidates(tx);

    // Same installment can't appear twice; boletos are keyed by their own slip.
    return [...installmentCandidates, ...boletoCandidates].sort((a, b) => b.confidence - a.confidence);
  }

  /** Unlinked PAID boletos as manual conciliation candidates (the operator's path
   *  for what the auto bridge couldn't uniquely resolve). Scored by value + date +
   *  counterparty, mirroring the installment scorer. */
  private async findBoletoCandidates(tx: {
    postedAt: Date;
    amount: Prisma.Decimal | number;
    counterpartyName?: string | null;
    counterpartyCnpjCpf?: string | null;
  }) {
    const abs = Math.abs(Number(tx.amount));
    // Value band tolerant of boleto juros/multa/desconto drift; date band wide
    // since the operator reviews each one.
    const valuePad = Math.max(5, abs * 0.05);
    const windowMs = 90 * 86_400_000;
    const lower = new Date(tx.postedAt.getTime() - windowMs);
    const upper = new Date(tx.postedAt.getTime() + windowMs);
    const txCnpj = onlyDigits(tx.counterpartyCnpjCpf);

    const slips = await this.prisma.bankSlip.findMany({
      where: {
        status: 'PAID',
        transactions: { none: {} }, // not yet linked to a bank credit
        paidAmount: { gte: abs - valuePad, lte: abs + valuePad },
        OR: [{ paidAt: { gte: lower, lte: upper } }, { paidAt: null }],
      },
      select: {
        id: true,
        paidAmount: true,
        paidAt: true,
        dueDate: true,
        installment: {
          select: {
            id: true,
            number: true,
            amount: true,
            dueDate: true,
            status: true,
            invoiceId: true,
            invoice: {
              select: {
                taskId: true,
                totalAmount: true,
                customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
                task: { select: { id: true, name: true, serialNumber: true } },
                _count: { select: { installments: true } },
              },
            },
            customerConfig: {
              select: {
                customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
                quote: { select: { task: { select: { id: true, name: true, serialNumber: true } } } },
              },
            },
            externalOperation: {
              select: { customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } } },
            },
          },
        },
      },
      take: 50,
    });

    return slips
      .filter(s => s.installment != null)
      .map(s => {
        const inst = s.installment!;
        const customer =
          inst.invoice?.customer ?? inst.customerConfig?.customer ?? inst.externalOperation?.customer ?? null;
        const task = inst.invoice?.task ?? inst.customerConfig?.quote?.task ?? null;
        const paid = Number(s.paidAmount ?? inst.amount);
        const confidence = this.scoreCandidate({
          txAbs: abs,
          txPostedAt: tx.postedAt,
          txName: tx.counterpartyName ?? null,
          txCnpj,
          instAmount: paid,
          instDueDate: s.paidAt ?? s.dueDate ?? inst.dueDate,
          custName: customer?.fantasyName ?? customer?.corporateName ?? null,
          custCnpj: onlyDigits(customer?.cnpj ?? customer?.cpf ?? null) || null,
        });
        return {
          installmentId: inst.id,
          number: inst.number,
          amount: paid,
          paidAmount: 0,
          remaining: paid,
          dueDate: inst.dueDate,
          status: inst.status,
          customerName: customer?.fantasyName ?? customer?.corporateName ?? null,
          invoiceId: inst.invoiceId,
          confidence,
          taskId: task?.id ?? inst.invoice?.taskId ?? null,
          taskName: task?.name ?? null,
          taskSerialNumber: task?.serialNumber ?? null,
          invoiceTotal: inst.invoice?.totalAmount != null ? Number(inst.invoice.totalAmount) : null,
          totalInstallments: inst.invoice?._count?.installments ?? null,
          // Boleto bridge: matching this candidate links the credit to the boleto,
          // it does NOT re-settle the (already paid) installment.
          bankSlipId: s.id,
          viaBankSlip: true,
        };
      });
  }

  async manualMatchInstallment(transactionId: string, installmentId: string, userId?: string) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true, counterpartyName: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') throw new BadRequestException('Conciliação de entrada requer um crédito.');

    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      select: {
        id: true,
        status: true,
        reconciliationMatches: { where: { reversedAt: null }, select: { id: true } },
        bankSlip: { select: { id: true, status: true, transactions: { select: { id: true }, take: 1 } } },
      },
    });
    if (!installment) throw new NotFoundException('Parcela a receber não encontrada.');
    if (installment.reconciliationMatches.length > 0) {
      throw new BadRequestException('Esta parcela já está conciliada.');
    }

    // Boleto receivable already PAID (Sicredi) with no bank line linked yet: link
    // the credit to the boleto (bridge) instead of re-settling the installment.
    const slip = installment.bankSlip;
    if (slip && slip.status === 'PAID') {
      if (slip.transactions.length > 0) {
        throw new BadRequestException('Este boleto já está conciliado a outra transação.');
      }
      await this.settleViaBoletoBridge(tx, slip.id, userId);
      return { success: true, message: 'Recebimento conciliado ao boleto com sucesso.' };
    }

    await this.settleInstallment(tx, installmentId, ReconciliationSource.MANUAL, userId);
    return { success: true, message: 'Recebimento conciliado com sucesso.' };
  }

  /** Manually link a credit to an already-PAID boleto (mirror of the auto bridge).
   *  The installment was settled by the Sicredi webhook, so this only attaches the
   *  bank line + tags the entrada — it never touches the installment/invoice. */
  private async settleViaBoletoBridge(
    tx: { id: string; amount: Prisma.Decimal | number },
    bankSlipId: string,
    userId?: string,
  ): Promise<void> {
    const abs = new Decimal(Math.abs(Number(tx.amount)));
    await this.prisma.$transaction(async db => {
      await db.reconciliationMatch.create({
        data: {
          transactionId: tx.id,
          bankSlipId,
          allocatedAmount: abs,
          matchType: ReconciliationMatchType.BANK_SLIP_BRIDGE,
          confidenceScore: 100,
          matchedByUserId: userId ?? null,
        },
      });
      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          bankSlipId,
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.MANUAL,
          topMatchScore: null,
          expectsFiscalDocument: true,
        },
      });
      await this.tagServiceRevenue(db, tx.id, abs);
    });
  }

  /**
   * Manual partial / multi allocation: settle one credit across one or more
   * installments with explicit amounts — a lump PIX paying several parcelas, or
   * a partial payment of a single installment. The auto path stays conservative
   * (exact-value only); this is the operator's escape hatch for everything else.
   *
   * Each allocation accrues onto the installment's paidAmount; the installment
   * flips to PAID once fully covered, otherwise stays open (rendered as
   * PARTIALLY_RECEIVED). The credit is RECONCILED when fully allocated, else PARTIAL.
   */
  async allocateInflow(
    transactionId: string,
    allocations: { installmentId: string; amount: number }[],
    userId?: string,
  ) {
    if (!allocations?.length) throw new BadRequestException('Informe ao menos uma alocação.');

    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') throw new BadRequestException('Conciliação de entrada requer um crédito.');

    const creditAbs = new Decimal(Math.abs(Number(tx.amount)));
    const totalAlloc = allocations.reduce((s, a) => s.add(new Decimal(a.amount)), new Decimal(0));
    if (totalAlloc.lte(0)) throw new BadRequestException('Valor alocado deve ser maior que zero.');
    if (totalAlloc.gt(creditAbs.add(AMOUNT_TOLERANCE))) {
      throw new BadRequestException('A soma das alocações excede o valor do crédito.');
    }

    // Validate every installment up front (exists, open, unmatched, amount fits).
    const ids = allocations.map(a => a.installmentId);
    const installments = await this.prisma.installment.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        invoiceId: true,
        status: true,
      },
    });
    const byId = new Map(installments.map(i => [i.id, i]));
    for (const a of allocations) {
      const inst = byId.get(a.installmentId);
      if (!inst) throw new NotFoundException('Parcela a receber não encontrada.');
      // Allow topping up a partially-allocated installment; only a fully
      // settled (PAID) parcela is off-limits. The remaining-balance check below
      // (computed from paidAmount) prevents over-allocation.
      if (inst.status === 'PAID') {
        throw new BadRequestException('Uma das parcelas já está totalmente conciliada.');
      }
      const remaining = new Decimal(inst.amount).sub(inst.paidAmount ?? new Decimal(0));
      if (new Decimal(a.amount).lte(0)) throw new BadRequestException('Cada alocação deve ser positiva.');
      if (new Decimal(a.amount).gt(remaining.add(AMOUNT_TOLERANCE))) {
        throw new BadRequestException('Alocação excede o saldo em aberto da parcela.');
      }
    }

    const invoiceIds = new Set<string>();
    await this.prisma.$transaction(async db => {
      for (const a of allocations) {
        const inst = byId.get(a.installmentId)!;
        const newPaid = new Decimal(inst.paidAmount ?? 0).add(new Decimal(a.amount));
        const fullyPaid = newPaid.gte(new Decimal(inst.amount).sub(AMOUNT_TOLERANCE));
        await db.installment.update({
          where: { id: inst.id },
          data: {
            paidAmount: newPaid,
            status: fullyPaid ? 'PAID' : inst.status,
            paidAt: fullyPaid ? tx.postedAt : null,
          },
        });
        await db.reconciliationMatch.create({
          data: {
            transactionId: tx.id,
            installmentId: inst.id,
            allocatedAmount: new Decimal(a.amount),
            matchType: ReconciliationMatchType.MANUAL,
            confidenceScore: 100,
            matchedByUserId: userId ?? null,
          },
        });
        if (inst.invoiceId) invoiceIds.add(inst.invoiceId);
      }
      for (const invoiceId of invoiceIds) await this.recalcInvoice(db, invoiceId);
      const fullyAllocated = totalAlloc.gte(creditAbs.sub(AMOUNT_TOLERANCE));
      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: fullyAllocated ? ReconciliationStatus.RECONCILED : ReconciliationStatus.PARTIAL,
          reconciliationSource: ReconciliationSource.MANUAL,
          topMatchScore: null,
        },
      });
      await this.tagServiceRevenue(db, tx.id, totalAlloc);
    });

    // Cascade by installment so customerConfig/externalOperation-anchored
    // receivables (no invoice) also flow up to their source-entity status.
    for (const a of allocations) {
      await this.cascadeService.cascadeFromInstallment(a.installmentId).catch(() => undefined);
    }
    return { success: true, message: 'Recebimento alocado com sucesso.' };
  }

  /** Reverse an inflow match (mirrors the saída unmatch). Two shapes:
   *  - Direct installment match (PIX/TED): reopen the installment + recompute the
   *    invoice (the match itself is what marked it received).
   *  - Boleto-bridge match (OFX credit ↔ bankSlip, installmentId null): the boleto
   *    was settled by the Sicredi webhook independently, so unlinking only detaches
   *    the bank line (clear bankSlipId) — the installment stays PAID.
   *  Either way the transaction goes back to PENDING and its service-revenue tag drops. */
  async unmatchInflow(transactionId: string) {
    const matches = await this.prisma.reconciliationMatch.findMany({
      where: { transactionId, reversedAt: null, installmentId: { not: null } },
      select: { id: true, installmentId: true },
    });
    // Boleto-bridge links (credit ↔ bankSlip, no installmentId) — detached, not reopened.
    const bridgeMatches = await this.prisma.reconciliationMatch.findMany({
      where: { transactionId, reversedAt: null, installmentId: null, bankSlipId: { not: null } },
      select: { id: true },
    });
    if (matches.length === 0 && bridgeMatches.length === 0) {
      throw new BadRequestException('Nenhuma conciliação de entrada para reverter.');
    }

    const now = new Date();
    await this.prisma.$transaction(async db => {
      // Delete this transaction's matches first (NOT soft-reverse): the
      // (transactionId, installmentId) unique index counts reversed rows, so
      // soft-reversing would 500 when the operator re-matches the same credit to
      // the same installment after fixing a mistake. Hard delete mirrors the
      // saída unmatch and frees the slot. Each affected installment's paidAmount
      // is then recomputed from its remaining matches, so a credit that only
      // partially paid an installment leaves the other credits' shares intact.
      await db.reconciliationMatch.deleteMany({
        where: { id: { in: [...matches.map(m => m.id), ...bridgeMatches.map(m => m.id)] } },
      });

      const installmentIds = [...new Set(matches.map(m => m.installmentId!).filter(Boolean))];
      for (const installmentId of installmentIds) {
        const inst = await db.installment.findUnique({
          where: { id: installmentId },
          select: { id: true, amount: true, dueDate: true, invoiceId: true },
        });
        if (!inst) continue;
        const remaining = await db.reconciliationMatch.findMany({
          where: { installmentId, reversedAt: null },
          select: { allocatedAmount: true },
        });
        const paid = remaining.reduce((s, r) => s.add(r.allocatedAmount), new Decimal(0));
        const fullyPaid = paid.gte(new Decimal(inst.amount).sub(AMOUNT_TOLERANCE));
        await db.installment.update({
          where: { id: installmentId },
          data: {
            paidAmount: paid,
            status: fullyPaid ? 'PAID' : inst.dueDate < now ? 'OVERDUE' : 'PENDING',
            paidAt: fullyPaid ? inst.dueDate : null,
          },
        });
        if (inst.invoiceId) {
          await this.recalcInvoice(db, inst.invoiceId);
        }
      }
      await this.untagServiceRevenue(db, transactionId);

      await db.bankTransaction.update({
        where: { id: transactionId },
        data: {
          reconciliationStatus: ReconciliationStatus.PENDING,
          reconciliationSource: null,
          // Detach the boleto bridge link too (no-op for direct installment matches,
          // whose transactions never carry a bankSlipId).
          bankSlipId: null,
        },
      });
    });

    // Cascade by installment so non-invoice (customerConfig/externalOperation)
    // receivables reopen their source-entity status too.
    for (const installmentId of [...new Set(matches.map(m => m.installmentId!).filter(Boolean))]) {
      await this.cascadeService.cascadeFromInstallment(installmentId).catch(() => undefined);
    }
    return { success: true, message: 'Conciliação de entrada revertida.' };
  }

  // ---------------------------------------------------------------------------
  // Shared settlement (mirror of the Sicredi webhook's liquidation cascade)
  // ---------------------------------------------------------------------------

  private async settleInstallment(
    tx: { id: string; postedAt: Date; amount: Prisma.Decimal | number },
    installmentId: string,
    source: ReconciliationSource,
    userId?: string,
    confidence?: number,
  ): Promise<void> {
    const abs = new Decimal(Math.abs(Number(tx.amount)));
    let invoiceId: string | null = null;

    await this.prisma.$transaction(async db => {
      const installment = await db.installment.findUniqueOrThrow({
        where: { id: installmentId },
        select: { id: true, amount: true, invoiceId: true },
      });
      invoiceId = installment.invoiceId;

      await db.installment.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paidAmount: installment.amount,
          paidAt: tx.postedAt,
        },
      });

      await db.reconciliationMatch.create({
        data: {
          transactionId: tx.id,
          installmentId,
          allocatedAmount: abs,
          matchType: source === ReconciliationSource.MANUAL ? ReconciliationMatchType.MANUAL : ReconciliationMatchType.VALUE_DATE,
          confidenceScore: source === ReconciliationSource.MANUAL ? 100 : (confidence ?? 95),
          matchedByUserId: userId ?? null,
        },
      });

      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: source,
          topMatchScore: null,
        },
      });

      await this.tagServiceRevenue(db, tx.id, abs);

      if (invoiceId) await this.recalcInvoice(db, invoiceId);
    });

    // Cascade source-entity status outside the transaction (same as the webhook).
    // Cascade by installment, not invoice: non-boleto receivables can hang
    // directly off a customerConfig/externalOperation with no invoice.
    await this.cascadeService.cascadeFromInstallment(installmentId).catch(() => undefined);
  }

  /** Recompute an invoice's paidAmount + status from its installments. Copied
   *  from SicrediWebhookService.recalculateInvoice to keep one behavior. */
  private async recalcInvoice(db: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.status === 'CANCELLED') return;
    const installments = await db.installment.findMany({ where: { invoiceId } });
    const totalPaid = installments.reduce(
      (sum, inst) => sum.add(inst.paidAmount ?? new Decimal(0)),
      new Decimal(0),
    );
    const status = totalPaid.gte(invoice.totalAmount)
      ? 'PAID'
      : totalPaid.gt(0)
        ? 'PARTIALLY_PAID'
        : 'ACTIVE';
    await db.invoice.update({ where: { id: invoiceId }, data: { paidAmount: totalPaid, status } });
  }
}
