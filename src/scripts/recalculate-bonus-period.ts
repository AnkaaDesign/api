/**
 * recalculate-bonus-period.ts
 *
 * Recalcula e regrava um período de bonificação inteiro pelo MESMO caminho que
 * o cron usa (`BonusService.calculateAndSaveBonuses`), sem esperar a janela do
 * dia 5 ao 10.
 *
 * Serve para reaplicar o divisor proporcional em períodos já gravados com a
 * versão antiga (v2-logistic), e para podar linhas que não pertencem mais ao
 * conjunto elegível do período.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/recalculate-bonus-period.ts 2026 7
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { BonusService } from '../modules/personnel-department/bonus/bonus.service';
import { BonusEligibilityService } from '../modules/personnel-department/bonus/bonus-eligibility.service';
import { PrismaService } from '../modules/common/prisma/prisma.service';

const log = new Logger('recalculate-bonus-period');

async function main(): Promise<void> {
  const [yearArg, monthArg] = process.argv.slice(2);
  const year = Number(yearArg);
  const month = Number(monthArg);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Uso: recalculate-bonus-period.ts <ano> <mês 1-12>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const bonusService = app.get(BonusService);
    const eligibilityService = app.get(BonusEligibilityService);

    const before = await prisma.bonus.findMany({
      where: { year, month },
      select: { userId: true, netBonus: true, calculationVersion: true },
    });
    const eligibility = await eligibilityService.resolvePeriodEligibility(year, month);

    log.log(
      `ANTES: ${before.length} linha(s), versão ${before[0]?.calculationVersion ?? '—'}, ` +
        `total R$ ${before.reduce((s, b) => s + Number(b.netBonus), 0).toFixed(2)}`,
    );
    log.log(
      `Elegíveis do período: ${eligibility.entries.length} pessoa(s), ` +
        `divisor ${eligibility.divisor.toFixed(4)} (${eligibility.periodBusinessDays} dias úteis)`,
    );

    const result = await bonusService.calculateAndSaveBonuses(
      String(year),
      String(month).padStart(2, '0'),
    );

    const after = await prisma.bonus.findMany({
      where: { year, month },
      select: { userId: true, netBonus: true, calculationVersion: true, eligibilityWeight: true },
    });

    log.log(
      `DEPOIS: ${after.length} linha(s), versão ${after[0]?.calculationVersion ?? '—'}, ` +
        `total R$ ${after.reduce((s, b) => s + Number(b.netBonus), 0).toFixed(2)} ` +
        `(${result.totalSuccess} ok, ${result.totalFailed} falhas)`,
    );

    if (result.totalFailed > 0) {
      log.error('Houve falhas por colaborador — veja o log acima antes de considerar fechado.');
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch(err => {
  log.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
