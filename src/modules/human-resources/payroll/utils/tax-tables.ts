// tax-tables.ts
// ============================================================================
// TABELAS FISCAIS OFICIAIS (INSS / IRRF / SALÁRIO-FAMÍLIA) + FUNÇÕES PURAS
// ============================================================================
// Fonte única de verdade para os valores legais usados no cálculo da folha.
// As tabelas são constantes versionadas por vigência (effectiveFrom/year):
// tabelas futuras devem ser ADICIONADAS (append), nunca sobrescritas, para que
// folhas de anos anteriores continuem calculando com a tabela da época.
//
// Quando existir uma TaxTable ativa no banco para o ano, os brackets do banco
// têm precedência (ver brazilian-tax-calculator.service.ts); estas constantes
// são o fallback estatutário e a única fonte do REDUTOR da Lei 15.270/2025
// (o modelo TaxBracket não representa o redutor).
//
// Fontes:
// - INSS 2026: Portaria Interministerial MPS/MF nº 13, de 09/01/2026
//   (faixas 7,5%/9%/12%/14%, teto R$ 8.475,55; salário-família R$ 67,54 até
//   remuneração de R$ 1.980,38).
// - INSS 2025: Portaria Interministerial MPS/MF nº 6, de 10/01/2025.
// - IRRF (tabela progressiva mensal): Lei 14.663/2023 + MP 1.294/2025 (faixa
//   isenta R$ 2.428,80 desde 05/2025; sem alteração de faixas para 2026).
// - IRRF redutor 2026: Lei nº 15.270, de 26/11/2025 — isenção efetiva até
//   R$ 5.000,00/mês e redução decrescente até R$ 7.350,00/mês:
//   redução = R$ 978,62 − 0,133145 × rendimentos tributáveis (limitada ao
//   imposto apurado pela tabela progressiva; nunca negativa).
// - Dedução por dependente: R$ 189,59 (Lei 9.250/1995 art. 4º III, valor da
//   Lei 13.149/2015 — vigente em 2026).
// - Desconto simplificado mensal: R$ 607,20 (25% da faixa isenta; substitui
//   as deduções legais quando mais benéfico).
// ============================================================================

import { roundCurrency } from '@utils/currency-precision.util';

// =====================
// Tipos
// =====================

export interface ProgressiveBracket {
  /** Limite inferior da faixa (inclusive). */
  minValue: number;
  /** Limite superior da faixa (inclusive); null = sem teto. */
  maxValue: number | null;
  /** Alíquota em % (ex.: 7.5). */
  rate: number;
  /** Parcela a deduzir (apenas IRRF). */
  deduction?: number;
}

export interface InssTaxTable {
  year: number;
  effectiveFrom: string; // ISO date
  legalReference: string;
  brackets: ProgressiveBracket[];
  /** Teto do salário de contribuição. */
  ceiling: number;
  /** Desconto máximo possível (informativo). */
  maxContribution: number;
}

export interface IrrfRedutor {
  /** Rendimentos tributáveis mensais até este valor: imposto zerado. */
  fullExemptionUpTo: number;
  /** Fim da faixa de redução parcial (acima disso, sem redução). */
  phaseOutEnd: number;
  /** Coeficiente linear: redução = coefA − coefB × rendimentos. */
  coefA: number;
  coefB: number;
  legalReference: string;
}

export interface IrrfTaxTable {
  year: number;
  effectiveFrom: string;
  legalReference: string;
  brackets: ProgressiveBracket[];
  /** Dedução mensal por dependente. */
  dependentDeduction: number;
  /** Desconto simplificado mensal (substitui deduções legais). */
  simplifiedDeduction: number;
  /** Redutor Lei 15.270/2025 (a partir de 2026). */
  redutor: IrrfRedutor | null;
}

export interface SalarioFamiliaTable {
  year: number;
  effectiveFrom: string;
  legalReference: string;
  /** Valor da cota por filho/equiparado (≤14 anos ou inválido). */
  quota: number;
  /** Remuneração mensal máxima para ter direito. */
  remunerationLimit: number;
}

// =====================
// Constantes legais compartilhadas
// =====================

/** Dedução mensal de IRRF por dependente — R$ 189,59 (Lei 13.149/2015; vigente em 2026). */
export const IRRF_DEPENDENT_DEDUCTION = 189.59;

/** Desconto simplificado mensal do IRRF — R$ 607,20 (Lei 14.663/2023 + MP 1.294/2025). */
export const IRRF_SIMPLIFIED_DEDUCTION = 607.2;

