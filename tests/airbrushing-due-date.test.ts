/**
 * Guarda do vencimento da aerografia — `resolveAirbrushingDueDate`.
 *
 * O vencimento deixou de ser um prazo fixo de 7 dias calculado em memória e
 * passou a ser configurável POR aerografia (N dias após o término, dia fixo do
 * mês, ou data escolhida à mão), materializado em `Airbrushing.dueDate` a cada
 * escrita. Contas a Pagar só lê a coluna.
 *
 * O que este arquivo protege:
 *
 *  1. COMPATIBILIDADE. Uma aerografia que nunca configurou nada tem de vencer
 *     exatamente onde vencia antes — término + 7 dias às 18:00 de São Paulo
 *     (21:00 UTC). É o mesmo instante que o backfill da migração gravou nas
 *     linhas antigas; divergir aqui moveria centenas de vencimentos.
 *
 *  2. DATA DE CALENDÁRIO ≠ INSTANTE. A referência é a data-calendário do
 *     término EM SÃO PAULO. Um término às 23:00 de 10/08 em SP é 02:00 de 11/08
 *     em UTC — contar a partir do dia UTC erraria o vencimento em um dia, o
 *     mesmo erro que originou `due-date.test.ts`.
 *
 *  3. A VIRADA DO DIA FIXO. "Vence todo dia 30" tem de escolher o PRÓXIMO dia 30
 *     em/depois do término, e truncar ao último dia nos meses curtos — senão
 *     fevereiro produziria 30/02, que o JS silenciosamente vira 01/03 ou 02/03.
 *
 * Rodar: npx tsx tests/airbrushing-due-date.test.ts
 */

