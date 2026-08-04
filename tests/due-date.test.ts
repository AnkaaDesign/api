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
import {
  formatDateBR,
  generatePaymentText,
} from '../src/modules/common/signature/document/quote-text';

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

// ---------------------------------------------------------------------------
// O texto do orçamento cita o MESMO dia que a parcela e o boleto
//
// O dossiê do orçamento 609 (Nutrymax 15,50 — série 38772) saiu com "Pagamento
// à vista ... com vencimento em 11/08/2026" enquanto a parcela e o boleto
// diziam 12/08 — o `specificDate` do `paymentConfig` era, literalmente,
// "2026-08-12".
//
// A causa: `parseSpecificDate` montava meia-noite LOCAL e `formatDateBR` fixa
// America/Sao_Paulo. No browser os dois são o mesmo fuso e se cancelam; o
// `ankaa-api.service` não define `TZ` e a máquina é `Etc/UTC`, então
// meia-noite UTC formatada em UTC-3 recua um dia. O teste roda o par
// parse+format sob os DOIS fusos, porque sob SP o bug era invisível.
console.log('\nCláusula de pagamento: a data citada não depende do fuso do processo');
{
  const originalTZ = process.env.TZ;

  const underTZ = (tz: string, fn: () => void) => {
    process.env.TZ = tz;
    try {
      fn();
    } finally {
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    }
  };

  for (const tz of ['UTC', 'America/Sao_Paulo']) {
    underTZ(tz, () => {
      const text = generatePaymentText({
        paymentConfig: { type: 'CASH', cashDays: 5, specificDate: '2026-08-12' },
        total: 12765,
        paymentMethod: 'BANK_SLIP',
      });
      check(
        `à vista com specificDate cita 12/08 sob TZ=${tz}`,
        text.includes('12/08/2026'),
        text,
      );
    });
  }

  // A data já resolvida (parcela real) chega como Date ao meio-dia UTC — o
  // mesmo dia tem de sair do formatador.
  check(
    'vencimento gravado (meio-dia UTC) formata no próprio dia',
    formatDateBR(parseDueDateYMD('2026-08-12')) === '12/08/2026',
    formatDateBR(parseDueDateYMD('2026-08-12')),
  );

  // Meia-noite UTC é a forma ERRADA de gravar; se aparecer, tem de aparecer
  // como o dia anterior em SP — é isso que torna a convenção meio-dia
  // necessária, e não uma preferência de estilo.
  check(
    'meia-noite UTC recua um dia em SP (por que a convenção é meio-dia)',
    formatDateBR(new Date('2026-08-12T00:00:00.000Z')) === '11/08/2026',
  );

  // Segunda divergência: o `specificDate` é o COMBINADO, a parcela é o EMITIDO.
  // `generateInstallmentsFromPaymentConfig` aplica o piso de hoje+3 e rola para
  // o próximo dia útil, então os dois separam sempre que a data combinada cai em
  // sábado/domingo/feriado. Com parcela emitida, quem manda é ela — é a data
  // impressa no boleto que vai junto no dossiê.
  {
    const emitida = parseDueDateYMD('2026-08-14'); // 12/08 rolado para sexta
    const text = generatePaymentText({
      paymentConfig: { type: 'CASH', cashDays: 5, specificDate: '2026-08-12' },
      total: 12765,
      paymentMethod: 'BANK_SLIP',
      firstDueDate: emitida,
    });
    check('parcela emitida vence o specificDate combinado', text.includes('14/08/2026'), text);
    check('o specificDate não sobra no texto', !text.includes('12/08/2026'), text);
  }

  // Sem parcela (o estado na hora de ASSINAR) o texto continua saindo do
  // specificDate — a mudança não pode alterar o documento assinado.
  check(
    'sem parcela emitida cai no specificDate, como antes',
    generatePaymentText({
      paymentConfig: { type: 'CASH', cashDays: 5, specificDate: '2026-08-12' },
      total: 12765,
      paymentMethod: 'BANK_SLIP',
      firstDueDate: null,
    }).includes('12/08/2026'),
  );

  // Parcelado: a mesma preferência vale para a "entrada".
  check(
    'parcelado cita a entrada da parcela emitida',
    generatePaymentText({
      paymentConfig: { type: 'INSTALLMENTS', installmentCount: 3, installmentStep: 20, entryDays: 5 },
      total: 9000,
      paymentMethod: 'BANK_SLIP',
      firstDueDate: parseDueDateYMD('2026-09-01'),
    }).includes('com entrada em 01/09/2026'),
  );
}

console.log(
  failures === 0 ? '\n✅ Todas as verificações passaram.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