// =====================
// Tabelas INSS (empregado/doméstico/avulso) — progressivas
// =====================

export const INSS_TABLES: InssTaxTable[] = [
  {
    year: 2025,
    effectiveFrom: '2025-01-01',
    legalReference: 'Portaria Interministerial MPS/MF nº 6/2025',
    brackets: [
      { minValue: 0, maxValue: 1518.0, rate: 7.5 },
      { minValue: 1518.01, maxValue: 2793.88, rate: 9 },
      { minValue: 2793.89, maxValue: 4190.83, rate: 12 },
      { minValue: 4190.84, maxValue: 8157.41, rate: 14 },
    ],
    ceiling: 8157.41,
    maxContribution: 951.62,
  },
  {
    year: 2026,
    effectiveFrom: '2026-01-01',
    legalReference: 'Portaria Interministerial MPS/MF nº 13/2026',
    brackets: [
      { minValue: 0, maxValue: 1621.0, rate: 7.5 },
      { minValue: 1621.01, maxValue: 2902.84, rate: 9 },
      { minValue: 2902.85, maxValue: 4354.27, rate: 12 },
      { minValue: 4354.28, maxValue: 8475.55, rate: 14 },
    ],
    ceiling: 8475.55,
    maxContribution: 988.09,
  },
];

// =====================
// Tabelas IRRF mensais
// =====================

const IRRF_BRACKETS_SINCE_2025_05: ProgressiveBracket[] = [
  { minValue: 0, maxValue: 2428.8, rate: 0, deduction: 0 },
  { minValue: 2428.81, maxValue: 2826.65, rate: 7.5, deduction: 182.16 },
  { minValue: 2826.66, maxValue: 3751.05, rate: 15, deduction: 394.16 },
  { minValue: 3751.06, maxValue: 4664.68, rate: 22.5, deduction: 675.49 },
  { minValue: 4664.69, maxValue: null, rate: 27.5, deduction: 908.73 },
];

export const IRRF_TABLES: IrrfTaxTable[] = [
  {
    year: 2025,
    effectiveFrom: '2025-05-01',
    legalReference: 'Lei 14.663/2023 + MP 1.294/2025',
    brackets: IRRF_BRACKETS_SINCE_2025_05,
    dependentDeduction: IRRF_DEPENDENT_DEDUCTION,
    simplifiedDeduction: IRRF_SIMPLIFIED_DEDUCTION,
    redutor: null,
  },
  {
    year: 2026,
    effectiveFrom: '2026-01-01',
    legalReference: 'Lei 15.270/2025 (redutor) sobre a tabela vigente',
    brackets: IRRF_BRACKETS_SINCE_2025_05,
    dependentDeduction: IRRF_DEPENDENT_DEDUCTION,
    simplifiedDeduction: IRRF_SIMPLIFIED_DEDUCTION,
    redutor: {
      fullExemptionUpTo: 5000.0,
      phaseOutEnd: 7350.0,
      coefA: 978.62,
      coefB: 0.133145,
      legalReference: 'Lei nº 15.270/2025, art. 1º',
    },
  },
];

// =====================
// Salário-família
// =====================

export const SALARIO_FAMILIA_TABLES: SalarioFamiliaTable[] = [
  {
    year: 2025,
    effectiveFrom: '2025-01-01',
    legalReference: 'Portaria Interministerial MPS/MF nº 6/2025',
    quota: 65.0,
    remunerationLimit: 1906.04,
  },
  {
    year: 2026,
    effectiveFrom: '2026-01-01',
    legalReference: 'Portaria Interministerial MPS/MF nº 13/2026',
    quota: 67.54,
    remunerationLimit: 1980.38,
  },
];

// =====================
// Seleção de tabela por ano
// =====================

function latestForYear<T extends { year: number }>(tables: T[], year: number): T {
  const sorted = [...tables].sort((a, b) => a.year - b.year);
  let chosen = sorted[0];
  for (const table of sorted) {
    if (table.year <= year) chosen = table;
  }
  return chosen;
}

/** Tabela INSS vigente para o ano (anos futuros usam a última publicada). */
export function getInssTableForYear(year: number): InssTaxTable {
  return latestForYear(INSS_TABLES, year);
}

/** Tabela IRRF vigente para o ano (anos futuros usam a última publicada). */
export function getIrrfTableForYear(year: number): IrrfTaxTable {
  return latestForYear(IRRF_TABLES, year);
}

/** Tabela de salário-família vigente para o ano. */
export function getSalarioFamiliaTableForYear(year: number): SalarioFamiliaTable {
  return latestForYear(SALARIO_FAMILIA_TABLES, year);
}

