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
 * A REGRA DO CLIENTE (decisão dele, 17/09/2026): 1 dia após o convite, 2 dias
 * após esse primeiro lembrete, 5 dias antes do vencimento e 1 dia antes do
 * vencimento. Quatro toques, e o prazo é âncora dos dois últimos.
 *
 * A REGRA INTERNA (11/09/2026, inalterada): a cobrança da contra-assinatura da
 * Ankaa segue nos 3 primeiros DIAS ÚTEIS e depois de 5 em 5 — ver
 * `isInternalReminderDue`. Os testes dela continuam abaixo, porque a cadência
 * continua no ar; o que mudou foi quem a usa.
 *
 * ⚠️ As datas abaixo são construídas com `-03:00` explícito. `new Date('2026-09-14')`
 * é meia-noite UTC, que em São Paulo ainda é dia 13 — e um teste de cadência que
 * erra o dia por três horas afirma o contrário do que quer afirmar.
 */

import {
  civilDayKey,
  customerReminderSchedule,
  dueCustomerReminder,
  isBusinessDaySP,
  isInternalReminderDue,
  spDayDiff,
  type CustomerReminderState,
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
    isInternalReminderDue(state(), sp(TER)),
  );
  check(
    'convite às 8h, rodada das 9h do MESMO dia: não cobra',
    !isInternalReminderDue(state({ invitedAt: sp(SEG, '08:00') }), sp(SEG, '09:00')),
  );
}

console.log('\nOs três primeiros são um por dia útil');
{
  check('1º lembrete: terça', isInternalReminderDue(state(), sp(TER)));
  check(
    '2º lembrete: quarta (a véspera foi ontem)',
    isInternalReminderDue(state({ lastReminderAt: sp(TER), reminderCount: 1 }), sp(QUA)),
  );
  check(
    '3º lembrete: quinta',
    isInternalReminderDue(state({ lastReminderAt: sp(QUA), reminderCount: 2 }), sp(QUI)),
  );
  check(
    'na SEXTA já não cobra: os três da rajada saíram',
    !isInternalReminderDue(state({ lastReminderAt: sp(QUI), reminderCount: 3 }), sp(SEX)),
  );
}

console.log('\nA rajada pula o fim de semana em vez de queimar os três nele');
{
  // Convite numa sexta: os "3 primeiros dias úteis" são segunda, terça e quarta.
  const conviteSexta = { invitedAt: sp(SEX, '16:00') };
  check(
    'sábado: não cobra',
    !isInternalReminderDue(state(conviteSexta), sp(SAB)),
  );
  check('domingo: não cobra', !isInternalReminderDue(state(conviteSexta), sp(DOM)));
  check(
    'segunda seguinte: cobra o 1º',
    isInternalReminderDue(state(conviteSexta), sp('2026-09-21')),
  );
}

console.log('\nDepois da rajada, de 5 em 5 dias');
{
  const pos = { lastReminderAt: sp(QUI), reminderCount: 3 };
  for (const [dia, rotulo] of [
    ['2026-09-18', '1 dia depois (sexta)'],
    ['2026-09-21', '4 dias depois (segunda)'],
  ] as const) {
    check(`${rotulo}: não cobra`, !isInternalReminderDue(state(pos), sp(dia)));
  }
  check(
    '5 dias depois (terça 22/09): cobra',
    isInternalReminderDue(state(pos), sp('2026-09-22')),
  );
  check(
    'e volta a silenciar no dia seguinte',
    !isInternalReminderDue(state({ lastReminderAt: sp('2026-09-22'), reminderCount: 4 }), sp('2026-09-23')),
  );
}

console.log('\nO intervalo de 5 dias que cai no fim de semana espera segunda');
{
  // Último lembrete numa segunda: +5 dias é sábado.
  const ultimoSegunda = { lastReminderAt: sp(SEG), reminderCount: 4 };
  check(
    'sábado 19/09 (5 dias depois): não cobra, é fim de semana',
    !isInternalReminderDue(state(ultimoSegunda), sp(SAB)),
  );
  check(
    'segunda 21/09 (7 dias depois): cobra',
    isInternalReminderDue(state(ultimoSegunda), sp('2026-09-21')),
  );
}

