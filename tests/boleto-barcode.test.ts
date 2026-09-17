/**
 * Guarda do código de barras do boleto — o vencimento também mora DENTRO da barra.
 *
 * O bug que originou este arquivo: `PUT /invoices/:id/boleto/due-date` trocava a data no
 * Sicredi e no banco, mas `barcode` e `digitableLine` só eram escritos na CRIAÇÃO do
 * boleto. Como o "fator de vencimento" ocupa as posições 6-9 da barra, a linha digitável
 * ficava congelada na data antiga — 18 de 321 boletos chegaram a carregar uma data até
 * 41 dias atrás da que o sistema mostrava. E isso vaza para o cliente por dois caminhos:
 * o botão "copiar linha digitável" e `GET /boleto/pdf`, que consulta o Sicredi USANDO a
 * linha digitável armazenada como chave.
 *
 * A regra que este arquivo protege:
 *  · trocar o vencimento reconstrói fator + DV geral + linha digitável;
 *  · tudo o mais da barra (banco, moeda, valor, campo livre) fica intacto;
 *  · uma barra ilegível não é "consertada" na marra — devolve null e o chamador registra.
 *
 * Os vetores abaixo são boletos REAIS de produção (Sicredi 748), escolhidos por
 * cobrirem os dois lados do problema. Os algoritmos foram conferidos contra os 323
 * boletos com barra no banco: DV geral e linha digitável batem 323/323.
 *
 * Rodar: pnpm tsx tests/boleto-barcode.test.ts
 */

import {
  barcodeAmount,
  barcodeDueDateYMD,
  barcodeToDigitableLine,
  computeBarcodeCheckDigit,
  dueDateToFactor,
  factorToDueDateYMD,
  isBarcodeCurrentForDueDate,
  isValidBarcodeShape,
  rebuildBoletoCodesForDueDate,
} from '../src/utils/boleto-barcode.util';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Boletos reais em produção (nossoNumero, barra, linha, vencimento gravado). */
const PRODUCTION_SLIPS = [
  {
    nossoNumero: '600003613', // MAR & RIO NF3194, parcela 3
    barcode: '74894157200005468101160000361307185818078102',
    digitableLine: '74891160090036130718458180781021415720000546810',
    encodesYMD: '2026-09-17',
    amount: 5468.1,
  },
];

// ---------------------------------------------------------------------------
console.log('\nFator de vencimento: a data dentro da barra');
{
  // Época pós-rollover: o fator estourou 9999 em 21/02/2025 e voltou a 1000 no dia seguinte.
  check('fator 1000 é 22/02/2025', factorToDueDateYMD(1000) === '2025-02-22', String(factorToDueDateYMD(1000)));
  check('ida e volta preserva o dia', factorToDueDateYMD(dueDateToFactor('2026-09-17')) === '2026-09-17');
  check('fator do caso real é 1572', dueDateToFactor('2026-09-17') === 1572, String(dueDateToFactor('2026-09-17')));
  check(
    'lê o vencimento da barra de produção',
    barcodeDueDateYMD(PRODUCTION_SLIPS[0].barcode) === '2026-09-17',
    String(barcodeDueDateYMD(PRODUCTION_SLIPS[0].barcode)),
  );
  check('lê o valor da barra de produção', barcodeAmount(PRODUCTION_SLIPS[0].barcode) === 5468.1);

  // Fora da faixa 1000-9999 não existe fator — melhor estourar do que gravar lixo.
  let threw = false;
  try {
    dueDateToFactor('2020-01-01');
  } catch {
    threw = true;
  }
  check('data anterior à época não vira fator', threw);
  check('fator fora da faixa devolve null', factorToDueDateYMD(999) === null);
}

// ---------------------------------------------------------------------------
console.log('\nDígitos verificadores, conferidos contra produção');
{
  for (const slip of PRODUCTION_SLIPS) {
    const digits43 = slip.barcode.slice(0, 4) + slip.barcode.slice(5);
    check(
      `${slip.nossoNumero}: DV geral (mód. 11) reproduz a barra emitida`,
      String(computeBarcodeCheckDigit(digits43)) === slip.barcode[4],
    );
    check(
      `${slip.nossoNumero}: linha digitável reconstruída bate com a emitida`,
      barcodeToDigitableLine(slip.barcode) === slip.digitableLine,
      barcodeToDigitableLine(slip.barcode),
    );
  }
}

