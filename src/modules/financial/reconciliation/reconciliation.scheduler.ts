import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ReconciliationStatus, ReconciliationSource } from '@prisma/client';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import { ReconciliationClassifierService } from './reconciliation-classifier.service';
import { ReceivableMatchService } from './receivable-match.service';

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly matcher: ReconciliationMatcherService,
    private readonly classifier: ReconciliationClassifierService,
    private readonly receivableMatch: ReceivableMatchService,
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
      this.logger.log(
        `Daily rematch: ${matched} saída + ${inflowMatched} entrada + ${bridged} boleto-bridge transactions auto-matched`,
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
}
