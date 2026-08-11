/**
 * verify-bonus-period-integrity.ts — VERIFICAÇÃO SOMENTE-LEITURA
 *
 * Reproduz, período a período, a checagem de completude que o cron de
 * finalização faz — e mostra as DUAS direções da divergência:
 *
 *   FALTANDO  pessoa elegível no período sem linha `Bonus`
 *             (era o sintoma do bug do ChangeLog: quem tinha desconto de falta
 *              tinha a transação inteira revertida e sumia da folha em silêncio)
 *
 *   SOBRANDO  linha `Bonus` de quem a elegibilidade do período não reconhece
 *             (a lista mostrava N pessoas enquanto o divisor contava M < N)
 *
 * Verifica ainda que o divisor gravado em cada linha bate com o divisor
 * recalculado agora, e que todas as linhas do período carregam o mesmo.
 *
 *   cd api && npx tsx scripts/verify-bonus-period-integrity.ts
 *   cd api && npx tsx scripts/verify-bonus-period-integrity.ts 2026 8
 *
 * Sai com código 1 se algum período divergir.
 */

import { PrismaClient } from '@prisma/client';
import { BonusEligibilityService } from '../src/modules/personnel-department/bonus/bonus-eligibility.service';
import { neutralAbsenceService, ABSENCE_STUB_NOTICE } from './_bonus-absence-stub';

// O aviso é IMPRESSO, não só documentado: um divisor sem o eixo de afastamento
// pode divergir do real, e quem lê a saída precisa saber disso na hora.
console.log('\n' + ABSENCE_STUB_NOTICE);

const prisma = new PrismaClient();
const service = new BonusEligibilityService(prisma as never, neutralAbsenceService() as never);

/** Divisores gravados antes da v3 não existem — linha antiga não é divergência. */
const V3 = 'v3-proportional';

async function checkPeriod(year: number, month: number): Promise<boolean> {
  const el = await service.resolvePeriodEligibility(year, month);
  const rows = await prisma.bonus.findMany({
    where: { year, month },
    select: {
      userId: true,
      periodDivisor: true,
      calculationVersion: true,
      payrollId: true,
      user: { select: { name: true } },
    },
  });

  const savedIds = new Set(rows.map(r => r.userId));
  const expected = el.entries;
  const expectedIds = new Set(expected.map(e => e.userId));

  const missing = expected.filter(e => !savedIds.has(e.userId));
  const stray = rows.filter(r => !expectedIds.has(r.userId));

  const label = `${String(month).padStart(2, '0')}/${year}`;
  const v3Rows = rows.filter(r => r.calculationVersion?.startsWith(V3));
  const divisorMismatch = v3Rows.filter(
    r => r.periodDivisor != null && Math.abs(Number(r.periodDivisor) - el.divisor) > 0.0001,
  );
  const distinctDivisors = new Set(
    v3Rows.filter(r => r.periodDivisor != null).map(r => Number(r.periodDivisor).toFixed(4)),
  );

  const ok =
    missing.length === 0 &&
    stray.length === 0 &&
    divisorMismatch.length === 0 &&
    distinctDivisors.size <= 1;

  console.log(
    `${label}  salvos=${String(rows.length).padStart(2)}  elegíveis=${String(expected.length).padStart(2)}  ` +
      `divisor=${el.divisor.toFixed(4).padStart(8)}  ${ok ? '✔ bate' : '✗ DIVERGE'}`,
  );

  if (missing.length > 0) {
    console.log(`     FALTANDO (${missing.length}): ${missing.map(e => e.userName).join(', ')}`);
  }
  if (stray.length > 0) {
    console.log(
      `     SOBRANDO (${stray.length}): ` +
        stray.map(r => `${r.user?.name ?? r.userId}${r.payrollId ? ' [EM FOLHA]' : ''}`).join(', '),
    );
  }
  if (divisorMismatch.length > 0) {
    console.log(
      `     DIVISOR gravado ≠ recalculado em ${divisorMismatch.length} linha(s): ` +
        `${[...new Set(divisorMismatch.map(r => Number(r.periodDivisor).toFixed(4)))].join(', ')}`,
    );
  }
  if (distinctDivisors.size > 1) {
    console.log(`     DIVISORES diferentes na mesma folha: ${[...distinctDivisors].join(', ')}`);
  }

  return ok;
}

async function main(): Promise<void> {
  const [argYear, argMonth] = process.argv.slice(2).map(Number);

  const periods =
    argYear && argMonth
      ? [{ year: argYear, month: argMonth }]
      : (
          await prisma.bonus.findMany({
            distinct: ['year', 'month'],
            select: { year: true, month: true },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
          })
        ).map(r => ({ year: r.year, month: r.month }));

  console.log('\nIntegridade dos períodos de bonificação (lista × divisor)\n');

  let allOk = true;
  for (const p of periods) {
    const ok = await checkPeriod(p.year, p.month);
    allOk = allOk && ok;
  }

  console.log(
    `\n${allOk ? 'Todos os períodos batem.' : 'Há períodos divergentes — rode o recálculo do período.'}\n`,
  );
  if (!allOk) process.exitCode = 1;
}

main()
  .catch(err => {
    console.error('\nFalhou:', err instanceof Error ? err.stack : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