// =====================
// Cálculos puros
// =====================

export interface InssComputation {
  total: number;
  effectiveRate: number;
  perBracket: Array<{
    bracketOrder: number;
    minValue: number;
    maxValue: number | null;
    rate: number;
    incomeInBracket: number;
    taxOnBracket: number;
  }>;
}

/**
 * INSS progressivo: cada alíquota incide apenas sobre a parcela do salário
 * dentro da respectiva faixa; salários acima do teto contribuem só até ele.
 * Implementação por tetos acumulados — imune a lacunas de R$ 0,01 entre faixas.
 */
export function computeProgressiveINSS(
  salary: number,
  brackets: ProgressiveBracket[],
): InssComputation {
  const sorted = [...brackets].sort((a, b) => a.minValue - b.minValue);
  let previousCap = 0;
  let total = 0;
  const perBracket: InssComputation['perBracket'] = [];

  sorted.forEach((bracket, index) => {
    const cap = bracket.maxValue ?? Infinity;
    const incomeInBracket = Math.max(0, Math.min(salary, cap) - previousCap);
    const taxOnBracket = (incomeInBracket * bracket.rate) / 100;
    total += taxOnBracket;

    perBracket.push({
      bracketOrder: index + 1,
      minValue: bracket.minValue,
      maxValue: bracket.maxValue,
      rate: bracket.rate,
      incomeInBracket: roundCurrency(incomeInBracket),
      taxOnBracket: roundCurrency(taxOnBracket),
    });

    previousCap = cap === Infinity ? previousCap : cap;
  });

  const rounded = roundCurrency(total);
  return {
    total: rounded,
    effectiveRate: salary > 0 ? roundCurrency((rounded / salary) * 100) : 0,
    perBracket,
  };
}

export interface IrrfComputationInput {
  /**
   * Base de cálculo do IRRF (bruto tributável JÁ reduzido por deduções
   * itemizadas que o chamador subtrai ANTES da tabela — p.ex. pensão
   * alimentícia e plano de saúde). É sobre esta figura que incidem as
   * deduções (INSS + dependentes / simplificado) e a tabela progressiva.
   */
  taxableGross: number;
  /**
   * Rendimentos tributáveis BRUTOS de referência para o REDUTOR da Lei
   * 15.270/2025 (faixa de elegibilidade e fórmula do redutor). Devem ser os
   * rendimentos ANTES das deduções itemizadas (pensão/plano), pois o redutor
   * é função dos rendimentos, não da base reduzida. Quando omitido, usa
   * `taxableGross` (compatível com chamadores sem deduções itemizadas, p.ex.
   * férias/13º). Ver Lei 15.270/2025. PENDENTE DE VALIDAÇÃO DA CONTADORA
   * (Andressa): a separação base × referência-do-redutor segue a leitura mais
   * defensável (o redutor é benefício sobre os rendimentos, não sobre a base
   * itemizada), mas requer assinatura contábil.
   */
  redutorReference?: number;
  /** INSS retido no mês (dedução legal). */
  inssAmount: number;
  /** Dependentes elegíveis à dedução de IRRF. */
  dependentsCount: number;
  /** Permitir o desconto simplificado quando for mais benéfico. */
  allowSimplifiedDeduction: boolean;
  table: IrrfTaxTable;
}

export interface IrrfComputation {
  tax: number;
  taxableIncome: number;
  /** Deduções legais (INSS + dependentes). */
  legalDeductions: number;
  dependentsDeduction: number;
  /** true quando o desconto simplificado substituiu as deduções legais. */
  usedSimplifiedDeduction: boolean;
  simplifiedDeduction: number;
  /** Imposto pela tabela progressiva antes do redutor da Lei 15.270/2025. */
  taxBeforeRedutor: number;
  /** Redução aplicada (Lei 15.270/2025); 0 quando não aplicável. */
  redutorAmount: number;
  appliedBracket: {
    minValue: number;
    maxValue: number | null;
    rate: number;
    deduction: number;
  } | null;
}

/**
 * IRRF mensal:
 * 1. Deduções: o MAIOR entre (INSS + dependentes × R$ 189,59) e o desconto
 *    simplificado de R$ 607,20 (Lei 14.663/2023 — o simplificado SUBSTITUI as
 *    deduções legais e só é usado quando mais benéfico; deduções maiores ⇒
 *    imposto menor, então maximizar a dedução minimiza o imposto).
 * 2. Tabela progressiva: imposto = base × alíquota − parcela a deduzir.
 * 3. Redutor Lei 15.270/2025 (tabelas 2026+): aplicado sobre o imposto
 *    apurado, em função dos RENDIMENTOS TRIBUTÁVEIS (não da base):
 *    - rendimentos ≤ R$ 5.000,00 → imposto zerado;
 *    - R$ 5.000,01–7.350,00 → redução = 978,62 − 0,133145 × rendimentos,
 *      limitada ao imposto apurado e nunca negativa;
 *    - acima de R$ 7.350,00 → sem redução.
 */
