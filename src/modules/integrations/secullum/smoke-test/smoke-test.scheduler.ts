import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SecullumSmokeTestService } from './smoke-test.service';
import { SmokeTrigger } from './smoke-test.types';

/**
 * Schedules the Secullum integration health-check at 06:00 and 12:00 (BRT).
 * Both crons delegate to the same service run. A re-entrancy lock (with a
 * stale-lock release) prevents overlapping runs — a single end-to-end smoke
 * test can take tens of seconds.
 */
@Injectable()
export class SecullumSmokeTestScheduler {
  private readonly logger = new Logger(SecullumSmokeTestScheduler.name);

  private isProcessing = false;
  private processingStartedAt: number | null = null;
  private readonly MAX_RUN_MS = 10 * 60 * 1000; // 10 min — release a hung lock

  constructor(private readonly service: SecullumSmokeTestService) {}

  @Cron('0 6 * * *', { timeZone: 'America/Sao_Paulo' })
  async runAtSix(): Promise<void> {
    // The fechamento/apuração checks leave undeletable apurações, so they run only
    // once a month: on the 25th (the day before the real cartão-ponto closing).
    const isClosingEve = this.saoPauloDayOfMonth() === 25;
    // Notify on the morning run only — the daily diagnostic result.
    await this.runScheduled(isClosingEve, true);
  }

  @Cron('0 12 * * *', { timeZone: 'America/Sao_Paulo' })
  async runAtNoon(): Promise<void> {
    // Never run apuração at noon — the 06:00 run on the 25th already covered it.
    // No notification at noon (the morning run already sent the daily result).
    await this.runScheduled(false, false);
  }

  private async runScheduled(includeApuracao: boolean, notify: boolean): Promise<void> {
    if (this.isProcessing) {
      const elapsed = Date.now() - (this.processingStartedAt ?? 0);
      if (elapsed < this.MAX_RUN_MS) {
        this.logger.warn('Smoke test already in progress, skipping this run');
        return;
      }
      this.logger.error(`Smoke test lock held for ${Math.round(elapsed / 1000)}s — releasing stale lock`);
    }
    await this.execute('SCHEDULED', null, includeApuracao, notify);
  }

  /**
   * Manual trigger (admin endpoint). Does not notify (the operator sees the result
   * in the UI immediately). apuração opt-in is controlled by the caller.
   */
  async triggerManualRun(triggeredById: string | null, includeApuracao = false): Promise<{ runId: string }> {
    return this.execute('MANUAL', triggeredById, includeApuracao, false);
  }

  /** The day-of-month in America/Sao_Paulo (the server runs UTC). */
  private saoPauloDayOfMonth(): number {
    const s = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', day: '2-digit' });
    return parseInt(s, 10);
  }

  private async execute(trigger: SmokeTrigger, triggeredById: string | null, includeApuracao: boolean, notify: boolean): Promise<{ runId: string }> {
    this.isProcessing = true;
    this.processingStartedAt = Date.now();
    try {
      this.logger.log(`Starting Secullum smoke test (${trigger}, apuracao=${includeApuracao}, notify=${notify})`);
      const result = await this.service.runSmokeTest(trigger, triggeredById, { includeApuracao, notify });
      this.logger.log(`Secullum smoke test ${trigger} completed: run ${result.runId}`);
      return result;
    } finally {
      this.isProcessing = false;
      this.processingStartedAt = null;
    }
  }
}
