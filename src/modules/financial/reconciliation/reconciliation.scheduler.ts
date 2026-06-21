import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ReconciliationStatus, ReconciliationSource } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import { ReconciliationClassifierService } from './reconciliation-classifier.service';
import { ReceivableMatchService } from './receivable-match.service';
import { PayableMatchService } from './payable-match.service';

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly matcher: ReconciliationMatcherService,
    private readonly classifier: ReconciliationClassifierService,
    private readonly receivableMatch: ReceivableMatchService,
    private readonly payableMatch: PayableMatchService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Daily rematch at 04:00 São Paulo time, one hour after the SIEG ingest job.
   * Skipped when RECONCILIATION_AUTO_MATCH_ENABLED=false.
   */
  @Cron('0 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDailyRematch(): Promise<void> {
    const enabled = this.config.get<boolean>('RECONCILIATION_AUTO_MATCH_ENABLED', true);
    if (!enabled) {
      this.logger.debug('Auto-match disabled; skipping daily rematch');
      return;
    }
    if (this.isRunning) {
      this.logger.warn('Daily rematch already running; skipping overlap');
      return;
    }
    this.isRunning = true;
    try {
      const lookback = this.config.get<number>('RECONCILIATION_LOOKBACK_DAYS', 90);
      const end = new Date();
      const start = new Date(end.getTime() - lookback * 86_400_000);
      const matched = await this.matcher.matchDateRange(start, end);
      // ENTRADA: also auto-conciliate incoming credits against open receivables.
      const inflowMatched = await this.receivableMatch.matchInflowDateRange(start, end);
      // BOLETO: bridge incoming boleto liquidations to their PAID slip (these
      // credits are skipped by both matchers above — see bridgeBoletoCredits).
      const bridged = await this.matcher.bridgeBoletoCredits({ start, end });
      // SAÍDA: confirm marked-paid payables against DEBITs (the import-time sweep
      // backstop). Gated by PAYABLE_AUTO_CONFIRM_ENABLED + paidAt-anchored, so a
      // wide lookback here cannot retroactively confirm history.
      const payableConfirmed = await this.payableMatch.confirmPayablesDateRange(start, end);
      this.logger.log(
        `Daily rematch: ${matched} saída-NF + ${inflowMatched} entrada + ${bridged} boleto-bridge + ${payableConfirmed} payable-confirm transactions auto-matched`,
      );
    } catch (err) {
      this.logger.error(`Daily rematch failed: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Self-improvement pass at 04:30 (after the rematch). Re-runs classification
   * over still-PENDING, non-MANUAL transactions so that as the learners
   * accumulate confirmations, transactions that were ABSTAIN/SUGGEST last week
   * cross the auto-apply threshold and get categorized this week. Idempotent:
   * RECONCILED and MANUAL rows are skipped, and re-deriving the same decision
   * upserts the same tag (a no-op write).
   */
  @Cron('30 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDailyReclassify(): Promise<void> {
    const enabled = this.config.get<boolean>('RECONCILIATION_AUTO_MATCH_ENABLED', true);
    if (!enabled) {
      this.logger.debug('Auto-match disabled; skipping daily reclassify');
      return;
    }
    try {
      const result = await this.classifier.classifyBatch({
        reconciliationStatus: ReconciliationStatus.PENDING,
        categorySource: { not: ReconciliationSource.MANUAL },
      });
      this.logger.log(
        `Daily reclassify: ${result.processed} processed, ${result.reconciled} auto-reconciled`,
      );
    } catch (err) {
      this.logger.error(`Daily reclassify failed: ${err}`);
    }
  }

  /**
   * Stale-paid aging alert at 05:00 BRT. Finds payables that were ASSERTED paid
   * (paidAt set, terminal status) but remain UNCLEARED — no non-reversed
   * ReconciliationMatch on their anchor — past PAYABLE_CONFIRMATION_STALE_DAYS
   * (≈2× the OFX upload cadence, default 7). These are "Pago · aguardando
   * conciliação" items that never got a confirming bank line, so a never-actually
   * -paid one stops looking identical to a real one forever. One summary
   * notification per run (not per item) to avoid spam.
   */
  @Cron('0 5 * * *', { timeZone: 'America/Sao_Paulo' })
  async runStalePaidAging(): Promise<void> {
    try {
      const staleDays = this.config.get<number>('PAYABLE_CONFIRMATION_STALE_DAYS', 7);
      const cutoff = new Date(Date.now() - staleDays * 86_400_000);

      const [orderInstallments, airbrushings, occurrences, payrolls] = await Promise.all([
        this.prisma.orderInstallment.count({
          where: {
            status: 'PAID',
            paidAt: { not: null, lt: cutoff },
            reconciliationMatches: { none: { reversedAt: null } },
          },
        }),
        this.prisma.airbrushing.count({
          where: {
            paymentStatus: 'PAID',
            paidAt: { not: null, lt: cutoff },
            reconciliationMatches: { none: { reversedAt: null } },
          },
        }),
        this.prisma.recurrentPayableOccurrence.count({
          where: {
            status: 'PAID',
            paidAt: { not: null, lt: cutoff },
            reconciliationMatches: { none: { reversedAt: null } },
          },
        }),
        this.prisma.payrollMonthSettlement.count({
          where: {
            paidAt: { not: null, lt: cutoff },
            reconciliationMatches: { none: { reversedAt: null } },
          },
        }),
      ]);

      const staleCount = orderInstallments + airbrushings + occurrences + payrolls;
      if (staleCount === 0) {
        this.logger.debug('Stale-paid aging: no unconfirmed paid payables');
        return;
      }

      this.logger.log(
        `Stale-paid aging: ${staleCount} paid-but-unconfirmed payable(s) older than ${staleDays}d ` +
          `(orders ${orderInstallments}, airbrushing ${airbrushings}, recorrentes ${occurrences}, folha ${payrolls})`,
      );

      await this.dispatchService
        .dispatchByConfiguration('payable.confirmation.stale', 'system', {
          entityType: 'Payable',
          entityId: 'stale-paid-aging',
          action: 'stale',
          data: {
            staleCount,
            staleDays,
            orderInstallments,
            airbrushings,
            occurrences,
            payrolls,
          },
          overrides: {
            title: 'Pagamentos sem conciliação',
            body: `${staleCount} pagamento(s) marcado(s) como pago(s) há mais de ${staleDays} dias ainda não foram conciliados com o extrato bancário. Importe o OFX ou revise as baixas.`,
            webUrl: `/financeiro/contas-a-pagar`,
            relatedEntityType: 'PAYABLE',
          },
        })
        .catch(err =>
          this.logger.error(`Falha ao notificar pagamentos sem conciliação: ${err}`),
        );
    } catch (err) {
      this.logger.error(`Stale-paid aging failed: ${err}`);
    }
  }
}
