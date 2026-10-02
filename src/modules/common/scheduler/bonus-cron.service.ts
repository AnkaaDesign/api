import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BonusService } from '../../personnel-department/bonus/bonus.service';
import { PayrollService } from '../../personnel-department/payroll/payroll.service';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';
import { BonusEligibilityService } from '../../personnel-department/bonus/bonus-eligibility.service';
import { getBonusPeriodCutoff } from '../../../utils/bonus';

/**
 * O que a finalização deve fazer com um período, dado o que já está gravado.
 *
 * Função pura (sem Nest, sem banco) para que a regra seja testável — ver
 * `tests/bonus-period-cutoff.test.ts`.
 *
 *   • `done`             — linhas completas e folha gerada: nada a fazer;
 *   • `payroll-only`     — linhas completas e frescas, falta só a folha;
 *   • `calculate`        — recalcula as linhas e, dando certo, gera a folha;
 *   • `blocked-payroll`  — a folha JÁ existe mas as linhas não batem (faltando,
 *                          sobrando ou gravadas antes do corte). Recalcular
 *                          agora faria `Bonus` divergir da `Payroll`, que já
 *                          leu `netBonus`. Decisão humana, nunca rotina.
 */
export type BonusFinalizationAction = 'done' | 'payroll-only' | 'calculate' | 'blocked-payroll';

export function decideBonusFinalization(input: {
  expectedCount: number;
  missingCount: number;
  strayCount: number;
  staleCount: number;
  payrollCount: number;
}): BonusFinalizationAction {
  const bonusesComplete =
    input.expectedCount > 0 &&
    input.missingCount === 0 &&
    input.strayCount === 0 &&
    input.staleCount === 0;
  if (input.payrollCount > 0) return bonusesComplete ? 'done' : 'blocked-payroll';
  return bonusesComplete ? 'payroll-only' : 'calculate';
}

@Injectable()
export class BonusCronService {
  private readonly logger = new Logger(BonusCronService.name);
  private readonly PREWARM_LOCK_KEY = 'bonus:prewarm:lock';
  private readonly PREWARM_LOCK_TTL_SEC = 25 * 60; // 25 min (< cron interval of 30 min)