export function computeIRRF(input: IrrfComputationInput): IrrfComputation {
  const { taxableGross, inssAmount, dependentsCount, allowSimplifiedDeduction, table } = input;
  // Referência do REDUTOR (Lei 15.270/2025): rendimentos tributáveis BRUTOS,
  // ANTES das deduções itemizadas (pensão/plano). Sem itemização, é o próprio
  // taxableGross. Mantém as deduções reduzindo a BASE (bracket), mas avalia o
  // redutor sobre os rendimentos. PENDENTE sign-off contábil (Andressa).
  const redutorReference = input.redutorReference ?? taxableGross;

  const dependentsDeduction = roundCurrency(dependentsCount * table.dependentDeduction);
  const legalDeductions = roundCurrency(inssAmount + dependentsDeduction);

  const usedSimplifiedDeduction =
    allowSimplifiedDeduction && table.simplifiedDeduction > legalDeductions;
  const appliedDeductions = usedSimplifiedDeduction ? table.simplifiedDeduction : legalDeductions;

  const taxableIncome = roundCurrency(Math.max(0, taxableGross - appliedDeductions));

  // Faixa aplicável (fórmula simplificada: base × alíquota − parcela a deduzir)
  let taxBeforeRedutor = 0;
  let appliedBracket: IrrfComputation['appliedBracket'] = null;
  for (const bracket of table.brackets) {
    const max = bracket.maxValue ?? Infinity;
    if (taxableIncome >= bracket.minValue && taxableIncome <= max) {
      const deduction = bracket.deduction ?? 0;
      taxBeforeRedutor = Math.max(0, (taxableIncome * bracket.rate) / 100 - deduction);
      appliedBracket = {
        minValue: bracket.minValue,
        maxValue: bracket.maxValue,
        rate: bracket.rate,
        deduction,
      };
      break;
    }
  }
  taxBeforeRedutor = roundCurrency(taxBeforeRedutor);

  // Redutor Lei 15.270/2025 — chaveado pelos RENDIMENTOS tributáveis brutos
  // (redutorReference), NÃO pela base já reduzida por pensão/plano. Subtrair as
  // deduções itemizadas antes do teste de faixa over-concedia o redutor na
  // faixa R$ 5k–7,35k. As deduções itemizadas continuam reduzindo a BASE da
  // tabela (taxableIncome/taxBeforeRedutor acima); apenas a referência do
  // redutor passou a ser os rendimentos brutos. PENDENTE sign-off Andressa.
  let redutorAmount = 0;
  if (table.redutor && taxBeforeRedutor > 0) {
    const { fullExemptionUpTo, phaseOutEnd, coefA, coefB } = table.redutor;
    if (redutorReference <= fullExemptionUpTo) {
      redutorAmount = taxBeforeRedutor;
    } else if (redutorReference <= phaseOutEnd) {
      redutorAmount = Math.min(
        taxBeforeRedutor,
        Math.max(0, roundCurrency(coefA - coefB * redutorReference)),
      );
    }
  }
  redutorAmount = roundCurrency(redutorAmount);

  return {
    tax: roundCurrency(taxBeforeRedutor - redutorAmount),
    taxableIncome,
    legalDeductions,
    dependentsDeduction,
    usedSimplifiedDeduction,
    simplifiedDeduction: usedSimplifiedDeduction ? table.simplifiedDeduction : 0,
    taxBeforeRedutor,
    redutorAmount,
    appliedBracket,
  };
}

/**
 * Salário-família: cota por dependente elegível (salarioFamilia = true) quando
 * a remuneração mensal não excede o limite da portaria vigente.
 * É um BENEFÍCIO pago junto ao salário (não integra a base de INSS/IRRF).
 */
export function computeSalarioFamilia(
  remuneration: number,
  eligibleDependentsCount: number,
  table: SalarioFamiliaTable,
): number {
  if (eligibleDependentsCount <= 0) return 0;
  if (remuneration > table.remunerationLimit) return 0;
  return roundCurrency(table.quota * eligibleDependentsCount);
}

