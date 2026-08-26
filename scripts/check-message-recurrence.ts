/**
 * Portão do motor de recorrência de comunicados.
 *
 * Roda o `calculateNextRunDate` compartilhado contra os casos que o dono pediu —
 * "toda segunda", "mensal na primeira segunda", "mensal no dia 5" — mais as
 * bordas que historicamente quebram calendário: dia 31 em fevereiro, "última
 * sexta", virada de ano, e a sequência de várias ocorrências seguidas.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/check-message-recurrence.ts
 */
import { calculateNextRunDate } from '../src/utils/schedule-recurrence';
import type { RecurringSchedule } from '../src/utils/schedule-recurrence';

const NO_DAYS = {
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
};

let pass = 0;
let fail = 0;

const ymd = (d: Date | null): string =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'null';

function check(label: string, actual: Date | null, expected: string) {
  const got = ymd(actual);
  if (got === expected) {
    pass++;
    console.log(`  ok   ${label} → ${got}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} → esperado ${expected}, veio ${got}`);
  }
}

/** Encadeia N ocorrências, alimentando cada resultado de volta no motor. */
function series(schedule: RecurringSchedule, from: Date, n: number): string[] {
  const out: string[] = [];
  let cursor: Date | null = from;
  for (let i = 0; i < n; i++) {
    cursor = calculateNextRunDate(schedule, cursor!);
    if (!cursor) break;
    out.push(ymd(cursor));
  }
  return out;
}

function checkSeries(label: string, got: string[], expected: string[]) {
  const a = got.join(' ');
  const b = expected.join(' ');
  if (a === b) {
    pass++;
    console.log(`  ok   ${label} → ${a}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         esperado ${b}\n         veio     ${a}`);
  }
}

console.log('\n== Os três pedidos do dono ==');

// 1) "toda segunda"
const everyMonday: RecurringSchedule = {
  isActive: true,
  frequency: 'WEEKLY',
  frequencyCount: 1,
  weeklyConfig: { ...NO_DAYS, monday: true },
};
// 2026-08-26 é uma quarta-feira → próxima segunda é 31/08.
check('toda segunda (de qua 26/08/2026)', calculateNextRunDate(everyMonday, new Date(2026, 7, 26)), '2026-08-31');
// A partir de uma segunda, o motor não repete o mesmo dia: vai para a seguinte.
check('toda segunda (de seg 31/08/2026)', calculateNextRunDate(everyMonday, new Date(2026, 7, 31)), '2026-09-07');
checkSeries(
  'toda segunda, 5 seguidas',
  series(everyMonday, new Date(2026, 7, 26), 5),
  ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'],
);

// 3) "mensal, sempre na primeira segunda"
const firstMonday: RecurringSchedule = {
  isActive: true,
  frequency: 'MONTHLY',
  frequencyCount: 1,
  monthlyConfig: { occurrence: 'FIRST', dayOfWeek: 'MONDAY' },
};
check('1ª segunda (de 26/08/2026)', calculateNextRunDate(firstMonday, new Date(2026, 7, 26)), '2026-09-07');
checkSeries(
  '1ª segunda, 4 seguidas',
  series(firstMonday, new Date(2026, 7, 26), 4),
  ['2026-09-07', '2026-10-05', '2026-11-02', '2026-12-07'],
);

// 4) "mensal, sempre dia 5"
const dayFive: RecurringSchedule = {
  isActive: true,
  frequency: 'MONTHLY',
  frequencyCount: 1,
  monthlyConfig: { dayOfMonth: 5 },
};
// Dia 5 já passou em agosto → setembro.
check('dia 5 (de 26/08/2026)', calculateNextRunDate(dayFive, new Date(2026, 7, 26)), '2026-09-05');
// Dia 5 ainda não chegou neste mês → não pula o ciclo.
check('dia 5 (de 02/09/2026)', calculateNextRunDate(dayFive, new Date(2026, 8, 2)), '2026-09-05');
checkSeries(
  'dia 5, 4 seguidas',
  series(dayFive, new Date(2026, 7, 26), 4),
  ['2026-09-05', '2026-10-05', '2026-11-05', '2026-12-05'],
);

console.log('\n== Bordas de calendário ==');