  constructor(
    private readonly bonusService: BonusService,
    private readonly bonusEligibilityService: BonusEligibilityService,
    private readonly payrollService: PayrollService,
    private readonly cacheService: CacheService,
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  // Runs daily at 01:00 SP time.
  // Primary attempt: day 5 (payment day). Retry window: days 6–10.
  // After day 10 the window closes — the next period is already live.
  // Idempotent: skips each step that already has saved records for the period.
  @Cron('0 1 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleMonthlyBonusAndPayrollFinalization() {
    const now = new Date();
    const currentDay = now.getDate();

    // Only run within the retry window (5th = primary, 6th–10th = retries)
    if (currentDay < 5 || currentDay > 10) {
      this.logger.debug(
        `[FINALIZATION] Day ${currentDay} — outside save window (5–10). Skipping.`,
      );
      return;
    }

    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Target: previous calendar month (the period that closed on the 25th)
    let periodMonth = currentMonth - 1;
    let periodYear = currentYear;
    if (periodMonth === 0) {
      periodMonth = 12;
      periodYear = currentYear - 1;
    }

    const year = periodYear.toString();
    const month = periodMonth.toString().padStart(2, '0');
    const attempt = currentDay - 4; // attempt 1 = day 5, attempt 6 = day 10

    this.logger.log(
      `[FINALIZATION] Day ${currentDay} — attempt ${attempt}/6 for period ${year}/${month}`,
    );

    try {
      // Check what is already persisted for this period.
      //
      // A completude é comparada por CONJUNTO, não por contagem. Comparar
      // `count(Bonus) >= count(elegíveis agora)` dava falso-positivo assim que
      // alguém era desligado: 40 linhas gravadas contra 39 elegíveis restantes
      // marcava o período como "completo" e pulava o recálculo, mesmo faltando
      // a linha de um recém-contratado. E os dois lados nem eram o mesmo
      // conjunto — um filtrava `payrollNumber`, o outro `position.bonifiable`.
      const [savedBonuses, savedPayrollCount, expectedEligibility] = await Promise.all([
        this.prisma.bonus.findMany({
          where: { year: periodYear, month: periodMonth },
          select: { userId: true, updatedAt: true },
        }),
        this.prisma.payroll.count({ where: { year: periodYear, month: periodMonth } }),
        this.bonusEligibilityService.resolvePeriodEligibility(periodYear, periodMonth),
      ]);
      const savedBonusUserIds = new Set(savedBonuses.map(r => r.userId));

      const expectedUserIds = expectedEligibility.entries.map(e => e.userId);
      const expectedUserCount = expectedUserIds.length;
      const savedBonusCount = savedBonusUserIds.size;
      const expectedIdSet = new Set(expectedUserIds);
      const missingUserIds = expectedUserIds.filter(id => !savedBonusUserIds.has(id));
      // Sobra conta tanto quanto falta. Só olhar o que FALTA deixava o período
      // "completo" carregando linhas de gente que a elegibilidade do período já
      // não reconhece — a lista mostrava N pessoas e o divisor contava M < N.
      // `calculateAndSaveBonuses` poda essas linhas (as que não estão presas a
      // uma folha), então basta forçar o recálculo.
      const strayUserIds = [...savedBonusUserIds].filter(id => !expectedIdSet.has(id));

      // O CONJUNTO estar certo não basta: o VALOR também precisa ser do período
      // fechado. O fechamento no desligamento (`BonusTerminationListener`) grava
      // o período CORRENTE, ainda aberto — números que ainda vão mudar até o dia
      // 25. Se a completude olhasse só o conjunto, essas linhas passariam por
      // completas e o cron pularia o Step 1, congelando o bônus de TODA a folha
      // no valor que existia no dia da demissão.
      //
      // A trava é temporal: alguma linha gravada ANTES do CORTE obriga pelo
      // menos um recálculo depois dele.
      //
      // O corte é o dia 5, 00:00 de SP (`getBonusPeriodCutoff`) — NÃO o dia 25.
      // Com o dia 25, uma linha gravada entre o 26 e o 4 (recálculo manual,
      // listener de demissão/efetivação) passava por definitiva, o cron pulava
      // o Step 1 e a folha saía do valor daquele instante. Foi o que aconteceu
      // em 08/2026: linhas de 27/08 20:33, nível do Paulo Henrique mudado de 1
      // para 3 em 31/08, e a folha de 05/09 pagou o nível 1.
      const cutoff = getBonusPeriodCutoff(periodYear, periodMonth);
      if (now < cutoff) {
        // O cron roda à 01:00 do dia 5 em SP, depois do corte. Chegar aqui antes
        // dele é relógio/fuso errado — gravar agora congelaria um período que o
        // RH ainda está apurando.
        this.logger.error(
          `[FINALIZATION] Período ${year}/${month} ainda em apuração até ${cutoff.toISOString()} — ` +
            `nada gravado.`,
        );
        return;
      }
      const staleRows = savedBonuses.filter(r => r.updatedAt < cutoff);

      const action = decideBonusFinalization({
        expectedCount: expectedUserCount,
        missingCount: missingUserIds.length,
        strayCount: strayUserIds.length,
        staleCount: staleRows.length,
        payrollCount: savedPayrollCount,
      });

      if (staleRows.length > 0) {
        this.logger.warn(
          `[FINALIZATION] Período ${year}/${month}: ${staleRows.length} linha(s) Bonus ` +
            `gravada(s) antes do corte (${cutoff.toISOString()}) — ` +
            (action === 'blocked-payroll'
              ? 'mas a folha já existe (ver abaixo).'
              : 'recalculando com os números definitivos.'),
        );
      }

      if (missingUserIds.length > 0 && savedBonusCount > 0) {
        this.logger.warn(
          `[FINALIZATION] Período ${year}/${month}: ${missingUserIds.length} pessoa(s) do ` +
            `período sem linha Bonus — recalculando. ` +
            expectedEligibility.entries
              .filter(e => missingUserIds.includes(e.userId))
              .map(e => e.userName)
              .join(', '),
        );
      }

      if (strayUserIds.length > 0) {
        this.logger.warn(
          `[FINALIZATION] Período ${year}/${month}: ${strayUserIds.length} linha(s) Bonus ` +
            `fora do conjunto elegível do período — recalculando para podar.`,
        );
      }

      if (action === 'done') {
        this.logger.log(
          `[FINALIZATION] Period ${year}/${month} already complete` +
            ` (${savedBonusCount}/${expectedUserCount} bonuses, ${savedPayrollCount} payrolls). Nothing to do.`,
        );
        return;
      }

      // A FOLHA JÁ EXISTE e as linhas não batem. Antes, o cron recalculava o
      // Step 1 e pulava o Step 2 ("folha já gerada") — deixando `Bonus` com um
      // valor e `Payroll` (que copiou `netBonus`) com outro. Reescrever bônus
      // com folha pronta é decisão humana: reporta e para.
      if (action === 'blocked-payroll') {
        const detail =
          `Folha de ${month}/${year} já gerada (${savedPayrollCount}), mas as linhas de bônus ` +
          `não batem com o período: ${missingUserIds.length} faltando, ${strayUserIds.length} ` +
          `sobrando, ${staleRows.length} gravada(s) antes do corte. NADA foi recalculado ` +
          `automaticamente para não divergir da folha. Se for para corrigir, o RH decide e roda: ` +
          `pnpm bonus:recalc-period ${periodYear} ${periodMonth} (e regenera a folha).`;
        this.logger.error(`[FINALIZATION] ${detail}`);
        await this.notifyFinalization('failed', year, month, { stage: 'Bônus', detail });
        return;
      }

      // Step 1 — bonuses (skip only if all expected users already have fresh records)
      if (action === 'payroll-only') {
        this.logger.log(
          `[FINALIZATION] Step 1 already done (${savedBonusCount}/${expectedUserCount} bonuses). Skipping.`,
        );
      } else {
        this.logger.log(
          `[FINALIZATION] Step 1: Calculating and saving bonuses for ${year}/${month}` +
            ` (${savedBonusCount} existing / ${expectedUserCount} expected)...`,
        );
        // Sem `userId`: não existe pessoa por trás do cron. Passar a string
        // 'system' fazia o `ChangeLog` tentar `connect` num User inexistente e
        // derrubar a transação de CADA colaborador que tivesse desconto de
        // falta — 7 pessoas ficaram sem linha `Bonus` em 07/2026 por isso.
        const bonusResult = await this.bonusService.calculateAndSaveBonuses(year, month);
        this.logger.log(
          `[FINALIZATION] Bonuses: ${bonusResult.totalSuccess} ok, ${bonusResult.totalFailed} failed`,
        );
        if (bonusResult.totalFailed > 0) {
          this.logger.error(
            `[FINALIZATION] ${bonusResult.totalFailed} bonus failures — will retry tomorrow if within window`,
          );
          await this.notifyFinalization('failed', year, month, {
            stage: 'Bônus',
            detail: `${bonusResult.totalFailed} falha(s) no cálculo de bônus`,
          });
          return; // do not advance to payroll if bonuses are incomplete
        }
      }

      // Step 2 — payrolls (skip if already saved)
      if (savedPayrollCount > 0) {
        this.logger.log(
          `[FINALIZATION] Step 2 already done (${savedPayrollCount} payrolls). Skipping.`,
        );
      } else {
        this.logger.log(`[FINALIZATION] Step 2: Generating payrolls for ${year}/${month}...`);
        const payrollResult = await this.payrollService.generateForMonth(
          parseInt(year),
          parseInt(month),
          'system',
        );
        this.logger.log(
          `[FINALIZATION] Payrolls: ${payrollResult.created} created,` +
            ` ${payrollResult.skipped} skipped, ${payrollResult.errors?.length || 0} errors`,
        );
        if (payrollResult.errors && payrollResult.errors.length > 0) {
          this.logger.error('[FINALIZATION] Payroll errors:', payrollResult.errors);
          await this.notifyFinalization('failed', year, month, {
            stage: 'Folha de pagamento',
            detail: `${payrollResult.errors.length} erro(s) ao gerar a folha`,
          });
          return;
        }
      }

      this.logger.log(`[FINALIZATION] Period ${year}/${month} finalization complete.`);
      await this.notifyFinalization('succeeded', year, month, {
        detail: `Bônus e folha de pagamento do período ${month}/${year} finalizados.`,
      });
    } catch (error) {
      this.logger.error(
        `[FINALIZATION] Failed on attempt ${attempt}/6 — will retry tomorrow if within window`,
        error,
      );
      await this.notifyFinalization('failed', year, month, {
        detail: `Erro inesperado na finalização (tentativa ${attempt}/6): ${(error as Error)?.message || error}`,
      });
    }
  }

  /**
   * Emits payroll.finalization.succeeded / payroll.finalization.failed.
   * System-triggered; never throws (notification failures must not break the cron).
   */
  private async notifyFinalization(
    outcome: 'succeeded' | 'failed',
    year: string,
    month: string,
    opts: { stage?: string; detail: string },
  ): Promise<void> {
    try {
      const period = `${month}/${year}`;
      const isFailure = outcome === 'failed';
      await this.dispatchService.dispatchByConfiguration(
        `payroll.finalization.${outcome}`,
        'system',
        {
          entityType: 'Payroll',
          entityId: `${year}-${month}`,
          action: `finalization_${outcome}`,
          data: {
            period,
            year,
            month,
            stage: opts.stage,
            detail: opts.detail,
          },
          overrides: {
            webUrl: '/departamento-pessoal/folha-de-pagamento',
            mobileUrl: '/(tabs)/departamento-pessoal/folha-de-pagamento',
            relatedEntityType: 'PAYROLL',
            title: isFailure
              ? `Falha na finalização da folha (${period})`
              : `Folha de pagamento finalizada (${period})`,
            body: opts.detail,
          },
        },
      );
    } catch (err) {
      this.logger.error(
        `[FINALIZATION] Failed to dispatch payroll.finalization.${outcome} notification`,
        err as Error,
      );
    }
  }

  // Optional: Run a test calculation on demand (can be triggered manually)
  async runManualBonusCalculation(year: string, month: string, userId?: string) {
    this.logger.log(`Running manual bonus calculation for ${year}/${month}`);

    try {
      // Validate the period
      if (!year || !month) {
        throw new Error('Year and month are required for manual calculation');
      }

      // Log who triggered the manual calculation
      const triggeredBy = userId ? `user: ${userId}` : 'system';
      this.logger.log(`Manual bonus calculation triggered by ${triggeredBy}`);

      // Use calculateAndSaveBonuses which properly determines bonus status
      // `userId` só quando há gente de verdade por trás — ver comentário acima.
      const result = await this.bonusService.calculateAndSaveBonuses(year, month, userId);

      this.logger.log(
        `Manual bonus calculation completed for ${year}/${month}. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`,
      );

      return {
        success: true,
        data: result,
        message: `Cálculo manual de bônus concluído: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas`,
      };
    } catch (error) {
      this.logger.error('Failed to run manual bonus calculation', error);
      throw error;
    }
  }

  // Optional: Get next scheduled execution time
  getNextExecutionTime(): Date {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    let nextExecution: Date;

    // If we're before the 5th of this month, next execution is this month's 5th at 1 AM
    if (currentDay < 5) {
      nextExecution = new Date(currentYear, currentMonth, 5, 1, 0, 0);
    } else {
      // Otherwise, it's the 5th of next month
      nextExecution = new Date(currentYear, currentMonth + 1, 5, 1, 0, 0);
    }

    return nextExecution;
  }

  // Optional: Check if today is bonus/payroll calculation day
  isBonusCalculationDay(): boolean {
    const now = new Date();
    return now.getDate() === 5;
  }

  /**
   * Pre-warm the live-bonus SWR cache every 30 minutes during São Paulo working hours.
   *
   * Flow:
   * 1. Acquire a Redis lock (`bonus:prewarm:lock`, 25 min TTL) so parallel API instances
   *    don't all fan-out to Secullum at the same tick. If the lock exists, skip this run.
   * 2. Determine the current bonus period (26th-to-25th — the 5th-day rule pushes the
   *    period forward on day 6). We pre-warm only this period.
   * 3. Call `calculateLiveBonuses(year, month)` — the cache wrapper writes the result
   *    to Redis; any Secullum day-cache entries it touches are also warmed.
   * 4. On any error, log and release the lock on next expiration (do not rethrow — we
   *    don't want a pre-warm failure to page on-call).
   */
  @Cron('*/30 8-18 * * 1-5', { timeZone: 'America/Sao_Paulo' })
  async handleLiveBonusPrewarm() {
    // Cheap non-atomic lock: if key exists, another instance/tick already has it.
    // Not a strict mutex — worst case two instances both pre-warm for one tick.
    let alreadyLocked = false;
    try {
      alreadyLocked = await this.cacheService.exists(this.PREWARM_LOCK_KEY);
    } catch (err) {
      this.logger.warn(
        `[PREWARM] Failed to read lock key: ${(err as Error)?.message || err}. Proceeding anyway.`,
      );
    }
    if (alreadyLocked) {
      this.logger.debug('[PREWARM] Lock held by another instance/tick — skipping.');
      return;
    }

    try {
      await this.cacheService.set(this.PREWARM_LOCK_KEY, '1', this.PREWARM_LOCK_TTL_SEC);
    } catch (err) {
      this.logger.warn(
        `[PREWARM] Failed to set lock: ${(err as Error)?.message || err}. Aborting this tick.`,
      );
      return;
    }

    const startedAt = Date.now();
    const { year, month } = this.getCurrentBonusPeriod();

    this.logger.log(`[PREWARM] Starting live-bonus cache warm for ${year}/${month}`);

    try {
      const result = await this.bonusService.calculateLiveBonuses(year, month);
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[PREWARM] Completed ${year}/${month} in ${durationMs}ms — ` +
          `users=${result.bonuses?.length ?? 0} weightedTasks=${result.totalWeightedTasks}`,
      );
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[PREWARM] Failed for ${year}/${month} after ${durationMs}ms: ${(err as Error)?.message || err}`,
      );
      // Release the lock so the next tick can retry immediately.
      try {
        await this.cacheService.del(this.PREWARM_LOCK_KEY);
      } catch {
        /* best-effort — will expire via TTL */
      }
    }
  }

  /**
   * Current bonus period respects the 5th-day rule: days 1-5 still belong to the
   * previous period, days 6+ belong to the current calendar month.
   */
  private getCurrentBonusPeriod(): { year: number; month: number } {
    const now = new Date();
    const day = now.getDate();
    let month = now.getMonth() + 1;
    let year = now.getFullYear();
    if (day <= 5) {
      month = month - 1;
      if (month === 0) {
        month = 12;
        year = year - 1;
      }
    }
    return { year, month };
  }
}
