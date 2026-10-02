/**
 * Guarda do CORTE do período de bonificação (aberto × fechado).
 *
 * Em 08/2026 as linhas `Bonus` foram gravadas em 27/08 (entre o 26 e o dia 5,
 * com o RH ainda apurando). O cron do dia 5 considerava "fresca" qualquer linha
 * gravada depois do dia 25, pulou o recálculo e a folha saiu do valor de 27/08:
 * o nível do Paulo Henrique, mudado de 1 para 3 em 31/08, não entrou.
 *
 * A regra que este arquivo protege:
 *  · o período fecha no dia 5 do mês seguinte, 00:00 de SP — um INSTANTE;
 *  · antes disso o vivo vence a linha salva; a partir dele, a linha é a verdade;
 *  · o cron recalcula toda linha gravada antes do corte, e NUNCA recalcula
 *    bônus depois que a folha existe (bônus ≠ folha é pior que bônus velho).
 *
 * Rodar: npx tsx tests/bonus-period-cutoff.test.ts
 */

import {
  getBonusPeriodCutoff,
  isBonusPeriodOpen,
  usesBonusCutoffRule,
} from '../src/utils/bonus';
import { decideBonusFinalization } from '../src/modules/common/scheduler/bonus-cron.service';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\no corte é dia 5 do mês seguinte, 00:00 de SP');
{
  const c = getBonusPeriodCutoff(2026, 9);
  check('09/2026 → 2026-10-05T03:00Z', c.toISOString() === '2026-10-05T03:00:00.000Z', c.toISOString());
  const dez = getBonusPeriodCutoff(2026, 12);
  check('12/2026 vira janeiro do ano seguinte', dez.toISOString() === '2027-01-05T03:00:00.000Z', dez.toISOString());
  const jan = getBonusPeriodCutoff(2027, 1);
  check('01/2027 → 2027-02-05T03:00Z', jan.toISOString() === '2027-02-05T03:00:00.000Z', jan.toISOString());
}

console.log('\naberto até o fim do dia 4, fechado a partir de 00:00 do dia 5 (SP)');
{
  check('04/10 23:59:59 SP → 09 aberto', isBonusPeriodOpen(2026, 9, new Date('2026-10-04T23:59:59.999-03:00')));
  check('05/10 00:00 SP → 09 fechado', !isBonusPeriodOpen(2026, 9, new Date('2026-10-05T00:00:00.000-03:00')));
  check('05/10 01:00 SP (cron) → 09 fechado', !isBonusPeriodOpen(2026, 9, new Date('2026-10-05T01:00:00-03:00')));
  // O bug B: no dia 5 à tarde a regra UTC ainda chamava 09 de "corrente".
  check('05/10 15:00 SP → 09 fechado', !isBonusPeriodOpen(2026, 9, new Date('2026-10-05T15:00:00-03:00')));
  check('28/09 → 09 aberto (em apuração)', isBonusPeriodOpen(2026, 9, new Date('2026-09-28T12:00:00-03:00')));
  check('28/09 → 10 também aberto (já começou)', isBonusPeriodOpen(2026, 10, new Date('2026-09-28T12:00:00-03:00')));
  check('20/09 → 10 ainda não começou', !isBonusPeriodOpen(2026, 10, new Date('2026-09-20T12:00:00-03:00')));
  check('04/01/2027 23:59 SP → 12/2026 aberto', isBonusPeriodOpen(2026, 12, new Date('2027-01-04T23:59:00-03:00')));
  check('05/01/2027 00:00 SP → 12/2026 fechado', !isBonusPeriodOpen(2026, 12, new Date('2027-01-05T00:00:00-03:00')));
  check('30/12/2026 → 01/2027 aberto', isBonusPeriodOpen(2027, 1, new Date('2026-12-30T12:00:00-03:00')));
}

console.log('\nhistória paga não é reclassificada');
{
  check('08/2026 fica na regra antiga', !usesBonusCutoffRule(2026, 8));
  check('09/2026 usa o corte', usesBonusCutoffRule(2026, 9));
  check('01/2027 usa o corte', usesBonusCutoffRule(2027, 1));
  check('12/2025 fica na regra antiga', !usesBonusCutoffRule(2025, 12));
}

console.log('\ndecisão do cron de finalização');
{
  const base = { expectedCount: 20, missingCount: 0, strayCount: 0, staleCount: 0, payrollCount: 0 };
  check('sem folha, linhas frescas → só a folha', decideBonusFinalization(base) === 'payroll-only');
  // O caso 08/2026: 18 linhas de 27/08, antes do corte.
  check(
    'sem folha, linhas de antes do corte → recalcula',
    decideBonusFinalization({ ...base, staleCount: 18 }) === 'calculate',
  );
  check('sem folha, faltando gente → recalcula', decideBonusFinalization({ ...base, missingCount: 1 }) === 'calculate');
  check('sem folha, sobrando gente → recalcula', decideBonusFinalization({ ...base, strayCount: 1 }) === 'calculate');
  check('ninguém esperado → recalcula', decideBonusFinalization({ ...base, expectedCount: 0 }) === 'calculate');
  check('folha + linhas certas → nada', decideBonusFinalization({ ...base, payrollCount: 21 }) === 'done');
  check(
    'folha + linhas de antes do corte → BLOQUEIA (nunca recalcula)',
    decideBonusFinalization({ ...base, payrollCount: 21, staleCount: 3 }) === 'blocked-payroll',
  );
  check(
    'folha + faltando gente → BLOQUEIA',
    decideBonusFinalization({ ...base, payrollCount: 21, missingCount: 1 }) === 'blocked-payroll',
  );
}

console.log(failures === 0 ? '\nTUDO CERTO\n' : `\n${failures} FALHA(S)\n`);
process.exit(failures === 0 ? 0 : 1);
