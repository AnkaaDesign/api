// benefit-discount.ts
// REGRA CANÔNICA da coparticipação de benefícios (empresa × colaborador).
//
// Esta é a única fonte de verdade para o cálculo do desconto do colaborador
// (parte do colaborador) e do custo da empresa (parte da empresa) de uma
// adesão de benefício (UserBenefit). É consumida por:
//   - Folha de pagamento (desconto de benefícios no holerite);
//   - Telas de Benefícios/Adesões (preview e colunas Empresa/Colaborador);
//   - Card de benefícios no detalhe do colaborador.
//
// Regra (em pseudo-código):
//   employeeShare(ub, baseSalary) =
//     ub.employeeDiscountValue != null
//       ? min(employeeDiscountValue, monthlyValue)
//       : ub.employeeDiscountPercent != null
//         ? (benefit.kind === TRANSPORT_VOUCHER
//             ? min(percent/100 × baseSalary, monthlyValue)   // CLT: VT desconta % do SALÁRIO
//             : percent/100 × monthlyValue)                   // demais: % do CUSTO do benefício
//         : 0
//   companyShare = monthlyValue − employeeShare
//
// Observações legais:
//   - Vale Transporte: desconto máximo de 6% do salário-base (Lei 7.418/85,
//     Decreto 95.247/87), nunca excedendo o custo do próprio VT.
//   - Vale Refeição/Alimentação: desconto máximo de 20% do custo (PAT).
//   - O arquivo é puro (sem dependências) e mantido IDÊNTICO em
//     api/src/utils/benefit-discount.ts e web/src/utils/benefit-discount.ts.

/** BenefitKind cujo percentual incide sobre o salário (Vale Transporte). */
export const SALARY_BASED_DISCOUNT_KIND = 'TRANSPORT_VOUCHER';

/** Campos mínimos de uma adesão (UserBenefit) usados pela regra. */
export interface BenefitShareRule {
  /** Custo total mensal do benefício (parte empresa + parte colaborador). */
  monthlyValue: number;
  /** Desconto fixo mensal do colaborador (exclusivo com o percentual). */
  employeeDiscountValue?: number | null;
  /** Percentual de desconto do colaborador (exclusivo com o valor fixo). */
  employeeDiscountPercent?: number | null;
  /** BenefitKind da adesão (ex.: 'TRANSPORT_VOUCHER'). */
  benefitKind?: string | null;
}

export interface BenefitShareSplit {
  /** Custo total mensal (espelho de monthlyValue, nunca negativo). */
  monthlyValue: number;
  /** Parte do colaborador (desconto em folha). */
  employeeShare: number;
  /** Parte da empresa (monthlyValue − employeeShare). */
  companyShare: number;
  /** true quando a regra é percentual de VT (depende do salário-base). */
  dependsOnSalary: boolean;
}

/**
 * Indica se a parte do colaborador depende do salário-base: regra percentual
 * de Vale Transporte sem desconto fixo.
 */
export function employeeShareDependsOnSalary(rule: BenefitShareRule): boolean {
  return (
    rule.benefitKind === SALARY_BASED_DISCOUNT_KIND &&
    (rule.employeeDiscountValue === null || rule.employeeDiscountValue === undefined) &&
    rule.employeeDiscountPercent !== null &&
    rule.employeeDiscountPercent !== undefined
  );
}

/**
 * Parte do colaborador (desconto em folha) de uma adesão.
 *
 * @param rule       Campos da adesão (UserBenefit) + tipo do benefício.
 * @param baseSalary Salário-base mensal do colaborador — obrigatório para a
 *                   regra percentual de VT; ignorado nos demais casos.
 *                   Quando desconhecido (null/undefined) é tratado como 0.
 * @returns Valor em R$, sempre dentro de [0, monthlyValue].
 */
export function calculateEmployeeShare(
  rule: BenefitShareRule,
  baseSalary?: number | null,
): number {
  const monthlyValue = Math.max(rule.monthlyValue ?? 0, 0);
  if (monthlyValue <= 0) return 0;

  const clamp = (value: number) => Math.min(Math.max(value, 0), monthlyValue);

  if (rule.employeeDiscountValue !== null && rule.employeeDiscountValue !== undefined) {
    return clamp(rule.employeeDiscountValue);
  }

  if (rule.employeeDiscountPercent !== null && rule.employeeDiscountPercent !== undefined) {
    const fraction = rule.employeeDiscountPercent / 100;
    if (rule.benefitKind === SALARY_BASED_DISCOUNT_KIND) {
      const salary = Math.max(baseSalary ?? 0, 0);
      return clamp(fraction * salary);
    }
    return clamp(fraction * monthlyValue);
  }

  return 0;
}

/**
 * Divisão completa empresa × colaborador de uma adesão.
 * companyShare = monthlyValue − employeeShare (nunca negativo).
 */
export function calculateBenefitSplit(
  rule: BenefitShareRule,
  baseSalary?: number | null,
): BenefitShareSplit {
  const monthlyValue = Math.max(rule.monthlyValue ?? 0, 0);
  const employeeShare = calculateEmployeeShare(rule, baseSalary);
  return {
    monthlyValue,
    employeeShare,
    companyShare: monthlyValue - employeeShare,
    dependsOnSalary: employeeShareDependsOnSalary(rule),
  };
}