// Dia 31 em mês curto: tem de ser aparado, nunca transbordar para o mês seguinte.
// Mensagens usam `clampDayOfMonth: true` — pular fevereiro deixaria o quadro um
// mês sem aviso, em silêncio.
const dayThirtyOne: RecurringSchedule = {
  isActive: true,
  frequency: 'MONTHLY',
  frequencyCount: 1,
  monthlyConfig: { dayOfMonth: 31 },
  clampDayOfMonth: true,
};
checkSeries(
  'dia 31 atravessando fevereiro, APARANDO (2027, não bissexto)',
  series(dayThirtyOne, new Date(2027, 0, 1), 4),
  ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'],
);

// Sem a bandeira, o comportamento HISTÓRICO tem de continuar intacto — é dele
// que dependem os agendamentos de pedido/EPI/manutenção.
checkSeries(
  'dia 31 SEM aparar (comportamento herdado: pula mês curto)',
  series({ ...dayThirtyOne, clampDayOfMonth: false }, new Date(2027, 0, 1), 4),
  ['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31'],
);

// Dia 29 num fevereiro bissexto cai no 29 mesmo.
checkSeries(
  'dia 29 em fevereiro bissexto (2028)',
  series(
    { ...dayThirtyOne, monthlyConfig: { dayOfMonth: 29 } },
    new Date(2028, 0, 1),
    3,
  ),
  ['2028-01-29', '2028-02-29', '2028-03-29'],
);

// Última sexta do mês.
const lastFriday: RecurringSchedule = {
  isActive: true,
  frequency: 'MONTHLY',
  frequencyCount: 1,
  monthlyConfig: { occurrence: 'LAST', dayOfWeek: 'FRIDAY' },
};
checkSeries(
  'última sexta, 3 seguidas (virada de ano)',
  series(lastFriday, new Date(2026, 10, 1), 3),
  ['2026-11-27', '2026-12-25', '2027-01-29'],
);

// Quinzenal.
const biweeklyTuesday: RecurringSchedule = {
  isActive: true,
  frequency: 'BIWEEKLY',
  frequencyCount: 1,
  weeklyConfig: { ...NO_DAYS, tuesday: true },
};
// LIMITAÇÃO HERDADA, registrada de propósito: partindo de uma quarta, a
// quinzenal NÃO pega a terça seguinte (01/09) — ela avança duas semanas e só
// então procura o dia. O primeiro disparo fica a ~13 dias, não a ~6. O ritmo
// depois disso é exato. Vale para pedido/EPI/manutenção também; não se mexe
// nisso por conta de mensagem.
checkSeries(
  'quinzenal na terça, 3 seguidas (1º disparo a 2 semanas)',
  series(biweeklyTuesday, new Date(2026, 7, 26), 3),
  ['2026-09-08', '2026-09-22', '2026-10-06'],
);

// Anual com dia 29/02 pedido em ano não bissexto: apara para 28.
const yearlyLeap: RecurringSchedule = {
  isActive: true,
  frequency: 'ANNUAL',
  frequencyCount: 1,
  yearlyConfig: { month: 'FEBRUARY', dayOfMonth: 29 },
};
check('anual 29/02 a partir de 2026', calculateNextRunDate(yearlyLeap, new Date(2026, 5, 1)), '2027-02-28');

console.log('\n== Configuração incompleta devolve null (o service barra antes) ==');
check(
  'semanal sem nenhum dia marcado',
  calculateNextRunDate(
    { isActive: true, frequency: 'WEEKLY', frequencyCount: 1, weeklyConfig: { ...NO_DAYS } },
    new Date(2026, 7, 26),
  ),
  'null',
);
check(
  'mensal sem dia nem ocorrência',
  calculateNextRunDate(
    { isActive: true, frequency: 'MONTHLY', frequencyCount: 1, monthlyConfig: {} },
    new Date(2026, 7, 26),
  ),
  'null',
);
check(
  'agendamento pausado',
  calculateNextRunDate({ ...everyMonday, isActive: false }, new Date(2026, 7, 26)),
  'null',
);

console.log(`\n${pass} ok, ${fail} falha(s)\n`);
process.exit(fail === 0 ? 0 : 1);