console.log('\nA âncora é o ÚLTIMO envio — um dia de API fora do ar não vira dois lembretes');
{
  // Rajada em curso (1 já saiu na terça) e a API passa quarta e quinta fora.
  const parado = { lastReminderAt: sp(TER), reminderCount: 1 };
  check(
    'sexta: cobra UMA vez (não duas para repor quarta e quinta)',
    isInternalReminderDue(state(parado), sp(SEX)),
  );
  check(
    'e no sábado seguinte já não cobra de novo',
    !isInternalReminderDue(state({ lastReminderAt: sp(SEX), reminderCount: 2 }), sp(SAB)),
  );
}

console.log('\nA conta de 30 dias: a cadência entrega ~8, e não 29');
{
  // Simula o cron diário das 9h por 30 dias sobre um signatário que nunca assina.
  let s = state();
  let enviados = 0;
  for (let i = 1; i <= 30; i++) {
    const dia = new Date(sp(SEG, '09:00').getTime() + i * 86_400_000);
    if (isInternalReminderDue(s, dia)) {
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

// ─── A CADÊNCIA DO CLIENTE ───────────────────────────────────────────────────

/** Os dias do calendário, em `YYYY-MM-DD`, para caber numa asserção legível. */
function agenda(convite: Date, vencimento: Date): string[] {
  return customerReminderSchedule(convite, vencimento).map(civilDayKey);
}

function clienteState(over: Partial<CustomerReminderState> = {}): CustomerReminderState {
  return {
    lastReminderAt: null,
    reminderCount: 0,
    invitedAt: sp(SEG, '14:00'),
    deadlineAt: sp('2026-10-14', '23:59'),
    ...over,
  };
}

console.log('\nO calendário do cliente: 1 dia, +2 dias, -5 do prazo, -1 do prazo');
{
  // Convite segunda 14/09; vencimento quarta 14/10 (30 dias).
  const dias = agenda(sp(SEG, '14:00'), sp('2026-10-14', '23:59'));
  check('são quatro toques, não mais', dias.length === 4, dias.join(' '));
  check('1º: um dia depois do convite (terça 15/09)', dias[0] === '2026-09-15', dias[0]);
  check('2º: dois dias depois do 1º (quinta 17/09)', dias[1] === '2026-09-17', dias[1]);
  check('3º: cinco dias antes do prazo (sexta 09/10)', dias[2] === '2026-10-09', dias[2]);
  check('4º: um dia antes do prazo (terça 13/10)', dias[3] === '2026-10-13', dias[3]);
}

console.log('\nFim de semana: o começo empurra para a frente, o fim puxa para trás');
{
  // Convite SEXTA 18/09: o 1º cairia no sábado.
  const dias = agenda(sp(SEX, '14:00'), sp('2026-10-16', '23:59'));
  check('1º de um convite de sexta vai para a segunda (21/09)', dias[0] === '2026-09-21', dias[0]);
  check(
    '2º conta do dia REAL do 1º, não do convite (quarta 23/09)',
    dias[1] === '2026-09-23',
    dias[1],
  );

  // Vencimento SEGUNDA 12/10: "um dia antes" é domingo 11/10.
  const colado = agenda(sp(SEG, '14:00'), sp('2026-10-12', '23:59'));
  check(
    'o último NUNCA é empurrado para depois do prazo: domingo vira sexta 09/10',
    colado[colado.length - 1] === '2026-10-09',
    colado.join(' '),
  );
  check(
    'todo dia do calendário é dia útil',
    colado.every(d => isBusinessDaySP(sp(d))),
    colado.join(' '),
  );
  check(
    'os dias são estritamente crescentes, sem repetição',
    colado.every((d, i) => i === 0 || d > colado[i - 1]),
    colado.join(' '),
  );
}

console.log('\nValidade curta: os toques do fim comem os do começo');
{
  // Convite segunda 14/09, vencimento sexta 18/09 — 4 dias de validade.
  const dias = agenda(sp(SEG, '14:00'), sp(SEX, '23:59'));
  check('nenhum toque no dia do convite ou depois do prazo', dias.every(d => d > SEG && d < SEX), dias.join(' '));
  check('sem duplicata num prazo apertado', new Set(dias).size === dias.length, dias.join(' '));
  check('o último previsto é a quinta (um dia antes)', dias[dias.length - 1] === QUI, dias.join(' '));

  // Vencimento no dia seguinte ao convite: não sobra dia útil nenhum.
  const semEspaco = agenda(sp(SEG, '14:00'), sp(TER, '23:59'));
  check('vencimento colado no convite não produz lembrete nenhum', semEspaco.length === 0, semEspaco.join(' '));
}

console.log('\nQuando o toque sai');
{
  check(
    'no dia do convite, não',
    dueCustomerReminder(clienteState(), sp(SEG, '18:00')) === null,
  );
  const primeiro = dueCustomerReminder(clienteState(), sp(TER));
  check('no dia seguinte, sai o 1º', primeiro?.index === 0 && primeiro?.total === 4);
  check(
    'no dia seguinte ao 1º ainda não é hora do 2º',
    dueCustomerReminder(clienteState({ lastReminderAt: sp(TER), reminderCount: 1 }), sp(QUA)) ===
      null,
  );
  check(
    'dois dias depois, sai o 2º',
    dueCustomerReminder(clienteState({ lastReminderAt: sp(TER), reminderCount: 1 }), sp(QUI))
      ?.index === 1,
  );
  check(
    'entre o 2º e os 5 dias antes do prazo, silêncio total',
    ['2026-09-18', '2026-09-23', '2026-09-30', '2026-10-07', '2026-10-08'].every(
      dia =>
        dueCustomerReminder(
          clienteState({ lastReminderAt: sp(QUI), reminderCount: 2 }),
          sp(dia),
        ) === null,
    ),
  );
  check(
    '5 dias antes do prazo, sai o 3º',
    dueCustomerReminder(clienteState({ lastReminderAt: sp(QUI), reminderCount: 2 }), sp('2026-10-09'))
      ?.index === 2,
  );
  check(
    '1 dia antes do prazo, sai o 4º',
    dueCustomerReminder(
      clienteState({ lastReminderAt: sp('2026-10-09'), reminderCount: 3 }),
      sp('2026-10-13'),
    )?.index === 3,
  );
  check(
    'depois do 4º não há mais nada — o próximo aviso é o de vencimento',
    dueCustomerReminder(
      clienteState({ lastReminderAt: sp('2026-10-13'), reminderCount: 4 }),
      sp('2026-10-14'),
    ) === null,
  );
  check(
    'fim de semana não cobra, nem para recuperar atraso',
    dueCustomerReminder(clienteState({ lastReminderAt: sp(QUI), reminderCount: 2 }), sp('2026-10-10')) ===
      null,
  );
}

console.log('\nQueda do agendador: sai o toque mais recente, não a fila inteira');
{
  // O agendador dorme de 09/10 (3º toque) até 13/10 (4º). Ao acordar, o que
  // vale é "vence amanhã" — "vence em 5 dias" já seria mentira.
  const atrasado = dueCustomerReminder(
    clienteState({ lastReminderAt: sp(QUI), reminderCount: 2 }),
    sp('2026-10-13'),
  );
  check('pula o toque perdido e entrega o último', atrasado?.index === 3, String(atrasado?.index));
  check(
    'e o contador consumido leva o calendário junto (index + 1 = 4)',
    (atrasado?.index ?? -1) + 1 === 4,
  );
}

console.log('\nO total de mensagens num orçamento de 30 dias');
{
  let s: CustomerReminderState = clienteState();
  let enviados = 0;
  for (let i = 1; i <= 30; i++) {
    const dia = new Date(sp(SEG, '09:00').getTime() + i * 86_400_000);
    const due = dueCustomerReminder(s, dia);
    if (due) {
      enviados++;
      s = { ...s, lastReminderAt: dia, reminderCount: due.index + 1 };
    }
  }
  check(
    `30 dias de validade produzem ${enviados} lembretes (a cadência antiga produzia ~8)`,
    enviados === 4,
    String(enviados),
  );
}

if (failures > 0) {
  console.log(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('\n✅ Cadência do lembrete: todas as verificações passaram.');