import {
  AIRBRUSHING_DEFAULT_PAYMENT_TERM_DAYS,
  resolveAirbrushingDueDate,
} from '../src/utils/airbrushing';
import { AIRBRUSHING_DUE_DATE_RULE } from '../src/constants/enums';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Instante → "YYYY-MM-DD HH:mm" em São Paulo, que é como o usuário lê a data. */
function inSaoPaulo(d: Date | null): string {
  if (!d) return 'null';
  const date = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const time = d.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} ${time}`;
}

const DAYS = AIRBRUSHING_DUE_DATE_RULE.DAYS_AFTER_FINISH;
const MONTH_DAY = AIRBRUSHING_DUE_DATE_RULE.DAY_OF_MONTH;
const FIXED = AIRBRUSHING_DUE_DATE_RULE.FIXED_DATE;

console.log('\n▶ DAYS_AFTER_FINISH');
{
  // Término 10/08/2026 12:00 SP.
  const finish = new Date('2026-08-10T15:00:00.000Z');

  const legacy = resolveAirbrushingDueDate({}, finish);
  check(
    `sem configuração usa o prazo histórico de ${AIRBRUSHING_DEFAULT_PAYMENT_TERM_DAYS} dias às 18:00 SP`,
    inSaoPaulo(legacy) === '2026-08-17 18:00',
    inSaoPaulo(legacy),
  );

  const threeDays = resolveAirbrushingDueDate(
    { dueDateRule: DAYS, paymentTermDays: 3 },
    finish,
  );
  check(
    '"3 dias após o término" vence em 13/08',
    inSaoPaulo(threeDays) === '2026-08-13 18:00',
    inSaoPaulo(threeDays),
  );

  const sameDay = resolveAirbrushingDueDate(
    { dueDateRule: DAYS, paymentTermDays: 0 },
    finish,
  );
  check(
    'prazo 0 vence no próprio dia do término',
    inSaoPaulo(sameDay) === '2026-08-10 18:00',
    inSaoPaulo(sameDay),
  );

  // 23:00 SP de 10/08 = 02:00 UTC de 11/08. Contar pelo dia UTC daria 14/08.
  const lateNight = new Date('2026-08-11T02:00:00.000Z');
  const fromLateNight = resolveAirbrushingDueDate(
    { dueDateRule: DAYS, paymentTermDays: 3 },
    lateNight,
  );
  check(
    'término tarde da noite conta pelo dia de SÃO PAULO, não pelo dia UTC',
    inSaoPaulo(fromLateNight) === '2026-08-13 18:00',
    inSaoPaulo(fromLateNight),
  );

  const overMonth = resolveAirbrushingDueDate(
    { dueDateRule: DAYS, paymentTermDays: 30 },
    new Date('2026-08-25T15:00:00.000Z'),
  );
  check(
    'prazo que atravessa o mês normaliza sozinho',
    inSaoPaulo(overMonth) === '2026-09-24 18:00',
    inSaoPaulo(overMonth),
  );

  check(
    'sem término não há vencimento',
    resolveAirbrushingDueDate({ dueDateRule: DAYS, paymentTermDays: 3 }, null) === null,
  );
}

console.log('\n▶ DAY_OF_MONTH');
{
  const beforeTheDay = resolveAirbrushingDueDate(
    { dueDateRule: MONTH_DAY, dueDayOfMonth: 30 },
    new Date('2026-08-10T15:00:00.000Z'), // 10/08 SP
  );
  check(
    'término antes do dia escolhido vence no MESMO mês',
    inSaoPaulo(beforeTheDay) === '2026-08-30 18:00',
    inSaoPaulo(beforeTheDay),
  );

  const onTheDay = resolveAirbrushingDueDate(
    { dueDateRule: MONTH_DAY, dueDayOfMonth: 30 },
    new Date('2026-08-30T15:00:00.000Z'),
  );
  check(
    'término no próprio dia vence naquele dia (não rola de mês)',
    inSaoPaulo(onTheDay) === '2026-08-30 18:00',
    inSaoPaulo(onTheDay),
  );

  const afterTheDay = resolveAirbrushingDueDate(
    { dueDateRule: MONTH_DAY, dueDayOfMonth: 10 },
    new Date('2026-08-25T15:00:00.000Z'),
  );
  check(
    'término depois do dia escolhido rola para o mês seguinte',
    inSaoPaulo(afterTheDay) === '2026-09-10 18:00',
    inSaoPaulo(afterTheDay),
  );

  // Terminar NO dia 31 com "vence dia 31" vence naquele mesmo dia — a ocorrência
  // ainda não passou. Só o mês seguinte precisaria de truncamento.
  const finishOn31 = resolveAirbrushingDueDate(
    { dueDateRule: MONTH_DAY, dueDayOfMonth: 31 },
    new Date('2026-01-31T15:00:00.000Z'),
  );
  check(
    'término no dia 31 com vencimento dia 31 vence no próprio dia',
    inSaoPaulo(finishOn31) === '2026-01-31 18:00',
    inSaoPaulo(finishOn31),
  );

  // 01/02 com "dia 31": fevereiro não tem 31, e um 30/02 ingênuo viraria 02/03.
  const shortMonth = resolveAirbrushingDueDate(
    { dueDateRule: MONTH_DAY, dueDayOfMonth: 31 },
    new Date('2026-02-01T15:00:00.000Z'),
  );
  check(
    'dia 31 em fevereiro trunca para o último dia (28/02/2026), nunca vaza para março',
    inSaoPaulo(shortMonth) === '2026-02-28 18:00',
    inSaoPaulo(shortMonth),
  );

  const leapYear = resolveAirbrushingDueDate(
    { dueDateRule: MONTH_DAY, dueDayOfMonth: 30 },
    new Date('2028-02-05T15:00:00.000Z'), // 2028 é bissexto
  );
  check(
    'ano bissexto trunca para 29/02',
    inSaoPaulo(leapYear) === '2028-02-29 18:00',
    inSaoPaulo(leapYear),
  );

  const yearRollover = resolveAirbrushingDueDate(
    { dueDateRule: MONTH_DAY, dueDayOfMonth: 5 },
    new Date('2026-12-20T15:00:00.000Z'),
  );
  check(
    'virada de ano',
    inSaoPaulo(yearRollover) === '2027-01-05 18:00',
    inSaoPaulo(yearRollover),
  );

  check(
    'regra de dia fixo sem o dia não inventa vencimento',
    resolveAirbrushingDueDate(
      { dueDateRule: MONTH_DAY },
      new Date('2026-08-10T15:00:00.000Z'),
    ) === null,
  );
}

console.log('\n▶ FIXED_DATE');
{
  const chosen = new Date('2026-09-15T21:00:00.000Z');
  const fixed = resolveAirbrushingDueDate({ dueDateRule: FIXED, dueDate: chosen }, null);
  check(
    'data escolhida à mão vale mesmo sem término',
    fixed?.getTime() === chosen.getTime(),
    inSaoPaulo(fixed),
  );

  const ignoresFinish = resolveAirbrushingDueDate(
    { dueDateRule: FIXED, dueDate: chosen, paymentTermDays: 3, dueDayOfMonth: 30 },
    new Date('2026-08-10T15:00:00.000Z'),
  );
  check(
    'data específica ignora término, prazo e dia do mês',
    ignoresFinish?.getTime() === chosen.getTime(),
    inSaoPaulo(ignoresFinish),
  );

  check(
    'regra de data específica sem data não inventa vencimento',
    resolveAirbrushingDueDate({ dueDateRule: FIXED }, new Date()) === null,
  );
}

console.log(
  failures === 0
    ? '\n✅ Todas as verificações passaram.\n'
    : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
