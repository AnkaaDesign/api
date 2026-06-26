// test-payroll-calculations.ts
// Testes de unidade (funções puras, SEM banco) dos cálculos da folha:
//   - INSS progressivo (tabelas 2025/2026, teto)
//   - IRRF mensal (deduções legais × desconto simplificado, dependentes,
//     redutor Lei 15.270/2025) — inclui exemplos oficiais da Receita Federal
//   - Salário-família (Portarias MPS/MF 6/2025 e 13/2026)
//   - Coparticipação de benefícios (regra canônica benefit-discount)
//
// Execução: cd api && npx tsx scripts/test-payroll-calculations.ts
// Sai com código != 0 quando qualquer asserção falha.

import assert from 'node:assert/strict';
import {
  INSS_TABLES,
  IRRF_TABLES,
  getInssTableForYear,
  getIrrfTableForYear,
  getSalarioFamiliaTableForYear,
  computeProgressiveINSS,
  computeIRRF,
  computeSalarioFamilia,
  IRRF_DEPENDENT_DEDUCTION,
} from '../src/modules/personnel-department/payroll/utils/tax-tables';
import { calculateEmployeeShare } from '../src/utils/benefit-discount';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : error}`);
  }
}

function approx(actual: number, expected: number, name = '') {
  assert.ok(
    Math.abs(actual - expected) < 0.005,
    `${name} esperado ${expected.toFixed(2)}, obtido ${actual.toFixed(2)}`,
  );
}

// ============================================================================
console.log('\n— Seleção de tabela por ano —');
// ============================================================================

test('2025 usa tabela INSS 2025; 2026 usa 2026; 2027 (futuro) usa a última (2026)', () => {
  assert.equal(getInssTableForYear(2025).year, 2025);
  assert.equal(getInssTableForYear(2026).year, 2026);
  assert.equal(getInssTableForYear(2027).year, 2026);
  assert.equal(getInssTableForYear(2024).year, 2025); // anterior a todas → a mais antiga
});

test('IRRF: redutor Lei 15.270 existe APENAS a partir de 2026', () => {
  assert.equal(getIrrfTableForYear(2025).redutor, null);
  assert.ok(getIrrfTableForYear(2026).redutor);
  assert.ok(getIrrfTableForYear(2030).redutor);
});

// ============================================================================
console.log('\n— INSS progressivo —');
// ============================================================================

const inss2025 = getInssTableForYear(2025);
const inss2026 = getInssTableForYear(2026);

test('2025: R$ 3.000,00 → R$ 253,41 (exemplo documentado)', () => {
  approx(computeProgressiveINSS(3000, inss2025.brackets).total, 253.41);
});

test('2026: R$ 1.621,00 (1ª faixa cheia) → 7,5% = R$ 121,58', () => {
  approx(computeProgressiveINSS(1621, inss2026.brackets).total, 121.58);
});

test('2026: R$ 3.000,00 → R$ 248,60', () => {
  // 1621×7,5% + 1.281,84×9% + 97,16×12% = 121,575 + 115,3656 + 11,6592
  approx(computeProgressiveINSS(3000, inss2026.brackets).total, 248.6);
});

test('2026: salário acima do teto contribui só até o teto (R$ 988,09)', () => {
  const atCeiling = computeProgressiveINSS(8475.55, inss2026.brackets).total;
  const above = computeProgressiveINSS(20000, inss2026.brackets).total;
  approx(atCeiling, inss2026.maxContribution);
  assert.equal(above, atCeiling);
});

test('progressivo é monotônico e contínuo nas bordas de faixa', () => {
  for (const boundary of [1621.0, 2902.84, 4354.27]) {
    const before = computeProgressiveINSS(boundary - 0.01, inss2026.brackets).total;
    const after = computeProgressiveINSS(boundary + 0.01, inss2026.brackets).total;
    assert.ok(after >= before, `descontinuidade em ${boundary}`);
    // tolerância de 1 centavo: arredondamento monetário nas bordas
    assert.ok(after - before <= 0.011, `salto em ${boundary}: ${before} → ${after}`);
  }
});

// ============================================================================
console.log('\n— IRRF mensal 2026 (Lei 15.270/2025) —');
// ============================================================================

const irrf2026 = getIrrfTableForYear(2026);
const irrf2025 = getIrrfTableForYear(2025);

test('exemplo oficial Receita: R$ 6.000 (desconto simplificado) → imposto R$ 394,54', () => {
  // base 6.000 − 607,20 = 5.392,80 → ×27,5% − 908,73 = 574,29
  // redutor: 978,62 − 0,133145×6.000 = 179,75 → 574,29 − 179,75 = 394,54
  const r = computeIRRF({
    taxableGross: 6000,
    inssAmount: 0,
    dependentsCount: 0,
    allowSimplifiedDeduction: true,
    table: irrf2026,
  });
  assert.equal(r.usedSimplifiedDeduction, true);
  approx(r.taxableIncome, 5392.8, 'base');
  approx(r.taxBeforeRedutor, 574.29, 'imposto antes do redutor');
  approx(r.redutorAmount, 179.75, 'redutor');
  approx(r.tax, 394.54, 'imposto final');
});

test('rendimentos ≤ R$ 5.000 → imposto ZERO (redutor = imposto apurado, máx. 312,89)', () => {
  const r = computeIRRF({
    taxableGross: 5000,
    inssAmount: 0,
    dependentsCount: 0,
    allowSimplifiedDeduction: true,
    table: irrf2026,
  });
  approx(r.taxBeforeRedutor, 312.89, 'imposto pela tabela'); // valor citado pela RFB
  assert.equal(r.tax, 0);
  approx(r.redutorAmount, r.taxBeforeRedutor, 'redutor == imposto');
});

test('mesmo caso em 2025 (sem redutor) → paga os R$ 312,89', () => {
  const r = computeIRRF({
    taxableGross: 5000,
    inssAmount: 0,
    dependentsCount: 0,
    allowSimplifiedDeduction: true,
    table: irrf2025,
  });
  assert.equal(r.redutorAmount, 0);
  approx(r.tax, 312.89);
});

test('rendimentos > R$ 7.350 → sem redução', () => {
  const r = computeIRRF({
    taxableGross: 8000,
    inssAmount: 921.51,
    dependentsCount: 0,
    allowSimplifiedDeduction: true,
    table: irrf2026,
  });
  assert.equal(r.redutorAmount, 0);
  assert.ok(r.tax > 0);
});

test('fronteira R$ 7.350: redução ≈ 0 (transição contínua)', () => {
  const r = computeIRRF({
    taxableGross: 7350,
    inssAmount: 0,
    dependentsCount: 0,
    allowSimplifiedDeduction: true,
    table: irrf2026,
  });
  assert.ok(r.redutorAmount <= 0.01, `redutor deveria ~0, obtido ${r.redutorAmount}`);
});

test('redutor nunca deixa o imposto negativo', () => {
  for (let gross = 5000.01; gross <= 7350; gross += 250) {
    const r = computeIRRF({
      taxableGross: gross,
      inssAmount: computeProgressiveINSS(gross, inss2026.brackets).total,
      dependentsCount: 2,
      allowSimplifiedDeduction: true,
      table: irrf2026,
    });
    assert.ok(r.tax >= 0, `imposto negativo em ${gross}: ${r.tax}`);
  }
});

// ============================================================================
console.log('\n— IRRF: deduções legais × desconto simplificado, dependentes —');
// ============================================================================

test('deduções legais maiores que o simplificado → usa legais (INSS + dependentes)', () => {
  // INSS 350 + 2 dep × 189,59 = 729,18 > 607,20
  const r = computeIRRF({
    taxableGross: 9000,
    inssAmount: 350,
    dependentsCount: 2,
    allowSimplifiedDeduction: true,
    table: irrf2026,
  });
  assert.equal(r.usedSimplifiedDeduction, false);
  approx(r.dependentsDeduction, 2 * IRRF_DEPENDENT_DEDUCTION);
  approx(r.taxableIncome, 9000 - 729.18, 'base com deduções legais');
});

test('deduções legais menores que o simplificado → usa simplificado (R$ 607,20)', () => {
  // INSS 100 + 1 dep = 289,59 < 607,20
  const r = computeIRRF({
    taxableGross: 9000,
    inssAmount: 100,
    dependentsCount: 1,
    allowSimplifiedDeduction: true,
    table: irrf2026,
  });
  assert.equal(r.usedSimplifiedDeduction, true);
  approx(r.taxableIncome, 9000 - 607.2);
});

test('simplificado desabilitado → sempre deduções legais', () => {
  const r = computeIRRF({
    taxableGross: 9000,
    inssAmount: 100,
    dependentsCount: 0,
    allowSimplifiedDeduction: false,
    table: irrf2026,
  });
  assert.equal(r.usedSimplifiedDeduction, false);
  approx(r.taxableIncome, 8900);
});

test('cada dependente reduz a base em R$ 189,59 (imposto nunca aumenta)', () => {
  let previousTax = Infinity;
  for (let deps = 0; deps <= 4; deps++) {
    const r = computeIRRF({
      taxableGross: 12000,
      inssAmount: 988.09,
      dependentsCount: deps,
      allowSimplifiedDeduction: true,
      table: irrf2026,
    });
    assert.ok(r.tax <= previousTax, `imposto subiu com ${deps} dependentes`);
    previousTax = r.tax;
  }
});

test('base na faixa isenta (≤ 2.428,80) → imposto zero', () => {
  const r = computeIRRF({
    taxableGross: 3000,
    inssAmount: 248.6,
    dependentsCount: 2,
    allowSimplifiedDeduction: true,
    table: irrf2025, // sem redutor, prova que é a faixa isenta que zera
  });
  approx(r.taxableIncome, 3000 - 248.6 - 379.18);
  assert.equal(r.tax, 0);
});

// ============================================================================
console.log('\n— Salário-família —');
// ============================================================================

test('2026: remuneração ≤ R$ 1.980,38 → R$ 67,54 por filho elegível', () => {
  const table = getSalarioFamiliaTableForYear(2026);
  approx(computeSalarioFamilia(1900, 2, table), 135.08);
  approx(computeSalarioFamilia(1980.38, 1, table), 67.54);
});

test('2026: remuneração acima do limite → R$ 0', () => {
  const table = getSalarioFamiliaTableForYear(2026);
  assert.equal(computeSalarioFamilia(1980.39, 3, table), 0);
});

test('2025: cota R$ 65,00 até R$ 1.906,04', () => {
  const table = getSalarioFamiliaTableForYear(2025);
  approx(computeSalarioFamilia(1906.04, 1, table), 65.0);
  assert.equal(computeSalarioFamilia(1910, 1, table), 0);
});

test('sem dependentes elegíveis → R$ 0', () => {
  assert.equal(computeSalarioFamilia(1500, 0, getSalarioFamiliaTableForYear(2026)), 0);
});

// ============================================================================
console.log('\n— Coparticipação de benefícios (regra canônica) —');
// ============================================================================

test('valor fixo: limitado ao custo do benefício', () => {
  approx(
    calculateEmployeeShare({ monthlyValue: 300, employeeDiscountValue: 120 }, 2000),
    120,
  );
  approx(
    calculateEmployeeShare({ monthlyValue: 100, employeeDiscountValue: 150 }, 2000),
    100, // min(valor, custo)
  );
});

test('VT percentual: % do SALÁRIO, limitado ao custo', () => {
  approx(
    calculateEmployeeShare(
      { monthlyValue: 300, employeeDiscountPercent: 6, benefitKind: 'TRANSPORT_VOUCHER' },
      2000,
    ),
    120, // 6% × 2.000
  );
  approx(
    calculateEmployeeShare(
      { monthlyValue: 300, employeeDiscountPercent: 6, benefitKind: 'TRANSPORT_VOUCHER' },
      10000,
    ),
    300, // 6% × 10.000 = 600 → limitado ao custo
  );
});

test('demais benefícios percentuais: % do CUSTO', () => {
  approx(
    calculateEmployeeShare(
      { monthlyValue: 400, employeeDiscountPercent: 20, benefitKind: 'MEAL_VOUCHER' },
      2000,
    ),
    80, // 20% × 400
  );
});

test('sem regra de desconto → R$ 0', () => {
  assert.equal(calculateEmployeeShare({ monthlyValue: 500 }, 2000), 0);
});

test('valor fixo tem precedência sobre percentual', () => {
  approx(
    calculateEmployeeShare(
      {
        monthlyValue: 300,
        employeeDiscountValue: 50,
        employeeDiscountPercent: 6,
        benefitKind: 'TRANSPORT_VOUCHER',
      },
      2000,
    ),
    50,
  );
});

// ============================================================================
console.log('\n— Sanidade das tabelas —');
// ============================================================================

test('tabelas em ordem cronológica, faixas contíguas e crescentes', () => {
  for (const table of INSS_TABLES) {
    const brackets = table.brackets;
    for (let i = 1; i < brackets.length; i++) {
      assert.ok(brackets[i].rate > brackets[i - 1].rate, `${table.year}: alíquotas crescentes`);
      approx(
        brackets[i].minValue,
        (brackets[i - 1].maxValue ?? 0) + 0.01,
        `${table.year}: contiguidade faixa ${i}`,
      );
    }
    assert.equal(brackets[brackets.length - 1].maxValue, table.ceiling);
  }
  for (const table of IRRF_TABLES) {
    assert.equal(table.brackets[table.brackets.length - 1].maxValue, null);
  }
});

// ============================================================================

console.log(`\n${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
