import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly matcher: ReconciliationMatcherService,
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
      this.logger.log(`Daily rematch: ${matched} transactions auto-matched`);
    } catch (err) {
      this.logger.error(`Daily rematch failed: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }
}