// ============================================================================
// FÉRIAS — base de cálculo própria (Part C)
// ============================================================================

export interface VacationTaxInput {
  /** Remuneração-base das férias incl. média de variáveis (sem o 1/3). */
  baseRemuneration: number;
  /** Terço constitucional (geralmente baseRemuneration/3). */
  oneThird: number;
  /**
   * Abono pecuniário (venda de dias) — NÃO integra a base de INSS/IRRF
   * (verba indenizatória). Informe apenas para devolução no resultado.
   */
  abonoAmount?: number;
  /** Dependentes elegíveis à dedução de IRRF. */
  dependentsCount: number;
  /** Permitir desconto simplificado de IRRF quando mais benéfico. */
  allowSimplifiedDeduction: boolean;
  /** Ano de vigência das tabelas. */
  year: number;
}

export interface VacationTaxResult {
  /** Base tributável de INSS/IRRF = férias + 1/3 (abono é isento). */
  taxableBase: number;
  inss: number;
  irrf: number;
  /** Detalhamento completo do INSS (faixas) e do IRRF para auditoria. */
  inssDetail: InssComputation;
  irrfDetail: IrrfComputation;
}

/**
 * INSS/IRRF das FÉRIAS sobre base PRÓPRIA (férias + 1/3), separada da folha
 * mensal. O abono pecuniário (venda de até 10 dias) e o respectivo 1/3 são
 * verbas indenizatórias — NÃO entram na base tributável.
 *
 * Função pura — não persiste nada e não conhece consumidores (Phase 2 liga os callers).
 */
export function computeVacationTaxes(input: VacationTaxInput): VacationTaxResult {
  const { baseRemuneration, oneThird, dependentsCount, allowSimplifiedDeduction, year } = input;

  const taxableBase = roundCurrency(baseRemuneration + oneThird);

  const inssTable = getInssTableForYear(year);
  const irrfTable = getIrrfTableForYear(year);

  const inssDetail = computeProgressiveINSS(taxableBase, inssTable.brackets);
  const irrfDetail = computeIRRF({
    taxableGross: taxableBase,
    inssAmount: inssDetail.total,
    dependentsCount,
    allowSimplifiedDeduction,
    table: irrfTable,
  });

  return {
    taxableBase,
    inss: inssDetail.total,
    irrf: irrfDetail.tax,
    inssDetail,
    irrfDetail,
  };
}

// ============================================================================
// 13º SALÁRIO — base EXCLUSIVA (Part D)
// ============================================================================

export interface ThirteenthTaxInput {
  /**
   * Base do 13º (valor cheio devido no ano — proporcional aos avos já calculado
   * pelo caller), incl. média de variáveis. É a base sobre a qual incidem INSS
   * e IRRF na SEGUNDA parcela.
   */
  baseRemuneration: number;
  /** Dependentes elegíveis à dedução de IRRF. */
  dependentsCount: number;
  /** Permitir desconto simplificado de IRRF quando mais benéfico. */
  allowSimplifiedDeduction: boolean;
  /** Ano de vigência das tabelas. */
  year: number;
}

export interface ThirteenthTaxResult {
  /** Base tributável (= baseRemuneration do 13º). */
  taxableBase: number;
  inss: number;
  irrf: number;
  inssDetail: InssComputation;
  irrfDetail: IrrfComputation;
}

/**
 * INSS/IRRF do 13º salário sobre base EXCLUSIVA — tributado SEPARADAMENTE do
 * salário do mês (não se soma à folha de dezembro). A 1ª parcela é paga sem
 * descontos; INSS e IRRF incidem integralmente na 2ª parcela, calculados sobre
 * a base própria do 13º conforme esta função.
 *
 * Função pura — não persiste nada e não conhece consumidores (Phase 2 liga os callers).
 */
export function computeThirteenthTaxes(input: ThirteenthTaxInput): ThirteenthTaxResult {
  const { baseRemuneration, dependentsCount, allowSimplifiedDeduction, year } = input;

  const taxableBase = roundCurrency(baseRemuneration);

  const inssTable = getInssTableForYear(year);
  const irrfTable = getIrrfTableForYear(year);

  const inssDetail = computeProgressiveINSS(taxableBase, inssTable.brackets);
  const irrfDetail = computeIRRF({
    taxableGross: taxableBase,
    inssAmount: inssDetail.total,
    dependentsCount,
    allowSimplifiedDeduction,
    table: irrfTable,
  });

  return {
    taxableBase,
    inss: inssDetail.total,
    irrf: irrfDetail.tax,
    inssDetail,
    irrfDetail,
  };
}
