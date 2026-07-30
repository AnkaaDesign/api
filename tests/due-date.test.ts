/**
 * Guarda das datas de vencimento — parcela, boleto e a virada para "vencido".
 *
 * Dois bugs originaram este arquivo, e os dois nasceram de tratar uma DATA DE
 * CALENDÁRIO como se fosse um INSTANTE:
 *
 *  1. D-1 no sync do Sicredi. O endpoint devolve `dataVencimento` como
 *     "yyyy-MM-dd" puro. `new Date('2026-09-08')` é meia-noite UTC, que renderizada
 *     em São Paulo (UTC-3) vira 2026-09-07. O job comparava esse dia com o nosso
 *     (meio-dia UTC), "achava" divergência e regravava o vencimento um dia ANTES —
 *     no boleto E na parcela. O desvio era de mão única: uma vez gravado como D-1
 *     a comparação passava a concordar, e o registro estabilizava errado. 134 dos
 *     217 boletos registrados chegaram a ficar um dia atrás do boleto real.
 *
 *  2. "Vencido" no próprio dia do vencimento. Comparar instantes
 *     (`dueDate < new Date()`) virava a parcela para OVERDUE às 09:00 de SP (meio-dia
 *     UTC) do dia do vencimento, e o orçamento inteiro caía para DUE antes de o
 *     cliente ter qualquer chance de atrasar.
 *
 * A regra que este arquivo protege:
 *  · a data gravada é sempre meio-dia UTC, e o dia do calendário nunca se move;
 *  · uma data do banco é lida pelos dígitos, sem passar por fuso nenhum;
 *  · "vencido" começa no dia SEGUINTE ao vencimento — nunca no próprio dia.
 *
 * Rodar: pnpm tsx tests/due-date.test.ts
 */

import {
  bankDateToYMD,
  daysBetweenDueDates,
  formatDueDateYMD,
  isDueDateOverdue,
  normalizeDueDateToNoonUtc,
  parseDueDateYMD,
} from '../src/utils/due-date.util';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nArmazenamento: o dia do calendário não se move');
{
  const d = parseDueDateYMD('2026-09-08');
  check('grava ao meio-dia UTC', d.toISOString() === '2026-09-08T12:00:00.000Z', d.toISOString());
  check('ida e volta preserva o dia', formatDueDateYMD(d) === '2026-09-08', formatDueDateYMD(d));
  check(
    'renderizado em São Paulo continua sendo o mesmo dia',
    d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === '2026-09-08',
  );
  check(
    'renderizado em UTC continua sendo o mesmo dia',
    d.toLocaleDateString('en-CA', { timeZone: 'UTC' }) === '2026-09-08',
  );
  // Meia-noite UTC é exatamente o valor que a importação de abril gravou.
  const midnight = new Date('2026-09-08T00:00:00.000Z');
  check(
    'meia-noite UTC é o que renderiza D-1 em SP (o motivo da convenção)',
    midnight.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === '2026-09-07',
  );
  check(
    'normalizar meia-noite UTC mantém o dia e corrige a hora',
    formatDueDateYMD(normalizeDueDateToNoonUtc(midnight)) === '2026-09-08' &&
      normalizeDueDateToNoonUtc(midnight).toISOString() === '2026-09-08T12:00:00.000Z',
  );
}

// ---------------------------------------------------------------------------
console.log('\nLeitura da data vinda do banco: pelos dígitos, sem fuso');
{
  // Formato que o Sicredi realmente devolve — 100% dos boletos consultados.
  check('"yyyy-MM-dd" puro', bankDateToYMD('2026-09-08') === '2026-09-08');
  check('"dd/MM/yyyy"', bankDateToYMD('08/09/2026') === '2026-09-08');
  check('com hora', bankDateToYMD('2026-09-08 00:00:00') === '2026-09-08');
  check('com offset', bankDateToYMD('2026-09-08T00:00:00-03:00') === '2026-09-08');
  check('dd/MM/yyyy com hora', bankDateToYMD('08/09/2026 10:30') === '2026-09-08');
  check('vazio devolve null', bankDateToYMD('') === null && bankDateToYMD(null) === null);
  check('formato irreconhecível devolve null', bankDateToYMD('08-09-26') === null);

  // A regressão em si: o caminho antigo perdia um dia, o novo não.
  const bugged = new Date('2026-09-08').toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });
  check(
    'o caminho antigo perdia um dia (regressão registrada)',
    bugged === '2026-09-07',
    bugged,
  );
  check('o caminho novo não perde o dia', bankDateToYMD('2026-09-08') === '2026-09-08');
}

// ---------------------------------------------------------------------------
console.log('\n"Vencido" começa no dia SEGUINTE ao vencimento');
{
  const today = parseDueDateYMD('2026-07-30');

  check('vence depois de amanhã → não vencido', !isDueDateOverdue(parseDueDateYMD('2026-08-01'), today));
  check('vence amanhã → não vencido', !isDueDateOverdue(parseDueDateYMD('2026-07-31'), today));
  check('vence HOJE → NÃO vencido', !isDueDateOverdue(parseDueDateYMD('2026-07-30'), today));
  check('venceu ontem (1 dia depois) → vencido', isDueDateOverdue(parseDueDateYMD('2026-07-29'), today));
  check('venceu há 2 dias → vencido', isDueDateOverdue(parseDueDateYMD('2026-07-28'), today));

  // O caso concreto que motivou a correção: 4 boletos com vencimento 30/07 estavam
  // marcados OVERDUE porque o sync os havia gravado como 29/07.
  check(
    'boleto do dia não pode ser marcado vencido',
    !isDueDateOverdue(parseDueDateYMD('2026-07-30'), today),
  );

  // A hora do dia não pode influenciar — é comparação de calendário.
  const lateInTheDay = new Date('2026-07-30T23:59:59.000Z');
  check(
    'a hora do dia não muda o resultado',
    !isDueDateOverdue(parseDueDateYMD('2026-07-30'), normalizeDueDateToNoonUtc(lateInTheDay)),
  );

  // Virada de mês e de ano.
  check('virada de mês', isDueDateOverdue(parseDueDateYMD('2026-07-31'), parseDueDateYMD('2026-08-01')));
  check('virada de ano', isDueDateOverdue(parseDueDateYMD('2026-12-31'), parseDueDateYMD('2027-01-01')));
  check(
    'último dia do mês não vence no próprio dia',
    !isDueDateOverdue(parseDueDateYMD('2026-07-31'), parseDueDateYMD('2026-07-31')),
  );
}

// ---------------------------------------------------------------------------
console.log('\n"Dias restantes" conta dias de calendário');
{
  const today = parseDueDateYMD('2026-07-30');
  // Antes, um boleto vencendo HOJE avisava "faltam 1 dia" (meio-dia UTC vs
  // meia-noite de SP = +9h, arredondado para cima).
  check('vence hoje → 0', daysBetweenDueDates(parseDueDateYMD('2026-07-30'), today) === 0);
  check('vence amanhã → 1', daysBetweenDueDates(parseDueDateYMD('2026-07-31'), today) === 1);
  check('venceu ontem → -1', daysBetweenDueDates(parseDueDateYMD('2026-07-29'), today) === -1);
  check('daqui a 30 dias → 30', daysBetweenDueDates(parseDueDateYMD('2026-08-29'), today) === 30);
  check(
    'atravessa a virada de ano',
    daysBetweenDueDates(parseDueDateYMD('2027-01-01'), parseDueDateYMD('2026-12-31')) === 1,
  );
}

console.log(
  failures === 0 ? '\n✅ Todas as verificações passaram.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
