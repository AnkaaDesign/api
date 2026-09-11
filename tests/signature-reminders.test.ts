/**
 * A CADÊNCIA DO LEMBRETE DE ASSINATURA.
 *
 * O QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Um orçamento saía para assinatura e, se o cliente não abrisse, ninguém voltava
 * a falar com ele: o reenvio era manual, um signatário por vez. Agora um cron
 * cobra sozinho — e cobrar sozinho é a classe de código que erra em silêncio.
 * Nada aqui tem tipo a quebrar: uma comparação invertida manda lembrete todo dia
 * por trinta dias, e o sintoma chega semanas depois, na conversa de um cliente
 * de verdade, com o template já com a nota de qualidade arranhada na Meta.
 *
 * A REGRA (decisão dele, 11/09/2026): os 3 primeiros DIAS ÚTEIS depois do
 * convite, e depois de 5 em 5 dias.
 *
 * ⚠️ As datas abaixo são construídas com `-03:00` explícito. `new Date('2026-09-14')`
 * é meia-noite UTC, que em São Paulo ainda é dia 13 — e um teste de cadência que
 * erra o dia por três horas afirma o contrário do que quer afirmar.
 */

import {
  isBusinessDaySP,
  isReminderDue,
  spDayDiff,
  type ReminderState,
} from '../src/modules/common/signature/signature-reminder-cadence';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Data no relógio de São Paulo. `sp('2026-09-14', '09:00')` = 14/09 às 9h em SP. */
function sp(day: string, time = '09:00'): Date {
  return new Date(`${day}T${time}:00-03:00`);
}

// Setembro de 2026: dia 14 é uma segunda-feira.
const SEG = '2026-09-14';
const TER = '2026-09-15';
const QUA = '2026-09-16';
const QUI = '2026-09-17';
const SEX = '2026-09-18';
const SAB = '2026-09-19';
const DOM = '2026-09-20';

function state(over: Partial<ReminderState> = {}): ReminderState {
  return { lastReminderAt: null, reminderCount: 0, invitedAt: sp(SEG, '14:00'), ...over };
}

console.log('\nO calendário é o de São Paulo, não o do servidor');
{
  check('segunda é dia útil', isBusinessDaySP(sp(SEG)));
  check('sábado não é', !isBusinessDaySP(sp(SAB)));
  check('domingo não é', !isBusinessDaySP(sp(DOM)));
  check(
    'meia-noite e dez de terça em SP ainda é terça (e não quarta, como seria em UTC)',
    isBusinessDaySP(sp(TER, '00:10')),
  );
  check(
    '23h30 de sexta em SP ainda é sexta (em UTC já seria sábado)',
    isBusinessDaySP(sp(SEX, '23:30')),
  );
  check('a diferença é em dias civis', spDayDiff(sp(SEG, '23:50'), sp(TER, '00:10')) === 1);
}

console.log('\nNo dia do convite, ninguém é cobrado');
{
  check(
    'convite às 14h, rodada das 9h do dia seguinte: cobra',
    isReminderDue(state(), sp(TER)),
  );
  check(
    'convite às 8h, rodada das 9h do MESMO dia: não cobra',
    !isReminderDue(state({ invitedAt: sp(SEG, '08:00') }), sp(SEG, '09:00')),
  );
}

console.log('\nOs três primeiros são um por dia útil');
{
  check('1º lembrete: terça', isReminderDue(state(), sp(TER)));
  check(
    '2º lembrete: quarta (a véspera foi ontem)',
    isReminderDue(state({ lastReminderAt: sp(TER), reminderCount: 1 }), sp(QUA)),
  );
  check(
    '3º lembrete: quinta',
    isReminderDue(state({ lastReminderAt: sp(QUA), reminderCount: 2 }), sp(QUI)),
  );
  check(
    'na SEXTA já não cobra: os três da rajada saíram',
    !isReminderDue(state({ lastReminderAt: sp(QUI), reminderCount: 3 }), sp(SEX)),
  );
}

console.log('\nA rajada pula o fim de semana em vez de queimar os três nele');
{
  // Convite numa sexta: os "3 primeiros dias úteis" são segunda, terça e quarta.
  const conviteSexta = { invitedAt: sp(SEX, '16:00') };
  check(
    'sábado: não cobra',
    !isReminderDue(state(conviteSexta), sp(SAB)),
  );
  check('domingo: não cobra', !isReminderDue(state(conviteSexta), sp(DOM)));
  check(
    'segunda seguinte: cobra o 1º',
    isReminderDue(state(conviteSexta), sp('2026-09-21')),
  );
}

console.log('\nDepois da rajada, de 5 em 5 dias');
{
  const pos = { lastReminderAt: sp(QUI), reminderCount: 3 };
  for (const [dia, rotulo] of [
    ['2026-09-18', '1 dia depois (sexta)'],
    ['2026-09-21', '4 dias depois (segunda)'],
  ] as const) {
    check(`${rotulo}: não cobra`, !isReminderDue(state(pos), sp(dia)));
  }
  check(
    '5 dias depois (terça 22/09): cobra',
    isReminderDue(state(pos), sp('2026-09-22')),
  );
  check(
    'e volta a silenciar no dia seguinte',
    !isReminderDue(state({ lastReminderAt: sp('2026-09-22'), reminderCount: 4 }), sp('2026-09-23')),
  );
}

console.log('\nO intervalo de 5 dias que cai no fim de semana espera segunda');
{
  // Último lembrete numa segunda: +5 dias é sábado.
  const ultimoSegunda = { lastReminderAt: sp(SEG), reminderCount: 4 };
  check(
    'sábado 19/09 (5 dias depois): não cobra, é fim de semana',
    !isReminderDue(state(ultimoSegunda), sp(SAB)),
  );
  check(
    'segunda 21/09 (7 dias depois): cobra',
    isReminderDue(state(ultimoSegunda), sp('2026-09-21')),
  );
}

console.log('\nA âncora é o ÚLTIMO envio — um dia de API fora do ar não vira dois lembretes');
{
  // Rajada em curso (1 já saiu na terça) e a API passa quarta e quinta fora.
  const parado = { lastReminderAt: sp(TER), reminderCount: 1 };
  check(
    'sexta: cobra UMA vez (não duas para repor quarta e quinta)',
    isReminderDue(state(parado), sp(SEX)),
  );
  check(
    'e no sábado seguinte já não cobra de novo',
    !isReminderDue(state({ lastReminderAt: sp(SEX), reminderCount: 2 }), sp(SAB)),
  );
}

console.log('\nA conta de 30 dias: a cadência entrega ~8, e não 29');
{
  // Simula o cron diário das 9h por 30 dias sobre um signatário que nunca assina.
  let s = state();
  let enviados = 0;
  for (let i = 1; i <= 30; i++) {
    const dia = new Date(sp(SEG, '09:00').getTime() + i * 86_400_000);
    if (isReminderDue(s, dia)) {
      enviados++;
      s = { ...s, lastReminderAt: dia, reminderCount: s.reminderCount + 1 };
    }
  }
  check(
    `30 dias de validade produzem ${enviados} lembretes (o pedido literal "todo dia" produziria 29)`,
    enviados >= 6 && enviados <= 9,
    String(enviados),
  );
}

if (failures > 0) {
  console.log(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('\n✅ Cadência do lembrete: todas as verificações passaram.');
