/**
 * preview-bonus-period.ts — SÓ LEITURA. Não grava nada.
 *
 * Mostra a elegibilidade de um período com os DOIS eixos separados (vínculo e
 * afastamento) e compara o divisor resultante com o que está gravado nas linhas
 * `Bonus`. É o jeito de conferir o efeito de uma mudança de regra antes de
 * deixar o cron gravar.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/preview-bonus-period.ts 2026 8
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { BonusEligibilityService } from '../modules/personnel-department/bonus/bonus-eligibility.service';

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

async function main(): Promise<void> {
  const [yearArg, monthArg] = process.argv.slice(2);
  const year = Number(yearArg);
  const month = Number(monthArg);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Uso: preview-bonus-period.ts <ano> <mês 1-12>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const prisma = app.get(PrismaService);
    const eligibility = app.get(BonusEligibilityService);

    // `skipAbsenceCache` para ver o estado de AGORA, não o de até 30 min atrás.
    const p = await eligibility.resolvePeriodEligibility(year, month, { skipAbsenceCache: true });

    const saved = await prisma.bonus.findMany({
      where: { year, month },
      select: {
        userId: true,
        eligibilityWeight: true,
        periodDivisor: true,
        netBonus: true,
        updatedAt: true,
        user: { select: { name: true } },
      },
    });
    const savedByUser = new Map(saved.map(s => [s.userId, s]));

    console.log(`\n${'='.repeat(112)}`);
    console.log(
      `PERÍODO ${String(month).padStart(2, '0')}/${year}  ` +
        `${p.periodStart.toISOString().slice(0, 10)} → ${p.periodEnd.toISOString().slice(0, 10)}  ` +
        `(${p.periodBusinessDays} dias úteis)`,
    );
    console.log(
      `afastamento medido: ${p.absenceDataAvailable ? 'SIM' : `NÃO — ${p.absenceError}`}`,
    );
    console.log('='.repeat(112));

    console.log(
      `\n${pad('COLABORADOR', 36)}${padL('nv', 3)}${padL('dias', 6)}${padL('temporal', 10)}` +
        `${padL('afast', 7)}${padL('fator', 8)}${padL('PESO', 8)}${padL('peso salvo', 12)}  motivo`,
    );
    console.log('-'.repeat(112));

    for (const e of [...p.entries].sort((a, b) => a.userName.localeCompare(b.userName))) {
      const s = savedByUser.get(e.userId);
      const savedW = s ? Number(s.eligibilityWeight).toFixed(4) : '—';
      const changed = s && Math.abs(Number(s.eligibilityWeight) - e.weight) > 1e-4 ? ' *' : '';
      console.log(
        pad(e.userName.slice(0, 35), 36) +
          padL(e.performanceLevel, 3) +
          padL(e.eligibleDays, 6) +
          padL(e.temporalWeight.toFixed(4), 10) +
          padL(e.absentDays > 0 ? e.absentDays : '—', 7) +
          padL(e.absenceFactor.toFixed(4), 8) +
          padL(e.weight.toFixed(4), 8) +
          padL(savedW + changed, 12) +
          '  ' +
          e.reason +
          (e.absenceMeasured ? '' : ' [não medido]'),
      );
    }

    if (p.fullyAbsent.length > 0) {
      console.log('\nFORA DO CÁLCULO POR AFASTAMENTO INTEGRAL (somem da lista):');
      for (const f of p.fullyAbsent) {
        const s = savedByUser.get(f.userId);
        console.log(
          `  ${pad(f.userName.slice(0, 35), 36)}${padL(f.absentDays, 6)} dias afastado` +
            (s ? `   — tem linha salva de R$ ${Number(s.netBonus).toFixed(2)}, será podada` : ''),
        );
      }
    }

    const savedDivisor = saved[0]?.periodDivisor;
    console.log('\n' + '-'.repeat(112));
    console.log(
      `DIVISOR novo: ${p.divisor.toFixed(4)}   |   gravado hoje: ` +
        `${savedDivisor != null ? Number(savedDivisor).toFixed(4) : '—'}   |   ` +
        `pessoas: ${p.entries.length} (${p.entries.filter(e => e.performanceLevel > 0).length} no divisor)`,
    );
    const strays = saved.filter(s => !p.byUserId.has(s.userId));
    if (strays.length > 0) {
      console.log(
        `LINHAS ÓRFÃS (existem no banco, fora do conjunto elegível): ` +
          strays.map(s => s.user?.name ?? s.userId).join(', '),
      );
    }
    console.log('-'.repeat(112) + '\n');
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