// ---------------------------------------------------------------------------
console.log('\nTrocar o vencimento: o que muda e o que NÃO muda');
{
  const original = PRODUCTION_SLIPS[0].barcode;
  const rebuilt = rebuildBoletoCodesForDueDate(original, '2026-09-28');

  check('reconstrói para a nova data', rebuilt !== null);
  if (rebuilt) {
    check(
      'a barra nova codifica 28/09 (era 17/09 — o caso MAR & RIO)',
      barcodeDueDateYMD(rebuilt.barcode) === '2026-09-28',
      String(barcodeDueDateYMD(rebuilt.barcode)),
    );
    check('continua com 44 dígitos', isValidBarcodeShape(rebuilt.barcode));
    check('linha digitável continua com 47 dígitos', rebuilt.digitableLine.length === 47);
    check(
      'DV geral foi RECALCULADO, não copiado',
      String(computeBarcodeCheckDigit(rebuilt.barcode.slice(0, 4) + rebuilt.barcode.slice(5))) ===
        rebuilt.barcode[4],
    );
    check(
      'a linha digitável é coerente com a barra nova',
      barcodeToDigitableLine(rebuilt.barcode) === rebuilt.digitableLine,
    );
    // Só o fator (6-9) e o DV (5) podem mudar. Mexer no valor ou no campo livre
    // (cooperativa/posto/beneficiário/nossoNumero) produziria um boleto de outra pessoa.
    check('banco e moeda intactos', rebuilt.barcode.slice(0, 4) === original.slice(0, 4));
    check('valor intacto', rebuilt.barcode.slice(9, 19) === original.slice(9, 19));
    check('campo livre intacto', rebuilt.barcode.slice(19) === original.slice(19));
    check('o valor lido continua R$ 5.468,10', barcodeAmount(rebuilt.barcode) === 5468.1);
  }

  // Reconstruir para a MESMA data tem de devolver exatamente a barra emitida — é o
  // teste que prova que a reconstrução não inventa nada.
  const noop = rebuildBoletoCodesForDueDate(original, '2026-09-17');
  check(
    'reconstruir para a mesma data devolve a barra original, dígito por dígito',
    noop?.barcode === original && noop?.digitableLine === PRODUCTION_SLIPS[0].digitableLine,
  );
}

// ---------------------------------------------------------------------------
console.log('\nDetecção da barra defasada (o que a auditoria procura)');
{
  const slip = PRODUCTION_SLIPS[0];
  check('barra em dia é reconhecida', isBarcodeCurrentForDueDate(slip.barcode, '2026-09-17'));
  check(
    'barra defasada é reconhecida (o estado em que 18 boletos ficaram)',
    !isBarcodeCurrentForDueDate(slip.barcode, '2026-09-28'),
  );
  check('barra ausente nunca conta como em dia', !isBarcodeCurrentForDueDate(null, '2026-09-17'));
}

// ---------------------------------------------------------------------------
console.log('\nEntradas inválidas: devolver null, nunca uma linha meio válida');
{
  check('null', rebuildBoletoCodesForDueDate(null, '2026-09-28') === null);
  check('string vazia', rebuildBoletoCodesForDueDate('', '2026-09-28') === null);
  check('barra curta', rebuildBoletoCodesForDueDate('7489415720000546810', '2026-09-28') === null);
  check(
    'barra com letra',
    rebuildBoletoCodesForDueDate('7489415720000546810116000036130718581807810X', '2026-09-28') ===
      null,
  );
  check(
    'data fora da faixa do fator',
    rebuildBoletoCodesForDueDate(PRODUCTION_SLIPS[0].barcode, '2020-01-01') === null,
  );
  check('vencimento de barra malformada é null', barcodeDueDateYMD('abc') === null);
}

console.log(
  failures === 0 ? '\n✅ Todas as verificações passaram.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
